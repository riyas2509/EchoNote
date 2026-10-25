/**
 * Task Notification Service (Phase 3 Step 3.3 - Hardened Ambiguous Delivery Recovery)
 *
 * Implements a reliable, production-oriented foundation for task and deadline notifications:
 * 1. Strongly typed notification categories (task_assignment, upcoming_deadline, overdue_task, blocked_task).
 * 2. Stable, collision-safe deterministic notification identity using canonical event hashing.
 * 3. Atomic Firestore transaction claiming with distributed lease fencing, stale-worker rejection, and retries.
 * 4. Recipient authorization and eligibility checking against live project membership and organization boundaries.
 * 5. Distinction between permanent authorization failures and transient lookup errors.
 * 6. Protection against recipient tampering / payload hijacking.
 * 7. Provider acceptance verification with atomic persistence and explicit 'ambiguous_delivery' quarantine state.
 * 8. Bounded post-acceptance retry loop with fallback diagnostic logging.
 * 9. Evidence-based manual reconciliation contract (`reconcileAmbiguousNotification`).
 * 10. Strict validation of allowed state transitions.
 * 11. Privacy & security: ensures arbitrary external emails are rejected and transcripts are not leaked.
 */

import crypto from "crypto";
import {
  TaskNotificationType,
  TaskNotificationDeliveryStatus,
  TaskNotificationRecord,
  TaskNotificationPayload
} from "../types";
import { emailService, maskEmailForLogs } from "./emailService";

export const TASK_NOTIFICATIONS_COLLECTION = "taskNotifications";
export const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_MAX_NOTIFICATION_ATTEMPTS = 3;
export const DEFAULT_STALE_DISPATCH_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (bounded threshold for in-flight dispatch)

/**
 * Valid allowed state transitions matrix.
 * 
 * Strict Invariants:
 * - 'sent' is terminal: no transition allowed out of 'sent'.
 * - 'permanently_failed' is terminal: no transition allowed out of 'permanently_failed'.
 * - 'pending' can transition to 'processing'.
 * - 'processing' can transition to 'dispatching', 'retryable_failed', 'permanently_failed', or 'ambiguous_delivery'.
 * - 'dispatching' can transition to 'sent', 'retryable_failed', 'permanently_failed', or 'ambiguous_delivery'.
 * - 'retryable_failed' can transition to 'processing' (on reclaim) or 'permanently_failed' (max attempts reached).
 * - 'ambiguous_delivery' is a quarantined state: can ONLY transition to 'sent' or 'permanently_failed'
 *   via explicit administrative reconciliation with evidence. CANNOT transition to 'processing' or 'dispatching' via automatic workers.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<TaskNotificationDeliveryStatus, TaskNotificationDeliveryStatus[]> = {
  pending: ['processing'],
  processing: ['dispatching', 'sent', 'retryable_failed', 'permanently_failed', 'ambiguous_delivery'],
  dispatching: ['sent', 'retryable_failed', 'permanently_failed', 'ambiguous_delivery'],
  retryable_failed: ['processing', 'permanently_failed'],
  ambiguous_delivery: ['sent', 'permanently_failed'], // Quarantined: only administrative reconciliation
  sent: [],
  permanently_failed: []
};


/**
 * Checks whether a requested state transition is valid according to the state machine contract.
 */
export function isValidStatusTransition(
  currentStatus: TaskNotificationDeliveryStatus,
  targetStatus: TaskNotificationDeliveryStatus
): boolean {
  if (currentStatus === targetStatus) return true;
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus];
  return Array.isArray(allowed) && allowed.includes(targetStatus);
}

/**
 * Normalizes email address deterministically.
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') return '';
  return email.toLowerCase().trim();
}

/**
 * Computes a deterministic, collision-safe event hash.
 */
export function computeNotificationEventHash(
  type: TaskNotificationType,
  options: {
    dueDate?: string | null;
    assigneeEmail?: string | null;
    exceptionId?: string | null;
    exceptionStatus?: string | null;
    customEventVersion?: string | null;
  }
): string {
  const canonicalEvent = {
    t: type,
    d: options.dueDate ? options.dueDate.trim() : null,
    a: options.assigneeEmail ? normalizeEmail(options.assigneeEmail) : null,
    e: options.exceptionId || null,
    s: options.exceptionStatus || null,
    v: options.customEventVersion || null
  };

  const serialized = JSON.stringify(canonicalEvent, Object.keys(canonicalEvent).sort());
  return crypto.createHash('sha256').update(serialized).digest('hex').substring(0, 24);
}

/**
 * Generates a collision-resistant deterministic deduplication key for a task notification.
 * Format: notif_${encodeURIComponent(safeTaskId)}_${sha256(email)}_${type}_${eventHash}
 */
export function generateNotificationDeduplicationKey(
  taskId: string,
  recipientEmail: string,
  type: TaskNotificationType,
  eventHash: string
): string {
  const cleanTaskId = (taskId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  const normalizedEmail = normalizeEmail(recipientEmail);
  const emailDigest = crypto.createHash('sha256').update(normalizedEmail).digest('hex').substring(0, 16);
  return `notif_${cleanTaskId}_${emailDigest}_${type}_${eventHash}`;
}

/**
 * Validate that an email is legitimate and matches standard format.
 */
export function isValidEmailAddress(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(trimmed);
}

export interface RecipientAuthorizationContext {
  recipientEmail: string;
  projectId: string;
  organizationId?: string | null;
}

export interface RecipientEligibilityResult {
  isEligible: boolean;
  isTransientError?: boolean;
  reason?: string;
  recipientName?: string;
}

/**
 * Authoritatively verifies that the recipient is an authorized member or owner of the project.
 * Distinguishes between permanent authorization failure (unauthorized, wrong tenant)
 * and transient database lookup errors (timeout, unavailable).
 */
export async function verifyRecipientEligibility(
  db: any,
  context: RecipientAuthorizationContext
): Promise<RecipientEligibilityResult> {
  const email = normalizeEmail(context.recipientEmail);
  if (!isValidEmailAddress(email)) {
    return { isEligible: false, isTransientError: false, reason: "Malformed or invalid email address." };
  }

  if (!context.projectId) {
    return { isEligible: false, isTransientError: false, reason: "Missing required projectId context." };
  }

  // 1. Fetch Project document
  let projectDoc: any = null;
  try {
    projectDoc = await db.collection("projects").doc(context.projectId).get();
  } catch (err: any) {
    return {
      isEligible: false,
      isTransientError: true,
      reason: `Transient database failure fetching project: ${err?.message || err}`
    };
  }

  if (!projectDoc || !projectDoc.exists) {
    return { isEligible: false, isTransientError: false, reason: "Project does not exist." };
  }

  const projectData = projectDoc.data() || {};
  const projectOrgId = projectData.organizationId || projectData.orgId || null;

  // Enforce Tenant Boundary: If organizationId was specified, verify strict match
  if (context.organizationId && projectOrgId && context.organizationId !== projectOrgId) {
    return {
      isEligible: false,
      isTransientError: false,
      reason: `Tenant isolation violation: project belongs to org ${projectOrgId}, expected ${context.organizationId}.`
    };
  }

  // 2. Direct project ownership
  if (projectData.ownerEmail && normalizeEmail(projectData.ownerEmail) === email) {
    return { isEligible: true, recipientName: projectData.ownerName || undefined };
  }

  // Check creator via users lookup if project only stores userId
  if (projectData.userId) {
    try {
      const creatorDoc = await db.collection("users").doc(projectData.userId).get();
      if (creatorDoc.exists && normalizeEmail(creatorDoc.data()?.email) === email) {
        return { isEligible: true, recipientName: creatorDoc.data()?.displayName || undefined };
      }
    } catch (err: any) {
      console.warn("⚠️ [TaskNotification] creator lookup warning:", err);
    }
  }

  // 3. Embedded project members array (support both object members and raw email strings)
  if (Array.isArray(projectData.members)) {
    const matchedMember = projectData.members.find((m: any) => {
      if (!m) return false;
      if (typeof m === 'string') return normalizeEmail(m) === email;
      if (typeof m === 'object' && m.email) return normalizeEmail(m.email) === email;
      return false;
    });
    if (matchedMember) {
      const recipientName = typeof matchedMember === 'object' ? (matchedMember.name || undefined) : undefined;
      return { isEligible: true, recipientName };
    }
  }

  // 4. projectMembers collection
  try {
    const memberSnap = await db.collection("projectMembers")
      .where("projectId", "==", context.projectId)
      .where("email", "==", email)
      .limit(1)
      .get();

    if (!memberSnap.empty) {
      const mData = memberSnap.docs[0].data() || {};
      return { isEligible: true, recipientName: mData.name || mData.displayName || undefined };
    }
  } catch (err: any) {
    return {
      isEligible: false,
      isTransientError: true,
      reason: `Transient database failure querying projectMembers: ${err?.message || err}`
    };
  }

  // 5. If project belongs to an organization, check organization supervisory membership
  if (projectOrgId) {
    try {
      const orgDoc = await db.collection("organizations").doc(projectOrgId).get();
      if (orgDoc.exists) {
        const orgData = orgDoc.data() || {};
        if (orgData.ownerEmail && normalizeEmail(orgData.ownerEmail) === email) {
          return { isEligible: true, recipientName: orgData.ownerName || undefined };
        }
      }

      const orgMemberSnap = await db.collection("orgMembers")
        .where("organizationId", "==", projectOrgId)
        .where("email", "==", email)
        .where("status", "==", "active")
        .limit(1)
        .get();

      if (!orgMemberSnap.empty) {
        const omData = orgMemberSnap.docs[0].data() || {};
        if (['owner', 'org_admin', 'admin'].includes(omData.role)) {
          return { isEligible: true, recipientName: omData.name || omData.displayName || undefined };
        }
      }
    } catch (err: any) {
      return {
        isEligible: false,
        isTransientError: true,
        reason: `Transient database failure querying organization members: ${err?.message || err}`
      };
    }
  }

  return {
    isEligible: false,
    isTransientError: false,
    reason: "Recipient is not an authorized member of this project or organization."
  };
}

export interface EnqueueTaskNotificationParams {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName?: string;
  organizationId?: string | null;
  recipientEmail: string;
  recipientName?: string;
  type: TaskNotificationType;
  dueDate?: string | null;
  priority?: string | null;
  status?: string | null;
  exceptionId?: string | null;
  exceptionTitle?: string | null;
  exceptionSeverity?: string | null;
  details?: string | null;
  appUrl?: string;
  customEventVersion?: string | null;
}

/**
 * Creates or retrieves a pending task notification record deterministically.
 */
export async function enqueueTaskNotification(
  db: any,
  params: EnqueueTaskNotificationParams
): Promise<{ record: TaskNotificationRecord; isNew: boolean; deduplicationKey: string }> {
  const recipientEmail = normalizeEmail(params.recipientEmail);
  const eventHash = computeNotificationEventHash(params.type, {
    dueDate: params.dueDate,
    assigneeEmail: recipientEmail,
    exceptionId: params.exceptionId,
    exceptionStatus: params.status,
    customEventVersion: params.customEventVersion
  });

  const dedupKey = generateNotificationDeduplicationKey(
    params.taskId,
    recipientEmail,
    params.type,
    eventHash
  );

  const notifRef = db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(dedupKey);
  const nowIso = new Date().toISOString();

  let isNew = false;
  let record: TaskNotificationRecord | null = null;

  await db.runTransaction(async (transaction: any) => {
    const docSnap = await transaction.get(notifRef);

    if (docSnap.exists) {
      record = { id: docSnap.id, ...docSnap.data() } as TaskNotificationRecord;
      return;
    }

    isNew = true;
    const newRecord: TaskNotificationRecord = {
      id: dedupKey,
      taskId: params.taskId,
      projectId: params.projectId,
      organizationId: params.organizationId || null,
      type: params.type,
      recipientEmail,
      recipientName: params.recipientName,
      eventHash,
      status: 'pending',
      leaseExpiresAt: null,
      workerId: null,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_NOTIFICATION_ATTEMPTS,
      lastError: null,
      providerMessageId: null,
      payload: {
        taskId: params.taskId,
        taskTitle: params.taskTitle,
        projectId: params.projectId,
        projectName: params.projectName,
        organizationId: params.organizationId || null,
        recipientEmail,
        recipientName: params.recipientName,
        dueDate: params.dueDate || null,
        priority: params.priority || null,
        status: params.status || null,
        exceptionId: params.exceptionId || null,
        exceptionTitle: params.exceptionTitle || null,
        exceptionSeverity: params.exceptionSeverity || null,
        details: params.details || null,
        appUrl: params.appUrl
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      sentAt: null
    };

    transaction.set(notifRef, newRecord);
    record = newRecord;
  });

  return { record: record!, isNew, deduplicationKey: dedupKey };
}

export interface ClaimNotificationResult {
  claimed: boolean;
  notification: TaskNotificationRecord | null;
  reason?: string;
}

/**
 * Atomically claims a task notification for processing using Firestore transactions.
 * Enforces valid state transitions and fencing guards.
 * 
 * Eligible states:
 * - status === 'pending'
 * - status === 'processing' AND leaseExpiresAt <= now (lease expired)
 * - status === 'retryable_failed' AND attempts < maxAttempts
 * 
 * Invariant: 'ambiguous_delivery' is strictly EXCLUDED from automatic worker claiming!
 */
export async function claimTaskNotification(
  db: any,
  notificationId: string,
  workerId: string,
  leaseDurationMs: number = DEFAULT_LEASE_DURATION_MS
): Promise<ClaimNotificationResult> {
  const notifRef = db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(notificationId);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const leaseExpiresAt = now + leaseDurationMs;

  let claimed = false;
  let claimedDoc: TaskNotificationRecord | null = null;
  let reason: string | undefined;

  await db.runTransaction(async (transaction: any) => {
    const docSnap = await transaction.get(notifRef);

    if (!docSnap.exists) {
      reason = "Notification record does not exist";
      return;
    }

    const data = docSnap.data() as TaskNotificationRecord;

    // Validate state transition to 'processing'
    if (!isValidStatusTransition(data.status, 'processing')) {
      reason = `Invalid status transition: cannot claim notification from state '${data.status}'`;
      return;
    }

    const isLeaseExpired =
      data.status === 'processing' &&
      typeof data.leaseExpiresAt === 'number' &&
      data.leaseExpiresAt <= now;

    const isPending = data.status === 'pending';
    const isRetryable = data.status === 'retryable_failed' && data.attempts < data.maxAttempts;

    // Quarantined states (ambiguous_delivery, sent, permanently_failed) cannot be claimed by automated workers
    if (!isPending && !isLeaseExpired && !isRetryable) {
      reason = `Notification is not eligible for automated claiming (status: ${data.status}, workerId: ${data.workerId}, leaseExpiresAt: ${data.leaseExpiresAt})`;
      return;
    }

    const updatedData: Partial<TaskNotificationRecord> = {
      status: 'processing',
      workerId,
      leaseExpiresAt,
      attempts: (data.attempts || 0) + 1,
      updatedAt: nowIso
    };

    transaction.update(notifRef, updatedData);
    claimed = true;
    claimedDoc = { ...data, ...updatedData };
  });

  return { claimed, notification: claimedDoc, reason };
}

export interface DispatchNotificationResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
  retryable: boolean;
  ambiguous?: boolean;
}

/**
 * Dispatches a task notification with authorization validation, fencing, bounded post-acceptance persistence retries,
 * and ambiguous-delivery quarantine handling.
 */
export async function dispatchTaskNotification(
  db: any,
  notificationId: string,
  workerId: string,
  options?: {
    emailSenderOverride?: (to: string, payload: any) => Promise<{ success: boolean; id?: string; error?: string; isSandboxOrValidation?: boolean }>;
    skipRecipientValidation?: boolean;
    simulatePersistenceFailure?: boolean; // For testing persistent Firestore failures after send
    transientPersistenceFailureCount?: number; // For testing transient Firestore failures that recover on subsequent attempt
  }
): Promise<DispatchNotificationResult> {
  const notifRef = db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(notificationId);
  const now = Date.now();
  const notifSnap = await notifRef.get();

  if (!notifSnap.exists) {
    return { success: false, error: "Notification record not found", retryable: false };
  }

  const notification = notifSnap.data() as TaskNotificationRecord;

  // Worker & Lease verification guard
  if (notification.workerId !== workerId) {
    return {
      success: false,
      error: `Worker mismatch: owned by ${notification.workerId}, caller is ${workerId}`,
      retryable: false
    };
  }

  if (notification.status !== 'processing') {
    return {
      success: false,
      error: `Invalid status for dispatch: ${notification.status}`,
      retryable: false
    };
  }

  if (typeof notification.leaseExpiresAt === 'number' && notification.leaseExpiresAt <= now) {
    return {
      success: false,
      error: "Lease expired before dispatch initiation",
      retryable: true
    };
  }

  // Anti-Tampering Invariant
  const authoritativeRecipient = normalizeEmail(notification.recipientEmail);
  const authoritativeProjectId = notification.projectId;
  const authoritativeOrgId = notification.organizationId;
  const { payload, type } = notification;

  // 1. Recipient Eligibility Verification (Security, Revocation & Tenant Boundary)
  if (!options?.skipRecipientValidation) {
    const eligibility = await verifyRecipientEligibility(db, {
      recipientEmail: authoritativeRecipient,
      projectId: authoritativeProjectId,
      organizationId: authoritativeOrgId
    });

    if (!eligibility.isEligible) {
      const errorMsg = `Recipient eligibility check failed: ${eligibility.reason}`;
      const nowIso = new Date().toISOString();

      if (eligibility.isTransientError) {
        // Transient database/network failure: keep as retryable_failed so alert is NOT permanently suppressed!
        await notifRef.update({
          status: 'retryable_failed',
          lastError: errorMsg,
          updatedAt: nowIso
        });
        return { success: false, error: errorMsg, retryable: true };
      } else {
        // Permanent authorization failure (revoked membership, wrong tenant, non-member)
        await notifRef.update({
          status: 'permanently_failed',
          lastError: errorMsg,
          updatedAt: nowIso
        });
        return { success: false, error: errorMsg, retryable: false };
      }
    }
  }

  // 2. Transition atomically to 'dispatching' before provider invocation to prevent concurrent claim or duplicate send
  const nowIsoPre = new Date().toISOString();
  let dispatchAllowed = false;
  let preDispatchError: string | undefined;

  await db.runTransaction(async (transaction: any) => {
    const currentDoc = await transaction.get(notifRef);
    if (!currentDoc.exists) {
      preDispatchError = "Notification record does not exist";
      return;
    }
    const currentData = currentDoc.data() as TaskNotificationRecord;

    if (currentData.workerId !== workerId) {
      preDispatchError = `Worker mismatch: owned by ${currentData.workerId}, caller is ${workerId}`;
      return;
    }

    if (currentData.status !== 'processing') {
      preDispatchError = `Invalid status transition: expected 'processing', found '${currentData.status}'`;
      return;
    }

    if (typeof currentData.leaseExpiresAt === 'number' && currentData.leaseExpiresAt <= Date.now()) {
      preDispatchError = "Lease expired before dispatch initiation";
      return;
    }

    // Atomically transition to 'dispatching' with start timestamp for bounded stale recovery
    transaction.update(notifRef, {
      status: 'dispatching',
      dispatchStartedAt: nowIsoPre,
      updatedAt: nowIsoPre
    });
    dispatchAllowed = true;
  });

  if (!dispatchAllowed) {
    return {
      success: false,
      error: preDispatchError || "Fencing guard abort: Could not enter dispatching state",
      retryable: true
    };
  }

  // 3. Dispatch via email service
  let sendResult: { success: boolean; id?: string; error?: string; isSandboxOrValidation?: boolean };

  try {
    if (options?.emailSenderOverride) {
      sendResult = await options.emailSenderOverride(authoritativeRecipient, payload);
    } else {
      switch (type) {
        case 'task_assignment':
          sendResult = await emailService.sendTaskAssignmentNotification(authoritativeRecipient, {
            recipientName: payload.recipientName,
            taskTitle: payload.taskTitle,
            projectName: payload.projectName,
            dueDate: payload.dueDate,
            priority: payload.priority,
            appUrl: payload.appUrl
          });
          break;

        case 'upcoming_deadline':
          sendResult = await emailService.sendUpcomingDeadlineNotification(authoritativeRecipient, {
            recipientName: payload.recipientName,
            taskTitle: payload.taskTitle,
            projectName: payload.projectName,
            dueDate: payload.dueDate || 'Approaching deadline',
            priority: payload.priority,
            appUrl: payload.appUrl
          });
          break;

        case 'overdue_task':
          sendResult = await emailService.sendOverdueTaskNotification(authoritativeRecipient, {
            recipientName: payload.recipientName,
            taskTitle: payload.taskTitle,
            projectName: payload.projectName,
            dueDate: payload.dueDate || 'Past deadline',
            priority: payload.priority,
            appUrl: payload.appUrl
          });
          break;

        case 'blocked_task':
          sendResult = await emailService.sendTaskExceptionNotification(authoritativeRecipient, {
            recipientName: payload.recipientName,
            taskTitle: payload.taskTitle,
            projectName: payload.projectName,
            exceptionTitle: payload.exceptionTitle || 'Task Blocker',
            severity: payload.exceptionSeverity,
            details: payload.details,
            appUrl: payload.appUrl
          });
          break;

        default:
          throw new Error(`Unsupported task notification type: ${type}`);
      }
    }
  } catch (err: any) {
    sendResult = {
      success: false,
      error: err?.message || String(err),
      isSandboxOrValidation: false
    };
  }

  const nowIso = new Date().toISOString();

  // 4. Provider Acceptance & Transactional Persistence Verification
  if (sendResult.success && sendResult.id) {
    const providerMessageId = sendResult.id;
    let persistenceSuccessful = false;
    let lastPersistenceError: any = null;
    let simulatedFailuresRemaining = options?.transientPersistenceFailureCount ?? 0;

    // Bounded immediate retry loop (up to 3 attempts, short backoff 100ms)
    // Ensures a transient Firestore network blip does not instantly mark an ambiguous delivery
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (options?.simulatePersistenceFailure) {
          throw new Error("Simulated persistent Firestore timeout after provider dispatch");
        }
        if (simulatedFailuresRemaining > 0) {
          simulatedFailuresRemaining--;
          throw new Error("Simulated transient Firestore timeout after provider dispatch");
        }

        await db.runTransaction(async (transaction: any) => {
          const currentDoc = await transaction.get(notifRef);
          if (!currentDoc.exists) {
            throw new Error("Notification document no longer exists in database");
          }
          const currentData = currentDoc.data() as TaskNotificationRecord;

          // Verify worker has not been overtaken while waiting on Resend
          if (currentData.workerId !== workerId) {
            throw new Error(`Worker fencing conflict: Notification overtaken by ${currentData.workerId}`);
          }

          // Worker persistence can only mark 'sent' from 'dispatching' or 'processing'.
          // If the record was already quarantined to 'ambiguous_delivery' or reconciled, worker cannot mark sent!
          if (currentData.status !== 'dispatching' && currentData.status !== 'processing') {
            throw new Error(`Invalid status transition from ${currentData.status} to sent: notification quarantined or reconciled`);
          }

          if (!isValidStatusTransition(currentData.status, 'sent')) {
            throw new Error(`Invalid status transition from ${currentData.status} to sent`);
          }

          transaction.update(notifRef, {
            status: 'sent',
            providerMessageId,
            sentAt: nowIso,
            updatedAt: nowIso,
            lastError: null
          });
        });

        persistenceSuccessful = true;
        break; // Persisted successfully!
      } catch (err: any) {
        lastPersistenceError = err;
        // If fencing conflict, document deleted, or invalid status transition (e.g. quarantined), abort immediate retries
        const errMsg = String(err?.message || '');
        if (errMsg.includes("Worker fencing conflict") || errMsg.includes("Invalid status transition")) {
          break;
        }
        if (attempt < 3) {
          // Bounded short sleep: 50ms, 100ms
          await new Promise(res => setTimeout(res, attempt * 50));
        }
      }
    }

    if (persistenceSuccessful) {
      return {
        success: true,
        providerMessageId,
        retryable: false
      };
    }

    // IRREDUCIBLE CASE & AMBIGUOUS DELIVERY QUARANTINE:
    // The email was accepted by Resend (id: providerMessageId), but Firestore could not be updated to 'sent'.
    // We attempt a single bounded write to mark 'ambiguous_delivery' and emit structured emergency stderr diagnostics.
    const maskedRecipient = maskEmailForLogs(authoritativeRecipient);
    const failureReason = lastPersistenceError?.message || String(lastPersistenceError);
    const diagnosticMessage =
      `[AMBIGUOUS_DELIVERY_EMERGENCY] Provider accepted message ${providerMessageId} for task notification ${notificationId} ` +
      `(recipient: ${maskedRecipient}, project: ${authoritativeProjectId}), but Firestore write failed: ${failureReason}`;

    console.error(`🚨 ${diagnosticMessage}`);

    try {
      await db.runTransaction(async (transaction: any) => {
        const curDoc = await transaction.get(notifRef);
        if (!curDoc.exists) return;
        const curData = curDoc.data() as TaskNotificationRecord;

        // If already terminal (sent, permanently_failed), do not regress
        if (curData.status === 'sent' || curData.status === 'permanently_failed') {
          return;
        }

        // If the record was already marked ambiguous_delivery by stale recovery, preserve providerMessageId
        const existingQuarantinedAt = curData.quarantinedAt;
        transaction.update(notifRef, {
          status: 'ambiguous_delivery',
          providerMessageId,
          lastError: `Provider accepted (${providerMessageId}) but persistence failed: ${failureReason}`,
          updatedAt: nowIso,
          quarantinedAt: existingQuarantinedAt || nowIso
        });
      });
    } catch (quarantineErr) {
      // THE IRREDUCIBLE CASE:
      // Even the update to 'ambiguous_delivery' failed (e.g. database completely down or network severed).
      // We emit the authoritative emergency log line containing all required fields for operator reconciliation.
      console.error(
        `🚨 [IRREDUCIBLE_STORAGE_FAILURE] Could not write ambiguous_delivery status for notification ${notificationId}. ` +
        `Manual reconciliation required. Details: providerMessageId=${providerMessageId}, ` +
        `recipient=${maskedRecipient}, err=${quarantineErr}`
      );
    }

    return {
      success: false,
      providerMessageId,
      error: `Provider accepted (${providerMessageId}) but Firestore persistence failed: ${failureReason}`,
      retryable: false,
      ambiguous: true
    };
  } else {

    // Provider rejected send: verify state transition and update DB
    const isPermanent = Boolean(sendResult.isSandboxOrValidation || notification.attempts >= notification.maxAttempts);
    const targetStatus: TaskNotificationDeliveryStatus = isPermanent ? 'permanently_failed' : 'retryable_failed';

    try {
      await db.runTransaction(async (transaction: any) => {
        const currentDoc = await transaction.get(notifRef);
        if (!currentDoc.exists) return;
        const currentData = currentDoc.data() as TaskNotificationRecord;

        // Fencing check: if a new worker took over, do not overwrite with stale failure
        if (currentData.workerId !== workerId) {
          console.warn(`[Fencing Guard] Stale worker ${workerId} failure ignored. Active worker: ${currentData.workerId}`);
          return;
        }

        if (isValidStatusTransition(currentData.status, targetStatus)) {
          transaction.update(notifRef, {
            status: targetStatus,
            lastError: sendResult.error || 'Provider rejected notification dispatch',
            updatedAt: nowIso
          });
        }
      });
    } catch (err) {
      console.warn("⚠️ Failed to record failure state:", err);
    }

    return {
      success: false,
      error: sendResult.error || 'Provider rejected notification dispatch',
      retryable: !isPermanent
    };
  }
}

export interface ReconcileAmbiguousOptions {
  decision: 'mark_sent' | 'mark_permanently_failed';
  evidence: {
    operatorId: string;
    reason: string;
    providerMessageId?: string;
  };
}

/**
 * Reconciles an ambiguous or stale in-flight notification through an evidence-based administrative operation.
 * 
 * Strict Guarantees:
 * 1. Only notifications in 'ambiguous_delivery' or 'dispatching' state can be reconciled.
 * 2. To mark 'sent', verifiable evidence (operator ID, non-empty reason, providerMessageId) MUST be present.
 * 3. Does NOT send or re-send any email.
 * 4. Records complete audit metadata with operator ID and verified timestamp.
 * 5. If provider evidence is absent for 'mark_sent', the operation is strictly rejected and state preserved.
 */
export async function reconcileAmbiguousNotification(
  db: any,
  notificationId: string,
  options: ReconcileAmbiguousOptions
): Promise<{ success: boolean; error?: string; notification?: TaskNotificationRecord }> {
  if (!options?.evidence?.operatorId || !options?.evidence?.reason) {
    return {
      success: false,
      error: "Reconciliation rejected: Operator ID and verifiable reason are strictly required."
    };
  }

  const notifRef = db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(notificationId);
  const nowIso = new Date().toISOString();
  let updatedRecord: TaskNotificationRecord | null = null;
  let reconcileError: string | undefined;

  await db.runTransaction(async (transaction: any) => {
    const docSnap = await transaction.get(notifRef);
    if (!docSnap.exists) {
      reconcileError = "Notification record does not exist.";
      return;
    }

    const data = docSnap.data() as TaskNotificationRecord;

    // Reconciliation is strictly confined to uncertain/quarantined states
    if (data.status !== 'ambiguous_delivery' && data.status !== 'dispatching') {
      reconcileError = `Reconciliation rejected: Notification status is '${data.status}'. Only 'ambiguous_delivery' or 'dispatching' records can be manually reconciled.`;
      return;
    }

    const targetStatus = options.decision === 'mark_sent' ? 'sent' : 'permanently_failed';
    if (!isValidStatusTransition(data.status, targetStatus)) {
      reconcileError = `Invalid state transition from ${data.status} to ${targetStatus}`;
      return;
    }

    const effectiveProviderId = options.evidence.providerMessageId || data.providerMessageId;
    if (options.decision === 'mark_sent' && !effectiveProviderId) {
      reconcileError = "Cannot mark as sent without verified providerMessageId evidence. Check email provider logs or select mark_permanently_failed.";
      return;
    }

    const reconciliationMetadata = {
      reconciledBy: options.evidence.operatorId,
      reconciledAt: nowIso,
      reconciliationReason: options.evidence.reason,
      reconciliationDecision: options.decision
    };

    const updateData: Partial<TaskNotificationRecord> & { reconciliation?: any } = {
      status: targetStatus,
      updatedAt: nowIso,
      reconciliation: reconciliationMetadata
    };

    if (targetStatus === 'sent') {
      updateData.sentAt = nowIso;
      updateData.providerMessageId = effectiveProviderId;
      updateData.lastError = null;
    } else {
      updateData.lastError = `Marked permanently_failed by reconciliation (${options.evidence.reason})`;
    }

    transaction.update(notifRef, updateData);
    updatedRecord = { ...data, ...updateData };
  });

  if (reconcileError) {
    return { success: false, error: reconcileError };
  }

  return { success: true, notification: updatedRecord! };
}

export interface QuarantineStaleDispatchResult {
  quarantined: boolean;
  notificationId: string;
  reason?: string;
  notification?: TaskNotificationRecord;
}

/**
 * Atomically quarantines a single stale 'dispatching' notification into 'ambiguous_delivery'.
 *
 * Requirements:
 * 1. Checks that status is 'dispatching'.
 * 2. Checks that dispatchStartedAt (or fallback leaseExpiresAt/updatedAt) is older than staleTimeoutMs.
 * 3. Atomic transition: Sets status to 'ambiguous_delivery', records quarantinedAt timestamp without resetting age.
 * 4. Stale-worker fencing: Preserves workerId for audit trails while quarantining document.
 * 5. Idempotent: If already in 'ambiguous_delivery', preserves quarantinedAt and does not re-advance timestamps.
 * 6. Never calls external email provider.
 */
export async function quarantineStaleDispatchingNotification(
  db: any,
  notificationId: string,
  options?: {
    staleTimeoutMs?: number;
    nowMs?: number;
    quarantinedByWorkerId?: string;
  }
): Promise<QuarantineStaleDispatchResult> {
  const staleTimeoutMs = options?.staleTimeoutMs ?? DEFAULT_STALE_DISPATCH_TIMEOUT_MS;
  const nowMs = options?.nowMs ?? Date.now();
  const notifRef = db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(notificationId);
  const nowIso = new Date(nowMs).toISOString();

  let quarantined = false;
  let reason: string | undefined;
  let updatedRecord: TaskNotificationRecord | undefined;

  await db.runTransaction(async (transaction: any) => {
    const docSnap = await transaction.get(notifRef);
    if (!docSnap.exists) {
      reason = "Notification record does not exist";
      return;
    }

    const data = docSnap.data() as TaskNotificationRecord;

    // Idempotency: If already in ambiguous_delivery, return cleanly without resetting recovery age
    if (data.status === 'ambiguous_delivery') {
      quarantined = true;
      updatedRecord = data;
      reason = "Notification is already in ambiguous_delivery quarantine";
      return;
    }

    if (data.status !== 'dispatching') {
      reason = `Notification status is '${data.status}', expected 'dispatching'`;
      return;
    }

    // Determine dispatch reference time: dispatchStartedAt > leaseExpiresAt > updatedAt > createdAt
    const startedTimeMs = data.dispatchStartedAt
      ? new Date(data.dispatchStartedAt).getTime()
      : (typeof data.leaseExpiresAt === 'number' ? data.leaseExpiresAt : new Date(data.updatedAt || data.createdAt).getTime());

    const ageMs = nowMs - startedTimeMs;
    if (ageMs < staleTimeoutMs) {
      reason = `Dispatch is still within active timeout threshold (${ageMs}ms elapsed, threshold is ${staleTimeoutMs}ms)`;
      return;
    }

    if (!isValidStatusTransition('dispatching', 'ambiguous_delivery')) {
      reason = "Invalid status transition from dispatching to ambiguous_delivery";
      return;
    }

    const maskedRecipient = maskEmailForLogs(data.recipientEmail);
    const quarantineMessage =
      `[AMBIGUOUS_DELIVERY_EMERGENCY] Stale dispatch detected for notification ${notificationId} ` +
      `(recipient: ${maskedRecipient}, project: ${data.projectId}, worker: ${data.workerId}, age: ${Math.round(ageMs / 1000)}s). ` +
      `Moving to ambiguous_delivery quarantine.`;

    console.error(`🚨 ${quarantineMessage}`);

    const updateData: Partial<TaskNotificationRecord> = {
      status: 'ambiguous_delivery',
      quarantinedAt: nowIso,
      updatedAt: nowIso,
      lastError: `Stale dispatch quarantined after ${Math.round(ageMs / 1000)}s in-flight without provider confirmation`
    };

    transaction.update(notifRef, updateData);
    quarantined = true;
    updatedRecord = { ...data, ...updateData };
  });

  return { quarantined, notificationId, reason, notification: updatedRecord };
}

export interface StaleDispatchScanResult {
  scanned: number;
  quarantinedCount: number;
  quarantinedIds: string[];
}

/**
 * Scans for stale 'dispatching' notifications and quarantines them.
 * 
 * Strict Guarantees:
 * 1. Safe scan: only identifies records in 'dispatching' state.
 * 2. Idempotent: repeated scans cannot continuously advance or reset the quarantinedAt timestamp.
 * 3. Never sends or re-sends emails.
 */
export async function scanAndQuarantineStaleDispatches(
  db: any,
  options?: {
    staleTimeoutMs?: number;
    limit?: number;
    nowMs?: number;
    scannerWorkerId?: string;
  }
): Promise<StaleDispatchScanResult> {
  const limitCount = options?.limit ?? 50;
  const staleTimeoutMs = options?.staleTimeoutMs ?? DEFAULT_STALE_DISPATCH_TIMEOUT_MS;
  const nowMs = options?.nowMs ?? Date.now();

  const snapshot = await db
    .collection(TASK_NOTIFICATIONS_COLLECTION)
    .where('status', '==', 'dispatching')
    .limit(limitCount)
    .get();

  let quarantinedCount = 0;
  const quarantinedIds: string[] = [];

  for (const doc of snapshot.docs) {
    const notifId = doc.id;
    const res = await quarantineStaleDispatchingNotification(db, notifId, {
      staleTimeoutMs,
      nowMs,
      quarantinedByWorkerId: options?.scannerWorkerId
    });

    if (res.quarantined && res.reason !== "Notification is already in ambiguous_delivery quarantine") {
      quarantinedCount++;
      quarantinedIds.push(notifId);
    }
  }

  return {
    scanned: snapshot.docs.length,
    quarantinedCount,
    quarantinedIds
  };
}

export interface TaskNotificationGenerationSummary {
  projectId: string;
  tasksEvaluated: number;
  notificationsCreated: number;
  notificationsReused: number;
  notificationsSkipped: number;
  breakdown: {
    upcoming_deadline: { created: number; reused: number };
    overdue_task: { created: number; reused: number };
    blocked_task: { created: number; reused: number };
    task_assignment: { created: number; reused: number };
  };
}

/**
 * Narrowly scoped, idempotent task notification generator.
 * Evaluates authoritative task and exception state for a project and enqueues
 * notification records deterministically.
 * 
 * Strict Guarantees:
 * 1. ZERO Email Dispatches: Only creates or references notification records in 'pending' status.
 * 2. Idempotent: Repeated sweeps for unchanged event state compute identical deduplication keys and reuse existing records without resetting delivery state.
 * 3. Authority Validation: Verifies recipient membership and project boundaries via verifyRecipientEligibility.
 * 4. Completed Task Exclusion: Inactive or completed tasks are excluded from notifications.
 * 5. Bounded Work: Scans within the bounded set of active project tasks and exceptions.
 */
export async function generateTaskNotificationsForProject(
  db: any,
  params: {
    projectId: string;
    organizationId?: string | null;
    projectName?: string;
    activeTasks: any[];
    exceptions: any[];
    risks?: any[];
    options?: {
      nowMs?: number;
      dueSoonDays?: number; // Defaults to 3
    };
  }
): Promise<TaskNotificationGenerationSummary> {
  const { projectId, organizationId, activeTasks, exceptions } = params;
  const nowMs = params.options?.nowMs ?? Date.now();
  const dueSoonDays = params.options?.dueSoonDays ?? 3;
  const dueSoonThresholdMs = nowMs + dueSoonDays * 24 * 60 * 60 * 1000;

  const summary: TaskNotificationGenerationSummary = {
    projectId,
    tasksEvaluated: activeTasks.length,
    notificationsCreated: 0,
    notificationsReused: 0,
    notificationsSkipped: 0,
    breakdown: {
      upcoming_deadline: { created: 0, reused: 0 },
      overdue_task: { created: 0, reused: 0 },
      blocked_task: { created: 0, reused: 0 },
      task_assignment: { created: 0, reused: 0 }
    }
  };

  // Cache recipient eligibility checks within the project run to avoid redundant lookups
  const eligibilityCache = new Map<string, { isEligible: boolean; recipientName?: string }>();

  async function checkRecipient(email: string): Promise<{ isEligible: boolean; recipientName?: string }> {
    const normalized = normalizeEmail(email);
    if (!normalized || !isValidEmailAddress(normalized)) {
      return { isEligible: false };
    }
    if (eligibilityCache.has(normalized)) {
      return eligibilityCache.get(normalized)!;
    }
    const res = await verifyRecipientEligibility(db, {
      recipientEmail: normalized,
      projectId,
      organizationId: organizationId || null
    });
    const result = { isEligible: res.isEligible, recipientName: res.recipientName };
    eligibilityCache.set(normalized, result);
    return result;
  }

  // 1. Task Deadline & Assignment Notifications
  for (const task of activeTasks) {
    // Exclude completed or inactive tasks
    if (!task || task.status === 'completed') {
      summary.notificationsSkipped++;
      continue;
    }

    const assigneeEmail = normalizeEmail(task.assigneeEmail || '');
    if (!assigneeEmail) {
      // Unassigned active task: no recipient to notify
      summary.notificationsSkipped++;
      continue;
    }

    const recipientAuth = await checkRecipient(assigneeEmail);
    if (!recipientAuth.isEligible) {
      summary.notificationsSkipped++;
      continue;
    }

    const recipientName = task.assigneeName || recipientAuth.recipientName || assigneeEmail.split('@')[0];

    // A. Parse and evaluate due date
    let parsedDueDateMs: number | null = null;
    if (task.dueDate && typeof task.dueDate === 'string') {
      const d = new Date(task.dueDate).getTime();
      if (!isNaN(d)) parsedDueDateMs = d;
    }

    if (parsedDueDateMs) {
      if (parsedDueDateMs < nowMs) {
        // OVERDUE TASK
        const res = await enqueueTaskNotification(db, {
          taskId: task.id,
          taskTitle: task.title,
          projectId,
          projectName: params.projectName,
          organizationId: organizationId || null,
          recipientEmail: assigneeEmail,
          recipientName,
          type: 'overdue_task',
          dueDate: task.dueDate,
          priority: task.priority || null,
          status: task.status
        });

        if (res.isNew) {
          summary.notificationsCreated++;
          summary.breakdown.overdue_task.created++;
        } else {
          summary.notificationsReused++;
          summary.breakdown.overdue_task.reused++;
        }
      } else if (parsedDueDateMs <= dueSoonThresholdMs) {
        // UPCOMING DEADLINE
        const res = await enqueueTaskNotification(db, {
          taskId: task.id,
          taskTitle: task.title,
          projectId,
          projectName: params.projectName,
          organizationId: organizationId || null,
          recipientEmail: assigneeEmail,
          recipientName,
          type: 'upcoming_deadline',
          dueDate: task.dueDate,
          priority: task.priority || null,
          status: task.status
        });

        if (res.isNew) {
          summary.notificationsCreated++;
          summary.breakdown.upcoming_deadline.created++;
        } else {
          summary.notificationsReused++;
          summary.breakdown.upcoming_deadline.reused++;
        }
      }
    }

    // B. Explicit Task Assignment Event Check
    // A task has an assignment event if:
    // - activityHistory contains an action === 'reassigned' or action === 'assigned'
    // - or activityHistory explicitly records assignment details during creation (e.g. details contains 'Assigned to')
    // - or assignedAt timestamp is explicitly present
    // Merely existing with an assignee without an assignment event or after completion does not qualify.
    let assignmentEventTimestamp: string | null = null;
    if (Array.isArray(task.activityHistory) && task.activityHistory.length > 0) {
      // Find latest assignment activity
      for (let i = task.activityHistory.length - 1; i >= 0; i--) {
        const act = task.activityHistory[i];
        if (!act) continue;
        const isReassigned = act.action === 'reassigned' || act.action === 'assigned';
        const isExplicitCreationAssignment = act.action === 'task_created' && typeof act.details === 'string' && act.details.toLowerCase().includes('assigned');
        if (isReassigned || isExplicitCreationAssignment) {
          assignmentEventTimestamp = act.timestamp || null;
          break;
        }
      }
    } else if (task.assignedAt && typeof task.assignedAt === 'string') {
      assignmentEventTimestamp = task.assignedAt;
    }

    if (assignmentEventTimestamp) {
      const res = await enqueueTaskNotification(db, {
        taskId: task.id,
        taskTitle: task.title,
        projectId,
        projectName: params.projectName,
        organizationId: organizationId || null,
        recipientEmail: assigneeEmail,
        recipientName,
        type: 'task_assignment',
        dueDate: task.dueDate || null,
        priority: task.priority || null,
        status: task.status,
        customEventVersion: assignmentEventTimestamp
      });

      if (res.isNew) {
        summary.notificationsCreated++;
        summary.breakdown.task_assignment.created++;
      } else {
        summary.notificationsReused++;
        summary.breakdown.task_assignment.reused++;
      }
    }
  }

  // 2. Actionable Task Exceptions (Blocked Tasks)
  // Evaluates newly active or reactivated task exceptions in 'open', 'acknowledged', or 'in_progress' state
  const taskMap = new Map<string, any>();
  activeTasks.forEach(t => {
    if (t && t.id) taskMap.set(t.id, t);
  });

  const activeExceptions = exceptions.filter(e =>
    e && e.taskId && ['open', 'acknowledged', 'in_progress'].includes(e.status)
  );

  for (const ex of activeExceptions) {
    const associatedTask = taskMap.get(ex.taskId);
    if (!associatedTask || associatedTask.status === 'completed') {
      summary.notificationsSkipped++;
      continue;
    }

    const assigneeEmail = normalizeEmail(associatedTask.assigneeEmail || '');
    if (!assigneeEmail) {
      summary.notificationsSkipped++;
      continue;
    }

    const recipientAuth = await checkRecipient(assigneeEmail);
    if (!recipientAuth.isEligible) {
      summary.notificationsSkipped++;
      continue;
    }

    const recipientName = associatedTask.assigneeName || recipientAuth.recipientName || assigneeEmail.split('@')[0];

    // Compute versioning from exception status and updatedAt to allow reactivation notifications if re-opened
    const exceptionVersion = `${ex.status}_${ex.updatedAt || ex.createdAt || 'v1'}`;

    const res = await enqueueTaskNotification(db, {
      taskId: associatedTask.id,
      taskTitle: associatedTask.title,
      projectId,
      projectName: params.projectName,
      organizationId: organizationId || null,
      recipientEmail: assigneeEmail,
      recipientName,
      type: 'blocked_task',
      dueDate: associatedTask.dueDate || null,
      priority: associatedTask.priority || null,
      status: ex.status,
      exceptionId: ex.id,
      exceptionTitle: ex.title || 'Task Exception',
      exceptionSeverity: ex.severity || 'high',
      details: ex.description || null,
      customEventVersion: exceptionVersion
    });

    if (res.isNew) {
      summary.notificationsCreated++;
      summary.breakdown.blocked_task.created++;
    } else {
      summary.notificationsReused++;
      summary.breakdown.blocked_task.reused++;
    }
  }

  return summary;
}

/**
 * Checks whether automated notification email dispatch is explicitly enabled.
 * Defaults to FALSE (disabled) unless NOTIFICATION_DISPATCH_ENABLED is explicitly set to 'true'.
 */
export function isNotificationDispatchEnabled(): boolean {
  return process.env.NOTIFICATION_DISPATCH_ENABLED === 'true';
}

export interface NotificationDispatchItemResult {
  notificationId: string;
  status: 'sent' | 'skipped' | 'retryable_failed' | 'permanently_failed' | 'ambiguous_delivery';
  recipientMasked?: string;
  providerMessageId?: string | null;
  error?: string;
  dryRun?: boolean;
}

export interface NotificationDispatchBatchResult {
  mode: 'dry_run' | 'live_dispatch';
  activationEnabled: boolean;
  workerId: string;
  scanned: number;
  claimed: number;
  sent: number;
  skipped: number;
  retryableFailures: number;
  permanentFailures: number;
  ambiguousDeliveries: number;
  items: NotificationDispatchItemResult[];
}

export const DEFAULT_DISPATCH_BATCH_SIZE = 10;
export const MAX_DISPATCH_BATCH_SIZE = 50;

/**
 * Processes a bounded batch of pending or retryable notifications.
 * 
 * Strict Guarantees:
 * 1. Default-off activation: If NOTIFICATION_DISPATCH_ENABLED !== 'true' and options.forceLiveDispatch is not set,
 *    executes a non-mutating dry run that inspects eligible records and returns intended actions without claiming or sending.
 * 2. Atomic claim and fencing: In live mode, uses claimTaskNotification() and dispatchTaskNotification() with worker fencing.
 * 3. Never claims or redispatches 'dispatching' or 'ambiguous_delivery' records.
 * 4. Bounded: Capped at MAX_DISPATCH_BATCH_SIZE (50) to prevent long-running worker operations.
 * 5. PII Masked: Only masked recipient emails are emitted in item summaries.
 */
export async function processNotificationDispatchBatch(
  db: any,
  options?: {
    batchSize?: number;
    workerId?: string;
    dryRun?: boolean;
    forceLiveDispatch?: boolean; // Controlled bypass for testing or explicit invocation
    leaseDurationMs?: number;
    emailSenderOverride?: (recipient: string, payload: any) => Promise<{ success: boolean; id?: string; error?: string }>;
  }
): Promise<NotificationDispatchBatchResult> {
  const batchSize = Math.max(1, Math.min(options?.batchSize || DEFAULT_DISPATCH_BATCH_SIZE, MAX_DISPATCH_BATCH_SIZE));
  const workerId = options?.workerId || `dispatch_worker_${crypto.randomUUID().substring(0, 8)}`;
  const activationEnabled = isNotificationDispatchEnabled() || Boolean(options?.forceLiveDispatch);
  const isDryRun = options?.dryRun === true || !activationEnabled;

  const result: NotificationDispatchBatchResult = {
    mode: isDryRun ? 'dry_run' : 'live_dispatch',
    activationEnabled,
    workerId,
    scanned: 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    retryableFailures: 0,
    permanentFailures: 0,
    ambiguousDeliveries: 0,
    items: []
  };

  const now = Date.now();

  // Query candidates: 'pending' or 'retryable_failed'
  // Note: Firestore 'in' query allows up to 10 equality values.
  const querySnap = await db
    .collection(TASK_NOTIFICATIONS_COLLECTION)
    .where('status', 'in', ['pending', 'retryable_failed'])
    .limit(batchSize)
    .get();

  const candidates = querySnap.docs.map((d: any) => ({
    id: d.id,
    ...d.data()
  } as TaskNotificationRecord));

  result.scanned = candidates.length;

  for (const candidate of candidates) {
    const masked = maskEmailForLogs(candidate.recipientEmail || '');

    // Skip if retryable_failed and max attempts reached
    if (candidate.status === 'retryable_failed' && (candidate.attempts || 0) >= (candidate.maxAttempts || DEFAULT_MAX_NOTIFICATION_ATTEMPTS)) {
      result.skipped++;
      result.items.push({
        notificationId: candidate.id,
        status: 'skipped',
        recipientMasked: masked,
        error: 'Max retry attempts exceeded'
      });
      continue;
    }

    // DRY RUN MODE:
    // Non-mutating inspection. Does NOT claim or change state in database.
    if (isDryRun) {
      result.items.push({
        notificationId: candidate.id,
        status: 'skipped',
        recipientMasked: masked,
        dryRun: true
      });
      result.skipped++;
      continue;
    }

    // LIVE DISPATCH MODE:
    // 1. Atomic claim with worker lease
    const claimRes = await claimTaskNotification(db, candidate.id, workerId, options?.leaseDurationMs);
    if (!claimRes.claimed || !claimRes.notification) {
      result.skipped++;
      result.items.push({
        notificationId: candidate.id,
        status: 'skipped',
        recipientMasked: masked,
        error: claimRes.reason || 'Failed to claim record'
      });
      continue;
    }

    result.claimed++;

    // 2. Dispatch with recipient revalidation, anti-tampering, and atomic lease fencing
    const dispatchRes = await dispatchTaskNotification(db, candidate.id, workerId, {
      emailSenderOverride: options?.emailSenderOverride
    });

    if (dispatchRes.success) {
      result.sent++;
      result.items.push({
        notificationId: candidate.id,
        status: 'sent',
        recipientMasked: masked,
        providerMessageId: dispatchRes.providerMessageId || null
      });
    } else if (dispatchRes.ambiguous) {
      result.ambiguousDeliveries++;
      result.items.push({
        notificationId: candidate.id,
        status: 'ambiguous_delivery',
        recipientMasked: masked,
        providerMessageId: dispatchRes.providerMessageId || null,
        error: dispatchRes.error
      });
    } else if (dispatchRes.retryable) {
      result.retryableFailures++;
      result.items.push({
        notificationId: candidate.id,
        status: 'retryable_failed',
        recipientMasked: masked,
        error: dispatchRes.error
      });
    } else {
      result.permanentFailures++;
      result.items.push({
        notificationId: candidate.id,
        status: 'permanently_failed',
        recipientMasked: masked,
        error: dispatchRes.error
      });
    }
  }

  return result;
}

