/**
 * EchoNote Persistent In-App Notification Model (AH.139)
 *\r\n */

import crypto from "crypto";

export type InAppNotificationType =
  | "DEADLINE_PROPAGATED"
  | "TASK_OVERDUE"
  | "PREREQUISITE_COMPLETED";

export interface DeadlinePropagatedMetadata {
  triggerTaskId: string;
  triggerTaskTitle: string;
  affectedTaskId: string;
  affectedTaskTitle: string;
  oldStartDate?: string | null;
  oldDueDate?: string | null;
  newStartDate?: string | null;
  newDueDate?: string | null;
  shiftDays: number;
  performerId: string;
  performerName: string;
  scheduleVersionToken?: string;
  [key: string]: any;
}

export interface InAppNotificationRecord {
  id: string;
  projectId: string;
  taskId?: string;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  /** Backward-compatible alias for real-time Firestore queries and legacy listeners */
  userId?: string | null;
  /** Backward-compatible alias for real-time Firestore queries and legacy listeners */
  userEmail?: string | null;
  type: InAppNotificationType;
  title: string;
  message: string;
  metadata: Record<string, any>;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string | null;
}

export function generateDeadlinePropagationDedupKey(
  projectId: string,
  affectedTaskId: string,
  recipientIdentifier: string,
  newDueDate: string | null | undefined,
  newStartDate: string | null | undefined,
  shiftDays: number
): string {
  const normRecipient = (recipientIdentifier || "").trim().toLowerCase();
  const raw = `${projectId}:${affectedTaskId}:${normRecipient}:${newStartDate || ""}:${newDueDate || ""}:${shiftDays}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `notif_prop_${affectedTaskId}_${hash}`;
}

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email || "").trim().toLowerCase();
}

export function formatDeadlinePropagationMessage(params: {
  affectedTaskTitle: string;
  triggerTaskTitle: string;
  performerName: string;
  oldDueDate?: string | null;
  newDueDate?: string | null;
  shiftDays: number;
}): { title: string; message: string } {
  const { affectedTaskTitle, triggerTaskTitle, performerName, oldDueDate, newDueDate, shiftDays } = params;
  const direction = shiftDays > 0 ? 'pushed by +' + shiftDays + ' day(s)' : 'shifted by ' + shiftDays + ' day(s)';
  const title = 'Deadline adjusted for "' + affectedTaskTitle + '"';
  const dueInfo = oldDueDate && newDueDate ? (' from ' + oldDueDate + ' to ' + newDueDate) : (newDueDate ? (' to ' + newDueDate) : '');
  const message = 'Your task "' + affectedTaskTitle + '" deadline was ' + direction + dueInfo + ' because prerequisite "' + triggerTaskTitle + '" was updated by ' + performerName + '.';
  return { title, message };
}


export interface TaskOverdueMetadata {
  taskId: string;
  taskTitle: string;
  projectId: string;
  dueDate: string;
  daysOverdue: number;
  recipientIdentifier: string;
  scannedAt: string;
  priority?: string;
  [key: string]: any;
}

export function generateTaskOverdueDedupKey(
  projectId: string,
  taskId: string,
  recipientIdentifier: string,
  dueDate: string): string {
  const normRecipient = (recipientIdentifier || "").trim().toLowerCase();
  const raw = `${projectId}:${taskId}:${normRecipient}:${dueDate || ""}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `notif_overdue_${taskId}_${hash}`;
}


export function formatTaskOverdueMessage(params: {
  taskTitle: string;
  dueDate: string;
  daysOverdue: number;
}): { title: string; message: string } {
  const { taskTitle, dueDate, daysOverdue } = params;
  const title = `Task overdue: "${taskTitle}"`;
  const dayStr = daysOverdue === 1 ? '1 day' : `${daysOverdue} days`;
  const message = `Task "${taskTitle}" is overdue by ${dayStr} (due date was ${dueDate}). Please review and take action.`;
  return { title, message };
}

export interface PrerequisiteCompletedMetadata {
  prerequisiteTaskId: string;
  prerequisiteTaskTitle: string;
  affectedTaskId: string;
  affectedTaskTitle: string;
  projectId: string;
  completedAt: string;
  completedByUserId?: string;
  completedByUserName?: string;
  recipientIdentifier: string;
  [key: string]: any;
}

export function generatePrerequisiteCompletedDedupKey(
  projectId: string,
  affectedTaskId: string,
  prerequisiteTaskId: string,
  recipientIdentifier: string
): string {
  const normRecipient = (recipientIdentifier || "").trim().toLowerCase();
  const raw = `${projectId}:${affectedTaskId}:${prerequisiteTaskId}:${normRecipient}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `notif_prereq_${affectedTaskId}_${prerequisiteTaskId}_${hash}`;
}

export function formatPrerequisiteCompletedMessage(params: {
  prerequisiteTaskTitle: string;
  affectedTaskTitle: string;
  completedByUserName?: string;
}): { title: string; message: string } {
  const { prerequisiteTaskTitle, affectedTaskTitle, completedByUserName } = params;
  const title = `Prerequisite completed for "${affectedTaskTitle}"`;
  const byUser = completedByUserName && completedByUserName.trim() ? ` by ${completedByUserName.trim()}` : '';
  const message = `Prerequisite task "${prerequisiteTaskTitle}" was completed${byUser}. Your task "${affectedTaskTitle}" is ready to proceed.`;
  return { title, message };
}
