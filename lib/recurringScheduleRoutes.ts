import { generateReportDownloadToken } from './recurringReportDeliveryService.ts';
import express from 'express';
import { db } from './firebaseAdmin.ts';
import { requireAuth, resolveProjectAccess, AuthenticatedRequest } from '../middleware/auth.ts';
import { validateRecurrenceConfig, calculateNextOccurrence } from './recurrenceScheduling.ts';
import type {
  RecurringSchedule,
  ReportType,
  ReportFormat,
  ReportCoverageConfig,
  ReportCoverageScope,
  ReportDeliveryConfig,
  MeetingAutomationConfig,
  CreateRecurringScheduleRequest,
  UpdateRecurringScheduleRequest,
} from '../types.ts';

const VALID_REPORT_TYPES: readonly ReportType[] = ['meeting_summary', 'project_status', 'management_review'] as const;
const VALID_REPORT_FORMATS: readonly ReportFormat[] = ['pptx', 'xlsx'] as const;
const VALID_COVERAGE_SCOPES: readonly ReportCoverageScope[] = [
  'all_time',
  'since_last_run',
  'rolling_7_days',
  'rolling_30_days',
  'custom_window',
] as const;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerRecurringScheduleRoutes(
  app: express.Express,
  customDb?: any,
  customAuthMiddleware?: any
): void {
  const activeDb = customDb || db;
  const activeAuth = customAuthMiddleware || requireAuth;

  // 1. GET /api/projects/:projectId/recurring-schedules - List authorized schedules for project
  app.get('/api/projects/:projectId/recurring-schedules', activeAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
        return res.status(400).json({ error: 'Bad Request', message: 'Project ID is required.' });
      }

      // Viewer permission required
      const projAccess = await resolveProjectAccess(activeDb, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess || !projAccess.permissions.canView) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: 'Not Found', message: 'Project not found.' });
        }
        return res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to view schedules for this project.' });
      }

      const schedulesSnap = await activeDb.collection('recurringSchedules')
        .where('projectId', '==', projectId)
        .get();

      const schedules: RecurringSchedule[] = [];
      schedulesSnap.forEach((doc: any) => {
        const data = doc.data() as RecurringSchedule;
        // Tenant isolation guard: verify organizationId matches if project is organization-scoped
        if (projAccess.project?.organizationId && data.organizationId && data.organizationId !== projAccess.project.organizationId) {
          return;
        }
        schedules.push({ ...data, id: doc.id });
      });

      // Sort by createdAt descending
      schedules.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return res.status(200).json({
        success: true,
        schedules,
        total: schedules.length,
      });
    } catch (err: any) {
      console.error('[RECURRING_SCHEDULES] Failed to list recurring schedules:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve recurring schedules.' });
    }
  });

  // 2. POST /api/projects/:projectId/recurring-schedules - Create a recurring schedule
  app.post('/api/projects/:projectId/recurring-schedules', activeAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId } = req.params;
      if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
        return res.status(400).json({ error: 'Bad Request', message: 'Project ID is required.' });
      }

      // Project edit/management permission required
      const projAccess = await resolveProjectAccess(activeDb, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: 'Not Found', message: 'Project not found.' });
        }
        return res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to create schedules for this project.' });
      }

      const body = req.body as CreateRecurringScheduleRequest;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Bad Request', message: 'Request body must be a valid JSON object.' });
      }

      const { title, description, schedule, reportType, formats, coverage, delivery, meetingAutomation, active } = body;

      // Validate title
      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'Bad Request', message: 'Schedule title is required.' });
      }
      if (title.trim().length > 120) {
        return res.status(400).json({ error: 'Bad Request', message: 'Schedule title must not exceed 120 characters.' });
      }

      // Validate description if provided
      if (description !== undefined && description !== null && typeof description !== 'string') {
        return res.status(400).json({ error: 'Bad Request', message: 'Description must be a string.' });
      }

      // Validate schedule configuration using recurrence engine
      if (!schedule || typeof schedule !== 'object') {
        return res.status(400).json({ error: 'Bad Request', message: 'Schedule configuration object is required.' });
      }
      const schedValidation = validateRecurrenceConfig(schedule);
      if (!schedValidation.valid) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid recurrence configuration: ' + schedValidation.errors.join('; '),
          errors: schedValidation.errors,
        });
      }

      // Validate reportType
      if (!reportType || !VALID_REPORT_TYPES.includes(reportType)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid reportType: ' + String(reportType) + '. Must be one of: ' + VALID_REPORT_TYPES.join(', '),
        });
      }

      // Validate formats
      if (!Array.isArray(formats) || formats.length === 0) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'At least one output format is required (pptx, xlsx).',
        });
      }
      for (const fmt of formats) {
        if (!VALID_REPORT_FORMATS.includes(fmt)) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Invalid report format: ' + String(fmt) + '. Supported formats are: ' + VALID_REPORT_FORMATS.join(', '),
          });
        }
      }

      // Validate coverage if provided, otherwise default to all_time
      const resolvedCoverage: ReportCoverageConfig = coverage && typeof coverage === 'object'
        ? coverage
        : { scope: 'all_time' };

      if (!resolvedCoverage.scope || !VALID_COVERAGE_SCOPES.includes(resolvedCoverage.scope)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid coverage scope: ' + String(resolvedCoverage.scope) + '. Supported scopes: ' + VALID_COVERAGE_SCOPES.join(', '),
        });
      }

      if (resolvedCoverage.scope === 'custom_window') {
        if (typeof resolvedCoverage.windowDays !== 'number' || resolvedCoverage.windowDays <= 0 || !Number.isInteger(resolvedCoverage.windowDays)) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'windowDays must be a positive integer when coverage scope is custom_window.',
          });
        }
      }

      // Validate delivery
      if (!delivery || typeof delivery !== 'object') {
        return res.status(400).json({ error: 'Bad Request', message: 'Delivery configuration object is required.' });
      }
      const recipients = delivery.recipients;
      if (!Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: 'Bad Request', message: 'At least one recipient email is required in delivery configuration.' });
      }
      for (const email of recipients) {
        if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
          return res.status(400).json({ error: 'Bad Request', message: 'Invalid recipient email: ' + String(email) + '.' });
        }
      }

      // Validate meetingAutomation if provided
      if (meetingAutomation !== undefined && meetingAutomation !== null) {
        if (typeof meetingAutomation !== 'object' || typeof meetingAutomation.enabled !== 'boolean') {
          return res.status(400).json({ error: 'Bad Request', message: 'meetingAutomation must include boolean enabled flag.' });
        }
      }

      // Calculate initial nextRunAt from referenceInstant (now)
      const nowIso = new Date().toISOString();
      const nextOcc = calculateNextOccurrence(schedule, nowIso);
      if (!nextOcc) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Schedule configuration does not produce any future occurrence within the configured boundaries.',
        });
      }

      const scheduleRef = activeDb.collection('recurringSchedules').doc();
      const creatorInfo = {
        uid: req.user.uid,
        email: req.user.email || '',
        name: req.user.name || req.user.email || 'Unknown User',
      };

      const newSchedule: RecurringSchedule = {
        id: scheduleRef.id,
        projectId,
        organizationId: projAccess.project?.organizationId || null,
        title: title.trim(),
        description: description ? description.trim() : '',
        schedule,
        reportType,
        formats: Array.from(new Set(formats)), // Deduplicate
        coverage: resolvedCoverage,
        delivery: {
          recipients: recipients.map(e => e.trim().toLowerCase()),
          notifyOnFailure: delivery.notifyOnFailure !== undefined ? Boolean(delivery.notifyOnFailure) : true,
        },
        meetingAutomation: meetingAutomation || { enabled: false },
        active: active !== undefined ? Boolean(active) : true,
        nextRunAt: nextOcc.nextOccurrence,
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: creatorInfo,
        updatedBy: creatorInfo,
      };

      await scheduleRef.set(newSchedule);

      return res.status(201).json({
        success: true,
        message: 'Recurring schedule created successfully.',
        schedule: newSchedule,
      });
    } catch (err: any) {
      console.error('[RECURRING_SCHEDULES] Failed to create recurring schedule:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create recurring schedule.' });
    }
  });

  // 3. PATCH /api/projects/:projectId/recurring-schedules/:scheduleId - Update schedule
  app.patch('/api/projects/:projectId/recurring-schedules/:scheduleId', activeAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId, scheduleId } = req.params;
      if (!projectId || !projectId.trim() || !scheduleId || !scheduleId.trim()) {
        return res.status(400).json({ error: 'Bad Request', message: 'Project ID and Schedule ID are required.' });
      }

      // Edit permission required
      const projAccess = await resolveProjectAccess(activeDb, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: 'Not Found', message: 'Project not found.' });
        }
        return res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to modify schedules for this project.' });
      }

      const scheduleRef = activeDb.collection('recurringSchedules').doc(scheduleId);

      // Perform update inside a Firestore transaction for concurrency safety
      const updatedSchedule = await activeDb.runTransaction(async (transaction: any) => {
        const docSnap = await transaction.get(scheduleRef);
        if (!docSnap.exists) {
          const notFoundErr: any = new Error('Schedule not found');
          notFoundErr.code = 'NOT_FOUND';
          throw notFoundErr;
        }

        const existing = docSnap.data() as RecurringSchedule;

        // Cross-project and cross-tenant validation
        if (existing.projectId !== projectId) {
          const crossProjErr: any = new Error('Schedule does not belong to this project');
          crossProjErr.code = 'CROSS_PROJECT';
          throw crossProjErr;
        }
        if (projAccess.project?.organizationId && existing.organizationId && existing.organizationId !== projAccess.project.organizationId) {
          const crossTenantErr: any = new Error('Schedule does not belong to your organization');
          crossTenantErr.code = 'CROSS_TENANT';
          throw crossTenantErr;
        }

        const body = req.body as UpdateRecurringScheduleRequest;
        if (!body || typeof body !== 'object') {
          const badReqErr: any = new Error('Request body must be a valid JSON object');
          badReqErr.code = 'BAD_REQUEST';
          throw badReqErr;
        }

        // Reject attempts to modify protected server fields
        const protectedFields = ['id', 'projectId', "organizationId", 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'nextRunAt', 'execution'];
        for (const f of protectedFields) {
          if (f in body) {
            const protErr: any = new Error('Field: ' + f + ' is protected and cannot be modified.');
            protErr.code = 'PROTECTED_FIELD';
            throw protErr;
          }
        }

        const updates: Partial<RecurringSchedule> = {};

        // Title update
        if (body.title !== undefined) {
          if (typeof body.title !== 'string' || !body.title.trim()) {
            const err: any = new Error('Schedule title must be a non-empty string.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          if (body.title.trim().length > 120) {
            const err: any = new Error('Schedule title must not exceed 120 characters.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          updates.title = body.title.trim();
        }

        // Description update
        if (body.description !== undefined) {
          if (body.description !== null && typeof body.description !== 'string') {
            const err: any = new Error('Description must be a string or null.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          updates.description = body.description ? body.description.trim() : '';
        }

        // Active state update
        if (body.active !== undefined) {
          updates.active = Boolean(body.active);
        }

        // Schedule configuration update
        let mergedSchedule = existing.schedule;
        let scheduleConfigChanged = false;
        if (body.schedule !== undefined) {
          if (!body.schedule || typeof body.schedule !== 'object') {
            const err: any = new Error('schedule must be a valid configuration object.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          mergedSchedule = { ...existing.schedule, ...body.schedule };
          const schedValidation = validateRecurrenceConfig(mergedSchedule);
          if (!schedValidation.valid) {
            const err: any = new Error('Invalid recurrence configuration: ' + schedValidation.errors.join('; '));
            err.code = 'BAD_REQUEST';
            err.errors = schedValidation.errors;
            throw err;
          }
          updates.schedule = mergedSchedule;
          scheduleConfigChanged = true;
        }

        // Report type update
        if (body.reportType !== undefined) {
          if (!VALID_REPORT_TYPES.includes(body.reportType)) {
            const err: any = new Error('Invalid reportType: ' + String(body.reportType) + '. Must be one of: ' + VALID_REPORT_TYPES.join(', '));
            err.code = 'BAD_REQUEST';
            throw err;
          }
          updates.reportType = body.reportType;
        }

        // Formats update
        if (body.formats !== undefined) {
          if (!Array.isArray(body.formats) || body.formats.length === 0) {
            const err: any = new Error('At least one output format is required.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          for (const fmt of body.formats) {
            if (!VALID_REPORT_FORMATS.includes(fmt)) {
              const err: any = new Error('Invalid format: ' + String(fmt) + '. Supported formats: ' + VALID_REPORT_FORMATS.join(', '));
              err.code = 'BAD_REQUEST';
              throw err;
            }
          }
          updates.formats = Array.from(new Set(body.formats));
        }

        // Coverage update
        if (body.coverage !== undefined) {
          if (!body.coverage || typeof body.coverage !== 'object') {
            const err: any = new Error('coverage must be an object.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          if (!VALID_COVERAGE_SCOPES.includes(body.coverage.scope)) {
            const err: any = new Error('Invalid coverage scope: ' + String(body.coverage.scope) + '.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          if (body.coverage.scope === 'custom_window') {
            if (typeof body.coverage.windowDays !== 'number' || body.coverage.windowDays <= 0 || !Number.isInteger(body.coverage.windowDays)) {
              const err: any = new Error('windowDays must be a positive integer when scope is custom_window.');
              err.code = 'BAD_REQUEST';
              throw err;
            }
          }
          updates.coverage = body.coverage;
        }

        // Delivery update
        if (body.delivery !== undefined) {
          if (!body.delivery || typeof body.delivery !== 'object' || !Array.isArray(body.delivery.recipients) || body.delivery.recipients.length === 0) {
            const err: any = new Error('delivery must include at least one recipient.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          for (const email of body.delivery.recipients) {
            if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
              const err: any = new Error('Invalid recipient email: ' + String(email) + '.');
              err.code = 'BAD_REQUEST';
              throw err;
            }
          }
          updates.delivery = {
            recipients: body.delivery.recipients.map(e => e.trim().toLowerCase()),
            notifyOnFailure: body.delivery.notifyOnFailure !== undefined
              ? Boolean(body.delivery.notifyOnFailure)
              : existing.delivery.notifyOnFailure,
          };
        }

        // Meeting automation update
        if (body.meetingAutomation !== undefined) {
          if (typeof body.meetingAutomation !== 'object' || typeof body.meetingAutomation.enabled !== 'boolean') {
            const err: any = new Error('meetingAutomation must include boolean enabled flag.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          updates.meetingAutomation = body.meetingAutomation;
        }

        const nowIso = new Date().toISOString();

        // If schedule configuration changed, recalculate nextRunAt from referenceInstant (now)
        if (scheduleConfigChanged) {
          const nextOcc = calculateNextOccurrence(mergedSchedule, nowIso);
          if (!nextOcc) {
            const err: any = new Error('Updated recurrence configuration does not produce any future occurrence within boundaries.');
            err.code = 'BAD_REQUEST';
            throw err;
          }
          updates.nextRunAt = nextOcc.nextOccurrence;
        }

        updates.updatedAt = nowIso;
        updates.updatedBy = {
          uid: req.user.uid,
          email: req.user.email || '',
          name: req.user.name || req.user.email || 'Unknown User',
        };

        const finalSchedule: RecurringSchedule = {
          ...existing,
          ...updates,
        };

        transaction.update(scheduleRef, updates);
        return finalSchedule;
      });

      return res.status(200).json({
        success: true,
        message: 'Recurring schedule updated successfully.',
        schedule: updatedSchedule,
      });
    } catch (err: any) {
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Not Found', message: err.message });
      }
      if (err.code === 'CROSS_PROJECT' || err.code === 'CROSS_TENANT') {
        return res.status(403).json({ error: 'Forbidden', message: err.message });
      }
      if (err.code === 'BAD_REQUEST' || err.code === 'PROTECTED_FIELD') {
        return res.status(400).json({ error: 'Bad Request', message: err.message, errors: err.errors });
      }
      console.error('[RECURRING_SCHEDULES] Failed to update recurring schedule:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update recurring schedule.' });
    }
  });

  // 4. DELETE /api/projects/:projectId/recurring-schedules/:scheduleId - Delete schedule
  app.delete('/api/projects/:projectId/recurring-schedules/:scheduleId', activeAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId, scheduleId } = req.params;
      if (!projectId || !projectId.trim() || !scheduleId || !scheduleId.trim()) {
        return res.status(400).json({ error: 'Bad Request', message: 'Project ID and Schedule ID are required.' });
      }

      // Edit/management permission required
      const projAccess = await resolveProjectAccess(activeDb, req.user, projectId, { requiredPermission: 'EDIT_CONTENT' });
      if (!projAccess.hasAccess || !projAccess.permissions.canEditContent) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: 'Not Found', message: 'Project not found.' });
        }
        return res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to delete schedules for this project.' });
      }

      const scheduleRef = activeDb.collection('recurringSchedules').doc(scheduleId);
      const scheduleSnap = await scheduleRef.get();

      if (!scheduleSnap.exists) {
        return res.status(404).json({ error: 'Not Found', message: 'Recurring schedule not found.' });
      }

      const scheduleData = scheduleSnap.data() as RecurringSchedule;

      // Project & tenant validation
      if (scheduleData.projectId !== projectId) {
        return res.status(403).json({ error: 'Forbidden', message: 'Schedule does not belong to this project.' });
      }
      if (projAccess.project?.organizationId && scheduleData.organizationId && scheduleData.organizationId !== projAccess.project.organizationId) {
        return res.status(403).json({ error: 'Forbidden', message: 'Schedule does not belong to your organization.' });
      }

      // Permanent removal of the schedule definition (does not touch meetings, tasks, or reports)
      await scheduleRef.delete();

      return res.status(200).json({
        success: true,
        message: 'Recurring schedule deleted successfully.',
        scheduleId,
      });
    } catch (err: any) {
      console.error('[RECURRING_SCHEDULES] Failed to delete recurring schedule:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to delete recurring schedule.' });
    }
  });

  // 5. GET /api/projects/:projectId/recurring-schedules/:scheduleId/history - Occurrence & delivery history
  app.get('/api/projects/:projectId/recurring-schedules/:scheduleId/history', activeAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { projectId, scheduleId } = req.params;

      // Access verification (Read permission)
      const projAccess = await resolveProjectAccess(activeDb, req.user, projectId, { requiredPermission: 'VIEW' });
      if (!projAccess.hasAccess || !projAccess.permissions.canView) {
        if (projAccess.notFound) {
          return res.status(404).json({ error: 'Not Found', message: 'Project not found.' });
        }
        return res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to view schedules for this project.' });
      }

      const scheduleRef = activeDb.collection('recurringSchedules').doc(scheduleId);
      const scheduleSnap = await scheduleRef.get();

      if (!scheduleSnap.exists) {
        return res.status(404).json({ error: 'Not Found', message: 'Recurring schedule not found.' });
      }

      const scheduleData = scheduleSnap.data() as RecurringSchedule;
      if (scheduleData.projectId !== projectId) {
        return res.status(403).json({ error: 'Forbidden', message: 'Schedule does not belong to this project.' });
      }

      // Query occurrences for this schedule
      const occurrencesSnap = await activeDb.collection('recurringScheduleOccurrences')
        .where('scheduleId', '==', scheduleId)
        .get();

      const occurrences: any[] = [];
      const callerEmail = req.user && req.user.email ? req.user.email.toLowerCase() : null;

      for (const doc of occurrencesSnap.docs) {
        const occ = doc.data();

        // For each artifact, generate an authorized, short-lived download URL if caller has email
        const artifactsWithUrls = (occ.artifacts || []).map((art: any) => {
          let downloadUrl: string | undefined = undefined;
          if (callerEmail) {
            try {
              const token = generateReportDownloadToken({
                artifactId: art.id,
                projectId,
                occurrenceId: occ.id,
                email: callerEmail,
                expiresInSeconds: 24 * 3600,
              });
              downloadUrl = '/api/reports/artifacts/' + art.id + '/download?token=' + encodeURIComponent(token);
            } catch (tokenErr) {
              // Silently leave downloadUrl undefined if token generation fails
            }
          }
          return {
            ...art,
            downloadUrl,
          };
        });

        // Query deliveries for this occurrence
        const deliveriesSnap = await activeDb.collection('reportDeliveries')
          .where('occurrenceId', '==', occ.id)
          .get();

        const deliveries = deliveriesSnap.docs.map((dDoc: any) => {
          const dData = dDoc.data();
          // Subject to privacy: sanitize email for privacy (e.g., u***r@domain.com) if not current user
          const rawEmail = dData.recipientEmail || '';
          let displayEmail = rawEmail;
          if (callerEmail && rawEmail.toLowerCase() !== callerEmail) {
            const parts = rawEmail.split('@');
            if (parts.length === 2 && parts[0].length > 2) {
              displayEmail = parts[0][0] + '***' + parts[0][-1] + '@' + parts[1];
            } else if (parts.length === 2) {
              displayEmail = '*@' + parts[1];
            }
          }

          return {
            id: dData.id,
            notificationType: dData.notificationType,
            recipientEmail: displayEmail,
            status: dData.status,
            attempts: dData.attempts,
            maxAttempts: dData.maxAttempts,
            lastError: dData.lastError,
            sentAt: dData.sentAt,
            createdAt: dData.createdAt,
          };
        });

        occurrences.push({
          ...occ,
          artifacts: artifactsWithUrls,
          deliveries,
        });
      }

      // Sort occurrences descending by scheduledFor
      occurrences.sort((a: any, b: any) => new Date(b.scheduledFor || b.createdAt).getTime() - new Date(a.scheduledFor || a.createdAt).getTime());

      return res.status(200).json({
        scheduleId,
        occurrences,
      });
    } catch (err: any) {
      console.error('[RECURRING_SCHEDULES] Failed to fetch schedule history:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch schedule history.' });
    }
  });

}
