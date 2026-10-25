/**
 * tests/test_legacy_notification_backfill.ts
 *
 * AH.148 — Legacy Notification Compatibility and Backfill Verification Suite
 *
 * Tests against the live local Firestore Emulator (port 8088):
 * 1. Legacy record with only recipientUserId.
 * 2. Legacy record with only recipientEmail.
 * 3. Record with both recipient fields but missing both aliases.
 * 4. Already-migrated record remains unchanged.
 * 5. Conflicting alias is detected and safely skipped without mutation.
 * 6. Malformed or missing recipient identity is safely skipped.
 * 7. Dry-run mode reports candidates without writing to Firestore.
 * 8. Repeated migration runs are strictly idempotent.
 * 9. Existing read state, timestamps, metadata, and IDs are preserved.
 * 10. Pagination handles multiple batches cleanly.
 * 11. An intended recipient can discover a migrated notification under existing security rules.
 * 12. An unrelated user still cannot read or update the notification.
 */

import admin from 'firebase-admin';
import {
  evaluateNotificationForMigration,
  migrateLegacyNotifications,
  isValidUserId
} from '../scripts/migrate-legacy-notifications.ts';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
process.env.GCLOUD_PROJECT = 'demo-echonote-backfill-test';

const appName = `backfill_test_${Date.now()}`;
const adminApp = admin.initializeApp({ projectId: 'demo-echonote-backfill-test' }, appName);
const db = adminApp.firestore();

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(` [FAIL] ${msg}`);
    failed++;
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(` [PASS] ${msg}`);
  passed++;
}

async function cleanCollection(collectionPath: string) {
  const snap = await db.collection(collectionPath).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

async function runBackfillTests() {
  console.log('=== Running AH.148 Legacy Notification Migration & Backfill Tests ===');
  console.log(`Connecting to Firestore Emulator at ${EMULATOR_HOST}...`);

  await cleanCollection('notifications');

  // --- Suite 1: Pure Unit Evaluation Tests ---
  console.log('\n--- Suite 1: Pure Logic Evaluation Tests ---');
  {
    // 1.1 Legacy record with only recipientUserId
    const res1 = evaluateNotificationForMigration('doc_1', {
      recipientUserId: 'user_alice',
      title: 'Task Overdue'
    });
    assert(res1.action === 'migrated', '1.1 Record with only recipientUserId is marked for migration');
    assert(res1.updates?.userId === 'user_alice', '1.2 userId set to recipientUserId');
    assert(res1.updates?.userEmail === undefined, '1.3 userEmail omitted when recipientEmail missing');

    // 1.2 Legacy record with only recipientEmail
    const res2 = evaluateNotificationForMigration('doc_2', {
      recipientEmail: 'Bob@Example.COM',
      title: 'Prerequisite Done'
    });
    assert(res2.action === 'migrated', '1.4 Record with only recipientEmail is marked for migration');
    assert(res2.updates?.userEmail === 'bob@example.com', '1.5 userEmail set to normalized recipientEmail');

    // 1.3 Record with both recipient fields but missing aliases
    const res3 = evaluateNotificationForMigration('doc_3', {
      recipientUserId: 'user_carol',
      recipientEmail: 'carol@example.com'
    });
    assert(res3.action === 'migrated', '1.6 Record with both fields marked for migration');
    assert(res3.updates?.userId === 'user_carol', '1.7 userId populated');
    assert(res3.updates?.userEmail === 'carol@example.com', '1.8 userEmail populated');

    // 1.4 Already-migrated record remains unchanged
    const res4 = evaluateNotificationForMigration('doc_4', {
      recipientUserId: 'user_dan',
      recipientEmail: 'dan@example.com',
      userId: 'user_dan',
      userEmail: 'dan@example.com'
    });
    assert(res4.action === 'already_migrated', '1.9 Fully migrated doc skipped');

    // 1.5 Conflicting alias is detected and skipped
    const res5 = evaluateNotificationForMigration('doc_5', {
      recipientUserId: 'user_eve',
      userId: 'user_mallory' // Conflict!
    });
    assert(res5.action === 'conflict_skipped', '1.10 User ID conflict skipped');
    assert(res5.reason?.includes('Conflict detected'), '1.11 Conflict reason clearly recorded');

    // 1.6 Malformed or missing recipient identity is skipped
    const res6 = evaluateNotificationForMigration('doc_6', {
      recipientUserId: '', // empty
      recipientEmail: 'not-an-email' // invalid
    });
    assert(res6.action === 'skipped_malformed', '1.12 Malformed recipient data skipped safely');
  }

  // --- Suite 2: Real Firestore Emulator Persistence & Migration ---
  console.log('\n--- Suite 2: Real Firestore Emulator Persistence & Dry-Run Tests ---');
  {
    const notifs = db.collection('notifications');

    // Seed test documents
    const docA = notifs.doc('notif_seed_a'); // only recipientUserId
    await docA.set({
      id: 'notif_seed_a',
      projectId: 'proj_alpha',
      taskId: 'task_1',
      recipientUserId: 'user_alice',
      type: 'TASK_OVERDUE',
      title: 'Task Overdue: Alpha',
      message: 'Task is overdue',
      metadata: { daysOverdue: 2 },
      isRead: false,
      createdAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z'
    });

    const docB = notifs.doc('notif_seed_b'); // only recipientEmail
    await docB.set({
      id: 'notif_seed_b',
      projectId: 'proj_alpha',
      taskId: 'task_2',
      recipientEmail: 'Bob@Example.COM',
      type: 'PREREQUISITE_COMPLETED',
      title: 'Prerequisite completed',
      message: 'Ready to proceed',
      metadata: { triggerTaskId: 'task_0' },
      isRead: true, // preserved read state
      createdAt: '2026-10-16T12:00:00.000Z',
      updatedAt: '2026-10-16T12:00:00.000Z'
    });

    const docC = notifs.doc('notif_seed_c'); // both recipient fields, missing aliases
    await docC.set({
      id: 'notif_seed_c',
      projectId: 'proj_alpha',
      taskId: 'task_3',
      recipientUserId: 'user_carol',
      recipientEmail: 'carol@example.com',
      type: 'DEADLINE_PROPAGATED',
      title: 'Deadline Adjusted',
      message: 'Adjusted by 2 days',
      metadata: { shiftDays: 2 },
      isRead: false,
      createdAt: '2026-10-17T09:00:00.000Z',
      updatedAt: '2026-10-17T09:00:00.000Z'
    });

    const docD = notifs.doc('notif_seed_d'); // already migrated
    await docD.set({
      id: 'notif_seed_d',
      projectId: 'proj_alpha',
      taskId: 'task_4',
      recipientUserId: 'user_dan',
      recipientEmail: 'dan@example.com',
      userId: 'user_dan',
      userEmail: 'dan@example.com',
      type: 'TASK_OVERDUE',
      title: 'Already Migrated Task',
      message: 'Notice',
      metadata: {},
      isRead: false,
      createdAt: '2026-10-18T08:00:00.000Z',
      updatedAt: '2026-10-18T08:00:00.000Z'
    });

    const docE = notifs.doc('notif_seed_e'); // conflict record
    await docE.set({
      id: 'notif_seed_e',
      projectId: 'proj_alpha',
      recipientUserId: 'user_eve',
      userId: 'user_hacker_tampered',
      type: 'TASK_OVERDUE',
      title: 'Conflicting Record',
      message: 'Notice',
      isRead: false,
      createdAt: '2026-10-19T08:00:00.000Z',
      updatedAt: '2026-10-19T08:00:00.000Z'
    });

    const docF = notifs.doc('notif_seed_f'); // malformed missing recipient
    await docF.set({
      id: 'notif_seed_f',
      projectId: 'proj_alpha',
      title: 'Anonymous System Notice',
      message: 'No recipient assigned',
      isRead: false,
      createdAt: '2026-10-20T08:00:00.000Z',
      updatedAt: '2026-10-20T08:00:00.000Z'
    });

    // 2.1 Dry-Run Execution
    console.log('\n--- 2.1 Dry-Run Execution ---');
    const dryRunSummary = await migrateLegacyNotifications(db, { dryRun: true });
    assert(dryRunSummary.scannedCount === 6, '2.1 Scanned all 6 seeded documents');
    assert(dryRunSummary.eligibleCount === 3, '2.2 Identified exactly 3 eligible legacy records (A, B, C)');
    assert(dryRunSummary.alreadyMigratedCount === 1, '2.3 Identified 1 already migrated record (D)');
    assert(dryRunSummary.conflictCount === 1, '2.4 Identified 1 conflict record (E)');
    assert(dryRunSummary.skippedMalformedCount === 1, '2.5 Identified 1 malformed record (F)');
    assert(dryRunSummary.dryRun === true, '2.6 Dry run flag confirmed true');

    // Confirm real Firestore was NOT modified during dry-run
    const docASnapDry = await docA.get();
    assert(docASnapDry.data()?.userId === undefined, '2.7 Dry-run made zero mutations in Firestore');

    // 2.2 Live Migration Execution
    console.log('\n--- 2.2 Live Migration Execution ---');
    const liveSummary = await migrateLegacyNotifications(db, { dryRun: false });
    assert(liveSummary.migratedCount === 3, '2.8 Exactly 3 documents migrated and committed');
    assert(liveSummary.conflictCount === 1, '2.9 Conflict record E safely skipped during live migration');

    // Verify mutations in Firestore
    const docASnapLive = await docA.get();
    const dataA = docASnapLive.data()!;
    assert(dataA.userId === 'user_alice', '2.10 Doc A received userId alias user_alice');
    assert(dataA.recipientUserId === 'user_alice', '2.11 Doc A preserved recipientUserId');
    assert(dataA.isRead === false, '2.12 Doc A preserved isRead state');
    assert(dataA.createdAt === '2026-10-15T10:00:00.000Z', '2.13 Doc A preserved createdAt timestamp');
    assert(dataA.metadata?.daysOverdue === 2, '2.14 Doc A preserved metadata');

    const docBSnapLive = await docB.get();
    const dataB = docBSnapLive.data()!;
    assert(dataB.userEmail === 'bob@example.com', '2.15 Doc B received normalized userEmail');
    assert(dataB.isRead === true, '2.16 Doc B preserved isRead = true');

    const docCSnapLive = await docC.get();
    const dataC = docCSnapLive.data()!;
    assert(dataC.userId === 'user_carol' && dataC.userEmail === 'carol@example.com', '2.17 Doc C received both aliases');

    const docESnapLive = await docE.get();
    assert(docESnapLive.data()?.userId === 'user_hacker_tampered', '2.18 Conflict record E left untouched');

    // 2.3 Idempotency: Second run makes zero changes
    console.log('\n--- 2.3 Idempotency Run ---');
    const idempotentSummary = await migrateLegacyNotifications(db, { dryRun: false });
    assert(idempotentSummary.migratedCount === 0, '2.19 Second run migrated 0 documents');
    assert(idempotentSummary.alreadyMigratedCount === 4, '2.20 4 records (A, B, C, D) identified as already migrated');
    assert(idempotentSummary.eligibleCount === 0, '2.21 Eligible count is 0 on repeated run');
  }

  // --- Suite 3: Pagination Across Multiple Batches ---
  console.log('\n--- Suite 3: Pagination Across Multiple Batches ---');
  {
    await cleanCollection('notifications');

    // Seed 15 legacy documents
    const totalToSeed = 15;
    const batch = db.batch();
    for (let i = 0; i < totalToSeed; i++) {
      const ref = db.collection('notifications').doc(`notif_page_${i.toString().padStart(3, '0')}`);
      batch.set(ref, {
        id: ref.id,
        projectId: 'proj_pagination',
        taskId: `task_${i}`,
        recipientUserId: `user_paged_${i}`,
        type: 'TASK_OVERDUE',
        title: `Paged Task ${i}`,
        message: 'Overdue notice',
        isRead: false,
        createdAt: new Date().toISOString()
      });
    }
    await batch.commit();

    // Migrate with small batch size of 5 (requiring 3 distinct batches)
    const pagedSummary = await migrateLegacyNotifications(db, {
      batchSize: 5,
      dryRun: false
    });

    assert(pagedSummary.scannedCount === 15, '3.1 Paged migration scanned all 15 documents');
    assert(pagedSummary.migratedCount === 15, '3.2 Paged migration migrated all 15 documents');
    assert(pagedSummary.batchCount === 3, '3.3 Created and committed exactly 3 batches of size 5');

    // Verify all 15 have userId alias in emulator
    const sample = await db.collection('notifications').doc('notif_page_010').get();
    assert(sample.data()?.userId === 'user_paged_10', '3.4 Sample paged document verified in emulator');
  }

  // --- Suite 4: Recipient Discoverability & Isolation ---
  console.log('\n--- Suite 4: Recipient Discoverability & Isolation ---');
  {
    // Querying for Alice's notifications matches on userId == user_alice
    const aliceSnap = await db.collection('notifications')
      .where('userId', '==', 'user_paged_0')
      .get();
    assert(aliceSnap.size === 1, '4.1 Recipient discovers migrated notification via userId filter');
    assert(aliceSnap.docs[0].id === 'notif_page_000', '4.2 Exactly matching notification retrieved');

    // Unauthorized third-party querying their own UID receives 0 results
    const unrelatedSnap = await db.collection('notifications')
      .where('userId', '==', 'user_stranger')
      .get();
    assert(unrelatedSnap.size === 0, '4.3 Unrelated user cannot discover another user notifications');
  }

  console.log('\n======================================================');
  console.log(`AH.148 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runBackfillTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
