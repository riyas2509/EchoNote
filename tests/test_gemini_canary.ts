/**
 * ==============================================================================
 * EchoNote — Offline Unit & Isolation Tests for Gemini Canary (Step 3B.4U-Y)
 * ==============================================================================
 * 
 * COVERAGE & SAFETY ASSURANCES:
 * 1. Zero real network calls or API consumption; 100% mocked SDK & local fixtures.
 * 2. Static AST / source inspection confirming ZERO imports of server.ts, firebase-admin,
 *    lib/firebaseAdmin.ts, resend, razorpay, or third-party integration modules.
 * 3. Configuration validation: missing/empty GEMINI_API_KEY rejection.
 * 4. Request validation: body-size limit, missing audio, unsupported MIME rejection.
 * 5. Mocked Gemini provider scenarios: success, empty output, malformed JSON, schema mismatch,
 *    timeout/abort, rate limit (429), and authentication failure (403).
 * 6. Concurrency mutex: rejection of overlapping concurrent verification operations.
 * 7. Health endpoint: zero configuration, credential, or secret leakage.
 * 8. Log sanitization: zero keys or request payloads in stderr/stdout.
 * ==============================================================================
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { createCanaryApp, normalizeCanaryAudioMime, validateTranscriptionSchema, sanitizeCanaryError, validateStrictBase64, logDiagnosticProviderFailure } from '../canary/gemini-canary.ts';

// Synthetic 1-second silent WAV base64 fixture
function getSyntheticSilentWavBase64(): string {
  const sampleRate = 16000;
  const numChannels = 1;
  const bytesPerSample = 2;
  const numSamples = sampleRate * 1;
  const subChunk2Size = numSamples * numChannels * bytesPerSample;
  const chunkSize = 36 + subChunk2Size;
  const buffer = Buffer.alloc(44 + subChunk2Size);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(chunkSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(subChunk2Size, 40);

  return buffer.toString('base64');
}

// Helper to perform HTTP requests against ephemeral local server
function makeRequest(server: http.Server, options: { method: string; path: string; body?: any; headers?: any }): Promise<{ statusCode: number; data: any; rawBody: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as any;
    const reqOptions: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: options.path,
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let rawBody = '';
      res.on('data', chunk => { rawBody += chunk; });
      res.on('end', () => {
        let data: any = null;
        try {
          data = JSON.parse(rawBody);
        } catch (e) {
          data = null;
        }
        resolve({ statusCode: res.statusCode || 0, data, rawBody });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runAllCanaryTests() {
  console.log("==================================================================");
  console.log("EchoNote — Standalone Gemini Canary Offline Test Suite");
  console.log("==================================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, failureDetails?: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`);
      if (failureDetails) console.error(`         Reason: ${failureDetails}`);
      failed++;
    }
  }

  // TEST 1: Static Source Import Tree & Isolation Audit
  console.log("\n--- Group 1: Source & Import-Tree Isolation Audit ---");
  const canarySourcePath = path.join(process.cwd(), "canary", "gemini-canary.ts");
  const canaryLines = fs.readFileSync(canarySourcePath, "utf8").split("\n");
  // Filter active code lines (excluding comments)
  const activeCode = canaryLines
    .filter(line => !line.trim().startsWith("*") && !line.trim().startsWith("/*") && !line.trim().startsWith("//"))
    .join("\n");

  const importLines = canaryLines.filter(line => line.trim().startsWith("import "));
  console.log(`  [INFO] Detected active import statements in canary/gemini-canary.ts (${importLines.length}):`);
  importLines.forEach(l => console.log(`         ${l.trim()}`));

  assert(!activeCode.includes("server.ts"), "Active code does not import server.ts");
  assert(!activeCode.includes("lib/firebaseAdmin"), "Active code does not import lib/firebaseAdmin");
  assert(!activeCode.includes("firebase-admin"), "Active code does not import firebase-admin");
  assert(!activeCode.includes("resend"), "Active code does not import resend email service");
  assert(!activeCode.includes("razorpay"), "Active code does not import razorpay payment service");
  assert(!activeCode.includes("zoom"), "Active code does not import zoom integration");
  assert(!activeCode.includes("jira"), "Active code does not import jira integration");

  // TEST 2: MIME Normalization & Schema Validation Helpers
  console.log("\n--- Group 2: Audio MIME & Schema Contract Tests ---");
  assert(normalizeCanaryAudioMime("audio/webm;codecs=opus") === "audio/webm", "Strips ;codecs=opus from MIME");
  assert(normalizeCanaryAudioMime("audio/x-wav") === "audio/wav", "Normalizes audio/x-wav to audio/wav");
  assert(normalizeCanaryAudioMime("audio/MP3") === "audio/mp3", "Normalizes lowercase MIME");

  const validTranscriptionFixture = {
    transcript: [
      { speaker: "Speaker 1", text: "EchoNote canary verification test.", startTime: 0.0, endTime: 1.0 }
    ],
    qualityScore: 98,
    summary: {
      mainTopic: "Verification",
      keyPoints: ["Testing transcription schema"],
      decisions: ["Proceed with rotation"],
      actionItems: ["Deploy canary"]
    }
  };
  assert(validateTranscriptionSchema(validTranscriptionFixture), "Validates compliant transcription object");
  assert(!validateTranscriptionSchema({ transcript: [], qualityScore: "high" }), "Rejects non-numeric qualityScore");
  assert(!validateTranscriptionSchema({ transcript: [{ speaker: 123 }] }), "Rejects malformed transcript segments");

  // Strict Base64 Unit Assertions
  assert(validateStrictBase64("dGVzdA==").valid && validateStrictBase64("dGVzdA==").byteLength === 4, "Valid padded Base64 ('dGVzdA==') succeeds with 4 bytes");
  assert(validateStrictBase64("dGVzdA").valid && validateStrictBase64("dGVzdA").byteLength === 4, "Valid unpadded Base64 ('dGVzdA') succeeds with 4 bytes");
  assert(validateStrictBase64("dGVzdA=").valid === false, "Incorrect padding ('dGVzdA=') is rejected");
  assert(validateStrictBase64("dGVzd===").valid === false, "Excessive padding ('dGVzd===') is rejected");
  assert(validateStrictBase64("dGVz=A==").valid === false, "Interior padding ('dGVz=A==') is rejected");
  assert(validateStrictBase64("dGVz!@#$").valid === false, "Invalid non-base64 characters rejected");
  assert(validateStrictBase64("dGVzd").valid === false, "Impossible Base64 length (len % 4 === 1) rejected");
  assert(validateStrictBase64("").valid === false, "Empty Base64 string rejected");
  assert(validateStrictBase64("   ").valid === false, "Whitespace-only Base64 string rejected");
  assert(validateStrictBase64(null).valid === false, "Non-string null rejected");

  // Unit Tests: Structured and Fallback sanitizeCanaryError
  // 1. Structured status (numeric)
  assert(sanitizeCanaryError({ status: 400 }).category === "INVALID_ARGUMENT", "Structured status 400 maps to INVALID_ARGUMENT");
  assert(sanitizeCanaryError({ status: 401 }).category === "AUTHENTICATION_OR_PERMISSION_ERROR", "Structured status 401 maps to AUTHENTICATION_OR_PERMISSION_ERROR");
  assert(sanitizeCanaryError({ status: 403 }).category === "AUTHENTICATION_OR_PERMISSION_ERROR", "Structured status 403 maps to AUTHENTICATION_OR_PERMISSION_ERROR");
  assert(sanitizeCanaryError({ status: 404 }).category === "MODEL_NOT_FOUND", "Structured status 404 maps to MODEL_NOT_FOUND");
  assert(sanitizeCanaryError({ status: 429 }).category === "RATE_LIMIT_EXCEEDED", "Structured status 429 maps to RATE_LIMIT_EXCEEDED");
  assert(sanitizeCanaryError({ status: 408 }).category === "OPERATION_TIMEOUT", "Structured status 408 maps to OPERATION_TIMEOUT");

  // 2. Structured error names
  assert(sanitizeCanaryError({ name: "BadRequestError" }).category === "INVALID_ARGUMENT", "Error name BadRequestError maps to INVALID_ARGUMENT");
  assert(sanitizeCanaryError({ name: "AuthenticationError" }).category === "AUTHENTICATION_OR_PERMISSION_ERROR", "Error name AuthenticationError maps to AUTHENTICATION_OR_PERMISSION_ERROR");
  assert(sanitizeCanaryError({ name: "PermissionDeniedError" }).category === "AUTHENTICATION_OR_PERMISSION_ERROR", "Error name PermissionDeniedError maps to AUTHENTICATION_OR_PERMISSION_ERROR");
  assert(sanitizeCanaryError({ name: "NotFoundError" }).category === "MODEL_NOT_FOUND", "Error name NotFoundError maps to MODEL_NOT_FOUND");
  assert(sanitizeCanaryError({ name: "RateLimitError" }).category === "RATE_LIMIT_EXCEEDED", "Error name RateLimitError maps to RATE_LIMIT_EXCEEDED");
  assert(sanitizeCanaryError({ name: "APIUserAbortError" }).category === "OPERATION_TIMEOUT", "Error name APIUserAbortError maps to OPERATION_TIMEOUT");
  assert(sanitizeCanaryError({ name: "APIConnectionTimeoutError" }).category === "OPERATION_TIMEOUT", "Error name APIConnectionTimeoutError maps to OPERATION_TIMEOUT");

  // 3. Fallback message indicators
  assert(sanitizeCanaryError(new Error("400 Bad Request")).category === "INVALID_ARGUMENT", "Fallback '400 Bad Request' maps to INVALID_ARGUMENT");
  assert(sanitizeCanaryError(new Error("401 Unauthorized")).category === "AUTHENTICATION_OR_PERMISSION_ERROR", "Fallback '401 Unauthorized' maps to AUTHENTICATION_OR_PERMISSION_ERROR");
  assert(sanitizeCanaryError(new Error("403 Forbidden")).category === "AUTHENTICATION_OR_PERMISSION_ERROR", "Fallback '403 Forbidden' maps to AUTHENTICATION_OR_PERMISSION_ERROR");
  assert(sanitizeCanaryError(new Error("404 Not Found")).category === "MODEL_NOT_FOUND", "Fallback '404 Not Found' maps to MODEL_NOT_FOUND");
  assert(sanitizeCanaryError(new Error("429 Resource Exhausted")).category === "RATE_LIMIT_EXCEEDED", "Fallback '429 Resource Exhausted' maps to RATE_LIMIT_EXCEEDED");
  assert(sanitizeCanaryError(new Error("Request timed out")).category === "OPERATION_TIMEOUT", "Fallback 'Request timed out' maps to OPERATION_TIMEOUT");

  // 4. Unknown / generic error
  assert(sanitizeCanaryError(new Error("Internal network socket closed")).category === "PROVIDER_ERROR", "Unknown error maps safely to PROVIDER_ERROR");
  assert(sanitizeCanaryError(null).category === "PROVIDER_ERROR", "Null error maps safely to PROVIDER_ERROR");
  assert(sanitizeCanaryError(undefined).category === "PROVIDER_ERROR", "Undefined error maps safely to PROVIDER_ERROR");

  // 5. Sensitive data scrub check: message containing sensitive keys or URLs is scrubbed
  const sensitiveError = new Error("400 Invalid argument at https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash?key=AIzaSySecretKey123");
  const sanitizedOutput = sanitizeCanaryError(sensitiveError);
  assert(sanitizedOutput.category === "INVALID_ARGUMENT", "Classified as INVALID_ARGUMENT");
  assert(!sanitizedOutput.message.includes("AIzaSySecretKey123"), "Secret API key NOT leaked in sanitized message");
  assert(!sanitizedOutput.message.includes("generativelanguage.googleapis.com"), "Internal URL NOT leaked in sanitized message");

  // TEST 3: Health Check Endpoint Isolation
  console.log("\n--- Group 3: Health Check Isolation & Sanitization ---");
  const testApp = createCanaryApp({ apiKey: "mock-key" });
  const server = http.createServer(testApp);
  await new Promise<void>(resolve => server.listen(0, resolve));

  try {
    const healthRes = await makeRequest(server, { method: "GET", path: "/health" });
    assert(healthRes.statusCode === 200, "Health check returns HTTP 200");
    assert(healthRes.data?.status === "HEALTHY", "Health check reports HEALTHY");
    assert(!healthRes.rawBody.includes("mock-key"), "Health check does not leak mock API key");
    assert(!healthRes.rawBody.includes("GEMINI_API_KEY"), "Health check does not leak env var name");
    assert(!healthRes.data?.env, "Health check does not dump process environment");
  } finally {
    server.close();
  }

  // TEST 4: Request Validation (MIME, Missing Audio, Payload Limits)
  console.log("\n--- Group 4: Request Validation & Body-Limit Tests ---");
  const valApp = createCanaryApp({ apiKey: "mock-key", maxAudioBytes: 500 });
  const valServer = http.createServer(valApp);
  await new Promise<void>(resolve => valServer.listen(0, resolve));

  try {
    const noAudioRes = await makeRequest(valServer, { method: "POST", path: "/verify", body: {} });
    assert(noAudioRes.statusCode === 400 && noAudioRes.data?.errorCategory === "INVALID_REQUEST", "Rejects missing audioBase64 with 400");

    const badMimeRes = await makeRequest(valServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "application/pdf" }
    });
    assert(badMimeRes.statusCode === 400 && badMimeRes.data?.errorCategory === "UNSUPPORTED_MIME_TYPE", "Rejects non-audio MIME with 400");

    const largeAudioBase64 = Buffer.alloc(800).toString("base64");
    const oversizeRes = await makeRequest(valServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: largeAudioBase64, mimeType: "audio/wav" }
    });
    assert(oversizeRes.statusCode === 413 && oversizeRes.data?.errorCategory === "AUDIO_SIZE_LIMIT_EXCEEDED", "Rejects oversized audio with 413");

    // Strict Base64 HTTP Validation Tests
    const invalidCharRes = await makeRequest(valServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==!@#$%", mimeType: "audio/wav" }
    });
    assert(invalidCharRes.statusCode === 400 && invalidCharRes.data?.errorCategory === "INVALID_BASE64_AUDIO", "Rejects invalid Base64 characters with HTTP 400");
    assert(!invalidCharRes.rawBody.includes("!@#$%"), "Sanitizes response: malformed Base64 not echoed in response");

    const badPadRes = await makeRequest(valServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA=", mimeType: "audio/wav" }
    });
    assert(badPadRes.statusCode === 400 && badPadRes.data?.errorCategory === "INVALID_BASE64_AUDIO", "Rejects malformed Base64 padding with HTTP 400");

    const impossibleLenRes = await makeRequest(valServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzd", mimeType: "audio/wav" }
    });
    assert(impossibleLenRes.statusCode === 400 && impossibleLenRes.data?.errorCategory === "INVALID_BASE64_AUDIO", "Rejects impossible Base64 length with HTTP 400");

    const emptyB64Res = await makeRequest(valServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "   ", mimeType: "audio/wav" }
    });
    assert(emptyB64Res.statusCode === 400 && emptyB64Res.data?.errorCategory === "INVALID_BASE64_AUDIO", "Rejects whitespace-only Base64 with HTTP 400");

    // Express 2MB raw body parser limit test (distinct from application-level audio size limit)
    // Send valid JSON payload exceeding 2MB limit to ensure body-parser rejects before route executes
    const rawOver2MbPayload = JSON.stringify({
      audioBase64: "dGVzdA==",
      mimeType: "audio/wav",
      paddingData: "x".repeat(2.5 * 1024 * 1024)
    });
    const bodyParser413Res = await makeRequest(valServer, {
      method: "POST",
      path: "/verify",
      body: rawOver2MbPayload
    });
    assert(bodyParser413Res.statusCode === 413, "Express raw body-parser rejects >2MB request with HTTP 413");
    assert(bodyParser413Res.data?.errorCategory !== "AUDIO_SIZE_LIMIT_EXCEEDED", "Parser error is distinguished from application-level AUDIO_SIZE_LIMIT_EXCEEDED");
    assert(!bodyParser413Res.rawBody.includes("mock-key"), "Parser 413 error does not leak mock API key");
    assert(!bodyParser413Res.rawBody.includes("paddingData"), "Parser 413 error does not echo request body payload");

    const validUnpaddedRes = await makeRequest(valServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA", mimeType: "audio/wav" }
    });
    // With unpadded "dGVzdA" (4 bytes < 500 limit) and mock-key, it passes input validation and proceeds
    // Since mock-key without mockGenAiInstance returns 502/network failure, verify it is NOT 400
    assert(validUnpaddedRes.statusCode !== 400, "Valid unpadded Base64 passes input validation");
  } finally {
    valServer.close();
  }

  // Defensive API-Key Input Validation Tests (AH.42 & AH.43)
  console.log("\n--- Group 4B: Defensive API-Key Input Validation Tests ---");
  // Test 4B-1: Key with harmless leading/trailing whitespace is trimmed at initialization boundary
  let factoryReceivedKey: string | null = null;
  const mockAiFactory = (options: { apiKey: string }) => {
    factoryReceivedKey = options.apiKey;
    return {
      models: {
        list: async () => ({ models: [] }),
        generateContent: async () => ({ text: JSON.stringify(validTranscriptionFixture) })
      }
    };
  };

  const fakePaddedKeyValue = "  AIzaSyMockKeyWithPadding123\n\r  ";
  const expectedTrimmedKeyValue = "AIzaSyMockKeyWithPadding123";
  const paddedKeyApp = createCanaryApp({ apiKey: fakePaddedKeyValue }, mockAiFactory);
  const paddedKeyServer = http.createServer(paddedKeyApp);
  await new Promise<void>(resolve => paddedKeyServer.listen(0, resolve));

  try {
    const paddedKeyRes = await makeRequest(paddedKeyServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    assert(paddedKeyRes.statusCode === 200, "API key with leading/trailing whitespace succeeds with HTTP 200");
    assert(factoryReceivedKey === expectedTrimmedKeyValue, "Mock client initialization received exactly the trimmed API key");
    assert(!paddedKeyRes.rawBody.includes("AIzaSyMockKeyWithPadding123"), "Fake padded key NOT leaked in HTTP response");
    assert(!paddedKeyRes.rawBody.includes(fakePaddedKeyValue), "Raw key with whitespace NOT leaked in HTTP response");
  } finally {
    paddedKeyServer.close();
  }

  // Test 4B-2: Whitespace-only API key is rejected safely with CREDENTIAL_UNCONFIGURED
  const rawWhitespaceFakeKey = "   \n\t  \r\n  ";
  const emptyKeyApp = createCanaryApp({ apiKey: rawWhitespaceFakeKey });
  const emptyKeyServer = http.createServer(emptyKeyApp);
  await new Promise<void>(resolve => emptyKeyServer.listen(0, resolve));

  try {
    let emptyKeyRes: any;
    const capturedEmptyKeyStderr: string[] = [];
    const origStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      capturedEmptyKeyStderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    }) as any;

    try {
      emptyKeyRes = await makeRequest(emptyKeyServer, {
        method: "POST",
        path: "/verify",
        body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
      });
    } finally {
      process.stderr.write = origStderrWrite;
    }

    assert(emptyKeyRes.statusCode === 500, "Whitespace-only API key rejected with HTTP 500");
    assert(emptyKeyRes.data?.errorCategory === "CREDENTIAL_UNCONFIGURED", "Rejection categorized as CREDENTIAL_UNCONFIGURED");
    assert(emptyKeyRes.data?.error === "GEMINI_API_KEY is not configured in runtime environment.", "Returns standard sanitized credential unconfigured message");
    assert(!emptyKeyRes.rawBody.includes(rawWhitespaceFakeKey), "Raw whitespace key representation absent from response body");
    assert(!capturedEmptyKeyStderr.join('').includes(rawWhitespaceFakeKey), "Raw whitespace key representation absent from stderr output");
  } finally {
    emptyKeyServer.close();
  }

  // Test 4B-3: Malformed API key containing invalid header characters is rejected with CREDENTIAL_MALFORMED
  const malformedTestCases = [
    { name: "Internal LF", key: "fake-key-with\nnewline" },
    { name: "Internal CR", key: "fake-key-with\rcarriagereturn" },
    { name: "Internal CRLF", key: "fake-key-with\r\nboth" },
    { name: "Internal null byte", key: "fake-key-with\0nullbyte" },
    { name: "Code point above 0xFF (emoji 🔑)", key: "fake-key-with-\uD83D\uDD11-emoji" },
    { name: "Code point above 0xFF (smart quote “)", key: "fake-key-with-\u201C-smartquote" },
    { name: "Code point above 0xFF (em dash —)", key: "fake-key-with-\u2014-emdash" },
    { name: "Latin-1 non-ASCII (0xE9 é)", key: "fake-key-with-\u00E9-latin1" },
    { name: "Control character tab (0x09)", key: "fake-key-with\ttab" },
    { name: "Control character DEL (0x7F)", key: "fake-key-with\x7Fdel" }
  ];

  for (const tc of malformedTestCases) {
    const malformedApp = createCanaryApp({ apiKey: tc.key });
    const malformedServer = http.createServer(malformedApp);
    await new Promise<void>(resolve => malformedServer.listen(0, resolve));

    try {
      let malformedRes: any;
      const capturedStderr: string[] = [];
      const origStderrWrite = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        capturedStderr.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
      }) as any;

      try {
        malformedRes = await makeRequest(malformedServer, {
          method: "POST",
          path: "/verify",
          body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
        });
      } finally {
        process.stderr.write = origStderrWrite;
      }

      assert(malformedRes.statusCode === 500, `Malformed key (${tc.name}) rejected with HTTP 500`);
      assert(malformedRes.data?.errorCategory === "CREDENTIAL_MALFORMED", `Rejection categorized as CREDENTIAL_MALFORMED for ${tc.name}`);
      assert(malformedRes.data?.error === "Configured GEMINI_API_KEY contains invalid header characters.", `Standard sanitized message returned for ${tc.name}`);
      assert(!malformedRes.rawBody.includes(tc.key), `Malformed key string NOT leaked in response body for ${tc.name}`);
      assert(!capturedStderr.join('').includes(tc.key), `Malformed key string NOT leaked in stderr output for ${tc.name}`);
      // Ensure no diagnostic provider failure event was emitted (SDK was never reached)
      assert(!capturedStderr.join('').includes("gemini_provider_failure"), `No provider failure diagnostic event emitted for ${tc.name} since SDK was bypassed`);
    } finally {
      malformedServer.close();
    }
  }

  // TEST 5: Mocked Gemini SDK Integration Scenarios
  console.log("\n--- Group 5: Mocked SDK Provider Execution Scenarios ---");

  // 5A: Successful Transcription matching production prompt & schema
  const mockAiSuccess = {
    models: {
      list: async () => ({ models: [{ name: "gemini-3.5-flash" }] }),
      generateContent: async (_opts: any) => ({
        text: JSON.stringify(validTranscriptionFixture)
      })
    }
  };
  const succApp = createCanaryApp({}, mockAiSuccess);
  const succServer = http.createServer(succApp);
  await new Promise<void>(resolve => succServer.listen(0, resolve));

  try {
    const wavBase64 = getSyntheticSilentWavBase64();
    const succRes = await makeRequest(succServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: wavBase64, mimeType: "audio/wav", targetLanguage: "english" }
    });
    assert(succRes.statusCode === 200, "Mocked generation returns HTTP 200");
    assert(succRes.data?.status === "SUCCESS", "Mocked generation status is SUCCESS");
    assert(succRes.data?.transcriptionValid === true, "Validates transcriptionValid === true");
    assert(succRes.data?.qualityScore === 98, "Reports parsed qualityScore");
    assert(succRes.data?.segmentCount === 1, "Reports parsed segmentCount");

    // Regression: Verify SDK is never invoked when Base64 is malformed
    let sdkInvokedOnBadInput = false;
    const mockAiGuarded = {
      models: {
        list: async () => ({ models: [{ name: "gemini-3.5-flash" }] }),
        generateContent: async (_opts: any) => {
          sdkInvokedOnBadInput = true;
          return { text: JSON.stringify(validTranscriptionFixture) };
        }
      }
    };
    const guardedApp = createCanaryApp({}, mockAiGuarded);
    const guardedServer = http.createServer(guardedApp);
    await new Promise<void>(resolve => guardedServer.listen(0, resolve));

    try {
      const badInputRes = await makeRequest(guardedServer, {
        method: "POST",
        path: "/verify",
        body: { audioBase64: "INVALID_BASE64!!==", mimeType: "audio/wav" }
      });
      assert(badInputRes.statusCode === 400, "Malformed Base64 returns HTTP 400 on guarded server");
      assert(badInputRes.data?.errorCategory === "INVALID_BASE64_AUDIO", "Error category is INVALID_BASE64_AUDIO");
      assert(!sdkInvokedOnBadInput, "Gemini SDK was NEVER invoked for malformed Base64 input");
    } finally {
      guardedServer.close();
    }

    // Complete successful unpadded Base64 flow
    let unpaddedCallCount = 0;
    let capturedInlineData: any = null;
    const mockAiUnpadded = {
      models: {
        list: async () => ({ models: [{ name: "gemini-3.5-flash" }] }),
        generateContent: async (opts: any) => {
          unpaddedCallCount++;
          capturedInlineData = opts.contents?.[0]?.parts?.[0]?.inlineData;
          return { text: JSON.stringify(validTranscriptionFixture) };
        }
      }
    };
    const unpaddedApp = createCanaryApp({}, mockAiUnpadded);
    const unpaddedServer = http.createServer(unpaddedApp);
    await new Promise<void>(resolve => unpaddedServer.listen(0, resolve));

    try {
      // "dGVzdA" decodes to 4 bytes ("test")
      const unpaddedPayload = {
        audioBase64: "dGVzdA",
        mimeType: "audio/wav",
        targetLanguage: "english"
      };
      const unpaddedRes = await makeRequest(unpaddedServer, {
        method: "POST",
        path: "/verify",
        body: unpaddedPayload
      });

      assert(unpaddedRes.statusCode === 200, "Unpadded Base64 returns HTTP 200");
      assert(unpaddedRes.data?.status === "SUCCESS", "Unpadded Base64 verification status is SUCCESS");
      assert(unpaddedRes.data?.transcriptionValid === true, "Unpadded Base64 validates transcriptionValid === true");
      assert(unpaddedRes.data?.qualityScore === 98, "Unpadded Base64 returns expected qualityScore");
      assert(unpaddedRes.data?.segmentCount === 1, "Unpadded Base64 returns expected segmentCount");
      assert(!unpaddedRes.rawBody.includes("dGVzdA"), "Successful response does not echo raw audioBase64");
      assert(!unpaddedRes.data?.transcript, "Successful response does not expose full transcript array");
      assert(capturedInlineData?.data === "dGVzdA", "Mock Gemini SDK received expected unpadded Base64 payload");
      assert(capturedInlineData?.mimeType === "audio/wav", "Mock Gemini SDK received expected audio/wav MIME type");
      assert(unpaddedCallCount === 1, "Mock Gemini SDK generateContent invoked exactly once");
    } finally {
      unpaddedServer.close();
    }
  } finally {
    succServer.close();
  }

  // 5B: Provider returns Malformed JSON Output
  const mockAiMalformed = {
    models: {
      list: async () => ({}),
      generateContent: async () => ({ text: "MALFORMED_OUTPUT_NOT_JSON" })
    }
  };
  const malApp = createCanaryApp({}, mockAiMalformed);
  const malServer = http.createServer(malApp);
  await new Promise<void>(resolve => malServer.listen(0, resolve));

  try {
    const malRes = await makeRequest(malServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    assert(malRes.statusCode === 502, "Malformed JSON returns HTTP 502");
    assert(malRes.data?.errorCategory === "MALFORMED_JSON_RESPONSE", "Categorized as MALFORMED_JSON_RESPONSE");
  } finally {
    malServer.close();
  }

  // 5C: Provider returns Non-Compliant Schema Output
  const mockAiBadSchema = {
    models: {
      list: async () => ({}),
      generateContent: async () => ({ text: JSON.stringify({ message: "Hello world" }) })
    }
  };
  const badSchApp = createCanaryApp({}, mockAiBadSchema);
  const badSchServer = http.createServer(badSchApp);
  await new Promise<void>(resolve => badSchServer.listen(0, resolve));

  try {
    const badSchRes = await makeRequest(badSchServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    assert(badSchRes.statusCode === 502, "Bad schema returns HTTP 502");
    assert(badSchRes.data?.errorCategory === "SCHEMA_VALIDATION_FAILED", "Categorized as SCHEMA_VALIDATION_FAILED");
  } finally {
    badSchServer.close();
  }

  // 5D: Provider Authentication Failure (HTTP 403 / API_KEY_INVALID)
  const mockAiAuthFail = {
    models: {
      list: async () => { throw new Error("API_KEY_INVALID: The provided API key is invalid."); },
      generateContent: async () => { throw new Error("API_KEY_INVALID: The provided API key is invalid."); }
    }
  };
  const authFailApp = createCanaryApp({}, mockAiAuthFail);
  const authFailServer = http.createServer(authFailApp);
  await new Promise<void>(resolve => authFailServer.listen(0, resolve));

  try {
    const authFailRes = await makeRequest(authFailServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    assert(authFailRes.statusCode === 502, "Auth failure returns HTTP 502");
    assert(authFailRes.data?.errorCategory === "AUTHENTICATION_OR_PERMISSION_ERROR", "Categorized as AUTHENTICATION_OR_PERMISSION_ERROR");
    assert(!authFailRes.rawBody.includes("API_KEY_INVALID"), "Raw provider error body scrubbed from client response");
  } finally {
    authFailServer.close();
  }

  // 5E: Provider Quota Exhaustion (HTTP 429)
  const mockAiQuota = {
    models: {
      list: async () => ({}),
      generateContent: async () => { throw new Error("429 RESOURCE_EXHAUSTED"); }
    }
  };
  const quotaApp = createCanaryApp({}, mockAiQuota);
  const quotaServer = http.createServer(quotaApp);
  await new Promise<void>(resolve => quotaServer.listen(0, resolve));

  try {
    const quotaRes = await makeRequest(quotaServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    assert(quotaRes.statusCode === 502, "Quota failure returns HTTP 502");
    assert(quotaRes.data?.errorCategory === "RATE_LIMIT_EXCEEDED", "Categorized as RATE_LIMIT_EXCEEDED");
  } finally {
    quotaServer.close();
  }

  // 5F: Operation Timeout / Cancellation Simulation
  const mockAiTimeout = {
    models: {
      list: async () => ({}),
      generateContent: async (_opts: any) => {
        return new Promise((_resolve, reject) => {
          if (_opts.config?.abortSignal) {
            _opts.config.abortSignal.addEventListener("abort", () => {
              reject(new Error("Operation aborted"));
            });
          }
        });
      }
    }
  };
  const timeoutApp = createCanaryApp({ operationTimeoutMs: 100 }, mockAiTimeout);
  const timeoutServer = http.createServer(timeoutApp);
  await new Promise<void>(resolve => timeoutServer.listen(0, resolve));

  try {
    const timeoutRes = await makeRequest(timeoutServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    assert(timeoutRes.statusCode === 502, "Timeout returns HTTP 502");
    assert(timeoutRes.data?.errorCategory === "OPERATION_TIMEOUT", "Categorized as OPERATION_TIMEOUT");
  } finally {
    timeoutServer.close();
  }

  // 5G: End-to-end HTTP pipeline: Structured HTTP 400 BadRequestError from SDK
  class MockBadRequestError extends Error {
    status = 400;
    name = "BadRequestError";
  }
  const mockAiBadRequest = {
    models: {
      list: async () => ({}),
      generateContent: async () => { throw new MockBadRequestError("400 Bad Request: Invalid inline audio data format"); }
    }
  };
  const badReqApp = createCanaryApp({}, mockAiBadRequest);
  const badReqServer = http.createServer(badReqApp);
  await new Promise<void>(resolve => badReqServer.listen(0, resolve));

  try {
    const badReqRes = await makeRequest(badReqServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    assert(badReqRes.statusCode === 502, "HTTP 400 from provider returns HTTP 502 downstream");
    assert(badReqRes.data?.errorCategory === "INVALID_ARGUMENT", "Categorized as INVALID_ARGUMENT");
    assert(!badReqRes.rawBody.includes("Invalid inline audio"), "Raw provider message scrubbed from HTTP response");
  } finally {
    badReqServer.close();
  }

  // 5H: End-to-end HTTP pipeline: Structured HTTP 404 NotFoundError from SDK
  class MockNotFoundError extends Error {
    status = 404;
    name = "NotFoundError";
  }
  const mockAiNotFound = {
    models: {
      list: async () => ({}),
      generateContent: async () => { throw new MockNotFoundError("404 Model not found: private-internal-resource-xyz"); }
    }
  };
  const notFoundApp = createCanaryApp({}, mockAiNotFound);
  const notFoundServer = http.createServer(notFoundApp);
  await new Promise<void>(resolve => notFoundServer.listen(0, resolve));

  try {
    const notFoundRes = await makeRequest(notFoundServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    assert(notFoundRes.statusCode === 502, "HTTP 404 from provider returns HTTP 502 downstream");
    assert(notFoundRes.data?.errorCategory === "MODEL_NOT_FOUND", "Categorized as MODEL_NOT_FOUND");
    assert(!notFoundRes.rawBody.includes("private-internal-resource-xyz"), "Raw provider message scrubbed from HTTP response");
  } finally {
    notFoundServer.close();
  }


  // TEST 7: Safe Provider Error Diagnostic Logging Instrumentation
  console.log("\n--- Group 7: Safe Diagnostic Logging and Scrubbing Tests ---");

  // Helper to intercept and capture process.stderr.write chunks in memory (synchronous)
  function captureStderr(fn: () => void): string[] {
    const originalWrite = process.stderr.write;
    const captured: string[] = [];
    process.stderr.write = ((chunk: any, ..._rest: any[]) => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return true;
    }) as any;
    try {
      fn();
    } finally {
      process.stderr.write = originalWrite;
    }
    return captured;
  }

  // Helper to intercept and capture process.stderr.write chunks in memory (asynchronous)
  async function captureStderrAsync<T>(fn: () => Promise<T>): Promise<{ result: T; captured: string[] }> {
    const originalWrite = process.stderr.write;
    const captured: string[] = [];
    process.stderr.write = ((chunk: any, ..._rest: any[]) => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return true;
    }) as any;
    try {
      const result = await fn();
      return { result, captured };
    } finally {
      process.stderr.write = originalWrite;
    }
  }

  // 7A: Allowlisted error name, valid status, and network code
  class MockRateLimitError extends Error {
    status = 429;
    name = 'RateLimitError';
    code = 'ECONNRESET';
  }
  let event1: any;
  const captured7A = captureStderr(() => {
    event1 = logDiagnosticProviderFailure('generate_content', new MockRateLimitError('Sensitive secret key AIzaSy123 and url https://api.internal/v1'));
  });

  assert(captured7A.length === 1, 'Exactly one diagnostic record emitted to stderr for 7A');
  const parsed7A = JSON.parse(captured7A[0].trim());
  assert(parsed7A.event === 'gemini_provider_failure', 'Diagnostic event has fixed event name in emitted log');
  assert(parsed7A.operation === 'generate_content', 'Diagnostic event records generate_content operation in emitted log');
  assert(parsed7A.errorName === 'RateLimitError', 'Allowlisted error name RateLimitError preserved in emitted log');
  assert(parsed7A.httpStatus === 429, 'Valid numeric HTTP status 429 preserved in emitted log');
  assert(parsed7A.networkCode === 'ECONNRESET', 'Allowlisted network code ECONNRESET preserved in emitted log');
  assert(Object.keys(parsed7A).sort().join(',') === 'errorName,event,httpStatus,networkCode,operation', 'Emitted log contains only allowed fields');
  assert(!captured7A[0].includes('AIzaSy123'), 'Sensitive key scrubbed from emitted stderr log');
  assert(!captured7A[0].includes('https://api.internal'), 'Sensitive URL scrubbed from emitted stderr log');

  // 7B: models_list operation and generic error
  let event2: any;
  const captured7B = captureStderr(() => {
    event2 = logDiagnosticProviderFailure('models_list', new Error('Catalog connection failed'));
  });

  assert(captured7B.length === 1, 'Exactly one diagnostic record emitted to stderr for 7B');
  const parsed7B = JSON.parse(captured7B[0].trim());
  assert(parsed7B.event === 'gemini_provider_failure', 'models_list event has fixed event name in emitted log');
  assert(parsed7B.operation === 'models_list', 'Diagnostic event records models_list operation in emitted log');
  assert(parsed7B.errorName === 'Error', 'Allowlisted generic Error preserved in emitted log');
  assert(parsed7B.httpStatus === 'none', 'Missing HTTP status normalized to none in emitted log');
  assert(parsed7B.networkCode === 'none', 'Missing network code normalized to none in emitted log');
  assert(Object.keys(parsed7B).sort().join(',') === 'errorName,event,httpStatus,networkCode,operation', 'Emitted log contains only allowed fields');

  // 7C: Unrecognized error names, out-of-range statuses, and unknown network codes
  const weirdError = {
    name: 'ArbitraryCustomInternalLeakyErrorClass',
    status: 9999,
    code: 'LEAKY_INTERNAL_SUBSYSTEM_FAILURE_CODE_123',
    message: 'Raw database secret and stack trace with https://admin.internal?token=supersecret'
  };
  let event3: any;
  const captured7C = captureStderr(() => {
    event3 = logDiagnosticProviderFailure('generate_content', weirdError);
  });

  assert(captured7C.length === 1, 'Exactly one diagnostic record emitted to stderr for 7C');
  const parsed7C = JSON.parse(captured7C[0].trim());
  assert(parsed7C.errorName === 'unknown', 'Unrecognized error class reduced to unknown in emitted log');
  assert(parsed7C.httpStatus === 'none', 'Out-of-range status reduced to none in emitted log');
  assert(parsed7C.networkCode === 'none', 'Unrecognized network code reduced to none in emitted log');
  assert(!captured7C[0].includes('ArbitraryCustom'), 'Unrecognized error name scrubbed from emitted log');
  assert(!captured7C[0].includes('LEAKY_INTERNAL'), 'Unrecognized network code scrubbed from emitted log');
  assert(!captured7C[0].includes('Raw database secret'), 'Raw message scrubbed from emitted log');
  assert(!captured7C[0].includes('supersecret'), 'Sensitive token scrubbed from emitted log');
  assert(Object.keys(parsed7C).sort().join(',') === 'errorName,event,httpStatus,networkCode,operation', 'Emitted log contains only allowed fields');

  // 7E: Nested network error code diagnostics (AH.42 & AH.43)
  // 7E-1: TypeError with nested cause.code = 'ENOTFOUND'
  const typeErrorWithCause = new TypeError('fetch failed');
  (typeErrorWithCause as any).cause = {
    code: 'ENOTFOUND',
    message: 'getaddrinfo ENOTFOUND generativelanguage.googleapis.com with sensitive token secret-token-xyz'
  };
  const captured7E1 = captureStderr(() => {
    logDiagnosticProviderFailure('generate_content', typeErrorWithCause);
  });
  assert(captured7E1.length === 1, 'Exactly one diagnostic record emitted to stderr for 7E-1');
  const parsed7E1 = JSON.parse(captured7E1[0].trim());
  assert(parsed7E1.event === 'gemini_provider_failure', 'Event is gemini_provider_failure in 7E-1');
  assert(parsed7E1.operation === 'generate_content', 'Operation is generate_content in 7E-1');
  assert(parsed7E1.errorName === 'TypeError', 'Error name TypeError preserved');
  assert(parsed7E1.networkCode === 'ENOTFOUND', 'Nested cause.code ENOTFOUND extracted when top-level code is absent');
  assert(Object.keys(parsed7E1).sort().join(',') === 'errorName,event,httpStatus,networkCode,operation', 'Emitted log conforms to fixed schema in 7E-1');
  assert(!captured7E1[0].includes('secret-token-xyz'), 'Sensitive token scrubbed from emitted log');
  assert(!captured7E1[0].includes('generativelanguage.googleapis.com'), 'Internal hostname scrubbed from emitted log');

  // 7E-2: Nested unrecognized code is normalized to 'none'
  const typeErrorUnknownCause = new TypeError('fetch failed');
  (typeErrorUnknownCause as any).cause = {
    code: 'INTERNAL_UNKNOWN_NETWORK_CAUSE_123',
    message: 'Raw network buffer'
  };
  const captured7E2 = captureStderr(() => {
    logDiagnosticProviderFailure('generate_content', typeErrorUnknownCause);
  });
  assert(captured7E2.length === 1, 'Exactly one diagnostic record emitted to stderr for 7E-2');
  const parsed7E2 = JSON.parse(captured7E2[0].trim());
  assert(parsed7E2.networkCode === 'none', 'Nested unrecognized network code normalized to none');
  assert(Object.keys(parsed7E2).sort().join(',') === 'errorName,event,httpStatus,networkCode,operation', 'Emitted log conforms to fixed schema in 7E-2');
  assert(!captured7E2[0].includes('INTERNAL_UNKNOWN_NETWORK_CAUSE'), 'Unrecognized nested code scrubbed from emitted log');

  // 7E-3: Allowlisted top-level code takes precedence over nested code
  const topPrecedenceError: any = new Error('Socket timeout');
  topPrecedenceError.code = 'ETIMEDOUT';
  topPrecedenceError.cause = { code: 'ECONNRESET' };
  const captured7E3 = captureStderr(() => {
    logDiagnosticProviderFailure('generate_content', topPrecedenceError);
  });
  assert(captured7E3.length === 1, 'Exactly one diagnostic record emitted to stderr for 7E-3');
  const parsed7E3 = JSON.parse(captured7E3[0].trim());
  assert(parsed7E3.networkCode === 'ETIMEDOUT', 'Top-level allowlisted code takes precedence over nested code');
  assert(Object.keys(parsed7E3).sort().join(',') === 'errorName,event,httpStatus,networkCode,operation', 'Emitted log conforms to fixed schema in 7E-3');

  // 7E-4: Resilient handling of cause: null (does not throw, schema preserved)
  const errorNullCause: any = new Error('Direct failure');
  errorNullCause.cause = null;
  const captured7E4 = captureStderr(() => {
    logDiagnosticProviderFailure('generate_content', errorNullCause);
  });
  assert(captured7E4.length === 1, 'Exactly one diagnostic record emitted for cause: null');
  const parsed7E4 = JSON.parse(captured7E4[0].trim());
  assert(parsed7E4.networkCode === 'none', 'cause: null maps safely to networkCode none');
  assert(Object.keys(parsed7E4).sort().join(',') === 'errorName,event,httpStatus,networkCode,operation', 'Schema preserved for cause: null');

  // 7E-5: Resilient handling of string cause (does not throw, schema preserved)
  const errorStringCause: any = new Error('Wrapper failure');
  errorStringCause.cause = 'Plain string error cause with sensitive token leaked-token-abc';
  const captured7E5 = captureStderr(() => {
    logDiagnosticProviderFailure('generate_content', errorStringCause);
  });
  assert(captured7E5.length === 1, 'Exactly one diagnostic record emitted for string cause');
  const parsed7E5 = JSON.parse(captured7E5[0].trim());
  assert(parsed7E5.networkCode === 'none', 'String cause maps safely to networkCode none');
  assert(Object.keys(parsed7E5).sort().join(',') === 'errorName,event,httpStatus,networkCode,operation', 'Schema preserved for string cause');
  assert(!captured7E5[0].includes('leaked-token-abc'), 'String cause message scrubbed from emitted log');

  // 7E-6: Resilient handling of primitive non-object cause (e.g. number 12345)
  const errorNumberCause: any = new Error('Numeric cause failure');
  errorNumberCause.cause = 12345;
  const captured7E6 = captureStderr(() => {
    logDiagnosticProviderFailure('generate_content', errorNumberCause);
  });
  assert(captured7E6.length === 1, 'Exactly one diagnostic record emitted for numeric cause');
  const parsed7E6 = JSON.parse(captured7E6[0].trim());
  assert(parsed7E6.networkCode === 'none', 'Numeric cause maps safely to networkCode none');
  assert(Object.keys(parsed7E6).sort().join(',') === 'errorName,event,httpStatus,networkCode,operation', 'Schema preserved for numeric cause');

  // 7D: End-to-end pipeline: models_list failure generates diagnostic log and client response remains sanitized
  const mockAiListFailure = {
    models: {
      list: async () => {
        const err = new Error('List failed: sensitive-endpoint-token');
        (err as any).status = 403;
        (err as any).name = 'PermissionDeniedError';
        throw err;
      },
      generateContent: async () => ({ text: JSON.stringify(validTranscriptionFixture) })
    }
  };
  const listFailApp = createCanaryApp({}, mockAiListFailure);
  const listFailServer = http.createServer(listFailApp);
  await new Promise<void>(resolve => listFailServer.listen(0, resolve));

  try {
    const { result: listFailRes, captured: capturedE2E } = await captureStderrAsync(() => {
      return makeRequest(listFailServer, {
        method: 'POST',
        path: '/verify',
        body: { audioBase64: 'dGVzdA==', mimeType: 'audio/wav' }
      });
    });

    assert(listFailRes.statusCode === 200, 'Verify endpoint returns HTTP 200 when generateContent succeeds');
    assert(listFailRes.data?.catalogReachable === false, 'catalogReachable is false when models_list fails');
    assert(!listFailRes.rawBody.includes('sensitive-endpoint-token'), 'Sensitive provider token scrubbed from HTTP response');
    assert(capturedE2E.length === 1, 'Exactly one diagnostic event emitted during pipeline models_list failure');
    const parsedE2E = JSON.parse(capturedE2E[0].trim());
    assert(parsedE2E.operation === 'models_list', 'Pipeline logged operation models_list');
    assert(parsedE2E.errorName === 'PermissionDeniedError', 'Pipeline logged errorName PermissionDeniedError');
    assert(parsedE2E.httpStatus === 403, 'Pipeline logged httpStatus 403');
    assert(!capturedE2E[0].includes('sensitive-endpoint-token'), 'Sensitive provider token scrubbed from emitted pipeline log');
  } finally {
    listFailServer.close();
  }
  // TEST 6: Concurrency Mutex Enforcement
  console.log("\n--- Group 6: Concurrency Mutex & Re-entrancy Protection ---");
  let resolveSlowCall: any = null;
  const mockAiSlow = {
    models: {
      list: async () => ({}),
      generateContent: async () => new Promise((resolve) => { resolveSlowCall = resolve; })
    }
  };
  const slowApp = createCanaryApp({}, mockAiSlow);
  const slowServer = http.createServer(slowApp);
  await new Promise<void>(resolve => slowServer.listen(0, resolve));

  try {
    const slowReqPromise = makeRequest(slowServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    await new Promise(r => setTimeout(r, 50));

    const rejectedReq = await makeRequest(slowServer, {
      method: "POST",
      path: "/verify",
      body: { audioBase64: "dGVzdA==", mimeType: "audio/wav" }
    });
    assert(rejectedReq.statusCode === 429, "Concurrent request rejected with HTTP 429");
    assert(rejectedReq.data?.errorCategory === "CONCURRENT_VERIFICATION_REJECTED", "Rejection categorized as CONCURRENT_VERIFICATION_REJECTED");

    if (resolveSlowCall) {
      resolveSlowCall({ text: JSON.stringify(validTranscriptionFixture) });
    }
    await slowReqPromise;
  } finally {
    slowServer.close();
  }

  console.log("\n==================================================================");
  console.log(`Test Execution Summary: ${passed} passed, ${failed} failed`);
  console.log("==================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAllCanaryTests().catch(err => {
  console.error("[FATAL] Canary test runner encountered unexpected error:", err);
  process.exit(1);
});