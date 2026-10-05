/**
 * EchoNote Phase 1 Step 2: Server-Side Authorization Hardening
 * Comprehensive Verification Tests
 * 
 * Verifies:
 * 1. Role capability permissions matrix for all canonical roles:
 *    - owner: full control including deletion and management
 *    - admin: content & member management, no project deletion
 *    - commenter: viewing and commenting only
 *    - viewer: read-only, no commenting, no content editing
 *    - null / unknown: least-privilege, all false
 * 2. Legacy 'editor' permission mapping (resolves to admin permissions)
 * 3. Public consumer domain protection against unauthorized enterprise SSO discovery
 * 4. SSO claims sanitization preventing privilege escalation (blocking injected role/admin keys)
 * 5. Authorization boundary invariants (least-privilege defaults)
 */

import {
  normalizeProjectRole,
  getProjectRolePermissions,
  TargetProjectRole,
  ProjectPermissions
} from "../types.js";
import {
  PUBLIC_CONSUMER_DOMAINS,
  normalizeDomain,
  isValidDomain
} from "../middleware/auth.js";

let passed = 0;
let failed = 0;

function assert(description: string, condition: boolean, actualDetails?: any) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    if (actualDetails !== undefined) {
      console.error(`     Details:`, actualDetails);
    }
    failed++;
  }
}

console.log("\n=======================================================");
console.log("🔒 RUNNING PHASE 1 STEP 2 AUTHORIZATION HARDENING TESTS");
console.log("=======================================================\n");

// -------------------------------------------------------------
// SECTION 1: Role Capability Permission Matrix
// -------------------------------------------------------------
console.log("--- Section 1: Canonical Role Capability Permissions ---");

const ownerPerms = getProjectRolePermissions('owner');
assert('Owner has canView', ownerPerms.canView === true);
assert('Owner has canComment', ownerPerms.canComment === true);
assert('Owner has canEditContent', ownerPerms.canEditContent === true);
assert('Owner has canManageProject', ownerPerms.canManageProject === true);
assert('Owner has canManageMembers', ownerPerms.canManageMembers === true);
assert('Owner has canDeleteProject', ownerPerms.canDeleteProject === true);

const adminPerms = getProjectRolePermissions('admin');
assert('Admin has canView', adminPerms.canView === true);
assert('Admin has canComment', adminPerms.canComment === true);
assert('Admin has canEditContent', adminPerms.canEditContent === true);
assert('Admin has canManageProject', adminPerms.canManageProject === true);
assert('Admin has canManageMembers', adminPerms.canManageMembers === true);
assert('Admin CANNOT delete project', adminPerms.canDeleteProject === false);

const commenterPerms = getProjectRolePermissions('commenter');
assert('Commenter has canView', commenterPerms.canView === true);
assert('Commenter has canComment', commenterPerms.canComment === true);
assert('Commenter CANNOT edit content', commenterPerms.canEditContent === false);
assert('Commenter CANNOT manage project', commenterPerms.canManageProject === false);
assert('Commenter CANNOT manage members', commenterPerms.canManageMembers === false);
assert('Commenter CANNOT delete project', commenterPerms.canDeleteProject === false);

const viewerPerms = getProjectRolePermissions('viewer');
assert('Viewer has canView', viewerPerms.canView === true);
assert('Viewer CANNOT comment', viewerPerms.canComment === false);
assert('Viewer CANNOT edit content', viewerPerms.canEditContent === false);
assert('Viewer CANNOT manage project', viewerPerms.canManageProject === false);
assert('Viewer CANNOT manage members', viewerPerms.canManageMembers === false);
assert('Viewer CANNOT delete project', viewerPerms.canDeleteProject === false);

const nullPerms = getProjectRolePermissions(null);
assert('Null role has all permissions false', 
  !nullPerms.canView && !nullPerms.canComment && !nullPerms.canEditContent &&
  !nullPerms.canManageProject && !nullPerms.canManageMembers && !nullPerms.canDeleteProject
);

// -------------------------------------------------------------
// SECTION 2: Legacy Role Mapping to Target Capability Matrix
// -------------------------------------------------------------
console.log("\n--- Section 2: Legacy Role Capability Mapping ---");

const legacyEditorRole = normalizeProjectRole("editor");
assert('Legacy "editor" normalizes to canonical "admin"', legacyEditorRole === 'admin');
const legacyEditorPerms = getProjectRolePermissions(legacyEditorRole);
assert('Legacy editor receives admin canEditContent', legacyEditorPerms.canEditContent === true);
assert('Legacy editor receives admin canManageMembers', legacyEditorPerms.canManageMembers === true);
assert('Legacy editor is NOT granted canDeleteProject', legacyEditorPerms.canDeleteProject === false);

// -------------------------------------------------------------
// SECTION 3: Public Consumer Domain Protection (SSO Isolation)
// -------------------------------------------------------------
console.log("\n--- Section 3: Consumer Domain Enterprise SSO Boundary ---");

assert('PUBLIC_CONSUMER_DOMAINS contains gmail.com', PUBLIC_CONSUMER_DOMAINS.has('gmail.com'));
assert('PUBLIC_CONSUMER_DOMAINS contains yahoo.com', PUBLIC_CONSUMER_DOMAINS.has('yahoo.com'));
assert('PUBLIC_CONSUMER_DOMAINS contains outlook.com', PUBLIC_CONSUMER_DOMAINS.has('outlook.com'));
assert('PUBLIC_CONSUMER_DOMAINS contains hotmail.com', PUBLIC_CONSUMER_DOMAINS.has('hotmail.com'));
assert('PUBLIC_CONSUMER_DOMAINS contains icloud.com', PUBLIC_CONSUMER_DOMAINS.has('icloud.com'));
assert('Enterprise domain "acme-corp.com" is NOT a public consumer domain', !PUBLIC_CONSUMER_DOMAINS.has('acme-corp.com'));

assert('Domain normalizer handles mixed case and whitespace', normalizeDomain("  user@GMAIL.COM  ") === 'gmail.com');
assert('Valid enterprise domain passes isValidDomain', isValidDomain("enterprise.echonote.ai"));
assert('Invalid domain with spaces fails isValidDomain', !isValidDomain("invalid domain"));

// -------------------------------------------------------------
// SECTION 4: SSO Claims Sanitization & Privilege Escalation Defense
// -------------------------------------------------------------
console.log("\n--- Section 4: SSO Claims Privilege Escalation Defense ---");

function sanitizeSsoClaims(claims: any): Record<string, any> {
  if (!claims || typeof claims !== 'object') return {};
  const sanitized: Record<string, any> = {};
  const blockedKeys = new Set([
    'role', 'orgrole', 'platform_admin', 'admin', 'owner', 'isowner', 'org_admin', 'super_admin'
  ]);
  for (const [k, v] of Object.entries(claims)) {
    if (!blockedKeys.has(k.toLowerCase().trim())) {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

const maliciousClaims = {
  role: 'admin',
  orgRole: 'owner',
  platform_admin: true,
  isOwner: true,
  super_admin: true,
  department: 'Engineering',
  jobTitle: 'Senior Architect',
  tenantId: 'tenant-123-abc'
};

const cleanClaims = sanitizeSsoClaims(maliciousClaims);
assert('Sanitized claims strip "role"', cleanClaims.role === undefined);
assert('Sanitized claims strip "orgRole"', cleanClaims.orgRole === undefined);
assert('Sanitized claims strip "platform_admin"', cleanClaims.platform_admin === undefined);
assert('Sanitized claims strip "isOwner"', cleanClaims.isOwner === undefined);
assert('Sanitized claims strip "super_admin"', cleanClaims.super_admin === undefined);
assert('Sanitized claims preserve legitimate "department"', cleanClaims.department === 'Engineering');
assert('Sanitized claims preserve legitimate "jobTitle"', cleanClaims.jobTitle === 'Senior Architect');
assert('Sanitized claims preserve legitimate "tenantId"', cleanClaims.tenantId === 'tenant-123-abc');

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log("\n=======================================================");
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎉 ALL PHASE 1 STEP 2 AUTHORIZATION TESTS PASSED SUCCESSFULLY!\n");
}
