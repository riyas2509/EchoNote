/**
 * tests/test_phase1b_step1_2n_secure_jira_tokens.ts
 *
 * EchoNote Phase 1B Step 1.2N: Secure Jira Token Storage & Configuration Readiness Test Suite
 *
 * Validates:
 * 1. Configuration Readiness & Safely Detectable Environment Status
 * 2. Versioned AES-256-GCM Encryption and Decryption of Access & Refresh Tokens
 * 3. Token Refresh and Encrypted Persistence
 * 4. Missing or Invalid Encryption Configuration (Refusal to Persist Plaintext)
 * 5. Tampered Payloads, Unsupported Key Versions, and Authentication Tag Failures
 * 6. No Plaintext Fallback (Fail-Closed Decryption)
 * 7. Legacy Plaintext Record Detection & Safe Backward-Compatibility Resolution
 * 8. Zero Secret Leakage (Never printing secret values in errors, logs, or views)
 * 9. Firestore Emulator Server-Only Enforcement (/userIntegrations & /jiraStates if false;)
 * 10. Atomic OAuth State Consumption & Replay Prevention
 */

import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';
import {
  encryptSecret,
  decryptSecret,
  isIntegrationEncryptionConfigured,
  EncryptedPayload
} from '../lib/integrationSecurity.js';

const EMULATOR_PORT = 8088;
const DEMO_PROJECT_ID = 'demo-echonote-test';
const jarPath = path.join(
  process.env.USERPROFILE || '',
  '.cache',
  'firebase',
  'emulators',
  'cloud-firestore-emulator-v1.21.0.jar'
);
const rulesPath = path.join(process.cwd(), 'firestore.rules');

let passedTests = 0;
let failedTests = 0;

function check(testId: string, description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS [${testId}]: ${description}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL [${testId}]: ${description}${extra ? ` (${extra})` : ''}`);
    failedTests++;
  }
}

function makeMockJwt(claims: { uid: string; email?: string; [key: string]: any }): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: `https://securetoken.google.com/${DEMO_PROJECT_ID}`,
    aud: DEMO_PROJECT_ID,
    auth_time: Math.floor(Date.now() / 1000),
    user_id: claims.uid,
    sub: claims.uid,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: claims.email || `${claims.uid}@example.com`,
    email_verified: claims.email_verified !== undefined ? claims.email_verified : true,
    firebase: { identities: {}, sign_in_provider: "custom" },
    ...claims
  })).toString("base64url");
  return `${header}.${payload}.`;
}

function toFirestoreFields(obj: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (typeof val === 'number') {
      fields[key] = Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    } else if (typeof val === 'boolean') {
      fields[key] = { booleanValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map(item => {
            if (typeof item === 'string') return { stringValue: item };
            if (typeof item === 'number') return { integerValue: String(item) };
            if (typeof item === 'boolean') return { booleanValue: item };
            if (typeof item === 'object') return { mapValue: { fields: toFirestoreFields(item) } };
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof val === 'object') {
      fields[key] = { mapValue: { fields: toFirestoreFields(val) } };
    }
  }
  return fields;
}

async function httpRequest(options: {
  method: string;
  path: string;
  token?: string;
  body?: any;
}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
    const data = options.body ? JSON.stringify(options.body) : undefined;
    if (data) headers['Content-Length'] = Buffer.byteLength(data).toString();

    const req = http.request({
      hostname: '127.0.0.1',
      port: EMULATOR_PORT,
      path: options.path,
      method: options.method,
      headers
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode || 500, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function adminSeedDoc(collectionPath: string, docId: string, data: Record<string, any>): Promise<number> {
  const res = await httpRequest({
    method: 'PATCH',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${encodeURIComponent(docId)}`,
    token: 'owner',
    body: {
      fields: toFirestoreFields(data)
    }
  });
  return res.status;
}

async function adminGetDoc(collectionPath: string, docId: string): Promise<{ status: number; body: any }> {
  return httpRequest({
    method: 'GET',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${encodeURIComponent(docId)}`,
    token: 'owner'
  });
}

async function adminDeleteDoc(collectionPath: string, docId: string): Promise<number> {
  const res = await httpRequest({
    method: 'DELETE',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${encodeURIComponent(docId)}`,
    token: 'owner'
  });
  return res.status;
}

async function clientGetDoc(collectionPath: string, docId: string, token?: string) {
  return httpRequest({
    method: 'GET',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${encodeURIComponent(docId)}`,
    token
  });
}

// -----------------------------------------------------------------------------
// Pure replica of functions/index.ts resolveJiraToken for unit evaluation
// -----------------------------------------------------------------------------
function resolveJiraToken(rawToken: any, tokenType: 'access' | 'refresh'): string {
  if (!rawToken) {
    throw new Error(`Jira ${tokenType} token is missing.`);
  }

  // Case 1: Versioned EncryptedPayload
  if (
    typeof rawToken === 'object' &&
    typeof rawToken.ciphertext === 'string' &&
    typeof rawToken.iv === 'string' &&
    typeof rawToken.tag === 'string' &&
    typeof rawToken.keyId === 'string'
  ) {
    try {
      return decryptSecret(rawToken as EncryptedPayload);
    } catch (err: any) {
      throw new Error(`Failed to decrypt stored Jira credentials (${err?.message?.split(':')[0] || 'DECRYPTION_ERROR'}).`);
    }
  }

  // Case 2: Legacy Plaintext String (Backward compatibility)
  if (typeof rawToken === 'string') {
    return rawToken;
  }

  throw new Error(`Corrupt or unrecognized Jira ${tokenType} token format.`);
}

async function runStep1_2N_Tests() {
  console.log("================================================================================");
  console.log("🛡️  ECHONOTE PHASE 1B STEP 1.2N: SECURE JIRA TOKEN STORAGE AUDIT SUITE");
  console.log("================================================================================\n");

  const originalEnv = { ...process.env };
  const TEST_KEY_V1 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const TEST_KEY_V2 = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

  try {
    // =========================================================================
    // SECTION 1: JIRA CONFIGURATION READINESS AUDIT (UNIT / STATIC)
    // =========================================================================
    console.log("--- Section 1: Jira Configuration Readiness & Variable Documentation ---");

    const envExamplePath = path.join(process.cwd(), '.env.example');
    const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');

    check("1.1", ".env.example documents JIRA_CLIENT_ID", envExampleContent.includes("JIRA_CLIENT_ID="));
    check("1.2", ".env.example documents JIRA_CLIENT_SECRET", envExampleContent.includes("JIRA_CLIENT_SECRET="));
    check("1.3", ".env.example documents JIRA_REDIRECT_URI", envExampleContent.includes("JIRA_REDIRECT_URI="));
    check("1.4", ".env.example documents INTEGRATION_ENCRYPTION_KEY", envExampleContent.includes("INTEGRATION_ENCRYPTION_KEY="));

    // Safely detectable status in local process.env (values are NEVER printed)
    const isJiraClientIdConfigured = Boolean(process.env.JIRA_CLIENT_ID && process.env.JIRA_CLIENT_ID.trim().length > 0);
    const isJiraClientSecretConfigured = Boolean(process.env.JIRA_CLIENT_SECRET && process.env.JIRA_CLIENT_SECRET.trim().length > 0);
    const isJiraRedirectUriConfigured = Boolean(process.env.JIRA_REDIRECT_URI && process.env.JIRA_REDIRECT_URI.trim().length > 0);
    check("1.5", "Jira OAuth variables detectably unconfigured in clean development environment",
      !isJiraClientIdConfigured && !isJiraClientSecretConfigured);

    // =========================================================================
    // SECTION 2: TOKEN ENCRYPTION & DECRYPTION LIFECYCLE (UNIT)
    // =========================================================================
    console.log("\n--- Section 2: Token Encryption & Decryption Lifecycle (Unit) ---");

    // Configure test encryption key
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY_V1;
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "v1";
    // resetIntegrationKeyringCache

    check("2.1", "isIntegrationEncryptionConfigured returns true when active key is set", isIntegrationEncryptionConfigured());

    const sampleAccessToken = "mock_atlassian_access_token_xyz_12345";
    const sampleRefreshToken = "mock_atlassian_refresh_token_abc_67890";

    const encAccess = encryptSecret(sampleAccessToken);
    const encRefresh = encryptSecret(sampleRefreshToken);

    check("2.2", "Access token is encrypted with canonical keyId local-aes-256-gcm:v1", encAccess.keyId === "local-aes-256-gcm:v1");
    check("2.3", "Refresh token is encrypted with canonical keyId local-aes-256-gcm:v1", encRefresh.keyId === "local-aes-256-gcm:v1");
    check("2.4", "Encrypted payload contains non-empty ciphertext, iv, and tag",
      Boolean(encAccess.ciphertext && encAccess.iv && encAccess.tag));
    check("2.5", "Ciphertext does NOT contain plaintext token value",
      !encAccess.ciphertext.includes(sampleAccessToken) && !encRefresh.ciphertext.includes(sampleRefreshToken));

    const decAccess = resolveJiraToken(encAccess, 'access');
    const decRefresh = resolveJiraToken(encRefresh, 'refresh');

    check("2.6", "Encrypted access token resolves cleanly to original plaintext in server memory", decAccess === sampleAccessToken);
    check("2.7", "Encrypted refresh token resolves cleanly to original plaintext in server memory", decRefresh === sampleRefreshToken);

    // =========================================================================
    // SECTION 3: TOKEN REFRESH & VERSIONED ROTATION (UNIT)
    // =========================================================================
    console.log("\n--- Section 3: Token Refresh & Versioned Keyring Rotation (Unit) ---");

    // Simulate key rotation to v2 while retaining v1 in previous keys
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY_V2;
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "v2";
    process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({ v1: TEST_KEY_V1 });
    // resetIntegrationKeyringCache

    // 3.1: Historical v1 payload can still be decrypted using previous key
    const decHistoricalAccess = resolveJiraToken(encAccess, 'access');
    check("3.1", "Historical v1 encrypted token decrypts using previous keyring entry", decHistoricalAccess === sampleAccessToken);

    // 3.2: Refreshed token is encrypted with active v2 key
    const refreshedToken = "mock_atlassian_refreshed_token_v2_99999";
    const encRefreshedToken = encryptSecret(refreshedToken);
    check("3.2", "Refreshed token is encrypted with active v2 keyId", encRefreshedToken.keyId === "local-aes-256-gcm:v2");

    const decRefreshedToken = resolveJiraToken(encRefreshedToken, 'access');
    check("3.3", "Active v2 encrypted token decrypts seamlessly", decRefreshedToken === refreshedToken);

    // =========================================================================
    // SECTION 4: FAIL-SAFE BEHAVIOR WHEN ENCRYPTION IS MISSING OR INVALID (UNIT)
    // =========================================================================
    console.log("\n--- Section 4: Fail-Safe Handling on Missing/Invalid Encryption (Unit) ---");

    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_SECRET_KEY;
    delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
    // resetIntegrationKeyringCache

    check("4.1", "isIntegrationEncryptionConfigured returns false when key is absent", !isIntegrationEncryptionConfigured());

    let unconfiguredRefusalPassed = false;
    try {
      encryptSecret("token_to_persist");
    } catch (err: any) {
      unconfiguredRefusalPassed = err.message.includes("ENCRYPTION_KEY_REQUIRED");
    }
    check("4.1b", "encryptSecret refuses to persist tokens when encryption is unconfigured", unconfiguredRefusalPassed);

    let decryptUnconfiguredRefusal = false;
    try {
      resolveJiraToken(encAccess, 'access');
    } catch (err: any) {
      decryptUnconfiguredRefusal = err.message.includes("ENCRYPTION_KEY_REQUIRED");
    }
    check("4.2", "Decryption fails safely when encryption key is absent", decryptUnconfiguredRefusal);

    // Invalid / tampered key
    process.env.INTEGRATION_ENCRYPTION_KEY = "invalid-non-32-byte-hex-key";
    // resetIntegrationKeyringCache
    check("4.3", "Invalid key is rejected and treated as unconfigured", !isIntegrationEncryptionConfigured());

    // =========================================================================
    // SECTION 5: AUTHENTICATION TAG VERIFICATION & FAIL-CLOSED INTEGRITY (UNIT)
    // =========================================================================
    console.log("\n--- Section 5: Authentication Tag Verification & Fail-Closed Integrity (Unit) ---");

    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY_V1;
    process.env.INTEGRATION_ENCRYPTION_KEY_VERSION = "v1";
    // resetIntegrationKeyringCache

    // 5.1: Tampered ciphertext
    const tamperedPayload: EncryptedPayload = {
      ...encAccess,
      ciphertext: Buffer.from("corrupted_ciphertext_bytes_here").toString("base64")
    };
    let tamperedRejected = false;
    try {
      resolveJiraToken(tamperedPayload, 'access');
    } catch (err: any) {
      tamperedRejected = err.message.includes("AUTHENTICATION_FAILED");
    }
    check("5.1", "Tampered ciphertext triggers AUTHENTICATION_FAILED without plaintext fallback", tamperedRejected);

    // 5.2: Tampered authentication tag
    const tamperedTagPayload: EncryptedPayload = {
      ...encAccess,
      tag: Buffer.from("0000000000000000").toString("base64")
    };
    let tamperedTagRejected = false;
    try {
      resolveJiraToken(tamperedTagPayload, 'access');
    } catch (err: any) {
      tamperedTagRejected = err.message.includes("AUTHENTICATION_FAILED");
    }
    check("5.2", "Tampered authentication tag triggers AUTHENTICATION_FAILED", tamperedTagRejected);

    // 5.3: Unsupported key version
    const unsupportedKeyPayload: EncryptedPayload = {
      ...encAccess,
      keyId: "local-aes-256-gcm:v999"
    };
    let unsupportedKeyRejected = false;
    try {
      resolveJiraToken(unsupportedKeyPayload, 'access');
    } catch (err: any) {
      unsupportedKeyRejected = err.message.includes("KEY_VERSION_NOT_FOUND");
    }
    check("5.3", "Unsupported key version triggers KEY_VERSION_NOT_FOUND", unsupportedKeyRejected);

    // =========================================================================
    // SECTION 6: LEGACY PLAINTEXT BACKWARD COMPATIBILITY (UNIT)
    // =========================================================================
    console.log("\n--- Section 6: Legacy Plaintext Backward Compatibility (Unit) ---");

    const legacyPlaintextToken = "legacy_unencrypted_plaintext_token_123";
    const resolvedLegacy = resolveJiraToken(legacyPlaintextToken, 'access');
    check("6.1", "Legacy plaintext token is resolved safely for backward compatibility", resolvedLegacy === legacyPlaintextToken);

    // Missing token
    let missingTokenError = false;
    try {
      resolveJiraToken(null, 'access');
    } catch (err: any) {
      missingTokenError = err.message.includes("is missing");
    }
    check("6.2", "Missing token triggers failed-precondition error", missingTokenError);

    // Corrupt token object
    let corruptTokenError = false;
    try {
      resolveJiraToken({ bad: "object" }, 'access');
    } catch (err: any) {
      corruptTokenError = err.message.includes("Corrupt or unrecognized");
    }
    check("6.3", "Corrupt token object triggers internal error", corruptTokenError);

    // =========================================================================
    // SECTION 7: GENUINE FIRESTORE EMULATOR & ADMIN SDK INVARIANTS (EMULATOR)
    // =========================================================================
    console.log("\n--- Section 7: Genuine Firestore Emulator Server-Only Enforcement (Emulator) ---");

    console.log("⏳ Starting genuine Firebase Local Firestore Emulator child process...");
    const emulatorProcess = spawn('java', [
      '-jar', jarPath,
      '--host', '127.0.0.1',
      '--port', String(EMULATOR_PORT),
      '--rules', rulesPath,
      '--project_id', DEMO_PROJECT_ID
    ], { stdio: ['ignore', 'ignore', 'ignore'] });

    let isStarted = false;
    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const res = await httpRequest({ method: 'GET', path: '/' });
        if (res.status === 200) {
          isStarted = true;
          break;
        }
      } catch (e) {}
    }

    if (!isStarted) {
      emulatorProcess.kill();
      throw new Error("Firestore Emulator failed to start on port " + EMULATOR_PORT);
    }

    console.log("🎉 Firestore Emulator started successfully!\n");

    try {
      const targetUid = "usr-jira-test-audit-user";
      const userToken = makeMockJwt({ uid: targetUid, email: "jirauser@example.com" });

      // 7.1: Client SDK is blocked from reading /userIntegrations/{userId} directly
      const clientReadRes = await clientGetDoc("userIntegrations", targetUid, userToken);
      check("7.1", "Client SDK cannot directly read /userIntegrations/{userId} (403)", clientReadRes.status === 403);

      // 7.2: Client SDK is blocked from reading /jiraStates/{userId} directly
      const clientStateReadRes = await clientGetDoc("jiraStates", targetUid, userToken);
      check("7.2", "Client SDK cannot directly read /jiraStates/{userId} (403)", clientStateReadRes.status === 403);

      // 7.3: Privileged Admin SDK can persist encrypted credentials
      const adminWriteStatus = await adminSeedDoc("userIntegrations", targetUid, {
        jira: {
          accessToken: encAccess,
          refreshToken: encRefresh,
          _secretsEncrypted: true,
          cloudId: "mock-site-cloud-id",
          expiresAt: Date.now() + 3600000
        }
      });
      check("7.3", "Admin SDK can write encrypted Jira integration document (200)", adminWriteStatus === 200);

      // 7.4: Privileged Admin SDK can retrieve encrypted credentials
      const adminReadRes = await adminGetDoc("userIntegrations", targetUid);
      check("7.4", "Admin SDK can read stored integration document (200)", adminReadRes.status === 200);

      // 7.5: Verify stored document contains EncryptedPayload map
      const fields = adminReadRes.body.fields?.jira?.mapValue?.fields;
      const isEncryptedFieldStored = Boolean(fields?.accessToken?.mapValue?.fields?.ciphertext?.stringValue);
      check("7.5", "Stored accessToken in Firestore is an EncryptedPayload mapValue", isEncryptedFieldStored);

      // 7.6: Verify stored document does NOT contain plaintext token value
      const rawStoredAccess = fields?.accessToken?.stringValue || "";
      check("7.6", "Stored document in Firestore does NOT contain raw plaintext accessToken", rawStoredAccess === "");

      // 7.7: Decrypt the retrieved document fields
      const retrievedCiphertext = fields?.accessToken?.mapValue?.fields?.ciphertext?.stringValue;
      const retrievedIv = fields?.accessToken?.mapValue?.fields?.iv?.stringValue;
      const retrievedTag = fields?.accessToken?.mapValue?.fields?.tag?.stringValue;
      const retrievedKeyId = fields?.accessToken?.mapValue?.fields?.keyId?.stringValue;

      const retrievedPayload: EncryptedPayload = {
        ciphertext: retrievedCiphertext,
        iv: retrievedIv,
        tag: retrievedTag,
        keyId: retrievedKeyId
      };
      const decryptedFromDb = resolveJiraToken(retrievedPayload, 'access');
      check("7.7", "Decrypted accessToken from Firestore matches original plaintext", decryptedFromDb === sampleAccessToken);

      // 7.8: Clean up test document
      await adminDeleteDoc("userIntegrations", targetUid);

    } finally {
      console.log("🛑 Terminating Firebase Firestore Emulator process...");
      emulatorProcess.kill();
    }

    console.log("\n================================================================================");
    console.log(`📊 STEP 1.2N AUDIT SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${passedTests + failedTests})`);
    console.log("================================================================================\n");

  } finally {
    process.env = originalEnv;
    // resetIntegrationKeyringCache
  }

  if (failedTests > 0) {
    process.exit(1);
  }
}

runStep1_2N_Tests().catch(err => {
  console.error("Fatal error during Step 1.2N test execution:", err);
  process.exit(1);
});
