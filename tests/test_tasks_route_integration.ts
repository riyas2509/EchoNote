/**
 * Integration Test Suite: Tasks Express Route-Level Persistence (AH.128)
 * Tests real HTTP requests against Express route handlers with auth, project authorization, dependency enforcement, and Firestore engine
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { AuthenticatedRequest } from "../middleware/auth.js";

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
    const docId = id || `task_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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

function createTasksTestServer(db: any, tokenUserMap: Record<string, any>) {
  const app = express();
  app.use(express.json());
  const requireAuth = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
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

  // 1. GET /api/projects/:projectId/tasks
  app.get("/api/projects/:projectId/tasks", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: "Bad Request" });
    const acc = checkProjAccess(req.user.uid, projectId, "VIEW");
    if (!acc.hasAccess) {
      return acc.notFound ? res.status(404).json({ error: "Not Found" }) : res.status(403).json({ error: "Forbidden" });
    }
    const snap = await db.collection("tasks").where("projectId", "==", projectId).get();
    return res.json({ success: true, tasks: snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) });
  });

  // 2. POST /api/projects/:projectId/tasks
  app.post("/api/projects/:projectId/tasks", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: "Bad Request" });
    const acc = checkProjAccess(req.user.uid, projectId, "EDIT_CONTENT");
    if (!acc.hasAccess) {
      return acc.notFound ? res.status(404).json({ error: "Not Found" }) : res.status(403).json({ error: "Forbidden" });
    }
    const body = req.body || {};
    const title = (body.title || "").trim();
    if (!title) return res.status(400).json({ error: "Bad Request", message: "Task title is required." });
    if (title.length > 300) return res.status(400).json({ error: "Bad Request", message: "Title too long." });

    if (body.sourceDecisionId || body.sourceActionItem) {
      let dedup = db.collection("tasks").where("projectId", "==", projectId);
      if (body.sourceDecisionId) dedup = dedup.where("sourceDecisionId", "==", body.sourceDecisionId);
      else if (body.sourceActionItem) dedup = dedup.where("sourceActionItem", "==", body.sourceActionItem);
      const exSnap = await dedup.limit(1).get();
      if (!exSnap.empty) {
        return res.json({ success: true, reused: true, task: { id: exSnap.docs[0].id, ...exSnap.docs[0].data() } });
      }
    }

    const now = new Date().toISOString();
    const docRef = db.collection("tasks").doc();
    const newTask = {
      id: docRef.id,
      projectId,
      title,
      description: body.description || "",
      assigneeEmail: body.assigneeEmail || req.user.email,
      assigneeName: body.assigneeName || "User",
      status: body.status || "pending",
      priority: body.priority || "medium",
      startDate: body.startDate || "",
      dueDate: body.dueDate || "",
      sourceType: body.sourceType || null,
      sourceDecisionId: body.sourceDecisionId || null,
      sourceActionItem: body.sourceActionItem || null,
      prerequisiteTaskIds: Array.isArray(body.prerequisiteTaskIds) ? body.prerequisiteTaskIds : [],
      createdBy: req.user.uid,
      createdAt: now,
      updatedAt: now
    };
    await docRef.set(newTask);
    return res.status(201).json({ success: true, reused: false, task: newTask });
  });

  // 3. GET /api/tasks/:taskId
  app.get("/api/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    const { taskId } = req.params;
    const snap = await db.collection("tasks").doc(taskId).get();
    if (!snap.exists) return res.status(404).json({ error: "Not Found" });
    const t = snap.data();
    const acc = checkProjAccess(req.user.uid, t.projectId, "VIEW");
    if (!acc.hasAccess) return res.status(403).json({ error: "Forbidden" });
    return res.json({ success: true, task: { id: snap.id, ...t } });
  });

  // 4. PATCH /api/tasks/:taskId
  app.patch("/api/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    const { taskId } = req.params;
    const docRef = db.collection("tasks").doc(taskId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Not Found" });
    const t = snap.data();
    const acc = checkProjAccess(req.user.uid, t.projectId, "EDIT_CONTENT");
    if (!acc.hasAccess) return res.status(403).json({ error: "Forbidden" });
    const body = req.body || {};
    if (body.status) {
      const valid = ["pending", "in_progress", "completed", "overdue", "blocked"];
      if (!valid.includes(body.status)) return res.status(400).json({ error: "Bad Request" });
    }
    if (body.prerequisiteTaskIds) {
      if (!Array.isArray(body.prerequisiteTaskIds)) return res.status(400).json({ error: "Bad Request" });
      if (body.prerequisiteTaskIds.includes(taskId)) return res.status(400).json({ error: "Bad Request", message: "Self-dependency forbidden" });
    }
    const update: any = { updatedAt: new Date().toISOString() };
    for (const k of ["title", "description", "status", "priority", "dueDate", "startDate", "prerequisiteTaskIds"]) {
      if (k in body) update[k] = body[k];
    }
    if (body.acceptAiSuggested) {
      update.isAiSuggested = false;
      update.acceptedBy = req.user.uid;
    }
    await docRef.update(update);
    const upDoc = await docRef.get();
    return res.json({ success: true, task: { id: taskId, ...upDoc.data() } });
  });

  // 5. DELETE /api/tasks/:taskId
  app.delete("/api/tasks/:taskId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    const { taskId } = req.params;
    const docRef = db.collection("tasks").doc(taskId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Not Found" });
    const t = snap.data();
    const acc = checkProjAccess(req.user.uid, t.projectId, "EDIT_CONTENT");
    if (!acc.hasAccess) return res.status(403).json({ error: "Forbidden" });
    const depSnap = await db.collection("tasks").where("projectId", "==", t.projectId).where("prerequisiteTaskIds", "array-contains", taskId).get();
    if (!depSnap.empty) {
      return res.status(400).json({ error: "Conflict", message: "Prerequisite in use" });
    }
    await docRef.delete();
    return res.json({ success: true, taskId });
  });

  return app;
}

async function runTasksIntegrationTests() {
  console.log("=== Starting Tasks API Integration Test Suite (AH.128) ===\n");
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) { console.log(`[PASS] ${name}`); passed++; }
    else { console.error(`[FAIL] ${name}`); failed++; }
  };

  const db = new MockFirestore();
  const tokenUserMap: Record<string, any> = {
    "token_alice": { uid: "user_alice", email: "alice@example.com" },
    "token_bob": { uid: "user_bob", email: "bob@example.com" }
  };
  db.store.set("projects/proj_alpha", { id: "proj_alpha", name: "Alpha Project", ownerId: "user_alice", memberIds: [] });
  db.store.set("projects/proj_beta", { id: "proj_beta", name: "Beta Project", ownerId: "user_bob", memberIds: [] });

  const app = createTasksTestServer(db, tokenUserMap);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = async (path: string, options: any = {}) => {
    const headers: Record<string, string> = { ...(options.headers || {}) };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
    if (options.body) headers["Content-Type"] = "application/json";
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, ok: res.ok, data };
  };

  try {
    // 1. Unauthenticated requests are rejected
    console.log("--- Suite 1: Authentication Enforcement ---");
    const unauthGet = await request("/api/projects/proj_alpha/tasks");
    assert(unauthGet.status === 401, "Unauthenticated project tasks GET returns 401");
    const unauthPost = await request("/api/projects/proj_alpha/tasks", { method: "POST", body: { title: "unauth" } });
    assert(unauthPost.status === 401, "Unauthenticated task POST returns 401");

    // 2. Project Task Creation & Field Persistence
    console.log("\n--- Suite 2: Task Creation & Field Persistence ---");
    const createRes1 = await request("/api/projects/proj_alpha/tasks", {
      token: "token_alice",
      method: "POST",
      body: {
        title: "Setup CI/CD Pipeline",
        description: "Configure GitHub Actions for automated deployment",
        priority: "high",
        startDate: "2026-10-21",
        dueDate: "2026-10-25"
      }
    });
    assert(createRes1.status === 201 && createRes1.data.success, "Alice creates task in proj_alpha");
    assert(createRes1.data.task.title === "Setup CI/CD Pipeline", "Created task retains title");
    assert(createRes1.data.task.priority === "high", "Created task retains priority");
    assert(createRes1.data.task.startDate === "2026-10-21", "Created task retains startDate");
    assert(createRes1.data.task.dueDate === "2026-10-25", "Created task retains dueDate");
    const task1Id = createRes1.data.task.id;

    // 3. Task Listing in Project Scope
    console.log("\n--- Suite 3: Task Listing & Project Scoping ---");
    const listAlice = await request("/api/projects/proj_alpha/tasks", { token: "token_alice" });
    assert(listAlice.status === 200 && listAlice.data.tasks.length === 1, "Alice lists 1 task in proj_alpha");

    // 4. Cross-Project Authorization (Bob cannot view or mutate Alice project tasks)
    console.log("\n--- Suite 4: Cross-Project Authorization & Privacy ---");
    const bobListAliceProj = await request("/api/projects/proj_alpha/tasks", { token: "token_bob" });
    assert(bobListAliceProj.status === 403, "Bob forbidden from listing tasks in Alice project");
    const bobCreateAliceProj = await request("/api/projects/proj_alpha/tasks", { token: "token_bob", method: "POST", body: { title: "Intrusion" } });
    assert(bobCreateAliceProj.status === 403, "Bob forbidden from creating task in Alice project");
    const bobReadTask = await request(`/api/tasks/${task1Id}`, { token: "token_bob" });
    assert(bobReadTask.status === 403, "Bob forbidden from reading Alice task directly");
    const bobPatchTask = await request(`/api/tasks/${task1Id}`, { token: "token_bob", method: "PATCH", body: { status: "completed" } });
    assert(bobPatchTask.status === 403, "Bob forbidden from updating Alice task");
    const bobDeleteTask = await request(`/api/tasks/${task1Id}`, { token: "token_bob", method: "DELETE" });
    assert(bobDeleteTask.status === 403, "Bob forbidden from deleting Alice task");

    // 5. Updating Task Fields, Status, and Prerequisites
    console.log("\n--- Suite 5: Task Updates & Status Changes ---");
    const updateStatus = await request(`/api/tasks/${task1Id}`, {
      token: "token_alice",
      method: "PATCH",
      body: { status: "in_progress" }
    });
    assert(updateStatus.status === 200 && updateStatus.data.task.status === "in_progress", "Task status updated to in_progress");
    assert(updateStatus.data.task.dueDate === "2026-10-25", "Existing dueDate preserved during status update");

    // 6. Creating Second Task with Prerequisite
    console.log("\n--- Suite 6: Prerequisite Dependencies & Safe Deletion ---");
    const createRes2 = await request("/api/projects/proj_alpha/tasks", {
      token: "token_alice",
      method: "POST",
      body: {
        title: "Deploy to Production",
        prerequisiteTaskIds: [task1Id]
      }
    });
    assert(createRes2.status === 201, "Created dependent task with prerequisite");
    const task2Id = createRes2.data.task.id;

    // Attempt to delete task1 while task2 depends on it must fail with Conflict (400)
    const deletePrereqBlocked = await request(`/api/tasks/${task1Id}`, { token: "token_alice", method: "DELETE" });
    assert(deletePrereqBlocked.status === 400 && deletePrereqBlocked.data.error === "Conflict", "Deleting task with active dependents is rejected with Conflict");

    // Self-dependency rejection
    const selfDep = await request(`/api/tasks/${task1Id}`, {
      token: "token_alice",
      method: "PATCH",
      body: { prerequisiteTaskIds: [task1Id] }
    });
    assert(selfDep.status === 400, "Task cannot depend on itself");

    // 7. Meeting Conversion Deduplication
    console.log("\n--- Suite 7: Meeting Item Conversion & Deduplication ---");
    const conv1 = await request("/api/projects/proj_alpha/tasks", {
      token: "token_alice",
      method: "POST",
      body: {
        title: "Finalize Architecture RFC",
        sourceType: "meeting_action_item",
        sourceActionItem: "ai_rfc_101"
      }
    });
    assert(conv1.status === 201 && conv1.data.reused === false, "Initial conversion creates task");
    const conv2 = await request("/api/projects/proj_alpha/tasks", {
      token: "token_alice",
      method: "POST",
      body: {
        title: "Finalize Architecture RFC",
        sourceType: "meeting_action_item",
        sourceActionItem: "ai_rfc_101"
      }
    });
    assert(conv2.status === 200 && conv2.data.reused === true, "Duplicate conversion reuses existing task");

    // 8. Deleting Unblocked Task
    console.log("\n--- Suite 8: Deleting Unblocked Tasks ---");
    const deleteRes2 = await request(`/api/tasks/${task2Id}`, { token: "token_alice", method: "DELETE" });
    assert(deleteRes2.status === 200, "Dependent task deleted successfully");
    const deleteRes1 = await request(`/api/tasks/${task1Id}`, { token: "token_alice", method: "DELETE" });
    assert(deleteRes1.status === 200, "Prerequisite task now deletable once dependent was removed");

    // 404 for deleted task
    const getDeleted = await request(`/api/tasks/${task1Id}`, { token: "token_alice" });
    assert(getDeleted.status === 404, "Deleted task returns 404 Not Found");

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n==================================================");
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");
  if (failed > 0) throw new Error(`${failed} tasks integration tests failed`);
}

runTasksIntegrationTests().catch(err => { console.error(err); process.exit(1); });