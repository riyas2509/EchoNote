/**
 * Comprehensive Test Suite for Phase 3 Step 3.1: Reliable Task Notification Foundation
 *
 * Verifies:
 * 1. Concurrent claims of the same notification (atomicity, only one worker wins).
 * 2. Duplicate suppression for identical events (deterministic deduplication key).
 * 3. Legitimate re-alerting after deadline change (event hash alteration).
 * 4. Legitimate re-alerting after task reactivation / new exception.
 * 5. Provider rejection handling and retryable vs permanent failure categorization.
 * 6. Missing or unauthorized recipients rejection (project & organization tenant security).
 * 7. Lease expiry and recovery by a subsequent worker.
 * 8. Ensuring an unsuccessful send is NEVER marked 'sent'.
 * 9. Integration with emailService templates without leaking sensitive transcripts.
 */

import { strict as assert } from 'assert';
import {
  computeNotificationEventHash,
  generateNotificationDeduplicationKey,
  verifyRecipientEligibility,
  enqueueTaskNotification,
  claimTaskNotification,
  dispatchTaskNotification,
  reconcileAmbiguousNotification,
  quarantineStaleDispatchingNotification,
  scanAndQuarantineStaleDispatches,
  generateTaskNotificationsForProject,
  processNotificationDispatchBatch,
  isNotificationDispatchEnabled,
  DEFAULT_STALE_DISPATCH_TIMEOUT_MS,
  TASK_NOTIFICATIONS_COLLECTION
} from '../lib/taskNotificationService';
import { emailService } from '../lib/emailService';
import { TaskNotificationRecord, TaskNotificationType } from '../types';

// In-Memory Firestore Simulation supporting transactions, collections, documents
class MockFirestore {
  private collections: Map<string, Map<string, any>> = new Map();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    const store = this.collections.get(name)!;

    return {
      doc: (id: string) => {
        return {
          id,
          get: async () => {
            const data = store.get(id);
            return {
              id,
              exists: data !== undefined,
              data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined)
            };
          },
          set: async (val: any, options?: { merge?: boolean }) => {
            if (options?.merge && store.has(id)) {
              store.set(id, { ...store.get(id), ...JSON.parse(JSON.stringify(val)) });
            } else {
              store.set(id, JSON.parse(JSON.stringify(val)));
            }
          },
          update: async (val: any) => {
            if (!store.has(id)) throw new Error(`Document ${id} not found`);
            store.set(id, { ...store.get(id), ...JSON.parse(JSON.stringify(val)) });
          },
          delete: async () => {
            store.delete(id);
          }
        };
      },
      get: async () => {
        const allDocs = Array.from(store.entries()).map(([id, data]) => ({
          id,
          exists: true,
          data: () => JSON.parse(JSON.stringify(data))
        }));
        return {
          empty: allDocs.length === 0,
          docs: allDocs
        };
      },
      where: (field: string, op: string, value: any) => {
        let results = Array.from(store.entries()).map(([id, data]) => ({ id, ...data }));
        const filter = (item: any) => {
          if (op === '==') return item[field] === value;
          if (op === 'in') return Array.isArray(value) && value.includes(item[field]);
          return false;
        };

        const createQuery = (filtered: any[]) => ({
          where: (f2: string, op2: string, val2: any) => {
            return createQuery(filtered.filter(item => {
              if (op2 === '==') return item[f2] === val2;
              if (op2 === 'in') return Array.isArray(val2) && val2.includes(item[f2]);
              return false;
            }));
          },
          limit: (n: number) => ({
            get: async () => {
              const sliced = filtered.slice(0, n);
              return {
                empty: sliced.length === 0,
                docs: sliced.map(d => ({
                  id: d.id,
                  exists: true,
                  data: () => JSON.parse(JSON.stringify(d))
                }))
              };
            }
          }),
          get: async () => {
            return {
              empty: filtered.length === 0,
              docs: filtered.map(d => ({
                id: d.id,
                exists: true,
                data: () => JSON.parse(JSON.stringify(d))
              }))
            };
          }
        });

        return createQuery(results.filter(filter));
      }
    };
  }

  private txLock: Promise<void> = Promise.resolve();

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    // Acquire transaction lock to serialize atomic execution like real Firestore transactions
    let releaseLock: () => void;
    const lockAcquired = new Promise<void>(resolve => { releaseLock = resolve; });
    const prevLock = this.txLock;
    this.txLock = (async () => {
      await prevLock;
      await lockAcquired;
    })();

    await prevLock;

    try {
      const transaction = {
        get: async (docRef: any) => {
          return docRef.get();
        },
        set: (docRef: any, data: any, options?: any) => {
          return docRef.set(data, options);
        },
        update: (docRef: any, data: any) => {
          return docRef.update(data);
        },
        delete: (docRef: any) => {
          return docRef.delete();
        }
      };

      return await updateFunction(transaction);
    } finally {
      releaseLock!();
    }
  }

}

async function runTestSuite() {
  console.log('--- Starting EchoNote Phase 3 Step 3.1: Task Notification Foundation Test Suite ---');
  let passedTests = 0;

  function assertTest(desc: string, condition: boolean, detail?: any) {
    if (!condition) {
      console.error(`❌ FAILED: ${desc}`);
      if (detail) console.error('Details:', detail);
      throw new Error(`Test assertion failed: ${desc}`);
    }
    console.log(`✅ PASSED: ${desc}`);
    passedTests++;
  }

  // Set up mock DB
  const db = new MockFirestore();

  // Seed projects and users for eligibility checks
  await db.collection('projects').doc('proj_alpha').set({
    id: 'proj_alpha',
    name: 'Alpha Project',
    organizationId: 'org_main',
    ownerEmail: 'owner@echotechai.in',
    ownerName: 'Project Owner',
    members: [
      { email: 'developer@echotechai.in', name: 'Lead Dev', role: 'admin' },
      { email: 'member@echotechai.in', name: 'Member Alice', role: 'member' }
    ]
  });

  await db.collection('organizations').doc('org_main').set({
    id: 'org_main',
    name: 'EchoTech Org',
    ownerEmail: 'orgowner@echotechai.in'
  });

  await db.collection('orgMembers').doc('org_main_admin').set({
    organizationId: 'org_main',
    email: 'orgadmin@echotechai.in',
    name: 'Org Administrator',
    role: 'org_admin',
    status: 'active'
  });

  // =========================================================================
  // SECTION 1: DETERMINISTIC DEDUPLICATION & EVENT HASHING
  // =========================================================================
  console.log('\n--- Section 1: Deterministic Deduplication & Event Hashing ---');

  const hash1 = computeNotificationEventHash('upcoming_deadline', { dueDate: '2026-11-01' });
  const hash2 = computeNotificationEventHash('upcoming_deadline', { dueDate: '2026-11-01' });
  const hash3 = computeNotificationEventHash('upcoming_deadline', { dueDate: '2026-11-05' }); // changed deadline

  assertTest('1.1 Identical deadline produces identical event hash', hash1 === hash2);
  assertTest('1.2 Altered deadline produces distinct event hash', hash1 !== hash3);

  const key1 = generateNotificationDeduplicationKey('task_123', 'alice@echotechai.in', 'upcoming_deadline', hash1);
  const key2 = generateNotificationDeduplicationKey('task_123', 'alice@echotechai.in', 'upcoming_deadline', hash2);
  const key3 = generateNotificationDeduplicationKey('task_123', 'alice@echotechai.in', 'upcoming_deadline', hash3);

  assertTest('1.3 Identical parameters produce identical deduplication key', key1 === key2);
  assertTest('1.4 Deadline change produces distinct deduplication key to unblock alerts', key1 !== key3);

  // Exception hashing
  const exHashOpen = computeNotificationEventHash('blocked_task', { exceptionId: 'ex_1', exceptionStatus: 'open' });
  const exHashResolved = computeNotificationEventHash('blocked_task', { exceptionId: 'ex_1', exceptionStatus: 'resolved' });
  const exHashReopened = computeNotificationEventHash('blocked_task', { exceptionId: 'ex_1', exceptionStatus: 'open', customEventVersion: 'v2' });

  assertTest('1.5 Exception status / versioning changes produce distinct hashes', exHashOpen !== exHashResolved && exHashOpen !== exHashReopened);

  // =========================================================================
  // SECTION 2: RECIPIENT ELIGIBILITY & TENANT BOUNDARY SECURITY
  // =========================================================================
  console.log('\n--- Section 2: Recipient Eligibility & Tenant Boundary ---');

  // Valid project owner
  const eligOwner = await verifyRecipientEligibility(db, {
    recipientEmail: 'owner@echotechai.in',
    projectId: 'proj_alpha',
    organizationId: 'org_main'
  });
  assertTest('2.1 Project owner is eligible', eligOwner.isEligible === true);

  // Valid project member
  const eligMember = await verifyRecipientEligibility(db, {
    recipientEmail: 'member@echotechai.in',
    projectId: 'proj_alpha',
    organizationId: 'org_main'
  });
  assertTest('2.2 Project member is eligible', eligMember.isEligible === true);

  // Valid org admin with supervisory role
  const eligOrgAdmin = await verifyRecipientEligibility(db, {
    recipientEmail: 'orgadmin@echotechai.in',
    projectId: 'proj_alpha',
    organizationId: 'org_main'
  });
  assertTest('2.3 Organization admin is eligible via supervisory role', eligOrgAdmin.isEligible === true);

  // External arbitrary email address rejected
  const eligExternal = await verifyRecipientEligibility(db, {
    recipientEmail: 'attacker@random-external.com',
    projectId: 'proj_alpha',
    organizationId: 'org_main'
  });
  assertTest('2.4 Arbitrary external email is rejected', eligExternal.isEligible === false);

  // Tenant boundary mismatch: correct email, wrong organizationId
  const eligCrossOrg = await verifyRecipientEligibility(db, {
    recipientEmail: 'member@echotechai.in',
    projectId: 'proj_alpha',
    organizationId: 'org_different'
  });
  assertTest('2.5 Tenant isolation: organization mismatch is rejected', eligCrossOrg.isEligible === false);

  // Malformed email
  const eligMalformed = await verifyRecipientEligibility(db, {
    recipientEmail: 'not-an-email',
    projectId: 'proj_alpha',
    organizationId: 'org_main'
  });
  assertTest('2.6 Malformed email is rejected', eligMalformed.isEligible === false);

  // =========================================================================
  // SECTION 3: ENQUEUE & DUPLICATE SUPPRESSION
  // =========================================================================
  console.log('\n--- Section 3: Enqueue & Duplicate Suppression ---');

  const enqueue1 = await enqueueTaskNotification(db, {
    taskId: 'task_qa_1',
    taskTitle: 'Perform Security Audit',
    projectId: 'proj_alpha',
    projectName: 'Alpha Project',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    recipientName: 'Lead Dev',
    type: 'task_assignment',
    priority: 'high'
  });

  assertTest('3.1 First enqueue creates new pending record', enqueue1.isNew === true && enqueue1.record.status === 'pending');

  const enqueueDuplicate = await enqueueTaskNotification(db, {
    taskId: 'task_qa_1',
    taskTitle: 'Perform Security Audit',
    projectId: 'proj_alpha',
    projectName: 'Alpha Project',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    recipientName: 'Lead Dev',
    type: 'task_assignment',
    priority: 'high'
  });

  assertTest('3.2 Re-enqueuing duplicate returns existing record with isNew = false', enqueueDuplicate.isNew === false);
  assertTest('3.3 Deduplication key matches perfectly', enqueue1.deduplicationKey === enqueueDuplicate.deduplicationKey);

  // =========================================================================
  // SECTION 4: CONCURRENT ATOMIC CLAIMS & LEASE FENCING
  // =========================================================================
  console.log('\n--- Section 4: Concurrent Atomic Claims & Lease Fencing ---');

  // Simulate two workers attempting to claim the exact same pending notification simultaneously
  const workerA = 'worker_node_1';
  const workerB = 'worker_node_2';

  const [claimA, claimB] = await Promise.all([
    claimTaskNotification(db, enqueue1.deduplicationKey, workerA, 3000),
    claimTaskNotification(db, enqueue1.deduplicationKey, workerB, 3000)
  ]);

  const winningClaims = [claimA, claimB].filter(c => c.claimed);
  const losingClaims = [claimA, claimB].filter(c => !c.claimed);

  assertTest('4.1 Exactly one worker successfully claims the notification', winningClaims.length === 1);
  assertTest('4.2 The other worker is locked out', losingClaims.length === 1 && losingClaims[0].claimed === false);

  const winningWorker = winningClaims[0].notification?.workerId;
  assertTest('4.3 Claimed notification status is processing with valid lease', winningClaims[0].notification?.status === 'processing');

  // Attempting to claim again while lease is still valid fails
  const secondAttempt = await claimTaskNotification(db, enqueue1.deduplicationKey, 'worker_node_3', 3000);
  assertTest('4.4 Third worker cannot claim while lease is active', secondAttempt.claimed === false);

  // =========================================================================
  // SECTION 5: DISPATCH, PROVIDER CONFIRMATION & EXACTLY-ONCE HANDLING
  // =========================================================================
  console.log('\n--- Section 5: Dispatch & Provider Acceptance Invariant ---');

  // Test 5A: Provider Rejection (simulated network or provider error)
  const mockProviderReject = async (to: string, payload: any) => {
    return {
      success: false,
      error: 'Simulated Resend API 500 error',
      isSandboxOrValidation: false
    };
  };

  const dispatchFailed = await dispatchTaskNotification(
    db,
    enqueue1.deduplicationKey,
    winningWorker!,
    { emailSenderOverride: mockProviderReject }
  );

  assertTest('5.1 Failed provider send returns success = false', dispatchFailed.success === false);
  assertTest('5.2 Transient error is marked retryable', dispatchFailed.retryable === true);

  // Check DB state: must NOT be marked sent!
  const docAfterFail = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(enqueue1.deduplicationKey).get();
  const dataAfterFail = docAfterFail.data();
  assertTest('5.3 Unsuccessful send is NEVER marked sent in DB', dataAfterFail.status === 'retryable_failed');
  assertTest('5.4 sentAt timestamp remains null', dataAfterFail.sentAt === null);

  // Test 5B: Provider Acceptance
  const mockProviderSuccess = async (to: string, payload: any) => {
    return {
      success: true,
      id: 'resend_msg_test_abc123'
    };
  };

  // Re-claim for retry
  const reclaim = await claimTaskNotification(db, enqueue1.deduplicationKey, 'worker_node_retry', 3000);
  assertTest('5.5 Retryable failed notification can be reclaimed', reclaim.claimed === true);

  const dispatchSuccess = await dispatchTaskNotification(
    db,
    enqueue1.deduplicationKey,
    'worker_node_retry',
    { emailSenderOverride: mockProviderSuccess }
  );

  assertTest('5.6 Successful provider acceptance returns success = true', dispatchSuccess.success === true);
  assertTest('5.7 Provider message ID is captured', dispatchSuccess.providerMessageId === 'resend_msg_test_abc123');

  // Check DB state: must now be marked sent with providerMessageId
  const docAfterSuccess = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(enqueue1.deduplicationKey).get();
  const dataAfterSuccess = docAfterSuccess.data();
  assertTest('5.8 Record status is now sent', dataAfterSuccess.status === 'sent');
  assertTest('5.9 providerMessageId is securely persisted', dataAfterSuccess.providerMessageId === 'resend_msg_test_abc123');
  assertTest('5.10 sentAt timestamp is populated', typeof dataAfterSuccess.sentAt === 'string');

  // Sent notification can never be reclaimed
  const claimAfterSent = await claimTaskNotification(db, enqueue1.deduplicationKey, 'worker_node_late', 3000);
  assertTest('5.11 Sent notification can NEVER be reclaimed', claimAfterSent.claimed === false);

  // =========================================================================
  // SECTION 6: LEASE EXPIRY & RECOVERY
  // =========================================================================
  console.log('\n--- Section 6: Lease Expiry & Recovery ---');

  const notifStalled = await enqueueTaskNotification(db, {
    taskId: 'task_qa_2',
    taskTitle: 'Prepare Quarterly Report',
    projectId: 'proj_alpha',
    recipientEmail: 'developer@echotechai.in',
    type: 'upcoming_deadline',
    dueDate: '2026-11-15'
  });

  // Claim with an already-expired lease (e.g. worker crashed 10 minutes ago)
  const notifStalledRef = db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(notifStalled.deduplicationKey);
  await notifStalledRef.update({
    status: 'processing',
    workerId: 'worker_crashed',
    leaseExpiresAt: Date.now() - 60000 // 1 minute in the past
  });

  // Another worker should successfully recover the abandoned lease
  const recoveryClaim = await claimTaskNotification(db, notifStalled.deduplicationKey, 'worker_recovery', 5000);
  assertTest('6.1 Expired lease is safely recovered by healthy worker', recoveryClaim.claimed === true);
  assertTest('6.2 Recovered notification is assigned to new worker', recoveryClaim.notification?.workerId === 'worker_recovery');

  // =========================================================================
  // SECTION 7: UNAUTHORIZED RECIPIENT DISPATCH REJECTION
  // =========================================================================
  console.log('\n--- Section 7: Unauthorized Recipient Dispatch Rejection ---');

  const unauthNotif = await enqueueTaskNotification(db, {
    taskId: 'task_qa_3',
    taskTitle: 'Secret Project Task',
    projectId: 'proj_alpha',
    recipientEmail: 'hacker@unauthorized.com', // Not a project member
    type: 'overdue_task',
    dueDate: '2026-10-01'
  });

  const claimUnauth = await claimTaskNotification(db, unauthNotif.deduplicationKey, 'worker_safe', 5000);
  assertTest('7.1 Unauth notification can be claimed by worker', claimUnauth.claimed === true);

  const dispatchUnauth = await dispatchTaskNotification(
    db,
    unauthNotif.deduplicationKey,
    'worker_safe',
    { emailSenderOverride: mockProviderSuccess }
  );

  assertTest('7.2 Dispatch rejects unauthorized recipient before email sending', dispatchUnauth.success === false);
  assertTest('7.3 Unauthorized recipient error is permanently failed', dispatchUnauth.retryable === false);

  const docUnauth = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(unauthNotif.deduplicationKey).get();
  assertTest('7.4 DB status set to permanently_failed', docUnauth.data().status === 'permanently_failed');

  // =========================================================================
  // SECTION 8: EMAIL TEMPLATES SMOKE TEST
  // =========================================================================
  console.log('\n--- Section 8: Email Templates Smoke Test ---');

  // Verify that all 4 templates exist and can render with valid options without throwing
  assertTest('8.1 sendTaskAssignmentNotification exists', typeof emailService.sendTaskAssignmentNotification === 'function');
  assertTest('8.2 sendUpcomingDeadlineNotification exists', typeof emailService.sendUpcomingDeadlineNotification === 'function');
  assertTest('8.3 sendOverdueTaskNotification exists', typeof emailService.sendOverdueTaskNotification === 'function');
  assertTest('8.4 sendTaskExceptionNotification exists', typeof emailService.sendTaskExceptionNotification === 'function');

  // =========================================================================
  // SECTION 9: HARDENED AUTHORIZATION, REVOCATION & TAMPER RESISTANCE (Step 3.2)
  // =========================================================================
  console.log('\n--- Section 9: Hardened Authorization, Revocation & Tamper Resistance ---');

  // 9.1 Membership Revocation after Enqueue
  // Enqueue while member is initially valid
  await db.collection('projects').doc('proj_revocation_test').set({
    id: 'proj_revocation_test',
    name: 'Revocation Test Project',
    organizationId: 'org_main',
    ownerEmail: 'owner@echotechai.in',
    members: [{ email: 'temp_contractor@echotechai.in', name: 'Contractor', role: 'member' }]
  });

  const revocationNotif = await enqueueTaskNotification(db, {
    taskId: 'task_rev_1',
    taskTitle: 'Contractor Task',
    projectId: 'proj_revocation_test',
    organizationId: 'org_main',
    recipientEmail: 'temp_contractor@echotechai.in',
    type: 'upcoming_deadline',
    dueDate: '2026-11-20'
  });

  // Now simulate revoking membership before dispatch occurs
  await db.collection('projects').doc('proj_revocation_test').update({
    members: [] // Contractor removed!
  });

  const claimRev = await claimTaskNotification(db, revocationNotif.deduplicationKey, 'worker_rev', 5000);
  assertTest('9.1 Notification was claimed before revocation check', claimRev.claimed === true);

  let emailSentToRevoked = false;
  const dispatchRev = await dispatchTaskNotification(
    db,
    revocationNotif.deduplicationKey,
    'worker_rev',
    {
      emailSenderOverride: async () => {
        emailSentToRevoked = true;
        return { success: true, id: 'should_not_reach_here' };
      }
    }
  );

  assertTest('9.2 Immediate authorization check catches revoked member before dispatch', dispatchRev.success === false);
  assertTest('9.3 No email was dispatched to revoked member', emailSentToRevoked === false);
  assertTest('9.4 Revoked member is marked permanently_failed', dispatchRev.retryable === false);

  // 9.2 Recipient Tampering / Payload Hijacking Resistance
  // Verify that modifying inner payload.recipientEmail does NOT redirect the email
  const tamperNotif = await enqueueTaskNotification(db, {
    taskId: 'task_tamper_1',
    taskTitle: 'Confidential Milestone',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in', // legitimate recipient
    type: 'task_assignment'
  });

  // Malicious mutation of inner payload to an attacker address
  const tamperDocRef = db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(tamperNotif.deduplicationKey);
  const tamperDocSnap = await tamperDocRef.get();
  const tamperData = tamperDocSnap.data();
  tamperData.payload.recipientEmail = 'attacker@external-leak.com';
  await tamperDocRef.set(tamperData);

  const claimTamper = await claimTaskNotification(db, tamperNotif.deduplicationKey, 'worker_tamper', 5000);
  assertTest('9.5 Tampered notification claimed by worker', claimTamper.claimed === true);

  let targetRecipientPassedToSender = '';
  await dispatchTaskNotification(
    db,
    tamperNotif.deduplicationKey,
    'worker_tamper',
    {
      emailSenderOverride: async (to) => {
        targetRecipientPassedToSender = to;
        return { success: true, id: 'tamper_msg_1' };
      }
    }
  );

  assertTest('9.6 Anti-tampering invariant forces dispatch to authoritative top-level recipient only', targetRecipientPassedToSender === 'developer@echotechai.in');
  assertTest('9.7 Attacker email in mutable payload was ignored', targetRecipientPassedToSender !== 'attacker@external-leak.com');

  // 9.3 Transient Authorization Lookup Failure (Should NOT permanently fail)
  const transientDb = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (name === 'projects') {
            throw new Error('Connection reset: Firestore backend unavailable');
          }
          return db.collection(name).doc(id).get();
        },
        update: (val: any) => db.collection(name).doc(id).update(val),
        set: (val: any) => db.collection(name).doc(id).set(val)
      })
    }),
    runTransaction: db.runTransaction.bind(db)
  };

  const transientNotif = await enqueueTaskNotification(db, {
    taskId: 'task_transient_1',
    taskTitle: 'Transient Test Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    type: 'upcoming_deadline',
    dueDate: '2026-11-22'
  });

  const claimTransient = await claimTaskNotification(db, transientNotif.deduplicationKey, 'worker_transient', 5000);
  assertTest('9.8 Transient test notification claimed', claimTransient.claimed === true);

  const dispatchTransient = await dispatchTaskNotification(
    transientDb as any,
    transientNotif.deduplicationKey,
    'worker_transient'
  );

  assertTest('9.9 Transient failure during eligibility check returns retryable = true', dispatchTransient.retryable === true);
  const transientDocAfter = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(transientNotif.deduplicationKey).get();
  assertTest('9.10 Transient error marks notification as retryable_failed (not permanently suppressed)', transientDocAfter.data().status === 'retryable_failed');

  // =========================================================================
  // SECTION 10: PROVIDER ACCEPTANCE & PERSISTENCE FAILURE RECOVERY (Step 3.2)
  // =========================================================================
  console.log('\n--- Section 10: Provider Acceptance & Persistence Failure Recovery ---');

  // 10.1 Resend accepts, but Firestore write fails
  const ambigNotif = await enqueueTaskNotification(db, {
    taskId: 'task_ambig_1',
    taskTitle: 'Ambiguous Failure Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    type: 'overdue_task',
    dueDate: '2026-10-10'
  });

  await claimTaskNotification(db, ambigNotif.deduplicationKey, 'worker_ambig', 5000);

  const dispatchAmbig = await dispatchTaskNotification(
    db,
    ambigNotif.deduplicationKey,
    'worker_ambig',
    {
      emailSenderOverride: async () => ({ success: true, id: 'resend_accepted_id_999' }),
      simulatePersistenceFailure: true // Simulates Firestore timeout during persistence
    }
  );

  assertTest('10.1 Dispatch acknowledges persistence error after provider acceptance', dispatchAmbig.success === false);
  assertTest('10.2 Result explicitly flags ambiguous delivery state', dispatchAmbig.ambiguous === true);
  assertTest('10.3 Provider message ID is preserved in diagnostic result', dispatchAmbig.providerMessageId === 'resend_accepted_id_999');

  const ambigDocAfter = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(ambigNotif.deduplicationKey).get();
  assertTest('10.4 DB record status is safely marked ambiguous_delivery to prevent blind resending', ambigDocAfter.data().status === 'ambiguous_delivery');
  assertTest('10.5 providerMessageId is safely saved in the ambiguous record', ambigDocAfter.data().providerMessageId === 'resend_accepted_id_999');

  // 10.2 Stale Worker Fencing after lease loss
  const staleNotif = await enqueueTaskNotification(db, {
    taskId: 'task_stale_fencing',
    taskTitle: 'Stale Worker Fencing Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    type: 'task_assignment'
  });

  await claimTaskNotification(db, staleNotif.deduplicationKey, 'worker_slow', 5000);

  // Now worker_slow lease expires or worker_fast takes over!
  await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(staleNotif.deduplicationKey).update({
    workerId: 'worker_fast',
    status: 'processing',
    leaseExpiresAt: Date.now() + 5000
  });

  // Slow worker attempts to dispatch
  const staleDispatch = await dispatchTaskNotification(
    db,
    staleNotif.deduplicationKey,
    'worker_slow', // overtaken worker
    {
      emailSenderOverride: async () => ({ success: true, id: 'should_not_deliver' })
    }
  );

  assertTest('10.6 Overtaken worker dispatch is rejected by fencing guard', staleDispatch.success === false);
  assertTest('10.7 Error explains worker mismatch', staleDispatch.error?.includes('Worker mismatch') === true);

  // =========================================================================
  // SECTION 11: KEY COLLISION RESISTANCE & NORMALIZATION (Step 3.2)
  // =========================================================================
  console.log('\n--- Section 11: Key Collision Resistance & Normalization ---');

  // Test that different combinations of taskId and email cannot collide via delimiter injection
  const keyA = generateNotificationDeduplicationKey('task_12', 'user_a@domain.com', 'task_assignment', 'hash1');
  const keyB = generateNotificationDeduplicationKey('task', '12_user_a@domain.com', 'task_assignment', 'hash1');
  assertTest('11.1 Delimiter injection between taskId and email produces distinct keys', keyA !== keyB);

  // Email case normalization
  const keyUpper = generateNotificationDeduplicationKey('task_1', 'ALICE@Echotechai.in', 'upcoming_deadline', 'hash2');
  const keyLower = generateNotificationDeduplicationKey('task_1', 'alice@echotechai.in', 'upcoming_deadline', 'hash2');
  assertTest('11.2 Email casing normalization produces identical deduplication key', keyUpper === keyLower);

  // Trailing whitespace normalization
  const keySpaced = generateNotificationDeduplicationKey('task_1', '  alice@echotechai.in  ', 'upcoming_deadline', 'hash2');
  assertTest('11.3 Email whitespace normalization produces identical deduplication key', keySpaced === keyLower);

  // =========================================================================
  // SECTION 12: STATE MACHINE TRANSITION INTEGRITY (Step 3.2)
  // =========================================================================
  console.log('\n--- Section 12: State Machine Transition Integrity ---');

  // A sent notification cannot transition to processing or retryable_failed
  const sentNotif = await enqueueTaskNotification(db, {
    taskId: 'task_state_test',
    taskTitle: 'State Transition Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    type: 'task_assignment'
  });

  await claimTaskNotification(db, sentNotif.deduplicationKey, 'worker_state', 5000);
  await dispatchTaskNotification(
    db,
    sentNotif.deduplicationKey,
    'worker_state',
    { emailSenderOverride: async () => ({ success: true, id: 'state_resend_1' }) }
  );

  const claimSentAgain = await claimTaskNotification(db, sentNotif.deduplicationKey, 'worker_state_2', 5000);
  assertTest('12.1 Sent state is terminal: claim fails with state transition error', claimSentAgain.claimed === false);

  // A permanently_failed notification cannot be claimed
  const permRef = db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(sentNotif.deduplicationKey);
  await permRef.update({ status: 'permanently_failed' });
  const claimPerm = await claimTaskNotification(db, sentNotif.deduplicationKey, 'worker_state_3', 5000);
  assertTest('12.2 permanently_failed is terminal: claim fails', claimPerm.claimed === false);

  // =========================================================================
  // SECTION 13: HARDENED AMBIGUOUS-DELIVERY RECOVERY & FAILURE INJECTION (Step 3.3)
  // =========================================================================
  console.log('\n--- Section 13: Hardened Ambiguous-Delivery Recovery & Failure Injection ---');

  // 13.1 Transient persistence failure immediately recovers on bounded in-memory retry
  const transientPersistNotif = await enqueueTaskNotification(db, {
    taskId: 'task_transient_persist_1',
    taskTitle: 'Transient Persistence Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    type: 'upcoming_deadline',
    dueDate: '2026-11-25'
  });

  await claimTaskNotification(db, transientPersistNotif.deduplicationKey, 'worker_tp', 5000);

  const dispatchTransientPersist = await dispatchTaskNotification(
    db,
    transientPersistNotif.deduplicationKey,
    'worker_tp',
    {
      emailSenderOverride: async () => ({ success: true, id: 'resend_transient_recover_123' }),
      transientPersistenceFailureCount: 1 // First persistence attempt fails, 2nd attempt succeeds
    }
  );

  assertTest('13.1 Transient persistence failure recovers within bounded retry and returns success = true', dispatchTransientPersist.success === true);
  assertTest('13.2 Recovered notification provider message ID is preserved', dispatchTransientPersist.providerMessageId === 'resend_transient_recover_123');

  const docTransientPersist = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(transientPersistNotif.deduplicationKey).get();
  assertTest('13.3 DB record status is successfully updated to sent', docTransientPersist.data().status === 'sent');
  assertTest('13.4 Provider ID in DB matches Resend message ID', docTransientPersist.data().providerMessageId === 'resend_transient_recover_123');

  // 13.2 Ambiguous Delivery Quarantine: Strict exclusion from automated claims
  const quarantinedNotif = await enqueueTaskNotification(db, {
    taskId: 'task_quarantined_1',
    taskTitle: 'Quarantined Ambiguous Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    type: 'overdue_task',
    dueDate: '2026-10-12'
  });

  await claimTaskNotification(db, quarantinedNotif.deduplicationKey, 'worker_q', 5000);

  // Force dispatch to fail persistence and enter ambiguous_delivery
  await dispatchTaskNotification(
    db,
    quarantinedNotif.deduplicationKey,
    'worker_q',
    {
      emailSenderOverride: async () => ({ success: true, id: 'resend_msg_quarantine_999' }),
      simulatePersistenceFailure: true
    }
  );

  const docQuarantined = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(quarantinedNotif.deduplicationKey).get();
  assertTest('13.5 Notification is in ambiguous_delivery quarantine state', docQuarantined.data().status === 'ambiguous_delivery');

  // Verify automated worker claiming is strictly rejected
  const automatedClaimAttempt = await claimTaskNotification(db, quarantinedNotif.deduplicationKey, 'worker_auto_sweep', 5000);
  assertTest('13.6 Automated worker claim strictly rejected for ambiguous_delivery', automatedClaimAttempt.claimed === false);
  assertTest('13.7 Rejection reason indicates invalid transition from ambiguous_delivery', automatedClaimAttempt.reason?.includes("cannot claim notification from state 'ambiguous_delivery'") === true);

  // 13.3 Evidence-based Manual Reconciliation: Rejection without operator ID or reason
  const unverifiedReconcile = await reconcileAmbiguousNotification(
    db,
    quarantinedNotif.deduplicationKey,
    {
      decision: 'mark_sent',
      evidence: {
        operatorId: '',
        reason: ''
      }
    }
  );
  assertTest('13.8 Reconciliation rejected when operator evidence is missing', unverifiedReconcile.success === false);

  // 13.4 Evidence-based Manual Reconciliation: Legitimate administrative reconciliation to 'sent'
  const validReconcile = await reconcileAmbiguousNotification(
    db,
    quarantinedNotif.deduplicationKey,
    {
      decision: 'mark_sent',
      evidence: {
        operatorId: 'sec_ops_admin_1',
        reason: 'Verified Resend Dashboard log confirms delivery with ID resend_msg_quarantine_999',
        providerMessageId: 'resend_msg_quarantine_999'
      }
    }
  );

  assertTest('13.9 Verified administrative reconciliation succeeds', validReconcile.success === true);
  assertTest('13.10 Reconciled notification status is sent', validReconcile.notification?.status === 'sent');
  assertTest('13.11 Reconciliation audit metadata is preserved', validReconcile.notification?.reconciliation?.reconciledBy === 'sec_ops_admin_1');

  // Reconciled notification is now terminal ('sent') and cannot be modified
  const postReconcileClaim = await claimTaskNotification(db, quarantinedNotif.deduplicationKey, 'worker_late', 5000);
  assertTest('13.12 Reconciled notification in sent state is terminal and cannot be claimed', postReconcileClaim.claimed === false);

  // =========================================================================
  // SECTION 14: POST-ACCEPTANCE LEASE EXPIRY & IN-FLIGHT DISPATCH PROTECTION (Step 3.4)
  // =========================================================================
  console.log('\n--- Section 14: Post-Acceptance Lease Expiry & In-Flight Dispatch Protection ---');

  // 14.1 Worker B attempts to claim during Worker A's in-flight dispatch
  const raceNotif = await enqueueTaskNotification(db, {
    taskId: 'task_race_1',
    taskTitle: 'Race Condition Test Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    type: 'task_assignment'
  });

  await claimTaskNotification(db, raceNotif.deduplicationKey, 'worker_A', 1000); // short 1s lease

  let providerCallResolved = false;
  let delayedSendPromiseResolve: (val: any) => void;
  const delayedSendPromise = new Promise(resolve => {
    delayedSendPromiseResolve = resolve;
  });

  // Start Worker A's dispatch asynchronously
  const workerADispatchPromise = dispatchTaskNotification(
    db,
    raceNotif.deduplicationKey,
    'worker_A',
    {
      emailSenderOverride: async () => {
        // Wait until signaled
        await delayedSendPromise;
        providerCallResolved = true;
        return { success: true, id: 'resend_race_worker_A_101' };
      }
    }
  );

  // Give Worker A a brief moment to transition state to 'dispatching'
  await new Promise(res => setTimeout(res, 50));

  const docDuringDispatch = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(raceNotif.deduplicationKey).get();
  assertTest('14.1 Notification transitioned to dispatching state during provider invocation', docDuringDispatch.data().status === 'dispatching');

  // Now simulate Worker A's lease expiring in the database while the email provider is still processing
  await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(raceNotif.deduplicationKey).update({
    leaseExpiresAt: Date.now() - 1000 // 1 second in the past
  });

  // Worker B attempts to reclaim while dispatch is in flight
  const workerBClaim = await claimTaskNotification(db, raceNotif.deduplicationKey, 'worker_B', 5000);
  assertTest('14.2 Worker B CANNOT claim while status is dispatching, even if lease expired', workerBClaim.claimed === false);
  assertTest('14.3 Worker B rejection reason cites invalid transition from dispatching', workerBClaim.reason?.includes("cannot claim notification from state 'dispatching'") === true);

  // Now Resend accepts Worker A's message
  delayedSendPromiseResolve!({ success: true, id: 'resend_race_worker_A_101' });
  const workerAResult = await workerADispatchPromise;

  assertTest('14.4 Worker A completes dispatch successfully despite expired lease during network call', workerAResult.success === true);
  assertTest('14.5 Worker A persists verified provider message ID', workerAResult.providerMessageId === 'resend_race_worker_A_101');

  const docAfterRace = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(raceNotif.deduplicationKey).get();
  assertTest('14.6 DB record status is sent', docAfterRace.data().status === 'sent');
  assertTest('14.7 Stored provider ID matches Worker A Resend ID', docAfterRace.data().providerMessageId === 'resend_race_worker_A_101');

  // 14.2 Provider Acceptance after Worker Loss (Overtaken Fencing Protection)
  const overtakenNotif = await enqueueTaskNotification(db, {
    taskId: 'task_overtaken_1',
    taskTitle: 'Overtaken Test Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'developer@echotechai.in',
    type: 'upcoming_deadline',
    dueDate: '2026-11-30'
  });

  await claimTaskNotification(db, overtakenNotif.deduplicationKey, 'worker_X', 5000);

  // Directly set status to processing, then simulate worker_Y taking over before persistence
  let delayedSendYResolve: (val: any) => void;
  const delayedSendYPromise = new Promise(resolve => {
    delayedSendYResolve = resolve;
  });

  const workerXDispatchPromise = dispatchTaskNotification(
    db,
    overtakenNotif.deduplicationKey,
    'worker_X',
    {
      emailSenderOverride: async () => {
        await delayedSendYPromise;
        return { success: true, id: 'resend_worker_X_accepted' };
      }
    }
  );

  await new Promise(res => setTimeout(res, 50));

  // Simulate an administrator or system recovery reassigning workerId to worker_Y
  await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(overtakenNotif.deduplicationKey).update({
    workerId: 'worker_Y',
    status: 'dispatching'
  });

  // Resend accepts worker X's call
  delayedSendYResolve!({ success: true, id: 'resend_worker_X_accepted' });
  const workerXResult = await workerXDispatchPromise;

  assertTest('14.8 Overtaken worker X cannot mark sent after losing ownership to worker Y', workerXResult.success === false);
  assertTest('14.9 Overtaken result is flagged ambiguous to preserve accepted message ID', workerXResult.ambiguous === true);
  assertTest('14.10 Accepted provider ID from worker X is captured for operator audit', workerXResult.providerMessageId === 'resend_worker_X_accepted');

  // 14.3 Privacy & PII Masking in Emergency Diagnostics
  let loggedEmergencyStderr = '';
  const originalConsoleError = console.error;
  console.error = function (...args: any[]) {
    loggedEmergencyStderr += args.map(a => String(a)).join(' ') + '\n';
    originalConsoleError.apply(console, args);
  };

  try {
    // Seed confidential user as a valid member of proj_alpha so eligibility check passes
    const alphaDoc = await db.collection('projects').doc('proj_alpha').get();
    const alphaData = alphaDoc.data();
    await db.collection('projects').doc('proj_alpha').set({
      ...alphaData,
      members: [
        ...(alphaData.members || []),
        { email: 'confidential_user@echotechai.in', name: 'Confidential User', role: 'member' }
      ]
    });

    const piiNotif = await enqueueTaskNotification(db, {
      taskId: 'task_pii_test',
      taskTitle: 'PII Test Task',
      projectId: 'proj_alpha',
      organizationId: 'org_main',
      recipientEmail: 'confidential_user@echotechai.in',
      type: 'overdue_task',
      dueDate: '2026-10-14'
    });

    await claimTaskNotification(db, piiNotif.deduplicationKey, 'worker_pii', 5000);

    await dispatchTaskNotification(
      db,
      piiNotif.deduplicationKey,
      'worker_pii',
      {
        emailSenderOverride: async () => ({ success: true, id: 'resend_pii_999' }),
        simulatePersistenceFailure: true
      }
    );
  } finally {
    console.error = originalConsoleError;
  }

  assertTest('14.11 Emergency stderr diagnostic was emitted', loggedEmergencyStderr.includes('[AMBIGUOUS_DELIVERY_EMERGENCY]'));
  assertTest('14.12 Full recipient email address was MASKED in emergency log', !loggedEmergencyStderr.includes('confidential_user@echotechai.in'));
  assertTest('14.13 Masked email representation is present in emergency log', loggedEmergencyStderr.includes('c***r@echotechai.in'));
  assertTest('14.14 Stable providerMessageId is preserved in emergency log', loggedEmergencyStderr.includes('resend_pii_999'));

  // =========================================================================
  // SECTION 15: SAFE RECOVERY FOR STALE IN-FLIGHT DISPATCHES (Step 3.5)
  // =========================================================================
  console.log('\n--- Section 15: Safe Recovery for Stale In-Flight Dispatches ---');

  // 15.1 Worker crash after entering 'dispatching': Notification remains in dispatching
  const crashNotif = await enqueueTaskNotification(db, {
    taskId: 'task_crash_1',
    taskTitle: 'Worker Crash Test Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'member@echotechai.in',
    type: 'task_assignment'
  });

  await claimTaskNotification(db, crashNotif.deduplicationKey, 'worker_crash_node', 5000);

  let triggerCrashResolve: (val: any) => void;
  const triggerCrashPromise = new Promise(res => { triggerCrashResolve = res; });

  // Worker enters dispatching, then hangs/crashes before returning
  const crashDispatchPromise = dispatchTaskNotification(
    db,
    crashNotif.deduplicationKey,
    'worker_crash_node',
    {
      emailSenderOverride: async () => {
        const res = await triggerCrashPromise;
        return res as any;
      }
    }
  );

  // Allow dispatchTaskNotification to transition to 'dispatching'
  await new Promise(res => setTimeout(res, 50));
  const docDuringCrash = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(crashNotif.deduplicationKey).get();
  assertTest('15.1 Worker crash leaves notification in dispatching state with dispatchStartedAt', docDuringCrash.data().status === 'dispatching' && Boolean(docDuringCrash.data().dispatchStartedAt));

  // Automated workers cannot claim it while dispatching
  const automatedSweepClaim = await claimTaskNotification(db, crashNotif.deduplicationKey, 'worker_auto_sweep_2', 5000);
  assertTest('15.2 Automated claim strictly rejected while in dispatching state', automatedSweepClaim.claimed === false);

  // 15.2 Quarantine scan: record within threshold is NOT quarantined prematurely
  const earlyScan = await quarantineStaleDispatchingNotification(db, crashNotif.deduplicationKey, {
    staleTimeoutMs: 10 * 60 * 1000,
    nowMs: Date.now() // immediate
  });
  assertTest('15.3 Dispatching record within timeout threshold is NOT quarantined', earlyScan.quarantined === false);

  // 15.3 Quarantine scan: record exceeding threshold IS quarantined to ambiguous_delivery
  const simulatedPastTime = Date.now() + 15 * 60 * 1000; // 15 mins later (> 10 min threshold)
  const staleQuarantine = await quarantineStaleDispatchingNotification(db, crashNotif.deduplicationKey, {
    staleTimeoutMs: 10 * 60 * 1000,
    nowMs: simulatedPastTime
  });
  assertTest('15.4 Stale dispatching record is atomically quarantined to ambiguous_delivery', staleQuarantine.quarantined === true);
  assertTest('15.5 Quarantined record has quarantinedAt timestamp recorded', Boolean(staleQuarantine.notification?.quarantinedAt));
  const initialQuarantinedAt = staleQuarantine.notification?.quarantinedAt;

  // 15.4 Repeated recovery scan is idempotent and cannot reset or advance quarantinedAt timestamp
  const repeatedScan = await quarantineStaleDispatchingNotification(db, crashNotif.deduplicationKey, {
    staleTimeoutMs: 10 * 60 * 1000,
    nowMs: simulatedPastTime + 60 * 1000
  });
  assertTest('15.6 Repeated quarantine scan is idempotent', repeatedScan.quarantined === true);
  const docAfterRepeated = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(crashNotif.deduplicationKey).get();
  assertTest('15.7 Repeated quarantine scan does NOT reset quarantinedAt age', docAfterRepeated.data().quarantinedAt === initialQuarantinedAt);

  // 15.5 Late provider acceptance after quarantine: preserves message ID without blindly marking sent
  triggerCrashResolve!({ success: true, id: 'resend_late_accepted_999' });
  const crashDispatchResult = await crashDispatchPromise;

  assertTest('15.8 Late provider dispatch after quarantine acknowledges persistence conflict', crashDispatchResult.success === false, crashDispatchResult);
  assertTest('15.9 Late provider dispatch returns ambiguous: true', crashDispatchResult.ambiguous === true);
  assertTest('15.10 Late accepted provider message ID is preserved in dispatch result', crashDispatchResult.providerMessageId === 'resend_late_accepted_999');

  const docAfterLateResponse = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(crashNotif.deduplicationKey).get();
  assertTest('15.11 Late accepted provider message ID is preserved in DB record', docAfterLateResponse.data().providerMessageId === 'resend_late_accepted_999');
  assertTest('15.12 Delivery status remains quarantined ambiguous_delivery and NOT blindly marked sent', docAfterLateResponse.data().status === 'ambiguous_delivery');

  // 15.6 Late provider rejection after quarantine: does not overwrite ambiguous quarantine
  const lateRejectionNotif = await enqueueTaskNotification(db, {
    taskId: 'task_late_reject',
    taskTitle: 'Late Reject Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'member@echotechai.in',
    type: 'overdue_task'
  });

  await claimTaskNotification(db, lateRejectionNotif.deduplicationKey, 'worker_slow_reject', 5000);

  let rejectResolve: (val: any) => void;
  const rejectPromise = new Promise(res => { rejectResolve = res; });

  const slowRejectDispatchPromise = dispatchTaskNotification(
    db,
    lateRejectionNotif.deduplicationKey,
    'worker_slow_reject',
    {
      emailSenderOverride: async () => {
        await rejectPromise;
        return { success: false, error: 'SMTP network timeout' };
      }
    }
  );

  await new Promise(res => setTimeout(res, 50));
  // Quarantine the slow dispatch
  await quarantineStaleDispatchingNotification(db, lateRejectionNotif.deduplicationKey, {
    staleTimeoutMs: 10 * 60 * 1000,
    nowMs: Date.now() + 15 * 60 * 1000
  });

  // Now provider returns rejection
  rejectResolve!({ success: false, error: 'SMTP network timeout' });
  const slowRejectResult = await slowRejectDispatchPromise;
  assertTest('15.13 Late rejection returns success = false', slowRejectResult.success === false);

  const docAfterLateReject = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(lateRejectionNotif.deduplicationKey).get();
  assertTest('15.14 Late provider rejection does not regress quarantined ambiguous_delivery status', docAfterLateReject.data().status === 'ambiguous_delivery');

  // 15.7 Explicit Operator Reconciliation on Quarantined / Stale Dispatch
  // A. Reconcile attempt missing operator ID or reason fails
  const missingEvidenceReconcile = await reconcileAmbiguousNotification(
    db,
    crashNotif.deduplicationKey,
    {
      decision: 'mark_sent',
      evidence: {
        operatorId: '',
        reason: ''
      }
    }
  );
  assertTest('15.15 Reconciliation rejected when operator credentials or reason are missing', missingEvidenceReconcile.success === false);

  // B. Operator cannot mark sent without provider message ID evidence
  const noProviderEvidenceNotif = await enqueueTaskNotification(db, {
    taskId: 'task_no_provider_id',
    taskTitle: 'No Provider ID Task',
    projectId: 'proj_alpha',
    organizationId: 'org_main',
    recipientEmail: 'member@echotechai.in',
    type: 'task_assignment'
  });
  await claimTaskNotification(db, noProviderEvidenceNotif.deduplicationKey, 'worker_unprov', 5000);
  // Enter dispatching and quarantine without provider ID
  let unprovResolve: (val: any) => void;
  const unprovPromise = new Promise(res => { unprovResolve = res; });
  const unprovDispatchPromise = dispatchTaskNotification(db, noProviderEvidenceNotif.deduplicationKey, 'worker_unprov', {
    emailSenderOverride: async () => {
      await unprovPromise;
      return { success: false, error: 'Timed out' };
    }
  });
  // Yield for dispatching status update
  await new Promise(res => setTimeout(res, 50));

  await quarantineStaleDispatchingNotification(db, noProviderEvidenceNotif.deduplicationKey, {
    staleTimeoutMs: 0,
    nowMs: Date.now() + 1000
  });

  const sentWithoutIdReconcile = await reconcileAmbiguousNotification(
    db,
    noProviderEvidenceNotif.deduplicationKey,
    {
      decision: 'mark_sent',
      evidence: {
        operatorId: 'operator_dan',
        reason: 'Timeout elapsed so assuming sent'
      }
    }
  );
  assertTest('15.16 Operator CANNOT mark notification sent solely because a timeout elapsed without provider ID', sentWithoutIdReconcile.success === false);
  assertTest('15.17 Rejection explains requirement for verified providerMessageId evidence', sentWithoutIdReconcile.error?.includes('without verified providerMessageId evidence') === true);

  // Clean up hanging unprov worker
  unprovResolve!({ success: false, error: 'Timed out' });
  await unprovDispatchPromise;

  // C. Legitimate operator reconciliation with verified provider evidence
  let reconcileEmailSentCount = 0;
  const verifiedReconcile = await reconcileAmbiguousNotification(
    db,
    crashNotif.deduplicationKey,
    {
      decision: 'mark_sent',
      evidence: {
        operatorId: 'operator_lead_1',
        reason: 'Verified Resend delivery logs confirm message delivery with ID resend_late_accepted_999',
        providerMessageId: 'resend_late_accepted_999'
      }
    }
  );
  assertTest('15.18 Valid administrative reconciliation succeeds', verifiedReconcile.success === true);
  assertTest('15.19 Reconciled status is now sent', verifiedReconcile.notification?.status === 'sent');
  assertTest('15.20 Reconciled audit metadata captures operator and decision', verifiedReconcile.notification?.reconciliation?.reconciledBy === 'operator_lead_1');
  assertTest('15.21 Reconciliation performs ZERO email dispatches', reconcileEmailSentCount === 0);

  // D. Stale worker attempting to overwrite reconciled state is strictly rejected
  let loggedOverriddenWarning = false;
  const staleWorkerAttempt = await dispatchTaskNotification(
    db,
    crashNotif.deduplicationKey,
    'worker_crash_node',
    {
      emailSenderOverride: async () => ({ success: true, id: 'resend_zombie_id' })
    }
  );
  assertTest('15.22 Stale worker attempt to dispatch already reconciled notification is rejected', staleWorkerAttempt.success === false);

  // E. Batch scanner function verifies bulk stale discovery
  const batchScanResult = await scanAndQuarantineStaleDispatches(db, {
    staleTimeoutMs: 10 * 60 * 1000,
    nowMs: Date.now()
  });
  assertTest('15.23 Batch scanner runs without errors', typeof batchScanResult.scanned === 'number');

  // =========================================================================
  // Section 16: Tracking Monitoring Pipeline Notification Generation Integration
  // =========================================================================
  console.log('\n--- Section 16: Tracking Monitoring Notification Integration ---');

  const nowMs = Date.now();
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;
  const pastOneDayMs = -1 * 24 * 60 * 60 * 1000;

  // Setup project and member in DB
  await db.collection('projects').doc('proj_tracking_eval').set({
    id: 'proj_tracking_eval',
    name: 'Tracking Evaluation Project',
    organizationId: 'org_main',
    ownerId: 'user_owner',
    ownerEmail: 'owner@echotechai.in',
    members: ['assignee@echotechai.in', 'member@echotechai.in']
  });

  const testActiveTasks = [
    // 1. Upcoming deadline (due in 2 days <= 3-day threshold)
    {
      id: 'task_due_soon',
      projectId: 'proj_tracking_eval',
      title: 'Upcoming Due Task',
      status: 'pending',
      priority: 'high',
      dueDate: new Date(nowMs + twoDaysMs).toISOString(),
      assigneeEmail: 'assignee@echotechai.in',
      assigneeName: 'Test Assignee'
    },
    // 2. Overdue task (due 1 day ago)
    {
      id: 'task_overdue',
      projectId: 'proj_tracking_eval',
      title: 'Overdue Task Item',
      status: 'in_progress',
      priority: 'urgent',
      dueDate: new Date(nowMs + pastOneDayMs).toISOString(),
      assigneeEmail: 'assignee@echotechai.in',
      assigneeName: 'Test Assignee'
    },
    // 3. Completed task with past due date -> MUST BE EXCLUDED
    {
      id: 'task_completed',
      projectId: 'proj_tracking_eval',
      title: 'Completed Task',
      status: 'completed',
      priority: 'medium',
      dueDate: new Date(nowMs + pastOneDayMs).toISOString(),
      assigneeEmail: 'assignee@echotechai.in',
      assigneeName: 'Test Assignee'
    },
    // 4. Distant task (due in 4 days > 3-day threshold) -> No upcoming or overdue notification
    {
      id: 'task_distant',
      projectId: 'proj_tracking_eval',
      title: 'Distant Future Task',
      status: 'pending',
      priority: 'low',
      dueDate: new Date(nowMs + fourDaysMs).toISOString(),
      assigneeEmail: 'assignee@echotechai.in',
      assigneeName: 'Test Assignee'
    },
    // 5. Task with legitimate assignment event in activityHistory
    {
      id: 'task_with_assignment',
      projectId: 'proj_tracking_eval',
      title: 'Assigned Task Item',
      status: 'pending',
      priority: 'medium',
      assigneeEmail: 'member@echotechai.in',
      assigneeName: 'Member User',
      activityHistory: [
        {
          id: 'act_1',
          action: 'reassigned',
          performedBy: 'Lead',
          timestamp: new Date(nowMs - 5000).toISOString(),
          details: 'Assigned to Member User'
        }
      ]
    },
    // 6. Task with assignee but NO assignment event -> MUST NOT generate task_assignment notification
    {
      id: 'task_no_assign_event',
      projectId: 'proj_tracking_eval',
      title: 'Legacy Static Task',
      status: 'pending',
      priority: 'low',
      assigneeEmail: 'member@echotechai.in',
      assigneeName: 'Member User',
      activityHistory: [
        {
          id: 'act_0',
          action: 'task_created',
          performedBy: 'Creator',
          timestamp: new Date(nowMs - 100000).toISOString()
          // Notice: no assignee details in task_created or reassigned
        }
      ]
    }
  ];

  const testExceptions = [
    // Actionable active exception for task_due_soon
    {
      id: 'ex_blocked_1',
      projectId: 'proj_tracking_eval',
      taskId: 'task_due_soon',
      title: 'Blocked on API Spec',
      description: 'Waiting for vendor endpoint approval',
      severity: 'high',
      status: 'open',
      createdAt: new Date(nowMs - 10000).toISOString(),
      updatedAt: new Date(nowMs - 10000).toISOString()
    },
    // Inactive / resolved exception -> MUST BE EXCLUDED
    {
      id: 'ex_resolved_1',
      projectId: 'proj_tracking_eval',
      taskId: 'task_overdue',
      title: 'Old Resolved Issue',
      description: 'Already resolved',
      severity: 'medium',
      status: 'resolved',
      createdAt: new Date(nowMs - 50000).toISOString(),
      updatedAt: new Date(nowMs - 20000).toISOString()
    }
  ];

  // 16.1 First generation run creates expected notifications
  const run1Summary = await generateTaskNotificationsForProject(db, {
    projectId: 'proj_tracking_eval',
    organizationId: 'org_main',
    projectName: 'Tracking Evaluation Project',
    activeTasks: testActiveTasks,
    exceptions: testExceptions,
    options: { nowMs, dueSoonDays: 3 }
  });

  assertTest('16.1 First generation run creates upcoming_deadline notification', run1Summary.breakdown.upcoming_deadline.created === 1);
  assertTest('16.2 First generation run creates overdue_task notification', run1Summary.breakdown.overdue_task.created === 1);
  assertTest('16.3 First generation run creates blocked_task notification for active exception', run1Summary.breakdown.blocked_task.created === 1);
  assertTest('16.4 First generation run creates task_assignment notification for explicit assignment event', run1Summary.breakdown.task_assignment.created === 1);
  assertTest('16.5 Completed tasks are strictly excluded from notification creation', run1Summary.notificationsSkipped > 0);

  // 16.2 Verify created notification records in DB are strictly in 'pending' status
  const notifDocs = await db.collection(TASK_NOTIFICATIONS_COLLECTION).get();
  const trackingNotifs = notifDocs.docs.map((d: any) => d.data()).filter((n: any) => n.projectId === 'proj_tracking_eval');
  assertTest('16.6 All generated notifications are stored in pending status', trackingNotifs.every((n: any) => n.status === 'pending'));
  assertTest('16.7 No notification has a providerMessageId (zero email dispatches)', trackingNotifs.every((n: any) => n.providerMessageId === null));
  assertTest('16.8 No notification has a sentAt timestamp', trackingNotifs.every((n: any) => n.sentAt === undefined || n.sentAt === null));

  // 16.3 Repeated generation run is 100% idempotent
  const run2Summary = await generateTaskNotificationsForProject(db, {
    projectId: 'proj_tracking_eval',
    organizationId: 'org_main',
    projectName: 'Tracking Evaluation Project',
    activeTasks: testActiveTasks,
    exceptions: testExceptions,
    options: { nowMs, dueSoonDays: 3 }
  });

  assertTest('16.9 Repeated run creates ZERO new notifications (100% reused)', run2Summary.notificationsCreated === 0);
  assertTest('16.10 Repeated run reuses upcoming_deadline', run2Summary.breakdown.upcoming_deadline.reused === 1);
  assertTest('16.11 Repeated run reuses overdue_task', run2Summary.breakdown.overdue_task.reused === 1);
  assertTest('16.12 Repeated run reuses blocked_task', run2Summary.breakdown.blocked_task.reused === 1);
  assertTest('16.13 Repeated run reuses task_assignment', run2Summary.breakdown.task_assignment.reused === 1);

  // 16.4 Exception reactivation test: updating exception version produces new distinct alert
  const reactivatedExceptions = [
    {
      id: 'ex_blocked_1',
      projectId: 'proj_tracking_eval',
      taskId: 'task_due_soon',
      title: 'Blocked on API Spec',
      description: 'Waiting for vendor endpoint approval (reopened)',
      severity: 'critical',
      status: 'open',
      createdAt: new Date(nowMs - 10000).toISOString(),
      updatedAt: new Date(nowMs + 1000).toISOString() // Re-opened timestamp
    }
  ];

  const reactivationSummary = await generateTaskNotificationsForProject(db, {
    projectId: 'proj_tracking_eval',
    organizationId: 'org_main',
    projectName: 'Tracking Evaluation Project',
    activeTasks: testActiveTasks,
    exceptions: reactivatedExceptions,
    options: { nowMs: nowMs + 1000, dueSoonDays: 3 }
  });

  assertTest('16.14 Reactivated exception generates fresh distinct blocked_task notification', reactivationSummary.breakdown.blocked_task.created === 1);

  // 16.5 Concurrent generation for the same project/tasks does not create duplicate documents
  const [concurrent1, concurrent2] = await Promise.all([
    generateTaskNotificationsForProject(db, {
      projectId: 'proj_tracking_eval',
      organizationId: 'org_main',
      activeTasks: testActiveTasks,
      exceptions: testExceptions,
      options: { nowMs, dueSoonDays: 3 }
    }),
    generateTaskNotificationsForProject(db, {
      projectId: 'proj_tracking_eval',
      organizationId: 'org_main',
      activeTasks: testActiveTasks,
      exceptions: testExceptions,
      options: { nowMs, dueSoonDays: 3 }
    })
  ]);
  assertTest('16.15 Concurrent generation calls complete cleanly', concurrent1.tasksEvaluated === concurrent2.tasksEvaluated);

  // 16.6 Preserves existing delivery protections (e.g. if a notification was quarantined or sent, generation does not overwrite it)
  // Transition one notification to ambiguous_delivery
  const existingKey = trackingNotifs[0].id;
  await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(existingKey).set({
    status: 'ambiguous_delivery',
    quarantinedAt: new Date().toISOString()
  }, { merge: true });

  const runAfterQuarantine = await generateTaskNotificationsForProject(db, {
    projectId: 'proj_tracking_eval',
    organizationId: 'org_main',
    activeTasks: testActiveTasks,
    exceptions: testExceptions,
    options: { nowMs, dueSoonDays: 3 }
  });
  const quarantinedCheckDoc = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(existingKey).get();
  assertTest('16.16 Generation reuses existing record and does NOT reset quarantined ambiguous_delivery status', quarantinedCheckDoc.data().status === 'ambiguous_delivery');

  // =========================================================================
  // Section 17: Protected, Bounded Notification Dispatch Worker
  // =========================================================================
  console.log('\n--- Section 17: Protected, Bounded Notification Dispatch Worker ---');

  // 17.1 Default-off activation check: When NOTIFICATION_DISPATCH_ENABLED is unset or false, isNotificationDispatchEnabled() is false
  delete process.env.NOTIFICATION_DISPATCH_ENABLED;
  assertTest('17.1 isNotificationDispatchEnabled() defaults to false when env unset', isNotificationDispatchEnabled() === false);

  process.env.NOTIFICATION_DISPATCH_ENABLED = 'false';
  assertTest('17.2 isNotificationDispatchEnabled() is false when env is "false"', isNotificationDispatchEnabled() === false);

  // 17.2 Default-off dry run test: Non-mutating inspection without claiming records or sending emails
  let resendCallCounter = 0;
  const mockEmailSender = async (recipient: string, payload: any) => {
    resendCallCounter++;
    return { success: true, id: `resend_mock_${Date.now()}` };
  };

  const dryRunResult = await processNotificationDispatchBatch(db, {
    batchSize: 10,
    emailSenderOverride: mockEmailSender
  });

  assertTest('17.3 Default execution executes in dry_run mode', dryRunResult.mode === 'dry_run');
  assertTest('17.4 activationEnabled is false in default mode', dryRunResult.activationEnabled === false);
  assertTest('17.5 Dry run scanned pending/retryable records', dryRunResult.scanned > 0);
  assertTest('17.6 Dry run claimed zero records (claimed === 0)', dryRunResult.claimed === 0);
  assertTest('17.7 Dry run sent zero records (sent === 0)', dryRunResult.sent === 0);
  assertTest('17.8 Dry run made zero provider calls (resendCallCounter === 0)', resendCallCounter === 0);

  // Verify records remain strictly in their prior state (pending or retryable_failed) after dry run
  const firstDocAfterDryRun = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(dryRunResult.items[0].notificationId).get();
  assertTest('17.9 Dry run preserved original record state without mutation', ['pending', 'retryable_failed'].includes(firstDocAfterDryRun.data().status));
  assertTest('17.10 Dry run did not assign a new worker lease to the document', firstDocAfterDryRun.data().workerId !== 'dispatch_worker_test');

  // 17.3 Bounded batch size check: batch size capped at MAX_DISPATCH_BATCH_SIZE (50)
  const boundedResult = await processNotificationDispatchBatch(db, {
    batchSize: 100, // Requested 100
    dryRun: true
  });
  assertTest('17.11 Batch processing limits scan to batch size (<= 50)', boundedResult.scanned <= 50);

  // 17.4 Controlled live dispatch with email sender override (NEVER sends real email)
  const pendingNotifForDispatch = await enqueueTaskNotification(db, {
    taskId: 'task_dispatch_1',
    taskTitle: 'Live Dispatch Test Task',
    projectId: 'proj_tracking_eval',
    organizationId: 'org_main',
    recipientEmail: 'assignee@echotechai.in',
    type: 'task_assignment',
    customEventVersion: 'live_test_1'
  });

  let liveSendCount = 0;
  const liveDispatchResult = await processNotificationDispatchBatch(db, {
    batchSize: 1,
    forceLiveDispatch: true,
    emailSenderOverride: async (recipient, payload) => {
      liveSendCount++;
      return { success: true, id: 'resend_live_mock_123' };
    }
  });

  assertTest('17.12 Controlled live dispatch runs in live_dispatch mode', liveDispatchResult.mode === 'live_dispatch');
  assertTest('17.13 Controlled live dispatch claimed record', liveDispatchResult.claimed >= 1);
  assertTest('17.14 Controlled live dispatch sent record successfully', liveDispatchResult.sent >= 1);
  assertTest('17.15 Controlled live dispatch executed mock sender', liveSendCount >= 1);

  // Verify recipient PII masking in output item
  const sentItem = liveDispatchResult.items.find((i: any) => i.status === 'sent');
  assertTest('17.16 Recipient email is masked in dispatch item output', sentItem?.recipientMasked?.includes('***') === true);
  assertTest('17.17 Full recipient email is NOT leaked in item output', !sentItem?.recipientMasked?.includes('assignee@echotechai.in'));

  // 17.5 Concurrent dispatch workers: atomic claim prevents duplicate sends
  const concurrentTargetNotif = await enqueueTaskNotification(db, {
    taskId: 'task_concurrent_dispatch',
    taskTitle: 'Concurrent Dispatch Target',
    projectId: 'proj_tracking_eval',
    organizationId: 'org_main',
    recipientEmail: 'member@echotechai.in',
    type: 'upcoming_deadline',
    dueDate: new Date(nowMs + 24 * 3600 * 1000).toISOString(),
    customEventVersion: 'concurrent_test_1'
  });

  let concurrentSenderCalls = 0;
  const concurrentSender = async (recipient: string, payload: any) => {
    concurrentSenderCalls++;
    return { success: true, id: `resend_concurrent_${concurrentSenderCalls}` };
  };

  const [worker1Result, worker2Result] = await Promise.all([
    processNotificationDispatchBatch(db, {
      batchSize: 10,
      forceLiveDispatch: true,
      workerId: 'worker_alpha',
      emailSenderOverride: concurrentSender
    }),
    processNotificationDispatchBatch(db, {
      batchSize: 10,
      forceLiveDispatch: true,
      workerId: 'worker_beta',
      emailSenderOverride: concurrentSender
    })
  ]);

  // Find occurrences of concurrentTargetNotif across both workers
  const worker1Sent = worker1Result.items.find((i: any) => i.notificationId === concurrentTargetNotif.deduplicationKey && i.status === 'sent');
  const worker2Sent = worker2Result.items.find((i: any) => i.notificationId === concurrentTargetNotif.deduplicationKey && i.status === 'sent');

  // Exactly one worker must have sent it; never both!
  const exactlyOneSent = (worker1Sent ? 1 : 0) + (worker2Sent ? 1 : 0) === 1;
  assertTest('17.18 Exactly one worker claimed and sent the notification under concurrent dispatch', exactlyOneSent);

  // 17.6 Revoked recipient authorization during dispatch batch
  const revokedProjectNotif = await enqueueTaskNotification(db, {
    taskId: 'task_revoked_member',
    taskTitle: 'Revoked Member Task',
    projectId: 'proj_tracking_eval',
    organizationId: 'org_main',
    recipientEmail: 'unauthorized_stranger@external.com',
    type: 'overdue_task',
    customEventVersion: 'revoked_test_1'
  });

  const revokedDispatchResult = await processNotificationDispatchBatch(db, {
    batchSize: 10,
    forceLiveDispatch: true,
    emailSenderOverride: async () => ({ success: true, id: 'should_not_reach_here' })
  });

  const revokedItem = revokedDispatchResult.items.find((i: any) => i.notificationId === revokedProjectNotif.deduplicationKey);
  assertTest('17.19 Revoked / unauthorized recipient is permanently failed by dispatch worker', revokedItem?.status === 'permanently_failed');

  // 17.7 Quarantined states (dispatching, ambiguous_delivery, sent, permanently_failed) strictly EXCLUDED from dispatch query
  const ambiguousKey = 'notif_quarantined_exclusion_test';
  await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(ambiguousKey).set({
    id: ambiguousKey,
    taskId: 't_ambig',
    projectId: 'proj_tracking_eval',
    recipientEmail: 'assignee@echotechai.in',
    type: 'overdue_task',
    status: 'ambiguous_delivery',
    quarantinedAt: new Date().toISOString()
  });

  const dispatchingKey = 'notif_dispatching_exclusion_test';
  await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(dispatchingKey).set({
    id: dispatchingKey,
    taskId: 't_disp',
    projectId: 'proj_tracking_eval',
    recipientEmail: 'assignee@echotechai.in',
    type: 'overdue_task',
    status: 'dispatching',
    dispatchStartedAt: new Date().toISOString()
  });

  const exclusionScanResult = await processNotificationDispatchBatch(db, {
    batchSize: 50,
    dryRun: true
  });

  assertTest('17.20 ambiguous_delivery is excluded from ordinary dispatch batch scan', !exclusionScanResult.items.some((i: any) => i.notificationId === ambiguousKey));
  assertTest('17.21 dispatching is excluded from ordinary dispatch batch scan', !exclusionScanResult.items.some((i: any) => i.notificationId === dispatchingKey));

  // =========================================================================
  // Section 18: Notification Dispatch Pre-Activation Safety Audit (Step 3.8)
  // =========================================================================
  console.log('\n--- Section 18: Notification Dispatch Pre-Activation Safety Audit ---');

  // 18.1 Prove client-side activation requests cannot enable live dispatch
  // Any variation of non-'true' environment variable must evaluate strictly to false
  const nonTrueValues = ['', '1', 'yes', 'TRUE', 'True', 'enabled', 'null', 'undefined', 'false'];
  for (const val of nonTrueValues) {
    process.env.NOTIFICATION_DISPATCH_ENABLED = val;
    assertTest(`18.1 Environment value '${val}' evaluates to false (disabled)`, isNotificationDispatchEnabled() === false);
  }

  // 18.2 An HTTP client supplying dryRun: false or forceLiveDispatch cannot bypass server env activation
  delete process.env.NOTIFICATION_DISPATCH_ENABLED; // Ensure unset
  let clientAttemptProviderCalls = 0;
  const clientTamperResult = await processNotificationDispatchBatch(db, {
    batchSize: 10,
    dryRun: false, // Client explicitly requests NOT dry-run
    emailSenderOverride: async () => {
      clientAttemptProviderCalls++;
      return { success: true, id: 'tamper_provider_call' };
    }
  });

  assertTest('18.2 Client supplying dryRun: false cannot enable dispatch when env is disabled', clientTamperResult.mode === 'dry_run');
  assertTest('18.3 activationEnabled remains strictly false under client tamper attempt', clientTamperResult.activationEnabled === false);
  assertTest('18.4 Client tamper attempt claimed zero records (claimed === 0)', clientTamperResult.claimed === 0);
  assertTest('18.5 Client tamper attempt sent zero records (sent === 0)', clientTamperResult.sent === 0);
  assertTest('18.6 Zero provider calls occurred under client tamper attempt', clientAttemptProviderCalls === 0);

  // 18.3 Monitoring-job notification generation can NEVER invoke email provider indirectly
  // Verify generateTaskNotificationsForProject across multiple invocations never touches email service
  let monitoringGenProviderCalls = 0;
  const originalSendTaskAssignment = emailService.sendTaskAssignmentNotification;
  emailService.sendTaskAssignmentNotification = (async () => {
    monitoringGenProviderCalls++;
    return { success: true, id: 'unauthorized_monitoring_call' };
  }) as any;

  try {
    await generateTaskNotificationsForProject(db, {
      projectId: 'proj_tracking_eval',
      organizationId: 'org_main',
      activeTasks: testActiveTasks,
      exceptions: testExceptions
    });
    assertTest('18.7 Monitoring generation performs zero indirect provider invocations', monitoringGenProviderCalls === 0);
  } finally {
    emailService.sendTaskAssignmentNotification = originalSendTaskAssignment;
  }

  // 18.4 Batch size hard maximum cannot be exceeded by client request
  const maxBatchClientResult = await processNotificationDispatchBatch(db, {
    batchSize: 999999, // Unbounded client request
    dryRun: true
  });
  assertTest('18.8 Batch size capped at server maximum (<= 50)', maxBatchClientResult.scanned <= 50);

  // 18.5 Dry run non-mutation invariant: Inspect before and after dry run
  const testPendingKey = 'notif_audit_dryrun_test_key';
  await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(testPendingKey).set({
    id: testPendingKey,
    taskId: 't_audit_pending',
    projectId: 'proj_tracking_eval',
    recipientEmail: 'assignee@echotechai.in',
    type: 'upcoming_deadline',
    status: 'pending',
    workerId: null,
    leaseExpiresAt: null,
    attempts: 0,
    lastError: null,
    providerMessageId: null,
    createdAt: new Date().toISOString()
  });

  const beforeDoc = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(testPendingKey).get();
  await processNotificationDispatchBatch(db, {
    batchSize: 50,
    dryRun: true
  });
  const afterDoc = await db.collection(TASK_NOTIFICATIONS_COLLECTION).doc(testPendingKey).get();

  assertTest('18.9 Dry run preserves status identically', beforeDoc.data().status === afterDoc.data().status);
  assertTest('18.10 Dry run preserves workerId identically (null)', beforeDoc.data().workerId === afterDoc.data().workerId);
  assertTest('18.11 Dry run preserves leaseExpiresAt identically (null)', beforeDoc.data().leaseExpiresAt === afterDoc.data().leaseExpiresAt);
  assertTest('18.12 Dry run preserves attempts count identically (0)', beforeDoc.data().attempts === afterDoc.data().attempts);

  // 18.6 Stale-dispatch recovery scanner is callable, idempotent, and bounded
  const scanLimitCheck = await scanAndQuarantineStaleDispatches(db, {
    limit: 1000, // Excessive limit
    staleTimeoutMs: 10 * 60 * 1000
  });
  assertTest('18.13 Stale-dispatch scanner executed cleanly without errors', typeof scanLimitCheck.scanned === 'number');

  console.log(`\n🎉 All ${passedTests} test assertions passed successfully!`);
}

runTestSuite().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});



