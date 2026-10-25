import { Firestore } from 'firebase-admin/firestore';
import {
  InAppNotificationRecord,
  TaskOverdueMetadata,
  generateTaskOverdueDedupKey,
  formatTaskOverdueMessage,
  isValidEmail,
  normalizeEmail
} from './notificationModel';
import { parseCalendarDate, diffCalendarDays } from './taskScheduling';

export interface OverdueScanOptions {
  projectId?: string;
  evaluationDate?: string; // YYYY-MM-DD (defaults to current UTC date)
  pageSize?: number;
  dryRun?: boolean;
}

export interface OverdueScanItemResult {
  taskId: string;
  projectId: string;
  taskTitle: string;
  dueDate: string;
  daysOverdue: number;
  recipientIdentifier: string;
  status: 'created' | 'already_notified' | 'skipped' | 'error';
  reason?: string;
  notificationId?: string;
}

export interface OverdueScanResult {
  scannedCount: number;
  eligibleOverdueCount: number;
  createdCount: number;
  alreadyNotifiedCount: number;
  skippedCount: number;
  errorCount: number;
  evaluationDate: string;
  durationMs: number;
  details: OverdueScanItemResult[];
}

/**
 * Returns current UTC date formatted as YYYY-MM-DD.
 */
export function getCurrentUtcCalendarDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

/**
 * Validates whether a status represents a completed/cancelled/terminal state.
 */
export function isTaskTerminalOrCompleted(status: any): boolean {
  if (!status || typeof status !== 'string') return false;
  const s = status.trim().toLowerCase();
  return s === 'completed' || s === 'done' || s === 'cancelled' || s === 'canceled';
}

/**
 * Evaluates whether a task is eligible for an overdue alert.
 * Returns null if ineligible, or overdue metadata if eligible.
 */
export function evaluateTaskOverdueEligibility(
  task: any,
  evalDate: string
): { eligible: false; reason: string } | { eligible: true; daysOverdue: number; dueDate: string } {
  if (!task) {
    return { eligible: false, reason: 'Task document is empty' };
  }

  if (isTaskTerminalOrCompleted(task.status)) {
    return { eligible: false, reason: 'Task status is terminal (' + task.status + ')' };
  }

  const rawDueDate = task.dueDate;
  if (!rawDueDate || typeof rawDueDate !== 'string' || !rawDueDate.trim()) {
    return { eligible: false, reason: 'Task has no due date' };
  }

  const parsedDueDate = parseCalendarDate(rawDueDate.trim());
  if (!parsedDueDate) {
    return { eligible: false, reason: 'Task due date is invalid (' + rawDueDate + ')' };
  }

  const parsedEvalDate = parseCalendarDate(evalDate);
  if (!parsedEvalDate) {
    return { eligible: false, reason: 'Evaluation date is invalid (' + evalDate + ')' };
  }

  const daysOverdue = diffCalendarDays(evalDate, rawDueDate.trim());
  if (daysOverdue <= 0) {
    return { eligible: false, reason: 'Task is not overdue (due ' + rawDueDate + ', eval ' + evalDate + ', diff ' + daysOverdue + ')' };
  }

  return { eligible: true, daysOverdue, dueDate: rawDueDate.trim() };
}

/**
 * Resolves a reliable notification recipient from task fields.
 */
export function resolveTaskRecipient(task: any): { recipientUserId?: string | null; recipientEmail?: string | null; identifier: string } | null {
  if (!task) return null;

  // 1. Assignee ID if present
  if (task.assigneeId && typeof task.assigneeId === 'string' && task.assigneeId.trim()) {
    const uid = task.assigneeId.trim();
    const email = isValidEmail(task.assigneeEmail) ? normalizeEmail(task.assigneeEmail) : null;
    return {
      recipientUserId: uid,
      recipientEmail: email,
      identifier: uid
    };
  }

  // 2. Assignee Email if valid
  if (task.assigneeEmail && typeof task.assigneeEmail === 'string' && isValidEmail(task.assigneeEmail)) {
    const normEmail = normalizeEmail(task.assigneeEmail);
    return {
      recipientUserId: null,
      recipientEmail: normEmail,
      identifier: normEmail
    };
  }

  // No resolvable recipient
  return null;
}

/**
 * Executes atomic creation of an overdue notification inside a Firestore transaction.
 */
export async function createOverdueNotificationAtomic(
  db: Firestore,
  params: {
    projectId: string;
    taskId: string;
    taskTitle: string;
    dueDate: string;
    daysOverdue: number;
    recipientUserId?: string | null;
    recipientEmail?: string | null;
    recipientIdentifier: string;
    priority?: string;
    evaluationDate: string;
  }
): Promise<{ status: 'created' | 'already_notified' | 'skipped'; reason?: string; notificationId?: string }> {
  const {
    projectId,
    taskId,
    taskTitle,
    dueDate,
    daysOverdue,
    recipientUserId,
    recipientEmail,
    recipientIdentifier,
    priority,
    evaluationDate
  } = params;

  const dedupKey = generateTaskOverdueDedupKey(projectId, taskId, recipientIdentifier, dueDate);
  const notifRef = db.collection('notifications').doc(dedupKey);
  const taskRef = db.collection('projects').doc(projectId).collection('tasks').doc(taskId);

  return await db.runTransaction(async (transaction) => {
    // 1. Transactional check for existing notification with this episode key
    const notifSnap = await transaction.get(notifRef);
    if (notifSnap.exists) {
      return { status: 'already_notified', reason: 'Notification already exists for this overdue episode', notificationId: dedupKey };
    }

    // 2. Transactional check on fresh task document to prevent stale race conditions
    const taskSnap = await transaction.get(taskRef);
    if (!taskSnap.exists) {
      return { status: 'skipped', reason: 'Task document no longer exists' };
    }

    const freshTask = taskSnap.data() || {};

    // Revalidate project association
    if (freshTask.projectId && freshTask.projectId !== projectId) {
      return { status: 'skipped', reason: 'Task project association changed concurrently (' + freshTask.projectId + ' vs ' + projectId + ')' };
    }

    if (isTaskTerminalOrCompleted(freshTask.status)) {
      return { status: 'skipped', reason: 'Task was completed before processing (' + freshTask.status + ')' };
    }

    // Check if due date was modified mid-flight
    if (freshTask.dueDate !== dueDate) {
      return { status: 'skipped', reason: 'Task due date changed concurrently (' + freshTask.dueDate + ' vs ' + dueDate + ')' };
    }

    // Revalidate overdue eligibility for the evaluation date against fresh task state
    const eligibilityRecheck = evaluateTaskOverdueEligibility(freshTask, evaluationDate);
    if (eligibilityRecheck.eligible === false) {
      return { status: 'skipped', reason: 'Task is no longer overdue on evaluation date (' + eligibilityRecheck.reason + ')' };
    }

    // Revalidate recipient identity against fresh task state
    const freshRecipient = resolveTaskRecipient(freshTask);
    if (!freshRecipient || freshRecipient.identifier !== recipientIdentifier) {
      return {
        status: 'skipped',
        reason: 'Task recipient changed concurrently (' + (freshRecipient ? freshRecipient.identifier : 'unassigned') + ' vs ' + recipientIdentifier + ')'
      };
    }

    const actualDaysOverdue = eligibilityRecheck.daysOverdue;

    // Format copy
    const { title, message } = formatTaskOverdueMessage({
      taskTitle: freshTask.title || taskTitle,
      dueDate,
      daysOverdue: actualDaysOverdue
    });

    const nowIso = new Date().toISOString();
    const metadata: TaskOverdueMetadata = {
      taskId,
      taskTitle: freshTask.title || taskTitle,
      projectId,
      dueDate,
      daysOverdue: actualDaysOverdue,
      recipientIdentifier,
      scannedAt: nowIso,
      evaluationDate,
      priority: freshTask.priority || priority || 'medium'
    };

    const record: InAppNotificationRecord = {
      id: dedupKey,
      projectId,
      taskId,
      recipientUserId: freshRecipient.recipientUserId || null,
      recipientEmail: freshRecipient.recipientEmail || null,
      userId: freshRecipient.recipientUserId || null,
      userEmail: freshRecipient.recipientEmail || null,
      type: 'TASK_OVERDUE',
      title,
      message,
      metadata,
      isRead: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      idempotencyKey: dedupKey
    };

    transaction.set(notifRef, record);
    return { status: 'created', notificationId: dedupKey };
  });
}

/**
 * Scans tasks and processes overdue alerts with pagination.
 */
export async function scanAndCreateOverdueNotifications(
  db: Firestore,
  options: OverdueScanOptions = {}
): Promise<OverdueScanResult> {
  const startTime = Date.now();
  const evalDate = options.evaluationDate && parseCalendarDate(options.evaluationDate)
    ? options.evaluationDate
    : getCurrentUtcCalendarDate();

  const pageSize = options.pageSize && options.pageSize > 0 && options.pageSize <= 500
    ? options.pageSize
    : 100;

  const result: OverdueScanResult = {
    scannedCount: 0,
    eligibleOverdueCount: 0,
    createdCount: 0,
    alreadyNotifiedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    evaluationDate: evalDate,
    durationMs: 0,
    details: []
  };

  try {
    let baseQuery: any;
    if (options.projectId) {
      baseQuery = db.collection('projects').doc(options.projectId).collection('tasks');
    } else {
      baseQuery = db.collectionGroup('tasks');
    }

    let lastDoc: any = null;
    let hasMore = true;

    while (hasMore) {
      let pageQuery = baseQuery.limit(pageSize);
      if (lastDoc) {
        pageQuery = pageQuery.startAfter(lastDoc);
      }

      const snapshot = await pageQuery.get();
      if (snapshot.empty) {
        break;
      }

      result.scannedCount += snapshot.docs.length;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      for (const doc of snapshot.docs) {
        const taskData = doc.data() || {};
        const taskId = doc.id;
        
        let taskProjectId = taskData.projectId;
        if (!taskProjectId) {
          const projectDocRef = doc.ref.parent ? doc.ref.parent.parent : null;
          if (projectDocRef) {
            taskProjectId = projectDocRef.id;
          }
        }

        if (!taskProjectId) {
          result.skippedCount++;
          result.details.push({
            taskId,
            projectId: 'unknown',
            taskTitle: taskData.title || 'Untitled',
            dueDate: taskData.dueDate || '',
            daysOverdue: 0,
            recipientIdentifier: 'unknown',
            status: 'skipped',
            reason: 'Could not determine projectId for task'
          });
          continue;
        }

        // 1. Evaluate Overdue Eligibility
        const evalOutcome = evaluateTaskOverdueEligibility(taskData, evalDate);
        if (!evalOutcome.eligible) {
          result.skippedCount++;
          continue;
        }

        result.eligibleOverdueCount++;

        // 2. Resolve Recipient
        const recipient = resolveTaskRecipient(taskData);
        if (!recipient) {
          result.skippedCount++;
          result.details.push({
            taskId,
            projectId: taskProjectId,
            taskTitle: taskData.title || 'Untitled',
            dueDate: evalOutcome.dueDate,
            daysOverdue: evalOutcome.daysOverdue,
            recipientIdentifier: 'unassigned',
            status: 'skipped',
            reason: 'Task has no assigned user ID or valid recipient email'
          });
          continue;
        }

        // 3. Dry Run Check
        if (options.dryRun) {
          result.details.push({
            taskId,
            projectId: taskProjectId,
            taskTitle: taskData.title || 'Untitled',
            dueDate: evalOutcome.dueDate,
            daysOverdue: evalOutcome.daysOverdue,
            recipientIdentifier: recipient.identifier,
            status: 'skipped',
            reason: 'Dry run requested'
          });
          continue;
        }

        // 4. Atomic Transactional Creation
        try {
          const outcome = await createOverdueNotificationAtomic(db, {
            projectId: taskProjectId,
            taskId,
            taskTitle: taskData.title || 'Untitled',
            dueDate: evalOutcome.dueDate,
            daysOverdue: evalOutcome.daysOverdue,
            recipientUserId: recipient.recipientUserId,
            recipientEmail: recipient.recipientEmail,
            recipientIdentifier: recipient.identifier,
            priority: taskData.priority,
            evaluationDate: evalDate
          });

          if (outcome.status === 'created') {
            result.createdCount++;
          } else if (outcome.status === 'already_notified') {
            result.alreadyNotifiedCount++;
          } else {
            result.skippedCount++;
          }

          result.details.push({
            taskId,
            projectId: taskProjectId,
            taskTitle: taskData.title || 'Untitled',
            dueDate: evalOutcome.dueDate,
            daysOverdue: evalOutcome.daysOverdue,
            recipientIdentifier: recipient.identifier,
            status: outcome.status,
            reason: outcome.reason,
            notificationId: outcome.notificationId
          });
        } catch (itemErr: any) {
          result.errorCount++;
          result.details.push({
            taskId,
            projectId: taskProjectId,
            taskTitle: taskData.title || 'Untitled',
            dueDate: evalOutcome.dueDate,
            daysOverdue: evalOutcome.daysOverdue,
            recipientIdentifier: recipient.identifier,
            status: 'error',
            reason: (itemErr && itemErr.message) || 'Transaction error'
          });
        }
      }

      if (snapshot.docs.length < pageSize) {
        hasMore = false;
      }
    }
  } catch (err: any) {
    result.errorCount++;
    console.error('[OverdueTaskAlertService] Scan error:', err);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}
