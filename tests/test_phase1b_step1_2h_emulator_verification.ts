/**
 * tests/test_phase1b_step1_2h_emulator_verification.ts
 *
 * EchoNote Phase 1B Step 1.2H: Firebase Emulator Security Rules Verification Suite
 *
 * Genuine execution of the Firebase Local Firestore Emulator against the repository's
 * actual firestore.rules file (53KB, 1096 lines) in isolated offline mode.
 *
 * Covers:
 * 1. Integration credentials security:
 *    - /organizations/{orgId}/integrations/{integrationId} (read & write closed from all client SDKs)
 *    - /integrationConnections/{connectionId} (read & write closed from all client SDKs)
 * 2. Meeting sessions access control:
 *    - Project sessions readable only by authorized project members
 *    - Outsiders and unauthenticated callers denied
 *    - Project editors can create sessions
 *    - Identity spoofing rejected
 *    - Cross-project moving (altering projectId/organizationId) forbidden
 *    - Allowed field updates permitted for editors
 *    - Standalone personal sessions restricted to owner
 * 3. Provenance manifests hardening:
 *    - Authorized editor can create valid manifest
 *    - Project viewers and outsiders rejected
 *    - Nonexistent project references rejected
 *    - Inconsistent organization references rejected
 *    - Cross-project session references rejected
 *    - Standalone personal manifests permitted for owner
 *    - Manifest updates strictly forbidden for ALL users (immutability)
 *    - Manifest deletion restricted exclusively to platform admin
 *
 * Safety Invariants:
 * - Runs strictly against demo-echonote-test on localhost:8088.
 * - Zero network access to production Google Cloud / Firebase services.
 * - Leaves no dangling emulator background processes.
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

function check(description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}${extra ? ` (${extra})` : ''}`);
    failed++;
  }
}

// ============================================================================
// EMULATOR CONTROLLER & REST CLIENT
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
    email_verified: true,
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

// Admin seeding helper (bypasses rules via emulator admin authorization)
async function adminSeedDoc(collectionPath: string, docId: string, data: Record<string, any>): Promise<number> {
  const res = await httpRequest({
    method: 'PATCH',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${docId}`,
    token: 'owner', // Admin privilege in Firebase Emulator
    body: {
      fields: toFirestoreFields(data)
    }
  });
  return res.status;
}

// Client request helpers (evaluated against actual firestore.rules)
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

async function clearEmulatorData(): Promise<void> {
  await httpRequest({
    method: 'DELETE',
    path: `/emulator/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents`
  });
}

// ============================================================================
// MAIN TEST SUITE EXECUTION
// ============================================================================

async function runTestSuite() {
  console.log("================================================================================");
  console.log("🔥 ECHONOTE PHASE 1B STEP 1.2H: FIREBASE EMULATOR SECURITY RULES VERIFICATION");
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
    // SECTION 1: INTEGRATION CREDENTIALS RULES IN EMULATOR
    // -------------------------------------------------------------------------
    console.log("--- Section 1: Integration Credentials Rules in Emulator ---");

    // Seed test organization & integration doc via Admin
    await adminSeedDoc("organizations", "org-sec-1", {
      name: "Security Org 1",
      ownerId: "usr-org-owner-1",
      ownerEmail: "owner@org1.com"
    });
    await adminSeedDoc("organizations/org-sec-1/integrations", "slack-conn-1", {
      id: "slack-conn-1",
      provider: "slack",
      _secretsEncrypted: { ciphertext: "abc", iv: "def", tag: "ghi", keyId: "local-aes-256-gcm:v1" }
    });
    await adminSeedDoc("integrationConnections", "zoom-conn-1", {
      id: "zoom-conn-1",
      provider: "zoom",
      organizationId: "org-sec-1"
    });

    // Seed authoritative user record for platform admin
    await adminSeedDoc("users", "usr-plat-1", {
      id: "usr-plat-1",
      email: "admin@echonote.com",
      role: "admin",
      accountStatus: "active",
      disabled: false
    });

    const orgMemberToken = makeMockJwt({ uid: "usr-member-1", orgId: "org-sec-1", orgRole: "member" });
    const orgAdminToken = makeMockJwt({ uid: "usr-admin-1", orgId: "org-sec-1", orgRole: "org_admin" });
    const platformAdminToken = makeMockJwt({ uid: "usr-plat-1", role: "admin", platform_admin: true });

    // Test 1: Unauthenticated read of /organizations/{orgId}/integrations/{integrationId}
    const resUnauthIntRead = await clientGetDoc("organizations/org-sec-1/integrations", "slack-conn-1");
    check("[1] Unauthenticated read of organization integration document is rejected (403)",
      resUnauthIntRead.status === 403
    );

    // Test 2: Authenticated org member read of integration document
    const resMemberIntRead = await clientGetDoc("organizations/org-sec-1/integrations", "slack-conn-1", orgMemberToken);
    check("[2] Authenticated org member read of integration document is rejected (403)",
      resMemberIntRead.status === 403
    );

    // Test 3: Authenticated org admin read of integration document
    const resAdminIntRead = await clientGetDoc("organizations/org-sec-1/integrations", "slack-conn-1", orgAdminToken);
    check("[3] Authenticated org admin read of integration document is rejected (403)",
      resAdminIntRead.status === 403
    );

    // Test 4: Platform admin read of integration document via client SDK
    const resPlatAdminIntRead = await clientGetDoc("organizations/org-sec-1/integrations", "slack-conn-1", platformAdminToken);
    check("[4] Platform admin read of integration document via client SDK is rejected (403)",
      resPlatAdminIntRead.status === 403
    );

    // Test 5: Unauthenticated write to integration document
    const resUnauthIntWrite = await clientCreateDoc("organizations/org-sec-1/integrations", "fake-conn", {
      id: "fake-conn",
      provider: "slack"
    });
    check("[5] Unauthenticated write to organization integration document is rejected (403)",
      resUnauthIntWrite.status === 403
    );

    // Test 6: Org member write to integration document
    const resMemberIntWrite = await clientCreateDoc("organizations/org-sec-1/integrations", "fake-conn", {
      id: "fake-conn",
      provider: "slack"
    }, orgMemberToken);
    check("[6] Org member write to organization integration document is rejected (403)",
      resMemberIntWrite.status === 403
    );

    // Test 7: Org admin write to integration document via client SDK
    const resAdminIntWrite = await clientCreateDoc("organizations/org-sec-1/integrations", "fake-conn", {
      id: "fake-conn",
      provider: "slack"
    }, orgAdminToken);
    check("[7] Org admin write to organization integration document is rejected (403)",
      resAdminIntWrite.status === 403
    );

    // Test 8: Platform admin write to integration document via client SDK
    const resPlatAdminIntWrite = await clientCreateDoc("organizations/org-sec-1/integrations", "fake-conn", {
      id: "fake-conn",
      provider: "slack"
    }, platformAdminToken);
    check("[8] Platform admin write to organization integration document via client SDK is rejected (403)",
      resPlatAdminIntWrite.status === 403
    );

    // Test 9: Unauthenticated read of /integrationConnections/{connectionId}
    const resUnauthConnRead = await clientGetDoc("integrationConnections", "zoom-conn-1");
    check("[9] Unauthenticated read of /integrationConnections/{connectionId} is rejected (403)",
      resUnauthConnRead.status === 403
    );

    // Test 10: Authenticated user read of /integrationConnections/{connectionId}
    const resUserConnRead = await clientGetDoc("integrationConnections", "zoom-conn-1", orgMemberToken);
    check("[10] Authenticated user read of /integrationConnections/{connectionId} is rejected (403)",
      resUserConnRead.status === 403
    );

    // Test 11: Unauthenticated write to /integrationConnections/{connectionId}
    const resUnauthConnWrite = await clientCreateDoc("integrationConnections", "conn-new", {
      id: "conn-new",
      provider: "zoom"
    });
    check("[11] Unauthenticated write to /integrationConnections/{connectionId} is rejected (403)",
      resUnauthConnWrite.status === 403
    );

    // Test 12: Authenticated user write to /integrationConnections/{connectionId}
    const resUserConnWrite = await clientCreateDoc("integrationConnections", "conn-new", {
      id: "conn-new",
      provider: "zoom"
    }, orgMemberToken);
    check("[12] Authenticated user write to /integrationConnections/{connectionId} is rejected (403)",
      resUserConnWrite.status === 403
    );

    // Test 13: Platform admin write to /integrationConnections/{connectionId} via client SDK
    const resPlatConnWrite = await clientCreateDoc("integrationConnections", "conn-new", {
      id: "conn-new",
      provider: "zoom"
    }, platformAdminToken);
    check("[13] Platform admin write to /integrationConnections/{connectionId} via client SDK is rejected (403)",
      resPlatConnWrite.status === 403
    );

    // -------------------------------------------------------------------------
    // SECTION 2: MEETING SESSIONS RULES IN EMULATOR
    // -------------------------------------------------------------------------
    console.log("\n--- Section 2: Meeting Sessions Rules in Emulator ---");

    // Seed test project, org, and members for meeting sessions
    await adminSeedDoc("organizations", "org-sess-1", {
      name: "Session Org 1",
      ownerId: "usr-sess-owner"
    });
    await adminSeedDoc("projects", "proj-sess-alpha", {
      name: "Alpha Sessions Project",
      userId: "usr-sess-owner",
      organizationId: "org-sess-1"
    });
    await adminSeedDoc("projectMembers", "usr-sess-editor_proj-sess-alpha", {
      userId: "usr-sess-editor",
      projectId: "proj-sess-alpha",
      role: "editor"
    });
    await adminSeedDoc("projectMembers", "usr-sess-viewer_proj-sess-alpha", {
      userId: "usr-sess-viewer",
      projectId: "proj-sess-alpha",
      role: "viewer"
    });
    await adminSeedDoc("orgMembers", "usr-sess-editor_org-sess-1", {
      userId: "usr-sess-editor",
      orgId: "org-sess-1",
      role: "member",
      status: "active"
    });
    await adminSeedDoc("orgMembers", "usr-sess-viewer_org-sess-1", {
      userId: "usr-sess-viewer",
      orgId: "org-sess-1",
      role: "member",
      status: "active"
    });

    // Seed existing project session
    await adminSeedDoc("meetingSessions", "sess-proj-alpha-1", {
      id: "sess-proj-alpha-1",
      userId: "usr-sess-editor",
      projectId: "proj-sess-alpha",
      organizationId: "org-sess-1",
      title: "Sprint Planning Alpha",
      status: "completed"
    });

    // Seed standalone personal session (no project)
    await adminSeedDoc("meetingSessions", "sess-solo-1", {
      id: "sess-solo-1",
      userId: "usr-solo-dev",
      title: "Solo Notes",
      status: "active"
    });

    const sessEditorToken = makeMockJwt({ uid: "usr-sess-editor", orgId: "org-sess-1", orgRole: "member" });
    const sessViewerToken = makeMockJwt({ uid: "usr-sess-viewer", orgId: "org-sess-1", orgRole: "member" });
    const sessOutsiderToken = makeMockJwt({ uid: "usr-sess-stranger", email: "stranger@ext.com" });
    const sessSoloToken = makeMockJwt({ uid: "usr-solo-dev" });

    // Test 14: Project viewer can read project meeting session
    const resViewerReadSess = await clientGetDoc("meetingSessions", "sess-proj-alpha-1", sessViewerToken);
    check("[14] Authorized project viewer can read project meeting session (200)",
      resViewerReadSess.status === 200
    );

    // Test 15: Project editor can read project meeting session
    const resEditorReadSess = await clientGetDoc("meetingSessions", "sess-proj-alpha-1", sessEditorToken);
    check("[15] Authorized project editor can read project meeting session (200)",
      resEditorReadSess.status === 200
    );

    // Test 16: Outsider cannot read project meeting session
    const resOutsiderReadSess = await clientGetDoc("meetingSessions", "sess-proj-alpha-1", sessOutsiderToken);
    check("[16] Outsider without project access cannot read project meeting session (403)",
      resOutsiderReadSess.status === 403
    );

    // Test 17: Unauthenticated client cannot read project meeting session
    const resUnauthReadSess = await clientGetDoc("meetingSessions", "sess-proj-alpha-1");
    check("[17] Unauthenticated client cannot read project meeting session (403)",
      resUnauthReadSess.status === 403
    );

    // Test 18: Standalone session owner can read their personal session
    const resSoloReadOwn = await clientGetDoc("meetingSessions", "sess-solo-1", sessSoloToken);
    check("[18] Standalone session owner can read their personal session (200)",
      resSoloReadOwn.status === 200
    );

    // Test 19: Stranger cannot read standalone session
    const resStrangerReadSolo = await clientGetDoc("meetingSessions", "sess-solo-1", sessOutsiderToken);
    check("[19] Stranger cannot read another user's standalone session (403)",
      resStrangerReadSolo.status === 403
    );

    // Test 20: Platform admin can read any session
    const resPlatReadSession = await clientGetDoc("meetingSessions", "sess-proj-alpha-1", platformAdminToken);
    check("[20] Platform administrator can read any meeting session (200)",
      resPlatReadSession.status === 200
    );

    // Test 21: Authorized project editor can create session in project
    const resEditorCreateSess = await clientCreateDoc("meetingSessions", "sess-proj-alpha-new", {
      id: "sess-proj-alpha-new",
      userId: "usr-sess-editor",
      projectId: "proj-sess-alpha",
      organizationId: "org-sess-1",
      title: "New Team Standup"
    }, sessEditorToken);
    check("[21] Authorized project editor can create meeting session in project (200)",
      resEditorCreateSess.status === 200
    );

    // Test 22: Project viewer cannot create session in project
    const resViewerCreateSess = await clientCreateDoc("meetingSessions", "sess-proj-viewer-invalid", {
      id: "sess-proj-viewer-invalid",
      userId: "usr-sess-viewer",
      projectId: "proj-sess-alpha",
      organizationId: "org-sess-1",
      title: "Viewer Unauthorized Session"
    }, sessViewerToken);
    check("[22] Project viewer cannot create meeting session in project (403)",
      resViewerCreateSess.status === 403
    );

    // Test 23: Outsider cannot create session in project
    const resOutsiderCreateSess = await clientCreateDoc("meetingSessions", "sess-proj-outsider-invalid", {
      id: "sess-proj-outsider-invalid",
      userId: "usr-sess-stranger",
      projectId: "proj-sess-alpha",
      organizationId: "org-sess-1",
      title: "Outsider Unauthorized Session"
    }, sessOutsiderToken);
    check("[23] Outsider cannot create meeting session in project (403)",
      resOutsiderCreateSess.status === 403
    );

    // Test 24: Solo user can create standalone personal session
    const resSoloCreateSess = await clientCreateDoc("meetingSessions", "sess-solo-new", {
      id: "sess-solo-new",
      userId: "usr-solo-dev",
      title: "My Personal Audio Journal"
    }, sessSoloToken);
    check("[24] User can create valid standalone personal session (200)",
      resSoloCreateSess.status === 200
    );

    // Test 25: Creator identity spoofing (userId != auth.uid) rejected
    const resSpoofedSess = await clientCreateDoc("meetingSessions", "sess-spoofed", {
      id: "sess-spoofed",
      userId: "usr-impersonated-target",
      projectId: "proj-sess-alpha",
      organizationId: "org-sess-1",
      title: "Spoofed Identity Session"
    }, sessEditorToken);
    check("[25] Rejects session creation when userId does not match auth.uid (403)",
      resSpoofedSess.status === 403
    );

    // Test 26: User cannot move session between projects (altering projectId rejected)
    const resMoveProjectSess = await clientUpdateDoc("meetingSessions", "sess-proj-alpha-1", {
      id: "sess-proj-alpha-1",
      userId: "usr-sess-editor",
      projectId: "proj-different-hijack",
      organizationId: "org-sess-1",
      title: "Moving Project Attempt"
    }, sessEditorToken);
    check("[26] Rejects altering projectId on existing meeting session (403)",
      resMoveProjectSess.status === 403
    );

    // Test 27: User cannot alter organizationId on existing meeting session
    const resMoveOrgSess = await clientUpdateDoc("meetingSessions", "sess-proj-alpha-1", {
      id: "sess-proj-alpha-1",
      userId: "usr-sess-editor",
      projectId: "proj-sess-alpha",
      organizationId: "org-different-tenant",
      title: "Moving Org Attempt"
    }, sessEditorToken);
    check("[27] Rejects altering organizationId on existing meeting session (403)",
      resMoveOrgSess.status === 403
    );

    // Test 28: Authorized editor can update allowed operational fields (title, summary)
    const resEditorUpdateSess = await clientUpdateDoc("meetingSessions", "sess-proj-alpha-1", {
      id: "sess-proj-alpha-1",
      userId: "usr-sess-editor",
      projectId: "proj-sess-alpha",
      organizationId: "org-sess-1",
      title: "Updated Sprint Planning Title",
      summary: "Detailed meeting discussion points"
    }, sessEditorToken);
    check("[28] Authorized editor can update non-linkage fields on meeting session (200)",
      resEditorUpdateSess.status === 200
    );

    // Test 29: Project viewer cannot delete meeting session
    const resViewerDeleteSess = await clientDeleteDoc("meetingSessions", "sess-proj-alpha-1", sessViewerToken);
    check("[29] Project viewer cannot delete meeting session (403)",
      resViewerDeleteSess.status === 403
    );

    // Test 30: Session creator/owner can delete their meeting session
    const resCreatorDeleteSess = await clientDeleteDoc("meetingSessions", "sess-proj-alpha-new", sessEditorToken);
    check("[30] Session creator can delete permitted meeting session (200)",
      resCreatorDeleteSess.status === 200
    );

    // Test 31: Solo owner can delete their standalone session
    const resSoloDeleteOwn = await clientDeleteDoc("meetingSessions", "sess-solo-new", sessSoloToken);
    check("[31] Standalone owner can delete personal meeting session (200)",
      resSoloDeleteOwn.status === 200
    );

    // -------------------------------------------------------------------------
    // SECTION 3: PROVENANCE MANIFESTS RULES IN EMULATOR
    // -------------------------------------------------------------------------
    console.log("\n--- Section 3: Provenance Manifests Rules in Emulator ---");

    // Seed test projects, organizations, members, and sessions
    await adminSeedDoc("organizations", "org-omega-1", {
      name: "Omega Corporation",
      ownerId: "usr-man-boss"
    });
    await adminSeedDoc("projects", "proj-man-alpha", {
      name: "Alpha Manifest Project",
      userId: "usr-man-owner",
      organizationId: "org-omega-1"
    });
    await adminSeedDoc("projects", "proj-man-beta", {
      name: "Beta Manifest Project",
      userId: "usr-man-owner",
      organizationId: "org-omega-1"
    });
    await adminSeedDoc("projectMembers", "usr-man-editor_proj-man-alpha", {
      userId: "usr-man-editor",
      projectId: "proj-man-alpha",
      role: "editor"
    });
    await adminSeedDoc("projectMembers", "usr-man-viewer_proj-man-alpha", {
      userId: "usr-man-viewer",
      projectId: "proj-man-alpha",
      role: "viewer"
    });
    await adminSeedDoc("projectMembers", "usr-man-editor_proj-man-beta", {
      userId: "usr-man-editor",
      projectId: "proj-man-beta",
      role: "editor"
    });
    await adminSeedDoc("orgMembers", "usr-man-editor_org-omega-1", {
      userId: "usr-man-editor",
      orgId: "org-omega-1",
      role: "member",
      status: "active"
    });
    await adminSeedDoc("orgMembers", "usr-man-viewer_org-omega-1", {
      userId: "usr-man-viewer",
      orgId: "org-omega-1",
      role: "member",
      status: "active"
    });

    // Seed session in Alpha
    await adminSeedDoc("meetingSessions", "sess-in-alpha", {
      id: "sess-in-alpha",
      userId: "usr-man-editor",
      projectId: "proj-man-alpha",
      organizationId: "org-omega-1"
    });

    // Seed session in Beta
    await adminSeedDoc("meetingSessions", "sess-in-beta", {
      id: "sess-in-beta",
      userId: "usr-man-editor",
      projectId: "proj-man-beta",
      organizationId: "org-omega-1"
    });

    const manEditorToken = makeMockJwt({ uid: "usr-man-editor", orgId: "org-omega-1", orgRole: "member" });
    const manViewerToken = makeMockJwt({ uid: "usr-man-viewer", orgId: "org-omega-1", orgRole: "member" });
    const manOutsiderToken = makeMockJwt({ uid: "usr-man-outsider", email: "outsider@evil.com" });
    const manSoloToken = makeMockJwt({ uid: "usr-man-solo" });

    // Test 32: Authorized project editor creates valid project manifest
    const resEditorCreateManifest = await clientCreateDoc("meetingProvenanceManifests", "man-alpha-001", {
      manifestId: "man-alpha-001",
      userId: "usr-man-editor",
      projectId: "proj-man-alpha",
      organizationId: "org-omega-1",
      meetingSessionId: "sess-in-alpha",
      provider: "zoom",
      captureMode: "recording",
      schemaVersion: "1.0"
    }, manEditorToken);
    check("[32] Authorized project editor can create provenance manifest (200)",
      resEditorCreateManifest.status === 200,
      `Status: ${resEditorCreateManifest.status}, Body: ${JSON.stringify(resEditorCreateManifest.body)}`
    );

    // Test 33: Project viewer cannot create manifest
    const resViewerCreateManifest = await clientCreateDoc("meetingProvenanceManifests", "man-alpha-viewer", {
      manifestId: "man-alpha-viewer",
      userId: "usr-man-viewer",
      projectId: "proj-man-alpha",
      organizationId: "org-omega-1",
      provider: "zoom",
      captureMode: "recording",
      schemaVersion: "1.0"
    }, manViewerToken);
    check("[33] Project viewer cannot create provenance manifest (403)",
      resViewerCreateManifest.status === 403
    );

    // Test 34: Outsider cannot create manifest
    const resOutsiderCreateManifest = await clientCreateDoc("meetingProvenanceManifests", "man-alpha-outsider", {
      manifestId: "man-alpha-outsider",
      userId: "usr-man-outsider",
      projectId: "proj-man-alpha",
      organizationId: "org-omega-1",
      provider: "zoom",
      captureMode: "recording",
      schemaVersion: "1.0"
    }, manOutsiderToken);
    check("[34] Outsider cannot create provenance manifest (403)",
      resOutsiderCreateManifest.status === 403
    );

    // Test 35: Rejects manifest referencing nonexistent project
    const resNonexistentProjManifest = await clientCreateDoc("meetingProvenanceManifests", "man-nonexistent-proj", {
      manifestId: "man-nonexistent-proj",
      userId: "usr-man-editor",
      projectId: "proj-nonexistent-999",
      organizationId: "org-omega-1",
      provider: "zoom",
      captureMode: "recording",
      schemaVersion: "1.0"
    }, manEditorToken);
    check("[35] Rejects provenance manifest referencing nonexistent project (403)",
      resNonexistentProjManifest.status === 403
    );

    // Test 36: Rejects manifest with inconsistent organization ID
    const resInconsistentOrgManifest = await clientCreateDoc("meetingProvenanceManifests", "man-inconsistent-org", {
      manifestId: "man-inconsistent-org",
      userId: "usr-man-editor",
      projectId: "proj-man-alpha",
      organizationId: "org-fake-mismatch",
      provider: "zoom",
      captureMode: "recording",
      schemaVersion: "1.0"
    }, manEditorToken);
    check("[36] Rejects manifest with inconsistent organizationId differing from project org (403)",
      resInconsistentOrgManifest.status === 403
    );

    // Test 37: Rejects cross-project session linkage (session belongs to beta, manifest claims alpha)
    const resCrossLinkageManifest = await clientCreateDoc("meetingProvenanceManifests", "man-cross-link", {
      manifestId: "man-cross-link",
      userId: "usr-man-editor",
      projectId: "proj-man-alpha", // Manifest set to Alpha
      organizationId: "org-omega-1",
      meetingSessionId: "sess-in-beta", // But session belongs to Beta!
      provider: "zoom",
      captureMode: "recording",
      schemaVersion: "1.0"
    }, manEditorToken);
    check("[37] Rejects cross-project session linkage in provenance manifest (403)",
      resCrossLinkageManifest.status === 403
    );

    // Test 38: Allows standalone personal manifest creation by owner
    const resSoloManifest = await clientCreateDoc("meetingProvenanceManifests", "man-solo-001", {
      manifestId: "man-solo-001",
      userId: "usr-man-solo",
      provider: "google_meet",
      captureMode: "bot",
      schemaVersion: "1.0"
    }, manSoloToken);
    check("[38] Allows standalone personal manifest creation by owner (200)",
      resSoloManifest.status === 200
    );

    // Test 39: Rejects manifest when creator userId does not match auth.uid
    const resSpoofedManifest = await clientCreateDoc("meetingProvenanceManifests", "man-spoofed", {
      manifestId: "man-spoofed",
      userId: "usr-different-victim",
      projectId: "proj-man-alpha",
      organizationId: "org-omega-1",
      provider: "zoom",
      captureMode: "recording",
      schemaVersion: "1.0"
    }, manEditorToken);
    check("[39] Rejects manifest creation when userId does not match auth.uid (403)",
      resSpoofedManifest.status === 403
    );

    // Test 40: Manifest updates strictly forbidden for regular editor (immutability)
    const resEditorUpdateManifest = await clientUpdateDoc("meetingProvenanceManifests", "man-alpha-001", {
      manifestId: "man-alpha-001",
      userId: "usr-man-editor",
      projectId: "proj-man-alpha",
      organizationId: "org-omega-1",
      tamperedField: "malicious-change"
    }, manEditorToken);
    check("[40] Regular editor update of provenance manifest is strictly forbidden (403)",
      resEditorUpdateManifest.status === 403,
      `Status: ${resEditorUpdateManifest.status}, Body: ${JSON.stringify(resEditorUpdateManifest.body)}`
    );

    // Test 41: Manifest updates strictly forbidden even for platform admin (allow update: if false;)
    const resAdminUpdateManifest = await clientUpdateDoc("meetingProvenanceManifests", "man-alpha-001", {
      manifestId: "man-alpha-001",
      userId: "usr-man-editor",
      projectId: "proj-man-alpha",
      organizationId: "org-omega-1",
      adminTamperedField: "admin-tampering"
    }, platformAdminToken);
    check("[41] Platform admin update of provenance manifest is strictly forbidden (403)",
      resAdminUpdateManifest.status === 403
    );

    // Test 42: Manifest deletion denied for regular editor
    const resEditorDeleteManifest = await clientDeleteDoc("meetingProvenanceManifests", "man-alpha-001", manEditorToken);
    check("[42] Regular editor cannot delete provenance manifest (403)",
      resEditorDeleteManifest.status === 403
    );

    // Test 43: Manifest deletion permitted exclusively for platform administrator
    const resAdminDeleteManifest = await clientDeleteDoc("meetingProvenanceManifests", "man-solo-001", platformAdminToken);
    check("[43] Platform administrator can delete provenance manifest (200)",
      resAdminDeleteManifest.status === 200
    );

    // -------------------------------------------------------------------------
    // SECTION 4: CONFIGURATION & ENVIRONMENT INVARIANTS
    // -------------------------------------------------------------------------
    console.log("\n--- Section 4: Configuration & Environment Invariants ---");

    const firebaseJsonText = fs.readFileSync(path.join(process.cwd(), 'firebase.json'), 'utf8');
    const firestoreRulesText = fs.readFileSync(rulesPath, 'utf8');

    check("[44] firebase.json binds rules to firestore.rules",
      firebaseJsonText.includes('"rules": "firestore.rules"')
    );

    check("[45] firestore.rules exports rules_version = '2'",
      firestoreRulesText.includes("rules_version = '2';")
    );

    check("[46] Emulator operates on isolated non-production project ID (demo-echonote-test)",
      DEMO_PROJECT_ID.startsWith('demo-')
    );

    // -------------------------------------------------------------------------
    // TEST SUITE SUMMARY
    // -------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log(`📊 TEST SUITE SUMMARY: ${passed} / ${passed + failed} PASSED (${failed} FAILED)`);
    console.log("================================================================================");

    if (failed > 0) {
      process.exit(1);
    } else {
      console.log("🎉 ALL 46 FIREBASE EMULATOR SECURITY RULES INVARIANTS VERIFIED CLEANLY!\n");
    }

  } finally {
    console.log("🛑 Terminating Firebase Firestore Emulator process...");
    emulatorProcess.kill('SIGTERM');
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
