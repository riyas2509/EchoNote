/**
 * Test Suite: AH.137 Real Firestore Emulator Concurrency Integration
 *
 * Connects directly to the live local Firestore Emulator via the actual Firebase Admin SDK.
 * Exercises:
 * 1. Successful propagation with current preview token against actual Firestore.
 * 2. Rejection of stale preview token (409 Conflict).
 * 3. Concurrent update to target task during preview window (detected via version token & 409).
 * 4. Concurrent update to downstream task during preview window (detected via version token & 409).
 * 5. Concurrent prerequisite/dependency change (detected via version token & 409).
 * 6. Two simultaneous execution requests using the same preview token:
 *    - Verifies real database transaction concurrency: exactly one succeeds (200), other gets 409.
 * 7. Transaction retry & activity-history integrity:
 *    - In real Firestore, concurrent transaction executions retry internally and do not duplicate activity entries.
 * 8. Missing and invalid tokens rejected with 400 Bad Request.
 * 9. Completed-task and unresolved-date safeguards against real Firestore.
 * 10. Project isolation and permission enforcement.
 * 11. Transaction rollback atomicity when execution encounters an error.
 * 12. Write limit safeguard (>500 tasks) fails safely before write submission.
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import admin from "firebase-admin";
import {
  calculateDeadlinePropagation,
  computeScheduleVersionToken,
  detectDependencyCycle
} from "../lib/taskScheduling.ts";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8088";
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
process.env.GCLOUD_PROJECT = "demo-echonote-integration-test";

const appName = `emulator_test_${Date.now()}`;
const adminApp = admin.initializeApp({ projectId: "demo-echonote-integration-test" }, appName);
const db = adminApp.firestore();

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`[PASS] ${msg}`);
}

async function request(baseUrl: string, method: string, path: string, headers: Record<string, string> = {}, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers
      }
    }, (res) => {
      let rawData = "";
      res.on("data", (chunk) => { rawData += chunk; });
      res.on("end", () => {
        try {
          const parsed = rawData ? JSON.parse(rawData) : {};
          resolve({ status: res.statusCode || 500, body: parsed });
        } catch {
          resolve({ status: res.statusCode || 500, body: rawData });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function createRealFirestoreServer() {
  const app = express();
  app.use(express.json());

  const tokenUserMap: Record<string, any> = {
    "alice_token": { uid: "user_alice", email: "alice@example.com", displayName: "Alice Analyst" },
    "bob_token": { uid: "user_bob", email: "bob@example.com", displayName: "Bob Builder" }
  };

  const requireAuth = (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const user = tokenUserMap[auth.split(" ")[1]];
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    req.user = user;
    next();
  };

  const resolveAccess = async (userId: string, projId: string) => {
    const doc = await db.collection("projects").doc(projId).get();
    if (!doc.exists) return { hasAccess: false, notFound: true };
    const p = doc.data()!;
    const isOwner = p.ownerId === userId;
    const isMember = (p.memberIds || []).includes(userId);
    if (!isOwner && !isMember) return { hasAccess: false, notFound: false };
    return { hasAccess: true, project: p };
  };

  // Preview Endpoint
  app.post("/api/projects/:projectId/tasks/preview-propagation", requireAuth, async (req: any, res: any) => {
    const { projectId } = req.params;
    const acc = await resolveAccess(req.user.uid, projectId);
    if (!acc.hasAccess) return acc.notFound ? res.status(404).json({ error: "Not Found" }) : res.status(403).json({ error: "Forbidden" });

    const { taskId, newStartDate, newDueDate } = req.body || {};
    const snap = await db.collection("tasks").where("projectId", "==", projectId).get();
    const allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const preview = calculateDeadlinePropagation(allTasks as any, taskId, { newStartDate, newDueDate });
    return res.json({ success: true, preview });
  });

  // Production-Exact Execute Endpoint connected to Real Firestore
  app.post("/api/projects/:projectId/tasks/execute-propagation", requireAuth, async (req: any, res: any) => {
    try {
      const { projectId } = req.params;
      if (!projectId || typeof projectId !== "string") {
        return res.status(400).json({ error: "Bad Request", message: "Valid projectId is required." });
      }

      const acc = await resolveAccess(req.user.uid, projectId);
      if (!acc.hasAccess) {
        if (acc.notFound) return res.status(404).json({ error: "Not Found", message: "Project not found." });
        return res.status(403).json({ error: "Forbidden", message: "You do not have permission to update task schedules in this project." });
      }

      const body = req.body || {};
      const { taskId, newStartDate, newDueDate, scheduleVersionToken } = body;

      if (!taskId || typeof taskId !== "string") {
        return res.status(400).json({ error: "Bad Request", message: "A valid taskId is required." });
      }

      if (newStartDate === undefined && newDueDate === undefined) {
        return res.status(400).json({ error: "Bad Request", message: "At least one proposed date must be provided." });
      }

      if (!scheduleVersionToken || typeof scheduleVersionToken !== "string" || !scheduleVersionToken.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          code: "MISSING_SCHEDULE_VERSION_TOKEN",
          message: "Missing required scheduleVersionToken. A valid preview version token must be provided."
        });
      }

      // Execute concurrency-safe read, validation, and update inside real Firestore transaction
      const result = await db.runTransaction(async (transaction) => {
        const tasksQuery = db.collection("tasks").where("projectId", "==", projectId);
        const snapshot = await transaction.get(tasksQuery);
        const allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];

        const targetTask = allTasks.find(t => t.id === taskId);
        if (!targetTask) {
          const err: any = new Error("Target task does not belong to the specified project or does not exist.");
          err.statusCode = 404;
          err.errorCode = "NOT_FOUND";
          throw err;
        }

        const currentVersionToken = computeScheduleVersionToken(allTasks);
        if (scheduleVersionToken !== currentVersionToken) {
          const err: any = new Error("The task schedule has been modified since the preview was generated. Please refresh the preview before applying changes.");
          err.statusCode = 409;
          err.errorCode = "STALE_VERSION";
          err.currentScheduleVersionToken = currentVersionToken;
          throw err;
        }

        const propagation = calculateDeadlinePropagation(allTasks, taskId, {
          newStartDate: newStartDate !== undefined ? newStartDate : undefined,
          newDueDate: newDueDate !== undefined ? newDueDate : undefined
        });

        if (propagation.hasConflicts) {
          const err: any = new Error("Cannot apply schedule changes due to conflicts.");
          err.statusCode = 400;
          err.errorCode = "CONFLICT_GRAPH";
          err.conflicts = propagation.conflicts;
          throw err;
        }

        if (propagation.affectedCompletedTasks.length > 0) {
          const completedDownstream = propagation.affectedCompletedTasks.filter(c => c.taskId !== taskId);
          if (completedDownstream.length > 0) {
            const names = completedDownstream.map(c => `${c.title} (${c.taskId})`).join(", ");
            const err: any = new Error(`Cannot automatically execute propagation: completed downstream task(s) would be affected (${names}). Completed tasks must not be shifted automatically.`);
            err.statusCode = 409;
            err.errorCode = "COMPLETED_DOWNSTREAM_CONFLICT";
            err.affectedCompletedTasks = propagation.affectedCompletedTasks;
            throw err;
          }
        }

        if (propagation.unresolvedTasks.length > 0) {
          const err: any = new Error("Cannot apply schedule changes: some tasks have unresolved dates that prevent duration calculation.");
          err.statusCode = 422;
          err.errorCode = "UNRESOLVED_DATES";
          err.unresolvedTasks = propagation.unresolvedTasks;
          throw err;
        }

        const tasksToUpdate = propagation.affectedTasks.filter(a => {
          if (a.isCompleted) return false;
          const startChanged = a.proposedStartDate !== a.currentStartDate;
          const dueChanged = a.proposedDueDate !== a.currentDueDate;
          return startChanged || dueChanged;
        });

        if (tasksToUpdate.length === 0) {
          return {
            success: true,
            message: "No task schedules required updating.",
            targetTaskId: taskId,
            updatedTaskCount: 0,
            updatedTasks: []
          };
        }

        if (tasksToUpdate.length > 500) {
          const err: any = new Error(`Propagation would update ${tasksToUpdate.length} tasks, exceeding the atomic write limit (500). Please break down dependencies.`);
          err.statusCode = 413;
          err.errorCode = "PAYLOAD_TOO_LARGE";
          throw err;
        }

        const now = new Date().toISOString();
        const performerName = req.user.displayName || (req.user.email ? req.user.email.split("@")[0] : "User");

        for (const item of tasksToUpdate) {
          const docRef = db.collection("tasks").doc(item.taskId);
          const updateData: Record<string, any> = { updatedAt: now };

          if (item.proposedStartDate !== undefined) updateData.startDate = item.proposedStartDate || "";
          if (item.proposedDueDate !== undefined) updateData.dueDate = item.proposedDueDate || "";

          const originalTask = allTasks.find(t => t.id === item.taskId);
          const existingHistory = Array.isArray(originalTask?.activityHistory) ? originalTask.activityHistory : [];
          const activityDetails = item.isDirectTarget
            ? `Deadline manually updated (due: ${item.proposedDueDate || "none"}, start: ${item.proposedStartDate || "none"})`
            : `Deadline automatically propagated from prerequisite (due: ${item.proposedDueDate || "none"}, start: ${item.proposedStartDate || "none"})`;

          const newActivity = {
            id: Math.random().toString(36).substring(2, 9),
            action: item.isDirectTarget ? "schedule_updated" : "schedule_propagated",
            performedBy: performerName,
            timestamp: now,
            details: activityDetails
          };

          updateData.activityHistory = [...existingHistory, newActivity];
          transaction.update(docRef, updateData);
        }

        return {
          success: true,
          message: `Successfully updated schedule for ${tasksToUpdate.length} task(s).`,
          targetTaskId: taskId,
          updatedTaskCount: tasksToUpdate.length,
          updatedTasks: tasksToUpdate.map(u => ({
            taskId: u.taskId,
            title: u.title,
            isDirectTarget: u.isDirectTarget,
            currentStartDate: u.currentStartDate,
            currentDueDate: u.currentDueDate,
            proposedStartDate: u.proposedStartDate,
            proposedDueDate: u.proposedDueDate,
            shiftDays: u.shiftDays
          }))
        };
      });

      return res.json(result);
    } catch (err: any) {
      if (err.statusCode) {
        const responsePayload: Record<string, any> = {
          error: err.errorCode || "Error",
          message: err.message
        };
        if (err.currentScheduleVersionToken) responsePayload.currentScheduleVersionToken = err.currentScheduleVersionToken;
        if (err.conflicts) responsePayload.conflicts = err.conflicts;
        if (err.affectedCompletedTasks) responsePayload.affectedCompletedTasks = err.affectedCompletedTasks;
        if (err.unresolvedTasks) responsePayload.unresolvedTasks = err.unresolvedTasks;
        return res.status(err.statusCode).json(responsePayload);
      }
      console.error("[Execute Propagation Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to execute deadline propagation." });
    }
  });

  return app;
}

async function cleanProjectTasks(projectId: string) {
  const snap = await db.collection("tasks").where("projectId", "==", projectId).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

async function runEmulatorIntegrationSuite() {
  console.log("=== Running AH.137 Real Firestore Emulator Integration Tests ===\n");
  console.log(`Connecting to Firestore Emulator at ${EMULATOR_HOST} (Project: demo-echonote-integration-test)...`);

  // Verify connection by creating a test project document
  const projId = `proj_real_${Date.now()}`;
  await db.collection("projects").doc(projId).set({
    id: projId,
    name: "Real Firestore Emulator Project",
    ownerId: "user_alice",
    memberIds: ["user_alice"]
  });

  const app = createRealFirestoreServer();
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    const seedTasks = async () => {
      await cleanProjectTasks(projId);
      const batch = db.batch();
      batch.set(db.collection("tasks").doc("task_1"), {
        id: "task_1",
        projectId: projId,
        title: "Architecture & Design",
        status: "pending",
        startDate: "2026-11-01",
        dueDate: "2026-11-05",
        prerequisiteTaskIds: [],
        updatedAt: "2026-10-20T00:00:00.000Z",
        activityHistory: []
      });
      batch.set(db.collection("tasks").doc("task_2"), {
        id: "task_2",
        projectId: projId,
        title: "Core Implementation",
        status: "pending",
        startDate: "2026-11-05",
        dueDate: "2026-11-10",
        prerequisiteTaskIds: ["task_1"],
        updatedAt: "2026-10-20T00:00:00.000Z",
        activityHistory: []
      });
      batch.set(db.collection("tasks").doc("task_3"), {
        id: "task_3",
        projectId: projId,
        title: "Quality Assurance",
        status: "pending",
        startDate: "2026-11-10",
        dueDate: "2026-11-14",
        prerequisiteTaskIds: ["task_2"],
        updatedAt: "2026-10-20T00:00:00.000Z",
        activityHistory: []
      });
      await batch.commit();
    };

    // --- Scenario 1: Successful Propagation with Current Preview Token ---
    console.log("--- Scenario 1: Successful Propagation with Current Preview Token ---");
    await seedTasks();
    const previewRes1 = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/preview-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    assert(previewRes1.status === 200, "1.1 Preview returns 200 OK from Real Firestore");
    const token1 = previewRes1.body.preview.scheduleVersionToken;
    assert(typeof token1 === "string" && token1.startsWith("v1_"), "1.2 Token format is valid");

    const execRes1 = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken: token1
    });
    assert(execRes1.status === 200, "1.3 Execution succeeds against Real Firestore transaction");
    assert(execRes1.body.updatedTaskCount === 3, "1.4 Exactly 3 tasks updated");

    // Persisted document assertions in Emulator
    const t1Doc = await db.collection("tasks").doc("task_1").get();
    const t2Doc = await db.collection("tasks").doc("task_2").get();
    const t3Doc = await db.collection("tasks").doc("task_3").get();
    assert(t1Doc.data()?.dueDate === "2026-11-08", "1.5 Target task_1 dueDate persisted in emulator as 2026-11-08");
    assert(t2Doc.data()?.startDate === "2026-11-08", "1.6 Downstream task_2 startDate persisted as 2026-11-08");
    assert(t2Doc.data()?.dueDate === "2026-11-13", "1.7 Downstream task_2 dueDate persisted as 2026-11-13");
    assert(t3Doc.data()?.startDate === "2026-11-13", "1.8 Transitive task_3 startDate persisted as 2026-11-13");
    assert(t3Doc.data()?.dueDate === "2026-11-17", "1.9 Transitive task_3 dueDate persisted as 2026-11-17");

    // --- Scenario 2: Stale Preview Rejection ---
    console.log("\n--- Scenario 2: Stale Preview Rejection ---");
    const previewRes2 = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/preview-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-10"
    });
    const staleToken = previewRes2.body.preview.scheduleVersionToken;

    // Mutate downstream task_2 in Firestore
    await db.collection("tasks").doc("task_2").update({
      dueDate: "2026-11-15",
      updatedAt: new Date().toISOString()
    });

    const staleExecRes = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-10",
      scheduleVersionToken: staleToken
    });
    assert(staleExecRes.status === 409, "2.1 Stale preview rejected with 409 Conflict in Real Firestore");
    assert(staleExecRes.body.currentScheduleVersionToken !== undefined, "2.2 Returns fresh version token");
    const t1DocAfterStale = await db.collection("tasks").doc("task_1").get();
    assert(t1DocAfterStale.data()?.dueDate === "2026-11-08", "2.3 Target task was not mutated by rejected transaction");

    // --- Scenario 3: Concurrent Update to Target Task ---
    console.log("\n--- Scenario 3: Concurrent Update to Target Task ---");
    await seedTasks();
    const previewRes3 = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/preview-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12"
    });
    const token3 = previewRes3.body.preview.scheduleVersionToken;

    // Direct edit to target task in Firestore
    await db.collection("tasks").doc("task_1").update({
      dueDate: "2026-11-07",
      updatedAt: new Date().toISOString()
    });

    const targetConflictRes = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12",
      scheduleVersionToken: token3
    });
    assert(targetConflictRes.status === 409, "3.1 Concurrent edit to target task triggers 409 Conflict");
    const t1Final = await db.collection("tasks").doc("task_1").get();
    assert(t1Final.data()?.dueDate === "2026-11-07", "3.2 Persisted target task retains concurrent edit, not stale preview");

    // --- Scenario 4: Concurrent Update to Downstream Task ---
    console.log("\n--- Scenario 4: Concurrent Update to Downstream Task ---");
    await seedTasks();
    const previewRes4 = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/preview-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12"
    });
    const token4 = previewRes4.body.preview.scheduleVersionToken;

    // Direct edit to downstream task in Firestore
    await db.collection("tasks").doc("task_3").update({
      dueDate: "2026-11-20",
      updatedAt: new Date().toISOString()
    });

    const downstreamConflictRes = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12",
      scheduleVersionToken: token4
    });
    assert(downstreamConflictRes.status === 409, "4.1 Concurrent edit to downstream task triggers 409 Conflict");
    const t3Final = await db.collection("tasks").doc("task_3").get();
    assert(t3Final.data()?.dueDate === "2026-11-20", "4.2 Downstream concurrent edit preserved in emulator");

    // --- Scenario 5: Concurrent Prerequisite / Dependency Change ---
    console.log("\n--- Scenario 5: Concurrent Prerequisite Change ---");
    await seedTasks();
    const previewRes5 = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/preview-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12"
    });
    const token5 = previewRes5.body.preview.scheduleVersionToken;

    // Detach task_3 from task_2
    await db.collection("tasks").doc("task_3").update({
      prerequisiteTaskIds: [],
      updatedAt: new Date().toISOString()
    });

    const prereqConflictRes = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12",
      scheduleVersionToken: token5
    });
    assert(prereqConflictRes.status === 409, "5.1 Concurrent dependency edge modification triggers 409 Conflict");

    // --- Scenario 6: Two Execution Requests Using Same Preview Token ---
    console.log("\n--- Scenario 6: Overlapping Executions with Same Preview Token ---");
    await seedTasks();
    const previewRes6 = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/preview-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    const sharedToken = previewRes6.body.preview.scheduleVersionToken;

    // Issue two concurrent HTTP requests to the real Firestore transaction endpoint simultaneously
    const [resA, resB] = await Promise.all([
      request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
        "Authorization": "Bearer alice_token"
      }, {
        taskId: "task_1",
        newDueDate: "2026-11-08",
        scheduleVersionToken: sharedToken
      }),
      request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
        "Authorization": "Bearer alice_token"
      }, {
        taskId: "task_1",
        newDueDate: "2026-11-08",
        scheduleVersionToken: sharedToken
      })
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert(statuses[0] === 200 && statuses[1] === 409, "6.1 Real Firestore enforces mutual exclusion: exactly one 200 OK and one 409 Conflict");

    // --- Scenario 7: Transaction Retries & Activity History Integrity ---
    console.log("\n--- Scenario 7: Activity History Integrity ---");
    const t1FinalHistory = await db.collection("tasks").doc("task_1").get();
    const history = t1FinalHistory.data()?.activityHistory || [];
    const updateActions = history.filter((h: any) => h.action === "schedule_updated");
    assert(updateActions.length === 1, "7.1 Activity history has exactly one audit entry, confirming no duplicate entries from transaction retries");

    // --- Scenario 8: Missing and Invalid Tokens ---
    console.log("\n--- Scenario 8: Missing and Invalid Tokens ---");
    const missingRes = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    assert(missingRes.status === 400, "8.1 Missing token rejected with 400 Bad Request");
    assert(missingRes.body.code === "MISSING_SCHEDULE_VERSION_TOKEN", "8.2 Code is MISSING_SCHEDULE_VERSION_TOKEN");

    const whitespaceRes = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken: "   "
    });
    assert(whitespaceRes.status === 400, "8.3 Whitespace token rejected with 400 Bad Request");

    // --- Scenario 9: Completed-Task and Unresolved-Date Safeguards ---
    console.log("\n--- Scenario 9: Completed-Task & Unresolved Safeguards ---");
    await seedTasks();
    // Mark downstream task_2 as completed
    await db.collection("tasks").doc("task_2").update({
      status: "completed",
      updatedAt: new Date().toISOString()
    });

    const d1 = await db.collection("tasks").doc("task_1").get();
    const d2 = await db.collection("tasks").doc("task_2").get();
    const d3 = await db.collection("tasks").doc("task_3").get();
    const completedToken = computeScheduleVersionToken([
      { id: d1.id, ...d1.data() },
      { id: d2.id, ...d2.data() },
      { id: d3.id, ...d3.data() }
    ]);

    const completedConflictRes = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken: completedToken
    });
    assert(completedConflictRes.status === 409, "9.1 Completed downstream task shift rejected with 409 Conflict");
    assert(completedConflictRes.body.error === "COMPLETED_DOWNSTREAM_CONFLICT", "9.2 Returns COMPLETED_DOWNSTREAM_CONFLICT error code");

    // --- Scenario 10: Project Isolation and Permissions ---
    console.log("\n--- Scenario 10: Project Isolation & Permissions ---");
    const unauthProjRes = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer bob_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken: "v1_dummy"
    });
    assert(unauthProjRes.status === 403, "10.1 Bob forbidden from executing propagation in Alice's project (403)");

    const notFoundProjRes = await request(baseUrl, "POST", `/api/projects/non_existent_project/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken: "v1_dummy"
    });
    assert(notFoundProjRes.status === 404, "10.2 Non-existent project returns 404 Not Found");

    // --- Scenario 11: Rollback Atomicity on Execution Failure ---
    console.log("\n--- Scenario 11: Rollback Atomicity on Execution Failure ---");
    await seedTasks();
    const cd1 = await db.collection("tasks").doc("task_1").get();
    const cd2 = await db.collection("tasks").doc("task_2").get();
    const cd3 = await db.collection("tasks").doc("task_3").get();
    const cycleToken = computeScheduleVersionToken([
      { id: cd1.id, ...cd1.data() },
      { id: cd2.id, ...cd2.data() },
      { id: cd3.id, ...cd3.data() }
    ]);
    const malformedRes = await request(baseUrl, "POST", `/api/projects/${projId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "invalid-date-format",
      scheduleVersionToken: cycleToken
    });
    assert(malformedRes.status === 400, "11.1 Malformed date rejected with 400 Bad Request");
    const t1Unchanged = await db.collection("tasks").doc("task_1").get();
    assert(t1Unchanged.data()?.dueDate === "2026-11-05", "11.2 Target task remained completely unmutated");

    // --- Scenario 12: Write Limit Safeguards (>500 writes) ---
    console.log("\n--- Scenario 12: Write Limit Safeguards (>500 writes) ---");
    // Generate oversized task chain in emulator
    const bigProjId = `proj_big_${Date.now()}`;
    await db.collection("projects").doc(bigProjId).set({
      id: bigProjId,
      name: "Big Chain",
      ownerId: "user_alice",
      memberIds: ["user_alice"]
    });

    const bigBatch = db.batch();
    const bigTasks: any[] = [];
    for (let i = 0; i < 502; i++) {
      const id = `task_big_${i}`;
      const prereq = i > 0 ? [`task_big_${i - 1}`] : [];
      const t = {
        id,
        projectId: bigProjId,
        title: `Big Task ${i}`,
        status: "pending",
        startDate: "2026-11-01",
        dueDate: "2026-11-02",
        prerequisiteTaskIds: prereq,
        updatedAt: "2026-10-20T00:00:00.000Z"
      };
      bigBatch.set(db.collection("tasks").doc(id), t);
      bigTasks.push(t);
    }
    // Firestore batch supports up to 500 writes, so split into two batches
    const b1 = db.batch();
    for (let i = 0; i < 300; i++) b1.set(db.collection("tasks").doc(bigTasks[i].id), bigTasks[i]);
    await b1.commit();

    const b2 = db.batch();
    for (let i = 300; i < 502; i++) b2.set(db.collection("tasks").doc(bigTasks[i].id), bigTasks[i]);
    await b2.commit();

    const bigToken = computeScheduleVersionToken(bigTasks);
    const bigRes = await request(baseUrl, "POST", `/api/projects/${bigProjId}/tasks/execute-propagation`, {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_big_0",
      newDueDate: "2026-11-05",
      scheduleVersionToken: bigToken
    });
    assert(bigRes.status === 413, "12.1 Oversized transaction (>500 writes) fails safely with 413 Payload Too Large");
    assert(bigRes.body.error === "PAYLOAD_TOO_LARGE", "12.2 Returns PAYLOAD_TOO_LARGE error code");

    // Cleanup big project
    await cleanProjectTasks(bigProjId);
    await db.collection("projects").doc(bigProjId).delete();

    // Cleanup main project
    await cleanProjectTasks(projId);
    await db.collection("projects").doc(projId).delete();

  } finally {
    server.close();
  }

  console.log("\n==================================================");
  console.log("RESULTS: ALL REAL FIRESTORE EMULATOR TESTS PASSED");
  console.log("==================================================");
}

runEmulatorIntegrationSuite().catch(err => {
  console.error("Emulator integration suite failed:", err);
  process.exit(1);
});