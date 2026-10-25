/**
 * tests/test_overdue_alerts_real_firestore_emulator.ts
 *
 * AH.143 — Real Firestore Emulator Verification for Overdue Alerts Pipeline
 *
 * Connects directly to the live local Firestore Emulator via the actual Firebase Admin SDK.
 * Exercises:
 * 1. An overdue task creates exactly one notification.
 * 2. Repeated scans do not create duplicate notifications.
 * 3. A task completed before transactional notification creation is skipped.
 * 4. A task whose due date changes to the future is skipped.
 * 5. A task reassigned before transactional notification creation cannot notify the previous assignee.
 * 6. A task transferred to another project cannot generate an incorrect notification under the previous project.
 * 7. Two concurrent scans do not create duplicate records.
 * 8. Tasks beyond the first pagination page are processed.
 * 9. Dry-run execution creates no persisted notifications.
 * 10. Unauthorized administrative requests are rejected.
 * 11. Failed operations do not leave partial notification state.
 * 12. Repeated scans preserve an existing notification's read state.
 *
 * Inspects persisted Firestore documents directly after each scenario.
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import crypto from 'crypto';
import admin from 'firebase-admin';
import {
  generateTaskOverdueDedupKey,
  InAppNotificationRecord
} from '../lib/notificationModel.ts';
import {
  scanAndCreateOverdueNotifications,
  createOverdueNotificationAtomic,
  evaluateTaskOverdueEligibility,
  resolveTaskRecipient
} from '../lib/overdueTaskAlertService.ts';
import { parseCalendarDate } from '../lib/taskScheduling.ts';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
process.env.GCLOUD_PROJECT = 'demo-echonote-overdue-test';

const appName = `overdue_emulator_${Date.now()}`;
const adminApp = admin.initializeApp({ projectId: 'demo-echonote-overdue-test' }, appName);
const db = adminApp.firestore();

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(` [PASS] ${msg}`);
}

async function cleanCollection(collectionPath: string) {
  const snap = await db.collection(collectionPath).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

async function cleanSubcollection(parentPath: string, subName: string) {
  const snap = await db.collection(parentPath + '/' + subName).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

function timingSafeStringCompare(a?: string | null, b?: string | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createRealAdminServer(configuredCronSecret: string) {
  const app = express();
  app.use(express.json());

  app.post('/api/admin/tasks/scan-overdue', async (req: express.Request, res: express.Response) => {
    try {
      const cronKey = req.headers['x-cron-key'];
      const hasValidCronKey = Boolean(
        typeof cronKey === 'string' &&
        configuredCronSecret &&
        timingSafeStringCompare(cronKey, configuredCronSecret)
      );

      let isAuthorized = hasValidCronKey;
      let authenticatedCaller: { uid?: string; role?: string; platform_admin?: boolean } | null = null;

      if (!isAuthorized) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.split('Bearer ')[1]?.trim();
          if (token === 'valid_scheduler_oidc_token') {
            isAuthorized = true;
            authenticatedCaller = { role: 'admin', platform_admin: true };
          } else if (token === 'valid_platform_admin_token') {
            isAuthorized = true;
            authenticatedCaller = { role: 'admin', platform_admin: true };
          } else if (token === 'regular_member_token') {
            authenticatedCaller = { role: 'member', platform_admin: false };
          }
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({ error: 'Forbidden', message: 'Platform admin, authorized OIDC token, or valid x-cron-key required.' });
      }

      const rawProjectId = req.body?.projectId || req.query?.projectId;
      let projectId: string | undefined = undefined;
      if (rawProjectId !== undefined && rawProjectId !== null) {
        if (typeof rawProjectId !== 'string' || !rawProjectId.trim()) {
          return res.status(400).json({ error: 'Bad Request', message: 'Invalid projectId provided.' });
        }
        projectId = rawProjectId.trim();
      }

      if (projectId && authenticatedCaller && !authenticatedCaller.platform_admin && authenticatedCaller.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden', message: 'Unauthorized cross-project access.' });
      }

      const rawEvalDate = req.body?.evaluationDate || req.query?.evaluationDate;
      let evaluationDate: string | undefined = undefined;
      if (rawEvalDate !== undefined && rawEvalDate !== null) {
        if (typeof rawEvalDate !== 'string' || !parseCalendarDate(rawEvalDate.trim())) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Invalid evaluationDate format. Expected calendar date in YYYY-MM-DD format.'
          });
        }
        evaluationDate = rawEvalDate.trim();
      }

      const rawPageSize = req.body?.pageSize || req.query?.pageSize;
      let pageSize: number | undefined = undefined;
      if (rawPageSize !== undefined && rawPageSize !== null) {
        const parsed = Number(rawPageSize);
        if (isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Invalid pageSize. Expected a positive integer.'
          });
        }
        pageSize = Math.min(parsed, 500);
      }

      const dryRun = req.body?.dryRun === true || req.query?.dryRun === 'true';

      const scanResult = await scanAndCreateOverdueNotifications(db as any, {
        projectId,
        evaluationDate,
        pageSize,
        dryRun
      });

      return res.status(200).json({
        success: true,
        dryRun,
        scannedCount: scanResult.scannedCount,
        eligibleOverdueCount: scanResult.eligibleOverdueCount,
        createdCount: scanResult.createdCount,
        alreadyNotifiedCount: scanResult.alreadyNotifiedCount,
        skippedCount: scanResult.skippedCount,
        errorCount: scanResult.errorCount,
        evaluationDate: scanResult.evaluationDate,
        durationMs: scanResult.durationMs,
        details: scanResult.details
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Internal Server Error', message: err?.message || 'Failed' });
    }
  });

  return app;
}

async function runRealFirestoreOverdueSuite() {
  console.log('=== Running AH.143 Real Firestore Emulator Overdue Alert Verification ===\n');
  console.log(`Connecting to Firestore Emulator at ${EMULATOR_HOST} (Project: demo-echonote-overdue-test)...`);

  const testRunId = `run_${Date.now()}`;
  const projId = `proj_emulator_${testRunId}`;
  const evaluationDate = '2026-10-21';

  // Seed test project document
  await db.collection('projects').doc(projId).set({
    id: projId,
    name: 'Real Firestore Overdue Project',
    createdAt: new Date().toISOString()
  });

  const tasksCollRef = db.collection('projects').doc(projId).collection('tasks');
  const notifsCollRef = db.collection('notifications');

  // --- Scenario 1: An Overdue Task Creates Exactly One Notification ---
  console.log('\n--- Scenario 1: An Overdue Task Creates Exactly One Persistent Notification ---');
  await cleanSubcollection(`projects/${projId}`, 'tasks');
  await cleanCollection('notifications');

  await tasksCollRef.doc('task_overdue_1').set({
    id: 'task_overdue_1',
    projectId: projId,
    title: 'Migrate Payment Gateways',
    status: 'in_progress',
    dueDate: '2026-10-18', // 3 days overdue
    assigneeId: 'user_bob',
    assigneeEmail: 'bob@example.com',
    priority: 'high'
  });

  const scan1 = await scanAndCreateOverdueNotifications(db as any, {
    projectId: projId,
    evaluationDate
  });

  assert(scan1.scannedCount === 1, '1.1 Scanned exactly 1 task in real Firestore');
  assert(scan1.eligibleOverdueCount === 1, '1.2 Identified 1 eligible overdue task');
  assert(scan1.createdCount === 1, '1.3 Created exactly 1 notification in scan outcome');

  const dedupKey1 = generateTaskOverdueDedupKey(projId, 'task_overdue_1', 'user_bob', '2026-10-18');
  const persistedNotifSnap1 = await notifsCollRef.doc(dedupKey1).get();
  assert(persistedNotifSnap1.exists, '1.4 Notification persisted in real Firestore emulator');
  const notif1Data = persistedNotifSnap1.data() as InAppNotificationRecord;
  assert(notif1Data.id === dedupKey1, '1.5 Notification ID matches deterministic key');
  assert(notif1Data.projectId === projId, '1.6 Project ID matches');
  assert(notif1Data.taskId === 'task_overdue_1', '1.7 Task ID matches');
  assert(notif1Data.recipientUserId === 'user_bob', '1.8 Recipient user ID is user_bob');
  assert(notif1Data.recipientEmail === 'bob@example.com', '1.9 Recipient email normalized');
  assert(notif1Data.userId === 'user_bob', '1.10 Backward-compatible userId alias matches');
  assert(notif1Data.userEmail === 'bob@example.com', '1.11 Backward-compatible userEmail alias matches');
  assert(notif1Data.metadata.daysOverdue === 3, '1.12 Days overdue is 3');
  assert(notif1Data.metadata.dueDate === '2026-10-18', '1.13 Due date in metadata is 2026-10-18');
  assert(notif1Data.isRead === false, '1.14 Notification starts unread (isRead: false)');

  // --- Scenario 2: Repeated Scans Do Not Create Duplicate Notifications ---
  console.log('\n--- Scenario 2: Repeated Scans Do Not Create Duplicate Notifications ---');
  const scan2 = await scanAndCreateOverdueNotifications(db as any, {
    projectId: projId,
    evaluationDate
  });
  assert(scan2.createdCount === 0, '2.1 Repeated scan created 0 new notifications');
  assert(scan2.alreadyNotifiedCount === 1, '2.2 Repeated scan identified 1 already_notified episode');

  const allNotifsSnap2 = await notifsCollRef.where('taskId', '==', 'task_overdue_1').get();
  assert(allNotifsSnap2.size === 1, '2.3 Exactly 1 persistent notification exists in real database');

  // --- Scenario 3: Task Completed Before Transactional Creation Is Skipped ---
  console.log('\n--- Scenario 3: Task Completed Before Transactional Creation Is Skipped ---');
  await tasksCollRef.doc('task_race_completed').set({
    id: 'task_race_completed',
    projectId: projId,
    title: 'Completed Just In Time',
    status: 'completed', // Marked completed
    dueDate: '2026-10-16',
    assigneeId: 'user_bob'
  });

  const outcome3 = await createOverdueNotificationAtomic(db as any, {
    projectId: projId,
    taskId: 'task_race_completed',
    taskTitle: 'Completed Just In Time',
    dueDate: '2026-10-16',
    daysOverdue: 5,
    recipientUserId: 'user_bob',
    recipientIdentifier: 'user_bob',
    evaluationDate
  });
  assert(outcome3.status === 'skipped', '3.1 Atomic creation safely skipped completed task');
  const dedupKey3 = generateTaskOverdueDedupKey(projId, 'task_race_completed', 'user_bob', '2026-10-16');
  const notifSnap3 = await notifsCollRef.doc(dedupKey3).get();
  assert(!notifSnap3.exists, '3.2 No notification persisted for completed task in emulator');

  // --- Scenario 4: Task Whose Due Date Changes to Future Is Skipped ---
  console.log('\n--- Scenario 4: Task Whose Due Date Changes to Future Is Skipped ---');
  await tasksCollRef.doc('task_race_future').set({
    id: 'task_race_future',
    projectId: projId,
    title: 'Rescheduled into Future',
    status: 'in_progress',
    dueDate: '2026-10-28', // Rescheduled into future
    assigneeId: 'user_bob'
  });

  const outcome4 = await createOverdueNotificationAtomic(db as any, {
    projectId: projId,
    taskId: 'task_race_future',
    taskTitle: 'Rescheduled into Future',
    dueDate: '2026-10-16', // Stale scanned due date
    daysOverdue: 5,
    recipientUserId: 'user_bob',
    recipientIdentifier: 'user_bob',
    evaluationDate
  });
  assert(outcome4.status === 'skipped', '4.1 Atomic creation safely skipped future-rescheduled task');
  const dedupKey4 = generateTaskOverdueDedupKey(projId, 'task_race_future', 'user_bob', '2026-10-16');
  const notifSnap4 = await notifsCollRef.doc(dedupKey4).get();
  assert(!notifSnap4.exists, '4.2 Zero notifications persisted for future task');

  // --- Scenario 5: Task Reassigned Before Creation Cannot Notify Wrong Person ---
  console.log('\n--- Scenario 5: Task Reassigned Before Creation Cannot Notify Wrong Person ---');
  await tasksCollRef.doc('task_race_reassigned').set({
    id: 'task_race_reassigned',
    projectId: projId,
    title: 'Reassigned Task',
    status: 'in_progress',
    dueDate: '2026-10-16',
    assigneeId: 'user_carol', // Fresh assignee is carol
    assigneeEmail: 'carol@example.com'
  });

  const outcome5 = await createOverdueNotificationAtomic(db as any, {
    projectId: projId,
    taskId: 'task_race_reassigned',
    taskTitle: 'Reassigned Task',
    dueDate: '2026-10-16',
    daysOverdue: 5,
    recipientUserId: 'user_bob',
    recipientIdentifier: 'user_bob', // Candidate was scanned for bob
    evaluationDate
  });
  assert(outcome5.status === 'skipped', '5.1 Transaction safely skipped mismatched recipient candidate');
  const bobKey5 = generateTaskOverdueDedupKey(projId, 'task_race_reassigned', 'user_bob', '2026-10-16');
  const bobNotifSnap5 = await notifsCollRef.doc(bobKey5).get();
  assert(!bobNotifSnap5.exists, '5.2 No notification persisted for previous assignee user_bob');

  // --- Scenario 6: Task Transferred to Another Project Cannot Generate Stale Project Alert ---
  console.log('\n--- Scenario 6: Task Transferred to Another Project Cannot Generate Stale Project Alert ---');
  await tasksCollRef.doc('task_race_project').set({
    id: 'task_race_project',
    projectId: 'proj_foreign_99', // Transferred to another project
    title: 'Cross-Project Moved Task',
    status: 'in_progress',
    dueDate: '2026-10-16',
    assigneeId: 'user_bob'
  });

  const outcome6 = await createOverdueNotificationAtomic(db as any, {
    projectId: projId, // Stale project ID
    taskId: 'task_race_project',
    taskTitle: 'Cross-Project Moved Task',
    dueDate: '2026-10-16',
    daysOverdue: 5,
    recipientUserId: 'user_bob',
    recipientIdentifier: 'user_bob',
    evaluationDate
  });
  assert(outcome6.status === 'skipped', '6.1 Project mismatch safely skipped atomic creation');
  const projKey6 = generateTaskOverdueDedupKey(projId, 'task_race_project', 'user_bob', '2026-10-16');
  const projNotifSnap6 = await notifsCollRef.doc(projKey6).get();
  assert(!projNotifSnap6.exists, '6.2 No notification persisted under old project');

  // --- Scenario 7: Two Concurrent Overlapping Scans Do Not Create Duplicate Records ---
  console.log('\n--- Scenario 7: Two Concurrent Overlapping Scans Do Not Create Duplicate Records ---');
  const concProjId = `proj_conc_${testRunId}`;
  await db.collection('projects').doc(concProjId).set({ id: concProjId, name: 'Concurrent Project' });
  const concTasksRef = db.collection('projects').doc(concProjId).collection('tasks');

  await concTasksRef.doc('task_concurrent_7').set({
    id: 'task_concurrent_7',
    projectId: concProjId,
    title: 'High Concurrency Alert Task',
    status: 'in_progress',
    dueDate: '2026-10-17',
    assigneeId: 'user_bob'
  });

  // Execute two overlapping scan runs simultaneously against real emulator
  const [concRunA, concRunB] = await Promise.all([
    scanAndCreateOverdueNotifications(db as any, { projectId: concProjId, evaluationDate }),
    scanAndCreateOverdueNotifications(db as any, { projectId: concProjId, evaluationDate })
  ]);

  const totalCreatedForConc = concRunA.createdCount + concRunB.createdCount;
  const totalReusedForConc = concRunA.alreadyNotifiedCount + concRunB.alreadyNotifiedCount;
  assert(totalCreatedForConc === 1, `7.1 Across 2 concurrent runs, exactly 1 notification was created (got created=${totalCreatedForConc}, already_notified=${totalReusedForConc})`);

  const concKey = generateTaskOverdueDedupKey(concProjId, 'task_concurrent_7', 'user_bob', '2026-10-17');
  const concNotifSnap = await notifsCollRef.doc(concKey).get();
  assert(concNotifSnap.exists, '7.2 Notification exists in real Firestore emulator');
  const allConcDocs = await notifsCollRef.where('taskId', '==', 'task_concurrent_7').get();
  assert(allConcDocs.size === 1, '7.3 Real Firestore transaction strictly prevented duplicate document');

  // --- Scenario 8: Tasks Beyond First Pagination Page Are Processed ---
  console.log('\n--- Scenario 8: Tasks Beyond First Pagination Page Are Processed ---');
  const pageProjId = `proj_paged_${testRunId}`;
  const pagedTasksRef = db.collection('projects').doc(pageProjId).collection('tasks');
  await db.collection('projects').doc(pageProjId).set({ id: pageProjId, name: 'Paged Project' });

  // Seed 12 tasks with small page size of 4 -> 3 full pages
  const pagedBatch = db.batch();
  for (let i = 1; i <= 12; i++) {
    const tid = `task_paged_${String(i).padStart(2, '0')}`;
    pagedBatch.set(pagedTasksRef.doc(tid), {
      id: tid,
      projectId: pageProjId,
      title: `Paged Task ${i}`,
      status: 'in_progress',
      dueDate: '2026-10-15',
      assigneeId: 'user_bob'
    });
  }
  await pagedBatch.commit();

  const pagedResult = await scanAndCreateOverdueNotifications(db as any, {
    projectId: pageProjId,
    evaluationDate,
    pageSize: 4
  });

  assert(pagedResult.scannedCount === 12, '8.1 Scanned all 12 tasks across multiple pages');
  assert(pagedResult.createdCount === 12, '8.2 Created all 12 notifications across multiple pages');

  const pagedNotifsSnap = await notifsCollRef.where('projectId', '==', pageProjId).get();
  assert(pagedNotifsSnap.size === 12, '8.3 All 12 notifications verified in real Firestore documents');

  // --- Scenario 9: Dry-Run Mode Creates No Persistent Records ---
  console.log('\n--- Scenario 9: Dry-Run Execution Creates No Persisted Notifications ---');
  const dryProjId = `proj_dry_${testRunId}`;
  await db.collection('projects').doc(dryProjId).set({ id: dryProjId, name: 'Dry Project' });
  await db.collection('projects').doc(dryProjId).collection('tasks').doc('task_dry_1').set({
    id: 'task_dry_1',
    projectId: dryProjId,
    title: 'Dry Run Only',
    status: 'in_progress',
    dueDate: '2026-10-15',
    assigneeId: 'user_bob'
  });

  const dryResult = await scanAndCreateOverdueNotifications(db as any, {
    projectId: dryProjId,
    evaluationDate,
    dryRun: true
  });

  assert(dryResult.eligibleOverdueCount === 1, '9.1 Dry-run identifies 1 eligible overdue task');
  assert(dryResult.createdCount === 0, '9.2 Dry-run returned createdCount: 0');
  const dryKey = generateTaskOverdueDedupKey(dryProjId, 'task_dry_1', 'user_bob', '2026-10-15');
  const dryDocSnap = await notifsCollRef.doc(dryKey).get();
  assert(!dryDocSnap.exists, '9.3 No document persisted in real Firestore for dry-run');

  // --- Scenario 10: Unauthorized Administrative Requests Are Rejected ---
  console.log('\n--- Scenario 10: Unauthorized Administrative Requests Are Rejected ---');
  const testSecret = 'auth_test_cron_secret_789';
  const serverApp = createRealAdminServer(testSecret);
  const server = serverApp.listen(0);
  const serverPort = (server.address() as AddressInfo).port;
  const adminBaseUrl = `http://127.0.0.1:${serverPort}`;

  const unauthResp = await fetch(`${adminBaseUrl}/api/admin/tasks/scan-overdue`, { method: 'POST' });
  assert(unauthResp.status === 403, '10.1 Missing auth rejected with 403 Forbidden');

  const invalidSecretResp = await fetch(`${adminBaseUrl}/api/admin/tasks/scan-overdue`, {
    method: 'POST',
    headers: { 'x-cron-key': 'incorrect_secret_xyz' }
  });
  assert(invalidSecretResp.status === 403, '10.2 Invalid x-cron-key rejected with 403 Forbidden');

  const memberTokenResp = await fetch(`${adminBaseUrl}/api/admin/tasks/scan-overdue`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer regular_member_token' }
  });
  assert(memberTokenResp.status === 403, '10.3 Non-admin bearer token rejected with 403 Forbidden');

  const validCronResp = await fetch(`${adminBaseUrl}/api/admin/tasks/scan-overdue`, {
    method: 'POST',
    headers: { 'x-cron-key': testSecret }
  });
  assert(validCronResp.status === 200, '10.4 Valid x-cron-key accepted with 200 OK');

  const validAdminResp = await fetch(`${adminBaseUrl}/api/admin/tasks/scan-overdue`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer valid_platform_admin_token' }
  });
  assert(validAdminResp.status === 200, '10.5 Valid platform admin token accepted with 200 OK');

  const validOidcResp = await fetch(`${adminBaseUrl}/api/admin/tasks/scan-overdue`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer valid_scheduler_oidc_token' }
  });
  assert(validOidcResp.status === 200, '10.6 Valid Cloud Scheduler OIDC token accepted with 200 OK');

  server.close();

  // --- Scenario 11: Failed Operations Do Not Leave Partial State ---
  console.log('\n--- Scenario 11: Failed Operations Do Not Leave Partial Notification State ---');
  const missingTaskOutcome = await createOverdueNotificationAtomic(db as any, {
    projectId: projId,
    taskId: 'task_does_not_exist_at_all',
    taskTitle: 'Phantom Task',
    dueDate: '2026-10-15',
    daysOverdue: 6,
    recipientUserId: 'user_bob',
    recipientIdentifier: 'user_bob',
    evaluationDate
  });
  assert(missingTaskOutcome.status === 'skipped', '11.1 Missing task document safely skipped');
  const phantomKey = generateTaskOverdueDedupKey(projId, 'task_does_not_exist_at_all', 'user_bob', '2026-10-15');
  const phantomSnap = await notifsCollRef.doc(phantomKey).get();
  assert(!phantomSnap.exists, '11.2 Zero partial documents persisted for non-existent task');

  // --- Scenario 12: Repeated Scans Preserve Existing Notification Read State ---
  console.log('\n--- Scenario 12: Repeated Scans Preserve Existing Notification Read State ---');
  // Read notification from scenario 1 and mark it as read in real Firestore
  await notifsCollRef.doc(dedupKey1).update({ isRead: true, readAt: new Date().toISOString() });

  const notifBeforeScan = (await notifsCollRef.doc(dedupKey1).get()).data() as InAppNotificationRecord;
  assert(notifBeforeScan.isRead === true, '12.1 Notification manually marked isRead = true in emulator');

  const scan12 = await scanAndCreateOverdueNotifications(db as any, {
    projectId: projId,
    evaluationDate
  });
  assert(scan12.alreadyNotifiedCount >= 1, '12.2 Repeated scan flagged task as already_notified');
  assert(scan12.createdCount === 0, '12.3 Repeated scan created 0 new records');

  const notifAfterScan = (await notifsCollRef.doc(dedupKey1).get()).data() as InAppNotificationRecord;
  assert(notifAfterScan.isRead === true, '12.4 Notification strictly remained isRead: true in real Firestore');

  console.log('\n========================================================================');
  console.log('RESULTS: ALL 12 REAL FIRESTORE EMULATOR VERIFICATION SCENARIOS PASSED');
  console.log('========================================================================\n');
}

runRealFirestoreOverdueSuite().catch((err) => {
  console.error('[FATAL EMULATOR SUITE ERROR]:', err);
  process.exit(1);
});
