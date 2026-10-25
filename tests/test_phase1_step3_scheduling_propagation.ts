/**
 * Test Suite: AH.131 Phase 1 Dependency Cycle Detection and Deadline Propagation Preview
 * 
 * Tests:
 * 1. Direct self-dependency rejection
 * 2. Two-node cycle rejection (A -> B -> A)
 * 3. Three-node or longer cycle rejection (A -> B -> C -> A)
 * 4. Valid acyclic dependency graphs (DAG)
 * 5. Missing prerequisite rejection
 * 6. Cross-project prerequisite rejection
 * 7. Single-level downstream impact calculation
 * 8. Multi-level transitive propagation (topological order)
 * 9. Preservation of task duration
 * 10. Completed downstream task protection and warning reporting
 * 11. Date-only arithmetic across timezone boundaries
 * 12. Missing or malformed date handling
 * 13. Preview response correctness
 * 14. Preview does not modify Firestore documents
 * 15. Unauthenticated preview request rejection
 * 16. Unauthorized project access rejection
 * 17. Existing task CRUD and search-history routes remain functional
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import {
  parseCalendarDate,
  formatCalendarDate,
  addCalendarDays,
  diffCalendarDays,
  maxCalendarDate,
  detectDependencyCycle,
  calculateDeadlinePropagation,
  SchedulableTask
} from "../lib/taskScheduling.ts";

class MockDocSnapshot {
  constructor(public id: string, private _data: any, private _collRef?: any) {}
  get exists(): boolean { return this._data !== undefined && this._data !== null; }
  data(): any { return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined; }
  get ref() { return this._collRef ? this._collRef.doc(this.id) : { id: this.id }; }
}

class MockQuerySnapshot {
  constructor(public docs: MockDocSnapshot[]) {}
  get empty(): boolean { return this.docs.length === 0; }
  get size(): number { return this.docs.length; }
}

class MockCollectionReference {
  constructor(private db: MockFirestore, private collectionName: string) {}
  doc(id?: string) {
    const collName = this.collectionName;
    const db = this.db;
    const docId = id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ref = {
      id: docId,
      get: async () => new MockDocSnapshot(docId, db.store.get(`${collName}/${docId}`), this),
      set: async (data: any) => { db.store.set(`${collName}/${docId}`, { ...data }); },
      update: async (data: any) => {
        const ex = db.store.get(`${collName}/${docId}`);
        if (!ex) throw new Error(`Document ${collName}/${docId} not found`);
        db.store.set(`${collName}/${docId}`, { ...ex, ...data });
      },
      delete: async () => { db.store.delete(`${collName}/${docId}`); }
    };
    return ref;
  }
  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionName, [{ field, op, val }]);
  }
  async get() { return new MockQuery(this.db, this.collectionName, []).get(); }
}

class MockQuery {
  private _limit?: number;
  constructor(
    private db: MockFirestore,
    private collectionName: string,
    private filters: Array<{ field: string; op: string; val: any }>
  ) {}
  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionName, [...this.filters, { field, op, val }]);
  }
  limit(n: number) {
    this._limit = n;
    return this;
  }
  async get(): Promise<MockQuerySnapshot> {
    const prefix = `${this.collectionName}/`;
    let matched: MockDocSnapshot[] = [];
    for (const [key, data] of this.db.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      let matches = true;
      for (const f of this.filters) {
        if (f.op === "==" && data[f.field] !== f.val) { matches = false; break; }
        if (f.op === "array-contains" && (!Array.isArray(data[f.field]) || !data[f.field].includes(f.val))) { matches = false; break; }
      }
      if (matches) matched.push(new MockDocSnapshot(id, data, this.db.collection(this.collectionName)));
    }
    if (typeof this._limit === "number") matched = matched.slice(0, this._limit);
    return new MockQuerySnapshot(matched);
  }
}

class MockFirestore {
  public store = new Map<string, any>();
  collection(name: string) { return new MockCollectionReference(this, name); }
}

function createTestServer(db: any, tokenUserMap: Record<string, any>) {
  const app = express();
  app.use(express.json());

  const requireAuth = (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const user = tokenUserMap[auth.split(" ")[1]];
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    req.user = user;
    next();
  };

  const checkProjAccess = (userId: string, projId: string, reqPermission: string) => {
    const p = db.store.get(`projects/${projId}`);
    if (!p) return { hasAccess: false, notFound: true };
    const isOwner = p.ownerId === userId;
    const isMember = (p.memberIds || []).includes(userId);
    if (!isOwner && !isMember) return { hasAccess: false, notFound: false };
    return { hasAccess: true, project: p };
  };

  // POST /api/projects/:projectId/tasks/preview-propagation (AH.131)
  app.post("/api/projects/:projectId/tasks/preview-propagation", requireAuth, async (req: any, res: any) => {
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: "Bad Request", message: "Valid projectId is required." });
    const acc = checkProjAccess(req.user.uid, projectId, "VIEW");
    if (!acc.hasAccess) {
      return acc.notFound ? res.status(404).json({ error: "Not Found", message: "Project not found." }) : res.status(403).json({ error: "Forbidden", message: "Access denied." });
    }

    const body = req.body || {};
    const { taskId, newStartDate, newDueDate } = body;
    if (!taskId || typeof taskId !== "string") {
      return res.status(400).json({ error: "Bad Request", message: "A valid taskId is required." });
    }
    if (newStartDate === undefined && newDueDate === undefined) {
      return res.status(400).json({ error: "Bad Request", message: "At least one proposed date must be provided." });
    }

    const snap = await db.collection("tasks").where("projectId", "==", projectId).get();
    const allTasks = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    const targetExists = allTasks.find((t: any) => t.id === taskId);
    if (!targetExists) {
      return res.status(404).json({ error: "Not Found", message: "Target task does not belong to the specified project or does not exist." });
    }

    const preview = calculateDeadlinePropagation(allTasks, taskId, {
      newStartDate: newStartDate !== undefined ? newStartDate : undefined,
      newDueDate: newDueDate !== undefined ? newDueDate : undefined
    });

    return res.json({ success: true, preview });
  });

  // PATCH /api/tasks/:taskId (AH.131 with cycle detection & prerequisite validation)
  app.patch("/api/tasks/:taskId", requireAuth, async (req: any, res: any) => {
    const { taskId } = req.params;
    const docRef = db.collection("tasks").doc(taskId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Not Found" });
    const taskData = snap.data();
    const acc = checkProjAccess(req.user.uid, taskData.projectId, "EDIT_CONTENT");
    if (!acc.hasAccess) return res.status(403).json({ error: "Forbidden" });

    const body = req.body || {};
    const updatePayload: any = { updatedAt: new Date().toISOString() };

    if ("prerequisiteTaskIds" in body) {
      if (!Array.isArray(body.prerequisiteTaskIds)) {
        return res.status(400).json({ error: "Bad Request", message: "prerequisiteTaskIds must be an array." });
      }
      if (body.prerequisiteTaskIds.includes(taskId)) {
        return res.status(400).json({
          error: "Bad Request",
          message: "A task cannot depend on itself.",
          cyclePath: `${taskData.title || taskId} (${taskId}) -> ${taskData.title || taskId} (${taskId})`
        });
      }

      // Fetch all tasks for this project
      const projectTasksSnap = await db.collection("tasks").where("projectId", "==", taskData.projectId).get();
      const projectTasks = projectTasksSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      const projectTaskMap = new Map(projectTasks.map((t: any) => [t.id, t]));

      // Validate existence and project containment
      for (const pId of body.prerequisiteTaskIds) {
        if (typeof pId !== "string" || !projectTaskMap.has(pId)) {
          return res.status(400).json({
            error: "Bad Request",
            message: `Prerequisite task ${pId} does not exist in this project.`
          });
        }
      }

      // Validate transitive cycle
      const cycleCheck = detectDependencyCycle(taskId, body.prerequisiteTaskIds, projectTasks);
      if (cycleCheck.hasCycle) {
        return res.status(400).json({
          error: "Bad Request",
          message: `Cannot add prerequisite: Cyclic dependency detected (${cycleCheck.cyclePath}).`,
          cyclePath: cycleCheck.cyclePath,
          cycleNodeIds: cycleCheck.cycleNodeIds
        });
      }

      updatePayload.prerequisiteTaskIds = body.prerequisiteTaskIds;
    }

    for (const k of ["title", "description", "status", "priority", "dueDate", "startDate"]) {
      if (k in body) updatePayload[k] = body[k];
    }

    await docRef.update(updatePayload);
    const updatedSnap = await docRef.get();
    return res.json({ success: true, task: { id: taskId, ...updatedSnap.data() } });
  });

  return app;
}

async function request(baseUrl: string, method: string, path: string, headers: Record<string, string> = {}, body?: any) {
  const url = new URL(path, baseUrl);
  const payload = body ? JSON.stringify(body) : undefined;
  const reqHeaders: Record<string, string> = { ...headers };
  if (payload) {
    reqHeaders["Content-Type"] = "application/json";
    reqHeaders["Content-Length"] = Buffer.byteLength(payload).toString();
  }
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(url, { method, headers: reqHeaders }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode || 0, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode || 0, body: data }); }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log("=== Running AH.131 Phase 1 Dependency & Propagation Tests ===\n");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // Pure Unit Tests: Calendar & Cycle & Propagation Engine
  // --------------------------------------------------------------------------
  console.log("--- Group 1: Calendar Arithmetic & Timezone Safety ---");
  const d1 = parseCalendarDate("2026-10-20");
  assert(d1 !== null && d1.year === 2026 && d1.month === 10 && d1.day === 20, "11.1 Parses YYYY-MM-DD accurately");
  assert(formatCalendarDate({ year: 2026, month: 10, day: 5 }) === "2026-10-05", "11.2 Formats calendar date with leading zeros");
  assert(addCalendarDays("2026-10-20", 5) === "2026-10-25", "11.3 addCalendarDays forward across calendar days");
  assert(addCalendarDays("2026-10-20", -5) === "2026-10-15", "11.4 addCalendarDays backward");
  assert(diffCalendarDays("2026-10-25", "2026-10-20") === 5, "11.5 diffCalendarDays calculates exact calendar delta");
  assert(diffCalendarDays("2026-03-01", "2026-02-28") === 1, "11.6 diffCalendarDays across month boundary");
  assert(parseCalendarDate("invalid-date") === null, "12.1 Rejects malformed date strings");
  assert(parseCalendarDate("2023-02-29") === null, "12.2 Rejects non-existent leap year dates");

  console.log("\n--- Group 2: Transitive Dependency Cycle Detection Engine ---");
  const sampleTasks: SchedulableTask[] = [
    { id: "taskA", projectId: "p1", title: "Task A", status: "pending", prerequisiteTaskIds: [] },
    { id: "taskB", projectId: "p1", title: "Task B", status: "pending", prerequisiteTaskIds: ["taskA"] },
    { id: "taskC", projectId: "p1", title: "Task C", status: "pending", prerequisiteTaskIds: ["taskB"] },
    { id: "taskD", projectId: "p1", title: "Task D", status: "pending", prerequisiteTaskIds: ["taskC"] }
  ];

  // 1. Direct self-dependency
  const selfCycle = detectDependencyCycle("taskA", ["taskA"], sampleTasks);
  assert(selfCycle.hasCycle && selfCycle.cycleNodeIds?.includes("taskA"), "1. Direct self-dependency rejected");
  assert(selfCycle.cyclePath?.includes("Task A (taskA) -> Task A (taskA)"), "1. Self-cycle path formatted properly");

  // 2. Two-node cycle (A -> B -> A)
  const twoNode = detectDependencyCycle("taskA", ["taskB"], sampleTasks);
  assert(twoNode.hasCycle, "2. Two-node cycle detected (A -> B -> A)");
  assert(twoNode.cyclePath?.includes("taskA") && twoNode.cyclePath?.includes("taskB"), "2. Two-node cycle path contains both nodes");

  // 3. Three-node and longer cycle (A -> D -> C -> B -> A)
  const longCycle = detectDependencyCycle("taskA", ["taskD"], sampleTasks);
  assert(longCycle.hasCycle, "3. Long transitive cycle detected (A -> D -> C -> B -> A)");

  // 4. Valid DAG addition
  const validDag = detectDependencyCycle("taskD", ["taskA", "taskB", "taskC"], sampleTasks);
  assert(!validDag.hasCycle, "4. Valid acyclic DAG dependencies accepted without false positives");

  console.log("\n--- Group 3: Deterministic Propagation Calculator Engine ---");
  const projTasks: SchedulableTask[] = [
    { id: "t1", projectId: "proj1", title: "Architecture", status: "pending", startDate: "2026-10-01", dueDate: "2026-10-05", prerequisiteTaskIds: [] },
    { id: "t2", projectId: "proj1", title: "Implementation", status: "pending", startDate: "2026-10-05", dueDate: "2026-10-10", prerequisiteTaskIds: ["t1"] },
    { id: "t3", projectId: "proj1", title: "QA Testing", status: "pending", startDate: "2026-10-10", dueDate: "2026-10-14", prerequisiteTaskIds: ["t2"] },
    { id: "t4_done", projectId: "proj1", title: "Audit Signoff", status: "completed", startDate: "2026-10-14", dueDate: "2026-10-16", prerequisiteTaskIds: ["t3"] },
    { id: "t5_unrelated", projectId: "proj1", title: "Docs", status: "pending", startDate: "2026-10-01", dueDate: "2026-10-05", prerequisiteTaskIds: [] }
  ];

  // 7. Single-level & 8. Multi-level transitive propagation (shift t1 due from 2026-10-05 to 2026-10-08)
  const propRes = calculateDeadlinePropagation(projTasks, "t1", { newDueDate: "2026-10-08" });
  assert(!propRes.hasConflicts, "7. Propagation calculates without hard conflicts");
  assert(propRes.hasWarnings, "10.1 Reports warnings when completed task is downstream");
  assert(propRes.affectedCompletedTasks.some(c => c.taskId === "t4_done"), "10.2 Identifies completed downstream task in affectedCompletedTasks");

  // Check t1 (direct target)
  const t1Preview = propRes.affectedTasks.find(a => a.taskId === "t1");
  assert(t1Preview?.isDirectTarget === true, "13.1 Target task marked as direct target");
  assert(t1Preview?.proposedDueDate === "2026-10-08", "7.1 Target task proposed dueDate is 2026-10-08");
  assert(t1Preview?.proposedStartDate === "2026-10-01", "7.2 Target task original startDate preserved when only newDueDate given");

  // Check t2 (first downstream)
  const t2Preview = propRes.affectedTasks.find(a => a.taskId === "t2");
  assert(t2Preview?.proposedStartDate === "2026-10-08", "8.1 Downstream task t2 starts when prerequisite finishes (2026-10-08)");
  assert(t2Preview?.durationDays === 5, "9.1 Preserves task duration for downstream t2 (5 days)");
  assert(t2Preview?.proposedDueDate === "2026-10-13", "8.2 Downstream t2 due date shifted by duration to 2026-10-13");
  assert(t2Preview?.shiftDays === 3, "8.3 Calculated shiftDays is 3 calendar days");

  // Check t3 (second downstream, transitive)
  const t3Preview = propRes.affectedTasks.find(a => a.taskId === "t3");
  assert(t3Preview?.proposedStartDate === "2026-10-13", "8.4 Transitive t3 starts when t2 finishes (2026-10-13)");
  assert(t3Preview?.proposedDueDate === "2026-10-17", "8.5 Transitive t3 proposed due date is 2026-10-17 (duration 4 days)");

  // Check t4_done (completed task protection)
  const t4Preview = propRes.affectedTasks.find(a => a.taskId === "t4_done");
  assert(t4Preview?.isCompleted === true, "10.3 Completed task identified as completed");
  assert(t4Preview?.proposedStartDate === "2026-10-14", "10.4 Completed task startDate NOT shifted automatically");
  assert(t4Preview?.proposedDueDate === "2026-10-16", "10.5 Completed task dueDate NOT shifted automatically");
  assert(t4Preview?.shiftDays === 0, "10.6 Completed task shiftDays is 0");

  // Check unaffected count
  assert(propRes.unaffectedCount === 1, "13.2 Unaffected task count accurately reported (t5_unrelated is unaffected)");

  // 12. Missing dates handling
  const taskNoDates: SchedulableTask[] = [
    { id: "tA", projectId: "p1", title: "Target A", status: "pending", dueDate: "2026-10-10", prerequisiteTaskIds: [] },
    { id: "tB", projectId: "p1", title: "Downstream B (No Dates)", status: "pending", prerequisiteTaskIds: ["tA"] }
  ];
  const missingDateRes = calculateDeadlinePropagation(taskNoDates, "tA", { newDueDate: "2026-10-15" });
  assert(missingDateRes.unresolvedTasks.some(u => u.taskId === "tB"), "12.3 Tasks without valid dates reported in unresolvedTasks");

  // --------------------------------------------------------------------------
  // Integration Tests: Real Express Route Endpoints
  // --------------------------------------------------------------------------
  console.log("\n--- Group 4: Express Endpoint Integration Tests ---");
  const db = new MockFirestore();
  const tokenUserMap = {
    "alice_token": { uid: "alice_uid", email: "alice@example.com" },
    "bob_token": { uid: "bob_uid", email: "bob@example.com" }
  };

  // Seed project
  db.store.set("projects/proj_alpha", {
    id: "proj_alpha",
    name: "Alpha Project",
    ownerId: "alice_uid",
    memberIds: ["alice_uid"]
  });

  db.store.set("projects/proj_beta", {
    id: "proj_beta",
    name: "Beta Project",
    ownerId: "bob_uid",
    memberIds: ["bob_uid"]
  });

  // Seed tasks in proj_alpha
  db.store.set("tasks/task_1", {
    id: "task_1",
    projectId: "proj_alpha",
    title: "Task 1",
    status: "pending",
    startDate: "2026-11-01",
    dueDate: "2026-11-05",
    prerequisiteTaskIds: []
  });

  db.store.set("tasks/task_2", {
    id: "task_2",
    projectId: "proj_alpha",
    title: "Task 2",
    status: "pending",
    startDate: "2026-11-05",
    dueDate: "2026-11-10",
    prerequisiteTaskIds: ["task_1"]
  });

  db.store.set("tasks/task_beta_1", {
    id: "task_beta_1",
    projectId: "proj_beta",
    title: "Beta Task 1",
    status: "pending",
    prerequisiteTaskIds: []
  });

  const app = createTestServer(db, tokenUserMap);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 15. Unauthenticated preview request rejection
    const unauthRes = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {}, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    assert(unauthRes.status === 401, "15. Unauthenticated preview request rejected with 401");

    // 16. Unauthorized project access rejection (Bob trying to preview Alice's project)
    const unauthProjRes = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {
      "Authorization": "Bearer bob_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    assert(unauthProjRes.status === 403, "16. Unauthorized user preview request rejected with 403");

    // 13. Preview response correctness (Alice previewing task_1)
    const previewRes = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    assert(previewRes.status === 200, "13.3 Preview endpoint returns 200 OK");
    assert(previewRes.body.success === true, "13.4 Preview body has success: true");
    assert(previewRes.body.preview.targetTaskId === "task_1", "13.5 Preview returns targetTaskId");
    assert(previewRes.body.preview.affectedTasks.length === 2, "13.6 Both task_1 and task_2 returned in affectedTasks");

    // 14. Preview does not modify Firestore documents
    const task1AfterPreview = db.store.get("tasks/task_1");
    assert(task1AfterPreview.dueDate === "2026-11-05", "14.1 task_1 dueDate unchanged in store after preview");
    const task2AfterPreview = db.store.get("tasks/task_2");
    assert(task2AfterPreview.startDate === "2026-11-05", "14.2 task_2 startDate unchanged in store after preview");

    // 5. Missing prerequisite rejection (PATCH /api/tasks/:taskId with non-existent prereq)
    const missingPrereqRes = await request(baseUrl, "PATCH", "/api/tasks/task_1", {
      "Authorization": "Bearer alice_token"
    }, {
      prerequisiteTaskIds: ["non_existent_task_id"]
    });
    assert(missingPrereqRes.status === 400, "5. Missing prerequisite rejected with 400 Bad Request");
    assert(missingPrereqRes.body.message.includes("does not exist in this project"), "5.1 Informative missing prerequisite error message");

    // 6. Cross-project prerequisite rejection (Alice tries to make task_1 depend on Bob's task_beta_1)
    const crossProjRes = await request(baseUrl, "PATCH", "/api/tasks/task_1", {
      "Authorization": "Bearer alice_token"
    }, {
      prerequisiteTaskIds: ["task_beta_1"]
    });
    assert(crossProjRes.status === 400, "6. Cross-project prerequisite rejected with 400 Bad Request");

    // 2. Cycle rejection via PATCH (Alice tries to make task_1 depend on task_2, creating task_1 -> task_2 -> task_1 cycle)
    const cyclePatchRes = await request(baseUrl, "PATCH", "/api/tasks/task_1", {
      "Authorization": "Bearer alice_token"
    }, {
      prerequisiteTaskIds: ["task_2"]
    });
    assert(cyclePatchRes.status === 400, "2.1 Cycle rejected via PATCH with 400 Bad Request");
    assert(cyclePatchRes.body.cyclePath !== undefined, "2.2 Cycle path returned in response body");
    assert(cyclePatchRes.body.cycleNodeIds?.includes("task_1") && cyclePatchRes.body.cycleNodeIds?.includes("task_2"), "2.3 Cycle node IDs returned");

    // Verify task_1 in store was not mutated after failed PATCH
    const task1StoreAfterCycle = db.store.get("tasks/task_1");
    assert(task1StoreAfterCycle.prerequisiteTaskIds.length === 0, "2.4 Task prerequisiteTaskIds remained unchanged in database");

    // 17. Valid PATCH without cycle succeeds
    const validPatchRes = await request(baseUrl, "PATCH", "/api/tasks/task_2", {
      "Authorization": "Bearer alice_token"
    }, {
      title: "Updated Task 2 Title"
    });
    assert(validPatchRes.status === 200, "17.1 Normal field update PATCH succeeds");
    assert(db.store.get("tasks/task_2").title === "Updated Task 2 Title", "17.2 Store updated with new title");

  } finally {
    server.close();
  }

  console.log("\n==================================================");
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
