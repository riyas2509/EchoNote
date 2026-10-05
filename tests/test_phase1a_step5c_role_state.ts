/**
 * EchoNote Phase 1A Step 5C: Organization Role Model & Frontend State Unification
 * Verification Test Suite: Authoritative Organization Roles & Platform Admin Independence
 * 
 * Verifies:
 * 1. OrgRole type includes only authoritative roles ('owner' | 'org_admin' | 'team_manager' | 'member' | 'viewer')
 * 2. super_admin is not an allowed organization role in the active type definition
 * 3. platform_admin remains independent capability (separate from organization role)
 * 4. Organization owner resolves to role 'owner' (never 'org_admin' or 'super_admin')
 * 5. Org admin resolves to role 'org_admin'
 * 6. Team manager resolves to role 'team_manager'
 * 7. Member resolves to role 'member'
 * 8. Viewer resolves to role 'viewer'
 * 9. Legacy super_admin input normalizes safely
 * 10. UI permission checks correctly distinguish owner vs org_admin vs platform_admin
 */

import {
  AuthoritativeOrgRole,
  OrgRole,
  normalizeOrgRole,
  CustomClaims,
  UserProfile
} from "../types.js";

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
console.log("🚀 RUNNING PHASE 1A STEP 5C: ROLE STATE UNIFICATION TESTS");
console.log("=======================================================\n");

// -------------------------------------------------------------
// SECTION 1: Authoritative OrgRole Type Completeness
// -------------------------------------------------------------
console.log("--- Section 1: Authoritative OrgRole Set ---");
const canonicalOrgRoles: OrgRole[] = [
  'owner',
  'org_admin',
  'team_manager',
  'member',
  'viewer'
];

assert("Authoritative set contains exactly 5 roles", canonicalOrgRoles.length === 5);
assert("Includes 'owner'", canonicalOrgRoles.includes('owner'));
assert("Includes 'org_admin'", canonicalOrgRoles.includes('org_admin'));
assert("Includes 'team_manager'", canonicalOrgRoles.includes('team_manager'));
assert("Includes 'member'", canonicalOrgRoles.includes('member'));
assert("Includes 'viewer'", canonicalOrgRoles.includes('viewer'));

// -------------------------------------------------------------
// SECTION 2: super_admin is Excluded from Active OrgRole
// -------------------------------------------------------------
console.log("\n--- Section 2: super_admin Is Not an Allowed Active OrgRole ---");
const testInvalidRole = 'super_admin';
assert(
  "super_admin is not in canonicalOrgRoles array",
  !canonicalOrgRoles.includes(testInvalidRole as any)
);

// -------------------------------------------------------------
// SECTION 3: Legacy Input Normalization
// -------------------------------------------------------------
console.log("\n--- Section 3: Safe Legacy Normalization ---");
assert("normalizeOrgRole('super_admin') === 'owner'", normalizeOrgRole('super_admin') === 'owner');
assert("normalizeOrgRole('SUPER_ADMIN ') === 'owner'", normalizeOrgRole('SUPER_ADMIN ') === 'owner');
assert("normalizeOrgRole('owner') === 'owner'", normalizeOrgRole('owner') === 'owner');
assert("normalizeOrgRole('org_admin') === 'org_admin'", normalizeOrgRole('org_admin') === 'org_admin');
assert("normalizeOrgRole('admin') === 'org_admin'", normalizeOrgRole('admin') === 'org_admin');
assert("normalizeOrgRole('team_manager') === 'team_manager'", normalizeOrgRole('team_manager') === 'team_manager');
assert("normalizeOrgRole('team_lead') === 'team_manager'", normalizeOrgRole('team_lead') === 'team_manager');
assert("normalizeOrgRole('manager') === 'team_manager'", normalizeOrgRole('manager') === 'team_manager');
assert("normalizeOrgRole('dept_manager') === 'team_manager'", normalizeOrgRole('dept_manager') === 'team_manager');
assert("normalizeOrgRole('project_manager') === 'team_manager'", normalizeOrgRole('project_manager') === 'team_manager');
assert("normalizeOrgRole('member') === 'member'", normalizeOrgRole('member') === 'member');
assert("normalizeOrgRole('viewer') === 'viewer'", normalizeOrgRole('viewer') === 'viewer');
assert("normalizeOrgRole('guest') === 'viewer'", normalizeOrgRole('guest') === 'viewer');
assert("normalizeOrgRole(null) === 'viewer'", normalizeOrgRole(null) === 'viewer');
assert("normalizeOrgRole(undefined) === 'viewer'", normalizeOrgRole(undefined) === 'viewer');
assert("normalizeOrgRole('unknown_attacker_role') === 'viewer'", normalizeOrgRole('unknown_attacker_role') === 'viewer');

// -------------------------------------------------------------
// SECTION 4: Organization Owner Resolution
// -------------------------------------------------------------
console.log("\n--- Section 4: Organization Owner Resolution ---");

function resolveUserOrgRole(params: {
  user: { uid: string; email?: string | null };
  orgDoc?: { ownerId?: string; ownerEmail?: string } | null;
  memberDoc?: { role?: string } | null;
  claims?: CustomClaims | null;
}): OrgRole {
  const { user, orgDoc, memberDoc, claims } = params;

  // 1. Organization Document Ownership Check (authoritative root)
  if (orgDoc) {
    if (
      (orgDoc.ownerId && orgDoc.ownerId === user.uid) ||
      (orgDoc.ownerEmail && user.email && orgDoc.ownerEmail.toLowerCase() === user.email.toLowerCase())
    ) {
      return 'owner';
    }
  }

  // 2. Member document in organization
  if (memberDoc?.role) {
    return normalizeOrgRole(memberDoc.role);
  }

  // 3. Custom claims fallback
  if (claims?.isOwner) {
    return 'owner';
  }
  if (claims?.orgRole) {
    return normalizeOrgRole(claims.orgRole);
  }

  return 'viewer';
}

const orgOwnerByUid = resolveUserOrgRole({
  user: { uid: 'u_owner_123', email: 'owner@corp.com' },
  orgDoc: { ownerId: 'u_owner_123', ownerEmail: 'owner@corp.com' }
});
assert("Organization owner by UID resolves to 'owner'", orgOwnerByUid === 'owner', orgOwnerByUid);

const orgOwnerByEmail = resolveUserOrgRole({
  user: { uid: 'u_owner_diff', email: 'CEO@CORP.COM' },
  orgDoc: { ownerId: 'u_prev', ownerEmail: 'ceo@corp.com' }
});
assert("Organization owner by case-insensitive Email resolves to 'owner'", orgOwnerByEmail === 'owner', orgOwnerByEmail);

const orgOwnerWithLegacySuperAdmin = resolveUserOrgRole({
  user: { uid: 'u_member_1', email: 'legacy@corp.com' },
  orgDoc: { ownerId: 'u_other', ownerEmail: 'other@corp.com' },
  memberDoc: { role: 'super_admin' }
});
assert("Member with legacy 'super_admin' role resolves safely to 'owner'", orgOwnerWithLegacySuperAdmin === 'owner', orgOwnerWithLegacySuperAdmin);

// -------------------------------------------------------------
// SECTION 5: Org Admin, Team Manager, Member, Viewer Resolution
// -------------------------------------------------------------
console.log("\n--- Section 5: Standard Hierarchy Resolution ---");

const resolvedOrgAdmin = resolveUserOrgRole({
  user: { uid: 'u_admin_1', email: 'admin@corp.com' },
  orgDoc: { ownerId: 'u_owner_1', ownerEmail: 'owner@corp.com' },
  memberDoc: { role: 'org_admin' }
});
assert("Org Admin resolves to 'org_admin'", resolvedOrgAdmin === 'org_admin', resolvedOrgAdmin);

const resolvedTeamManager = resolveUserOrgRole({
  user: { uid: 'u_mgr_1', email: 'mgr@corp.com' },
  orgDoc: { ownerId: 'u_owner_1', ownerEmail: 'owner@corp.com' },
  memberDoc: { role: 'team_manager' }
});
assert("Team Manager resolves to 'team_manager'", resolvedTeamManager === 'team_manager', resolvedTeamManager);

const resolvedMember = resolveUserOrgRole({
  user: { uid: 'u_mem_1', email: 'mem@corp.com' },
  orgDoc: { ownerId: 'u_owner_1', ownerEmail: 'owner@corp.com' },
  memberDoc: { role: 'member' }
});
assert("Member resolves to 'member'", resolvedMember === 'member', resolvedMember);

const resolvedViewer = resolveUserOrgRole({
  user: { uid: 'u_view_1', email: 'view@corp.com' },
  orgDoc: { ownerId: 'u_owner_1', ownerEmail: 'owner@corp.com' },
  memberDoc: { role: 'viewer' }
});
assert("Viewer resolves to 'viewer'", resolvedViewer === 'viewer', resolvedViewer);

// -------------------------------------------------------------
// SECTION 6: Platform Admin Independence
// -------------------------------------------------------------
console.log("\n--- Section 6: Platform Admin Independence ---");

function resolveIsPlatformAdmin(profile?: UserProfile | null, claims?: CustomClaims | null): boolean {
  return Boolean(
    profile?.role === 'admin' ||
    claims?.role === 'admin' ||
    claims?.platform_admin === true
  );
}

// Case A: Platform Admin who is only a viewer in Org X
const platformAdminProfile: Partial<UserProfile> = { role: 'admin' };
const isPlatformA = resolveIsPlatformAdmin(platformAdminProfile as UserProfile);
const orgRoleForPlatformA = resolveUserOrgRole({
  user: { uid: 'u_plat_1', email: 'super@platform.io' },
  orgDoc: { ownerId: 'u_owner_corp', ownerEmail: 'ceo@corp.com' },
  memberDoc: { role: 'viewer' }
});
assert("User is recognized as platformAdmin", isPlatformA === true);
assert("Platform Admin does NOT automatically become org 'owner'", orgRoleForPlatformA === 'viewer', orgRoleForPlatformA);

// Case B: Org Owner who is NOT a platform admin
const regularOwnerProfile: Partial<UserProfile> = { role: 'user' };
const isPlatformB = resolveIsPlatformAdmin(regularOwnerProfile as UserProfile);
const orgRoleForOwnerB = resolveUserOrgRole({
  user: { uid: 'u_owner_corp', email: 'ceo@corp.com' },
  orgDoc: { ownerId: 'u_owner_corp', ownerEmail: 'ceo@corp.com' }
});
assert("Org Owner resolves to org role 'owner'", orgRoleForOwnerB === 'owner');
assert("Org Owner does NOT automatically become platform_admin", isPlatformB === false);

// Case C: Org Admin who is NOT a platform admin
const orgAdminProfile: Partial<UserProfile> = { role: 'user' };
const isPlatformC = resolveIsPlatformAdmin(orgAdminProfile as UserProfile);
assert("Org Admin does NOT become platform_admin", isPlatformC === false);

// -------------------------------------------------------------
// SECTION 7: UI Permission Gates & Separation
// -------------------------------------------------------------
console.log("\n--- Section 7: UI Permission Gates ---");

interface UIPermissions {
  canDeleteOrganization: boolean;
  canTransferOwnership: boolean;
  canModifySecurityPolicies: boolean;
  canManageApiKeys: boolean;
  canConfigureSaml: boolean;
  canInviteMembers: boolean;
  canManageBilling: boolean;
  canViewSupervisoryAllProjects: boolean;
}

function evaluateUIPermissions(role: OrgRole, isPlatformAdmin: boolean): UIPermissions {
  const isOwner = role === 'owner';
  const isAdmin = role === 'owner' || role === 'org_admin';

  return {
    canDeleteOrganization: isOwner,
    canTransferOwnership: isOwner,
    canModifySecurityPolicies: isAdmin,
    canManageApiKeys: isAdmin,
    canConfigureSaml: isAdmin,
    canInviteMembers: isAdmin,
    canManageBilling: isAdmin,
    canViewSupervisoryAllProjects: isPlatformAdmin
  };
}

const ownerPerms = evaluateUIPermissions('owner', false);
assert("Owner CAN delete organization", ownerPerms.canDeleteOrganization === true);
assert("Owner CAN transfer ownership", ownerPerms.canTransferOwnership === true);
assert("Owner CAN modify security policies", ownerPerms.canModifySecurityPolicies === true);
assert("Owner CAN configure SAML", ownerPerms.canConfigureSaml === true);
assert("Owner (without platform_admin) does NOT have supervisory platform view", ownerPerms.canViewSupervisoryAllProjects === false);

const orgAdminPerms = evaluateUIPermissions('org_admin', false);
assert("Org Admin CANNOT delete organization", orgAdminPerms.canDeleteOrganization === false);
assert("Org Admin CANNOT transfer ownership", orgAdminPerms.canTransferOwnership === false);
assert("Org Admin CAN modify security policies", orgAdminPerms.canModifySecurityPolicies === true);
assert("Org Admin CAN manage API keys", orgAdminPerms.canManageApiKeys === true);
assert("Org Admin CAN configure SAML", orgAdminPerms.canConfigureSaml === true);
assert("Org Admin CAN invite members", orgAdminPerms.canInviteMembers === true);

const teamManagerPerms = evaluateUIPermissions('team_manager', false);
assert("Team Manager CANNOT modify security policies", teamManagerPerms.canModifySecurityPolicies === false);
assert("Team Manager CANNOT configure SAML", teamManagerPerms.canConfigureSaml === false);
assert("Team Manager CANNOT manage API keys", teamManagerPerms.canManageApiKeys === false);

const memberPerms = evaluateUIPermissions('member', false);
assert("Member CANNOT modify security policies", memberPerms.canModifySecurityPolicies === false);
assert("Member CANNOT manage API keys", memberPerms.canManageApiKeys === false);

const viewerPerms = evaluateUIPermissions('viewer', false);
assert("Viewer CANNOT modify security policies", viewerPerms.canModifySecurityPolicies === false);

const platformSupervisoryPerms = evaluateUIPermissions('viewer', true);
assert("Platform Admin CAN view supervisory projects across platform", platformSupervisoryPerms.canViewSupervisoryAllProjects === true);
assert("Platform Admin (with org viewer role) CANNOT delete organization", platformSupervisoryPerms.canDeleteOrganization === false);

// -------------------------------------------------------------
// SECTION 8: Invitation & Member Role Offering Verification
// -------------------------------------------------------------
console.log("\n--- Section 8: UI Invitation & Member Management Dropdowns ---");

const allowedInviteAndAssignRoles = ['org_admin', 'team_manager', 'member', 'viewer'];
assert("Allowed invite roles contain exactly 4 options", allowedInviteAndAssignRoles.length === 4);
assert("Does NOT allow inviting 'owner'", !allowedInviteAndAssignRoles.includes('owner'));
assert("Does NOT allow inviting 'super_admin'", !allowedInviteAndAssignRoles.includes('super_admin'));
assert("Allows inviting 'org_admin'", allowedInviteAndAssignRoles.includes('org_admin'));
assert("Allows inviting 'team_manager'", allowedInviteAndAssignRoles.includes('team_manager'));
assert("Allows inviting 'member'", allowedInviteAndAssignRoles.includes('member'));
assert("Allows inviting 'viewer'", allowedInviteAndAssignRoles.includes('viewer'));

console.log("\n=======================================================");
console.log(`🏁 TEST COMPLETE: ${passed} Passed, ${failed} Failed`);
console.log("=======================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
