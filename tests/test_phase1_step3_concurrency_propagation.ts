/**
 * Test Suite: AH.135 Concurrency-Safe Deadline Propagation
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import {
  calculateDeadlinePropagation,
  computeScheduleVersionToken,
  detectDependencyCycle,
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
  constructor(private db: ConcurrencyMockFirestore, private collectionName: string) {}
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
    private db: ConcurrencyMockFirestore,
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

class ConcurrencyMockTransaction {
  public writes: Array<{ docRef: any; data: any }> = [];
  public readSnapshots: Map<string, number> = new Map();

  constructor(private db: ConcurrencyMockFirestore, public txId: string) {}

  async get(target: any) {
    if (typeof target.get === "function") {
      const snap = await target.get();
      for (const doc of snap.docs) {
        this.readSnapshots.set(doc.id, this.db.versionMap.get(doc.id) || 1);
      }
      return snap;
    }
    throw new Error("Unsupported query target in ConcurrencyMockTransaction.get");
  }

  update(docRef: any, data: any) {
    this.writes.push({ docRef, data });
    return this;
  }

  set(docRef: any, data: any) {
    this.writes.push({ docRef, data });
    return this;
  }

  delete(docRef: any) {
    this.writes.push({ docRef, data: null });
    return this;
  }
}

class ConcurrencyMockFirestore {
  public store = new Map<string, any>();
  public versionMap = new Map<string, number>();
  public onTransactionReadHook?: (tx: ConcurrencyMockTransaction) => Promise<void>;
  public activeTransactions: number = 0;
  public retryAttemptsCount: number = 0;

  collection(name: string) { return new MockCollectionReference(this, name); }

  async runTransaction<T>(
    updateFunction: (transaction: ConcurrencyMockTransaction) => Promise<T>,
    options?: { maxAttempts?: number }
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts || 5;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      const tx = new ConcurrencyMockTransaction(this, `tx_${Date.now()}_${attempt}`);
      this.activeTransactions++;

      try {
        const result = await updateFunction(tx);

        if (this.onTransactionReadHook) {
          const hook = this.onTransactionReadHook;
          this.onTransactionReadHook = undefined;
          await hook(tx);
        }

        let conflictDetected = false;
        for (const [docId, readVer] of tx.readSnapshots.entries()) {
          const currentVer = this.versionMap.get(docId) || 1;
          if (currentVer !== readVer) {
            conflictDetected = true;
            break;
          }
        }

        if (conflictDetected) {
          this.retryAttemptsCount++;
          const retryErr: any = new Error("ABORTED: Transaction was aborted due to concurrent modification.");
          retryErr.code = 10;
          throw retryErr;
        }

        for (const w of tx.writes) {
          const key = `tasks/${w.docRef.id}`;
          if (w.data === null) {
            this.store.delete(key);
          } else {
            const ex = this.store.get(key) || {};
            this.store.set(key, { ...ex, ...w.data });
            this.versionMap.set(w.docRef.id, (this.versionMap.get(w.docRef.id) || 1) + 1);
          }
        }

        return result;
      } catch (err: any) {
        if (err.code === 10 && attempt < maxAttempts) {
          continue;
        }
        throw err;
      } finally {
        this.activeTransactions--;
      }
    }

    throw new Error(`Transaction failed after ${maxAttempts} attempts.`);
  }
}

function createConcurrencyServer(db: ConcurrencyMockFirestore, tokenUserMap: Record<string, any>) {
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

  const checkProjAccess = (userId: string, projId: string) => {
    const p = db.store.get(`projects/${projId}`);
    if (!p) return { hasAccess: false, notFound: true };
    const isOwner = p.ownerId === userId;
    const isMember = (p.memberIds || []).includes(userId);
    if (!isOwner && !isMember) return { hasAccess: false, notFound: false };
    return { hasAccess: true, project: p };
  };

  app.post("/api/projects/:projectId/tasks/preview-propagation", requireAuth, async (req: any, res: any) => {
    const { projectId } = req.params;
    const acc = checkProjAccess(req.user.uid, projectId);
    if (!acc.hasAccess) return acc.notFound ? res.status(404).json({ error: "Not Found" }) : res.status(403).json({ error: "Forbidden" });

    const { taskId, newStartDate, newDueDate } = req.body || {};
    const snap = await db.collection("tasks").where("projectId", "==", projectId).get();
    const allTasks = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    const preview = calculateDeadlinePropagation(allTasks, taskId, { newStartDate, newDueDate });
    return res.json({ success: true, preview });
  });

  app.post("/api/projects/:projectId/tasks/execute-propagation", requireAuth, async (req: any, res: any) => {
    try {
      const { projectId } = req.params;
      if (!projectId) return res.status(400).json({ error: "Bad Request", message: "Valid projectId is required." });

      const acc = checkProjAccess(req.user.uid, projectId);
      if (!acc.hasAccess) {
        return acc.notFound ? res.status(404).json({ error: "Not Found" }) : res.status(403).json({ error: "Forbidden", message: "Permission denied." });
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

      const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(db.collection("tasks").where("projectId", "==", projectId));
        const allTasks = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })) as any[];

        const targetTask = allTasks.find((t: any) => t.id === taskId);
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
          const completedDownstream = propagation.affectedCompletedTasks.filter((c: any) => c.taskId !== taskId);
          if (completedDownstream.length > 0) {
            const names = completedDownstream.map((c: any) => `${c.title} (${c.taskId})`).join(", ");
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

        const tasksToUpdate = propagation.affectedTasks.filter((a: any) => {
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
        const performerName = req.user.email ? req.user.email.split("@")[0] : "User";

        for (const item of tasksToUpdate) {
          const docRef = db.collection("tasks").doc(item.taskId);
          const updateData: Record<string, any> = { updatedAt: now };

          if (item.proposedStartDate !== undefined) updateData.startDate = item.proposedStartDate || "";
          if (item.proposedDueDate !== undefined) updateData.dueDate = item.proposedDueDate || "";

          const originalTask = allTasks.find((t: any) => t.id === item.taskId);
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
          updatedTasks: tasksToUpdate.map((u: any) => ({
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

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`[PASS] ${msg}`);
}

async function runConcurrencyTests() {
  console.log("=== Running AH.135 Concurrency-Safe Deadline Propagation Tests ===\n");

  const db = new ConcurrencyMockFirestore();
  const tokenUserMap: Record<string, any> = {
    "alice_token": { uid: "user_alice", email: "alice@example.com", displayName: "Alice Analyst" },
    "bob_token": { uid: "user_bob", email: "bob@example.com", displayName: "Bob Builder" }
  };

  db.store.set("projects/proj_alpha", {
    id: "proj_alpha",
    name: "Project Alpha",
    ownerId: "user_alice",
    memberIds: ["user_alice"]
  });

  const seedInitialTasks = () => {
    db.store.set("tasks/task_1", {
      id: "task_1",
      projectId: "proj_alpha",
      title: "Architecture & Design",
      status: "pending",
      startDate: "2026-11-01",
      dueDate: "2026-11-05",
      prerequisiteTaskIds: [],
      updatedAt: "2026-10-20T00:00:00.000Z",
      activityHistory: []
    });
    db.versionMap.set("task_1", 1);

    db.store.set("tasks/task_2", {
      id: "task_2",
      projectId: "proj_alpha",
      title: "Core Implementation",
      status: "pending",
      startDate: "2026-11-05",
      dueDate: "2026-11-10",
      prerequisiteTaskIds: ["task_1"],
      updatedAt: "2026-10-20T00:00:00.000Z",
      activityHistory: []
    });
    db.versionMap.set("task_2", 1);

    db.store.set("tasks/task_3", {
      id: "task_3",
      projectId: "proj_alpha",
      title: "Quality Assurance",
      status: "pending",
      startDate: "2026-11-10",
      dueDate: "2026-11-14",
      prerequisiteTaskIds: ["task_2"],
      updatedAt: "2026-10-20T00:00:00.000Z",
      activityHistory: []
    });
    db.versionMap.set("task_3", 1);
  };

  seedInitialTasks();

  const app = createConcurrencyServer(db, tokenUserMap);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://localhost:${port}`;

  try {
    console.log("--- Test 1: Current Preview Token Propagation ---");
    const previewRes1 = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    assert(previewRes1.status === 200, "1.1 Preview returns 200 OK");
    const token1 = previewRes1.body.preview.scheduleVersionToken;
    assert(typeof token1 === "string" && token1.startsWith("v1_"), "1.2 Preview token generated");

    const execRes1 = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken: token1
    });
    assert(execRes1.status === 200, "1.3 Execution succeeds with current token");
    assert(db.store.get("tasks/task_1").dueDate === "2026-11-08", "1.4 Task 1 dueDate committed");
    assert(db.store.get("tasks/task_2").startDate === "2026-11-08", "1.5 Downstream Task 2 shifted");

    console.log("\n--- Test 2: Stale Preview Rejection ---");
    const previewRes2 = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-10"
    });
    const staleToken = previewRes2.body.preview.scheduleVersionToken;

    const t2 = db.store.get("tasks/task_2");
    db.store.set("tasks/task_2", {
      ...t2,
      dueDate: "2026-11-15",
      updatedAt: "2026-10-20T01:00:00.000Z"
    });
    db.versionMap.set("task_2", (db.versionMap.get("task_2") || 1) + 1);

    const execStale = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-10",
      scheduleVersionToken: staleToken
    });
    assert(execStale.status === 409, "2.1 Stale preview rejected with 409 Conflict");
    assert(execStale.body.currentScheduleVersionToken !== undefined, "2.2 Returns fresh version token for refresh");

    console.log("\n--- Test 3: Concurrent Edit to Target Task ---");
    const previewRes3 = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12"
    });
    const token3 = previewRes3.body.preview.scheduleVersionToken;

    const t1 = db.store.get("tasks/task_1");
    db.store.set("tasks/task_1", {
      ...t1,
      dueDate: "2026-11-09",
      updatedAt: "2026-10-20T02:00:00.000Z"
    });
    db.versionMap.set("task_1", (db.versionMap.get("task_1") || 1) + 1);

    const execConcurrentTarget = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12",
      scheduleVersionToken: token3
    });
    assert(execConcurrentTarget.status === 409, "3.1 Concurrent edit to target task rejected with 409");
    assert(db.store.get("tasks/task_1").dueDate === "2026-11-09", "3.2 Other user edit preserved; stale data not overwritten");

    console.log("\n--- Test 4: Concurrent Edit to Downstream Task ---");
    const previewRes4 = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12"
    });
    const token4 = previewRes4.body.preview.scheduleVersionToken;

    const t3 = db.store.get("tasks/task_3");
    db.store.set("tasks/task_3", {
      ...t3,
      dueDate: "2026-11-20",
      updatedAt: "2026-10-20T03:00:00.000Z"
    });
    db.versionMap.set("task_3", (db.versionMap.get("task_3") || 1) + 1);

    const execConcurrentDownstream = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12",
      scheduleVersionToken: token4
    });
    assert(execConcurrentDownstream.status === 409, "4.1 Concurrent edit to downstream task rejected with 409");
    assert(db.store.get("tasks/task_3").dueDate === "2026-11-20", "4.2 Downstream edit preserved");

    console.log("\n--- Test 5: Concurrent Dependency Relationship Change ---");
    const previewRes5 = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12"
    });
    const token5 = previewRes5.body.preview.scheduleVersionToken;

    const t3Pre = db.store.get("tasks/task_3");
    db.store.set("tasks/task_3", {
      ...t3Pre,
      prerequisiteTaskIds: [],
      updatedAt: "2026-10-20T04:00:00.000Z"
    });
    db.versionMap.set("task_3", (db.versionMap.get("task_3") || 1) + 1);

    const execConcurrentRel = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-12",
      scheduleVersionToken: token5
    });
    assert(execConcurrentRel.status === 409, "5.1 Prerequisite relationship alteration triggers 409 Conflict");

    console.log("\n--- Test 6: Overlapping Executions with Same Preview Token ---");
    seedInitialTasks();
    const previewRes6 = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    const sharedToken = previewRes6.body.preview.scheduleVersionToken;

    const [resA, resB] = await Promise.all([
      request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
        "Authorization": "Bearer alice_token"
      }, {
        taskId: "task_1",
        newDueDate: "2026-11-08",
        scheduleVersionToken: sharedToken
      }),
      request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
        "Authorization": "Bearer alice_token"
      }, {
        taskId: "task_1",
        newDueDate: "2026-11-08",
        scheduleVersionToken: sharedToken
      })
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert(statuses[0] === 200 && statuses[1] === 409, "6.1 Exactly one execution succeeds (200) and the other fails safely (409 Conflict)");

    console.log("\n--- Test 7: Transaction Retry Simulation (No Duplicate Side Effects) ---");
    seedInitialTasks();
    const previewRes7 = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/preview-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    const token7 = previewRes7.body.preview.scheduleVersionToken;

    let barrierHit = false;
    db.onTransactionReadHook = async () => {
      if (!barrierHit) {
        barrierHit = true;
        db.versionMap.set("task_1", 999);
      }
    };

    const retryExecRes = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken: token7
    });

    assert(db.retryAttemptsCount >= 1, "7.1 Transaction retried after conflict abort");
    const task1After = db.store.get("tasks/task_1");
    const actions = (task1After.activityHistory || []).map((a: any) => a.action);
    const scheduleUpdatedCount = actions.filter((a: string) => a === "schedule_updated").length;
    assert(scheduleUpdatedCount <= 1, "7.2 Activity history has no duplicate entries from retried callback");

    console.log("\n--- Test 8: Missing or Invalid Execution Token ---");
    const missingTokenRes = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08"
    });
    assert(missingTokenRes.status === 400, "8.1 Missing token returns 400 Bad Request");
    assert(missingTokenRes.body.code === "MISSING_SCHEDULE_VERSION_TOKEN", "8.2 Identifies MISSING_SCHEDULE_VERSION_TOKEN");

    const emptyTokenRes = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "task_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken: "   "
    });
    assert(emptyTokenRes.status === 400, "8.3 Whitespace-only token returns 400 Bad Request");

    console.log("\n--- Test 9: Transaction Write Limit Safety ---");
    for (let i = 0; i <= 501; i++) {
      const id = `mass_task_${i}`;
      const prereq = i > 0 ? [`mass_task_${i - 1}`] : [];
      const t = {
        id,
        projectId: "proj_alpha",
        title: `Mass Task ${i}`,
        status: "pending",
        startDate: "2026-11-01",
        dueDate: "2026-11-02",
        prerequisiteTaskIds: prereq,
        updatedAt: "2026-10-20T00:00:00.000Z"
      };
      db.store.set(`tasks/${id}`, t);
      db.versionMap.set(id, 1);
    }
    const massToken = computeScheduleVersionToken(Array.from(db.store.values()).filter(t => t.projectId === "proj_alpha"));
    const massRes = await request(baseUrl, "POST", "/api/projects/proj_alpha/tasks/execute-propagation", {
      "Authorization": "Bearer alice_token"
    }, {
      taskId: "mass_task_0",
      newDueDate: "2026-11-05",
      scheduleVersionToken: massToken
    });
    assert(massRes.status === 413, "9.1 Oversized transaction (>500 writes) rejected with 413 Payload Too Large");

  } finally {
    server.close();
  }

  console.log("\n==================================================");
  console.log("RESULTS: ALL CONCURRENCY TESTS PASSED");
  console.log("==================================================");
}

runConcurrencyTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
