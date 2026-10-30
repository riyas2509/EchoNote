import { queueReportDeliveries } from './recurringReportDeliveryService.ts';
/**
 * Requirement 24.4 - Recurring Schedule Execution Worker & Report Pipeline
 *
 * Implements:
 * 1. POST /api/internal/reports/process-recurring worker endpoint.
 * 2. Idempotent occurrence state machine with lease claiming, expiry, and fencing tokens.
 * 3. Report generation pipeline reusing services/reportService.ts builders (pptx/xlsx).
 * 4. Safe report artifact persistence to Firebase Admin Storage & generatedReports collection.
 * 5. Optional automatic follow-up meeting creation linked to the occurrence.
 * 6. Deterministic nextRunAt schedule advancement and failure recording.
 */

import crypto from 'crypto';
import express from 'express';
import { db, getFirebaseAdminApp } from './firebaseAdmin.ts';
import { calculateNextOccurrence } from './recurrenceScheduling.ts';
import {
  collectProjectReportData,
  generateMeetingPowerPoint,
  generateMeetingExcel,
  generateProjectStatusPowerPoint,
  generateProjectStatusExcel,
  generateManagementReviewPowerPoint,
  generateManagementReviewExcel,
  REPORT_BOUNDS,
} from '../services/reportService.ts';
import type {
  RecurringSchedule,
  RecurringScheduleOccurrence,
  GeneratedReportArtifact,
  ProcessRecurringResult,
  ReportFormat,
  FollowUpMeeting,
} from '../types.ts';

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_BATCH_SIZE = 10;
const MAX_RETRIES = 3;

/**
 * Derives a canonical, stable occurrence identifier from scheduleId and scheduledFor.
 */
export function getOccurrenceId(scheduleId: string, scheduledFor: string): string {
  const sanitizedIso = scheduledFor.replace(/[^a-zA-Z0-9]/g, '_');
  return scheduleId + '_' + sanitizedIso;
}

/**
 * Computes coverage date range [startDate, endDate] from coverage configuration and occurrence instant.
 */
export function resolveCoverageWindow(
  coverage: RecurringSchedule['coverage'],
  scheduledFor: string,
  lastRunAt?: string | null
): { startDate: string; endDate: string } {
  const targetDate = new Date(scheduledFor);
  const targetIso = targetDate.toISOString().split('T')[0];

  switch (coverage.scope) {
    case 'since_last_run': {
      if (lastRunAt) {
        const lastIso = new Date(lastRunAt).toISOString().split('T')[0];
        return { startDate: lastIso, endDate: targetIso };
      }
      // If no last run recorded, default to rolling 30 days
      const thirtyDaysAgo = new Date(targetDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { startDate: thirtyDaysAgo.toISOString().split('T')[0], endDate: targetIso };
    }
    case 'rolling_7_days': {
      const sevenDaysAgo = new Date(targetDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { startDate: sevenDaysAgo.toISOString().split('T')[0], endDate: targetIso };
    }
    case 'rolling_30_days': {
      const thirtyDaysAgo = new Date(targetDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { startDate: thirtyDaysAgo.toISOString().split('T')[0], endDate: targetIso };
    }
    case 'custom_window': {
      const days = coverage.windowDays && coverage.windowDays > 0 ? coverage.windowDays : 30;
      const windowStart = new Date(targetDate.getTime() - days * 24 * 60 * 60 * 1000);
      return { startDate: windowStart.toISOString().split('T')[0], endDate: targetIso };
    }
    case 'all_time':
    default: {
      return { startDate: '1970-01-01', endDate: targetIso };
    }
  }
}

/**
 * Uploads a report buffer to Firebase Admin Storage, writing to a deterministic occurrence path.
 */
export async function uploadReportArtifact(
  storageService: any,
  storagePath: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  if (!storageService) {
    // In test or non-cloud environments without storage bucket initialized
    return;
  }
  const file = storageService.file(storagePath);
  await file.save(buffer, {
    metadata: {
      contentType,
      cacheControl: 'private, no-cache',
    },
  });
}

/**
 * Core engine for processing due recurring schedules.
 */

/**
 * Transforms ProjectReportData into ManagementReviewData conforming to types.ts
 */
export function buildManagementReviewData(
  projectData: any,
  projectName: string,
  projectId: string,
  reportingPeriod: { startDate: string; endDate: string }
): any {
  const today = new Date();
  const overdueCommitments = (projectData.tasks || [])
    .filter((t: any) => t.isOverdue)
    .map((t: any) => {
      const dueMs = t.dueDate ? new Date(t.dueDate).getTime() : 0;
      const daysOverdue = Math.max(Math.floor((today.getTime() - dueMs) / (24 * 60 * 60 * 1000)), 1);
      return {
        taskTitle: t.title || 'Untitled Task',
        owner: t.assigneeName || t.assigneeEmail || 'Unassigned',
        dueDate: t.dueDate || 'Unset',
        daysOverdue,
        priority: t.priority || 'medium',
      };
    });

  const blockersAndRisks = (projectData.tasks || [])
    .filter((t: any) => t.dependencyStatus === 'blocked' || (t.blockingPrerequisitesCount && t.blockingPrerequisitesCount > 0))
    .map((t: any) => ({
      taskTitle: t.title || 'Untitled Task',
      severity: t.priority === 'urgent' || t.priority === 'high' ? 'High' : 'Medium',
      blockerReason: 'Waiting on ' + (t.blockingPrerequisitesCount || 1) + ' prerequisite dependencies',
      owner: t.assigneeName || t.assigneeEmail || 'Unassigned',
    }));

  const metrics = projectData.metrics || {
    totalTasks: 0,
    completedTasks: 0,
    inProgressTasks: 0,
    pendingTasks: 0,
    overdueTasks: 0,
    tasksWithoutDeadline: 0,
    tasksDueNext7Days: 0,
    blockedTasks: 0,
  };

  const execSummary = [
    'Portfolio tracking ' + metrics.totalTasks + ' total tasks across active work streams.',
    metrics.completedTasks + ' deliverables completed (' + (metrics.totalTasks > 0 ? Math.round((metrics.completedTasks / metrics.totalTasks) * 100) : 0) + '% completion rate).',
    metrics.overdueTasks + ' commitments currently overdue requiring management review.',
  ];

  return {
    projectName,
    projectId,
    reportingPeriod,
    generatedAt: new Date().toISOString(),
    executiveSummary: execSummary,
    metrics,
    majorMilestones: [],
    keyDecisions: (projectData.decisions || []).map((d: any) => ({
      decision: d.title || d.decision || '',
      context: d.source || '',
      date: d.date || today.toISOString().split('T')[0],
    })),
    blockersAndRisks,
    overdueCommitments,
    sourceMeetings: (projectData.meetings || []).map((m: any) => ({
      id: m.id || '',
      title: m.title || '',
      date: m.date || today.toISOString().split('T')[0],
    })),
  };
}

export async function processDueRecurringSchedules(
  firestoreDb: any,
  storageService: any,
  options?: {
    workerId?: string;
    nowMs?: number;
    batchSize?: number;
    leaseDurationMs?: number;
  }
): Promise<ProcessRecurringResult> {
  const activeWorkerId = options?.workerId || ('worker_' + crypto.randomUUID().substring(0, 8));
  const nowMs = options?.nowMs || Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const batchLimit = Math.min(options?.batchSize || MAX_BATCH_SIZE, 50);
  const leaseDurationMs = options?.leaseDurationMs || DEFAULT_LEASE_DURATION_MS;

  const result: ProcessRecurringResult = {
    claimedCount: 0,
    completedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    occurrences: [],
  };

  // 1. Query active schedules where nextRunAt <= nowIso
  const schedulesSnap = await firestoreDb.collection('recurringSchedules')
    .where('active', '==', true)
    .where('nextRunAt', '<=', nowIso)
    .limit(batchLimit)
    .get();

  const dueSchedules: RecurringSchedule[] = [];
  schedulesSnap.forEach((doc: any) => {
    dueSchedules.push({ ...doc.data(), id: doc.id });
  });

  for (const schedule of dueSchedules) {
    const scheduledFor = schedule.nextRunAt;
    const occurrenceId = getOccurrenceId(schedule.id, scheduledFor);
    const occurrenceRef = firestoreDb.collection('recurringScheduleOccurrences').doc(occurrenceId);

    let claimedFencingToken: number | null = null;
    let initialOccurrenceData: RecurringScheduleOccurrence | null = null;

    // 2. Transactionally claim the occurrence
    try {
      await firestoreDb.runTransaction(async (transaction: any) => {
        const occSnap = await transaction.get(occurrenceRef);
        const schedSnap = await transaction.get(firestoreDb.collection('recurringSchedules').doc(schedule.id));

        if (!schedSnap.exists || !schedSnap.data().active) {
          throw new Error('SCHEDULE_INACTIVE');
        }

        if (occSnap.exists) {
          const occ = occSnap.data() as RecurringScheduleOccurrence;
          if (occ.status === 'succeeded') {
            throw new Error('ALREADY_COMPLETED');
          }

          // Check if active lease exists
          if (occ.status === 'processing' && occ.lease) {
            const expiryMs = new Date(occ.lease.leaseExpiresAt).getTime();
            if (nowMs < expiryMs) {
              throw new Error('LEASE_ACTIVE');
            }
          }

          // Check max retries
          if (occ.retryCount >= MAX_RETRIES) {
            throw new Error('MAX_RETRIES_EXCEEDED');
          }

          const nextToken = (occ.lease?.fencingToken || 0) + 1;
          claimedFencingToken = nextToken;
          const leaseExpiresAt = new Date(nowMs + leaseDurationMs).toISOString();

          const updatedOcc: Partial<RecurringScheduleOccurrence> = {
            status: 'processing',
            lease: {
              workerId: activeWorkerId,
              leaseExpiresAt,
              fencingToken: nextToken,
            },
            claimedAt: nowIso,
            updatedAt: nowIso,
          };

          transaction.update(occurrenceRef, updatedOcc);
          initialOccurrenceData = { ...occ, ...updatedOcc } as RecurringScheduleOccurrence;
        } else {
          // First claim on this occurrence
          claimedFencingToken = 1;
          const leaseExpiresAt = new Date(nowMs + leaseDurationMs).toISOString();

          const newOcc: RecurringScheduleOccurrence = {
            id: occurrenceId,
            scheduleId: schedule.id,
            projectId: schedule.projectId,
            organizationId: schedule.organizationId,
            scheduledFor,
            status: 'processing',
            lease: {
              workerId: activeWorkerId,
              leaseExpiresAt,
              fencingToken: 1,
            },
            artifacts: [],
            meetingId: null,
            retryCount: 0,
            claimedAt: nowIso,
            completedAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          };

          transaction.set(occurrenceRef, newOcc);
          initialOccurrenceData = newOcc;
        }
      });
    } catch (claimErr: any) {
      if (claimErr.message === 'ALREADY_COMPLETED' || claimErr.message === 'LEASE_ACTIVE' || claimErr.message === 'SCHEDULE_INACTIVE' || claimErr.message === 'MAX_RETRIES_EXCEEDED') {
        result.skippedCount++;
        result.occurrences.push({
          occurrenceId,
          scheduleId: schedule.id,
          status: 'pending',
          error: claimErr.message,
        });
        continue;
      }
      result.failedCount++;
      result.occurrences.push({
        occurrenceId,
        scheduleId: schedule.id,
        status: 'failed',
        error: claimErr.message,
      });
      continue;
    }

    result.claimedCount++;

    // 3. Execution Phase: generate artifacts and optional meeting
    try {
      // Fetch project details for report generation
      const projectDoc = await firestoreDb.collection('projects').doc(schedule.projectId).get();
      if (!projectDoc.exists) {
        throw new Error('Project not found: ' + schedule.projectId);
      }
      const projectData = projectDoc.data();
      const projectName = projectData.name || 'Project';

      // Resolve reporting period
      const reportingPeriod = resolveCoverageWindow(
        schedule.coverage,
        scheduledFor,
        schedule.execution?.lastRunAt
      );

      // Collect project data
      const boundedResult = await collectProjectReportData(
        firestoreDb,
        schedule.projectId,
        projectName,
        reportingPeriod
      );

      const generatedArtifacts: GeneratedReportArtifact[] = [];

      for (const format of schedule.formats) {
        let buffer: Buffer;
        let contentType: string;
        let extension: string;

        if (format === 'pptx') {
          contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
          extension = 'pptx';
          if (schedule.reportType === 'project_status') {
            buffer = await generateProjectStatusPowerPoint(boundedResult.projectData);
          } else if (schedule.reportType === 'management_review') {
            const reviewData = buildManagementReviewData(boundedResult.projectData, projectName, schedule.projectId, reportingPeriod);
            buffer = await generateManagementReviewPowerPoint(reviewData);
          } else {
            // meeting_summary requested for recurring schedule without specific meetingId
            buffer = await generateProjectStatusPowerPoint(boundedResult.projectData);
          }
        } else {
          // xlsx
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          extension = 'xlsx';
          if (schedule.reportType === 'project_status') {
            buffer = await generateProjectStatusExcel(boundedResult.projectData);
          } else if (schedule.reportType === 'management_review') {
            const reviewData = buildManagementReviewData(boundedResult.projectData, projectName, schedule.projectId, reportingPeriod);
            buffer = await generateManagementReviewExcel(reviewData);
          } else {
            buffer = await generateProjectStatusExcel(boundedResult.projectData);
          }
        }

        const artifactId = 'art_' + crypto.randomUUID().substring(0, 12);
        const storagePath = 'reports/' + schedule.projectId + '/' + occurrenceId + '/' + artifactId + '.' + extension;

        await uploadReportArtifact(storageService, storagePath, buffer, contentType);

        const artifactMeta: GeneratedReportArtifact = {
          id: artifactId,
          occurrenceId,
          scheduleId: schedule.id,
          projectId: schedule.projectId,
          organizationId: schedule.organizationId,
          reportType: schedule.reportType,
          format,
          storagePath,
          contentType,
          fileSizeBytes: buffer.length,
          reportingPeriod,
          isTruncated: Boolean(boundedResult.isTruncated),
          warnings: boundedResult.warnings || [],
          generatedAt: new Date().toISOString(),
        };

        // Persist artifact metadata to generatedReports collection
        await firestoreDb.collection('generatedReports').doc(artifactId).set(artifactMeta);
        generatedArtifacts.push(artifactMeta);
      }

      // 4. Optional Automatic Meeting Creation
      let createdMeetingId: string | null = null;
      if (schedule.meetingAutomation && schedule.meetingAutomation.enabled) {
        const meetingRef = firestoreDb.collection('followUpMeetings').doc();
        createdMeetingId = meetingRef.id;

        const meetingTitle = (schedule.meetingAutomation.meetingTitleTemplate || 'Recurring Review: {reportType}')
          .replace('{reportType}', schedule.reportType.replace('_', ' '))
          .replace('{projectName}', projectName);

        const durationMinutes = schedule.meetingAutomation.meetingDurationMinutes || 30;
        const proposedStart = new Date(scheduledFor);
        const proposedEnd = new Date(proposedStart.getTime() + durationMinutes * 60 * 1000);

        const meetingRecord: any = {
          id: createdMeetingId,
          projectId: schedule.projectId,
          organizationId: schedule.organizationId,
          title: meetingTitle,
          purpose: 'Automated recurring report review meeting for ' + schedule.title,
          status: 'scheduled',
          proposedStartTime: proposedStart.toISOString(),
          proposedEndTime: proposedEnd.toISOString(),
          timezone: schedule.schedule.timeZone,
          proposedParticipants: schedule.delivery.recipients.map(email => ({
            email,
            name: email,
            role: 'participant',
          })),
          relatedScheduleId: schedule.id,
          relatedOccurrenceId: occurrenceId,
          history: [{
            id: crypto.randomUUID().substring(0, 8),
            action: 'created',
            performedBy: 'automated_worker',
            performedByName: 'EchoNote Scheduler',
            performedByEmail: 'system@echonote.ai',
            timestamp: nowIso,
            previousStatus: null,
            newStatus: 'scheduled',
            details: 'Automatically created by recurring schedule ' + schedule.title,
          }],
          createdBy: schedule.createdBy.uid,
          creatorName: schedule.createdBy.name,
          creatorEmail: schedule.createdBy.email,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        await meetingRef.set(meetingRecord);
      }

      // 5. Finalize Occurrence & Advance Schedule via Transaction
      await firestoreDb.runTransaction(async (transaction: any) => {
        const occSnap = await transaction.get(occurrenceRef);
        if (!occSnap.exists) {
          throw new Error('OCCURRENCE_DELETED');
        }
        const occ = occSnap.data() as RecurringScheduleOccurrence;

        // Fencing token check: ensure worker still owns lease
        if (occ.lease?.workerId !== activeWorkerId || occ.lease?.fencingToken !== claimedFencingToken) {
          throw new Error('LEASE_SUPERSEDED');
        }

        const schedSnap = await transaction.get(firestoreDb.collection('recurringSchedules').doc(schedule.id));
        if (!schedSnap.exists) {
          throw new Error('SCHEDULE_NOT_FOUND');
        }
        const latestSchedule = schedSnap.data() as RecurringSchedule;

        // Calculate next occurrence strictly after the current scheduledFor instant
        const nextOcc = calculateNextOccurrence(latestSchedule.schedule, scheduledFor);
        const nextRunAt = nextOcc ? nextOcc.nextOccurrence : null;
        const shouldDeactivate = nextOcc === null; // Expired recurrence schedule

        // Update occurrence as succeeded
        transaction.update(occurrenceRef, {
          status: 'succeeded',
          lease: null,
          artifacts: generatedArtifacts,
          meetingId: createdMeetingId,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Advance schedule nextRunAt
        transaction.update(firestoreDb.collection('recurringSchedules').doc(schedule.id), {
          nextRunAt,
          active: shouldDeactivate ? false : latestSchedule.active,
          'execution.lastRunAt': nowIso,
          'execution.lastRunStatus': 'success',
          'execution.lastError': null,
          'execution.consecutiveFailures': 0,
          'execution.totalRunCount': (latestSchedule.execution?.totalRunCount || 0) + 1,
          updatedAt: nowIso,
        });
      });

      result.completedCount++;
      result.occurrences.push({
        occurrenceId,
        scheduleId: schedule.id,
        status: 'succeeded',
      });

      // Queue report ready delivery notifications (Requirement 24.5)
      try {
        await queueReportDeliveries(firestoreDb, {
          schedule,
          occurrence: {
            id: occurrenceId,
            scheduleId: schedule.id,
            projectId: schedule.projectId,
            organizationId: schedule.organizationId,
            scheduledFor,
            status: 'succeeded',
            artifacts: generatedArtifacts,
            meetingId: createdMeetingId,
            retryCount: 0,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          notificationType: 'report_ready',
        });
      } catch (queueErr) {
        console.warn('[RECURRING_WORKER] Warning: Failed to queue report delivery notifications:', queueErr);
      }
    } catch (execErr: any) {
      result.failedCount++;
      result.occurrences.push({
        occurrenceId,
        scheduleId: schedule.id,
        status: 'failed',
        error: execErr.message,
      });

      // Queue failure alert notification if enabled (Requirement 24.5)
      try {
        if (schedule.delivery?.notifyOnFailure) {
          await queueReportDeliveries(firestoreDb, {
            schedule,
            occurrence: {
              id: occurrenceId,
              scheduleId: schedule.id,
              projectId: schedule.projectId,
              organizationId: schedule.organizationId,
              scheduledFor,
              status: 'failed',
              artifacts: [],
              meetingId: null,
              retryCount: 1,
              error: execErr.message,
              createdAt: nowIso,
              updatedAt: nowIso,
            },
            notificationType: 'report_failed',
            errorMessage: execErr.message,
          });
        }
      } catch (queueFailErr) {
        console.warn('[RECURRING_WORKER] Warning: Failed to queue failure notification:', queueFailErr);
      }

      // Record occurrence failure and schedule failure count
      try {
        await firestoreDb.runTransaction(async (transaction: any) => {
          const occSnap = await transaction.get(occurrenceRef);
          if (occSnap.exists) {
            const occ = occSnap.data() as RecurringScheduleOccurrence;
            // Only update if worker still owns lease
            if (occ.lease?.fencingToken === claimedFencingToken) {
              transaction.update(occurrenceRef, {
                status: 'failed',
                lease: null,
                error: execErr.message,
                retryCount: (occ.retryCount || 0) + 1,
                updatedAt: new Date().toISOString(),
              });
            }
          }

          const schedSnap = await transaction.get(firestoreDb.collection('recurringSchedules').doc(schedule.id));
          if (schedSnap.exists) {
            const s = schedSnap.data() as RecurringSchedule;
            transaction.update(firestoreDb.collection('recurringSchedules').doc(schedule.id), {
              'execution.lastRunAt': nowIso,
              'execution.lastRunStatus': 'failed',
              'execution.lastError': execErr.message,
              'execution.consecutiveFailures': (s.execution?.consecutiveFailures || 0) + 1,
              updatedAt: nowIso,
            });
          }
        });
      } catch {}
    }
  }

  return result;
}

/**
 * Registers the internal worker endpoint: POST /api/internal/reports/process-recurring
 */
export function registerRecurringWorkerRoutes(
  app: express.Express,
  customDb?: any,
  customStorage?: any,
  customAuthFn?: (req: express.Request) => Promise<{ authorized: boolean; reason?: string }>
): void {
  const activeDb = customDb || db;
  const activeStorage = customStorage || null;

  app.post('/api/internal/reports/process-recurring', async (req: express.Request, res: express.Response) => {
    try {
      // 1. Worker Authentication
      if (customAuthFn) {
        const auth = await customAuthFn(req);
        if (!auth.authorized) {
          return res.status(401).json({ error: 'Unauthorized', message: auth.reason || 'Worker authentication failed' });
        }
      } else {
        const cronKey = req.headers['x-cron-key'];
        const configuredCronSecret = (process.env.CRON_SECRET || '').trim();
        const authHeader = req.headers.authorization;
        const configuredWorkerSecret = (process.env.INTERNAL_WORKER_SECRET || '').trim();

        let isAuthorized = false;
        if (typeof cronKey === 'string' && configuredCronSecret && cronKey === configuredCronSecret) {
          isAuthorized = true;
        } else if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7).trim();
          if (configuredWorkerSecret && token === configuredWorkerSecret) {
            isAuthorized = true;
          }
        }

        if (!isAuthorized) {
          return res.status(401).json({ error: 'Unauthorized', message: 'Valid worker credentials required.' });
        }
      }

      const requestedBatch = Number(req.body?.batchSize || req.query?.batchSize);
      const batchSize = !isNaN(requestedBatch) && requestedBatch > 0 ? requestedBatch : MAX_BATCH_SIZE;

      const result = await processDueRecurringSchedules(activeDb, activeStorage, { batchSize });
      return res.status(200).json({
        success: true,
        message: 'Processed due recurring schedules successfully.',
        ...result,
      });
    } catch (err: any) {
      console.error('[RECURRING_WORKER] Execution error:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to process recurring schedules.' });
    }
  });
}
