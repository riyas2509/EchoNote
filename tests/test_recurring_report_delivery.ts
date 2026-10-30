/**
 * EchoNote Requirement 24.5 — Notification and Automated Report Delivery Test Suite
 */

import assert from 'assert';
import express from 'express';
import {
  generateReportDownloadToken,
  verifyReportDownloadToken,
  getDeliveryRecordId,
  escapeHtml,
  buildReportReadyEmailHtml,
  buildReportFailureEmailHtml,
  queueReportDeliveries,
  dispatchQueuedReportDeliveries,
  registerReportDeliveryRoutes,
  REPORT_DELIVERIES_COLLECTION,
} from '../lib/recurringReportDeliveryService.ts';
import type {
  RecurringSchedule,
  RecurringScheduleOccurrence,
  GeneratedReportArtifact,
  ReportDeliveryRecord,
} from '../types.ts';

// In-memory mock Firestore database
class MockFirestore {
  public collections: Map<string, Map<string, any>> = new Map();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    const col = this.collections.get(name)!;

    return {
      doc: (id?: string) => {
        const docId = id || 'mock_doc_' + Math.random().toString(36).substring(2, 9);
        return {
          id: docId,
          get: async () => ({
            exists: col.has(docId),
            data: () => col.get(docId),
          }),
          set: async (data: any) => {
            col.set(docId, JSON.parse(JSON.stringify(data)));
          },
          update: async (data: any) => {
            const existing = col.get(docId) || {};
            col.set(docId, { ...existing, ...JSON.parse(JSON.stringify(data)) });
          },
        };
      },
      where: function buildQuery(field: string, op: string, val: any, currentDocs?: any[]): any {
        let docs = currentDocs || Array.from(col.entries()).map(([id, d]) => ({ id, ...d }));
        if (op === '==') {
          docs = docs.filter((d: any) => d[field] === val);
        } else if (op === 'in') {
          docs = docs.filter((d: any) => Array.isArray(val) && val.includes(d[field]));
        }
        return {
          where: (f2: string, op2: string, v2: any) => buildQuery(f2, op2, v2, docs),
          limit: (n: number) => ({
            get: async () => ({
              empty: docs.slice(0, n).length === 0,
              docs: docs.slice(0, n).map((item: any) => ({
                id: item.id,
                data: () => item,
              })),
          }),
          }),
          get: async () => ({
            empty: docs.length === 0,
            docs: docs.map((item: any) => ({
              id: item.id,
              data: () => item,
            })),
          }),
        };
      },
    };
  }

  runTransaction(fn: (tx: any) => Promise<any>) {
    const tx = {
      get: async (ref: any) => ref.get(),
      set: (ref: any, data: any) => ref.set(data),
      update: (ref: any, data: any) => ref.update(data),
    };
    return fn(tx);
  }
}

async function runAllTests() {
  process.env.REPORT_DOWNLOAD_SECRET = 'test_delivery_secret_32_characters_long_12345';
  console.log('--- Running EchoNote Requirement 24.5 Delivery & Notification Test Suite ---');
  const mockDb = new MockFirestore();

  // Seed Project
  await mockDb.collection('projects').doc('proj_test_1').set({
    id: 'proj_test_1',
    name: 'Alpha Project',
    organizationId: 'org_123',
    ownerEmail: 'owner@example.com',
    members: ['owner@example.com', 'lead@example.com'],
  });

  // 1. Token Generation & Verification
  const token = generateReportDownloadToken({
    email: 'lead@example.com',
    projectId: 'proj_test_1',
    artifactId: 'art_abc',
    occurrenceId: 'occ_123',
  });
  const tokenVerification = verifyReportDownloadToken(token);
  assert.strictEqual(tokenVerification.valid, true);
  assert.strictEqual(tokenVerification.claims?.email, 'lead@example.com');
  assert.strictEqual(tokenVerification.claims?.artifactId, 'art_abc');

  // Tampered token fails
  const tamperedToken = token.substring(0, token.length - 4) + 'xxxx';
  assert.strictEqual(verifyReportDownloadToken(tamperedToken).valid, false);
  console.log('  PASS: 1. Tamper-evident download tokens validated and tampering detected');

  // 2. Template HTML Sanitization
  const maliciousTitle = 'Project <script>alert(1)</script> & "Hack"';
  const escaped = escapeHtml(maliciousTitle);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(escaped.includes('&lt;script&gt;'));
  assert.ok(escaped.includes('&amp;'));
  console.log('  PASS: 2. HTML template values strictly sanitized against injection');

  // 3. Queue Report Deliveries (Success)
  const mockSchedule: any = {
    id: 'sched_1',
    projectId: 'proj_test_1',
    organizationId: 'org_123',
    title: 'Weekly Executive Review',
    reportType: 'project_status',
    delivery: {
      recipients: ['lead@example.com', 'owner@example.com'],
      notifyOnFailure: true,
    },
    createdBy: { uid: 'user_1', email: 'owner@example.com', name: 'Owner' },
  };

  const mockArtifacts: GeneratedReportArtifact[] = [
    {
      id: 'art_1',
      occurrenceId: 'occ_1',
      scheduleId: 'sched_1',
      projectId: 'proj_test_1',
      organizationId: 'org_123',
      reportType: 'project_status',
      format: 'pptx',
      storagePath: 'reports/proj_test_1/occ_1/art_1.pptx',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSizeBytes: 15000,
      reportingPeriod: { startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-26T00:00:00.000Z' },
      isTruncated: false,
      warnings: [],
      generatedAt: new Date().toISOString(),
    },
    {
      id: 'art_2',
      occurrenceId: 'occ_1',
      scheduleId: 'sched_1',
      projectId: 'proj_test_1',
      organizationId: 'org_123',
      reportType: 'project_status',
      format: 'xlsx',
      storagePath: 'reports/proj_test_1/occ_1/art_2.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSizeBytes: 22000,
      reportingPeriod: { startDate: '2026-10-01T00:00:00.000Z', endDate: '2026-10-26T00:00:00.000Z' },
      isTruncated: false,
      warnings: [],
      generatedAt: new Date().toISOString(),
    },
  ];

  const mockOccurrence: any = {
    id: 'occ_1',
    scheduleId: 'sched_1',
    projectId: 'proj_test_1',
    organizationId: 'org_123',
    scheduledFor: '2026-10-26T04:00:00.000Z',
    status: 'succeeded',
    artifacts: mockArtifacts,
    meetingId: 'meet_xyz',
  };

  const queueRes = await queueReportDeliveries(mockDb, {
    schedule: mockSchedule,
    occurrence: mockOccurrence,
    notificationType: 'report_ready',
  });
  assert.strictEqual(queueRes.queuedCount, 2);
  assert.strictEqual(queueRes.existingCount, 0);

  // Verify idempotency: re-queueing same occurrence does not duplicate
  const queueRes2 = await queueReportDeliveries(mockDb, {
    schedule: mockSchedule,
    occurrence: mockOccurrence,
    notificationType: 'report_ready',
  });
  assert.strictEqual(queueRes2.queuedCount, 0);
  assert.strictEqual(queueRes2.existingCount, 2);
  console.log('  PASS: 3. Report deliveries queued with strict idempotency (no duplicates)');

  // 4. Failure Alert Queueing
  const failQueueRes = await queueReportDeliveries(mockDb, {
    schedule: mockSchedule,
    occurrence: { ...mockOccurrence, id: 'occ_fail_1', artifacts: [] },
    notificationType: 'report_failed',
    errorMessage: 'Storage timeout',
  });
  assert.strictEqual(failQueueRes.queuedCount, 2);

  // Failure alert suppressed when notifyOnFailure is false
  const noAlertSchedule = { ...mockSchedule, delivery: { recipients: ['lead@example.com'], notifyOnFailure: false } };
  const suppressedRes = await queueReportDeliveries(mockDb, {
    schedule: noAlertSchedule,
    occurrence: { ...mockOccurrence, id: 'occ_fail_2', artifacts: [] },
    notificationType: 'report_failed',
    errorMessage: 'Some error',
  });
  assert.strictEqual(suppressedRes.queuedCount, 0);
  console.log('  PASS: 4. Failure notifications queued when enabled, suppressed when disabled');

  // 5. Dispatch Worker Processes Queued Deliveries
  let emailsSent: any[] = [];
  const mockSender = async (to: string, subject: string, html: string) => {
    emailsSent.push({ to, subject, html });
    return { success: true, id: 'resend_msg_' + emailsSent.length };
  };

  const dispatchRes = await dispatchQueuedReportDeliveries(mockDb, {
    batchSize: 10,
    emailSenderOverride: mockSender,
  });
  assert.ok(dispatchRes.sent >= 2);
  assert.strictEqual(dispatchRes.retryableFailures, 0);
  assert.strictEqual(dispatchRes.permanentFailures, 0);
  console.log('  PASS: 5. Dispatch worker delivered emails via provider with valid message IDs');

  // 6. Ineligible Recipient Rejection
  await mockDb.collection(REPORT_DELIVERIES_COLLECTION).doc('deliv_unauth').set({
    id: 'deliv_unauth',
    occurrenceId: 'occ_x',
    scheduleId: 'sched_1',
    projectId: 'proj_test_1',
    organizationId: 'org_123',
    notificationType: 'report_ready',
    recipientEmail: 'stranger@outside.com',
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const unauthDispatch = await dispatchQueuedReportDeliveries(mockDb, {
    batchSize: 1,
    emailSenderOverride: mockSender,
  });
  console.log('unauthDispatch result:', unauthDispatch); assert.strictEqual(unauthDispatch.permanentFailures, 1);
  const unauthDoc = await mockDb.collection(REPORT_DELIVERIES_COLLECTION).doc('deliv_unauth').get();
  assert.strictEqual(unauthDoc.data().status, 'permanent_failure');
  console.log('  PASS: 6. Unauthorized recipient rejected with permanent_failure');

  // 7. HTTP Endpoints: Download & Dispatch
  const app = express();
  app.use(express.json());

  // Seed Artifact
  await mockDb.collection('generatedReports').doc('art_download_1').set({
    id: 'art_download_1',
    occurrenceId: 'occ_1',
    scheduleId: 'sched_1',
    projectId: 'proj_test_1',
    organizationId: 'org_123',
    reportType: 'project_status',
    format: 'pptx',
    storagePath: 'reports/proj_test_1/occ_1/art_download_1.pptx',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    fileSizeBytes: 5000,
  });

  registerReportDeliveryRoutes(app, mockDb, {
    download: async () => Buffer.from('PK\x03\x04[MOCK_PRESENTATION_CONTENT]', 'utf-8'),
  }, async (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader === 'Bearer secret-worker-key') return { authorized: true };
    return { authorized: false, reason: 'Invalid credentials' };
  });

  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Valid download
  const validToken = generateReportDownloadToken({
    email: 'owner@example.com',
    projectId: 'proj_test_1',
    artifactId: 'art_download_1',
    occurrenceId: 'occ_1',
  });
  const dlRes = await fetch(baseUrl + '/api/reports/artifacts/art_download_1/download?token=' + encodeURIComponent(validToken));
  assert.strictEqual(dlRes.status, 200);
  assert.strictEqual(dlRes.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  const bodyBuffer = Buffer.from(await dlRes.arrayBuffer());
  assert.ok(bodyBuffer.toString().startsWith('PK'));

  // Unauthorized download (unregistered email)
  const unauthDlToken = generateReportDownloadToken({
    email: 'attacker@evil.com',
    projectId: 'proj_test_1',
    artifactId: 'art_download_1',
    occurrenceId: 'occ_1',
  });
  const unauthRes = await fetch(baseUrl + '/api/reports/artifacts/art_download_1/download?token=' + encodeURIComponent(unauthDlToken));
  assert.strictEqual(unauthRes.status, 403);

  // Unauthenticated worker endpoint
  const unauthWorkerRes = await fetch(baseUrl + '/api/internal/reports/dispatch-deliveries', { method: 'POST' });
  assert.strictEqual(unauthWorkerRes.status, 401);

  // Authenticated worker endpoint
  const authWorkerRes = await fetch(baseUrl + '/api/internal/reports/dispatch-deliveries', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer secret-worker-key' },
  });
  assert.strictEqual(authWorkerRes.status, 200);
  const workerData = await authWorkerRes.json();
  assert.strictEqual(workerData.success, true);
  console.log('  PASS: 7. Authenticated download and worker dispatch endpoints verified');

  server.close();
  console.log('All notification and automated report delivery tests PASSED!');
}

runAllTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
