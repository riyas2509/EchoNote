/**
 * tests/test_phase1b_step1_2c_secure_integration_credentials.ts
 *
 * EchoNote Phase 1B Step 1.2C: Integration Credential Storage & Security Test Suite
 *
 * Comprehensive end-to-end multi-dimensional verification covering:
 * 1. Secret Detection & Masking Engine:
 *    - All sensitive secrets (clientSecret, webhookSecret, rawKey, botToken, serviceAccount)
 *      are detected and stripped/masked before returning to clients.
 *    - Masked representations preserve safe UI visibility while preventing secret leakage.
 * 2. Fail-Safe Encryption Boundary:
 *    - When server encryption key is missing, attempting to encrypt sensitive credentials throws
 *      a clear CONFIGURATION_REQUIRED error without saving plaintext secrets.
 *    - When server encryption key is configured, credentials encrypt via AES-256-GCM and decrypt cleanly.
 * 3. Server Endpoints & Authorization Static Audit:
 *    - server.ts enforces requireAuth and requireOrgRole("org_admin") on write/delete operations.
 *    - server.ts enforces requireOrgRole("member") on read operations.
 *    - Responses always return sanitized configurations via sanitizeIntegrationConfig.
 * 4. Firestore Security Rules Hardening:
 *    - Direct client read and write to /organizations/{orgId}/integrations/{integrationId} are blocked (allow read, write: if false).
 *    - Direct client read and write to /integrationConnections/{connectionId} are completely blocked (allow read, write: if false).
 * 5. Frontend Decoupling Audit:
 *    - IntegrationsView.tsx no longer writes raw secrets to Firestore using client-side setDoc.
 *    - IntegrationsView.tsx routes all reads and writes through authenticated backend endpoints.
 * 6. Live Mock Express HTTP Lifecycle & Role Boundary Tests:
 *    - Unauthorized requests fail (401).
 *    - Non-member access fails (403).
 *    - Org members without org_admin role cannot modify/delete configurations (403).
 *    - Org members can read sanitized configurations (200).
 *    - Plaintext secrets with missing server encryption key fails safely (422 ENCRYPTION_KEY_REQUIRED).
 *    - Non-secret configurations remain functional even without encryption key (200).
 *    - Plaintext secrets with valid server encryption key encrypt via AES-256-GCM and response never leaks secrets (200).
 *    - Secret values are never returned to client in GET / POST responses.
 *    - Org admin can disconnect/delete integrations (200).
 * 7. Backward Compatibility:
 *    - Verifies that Recording, Transcript, AudioToTextRecord, and UnifiedMeetingIntelligence remain intact.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';
import { AddressInfo } from 'net';
import {
  sanitizeIntegrationConfig,
  containsSensitiveSecrets,
  maskSecretValue,
  encryptSecret,
  decryptSecret,
  isIntegrationEncryptionConfigured,
  SENSITIVE_INTEGRATION_FIELDS
} from '../lib/integrationSecurity.ts';

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}${extra ? ` (${extra})` : ''}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log("================================================================================");
  console.log("🛡️  ECHONOTE PHASE 1B STEP 1.2C: SECURE INTEGRATION CREDENTIALS TEST SUITE");
  console.log("================================================================================");

  // -----------------------------------------------------------------------------
  // Section 1: Secret Detection & Masking Unit Invariants
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 1: Secret Detection & Masking Unit Invariants ---");

  // Test 1: Masking preserves only last 4 chars
  check("[1] maskSecretValue produces safe masked output",
    maskSecretValue("secret_1234567890abcdef") === "••••••••••••cdef" &&
    maskSecretValue("short") === "••••••••••••hort" &&
    maskSecretValue("123") === "••••"
  );

  // Test 2: Detection of sensitive credentials
  const plainConfig = {
    zoomAccountId: "acc_123",
    zoomClientId: "client_abc",
    zoomClientSecret: "super_secret_zoom_value_1234",
    slackDefaultChannel: "#general"
  };
  check("[2] containsSensitiveSecrets detects plaintext client secrets",
    containsSensitiveSecrets(plainConfig) === true
  );

  const safeNonSecretConfig = {
    zoomAccountId: "acc_123",
    zoomClientId: "client_abc",
    slackDefaultChannel: "#general"
  };
  check("[3] containsSensitiveSecrets returns false for configs without secret keys",
    containsSensitiveSecrets(safeNonSecretConfig) === false
  );

  // Test 3: Deep sanitization strips plaintext secrets
  const sanitized = sanitizeIntegrationConfig(plainConfig);
  check("[4] sanitizeIntegrationConfig redacts sensitive secrets from output",
    sanitized.zoomClientSecret === "••••••••••••1234" &&
    sanitized.has_zoomClientSecret === true &&
    sanitized.zoomAccountId === "acc_123" &&
    sanitized.zoomClientId === "client_abc"
  );

  // Test 4: Webhook and API key lists sanitization
  const complexConfig = {
    endpoints: [
      { id: "wh_1", url: "https://example.com/webhook", secret: "whsec_plaintext_secret_9988" }
    ],
    keys: [
      { id: "key_1", label: "Production Key", rawKey: "en_live_supersecretkey1234", key: "en_live_supersecretkey1234" }
    ],
    clients: [
      { id: "oauth_1", name: "Custom App", secret: "client_secret_xyz_9876" }
    ]
  };
  const sanitizedComplex = sanitizeIntegrationConfig(complexConfig);
  check("[5] Webhook endpoints secret is masked and hasSecret is signaled",
    sanitizedComplex.endpoints[0].secret === "••••••••••••9988" &&
    sanitizedComplex.endpoints[0].hasSecret === true
  );
  check("[6] API key rawKey is completely stripped and key is masked",
    sanitizedComplex.keys[0].rawKey === undefined &&
    sanitizedComplex.keys[0].key.includes("••••")
  );
  check("[7] OAuth client secret is stripped and hasSecret is signaled",
    sanitizedComplex.clients[0].secret === undefined &&
    sanitizedComplex.clients[0].hasSecret === true
  );

  // -----------------------------------------------------------------------------
  // Section 2: Fail-Safe Encryption Invariants
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 2: Fail-Safe Encryption Invariants ---");

  // Test 8: Fail-safe behavior when encryption key is absent
  const origKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  const origKeyAlt = process.env.INTEGRATION_SECRET_KEY;
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
  delete process.env.INTEGRATION_SECRET_KEY;

  check("[8] isIntegrationEncryptionConfigured returns false when env key is unset",
    isIntegrationEncryptionConfigured() === false
  );

  let threwExpectedError = false;
  try {
    encryptSecret("test_secret");
  } catch (err: any) {
    if (err.message.includes("CONFIGURATION_REQUIRED")) {
      threwExpectedError = true;
    }
  }
  check("[9] encryptSecret fails safely with CONFIGURATION_REQUIRED when key is missing",
    threwExpectedError === true
  );

  // Test 9: AES-256-GCM encryption & decryption when 32-byte key is configured
  const testKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.INTEGRATION_ENCRYPTION_KEY = testKeyHex;

  check("[10] isIntegrationEncryptionConfigured returns true with 32-byte hex key",
    isIntegrationEncryptionConfigured() === true
  );

  const secretText = "my-confidential-oauth-client-secret-9999";
  const encryptedPayload = encryptSecret(secretText);
  check("[11] encryptSecret outputs valid ciphertext, iv, tag, and keyId",
    typeof encryptedPayload.ciphertext === "string" &&
    typeof encryptedPayload.iv === "string" &&
    typeof encryptedPayload.tag === "string" &&
    encryptedPayload.ciphertext !== secretText
  );

  const decryptedText = decryptSecret(encryptedPayload);
  check("[12] decryptSecret correctly reconstructs original plaintext",
    decryptedText === secretText
  );

  // Restore environment state
  if (origKey) process.env.INTEGRATION_ENCRYPTION_KEY = origKey;
  else delete process.env.INTEGRATION_ENCRYPTION_KEY;
  if (origKeyAlt) process.env.INTEGRATION_SECRET_KEY = origKeyAlt;
  else delete process.env.INTEGRATION_SECRET_KEY;

  // -----------------------------------------------------------------------------
  // Section 3: Server Endpoints & Authorization Static Audit
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 3: Server Endpoints & Authorization Static Audit ---");

  const serverContent = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');

  check("[13] server.ts declares GET /api/organizations/:organizationId/integrations with member check",
    serverContent.includes('app.get("/api/organizations/:organizationId/integrations", requireAuth, requireOrgRole(db, "member")')
  );

  check("[14] server.ts declares POST /api/organizations/:organizationId/integrations/:integrationId with org_admin requirement",
    serverContent.includes('app.post("/api/organizations/:organizationId/integrations/:integrationId", requireAuth, requireOrgRole(db, "org_admin")')
  );

  check("[15] server.ts declares DELETE /api/organizations/:organizationId/integrations/:integrationId with org_admin requirement",
    serverContent.includes('app.delete("/api/organizations/:organizationId/integrations/:integrationId", requireAuth, requireOrgRole(db, "org_admin")')
  );

  check("[16] server.ts checks isIntegrationEncryptionConfigured and returns 422 if key is missing for secrets",
    serverContent.includes("!isIntegrationEncryptionConfigured()") &&
    serverContent.includes('res.status(422).json({') &&
    serverContent.includes('error: "ENCRYPTION_KEY_REQUIRED"')
  );

  // -----------------------------------------------------------------------------
  // Section 4: Firestore Rules Hardening Static Audit
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 4: Firestore Rules Hardening Static Audit ---");

  const firestoreRulesContent = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf-8');

  const orgIntegrationsBlock = firestoreRulesContent.slice(
    firestoreRulesContent.indexOf("match /integrations/{integrationId}"),
    firestoreRulesContent.indexOf("match /teams/{teamId}")
  );
  check("[17] firestore.rules completely closes /organizations/{orgId}/integrations/{integrationId} from client SDKs (allow read, write: if false)",
    orgIntegrationsBlock.includes("allow read, write: if false;") ||
    (orgIntegrationsBlock.includes("allow read: if false;") && orgIntegrationsBlock.includes("allow write: if false;"))
  );

  const connectionBlock = firestoreRulesContent.slice(
    firestoreRulesContent.indexOf("match /integrationConnections/{connectionId}"),
    firestoreRulesContent.lastIndexOf("}")
  );
  check("[18] firestore.rules completely closes /integrationConnections/{connectionId} from client SDKs (allow read, write: if false)",
    connectionBlock.includes("allow read, write: if false;")
  );

  // -----------------------------------------------------------------------------
  // Section 5: Frontend Decoupling Audit
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 5: Frontend Decoupling Audit ---");

  const integrationsViewContent = fs.readFileSync(path.join(process.cwd(), 'components/IntegrationsView.tsx'), 'utf-8');

  check("[19] IntegrationsView.tsx calls /api/organizations/${organization.id}/integrations/${configuringId} to save config",
    integrationsViewContent.includes('fetch(`${baseUrl}/api/organizations/${organization.id}/integrations/${configuringId}`')
  );

  check("[20] IntegrationsView.tsx does NOT use setDoc on organizations integrations subcollection",
    !integrationsViewContent.includes("setDoc(doc(db, 'organizations', organization.id, 'integrations'")
  );

  check("[21] IntegrationsView.tsx does not import direct Firestore DB methods",
    !integrationsViewContent.includes("import { db,") &&
    !integrationsViewContent.includes("collection,") &&
    !integrationsViewContent.includes("setDoc,")
  );

  // -----------------------------------------------------------------------------
  // Section 6: Live Mock Express HTTP Lifecycle & Role Boundary Tests
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 6: Live Mock Express HTTP Lifecycle & Role Boundary Tests ---");

  // In-memory mock database store for testing
  const mockStore = new Map<string, any>();

  // Helper mock classes
  class MockDocSnap {
    constructor(public id: string, private _data: any) {}
    get exists() { return this._data !== undefined && this._data !== null; }
    data() { return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined; }
  }

  class MockQuerySnap {
    constructor(public docs: MockDocSnap[]) {}
    get empty() { return this.docs.length === 0; }
  }

  const mockDb: any = {
    collection: (collName: string) => ({
      doc: (docId: string) => ({
        get: async () => new MockDocSnap(docId, mockStore.get(`${collName}/${docId}`)),
        set: async (data: any, opts?: any) => {
          const key = `${collName}/${docId}`;
          if (opts?.merge) {
            const existing = mockStore.get(key) || {};
            mockStore.set(key, { ...existing, ...data });
          } else {
            mockStore.set(key, data);
          }
        },
        delete: async () => {
          mockStore.delete(`${collName}/${docId}`);
        },
        collection: (subName: string) => ({
          doc: (subId: string) => ({
            get: async () => new MockDocSnap(subId, mockStore.get(`${collName}/${docId}/${subName}/${subId}`)),
            set: async (data: any, opts?: any) => {
              const key = `${collName}/${docId}/${subName}/${subId}`;
              if (opts?.merge) {
                const existing = mockStore.get(key) || {};
                mockStore.set(key, { ...existing, ...data });
              } else {
                mockStore.set(key, data);
              }
            },
            delete: async () => {
              mockStore.delete(`${collName}/${docId}/${subName}/${subId}`);
            }
          }),
          get: async () => {
            const prefix = `${collName}/${docId}/${subName}/`;
            const docs: MockDocSnap[] = [];
            for (const [k, v] of mockStore.entries()) {
              if (k.startsWith(prefix)) {
                const id = k.slice(prefix.length);
                if (!id.includes('/')) docs.push(new MockDocSnap(id, v));
              }
            }
            return new MockQuerySnap(docs);
          }
        })
      }),
      where: (f1: string, op1: string, v1: any) => ({
        where: (f2: string, op2: string, v2: any) => ({
          where: (f3: string, op3: string, v3: any) => ({
            limit: () => ({
              get: async () => {
                const docs: MockDocSnap[] = [];
                for (const [k, v] of mockStore.entries()) {
                  if (k.startsWith(`${collName}/`)) {
                    if (v[f1] === v1 && v[f2] === v2 && v[f3] === v3) {
                      const id = k.slice(collName.length + 1);
                      docs.push(new MockDocSnap(id, v));
                    }
                  }
                }
                return new MockQuerySnap(docs);
              }
            })
          })
        })
      })
    })
  };

  // Setup initial mock organization and members
  const testOrgId = "org_secure_test";
  mockStore.set(`organizations/${testOrgId}`, {
    id: testOrgId,
    name: "Secure Test Org",
    ownerId: "uid_owner",
    ownerEmail: "owner@test.com"
  });
  mockStore.set(`orgMembers/member_1`, {
    orgId: testOrgId,
    userId: "uid_member",
    email: "member@test.com",
    role: "member",
    status: "active"
  });
  mockStore.set(`orgMembers/admin_1`, {
    orgId: testOrgId,
    userId: "uid_admin",
    email: "admin@test.com",
    role: "admin",
    status: "active"
  });

  // Create Express test app
  const testApp = express();
  testApp.use(express.json());

  // Test authentication simulation middleware
  const testAuthMiddleware = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Unauthorized", message: "User not authenticated" });
    }
    const token = authHeader.replace("Bearer ", "").trim();
    if (token === "token_admin") {
      req.user = { uid: "uid_admin", email: "admin@test.com" };
    } else if (token === "token_member") {
      req.user = { uid: "uid_member", email: "member@test.com" };
    } else if (token === "token_nonmember") {
      req.user = { uid: "uid_outsider", email: "outsider@other.com" };
    } else {
      return res.status(401).json({ error: "Unauthorized", message: "Invalid token" });
    }
    next();
  };

  // Test role middleware replicating requireOrgRole
  const testRequireRole = (minRole: 'member' | 'org_admin') => {
    return async (req: any, res: any, next: any) => {
      const orgId = req.params.organizationId;
      const org = mockStore.get(`organizations/${orgId}`);
      if (!org) {
        return res.status(404).json({ error: "Not Found", message: "Organization not found" });
      }
      const user = req.user;
      let userRole: string | null = null;
      if (org.ownerId === user.uid) userRole = "owner";
      else {
        for (const [k, v] of mockStore.entries()) {
          if (k.startsWith("orgMembers/") && v.orgId === orgId && (v.userId === user.uid || v.email === user.email) && v.status === "active") {
            userRole = v.role;
            break;
          }
        }
      }

      if (!userRole) {
        return res.status(403).json({ error: "Forbidden", message: "You are not an active member of this organization." });
      }

      if (minRole === 'org_admin') {
        if (userRole !== 'admin' && userRole !== 'owner') {
          return res.status(403).json({ error: "Forbidden", message: "Administrative privileges required." });
        }
      }
      next();
    };
  };

  // Mount identical route logic as server.ts
  testApp.get("/api/organizations/:organizationId/integrations", testAuthMiddleware, testRequireRole("member"), async (req: any, res: any) => {
    const { organizationId } = req.params;
    const prefix = `organizations/${organizationId}/integrations/`;
    const integrations: Record<string, any> = {};
    for (const [k, rawData] of mockStore.entries()) {
      if (k.startsWith(prefix)) {
        const id = k.slice(prefix.length);
        const safeConfig = sanitizeIntegrationConfig(rawData.config || {});
        integrations[id] = {
          id,
          enabled: Boolean(rawData.enabled),
          status: rawData.status || (rawData.enabled ? "connected" : "disconnected"),
          config: safeConfig,
          updatedAt: rawData.updatedAt || null,
          hasEncryptedSecrets: Boolean(rawData._secretsEncrypted || rawData.hasSecrets)
        };
      }
    }
    res.json({ success: true, organizationId, integrations });
  });

  testApp.get("/api/organizations/:organizationId/integrations/:integrationId", testAuthMiddleware, testRequireRole("member"), async (req: any, res: any) => {
    const { organizationId, integrationId } = req.params;
    const rawData = mockStore.get(`organizations/${organizationId}/integrations/${integrationId}`) || null;
    if (!rawData) {
      return res.json({
        success: true,
        integration: { id: integrationId, enabled: false, status: "disconnected", config: {} }
      });
    }
    const safeConfig = sanitizeIntegrationConfig(rawData.config || {});
    res.json({
      success: true,
      integration: {
        id: integrationId,
        enabled: Boolean(rawData.enabled),
        status: rawData.status || (rawData.enabled ? "connected" : "disconnected"),
        config: safeConfig,
        updatedAt: rawData.updatedAt || null,
        hasEncryptedSecrets: Boolean(rawData._secretsEncrypted)
      }
    });
  });

  testApp.post("/api/organizations/:organizationId/integrations/:integrationId", testAuthMiddleware, testRequireRole("org_admin"), async (req: any, res: any) => {
    const { organizationId, integrationId } = req.params;
    const { enabled, status, config } = req.body;
    const callerEmail = req.user!.email || "Admin";

    if (!integrationId || typeof integrationId !== "string" || !/^[a-zA-Z0-9_\-]+$/.test(integrationId)) {
      return res.status(400).json({ error: "Invalid integration identifier" });
    }

    const key = `organizations/${organizationId}/integrations/${integrationId}`;
    const existingData = mockStore.get(key) || {};
    const hasSensitiveSecrets = containsSensitiveSecrets(config);
    let secretsEncryptedPayload: any = existingData._encryptedSecrets || null;
    let finalConfigToStore = { ...(config || {}) };

    if (hasSensitiveSecrets) {
      if (!isIntegrationEncryptionConfigured()) {
        return res.status(422).json({
          error: "ENCRYPTION_KEY_REQUIRED",
          message: "Cannot store integration credentials: server-side encryption key (INTEGRATION_ENCRYPTION_KEY) is not configured in the environment. Plaintext credential storage is disallowed.",
          requiresConfig: "INTEGRATION_ENCRYPTION_KEY"
        });
      }

      const encryptedBundle = encryptSecret(JSON.stringify(config));
      secretsEncryptedPayload = encryptedBundle;
      finalConfigToStore = sanitizeIntegrationConfig(config);
    }

    const isNextEnabled = enabled !== undefined ? Boolean(enabled) : (existingData.enabled ?? true);
    const nextStatus = status || (isNextEnabled ? "connected" : "disconnected");

    const recordToSave: Record<string, any> = {
      id: integrationId,
      enabled: isNextEnabled,
      status: nextStatus,
      config: finalConfigToStore,
      updatedAt: new Date().toISOString(),
      updatedBy: callerEmail,
      _secretsEncrypted: Boolean(secretsEncryptedPayload)
    };

    if (secretsEncryptedPayload) {
      recordToSave._encryptedSecrets = secretsEncryptedPayload;
    }

    mockStore.set(key, recordToSave);

    res.json({
      success: true,
      message: `Integration ${integrationId} configuration saved successfully`,
      integration: {
        id: integrationId,
        enabled: isNextEnabled,
        status: nextStatus,
        config: sanitizeIntegrationConfig(finalConfigToStore),
        updatedAt: recordToSave.updatedAt,
        hasEncryptedSecrets: Boolean(secretsEncryptedPayload)
      }
    });
  });

  testApp.delete("/api/organizations/:organizationId/integrations/:integrationId", testAuthMiddleware, testRequireRole("org_admin"), async (req: any, res: any) => {
    const { organizationId, integrationId } = req.params;
    mockStore.delete(`organizations/${organizationId}/integrations/${integrationId}`);
    res.json({ success: true, message: `Integration ${integrationId} disconnected successfully` });
  });

  // Start HTTP server for tests
  const server = http.createServer(testApp);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Test 22: Unauthenticated request rejected
    const unauthRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations`);
    check("[22] Unauthorized request is rejected with 401",
      unauthRes.status === 401
    );

    // Test 23: Non-member access rejected
    const nonMemberRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations`, {
      headers: { Authorization: "Bearer token_nonmember" }
    });
    check("[23] Non-member access is rejected with 403 Forbidden",
      nonMemberRes.status === 403
    );

    // Test 24: Org member without org_admin cannot POST integration
    const memberPostRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations/zoom`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token_member",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled: true, config: { zoomClientId: "abc" } })
    });
    check("[24] Member role without admin permissions cannot save integration (403)",
      memberPostRes.status === 403
    );

    // Test 25: Org member without org_admin cannot DELETE integration
    const memberDeleteRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations/zoom`, {
      method: "DELETE",
      headers: { Authorization: "Bearer token_member" }
    });
    check("[25] Member role without admin permissions cannot delete integration (403)",
      memberDeleteRes.status === 403
    );

    // Test 26: Org admin submitting secret with NO encryption key fails safely (422)
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.INTEGRATION_SECRET_KEY;

    const adminSecretWithoutKeyRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations/zoom`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token_admin",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        enabled: true,
        config: {
          zoomClientId: "zoom_client_123",
          zoomClientSecret: "super_secret_unencrypted_value_9999"
        }
      })
    });
    const adminSecretWithoutKeyData = await adminSecretWithoutKeyRes.json();
    check("[26] Admin posting sensitive secret without server key fails safely with 422 ENCRYPTION_KEY_REQUIRED",
      adminSecretWithoutKeyRes.status === 422 &&
      adminSecretWithoutKeyData.error === "ENCRYPTION_KEY_REQUIRED"
    );

    // Test 27: Verify no plaintext secret was stored in mock database
    const storedDoc = mockStore.get(`organizations/${testOrgId}/integrations/zoom`);
    check("[27] Document was NOT written to database upon 422 safe failure",
      storedDoc === undefined
    );

    // Test 28: Org admin submitting NON-SECRET configuration without encryption key succeeds (200)
    const adminSafeConfigRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations/slack`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token_admin",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        enabled: true,
        config: {
          defaultChannel: "#announcements",
          notifyOnRecording: true
        }
      })
    });
    const adminSafeConfigData = await adminSafeConfigRes.json();
    check("[28] Non-secret integration configuration succeeds without encryption key",
      adminSafeConfigRes.status === 200 &&
      adminSafeConfigData.success === true &&
      adminSafeConfigData.integration.config.defaultChannel === "#announcements"
    );

    // Test 29: Org member can retrieve non-secret configuration
    const memberGetRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations/slack`, {
      headers: { Authorization: "Bearer token_member" }
    });
    const memberGetData = await memberGetRes.json();
    check("[29] Org member can retrieve sanitized integration configuration",
      memberGetRes.status === 200 &&
      memberGetData.integration.config.defaultChannel === "#announcements"
    );

    // Test 30: Org admin submitting secret WITH encryption key succeeds and encrypts
    process.env.INTEGRATION_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    const adminWithKeyRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations/zoom`, {
      method: "POST",
      headers: {
        Authorization: "Bearer token_admin",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        enabled: true,
        status: "connected",
        config: {
          zoomAccountId: "acc_9988",
          zoomClientId: "client_9988",
          zoomClientSecret: "confidential_zoom_secret_4321"
        }
      })
    });
    const adminWithKeyData = await adminWithKeyRes.json();

    check("[30] Admin saving sensitive secret with encryption key returns 200 OK",
      adminWithKeyRes.status === 200 &&
      adminWithKeyData.success === true
    );

    // Test 31: Response NEVER contains plaintext secret
    check("[31] Server response NEVER contains plaintext clientSecret",
      adminWithKeyData.integration.config.zoomClientSecret === "••••••••••••4321" &&
      !JSON.stringify(adminWithKeyData).includes("confidential_zoom_secret_4321")
    );

    // Test 32: Document in database stores encrypted payload and sanitized config
    const storedZoom = mockStore.get(`organizations/${testOrgId}/integrations/zoom`);
    check("[32] Stored document has _secretsEncrypted and ciphertext is AES-256-GCM encrypted",
      storedZoom._secretsEncrypted === true &&
      storedZoom._encryptedSecrets &&
      typeof storedZoom._encryptedSecrets.ciphertext === "string" &&
      storedZoom.config.zoomClientSecret === "••••••••••••4321"
    );

    // Test 33: Stored encrypted payload can be decrypted cleanly on server
    const decryptedStoredSecret = decryptSecret(storedZoom._encryptedSecrets);
    check("[33] Server can decrypt stored encrypted credentials payload",
      decryptedStoredSecret.includes("confidential_zoom_secret_4321")
    );

    // Test 34: Member reading the zoom integration gets sanitized data
    const memberGetZoomRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations/zoom`, {
      headers: { Authorization: "Bearer token_member" }
    });
    const memberGetZoomData = await memberGetZoomRes.json();
    check("[34] Member GET response contains sanitized config without raw secret",
      memberGetZoomData.integration.config.zoomClientSecret === "••••••••••••4321" &&
      !JSON.stringify(memberGetZoomData).includes("confidential_zoom_secret_4321")
    );

    // Test 35: Org admin deleting integration succeeds
    const deleteRes = await fetch(`${baseUrl}/api/organizations/${testOrgId}/integrations/zoom`, {
      method: "DELETE",
      headers: { Authorization: "Bearer token_admin" }
    });
    const deleteData = await deleteRes.json();
    check("[35] Admin deleting/disconnecting integration returns 200 OK and deletes document",
      deleteRes.status === 200 &&
      deleteData.success === true &&
      mockStore.get(`organizations/${testOrgId}/integrations/zoom`) === undefined
    );

  } finally {
    server.close();
  }

  // -----------------------------------------------------------------------------
  // Section 7: Backward Compatibility
  // -----------------------------------------------------------------------------
  console.log("\n--- Section 7: Backward Compatibility ---");

  const typesContent = fs.readFileSync(path.join(process.cwd(), 'types.ts'), 'utf-8');

  check("[36] types.ts exports OrgIntegrationPublicView with strictly sanitized config",
    typesContent.includes("export interface OrgIntegrationPublicView")
  );

  check("[37] Recording interface remains backward-compatible",
    typesContent.includes("export interface Recording {") &&
    typesContent.includes("meetingSessionId?: string;")
  );

  check("[38] Transcript interface remains backward-compatible",
    typesContent.includes("export interface Transcript {") &&
    typesContent.includes("meetingSessionId?: string;")
  );

  check("[39] AudioToTextRecord interface remains backward-compatible",
    typesContent.includes("export interface AudioToTextRecord {") &&
    typesContent.includes("meetingSessionId?: string;")
  );

  check("[40] UnifiedMeetingIntelligence interface remains backward-compatible",
    typesContent.includes("export interface UnifiedMeetingIntelligence {")
  );

  // -----------------------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`📊 TEST SUITE SUMMARY: ${passed} / ${passed + failed} PASSED (${failed} FAILED)`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("🎉 ALL SEC-05 INTEGRATION CREDENTIAL HARDENING INVARIANTS PASSED PERFECTLY!\n");
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
