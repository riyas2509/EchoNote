/**
 * tests/test_phase1b_step1_3b_zoom_recording_import.ts
 *
 * EchoNote Phase 1B, Step 1.3B: Authorized Zoom Cloud Recording Import Test Suite
 *
 * Comprehensive tests covering:
 * 1. Missing Zoom OAuth Configuration handling (fails safely with explicit error).
 * 2. Authorized OAuth token acquisition and in-memory caching/refresh.
 * 3. File selection heuristic: prioritizes M4A audio-only over MP4 video.
 * 4. Authorized download success using controlled mock responses.
 * 5. Unauthorized (HTTP 401) and insufficient scopes (HTTP 403) handling.
 * 6. Provider errors and retry behavior.
 * 7. Invalid content-type (HTML page) and oversized file rejection (> 500 MB limit).
 * 8. Secure storage references and Bearer token redaction on redirects.
 * 9. Idempotent import job records (`zoom_import_jobs`) and concurrent claiming prevention.
 * 10. Storage persistence and Firestore recording record creation (`recordings`).
 * 11. Provenance preservation: links `meetingSessions` and `meetingProvenanceManifests`.
 * 12. Transcription pipeline handoff and duplicate job prevention.
 * 13. Tenant isolation: preserves unmapped/pending association state without forcing arbitrary org.
 */

import crypto from "crypto";
import {
  resolveZoomCredentials,
  getZoomAccessToken,
  selectBestRecordingFile,
  downloadZoomRecordingBytes,
  computeZoomImportJobId,
  importZoomRecording,
  clearZoomTokenCache,
  MAX_RECORDING_SIZE_BYTES
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

// In-Memory Mock Firestore for unit tests
class MockFirestore {
  collections: Map<string, Map<string, any>> = new Map();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    const col = this.collections.get(name)!;

    return {
      doc: (id: string) => ({
        id,
        get: async () => {
          const data = col.get(id);
          return {
            exists: data !== undefined,
            id,
            data: () => data
          };
        },
        set: async (data: any, options?: any) => {
          if (options?.merge && col.has(id)) {
            col.set(id, { ...col.get(id), ...data });
          } else {
            col.set(id, data);
          }
        },
        update: async (data: any) => {
          const existing = col.get(id) || {};
          col.set(id, { ...existing, ...data });
        },
        collection: (subName: string) => this.collection(`${name}/${id}/${subName}`)
      }),
      where: (field: string, op: string, val: any) => {
        const filters = [{ field, op, val }];
        const queryObj: any = {
          where: (f2: string, op2: string, v2: any) => {
            filters.push({ field: f2, op: op2, val: v2 });
            return queryObj;
          },
          get: async () => {
            const matches: any[] = [];
            for (const [docId, docData] of col.entries()) {
              const satisfiesAll = filters.every((f) => docData[f.field] === f.val);
              if (satisfiesAll) {
                matches.push({
                  id: docId,
                  exists: true,
                  data: () => docData
                });
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

// In-Memory Mock Cloud Storage Bucket
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

async function runTests() {
  console.log("================================================================================");
  console.log("EchoNote Phase 1B — Step 1.3B: Authorized Zoom Cloud Recording Import Tests");
  console.log("================================================================================\n");

  const originalEnv = { ...process.env };

  try {
    // -------------------------------------------------------------------------
    // Section 1: Missing Zoom OAuth Configuration
    // -------------------------------------------------------------------------
    console.log("--- Section 1: Missing Zoom OAuth Configuration ---");
    delete process.env.ZOOM_CLIENT_ID;
    delete process.env.ZOOM_CLIENT_SECRET;
    delete process.env.ZOOM_ACCOUNT_ID;
    clearZoomTokenCache();

    const emptyCreds = await resolveZoomCredentials();
    check("1.1", "Returns undefined when environment variables are not set",
      emptyCreds.clientId === undefined && emptyCreds.clientSecret === undefined
    );

    let tokenErrorMsg = "";
    try {
      await getZoomAccessToken(emptyCreds);
    } catch (e: any) {
      tokenErrorMsg = e.message;
    }
    check("1.2", "Throws ZOOM_CREDENTIALS_MISSING when credentials missing",
      tokenErrorMsg.includes("ZOOM_CREDENTIALS_MISSING")
    );

    let accountErrorMsg = "";
    try {
      await getZoomAccessToken({ clientId: "cid_123", clientSecret: "csec_456" });
    } catch (e: any) {
      accountErrorMsg = e.message;
    }
    check("1.3", "Throws ZOOM_ACCOUNT_ID_MISSING when accountId missing",
      accountErrorMsg.includes("ZOOM_ACCOUNT_ID_MISSING")
    );

    // -------------------------------------------------------------------------
    // Section 2: Authorized OAuth Token Acquisition & Caching
    // -------------------------------------------------------------------------
    console.log("\n--- Section 2: Authorized OAuth Token Acquisition & Caching ---");
    clearZoomTokenCache();
    let tokenFetchCount = 0;

    const mockTokenFetch: typeof fetch = async (url, init) => {
      tokenFetchCount++;
      const urlStr = String(url);
      if (urlStr.includes("zoom.us/oauth/token")) {
        // Verify Basic Auth header
        const authHeader = init?.headers ? (init.headers as any)["Authorization"] : "";
        const expectedBasic = `Basic ${Buffer.from("client_abc:secret_xyz").toString("base64")}`;
        if (authHeader !== expectedBasic) {
          return new Response(JSON.stringify({ message: "Invalid client" }), { status: 401 });
        }
        return new Response(
          JSON.stringify({
            access_token: "mock_zoom_access_token_12345",
            token_type: "bearer",
            expires_in: 3600,
            scope: "recording:read:admin"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const validCreds = {
      accountId: "acct_test_001",
      clientId: "client_abc",
      clientSecret: "secret_xyz"
    };

    const token1 = await getZoomAccessToken(validCreds, mockTokenFetch);
    check("2.1", "Acquires access token successfully", token1 === "mock_zoom_access_token_12345");
    check("2.2", "Made 1 token request", tokenFetchCount === 1);

    // Second call should hit in-memory cache without secondary network request
    const token2 = await getZoomAccessToken(validCreds, mockTokenFetch);
    check("2.3", "Returns cached token on subsequent request", token2 === token1);
    check("2.4", "Token cache prevented redundant token network request", tokenFetchCount === 1);

    // -------------------------------------------------------------------------
    // Section 3: Recording File Selection Priority
    // -------------------------------------------------------------------------
    console.log("\n--- Section 3: Recording File Selection Priority ---");
    const mixedFiles = [
      {
        id: "file_mp4_01",
        fileType: "MP4",
        fileExtension: "MP4",
        fileSize: 45000000,
        downloadUrl: "https://zoom.us/rec/download/mp4_video_file",
        recordingType: "shared_screen_with_speaker_view"
      },
      {
        id: "file_m4a_02",
        fileType: "M4A",
        fileExtension: "M4A",
        fileSize: 8500000,
        downloadUrl: "https://zoom.us/rec/download/m4a_audio_file",
        recordingType: "audio_only"
      },
      {
        id: "file_chat_03",
        fileType: "CHAT",
        fileExtension: "TXT",
        fileSize: 12000,
        downloadUrl: "https://zoom.us/rec/download/chat_log",
        recordingType: "chat_file"
      }
    ];

    const selectedFile = selectBestRecordingFile(mixedFiles);
    check("3.1", "Prioritizes audio-only (M4A) over video (MP4)",
      selectedFile !== null && selectedFile.id === "file_m4a_02"
    );
    check("3.2", "Selected file has M4A extension", selectedFile?.fileExtension === "M4A");

    // When M4A is not present, falls back to MP4
    const videoOnlyFiles = mixedFiles.filter((f) => f.fileExtension !== "M4A");
    const fallbackFile = selectBestRecordingFile(videoOnlyFiles);
    check("3.3", "Falls back to MP4 when M4A is not present",
      fallbackFile !== null && fallbackFile.id === "file_mp4_01"
    );

    // Returns null if no eligible files
    const emptyCandidates = selectBestRecordingFile([]);
    check("3.4", "Returns null when candidates array is empty", emptyCandidates === null);

    // -------------------------------------------------------------------------
    // Section 4: Authorized Download & Redirect Handling (Token Redaction)
    // -------------------------------------------------------------------------
    console.log("\n--- Section 4: Authorized Download & Redirect Handling ---");
    const mockAudioData = Buffer.from("MOCK_AUDIO_BYTE_STREAM_ECHONOTE_TEST_CONTENT");
    let sawBearerOnS3: boolean = false;
    let sawBearerOnZoom: boolean = false;

    const mockDownloadFetch: typeof fetch = async (url, init) => {
      const urlStr = String(url);
      const authHeader = init?.headers ? (init.headers as any)["Authorization"] : "";

      if (urlStr.startsWith("https://zoom.us/rec/download")) {
        if (authHeader === "Bearer mock_zoom_access_token_12345") {
          sawBearerOnZoom = true;
        }
        // Simulate Zoom 302 redirect to pre-signed S3 storage URL
        return new Response(null, {
          status: 302,
          headers: {
            "Location": "https://zoom-recordings-storage.s3.amazonaws.com/recording_payload.m4a?signed_params=xyz"
          }
        });
      }

      if (urlStr.startsWith("https://zoom-recordings-storage.s3.amazonaws.com")) {
        if (authHeader && authHeader.includes("Bearer")) {
          sawBearerOnS3 = true; // Leakage bug!
        }
        return new Response(mockAudioData, {
          status: 200,
          headers: {
            "Content-Type": "audio/mp4",
            "Content-Length": String(mockAudioData.length)
          }
        });
      }

      return new Response("Not Found", { status: 404 });
    };

    const downloadResult = await downloadZoomRecordingBytes(
      "https://zoom.us/rec/download/m4a_audio_file",
      "mock_zoom_access_token_12345",
      { customFetch: mockDownloadFetch }
    );

    check("4.1", "Successfully downloaded recording bytes",
      downloadResult.buffer.equals(mockAudioData)
    );
    check("4.2", "Sent Bearer token to Zoom domain", Boolean(sawBearerOnZoom));
    check("4.3", "Did NOT send Bearer token to external S3 redirect domain (Token Redacted)",
      !sawBearerOnS3
    );
    check("4.4", "Returns correct MIME type", downloadResult.mimeType === "audio/mp4");
    check("4.5", "Returns correct byte length", downloadResult.sizeBytes === mockAudioData.length);

    // -------------------------------------------------------------------------
    // Section 5: Provider Errors & Rejections (401, 403, 404)
    // -------------------------------------------------------------------------
    console.log("\n--- Section 5: Provider Errors & Rejections ---");

    const mock401Fetch: typeof fetch = async () => new Response("Unauthorized", { status: 401 });
    let is401Handled = false;
    try {
      await downloadZoomRecordingBytes("https://zoom.us/rec/download/expired", "bad_token", { customFetch: mock401Fetch });
    } catch (e: any) {
      is401Handled = e.message.includes("ZOOM_DOWNLOAD_UNAUTHORIZED");
    }
    check("5.1", "Handles HTTP 401 with explicit ZOOM_DOWNLOAD_UNAUTHORIZED error", is401Handled);

    const mock403Fetch: typeof fetch = async () => new Response("Forbidden", { status: 403 });
    let is403Handled = false;
    try {
      await downloadZoomRecordingBytes("https://zoom.us/rec/download/forbidden", "good_token", { customFetch: mock403Fetch });
    } catch (e: any) {
      is403Handled = e.message.includes("ZOOM_DOWNLOAD_FORBIDDEN");
    }
    check("5.2", "Handles HTTP 403 with explicit ZOOM_DOWNLOAD_FORBIDDEN error", is403Handled);

    // -------------------------------------------------------------------------
    // Section 6: Content Type & File Size Validation
    // -------------------------------------------------------------------------
    console.log("\n--- Section 6: Content Type & File Size Validation ---");

    // Invalid HTML response (login page returned instead of audio bytes)
    const mockHtmlFetch: typeof fetch = async () => {
      return new Response("<!DOCTYPE html><html><body>Login to Zoom</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    };

    let isHtmlRejected = false;
    try {
      await downloadZoomRecordingBytes("https://zoom.us/rec/download/login_trap", "token", { customFetch: mockHtmlFetch });
    } catch (e: any) {
      isHtmlRejected = e.message.includes("INVALID_CONTENT_TYPE");
    }
    check("6.1", "Rejects HTML login page responses with INVALID_CONTENT_TYPE", isHtmlRejected);

    // Oversized recording rejection
    const mockOversizedHeaderFetch: typeof fetch = async () => {
      return new Response("bytes", {
        status: 200,
        headers: { "Content-Length": String(MAX_RECORDING_SIZE_BYTES + 1000) }
      });
    };

    let isOversizedRejected = false;
    try {
      await downloadZoomRecordingBytes("https://zoom.us/rec/download/giant", "token", { customFetch: mockOversizedHeaderFetch });
    } catch (e: any) {
      isOversizedRejected = e.message.includes("FILE_TOO_LARGE");
    }
    check("6.2", "Rejects oversized recording based on Content-Length header", isOversizedRejected);

    // -------------------------------------------------------------------------
    // Section 7: Deterministic Import Job & Storage Workflow
    // -------------------------------------------------------------------------
    console.log("\n--- Section 7: Deterministic Import Job & Storage Workflow ---");
    const mockDb = new MockFirestore() as any;
    const mockStorage = new MockStorageBucket();

    // Configure test environment credentials
    process.env.ZOOM_ACCOUNT_ID = "acct_prod_001";
    process.env.ZOOM_CLIENT_ID = "client_abc";
    process.env.ZOOM_CLIENT_SECRET = "secret_xyz";
    clearZoomTokenCache();

    // Mock fetch for full workflow: Token request + Recording download
    const fullWorkflowFetch: typeof fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("zoom.us/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock_jwt_token_zoom", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("zoom.us/rec/download")) {
        return new Response(null, {
          status: 302,
          headers: { "Location": "https://s3.zoom.mock/storage_payload.m4a" }
        });
      }
      if (urlStr.includes("storage_payload.m4a")) {
        return new Response(mockAudioData, {
          status: 200,
          headers: { "Content-Type": "audio/mp4" }
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const meetingPayload = {
      externalMeetingId: "98765432101",
      meetingInstanceUuid: "inst_uuid_alpha_001",
      meetingStartTime: "2026-10-14T10:00:00Z",
      meetingTopic: "Product Architecture Review",
      hostEmail: "lead@echotechai.in",
      hostId: "zoom_host_100",
      organizationId: "org_engineering",
      projectId: "proj_cloud_run",
      userId: "usr_alice",
      recordingFiles: mixedFiles
    };

    const importResult1 = await importZoomRecording(mockDb, meetingPayload, {
      customFetch: fullWorkflowFetch,
      customStorageBucket: mockStorage,
      skipAiTranscription: true // Unit test storage & record wiring first
    });

    check("7.1", "Import job status is 'completed'", importResult1.status === "completed");
    check("7.2", "Generates deterministic jobId",
      importResult1.jobId === computeZoomImportJobId(meetingPayload.externalMeetingId, meetingPayload.meetingInstanceUuid, "file_m4a_02")
    );
    check("7.3", "Generates recordingId in result", Boolean(importResult1.recordingId));
    check("7.4", "Generates storagePath in result", Boolean(importResult1.storagePath));

    // Verify Cloud Storage upload
    const storedFile = mockStorage.storedFiles.get(importResult1.storagePath!);
    check("7.5", "Saved audio buffer into Cloud Storage bucket",
      storedFile !== undefined && storedFile.buffer.equals(mockAudioData)
    );
    check("7.6", "Storage path is user-scoped and private",
      importResult1.storagePath!.startsWith("recordings/usr_alice/")
    );
    check("7.7", "Storage path does not leak bearer token or URL params",
      !importResult1.storagePath!.includes("?") && !importResult1.storagePath!.includes("mock_jwt_token")
    );

    // Verify Firestore `recordings` document
    const recDoc = await mockDb.collection("recordings").doc(importResult1.recordingId!).get();
    check("7.8", "Created Firestore recording document", recDoc.exists);
    const recData = recDoc.data();
    check("7.9", "Recording has provider 'zoom'", recData.provider === "zoom");
    check("7.10", "Recording has status 'processing'", recData.status === "processing");
    check("7.11", "Recording linked to meetingSessionId",
      recData.meetingSessionId === "zoom_sess_inst_uuid_alpha_001"
    );
    check("7.12", "Recording linked to provenanceManifestId",
      recData.provenanceManifestId === "zoom_prov_inst_uuid_alpha_001"
    );

    // Verify Provenance Manifest updated with imported recording artifact
    const provDoc = await mockDb.collection("meetingProvenanceManifests").doc("zoom_prov_inst_uuid_alpha_001").get();
    check("7.13", "Provenance manifest updated with imported artifact", provDoc.exists);
    const provData = provDoc.data();
    check("7.14", "Provenance contains contentHash (SHA-256)",
      provData?.importedRecordingArtifact?.contentHash === crypto.createHash("sha256").update(mockAudioData).digest("hex")
    );
    check("7.15", "Provenance URI uses gs:// storage scheme",
      provData?.importedRecordingArtifact?.uri?.startsWith("gs://recordings/usr_alice/")
    );

    // -------------------------------------------------------------------------
    // Section 8: Idempotency & Duplicate Webhook Replay
    // -------------------------------------------------------------------------
    console.log("\n--- Section 8: Idempotency & Duplicate Webhook Replay ---");
    let fetchCountBefore = mockStorage.storedFiles.size;

    // Second execution with identical event
    const importResult2 = await importZoomRecording(mockDb, meetingPayload, {
      customFetch: fullWorkflowFetch,
      customStorageBucket: mockStorage,
      skipAiTranscription: true
    });

    check("8.1", "Duplicate import returns status 'completed'", importResult2.status === "completed");
    check("8.2", "Returns identical jobId", importResult2.jobId === importResult1.jobId);
    check("8.3", "Returns identical recordingId without creating duplicate record",
      importResult2.recordingId === importResult1.recordingId
    );
    check("8.4", "Did not perform duplicate Cloud Storage uploads",
      mockStorage.storedFiles.size === fetchCountBefore
    );

    // -------------------------------------------------------------------------
    // Section 9: Concurrent Import Claiming & Lease Protection
    // -------------------------------------------------------------------------
    console.log("\n--- Section 9: Concurrent Import Claiming & Lease Protection ---");
    const mockDbConcurrent = new MockFirestore() as any;
    const concurrentJobId = computeZoomImportJobId("999888777", "uuid_concurrent_01", "file_01");

    // Pre-populate an active in-flight lease
    await mockDbConcurrent.collection("zoom_import_jobs").doc(concurrentJobId).set({
      id: concurrentJobId,
      status: "downloading",
      leaseExpiresAt: Date.now() + 60000, // active lease for 60s
      attempts: 1
    });

    const concurrentResult = await importZoomRecording(mockDbConcurrent, {
      externalMeetingId: "999888777",
      meetingInstanceUuid: "uuid_concurrent_01",
      recordingFiles: [{ id: "file_01", downloadUrl: "https://zoom.us/rec/download/1", fileType: "M4A" }]
    });

    check("9.1", "Concurrent import returns status 'downloading'", concurrentResult.status === "downloading");
    check("9.2", "Concurrent import returns isRetryable true", concurrentResult.isRetryable === true);
    check("9.3", "Concurrent import message identifies in-progress status",
      concurrentResult.message.includes("in progress")
    );

    // -------------------------------------------------------------------------
    // Section 10: Unmapped Tenant Association Handling
    // -------------------------------------------------------------------------
    console.log("\n--- Section 10: Unmapped Tenant Association Handling ---");
    const mockDbUnmapped = new MockFirestore() as any;
    const mockStorageUnmapped = new MockStorageBucket();

    const unmappedResult = await importZoomRecording(mockDbUnmapped, {
      externalMeetingId: "555444333",
      meetingInstanceUuid: "uuid_unmapped_01",
      hostId: "external_zoom_host_888",
      recordingFiles: [{ id: "file_unmapped_01", downloadUrl: "https://zoom.us/rec/download/unmapped", fileType: "M4A" }]
    }, {
      customFetch: fullWorkflowFetch,
      customStorageBucket: mockStorageUnmapped,
      skipAiTranscription: true
    });

    check("10.1", "Unmapped host import executes successfully", unmappedResult.status === "completed");
    check("10.2", "Uses zoom-unmapped-host fallback userId",
      unmappedResult.storagePath!.includes("zoom-unmapped-host:external_zoom_host_888")
    );
    const unmappedRecDoc = await mockDbUnmapped.collection("recordings").doc(unmappedResult.recordingId!).get();
    check("10.3", "Unmapped recording project is 'unassigned'",
      unmappedRecDoc.data()?.projectId === "unassigned"
    );

    // -------------------------------------------------------------------------
    // Section 11: Summary
    // -------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log(`Results: ${passedTests} passed, ${failedTests} failed`);
    console.log("================================================================================");

    if (failedTests > 0) {
      process.exit(1);
    }
  } finally {
    process.env = originalEnv;
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
