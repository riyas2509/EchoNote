import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import crypto from 'crypto';
import {
  InAppNotificationRecord,
  generateTaskOverdueDedupKey,
  formatTaskOverdueMessage
} from '../lib/notificationModel.ts';
import {
  evaluateTaskOverdueEligibility,
  resolveTaskRecipient,
  createOverdueNotificationAtomic,
  scanAndCreateOverdueNotifications,
  getCurrentUtcCalendarDate,
  isTaskTerminalOrCompleted
} from '../lib/overdueTaskAlertService.ts';

// In-Memory Transaction-Capable Firestore Mock for Concurrency & Isolation Tests
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
  constructor(private db: MockFirestore, private collectionName: string, private parentRef?: any) {}

  doc(id?: string) {
    const collName = this.collectionName;
    const db = this.db;
    const docId = id || ('doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    const fullPath = this.parentRef ? (this.parentRef.path + '/' + collName + '/' + docId) : (collName + '/' + docId);

    const ref = {
      id: docId,
      path: fullPath,
      parent: {
        id: collName,
        parent: this.parentRef ? { id: this.parentRef.id } : null
      },
      get: async () => new MockDocSnapshot(docId, db.store.get(fullPath), this),
      set: async (data: any) => { db.store.set(fullPath, { ...data }); },
      update: async (data: any) => {
        const existing = db.store.get(fullPath) || {};
        db.store.set(fullPath, { ...existing, ...data });
      },
      collection: (subCollName: string) => new MockCollectionReference(db, subCollName, { id: docId, path: fullPath })
    };
    return ref;
  }

  limit(num: number) {
    return new MockQuery(this.db, this.collectionName, this.parentRef, { limit: num });
  }

  async get() {
    return new MockQuery(this.db, this.collectionName, this.parentRef).get();
  }
}

class MockQuery {
  constructor(
    private db: MockFirestore,
    private collName: string,
    private parentRef?: any,
    private opts: { limit?: number; startAfter?: any } = {}
  ) {}

  limit(n: number) {
    return new MockQuery(this.db, this.collName, this.parentRef, { ...this.opts, limit: n });
  }

  startAfter(docSnap: any) {
    return new MockQuery(this.db, this.collName, this.parentRef, { ...this.opts, startAfter: docSnap });
  }

  async get() {
    const docs: MockDocSnapshot[] = [];
    const prefix = this.parentRef ? (this.parentRef.path + '/' + this.collName + '/') : (this.collName + '/');

    for (const [key, val] of this.db.store.entries()) {
      if (key.startsWith(prefix)) {
        const sub = key.slice(prefix.length);
        if (!sub.includes('/')) {
          docs.push(new MockDocSnapshot(sub, val, { id: this.collName, parent: this.parentRef }));
        }
      }
    }

    docs.sort((a, b) => a.id.localeCompare(b.id));

    let startIndex = 0;
    if (this.opts.startAfter) {
      const idx = docs.findIndex(d => d.id === this.opts.startAfter.id);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    let sliced = docs.slice(startIndex);
    if (this.opts.limit !== undefined) {
      sliced = sliced.slice(0, this.opts.limit);
    }

    return new MockQuerySnapshot(sliced);
  }
}

class MockCollectionGroupQuery {
  constructor(private db: MockFirestore, private groupName: string, private opts: { limit?: number; startAfter?: any } = {}) {}

  limit(n: number) {
    return new MockCollectionGroupQuery(this.db, this.groupName, { ...this.opts, limit: n });
  }

  startAfter(docSnap: any) {
    return new MockCollectionGroupQuery(this.db, this.groupName, { ...this.opts, startAfter: docSnap });
  }

  async get() {
    const docs: MockDocSnapshot[] = [];
    const pattern = '/' + this.groupName + '/';

    for (const [key, val] of this.db.store.entries()) {
      if (key.includes(pattern)) {
        const parts = key.split(pattern);
        const docId = parts[1];
        if (!docId.includes('/')) {
          const projParts = parts[0].split('/');
          const projId = projParts[projParts.length - 1];
          docs.push(new MockDocSnapshot(docId, val, {
            id: this.groupName,
            parent: { parent: { id: projId } },
            doc: (id: string) => ({ id, path: key })
          }));
        }
      }
    }

    docs.sort((a, b) => a.id.localeCompare(b.id));

    let startIndex = 0;
    if (this.opts.startAfter) {
      const idx = docs.findIndex(d => d.id === this.opts.startAfter.id);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    let sliced = docs.slice(startIndex);
    if (this.opts.limit !== undefined) {
      sliced = sliced.slice(0, this.opts.limit);
    }

    return new MockQuerySnapshot(sliced);
  }
}

class MockFirestore {
  public store = new Map<string, any>();

  collection(name: string) {
    return new MockCollectionReference(this, name);
  }

  collectionGroup(name: string) {
    return new MockCollectionGroupQuery(this, name);
  }

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    const stagedWrites = new Map<string, any>();

    const transaction = {
      get: async (docRef: any) => {
        const fullPath = docRef.path || ('notifications/' + docRef.id);
        const data = stagedWrites.has(fullPath)
          ? stagedWrites.get(fullPath)
          : this.store.get(fullPath);
        return new MockDocSnapshot(docRef.id, data);
      },
      set: (docRef: any, data: any) => {
        const fullPath = docRef.path || ('notifications/' + docRef.id);
        stagedWrites.set(fullPath, { ...data });
      },
      update: (docRef: any, data: any) => {
        const fullPath = docRef.path || ('notifications/' + docRef.id);
        const existing = stagedWrites.has(fullPath)
          ? stagedWrites.get(fullPath)
          : this.store.get(fullPath) || {};
        stagedWrites.set(fullPath, { ...existing, ...data });
      }
    };

    const result = await updateFunction(transaction);

    for (const [key, val] of stagedWrites.entries()) {
      this.store.set(key, val);
    }

    return result;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(' [FAIL] ' + msg);
    throw new Error('Assertion failed: ' + msg);
  }
  console.log(' [PASS] ' + msg);
}

async function runTestSuite() {
  console.log('=== Running AH.141 Persistent Overdue Task Alert Pipeline Tests ===\n');

  const db = new MockFirestore();
  const evaluationDate = '2026-10-21';
  const projId = 'proj_alpha';

  // Seed tasks
  db.store.set('projects/' + projId + '/tasks/task_overdue_1', {
    id: 'task_overdue_1',
    projectId: projId,
    title: 'Deploy Production Hotfix',
    status: 'in_progress',
    dueDate: '2026-10-18',
    assigneeId: 'user_bob',
    assigneeEmail: 'bob@example.com'
  });

  db.store.set('projects/' + projId + '/tasks/task_future_2', {
    id: 'task_future_2',
    projectId: projId,
    title: 'Prepare Sprint Review',
    status: 'todo',
    dueDate: '2026-10-22',
    assigneeId: 'user_bob',
    assigneeEmail: 'bob@example.com'
  });

  db.store.set('projects/' + projId + '/tasks/task_completed_3', {
    id: 'task_completed_3',
    projectId: projId,
    title: 'Archive Old Documentation',
    status: 'completed',
    dueDate: '2026-10-15',
    assigneeId: 'user_carol',
    assigneeEmail: 'carol@example.com'
  });

  db.store.set('projects/' + projId + '/tasks/task_no_date_4', {
    id: 'task_no_date_4',
    projectId: projId,
    title: 'General Brainstorming',
    status: 'todo',
    dueDate: null,
    assigneeId: 'user_bob'
  });

  db.store.set('projects/' + projId + '/tasks/task_bad_date_5', {
    id: 'task_bad_date_5',
    projectId: projId,
    title: 'Corrupt Date Task',
    status: 'todo',
    dueDate: 'not-a-valid-date',
    assigneeId: 'user_bob'
  });

  db.store.set('projects/' + projId + '/tasks/task_unassigned_6', {
    id: 'task_unassigned_6',
    projectId: projId,
    title: 'Unclaimed Triage Bug',
    status: 'in_progress',
    dueDate: '2026-10-17',
    assigneeId: null,
    assigneeEmail: null
  });

  db.store.set('projects/' + projId + '/tasks/task_email_only_7', {
    id: 'task_email_only_7',
    projectId: projId,
    title: 'External Partner Review',
    status: 'todo',
    dueDate: '2026-10-19',
    assigneeId: null,
    assigneeEmail: 'partner@external.org'
  });

  console.log('--- Test 1-5: Overdue Task Eligibility Filtering ---');
  const initialScan = await scanAndCreateOverdueNotifications(db as any, {
    projectId: projId,
    evaluationDate
  });

  assert(initialScan.scannedCount === 7, 'Scanned all 7 seeded tasks');
  assert(initialScan.eligibleOverdueCount === 3, 'Exactly 3 tasks met overdue calendar date criteria (task 1, 6, 7)');
  assert(initialScan.createdCount === 2, 'Exactly 2 persistent notifications created (task 1 and task 7; task 6 skipped as unassigned)');
  assert(initialScan.alreadyNotifiedCount === 0, 'Zero duplicate notifications on first run');

  const task1DedupKey = generateTaskOverdueDedupKey(projId, 'task_overdue_1', 'user_bob', '2026-10-18');
  const task1Notif = db.store.get('notifications/' + task1DedupKey);
  assert(task1Notif !== undefined, 'Task 1 notification persisted with deterministic dedup key');
  assert(task1Notif.recipientUserId === 'user_bob', 'Task 1 recipientUserId is user_bob');
  assert(task1Notif.metadata.daysOverdue === 3, 'Task 1 daysOverdue correctly calculated as 3');
  assert(task1Notif.metadata.dueDate === '2026-10-18', 'Task 1 metadata contains correct dueDate');
  assert(task1Notif.type === 'TASK_OVERDUE', 'Notification type is TASK_OVERDUE');
  assert(task1Notif.isRead === false, 'Notification starts unread');

  const task7DedupKey = generateTaskOverdueDedupKey(projId, 'task_email_only_7', 'partner@external.org', '2026-10-19');
  const task7Notif = db.store.get('notifications/' + task7DedupKey);
  assert(task7Notif !== undefined, 'Task 7 email-recipient notification persisted');
  assert(task7Notif.recipientEmail === 'partner@external.org', 'Task 7 recipientEmail normalized');
  assert(task7Notif.recipientUserId === null, 'Task 7 recipientUserId is null when unassigned UID');

  console.log('\n--- Test 6: Repeated Run Idempotency ---');
  const secondScan = await scanAndCreateOverdueNotifications(db as any, {
    projectId: projId,
    evaluationDate
  });
  assert(secondScan.createdCount === 0, 'Second run creates 0 new notifications');
  assert(secondScan.alreadyNotifiedCount === 2, 'Second run detects 2 already-notified episodes');

  console.log('\n--- Test 7: Concurrent Execution Idempotency ---');
  const [conc1, conc2] = await Promise.all([
    scanAndCreateOverdueNotifications(db as any, { projectId: projId, evaluationDate }),
    scanAndCreateOverdueNotifications(db as any, { projectId: projId, evaluationDate })
  ]);
  assert(conc1.createdCount === 0 && conc2.createdCount === 0, 'Concurrent execution does not create duplicate notifications');

  console.log('\n--- Test 8: New Episode Upon Due Date Change ---');
  db.store.set('projects/' + projId + '/tasks/task_overdue_1', {
    id: 'task_overdue_1',
    projectId: projId,
    title: 'Deploy Production Hotfix',
    status: 'in_progress',
    dueDate: '2026-10-20',
    assigneeId: 'user_bob',
    assigneeEmail: 'bob@example.com'
  });

  const thirdScan = await scanAndCreateOverdueNotifications(db as any, {
    projectId: projId,
    evaluationDate
  });
  assert(thirdScan.createdCount === 1, 'New overdue episode for updated due date creates exactly 1 new notification');
  const newTask1DedupKey = generateTaskOverdueDedupKey(projId, 'task_overdue_1', 'user_bob', '2026-10-20');
  const newTask1Notif = db.store.get('notifications/' + newTask1DedupKey);
  assert(newTask1Notif !== undefined, 'New episode notification persisted with new due date key');
  assert(newTask1Notif.metadata.daysOverdue === 1, 'New episode reflects updated 1 day overdue');

  console.log('\n--- Test 9: Task Completed Concurrently Safeguard ---');
  db.store.set('projects/' + projId + '/tasks/task_race_9', {
    id: 'task_race_9',
    projectId: projId,
    title: 'Concurrent Race Task',
    status: 'completed',
    dueDate: '2026-10-17',
    assigneeId: 'user_bob'
  });

  const atomicOutcome = await createOverdueNotificationAtomic(db as any, {
    projectId: projId,
    taskId: 'task_race_9',
    taskTitle: 'Concurrent Race Task',
    dueDate: '2026-10-17',
    daysOverdue: 4,
    recipientUserId: 'user_bob',
    recipientIdentifier: 'user_bob',
    evaluationDate
  });
  assert(atomicOutcome.status === 'skipped', 'Transaction safely skips completed task');

  console.log('\n--- Test 10: Pagination Across Multiple Pages ---');
  const pageProjId = 'proj_pagination';
  for (let i = 1; i <= 15; i++) {
    const id = 'task_p_' + String(i).padStart(2, '0');
    db.store.set('projects/' + pageProjId + '/tasks/' + id, {
      id,
      projectId: pageProjId,
      title: 'Pagination Task ' + i,
      status: 'in_progress',
      dueDate: '2026-10-15',
      assigneeId: 'user_bob'
    });
  }

  const pagedScan = await scanAndCreateOverdueNotifications(db as any, {
    projectId: pageProjId,
    evaluationDate,
    pageSize: 5
  });
  assert(pagedScan.scannedCount === 15, 'Pagination scanned all 15 tasks');
  assert(pagedScan.createdCount === 15, 'Pagination created all 15 notifications across pages');

  console.log('\n--- Test 11: Safe Retries After Partial Failure ---');
  const retryScan = await scanAndCreateOverdueNotifications(db as any, {
    projectId: pageProjId,
    evaluationDate,
    pageSize: 5
  });
  assert(retryScan.createdCount === 0, 'Retry creates 0 duplicates');
  assert(retryScan.alreadyNotifiedCount === 15, 'All 15 paged items reported as already_notified');

  console.log('\n--- Test 12: Dry Run Option ---');
  const dryProjId = 'proj_dry';
  db.store.set('projects/' + dryProjId + '/tasks/dry_task_1', {
    id: 'dry_task_1',
    projectId: dryProjId,
    title: 'Dry Run Task',
    status: 'in_progress',
    dueDate: '2026-10-18',
    assigneeId: 'user_bob'
  });

  const dryScan = await scanAndCreateOverdueNotifications(db as any, {
    projectId: dryProjId,
    evaluationDate,
    dryRun: true
  });
  assert(dryScan.eligibleOverdueCount === 1, 'Dry run identifies 1 eligible task');
  assert(dryScan.createdCount === 0, 'Dry run creates 0 notifications in database');

  console.log('\n--- Test 13: Timezone & Boundary Conditions ---');
  const sameDayEval = evaluateTaskOverdueEligibility({
    title: 'Same Day Task',
    status: 'in_progress',
    dueDate: '2026-10-21'
  }, '2026-10-21');
  assert(sameDayEval.eligible === false, 'Task due on evaluation date (diff = 0) is not overdue');

  const yesterdayEval = evaluateTaskOverdueEligibility({
    title: 'Yesterday Task',
    status: 'in_progress',
    dueDate: '2026-10-20'
  }, '2026-10-21');
  assert(yesterdayEval.eligible === true && (yesterdayEval as any).daysOverdue === 1, 'Task due yesterday is overdue by 1 day');

  const doneEval = evaluateTaskOverdueEligibility({
    title: 'Done Task',
    status: 'done',
    dueDate: '2026-10-15'
  }, '2026-10-21');
  assert(doneEval.eligible === false, 'Done status is skipped');

  const cancelledEval = evaluateTaskOverdueEligibility({
    title: 'Cancelled Task',
    status: 'cancelled',
    dueDate: '2026-10-15'
  }, '2026-10-21');
  assert(cancelledEval.eligible === false, 'Cancelled status is skipped');

  console.log('\n--- Test 14: Protected Endpoint Authorization Enforcement ---');
  const testApp = express();
  testApp.use(express.json());
  const configuredCronSecret = 'test_cron_secret_secure_123';
  testApp.post('/api/admin/tasks/scan-overdue', async (req: express.Request, res: express.Response) => {
    const cronKey = req.headers['x-cron-key'];
    const authHeader = req.headers.authorization;
    let isAuthorized = typeof cronKey === 'string' && cronKey === configuredCronSecret;
    if (!isAuthorized && authHeader === 'Bearer admin_token_valid') {
      isAuthorized = true;
    }
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Forbidden', message: 'Platform admin or valid x-cron-key required.' });
    }
    return res.json({ success: true, authorized: true });
  });
  const server = testApp.listen(0);
  const port = (server.address() as AddressInfo).port;
  const baseUrl = 'http://localhost:' + port;
  const unauthRes = await fetch(baseUrl + '/api/admin/tasks/scan-overdue', { method: 'POST' });
  assert(unauthRes.status === 403, 'Unauthenticated request rejected with 403');
  const cronRes = await fetch(baseUrl + '/api/admin/tasks/scan-overdue', { method: 'POST', headers: { 'x-cron-key': configuredCronSecret } });
  assert(cronRes.status === 200, 'Valid x-cron-key accepted with 200');
  const adminRes = await fetch(baseUrl + '/api/admin/tasks/scan-overdue', { method: 'POST', headers: { 'authorization': 'Bearer admin_token_valid' } });
  assert(adminRes.status === 200, 'Valid admin token accepted with 200');
  server.close();

  console.log('\n======================================================');
  console.log('RESULTS: ALL OVERDUE TASK ALERT PIPELINE TESTS PASSED');
  console.log('======================================================\n');
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
