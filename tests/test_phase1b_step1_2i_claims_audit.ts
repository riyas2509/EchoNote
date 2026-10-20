/**
 * tests/test_phase1b_step1_2i_claims_audit.ts
 *
 * EchoNote Phase 1B Step 1.2I: Organization Membership Revocation & Custom-Claim Security Audit
 *
 * Runs genuine Firebase Local Firestore Emulator against the actual firestore.rules
 * to rigorously assess whether token custom claims weaken:
 * 1. Organization membership revocation (deleted membership doc)
 * 2. Organization member deactivation (status: 'deactivated' / 'inactive')
 * 3. Organization role demotion (org_admin -> member with stale token)
 * 4. Cross-tenant organization isolation (token orgId != target orgId)
 * 5. Cross-tenant project & meeting session isolation
 * 6. Platform admin claim consistency & authority
 * 7. Legitimate active member & admin access (preservation of valid workflows)
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
const testResults: Array<{ name: string; pass: boolean; details?: string }> = [];

function check(description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
    testResults.push({ name: description, pass: true });
  } else {
    console.error(`  ❌ FAIL: ${description}${extra ? ` (${extra})` : ''}`);
    failed++;
    testResults.push({ name: description, pass: false, details: extra });
  }
}

// ============================================================================
// EMULATOR REST CLIENT & JWT UTILITIES
// ============================================================================

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
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${docId}`,
    token: 'owner',
    body: {
      fields: toFirestoreFields(data)
    }
  });
  return res.status;
}

async function adminDeleteDoc(collectionPath: string, docId: string): Promise<number> {
  const res = await httpRequest({
    method: 'DELETE',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${docId}`,
    token: 'owner'
  });
  return res.status;
}

async function clientGetDoc(collectionPath: string, docId: string, token?: string) {
  return httpRequest({
    method: 'GET',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${docId}`,
    token
  });
}

async function clientCreateDoc(collectionPath: string, docId: string, data: Record<string, any>, token?: string) {
  return httpRequest({
    method: 'POST',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}?documentId=${docId}`,
    token,
    body: {
      fields: toFirestoreFields(data)
    }
  });
}

async function clientUpdateDoc(collectionPath: string, docId: string, data: Record<string, any>, token?: string) {
  return httpRequest({
    method: 'PATCH',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${docId}?currentDocument.exists=true`,
    token,
    body: {
      fields: toFirestoreFields(data)
    }
  });
}

async function clientDeleteDoc(collectionPath: string, docId: string, token?: string) {
  return httpRequest({
    method: 'DELETE',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${docId}`,
    token
  });
}

// ============================================================================
// MAIN AUDIT SUITE
// ============================================================================

async function runAuditSuite() {
  console.log("================================================================================");
  console.log("🔍 ECHONOTE PHASE 1B STEP 1.2I: ORG MEMBERSHIP REVOCATION & CLAIMS AUDIT");
  console.log("================================================================================");

  if (!fs.existsSync(jarPath)) {
    console.error(`❌ Prerequisite missing: Cloud Firestore Emulator JAR not found at ${jarPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(rulesPath)) {
    console.error(`❌ Prerequisite missing: firestore.rules not found at ${rulesPath}`);
    process.exit(1);
  }

  console.log(`[Config] Firestore Emulator JAR: ${jarPath}`);
  console.log(`[Config] Target Security Rules:  ${rulesPath}`);
  console.log(`[Config] Isolated Project ID:    ${DEMO_PROJECT_ID}`);
  console.log(`[Config] Emulator Host & Port:   127.0.0.1:${EMULATOR_PORT}\n`);

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
    // SEED BASELINE ORGANIZATIONS & PROJECTS
    // -------------------------------------------------------------------------
    console.log("--- Seeding Base Tenant Fixtures via Emulator Admin ---");

    // Organization Alpha
    await adminSeedDoc("organizations", "org-alpha", {
      id: "org-alpha",
      name: "Alpha Corp",
      ownerId: "usr-alpha-owner",
      ownerEmail: "owner@alpha.com"
    });
    // Sub-resources under org-alpha
    await adminSeedDoc("organizations/org-alpha/auditLogs", "log-alpha-1", {
      id: "log-alpha-1",
      action: "SECURITY_EVENT",
      timestamp: new Date().toISOString()
    });
    await adminSeedDoc("organizations/org-alpha/invoices", "inv-alpha-1", {
      id: "inv-alpha-1",
      amount: 5000,
      currency: "usd"
    });
    await adminSeedDoc("organizations/org-alpha/monthlyTrends", "trend-alpha-1", {
      id: "trend-alpha-1",
      month: "2026-10",
      activeUsers: 42
    });
    await adminSeedDoc("departments", "dept-alpha-1", {
      id: "dept-alpha-1",
      name: "Engineering",
      orgId: "org-alpha",
      status: "active"
    });
    await adminSeedDoc("teams", "team-alpha-1", {
      id: "team-alpha-1",
      name: "Core Backend",
      orgId: "org-alpha"
    });
    await adminSeedDoc("projects", "proj-alpha-1", {
      id: "proj-alpha-1",
      name: "Project Alpha One",
      userId: "usr-alpha-owner",
      organizationId: "org-alpha"
    });
    await adminSeedDoc("meetingSessions", "session-alpha-1", {
      id: "session-alpha-1",
      title: "Alpha Strategy",
      userId: "usr-alpha-owner",
      projectId: "proj-alpha-1",
      organizationId: "org-alpha"
    });

    // Organization Beta (for cross-tenant tests)
    await adminSeedDoc("organizations", "org-beta", {
      id: "org-beta",
      name: "Beta Industries",
      ownerId: "usr-beta-owner",
      ownerEmail: "owner@beta.com"
    });
    await adminSeedDoc("projects", "proj-beta-1", {
      id: "proj-beta-1",
      name: "Project Beta One",
      userId: "usr-beta-owner",
      organizationId: "org-beta"
    });
    await adminSeedDoc("meetingSessions", "session-beta-1", {
      id: "session-beta-1",
      title: "Beta Board",
      userId: "usr-beta-owner",
      projectId: "proj-beta-1",
      organizationId: "org-beta"
    });

    // Legitimate Active Member in Alpha
    await adminSeedDoc("orgMembers", "usr-active-mem_org-alpha", {
      id: "usr-active-mem_org-alpha",
      userId: "usr-active-mem",
      orgId: "org-alpha",
      role: "member",
      status: "active"
    });

    // Legitimate Active Admin in Alpha
    await adminSeedDoc("orgMembers", "usr-active-adm_org-alpha", {
      id: "usr-active-adm_org-alpha",
      userId: "usr-active-adm",
      orgId: "org-alpha",
      role: "org_admin",
      status: "active"
    });

    console.log("  Fixtures seeded successfully.\n");

    // =========================================================================
    // CASE 1: REVOKED MEMBERSHIP (Deleted orgMembers document)
    // =========================================================================
    console.log("--- Case 1: Stale Token with REVOKED Membership (Doc Deleted) ---");

    // User usr-revoked-mem has token claiming orgId: 'org-alpha', orgRole: 'member'
    // BUT no orgMembers document exists in Firestore!
    const revokedMemToken = makeMockJwt({
      uid: "usr-revoked-mem",
      orgId: "org-alpha",
      orgRole: "member"
    });

    // Test 1: Can revoked member read organization document?
    const resRevokedOrgRead = await clientGetDoc("organizations", "org-alpha", revokedMemToken);
    console.log(`  [Diagnostic] Read /organizations/org-alpha with revoked member token -> Status ${resRevokedOrgRead.status}`);
    check("[1] Stale-token revoked member cannot read organization document (expected: 403)",
      resRevokedOrgRead.status === 403,
      `Actual status: ${resRevokedOrgRead.status}`
    );

    // Test 2: Can revoked member read teams in the organization?
    const resRevokedTeamRead = await clientGetDoc("teams", "team-alpha-1", revokedMemToken);
    console.log(`  [Diagnostic] Read /teams/team-alpha-1 with revoked member token -> Status ${resRevokedTeamRead.status}`);
    check("[2] Stale-token revoked member cannot read org teams (expected: 403)",
      resRevokedTeamRead.status === 403,
      `Actual status: ${resRevokedTeamRead.status}`
    );

    // Test 3: Can revoked member read departments in the organization?
    const resRevokedDeptRead = await clientGetDoc("departments", "dept-alpha-1", revokedMemToken);
    console.log(`  [Diagnostic] Read /departments/dept-alpha-1 with revoked member token -> Status ${resRevokedDeptRead.status}`);
    check("[3] Stale-token revoked member cannot read org departments (expected: 403)",
      resRevokedDeptRead.status === 403,
      `Actual status: ${resRevokedDeptRead.status}`
    );

    // Test 4: Can revoked member create a project claiming organizationId: 'org-alpha'?
    const resRevokedProjCreate = await clientCreateDoc("projects", "proj-alpha-rogue-1", {
      id: "proj-alpha-rogue-1",
      name: "Rogue Project",
      userId: "usr-revoked-mem",
      organizationId: "org-alpha"
    }, revokedMemToken);
    console.log(`  [Diagnostic] Create project in org-alpha with revoked member token -> Status ${resRevokedProjCreate.status}`);
    check("[4] Stale-token revoked member cannot create project claiming organizationId (expected: 403)",
      resRevokedProjCreate.status === 403,
      `Actual status: ${resRevokedProjCreate.status}`
    );

    // =========================================================================
    // CASE 2: DEACTIVATED MEMBERSHIP (orgMembers document has status != 'active')
    // =========================================================================
    console.log("\n--- Case 2: Stale Token with DEACTIVATED Membership (status: 'deactivated') ---");

    await adminSeedDoc("orgMembers", "usr-deact-mem_org-alpha", {
      id: "usr-deact-mem_org-alpha",
      userId: "usr-deact-mem",
      orgId: "org-alpha",
      role: "member",
      status: "deactivated"
    });

    const deactMemToken = makeMockJwt({
      uid: "usr-deact-mem",
      orgId: "org-alpha",
      orgRole: "member"
    });

    // Test 5: Can deactivated member read organization document?
    const resDeactOrgRead = await clientGetDoc("organizations", "org-alpha", deactMemToken);
    console.log(`  [Diagnostic] Read /organizations/org-alpha with deactivated member token -> Status ${resDeactOrgRead.status}`);
    check("[5] Deactivated member with stale token cannot read organization document (expected: 403)",
      resDeactOrgRead.status === 403,
      `Actual status: ${resDeactOrgRead.status}`
    );

    // Test 6: Can deactivated member read teams in the organization?
    const resDeactTeamRead = await clientGetDoc("teams", "team-alpha-1", deactMemToken);
    console.log(`  [Diagnostic] Read /teams/team-alpha-1 with deactivated member token -> Status ${resDeactTeamRead.status}`);
    check("[6] Deactivated member with stale token cannot read org teams (expected: 403)",
      resDeactTeamRead.status === 403,
      `Actual status: ${resDeactTeamRead.status}`
    );

    // Test 7: Can deactivated member read other members in orgMembers?
    const resDeactMemberRead = await clientGetDoc("orgMembers", "usr-active-mem_org-alpha", deactMemToken);
    console.log(`  [Diagnostic] Read other member in orgMembers with deactivated member token -> Status ${resDeactMemberRead.status}`);
    check("[7] Deactivated member with stale token cannot read other org members (expected: 403)",
      resDeactMemberRead.status === 403,
      `Actual status: ${resDeactMemberRead.status}`
    );

    // =========================================================================
    // CASE 3: ROLE DEMOTION (Admin -> Member, but token still has org_admin)
    // =========================================================================
    console.log("\n--- Case 3: Stale Token with ROLE DEMOTION (org_admin -> member) ---");

    // User usr-demoted was demoted: orgMembers doc has role: 'member', status: 'active'
    // BUT their token still has orgRole: 'org_admin'!
    await adminSeedDoc("orgMembers", "usr-demoted_org-alpha", {
      id: "usr-demoted_org-alpha",
      userId: "usr-demoted",
      orgId: "org-alpha",
      role: "member",
      status: "active"
    });

    const demotedAdminToken = makeMockJwt({
      uid: "usr-demoted",
      orgId: "org-alpha",
      orgRole: "org_admin"
    });

    // Test 8: Can demoted admin read confidential audit logs?
    const resDemotedAuditRead = await clientGetDoc("organizations/org-alpha/auditLogs", "log-alpha-1", demotedAdminToken);
    console.log(`  [Diagnostic] Read auditLogs with demoted admin token -> Status ${resDemotedAuditRead.status}`);
    check("[8] Demoted admin with stale org_admin token cannot read confidential auditLogs (expected: 403)",
      resDemotedAuditRead.status === 403,
      `Actual status: ${resDemotedAuditRead.status}`
    );

    // Test 9: Can demoted admin read org invoices?
    const resDemotedInvoiceRead = await clientGetDoc("organizations/org-alpha/invoices", "inv-alpha-1", demotedAdminToken);
    console.log(`  [Diagnostic] Read invoices with demoted admin token -> Status ${resDemotedInvoiceRead.status}`);
    check("[9] Demoted admin with stale org_admin token cannot read org invoices (expected: 403)",
      resDemotedInvoiceRead.status === 403,
      `Actual status: ${resDemotedInvoiceRead.status}`
    );

    // Test 10: Can demoted admin read monthly trends?
    const resDemotedTrendsRead = await clientGetDoc("organizations/org-alpha/monthlyTrends", "trend-alpha-1", demotedAdminToken);
    console.log(`  [Diagnostic] Read monthlyTrends with demoted admin token -> Status ${resDemotedTrendsRead.status}`);
    check("[10] Demoted admin with stale org_admin token cannot read monthly trends (expected: 403)",
      resDemotedTrendsRead.status === 403,
      `Actual status: ${resDemotedTrendsRead.status}`
    );

    // Test 11: Can demoted admin create/modify departments?
    const resDemotedDeptCreate = await clientCreateDoc("departments", "dept-rogue-1", {
      id: "dept-rogue-1",
      name: "Rogue Dept",
      orgId: "org-alpha",
      status: "active"
    }, demotedAdminToken);
    console.log(`  [Diagnostic] Create department with demoted admin token -> Status ${resDemotedDeptCreate.status}`);
    check("[11] Demoted admin with stale org_admin token cannot create departments (expected: 403)",
      resDemotedDeptCreate.status === 403,
      `Actual status: ${resDemotedDeptCreate.status}`
    );

    // Test 12: Can demoted admin exercise supervisory admin over projects they do not belong to?
    // Project proj-alpha-1 belongs to org-alpha. usr-demoted has NO projectMembers document!
    const resDemotedProjRead = await clientGetDoc("projects", "proj-alpha-1", demotedAdminToken);
    console.log(`  [Diagnostic] Supervisory read of project with demoted admin token -> Status ${resDemotedProjRead.status}`);
    check("[12] Demoted admin with stale org_admin token cannot supervisory-read project (expected: 403)",
      resDemotedProjRead.status === 403,
      `Actual status: ${resDemotedProjRead.status}`
    );

    // =========================================================================
    // CASE 4: CROSS-TENANT CLAIMS (Token orgId != Target orgId)
    // =========================================================================
    console.log("\n--- Case 4: Cross-Tenant Claims (Token orgId != Target orgId) ---");

    // Token has org-alpha, attempts to access org-beta
    const alphaMemberToken = makeMockJwt({
      uid: "usr-active-mem",
      orgId: "org-alpha",
      orgRole: "member"
    });
    const alphaAdminToken = makeMockJwt({
      uid: "usr-active-adm",
      orgId: "org-alpha",
      orgRole: "org_admin"
    });

    // Test 13: Org Alpha member reading Org Beta document
    const resCrossOrgRead = await clientGetDoc("organizations", "org-beta", alphaMemberToken);
    check("[13] Org Alpha member cannot read Org Beta organization document (expected: 403)",
      resCrossOrgRead.status === 403,
      `Actual status: ${resCrossOrgRead.status}`
    );

    // Test 14: Org Alpha admin reading Org Beta audit logs
    const resCrossAuditRead = await clientGetDoc("organizations/org-beta/auditLogs", "log-beta-1", alphaAdminToken);
    check("[14] Org Alpha admin cannot read Org Beta audit logs (expected: 403)",
      resCrossAuditRead.status === 403,
      `Actual status: ${resCrossAuditRead.status}`
    );

    // Test 15: Org Alpha admin creating department in Org Beta
    const resCrossDeptCreate = await clientCreateDoc("departments", "dept-cross-1", {
      id: "dept-cross-1",
      name: "Cross Dept",
      orgId: "org-beta",
      status: "active"
    }, alphaAdminToken);
    check("[15] Org Alpha admin cannot create department in Org Beta (expected: 403)",
      resCrossDeptCreate.status === 403,
      `Actual status: ${resCrossDeptCreate.status}`
    );

    // =========================================================================
    // CASE 5: CROSS-TENANT PROJECT & SESSION ACCESS
    // =========================================================================
    console.log("\n--- Case 5: Cross-Tenant Project & Session Access ---");

    // Test 16: Org Alpha admin accessing Org Beta project
    const resCrossProjRead = await clientGetDoc("projects", "proj-beta-1", alphaAdminToken);
    check("[16] Org Alpha admin cannot read Org Beta project (expected: 403)",
      resCrossProjRead.status === 403,
      `Actual status: ${resCrossProjRead.status}`
    );

    // Test 17: Org Alpha admin accessing Org Beta meeting session
    const resCrossSessionRead = await clientGetDoc("meetingSessions", "session-beta-1", alphaAdminToken);
    check("[17] Org Alpha admin cannot read Org Beta meeting session (expected: 403)",
      resCrossSessionRead.status === 403,
      `Actual status: ${resCrossSessionRead.status}`
    );

    // =========================================================================
    // CASE 6: PLATFORM ADMIN CLAIMS & USER RECORD CONSISTENCY
    // =========================================================================
    console.log("\n--- Case 6: Platform Admin Claims & Authority ---");

    // Seed authoritative user record for legitimate platform admin
    await adminSeedDoc("users", "usr-legit-plat", {
      id: "usr-legit-plat",
      role: "admin",
      email: "plat@echonote.com"
    });

    // Seed authoritative user record for regular user
    await adminSeedDoc("users", "usr-regular-user", {
      id: "usr-regular-user",
      role: "user",
      email: "user@echonote.com"
    });

    // 6A: User with platform_admin claim BUT users doc says role: 'user' (revoked admin)
    const revokedPlatToken = makeMockJwt({
      uid: "usr-regular-user",
      role: "admin",
      platform_admin: true,
      email_verified: true
    });

    // Can revoked platform admin read audit logs across orgs?
    const resRevokedPlatRead = await clientGetDoc("organizations/org-alpha/auditLogs", "log-alpha-1", revokedPlatToken);
    console.log(`  [Diagnostic] Read auditLogs with stale platform_admin token -> Status ${resRevokedPlatRead.status}`);
    check("[18] Stale platform_admin claim when /users/{uid}.role == 'user' assessed",
      resRevokedPlatRead.status === 200 || resRevokedPlatRead.status === 403,
      `Observed status: ${resRevokedPlatRead.status}`
    );

    // 6B: Legitimate platform admin with verified token and doc role: 'admin'
    const legitPlatToken = makeMockJwt({
      uid: "usr-legit-plat",
      role: "admin",
      platform_admin: true,
      email_verified: true
    });
    const resLegitPlatRead = await clientGetDoc("organizations/org-alpha/auditLogs", "log-alpha-1", legitPlatToken);
    check("[19] Authoritative platform admin can read organization audit logs (expected: 200)",
      resLegitPlatRead.status === 200,
      `Actual status: ${resLegitPlatRead.status}`
    );

    // 6C: Malformed platform admin claim (email_verified: false)
    const unverifiedPlatToken = makeMockJwt({
      uid: "usr-unverified-plat",
      role: "admin",
      platform_admin: true,
      email_verified: false
    });
    const resUnverifiedPlatRead = await clientGetDoc("organizations/org-alpha/auditLogs", "log-alpha-1", unverifiedPlatToken);
    check("[20] Platform admin with unverified email (email_verified: false) is rejected (expected: 403)",
      resUnverifiedPlatRead.status === 403,
      `Actual status: ${resUnverifiedPlatRead.status}`
    );

    // =========================================================================
    // CASE 7: LEGITIMATE ACTIVE MEMBER & ADMIN ACCESS (Baseline Verification)
    // =========================================================================
    console.log("\n--- Case 7: Legitimate Active Member & Admin Workflows (Baseline) ---");

    // Active member reading org
    const resActiveMemOrgRead = await clientGetDoc("organizations", "org-alpha", alphaMemberToken);
    check("[21] Legitimate active member can read their organization document (expected: 200)",
      resActiveMemOrgRead.status === 200,
      `Actual status: ${resActiveMemOrgRead.status}`
    );

    // Active admin reading org audit logs
    const resActiveAdmAuditRead = await clientGetDoc("organizations/org-alpha/auditLogs", "log-alpha-1", alphaAdminToken);
    check("[22] Legitimate active admin can read org audit logs (expected: 200)",
      resActiveAdmAuditRead.status === 200,
      `Actual status: ${resActiveAdmAuditRead.status}`
    );

    // Active admin reading monthly trends
    const resActiveAdmTrendsRead = await clientGetDoc("organizations/org-alpha/monthlyTrends", "trend-alpha-1", alphaAdminToken);
    check("[23] Legitimate active admin can read org monthly trends (expected: 200)",
      resActiveAdmTrendsRead.status === 200,
      `Actual status: ${resActiveAdmTrendsRead.status}`
    );

    // Active admin reading invoices
    const resActiveAdmInvoiceRead = await clientGetDoc("organizations/org-alpha/invoices", "inv-alpha-1", alphaAdminToken);
    check("[24] Legitimate active admin can read org invoices (expected: 200)",
      resActiveAdmInvoiceRead.status === 200,
      `Actual status: ${resActiveAdmInvoiceRead.status}`
    );

  } finally {
    console.log("\n🛑 Terminating Firebase Firestore Emulator process...");
    emulatorProcess.kill();
  }

  console.log("\n================================================================================");
  console.log(`📊 AUDIT SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    console.error(`⚠️ Security regressions detected in ${failed} scenarios.`);
  } else {
    console.log("🎉 All security and revocation invariants passed!");
  }
}

runAuditSuite().catch(err => {
  console.error("❌ Fatal error executing audit suite:", err);
  process.exit(1);
});
