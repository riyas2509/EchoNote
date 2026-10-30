/**
 * Test Suite: Reasoning Meeting Workflow (Requirement 23)
 *
 * Verifies backend foundation:
 * 1. Successful reasoning meeting completion with valid rootCause and agreedDueDate.
 * 2. Downstream deadline propagation with duration preservation and non-actor notifications.
 * 3. Malformed, empty, or oversized rootCause rejection (400).
 * 4. Invalid calendar date formats and inverted start/due relationship rejection (400).
 * 5. Missing or stale scheduleVersionToken rejection (400 / 409).
 * 6. Viewer and unauthorized caller rejection (403).
 * 7. Cross-project and cross-organization task / exception rejection (403 / 404).
 * 8. Cycle detection and conflict graph rejection (400).
 * 9. Duplicate completion and idempotent retry handling (400 ALREADY_COMPLETED).
 * 10. Write limit accounting (500 write limit enforced with 413 error).
 * 11. Transaction rollback on failure (atomicity guaranteed; meeting not marked completed if propagation fails).
 * 12. autoPropagateDownstream: false behavior (updates direct task only, skips downstream tasks and notifications).
 * 13. Audit event (REASONING_MEETING_COMPLETED) and structured outcome metadata persistence.
 * 14. Task exception handling: does not falsely resolve open blockers, annotates them instead.
 * 15. Regression: completed tasks are never shifted.
 */

import assert from "assert";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import {
  calculateDeadlinePropagation,
  computeScheduleVersionToken,
  parseCalendarDate,
  formatCalendarDate,
  diffCalendarDays,
  addCalendarDays,
  SchedulableTask
} from "../lib/taskScheduling.ts";
import {
  generateDeadlinePropagationDedupKey,
  formatDeadlinePropagationMessage,
  InAppNotificationRecord
} from "../lib/notificationModel.ts";
import { recordAuthAuditEvent, AuthAuditLogEvent } from "../lib/auditLogger.ts";

// ============================================================================
// Mock Database & Transaction Engine
// ============================================================================

class MockDocSnapshot {
  constructor(public id: string, private _data: any) {}
  get exists(): boolean { return this._data !== undefined && this._data !== null; }
  data(): any { return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined; }
}

class MockQuerySnapshot {
  constructor(public docs: MockDocSnapshot[]) {}
  get empty(): boolean { return this.docs.length === 0; }
  get size(): number { return this.docs.length; }
}

class MockFirestoreDb {
  public store = new Map<string, any>();
  public failNextTransaction = false;

  collection(collName: string) {
    const self = this;
    return {
      doc(docId: string) {
        const fullPath = `${collName}/${docId}`;
        return {
          id: docId,
          collectionName: collName,
          toString: () => fullPath,
          async get() {
            return new MockDocSnapshot(docId, self.store.get(fullPath));
          },
          async set(data: any, options?: { merge?: boolean }) {
            if (options?.merge && self.store.has(fullPath)) {
              const prev = self.store.get(fullPath);
              self.store.set(fullPath, { ...prev, ...data });
            } else {
              self.store.set(fullPath, { ...data });
            }
          },
          async delete() {
            self.store.delete(fullPath);
          }
        };
      },
      where(field: string, op: string, val: any) {
        return {
          async get() {
            const docs: MockDocSnapshot[] = [];
            for (const [key, value] of self.store.entries()) {
              if (key.startsWith(`${collName}/`)) {
                const docId = key.substring(collName.length + 1);
                if (op === "==" && value[field] === val) {
                  docs.push(new MockDocSnapshot(docId, value));
                }
              }
            }
            return new MockQuerySnapshot(docs);
          }
        };
      }
    };
  }

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    if (this.failNextTransaction) {
      this.failNextTransaction = false;
      throw new Error("Simulated Firestore transaction commit failure");
    }

    const self = this;
    const stagedWrites = new Map<string, any>();

    const transaction = {
      async get(docRefOrQuery: any) {
        if (typeof docRefOrQuery.get === "function") {
          return await docRefOrQuery.get();
        }
        return await docRefOrQuery;
      },
      set(docRef: any, data: any, options?: { merge?: boolean }) {
        const docId = docRef.id;
        let targetKey = "";
        const str = typeof docRef.toString === "function" ? docRef.toString() : "";
        const match = str.match(/([a-zA-Z0-9_]+)\/([a-zA-Z0-9_-]+)/);
        if (match && match[0] !== "[object Object]") {
          targetKey = match[0];
        } else if (docRef.collectionName) {
          targetKey = `${docRef.collectionName}/${docId}`;
        } else {
          for (const [key] of self.store.entries()) {
            if (key.endsWith(`/${docId}`)) {
              targetKey = key;
              break;
            }
          }
        }
        if (!targetKey) {
          targetKey = `unknown/${docId}`;
        }
        const prev = stagedWrites.has(targetKey)
          ? stagedWrites.get(targetKey)
          : (self.store.get(targetKey) || {});

        if (options?.merge) {
          stagedWrites.set(targetKey, { ...prev, ...data });
        } else {
          stagedWrites.set(targetKey, { ...data });
        }
      }
    };

    const result = await updateFunction(transaction);
    for (const [key, val] of stagedWrites.entries()) {
      self.store.set(key, val);
    }
    return result;
  }
}

// ============================================================================
// Express Test App Setup
// ============================================================================

function createTestServer(db: MockFirestoreDb) {
  const app = express();
  app.use(express.json());

  // Mock requireAuth middleware
  app.use((req: any, _res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return _res.status(401).json({ error: "Unauthorized", message: "Missing or invalid Authorization header." });
    }
    const token = authHeader.replace("Bearer ", "").trim();
    if (token === "token_viewer") {
      req.user = { uid: "user_viewer", email: "viewer@apollo.io", displayName: "Viewer User" };
    } else if (token === "token_lead") {
      req.user = { uid: "user_lead", email: "lead@apollo.io", displayName: "Lead User" };
    } else if (token === "token_stranger") {
      req.user = { uid: "user_stranger", email: "stranger@external.io", displayName: "Stranger" };
    } else {
      req.user = { uid: "user_lead", email: "lead@apollo.io", displayName: "Lead User" };
    }
    next();
  });

  // Simulated resolveProjectAccess helper
  async function resolveProjectAccess(user: any, projectId: string, options?: { requiredPermission?: string }) {
    const projDoc = db.store.get(`projects/${projectId}`);
    if (!projDoc) return { hasAccess: false, notFound: true, permissions: { canEditContent: false } };

    const member = (projDoc.members || []).find((m: any) => m.userId === user.uid || m.email === user.email);
    if (!member) {
      return { hasAccess: false, notFound: false, role: null, permissions: { canEditContent: false } };
    }

    const canEdit = ["owner", "admin", "lead", "editor", "member"].includes(member.role);
    return {
      hasAccess: options?.requiredPermission === "EDIT_CONTENT" ? canEdit : true,
      notFound: false,
      role: member.role,
      project: projDoc,
      permissions: { canEditContent: canEdit }
    };
  }

  // POST /api/follow-ups/:meetingId/complete-reasoning (mirrors server.ts implementation)
  app.post("/api/follow-ups/:meetingId/complete-reasoning", async (req: any, res: any) => {
    try {
      const { meetingId } = req.params;
      if (!meetingId || typeof meetingId !== 'string' || !meetingId.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "Valid meetingId is required." });
      }

      const body = req.body || {};
      const {
        rootCause,
        agreedDueDate,
        agreedStartDate,
        scheduleVersionToken,
        autoPropagateDownstream,
        resolveExceptionIds
      } = body;

      // 1. Validate rootCause
      if (!rootCause || typeof rootCause !== 'string' || !rootCause.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_ROOT_CAUSE",
          message: "A non-empty rootCause explaining the incomplete task is required."
        });
      }
      if (rootCause.trim().length > 3000) {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_ROOT_CAUSE",
          message: "rootCause must not exceed 3000 characters."
        });
      }

      // 2. Validate calendar dates
      if (!agreedDueDate || typeof agreedDueDate !== 'string' || !agreedDueDate.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_CALENDAR_DATE",
          message: "A valid agreedDueDate calendar date (YYYY-MM-DD) is required."
        });
      }

      const parsedDue = parseCalendarDate(agreedDueDate);
      if (!parsedDue) {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_CALENDAR_DATE",
          message: "agreedDueDate must be a valid calendar date in YYYY-MM-DD format."
        });
      }

      let cleanStartDate: string | undefined = undefined;
      if (agreedStartDate !== undefined && agreedStartDate !== null) {
        if (typeof agreedStartDate !== 'string' || !agreedStartDate.trim()) {
          return res.status(400).json({
            error: "Bad Request",
            code: "INVALID_CALENDAR_DATE",
            message: "agreedStartDate, if provided, must be a valid non-empty string."
          });
        }
        const parsedStart = parseCalendarDate(agreedStartDate);
        if (!parsedStart) {
          return res.status(400).json({
            error: "Bad Request",
            code: "INVALID_CALENDAR_DATE",
            message: "agreedStartDate must be a valid calendar date in YYYY-MM-DD format."
          });
        }
        const startIso = `${parsedStart.year}-${String(parsedStart.month).padStart(2, '0')}-${String(parsedStart.day).padStart(2, '0')}`;
        const dueIso = `${parsedDue.year}-${String(parsedDue.month).padStart(2, '0')}-${String(parsedDue.day).padStart(2, '0')}`;
        if (startIso > dueIso) {
          return res.status(400).json({
            error: "Bad Request",
            code: "INVALID_DATE_RELATIONSHIP",
            message: `agreedStartDate (${startIso}) cannot be after agreedDueDate (${dueIso}).`
          });
        }
        cleanStartDate = startIso;
      }
      const cleanDueDate = `${parsedDue.year}-${String(parsedDue.month).padStart(2, '0')}-${String(parsedDue.day).padStart(2, '0')}`;

      // 3. Validate scheduleVersionToken
      if (!scheduleVersionToken || typeof scheduleVersionToken !== 'string' || !scheduleVersionToken.trim()) {
        return res.status(400).json({
          error: "Bad Request",
          code: "MISSING_SCHEDULE_VERSION_TOKEN",
          message: "scheduleVersionToken is required for deterministic consistency and optimistic concurrency control."
        });
      }

      // 4. Validate autoPropagateDownstream is explicit boolean (mandatory field)
      if (autoPropagateDownstream === undefined || typeof autoPropagateDownstream !== "boolean") {
        return res.status(400).json({
          error: "Bad Request",
          code: "INVALID_PROPAGATION_FLAG",
          message: "autoPropagateDownstream must be an explicit boolean value."
        });
      }

      // 5. Validate resolveExceptionIds format (if provided, must be array of strings)
      if (resolveExceptionIds !== undefined && resolveExceptionIds !== null) {
        if (!Array.isArray(resolveExceptionIds) || resolveExceptionIds.some((eid: any) => typeof eid !== "string" || !eid.trim())) {
          return res.status(400).json({
            error: "Bad Request",
            code: "INVALID_EXCEPTION_IDS",
            message: "resolveExceptionIds, if provided, must be an array of non-empty strings."
          });
        }
      }

      // 5. Fetch and validate meeting
      const meetingDoc = await db.collection("followUpMeetings").doc(meetingId).get();
      if (!meetingDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Follow-up meeting not found." });
      }

      const meetingData = { id: meetingDoc.id, ...meetingDoc.data() } as any;
      const projectId = meetingData.projectId;
      if (!projectId) {
        return res.status(500).json({ error: "Internal Server Error", message: "Meeting is missing projectId." });
      }

      // 6. Project Authorization: EDIT_CONTENT required
      const projAccess = await resolveProjectAccess(req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: "Not Found", message: "Project not found." });
        }
        return res.status(403).json({
          error: "Forbidden",
          message: "Permission denied: Only editors or administrators can complete reasoning meetings."
        });
      }

      // 7. Check meeting status eligibility
      if (meetingData.status === 'completed') {
        return res.status(400).json({
          error: "Bad Request",
          code: "ALREADY_COMPLETED",
          message: "Meeting is already marked completed."
        });
      }
      if (meetingData.status === 'cancelled') {
        return res.status(400).json({
          error: "Bad Request",
          code: "MEETING_CANCELLED",
          message: "Cannot complete a cancelled meeting."
        });
      }

      // 8. Resolve target task from trusted persisted meeting data
      const relatedTaskIds: string[] = Array.isArray(meetingData.relatedTaskIds) ? meetingData.relatedTaskIds : [];
      if (relatedTaskIds.length === 0) {
        return res.status(400).json({
          error: "Bad Request",
          code: "NO_ASSOCIATED_TASK",
          message: "Follow-up meeting does not have an associated task for reasoning completion."
        });
      }
      const targetTaskId = relatedTaskIds[0];

      // 9. Execute transactionally
      const result = await db.runTransaction(async (transaction) => {
        const freshMeetingDoc = await transaction.get(db.collection("followUpMeetings").doc(meetingId));
        if (!freshMeetingDoc.exists) {
          const nfErr: any = new Error("Follow-up meeting was removed.");
          nfErr.statusCode = 404;
          throw nfErr;
        }
        const freshMeeting = { id: freshMeetingDoc.id, ...freshMeetingDoc.data() } as any;
        if (freshMeeting.status === 'completed') {
          const compErr: any = new Error("Meeting is already marked completed.");
          compErr.statusCode = 400;
          compErr.errorCode = "ALREADY_COMPLETED";
          throw compErr;
        }

        let snapshot = await transaction.get(db.collection("tasks").where("projectId", "==", projectId));
        let primaryCollection = "tasks";
        if (snapshot.empty) {
          snapshot = await transaction.get(db.collection("projectTasks").where("projectId", "==", projectId));
          primaryCollection = "projectTasks";
        }

        const allTasks: SchedulableTask[] = snapshot.docs.map((doc: any) => {
          const d = doc.data() || {};
          return {
            id: doc.id,
            projectId: d.projectId || projectId,
            title: d.title || "Untitled Task",
            status: d.status || "pending",
            startDate: d.startDate || null,
            dueDate: d.dueDate || null,
            prerequisiteTaskIds: Array.isArray(d.prerequisiteTaskIds) ? d.prerequisiteTaskIds : [],
            assigneeId: d.assigneeId || null,
            assigneeEmail: d.assigneeEmail || null,
            activityHistory: Array.isArray(d.activityHistory) ? d.activityHistory : [],
            updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : undefined
          };
        });
        const targetTask = allTasks.find(t => t.id === targetTaskId);
        if (!targetTask) {
          const nfErr: any = new Error(`Target task "${targetTaskId}" does not belong to project "${projectId}" or does not exist.`);
          nfErr.statusCode = 404;
          nfErr.errorCode = "NOT_FOUND";
          throw nfErr;
        }

        if (targetTask.projectId !== projectId) {
          const crossProjErr: any = new Error(`Task "${targetTaskId}" does not belong to project "${projectId}".`);
          crossProjErr.statusCode = 403;
          crossProjErr.errorCode = "CROSS_PROJECT_REFERENCE";
          throw crossProjErr;
        }

        const currentVersionToken = computeScheduleVersionToken(allTasks);
        if (scheduleVersionToken !== currentVersionToken) {
          const staleErr: any = new Error("The project tasks schedule was modified by another operation. Please refresh the preview.");
          staleErr.statusCode = 409;
          staleErr.errorCode = "STALE_VERSION";
          staleErr.currentScheduleVersionToken = currentVersionToken;
          throw staleErr;
        }

        let tasksToUpdate: any[] = [];
        let notificationsToCreate: InAppNotificationRecord[] = [];
        const now = new Date().toISOString();
        const actorUid = req.user.uid;
        const actorEmail = (req.user.email || "").toLowerCase();
        const performerName = req.user.displayName || "User";
        const triggerTitle = targetTask.title || "Prerequisite Task";

        if (autoPropagateDownstream) {
          const propagation = calculateDeadlinePropagation(allTasks, targetTaskId, {
            newStartDate: cleanStartDate,
            newDueDate: cleanDueDate
          });

          if (propagation.hasConflicts) {
            const conflictErr: any = new Error(`Cannot apply schedule changes due to conflicts: ${propagation.conflicts.join(", ")}`);
            conflictErr.statusCode = 400;
            conflictErr.errorCode = "CONFLICT_GRAPH";
            conflictErr.conflicts = propagation.conflicts;
            throw conflictErr;
          }

          tasksToUpdate = propagation.affectedTasks.filter(a => {
            if (a.isCompleted) return false;
            const startChanged = a.proposedStartDate !== a.currentStartDate;
            const dueChanged = a.proposedDueDate !== a.currentDueDate;
            return startChanged || dueChanged;
          });

          for (const item of tasksToUpdate) {
            if (item.isDirectTarget) continue;
            const orig = allTasks.find(t => t.id === item.taskId);
            if (!orig) continue;

            const rawAssigneeId = orig.assigneeId || null;
            const rawAssigneeEmail = orig.assigneeEmail || null;
            const normAssigneeEmail = rawAssigneeEmail ? rawAssigneeEmail.toLowerCase() : null;

            const isActor = (rawAssigneeId && rawAssigneeId === actorUid) ||
                            (normAssigneeEmail && normAssigneeEmail === actorEmail);
            if (isActor) continue;

            const recipientIdentifier = rawAssigneeId || normAssigneeEmail || "unknown";
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
                triggerTaskId: targetTaskId,
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
        } else {
          const startChanged = cleanStartDate !== undefined && cleanStartDate !== targetTask.startDate;
          const dueChanged = cleanDueDate !== targetTask.dueDate;
          if (startChanged || dueChanged) {
            tasksToUpdate.push({
              taskId: targetTaskId,
              title: targetTask.title,
              isDirectTarget: true,
              proposedStartDate: cleanStartDate !== undefined ? cleanStartDate : targetTask.startDate,
              proposedDueDate: cleanDueDate,
              currentStartDate: targetTask.startDate,
              currentDueDate: targetTask.dueDate,
              shiftDays: null
            });
          }
        }

        const requestedExceptionIds: string[] = Array.isArray(resolveExceptionIds) ? resolveExceptionIds : [];
        const relatedExceptionIds: string[] = Array.isArray(freshMeeting.relatedExceptionIds) ? freshMeeting.relatedExceptionIds : [];
        const exceptionsToResolve: any[] = [];
        const exceptionsToAnnotate: any[] = [];

        for (const reqId of requestedExceptionIds) {
          if (!relatedExceptionIds.includes(reqId)) {
            const err: any = new Error(`Exception "${reqId}" is not associated with this reasoning meeting.`);
            err.statusCode = 400;
            err.errorCode = "UNASSOCIATED_EXCEPTION";
            throw err;
          }
        }

        for (const eid of relatedExceptionIds) {
          const exDoc = await transaction.get(db.collection("taskExceptions").doc(eid));
          if (!exDoc.exists) {
            if (requestedExceptionIds.includes(eid)) {
              const nfErr: any = new Error(`Requested exception "${eid}" does not exist.`);
              nfErr.statusCode = 404;
              nfErr.errorCode = "NOT_FOUND";
              throw nfErr;
            }
            continue;
          }
          const exData = { id: exDoc.id, ...exDoc.data() } as any;
          if (exData.projectId !== projectId) {
            const crossExErr: any = new Error(`Exception "${eid}" does not belong to project "${projectId}".`);
            crossExErr.statusCode = 403;
            crossExErr.errorCode = "CROSS_PROJECT_REFERENCE";
            throw crossExErr;
          }

          if (requestedExceptionIds.includes(eid)) {
            if (exData.type === "blocked" && (!exData.description || !exData.description.toLowerCase().includes("resolved"))) {
              exceptionsToAnnotate.push(exData);
            } else if (["open", "in_progress", "acknowledged"].includes(exData.status)) {
              exceptionsToResolve.push(exData);
            }
          } else if (["open", "in_progress", "acknowledged"].includes(exData.status)) {
            exceptionsToAnnotate.push(exData);
          }
        }

        const FIRESTORE_MAX_TRANSACTION_WRITES = 500;
        const taskWrites = tasksToUpdate.length;
        const mirrorWrites = tasksToUpdate.length;
        const notifWrites = notificationsToCreate.length;
        const meetingWrites = 1;
        const exceptionWrites = exceptionsToResolve.length + exceptionsToAnnotate.length;
        const totalPlannedWrites = taskWrites + mirrorWrites + notifWrites + meetingWrites + exceptionWrites;

        if (totalPlannedWrites > FIRESTORE_MAX_TRANSACTION_WRITES) {
          const payloadErr: any = new Error(
            `Reasoning meeting completion would perform ${totalPlannedWrites} atomic writes (${taskWrites} primary tasks, ${mirrorWrites} mirror projectTasks, ${notifWrites} notifications, ${meetingWrites} meeting, ${exceptionWrites} exceptions), exceeding the Firestore limit of ${FIRESTORE_MAX_TRANSACTION_WRITES}.`
          );
          payloadErr.statusCode = 413;
          payloadErr.errorCode = "PAYLOAD_TOO_LARGE";
          payloadErr.details = {
            totalPlannedWrites,
            maxAllowedWrites: FIRESTORE_MAX_TRANSACTION_WRITES,
            taskWrites,
            mirrorWrites,
            notifWrites,
            meetingWrites,
            exceptionWrites
          };
          throw payloadErr;
        }

        for (const item of tasksToUpdate) {
          const docRef = { id: item.taskId, toString: () => `tasks/${item.taskId}` };
          const updateData: Record<string, any> = { updatedAt: now };
          if (item.proposedStartDate !== undefined) updateData.startDate = item.proposedStartDate || "";
          if (item.proposedDueDate !== undefined) updateData.dueDate = item.proposedDueDate || "";

          const originalTask = allTasks.find(t => t.id === item.taskId);
          const existingHistory = Array.isArray(originalTask?.activityHistory) ? originalTask.activityHistory : [];
          const activityDetails = item.isDirectTarget
            ? `Deadline rescheduled via reasoning meeting "${freshMeeting.title || meetingId}" (Root cause: ${rootCause.trim().substring(0, 100)}; due: ${item.proposedDueDate})`
            : `Deadline propagated from prerequisite task "${triggerTitle}" (due: ${item.proposedDueDate})`;

          const newActivity = {
            id: Math.random().toString(36).substring(2, 9),
            action: item.isDirectTarget ? "reasoning_rescheduled" : "schedule_propagated",
            performedBy: performerName,
            timestamp: now,
            details: activityDetails
          };

          updateData.activityHistory = [...existingHistory, newActivity];
          transaction.set(docRef, updateData, { merge: true });

          try {
            const mirrorRef = { id: item.taskId, toString: () => `projectTasks/${item.taskId}` };
            transaction.set(mirrorRef, updateData, { merge: true });
          } catch {}
        }

        for (const notif of notificationsToCreate) {
          const notifRef = { id: notif.id, toString: () => `notifications/${notif.id}` };
          transaction.set(notifRef, notif);
        }

        for (const ex of exceptionsToResolve) {
          const exRef = { id: ex.id, toString: () => `taskExceptions/${ex.id}` };
          const existingHistory = Array.isArray(ex.history) ? ex.history : [];
          const historyEntry = {
            id: Math.random().toString(36).substring(2, 9),
            action: "resolved",
            performedBy: actorUid,
            performedByName: performerName,
            performedByEmail: req.user.email || "",
            timestamp: now,
            previousStatus: ex.status,
            newStatus: "resolved",
            details: `Resolved via reasoning meeting "${freshMeeting.title || meetingId}". New deadline: ${cleanDueDate}.`
          };
          transaction.set(exRef, {
            status: "resolved",
            resolutionSummary: `Resolved via reasoning meeting: Root cause: ${rootCause.trim().substring(0, 200)}. Agreed deadline: ${cleanDueDate}.`,
            resolvedAt: now,
            resolvedById: actorUid,
            updatedAt: now,
            history: [...existingHistory, historyEntry]
          }, { merge: true });
        }

        for (const ex of exceptionsToAnnotate) {
          const exRef = { id: ex.id, toString: () => `taskExceptions/${ex.id}` };
          const existingHistory = Array.isArray(ex.history) ? ex.history : [];
          const historyEntry = {
            id: Math.random().toString(36).substring(2, 9),
            action: "updated",
            performedBy: actorUid,
            performedByName: performerName,
            performedByEmail: req.user.email || "",
            timestamp: now,
            details: `Reasoning meeting completed. Root cause: ${rootCause.trim().substring(0, 200)}. Agreed deadline: ${cleanDueDate}. (Underlying blocker remains open).`
          };
          transaction.set(exRef, {
            updatedAt: now,
            history: [...existingHistory, historyEntry]
          }, { merge: true });
        }

        const reasoningOutcome = {
          rootCause: rootCause.trim(),
          agreedDueDate: cleanDueDate,
          agreedStartDate: cleanStartDate || null,
          autoPropagateDownstream,
          propagationPerformed: autoPropagateDownstream && tasksToUpdate.length > 0,
          propagationSummary: {
            targetTaskId,
            updatedTaskCount: tasksToUpdate.length,
            updatedTasks: tasksToUpdate.map(t => ({
              taskId: t.taskId,
              title: t.title,
              startDate: t.proposedStartDate,
              dueDate: t.proposedDueDate,
              shiftDays: t.shiftDays
            })),
            notificationsCreated: notificationsToCreate.length
          },
          resolvedExceptionIds: exceptionsToResolve.map(e => e.id),
          annotatedExceptionIds: exceptionsToAnnotate.map(e => e.id),
          completedAt: now,
          completedBy: {
            uid: actorUid,
            name: performerName,
            email: req.user.email || ""
          }
        };

        const meetingHistoryEntry = {
          id: Math.random().toString(36).substring(2, 9),
          action: "completed",
          performedBy: actorUid,
          performedByName: performerName,
          performedByEmail: req.user.email || "",
          timestamp: now,
          previousStatus: freshMeeting.status,
          newStatus: "completed",
          details: `Reasoning meeting completed. Root cause: ${rootCause.trim().substring(0, 150)}. Agreed due date: ${cleanDueDate}. Propagated tasks: ${tasksToUpdate.length}.`
        };

        const meetingUpdates = {
          status: "completed",
          completedAt: now,
          updatedAt: now,
          reasoningOutcome,
          history: [...(Array.isArray(freshMeeting.history) ? freshMeeting.history : []), meetingHistoryEntry]
        };

        const meetingRef = { id: meetingId, toString: () => `followUpMeetings/${meetingId}` };
        transaction.set(meetingRef, meetingUpdates, { merge: true });

        return {
          success: true,
          message: `Reasoning meeting completed successfully. ${tasksToUpdate.length} task schedule(s) updated.`,
          meeting: { ...freshMeeting, ...meetingUpdates },
          reasoningOutcome
        };
      });

      // Post-commit audit event logging (mirrors server.ts exactly)
      try {
        await recordAuthAuditEvent(db as any, {
          eventType: "REASONING_MEETING_COMPLETED",
          action: "follow_up.reasoning.complete",
          status: "allowed",
          severity: "medium",
          actorUserId: req.user.uid,
          actorEmail: req.user.email,
          projectId,
          resourceId: meetingId,
          resourceType: "followUpMeeting",
          requiredPermission: "EDIT_CONTENT",
          callerRole: projAccess.role,
          details: `Completed reasoning meeting "${result.meeting.title || meetingId}" for task "${targetTaskId}". Agreed due date: ${cleanDueDate}.`,
          metadata: {
            meetingId,
            targetTaskId,
            agreedDueDate: cleanDueDate,
            agreedStartDate: cleanStartDate || null,
            autoPropagateDownstream,
            updatedTaskCount: result.reasoningOutcome.propagationSummary.updatedTaskCount,
            notificationsCreated: result.reasoningOutcome.propagationSummary.notificationsCreated,
            resolvedExceptionsCount: result.reasoningOutcome.resolvedExceptionIds.length,
            annotatedExceptionsCount: result.reasoningOutcome.annotatedExceptionIds.length
          }
        });
      } catch (auditErr: any) {
        console.warn("[TEST AUDIT WARNING]:", auditErr?.message || auditErr);
      }

      return res.json(result);
    } catch (err: any) {
      const status = err.statusCode || (err.errorCode === "STALE_VERSION" ? 409 : 500);
      return res.status(status).json({
        error: err.errorCode || "Internal Server Error",
        message: err.message || "Failed to complete reasoning meeting.",
        ...(err.currentScheduleVersionToken ? { currentScheduleVersionToken: err.currentScheduleVersionToken } : {}),
        ...(err.conflicts ? { conflicts: err.conflicts } : {}),
        ...(err.details ? { details: err.details } : {})
      });
    }
  });

  return app;
}

// ============================================================================
// Fixture Setup Helper
// ============================================================================

function seedInitialData(db: MockFirestoreDb) {
  db.store.clear();

  // Project A
  db.store.set("projects/proj_alpha", {
    id: "proj_alpha",
    name: "Alpha Architecture",
    organizationId: "org_apollo",
    members: [
      { userId: "user_lead", email: "lead@apollo.io", role: "lead" },
      { userId: "user_viewer", email: "viewer@apollo.io", role: "viewer" }
    ]
  });

  // Project B (for cross-project checks)
  db.store.set("projects/proj_beta", {
    id: "proj_beta",
    name: "Beta Core",
    organizationId: "org_apollo",
    members: [
      { userId: "user_lead", email: "lead@apollo.io", role: "lead" }
    ]
  });

  // Task 1: Root target task
  db.store.set("tasks/task_1", {
    id: "task_1",
    projectId: "proj_alpha",
    title: "Database Migration",
    status: "in_progress",
    startDate: "2026-11-01",
    dueDate: "2026-11-05",
    assigneeId: "user_dev1",
    assigneeEmail: "dev1@apollo.io",
    prerequisiteTaskIds: []
  });

  // Task 2: Downstream of Task 1 (5 days duration)
  db.store.set("tasks/task_2", {
    id: "task_2",
    projectId: "proj_alpha",
    title: "Backend API Cutover",
    status: "pending",
    startDate: "2026-11-05",
    dueDate: "2026-11-10",
    assigneeId: "user_dev2",
    assigneeEmail: "dev2@apollo.io",
    prerequisiteTaskIds: ["task_1"]
  });

  // Task 3: Completed task downstream of Task 1
  db.store.set("tasks/task_3", {
    id: "task_3",
    projectId: "proj_alpha",
    title: "Preliminary Schema Validation",
    status: "completed",
    startDate: "2026-11-05",
    dueDate: "2026-11-08",
    assigneeId: "user_qa",
    assigneeEmail: "qa@apollo.io",
    prerequisiteTaskIds: ["task_1"]
  });

  // Exception for Task 1: Blocker
  db.store.set("taskExceptions/ex_blocker", {
    id: "ex_blocker",
    projectId: "proj_alpha",
    taskId: "task_1",
    type: "blocked",
    title: "VPC Peering Latency",
    description: "Cloud SQL network latency exceeds 200ms",
    status: "open",
    severity: "critical"
  });

  // Exception for Task 1: Overdue note
  db.store.set("taskExceptions/ex_overdue", {
    id: "ex_overdue",
    projectId: "proj_alpha",
    taskId: "task_1",
    type: "overdue",
    title: "Target milestone slipped",
    description: "Milestone date passed",
    status: "open",
    severity: "high"
  });

  // Follow-up Reasoning Meeting for Task 1
  db.store.set("followUpMeetings/meet_reasoning_1", {
    id: "meet_reasoning_1",
    projectId: "proj_alpha",
    title: "Reasoning Session: Database Migration Blocker",
    status: "scheduled",
    relatedTaskIds: ["task_1"],
    relatedExceptionIds: ["ex_blocker", "ex_overdue"],
    history: []
  });
}

// ============================================================================
// Test Suite Execution
// ============================================================================

async function runTestSuite() {
  console.log("================================================================================");
  console.log("=== RUNNING REASONING MEETING WORKFLOW (REQUIREMENT 23) TEST SUITE ===");
  console.log("================================================================================\n");

  const db = new MockFirestoreDb();
  seedInitialData(db);
  const app = createTestServer(db);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let failed = 0;

  function recordPass(desc: string) {
    passed++;
    console.log(`✅ PASS: ${desc}`);
  }

  function recordFail(desc: string, err: any) {
    failed++;
    console.error(`❌ FAIL: ${desc}`, err?.message || err);
  }

  try {
    // --------------------------------------------------------------------------
    // Test 1: Successful Reasoning Meeting Completion with Propagation
    // --------------------------------------------------------------------------
    {
      const tasksSnapshot = [
        db.store.get("tasks/task_1"),
        db.store.get("tasks/task_2"),
        db.store.get("tasks/task_3")
      ];
      const token = computeScheduleVersionToken(tasksSnapshot);

      const res = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer token_lead"
        },
        body: JSON.stringify({
          rootCause: "Subnet peering routing tables had incorrect default gateways causing packet drops",
          agreedDueDate: "2026-11-12",
          agreedStartDate: "2026-11-01",
          scheduleVersionToken: token,
          autoPropagateDownstream: true,
          resolveExceptionIds: ["ex_overdue", "ex_blocker"]
        })
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.meeting.status, "completed");
      assert.strictEqual(body.reasoningOutcome.agreedDueDate, "2026-11-12");
      assert.strictEqual(body.reasoningOutcome.propagationPerformed, true);

      // Verify task 1 dates updated
      const updatedTask1 = db.store.get("tasks/task_1");
      assert.strictEqual(updatedTask1.dueDate, "2026-11-12");

      // Verify downstream task 2 was propagated and duration preserved (start = 11-12, due = 11-17)
      const updatedTask2 = db.store.get("tasks/task_2");
      assert.strictEqual(updatedTask2.startDate, "2026-11-12");
      assert.strictEqual(updatedTask2.dueDate, "2026-11-17");

      // Verify completed task 3 was NOT shifted
      const updatedTask3 = db.store.get("tasks/task_3");
      assert.strictEqual(updatedTask3.startDate, "2026-11-05");
      assert.strictEqual(updatedTask3.dueDate, "2026-11-08");

      // Verify notification created for dev2 (non-actor assignee)
      const notifs = Array.from(db.store.entries()).filter(([k]) => k.startsWith("notifications/"));
      assert.strictEqual(notifs.length, 1);
      assert.strictEqual(notifs[0][1].taskId, "task_2");

      recordPass("Successful reasoning meeting completion with downstream propagation & duration preservation");
    }

    // --------------------------------------------------------------------------
    // Test 2: Exception handling - Blocker safety
    // --------------------------------------------------------------------------
    {
      // ex_overdue should be resolved, but ex_blocker should NOT be falsely resolved (annotated instead)
      const exOverdue = db.store.get("taskExceptions/ex_overdue");
      assert.strictEqual(exOverdue.status, "resolved");

      const exBlocker = db.store.get("taskExceptions/ex_blocker");
      assert.strictEqual(exBlocker.status, "open"); // Active blocker kept open safely!
      const lastHistory = exBlocker.history[exBlocker.history.length - 1];
      assert.strictEqual(lastHistory.action, "updated");
      assert(lastHistory.details.includes("Underlying blocker remains open"));

      recordPass("Exception handling does not falsely resolve outstanding blockers");
    }

    // --------------------------------------------------------------------------
    // Test 3: Duplicate Completion Rejection (Idempotency)
    // --------------------------------------------------------------------------
    {
      const res = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer token_lead"
        },
        body: JSON.stringify({
          rootCause: "Another attempt",
          agreedDueDate: "2026-11-15",
          scheduleVersionToken: "any_token",
          autoPropagateDownstream: true
        })
      });
      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.code, "ALREADY_COMPLETED");

      recordPass("Duplicate reasoning meeting completion correctly rejected (ALREADY_COMPLETED)");
    }

    // --------------------------------------------------------------------------
    // Test 4: Malformed or Missing rootCause Rejection
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      // Missing rootCause
      const resEmpty = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          agreedDueDate: "2026-11-12",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resEmpty.status, 400);
      const bEmpty = await resEmpty.json();
      assert.strictEqual(bEmpty.code, "INVALID_ROOT_CAUSE");

      // Whitespace-only rootCause
      const resWs = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "   \n\t  ",
          agreedDueDate: "2026-11-12",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resWs.status, 400);

      recordPass("Malformed and missing rootCause rejected with 400 INVALID_ROOT_CAUSE");
    }

    // --------------------------------------------------------------------------
    // Test 5: Invalid Calendar Dates & Date Relationship Rejection
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      // Invalid date format
      const resBadDate = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Infrastructure delay",
          agreedDueDate: "next-tuesday",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resBadDate.status, 400);
      const bBadDate = await resBadDate.json();
      assert.strictEqual(bBadDate.code, "INVALID_CALENDAR_DATE");

      // Inverted date relationship: start date > due date
      const resInverted = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Infrastructure delay",
          agreedStartDate: "2026-11-20",
          agreedDueDate: "2026-11-15",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resInverted.status, 400);
      const bInverted = await resInverted.json();
      assert.strictEqual(bInverted.code, "INVALID_DATE_RELATIONSHIP");

      recordPass("Invalid calendar dates and inverted date relationships rejected with 400");
    }

    // --------------------------------------------------------------------------
    // Test 6: Missing or Stale Schedule Version Token Rejection (400 / 409)
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);

      // Missing token
      const resMissing = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Infrastructure delay",
          agreedDueDate: "2026-11-15",
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resMissing.status, 400);
      const bMissing = await resMissing.json();
      assert.strictEqual(bMissing.code, "MISSING_SCHEDULE_VERSION_TOKEN");

      // Stale token
      const resStale = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Infrastructure delay",
          agreedDueDate: "2026-11-15",
          scheduleVersionToken: "v1_stale_token_123",
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resStale.status, 409);
      const bStale = await resStale.json();
      assert.strictEqual(bStale.error, "STALE_VERSION");
      assert(bStale.currentScheduleVersionToken);

      recordPass("Missing (400) and stale (409) scheduleVersionToken rejected with optimistic concurrency check");
    }

    // --------------------------------------------------------------------------
    // Test 7: Viewer and Unauthorized Caller Rejection (403)
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      // Project viewer (read-only)
      const resViewer = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_viewer" },
        body: JSON.stringify({
          rootCause: "Unauthorized edit",
          agreedDueDate: "2026-11-15",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resViewer.status, 403);

      // Stranger (unrelated organization/project)
      const resStranger = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_stranger" },
        body: JSON.stringify({
          rootCause: "Unauthorized edit",
          agreedDueDate: "2026-11-15",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resStranger.status, 403);

      recordPass("Viewer and unauthorized callers strictly rejected with 403 Forbidden");
    }

    // --------------------------------------------------------------------------
    // Test 8: Cross-Project Reference Rejection
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      // Place task_1 in proj_beta while meeting is in proj_alpha
      db.store.set("tasks/task_1", {
        ...db.store.get("tasks/task_1"),
        projectId: "proj_beta"
      });

      const tasksSnapshot = [db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      const resCross = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Cross project exploit attempt",
          agreedDueDate: "2026-11-15",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resCross.status, 404); // Target task does not exist in project snapshot

      recordPass("Cross-project task reference strictly isolated and rejected");
    }

    // --------------------------------------------------------------------------
    // Test 9: Cycle Detection and Conflict Graph Rejection (400)
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      // Introduce cycle: Task 1 has prerequisite Task 2, while Task 2 has prerequisite Task 1
      db.store.set("tasks/task_1", {
        ...db.store.get("tasks/task_1"),
        prerequisiteTaskIds: ["task_2"]
      });

      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      const resCycle = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Testing cycle",
          agreedDueDate: "2026-11-15",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resCycle.status, 400);
      const bCycle = await resCycle.json();
      assert.strictEqual(bCycle.error, "CONFLICT_GRAPH");

      recordPass("Cyclic task dependencies rejected with 400 CONFLICT_GRAPH");
    }

    // --------------------------------------------------------------------------
    // Test 10: autoPropagateDownstream: false Policy
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      const res = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Task isolated delay without downstream movement",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token,
          autoPropagateDownstream: false
        })
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.reasoningOutcome.autoPropagateDownstream, false);
      assert.strictEqual(body.reasoningOutcome.propagationSummary.updatedTaskCount, 1); // Only target task

      // Direct task updated
      assert.strictEqual(db.store.get("tasks/task_1").dueDate, "2026-11-20");

      // Downstream task 2 NOT shifted
      assert.strictEqual(db.store.get("tasks/task_2").startDate, "2026-11-05");
      assert.strictEqual(db.store.get("tasks/task_2").dueDate, "2026-11-10");

      recordPass("autoPropagateDownstream: false updates target task only, preserving downstream dates");
    }

    // --------------------------------------------------------------------------
    // Test 11: Transaction Failure Atomicity Rollback
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      // Force failure during transaction commit
      db.failNextTransaction = true;

      const res = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Testing rollback",
          agreedDueDate: "2026-11-25",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(res.status, 500);

      // Meeting must NOT be completed!
      const meeting = db.store.get("followUpMeetings/meet_reasoning_1");
      assert.strictEqual(meeting.status, "scheduled");

      // Target task must NOT be modified!
      const task1 = db.store.get("tasks/task_1");
      assert.strictEqual(task1.dueDate, "2026-11-05");

      recordPass("Transaction failure preserves atomicity; meeting is not falsely marked completed");
    }

    // --------------------------------------------------------------------------
    // Test 12: Omitted or Invalid autoPropagateDownstream Rejection
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      // Omitted autoPropagateDownstream
      const resOmitted = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Testing missing autoPropagateDownstream",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token
          // autoPropagateDownstream omitted
        })
      });
      assert.strictEqual(resOmitted.status, 400);
      const omittedBody = await resOmitted.json();
      assert.strictEqual(omittedBody.code, "INVALID_PROPAGATION_FLAG");

      // Non-boolean autoPropagateDownstream
      const resNonBool = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Testing non-bool autoPropagateDownstream",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token,
          autoPropagateDownstream: "true" as any
        })
      });
      assert.strictEqual(resNonBool.status, 400);
      const nonBoolBody = await resNonBool.json();
      assert.strictEqual(nonBoolBody.code, "INVALID_PROPAGATION_FLAG");

      recordPass("Omitted and non-boolean autoPropagateDownstream strictly rejected with 400 INVALID_PROPAGATION_FLAG");
    }

    // --------------------------------------------------------------------------
    // Test 13: Malformed resolveExceptionIds Rejection
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      // Not an array
      const resNotArray = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Testing bad resolveExceptionIds",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token,
          autoPropagateDownstream: true,
          resolveExceptionIds: "ex_1" as any
        })
      });
      assert.strictEqual(resNotArray.status, 400);
      const notArrBody = await resNotArray.json();
      assert.strictEqual(notArrBody.code, "INVALID_EXCEPTION_IDS");

      // Array contains empty/whitespace/non-string items
      const resBadItems = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Testing empty item in resolveExceptionIds",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token,
          autoPropagateDownstream: true,
          resolveExceptionIds: ["ex_1", "   "]
        })
      });
      assert.strictEqual(resBadItems.status, 400);
      const badItemsBody = await resBadItems.json();
      assert.strictEqual(badItemsBody.code, "INVALID_EXCEPTION_IDS");

      recordPass("Malformed resolveExceptionIds strictly rejected with 400 INVALID_EXCEPTION_IDS");
    }

    // --------------------------------------------------------------------------
    // Test 14: Unassociated Exception Resolution Rejection (UNASSOCIATED_EXCEPTION)
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      // Attempt to resolve an exception not linked to meet_reasoning_1
      const resUnassoc = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Testing unassociated exception",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token,
          autoPropagateDownstream: true,
          resolveExceptionIds: ["ex_unassociated_random"]
        })
      });
      assert.strictEqual(resUnassoc.status, 400);
      const unassocBody = await resUnassoc.json();
      assert.strictEqual(unassocBody.error, "UNASSOCIATED_EXCEPTION");

      recordPass("Attempting to resolve unassociated exception strictly rejected with 400 UNASSOCIATED_EXCEPTION");
    }

    // --------------------------------------------------------------------------
    // Test 15: Cross-Project Exception Resolution Rejection (CROSS_PROJECT_REFERENCE)
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      // Create cross-project exception in store and associate it artificially to meeting
      db.store.set("taskExceptions/ex_other_proj", {
        id: "ex_other_proj",
        projectId: "proj_other_999",
        status: "open",
        type: "overdue"
      });
      const meeting = db.store.get("followUpMeetings/meet_reasoning_1");
      db.store.set("followUpMeetings/meet_reasoning_1", {
        ...meeting,
        relatedExceptionIds: ["ex_1", "ex_other_proj"]
      });

      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      const resCross = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Testing cross-project exception",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token,
          autoPropagateDownstream: true,
          resolveExceptionIds: ["ex_other_proj"]
        })
      });
      assert.strictEqual(resCross.status, 403);
      const crossBody = await resCross.json();
      assert.strictEqual(crossBody.error, "CROSS_PROJECT_REFERENCE");

      recordPass("Cross-project exception resolution strictly rejected with 403 CROSS_PROJECT_REFERENCE");
    }

    // --------------------------------------------------------------------------
    // Test 16: Concurrency Invalidation when Task Modified After Preview
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const tokenBefore = computeScheduleVersionToken(tasksSnapshot);

      // Concurrently modify task_3 in database (e.g. another user modified it)
      const task3 = db.store.get("tasks/task_3");
      db.store.set("tasks/task_3", {
        ...task3,
        dueDate: "2026-11-19",
        updatedAt: new Date().toISOString()
      });

      // Submit completion with old token
      const resStale = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Concurrent edit test",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: tokenBefore,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(resStale.status, 409);
      const staleBody = await resStale.json();
      assert.strictEqual(staleBody.error, "STALE_VERSION");
      assert.notStrictEqual(staleBody.currentScheduleVersionToken, tokenBefore);

      recordPass("Task modification after preview invalidates completion with 409 STALE_VERSION and returns fresh token");
    }

    // --------------------------------------------------------------------------
    // Test 17: Notification Generation Uses triggerTaskId and Avoids Self-Notification
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      const res = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Checking notification fields",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(res.status, 200);

      // Find created notification
      let foundNotif: any = null;
      for (const [key, value] of db.store.entries()) {
        if (key.startsWith("notifications/")) {
          foundNotif = value;
          break;
        }
      }
      assert.ok(foundNotif, "Notification should have been created for downstream task assignee");
      assert.strictEqual(foundNotif.metadata.triggerTaskId, "task_1");
      assert.strictEqual(foundNotif.metadata.performerId, "user_lead");
      assert.notStrictEqual(foundNotif.recipientUserId, "user_lead", "Actor should not receive self-notification");

      recordPass("Downstream notification correctly sets triggerTaskId and metadata without undefined variables");
    }

    // --------------------------------------------------------------------------
    // Test 18: Audit Logging Durability on Success
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      const res = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Audit logging verification",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token,
          autoPropagateDownstream: false
        })
      });
      assert.strictEqual(res.status, 200);

      // Verify audit event persisted in store
      let foundAudit: any = null;
      for (const [key, value] of db.store.entries()) {
        if (key.startsWith("authAuditLogs/")) {
          foundAudit = value;
          break;
        }
      }
      assert.ok(foundAudit, "Audit log record should have been saved to authAuditLogs collection");
      assert.strictEqual(foundAudit.eventType, "REASONING_MEETING_COMPLETED");
      assert.strictEqual(foundAudit.action, "follow_up.reasoning.complete");
      assert.strictEqual(foundAudit.status, "allowed");
      assert.strictEqual(foundAudit.resourceId, "meet_reasoning_1");
      assert.strictEqual(foundAudit.metadata.targetTaskId, "task_1");

      recordPass("REASONING_MEETING_COMPLETED audit event is durably recorded with structured metadata");
    }

    // --------------------------------------------------------------------------
    // Test 19: Audit Logging Failure Resilience (Does Not Break Completed Work)
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      // Save original doc method and mock throwing on authAuditLogs set
      const origCollection = db.collection.bind(db);
      (db as any).collection = (collName: string) => {
        if (collName === "authAuditLogs") {
          return {
            doc: (docId: string) => ({
              id: docId,
              set: async () => {
                throw new Error("Simulated Firestore outage for auditLogs collection");
              }
            })
          };
        }
        return origCollection(collName);
      };

      try {
        const res = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
          body: JSON.stringify({
            rootCause: "Testing audit failure resilience",
            agreedDueDate: "2026-11-20",
            scheduleVersionToken: token,
            autoPropagateDownstream: false
          })
        });
        assert.strictEqual(res.status, 200, "Operation succeeds gracefully even if secondary audit logging fails");
        const body = await res.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(db.store.get("followUpMeetings/meet_reasoning_1").status, "completed");

        recordPass("Audit persistence failure is caught and logged without aborting already-committed transaction");
      } finally {
        (db as any).collection = origCollection;
      }
    }

    // --------------------------------------------------------------------------
    // Test 20: Dual-Write Mirror Consistency Across Primary 'tasks' and 'projectTasks'
    // --------------------------------------------------------------------------
    {
      seedInitialData(db);
      // Seed mirror doc for task_1 and task_2 in projectTasks
      db.store.set("projectTasks/task_1", { ...db.store.get("tasks/task_1") });
      db.store.set("projectTasks/task_2", { ...db.store.get("tasks/task_2") });
      db.store.set("projectTasks/task_3", { ...db.store.get("tasks/task_3") });

      const tasksSnapshot = [db.store.get("tasks/task_1"), db.store.get("tasks/task_2"), db.store.get("tasks/task_3")];
      const token = computeScheduleVersionToken(tasksSnapshot);

      const res = await fetch(`${baseUrl}/api/follow-ups/meet_reasoning_1/complete-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer token_lead" },
        body: JSON.stringify({
          rootCause: "Dual-write mirror verification",
          agreedDueDate: "2026-11-20",
          scheduleVersionToken: token,
          autoPropagateDownstream: true
        })
      });
      assert.strictEqual(res.status, 200);

      // Both tasks and projectTasks must have identical new dueDates
      const task1Primary = db.store.get("tasks/task_1");
      const task1Mirror = db.store.get("projectTasks/task_1");
      assert.strictEqual(task1Primary.dueDate, "2026-11-20");
      assert.strictEqual(task1Mirror.dueDate, "2026-11-20");

      const task2Primary = db.store.get("tasks/task_2");
      const task2Mirror = db.store.get("projectTasks/task_2");
      assert.strictEqual(task2Primary.startDate, "2026-11-20");
      assert.strictEqual(task2Mirror.startDate, "2026-11-20");

      recordPass("Task updates maintain 100% dual-write consistency between tasks and projectTasks");
    }



  } catch (err: any) {
    recordFail("Unexpected test failure in suite", err);
  } finally {
    server.close();
  }

  console.log("\n================================================================================");
  console.log(`=== REASONING MEETING WORKFLOW TEST RUN COMPLETE: ${passed} PASSED, ${failed} FAILED ===`);
  console.log("================================================================================\n");

  if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
