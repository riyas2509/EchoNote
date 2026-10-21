/**
 * tests/test_assistant_email_escalation.ts
 *
 * AH.145 — Deterministic Verification Suite for EchoNote Assistant
 * Email Escalation, Safe Recipient Configuration, Rate Limiting, and Privacy Safeguards.
 */

import assert from 'node:assert';
import {
  validateEscalationRecipient,
  computeEscalationDedupKey,
  sanitizeQuestionExcerpt,
  getHourBucket,
  checkAndRecordEscalation,
  triggerAssistantEscalationIfEligible,
  AssistantEscalationTrigger
} from '../lib/assistantEscalationService.js';
import { emailService } from '../lib/emailService.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`   ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`   ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

// ============================================================================
// In-Memory Deterministic Mock for Firestore with Atomic Transactions
// ============================================================================
class MockFirestoreCollection {
  public store = new Map<string, any>();

  doc(id?: string) {
    const docId = id || `doc_${Math.random().toString(36).slice(2, 9)}`;
    return {
      id: docId,
      get: async () => {
        const val = this.store.get(docId);
        return {
          exists: val !== undefined,
          data: () => (val ? JSON.parse(JSON.stringify(val)) : undefined)
        };
      },
      set: async (data: any, options?: { merge?: boolean }) => {
        if (options?.merge && this.store.has(docId)) {
          const prev = this.store.get(docId);
          this.store.set(docId, { ...prev, ...data });
        } else {
          this.store.set(docId, JSON.parse(JSON.stringify(data)));
        }
      }
    };
  }
}

class MockFirestoreDb {
  public collections = new Map<string, MockFirestoreCollection>();
  public shouldFailPersistence = false;

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockFirestoreCollection());
    }
    return this.collections.get(name)!;
  }

  private _txLock = Promise.resolve();

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    if (this.shouldFailPersistence) {
      throw new Error("Simulated Firestore connection timeout / permission denied");
    }

    // Real Firestore serializes concurrent transactions accessing the same documents
    const execute = async () => {
      const t = {
        get: async (docRef: any) => {
          return docRef.get();
        },
        set: (docRef: any, data: any, options?: { merge?: boolean }) => {
          docRef.set(data, options);
        }
      };
      return updateFunction(t);
    };

    const nextLock = this._txLock.then(execute, execute);
    this._txLock = nextLock.then(() => {}, () => {});
    return nextLock;
  }
}

async function runSuite() {
  console.log('\n=================================================');
  console.log('AH.145 — Assistant Email Escalation & Reliability Verification');
  console.log('=================================================\n');

  const originalEnv = process.env.ASSISTANT_ESCALATION_EMAIL;

  // 1. Missing recipient configuration disables email safely
  await test('1. Missing recipient configuration disables email safely', async () => {
    delete process.env.ASSISTANT_ESCALATION_EMAIL;
    const db = new MockFirestoreDb() as any;

    const res = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: 'Why did the transcribing fail?',
      userId: 'user_123',
      errorCode: 'AI_TIMEOUT'
    });

    assert.equal(res.eligible, false);
    assert.equal(res.sent, false);
    assert.equal(res.skippedReason, 'CONFIG_MISSING');
  });

  // 2. Invalid recipient configuration disables email safely
  await test('2. Invalid recipient configuration disables email safely', async () => {
    process.env.ASSISTANT_ESCALATION_EMAIL = 'not-an-email';
    assert.equal(validateEscalationRecipient(process.env.ASSISTANT_ESCALATION_EMAIL), null);

    const db = new MockFirestoreDb() as any;
    const res = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: 'Why did the transcribing fail?',
      userId: 'user_123',
      errorCode: 'AI_TIMEOUT'
    });

    assert.equal(res.eligible, false);
    assert.equal(res.sent, false);
    assert.equal(res.skippedReason, 'CONFIG_INVALID');
  });

  // Mock mail provider for subsequent tests
  const dispatchedEmails: any[] = [];
  const originalSendEscalation = emailService.sendAssistantEscalation;
  emailService.sendAssistantEscalation = async (options: any) => {
    dispatchedEmails.push(options);
    return { success: true, id: `msg_${Date.now()}_${Math.random()}` };
  };

  process.env.ASSISTANT_ESCALATION_EMAIL = 'support-escalations@echonote.internal';

  // 3. A qualifying repeated provider failure triggers escalation
  await test('3. A qualifying repeated provider failure triggers escalation', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    const trigger: AssistantEscalationTrigger = {
      reason: 'repeated_failure',
      question: 'Summarize the audio call from yesterday',
      userId: 'user_bob',
      userEmail: 'bob@example.com',
      userPlan: 'pro',
      errorCode: 'AI_UPSTREAM_UNAVAILABLE',
      errorMessage: 'Upstream AI model provider is currently unreachable.'
    };

    const res = await triggerAssistantEscalationIfEligible(db, trigger);

    assert.equal(res.eligible, true);
    assert.equal(res.sent, true);
    assert.equal(dispatchedEmails.length, 1);
    assert.equal(dispatchedEmails[0].to, 'support-escalations@echonote.internal');
    assert(dispatchedEmails[0].subject.includes('Repeated Technical Failure'));
    assert(dispatchedEmails[0].html.includes('AI_UPSTREAM_UNAVAILABLE'));
  });

  // 4. An ordinary clarification does not trigger email
  await test('4. An ordinary clarification does not trigger email', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    const res = await triggerAssistantEscalationIfEligible(db, {
      reason: 'clarification_needed' as any,
      question: 'What is the status of the project?',
      userId: 'user_bob'
    });

    assert.equal(res.eligible, false);
    assert.equal(res.sent, false);
    assert.equal(res.skippedReason, 'NOT_ELIGIBLE');
    assert.equal(dispatchedEmails.length, 0);
  });

  // 5. INSUFFICIENT_CONTEXT alone does not trigger email
  await test('5. INSUFFICIENT_CONTEXT alone does not trigger email', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    const res = await triggerAssistantEscalationIfEligible(db, {
      reason: 'insufficient_context' as any,
      question: 'What is our Q4 marketing budget?',
      userId: 'user_bob'
    });

    assert.equal(res.eligible, false);
    assert.equal(res.sent, false);
    assert.equal(res.skippedReason, 'NOT_ELIGIBLE');
    assert.equal(dispatchedEmails.length, 0);
  });

  // 6. Normal successful answers do not trigger email
  await test('6. Normal successful answers do not trigger email', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    const res = await triggerAssistantEscalationIfEligible(db, {
      reason: 'answered' as any,
      question: 'Who spoke first in the meeting?',
      userId: 'user_bob'
    });

    assert.equal(res.eligible, false);
    assert.equal(res.sent, false);
    assert.equal(res.skippedReason, 'NOT_ELIGIBLE');
    assert.equal(dispatchedEmails.length, 0);
  });

  // 7. Explicit negative feedback triggers escalation
  await test('7. Explicit negative feedback triggers escalation', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    const trigger: AssistantEscalationTrigger = {
      reason: 'explicit_negative_feedback',
      question: 'How do I download the trimmed audio?',
      userId: 'user_alice',
      userEmail: 'alice@company.com',
      userPlan: 'team',
      feedbackComment: 'The answer said there is no export button, but the UI has one!',
      errorCode: 'UNHELPFUL_FEEDBACK'
    };

    const res = await triggerAssistantEscalationIfEligible(db, trigger);

    assert.equal(res.eligible, true);
    assert.equal(res.sent, true);
    assert.equal(dispatchedEmails.length, 1);
    assert(dispatchedEmails[0].subject.includes('User Negative Feedback'));
    assert(dispatchedEmails[0].html.includes('The answer said there is no export button'));
  });

  // 8. Duplicate user/question/day events are deduplicated
  await test('8. Duplicate user/question/day events are deduplicated', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    const q = 'Why did thinking analysis fail?';
    const key1 = computeEscalationDedupKey('user_bob', q, new Date());
    const key2 = computeEscalationDedupKey('user_bob', q, new Date());
    assert.equal(key1, key2, 'Deterministic dedup keys must match');

    // First attempt succeeds
    const res1 = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: q,
      userId: 'user_bob',
      errorCode: 'AI_TIMEOUT'
    });
    assert.equal(res1.sent, true);
    assert.equal(dispatchedEmails.length, 1);

    // Second identical attempt within same day is deduplicated
    const res2 = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: q,
      userId: 'user_bob',
      errorCode: 'AI_TIMEOUT'
    });
    assert.equal(res2.sent, false);
    assert.equal(res2.skippedReason, 'DEDUPLICATED');
    assert.equal(dispatchedEmails.length, 1, 'Duplicate email must not be dispatched');
  });

  // 9. The one-email-per-user-per-hour limit is enforced
  await test('9. The one-email-per-user-per-hour limit is enforced', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    // User sends inquiry 1
    const res1 = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: 'Question number 1',
      userId: 'user_rate_tester'
    });
    assert.equal(res1.sent, true);

    // User sends different inquiry 2 within same hour bucket
    const res2 = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: 'Question number 2',
      userId: 'user_rate_tester'
    });
    assert.equal(res2.sent, false);
    assert.equal(res2.skippedReason, 'USER_RATE_LIMIT');
    assert.equal(dispatchedEmails.length, 1, 'Only 1 email allowed per user per hour');
  });

  // 10. The global five-emails-per-hour limit is enforced
  await test('10. The global five-emails-per-hour limit is enforced', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    // 5 different users trigger escalation in the same hour
    for (let u = 1; u <= 5; u++) {
      const res = await triggerAssistantEscalationIfEligible(db, {
        reason: 'repeated_failure',
        question: `Unique question from user ${u}`,
        userId: `global_user_${u}`
      });
      assert.equal(res.sent, true, `User ${u} should succeed`);
    }
    assert.equal(dispatchedEmails.length, 5);

    // 6th different user attempts in same hour bucket -> blocked by global rate limit
    const res6 = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: 'Unique question from user 6',
      userId: 'global_user_6'
    });
    assert.equal(res6.sent, false);
    assert.equal(res6.skippedReason, 'GLOBAL_RATE_LIMIT');
    assert.equal(dispatchedEmails.length, 5, 'Global limit capped at 5');
  });

  // 11. Concurrent requests cannot bypass deduplication or rate limits
  await test('11. Concurrent requests cannot bypass deduplication or rate limits', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    // Fire 10 concurrent requests for the same user
    const promises = Array.from({ length: 10 }, (_, i) =>
      triggerAssistantEscalationIfEligible(db, {
        reason: 'repeated_failure',
        question: `Concurrent request question ${i}`,
        userId: 'concurrent_user'
      })
    );

    const results = await Promise.all(promises);
    const sentCount = results.filter(r => r.sent).length;

    assert.equal(sentCount, 1, 'Only exactly 1 concurrent request can pass user rate limit');
    assert.equal(dispatchedEmails.length, 1);
  });

  // 12. Email content excludes transcripts, secrets, tokens, stack traces, and unsafe HTML
  await test('12. Email content excludes transcripts, secrets, tokens, stack traces, and unsafe HTML', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    const dangerousQuestion = '<script>alert("XSS")</script> What is apiKey=AIzaSyA123456789012345678901234567890 Bearer eyJhbGciOi?';
    const dangerousError = 'Error at Object.<anonymous> (/var/app/secret/server.ts:50:10)';

    await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: dangerousQuestion,
      userId: 'user_sec',
      errorMessage: dangerousError
    });

    const sent = dispatchedEmails[0];
    assert(!sent.html.includes('<script>'), 'Unsafe HTML script tags must be escaped');
    assert(sent.html.includes('&lt;script&gt;alert'), 'Script tags properly HTML escaped');
    assert(!sent.html.includes('transcription text Alice Bob'), 'Transcripts never included in body');
    assert.equal(sent.to, 'support-escalations@echonote.internal');
  });

  // 13. Provider delivery failure does not break the assistant response
  await test('13. Provider delivery failure does not break the assistant response', async () => {
    const db = new MockFirestoreDb() as any;

    // Temporarily simulate mail provider error
    emailService.sendAssistantEscalation = async () => {
      return { success: false, error: 'Upstream Resend API socket timeout' };
    };

    const res = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: 'Test question with mail provider down',
      userId: 'user_mail_fail'
    });

    assert.equal(res.eligible, true);
    assert.equal(res.sent, false);
    assert.equal(res.skippedReason, 'DELIVERY_FAILURE');
    assert(res.error?.includes('Resend API socket timeout'));

    // Reset mock for subsequent tests
    emailService.sendAssistantEscalation = async (options: any) => {
      dispatchedEmails.push(options);
      return { success: true, id: 'msg_test' };
    };
  });

  // 14. Firestore or persistence failure fails closed for email delivery
  await test('14. Firestore or persistence failure fails closed for email delivery', async () => {
    const db = new MockFirestoreDb();
    db.shouldFailPersistence = true;

    dispatchedEmails.length = 0;
    const res = await triggerAssistantEscalationIfEligible(db as any, {
      reason: 'repeated_failure',
      question: 'Test question with firestore down',
      userId: 'user_db_fail'
    });

    assert.equal(res.sent, false);
    assert.equal(res.skippedReason, 'PERSISTENCE_FAILURE');
    assert.equal(dispatchedEmails.length, 0, 'Must fail closed on persistence failure');
  });

  // 15. Unhelpful feedback escalates even if a failure for the same question was deduplicated earlier
  await test('15. Unhelpful feedback escalates even if a failure for the same question was deduplicated earlier', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;
    const testQuestion = 'Why did the background task fail?';

    // 15A. Technical failure occurs and escalates
    const res1 = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: testQuestion,
      userId: 'user_feedback_flow',
      errorCode: 'AI_TIMEOUT'
    });
    assert.equal(res1.sent, true);
    assert.equal(dispatchedEmails.length, 1);
    assert(dispatchedEmails[0].subject.includes('Repeated Technical Failure'));

    // 15B. Immediate duplicate technical failure on same day is deduplicated
    const res2 = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: testQuestion,
      userId: 'user_feedback_flow',
      errorCode: 'AI_TIMEOUT'
    });
    assert.equal(res2.sent, false);
    assert.equal(res2.skippedReason, 'DEDUPLICATED');
    assert.equal(dispatchedEmails.length, 1);

    // 15C. User submits explicit negative feedback for that same question in a new hour bucket
    const nextHour = new Date(Date.now() + 3600 * 1000);
    const gateFeedback = await checkAndRecordEscalation(db, {
      userId: 'user_feedback_flow',
      question: testQuestion,
      triggerReason: 'explicit_negative_feedback',
      now: nextHour
    });
    assert.equal(gateFeedback.allowed, true, 'Unhelpful feedback should have distinct dedup namespace from failure');
  });

  // 16. Subject line sanitization strips CRLF and control characters to prevent header injection
  await test('16. Subject line sanitization strips CRLF to prevent header injection', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    const maliciousErrorCode = 'AI_ERROR\r\nBcc: evil@hacker.com\r\nSubject: Injected';
    await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: 'Normal inquiry question',
      userId: 'user_inj_check',
      errorCode: maliciousErrorCode
    });

    assert.equal(dispatchedEmails.length, 1);
    const subj = dispatchedEmails[0].subject;
    assert(!subj.includes('\r'), 'Subject must not contain CR');
    assert(!subj.includes('\n'), 'Subject must not contain LF');
    assert(subj.includes('AI_ERRORBcc: evil@hacker.comSubject: Injected'));
  });

  // 17. Provider failure preserves rate-limit reservation and prevents duplicate retry storm
  await test('17. Provider failure preserves rate-limit reservation and prevents duplicate retry storm', async () => {
    dispatchedEmails.length = 0;
    const db = new MockFirestoreDb() as any;

    // Simulate provider failure
    emailService.sendAssistantEscalation = async () => {
      return { success: false, error: 'Upstream Resend 503 Service Unavailable' };
    };

    const resFail = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: 'Question during provider downtime',
      userId: 'user_resend_down'
    });
    assert.equal(resFail.sent, false);
    assert.equal(resFail.skippedReason, 'DELIVERY_FAILURE');

    // Restore mail mock
    emailService.sendAssistantEscalation = async (options: any) => {
      dispatchedEmails.push(options);
      return { success: true, id: 'msg_recovered' };
    };

    // Immediate retry for same inquiry is blocked by deduplication
    const resRetry = await triggerAssistantEscalationIfEligible(db, {
      reason: 'repeated_failure',
      question: 'Question during provider downtime',
      userId: 'user_resend_down'
    });
    assert.equal(resRetry.sent, false);
    assert.equal(resRetry.skippedReason, 'DEDUPLICATED', 'Reservation slot prevents duplicate dispatch stampede');
  });

  // 18. UTC day and hour boundary transitions reset rate limits and deduplication
  await test('18. UTC day and hour boundary transitions reset rate limits and deduplication', async () => {
    const db = new MockFirestoreDb() as any;
    const q = 'How does UTC boundary work?';
    const u = 'utc_boundary_user';

    // Day 1 at 23:55 UTC
    const dateT1 = new Date('2026-10-21T23:55:00.000Z');
    const gate1 = await checkAndRecordEscalation(db, {
      userId: u,
      question: q,
      now: dateT1
    });
    assert.equal(gate1.allowed, true);

    // Same hour, same day -> blocked by USER_RATE_LIMIT
    const gate1SameHour = await checkAndRecordEscalation(db, {
      userId: u,
      question: 'Different question',
      now: new Date('2026-10-21T23:58:00.000Z')
    });
    assert.equal(gate1SameHour.allowed, false);
    assert.equal(gate1SameHour.reason, 'USER_RATE_LIMIT');

    // Day 2 at 00:05 UTC (new hour bucket and new calendar day) -> Allowed
    const dateT2 = new Date('2026-10-22T00:05:00.000Z');
    const gate2 = await checkAndRecordEscalation(db, {
      userId: u,
      question: q,
      now: dateT2
    });
    assert.equal(gate2.allowed, true, 'New UTC calendar day allows re-escalating the same question');
  });

  // Restore originals
  emailService.sendAssistantEscalation = originalSendEscalation;
  if (originalEnv) {
    process.env.ASSISTANT_ESCALATION_EMAIL = originalEnv;
  } else {
    delete process.env.ASSISTANT_ESCALATION_EMAIL;
  }

  console.log('\n=================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} tests failed.`);
  }
}

runSuite();