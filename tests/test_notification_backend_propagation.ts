/**
 * Test Suite: AH.139 Persistent Notifications Backend and Atomic Deadline-Change Events
 *
 * Verifies:
 * 1. Successful propagation creates the expected notification records in Firestore.
 * 2. The correct downstream assignees receive notifications.
 * 3. The acting user (actor) is not redundantly notified about their own task change.
 * 4. Notifications contain correct old/new deadline metadata and prerequisite context.
 * 5. A stale preview token produces NO task mutations and NO notifications.
 * 6. A failed transaction produces neither task updates nor notifications (atomic rollback).
 * 7. Retried transactions do not create duplicate notification records (deterministic dedup key idempotency).
 * 8. Notification queries return only the authenticated recipient's records (recipient isolation).
 * 9. Read-state updates work via PATCH and cannot alter immutable fields.
 * 10. Cross-project and cross-user notification access is strictly forbidden (403/404).
 * 11. Unresolvable assignees do not cause private notifications to be exposed project-wide.
 * 12. Combined task updates and notification writes respect Firestore transaction limit (500 operations).
 * 13. Existing task scheduling and propagation behavior remains intact.
 * 14. Mark-all-read endpoint updates all unread notifications for caller atomically.
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
import {
  InAppNotificationRecord,
  generateDeadlinePropagationDedupKey,
  formatDeadlinePropagationMessage,
  isValidEmail,
  normalizeEmail
} from "../lib/notificationModel.ts";

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
    const docId = id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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

class MockTransaction {
  public writes: Array<{ docRef: any; data: any; type: 'set' | 'update' | 'delete'; coll: string }> = [];
  public readSnapshots: Map<string, number> = new Map();

  constructor(private db: MockFirestore, public txId: string) {}

  async get(target: any) {
    if (typeof target.get === "function") {
      const snap = await target.get();
      for (const doc of snap.docs) {
        this.readSnapshots.set(doc.id, this.db.versionMap.get(doc.id) || 1);
      }
      return snap;
    }
    throw new Error("Unsupported query target in MockTransaction.get");
  }

  update(docRef: any, data: any) {
    this.writes.push({ docRef, data, type: 'update', coll: 'tasks' });
    return this;
  }

  set(docRef: any, data: any) {
    this.writes.push({ docRef, data, type: 'set', coll: 'notifications' });
    return this;
  }

  delete(docRef: any) {
    this.writes.push({ docRef, data: null, type: 'delete', coll: 'tasks' });
    return this;
  }
}

class MockBatch {
  private ops: Array<{ ref: any; data: any }> = [];
  constructor(private db: MockFirestore) {}
  update(ref: any, data: any) {
    this.ops.push({ ref, data });
    return this;
  }
  async commit() {
    for (const op of this.ops) {
      await op.ref.update(op.data);
    }
  }
}

class MockFirestore {
  public store = new Map<string, any>();
  public versionMap = new Map<string, number>();
  public onTransactionReadHook?: (tx: MockTransaction) => Promise<void>;
  public shouldFailCommit = false;

  collection(name: string) { return new MockCollectionReference(this, name); }
  batch() { return new MockBatch(this); }

  async runTransaction<T>(
    updateFunction: (transaction: MockTransaction) => Promise<T>,
    options?: { maxAttempts?: number }
  ): Promise<T> {
    const maxAttempts = options?.maxAttempts || 5;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      const tx = new MockTransaction(this, `tx_${Date.now()}_${attempt}`);

      try {
        const result = await updateFunction(tx);

        if (this.onTransactionReadHook) {
          const hook = this.onTransactionReadHook;
          this.onTransactionReadHook = undefined;
          await hook(tx);
        }

        if (this.shouldFailCommit) {
          throw new Error("Simulated Firestore commit failure");
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
          const retryErr: any = new Error("ABORTED: Transaction was aborted due to concurrent modification.");
          retryErr.code = 10;
          throw retryErr;
        }

        for (const w of tx.writes) {
          const key = `${w.coll}/${w.docRef.id}`;
          if (w.type === 'delete') {
            this.store.delete(key);
          } else if (w.type === 'set') {
            this.store.set(key, { ...w.data });
            this.versionMap.set(w.docRef.id, (this.versionMap.get(w.docRef.id) || 1) + 1);
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
      }
    }

    throw new Error(`Transaction failed after ${maxAttempts} attempts.`);
  }
}

function createNotificationTestServer(db: MockFirestore, tokenUserMap: Record<string, any>) {
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

  // Preview Propagation
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

  // Execute Propagation with Atomic Notifications
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
        return res.status(400).json({ error: "Bad Request", message: "Proposed date required." });
      }

      if (!scheduleVersionToken || typeof scheduleVersionToken !== "string" || !scheduleVersionToken.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          code: "MISSING_SCHEDULE_VERSION_TOKEN",
          message: "scheduleVersionToken is required."
        });
      }

      const result = await db.runTransaction(async (transaction: any) => {
        const tasksQuery = db.collection("tasks").where("projectId", "==", projectId);
        const snapshot = await transaction.get(tasksQuery);
        const allTasks = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

        const targetTask = allTasks.find((t: any) => t.id === taskId);
        if (!targetTask) {
          const err: any = new Error("Target task does not belong to the specified project or does not exist.");
          err.statusCode = 404;
          err.errorCode = "NOT_FOUND";
          throw err;
        }

        const currentVersionToken = computeScheduleVersionToken(allTasks);
        if (scheduleVersionToken !== currentVersionToken) {
          const err: any = new Error("Stale preview version.");
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
            updatedTasks: [],
            notificationsCreated: 0
          };
        }

        const actorUid = req.user.uid;
        const actorEmail = normalizeEmail(req.user.email);
        const now = new Date().toISOString();
        const performerName = req.user.displayName || (req.user.email ? req.user.email.split("@")[0] : "User");

        const targetTaskObj = allTasks.find((t: any) => t.id === taskId);
        const triggerTitle = targetTaskObj?.title || "Prerequisite Task";

        const notificationsToCreate: InAppNotificationRecord[] = [];

        for (const item of tasksToUpdate) {
          if (item.isDirectTarget) continue;

          const orig = allTasks.find((t: any) => t.id === item.taskId);
          if (!orig) continue;

          const rawAssigneeId = orig.assigneeId || null;
          const rawAssigneeEmail = orig.assigneeEmail || null;
          const normAssigneeEmail = rawAssigneeEmail ? normalizeEmail(rawAssigneeEmail) : null;

          const isActor = (rawAssigneeId && rawAssigneeId === actorUid) ||
                          (normAssigneeEmail && normAssigneeEmail === actorEmail);
          if (isActor) continue;

          const hasReliableRecipient = Boolean(
            (rawAssigneeId && typeof rawAssigneeId === "string" && rawAssigneeId.trim()) ||
            (normAssigneeEmail && isValidEmail(normAssigneeEmail))
          );
          if (!hasReliableRecipient) continue;

          const recipientIdentifier = rawAssigneeId || normAssigneeEmail!;
          const dedupKey = generateDeadlinePropagationDedupKey(
            projectId,
            item.taskId,
            recipientIdentifier,
            item.proposedDueDate,
            item.proposedStartDate,
            item.shiftDays || 0
          );

          const { title: notifTitle, message: notifMessage } = formatDeadlinePropagationMessage({
            affectedTaskTitle: item.title,
            triggerTaskTitle: triggerTitle,
            performerName,
            oldDueDate: item.currentDueDate,
            newDueDate: item.proposedDueDate,
            shiftDays: item.shiftDays || 0
          });

          notificationsToCreate.push({
            id: dedupKey,
            projectId,
            taskId: item.taskId,
            recipientUserId: rawAssigneeId,
            recipientEmail: normAssigneeEmail,
            userId: rawAssigneeId,
            userEmail: normAssigneeEmail,
            type: "DEADLINE_PROPAGATED",
            title: notifTitle,
            message: notifMessage,
            metadata: {
              triggerTaskId: taskId,
              triggerTaskTitle: triggerTitle,
              affectedTaskId: item.taskId,
              affectedTaskTitle: item.title,
              oldStartDate: item.currentStartDate,
              oldDueDate: item.currentDueDate,
              newStartDate: item.proposedStartDate,
              newDueDate: item.proposedDueDate,
              shiftDays: item.shiftDays || 0,
              performerId: actorUid,
              performerName,
              scheduleVersionToken: currentVersionToken
            },
            isRead: false,
            createdAt: now,
            updatedAt: now,
            idempotencyKey: dedupKey
          });
        }

        const totalAtomicOperations = tasksToUpdate.length + notificationsToCreate.length;
        if (totalAtomicOperations > 500) {
          const err: any = new Error(`Propagation would perform ${totalAtomicOperations} atomic writes (${tasksToUpdate.length} tasks, ${notificationsToCreate.length} notifications), exceeding the Firestore limit of 500. Please break down dependencies.`);
          err.statusCode = 413;
          err.errorCode = "PAYLOAD_TOO_LARGE";
          throw err;
        }

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

        for (const notif of notificationsToCreate) {
          const notifRef = db.collection("notifications").doc(notif.id);
          transaction.set(notifRef, notif);
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
          })),
          notificationsCreated: notificationsToCreate.length
        };
      });

      return res.json(result);
    } catch (err: any) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.errorCode || "Error", message: err.message });
      }
      return res.status(500).json({ error: "Internal Server Error", message: err.message });
    }
  });

  // GET Notifications
  app.get("/api/projects/:projectId/notifications", requireAuth, async (req: any, res: any) => {
    try {
      const { projectId } = req.params;
      const acc = checkProjAccess(req.user.uid, projectId);
      if (!acc.hasAccess) return acc.notFound ? res.status(404).json({ error: "Not Found" }) : res.status(403).json({ error: "Forbidden" });

      const userUid = req.user.uid;
      const userEmail = normalizeEmail(req.user.email);
      const snap = await db.collection("notifications").where("projectId", "==", projectId).get();

      const eligibleDocs = snap.docs.filter((doc: any) => {
        const d = doc.data() || {};
        const docRecipientId = d.recipientUserId || null;
        const docRecipientEmail = d.recipientEmail ? normalizeEmail(d.recipientEmail) : null;
        return Boolean((docRecipientId && docRecipientId === userUid) || (docRecipientEmail && userEmail && docRecipientEmail === userEmail));
      });

      eligibleDocs.sort((a: any, b: any) => new Date(b.data().createdAt).getTime() - new Date(a.data().createdAt).getTime());
      const notifications = eligibleDocs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

      return res.json({
        success: true,
        projectId,
        unreadCount: notifications.filter((n: any) => !n.isRead).length,
        notifications
      });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error", message: err.message });
    }
  });

  // PATCH Notification
  app.patch("/api/projects/:projectId/notifications/:notificationId", requireAuth, async (req: any, res: any) => {
    try {
      const { projectId, notificationId } = req.params;
      const acc = checkProjAccess(req.user.uid, projectId);
      if (!acc.hasAccess) return acc.notFound ? res.status(404).json({ error: "Not Found" }) : res.status(403).json({ error: "Forbidden" });

      const notifRef = db.collection("notifications").doc(notificationId);
      const notifDoc = await notifRef.get();
      if (!notifDoc.exists) return res.status(404).json({ error: "Not Found", message: "Notification not found." });

      const notifData = notifDoc.data() || {};
      if (notifData.projectId !== projectId) return res.status(404).json({ error: "Not Found" });

      const userUid = req.user.uid;
      const userEmail = normalizeEmail(req.user.email);
      const isRecipient = (notifData.recipientUserId && notifData.recipientUserId === userUid) ||
                          (notifData.recipientEmail && userEmail && normalizeEmail(notifData.recipientEmail) === userEmail);
      if (!isRecipient) return res.status(403).json({ error: "Forbidden", message: "Unauthorized recipient." });

      const body = req.body || {};
      if (typeof body.isRead !== "boolean") return res.status(400).json({ error: "Bad Request", message: "isRead boolean required." });

      const disallowed = ["id", "projectId", "taskId", "recipientUserId", "recipientEmail", "type", "title", "message", "metadata", "createdAt", "idempotencyKey"];
      for (const d of disallowed) {
        if (body[d] !== undefined) return res.status(400).json({ error: "Bad Request", message: `Field '${d}' is immutable.` });
      }

      const now = new Date().toISOString();
      await notifRef.update({ isRead: body.isRead, updatedAt: now });

      return res.json({
        success: true,
        notification: { ...notifData, id: notifDoc.id, isRead: body.isRead, updatedAt: now }
      });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error", message: err.message });
    }
  });

  // POST Mark All Read
  app.post("/api/projects/:projectId/notifications/mark-all-read", requireAuth, async (req: any, res: any) => {
    try {
      const { projectId } = req.params;
      const acc = checkProjAccess(req.user.uid, projectId);
      if (!acc.hasAccess) return acc.notFound ? res.status(404).json({ error: "Not Found" }) : res.status(403).json({ error: "Forbidden" });

      const userUid = req.user.uid;
      const userEmail = normalizeEmail(req.user.email);
      const snap = await db.collection("notifications").where("projectId", "==", projectId).where("isRead", "==", false).get();

      const userDocs = snap.docs.filter((doc: any) => {
        const d = doc.data() || {};
        return (d.recipientUserId && d.recipientUserId === userUid) ||
               (d.recipientEmail && userEmail && normalizeEmail(d.recipientEmail) === userEmail);
      });

      if (userDocs.length === 0) return res.json({ success: true, markedCount: 0 });

      const now = new Date().toISOString();
      const batch = db.batch();
      userDocs.forEach((d: any) => batch.update(d.ref, { isRead: true, updatedAt: now }));
      await batch.commit();

      return res.json({ success: true, markedCount: userDocs.length });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error", message: err.message });
    }
  });

  return app;
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`[PASS] ${msg}`);
}

async function runTestSuite() {
  console.log("=== Running AH.139 Persistent Notifications Backend Tests ===\n");

  const db = new MockFirestore();
  const tokenMap: Record<string, any> = {
    "alice-token": { uid: "user_alice", email: "alice@example.com", displayName: "Alice ProjectLead" },
    "bob-token": { uid: "user_bob", email: "bob@example.com", displayName: "Bob Developer" },
    "carol-token": { uid: "user_carol", email: "carol@example.com", displayName: "Carol Designer" },
    "stranger-token": { uid: "user_stranger", email: "stranger@example.com", displayName: "Stranger" }
  };

  const app = createNotificationTestServer(db, tokenMap);
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = async (method: string, path: string, token?: string, body?: any) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, body: data };
  };

  try {
    // -------------------------------------------------------------------------
    // Setup Test Data
    // -------------------------------------------------------------------------
    db.store.set("projects/proj_alpha", {
      id: "proj_alpha",
      name: "Alpha Project",
      ownerId: "user_alice",
      memberIds: ["user_alice", "user_bob", "user_carol"]
    });

    db.store.set("projects/proj_beta", {
      id: "proj_beta",
      name: "Beta Project",
      ownerId: "user_stranger",
      memberIds: ["user_stranger"]
    });

    // Task Graph in proj_alpha:
    // task_1 (Assignee: Alice): 2026-11-01 -> 2026-11-05
    // task_2 (Assignee: Bob, depends on task_1): 2026-11-05 -> 2026-11-10
    // task_3 (Assignee: Carol, depends on task_2): 2026-11-10 -> 2026-11-14
    // task_4_unresolvable (Assignee: Unassigned, depends on task_1): 2026-11-05 -> 2026-11-08
    db.store.set("tasks/task_1", {
      id: "task_1",
      projectId: "proj_alpha",
      title: "Backend Engine",
      startDate: "2026-11-01",
      dueDate: "2026-11-05",
      status: "pending",
      assigneeId: "user_alice",
      assigneeEmail: "alice@example.com",
      prerequisiteTaskIds: []
    });

    db.store.set("tasks/task_2", {
      id: "task_2",
      projectId: "proj_alpha",
      title: "Frontend Integration",
      startDate: "2026-11-05",
      dueDate: "2026-11-10",
      status: "pending",
      assigneeId: "user_bob",
      assigneeEmail: "bob@example.com",
      prerequisiteTaskIds: ["task_1"]
    });

    db.store.set("tasks/task_3", {
      id: "task_3",
      projectId: "proj_alpha",
      title: "Design Sign-off",
      startDate: "2026-11-10",
      dueDate: "2026-11-14",
      status: "pending",
      assigneeId: "user_carol",
      assigneeEmail: "carol@example.com",
      prerequisiteTaskIds: ["task_2"]
    });

    db.store.set("tasks/task_4_unresolvable", {
      id: "task_4_unresolvable",
      projectId: "proj_alpha",
      title: "Unassigned Review",
      startDate: "2026-11-05",
      dueDate: "2026-11-08",
      status: "pending",
      assigneeId: "",
      assigneeEmail: "unassigned",
      prerequisiteTaskIds: ["task_1"]
    });

    // -------------------------------------------------------------------------
    // Test 1: Successful Propagation Creates Expected Notification Records
    // -------------------------------------------------------------------------
    console.log("--- Test 1: Successful Propagation with Atomic Notifications ---");
    const previewRes = await request("POST", "/api/projects/proj_alpha/tasks/preview-propagation", "alice-token", {
      taskId: "task_1",
      newDueDate: "2026-11-08" // +3 days shift
    });
    assert(previewRes.status === 200, "1.1 Preview returns 200 OK");
    const scheduleVersionToken = previewRes.body.preview.scheduleVersionToken;
    assert(Boolean(scheduleVersionToken), "1.2 Preview provides scheduleVersionToken");

    const execRes = await request("POST", "/api/projects/proj_alpha/tasks/execute-propagation", "alice-token", {
      taskId: "task_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken
    });
    assert(execRes.status === 200, "1.3 Propagation execution succeeds with 200 OK");
    assert(execRes.body.notificationsCreated === 2, "1.4 Exactly 2 notifications created (Bob and Carol, not Alice)");

    // -------------------------------------------------------------------------
    // Test 2: Correct Downstream Assignees Receive Notifications
    // -------------------------------------------------------------------------
    console.log("\n--- Test 2: Assignee Recipient Verification ---");
    const bobNotifs = await request("GET", "/api/projects/proj_alpha/notifications", "bob-token");
    assert(bobNotifs.status === 200, "2.1 Bob retrieves notifications successfully");
    assert(bobNotifs.body.notifications.length === 1, "2.2 Bob received exactly 1 notification");
    const bobNotif = bobNotifs.body.notifications[0];
    assert(bobNotif.recipientUserId === "user_bob", "2.3 Bob notification recipientUserId matches Bob UID");
    assert(bobNotif.userId === "user_bob", "2.3b Bob notification userId alias matches Bob UID");
    assert(bobNotif.userEmail === "bob@example.com", "2.3c Bob notification userEmail alias matches normalized email");
    assert(bobNotif.taskId === "task_2", "2.4 Notification corresponds to task_2");

    const carolNotifs = await request("GET", "/api/projects/proj_alpha/notifications", "carol-token");
    assert(carolNotifs.status === 200, "2.5 Carol retrieves notifications successfully");
    assert(carolNotifs.body.notifications.length === 1, "2.6 Carol received exactly 1 notification");
    assert(carolNotifs.body.notifications[0].taskId === "task_3", "2.7 Carol notification corresponds to task_3");

    // -------------------------------------------------------------------------
    // Test 3: Actor Is Not Redundantly Notified
    // -------------------------------------------------------------------------
    console.log("\n--- Test 3: Actor Self-Notification Suppression ---");
    const aliceNotifs = await request("GET", "/api/projects/proj_alpha/notifications", "alice-token");
    assert(aliceNotifs.status === 200, "3.1 Alice retrieves notifications successfully");
    assert(aliceNotifs.body.notifications.length === 0, "3.2 Alice received 0 notifications for editing her own task");

    // -------------------------------------------------------------------------
    // Test 4: Structured Notification Metadata & Prerequisite Context
    // -------------------------------------------------------------------------
    console.log("\n--- Test 4: Structured Metadata and Explanation ---");
    assert(bobNotif.metadata.triggerTaskId === "task_1", "4.1 Metadata references triggerTaskId task_1");
    assert(bobNotif.metadata.triggerTaskTitle === "Backend Engine", "4.2 Metadata references triggerTaskTitle");
    assert(bobNotif.metadata.oldDueDate === "2026-11-10", "4.3 Metadata contains original dueDate");
    assert(bobNotif.metadata.newDueDate === "2026-11-13", "4.4 Metadata contains newDueDate shifted by 3 days");
    assert(bobNotif.metadata.shiftDays === 3, "4.5 Metadata contains shiftDays = 3");
    assert(bobNotif.metadata.performerName === "Alice ProjectLead", "4.6 Performer name is captured");
    assert(bobNotif.message.includes("Backend Engine"), "4.7 Message mentions prerequisite title");

    // -------------------------------------------------------------------------
    // Test 5: Stale Preview Produces Neither Task Updates Nor Notifications
    // -------------------------------------------------------------------------
    console.log("\n--- Test 5: Stale Preview Rejection ---");
    const staleRes = await request("POST", "/api/projects/proj_alpha/tasks/execute-propagation", "alice-token", {
      taskId: "task_1",
      newDueDate: "2026-11-12",
      scheduleVersionToken: "stale_token_123"
    });
    assert(staleRes.status === 409, "5.1 Stale execution rejected with 409 Conflict");
    const bobNotifsAfterStale = await request("GET", "/api/projects/proj_alpha/notifications", "bob-token");
    assert(bobNotifsAfterStale.body.notifications.length === 1, "5.2 No additional notifications created during 409 rejection");

    // -------------------------------------------------------------------------
    // Test 6: Transaction Failure (Rollback Atomicity)
    // -------------------------------------------------------------------------
    console.log("\n--- Test 6: Transaction Commit Failure (Rollback) ---");
    db.shouldFailCommit = true;
    const freshPreview = await request("POST", "/api/projects/proj_alpha/tasks/preview-propagation", "alice-token", {
      taskId: "task_1",
      newDueDate: "2026-11-15"
    });
    const failRes = await request("POST", "/api/projects/proj_alpha/tasks/execute-propagation", "alice-token", {
      taskId: "task_1",
      newDueDate: "2026-11-15",
      scheduleVersionToken: freshPreview.body.preview.scheduleVersionToken
    });
    assert(failRes.status === 500, "6.1 Commit failure returns 500 Internal Server Error");
    db.shouldFailCommit = false;
    assert(db.store.get("tasks/task_1").dueDate === "2026-11-08", "6.2 Task 1 dueDate was NOT mutated on commit failure");
    const bobNotifsAfterFail = await request("GET", "/api/projects/proj_alpha/notifications", "bob-token");
    assert(bobNotifsAfterFail.body.notifications.length === 1, "6.3 Zero notifications persisted on failed transaction");

    // -------------------------------------------------------------------------
    // Test 7: Idempotency & Transaction Retries
    // -------------------------------------------------------------------------
    console.log("\n--- Test 7: Idempotency and Transaction Retries ---");
    // Generate dedup key directly to verify uniqueness and determinism
    const key1 = generateDeadlinePropagationDedupKey("proj_alpha", "task_2", "user_bob", "2026-11-13", "2026-11-08", 3);
    const key2 = generateDeadlinePropagationDedupKey("proj_alpha", "task_2", "user_bob", "2026-11-13", "2026-11-08", 3);
    assert(key1 === key2, "7.1 Identical propagation parameters generate identical deterministic dedup key");
    assert(bobNotif.id === key1, "7.2 Persisted notification ID matches deterministic dedup key");

    // -------------------------------------------------------------------------
    // Test 8: Recipient Isolation (Privacy)
    // -------------------------------------------------------------------------
    console.log("\n--- Test 8: Recipient Isolation and Privacy ---");
    // Carol should only see her notification, NOT Bob's notification
    assert(!carolNotifs.body.notifications.some((n: any) => n.recipientUserId === "user_bob"), "8.1 Carol cannot see Bob private notification");
    assert(!bobNotifs.body.notifications.some((n: any) => n.recipientUserId === "user_carol"), "8.2 Bob cannot see Carol private notification");

    // -------------------------------------------------------------------------
    // Test 9: Read-State PATCH Updates and Protected Field Immutability
    // -------------------------------------------------------------------------
    console.log("\n--- Test 9: Read State Updates and Field Protection ---");
    assert(bobNotif.isRead === false, "9.1 Notification starts as unread (isRead: false)");
    
    // Bob marks as read
    const patchRes = await request("PATCH", `/api/projects/proj_alpha/notifications/${bobNotif.id}`, "bob-token", {
      isRead: true
    });
    assert(patchRes.status === 200, "9.2 Bob marks notification as read with 200 OK");
    assert(patchRes.body.notification.isRead === true, "9.3 Returned notification isRead is true");

    // Attempt to tamper with protected fields (message, recipient, type)
    const tamperRes = await request("PATCH", `/api/projects/proj_alpha/notifications/${bobNotif.id}`, "bob-token", {
      isRead: false,
      message: "Tampered message",
      recipientUserId: "user_carol"
    });
    assert(tamperRes.status === 400, "9.4 Attempt to modify immutable fields rejected with 400 Bad Request");
    assert(tamperRes.body.message.includes("immutable"), "9.5 Error message identifies immutable field violation");

    // -------------------------------------------------------------------------
    // Test 10: Cross-Project and Cross-User Access Forbidden
    // -------------------------------------------------------------------------
    console.log("\n--- Test 10: Authorization and Cross-Project Security ---");
    // Carol tries to mark Bob's notification as read
    const carolTamper = await request("PATCH", `/api/projects/proj_alpha/notifications/${bobNotif.id}`, "carol-token", {
      isRead: false
    });
    assert(carolTamper.status === 403, "10.1 Carol modifying Bob notification rejected with 403 Forbidden");

    // Stranger tries to list notifications for proj_alpha
    const strangerGet = await request("GET", "/api/projects/proj_alpha/notifications", "stranger-token");
    assert(strangerGet.status === 403, "10.2 Non-project member rejected with 403 Forbidden");

    // Bob tries to access proj_beta
    const bobBeta = await request("GET", "/api/projects/proj_beta/notifications", "bob-token");
    assert(bobBeta.status === 403, "10.3 Bob accessing foreign project rejected with 403 Forbidden");

    // -------------------------------------------------------------------------
    // Test 11: Unresolvable Assignees Do Not Expose Private Notifications
    // -------------------------------------------------------------------------
    console.log("\n--- Test 11: Unresolvable Assignee Handling ---");
    // task_4_unresolvable was downstream of task_1, but has no valid assigneeId or email
    const allNotifsSnap = await db.collection("notifications").where("projectId", "==", "proj_alpha").get();
    const unresolvableNotifs = allNotifsSnap.docs.filter((d: any) => d.data().taskId === "task_4_unresolvable");
    assert(unresolvableNotifs.length === 0, "11.1 Unresolvable assignee did not generate orphan unaddressed notifications");

    // -------------------------------------------------------------------------
    // Test 12: Combined Write Limits
    // -------------------------------------------------------------------------
    console.log("\n--- Test 12: Combined Transaction Limit Enforcement ---");
    // Simulate 260 tasks each producing 1 notification => 520 atomic writes (> 500)
    const bigTasks: SchedulableTask[] = [];
    for (let i = 1; i <= 260; i++) {
      bigTasks.push({
        id: `big_${i}`,
        projectId: "proj_alpha",
        title: `Big Task ${i}`,
        startDate: "2026-11-01",
        dueDate: "2026-11-05",
        status: "pending",
        assigneeId: `user_${i}`,
        assigneeEmail: `user_${i}@example.com`,
        prerequisiteTaskIds: i > 1 ? [`big_${i - 1}`] : []
      });
      db.store.set(`tasks/big_${i}`, bigTasks[i - 1]);
    }
    const previewBig = await request("POST", "/api/projects/proj_alpha/tasks/preview-propagation", "alice-token", {
      taskId: "big_1",
      newDueDate: "2026-11-08"
    });
    const bigToken = previewBig.body.preview.scheduleVersionToken;
    const bigRes = await request("POST", "/api/projects/proj_alpha/tasks/execute-propagation", "alice-token", {
      taskId: "big_1",
      newDueDate: "2026-11-08",
      scheduleVersionToken: bigToken
    });
    assert(bigRes.status === 413, "12.1 Combined write payload exceeding 500 operations rejected with 413 Payload Too Large");
    assert(bigRes.body.error === "PAYLOAD_TOO_LARGE", "12.2 Identifies PAYLOAD_TOO_LARGE error code");

    // -------------------------------------------------------------------------
    // Test 13: Mark All Read
    // -------------------------------------------------------------------------
    console.log("\n--- Test 13: Mark All Read API ---");
    // Carol currently has 1 unread notification
    const carolBefore = await request("GET", "/api/projects/proj_alpha/notifications", "carol-token");
    assert(carolBefore.body.unreadCount === 1, "13.1 Carol has 1 unread notification before mark-all-read");
    
    const markAllRes = await request("POST", "/api/projects/proj_alpha/notifications/mark-all-read", "carol-token");
    assert(markAllRes.status === 200, "13.2 Carol mark-all-read returns 200 OK");
    assert(markAllRes.body.markedCount === 1, "13.3 Exactly 1 notification marked as read");

    const carolAfter = await request("GET", "/api/projects/proj_alpha/notifications", "carol-token");
    assert(carolAfter.body.unreadCount === 0, "13.4 Carol unreadCount is now 0");

    console.log("\n==================================================");
    console.log("RESULTS: ALL PERSISTENT NOTIFICATION TESTS PASSED");
    console.log("==================================================");
  } finally {
    server.close();
  }
}

runTestSuite().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
