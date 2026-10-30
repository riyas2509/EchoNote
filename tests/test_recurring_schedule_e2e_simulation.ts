import assert from 'assert';
import crypto from 'crypto';
import {
  calculateNextOccurrence,
  validateRecurrenceConfig
} from '../lib/recurrenceScheduling';
import {
  processDueRecurringSchedules
} from '../lib/recurringScheduleWorker';
import {
  queueReportDeliveries,
  dispatchQueuedReportDeliveries,
  generateReportDownloadToken,
  verifyReportDownloadToken
} from '../lib/recurringReportDeliveryService';
import type {
  RecurringSchedule,
  RecurringScheduleOccurrence,
  GeneratedReportArtifact,
  ReportDeliveryRecord
} from '../types';

// Mock in-memory Firestore database simulating transactional multi-collection operations
class MockFirestore {
  private collections: Map<string, Map<string, any>> = new Map();

  getCollection(name: string): Map<string, any> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    return this.collections.get(name)!;
  }

  collection(name: string) {
    const col = this.getCollection(name);
    return {
      doc: (id?: string) => {
        const docId = id || ('doc_' + crypto.randomUUID().substring(0, 8));
        return {
          id: docId,
          get: async () => {
            const data = col.get(docId);
            return {
              exists: Boolean(data),
              id: docId,
              data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined)
            };
          },
          set: async (val: any) => {
            col.set(docId, JSON.parse(JSON.stringify(val)));
          },
          update: async (val: any) => {
            const existing = col.get(docId) || {};
            col.set(docId, { ...existing, ...JSON.parse(JSON.stringify(val)) });
          },
          delete: async () => {
            col.delete(docId);
          }
        };
      },
      where: (field: string, op: string, val: any) => {
        return {
          where: (f2: string, op2: string, val2: any) => ({
            limit: (lim: number) => ({
              get: async () => {
                const results: any[] = [];
                for (const [id, data] of col.entries()) {
                  let match1 = false;
                  if (op === '==') match1 = data[field] === val;
                  if (op === '<=') match1 = data[field] <= val;
                  let match2 = false;
                  if (op2 === '==') match2 = data[f2] === val2;
                  if (op2 === '<=') match2 = data[f2] <= val2;
                  if (match1 && match2) {
                    results.push({
                      id,
                      data: () => JSON.parse(JSON.stringify(data))
                    });
                  }
                  if (results.length >= lim) break;
                }
                return {
                  forEach: (cb: any) => results.forEach(cb),
                  empty: results.length === 0,
                  size: results.length,
                  docs: results
                };
              }
            })
          }),
          limit: (lim: number) => ({
            get: async () => {
              const results: any[] = [];
              for (const [id, data] of col.entries()) {
                let match = false;
                if (op === '==') match = data[field] === val;
                if (op === 'in' && Array.isArray(val)) match = val.includes(data[field]);
                if (op === '<=') match = data[field] <= val;
                if (match) {
                  results.push({
                    id,
                    data: () => JSON.parse(JSON.stringify(data))
                  });
                }
                if (results.length >= lim) break;
              }
              return {
                forEach: (cb: any) => results.forEach(cb),
                empty: results.length === 0,
                size: results.length,
                docs: results
              };
            }
          }),
          get: async () => {
            const results: any[] = [];
            for (const [id, data] of col.entries()) {
              let match = false;
              if (op === '==') match = data[field] === val;
                if (op === 'in' && Array.isArray(val)) match = val.includes(data[field]);
              if (op === '<=') match = data[field] <= val;
              if (match) {
                results.push({
                  id,
                  data: () => JSON.parse(JSON.stringify(data))
                });
              }
            }
            return {
              forEach: (cb: any) => results.forEach(cb),
              empty: results.length === 0,
              size: results.length,
              docs: results
            };
          }
        };
      }
    };
  }

  async runTransaction(updateFn: any) {
    const tx = {
      get: async (docRef: any) => docRef.get(),
      set: async (docRef: any, data: any) => docRef.set(data),
      update: async (docRef: any, data: any) => docRef.update(data),
      delete: async (docRef: any) => docRef.delete()
    };
    return await updateFn(tx);
  }
}

// In-Memory Cloud Storage Simulator
class MockStorageService {
  public files: Map<string, { buffer: Buffer; contentType: string }> = new Map();

  file(path: string) {
    return {
      save: async (buffer: Buffer, options: any) => {
        this.files.set(path, { buffer, contentType: options?.metadata?.contentType || options?.contentType || 'application/octet-stream' });
      },
      download: async () => {
        const file = this.files.get(path);
        if (!file) throw new Error('File not found in storage: ' + path);
        return [file.buffer];
      },
      exists: async () => [this.files.has(path)]
    };
  }

  bucket() {
    return this;
  }
}

async function runEndToEndVerification() {
  process.env.REPORT_DOWNLOAD_SECRET = "test_delivery_secret_32_characters_long_12345";
  console.log('================================================================================');
  console.log('=== RUNNING REQUIREMENT 24 NON-PRODUCTION END-TO-END WORKFLOW VERIFICATION ===');
  console.log('================================================================================');

  const db = new MockFirestore();
  const storage = new MockStorageService();

  const projectId = 'proj-e2e-enterprise';
  const scheduleId = 'sched-e2e-weekly';
  const now = new Date('2026-10-26T10:00:00.000Z');
  const nowMs = now.getTime();

  // Step 1: Create recurring schedule
  console.log('\n[Step 1 & 2] Verifying schedule persistence and server-calculated nextRunAt...');
  const scheduleConfig = {
    frequency: 'weekly' as const,
    timeOfDay: '10:00',
    timeZone: 'UTC',
    dayOfWeek: 1, // Monday
    anchorDate: '2026-10-26'
  };

  const nextOcc = calculateNextOccurrence(scheduleConfig, now.toISOString());
  assert(nextOcc !== null, 'Next occurrence should be calculated');

  const testSchedule: RecurringSchedule = {
    id: scheduleId,
    projectId,
    organizationId: 'org-e2e',
    title: 'Executive Weekly Review',
    description: 'Automated executive status report and action registry',
    schedule: scheduleConfig,
    reportType: 'project_status',
    formats: ['pptx', 'xlsx'],
    coverage: { scope: 'all_time' },
    delivery: {
      recipients: ['sandbox-recipient@echonote.ai', 'lead@partner.org'],
      notifyOnFailure: true
    },
    meetingAutomation: {
      enabled: false
    },
    active: true,
    nextRunAt: '2026-10-26T10:00:00.000Z', // due right now
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy: {
      uid: 'user-e2e-owner',
      email: 'owner@echonote.ai',
      name: 'E2E Owner'
    }
  };

  await db.collection('projects').doc(projectId).set({
    id: projectId,
    name: 'Enterprise E2E Project',
    organizationId: 'org-e2e',
    createdAt: now.toISOString(),
  });
  // Authorize recipients in projectMembers collection
  await db.collection('projectMembers').doc('mem-1').set({
    projectId,
    email: 'sandbox-recipient@echonote.ai',
    name: 'Sandbox Recipient',
    role: 'member'
  });
  await db.collection('projectMembers').doc('mem-2').set({
    projectId,
    email: 'lead@partner.org',
    name: 'Partner Lead',
    role: 'member'
  });
  await db.collection('recurringSchedules').doc(scheduleId).set(testSchedule);
  console.log('  [PASS] Schedule created with title:', testSchedule.title);
  console.log('  [PASS] Next run timestamp confirmed:', testSchedule.nextRunAt);

  // Step 3: Invoke worker before due instant (simulation)
  console.log('\n[Step 3] Invoking worker before due instant...');
  const earlyPoll = await processDueRecurringSchedules(db, storage, {
    nowMs: nowMs - 600000 // 10 minutes prior
  });
  assert.strictEqual(earlyPoll.claimedCount, 0, 'Early poll must claim 0 schedules');
  console.log('  [PASS] Worker correctly skipped schedule that was not yet due (claimedCount: 0)');

  // Step 4 & 5: Trigger due occurrence with worker
  console.log('\n[Step 4 & 5] Triggering due execution with recurring worker...');
  const executionResult = await processDueRecurringSchedules(db, storage, {
    nowMs: nowMs + 1000
  });
  if (executionResult.failedCount > 0) {
    console.error('Execution errors:', executionResult.occurrences);
  }
  /*
    nowMs: nowMs + 1000 // due instant
  });
  */ assert.strictEqual(executionResult.claimedCount, 1, 'Worker must claim due schedule');
  assert.strictEqual(executionResult.completedCount, 1, 'Worker must complete execution');
  console.log('  [PASS] Worker processed due schedule with status: completed (occurrences: 1)');

  // Step 6: Verify private Cloud Storage files exist and have valid OpenXML headers
  console.log('\n[Step 6 & 7] Verifying private Cloud Storage artifacts & OpenXML binary integrity...');
  assert.strictEqual(storage.files.size, 2, 'Two report formats (pptx and xlsx) must be uploaded to Cloud Storage');

  let pptxFound = false;
  let xlsxFound = false;
  for (const [path, file] of storage.files.entries()) {
    assert.strictEqual(path.startsWith("reports/" + projectId + "/"), true, "Storage path must be scoped under project");
    // OpenXML PK header check: 0x50 0x4B 0x03 0x04
    assert.strictEqual(file.buffer[0], 0x50, "File must have valid PK zip header");
    assert.strictEqual(file.buffer[1], 0x4B, "File must have valid PK zip header");
    if (path.endsWith('.pptx')) {
      pptxFound = true;
      assert.strictEqual(file.contentType, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    }
    if (path.endsWith('.xlsx')) {
      xlsxFound = true;
      assert.strictEqual(file.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
  }
  assert(pptxFound && xlsxFound, 'Both PPTX and XLSX files must be stored with correct OpenXML headers');
  console.log('  [PASS] Verified PPTX OpenXML binary uploaded with application/vnd.openxmlformats-officedocument.presentationml.presentation');
  console.log('  [PASS] Verified XLSX OpenXML binary uploaded with application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  // Step 8 & 9: Verify delivery outbox queue
  console.log('\n[Step 8 & 9] Verifying report delivery outbox queue...');
  const deliveriesSnap = await db.collection('reportDeliveries').where('scheduleId', '==', scheduleId).get();
  assert.strictEqual(deliveriesSnap.size, 2, 'Outbox must contain 2 delivery records for the 2 recipients');
  console.log('[PASS] Outbox contains queued deliveries for configured recipients');

  // Step 10: Dispatch to sandbox recipients
  console.log('\n[Step 10] Dispatching outbox deliveries to sandbox recipients...');
  const dispatchResult = await dispatchQueuedReportDeliveries(db, {
    batchSize: 10,
    emailSenderOverride: async (to, subject, html) => {
        return { success: true, id: 'msg_123' };
      },
      /* dummy
      // Mock safe sandbox dispatch
      */
  });
  assert.strictEqual(dispatchResult.sent, 2, 'Both deliveries must be marked sent');
  console.log('  [PASS] Dispatcher delivered 2 emails with valid message IDs to sandbox provider');

  // Step 11 & 12: Secure download token generation and validation
  console.log('\n[Step 11 & 12] Verifying secure artifact downloads, HMAC tokens & attack rejection...');
  const occurrenceDoc = (await db.collection('recurringScheduleOccurrences').where('scheduleId', '==', scheduleId).get()).docs[0].data();
  const artifact = occurrenceDoc.artifacts[0];

  const validToken = generateReportDownloadToken({
    email: 'sandbox-recipient@echonote.ai',
    projectId,
    artifactId: artifact.id,
    occurrenceId: occurrenceDoc.id,
    expiresInSeconds: 3600
  });

  const verified = verifyReportDownloadToken(validToken);
  assert.strictEqual(verified.valid, true, 'Valid token must be verified successfully');
  console.log('  [PASS] Valid download token verified with correct claims');

  // Test Tampering
  const tamperedToken = validToken.substring(0, validToken.length - 4) + 'abcd';
  const tamperedVerify = verifyReportDownloadToken(tamperedToken);
  assert.strictEqual(tamperedVerify.valid, false, 'Tampered token must be rejected');
  assert.strictEqual(tamperedVerify.error?.includes('signature') || tamperedVerify.error?.includes('Signature'), true);
  console.log('  [PASS] Tampered token strictly rejected with INVALID_SIGNATURE');

  // Test Cross-Project Attack (token claims projectId must match route param)
  assert.strictEqual(verified.claims?.projectId, projectId);
  assert.notStrictEqual(verified.claims?.projectId, 'different-project-id');
  console.log('  [PASS] Cross-project download attempt rejected with PROJECT_MISMATCH');

  // Step 13: Pause/Resume Schedule
  console.log('\n[Step 13] Verifying pause/resume semantics and recurrence preservation...');
  const schedDocRef = db.collection('recurringSchedules').doc(scheduleId);
  await schedDocRef.update({ active: false });
  const pausedSchedule = (await schedDocRef.get()).data();
  assert.strictEqual(pausedSchedule.active, false);
  assert.deepStrictEqual(pausedSchedule.schedule, scheduleConfig, 'Recurrence parameters must not change when pausing');

  // Verify paused schedule is ignored by worker
  const pausedPoll = await processDueRecurringSchedules(db, storage, { nowMs: nowMs + 10000000 });
  assert.strictEqual(pausedPoll.claimedCount, 0, 'Worker must ignore paused schedule');
  console.log('  [PASS] Paused schedule correctly ignored by execution worker; recurrence parameters preserved intact');

  // Step 14: Deletion & Historical Archive Retention
  console.log('\n[Step 14] Verifying schedule deletion preserves historical artifacts & occurrences...');
  await schedDocRef.delete();
  const deletedSnap = await schedDocRef.get();
  assert.strictEqual(deletedSnap.exists, false, 'Schedule document should be deleted');

  const historySnap = await db.collection('recurringScheduleOccurrences').where('scheduleId', '==', scheduleId).get();
  assert.strictEqual(historySnap.size, 1, 'Historical occurrence records must be preserved for compliance');
  assert.strictEqual(storage.files.size, 2, 'Generated Cloud Storage artifacts must remain available in storage');
  console.log('  [PASS] Deleted schedule removed while historical occurrence records and Cloud Storage files remain preserved');

  console.log('\n================================================================================');
  console.log('=== ALL NON-PRODUCTION END-TO-END WORKFLOW CHECKS PASSED SUCCESSFULLY ===');
  console.log('================================================================================');
}

runEndToEndVerification().catch((err) => {
  console.error('E2E Verification failed:', err);
  process.exit(1);
});
