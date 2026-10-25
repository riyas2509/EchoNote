import { Firestore } from 'firebase-admin/firestore';
import {
  InAppNotificationRecord,
  PrerequisiteCompletedMetadata,
  generatePrerequisiteCompletedDedupKey,
  formatPrerequisiteCompletedMessage,
  isValidEmail,
  normalizeEmail
} from './notificationModel';
import { isTaskTerminalOrCompleted } from './overdueTaskAlertService';

export interface PrerequisiteNotificationRecipient {
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  identifier: string;
}

export interface DownstreamCandidate {
  taskId: string;
  taskTitle: string;
  projectId: string;
  status: string;
  prerequisiteTaskIds: string[];
  recipient: PrerequisiteNotificationRecipient;
}

export interface PrerequisiteNotificationItemResult {
  downstreamTaskId: string;
  downstreamTaskTitle: string;
  recipientIdentifier: string;
  status: 'created' | 'already_notified' | 'skipped' | 'error';
  reason?: string;
  notificationId?: string;
}

export interface PrerequisiteCompletionResult {
  transitioned: boolean;
  prerequisiteTaskId: string;
  downstreamTasksScanned: number;
  notificationsCreated: number;
  notificationsReused: number;
  notificationsSkipped: number;
  details: PrerequisiteNotificationItemResult[];
}

/**
 * Resolves downstream candidate tasks in the same project that depend on the given prerequisite.
 */
export function findDownstreamCandidates(
  prerequisiteTaskId: string,
  prerequisiteProjectId: string,
  allProjectTasks: any[],
  actorUid?: string | null,
  actorEmail?: string | null
): DownstreamCandidate[] {
  const normActorEmail = actorEmail ? normalizeEmail(actorEmail) : null;
  const candidates: DownstreamCandidate[] = [];

  for (const task of allProjectTasks) {
    if (!task || !task.id || task.id === prerequisiteTaskId) continue;

    // Cross-project protection: task must belong to same project
    if (task.projectId && task.projectId !== prerequisiteProjectId) continue;

    // Do not notify already completed/terminal tasks
    if (isTaskTerminalOrCompleted(task.status)) continue;

    const prereqIds: string[] = Array.isArray(task.prerequisiteTaskIds)
      ? task.prerequisiteTaskIds.map((id: any) => String(id || '').trim()).filter(Boolean)
      : [];

    if (!prereqIds.includes(prerequisiteTaskId)) continue;

    // Resolve recipient
    let recipient: PrerequisiteNotificationRecipient | null = null;
    if (task.assigneeId && typeof task.assigneeId === 'string' && task.assigneeId.trim()) {
      const uid = task.assigneeId.trim();
      const email = isValidEmail(task.assigneeEmail) ? normalizeEmail(task.assigneeEmail) : null;
      recipient = { recipientUserId: uid, recipientEmail: email, identifier: uid };
    } else if (task.assigneeEmail && typeof task.assigneeEmail === 'string' && isValidEmail(task.assigneeEmail)) {
      const normEmail = normalizeEmail(task.assigneeEmail);
      recipient = { recipientUserId: null, recipientEmail: normEmail, identifier: normEmail };
    }

    if (!recipient) {
      continue; // Unassigned or unresolvable
    }

    // Suppress self-notification to the acting user
    const isActor = (recipient.recipientUserId && actorUid && recipient.recipientUserId === actorUid) ||
                    (recipient.recipientEmail && normActorEmail && recipient.recipientEmail === normActorEmail);
    if (isActor) {
      continue;
    }

    candidates.push({
      taskId: task.id,
      taskTitle: task.title || 'Untitled Task',
      projectId: prerequisiteProjectId,
      status: task.status || 'pending',
      prerequisiteTaskIds: prereqIds,
      recipient
    });
  }

  return candidates;
}

/**
 * Transactional executor for task completion and prerequisite notification generation.
 *
 * Runs inside a Firestore transaction:
 * 1. Reads current prerequisite task document.
 * 2. Checks if task transitions from non-completed to completed.
 *    If already completed, returns without generating duplicates.
 * 3. Finds downstream dependent tasks in the same project.
 * 4. Validates write limit (Firestore 500 writes limit).
 * 5. Creates idempotent PREREQUISITE_COMPLETED notification records.
 * 6. Updates prerequisite task document to completed.
 */
export async function executeTaskCompletionWithNotifications(
  db: Firestore,
  params: {
    taskId: string;
    projectId: string;
    taskUpdates: Record<string, any>;
    actorUid: string;
    actorEmail: string;
    actorName: string;
    nowIso: string;
  }
): Promise<PrerequisiteCompletionResult> {
  const { taskId, projectId, taskUpdates, actorUid, actorEmail, actorName, nowIso } = params;

  // Pre-fetch downstream candidate tasks to minimize transaction read load.
  // Note: we also re-read tasks in-transaction if needed, but in Firestore, querying tasks by array-contains
  // inside transaction can be done before or within limits.
  let allProjTasksSnap = await db.collection("tasks").where("projectId", "==", projectId).get();
  if (allProjTasksSnap.empty) {
    allProjTasksSnap = await db.collection("projectTasks").where("projectId", "==", projectId).get();
  }
  const allProjectTasks = allProjTasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const taskRef = db.collection("tasks").doc(taskId);
  const projectTaskRef = db.collection("projectTasks").doc(taskId);

  return await db.runTransaction(async (transaction) => {
    const taskSnap = await transaction.get(taskRef);
    if (!taskSnap.exists) {
      const err: any = new Error("Task not found");
      err.statusCode = 404;
      throw err;
    }

    const currentTask = taskSnap.data() || {};

    // Validate project boundary
    if (currentTask.projectId && currentTask.projectId !== projectId) {
      const err: any = new Error("Task project mismatch");
      err.statusCode = 403;
      throw err;
    }

    const wasCompleted = isTaskTerminalOrCompleted(currentTask.status);
    const targetStatus = taskUpdates.status || currentTask.status;
    const isNowCompleted = isTaskTerminalOrCompleted(targetStatus);

    const willTransitionToCompleted = !wasCompleted && isNowCompleted;

    const result: PrerequisiteCompletionResult = {
      transitioned: willTransitionToCompleted,
      prerequisiteTaskId: taskId,
      downstreamTasksScanned: 0,
      notificationsCreated: 0,
      notificationsReused: 0,
      notificationsSkipped: 0,
      details: []
    };

    const notificationsToCreate: InAppNotificationRecord[] = [];

    if (willTransitionToCompleted) {
      // Find downstream tasks that depend on this task
      const candidates = findDownstreamCandidates(
        taskId,
        projectId,
        allProjectTasks,
        actorUid,
        actorEmail
      );

      result.downstreamTasksScanned = candidates.length;

      // Re-read candidate tasks transactionally to guarantee fresh state
      for (const cand of candidates) {
        const candRef = db.collection("tasks").doc(cand.taskId);
        const candSnap = await transaction.get(candRef);
        if (!candSnap.exists) {
          result.notificationsSkipped++;
          result.details.push({
            downstreamTaskId: cand.taskId,
            downstreamTaskTitle: cand.taskTitle,
            recipientIdentifier: cand.recipient.identifier,
            status: 'skipped',
            reason: 'Downstream task no longer exists'
          });
          continue;
        }

        const freshCandData = candSnap.data() || {};

        // Cross-project check against fresh doc
        if (freshCandData.projectId && freshCandData.projectId !== projectId) {
          result.notificationsSkipped++;
          result.details.push({
            downstreamTaskId: cand.taskId,
            downstreamTaskTitle: freshCandData.title || cand.taskTitle,
            recipientIdentifier: cand.recipient.identifier,
            status: 'skipped',
            reason: 'Downstream task project mismatch'
          });
          continue;
        }

        // Fresh completion check: skip if downstream task is already completed
        if (isTaskTerminalOrCompleted(freshCandData.status)) {
          result.notificationsSkipped++;
          result.details.push({
            downstreamTaskId: cand.taskId,
            downstreamTaskTitle: freshCandData.title || cand.taskTitle,
            recipientIdentifier: cand.recipient.identifier,
            status: 'skipped',
            reason: 'Downstream task is already completed'
          });
          continue;
        }

        // Verify prerequisite relationship still holds
        const freshPrereqIds: string[] = Array.isArray(freshCandData.prerequisiteTaskIds)
          ? freshCandData.prerequisiteTaskIds.map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];

        if (!freshPrereqIds.includes(taskId)) {
          result.notificationsSkipped++;
          result.details.push({
            downstreamTaskId: cand.taskId,
            downstreamTaskTitle: freshCandData.title || cand.taskTitle,
            recipientIdentifier: cand.recipient.identifier,
            status: 'skipped',
            reason: 'Prerequisite dependency removed'
          });
          continue;
        }

        // Re-check recipient against fresh doc
        let freshRecipient: PrerequisiteNotificationRecipient | null = null;
        if (freshCandData.assigneeId && typeof freshCandData.assigneeId === 'string' && freshCandData.assigneeId.trim()) {
          const uid = freshCandData.assigneeId.trim();
          const email = isValidEmail(freshCandData.assigneeEmail) ? normalizeEmail(freshCandData.assigneeEmail) : null;
          freshRecipient = { recipientUserId: uid, recipientEmail: email, identifier: uid };
        } else if (freshCandData.assigneeEmail && typeof freshCandData.assigneeEmail === 'string' && isValidEmail(freshCandData.assigneeEmail)) {
          const normEmail = normalizeEmail(freshCandData.assigneeEmail);
          freshRecipient = { recipientUserId: null, recipientEmail: normEmail, identifier: normEmail };
        }

        if (!freshRecipient) {
          result.notificationsSkipped++;
          result.details.push({
            downstreamTaskId: cand.taskId,
            downstreamTaskTitle: freshCandData.title || cand.taskTitle,
            recipientIdentifier: 'unassigned',
            status: 'skipped',
            reason: 'Downstream task has no valid recipient'
          });
          continue;
        }

        // Suppress self-notification to actor
        const normActorEmail = actorEmail ? normalizeEmail(actorEmail) : null;
        const isActor = (freshRecipient.recipientUserId && actorUid && freshRecipient.recipientUserId === actorUid) ||
                        (freshRecipient.recipientEmail && normActorEmail && freshRecipient.recipientEmail === normActorEmail);
        if (isActor) {
          result.notificationsSkipped++;
          result.details.push({
            downstreamTaskId: cand.taskId,
            downstreamTaskTitle: freshCandData.title || cand.taskTitle,
            recipientIdentifier: freshRecipient.identifier,
            status: 'skipped',
            reason: 'Recipient is the acting user'
          });
          continue;
        }

        // Deterministic deduplication key
        const dedupKey = generatePrerequisiteCompletedDedupKey(
          projectId,
          cand.taskId,
          taskId,
          freshRecipient.identifier
        );

        // Transactional check for existing notification
        const notifRef = db.collection("notifications").doc(dedupKey);
        const existingNotifSnap = await transaction.get(notifRef);

        if (existingNotifSnap.exists) {
          result.notificationsReused++;
          result.details.push({
            downstreamTaskId: cand.taskId,
            downstreamTaskTitle: freshCandData.title || cand.taskTitle,
            recipientIdentifier: freshRecipient.identifier,
            status: 'already_notified',
            reason: 'Notification already exists',
            notificationId: dedupKey
          });
          continue;
        }

        const prereqTitle = currentTask.title || 'Prerequisite Task';
        const affectedTitle = freshCandData.title || cand.taskTitle;
        const { title: notifTitle, message: notifMessage } = formatPrerequisiteCompletedMessage({
          prerequisiteTaskTitle: prereqTitle,
          affectedTaskTitle: affectedTitle,
          completedByUserName: actorName
        });

        const metadata: PrerequisiteCompletedMetadata = {
          prerequisiteTaskId: taskId,
          prerequisiteTaskTitle: prereqTitle,
          affectedTaskId: cand.taskId,
          affectedTaskTitle: affectedTitle,
          projectId,
          completedAt: nowIso,
          completedByUserId: actorUid,
          completedByUserName: actorName,
          recipientIdentifier: freshRecipient.identifier
        };

        const notifRecord: InAppNotificationRecord = {
          id: dedupKey,
          projectId,
          taskId: cand.taskId,
          recipientUserId: freshRecipient.recipientUserId || null,
          recipientEmail: freshRecipient.recipientEmail || null,
          userId: freshRecipient.recipientUserId || null,
          userEmail: freshRecipient.recipientEmail || null,
          type: 'PREREQUISITE_COMPLETED',
          title: notifTitle,
          message: notifMessage,
          metadata,
          isRead: false,
          createdAt: nowIso,
          updatedAt: nowIso,
          idempotencyKey: dedupKey
        };

        notificationsToCreate.push(notifRecord);
        result.notificationsCreated++;
        result.details.push({
          downstreamTaskId: cand.taskId,
          downstreamTaskTitle: affectedTitle,
          recipientIdentifier: freshRecipient.identifier,
          status: 'created',
          notificationId: dedupKey
        });
      }
    }

    // Enforce Firestore 500-write limit: task write(s) + notifications
    const totalWrites = 2 + notificationsToCreate.length; // tasks doc + projectTasks doc + notifications
    if (totalWrites > 500) {
      const err: any = new Error(`Transaction would perform ${totalWrites} writes, exceeding Firestore limit of 500.`);
      err.statusCode = 413;
      err.errorCode = "PAYLOAD_TOO_LARGE";
      throw err;
    }

    // Apply notification writes
    for (const notif of notificationsToCreate) {
      const notifRef = db.collection("notifications").doc(notif.id);
      transaction.set(notifRef, notif);
    }

    // Apply task update
    transaction.set(taskRef, taskUpdates, { merge: true });
    try {
      transaction.set(projectTaskRef, taskUpdates, { merge: true });
    } catch {}

    return result;
  });
}
