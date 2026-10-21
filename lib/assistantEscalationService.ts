/**
 * lib/assistantEscalationService.ts
 *
 * AH.145 — EchoNote Assistant Unanswered-Question & Failure Email Escalation Service
 * 
 * Provides safe, rate-limited, deduplicated email escalation for EchoNote Assistant
 * unresolved questions and repeated infrastructure failures.
 */

import crypto from "crypto";
import admin from "firebase-admin";
import { emailService, maskEmailForLogs } from "./emailService.js";

export interface AssistantEscalationTrigger {
  reason: 'repeated_failure' | 'explicit_negative_feedback' | 'unresolved_question';
  question: string;
  userId: string;
  userEmail?: string;
  userPlan?: string;
  conversationTurnCount?: number;
  errorCode?: string;
  errorMessage?: string;
  contextSummary?: {
    recordingId?: string;
    projectId?: string;
    page?: string;
  };
  feedbackComment?: string;
}

export interface EscalationDecision {
  eligible: boolean;
  sent: boolean;
  skippedReason?: 'CONFIG_MISSING' | 'CONFIG_INVALID' | 'DEDUPLICATED' | 'USER_RATE_LIMIT' | 'GLOBAL_RATE_LIMIT' | 'PERSISTENCE_FAILURE' | 'DELIVERY_FAILURE' | 'NOT_ELIGIBLE';
  error?: string;
  escalationId?: string;
}

/**
 * Validates escalation email address from environment configuration.
 * Must match valid standard RFC email format and exclude dangerous characters.
 */
export function validateEscalationRecipient(rawEmail?: string | null): string | null {
  if (!rawEmail || typeof rawEmail !== 'string') return null;
  const trimmed = rawEmail.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return null;
  // Standard robust email regex
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) return null;
  return trimmed;
}

/**
 * Reads ASSISTANT_ESCALATION_EMAIL strictly from server environment.
 */
export function getEscalationRecipient(): string | null {
  return validateEscalationRecipient(process.env.ASSISTANT_ESCALATION_EMAIL);
}

/**
 * Computes deterministic deduplication hash for an inquiry.
 * Deduplicates by: authenticated userId, normalized question text, calendar day (UTC).
 */
export function computeEscalationDedupKey(
  userId: string,
  question: string,
  date: Date = new Date(),
  reason?: string
): string {
  const dayStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const normalizedQuestion = (question || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
  const reasonPrefix = reason === 'explicit_negative_feedback' ? 'feedback:' : 'inquiry:';
  const input = `${userId}:${dayStr}:${reasonPrefix}${normalizedQuestion}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Sanitizes and truncates a question excerpt for inclusion in escalation email.
 * Limits length to 280 characters and escapes all HTML special characters.
 */
export function sanitizeQuestionExcerpt(question: string): string {
  if (!question || typeof question !== 'string') return 'N/A';
  const clean = question.trim().slice(0, 280);
  return clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitizes diagnostic text for email presentation.
 */
function sanitizeDiagnosticText(text?: string | null): string {
  if (!text || typeof text !== 'string') return 'N/A';
  return text
    .slice(0, 500)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats calendar hour string for rate limiting (UTC): YYYY-MM-DD-HH
 */
export function getHourBucket(date: Date = new Date()): string {
  const iso = date.toISOString(); // 2026-10-21T17:45:00.000Z
  return iso.slice(0, 13).replace('T', '-'); // 2026-10-21-17
}

/**
 * Persistent atomic deduplication and rate limit gate using Firestore transaction.
 * Deduplication: 1 email per user/question/day.
 * User Rate Limit: 1 email per user per hour.
 * Global Rate Limit: 5 emails globally per hour.
 *
 * If persistence or Firestore throws, fails closed (returns false) to prevent uncontrolled delivery.
 */
export async function checkAndRecordEscalation(
  db: admin.firestore.Firestore,
  options: {
    userId: string;
    question: string;
    now?: Date;
    triggerReason?: string;
  }
): Promise<{ allowed: boolean; reason?: 'DEDUPLICATED' | 'USER_RATE_LIMIT' | 'GLOBAL_RATE_LIMIT' | 'PERSISTENCE_FAILURE'; dedupKey?: string }> {
  const now = options.now || new Date();
  const dedupKey = computeEscalationDedupKey(options.userId, options.question, now, options.triggerReason);
  const hourBucket = getHourBucket(now);

  const dedupRef = db.collection('assistantEscalations').doc(dedupKey);
  const userRateRef = db.collection('assistantEscalationRateLimits').doc(`user_${options.userId}_${hourBucket}`);
  const globalRateRef = db.collection('assistantEscalationRateLimits').doc(`global_${hourBucket}`);

  try {
    const result = await db.runTransaction(async (t) => {
      // 1. Check deduplication
      const dedupDoc = await t.get(dedupRef);
      if (dedupDoc.exists) {
        return { allowed: false, reason: 'DEDUPLICATED' as const };
      }

      // 2. Check user rate limit: max 1 per hour
      const userRateDoc = await t.get(userRateRef);
      const userCount = userRateDoc.exists ? (userRateDoc.data()?.count || 0) : 0;
      if (userCount >= 1) {
        return { allowed: false, reason: 'USER_RATE_LIMIT' as const };
      }

      // 3. Check global rate limit: max 5 per hour
      const globalRateDoc = await t.get(globalRateRef);
      const globalCount = globalRateDoc.exists ? (globalRateDoc.data()?.count || 0) : 0;
      if (globalCount >= 5) {
        return { allowed: false, reason: 'GLOBAL_RATE_LIMIT' as const };
      }

      // Atomically update rate counters and create dedup placeholder
      t.set(dedupRef, {
        userId: options.userId,
        dedupKey,
        createdAt: now.toISOString(),
        hourBucket
      });

      t.set(userRateRef, {
        userId: options.userId,
        hourBucket,
        count: userCount + 1,
        updatedAt: now.toISOString()
      }, { merge: true });

      t.set(globalRateRef, {
        hourBucket,
        count: globalCount + 1,
        updatedAt: now.toISOString()
      }, { merge: true });

      return { allowed: true };
    });

    return { allowed: result.allowed, reason: result.reason, dedupKey };
  } catch (err: any) {
    console.error('⚠️ [Assistant Escalation] Failed checking persistent rate limits (failing closed):', err?.message || err);
    return { allowed: false, reason: 'PERSISTENCE_FAILURE', dedupKey };
  }
}

/**
 * Dispatches escalation email to configured ASSISTANT_ESCALATION_EMAIL.
 * Privacy-safe: never includes full transcripts, audio, API keys, or raw stack traces.
 */
export async function sendAssistantEscalationEmail(options: {
  recipient: string;
  trigger: AssistantEscalationTrigger;
  dedupKey: string;
  timestamp?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const ts = options.timestamp || new Date().toISOString();
  const maskedRecipient = maskEmailForLogs(options.recipient);
  const cleanExcerpt = sanitizeQuestionExcerpt(options.trigger.question);

  let reasonDisplay = 'Unresolved Inquiry';
  if (options.trigger.reason === 'repeated_failure') {
    reasonDisplay = 'Repeated Technical Failure';
  } else if (options.trigger.reason === 'explicit_negative_feedback') {
    reasonDisplay = 'User Negative Feedback';
  }

  const safeErrorCode = (options.trigger.errorCode || 'UNRESOLVED').replace(/[\r\n\t]/g, '').slice(0, 50);
  const subject = `[EchoNote Assistant Escalation] ${reasonDisplay} (${safeErrorCode})`;

  const bodyContentHtml = `
    <h2 style="color: #1A234E; font-size: 20px; font-weight: 800; margin-bottom: 12px;">EchoNote Assistant Escalation</h2>
    <p style="font-size: 14px; line-height: 1.6; color: #334155; margin-bottom: 20px;">
      An EchoNote Assistant interaction requires support investigation based on the configured escalation policy.
    </p>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; font-size: 13px;">
        <tr>
          <td style="color: #64748b; padding-bottom: 8px; width: 140px; font-weight: 600;">Escalation Reason:</td>
          <td style="color: #1e293b; font-weight: 700; padding-bottom: 8px;">${reasonDisplay}</td>
        </tr>
        <tr>
          <td style="color: #64748b; padding-bottom: 8px; font-weight: 600;">Status / Code:</td>
          <td style="color: #1e293b; font-weight: 700; padding-bottom: 8px;">${sanitizeDiagnosticText(options.trigger.errorCode || 'NONE')}</td>
        </tr>
        <tr>
          <td style="color: #64748b; padding-bottom: 8px; font-weight: 600;">Timestamp:</td>
          <td style="color: #1e293b; padding-bottom: 8px;">${ts}</td>
        </tr>
        <tr>
          <td style="color: #64748b; padding-bottom: 8px; font-weight: 600;">User Identifier:</td>
          <td style="color: #1e293b; padding-bottom: 8px;">${sanitizeDiagnosticText(options.trigger.userId)}</td>
        </tr>
        ${options.trigger.userPlan ? `
        <tr>
          <td style="color: #64748b; padding-bottom: 8px; font-weight: 600;">User Plan:</td>
          <td style="color: #1e293b; padding-bottom: 8px;">${sanitizeDiagnosticText(options.trigger.userPlan)}</td>
        </tr>` : ''}
        ${options.trigger.contextSummary?.page ? `
        <tr>
          <td style="color: #64748b; padding-bottom: 8px; font-weight: 600;">Workspace Page:</td>
          <td style="color: #1e293b; padding-bottom: 8px;">${sanitizeDiagnosticText(options.trigger.contextSummary.page)}</td>
        </tr>` : ''}
        ${options.trigger.contextSummary?.recordingId ? `
        <tr>
          <td style="color: #64748b; padding-bottom: 8px; font-weight: 600;">Recording Ref:</td>
          <td style="color: #1e293b; padding-bottom: 8px;">${sanitizeDiagnosticText(options.trigger.contextSummary.recordingId)}</td>
        </tr>` : ''}
      </table>
    </div>

    <div style="background-color: #ffffff; border-left: 4px solid #3B82F6; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
      <p style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; margin: 0 0 6px 0;">Question Excerpt</p>
      <p style="font-size: 14px; color: #0f172a; margin: 0; line-height: 1.5; font-style: italic;">
        "${cleanExcerpt}"
      </p>
    </div>

    ${options.trigger.feedbackComment ? `
    <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
      <p style="font-size: 12px; font-weight: 700; color: #991b1b; text-transform: uppercase; margin: 0 0 6px 0;">User Feedback Note</p>
      <p style="font-size: 13px; color: #7f1d1d; margin: 0; line-height: 1.5;">
        ${sanitizeDiagnosticText(options.trigger.feedbackComment)}
      </p>
    </div>` : ''}

    ${options.trigger.errorMessage ? `
    <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
      <p style="font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; margin: 0 0 6px 0;">Diagnostic Summary</p>
      <p style="font-size: 13px; color: #334155; margin: 0; line-height: 1.5; font-family: monospace;">
        ${sanitizeDiagnosticText(options.trigger.errorMessage)}
      </p>
    </div>` : ''}

    <p style="font-size: 11px; color: #94a3b8; line-height: 1.5; margin-top: 25px; border-top: 1px solid #f1f5f9; padding-top: 15px;">
      Privacy Notice: Transcripts, audio files, and credentials are strictly excluded from escalation payloads. Tracking Hash: ${options.dedupKey.slice(0, 16)}...
    </p>
  `;

  // Use emailService's established delivery infrastructure
  const sendRes = await emailService.sendAssistantEscalation({
    to: options.recipient,
    subject,
    html: bodyContentHtml,
    text: `EchoNote Assistant Escalation: ${reasonDisplay}\nCode: ${options.trigger.errorCode || 'NONE'}\nTimestamp: ${ts}\nUser: ${options.trigger.userId}\nQuestion: "${cleanExcerpt}"\nDiagnostic: ${options.trigger.errorMessage || 'N/A'}`
  });

  return {
    success: sendRes.success,
    id: sendRes.id,
    error: sendRes.error
  };
}

/**
 * Top-level escalation orchestration helper.
 * Completely non-blocking and isolated: failures never alter or crash the assistant response.
 */
export async function triggerAssistantEscalationIfEligible(
  db: admin.firestore.Firestore,
  trigger: AssistantEscalationTrigger
): Promise<EscalationDecision> {
  // 1. Verify recipient configuration
  const recipient = getEscalationRecipient();
  if (!recipient) {
    const raw = process.env.ASSISTANT_ESCALATION_EMAIL;
    if (raw && raw.trim() !== '') {
      console.warn('⚠️ [Assistant Escalation] ASSISTANT_ESCALATION_EMAIL is configured with an invalid email format. Escalation disabled safely.');
      return { eligible: false, sent: false, skippedReason: 'CONFIG_INVALID' };
    }
    return { eligible: false, sent: false, skippedReason: 'CONFIG_MISSING' };
  }

  // 2. Eligibility checks
  // Do NOT escalate on plain INSUFFICIENT_CONTEXT, ordinary clarification, or normal questions
  if (trigger.reason !== 'repeated_failure' && trigger.reason !== 'explicit_negative_feedback' && trigger.reason !== 'unresolved_question') {
    return { eligible: false, sent: false, skippedReason: 'NOT_ELIGIBLE' };
  }

  // 3. Persistent rate limit and deduplication gate
  const gate = await checkAndRecordEscalation(db, {
    userId: trigger.userId,
    question: trigger.question,
    triggerReason: trigger.reason
  });

  if (!gate.allowed) {
    console.info(`ℹ️ [Assistant Escalation] Escalation skipped (${gate.reason}) for user ${trigger.userId}`);
    return { eligible: true, sent: false, skippedReason: gate.reason };
  }

  // 4. Safe email delivery via verified provider
  try {
    const delivery = await sendAssistantEscalationEmail({
      recipient,
      trigger,
      dedupKey: gate.dedupKey!
    });

    if (delivery.success) {
      console.info(`✅ [Assistant Escalation] Escalation email delivered to ${maskEmailForLogs(recipient)} (ID: ${delivery.id})`);
      return { eligible: true, sent: true, escalationId: delivery.id };
    } else {
      console.warn(`⚠️ [Assistant Escalation] Email provider failed delivering escalation: ${delivery.error}`);
      return { eligible: true, sent: false, skippedReason: 'DELIVERY_FAILURE', error: delivery.error };
    }
  } catch (deliveryErr: any) {
    console.error('⚠️ [Assistant Escalation] Unexpected exception during escalation dispatch:', deliveryErr?.message || deliveryErr);
    return { eligible: true, sent: false, skippedReason: 'DELIVERY_FAILURE', error: deliveryErr?.message || String(deliveryErr) };
  }
}