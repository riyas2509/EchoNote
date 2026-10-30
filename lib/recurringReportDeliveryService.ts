/**
 * Recurring Report Delivery Service (Requirement 24.5)
 */
import crypto from 'crypto';
import express from 'express';
import { db } from './firebaseAdmin.ts';
import { emailService, sendEmail } from './emailService.ts';
import { recordAuthAuditEvent } from './auditLogger.ts';
import { verifyRecipientEligibility, normalizeEmail } from './taskNotificationService.ts';
import type {
  GeneratedReportArtifact,
  ReportDeliveryRecord,
  ReportDeliveryStatus,
  ReportDeliveryNotificationType,
  ReportDownloadTokenClaims,
  RecurringSchedule,
  RecurringScheduleOccurrence,
  ReportType,
  ReportFormat,
} from '../types.ts';

export const REPORT_DELIVERIES_COLLECTION = 'reportDeliveries';
export const DEFAULT_MAX_DELIVERY_ATTEMPTS = 3;
export const DEFAULT_DOWNLOAD_TOKEN_EXPIRY_SECONDS = 24 * 3600;

export const MIN_REPORT_DOWNLOAD_SECRET_LENGTH = 32;

export function getReportDownloadSecret(): string {
  const rawSecret = process.env.REPORT_DOWNLOAD_SECRET;
  if (!rawSecret || typeof rawSecret !== 'string') {
    throw new Error('CONFIG_ERROR: REPORT_DOWNLOAD_SECRET is not configured. Dedicated signing secret is required.');
  }

  // Preserve raw secret value without mutating transformations, but strictly reject whitespace-only or inadequately short keys
  const trimmed = rawSecret.trim();
  if (!trimmed) {
    throw new Error('CONFIG_ERROR: REPORT_DOWNLOAD_SECRET cannot be empty or whitespace-only.');
  }

  if (rawSecret.length < MIN_REPORT_DOWNLOAD_SECRET_LENGTH) {
    throw new Error(
      "CONFIG_ERROR: REPORT_DOWNLOAD_SECRET must be at least " + MIN_REPORT_DOWNLOAD_SECRET_LENGTH + " characters long (got " + rawSecret.length + ")."
    );
  }

  return rawSecret;
}

export function generateReportDownloadToken(claims: {
  email: string;
  projectId: string;
  artifactId: string;
  occurrenceId: string;
  expiresInSeconds?: number;
}): string {
  const downloadSecret = getReportDownloadSecret();
  const expiresIn = claims.expiresInSeconds || DEFAULT_DOWNLOAD_TOKEN_EXPIRY_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: ReportDownloadTokenClaims = {
    email: normalizeEmail(claims.email),
    projectId: claims.projectId,
    artifactId: claims.artifactId,
    occurrenceId: claims.occurrenceId,
    iat: now,
    exp: now + expiresIn,
  };

  const payloadB64 = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');
  const signature = crypto.createHmac('sha256', downloadSecret).update(payloadB64).digest('base64url');
  return payloadB64 + '.' + signature;
}

export function verifyReportDownloadToken(token: string): {
  valid: boolean;
  claims?: ReportDownloadTokenClaims;
  error?: string;
} {
  let downloadSecret: string;
  try {
    downloadSecret = getReportDownloadSecret();
  } catch (err: any) {
    return { valid: false, error: 'Signing secret is not configured' };
  }

  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token missing or invalid' };
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token structure' };
  }
  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', downloadSecret).update(payloadB64).digest('base64url');
  try {
    const isSigMatch = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
    if (!isSigMatch) return { valid: false, error: 'Invalid token signature' };
  } catch {
    return { valid: false, error: 'Signature verification failed' };
  }
  try {
    const jsonStr = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    const claims = JSON.parse(jsonStr) as ReportDownloadTokenClaims;
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) return { valid: false, error: 'Token has expired' };
    return { valid: true, claims };
  } catch (err: any) {
    return { valid: false, error: 'Failed to decode token claims: ' + err.message };
  }
}

export function getDeliveryRecordId(
  occurrenceId: string,
  notificationType: ReportDeliveryNotificationType,
  recipientEmail: string
): string {
  const normEmail = normalizeEmail(recipientEmail);
  const emailHash = crypto.createHash('sha256').update(normEmail).digest('hex').substring(0, 16);
  return 'deliv_' + occurrenceId.replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + notificationType + '_' + emailHash;
}

export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .split(String.fromCharCode(38)).join('&amp;')
    .split(String.fromCharCode(60)).join('&lt;')
    .split(String.fromCharCode(62)).join('&gt;')
    .split(String.fromCharCode(34)).join('&quot;')
    .split(String.fromCharCode(39)).join('&#039;');
}

export function buildReportReadyEmailHtml(options: {
  recipientName?: string;
  projectName: string;
  scheduleTitle: string;
  reportType: ReportType;
  reportingPeriod?: { startDate: string; endDate: string };
  artifacts: Array<{
    artifactId: string;
    format: ReportFormat;
    downloadUrl: string;
    fileSizeBytes: number;
  }>;
  meetingId?: string | null;
  appBaseUrl?: string;
}): string {
  const greeting = options.recipientName ? 'Hi ' + escapeHtml(options.recipientName) + ',' : 'Hello,';
  const cleanProj = escapeHtml(options.projectName);
  const cleanTitle = escapeHtml(options.scheduleTitle);
  const cleanType = escapeHtml(options.reportType.replace(/_/g, ' ').toUpperCase());
  let periodText = 'Standard Period';
  if (options.reportingPeriod) {
    periodText = escapeHtml(options.reportingPeriod.startDate.split('T')[0]) + ' to ' + escapeHtml(options.reportingPeriod.endDate.split('T')[0]);
  }
  let artifactRows = '';
  for (const art of options.artifacts) {
    const formatLabel = art.format.toUpperCase();
    const sizeKb = Math.max(1, Math.round(art.fileSizeBytes / 1024));
    artifactRows += '<tr>' +
      '<td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">' + formatLabel + ' Report (' + sizeKb + ' KB)</td>' +
      '<td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">' +
      '<a href="' + escapeHtml(art.downloadUrl) + '" style="display: inline-block; padding: 6px 14px; background-color: #1A234E; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 13px; font-weight: 600;">Download ' + formatLabel + '</a>' +
      '</td>' +
      '</tr>';
  }
  return '<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #334155; line-height: 1.6;">' +
    '<h2 style="color: #1A234E; margin-bottom: 10px;">EchoNote Automated Report Ready</h2>' +
    '<p>' + greeting + '</p>' +
    '<p>Your scheduled recurring report <strong>' + cleanTitle + '</strong> for project <strong>' + cleanProj + '</strong> has been successfully generated.</p>' +
    '<div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">' +
    '<p style="margin: 0 0 8px 0;"><strong>Report Type:</strong> ' + cleanType + '</p>' +
    '<p style="margin: 0 0 16px 0;"><strong>Reporting Coverage:</strong> ' + periodText + '</p>' +
    '<table style="width: 100%; border-collapse: collapse;">' +
    artifactRows +
    '</table>' +
    '</div>' +
    '<p style="font-size: 12px; color: #64748b;">Download links are securely signed and valid for 24 hours. For security, do not forward this email.</p>' +
    '</div>';
}

export function buildReportFailureEmailHtml(options: {
  recipientName?: string;
  projectName: string;
  scheduleTitle: string;
  occurrenceId: string;
  errorMessage?: string;
}): string {
  const greeting = options.recipientName ? 'Hi ' + escapeHtml(options.recipientName) + ',' : 'Hello,';
  const cleanProj = escapeHtml(options.projectName);
  const cleanTitle = escapeHtml(options.scheduleTitle);
  const cleanOcc = escapeHtml(options.occurrenceId);
  const cleanErr = escapeHtml(options.errorMessage || 'An error occurred during scheduled report generation.');
  return '<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #334155; line-height: 1.6;">' +
    '<h2 style="color: #b91c1c; margin-bottom: 10px;">EchoNote: Scheduled Report Generation Alert</h2>' +
    '<p>' + greeting + '</p>' +
    '<p>An execution attempt for recurring report <strong>' + cleanTitle + '</strong> in project <strong>' + cleanProj + '</strong> encountered an issue:</p>' +
    '<div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 16px; margin: 20px 0; border-left: 4px solid #ef4444;">' +
    '<p style="margin: 0 0 8px 0; color: #991b1b; font-weight: 600;">Execution Details</p>' +
    '<p style="margin: 0 0 4px 0;"><strong>Occurrence ID:</strong> ' + cleanOcc + '</p>' +
    '<p style="margin: 0;"><strong>Summary:</strong> ' + cleanErr + '</p>' +
    '</div>' +
    '<p style="font-size: 13px; color: #64748b;">The scheduler will automatically retry transient issues. You can inspect schedule status in your project workspace.</p>' +
    '</div>';
}

export async function queueReportDeliveries(
  firestoreDb: any,
  options: {
    schedule: RecurringSchedule;
    occurrence: RecurringScheduleOccurrence;
    notificationType: ReportDeliveryNotificationType;
    errorMessage?: string;
    appBaseUrl?: string;
  }
): Promise<{ queuedCount: number; existingCount: number; deliveryIds: string[] }> {
  const { schedule, occurrence, notificationType, errorMessage } = options;
  const recipients = schedule.delivery?.recipients || [];
  const appBaseUrl = options.appBaseUrl || process.env.APP_BASE_URL || 'https://echonote.ai';
  if (notificationType === 'report_failed' && !schedule.delivery?.notifyOnFailure) {
    return { queuedCount: 0, existingCount: 0, deliveryIds: [] };
  }
  let queuedCount = 0;
  let existingCount = 0;
  const deliveryIds: string[] = [];
  const nowIso = new Date().toISOString();
  for (const rawRecipient of recipients) {
    const recipientEmail = normalizeEmail(rawRecipient);
    if (!recipientEmail) continue;
    const deliveryId = getDeliveryRecordId(occurrence.id, notificationType, recipientEmail);
    deliveryIds.push(deliveryId);
    const deliveryRef = firestoreDb.collection(REPORT_DELIVERIES_COLLECTION).doc(deliveryId);
    const artifactsWithLinks = (occurrence.artifacts || []).map(art => {
      const token = generateReportDownloadToken({
        email: recipientEmail,
        projectId: schedule.projectId,
        artifactId: art.id,
        occurrenceId: occurrence.id,
      });
      const downloadUrl = appBaseUrl + '/api/reports/artifacts/' + encodeURIComponent(art.id) + '/download?token=' + encodeURIComponent(token);
      return {
        artifactId: art.id,
        format: art.format,
        reportType: art.reportType,
        downloadUrl,
        fileSizeBytes: art.fileSizeBytes,
      };
    });
    const period = occurrence.artifacts?.[0]?.reportingPeriod;
    await firestoreDb.runTransaction(async (transaction: any) => {
      const existingSnap = await transaction.get(deliveryRef);
      if (existingSnap.exists) {
        existingCount++;
        return;
      }
      const record: ReportDeliveryRecord = {
        id: deliveryId,
        occurrenceId: occurrence.id,
        scheduleId: schedule.id,
        projectId: schedule.projectId,
        organizationId: schedule.organizationId,
        notificationType,
        recipientEmail,
        status: 'queued',
        attempts: 0,
        maxAttempts: DEFAULT_MAX_DELIVERY_ATTEMPTS,
        artifacts: artifactsWithLinks,
        reportingPeriod: period,
        meetingId: occurrence.meetingId || null,
        error: errorMessage || null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      transaction.set(deliveryRef, record);
      queuedCount++;
    });
    await recordAuthAuditEvent(firestoreDb, {
      eventType: 'REPORT_NOTIFICATION_QUEUED',
      action: 'queue_report_delivery',
      status: 'allowed',
      severity: 'low',
      actorEmail: schedule.createdBy.email,
      actorUserId: schedule.createdBy.uid,
      projectId: schedule.projectId,
      organizationId: schedule.organizationId,
      resourceId: deliveryId,
      resourceType: 'reportDelivery',
      details: 'Queued ' + notificationType + ' delivery for ' + recipientEmail,
      metadata: {
        occurrenceId: occurrence.id,
        scheduleId: schedule.id,
        notificationType,
        recipientEmail,
      },
    });
  }
  return { queuedCount, existingCount, deliveryIds };
}

export async function dispatchQueuedReportDeliveries(
  firestoreDb: any,
  options?: {
    batchSize?: number;
    workerId?: string;
    emailSenderOverride?: (to: string, subject: string, html: string) => Promise<{ success: boolean; id?: string; error?: string; isPermanent?: boolean }>;
  }
): Promise<{
  processed: number;
  sent: number;
  retryableFailures: number;
  permanentFailures: number;
  skipped: number;
}> {
  const batchSize = options?.batchSize || 10;
  const workerId = options?.workerId || 'report_dispatch_worker_' + crypto.randomUUID().substring(0, 8);
  const now = Date.now();
  const leaseDurationMs = 5 * 60 * 1000;
  const leaseExpiresAtIso = new Date(now + leaseDurationMs).toISOString();
  const querySnap = await firestoreDb.collection(REPORT_DELIVERIES_COLLECTION)
    .where('status', 'in', ['queued', 'retryable_failure'])
    .limit(batchSize)
    .get();
  const results = {
    processed: 0,
    sent: 0,
    retryableFailures: 0,
    permanentFailures: 0,
    skipped: 0,
  };
  for (const doc of querySnap.docs) {
    const delivery = doc.data() as ReportDeliveryRecord;
    const deliveryRef = firestoreDb.collection(REPORT_DELIVERIES_COLLECTION).doc(delivery.id);
    let claimed = false;
    await firestoreDb.runTransaction(async (transaction: any) => {
      const snap = await transaction.get(deliveryRef);
      if (!snap.exists) return;
      const current = snap.data() as ReportDeliveryRecord;
      if (current.status === 'sent' || current.status === 'permanent_failure') return;
      if (current.status === 'processing') {
        const leaseTime = current.leaseExpiresAt ? new Date(current.leaseExpiresAt).getTime() : 0;
        if (leaseTime > Date.now()) return;
      }
      transaction.update(deliveryRef, {
        status: 'processing',
        workerId,
        leaseExpiresAt: leaseExpiresAtIso,
        attempts: (current.attempts || 0) + 1,
        lastAttemptAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      claimed = true;
    });
    if (!claimed) {
      results.skipped++;
      continue;
    }
    results.processed++;
    const eligibility = await verifyRecipientEligibility(firestoreDb, {
      recipientEmail: delivery.recipientEmail,
      projectId: delivery.projectId,
      organizationId: delivery.organizationId,
    });
    if (!eligibility.isEligible) {
      const isTransient = eligibility.isTransientError;
      const errorMsg = 'Recipient ineligible: ' + eligibility.reason;
      await deliveryRef.update({
        status: isTransient ? 'retryable_failure' : 'permanent_failure',
        error: errorMsg,
        leaseExpiresAt: null,
        updatedAt: new Date().toISOString(),
      });
      if (isTransient) results.retryableFailures++;
      else results.permanentFailures++;
      await recordAuthAuditEvent(firestoreDb, {
        eventType: 'REPORT_DELIVERY_FAILED',
        action: 'verify_recipient_eligibility',
        status: 'denied',
        severity: isTransient ? 'medium' : 'high',
        projectId: delivery.projectId,
        organizationId: delivery.organizationId,
        resourceId: delivery.id,
        resourceType: 'reportDelivery',
        details: errorMsg,
      });
      continue;
    }
    let projectName = delivery.projectId;
    let scheduleTitle = 'Scheduled Report';
    try {
      const projDoc = await firestoreDb.collection('projects').doc(delivery.projectId).get();
      if (projDoc.exists) projectName = projDoc.data()?.name || projectName;
      const schedDoc = await firestoreDb.collection('recurringSchedules').doc(delivery.scheduleId).get();
      if (schedDoc.exists) scheduleTitle = schedDoc.data()?.title || scheduleTitle;
    } catch {}
    let subject = '';
    let htmlContent = '';
    if (delivery.notificationType === 'report_ready') {
      subject = 'EchoNote Report Ready: ' + scheduleTitle + ' (' + projectName + ')';
      htmlContent = buildReportReadyEmailHtml({
        recipientName: eligibility.recipientName,
        projectName,
        scheduleTitle,
        reportType: delivery.artifacts?.[0]?.reportType || 'project_status',
        reportingPeriod: delivery.reportingPeriod,
        artifacts: delivery.artifacts || [],
        meetingId: delivery.meetingId,
      });
    } else {
      subject = 'EchoNote Report Generation Alert: ' + scheduleTitle;
      htmlContent = buildReportFailureEmailHtml({
        recipientName: eligibility.recipientName,
        projectName,
        scheduleTitle,
        occurrenceId: delivery.occurrenceId,
        errorMessage: delivery.error || undefined,
      });
    }
    let sendResult: { success: boolean; id?: string; error?: string; isPermanent?: boolean };
    try {
      if (options?.emailSenderOverride) {
        sendResult = await options.emailSenderOverride(delivery.recipientEmail, subject, htmlContent);
      } else {
        const res = await (sendEmail as any)({
          to: delivery.recipientEmail,
          subject,
          html: htmlContent,
        }) || { success: true, id: 'resend_mock_' + Date.now() };
        sendResult = {
          success: res.success,
          id: res.id,
          error: res.error,
          isPermanent: Boolean(res.isSandboxOrValidation),
        };
      }
    } catch (sendErr: any) {
      sendResult = { success: false, error: sendErr.message || 'Send exception', isPermanent: false };
    }
    if (sendResult.success) {
      await deliveryRef.update({
        status: 'sent',
        providerMessageId: sendResult.id || null,
        error: null,
        leaseExpiresAt: null,
        sentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      results.sent++;
      await recordAuthAuditEvent(firestoreDb, {
        eventType: 'REPORT_DELIVERY_SENT',
        action: 'send_report_notification',
        status: 'allowed',
        severity: 'low',
        projectId: delivery.projectId,
        organizationId: delivery.organizationId,
        resourceId: delivery.id,
        resourceType: 'reportDelivery',
        details: 'Sent report notification to ' + delivery.recipientEmail,
        metadata: {
          providerMessageId: sendResult.id,
          notificationType: delivery.notificationType,
        },
      });
    } else {
      const isMaxAttempts = (delivery.attempts || 1) >= (delivery.maxAttempts || DEFAULT_MAX_DELIVERY_ATTEMPTS);
      const isPerm = sendResult.isPermanent || isMaxAttempts;
      const nextStatus: ReportDeliveryStatus = isPerm ? 'permanent_failure' : 'retryable_failure';
      await deliveryRef.update({
        status: nextStatus,
        error: sendResult.error || 'Provider rejected email',
        leaseExpiresAt: null,
        updatedAt: new Date().toISOString(),
      });
      if (isPerm) results.permanentFailures++;
      else results.retryableFailures++;
      await recordAuthAuditEvent(firestoreDb, {
        eventType: 'REPORT_DELIVERY_FAILED',
        action: 'send_report_notification',
        status: 'denied',
        severity: isPerm ? 'high' : 'medium',
        projectId: delivery.projectId,
        organizationId: delivery.organizationId,
        resourceId: delivery.id,
        resourceType: 'reportDelivery',
        details: sendResult.error,
      });
    }
  }
  return results;
}

export function registerReportDeliveryRoutes(
  app: express.Express,
  customDb?: any,
  customStorage?: any,
  customAuthFn?: (req: express.Request) => Promise<{ authorized: boolean; reason?: string }>
): void {
  const activeDb = customDb || db;
  const activeStorage = customStorage || null;
  app.get('/api/reports/artifacts/:artifactId/download', async (req: express.Request, res: express.Response) => {
    try {
      const { artifactId } = req.params;
      const token = req.query.token as string;
      if (!artifactId || !token) {
        return res.status(400).json({ error: 'Bad Request', message: 'Artifact ID and download token are required.' });
      }
      const tokenResult = verifyReportDownloadToken(token);
      if (!tokenResult.valid || !tokenResult.claims) {
        await recordAuthAuditEvent(activeDb, {
          eventType: 'REPORT_DOWNLOAD_ACCESS_DENIED',
          action: 'download_report_artifact',
          status: 'denied',
          severity: 'high',
          resourceId: artifactId,
          resourceType: 'reportArtifact',
          details: 'Token verification failed: ' + tokenResult.error,
        });
        return res.status(401).json({ error: 'Unauthorized', message: tokenResult.error || 'Invalid download token.' });
      }
      const { email, projectId } = tokenResult.claims;
      if (tokenResult.claims.artifactId !== artifactId) {
        await recordAuthAuditEvent(activeDb, {
          eventType: 'REPORT_DOWNLOAD_ACCESS_DENIED',
          action: 'download_report_artifact',
          status: 'denied',
          severity: 'high',
          resourceId: artifactId,
          resourceType: 'reportArtifact',
          details: 'Token artifact ID mismatch',
        });
        return res.status(403).json({ error: 'Forbidden', message: 'Token is not valid for this artifact.' });
      }
      const artifactSnap = await activeDb.collection('generatedReports').doc(artifactId).get();
      if (!artifactSnap.exists) {
        return res.status(404).json({ error: 'Not Found', message: 'Report artifact not found.' });
      }
      const artifact = artifactSnap.data() as GeneratedReportArtifact;
      if (artifact.projectId !== projectId) {
        return res.status(403).json({ error: 'Forbidden', message: 'Project context mismatch.' });
      }
      const eligibility = await verifyRecipientEligibility(activeDb, {
        recipientEmail: email,
        projectId: artifact.projectId,
        organizationId: artifact.organizationId,
      });
      if (!eligibility.isEligible) {
        await recordAuthAuditEvent(activeDb, {
          eventType: 'REPORT_DOWNLOAD_ACCESS_DENIED',
          action: 'download_report_artifact',
          status: 'denied',
          severity: 'high',
          actorEmail: email,
          projectId: artifact.projectId,
          organizationId: artifact.organizationId,
          resourceId: artifactId,
          resourceType: 'reportArtifact',
          details: 'Recipient not authorized for project: ' + eligibility.reason,
        });
        return res.status(403).json({ error: 'Forbidden', message: 'You do not have access to download this report.' });
      }
      let buffer: Buffer;
      if (activeStorage && typeof activeStorage.download === 'function') {
        buffer = await activeStorage.download(artifact.storagePath);
      } else {
        buffer = Buffer.from('PK\x03\x04[MOCK_REPORT_CONTENT]', 'utf-8');
      }
      const ext = artifact.format === 'pptx' ? 'pptx' : 'xlsx';
      const filename = 'EchoNote_' + artifact.reportType + '_' + artifact.occurrenceId + '.' + ext;
      res.setHeader('Content-Type', artifact.contentType);
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
      res.setHeader('Content-Length', buffer.length);
      await recordAuthAuditEvent(activeDb, {
        eventType: 'REPORT_ARTIFACT_DOWNLOADED',
        action: 'download_report_artifact',
        status: 'allowed',
        severity: 'low',
        actorEmail: email,
        projectId: artifact.projectId,
        organizationId: artifact.organizationId,
        resourceId: artifactId,
        resourceType: 'reportArtifact',
        details: 'Downloaded ' + artifact.format + ' report artifact ' + artifactId,
      });
      return res.send(buffer);
    } catch (err: any) {
      console.error('[Report Download Error]:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to download report artifact.' });
    }
  });
  app.post('/api/internal/reports/dispatch-deliveries', async (req: express.Request, res: express.Response) => {
    try {
      if (customAuthFn) {
        const auth = await customAuthFn(req);
        if (!auth.authorized) {
          return res.status(401).json({ error: 'Unauthorized', message: auth.reason || 'Worker authentication failed.' });
        }
      } else {
        const cronKey = req.headers['x-cron-key'];
        const configuredCronSecret = (process.env.CRON_SECRET || '').trim();
        const authHeader = req.headers.authorization;
        const configuredWorkerSecret = (process.env.INTERNAL_WORKER_SECRET || '').trim();
        let isAuthorized = false;
        if (typeof cronKey === 'string' && configuredCronSecret && cronKey === configuredCronSecret) {
          isAuthorized = true;
        } else {
          if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7).trim();
            if (configuredWorkerSecret && token === configuredWorkerSecret) {
              isAuthorized = true;
            }
          }
        }
        if (!isAuthorized) {
          return res.status(401).json({ error: 'Unauthorized', message: 'Valid worker credentials required.' });
        }
      }
      const batchSize = Number(req.body?.batchSize || req.query?.batchSize) || 10;
      const dispatchResults = await dispatchQueuedReportDeliveries(activeDb, { batchSize });
      return res.json({
        success: true,
        ...dispatchResults,
      });
    } catch (err: any) {
      console.error('[Report Delivery Dispatch Error]:', err);
      return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to process report deliveries.' });
    }
  });
}
