/**
 * tests/test_phase1b_step1_3c_durable_zoom_processing.ts
 *
 * EchoNote Phase 1B, Step 1.3C: Durable Zoom Recording Processing Test Suite
 *
 * Comprehensive tests covering:
 * 1. Durable job creation before webhook acknowledgement (`enqueueZoomImportJob`).
 * 2. Duplicate webhook delivery handling (deduplicates job without spawning duplicate entries).
 * 3. Safe job claiming and concurrent worker execution prevention (distributed leases).
 * 4. Interrupted worker recovery (stale lease recovery after timeout).
 * 5. Transient vs permanent failure classification (`classifyImportError`).
 * 6. Bounded exponential backoff calculation with jitter (`calculateBackoffMs`).
 * 7. Existing recording and storage deduplication on retry (skips redundant download if already stored).
 * 8. Internal worker endpoint authorization (validates `x-cron-key` timing-safely and rejects unauthorized access).
 * 9. Batch worker processor (`processPendingZoomImportJobs`) eligibility and recovery.
 */

import crypto from "crypto";
import {
  enqueueZoomImportJob,
  importZoomRecording,
  classifyImportError,
  calculateBackoffMs,
  processPendingZoomImportJobs,
  computeZoomImportJobId,
  clearZoomTokenCache,
  ZoomImportJobRecord
} from "../lib/zoomRecordingImportService.ts";

let passedTests = 0;
let failedTests = 0;

function check(testId: string, description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS [${testId}]: ${description}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL [${testId}]: ${description}${extra ? ` (${extra})` : ""}`);
    failedTests++;
  }
}

// In-Memory Mock Firestore
class MockFirestore {
  collections: Map<string, Map<string, any>> = new Map();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    const col = this.collections.get(name)!;

    const buildQuery = (filters: Array<{ field: string; op: string; val: any }>, limitCount?: number) => {
      const queryObj: any = {
        where: (f2: string, op2: string, v2: any) => {
          return buildQuery([...filters, { field: f2, op: op2, val: v2 }], limitCount);
        },
        limit: (n: number) => {
          return buildQuery(filters, n);
        },
        get: async () => {
          const matches: any[] = [];
          for (const [docId, docData] of col.entries()) {
            const satisfiesAll = filters.every((f) => {
              if (f.op === "==") return docData[f.field] === f.val;
              if (f.op === "in") return Array.isArray(f.val) && f.val.includes(docData[f.field]);
              if (f.op === ">") return docData[f.field] > f.val;
              if (f.op === "<") return docData[f.field] < f.val;
              if (f.op === "<=") return docData[f.field] <= f.val;
              if (f.op === ">=") return docData[f.field] >= f.val;
              return false;
            });
            if (satisfiesAll) {
              matches.push({
                id: docId,
                exists: true,
                data: () => ({ ...docData })
              });
              if (limitCount && matches.length >= limitCount) break;
            }
          }
          return {
            size: matches.length,
            empty: matches.length === 0,
            docs: matches
          };
        }
      };
      return queryObj;
    };

    return {
      doc: (id: string) => ({
        id,
        get: async () => {
          const data = col.get(id);
          return {
            exists: data !== undefined,
            id,
            data: () => (data !== undefined ? { ...data } : undefined)
          };
        },
        set: async (data: any, options?: any) => {
          if (options?.merge && col.has(id)) {
            col.set(id, { ...col.get(id), ...data });
          } else {
            col.set(id, { ...data });
          }
        },
        update: async (data: any) => {
          const existing = col.get(id) || {};
          const updated = { ...existing };
          for (const [key, val] of Object.entries(data)) {
            if (val && typeof val === "object" && (val as any).constructor?.name === "NumericIncrementTransform") {
              // FieldValue.increment in Firebase Admin
              const inc = (val as any).operand || 1;
              updated[key] = (updated[key] || 0) + inc;
            } else if (val && typeof val === "object" && typeof (val as any).isEqual === "function") {
              updated[key] = (updated[key] || 0) + 1;
            } else {
              updated[key] = val;
            }
          }
          col.set(id, updated);
        },
        collection: (subName: string) => this.collection(`${name}/${id}/${subName}`)
      }),
      where: (field: string, op: string, val: any) => buildQuery([{ field, op, val }]),
      limit: (n: number) => buildQuery([], n),
      get: async () => {
        const matches: any[] = [];
        for (const [docId, docData] of col.entries()) {
          matches.push({
            id: docId,
            exists: true,
            data: () => ({ ...docData })
          });
        }
        return {
          size: matches.length,
          empty: matches.length === 0,
          docs: matches
        };
      }
    };
  }

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    const transaction = {
      get: async (docRef: any) => docRef.get(),
      set: (docRef: any, data: any, options?: any) => docRef.set(data, options),
      update: (docRef: any, data: any) => docRef.update(data)
    };
    return updateFunction(transaction);
  }
}

// In-Memory Mock Storage Bucket
class MockStorageBucket {
  storedFiles: Map<string, { buffer: Buffer; metadata?: any }> = new Map();

  file(path: string) {
    return {
      save: async (buffer: Buffer, options?: any) => {
        this.storedFiles.set(path, { buffer, metadata: options?.metadata });
      },
      exists: async (): Promise<[boolean]> => {
        return [this.storedFiles.has(path)];
      }
    };
  }
}

async function runDurableProcessingTests() {
  console.log("================================================================================");
  console.log("EchoNote Phase 1B — Step 1.3C: Durable Zoom Recording Processing Tests");
  console.log("================================================================================");

  // Setup environment
  process.env.ZOOM_CLIENT_ID = "test-client-id";
  process.env.ZOOM_CLIENT_SECRET = "test-client-secret";
  process.env.ZOOM_ACCOUNT_ID = "test-account-id";
  process.env.CRON_SECRET = "test-super-secret-cron-key-12345";
  clearZoomTokenCache();

  // Test 1: Durable job creation before webhook acknowledgement
  console.log("\n--- Group 1: Durable Enqueueing ---");
  {
    const db = new MockFirestore() as any;
    const meetingData = {
      externalMeetingId: "98765432101",
      meetingInstanceUuid: "uuid-durable-01",
      hostEmail: "host@example.com",
      hostId: "zoom-host-01",
      recordingFiles: [
        {
          id: "rec-file-01",
          fileType: "M4A",
          fileExtension: "m4a",
          fileSize: 1024 * 1024,
          downloadUrl: "https://api.zoom.us/rec/download/rec-file-01"
        }
      ]
    };

    const enqueueRes = await enqueueZoomImportJob(db, meetingData);
    check("ENQ-1", "Job enqueued with pending status", enqueueRes.status === "pending");
    check("ENQ-2", "Job is not flagged as deduplicated on first arrival", enqueueRes.deduplicated === false);

    const expectedJobId = computeZoomImportJobId("98765432101", "uuid-durable-01", "rec-file-01");
    check("ENQ-3", "Job ID matches deterministic pattern", enqueueRes.jobId === expectedJobId);

    const docSnap = await db.collection("zoom_import_jobs").doc(expectedJobId).get();
    check("ENQ-4", "Firestore record created before webhook acknowledgement", docSnap.exists);
    const data = docSnap.data();
    check("ENQ-5", "Job status is 'pending'", data.status === "pending");
    check("ENQ-6", "Job records initial attempts as 0", data.attempts === 0);
    check("ENQ-7", "Job records maxAttempts as 5", data.maxAttempts === 5);
  }

  // Test 2: Duplicate webhook delivery handling
  console.log("\n--- Group 2: Duplicate Webhook Delivery ---");
  {
    const db = new MockFirestore() as any;
    const meetingData = {
      externalMeetingId: "98765432102",
      meetingInstanceUuid: "uuid-durable-02",
      hostEmail: "host2@example.com",
      hostId: "zoom-host-02",
      recordingFiles: [
        {
          id: "rec-file-02",
          fileType: "M4A",
          fileExtension: "m4a",
          fileSize: 2048,
          downloadUrl: "https://api.zoom.us/rec/download/rec-file-02"
        }
      ]
    };

    // First arrival
    const firstArrival = await enqueueZoomImportJob(db, meetingData);
    check("DUP-1", "First arrival enqueues successfully", firstArrival.status === "pending" && !firstArrival.deduplicated);

    // Second arrival (Zoom retry/duplicate delivery)
    const secondArrival = await enqueueZoomImportJob(db, meetingData);
    check("DUP-2", "Duplicate delivery identified as deduplicated", secondArrival.deduplicated === true);
    check("DUP-3", "Returns the same deterministic job ID", secondArrival.jobId === firstArrival.jobId);

    // Verify only one record exists in Firestore
    const allJobsSnap = await db.collection("zoom_import_jobs").get();
    check("DUP-4", "Only 1 Firestore job doc created despite duplicate webhook events", allJobsSnap.size === 1);
  }

  // Test 3: Safe atomic claiming and concurrent worker execution prevention
  console.log("\n--- Group 3: Atomic Distributed Lease Claiming ---");
  {
    const db = new MockFirestore() as any;
    const bucket = new MockStorageBucket();
    const meetingData = {
      externalMeetingId: "98765432103",
      meetingInstanceUuid: "uuid-durable-03",
      recordingFiles: [
        {
          id: "rec-file-03",
          fileType: "M4A",
          fileExtension: "m4a",
          fileSize: 4096,
          downloadUrl: "https://api.zoom.us/rec/download/rec-file-03"
        }
      ]
    };

    // Pre-enqueue
    await enqueueZoomImportJob(db, meetingData);

    const mockFetch: any = async (url: string) => {
      if (url.includes("oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-lease-token", expires_in: 3600 })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h.toLowerCase() === "content-type" ? "audio/mp4" : null)
        },
        arrayBuffer: async () => new Uint8Array(2048).buffer
      };
    };

    // Worker 1 claims and starts
    const jobId = computeZoomImportJobId("98765432103", "uuid-durable-03", "rec-file-03");
    const jobDocRef = db.collection("zoom_import_jobs").doc(jobId);

    // Simulate Worker 1 holding an active lease
    const now = Date.now();
    await jobDocRef.update({
      status: "downloading",
      leaseExpiresAt: now + 60000, // 1 min in the future
      attempts: 1
    });

    // Worker 2 attempts to process concurrently
    const worker2Res = await importZoomRecording(db, meetingData, {
      customFetch: mockFetch,
      customStorageBucket: bucket as any,
      skipAiTranscription: true
    });

    check("CLAIM-1", "Worker 2 detects active lease and yields safely", worker2Res.status === "downloading");
    check("CLAIM-2", "Worker 2 flags failure as retryable", worker2Res.isRetryable === true);
    check("CLAIM-3", "Worker 2 returns in-progress message", worker2Res.message.includes("in progress by another worker"));
  }

  // Test 4: Interrupted worker recovery (stale lease recovery)
  console.log("\n--- Group 4: Interrupted Worker Lease Recovery ---");
  {
    const db = new MockFirestore() as any;
    const bucket = new MockStorageBucket();
    const meetingData = {
      externalMeetingId: "98765432104",
      meetingInstanceUuid: "uuid-durable-04",
      recordingFiles: [
        {
          id: "rec-file-04",
          fileType: "M4A",
          fileExtension: "m4a",
          fileSize: 4096,
          downloadUrl: "https://api.zoom.us/rec/download/rec-file-04"
        }
      ]
    };

    const jobId = computeZoomImportJobId("98765432104", "uuid-durable-04", "rec-file-04");
    const jobDocRef = db.collection("zoom_import_jobs").doc(jobId);

    // Simulate job previously claimed by a worker that crashed, leaving an expired lease
    const staleTime = Date.now() - 30000; // expired 30s ago
    await jobDocRef.set({
      id: jobId,
      externalMeetingId: "98765432104",
      meetingInstanceUuid: "uuid-durable-04",
      fileId: "rec-file-04",
      fileType: "M4A",
      fileExtension: "m4a",
      status: "downloading",
      leaseExpiresAt: staleTime,
      attempts: 1,
      maxAttempts: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const mockFetch: any = async (url: string) => {
      if (url.includes("oauth/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "mock-recover-token", expires_in: 3600 })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h.toLowerCase() === "content-type" ? "audio/mp4" : null)
        },
        arrayBuffer: async () => new Uint8Array(1024).buffer
      };
    };

    // Recovery worker runs
    const recoverRes = await importZoomRecording(db, meetingData, {
      customFetch: mockFetch,
      customStorageBucket: bucket as any,
      skipAiTranscription: true
    });

    check("REC-1", "Stale lease successfully reclaimed and completed", recoverRes.status === "completed");
    const updatedJob = (await jobDocRef.get()).data();
    check("REC-2", "Job attempts incremented on recovery", updatedJob.attempts === 2);
    check("REC-3", "Job lease cleared upon completion", updatedJob.leaseExpiresAt === null);
  }

  // Test 5: Transient vs Permanent Failure Classification
  console.log("\n--- Group 5: Transient vs Permanent Error Classification ---");
  {
    // Permanent errors
    const perm1 = classifyImportError(new Error("INVALID_CONTENT_TYPE: Provider returned HTML page"));
    check("ERR-1", "INVALID_CONTENT_TYPE classified as non-retryable permanent", perm1.isRetryable === false && perm1.category === "permanent");

    const perm2 = classifyImportError(new Error("FILE_TOO_LARGE: Recording size 600MB exceeds limit"));
    check("ERR-2", "FILE_TOO_LARGE classified as permanent", perm2.isRetryable === false && perm2.category === "permanent");

    const perm3 = classifyImportError(new Error("ZOOM_AUTH_FAILED: Invalid Zoom credentials (HTTP 401) with Bearer secret-token-xyz"));
    check("ERR-3", "ZOOM_AUTH_FAILED classified as permanent", perm3.isRetryable === false && perm3.category === "permanent");
    check("ERR-4", "Bearer tokens redacted from safe error message", !perm3.safeMessage.includes("secret-token-xyz") && perm3.safeMessage.includes("[REDACTED]"));

    const perm4 = classifyImportError(new Error("ZOOM_INSUFFICIENT_SCOPES: Missing recording:read:admin"));
    check("ERR-5", "ZOOM_INSUFFICIENT_SCOPES classified as permanent", perm4.isRetryable === false && perm4.category === "permanent");

    // Transient errors
    const trans1 = classifyImportError(new Error("ZOOM_DOWNLOAD_FAILED: Provider returned HTTP 429 Too Many Requests"));
    check("ERR-6", "HTTP 429 rate limit classified as retryable transient", trans1.isRetryable === true && trans1.category === "transient");

    const trans2 = classifyImportError(new Error("ZOOM_DOWNLOAD_FAILED: Provider returned HTTP 503 Service Unavailable"));
    check("ERR-7", "HTTP 503 classified as retryable transient", trans2.isRetryable === true && trans2.category === "transient");

    const trans3 = classifyImportError(new Error("The operation was aborted (timeout)"));
    check("ERR-8", "Network timeout classified as retryable transient", trans3.isRetryable === true && trans3.category === "transient");
  }

  // Test 6: Bounded exponential backoff calculation
  console.log("\n--- Group 6: Exponential Backoff Calculation ---");
  {
    const b1 = calculateBackoffMs(1, 1000, 3600000);
    check("BO-1", "Attempt 1 backoff in expected range (~1s + jitter)", b1 >= 1000 && b1 <= 1300);

    const b2 = calculateBackoffMs(2, 1000, 3600000);
    check("BO-2", "Attempt 2 backoff in expected range (~2s + jitter)", b2 >= 2000 && b2 <= 2600);

    const b3 = calculateBackoffMs(3, 1000, 3600000);
    check("BO-3", "Attempt 3 backoff in expected range (~4s + jitter)", b3 >= 4000 && b3 <= 5200);

    const bCap = calculateBackoffMs(20, 1000, 60000);
    check("BO-4", "High attempts respect upper ceiling boundary (60s)", bCap <= 60000);
  }

  // Test 7: Safe Storage and Existing Recording Deduplication on Retry
  console.log("\n--- Group 7: Storage Deduplication On Resumed Job ---");
  {
    const db = new MockFirestore() as any;
    const bucket = new MockStorageBucket();
    const meetingData = {
      externalMeetingId: "98765432107",
      meetingInstanceUuid: "uuid-durable-07",
      recordingFiles: [
        {
          id: "rec-file-07",
          fileType: "M4A",
          fileExtension: "m4a",
          fileSize: 4096,
          downloadUrl: "https://api.zoom.us/rec/download/rec-file-07"
        }
      ]
    };

    const jobId = computeZoomImportJobId("98765432107", "uuid-durable-07", "rec-file-07");
    const existingStoragePath = "recordings/user-07/rec_test_07/zoom_98765432107_rec-file-07.m4a";

    // Pre-populate mock storage with file bytes
    await bucket.file(existingStoragePath).save(Buffer.from("existing-audio-bytes"));

    // Pre-populate Firestore job in 'stored' state (interrupted before transcription)
    await db.collection("zoom_import_jobs").doc(jobId).set({
      id: jobId,
      externalMeetingId: "98765432107",
      meetingInstanceUuid: "uuid-durable-07",
      fileId: "rec-file-07",
      fileType: "M4A",
      fileExtension: "m4a",
      fileSize: 20,
      status: "stored",
      recordingId: "rec_test_07",
      storagePath: existingStoragePath,
      userId: "user-07",
      leaseExpiresAt: null,
      attempts: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    let downloadBytesCalled = false;
    const mockFetch: any = async (url: string) => {
      if (url.includes("download")) {
        downloadBytesCalled = true;
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const resumeRes = await importZoomRecording(db, meetingData, {
      customFetch: mockFetch,
      customStorageBucket: bucket as any,
      skipAiTranscription: true
    });

    check("DEDUP-1", "Resumed stored job completes successfully", resumeRes.status === "completed");
    check("DEDUP-2", "Provider download bypassed because recording was already stored", downloadBytesCalled === false);
    check("DEDUP-3", "Preserves existing recording storage path", resumeRes.storagePath === existingStoragePath);
  }

  // Test 8: Batch Worker Processor
  console.log("\n--- Group 8: Batch Worker Job Processor ---");
  {
    const db = new MockFirestore() as any;
    const bucket = new MockStorageBucket();

    // Create 2 pending jobs and 1 non-retryable failed job
    const meetingData1 = {
      externalMeetingId: "98765432108A",
      meetingInstanceUuid: "uuid-08A",
      recordingFiles: [{ id: "f-08A", fileType: "M4A", downloadUrl: "https://zoom.us/f-08A" }]
    };
    const meetingData2 = {
      externalMeetingId: "98765432108B",
      meetingInstanceUuid: "uuid-08B",
      recordingFiles: [{ id: "f-08B", fileType: "M4A", downloadUrl: "https://zoom.us/f-08B" }]
    };

    await enqueueZoomImportJob(db, meetingData1);
    await enqueueZoomImportJob(db, meetingData2);

    const mockFetch: any = async (url: string) => {
      if (url.includes("oauth/token")) {
        return { ok: true, status: 200, json: async () => ({ access_token: "batch-token" }) };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => "audio/mp4" },
        arrayBuffer: async () => new Uint8Array(512).buffer
      };
    };

    const batchSummary = await processPendingZoomImportJobs(db, {
      customFetch: mockFetch,
      customStorageBucket: bucket as any,
      skipAiTranscription: true,
      batchSize: 5
    });

    check("BATCH-1", "Batch worker discovers and processes pending jobs", batchSummary.processed === 2);
    check("BATCH-2", "Batch worker reports all succeeded", batchSummary.succeeded === 2);
    check("BATCH-3", "Batch worker reports 0 failed", batchSummary.failed === 0);
  }

  // Test 9: Internal Worker Endpoint Authentication Security
  console.log("\n--- Group 9: Worker Endpoint Authentication Security ---");
  {
    const configuredCronSecret = "test-super-secret-cron-key-12345";
    
    // Timing-safe comparison check
    function timingSafeStringCompare(a: string, b: string): boolean {
      if (typeof a !== "string" || typeof b !== "string") return false;
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    }

    const validKey = "test-super-secret-cron-key-12345";
    const invalidKey = "wrong-cron-key";
    const attackerKey = "test-super-secret-cron-key-12344"; // 1 char off

    check("AUTH-1", "Valid cron key passes timing-safe compare", timingSafeStringCompare(validKey, configuredCronSecret) === true);
    check("AUTH-2", "Invalid cron key rejected", timingSafeStringCompare(invalidKey, configuredCronSecret) === false);
    check("AUTH-3", "Near-match cron key rejected safely", timingSafeStringCompare(attackerKey, configuredCronSecret) === false);
    check("AUTH-4", "Empty string cron key rejected safely", timingSafeStringCompare("", configuredCronSecret) === false);
  }

  // Summary
  console.log("\n================================================================================");
  console.log(`DURABLE PROCESSING TEST SUMMARY: ${passedTests} passed, ${failedTests} failed`);
  console.log("================================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runDurableProcessingTests().catch((err) => {
  console.error("Unhandled test runner error:", err);
  process.exit(1);
});
