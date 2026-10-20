/**
 * tests/test_step3b4e_emulator_verification.ts
 * ==============================================================================
 * EchoNote — Step 3B.4E: Genuine Firestore Rules Emulator Verification Suite
 * ==============================================================================
 * Tests critical authorization boundaries directly against the official
 * Google Cloud Firestore Emulator executing the repository's firestore.rules file.
 *
 * Covers:
 * 1. Project Membership & Role Escalation:
 *    - An editor cannot create project membership for another user
 *    - An editor cannot promote an existing member to admin
 *    - A project owner can create and manage project memberships
 *    - A project admin can create and manage project memberships
 *    - A member can update allowed self-service fields (displayName, email) without altering role
 *    - A member cannot change their own role via self-update
 * 2. Teams & Cross-Organization Isolation:
 *    - A manager can create a team in their own organization
 *    - A manager cannot create a team in another organization
 *    - A manager cannot modify a team in another organization
 *    - A manager cannot change an existing team's orgId (cross-org reassignment rejected)
 *    - Team deletion uses existing document's orgId and does not depend on request.resource
 *    - Manager cannot delete a team in another organization
 * 3. Departments & Cross-Organization Isolation:
 *    - An org admin can create a department in their own organization
 *    - An org manager (non-admin) cannot create a department
 *    - An org admin cannot create a department in another organization
 *    - An org admin cannot change an existing department's orgId
 *    - Department deletion uses existing document's orgId and does not depend on request.resource
 *    - Org admin cannot delete a department in another organization
 * 4. Identifier & Parameter Validation (Fail-Closed):
 *    - Missing or malformed organization identifiers are rejected on create
 *    - Missing or null organization identifiers are rejected on update
 * 5. User Profile Privileged Fields & Escalation:
 *    - User cannot self-assign role='admin' or platform_admin=true on create
 *    - User cannot modify role, platform_admin, orgRole, or plan on update
 *    - User can update permitted profile fields (displayName)
 * 6. Supervisory Admin & Platform Admin Invariants:
 *    - Platform admin retains management access across organizations and projects
 *    - Supervisory org admin can manage project memberships for projects in their org
 *
 * Safety Invariants:
 * - Runs strictly against demo-echonote-test on localhost:8089.
 * - Zero network access to production Google Cloud / Firebase services.
 * - Leaves no dangling emulator background processes.
 */

import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';

const EMULATOR_PORT = 8089;
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
const failures: string[] = [];

function check(description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    const msg = `❌ FAIL: ${description}${extra ? ` (${extra})` : ''}`;
    console.error(`  ${msg}`);
    failures.push(msg);
    failed++;
  }
}

// ============================================================================
// JWT MOCKING & REST API CLIENT
// ============================================================================

function makeMockJwt(claims: { uid: string; email?: string; [key: string]: any }): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
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
    firebase: { identities: {}, sign_in_provider: 'custom' },
    ...claims
  })).toString('base64url');
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

async function clientUpdateDoc(collectionPath: string, docId: string, data: Record<string, any>, token?: string, updateMaskFields?: string[]) {
  let url = `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents/${collectionPath}/${docId}?currentDocument.exists=true`;
  if (updateMaskFields && updateMaskFields.length > 0) {
    for (const f of updateMaskFields) {
      url += `&updateMask.fieldPaths=${encodeURIComponent(f)}`;
    }
  }
  return httpRequest({
    method: 'PATCH',
    path: url,
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

async function clientRunQuery(queryPayload: any, token?: string) {
  return httpRequest({
    method: 'POST',
    path: `/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents:runQuery`,
    token,
    body: queryPayload
  });
}

async function clearEmulatorData(): Promise<void> {
  await httpRequest({
    method: 'DELETE',
    path: `/emulator/v1/projects/${DEMO_PROJECT_ID}/databases/(default)/documents`
  });
}

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================

async function runTestSuite() {
  console.log("================================================================================");
  console.log("🔥 ECHONOTE STEP 3B.4E: GENUINE FIRESTORE RULES EMULATOR VERIFICATION");
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
    console.error("❌ Failed to connect to Firebase Firestore Emulator on port " + EMULATOR_PORT);
    emulatorProcess.kill('SIGTERM');
    process.exit(1);
  }

  console.log("🎉 Firestore Emulator successfully started and loaded firestore.rules!\n");

  try {
    await clearEmulatorData();

    // -------------------------------------------------------------------------
    // IDENTITIES & TOKENS SETUP
    // -------------------------------------------------------------------------
    const ORG_ALPHA = 'org_alpha';
    const ORG_BETA = 'org_beta';

    const UID_PLATFORM_ADMIN = 'usr_plat_admin';
    const UID_ALPHA_OWNER = 'usr_alpha_owner';
    const UID_ALPHA_ADMIN = 'usr_alpha_admin';
    const UID_ALPHA_MANAGER = 'usr_alpha_manager';
    const UID_ALPHA_MEMBER = 'usr_alpha_member';

    const UID_BETA_OWNER = 'usr_beta_owner';
    const UID_BETA_MANAGER = 'usr_beta_manager';

    const UID_PROJ_OWNER = 'usr_proj_owner';
    const UID_PROJ_ADMIN = 'usr_proj_admin';
    const UID_PROJ_EDITOR = 'usr_proj_editor';
    const UID_PROJ_VIEWER = 'usr_proj_viewer';
    const UID_PROJ_NEW_USER = 'usr_proj_new_user';

    const tokenPlatformAdmin = makeMockJwt({ uid: UID_PLATFORM_ADMIN, email: 'admin@echonote.internal', role: 'admin', platform_admin: true });
    const tokenAlphaOwner = makeMockJwt({ uid: UID_ALPHA_OWNER, email: 'owner@alpha.com' });
    const tokenAlphaAdmin = makeMockJwt({ uid: UID_ALPHA_ADMIN, email: 'admin@alpha.com' });
    const tokenAlphaManager = makeMockJwt({ uid: UID_ALPHA_MANAGER, email: 'manager@alpha.com' });
    const tokenAlphaMember = makeMockJwt({ uid: UID_ALPHA_MEMBER, email: 'member@alpha.com', orgId: ORG_ALPHA });

    const tokenBetaManager = makeMockJwt({ uid: UID_BETA_MANAGER, email: 'manager@beta.com' });

    const tokenProjOwner = makeMockJwt({ uid: UID_PROJ_OWNER, email: 'owner@project.com' });
    const tokenProjAdmin = makeMockJwt({ uid: UID_PROJ_ADMIN, email: 'admin@project.com' });
    const tokenProjEditor = makeMockJwt({ uid: UID_PROJ_EDITOR, email: 'editor@project.com' });
    const tokenProjViewer = makeMockJwt({ uid: UID_PROJ_VIEWER, email: 'viewer@project.com' });
    const tokenProjNewUser = makeMockJwt({ uid: UID_PROJ_NEW_USER, email: 'newuser@project.com' });

    // -------------------------------------------------------------------------
    // SEED ORGANIZATIONS AND MEMBERS
    // -------------------------------------------------------------------------
    // Seed authoritative user record for platform admin
    await adminSeedDoc('users', UID_PLATFORM_ADMIN, {
      id: UID_PLATFORM_ADMIN,
      email: 'admin@echonote.internal',
      role: 'admin',
      accountStatus: 'active',
      disabled: false
    });
    await adminSeedDoc('organizations', ORG_ALPHA, {
      name: 'Alpha Corp',
      ownerId: UID_ALPHA_OWNER,
      ownerEmail: 'owner@alpha.com'
    });
    await adminSeedDoc('organizations', ORG_BETA, {
      name: 'Beta Corp',
      ownerId: UID_BETA_OWNER,
      ownerEmail: 'owner@beta.com'
    });

    // Seed org memberships for Alpha
    await adminSeedDoc('orgMembers', `${UID_ALPHA_ADMIN}_${ORG_ALPHA}`, {
      userId: UID_ALPHA_ADMIN,
      orgId: ORG_ALPHA,
      role: 'admin',
      status: 'active'
    });
    await adminSeedDoc('orgMembers', `${UID_ALPHA_MANAGER}_${ORG_ALPHA}`, {
      userId: UID_ALPHA_MANAGER,
      orgId: ORG_ALPHA,
      role: 'manager',
      status: 'active'
    });
    await adminSeedDoc('orgMembers', `${UID_ALPHA_MEMBER}_${ORG_ALPHA}`, {
      userId: UID_ALPHA_MEMBER,
      orgId: ORG_ALPHA,
      role: 'member',
      status: 'active'
    });

    // Seed org memberships for Beta
    await adminSeedDoc('orgMembers', `${UID_BETA_MANAGER}_${ORG_BETA}`, {
      userId: UID_BETA_MANAGER,
      orgId: ORG_BETA,
      role: 'manager',
      status: 'active'
    });

    // -------------------------------------------------------------------------
    // SEED PROJECTS AND PROJECT MEMBERS
    // -------------------------------------------------------------------------
    const PROJ_ALPHA_1 = 'proj_alpha_1';
    await adminSeedDoc('projects', PROJ_ALPHA_1, {
      name: 'Alpha Project 1',
      userId: UID_PROJ_OWNER,
      organizationId: ORG_ALPHA
    });

    // Put users in orgMembers for Alpha so they pass isUserInProjectOrg
    for (const uid of [UID_PROJ_OWNER, UID_PROJ_ADMIN, UID_PROJ_EDITOR, UID_PROJ_VIEWER, UID_PROJ_NEW_USER]) {
      await adminSeedDoc('orgMembers', `${uid}_${ORG_ALPHA}`, {
        userId: uid,
        orgId: ORG_ALPHA,
        role: 'member',
        status: 'active'
      });
    }

    // Seed project memberships
    await adminSeedDoc('projectMembers', `${UID_PROJ_OWNER}_${PROJ_ALPHA_1}`, {
      userId: UID_PROJ_OWNER,
      projectId: PROJ_ALPHA_1,
      role: 'owner',
      displayName: 'Project Owner'
    });
    await adminSeedDoc('projectMembers', `${UID_PROJ_ADMIN}_${PROJ_ALPHA_1}`, {
      userId: UID_PROJ_ADMIN,
      projectId: PROJ_ALPHA_1,
      role: 'admin',
      displayName: 'Project Admin'
    });
    await adminSeedDoc('projectMembers', `${UID_PROJ_EDITOR}_${PROJ_ALPHA_1}`, {
      userId: UID_PROJ_EDITOR,
      projectId: PROJ_ALPHA_1,
      role: 'editor',
      displayName: 'Project Editor'
    });
    await adminSeedDoc('projectMembers', `${UID_PROJ_VIEWER}_${PROJ_ALPHA_1}`, {
      userId: UID_PROJ_VIEWER,
      projectId: PROJ_ALPHA_1,
      role: 'viewer',
      displayName: 'Project Viewer'
    });

    // -------------------------------------------------------------------------
    // SECTION 1: PROJECT MEMBERSHIP & ROLE ESCALATION (Step 3B.4C verification)
    // -------------------------------------------------------------------------
    console.log("\n--- Section 1: Project Membership & Role Escalation in Emulator ---");

    // Case 1: Editor cannot create project membership for another user
    const resEditorCreateMember = await clientCreateDoc(
      'projectMembers',
      `${UID_PROJ_NEW_USER}_${PROJ_ALPHA_1}`,
      {
        userId: UID_PROJ_NEW_USER,
        projectId: PROJ_ALPHA_1,
        role: 'viewer'
      },
      tokenProjEditor
    );
    check("[1] Editor cannot create project membership for another user (403)",
      resEditorCreateMember.status === 403,
      `Status: ${resEditorCreateMember.status}`
    );

    // Case 2: Editor cannot promote another user to admin
    const resEditorPromoteMember = await clientUpdateDoc(
      'projectMembers',
      `${UID_PROJ_VIEWER}_${PROJ_ALPHA_1}`,
      {
        userId: UID_PROJ_VIEWER,
        projectId: PROJ_ALPHA_1,
        role: 'admin'
      },
      tokenProjEditor
    );
    check("[2] Editor cannot promote another user to admin (403)",
      resEditorPromoteMember.status === 403,
      `Status: ${resEditorPromoteMember.status}`
    );

    // Case 3: Project owner can add a new project member
    const resOwnerCreateMember = await clientCreateDoc(
      'projectMembers',
      `${UID_PROJ_NEW_USER}_${PROJ_ALPHA_1}`,
      {
        userId: UID_PROJ_NEW_USER,
        projectId: PROJ_ALPHA_1,
        role: 'editor'
      },
      tokenProjOwner
    );
    check("[3] Project owner can create permitted project member (200)",
      resOwnerCreateMember.status === 200,
      `Status: ${resOwnerCreateMember.status}`
    );

    // Case 4: Project admin can update an existing member's role (not owner)
    const resAdminUpdateRole = await clientUpdateDoc(
      'projectMembers',
      `${UID_PROJ_NEW_USER}_${PROJ_ALPHA_1}`,
      {
        userId: UID_PROJ_NEW_USER,
        projectId: PROJ_ALPHA_1,
        role: 'commenter',
        displayName: 'Updated Name'
      },
      tokenProjAdmin
    );
    check("[4] Project admin can update existing member role to commenter (200)",
      resAdminUpdateRole.status === 200,
      `Status: ${resAdminUpdateRole.status}`
    );

    // Case 5: Member can update allowed self-service fields without changing role
    const resSelfServiceUpdate = await clientUpdateDoc(
      'projectMembers',
      `${UID_PROJ_VIEWER}_${PROJ_ALPHA_1}`,
      {
        userId: UID_PROJ_VIEWER,
        projectId: PROJ_ALPHA_1,
        role: 'viewer',
        displayName: 'Viewer New Display Name'
      },
      tokenProjViewer
    );
    check("[5] Member can update allowed self-service field displayName (200)",
      resSelfServiceUpdate.status === 200,
      `Status: ${resSelfServiceUpdate.status}`
    );

    // Case 6: Member cannot elevate their own role via self-update
    const resSelfRoleElevation = await clientUpdateDoc(
      'projectMembers',
      `${UID_PROJ_VIEWER}_${PROJ_ALPHA_1}`,
      {
        userId: UID_PROJ_VIEWER,
        projectId: PROJ_ALPHA_1,
        role: 'admin',
        displayName: 'Hacked Admin'
      },
      tokenProjViewer
    );
    check("[6] Member cannot elevate own role to admin (403)",
      resSelfRoleElevation.status === 403,
      `Status: ${resSelfRoleElevation.status}`
    );

    // -------------------------------------------------------------------------
    // SECTION 2: TEAMS & CROSS-ORGANIZATION ISOLATION (Step 3B.4D verification)
    // -------------------------------------------------------------------------
    console.log("\n--- Section 2: Teams & Cross-Organization Isolation in Emulator ---");

    // Seed existing team in Alpha
    await adminSeedDoc('teams', 'team_alpha_1', {
      name: 'Alpha Engineering',
      orgId: ORG_ALPHA
    });

    // Seed existing team in Beta
    await adminSeedDoc('teams', 'team_beta_1', {
      name: 'Beta Sales',
      orgId: ORG_BETA
    });

    // Case 7: Manager can create a team in their own organization
    const resManagerCreateTeamOwnOrg = await clientCreateDoc(
      'teams',
      'team_alpha_new',
      {
        name: 'Alpha Design',
        orgId: ORG_ALPHA
      },
      tokenAlphaManager
    );
    check("[7] Manager can create team in own organization (200)",
      resManagerCreateTeamOwnOrg.status === 200,
      `Status: ${resManagerCreateTeamOwnOrg.status}`
    );

    // Case 8: Manager cannot create a team in another organization
    const resManagerCreateTeamOtherOrg = await clientCreateDoc(
      'teams',
      'team_beta_tamper',
      {
        name: 'Cross Org Infiltrator',
        orgId: ORG_BETA
      },
      tokenAlphaManager
    );
    check("[8] Manager cannot create team in another organization (403)",
      resManagerCreateTeamOtherOrg.status === 403,
      `Status: ${resManagerCreateTeamOtherOrg.status}`
    );

    // Case 9: Manager cannot modify a team in another organization
    const resManagerUpdateTeamOtherOrg = await clientUpdateDoc(
      'teams',
      'team_beta_1',
      {
        name: 'Beta Tampered by Alpha Manager',
        orgId: ORG_BETA
      },
      tokenAlphaManager
    );
    check("[9] Manager cannot modify team in another organization (403)",
      resManagerUpdateTeamOtherOrg.status === 403,
      `Status: ${resManagerUpdateTeamOtherOrg.status}`
    );

    // Case 10: Manager cannot change an existing team's orgId (cross-org reassignment)
    const resManagerReassignTeam = await clientUpdateDoc(
      'teams',
      'team_alpha_1',
      {
        name: 'Alpha Engineering',
        orgId: ORG_BETA
      },
      tokenAlphaManager
    );
    check("[10] Reassigning team orgId to another organization is rejected (403)",
      resManagerReassignTeam.status === 403,
      `Status: ${resManagerReassignTeam.status}`
    );

    // Case 11: Manager cannot delete a team in another organization
    const resManagerDeleteTeamOtherOrg = await clientDeleteDoc(
      'teams',
      'team_beta_1',
      tokenAlphaManager
    );
    check("[11] Manager cannot delete team in another organization (403)",
      resManagerDeleteTeamOtherOrg.status === 403,
      `Status: ${resManagerDeleteTeamOtherOrg.status}`
    );

    // Case 12: Delete authorization uses existing document's orgId and succeeds without request.resource
    const resManagerDeleteTeamOwnOrg = await clientDeleteDoc(
      'teams',
      'team_alpha_new',
      tokenAlphaManager
    );
    check("[12] Delete team succeeds for authorized manager without request payload (200)",
      resManagerDeleteTeamOwnOrg.status === 200,
      `Status: ${resManagerDeleteTeamOwnOrg.status}`
    );

    // -------------------------------------------------------------------------
    // SECTION 3: DEPARTMENTS & CROSS-ORGANIZATION ISOLATION (Step 3B.4D verification)
    // -------------------------------------------------------------------------
    console.log("\n--- Section 3: Departments & Cross-Organization Isolation in Emulator ---");

    // Seed existing department in Alpha and Beta
    await adminSeedDoc('departments', 'dept_alpha_1', {
      name: 'Alpha R&D',
      orgId: ORG_ALPHA
    });
    await adminSeedDoc('departments', 'dept_beta_1', {
      name: 'Beta Operations',
      orgId: ORG_BETA
    });

    // Case 13: Org admin can create a department in own organization
    const resAdminCreateDeptOwnOrg = await clientCreateDoc(
      'departments',
      'dept_alpha_new',
      {
        name: 'Alpha Security',
        orgId: ORG_ALPHA
      },
      tokenAlphaAdmin
    );
    check("[13] Org admin can create department in own organization (200)",
      resAdminCreateDeptOwnOrg.status === 200,
      `Status: ${resAdminCreateDeptOwnOrg.status}`
    );

    // Case 14: Non-admin manager cannot create department (requires isOrgAdmin)
    const resManagerCreateDept = await clientCreateDoc(
      'departments',
      'dept_alpha_manager_attempt',
      {
        name: 'Alpha Marketing',
        orgId: ORG_ALPHA
      },
      tokenAlphaManager
    );
    check("[14] Non-admin manager cannot create department (requires isOrgAdmin) (403)",
      resManagerCreateDept.status === 403,
      `Status: ${resManagerCreateDept.status}`
    );

    // Case 15: Org admin cannot create department in another organization
    const resAdminCreateDeptOtherOrg = await clientCreateDoc(
      'departments',
      'dept_beta_tamper',
      {
        name: 'Infiltrated Dept',
        orgId: ORG_BETA
      },
      tokenAlphaAdmin
    );
    check("[15] Org admin cannot create department in another organization (403)",
      resAdminCreateDeptOtherOrg.status === 403,
      `Status: ${resAdminCreateDeptOtherOrg.status}`
    );

    // Case 16: Org admin cannot change existing department's orgId
    const resAdminReassignDept = await clientUpdateDoc(
      'departments',
      'dept_alpha_1',
      {
        name: 'Alpha R&D',
        orgId: ORG_BETA
      },
      tokenAlphaAdmin
    );
    check("[16] Reassigning department orgId to another organization is rejected (403)",
      resAdminReassignDept.status === 403,
      `Status: ${resAdminReassignDept.status}`
    );

    // Case 17: Org admin cannot delete department in another organization
    const resAdminDeleteDeptOtherOrg = await clientDeleteDoc(
      'departments',
      'dept_beta_1',
      tokenAlphaAdmin
    );
    check("[17] Org admin cannot delete department in another organization (403)",
      resAdminDeleteDeptOtherOrg.status === 403,
      `Status: ${resAdminDeleteDeptOtherOrg.status}`
    );

    // Case 18: Department deletion uses existing document's orgId and succeeds without request.resource
    const resAdminDeleteDeptOwnOrg = await clientDeleteDoc(
      'departments',
      'dept_alpha_new',
      tokenAlphaAdmin
    );
    check("[18] Delete department succeeds for authorized admin without request payload (200)",
      resAdminDeleteDeptOwnOrg.status === 200,
      `Status: ${resAdminDeleteDeptOwnOrg.status}`
    );

    // -------------------------------------------------------------------------
    // SECTION 4: IDENTIFIER & PARAMETER VALIDATION (Fail-Closed)
    // -------------------------------------------------------------------------
    console.log("\n--- Section 4: Identifier & Parameter Validation in Emulator ---");

    // Case 19: Missing orgId on create is denied
    const resCreateMissingOrgId = await clientCreateDoc(
      'teams',
      'team_alpha_no_org',
      {
        name: 'No Org Team'
      },
      tokenAlphaManager
    );
    check("[19] Team create missing orgId is rejected (403)",
      resCreateMissingOrgId.status === 403,
      `Status: ${resCreateMissingOrgId.status}`
    );

    // Case 20: Malformed/special character orgId on create is denied
    const resCreateMalformedOrgId = await clientCreateDoc(
      'teams',
      'team_alpha_bad_org',
      {
        name: 'Bad Org Team',
        orgId: 'invalid/org/id'
      },
      tokenAlphaManager
    );
    check("[20] Team create with malformed orgId is rejected (403)",
      resCreateMalformedOrgId.status === 403,
      `Status: ${resCreateMalformedOrgId.status}`
    );

    // Case 21: Non-existent orgId on create is denied
    const resCreateNonexistentOrgId = await clientCreateDoc(
      'teams',
      'team_alpha_ghost_org',
      {
        name: 'Ghost Org Team',
        orgId: 'org_nonexistent_999'
      },
      tokenAlphaManager
    );
    check("[21] Team create with nonexistent orgId is rejected (403)",
      resCreateNonexistentOrgId.status === 403,
      `Status: ${resCreateNonexistentOrgId.status}`
    );

    // Case 22: Update attempting to remove or nullify orgId is denied
    const resUpdateNullOrgId = await clientUpdateDoc(
      'teams',
      'team_alpha_1',
      {
        name: 'Alpha Engineering',
        orgId: null
      },
      tokenAlphaManager
    );
    check("[22] Team update nullifying orgId is rejected (403)",
      resUpdateNullOrgId.status === 403,
      `Status: ${resUpdateNullOrgId.status}`
    );

    // -------------------------------------------------------------------------
    // SECTION 5: USER PROFILE PRIVILEGED FIELDS & ESCALATION
    // -------------------------------------------------------------------------
    console.log("\n--- Section 5: User Profile Security in Emulator ---");

    const UID_TEST_USER = 'usr_regular_joe';
    const tokenRegularJoe = makeMockJwt({ uid: UID_TEST_USER, email: 'joe@example.com' });

    // Case 23: User cannot self-assign role='admin' on user creation
    const resUserSelfAssignAdmin = await clientCreateDoc(
      'users',
      UID_TEST_USER,
      {
        email: 'joe@example.com',
        displayName: 'Regular Joe',
        role: 'admin'
      },
      tokenRegularJoe
    );
    check("[23] User cannot self-assign role='admin' on create (403)",
      resUserSelfAssignAdmin.status === 403,
      `Status: ${resUserSelfAssignAdmin.status}`
    );

    // Case 24: User cannot self-assign platform_admin=true on create
    const resUserSelfAssignPlatformAdmin = await clientCreateDoc(
      'users',
      UID_TEST_USER,
      {
        email: 'joe@example.com',
        displayName: 'Regular Joe',
        platform_admin: true
      },
      tokenRegularJoe
    );
    check("[24] User cannot self-assign platform_admin=true on create (403)",
      resUserSelfAssignPlatformAdmin.status === 403,
      `Status: ${resUserSelfAssignPlatformAdmin.status}`
    );

    // Case 25: User can initialize standard profile with self-service fields
    const resUserValidCreate = await clientCreateDoc(
      'users',
      UID_TEST_USER,
      {
        email: 'joe@example.com',
        displayName: 'Regular Joe',
        role: 'user',
        plan: 'free'
      },
      tokenRegularJoe
    );
    check("[25] User can create valid profile with unprivileged defaults (200)",
      resUserValidCreate.status === 200,
      `Status: ${resUserValidCreate.status}`
    );

    // Case 26: User cannot modify role or platform_admin on update
    const resUserEscalateRoleUpdate = await clientUpdateDoc(
      'users',
      UID_TEST_USER,
      {
        email: 'joe@example.com',
        displayName: 'Regular Joe',
        role: 'admin'
      },
      tokenRegularJoe
    );
    check("[26] User cannot escalate role to admin on profile update (403)",
      resUserEscalateRoleUpdate.status === 403,
      `Status: ${resUserEscalateRoleUpdate.status}`
    );

    // Case 27: User cannot alter organizationId / orgRole via profile update
    const resUserOrgRoleTamper = await clientUpdateDoc(
      'users',
      UID_TEST_USER,
      {
        email: 'joe@example.com',
        displayName: 'Regular Joe',
        orgRole: 'owner'
      },
      tokenRegularJoe
    );
    check("[27] User cannot alter orgRole on profile update (403)",
      resUserOrgRoleTamper.status === 403,
      `Status: ${resUserOrgRoleTamper.status}`
    );

    // Case 28: User can update permitted non-privileged profile fields
    const resUserUpdateDisplayName = await clientUpdateDoc(
      'users',
      UID_TEST_USER,
      {
        email: 'joe@example.com',
        displayName: 'Joe Updated',
        role: 'user',
        plan: 'free'
      },
      tokenRegularJoe
    );
    check("[28] User can update permitted displayName field (200)",
      resUserUpdateDisplayName.status === 200,
      `Status: ${resUserUpdateDisplayName.status}`
    );

    // -------------------------------------------------------------------------
    // SECTION 6: SUPERVISORY ADMIN & PLATFORM ADMIN PERMISSIONS
    // -------------------------------------------------------------------------
    console.log("\n--- Section 6: Supervisory & Platform Admin Access in Emulator ---");

    // Case 29: Org supervisory admin can manage project memberships for project in their org
    const resSupervisorAddMember = await clientCreateDoc(
      'projectMembers',
      `${UID_ALPHA_MEMBER}_${PROJ_ALPHA_1}`,
      {
        userId: UID_ALPHA_MEMBER,
        projectId: PROJ_ALPHA_1,
        role: 'editor'
      },
      tokenAlphaAdmin
    );
    check("[29] Org supervisory admin can manage membership in org project (200)",
      resSupervisorAddMember.status === 200,
      `Status: ${resSupervisorAddMember.status}`
    );

    // Case 30: Platform admin retains full management access across teams and departments
    const resPlatformAdminCreateTeam = await clientCreateDoc(
      'teams',
      'team_plat_global',
      {
        name: 'Global Ops',
        orgId: ORG_ALPHA
      },
      tokenPlatformAdmin
    );
    check("[30] Platform admin can create team across organizations (200)",
      resPlatformAdminCreateTeam.status === 200,
      `Status: ${resPlatformAdminCreateTeam.status}`
    );

    // Case 31: Platform admin can delete department across organizations
    const resPlatformAdminDeleteDept = await clientDeleteDoc(
      'departments',
      'dept_beta_1',
      tokenPlatformAdmin
    );
    check("[31] Platform admin can delete department across organizations (200)",
      resPlatformAdminDeleteDept.status === 200,
      `Status: ${resPlatformAdminDeleteDept.status}`
    );

    // -------------------------------------------------------------------------
    // SECTION 7: PROJECT-MEMBER DELETION (Step 3B.4H Part A)
    // -------------------------------------------------------------------------
    console.log("\n--- Section 7: Project-Member Deletion in Emulator ---");

    // Seed dedicated members for deletion testing
    const UID_MEMBER_TO_LEAVE = 'usr_proj_leaving_member';
    const UID_MEMBER_TO_KICK = 'usr_proj_kicked_member';
    const tokenLeavingMember = makeMockJwt({ uid: UID_MEMBER_TO_LEAVE, email: 'leaving@project.com' });

    // Seed org memberships
    await adminSeedDoc('orgMembers', `${UID_MEMBER_TO_LEAVE}_${ORG_ALPHA}`, {
      userId: UID_MEMBER_TO_LEAVE,
      orgId: ORG_ALPHA,
      role: 'member',
      status: 'active'
    });
    await adminSeedDoc('orgMembers', `${UID_MEMBER_TO_KICK}_${ORG_ALPHA}`, {
      userId: UID_MEMBER_TO_KICK,
      orgId: ORG_ALPHA,
      role: 'member',
      status: 'active'
    });

    // Seed projectMember docs
    await adminSeedDoc('projectMembers', `${UID_MEMBER_TO_LEAVE}_${PROJ_ALPHA_1}`, {
      userId: UID_MEMBER_TO_LEAVE,
      projectId: PROJ_ALPHA_1,
      role: 'editor',
      displayName: 'Leaving Member'
    });
    await adminSeedDoc('projectMembers', `${UID_MEMBER_TO_KICK}_${PROJ_ALPHA_1}`, {
      userId: UID_MEMBER_TO_KICK,
      projectId: PROJ_ALPHA_1,
      role: 'commenter',
      displayName: 'Kicked Member'
    });

    // Case 32: Non-owner member can remove their own membership (self-removal)
    const resSelfRemove = await clientDeleteDoc(
      'projectMembers',
      `${UID_MEMBER_TO_LEAVE}_${PROJ_ALPHA_1}`,
      tokenLeavingMember
    );
    check("[32] Non-owner member can remove own membership (200)",
      resSelfRemove.status === 200,
      `Status: ${resSelfRemove.status}`
    );

    // Confirm document state: record is truly deleted (404)
    const resCheckSelfRemovedDoc = await clientGetDoc(
      'projectMembers',
      `${UID_MEMBER_TO_LEAVE}_${PROJ_ALPHA_1}`,
      tokenPlatformAdmin
    );
    check("[33] Confirmed document state: self-removed member document no longer exists (404)",
      resCheckSelfRemovedDoc.status === 404,
      `Status: ${resCheckSelfRemovedDoc.status}`
    );

    // Case 34: Project owner cannot be removed through self-removal path (resource.data.role != 'owner')
    const resOwnerSelfRemove = await clientDeleteDoc(
      'projectMembers',
      `${UID_PROJ_OWNER}_${PROJ_ALPHA_1}`,
      tokenProjOwner
    );
    check("[34] Project owner cannot be removed through self-removal path (403)",
      resOwnerSelfRemove.status === 403,
      `Status: ${resOwnerSelfRemove.status}`
    );

    // Confirm document state: owner document is preserved after self-removal attempt
    const resCheckOwnerDoc = await clientGetDoc(
      'projectMembers',
      `${UID_PROJ_OWNER}_${PROJ_ALPHA_1}`,
      tokenProjOwner
    );
    check("[35] Confirmed document state: project owner document remains intact after owner self-removal attempt (200)",
      resCheckOwnerDoc.status === 200,
      `Status: ${resCheckOwnerDoc.status}`
    );

    // Case 35a: Project admin cannot delete project owner membership
    const resAdminDeleteOwner = await clientDeleteDoc(
      'projectMembers',
      `${UID_PROJ_OWNER}_${PROJ_ALPHA_1}`,
      tokenProjAdmin
    );
    check("[35a] Project admin cannot delete owner membership (403)",
      resAdminDeleteOwner.status === 403,
      `Status: ${resAdminDeleteOwner.status}`
    );

    // Case 35b: Org supervisory admin cannot delete project owner membership
    const resOrgAdminDeleteOwner = await clientDeleteDoc(
      'projectMembers',
      `${UID_PROJ_OWNER}_${PROJ_ALPHA_1}`,
      tokenAlphaAdmin
    );
    check("[35b] Org supervisory admin cannot delete owner membership (403)",
      resOrgAdminDeleteOwner.status === 403,
      `Status: ${resOrgAdminDeleteOwner.status}`
    );

    // Case 35c: Platform admin cannot delete project owner membership through ordinary rule
    const resPlatAdminDeleteOwner = await clientDeleteDoc(
      'projectMembers',
      `${UID_PROJ_OWNER}_${PROJ_ALPHA_1}`,
      tokenPlatformAdmin
    );
    check("[35c] Platform admin cannot delete owner membership through ordinary delete rule (403)",
      resPlatAdminDeleteOwner.status === 403,
      `Status: ${resPlatAdminDeleteOwner.status}`
    );

    // Confirm document state: owner document is still intact after all deletion attempts
    const resCheckOwnerStillIntact = await clientGetDoc(
      'projectMembers',
      `${UID_PROJ_OWNER}_${PROJ_ALPHA_1}`,
      tokenProjOwner
    );
    check("[35d] Confirmed document state: project owner document remains intact after all privileged delete attempts (200)",
      resCheckOwnerStillIntact.status === 200,
      `Status: ${resCheckOwnerStillIntact.status}`
    );

    // Case 36: Unauthorized user (viewer) cannot remove another member
    const resUnauthorizedRemove = await clientDeleteDoc(
      'projectMembers',
      `${UID_MEMBER_TO_KICK}_${PROJ_ALPHA_1}`,
      tokenProjViewer
    );
    check("[36] Unauthorized user (viewer) cannot remove another member (403)",
      resUnauthorizedRemove.status === 403,
      `Status: ${resUnauthorizedRemove.status}`
    );

    // Confirm document state: member was NOT deleted by unauthorized user
    const resCheckKickedStillExists = await clientGetDoc(
      'projectMembers',
      `${UID_MEMBER_TO_KICK}_${PROJ_ALPHA_1}`,
      tokenProjAdmin
    );
    check("[37] Confirmed document state: member preserved after unauthorized deletion attempt (200)",
      resCheckKickedStillExists.status === 200,
      `Status: ${resCheckKickedStillExists.status}`
    );

    // Case 38: Authorized project admin can remove another member
    const resAdminRemoveMember = await clientDeleteDoc(
      'projectMembers',
      `${UID_MEMBER_TO_KICK}_${PROJ_ALPHA_1}`,
      tokenProjAdmin
    );
    check("[38] Authorized project admin can remove another member (200)",
      resAdminRemoveMember.status === 200,
      `Status: ${resAdminRemoveMember.status}`
    );

    // Confirm document state: member is deleted
    const resCheckKickedGone = await clientGetDoc(
      'projectMembers',
      `${UID_MEMBER_TO_KICK}_${PROJ_ALPHA_1}`,
      tokenPlatformAdmin
    );
    check("[39] Confirmed document state: member document successfully removed by admin (404)",
      resCheckKickedGone.status === 404,
      `Status: ${resCheckKickedGone.status}`
    );

    // -------------------------------------------------------------------------
    // SECTION 8: TEAM & DEPARTMENT READS & LIST QUERIES (Step 3B.4H Part B)
    // -------------------------------------------------------------------------
    console.log("\n--- Section 8: Team & Department Reads & List Queries in Emulator ---");

    // Re-seed team and department in Alpha
    await adminSeedDoc('teams', 'team_alpha_read_1', {
      name: 'Alpha Mobile Team',
      orgId: ORG_ALPHA
    });
    await adminSeedDoc('departments', 'dept_alpha_read_1', {
      name: 'Alpha Engineering Dept',
      orgId: ORG_ALPHA
    });

    // Re-seed team and department in Beta
    await adminSeedDoc('teams', 'team_beta_read_1', {
      name: 'Beta Marketing Team',
      orgId: ORG_BETA
    });
    await adminSeedDoc('departments', 'dept_beta_read_1', {
      name: 'Beta Finance Dept',
      orgId: ORG_BETA
    });

    // Token for user from Beta organization
    const tokenBetaMember = makeMockJwt({ uid: 'usr_beta_regular', email: 'member@beta.com', orgId: ORG_BETA });
    await adminSeedDoc('orgMembers', `usr_beta_regular_${ORG_BETA}`, {
      userId: 'usr_beta_regular',
      orgId: ORG_BETA,
      role: 'member',
      status: 'active'
    });

    // Case 40: Authorized organization member can read team in their own organization
    const resMemberReadOwnTeam = await clientGetDoc(
      'teams',
      'team_alpha_read_1',
      tokenAlphaMember
    );
    check("[40] Authorized org member can read team in own organization (200)",
      resMemberReadOwnTeam.status === 200,
      `Status: ${resMemberReadOwnTeam.status}`
    );

    // Case 41: Authorized organization member can read department in their own organization
    const resMemberReadOwnDept = await clientGetDoc(
      'departments',
      'dept_alpha_read_1',
      tokenAlphaMember
    );
    check("[41] Authorized org member can read department in own organization (200)",
      resMemberReadOwnDept.status === 200,
      `Status: ${resMemberReadOwnDept.status}`
    );

    // Case 42: User from another organization cannot read team in Alpha (cross-org read denial)
    const resCrossOrgReadTeam = await clientGetDoc(
      'teams',
      'team_alpha_read_1',
      tokenBetaMember
    );
    check("[42] Cross-org user cannot read protected team (403)",
      resCrossOrgReadTeam.status === 403,
      `Status: ${resCrossOrgReadTeam.status}`
    );

    // Case 43: User from another organization cannot read department in Alpha (cross-org read denial)
    const resCrossOrgReadDept = await clientGetDoc(
      'departments',
      'dept_alpha_read_1',
      tokenBetaMember
    );
    check("[43] Cross-org user cannot read protected department (403)",
      resCrossOrgReadDept.status === 403,
      `Status: ${resCrossOrgReadDept.status}`
    );

    // Case 44: Unauthenticated read of team is denied (403)
    const resUnauthReadTeam = await clientGetDoc(
      'teams',
      'team_alpha_read_1'
    );
    check("[44] Unauthenticated read of team is rejected (403)",
      resUnauthReadTeam.status === 403,
      `Status: ${resUnauthReadTeam.status}`
    );

    // Case 45: Unauthenticated read of department is denied (403)
    const resUnauthReadDept = await clientGetDoc(
      'departments',
      'dept_alpha_read_1'
    );
    check("[45] Unauthenticated read of department is rejected (403)",
      resUnauthReadDept.status === 403,
      `Status: ${resUnauthReadDept.status}`
    );

    // Case 46: Structured query for teams scoped to user's orgId succeeds with matching document
    const queryTeamsAlpha = {
      structuredQuery: {
        from: [{ collectionId: 'teams' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'orgId' },
            op: 'EQUAL',
            value: { stringValue: ORG_ALPHA }
          }
        }
      }
    };
    const resQueryTeamsAlpha = await clientRunQuery(
      queryTeamsAlpha,
      tokenAlphaMember
    );
    const hasAlphaDoc = Array.isArray(resQueryTeamsAlpha.body) &&
      resQueryTeamsAlpha.body.some((item: any) => item.document?.name?.includes('team_alpha_read_1'));
    check("[46] Scoped list query for teams returns matching documents for authorized member (200)",
      resQueryTeamsAlpha.status === 200 && hasAlphaDoc,
      `Status: ${resQueryTeamsAlpha.status}, DocsFound: ${hasAlphaDoc}`
    );

    // Case 47: Unauthorized structured query for teams in another org is rejected (403)
    const resQueryTeamsAlphaByBeta = await clientRunQuery(
      queryTeamsAlpha,
      tokenBetaMember
    );
    check("[47] Unauthorized list query for teams in another organization is rejected (403)",
      resQueryTeamsAlphaByBeta.status === 403,
      `Status: ${resQueryTeamsAlphaByBeta.status}`
    );

    // Case 48: Authorized query for department in empty scope succeeds with 0 matching documents (distinguish from 403)
    const queryDeptsEmpty = {
      structuredQuery: {
        from: [{ collectionId: 'departments' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'orgId' },
            op: 'EQUAL',
            value: { stringValue: 'org_empty_999' }
          }
        }
      }
    };
    const tokenEmptyOrgMember = makeMockJwt({ uid: 'usr_empty_org', email: 'empty@test.com', orgId: 'org_empty_999' });
    const resQueryDeptsEmpty = await clientRunQuery(
      queryDeptsEmpty,
      tokenEmptyOrgMember
    );
    // When query succeeds with 0 results, Firestore returns 200 with stream terminator [{ readTime: "...", done: true }]
    const hasNoDocs = Array.isArray(resQueryDeptsEmpty.body) &&
      !resQueryDeptsEmpty.body.some((item: any) => item.document);
    check("[48] Scoped query on empty organization succeeds (200) with 0 documents returned (not 403)",
      resQueryDeptsEmpty.status === 200 && hasNoDocs,
      `Status: ${resQueryDeptsEmpty.status}, ReturnedDocs: ${!hasNoDocs}`
    );

    // Case 49: Unauthenticated list query for teams is rejected (403)
    const resUnauthQueryTeams = await clientRunQuery(queryTeamsAlpha);
    check("[49] Unauthenticated list query for teams is rejected (403)",
      resUnauthQueryTeams.status === 403,
      `Status: ${resUnauthQueryTeams.status}`
    );

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log(`📊 REAL EMULATOR TEST SUMMARY: ${passed} / ${passed + failed} PASSED (${failed} FAILED)`);
    console.log("================================================================================");

    if (failed > 0) {
      console.error("\nFailed assertions:");
      for (const f of failures) {
        console.error(` - ${f}`);
      }
      process.exitCode = 1;
    } else {
      console.log("🎉 ALL REAL EMULATOR SECURITY RULES SCENARIOS PASSED WITH RIGOROUS ENFORCEMENT!\n");
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
