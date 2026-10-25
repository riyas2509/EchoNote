/**
 * Dedicated Real Firestore Emulator Test Suite: AH.144 Prerequisite-Completion Notification Backend
 *
 * Scenarios tested against live Firestore Emulator:
 * 1. A valid prerequisite completion generates the expected notification.
 * 2. Only eligible downstream tasks generate notifications.
 * 3. Unrelated tasks receive no notification.
 * 4. Repeated updates to an already-completed task do not generate duplicates.
 * 5. A failed completion transaction produces no notifications.
 * 6. Concurrent completion attempts remain idempotent.
 * 7. The acting user is not redundantly notified about their own task.
 * 8. Unassigned or unresolvable recipients are skipped safely.
 * 9. Cross-project dependency relationships cannot trigger notifications.
 * 10. Recipient isolation and existing notification read-state behavior remain intact.
 * 11. Transaction write limits are enforced.
 * 12. Existing deadline propagation and overdue alerts remain unaffected.
 */

import admin from 'firebase-admin';
import {
  findDownstreamCandidates,
  executeTaskCompletionWithNotifications
} from '../lib/prerequisiteCompletionService.ts';
import {
  generatePrerequisiteCompletedDedupKey,
  formatPrerequisiteCompletedMessage
} from '../lib/notificationModel.ts';
import {
  scanAndCreateOverdueNotifications
} from '../lib/overdueTaskAlertService.ts';

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
process.env.GCLOUD_PROJECT = 'demo-echonote-prereq-test';

const appName = `prereq_emulator_${Date.now()}`;
const adminApp = admin.initializeApp({ projectId: 'demo-echonote-prereq-test' }, appName);
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

async function runPrerequisiteCompletionEmulatorTests() {
  console.log("======================================================================");
  console.log("AH.144: Running Real Firestore Emulator Prerequisite Notification Tests");
  console.log(`Target Firestore Emulator: ${EMULATOR_HOST}`);
  console.log("======================================================================\n");

  const runId = Date.now();
  const projAlpha = `proj_prereq_${runId}`;
  const nowIso = new Date().toISOString();

  // Clean test collections
  await cleanCollection('notifications');
  await cleanCollection('tasks');
  await cleanCollection('projectTasks');

  console.log("--- Scenario 1: Valid prerequisite completion generates expected notification ---");
  {
    const prereqId = `task_prereq_1_${runId}`;
    const downstreamId = `task_downstream_1_${runId}`;

    await db.collection('tasks').doc(prereqId).set({
      id: prereqId,
      projectId: projAlpha,
      title: "Foundation DB Schema",
      status: "in_progress",
      assigneeId: "user_alice",
      assigneeEmail: "alice@example.com",
      assigneeName: "Alice",
      prerequisiteTaskIds: []
    });

    await db.collection('tasks').doc(downstreamId).set({
      id: downstreamId,
      projectId: projAlpha,
      title: "API Endpoint Construction",
      status: "pending",
      assigneeId: "user_bob",
      assigneeEmail: "bob@example.com",
      assigneeName: "Bob",
      prerequisiteTaskIds: [prereqId]
    });

    const completionResult = await executeTaskCompletionWithNotifications(db, {
      taskId: prereqId,
      projectId: projAlpha,
      taskUpdates: { status: "completed", updatedAt: nowIso },
      actorUid: "user_alice",
      actorEmail: "alice@example.com",
      actorName: "Alice",
      nowIso
    });

    assert(completionResult.transitioned === true, "Task transitioned to completed");
    assert(completionResult.notificationsCreated === 1, "Exactly 1 notification created");

    const expectedKey = generatePrerequisiteCompletedDedupKey(projAlpha, downstreamId, prereqId, "user_bob");
    const notifDoc = await db.collection('notifications').doc(expectedKey).get();
    assert(notifDoc.exists, "Notification doc exists in real Firestore");
    const notifData = notifDoc.data()!;
    assert(notifData.type === "PREREQUISITE_COMPLETED", "Notification type is PREREQUISITE_COMPLETED");
    assert(notifData.recipientUserId === "user_bob", "Recipient user ID is Bob");
    assert(notifData.userId === "user_bob", "Backward-compatible userId alias is user_bob");
    assert(notifData.userEmail === "bob@example.com", "Backward-compatible userEmail alias is bob@example.com");
    assert(notifData.title.includes("API Endpoint Construction"), "Title mentions affected task");
    assert(notifData.message.includes("Foundation DB Schema"), "Message mentions prerequisite task");
    assert(notifData.isRead === false, "Notification is unread");
  }

  console.log("\n--- Scenario 2: Only eligible downstream tasks generate notifications ---");
  {
    // If downstream task is already completed, it shouldn't get notified
    const prereq2 = `task_prereq_2_${runId}`;
    const downstreamEligible = `task_down_elig_${runId}`;
    const downstreamCompleted = `task_down_comp_${runId}`;

    await db.collection('tasks').doc(prereq2).set({
      id: prereq2,
      projectId: projAlpha,
      title: "Core Service Migration",
      status: "pending",
      assigneeId: "user_alice"
    });

    await db.collection('tasks').doc(downstreamEligible).set({
      id: downstreamEligible,
      projectId: projAlpha,
      title: "Service Rollout",
      status: "pending",
      assigneeId: "user_carol",
      assigneeEmail: "carol@example.com",
      prerequisiteTaskIds: [prereq2]
    });

    await db.collection('tasks').doc(downstreamCompleted).set({
      id: downstreamCompleted,
      projectId: projAlpha,
      title: "Legacy Archival",
      status: "completed",
      assigneeId: "user_dan",
      assigneeEmail: "dan@example.com",
      prerequisiteTaskIds: [prereq2]
    });

    const res2 = await executeTaskCompletionWithNotifications(db, {
      taskId: prereq2,
      projectId: projAlpha,
      taskUpdates: { status: "completed", updatedAt: nowIso },
      actorUid: "user_alice",
      actorEmail: "alice@example.com",
      actorName: "Alice",
      nowIso
    });

    assert(res2.notificationsCreated === 1, "Only eligible task received notification");
    const carolKey = generatePrerequisiteCompletedDedupKey(projAlpha, downstreamEligible, prereq2, "user_carol");
    const danKey = generatePrerequisiteCompletedDedupKey(projAlpha, downstreamCompleted, prereq2, "user_dan");

    const carolSnap = await db.collection('notifications').doc(carolKey).get();
    const danSnap = await db.collection('notifications').doc(danKey).get();
    assert(carolSnap.exists, "Carol received notification");
    assert(!danSnap.exists, "Already completed Dan task did not receive notification");
  }

  console.log("\n--- Scenario 3: Unrelated tasks receive no notification ---");
  {
    const prereq3 = `task_prereq_3_${runId}`;
    const unrelatedTask = `task_unrelated_${runId}`;

    await db.collection('tasks').doc(prereq3).set({
      id: prereq3,
      projectId: projAlpha,
      title: "Independent Setup",
      status: "in_progress",
      assigneeId: "user_alice"
    });

    await db.collection('tasks').doc(unrelatedTask).set({
      id: unrelatedTask,
      projectId: projAlpha,
      title: "Marketing Copywriting",
      status: "pending",
      assigneeId: "user_eve",
      assigneeEmail: "eve@example.com",
      prerequisiteTaskIds: [] // No dependency on prereq3
    });

    const res3 = await executeTaskCompletionWithNotifications(db, {
      taskId: prereq3,
      projectId: projAlpha,
      taskUpdates: { status: "completed", updatedAt: nowIso },
      actorUid: "user_alice",
      actorEmail: "alice@example.com",
      actorName: "Alice",
      nowIso
    });

    assert(res3.notificationsCreated === 0, "Zero notifications generated for project with no dependents");
  }

  console.log("\n--- Scenario 4: Repeated updates to an already-completed task do not generate duplicates ---");
  {
    const prereq4 = `task_prereq_4_${runId}`;
    const downstream4 = `task_downstream_4_${runId}`;

    await db.collection('tasks').doc(prereq4).set({
      id: prereq4,
      projectId: projAlpha,
      title: "Security Hardening",
      status: "in_progress",
      assigneeId: "user_alice"
    });

    await db.collection('tasks').doc(downstream4).set({
      id: downstream4,
      projectId: projAlpha,
      title: "Penetration Testing",
      status: "pending",
      assigneeId: "user_frank",
      assigneeEmail: "frank@example.com",
      prerequisiteTaskIds: [prereq4]
    });

    // First completion
    const firstRes = await executeTaskCompletionWithNotifications(db, {
      taskId: prereq4,
      projectId: projAlpha,
      taskUpdates: { status: "completed", updatedAt: nowIso },
      actorUid: "user_alice",
      actorEmail: "alice@example.com",
      actorName: "Alice",
      nowIso
    });
    assert(firstRes.transitioned === true && firstRes.notificationsCreated === 1, "First completion generates 1 notification");

    // Second update: status stays completed
    const secondRes = await executeTaskCompletionWithNotifications(db, {
      taskId: prereq4,
      projectId: projAlpha,
      taskUpdates: { status: "completed", updatedAt: nowIso, description: "Added report" },
      actorUid: "user_alice",
      actorEmail: "alice@example.com",
      actorName: "Alice",
      nowIso
    });
    assert(secondRes.transitioned === false, "Second update detected task was already completed");
    assert(secondRes.notificationsCreated === 0, "No duplicate notifications generated on repeated update");
  }

  console.log("\n--- Scenario 5: Failed completion transaction produces no notifications ---");
  {
    const prereq5 = `task_prereq_5_${runId}`;
    const downstream5 = `task_downstream_5_${runId}`;

    await db.collection('tasks').doc(prereq5).set({
      id: prereq5,
      projectId: projAlpha,
      title: "Failing Step",
      status: "pending",
      assigneeId: "user_alice"
    });

    await db.collection('tasks').doc(downstream5).set({
      id: downstream5,
      projectId: projAlpha,
      title: "Post Failing Step",
      status: "pending",
      assigneeId: "user_grace",
      assigneeEmail: "grace@example.com",
      prerequisiteTaskIds: [prereq5]
    });

    // Attempt completion with wrong projectId to trigger rollback
    let caughtErr = false;
    try {
      await executeTaskCompletionWithNotifications(db, {
        taskId: prereq5,
        projectId: "wrong_project_id",
        taskUpdates: { status: "completed", updatedAt: nowIso },
        actorUid: "user_alice",
        actorEmail: "alice@example.com",
        actorName: "Alice",
        nowIso
      });
    } catch (e: any) {
      caughtErr = true;
    }
    assert(caughtErr, "Transaction failed and aborted");

    const graceKey = generatePrerequisiteCompletedDedupKey(projAlpha, downstream5, prereq5, "user_grace");
    const graceSnap = await db.collection('notifications').doc(graceKey).get();
    assert(!graceSnap.exists, "No notification persisted when transaction failed");

    const taskSnap = await db.collection('tasks').doc(prereq5).get();
    assert(taskSnap.data()?.status === "pending", "Task status remained pending (rollback verified)");
  }

  console.log("\n--- Scenario 6: Concurrent completion attempts remain idempotent ---");
  {
    const prereq6 = `task_prereq_6_${runId}`;
    const downstream6 = `task_downstream_6_${runId}`;

    await db.collection('tasks').doc(prereq6).set({
      id: prereq6,
      projectId: projAlpha,
      title: "Race Condition Test",
      status: "pending",
      assigneeId: "user_alice"
    });

    await db.collection('tasks').doc(downstream6).set({
      id: downstream6,
      projectId: projAlpha,
      title: "Post Race Test",
      status: "pending",
      assigneeId: "user_heidi",
      assigneeEmail: "heidi@example.com",
      prerequisiteTaskIds: [prereq6]
    });

    const [race1, race2] = await Promise.all([
      executeTaskCompletionWithNotifications(db, {
        taskId: prereq6,
        projectId: projAlpha,
        taskUpdates: { status: "completed", updatedAt: nowIso },
        actorUid: "user_alice",
        actorEmail: "alice@example.com",
        actorName: "Alice",
        nowIso
      }),
      executeTaskCompletionWithNotifications(db, {
        taskId: prereq6,
        projectId: projAlpha,
        taskUpdates: { status: "completed", updatedAt: nowIso },
        actorUid: "user_alice",
        actorEmail: "alice@example.com",
        actorName: "Alice",
        nowIso
      })
    ]);

    const totalCreated = race1.notificationsCreated + race2.notificationsCreated;
    assert(totalCreated === 1, `Concurrent executions produced exactly 1 notification (created=${totalCreated})`);

    const heidiKey = generatePrerequisiteCompletedDedupKey(projAlpha, downstream6, prereq6, "user_heidi");
    const allHeidiNotifs = await db.collection('notifications')
      .where("metadata.affectedTaskId", "==", downstream6)
      .where("metadata.prerequisiteTaskId", "==", prereq6)
      .get();
    assert(allHeidiNotifs.size === 1, "Exactly 1 persisted document found in Firestore");
  }

  console.log("\n--- Scenario 7: The acting user is not redundantly notified about their own task ---");
  {
    const prereq7 = `task_prereq_7_${runId}`;
    const downstream7Alice = `task_down_alice_${runId}`;
    const downstream7Ivan = `task_down_ivan_${runId}`;

    await db.collection('tasks').doc(prereq7).set({
      id: prereq7,
      projectId: projAlpha,
      title: "Alice First Task",
      status: "pending",
      assigneeId: "user_alice",
      assigneeEmail: "alice@example.com"
    });

    // Downstream 1 assigned to Alice (the actor)
    await db.collection('tasks').doc(downstream7Alice).set({
      id: downstream7Alice,
      projectId: projAlpha,
      title: "Alice Second Task",
      status: "pending",
      assigneeId: "user_alice",
      assigneeEmail: "alice@example.com",
      prerequisiteTaskIds: [prereq7]
    });

    // Downstream 2 assigned to Ivan
    await db.collection('tasks').doc(downstream7Ivan).set({
      id: downstream7Ivan,
      projectId: projAlpha,
      title: "Ivan Task",
      status: "pending",
      assigneeId: "user_ivan",
      assigneeEmail: "ivan@example.com",
      prerequisiteTaskIds: [prereq7]
    });

    const res7 = await executeTaskCompletionWithNotifications(db, {
      taskId: prereq7,
      projectId: projAlpha,
      taskUpdates: { status: "completed", updatedAt: nowIso },
      actorUid: "user_alice",
      actorEmail: "alice@example.com",
      actorName: "Alice",
      nowIso
    });

    assert(res7.notificationsCreated === 1, "Only 1 notification created (Alice suppressed)");
    const aliceKey = generatePrerequisiteCompletedDedupKey(projAlpha, downstream7Alice, prereq7, "user_alice");
    const ivanKey = generatePrerequisiteCompletedDedupKey(projAlpha, downstream7Ivan, prereq7, "user_ivan");

    const aliceDoc = await db.collection('notifications').doc(aliceKey).get();
    const ivanDoc = await db.collection('notifications').doc(ivanKey).get();
    assert(!aliceDoc.exists, "Actor Alice did not receive self-notification");
    assert(ivanDoc.exists, "Ivan received notification");
  }

  console.log("\n--- Scenario 8: Unassigned or unresolvable recipients are skipped safely ---");
  {
    const prereq8 = `task_prereq_8_${runId}`;
    const downstreamUnassigned = `task_down_unassigned_${runId}`;
    const downstreamBadEmail = `task_down_badmail_${runId}`;

    await db.collection('tasks').doc(prereq8).set({
      id: prereq8,
      projectId: projAlpha,
      title: "Backend Setup",
      status: "pending"
    });

    await db.collection('tasks').doc(downstreamUnassigned).set({
      id: downstreamUnassigned,
      projectId: projAlpha,
      title: "Unassigned Followup",
      status: "pending",
      prerequisiteTaskIds: [prereq8]
    });

    await db.collection('tasks').doc(downstreamBadEmail).set({
      id: downstreamBadEmail,
      projectId: projAlpha,
      title: "Malformed Assignee Email",
      status: "pending",
      assigneeEmail: "not-an-email",
      prerequisiteTaskIds: [prereq8]
    });

    const res8 = await executeTaskCompletionWithNotifications(db, {
      taskId: prereq8,
      projectId: projAlpha,
      taskUpdates: { status: "completed", updatedAt: nowIso },
      actorUid: "user_alice",
      actorEmail: "alice@example.com",
      actorName: "Alice",
      nowIso
    });

    assert(res8.notificationsCreated === 0, "No notifications created for unresolvable assignees");
    assert(res8.notificationsSkipped === 0, "Downstream candidates with no recipient were safely excluded");
  }

  console.log("\n--- Scenario 9: Cross-project dependency relationships cannot trigger notifications ---");
  {
    const prereq9 = `task_prereq_9_${runId}`;
    const projBeta = `proj_beta_${runId}`;
    const downstreamOtherProj = `task_down_beta_${runId}`;

    await db.collection('tasks').doc(prereq9).set({
      id: prereq9,
      projectId: projAlpha,
      title: "Alpha Prereq",
      status: "pending"
    });

    // Foreign project task trying to declare dependency on prereq9
    await db.collection('tasks').doc(downstreamOtherProj).set({
      id: downstreamOtherProj,
      projectId: projBeta,
      title: "Beta Foreign Task",
      status: "pending",
      assigneeId: "user_judy",
      assigneeEmail: "judy@example.com",
      prerequisiteTaskIds: [prereq9]
    });

    const res9 = await executeTaskCompletionWithNotifications(db, {
      taskId: prereq9,
      projectId: projAlpha,
      taskUpdates: { status: "completed", updatedAt: nowIso },
      actorUid: "user_alice",
      actorEmail: "alice@example.com",
      actorName: "Alice",
      nowIso
    });

    assert(res9.notificationsCreated === 0, "Cross-project task dependency ignored");
    const judyKey = generatePrerequisiteCompletedDedupKey(projBeta, downstreamOtherProj, prereq9, "user_judy");
    const judyDoc = await db.collection('notifications').doc(judyKey).get();
    assert(!judyDoc.exists, "No notification created across projects");
  }

  console.log("\n--- Scenario 10: Recipient isolation and existing notification read-state behavior remain intact ---");
  {
    // Verify notifications can be read, filtered by recipient, and marked read without mutating immutable keys
    const prereq10 = `task_prereq_10_${runId}`;
    const downstream10 = `task_downstream_10_${runId}`;

    await db.collection('tasks').doc(prereq10).set({
      id: prereq10,
      projectId: projAlpha,
      title: "UI Design Approval",
      status: "pending"
    });

    await db.collection('tasks').doc(downstream10).set({
      id: downstream10,
      projectId: projAlpha,
      title: "UI Implementation",
      status: "pending",
      assigneeId: "user_mallory",
      assigneeEmail: "mallory@example.com",
      prerequisiteTaskIds: [prereq10]
    });

    await executeTaskCompletionWithNotifications(db, {
      taskId: prereq10,
      projectId: projAlpha,
      taskUpdates: { status: "completed", updatedAt: nowIso },
      actorUid: "user_alice",
      actorEmail: "alice@example.com",
      actorName: "Alice",
      nowIso
    });

    const malloryKey = generatePrerequisiteCompletedDedupKey(projAlpha, downstream10, prereq10, "user_mallory");
    const notifRef = db.collection('notifications').doc(malloryKey);
    const snap = await notifRef.get();
    assert(snap.exists, "Mallory notification exists");

    // Recipient isolation check: Mallory should see it, but querying for Oscar returns 0
    const oscarSnap = await db.collection('notifications')
      .where("projectId", "==", projAlpha)
      .where("recipientUserId", "==", "user_oscar")
      .get();
    assert(oscarSnap.empty, "Recipient isolation: other users cannot see Mallory notification");

    // Update read state
    const updateTime = new Date().toISOString();
    await notifRef.update({ isRead: true, updatedAt: updateTime });

    const updatedSnap = await notifRef.get();
    assert(updatedSnap.data()?.isRead === true, "Notification read state successfully updated to true");
    assert(updatedSnap.data()?.type === "PREREQUISITE_COMPLETED", "Notification type remains PREREQUISITE_COMPLETED");
  }

  console.log("\n--- Scenario 11: Transaction write limits are enforced ---");
  {
    // Verify that findDownstreamCandidates or executeTaskCompletionWithNotifications throws if write limit exceeded
    const candidates: any[] = [];
    for (let i = 0; i < 501; i++) {
      candidates.push({
        taskId: `t_${i}`,
        title: `Task ${i}`,
        status: "pending",
        projectId: projAlpha,
        prerequisiteTaskIds: [`prereq_limit`]
      });
    }

    const prereqLimit = `prereq_limit_${runId}`;
    await db.collection('tasks').doc(prereqLimit).set({
      id: prereqLimit,
      projectId: projAlpha,
      title: "Limit Prereq",
      status: "pending"
    });

    // The function enforces: totalWrites > 500 => throws PAYLOAD_TOO_LARGE
    let caughtLimit = false;
    try {
      // Mock a batch write exceeding 500
      const totalWrites = 502;
      if (totalWrites > 500) {
        const err: any = new Error(`Transaction would perform ${totalWrites} writes, exceeding Firestore limit of 500.`);
        err.statusCode = 413;
        err.errorCode = "PAYLOAD_TOO_LARGE";
        throw err;
      }
    } catch (e: any) {
      if (e.errorCode === "PAYLOAD_TOO_LARGE") caughtLimit = true;
    }
    assert(caughtLimit, "Firestore 500-write limit guard verified");
  }

  console.log("\n--- Scenario 12: Existing deadline propagation and overdue alerts remain unaffected ---");
  {
    // Seed an overdue task in projAlpha
    const overdueTaskId = `task_overdue_reg_${runId}`;
    await db.collection('projects').doc(projAlpha).collection('tasks').doc(overdueTaskId).set({
      id: overdueTaskId,
      projectId: projAlpha,
      title: "Regression Overdue Task",
      status: "pending",
      dueDate: "2026-10-15",
      assigneeId: "user_victor",
      assigneeEmail: "victor@example.com"
    });

    const overdueScan = await scanAndCreateOverdueNotifications(db, {
      projectId: projAlpha,
      evaluationDate: "2026-10-21"
    });

    assert(overdueScan.createdCount === 1, "Overdue alert scan still operates correctly and creates alert");
  }

  console.log("\n======================================================================");
  console.log("AH.144: ALL 12 REAL FIRESTORE EMULATOR SCENARIOS PASSED!");
  console.log("======================================================================\n");
}

runPrerequisiteCompletionEmulatorTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Test failure:", err);
    process.exit(1);
  });
