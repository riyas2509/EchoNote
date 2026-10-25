/**
 * Integration Test Suite: Search History Express Route-Level Persistence (AH.126)
 * Tests real HTTP requests against Express route handlers with auth, isolation, and Firestore engine
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { AuthenticatedRequest, resolveProjectAccess } from "../middleware/auth.js";

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

class MockBatch {
  private ops: Array<() => void> = [];
  delete(ref: any) {
    this.ops.push(() => ref.delete());
    return this;
  }
  async commit() {
    for (const op of this.ops) op();
    this.ops = [];
  }
}

class MockCollectionReference {
  constructor(private db: MockFirestore, private collectionName: string) {}
  doc(id?: string) {
    const collName = this.collectionName;
    const db = this.db;
    const docId = id || `sh_mock_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ref = {
      id: docId,
      get: async () => new MockDocSnapshot(docId, db.store.get(`${collName}/${docId}`)),
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
  private _orderBy?: { field: string; dir: "asc" | "desc" };
  constructor(
    private db: MockFirestore,
    private collectionName: string,
    private filters: Array<{ field: string; op: string; val: any }>
  ) {}
  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionName, [...this.filters, { field, op, val }]);
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc") {
    this._orderBy = { field, dir };
    return this;
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
      }
      if (matches) matched.push(new MockDocSnapshot(id, data, this.db.collection(this.collectionName)));
    }
    if (this._orderBy) {
      const { field, dir } = this._orderBy;
      matched.sort((a, b) => {
        const valA = new Date(a.data()[field] || 0).getTime();
        const valB = new Date(b.data()[field] || 0).getTime();
        return dir === "desc" ? valB - valA : valA - valB;
      });
    }
    if (typeof this._limit === "number") matched = matched.slice(0, this._limit);
    return new MockQuerySnapshot(matched);
  }
}

class MockFirestore {
  public store = new Map<string, any>();
  collection(name: string) { return new MockCollectionReference(this, name); }
  batch() { return new MockBatch(); }
}

function createTestServer(db: any, tokenUserMap: Record<string, any>) {
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

  // 1. GET /api/search-history
  app.get("/api/search-history", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const scope = (req.query.scope as string) || "global";
      if (scope !== "global" && scope !== "project") return res.status(400).json({ error: "Bad Request" });
      const rawLimit = parseInt(req.query.limit as string, 10);
      const limitVal = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 10;
      const projectId = (req.query.projectId as string) || null;
      if (scope === "project") {
        if (!projectId) return res.status(400).json({ error: "Bad Request" });
        const pData = db.store.get(`projects/${projectId}`);
        if (!pData) return res.status(404).json({ error: "Not Found" });
        if (pData.ownerId !== req.user.uid && !(pData.memberIds || []).includes(req.user.uid)) return res.status(403).json({ error: "Forbidden" });
      }
      let qRef = db.collection("searchHistory").where("userId", "==", req.user.uid).where("scope", "==", scope);
      if (scope === "project" && projectId) qRef = qRef.where("projectId", "==", projectId);
      qRef = qRef.orderBy("lastUsedAt", "desc").limit(limitVal);
      const snap = await qRef.get();
      return res.json({ success: true, entries: snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // 2. POST /api/search-history
  app.post("/api/search-history", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { query, scope = "global", projectId, filters } = req.body || {};
      if (!query || typeof query !== "string" || !query.trim()) return res.status(400).json({ error: "Bad Request" });
      const cleanQuery = query.trim();
      if (cleanQuery.length > 200) return res.status(400).json({ error: "Bad Request" });
      if (scope !== "global" && scope !== "project") return res.status(400).json({ error: "Bad Request" });
      let validProjectId: string | null = null;
      let validProjectName: string | null = null;
      if (scope === "project") {
        if (!projectId) return res.status(400).json({ error: "Bad Request" });
        const pData = db.store.get(`projects/${projectId}`);
        if (!pData) return res.status(404).json({ error: "Not Found" });
        if (pData.ownerId !== req.user.uid && !(pData.memberIds || []).includes(req.user.uid)) return res.status(403).json({ error: "Forbidden" });
        validProjectId = projectId;
        validProjectName = pData.name || null;
      }
      const now = new Date().toISOString();
      const signature = scope + ":" + (validProjectId || "") + ":" + cleanQuery.toLowerCase();
      const exSnap = await db.collection("searchHistory").where("userId", "==", req.user.uid).where("signature", "==", signature).limit(1).get();
      if (!exSnap.empty) {
        const docRef = exSnap.docs[0].ref;
        const up: any = { lastUsedAt: now };
        if (filters) up.filters = filters;
        await docRef.update(up);
        const uDoc = await docRef.get();
        return res.json({ success: true, entry: { id: docRef.id, ...uDoc.data() }, isDuplicate: true });
      }
      const userHist = await db.collection("searchHistory").where("userId", "==", req.user.uid).get();
      if (userHist.size >= 50) {
        const sorted = userHist.docs.sort((a: any, b: any) => new Date(a.data().lastUsedAt).getTime() - new Date(b.data().lastUsedAt).getTime());
        for (let i = 0; i < (userHist.size - 49); i++) await sorted[i].ref.delete();
      }
      const newDocRef = db.collection("searchHistory").doc();
      const newEntry = { id: newDocRef.id, userId: req.user.uid, query: cleanQuery, scope, projectId: validProjectId, projectName: validProjectName, filters: filters || null, signature, createdAt: now, lastUsedAt: now };
      await newDocRef.set(newEntry);
      return res.status(201).json({ success: true, entry: newEntry, isDuplicate: false });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // 3. DELETE /api/search-history/:id
  app.delete("/api/search-history/:id", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { id } = req.params;
      const docSnap = await db.collection("searchHistory").doc(id).get();
      if (!docSnap.exists) return res.status(404).json({ error: "Not Found" });
      if (docSnap.data().userId !== req.user.uid) return res.status(403).json({ error: "Forbidden" });
      await db.collection("searchHistory").doc(id).delete();
      return res.json({ success: true, id });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // 4. DELETE /api/search-history (Clear by scope)
  app.delete("/api/search-history", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const scope = (req.query.scope as string) || "global";
      if (scope !== "global" && scope !== "project") return res.status(400).json({ error: "Bad Request" });
      const projectId = (req.query.projectId as string) || null;
      if (scope === "project" && !projectId) return res.status(400).json({ error: "Bad Request" });
      let qRef = db.collection("searchHistory").where("userId", "==", req.user.uid).where("scope", "==", scope);
      if (scope === "project" && projectId) qRef = qRef.where("projectId", "==", projectId);
      const snap = await qRef.get();
      for (const d of snap.docs) await d.ref.delete();
      return res.json({ success: true, clearedCount: snap.size });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });

  return app;
}

async function runIntegrationTests() {
  console.log("=== Starting Search History Real-Route Integration Test Suite (AH.126) ===\n");
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
  db.store.set("projects/proj_secret", { id: "proj_secret", name: "Secret Vault", ownerId: "user_bob", memberIds: [] });

  const app = createTestServer(db, tokenUserMap);
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
    const unauthGet = await request("/api/search-history");
    assert(unauthGet.status === 401, "Unauthenticated GET returns 401");
    const unauthPost = await request("/api/search-history", { method: "POST", body: { query: "test" } });
    assert(unauthPost.status === 401, "Unauthenticated POST returns 401");

    // 2. Authenticated POST creates new history entry
    console.log("\n--- Suite 2: Global Search Creation & Listing ---");
    const createRes = await request("/api/search-history", { token: "token_alice", method: "POST", body: { query: "quarterly roadmap", scope: "global" } });
    assert(createRes.status === 201 && createRes.data.success && createRes.data.isDuplicate === false, "Alice creates first global search");
    const aliceFirstId = createRes.data.entry.id;

    // 3. Second query creates second entry and tests ordering
    await new Promise(r => setTimeout(r, 50));
    const createRes2 = await request("/api/search-history", { token: "token_alice", method: "POST", body: { query: "enterprise sso", scope: "global" } });
    assert(createRes2.status === 201, "Alice creates second global search");
    const listRes = await request("/api/search-history?scope=global", { token: "token_alice" });
    assert(listRes.status === 200 && listRes.data.entries.length === 2, "Alice lists 2 search history entries");
    assert(listRes.data.entries[0].query === "enterprise sso", "Newest query appears first");

    // 4. Repeating a search deduplicates and updates recency
    console.log("\n--- Suite 3: Deduplication & Recency Bump ---");
    await new Promise(r => setTimeout(r, 50));
    const dupRes = await request("/api/search-history", { token: "token_alice", method: "POST", body: { query: "quarterly roadmap", scope: "global" } });
    assert(dupRes.status === 200 && dupRes.data.isDuplicate === true, "Repeating query flags isDuplicate");
    const listAfterDup = await request("/api/search-history?scope=global", { token: "token_alice" });
    assert(listAfterDup.data.entries.length === 2, "Entry count remains 2 after duplicate query");
    assert(listAfterDup.data.entries[0].query === "quarterly roadmap", "Repeated query is bumped to index 0");

    // 5. Input validation (empty query, query > 200 chars, invalid scope)
    console.log("\n--- Suite 4: Input Validation & Boundary Checks ---");
    const emptyQuery = await request("/api/search-history", { token: "token_alice", method: "POST", body: { query: "   ", scope: "global" } });
    assert(emptyQuery.status === 400, "Empty query string is rejected with 400");
    const longQuery = await request("/api/search-history", { token: "token_alice", method: "POST", body: { query: "a".repeat(201), scope: "global" } });
    assert(longQuery.status === 400, "Query exceeding 200 chars is rejected with 400");
    const invalidScope = await request("/api/search-history", { token: "token_alice", method: "POST", body: { query: "test", scope: "unsupported" } });
    assert(invalidScope.status === 400, "Invalid scope is rejected with 400");

    // 6. Project search authorization & scoping
    console.log("\n--- Suite 5: Project Scoped History & Authorization ---");
    const projNoId = await request("/api/search-history", { token: "token_alice", method: "POST", body: { query: "auth check", scope: "project" } });
    assert(projNoId.status === 400, "Project search without projectId is rejected with 400");
    const projForbidden = await request("/api/search-history", { token: "token_alice", method: "POST", body: { query: "vault check", scope: "project", projectId: "proj_secret" } });
    assert(projForbidden.status === 403, "Alice cannot save project search in Bob secret project (403)");
    const projAliceOk = await request("/api/search-history", { token: "token_alice", method: "POST", body: { query: "alpha transcript", scope: "project", projectId: "proj_alpha" } });
    assert(projAliceOk.status === 201, "Alice successfully records search in owned project proj_alpha");

    // 7. Privacy & Cross-User Isolation
    console.log("\n--- Suite 6: Cross-User Isolation ---");
    const bobList = await request("/api/search-history?scope=global", { token: "token_bob" });
    assert(bobList.status === 200 && bobList.data.entries.length === 0, "Bob cannot see Alice global search history");
    const bobDeleteAlice = await request(`/api/search-history/${aliceFirstId}`, { token: "token_bob", method: "DELETE" });
    assert(bobDeleteAlice.status === 403, "Bob cannot delete Alice history entry (403 Forbidden)");

    // 8. Individual deletion
    console.log("\n--- Suite 7: Deletion Operations ---");
    const aliceDeleteOwn = await request(`/api/search-history/${aliceFirstId}`, { token: "token_alice", method: "DELETE" });
    assert(aliceDeleteOwn.status === 200, "Alice deletes her own history entry");
    const listAfterDelete = await request("/api/search-history?scope=global", { token: "token_alice" });
    assert(listAfterDelete.data.entries.length === 1, "Remaining entry preserved after single delete");

    // 9. Clear all global history
    const clearGlobal = await request("/api/search-history?scope=global", { token: "token_alice", method: "DELETE" });
    assert(clearGlobal.status === 200 && clearGlobal.data.clearedCount === 1, "Clear global history wipes remaining global item");
    const listAfterClear = await request("/api/search-history?scope=global", { token: "token_alice" });
    assert(listAfterClear.data.entries.length === 0, "Global history is completely empty");

    // Project history is still preserved
    const aliceProjList = await request("/api/search-history?scope=project&projectId=proj_alpha", { token: "token_alice" });
    assert(aliceProjList.data.entries.length === 1, "Clearing global history preserved project-scoped history");

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n==================================================");
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");
  if (failed > 0) throw new Error(`${failed} integration tests failed`);
}

runIntegrationTests().catch(err => { console.error(err); process.exit(1); });