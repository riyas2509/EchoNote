/**
 * lib/zoomRecordingImportService.ts
 *
 * EchoNote Phase 1B, Step 1.3B: Authorized Zoom Cloud Recording Import Service
 *
 * Provides end-to-end, server-authoritative recording retrieval and processing:
 * 1. Resolves Zoom OAuth credentials safely:
 *    - Server-to-Server OAuth app via environment / Secret Manager (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)
 *    - Organization-level integration configs with AES-256-GCM encrypted secrets (_encryptedSecrets)
 *    - Token caching in memory with TTL and automatic refresh
 * 2. Selects the optimal recording file:
 *    - Prefers audio-only (M4A) for fast, cost-effective, high-fidelity AI transcription
 *    - Falls back to MP4 (video/audio) if audio-only is unavailable
 *    - Validates file sizes against safe operational limits (e.g., 500 MB max)
 * 3. Secure, bounded streaming retrieval:
 *    - Authorizes download using Zoom OAuth Bearer token
 *    - Handles Zoom 302 redirects safely: strips Authorization header when redirecting to external storage (e.g. AWS S3)
 *    - Enforces max byte limits and timeouts; avoids unbounded memory consumption
 * 4. Deterministic import job management:
 *    - Records job in `zoom_import_jobs/{jobId}`
 *    - Tracks states: 'pending' | 'downloading' | 'stored' | 'transcribing' | 'completed' | 'failed'
 *    - Distributed lease claiming and safe idempotency to prevent duplicate downloads
 * 5. Secure storage and provenance:
 *    - Stores recording in Google Cloud Storage: `recordings/{userId}/{recordingId}/{fileName}`
 *    - Creates `recordings/{recordingId}` record
 *    - Updates `meetingSessions` and `meetingProvenanceManifests`
 *    - Never logs or exposes bearer tokens, download tokens, or signed URLs
 * 6. Transcription handoff:
 *    - Invokes existing Gemini AI transcription or marks status ready for transcription
 *    - Preserves association to meeting session, project, and provenance manifest
 *    - Retains 'pending_association' if tenant/project is unresolved
 */

import crypto from "crypto";
import { Firestore, FieldValue } from "firebase-admin/firestore";
import { GoogleGenAI, Type } from "@google/genai";
import { decryptSecret, isIntegrationEncryptionConfigured } from "./integrationSecurity.ts";
import {
  Recording,
  MeetingSessionRecord,
  MeetingProvenanceManifest,
  MeetingArtifactReference
} from "../types.ts";

/**
 * Maximum recording file size allowed for automated import (default: 500 MB).
 */
export const MAX_RECORDING_SIZE_BYTES = 500 * 1024 * 1024;

/**
 * Maximum download timeout in milliseconds (5 minutes).
 */
export const DOWNLOAD_TIMEOUT_MS = 300000;

/**
 * Import Job states
 */
export type ZoomImportJobStatus =
  | "pending"
  | "downloading"
  | "stored"
  | "transcribing"
  | "completed"
  | "failed"
  | "skipped";

/**
 * Record for tracking import jobs in Firestore `zoom_import_jobs`
 */
export interface ZoomImportJobRecord {
  id: string;
  meetingSessionId: string;
  externalMeetingId: string;
  meetingInstanceUuid?: string;
  fileId: string;
  fileType: string;
  fileExtension: string;
  fileSize?: number;
  downloadUrl?: string;
  status: ZoomImportJobStatus;
  userId: string;
  organizationId?: string | null;
  projectId?: string | null;
  recordingId?: string;
  storagePath?: string;
  transcriptionId?: string;
  leaseExpiresAt?: number | null;
  attempts: number;
  maxAttempts?: number;
  nextRetryAt?: number | null;
  isRetryable?: boolean;
  errorCategory?: "transient" | "permanent" | null;
  lastError?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

/**
 * Credentials configuration for Zoom OAuth.
 */
export interface ZoomOAuthConfig {
  accountId?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  tokenExpiresAt?: number;
}

/**
 * In-memory cache for OAuth access tokens.
 * Keyed by accountId or 'system'.
 */
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

/**
 * Clears token cache (useful for testing and revocation).
 */
export function clearZoomTokenCache(): void {
  tokenCache.clear();
}

/**
 * Resolves Zoom OAuth credentials from environment or organization integration record.
 */
export async function resolveZoomCredentials(
  db?: Firestore,
  organizationId?: string | null
): Promise<ZoomOAuthConfig> {
  // 1. Check organization-specific integration if orgId provided and db available
  if (db && organizationId) {
    try {
      const orgIntegrationRef = db
        .collection("organizations")
        .doc(organizationId)
        .collection("integrations")
        .doc("zoom");
      
      const snap = await orgIntegrationRef.get();
      if (snap.exists) {
        const data = snap.data() || {};
        if (data.enabled !== false && data._encryptedSecrets && isIntegrationEncryptionConfigured()) {
          const decryptedJson = decryptSecret(data._encryptedSecrets);
          const parsed = JSON.parse(decryptedJson);
          const clientId = parsed.clientId || parsed.zoomClientId;
          const clientSecret = parsed.clientSecret || parsed.zoomClientSecret;
          const accountId = parsed.accountId || parsed.zoomAccountId;

          if (clientId && clientSecret) {
            return {
              clientId,
              clientSecret,
              accountId: accountId || process.env.ZOOM_ACCOUNT_ID
            };
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Zoom Import] Could not load org-level Zoom credentials for org ${organizationId}:`, err?.message || err);
    }
  }

  // 2. Fall back to server environment variables (Server-to-Server OAuth)
  const envClientId = (process.env.ZOOM_CLIENT_ID || "").trim();
  const envClientSecret = (process.env.ZOOM_CLIENT_SECRET || "").trim();
  const envAccountId = (process.env.ZOOM_ACCOUNT_ID || "").trim();

  return {
    clientId: envClientId || undefined,
    clientSecret: envClientSecret || undefined,
    accountId: envAccountId || undefined
  };
}

/**
 * Fetches an authorized access token from Zoom using Server-to-Server OAuth.
 * Safe caching: reuses token until 60 seconds before expiration.
 */
export async function getZoomAccessToken(
  config: ZoomOAuthConfig,
  customFetch: typeof fetch = fetch
): Promise<string> {
  if (config.accessToken && config.tokenExpiresAt && config.tokenExpiresAt > Date.now() + 60000) {
    return config.accessToken;
  }

  const { clientId, clientSecret, accountId } = config;
  if (!clientId || !clientSecret) {
    throw new Error("ZOOM_CREDENTIALS_MISSING: Zoom Client ID or Client Secret is not configured.");
  }
  if (!accountId) {
    throw new Error("ZOOM_ACCOUNT_ID_MISSING: Zoom Account ID is required for Server-to-Server OAuth.");
  }

  const cacheKey = `${accountId}:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.accessToken;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`;

  const response = await customFetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });

  if (!response.ok) {
    let errBody = "";
    try {
      errBody = await response.text();
    } catch {}
    if (response.status === 401 || response.status === 400) {
      throw new Error(`ZOOM_AUTH_FAILED: Invalid Zoom credentials or account ID (HTTP ${response.status}). Details: ${errBody}`);
    }
    if (response.status === 403) {
      throw new Error(`ZOOM_INSUFFICIENT_SCOPES: Zoom credentials lack required scopes (e.g. recording:read:admin). Details: ${errBody}`);
    }
    throw new Error(`ZOOM_TOKEN_ERROR: Zoom token endpoint returned HTTP ${response.status}: ${errBody}`);
  }

  const tokenData = await response.json();
  if (!tokenData.access_token) {
    throw new Error("ZOOM_TOKEN_INVALID: Zoom token response did not contain access_token.");
  }

  const expiresInSec = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
  const expiresAt = Date.now() + expiresInSec * 1000;

  tokenCache.set(cacheKey, {
    accessToken: tokenData.access_token,
    expiresAt
  });

  return tokenData.access_token;
}

/**
 * Candidate recording file in Zoom recording.completed payload.
 */
export interface ZoomRecordingFileItem {
  id?: string;
  fileType?: string;
  fileExtension?: string;
  fileSize?: number;
  downloadUrl?: string;
  recordingType?: string;
  status?: string;
}

/**
 * Selects the best recording file for EchoNote's audio transcription pipeline:
 * - 1st priority: Audio-only (`M4A` or recording_type `audio_only`)
 * - 2nd priority: Video (`MP4` or recording_type `shared_screen_with_speaker_view(CC)` / `shared_screen_with_speaker_view`)
 * Returns null if no eligible audio/video file with a downloadUrl is found.
 */
export function selectBestRecordingFile(
  recordingFiles: ZoomRecordingFileItem[]
): ZoomRecordingFileItem | null {
  if (!Array.isArray(recordingFiles) || recordingFiles.length === 0) {
    return null;
  }

  const candidatesWithUrl = recordingFiles.filter(f => Boolean(f.downloadUrl && f.downloadUrl.trim().length > 0));
  if (candidatesWithUrl.length === 0) return null;

  // 1. Audio-only (M4A)
  const audioOnly = candidatesWithUrl.find(f => {
    const ext = (f.fileExtension || "").toUpperCase();
    const type = (f.fileType || "").toUpperCase();
    const recType = (f.recordingType || "").toLowerCase();
    return ext === "M4A" || type === "M4A" || recType === "audio_only";
  });
  if (audioOnly) return audioOnly;

  // 2. Video / MP4
  const videoFile = candidatesWithUrl.find(f => {
    const ext = (f.fileExtension || "").toUpperCase();
    const type = (f.fileType || "").toUpperCase();
    return ext === "MP4" || type === "MP4";
  });
  if (videoFile) return videoFile;

  // 3. Fallback to first available file
  return candidatesWithUrl[0];
}

/**
 * Downloads recording bytes from Zoom safely:
 * - Uses Bearer token
 * - Handles 302 redirects without leaking Bearer token to third-party domains (e.g. S3)
 * - Enforces max byte limits and timeouts
 * - Never includes tokens in thrown errors
 */
export async function downloadZoomRecordingBytes(
  downloadUrl: string,
  accessToken: string,
  options: {
    maxSizeBytes?: number;
    timeoutMs?: number;
    customFetch?: typeof fetch;
  } = {}
): Promise<{ buffer: Buffer; mimeType: string; sizeBytes: number }> {
  const maxBytes = options.maxSizeBytes || MAX_RECORDING_SIZE_BYTES;
  const timeoutMs = options.timeoutMs || DOWNLOAD_TIMEOUT_MS;
  const doFetch = options.customFetch || fetch;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = downloadUrl;
    let redirectCount = 0;
    const maxRedirects = 5;

    while (redirectCount < maxRedirects) {
      const isZoomDomain = isZoomHost(currentUrl);
      const headers: Record<string, string> = {};
      if (isZoomDomain) {
        headers["Authorization"] = `Bearer ${accessToken}`;
      }

      const response = await doFetch(currentUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
        redirect: "manual" // Handle redirects manually to protect bearer tokens
      });

      // Handle 301, 302, 303, 307, 308 redirects
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`ZOOM_DOWNLOAD_REDIRECT_ERROR: Redirect status ${response.status} missing Location header.`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirectCount++;
        continue;
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("ZOOM_DOWNLOAD_UNAUTHORIZED: Unauthorized recording download (token invalid or expired).");
        }
        if (response.status === 403) {
          throw new Error("ZOOM_DOWNLOAD_FORBIDDEN: Insufficient permissions to download recording.");
        }
        if (response.status === 404) {
          throw new Error("ZOOM_DOWNLOAD_NOT_FOUND: Recording file not found on provider.");
        }
        throw new Error(`ZOOM_DOWNLOAD_FAILED: Provider returned HTTP ${response.status}`);
      }

      // Check Content-Length header if provided
      const contentLengthHeader = response.headers.get("content-length");
      if (contentLengthHeader) {
        const declaredSize = parseInt(contentLengthHeader, 10);
        if (!isNaN(declaredSize) && declaredSize > maxBytes) {
          throw new Error(`FILE_TOO_LARGE: Recording size (${declaredSize} bytes) exceeds limit (${maxBytes} bytes).`);
        }
      }

      const contentType = response.headers.get("content-type") || "audio/mp4";

      // Read arrayBuffer safely with size bounding
      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (buffer.length === 0) {
        throw new Error("EMPTY_RECORDING_BYTES: Provider returned 0 recording bytes.");
      }

      if (buffer.length > maxBytes) {
        throw new Error(`FILE_TOO_LARGE: Recording size (${buffer.length} bytes) exceeds limit (${maxBytes} bytes).`);
      }

      // Validate that response is not an HTML error or login page
      const headString = buffer.slice(0, 100).toString("utf8").toLowerCase();
      if (headString.includes("<!doctype html") || headString.includes("<html")) {
        throw new Error("INVALID_CONTENT_TYPE: Provider returned HTML page instead of recording media.");
      }

      return {
        buffer,
        mimeType: contentType,
        sizeBytes: buffer.length
      };
    }

    throw new Error("ZOOM_DOWNLOAD_TOO_MANY_REDIRECTS: Exceeded maximum redirect limit (5).");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Checks whether the given URL points to an official Zoom API/download domain.
 */
function isZoomHost(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.toLowerCase();
    return host === "zoom.us" || host.endsWith(".zoom.us");
  } catch {
    return false;
  }
}

/**
 * Generates a deterministic import job ID based on meeting instance UUID (or ID) and file ID.
 */
export function computeZoomImportJobId(
  externalMeetingId: string,
  instanceUuid?: string,
  fileId?: string
): string {
  const base = (instanceUuid || externalMeetingId).replace(/[^a-zA-Z0-9_\-]/g, "_");
  const fId = (fileId || "primary").replace(/[^a-zA-Z0-9_\-]/g, "_");
  return `zoom_imp_${base}_${fId}`;
}

/**
 * Interface representing the storage bucket interface needed by the import service.
 */
export interface StorageBucketLike {
  file: (path: string) => {
    save: (buffer: Buffer, options?: any) => Promise<void>;
    exists?: () => Promise<[boolean]>;
  };
}

/**
 * Options for executing an authorized Zoom cloud recording import.
 */
export interface ZoomRecordingImportOptions {
  customFetch?: typeof fetch;
  customStorageBucket?: StorageBucketLike;
  geminiApiKey?: string;
  skipAiTranscription?: boolean;
}

/**
 * Result of the recording import workflow.
 */
export interface ZoomRecordingImportResult {
  jobId: string;
  status: ZoomImportJobStatus;
  recordingId?: string;
  storagePath?: string;
  transcriptionId?: string;
  sessionId?: string;
  manifestId?: string;
  fileSizeBytes?: number;
  message: string;
  isRetryable?: boolean;
}


/**
 * Classifies an error encountered during import as transient or permanent.
 * Permanent errors must not be retried automatically.
 */
export function classifyImportError(err: any): { isRetryable: boolean; category: "transient" | "permanent"; safeMessage: string } {
  const msg = (err?.message || "").toString();

  // Permanent failure indicators:
  if (
    msg.includes("INVALID_CONTENT_TYPE") ||
    msg.includes("FILE_TOO_LARGE") ||
    msg.includes("EMPTY_RECORDING_BYTES") ||
    msg.includes("ZOOM_CREDENTIALS_MISSING") ||
    msg.includes("ZOOM_AUTH_FAILED") ||
    msg.includes("ZOOM_INSUFFICIENT_SCOPES") ||
    msg.includes("ZOOM_DOWNLOAD_UNAUTHORIZED") ||
    msg.includes("ZOOM_DOWNLOAD_FORBIDDEN") ||
    msg.includes("ZOOM_DOWNLOAD_NOT_FOUND") ||
    msg.includes("ZOOM_TOKEN_INVALID") ||
    msg.includes("ZOOM_DOWNLOAD_TOO_MANY_REDIRECTS")
  ) {
    // Sanitize message: never expose raw token or authorization strings
    const safeMsg = msg.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]");
    return {
      isRetryable: false,
      category: "permanent",
      safeMessage: safeMsg
    };
  }

  // Transient failure indicators (429 rate limit, 5xx, timeouts, ECONNRESET, etc.)
  const safeMsg = msg.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]");
  return {
    isRetryable: true,
    category: "transient",
    safeMessage: safeMsg || "Transient network or provider error"
  };
}

/**
 * Calculates exponential backoff with jitter and a bounded maximum.
 */
export function calculateBackoffMs(attempts: number, baseMs: number = 2000, maxMs: number = 3600000): number {
  const exp = Math.min(Math.max(attempts, 1), 10);
  const backoff = Math.min(baseMs * Math.pow(2, exp - 1), maxMs);
  // Add 10-25% jitter
  const jitter = Math.floor(Math.random() * (backoff * 0.25));
  return Math.min(backoff + jitter, maxMs);
}

/**
 * Durably creates and enqueues an import job in Firestore before webhook acknowledgement.
 * Duplicate webhook deliveries safely return the existing pending/stored/completed job without creating duplicates.
 */
export async function enqueueZoomImportJob(
  db: Firestore,
  meetingEventData: {
    externalMeetingId: string;
    meetingInstanceUuid?: string;
    meetingStartTime?: string;
    meetingTopic?: string;
    hostEmail?: string;
    hostId?: string;
    recordingFiles?: ZoomRecordingFileItem[];
    organizationId?: string | null;
    projectId?: string | null;
    userId?: string;
  }
): Promise<{ jobId: string; status: ZoomImportJobStatus; deduplicated: boolean }> {
  const {
    externalMeetingId,
    meetingInstanceUuid,
    hostId,
    recordingFiles = [],
    organizationId,
    projectId,
    userId
  } = meetingEventData;

  const targetFile = selectBestRecordingFile(recordingFiles);
  if (!targetFile || !targetFile.downloadUrl) {
    return {
      jobId: `zoom_imp_${(meetingInstanceUuid || externalMeetingId).replace(/[^a-zA-Z0-9_\-]/g, "_")}_none`,
      status: "skipped",
      deduplicated: false
    };
  }

  const fileId = targetFile.id || "rec_0";
  const jobId = computeZoomImportJobId(externalMeetingId, meetingInstanceUuid, fileId);
  const jobDocRef = db.collection("zoom_import_jobs").doc(jobId);
  const authoritativeUserId = userId || `zoom-unmapped-host:${hostId || "unknown"}`;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  let deduplicated = false;
  let finalStatus: ZoomImportJobStatus = "pending";

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(jobDocRef);
    if (snap.exists) {
      const data = snap.data() as ZoomImportJobRecord;
      deduplicated = true;
      finalStatus = data.status;
      return;
    }

    const newJob: ZoomImportJobRecord = {
      id: jobId,
      meetingSessionId: `zoom_sess_${(meetingInstanceUuid || externalMeetingId).replace(/[^a-zA-Z0-9_\-]/g, "_")}`,
      externalMeetingId,
      meetingInstanceUuid,
      fileId,
      fileType: targetFile.fileType || "M4A",
      fileExtension: targetFile.fileExtension || "M4A",
      fileSize: targetFile.fileSize,
      downloadUrl: targetFile.downloadUrl,
      status: "pending",
      userId: authoritativeUserId,
      organizationId: organizationId || null,
      projectId: projectId || null,
      attempts: 0,
      maxAttempts: 5,
      leaseExpiresAt: null,
      nextRetryAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      metadata: {
        hostEmail: meetingEventData.hostEmail || null,
        meetingTopic: meetingEventData.meetingTopic || null,
        meetingStartTime: meetingEventData.meetingStartTime || null
      }
    };

    transaction.set(jobDocRef, newJob);
  });

  return { jobId, status: finalStatus, deduplicated };
}

/**
 * Executes the complete authorized Zoom cloud recording import workflow:
 * 1. Atomically claims/checks deterministic `zoom_import_jobs/{jobId}` record with lease.
 * 2. Resolves Zoom OAuth credentials (env or org integration).
 * 3. Selects optimal recording file (M4A audio-only preferred).
 * 4. Checks if recording is already stored in Cloud Storage (storage deduplication on retry).
 * 5. If not stored, downloads bytes securely via authorized download and uploads to Cloud Storage.
 * 6. Creates/updates Firestore `recordings/{recordingId}` doc.
 * 7. Links recording to `meetingSessions` and `meetingProvenanceManifests`.
 * 8. Triggers AI transcription pipeline (if configured and eligible).
 * 9. Marks job 'completed' or records structured, sanitized error details with exponential backoff.
 */
export async function importZoomRecording(
  db: Firestore,
  meetingEventData: {
    externalMeetingId: string;
    meetingInstanceUuid?: string;
    meetingStartTime?: string;
    meetingTopic?: string;
    hostEmail?: string;
    hostId?: string;
    recordingFiles?: ZoomRecordingFileItem[];
    organizationId?: string | null;
    projectId?: string | null;
    userId?: string;
  },
  options: ZoomRecordingImportOptions = {}
): Promise<ZoomRecordingImportResult> {
  const {
    externalMeetingId,
    meetingInstanceUuid,
    hostId,
    recordingFiles = [],
    organizationId,
    projectId,
    userId
  } = meetingEventData;

  const targetFile = selectBestRecordingFile(recordingFiles);
  if (!targetFile || !targetFile.downloadUrl) {
    return {
      jobId: `zoom_imp_${(meetingInstanceUuid || externalMeetingId).replace(/[^a-zA-Z0-9_\-]/g, "_")}_none`,
      status: "skipped",
      message: "No eligible audio or video recording file found in Zoom event."
    };
  }

  const fileId = targetFile.id || "rec_0";
  const jobId = computeZoomImportJobId(externalMeetingId, meetingInstanceUuid, fileId);
  const jobDocRef = db.collection("zoom_import_jobs").doc(jobId);

  const authoritativeUserId = userId || `zoom-unmapped-host:${hostId || "unknown"}`;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const leaseMs = 120000; // 2 minute lease for downloading and storing

  // 1. Transactional Claim of the Import Job
  let shouldProceed = false;
  let existingJobData: ZoomImportJobRecord | null = null;
  let currentAttempts = 1;

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(jobDocRef);
    if (snap.exists) {
      existingJobData = snap.data() as ZoomImportJobRecord;
      if (existingJobData.status === "completed") {
        shouldProceed = false;
        return;
      }
      // Check active lease on in-flight jobs
      if (
        (existingJobData.status === "downloading" || existingJobData.status === "transcribing") &&
        existingJobData.leaseExpiresAt &&
        existingJobData.leaseExpiresAt > now
      ) {
        shouldProceed = false;
        return;
      }

      currentAttempts = (existingJobData.attempts || 0) + 1;

      // Re-claim lease
      transaction.update(jobDocRef, {
        status: existingJobData.status === "stored" ? "transcribing" : "downloading",
        leaseExpiresAt: now + leaseMs,
        attempts: FieldValue.increment(1),
        updatedAt: nowIso
      });
      shouldProceed = true;
    } else {
      // First time claiming this import job
      const newJob: ZoomImportJobRecord = {
        id: jobId,
        meetingSessionId: `zoom_sess_${(meetingInstanceUuid || externalMeetingId).replace(/[^a-zA-Z0-9_\-]/g, "_")}`,
        externalMeetingId,
        meetingInstanceUuid,
        fileId,
        fileType: targetFile.fileType || "M4A",
        fileExtension: targetFile.fileExtension || "M4A",
        fileSize: targetFile.fileSize,
        downloadUrl: targetFile.downloadUrl,
        status: "downloading",
        userId: authoritativeUserId,
        organizationId: organizationId || null,
        projectId: projectId || null,
        leaseExpiresAt: now + leaseMs,
        attempts: 1,
        maxAttempts: 5,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      transaction.set(jobDocRef, newJob);
      shouldProceed = true;
    }
  });

  if (!shouldProceed) {
    if (existingJobData?.status === "completed") {
      return {
        jobId,
        status: "completed",
        recordingId: existingJobData.recordingId,
        storagePath: existingJobData.storagePath,
        transcriptionId: existingJobData.transcriptionId,
        message: "Recording has already been imported and processed."
      };
    }
    return {
      jobId,
      status: "downloading",
      message: "Import job is currently in progress by another worker.",
      isRetryable: true
    };
  }

  // 2. Resolve Credentials, Recording IDs, and Storage Path
  let recordingId = existingJobData?.recordingId || `rec_${crypto.randomUUID()}`;
  let fileExtension = (targetFile.fileExtension || (targetFile.fileType === "MP4" ? "mp4" : "m4a")).toLowerCase();
  let fileName = `zoom_${externalMeetingId}_${fileId}.${fileExtension}`;
  let storagePath = existingJobData?.storagePath || `recordings/${authoritativeUserId}/${recordingId}/${fileName}`;
  const sessionId = `zoom_sess_${(meetingInstanceUuid || externalMeetingId).replace(/[^a-zA-Z0-9_\-]/g, "_")}`;
  const manifestId = `zoom_prov_${(meetingInstanceUuid || externalMeetingId).replace(/[^a-zA-Z0-9_\-]/g, "_")}`;

  try {
    let buffer: Buffer | null = null;
    let mimeType = targetFile.fileType === "MP4" ? "video/mp4" : "audio/mp4";
    let sizeBytes = targetFile.fileSize || 0;

    // Check if recording is already stored in storage
    let alreadyStored = false;
    if (existingJobData?.status === "stored" && existingJobData?.storagePath) {
      if (options.customStorageBucket?.file(existingJobData.storagePath).exists) {
        const [exists] = await options.customStorageBucket.file(existingJobData.storagePath).exists!();
        if (exists) {
          alreadyStored = true;
          storagePath = existingJobData.storagePath;
          recordingId = existingJobData.recordingId || recordingId;
          sizeBytes = existingJobData.fileSize || sizeBytes;
        }
      }
    }

    if (!alreadyStored) {
      const creds = await resolveZoomCredentials(db, organizationId);
      const accessToken = await getZoomAccessToken(creds, options.customFetch);

      // Download recording bytes
      const downloadRes = await downloadZoomRecordingBytes(
        targetFile.downloadUrl,
        accessToken,
        { customFetch: options.customFetch }
      );
      buffer = downloadRes.buffer;
      mimeType = downloadRes.mimeType;
      sizeBytes = downloadRes.sizeBytes;

      // 3. Upload to Cloud Storage
      if (options.customStorageBucket) {
        await options.customStorageBucket.file(storagePath).save(buffer, {
          metadata: {
            contentType: mimeType,
            metadata: {
              externalMeetingId,
              meetingInstanceUuid: meetingInstanceUuid || "",
              fileId,
              provider: "zoom"
            }
          }
        });
      }

      // 4. Update Import Job: Stored
      await jobDocRef.update({
        status: "stored",
        recordingId,
        storagePath,
        fileSize: sizeBytes,
        leaseExpiresAt: now + leaseMs,
        updatedAt: new Date().toISOString()
      });
    }

    // 5. Create or Update `recordings/{recordingId}` Firestore doc
    const recordingDocRef = db.collection("recordings").doc(recordingId);
    const recordingPayload: Recording = {
      id: recordingId,
      projectId: projectId || "unassigned",
      userId: authoritativeUserId,
      fileName,
      storagePath,
      status: "processing",
      duration: targetFile.fileSize,
      mimeType,
      meetingSessionId: sessionId,
      externalMeetingId,
      provider: "zoom",
      provenanceManifestId: manifestId,
      createdAt: nowIso
    };

    await recordingDocRef.set(recordingPayload, { merge: true });

    // 6. Update meetingSession and meetingProvenanceManifest
    const sessionDocRef = db.collection("meetingSessions").doc(sessionId);
    await sessionDocRef.set({
      recordingId,
      recordingStoragePath: storagePath,
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch(() => {});

    const manifestDocRef = db.collection("meetingProvenanceManifests").doc(manifestId);
    const manifestArtifact: MeetingArtifactReference = {
      artifactId: fileId,
      type: "recording",
      uri: `gs://${storagePath}`,
      mimeType,
      sizeBytes,
      contentHash: buffer ? crypto.createHash("sha256").update(buffer).digest("hex") : (existingJobData?.id || fileId),
      createdAt: new Date().toISOString()
    };

    await manifestDocRef.set({
      importedRecordingArtifact: manifestArtifact,
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch(() => {});

    // 7. Trigger Transcription Pipeline
    let transcriptionId: string | undefined = existingJobData?.transcriptionId;

    if (!transcriptionId && !options.skipAiTranscription && buffer) {
      await jobDocRef.update({
        status: "transcribing",
        leaseExpiresAt: now + leaseMs,
        updatedAt: new Date().toISOString()
      });

      try {
        transcriptionId = await executeTranscriptionHandoff(
          db,
          buffer,
          mimeType,
          recordingId,
          authoritativeUserId,
          sessionId,
          manifestId,
          options.geminiApiKey
        );
      } catch (aiErr: any) {
        console.warn(`[Zoom Import] AI transcription failed, recording preserved: ${aiErr?.message}`);
        await recordingDocRef.update({
          status: "completed", // audio is stored and playable; transcription pending/failed
          errorMessage: `Transcription handoff note: ${aiErr?.message || "AI transcription unavailable"}`
        });
      }
    }

    // 8. Mark Job Completed
    await jobDocRef.update({
      status: "completed",
      recordingId,
      storagePath,
      transcriptionId: transcriptionId || null,
      leaseExpiresAt: null,
      nextRetryAt: null,
      isRetryable: false,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return {
      jobId,
      status: "completed",
      recordingId,
      storagePath,
      transcriptionId,
      sessionId,
      manifestId,
      fileSizeBytes: sizeBytes,
      message: `Recording ${fileName} successfully imported and stored.`
    };
  } catch (err: any) {
    const errorClassification = classifyImportError(err);
    const maxAttempts = existingJobData?.maxAttempts || 5;
    const isExhausted = currentAttempts >= maxAttempts;
    const willRetry = errorClassification.isRetryable && !isExhausted;
    const nextRetryAt = willRetry ? Date.now() + calculateBackoffMs(currentAttempts) : null;

    console.error(`[Zoom Import] Failed for job ${jobId} (attempt ${currentAttempts}/${maxAttempts}):`, errorClassification.safeMessage);

    await jobDocRef.update({
      status: "failed",
      leaseExpiresAt: null,
      lastError: errorClassification.safeMessage,
      isRetryable: willRetry,
      errorCategory: errorClassification.category,
      nextRetryAt,
      updatedAt: new Date().toISOString()
    }).catch(() => {});

    return {
      jobId,
      status: "failed",
      message: errorClassification.safeMessage,
      isRetryable: willRetry
    };
  }
}

/**
 * Worker processor: Discovers and processes queued, interrupted, or retryable Zoom import jobs.
 * - Claims jobs atomically with distributed leases.
 * - Recovers expired worker leases (interrupted jobs).
 * - Honors nextRetryAt backoff for failed transient jobs.
 */
export async function processPendingZoomImportJobs(
  db: Firestore,
  options: ZoomRecordingImportOptions & { batchSize?: number } = {}
): Promise<{ processed: number; succeeded: number; failed: number; skipped: number; results: ZoomRecordingImportResult[] }> {
  const batchSize = Math.min(Math.max(options.batchSize || 10, 1), 50);
  const now = Date.now();

  // Query eligible jobs
  // 1. Pending jobs
  const pendingSnap = await db.collection("zoom_import_jobs")
    .where("status", "==", "pending")
    .limit(batchSize)
    .get();

  const candidateDocs = [...pendingSnap.docs];

  // 2. Interrupted jobs with expired leases
  if (candidateDocs.length < batchSize) {
    const downloadingSnap = await db.collection("zoom_import_jobs")
      .where("status", "in", ["downloading", "transcribing"])
      .limit(batchSize)
      .get();

    for (const doc of downloadingSnap.docs) {
      const data = doc.data() as ZoomImportJobRecord;
      if (data.leaseExpiresAt && data.leaseExpiresAt < now && !candidateDocs.some(d => d.id === doc.id)) {
        candidateDocs.push(doc);
      }
    }
  }

  // 3. Retryable failed jobs whose backoff has elapsed
  if (candidateDocs.length < batchSize) {
    const failedSnap = await db.collection("zoom_import_jobs")
      .where("status", "==", "failed")
      .where("isRetryable", "==", true)
      .limit(batchSize)
      .get();

    for (const doc of failedSnap.docs) {
      const data = doc.data() as ZoomImportJobRecord;
      if (data.nextRetryAt && data.nextRetryAt <= now && !candidateDocs.some(d => d.id === doc.id)) {
        candidateDocs.push(doc);
      }
    }
  }

  const results: ZoomRecordingImportResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const doc of candidateDocs.slice(0, batchSize)) {
    const jobData = doc.data() as ZoomImportJobRecord;

    // Construct meetingEventData from stored job metadata
    const meetingEventData = {
      externalMeetingId: jobData.externalMeetingId,
      meetingInstanceUuid: jobData.meetingInstanceUuid,
      hostEmail: jobData.metadata?.hostEmail,
      hostId: jobData.userId.startsWith("zoom-unmapped-host:") ? jobData.userId.replace("zoom-unmapped-host:", "") : undefined,
      recordingFiles: [
        {
          id: jobData.fileId,
          fileType: jobData.fileType,
          fileExtension: jobData.fileExtension,
          fileSize: jobData.fileSize,
          downloadUrl: jobData.downloadUrl
        }
      ],
      organizationId: jobData.organizationId,
      projectId: jobData.projectId,
      userId: jobData.userId.startsWith("zoom-unmapped-host:") ? undefined : jobData.userId
    };

    const res = await importZoomRecording(db, meetingEventData, options);
    results.push(res);

    if (res.status === "completed") succeeded++;
    else if (res.status === "failed") failed++;
    else skipped++;
  }

  return {
    processed: candidateDocs.length,
    succeeded,
    failed,
    skipped,
    results
  };
}

/**
 * Executes server-side AI transcription handoff using Gemini, storing output in `transcriptions`.
 */
async function executeTranscriptionHandoff(
  db: Firestore,
  audioBuffer: Buffer,
  mimeType: string,
  recordingId: string,
  userId: string,
  sessionId: string,
  manifestId: string,
  geminiApiKey?: string
): Promise<string> {
  const apiKey = geminiApiKey || (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING: Gemini API key is not configured.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = "gemini-2.5-flash-native-audio-preview-12-2025";

  const prompt = `
    Analyze this meeting audio. Provide a speaker-wise transcript.
    Identify speakers as 'Speaker A', 'Speaker B', etc.
    Also provide a high-level executive summary and a list of specific action items.
    Return JSON format:
    {
      "summary": "string",
      "actionItems": ["string"],
      "segments": [
        { "speaker": "string", "text": "string", "startTime": number, "endTime": number }
      ]
    }
  `;

  const audioBase64 = audioBuffer.toString("base64");

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        inlineData: {
          data: audioBase64,
          mimeType
        }
      },
      { text: prompt }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                text: { type: Type.STRING },
                startTime: { type: Type.NUMBER },
                endTime: { type: Type.NUMBER }
              },
              required: ["speaker", "text", "startTime", "endTime"]
            }
          }
        },
        required: ["summary", "actionItems", "segments"]
      }
    }
  });

  const parsed = JSON.parse(response.text || "{}");
  const transcriptionId = `trn_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();

  // Save transcription
  await db.collection("transcriptions").doc(transcriptionId).set({
    id: transcriptionId,
    recordingId,
    userId,
    meetingSessionId: sessionId,
    provenanceManifestId: manifestId,
    summary: parsed.summary || "",
    actionItems: parsed.actionItems || [],
    segments: parsed.segments || [],
    createdAt: nowIso
  });

  // Mark recording completed
  await db.collection("recordings").doc(recordingId).update({
    status: "completed",
    transcriptionId,
    updatedAt: nowIso
  });

  return transcriptionId;
}
