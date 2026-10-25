/**
 * tests/test_phase1b_step1_2j_final_authorization_audit.ts
 *
 * EchoNote Phase 1B Step 1.2J: Final Authorization Edge-Case Audit Suite
 *
 * Evaluates the actual firestore.rules against the genuine Firebase Local Firestore Emulator:
 * - Part 1: Platform-Admin Edge Cases (authoritative user records vs claims, revocation, disabled, unverified)
 * - Part 2: Organization Ownership & Tenant Isolation (ownership transfer, unverified owner email, cross-org admin)
 * - Part 3: Project Tenant Isolation & Malformed Identifiers
 */

import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';

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

let passed = 0;
let failed = 0;
let skipped = 0;
const results: Array<{ testId: string; description: string; passed: boolean; details?: string }> = [];

function check(testId: string, description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS [${testId}]: ${description}`);
    passed++;
    results.push({ testId, description, passed: true });
  } else {
    console.error(`  ❌ FAIL [${testId}]: ${description}${extra ? ` (${extra})` : ''}`);
    failed++;
    results.push({ testId, description, passed: false, details: extra });
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

async function clientGetDoc(collectionPath: string, docId: string, token?: string) {
  return httpRequest({
    method: 'GET',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${encodeURIComponent(docId)}`,
    token
  });
}

async function clientCreateDoc(collectionPath: string, docId: string, data: Record<string, any>, token?: string) {
  return httpRequest({
    method: 'POST',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}?documentId=${encodeURIComponent(docId)}`,
    token,
    body: {
      fields: toFirestoreFields(data)
    }
  });
}

async function clientDeleteDoc(collectionPath: string, docId: string, token?: string) {
  return httpRequest({
    method: 'DELETE',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${encodeURIComponent(docId)}`,
    token
  });
}

async function runAuditSuite() {
  console.log("================================================================================");
  console.log("🛡️  ECHONOTE PHASE 1B STEP 1.2J: FINAL AUTHORIZATION EDGE-CASE AUDIT");
  console.log("================================================================================");

  if (!fs.existsSync(jarPath)) {
    console.error(`❌ Prerequisite missing: Emulator JAR not found at ${jarPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(rulesPath)) {
    console.error(`❌ Prerequisite missing: firestore.rules not found at ${rulesPath}`);
    process.exit(1);
  }

  console.log(`[Config] Emulator JAR:     ${jarPath}`);
  console.log(`[Config] Rules File:       ${rulesPath}`);
  console.log(`[Config] Isolated Project: ${DEMO_PROJECT_ID}`);
  console.log(`[Config] Host and Port:    127.0.0.1:${EMULATOR_PORT}\n`);

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
    throw new Error("Firestore Emulator failed to start or listen on port " + EMULATOR_PORT);
  }

  console.log("🎉 Firestore Emulator successfully started and loaded firestore.rules!\n");

  try {
    // -------------------------------------------------------------------------
    // BASELINE SEEDING
    // -------------------------------------------------------------------------
    console.log("--- Seeding Base Fixtures via Emulator Admin ---");

    // Standard user (victim/target for unauthorized reads)
    await adminSeedDoc("users", "usr-target-regular", {
      id: "usr-target-regular",
      email: "regular@target.com",
      role: "user"
    });

    // Legitimate platform admin user doc
    await adminSeedDoc("users", "usr-legit-admin", {
      id: "usr-legit-admin",
      email: "superadmin@echonote.com",
      role: "admin",
      accountStatus: "active",
      disabled: false
    });

    // Revoked platform admin user doc (was admin, now 'user')
    await adminSeedDoc("users", "usr-revoked-admin", {
      id: "usr-revoked-admin",
      email: "exadmin@echonote.com",
      role: "user",
      accountStatus: "active"
    });

    // Disabled platform admin user doc
    await adminSeedDoc("users", "usr-disabled-admin", {
      id: "usr-disabled-admin",
      email: "disabledadmin@echonote.com",
      role: "admin",
      disabled: true
    });

    // Closed platform admin user doc
    await adminSeedDoc("users", "usr-closed-admin", {
      id: "usr-closed-admin",
      email: "closedadmin@echonote.com",
      role: "admin",
      accountStatus: "closed"
    });

    // Valid organization owner profile (regular user role)
    await adminSeedDoc("users", "usr-alpha-owner-valid", {
      id: "usr-alpha-owner-valid",
      email: "owner@alphaaudit.com",
      role: "user",
      accountStatus: "active"
    });

    // Valid org admin profile (regular user role, no platform admin)
    await adminSeedDoc("users", "usr-org-admin-only", {
      id: "usr-org-admin-only",
      email: "orgadmin@alphaaudit.com",
      role: "user",
      accountStatus: "active"
    });

    // Organization Alpha
    await adminSeedDoc("organizations", "org-alpha-audit", {
      id: "org-alpha-audit",
      name: "Alpha Corp Audit",
      ownerId: "usr-alpha-owner-valid",
      ownerEmail: "owner@alphaaudit.com"
    });
    await adminSeedDoc("organizations/org-alpha-audit/auditLogs", "log-alpha-audit-1", {
      id: "log-alpha-audit-1",
      action: "CONFIDENTIAL_AUDIT_DATA",
      timestamp: new Date().toISOString()
    });

    // Organization Beta
    await adminSeedDoc("organizations", "org-beta-audit", {
      id: "org-beta-audit",
      name: "Beta Industries Audit",
      ownerId: "usr-beta-owner-valid",
      ownerEmail: "owner@betaaudit.com"
    });
    await adminSeedDoc("organizations/org-beta-audit/auditLogs", "log-beta-audit-1", {
      id: "log-beta-audit-1",
      action: "CONFIDENTIAL_BETA_DATA",
      timestamp: new Date().toISOString()
    });

    // Project in Org Alpha
    await adminSeedDoc("projects", "proj-alpha-test", {
      id: "proj-alpha-test",
      name: "Project Alpha Test",
      userId: "usr-alpha-owner-valid",
      organizationId: "org-alpha-audit"
    });

    // Provenance manifest (only platform admin can delete)
    await adminSeedDoc("meetingProvenanceManifests", "man-audit-protected-1", {
      manifestId: "man-audit-protected-1",
      userId: "usr-alpha-owner-valid",
      projectId: "proj-alpha-test",
      organizationId: "org-alpha-audit",
      provider: "zoom",
      captureMode: "recording",
      schemaVersion: "1.0"
    });

    console.log("  Fixtures seeded.\n");

    // =========================================================================
    // SECTION 1: PLATFORM-ADMIN AUTHORIZATION EDGE CASES
    // =========================================================================
    console.log("--- Section 1: Platform-Admin Edge Cases (Scenarios 1-8) ---");

    // Scenario 1: Valid platform admin with all required authoritative records and claims
    const legitAdminToken = makeMockJwt({
      uid: "usr-legit-admin",
      role: "admin",
      platform_admin: true,
      email_verified: true
    });
    const resScenario1 = await clientGetDoc("users", "usr-target-regular", legitAdminToken);
    check("1.1", "Valid platform admin with required records & claims can read target user profile (200)",
      resScenario1.status === 200,
      `Status: ${resScenario1.status}`
    );

    // Scenario 2: Token claiming platform-admin privileges when authoritative user record does NOT grant them
    // (User doc has role: 'user', but token claims role: 'admin', platform_admin: true)
    const spoofedAdminToken = makeMockJwt({
      uid: "usr-target-regular", // Document has role: 'user'
      role: "admin",
      platform_admin: true,
      email_verified: true
    });
    const resScenario2 = await clientGetDoc("organizations/org-alpha-audit/auditLogs", "log-alpha-audit-1", spoofedAdminToken);
    console.log(`  [Diagnostic 1.2] Token claiming platform_admin when /users/{uid}.role == 'user' -> Status ${resScenario2.status}`);
    check("1.2", "Token claiming platform-admin when user doc has role 'user' is rejected (403)",
      resScenario2.status === 403,
      `Observed status: ${resScenario2.status}`
    );

    // Scenario 3: Platform-admin role revoked in Firestore while user retains unexpired token with old claim
    const revokedAdminToken = makeMockJwt({
      uid: "usr-revoked-admin", // Document has role: 'user'
      role: "admin",
      platform_admin: true,
      email_verified: true
    });
    const resScenario3 = await clientGetDoc("organizations/org-alpha-audit/auditLogs", "log-alpha-audit-1", revokedAdminToken);
    console.log(`  [Diagnostic 1.3] Revoked admin with stale unexpired token -> Status ${resScenario3.status}`);
    check("1.3", "Platform-admin role revoked in user doc is immediately rejected even with unexpired token (403)",
      resScenario3.status === 403,
      `Observed status: ${resScenario3.status}`
    );

    // Scenario 4: Missing or malformed claims, but authoritative user record has role: 'admin'
    const missingClaimsAdminToken = makeMockJwt({
      uid: "usr-legit-admin",
      // role and platform_admin omitted entirely
      email_verified: true
    });
    const resScenario4 = await clientGetDoc("organizations/org-alpha-audit/auditLogs", "log-alpha-audit-1", missingClaimsAdminToken);
    check("1.4", "Platform admin with missing token claims can access via authoritative user record fallback (200)",
      resScenario4.status === 200,
      `Observed status: ${resScenario4.status}`
    );

    // Scenario 5: Unverified email where email verification is required
    const unverifiedAdminToken = makeMockJwt({
      uid: "usr-legit-admin",
      role: "admin",
      platform_admin: true,
      email_verified: false // Unverified!
    });
    const resScenario5 = await clientGetDoc("organizations/org-alpha-audit/auditLogs", "log-alpha-audit-1", unverifiedAdminToken);
    check("1.5", "Platform admin with unverified email (email_verified: false) is strictly rejected (403)",
      resScenario5.status === 403,
      `Observed status: ${resScenario5.status}`
    );

    // Scenario 6: Regular organization admin attempting to use platform-admin-only access
    // (e.g. attempting to read another user's profile in /users/{otherUid})
    await adminSeedDoc("orgMembers", "usr-org-admin-only_org-alpha-audit", {
      userId: "usr-org-admin-only",
      orgId: "org-alpha-audit",
      role: "org_admin",
      status: "active"
    });
    const orgAdminToken = makeMockJwt({
      uid: "usr-org-admin-only",
      orgId: "org-alpha-audit",
      orgRole: "org_admin"
    });
    const resScenario6 = await clientGetDoc("users", "usr-target-regular", orgAdminToken);
    check("1.6", "Regular organization admin cannot access platform-admin-only user profiles (403)",
      resScenario6.status === 403,
      `Observed status: ${resScenario6.status}`
    );

    // Scenario 7: Legitimate platform admin accessing resource explicitly allowed (provenance manifest delete)
    const resScenario7 = await clientDeleteDoc("meetingProvenanceManifests", "man-audit-protected-1", legitAdminToken);
    check("1.7", "Legitimate platform admin can execute platform-admin-only deletion of provenance manifest (200)",
      resScenario7.status === 200,
      `Observed status: ${resScenario7.status}`
    );

    // Scenario 8A: Disabled platform-admin authoritative user record (disabled: true)
    const disabledAdminToken = makeMockJwt({
      uid: "usr-disabled-admin",
      role: "admin",
      platform_admin: true,
      email_verified: true
    });
    const resScenario8A = await clientGetDoc("organizations/org-alpha-audit/auditLogs", "log-alpha-audit-1", disabledAdminToken);
    console.log(`  [Diagnostic 1.8A] Disabled admin (disabled: true) with token claims -> Status ${resScenario8A.status}`);
    check("1.8A", "Disabled platform admin (disabled: true) is rejected even with claims (403)",
      resScenario8A.status === 403,
      `Observed status: ${resScenario8A.status}`
    );

    // Scenario 8B: Closed platform-admin authoritative user record (accountStatus: 'closed')
    const closedAdminToken = makeMockJwt({
      uid: "usr-closed-admin",
      role: "admin",
      platform_admin: true,
      email_verified: true
    });
    const resScenario8B = await clientGetDoc("organizations/org-alpha-audit/auditLogs", "log-alpha-audit-1", closedAdminToken);
    console.log(`  [Diagnostic 1.8B] Closed admin (accountStatus: 'closed') with token claims -> Status ${resScenario8B.status}`);
    check("1.8B", "Closed platform admin account (accountStatus: 'closed') is rejected even with claims (403)",
      resScenario8B.status === 403,
      `Observed status: ${resScenario8B.status}`
    );

    // Scenario 8C: Deleted platform-admin user record (no /users/{uid} document)
    const deletedAdminToken = makeMockJwt({
      uid: "usr-deleted-admin", // Never seeded in users collection
      role: "admin",
      platform_admin: true,
      email_verified: true
    });
    const resScenario8C = await clientGetDoc("organizations/org-alpha-audit/auditLogs", "log-alpha-audit-1", deletedAdminToken);
    console.log(`  [Diagnostic 1.8C] Deleted admin (no /users doc) with token claims -> Status ${resScenario8C.status}`);
    check("1.8C", "Deleted platform admin record (no user document) is rejected even with claims (403)",
      resScenario8C.status === 403,
      `Observed status: ${resScenario8C.status}`
    );

    // =========================================================================
    // SECTION 2: ORGANIZATION OWNERSHIP & TENANT BOUNDARIES
    // =========================================================================
    console.log("\n--- Section 2: Organization Ownership & Tenant Boundaries ---");

    // Scenario 9: Organization owner whose ownership record is valid
    const validOwnerToken = makeMockJwt({
      uid: "usr-alpha-owner-valid",
      email: "owner@alphaaudit.com",
      email_verified: true
    });
    const resScenario9 = await clientGetDoc("organizations", "org-alpha-audit", validOwnerToken);
    check("2.1", "Valid organization owner with matching ownerId can read organization document (200)",
      resScenario9.status === 200,
      `Observed status: ${resScenario9.status}`
    );

    // Scenario 10: Ownership transferred in Firestore to new owner; former owner retains stale token
    await adminSeedDoc("organizations", "org-transferred", {
      id: "org-transferred",
      name: "Transferred Org",
      ownerId: "usr-new-owner",
      ownerEmail: "newowner@transferred.com"
    });
    const formerOwnerToken = makeMockJwt({
      uid: "usr-former-owner",
      email: "former@transferred.com",
      orgId: "org-transferred",
      orgRole: "owner", // Stale claim!
      email_verified: true
    });
    const resScenario10 = await clientGetDoc("organizations", "org-transferred", formerOwnerToken);
    check("2.2", "Former owner whose ownership was transferred cannot access org via stale token (403)",
      resScenario10.status === 403,
      `Observed status: ${resScenario10.status}`
    );

    // Scenario 11: User whose email matches organization ownerEmail but whose email is unverified
    const unverifiedOwnerEmailToken = makeMockJwt({
      uid: "usr-unverified-imposter",
      email: "owner@alphaaudit.com", // Matches ownerEmail
      email_verified: false // BUT NOT VERIFIED!
    });
    const resScenario11 = await clientGetDoc("organizations", "org-alpha-audit", unverifiedOwnerEmailToken);
    console.log(`  [Diagnostic 2.3] Unverified email matching ownerEmail -> Status ${resScenario11.status}`);
    check("2.3", "User matching ownerEmail with unverified email (email_verified: false) is rejected (403)",
      resScenario11.status === 403,
      `Observed status: ${resScenario11.status}`
    );

    // Scenario 12: Valid organization administrator of Org A attempting to access Org B audit logs
    const resScenario12 = await clientGetDoc("organizations/org-beta-audit/auditLogs", "log-beta-audit-1", orgAdminToken);
    check("2.4", "Org A administrator cannot access Org B audit logs (403)",
      resScenario12.status === 403,
      `Observed status: ${resScenario12.status}`
    );

    // Scenario 13: Valid project member in Org A attempting to access a project in Org B
    await adminSeedDoc("projects", "proj-beta-audit-1", {
      id: "proj-beta-audit-1",
      name: "Beta Project",
      userId: "usr-beta-owner-valid",
      organizationId: "org-beta-audit"
    });
    // Add rogue/isolated projectMember record for user in proj-beta without org membership in Org B
    await adminSeedDoc("projectMembers", "usr-org-admin-only_proj-beta-audit-1", {
      userId: "usr-org-admin-only",
      projectId: "proj-beta-audit-1",
      role: "viewer"
    });
    const resScenario13 = await clientGetDoc("projects", "proj-beta-audit-1", orgAdminToken);
    check("2.5", "Project member without membership in project's organization is denied tenant access (403)",
      resScenario13.status === 403,
      `Observed status: ${resScenario13.status}`
    );

    // =========================================================================
    // SECTION 3: MALFORMED / INVALID IDENTIFIERS
    // =========================================================================
    console.log("\n--- Section 3: Malformed & Invalid Identifiers ---");

    // Scenario 14A: Attempting to create a project with malformed identifier (contains spaces / illegal characters)
    const resScenario14A = await clientCreateDoc("projects", "bad id with spaces!", {
      id: "bad id with spaces!",
      name: "Bad ID Project",
      userId: "usr-legit-admin"
    }, legitAdminToken);
    check("3.1", "Creation with malformed identifier containing spaces/symbols is rejected (403)",
      resScenario14A.status === 403,
      `Observed status: ${resScenario14A.status}`
    );

    // Scenario 14B: Attempting to create a project with oversized identifier (> 128 chars)
    const oversizedId = "a".repeat(150);
    const resScenario14B = await clientCreateDoc("projects", oversizedId, {
      id: oversizedId,
      name: "Oversized ID Project",
      userId: "usr-legit-admin"
    }, legitAdminToken);
    check("3.2", "Creation with oversized identifier (> 128 characters) is rejected (403)",
      resScenario14B.status === 403,
      `Observed status: ${resScenario14B.status}`
    );

  } finally {
    console.log("\n🛑 Terminating Firebase Firestore Emulator process...");
    emulatorProcess.kill();
  }

  console.log("\n================================================================================");
  console.log(`📊 STEP 1.2J AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED, ${skipped} SKIPPED`);
  console.log("================================================================================");

  if (failed > 0) {
    console.error(`⚠️ Authorization edge-case defects detected in ${failed} scenario(s).`);
  } else {
    console.log("🎉 All platform-admin, ownership, and boundary edge cases verified cleanly!");
  }
}

runAuditSuite().catch(err => {
  console.error("❌ Fatal error executing audit suite:", err);
  process.exit(1);
});
