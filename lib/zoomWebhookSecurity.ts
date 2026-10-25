/**
 * lib/zoomWebhookSecurity.ts
 *
 * EchoNote Phase 1B: Secure Zoom Webhook Ingestion & Processing Foundation
 *
 * Implements Zoom's official webhook verification scheme:
 * - URL Validation Challenge: HMAC-SHA256 of plainToken with ZOOM_WEBHOOK_SECRET, returns encryptedToken
 * - Event Signature Verification: HMAC-SHA256 of `v0:${x-zm-request-timestamp}:${rawBody}`
 * - Constant-time signature comparison using crypto.timingSafeEqual
 * - Request timestamp freshness window (default: 5 minutes / 300 seconds)
 * - Safe event extraction, idempotency, and MeetingSession & MeetingProvenanceManifest persistence
 */

import crypto from "crypto";
import { Firestore, FieldValue } from "firebase-admin/firestore";
import {
  MeetingSessionRecord,
  MeetingProvenanceManifest,
  MeetingParticipant,
  MeetingArtifactReference
} from "../types.ts";

/**
 * Zoom Webhook Headers interface
 */
export interface ZoomWebhookHeaders {
  "x-zm-signature"?: string;
  "x-zm-request-timestamp"?: string;
  [key: string]: string | undefined;
}

/**
 * Result of signature verification
 */
export interface ZoomVerificationResult {
  valid: boolean;
  reason?: string;
  isStale?: boolean;
}

/**
 * Computes the HMAC-SHA256 hash expected for Zoom endpoint URL validation challenge.
 * Zoom challenge flow:
 * Event: "endpoint.url_validation"
 * Payload: { plainToken: string }
 * Response: { plainToken: string, encryptedToken: HMAC-SHA256(plainToken, secret) }
 */
export function generateZoomValidationResponse(
  plainToken: string,
  secret: string
): { plainToken: string; encryptedToken: string } {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(plainToken)
    .digest("hex");

  return {
    plainToken,
    encryptedToken: hash
  };
}

/**
 * Verifies a Zoom Webhook event signature using constant-time comparison.
 * Zoom signature formula:
 * message = `v0:${timestamp}:${rawBodyString}`
 * hash = crypto.createHmac('sha256', secret).update(message).digest('hex')
 * signature = `v0=${hash}`
 *
 * @param headers Request headers including x-zm-signature and x-zm-request-timestamp
 * @param rawBody Buffer or string representing the exact raw request body
 * @param secret Zoom webhook secret token
 * @param toleranceSeconds Allowed clock drift in seconds (default: 300 = 5 minutes)
 */
export function verifyZoomWebhookSignature(
  headers: ZoomWebhookHeaders,
  rawBody: Buffer | string,
  secret: string,
  toleranceSeconds: number = 300
): ZoomVerificationResult {
  const signatureHeader = headers["x-zm-signature"];
  const timestampHeader = headers["x-zm-request-timestamp"];

  if (!secret || typeof secret !== "string" || !secret.trim()) {
    return { valid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" };
  }

  if (!signatureHeader || typeof signatureHeader !== "string") {
    return { valid: false, reason: "MISSING_SIGNATURE_HEADER" };
  }

  if (!timestampHeader || typeof timestampHeader !== "string") {
    return { valid: false, reason: "MISSING_TIMESTAMP_HEADER" };
  }

  // Verify timestamp freshness
  const requestTimestamp = parseInt(timestampHeader, 10);
  if (isNaN(requestTimestamp) || requestTimestamp <= 0) {
    return { valid: false, reason: "INVALID_TIMESTAMP_FORMAT" };
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTimestamp - requestTimestamp) > toleranceSeconds) {
    return { valid: false, reason: "TIMESTAMP_OUT_OF_TOLERANCE", isStale: true };
  }

  // Construct expected signature string
  const rawBodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const message = `v0:${timestampHeader}:${rawBodyStr}`;
  const computedHash = crypto
    .createHmac("sha256", secret.trim())
    .update(message)
    .digest("hex");
  const expectedSignature = `v0=${computedHash}`;

  // Constant-time signature comparison
  const sigBuf = Buffer.from(signatureHeader);
  const expectedBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expectedBuf.length) {
    return { valid: false, reason: "SIGNATURE_MISMATCH" };
  }

  const isValid = crypto.timingSafeEqual(sigBuf, expectedBuf);
  if (!isValid) {
    return { valid: false, reason: "SIGNATURE_MISMATCH" };
  }

  return { valid: true };
}

/**
 * Extracted meeting metadata from a completed Zoom meeting webhook event.
 */
export interface ExtractedZoomMeeting {
  eventId: string;
  event: string;
  eventTimestamp: string;
  provider: "zoom";
  externalMeetingId: string;
  meetingInstanceUuid?: string;
  meetingTopic: string;
  meetingStartTime?: string;
  durationMinutes?: number;
  hostId?: string;
  hostEmail?: string;
  recordingFiles?: Array<{
    id?: string;
    fileType?: string;
    fileExtension?: string;
    fileSize?: number;
    downloadUrl?: string;
    recordingType?: string;
    status?: string;
  }>;
  rawObject: Record<string, any>;
}

/**
 * Sanitizes a URL by removing sensitive query parameters (e.g. access_token, zak, signature, pwd).
 */
export function sanitizeArtifactUrl(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== "string") return undefined;
  try {
    const parsed = new URL(rawUrl);
    const sensitiveParams = ["zak", "access_token", "token", "signature", "auth", "pwd", "jwt"];
    for (const p of sensitiveParams) {
      parsed.searchParams.delete(p);
    }
    return parsed.toString();
  } catch {
    // If not a valid standard URL, return with query parameters stripped
    return rawUrl.split("?")[0];
  }
}

/**
 * Computes a deterministic, collision-safe session ID for a Zoom meeting instance.
 * Prioritizes meetingInstanceUuid when available to isolate recurring meeting instances,
 * falling back to externalMeetingId combined with instanceStartTime.
 */
export function computeZoomMeetingSessionId(externalMeetingId: string, instanceUuid?: string, startTime?: string): string {
  if (instanceUuid && instanceUuid.trim().length > 0) {
    const safeUuid = instanceUuid.trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
    return `zoom_sess_${safeUuid}`;
  }
  if (startTime && startTime.trim().length > 0) {
    const safeTime = startTime.trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
    return `zoom_sess_${externalMeetingId.replace(/[^a-zA-Z0-9_\-]/g, "_")}_${safeTime}`;
  }
  return `zoom_sess_${externalMeetingId.replace(/[^a-zA-Z0-9_\-]/g, "_")}`;
}

/**
 * Computes a deterministic, collision-safe manifest ID for a Zoom meeting instance.
 */
export function computeZoomProvenanceManifestId(externalMeetingId: string, instanceUuid?: string, startTime?: string): string {
  if (instanceUuid && instanceUuid.trim().length > 0) {
    const safeUuid = instanceUuid.trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
    return `zoom_prov_${safeUuid}`;
  }
  if (startTime && startTime.trim().length > 0) {
    const safeTime = startTime.trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
    return `zoom_prov_${externalMeetingId.replace(/[^a-zA-Z0-9_\-]/g, "_")}_${safeTime}`;
  }
  return `zoom_prov_${externalMeetingId.replace(/[^a-zA-Z0-9_\-]/g, "_")}`;
}

/**
 * Validates and extracts Zoom meeting event payload details.
 * Supports events:
 * - 'meeting.ended'
 * - 'recording.completed'
 */
export function extractZoomMeetingEvent(
  body: any,
  headers?: ZoomWebhookHeaders
): { success: true; data: ExtractedZoomMeeting } | { success: false; error: string; code: string } {
  if (!body || typeof body !== "object") {
    return { success: false, error: "Invalid payload: body is not an object", code: "MALFORMED_PAYLOAD" };
  }

  const event = body.event;
  if (!event || typeof event !== "string") {
    return { success: false, error: "Missing or invalid event name in payload", code: "MISSING_EVENT" };
  }

  const payloadObj = body.payload?.object;
  if (!payloadObj || typeof payloadObj !== "object") {
    return { success: false, error: "Missing payload.object in event payload", code: "MISSING_OBJECT" };
  }

  // Meeting ID extraction (numeric series/meeting ID)
  const externalMeetingId = String(payloadObj.id || payloadObj.uuid || "").trim();
  if (!externalMeetingId) {
    return { success: false, error: "Missing meeting ID or UUID in payload.object", code: "MISSING_MEETING_ID" };
  }

  // Instance UUID extraction: payload.object.uuid represents the unique meeting occurrence instance
  const meetingInstanceUuid = payloadObj.uuid ? String(payloadObj.uuid).trim() : undefined;

  // Unique event ID extraction
  // Zoom provides body.event_ts or headers['x-zm-request-timestamp']
  const eventTs = body.event_ts || headers?.["x-zm-request-timestamp"] || Date.now();
  const eventId = body.event_id || `zoom_evt_${meetingInstanceUuid || externalMeetingId}_${event}_${eventTs}`;

  const recordingFiles = Array.isArray(payloadObj.recording_files)
    ? payloadObj.recording_files.map((rf: any) => ({
        id: rf.id ? String(rf.id) : undefined,
        fileType: rf.file_type ? String(rf.file_type) : undefined,
        fileExtension: rf.file_extension ? String(rf.file_extension) : undefined,
        fileSize: typeof rf.file_size === "number" ? rf.file_size : undefined,
        downloadUrl: rf.download_url ? String(rf.download_url) : undefined,
        recordingType: rf.recording_type ? String(rf.recording_type) : undefined,
        status: rf.status ? String(rf.status) : undefined
      }))
    : [];

  return {
    success: true,
    data: {
      eventId,
      event,
      eventTimestamp: new Date(typeof eventTs === "number" ? (eventTs > 1e11 ? eventTs : eventTs * 1000) : Date.now()).toISOString(),
      provider: "zoom",
      externalMeetingId,
      meetingInstanceUuid,
      meetingTopic: payloadObj.topic ? String(payloadObj.topic) : "Zoom Meeting",
      meetingStartTime: payloadObj.start_time ? String(payloadObj.start_time) : undefined,
      durationMinutes: typeof payloadObj.duration === "number" ? payloadObj.duration : undefined,
      hostId: payloadObj.host_id ? String(payloadObj.host_id) : undefined,
      hostEmail: payloadObj.host_email ? String(payloadObj.host_email) : undefined,
      recordingFiles,
      rawObject: payloadObj
    }
  };
}

/**
 * Result of processing a Zoom webhook event.
 */
export interface ProcessZoomEventResult {
  status: "processed" | "already_processed" | "pending_association" | "ignored" | "error";
  eventId: string;
  sessionId?: string;
  manifestId?: string;
  projectId?: string;
  message?: string;
  errorCode?: string;
  isRetryable?: boolean;
}

/**
 * Default lease timeout for in-flight webhook event processing (90 seconds).
 */
export const WEBHOOK_PROCESSING_LEASE_MS = 90000;

/**
 * Securely processes a validated Zoom completed meeting event into Firestore.
 * 
 * Idempotency & Recoverability:
 * - Atomically checks and claims `webhook_events/{eventId}` via transaction.
 * - If status is 'completed', returns 'already_processed'.
 * - If status is 'processing' with an active lease (< 90s), rejects concurrent delivery with retryable failure.
 * - If status is 'failed' or 'processing' with an expired lease, re-claims the event for recovery.
 * - Never marks an event 'completed' before all session and manifest writes succeed.
 * 
 * Instance Collision Prevention:
 * - Uses `meetingInstanceUuid` (or meetingId + instanceStartTime) to uniquely identify meeting occurrences.
 * - Merges `meeting.ended` and `recording.completed` into the same occurrence record without overwriting.
 * 
 * Tenant & Organization Mapping:
 * - Never assigns an organization based solely on an arbitrary match when a user belongs to multiple orgs.
 * - Verifies verified user existence and authoritative single active organization membership.
 * - Flags multi-org hosts or unmapped hosts as `pending_association: true` in a safe pending state.
 * 
 * Recording Artifacts:
 * - Sanitizes download URLs to strip sensitive query tokens.
 * - Clearly marks artifacts as metadata references (type: 'recording'), noting download has not been performed.
 */
export async function processZoomWebhookEvent(
  db: Firestore,
  meetingData: ExtractedZoomMeeting
): Promise<ProcessZoomEventResult> {
  const {
    eventId,
    event,
    externalMeetingId,
    meetingInstanceUuid,
    hostEmail,
    hostId,
    meetingTopic,
    meetingStartTime,
    durationMinutes,
    recordingFiles
  } = meetingData;

  const SUPPORTED_EVENTS = new Set(["meeting.ended", "recording.completed"]);
  if (!SUPPORTED_EVENTS.has(event)) {
    return {
      status: "ignored",
      eventId,
      message: `Event ${event} is not a completion event requiring meeting ingestion.`
    };
  }

  const eventDocRef = db.collection("webhook_events").doc(eventId);
  const nowMs = Date.now();
  const leaseExpiresAt = nowMs + WEBHOOK_PROCESSING_LEASE_MS;

  // 1. Transaction-safe check, claim, or recover the webhook event
  type ClaimResult = 
    | { outcome: "claimed" }
    | { outcome: "already_completed" }
    | { outcome: "in_flight_concurrent" };

  const claimResult: ClaimResult = await db.runTransaction(async (transaction) => {
    const docSnap = await transaction.get(eventDocRef);
    if (docSnap.exists) {
      const data = docSnap.data() || {};
      if (data.status === "completed" || data.processed === true) {
        return { outcome: "already_completed" };
      }
      if (data.status === "processing") {
        const leaseUntil = typeof data.leaseExpiresAt === "number" ? data.leaseExpiresAt : 0;
        if (nowMs < leaseUntil) {
          // In-flight processing by another worker
          return { outcome: "in_flight_concurrent" };
        }
        // Stale lease: proceed to re-claim and recover
      }
    }

    // Claim or re-claim event
    transaction.set(
      eventDocRef,
      {
        eventId,
        provider: "zoom",
        event,
        externalMeetingId,
        meetingInstanceUuid: meetingInstanceUuid || null,
        hostEmail: hostEmail || null,
        status: "processing",
        leaseExpiresAt,
        attemptCount: FieldValue.increment(1),
        claimedAt: FieldValue.serverTimestamp(),
        lastError: null
      },
      { merge: true }
    );
    return { outcome: "claimed" };
  });

  if (claimResult.outcome === "already_completed") {
    return {
      status: "already_processed",
      eventId,
      message: `Event ${eventId} has already been completed.`
    };
  }

  if (claimResult.outcome === "in_flight_concurrent") {
    return {
      status: "error",
      eventId,
      errorCode: "CONCURRENT_PROCESSING",
      message: `Event ${eventId} is currently being processed by another worker lease. Retry later.`,
      isRetryable: true
    };
  }

  try {
    // 2. Authoritative and Unambiguous Organization & User Mapping
    let matchedUserId: string | null = null;
    let unambiguousOrgId: string | null = null;
    let unambiguousProjectId: string | null = null;

    if (hostEmail && typeof hostEmail === "string") {
      const normalizedEmail = hostEmail.toLowerCase().trim();
      const userQuery = await db.collection("users").where("email", "==", normalizedEmail).limit(2).get();
      
      // Require unambiguous single user match
      if (!userQuery.empty && userQuery.size === 1) {
        const uDoc = userQuery.docs[0];
        matchedUserId = uDoc.id;
        const uData = uDoc.data() || {};

        // Query active organization memberships in orgMembers
        const membershipsQuery = await db
          .collection("orgMembers")
          .where("email", "==", normalizedEmail)
          .where("status", "==", "active")
          .get();

        const activeOrgIds = new Set<string>();
        for (const mDoc of membershipsQuery.docs) {
          const mData = mDoc.data() || {};
          if (mData.orgId) activeOrgIds.add(mData.orgId);
        }

        // Also check direct organizationId on user record if not in orgMembers
        if (uData.organizationId && typeof uData.organizationId === "string") {
          activeOrgIds.add(uData.organizationId);
        }

        if (activeOrgIds.size === 1) {
          unambiguousOrgId = Array.from(activeOrgIds)[0];
        } else if (activeOrgIds.size > 1) {
          // Multi-org host: Ambiguous! Do NOT guess an arbitrary organization.
          unambiguousOrgId = null;
          console.warn(`⚠️ Host ${normalizedEmail} belongs to multiple organizations (${Array.from(activeOrgIds).join(", ")}). Preserving event in pending association state.`);
        } else {
          // No active organization memberships
          unambiguousOrgId = null;
        }
      } else if (userQuery.size > 1) {
        console.warn(`⚠️ Multiple users found with email ${normalizedEmail}. Preserving event in pending association state.`);
      }
    }

    const authoritativeUserId = matchedUserId || `zoom-unmapped-host:${hostId || "unknown"}`;

    // 3. Collision-Safe Session & Provenance Manifest IDs
    const sessionId = computeZoomMeetingSessionId(externalMeetingId, meetingInstanceUuid, meetingStartTime);
    const manifestId = computeZoomProvenanceManifestId(externalMeetingId, meetingInstanceUuid, meetingStartTime);

    const sessionDocRef = db.collection("meetingSessions").doc(sessionId);
    const manifestDocRef = db.collection("meetingProvenanceManifests").doc(manifestId);

    const nowIso = new Date().toISOString();

    // Prepare participants list
    const participants: MeetingParticipant[] = [];
    if (hostEmail || hostId) {
      participants.push({
        id: `part_host_${externalMeetingId}`,
        externalUserId: hostId,
        name: hostEmail ? hostEmail.split("@")[0] : "Zoom Host",
        email: hostEmail || undefined,
        role: "host",
        joinedAt: meetingStartTime
      });
    }

    // 4. Protect recording artifact references (sanitize tokens, mark as metadata discovery only)
    const rawArtifacts: MeetingArtifactReference[] = (recordingFiles || []).map((rf, idx) => {
      const sanitizedUrl = sanitizeArtifactUrl(rf.downloadUrl);
      return {
        artifactId: rf.id || `art_${externalMeetingId}_${idx}`,
        type: "recording",
        uri: sanitizedUrl || `zoom://recordings/${externalMeetingId}/${rf.id || idx}`,
        mimeType: rf.fileExtension ? `video/${rf.fileExtension.toLowerCase()}` : "video/mp4",
        sizeBytes: rf.fileSize,
        createdAt: nowIso
      };
    });

    // 5. Construct / Merge Session Record
    const sessionRecordUpdate: Partial<MeetingSessionRecord> & Record<string, any> = {
      id: sessionId,
      userId: authoritativeUserId,
      provider: "zoom",
      externalMeetingId,
      title: meetingTopic,
      actualStartTime: meetingStartTime,
      durationSeconds: durationMinutes ? durationMinutes * 60 : undefined,
      sourceReference: {
        provider: "zoom",
        externalMeetingId,
        seriesId: externalMeetingId,
        captureMode: "post_meeting_webhook",
        instanceStartTime: meetingStartTime
      },
      provenanceManifestId: manifestId,
      status: "ingested",
      updatedAt: nowIso
    };

    if (meetingInstanceUuid) {
      sessionRecordUpdate.meetingInstanceUuid = meetingInstanceUuid;
    }

    if (unambiguousOrgId) {
      sessionRecordUpdate.organizationId = unambiguousOrgId;
    }

    if (unambiguousProjectId) {
      sessionRecordUpdate.projectId = unambiguousProjectId;
    }

    // Construct Provenance Manifest
    const provenanceManifestUpdate: Partial<MeetingProvenanceManifest> & Record<string, any> = {
      manifestId,
      meetingSessionId: sessionId,
      provider: "zoom",
      externalMeetingId,
      sourceReference: {
        provider: "zoom",
        externalMeetingId,
        seriesId: externalMeetingId,
        captureMode: "post_meeting_webhook",
        instanceStartTime: meetingStartTime
      },
      captureMode: "post_meeting_webhook",
      capturedAt: meetingStartTime || nowIso,
      ingestedAt: nowIso,
      schemaVersion: "1.0",
      userId: authoritativeUserId,
      organizationId: unambiguousOrgId || null,
      projectId: unambiguousProjectId || null
    };

    if (meetingInstanceUuid) {
      provenanceManifestUpdate.meetingInstanceUuid = meetingInstanceUuid;
    }

    // 6. Atomically persist session, provenance manifest, and mark event completed
    await db.runTransaction(async (transaction) => {
      // Check for existing session to merge participants without overwrite
      const existingSessionSnap = await transaction.get(sessionDocRef);
      if (existingSessionSnap.exists) {
        const existingData = existingSessionSnap.data() || {};
        const mergedParticipants = [...(existingData.participants || [])];
        for (const p of participants) {
          if (!mergedParticipants.some((mp: any) => mp.email === p.email || (p.externalUserId && mp.externalUserId === p.externalUserId))) {
            mergedParticipants.push(p);
          }
        }
        transaction.set(sessionDocRef, {
          ...sessionRecordUpdate,
          participants: mergedParticipants,
          createdAt: existingData.createdAt || nowIso
        }, { merge: true });
      } else {
        transaction.set(sessionDocRef, {
          ...sessionRecordUpdate,
          participants,
          createdAt: nowIso
        }, { merge: true });
      }

      // Check for existing manifest to merge rawArtifacts without duplicate entries
      const existingManifestSnap = await transaction.get(manifestDocRef);
      if (existingManifestSnap.exists) {
        const existingMData = existingManifestSnap.data() || {};
        const existingArtifacts: MeetingArtifactReference[] = existingMData.rawArtifacts || [];
        const mergedArtifacts = [...existingArtifacts];
        for (const a of rawArtifacts) {
          if (!mergedArtifacts.some((ea) => ea.artifactId === a.artifactId)) {
            mergedArtifacts.push(a);
          }
        }
        transaction.set(manifestDocRef, {
          ...provenanceManifestUpdate,
          rawArtifacts: mergedArtifacts,
          participants: participants.length > 0 ? participants : (existingMData.participants || []),
          createdAt: existingMData.createdAt || FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        transaction.set(manifestDocRef, {
          ...provenanceManifestUpdate,
          rawArtifacts,
          participants,
          createdAt: FieldValue.serverTimestamp()
        }, { merge: true });
      }

      // Mark webhook event completed ONLY after all writes succeed
      transaction.update(eventDocRef, {
        status: "completed",
        processed: true,
        sessionId,
        manifestId,
        leaseExpiresAt: null,
        completedAt: FieldValue.serverTimestamp()
      });
    });

    const isPendingAssociation = !unambiguousOrgId || !unambiguousProjectId;

    return {
      status: isPendingAssociation ? "pending_association" : "processed",
      eventId,
      sessionId,
      manifestId,
      projectId: unambiguousProjectId || undefined,
      message: unambiguousOrgId
        ? `Zoom meeting instance ${meetingInstanceUuid || externalMeetingId} successfully ingested for organization ${unambiguousOrgId}.`
        : `Zoom meeting instance ${meetingInstanceUuid || externalMeetingId} successfully ingested. Awaiting unambiguous tenant association.`
    };
  } catch (err: any) {
    console.error(`❌ Error processing Zoom webhook event ${eventId}:`, err?.message || err);
    // Mark as failed and clear lease so it can be retried immediately or by subsequent delivery
    await eventDocRef.set({
      status: "failed",
      processed: false,
      leaseExpiresAt: 0,
      lastError: err?.message || "Internal processing error",
      failedAt: FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});

    return {
      status: "error",
      eventId,
      errorCode: "INGESTION_FAILED",
      message: "An internal error occurred while persisting meeting ingestion data.",
      isRetryable: true
    };
  }
}

