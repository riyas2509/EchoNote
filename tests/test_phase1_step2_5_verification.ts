/**
 * EchoNote Phase 1 Step 2.5: Server-Side Authorization Verification
 * Comprehensive Security & Runtime Enforcement Test Suite
 * 
 * Verifies that the Step 2 authorization implementation strictly enforces
 * all architectural boundaries at runtime without relying on client assertions.
 */

import {
  normalizeProjectRole,
  getProjectRolePermissions,
  TargetProjectRole,
  ProjectPermission,
  ProjectPermissions,
  ProjectAccessResolution
} from "../types.js";

import {
  resolveProjectAccess,
  authorizeRecordingAccess,
  verifyAiResourceAccess,
  sanitizeSsoClaims,
  checkOrgAccess,
  PUBLIC_CONSUMER_DOMAINS,
  normalizeDomain,
  isValidDomain,
  ROLE_HIERARCHY,
  normalizeOrgRole
} from "../middleware/auth.js";

import { evaluateIdentityMappings } from "../lib/jitProvisioning.js";

// ============================================================================
// IN-MEMORY MOCK FIRESTORE ENGINE
// ============================================================================

class MockDocSnapshot {
  constructor(public id: string, private _data: any) {}
  get exists(): boolean {
    return this._data !== undefined && this._data !== null;
  }
  data(): any {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined;
  }
  get ref() {
    return { id: this.id };
  }
}

class MockQuerySnapshot {
  constructor(public docs: MockDocSnapshot[]) {}
  get empty(): boolean {
    return this.docs.length === 0;
  }
  get size(): number {
    return this.docs.length;
  }
}

class MockCollectionReference {
  constructor(private db: MockFirestore, private collectionName: string) {}

  doc(id: string) {
    const collName = this.collectionName;
    const db = this.db;
    return {
      id,
      get: async () => {
        const data = db.store.get(`${collName}/${id}`);
        return new MockDocSnapshot(id, data);
      },
      set: async (data: any, options?: { merge?: boolean }) => {
        const existing = db.store.get(`${collName}/${id}`);
        if (options?.merge && existing) {
          db.store.set(`${collName}/${id}`, { ...existing, ...data });
        } else {
          db.store.set(`${collName}/${id}`, data);
        }
      },
      update: async (data: any) => {
        const existing = db.store.get(`${collName}/${id}`);
        if (!existing) throw new Error(`Document ${collName}/${id} not found for update`);
        db.store.set(`${collName}/${id}`, { ...existing, ...data });
      },
      delete: async () => {
        db.store.delete(`${collName}/${id}`);
      }
    };
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionName, [{ field, op, val }]);
  }

  async get() {
    return new MockQuery(this.db, this.collectionName, []).get();
  }

  async add(data: any) {
    const id = `mock_auto_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.db.store.set(`${this.collectionName}/${id}`, data);
    return { id };
  }
}

class MockQuery {
  private _limit?: number;

  constructor(
    private db: MockFirestore,
    private collectionName: string,
    private filters: Array<{ field: string; op: string; val: any }>
  ) {}

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionName, [...this.filters, { field, op, val }]);
  }

  limit(n: number) {
    this._limit = n;
    return this;
  }

  async get(): Promise<MockQuerySnapshot> {
    const docs: MockDocSnapshot[] = [];
    const prefix = `${this.collectionName}/`;

    for (const [key, val] of this.db.store.entries()) {
      if (key.startsWith(prefix)) {
        const id = key.substring(prefix.length);
        let match = true;

        for (const filter of this.filters) {
          const itemVal = val ? val[filter.field] : undefined;
          if (filter.op === "==") {
            if (itemVal !== filter.val) {
              match = false;
              break;
            }
          } else if (filter.op === "!=") {
            if (itemVal === filter.val) {
              match = false;
              break;
            }
          }
        }

        if (match) {
          docs.push(new MockDocSnapshot(id, val));
          if (this._limit && docs.length >= this._limit) {
            break;
          }
        }
      }
    }

    return new MockQuerySnapshot(docs);
  }
}

class MockFirestore {
  public store = new Map<string, any>();

  collection(name: string) {
    return new MockCollectionReference(this, name);
  }

  batch() {
    const operations: Array<() => void> = [];
    return {
      set: (docRef: any, data: any, options?: any) => {
        operations.push(() => docRef.set(data, options));
        return this;
      },
      update: (docRef: any, data: any) => {
        operations.push(() => docRef.update(data));
        return this;
      },
      delete: (docRef: any) => {
        operations.push(() => docRef.delete());
        return this;
      },
      commit: async () => {
        for (const op of operations) op();
      }
    };
  }

  reset() {
    this.store.clear();
  }
}

// ============================================================================
// TEST HARNESS & RUNNER
// ============================================================================

let passedCount = 0;
let failedCount = 0;
const failures: string[] = [];

function assertTest(name: string, condition: boolean, detail?: any) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${name}`);
    if (detail !== undefined) {
      console.error(`     Details:`, detail);
    }
    failedCount++;
    failures.push(name);
  }
}

// ============================================================================
// MAIN TEST SUITE
// ============================================================================

export async function runStep2_5VerificationSuite() {
  console.log("\n===============================================================");
  console.log("🔒 RUNNING PHASE 1 STEP 2.5: SERVER-SIDE AUTHORIZATION VERIFICATION");
  console.log("===============================================================\n");

  const mockDb = new MockFirestore();
  const db = mockDb as any;

  // --------------------------------------------------------------------------
  // SETUP FIXTURES
  // --------------------------------------------------------------------------
  // Organization A (Acme Corp)
  mockDb.store.set("organizations/org_acme", {
    id: "org_acme",
    name: "Acme Corp",
    ownerId: "user_org_owner_acme",
    ownerEmail: "owner@acmewidgets.com"
  });
  // Organization B (Beta Industries)
  mockDb.store.set("organizations/org_beta", {
    id: "org_beta",
    name: "Beta Industries",
    ownerId: "user_org_owner_beta",
    ownerEmail: "owner@betaindustries.com"
  });

  // Org Members for Org Acme
  mockDb.store.set("orgMembers/org_acme_user_org_owner_acme", {
    orgId: "org_acme",
    userId: "user_org_owner_acme",
    email: "owner@acmewidgets.com",
    role: "owner",
    status: "active"
  });
  mockDb.store.set("orgMembers/org_acme_user_org_admin_acme", {
    orgId: "org_acme",
    userId: "user_org_admin_acme",
    email: "admin@acmewidgets.com",
    role: "org_admin",
    status: "active"
  });
  mockDb.store.set("orgMembers/org_acme_user_org_member_acme", {
    orgId: "org_acme",
    userId: "user_org_member_acme",
    email: "member@acmewidgets.com",
    role: "member",
    status: "active"
  });

  // Org Members for Org Beta
  mockDb.store.set("orgMembers/org_beta_user_beta_member", {
    orgId: "org_beta",
    userId: "user_beta_member",
    email: "user@betaindustries.com",
    role: "member",
    status: "active"
  });

  // Project in Org Acme: proj_acme_alpha
  mockDb.store.set("projects/proj_acme_alpha", {
    id: "proj_acme_alpha",
    name: "Alpha Strategic Audio",
    orgId: "org_acme",
    organizationId: "org_acme",
    userId: "user_proj_owner",
    ownerEmail: "proj_owner@acmewidgets.com"
  });

  // Users
  mockDb.store.set("users/user_proj_owner", { uid: "user_proj_owner", email: "proj_owner@acmewidgets.com" });
  mockDb.store.set("users/user_proj_admin", { uid: "user_proj_admin", email: "proj_admin@acmewidgets.com" });
  mockDb.store.set("users/user_proj_commenter", { uid: "user_proj_commenter", email: "proj_commenter@acmewidgets.com" });
  mockDb.store.set("users/user_proj_viewer", { uid: "user_proj_viewer", email: "proj_viewer@acmewidgets.com" });
  mockDb.store.set("users/user_proj_legacy_editor", { uid: "user_proj_legacy_editor", email: "proj_editor@acmewidgets.com" });
  mockDb.store.set("users/user_proj_invalid_role", { uid: "user_proj_invalid_role", email: "proj_invalid@acmewidgets.com" });
  mockDb.store.set("users/user_org_member_acme", { uid: "user_org_member_acme", email: "member@acmewidgets.com" });
  mockDb.store.set("users/user_beta_member", { uid: "user_beta_member", email: "user@betaindustries.com" });
  mockDb.store.set("users/user_platform_admin", { uid: "user_platform_admin", email: "sec_ops@echonote.ai", platform_admin: true, role: "admin" });

  // Project Members for proj_acme_alpha
  mockDb.store.set("projectMembers/user_proj_owner_proj_acme_alpha", {
    projectId: "proj_acme_alpha",
    userId: "user_proj_owner",
    email: "proj_owner@acmewidgets.com",
    role: "owner"
  });
  mockDb.store.set("projectMembers/user_proj_admin_proj_acme_alpha", {
    projectId: "proj_acme_alpha",
    userId: "user_proj_admin",
    email: "proj_admin@acmewidgets.com",
    role: "admin"
  });
  mockDb.store.set("projectMembers/user_proj_commenter_proj_acme_alpha", {
    projectId: "proj_acme_alpha",
    userId: "user_proj_commenter",
    email: "proj_commenter@acmewidgets.com",
    role: "commenter"
  });
  mockDb.store.set("projectMembers/user_proj_viewer_proj_acme_alpha", {
    projectId: "proj_acme_alpha",
    userId: "user_proj_viewer",
    email: "proj_viewer@acmewidgets.com",
    role: "viewer"
  });
  mockDb.store.set("projectMembers/user_proj_legacy_editor_proj_acme_alpha", {
    projectId: "proj_acme_alpha",
    userId: "user_proj_legacy_editor",
    email: "proj_editor@acmewidgets.com",
    role: "editor" // Legacy role
  });
  mockDb.store.set("projectMembers/user_proj_invalid_role_proj_acme_alpha", {
    projectId: "proj_acme_alpha",
    userId: "user_proj_invalid_role",
    email: "proj_invalid@acmewidgets.com",
    role: "super_ninja_god_mode" // Unknown/invalid role
  });

  // Ensure all project members are also registered in Org Acme for tenant consistency
  mockDb.store.set("orgMembers/org_acme_user_proj_owner", {
    orgId: "org_acme",
    userId: "user_proj_owner",
    email: "proj_owner@acmewidgets.com",
    role: "member",
    status: "active"
  });
  mockDb.store.set("orgMembers/org_acme_user_proj_admin", {
    orgId: "org_acme",
    userId: "user_proj_admin",
    email: "proj_admin@acmewidgets.com",
    role: "member",
    status: "active"
  });
  mockDb.store.set("orgMembers/org_acme_user_proj_commenter", {
    orgId: "org_acme",
    userId: "user_proj_commenter",
    email: "proj_commenter@acmewidgets.com",
    role: "member",
    status: "active"
  });
  mockDb.store.set("orgMembers/org_acme_user_proj_viewer", {
    orgId: "org_acme",
    userId: "user_proj_viewer",
    email: "proj_viewer@acmewidgets.com",
    role: "member",
    status: "active"
  });
  mockDb.store.set("orgMembers/org_acme_user_proj_legacy_editor", {
    orgId: "org_acme",
    userId: "user_proj_legacy_editor",
    email: "proj_editor@acmewidgets.com",
    role: "member",
    status: "active"
  });
  mockDb.store.set("orgMembers/org_acme_user_proj_invalid_role", {
    orgId: "org_acme",
    userId: "user_proj_invalid_role",
    email: "proj_invalid@acmewidgets.com",
    role: "member",
    status: "active"
  });

  // ==========================================================================
  // SECTION 1: TEST PROJECT ACCESS RESOLUTION (resolveProjectAccess)
  // ==========================================================================
  console.log("--- SECTION 1: PROJECT ACCESS RESOLUTION (resolveProjectAccess) ---");

  // 1A. Project Owner
  {
    const res = await resolveProjectAccess(db, { uid: "user_proj_owner", email: "proj_owner@acmewidgets.com" }, "proj_acme_alpha");
    assertTest("1A. Project Owner has access", res.hasAccess === true);
    assertTest("1A. Project Owner resolved role is 'owner'", res.role === 'owner');
    assertTest("1A. Project Owner isOwner is true", res.isOwner === true);
    assertTest("1A. Project Owner canView is true", res.permissions.canView === true);
    assertTest("1A. Project Owner canComment is true", res.permissions.canComment === true);
    assertTest("1A. Project Owner canEditContent is true", res.permissions.canEditContent === true);
    assertTest("1A. Project Owner canManageMembers is true", res.permissions.canManageMembers === true);
    assertTest("1A. Project Owner canDeleteProject is true", res.permissions.canDeleteProject === true);
  }

  // 1B. Project Admin
  {
    const res = await resolveProjectAccess(db, { uid: "user_proj_admin", email: "proj_admin@acmewidgets.com" }, "proj_acme_alpha");
    assertTest("1B. Project Admin has access", res.hasAccess === true);
    assertTest("1B. Project Admin resolved role is 'admin'", res.role === 'admin');
    assertTest("1B. Project Admin canView is true", res.permissions.canView === true);
    assertTest("1B. Project Admin canComment is true", res.permissions.canComment === true);
    assertTest("1B. Project Admin canEditContent is true", res.permissions.canEditContent === true);
    assertTest("1B. Project Admin canManageMembers is true", res.permissions.canManageMembers === true);
    assertTest("1B. Project Admin CANNOT delete project", res.permissions.canDeleteProject === false);
  }

  // 1C. Project Commenter
  {
    const res = await resolveProjectAccess(db, { uid: "user_proj_commenter", email: "proj_commenter@acmewidgets.com" }, "proj_acme_alpha");
    assertTest("1C. Project Commenter has access", res.hasAccess === true);
    assertTest("1C. Project Commenter resolved role is 'commenter'", res.role === 'commenter');
    assertTest("1C. Project Commenter canView is true", res.permissions.canView === true);
    assertTest("1C. Project Commenter canComment is true", res.permissions.canComment === true);
    assertTest("1C. Project Commenter CANNOT edit content", res.permissions.canEditContent === false);
    assertTest("1C. Project Commenter CANNOT manage members", res.permissions.canManageMembers === false);
    assertTest("1C. Project Commenter CANNOT delete project", res.permissions.canDeleteProject === false);
  }

  // 1D. Project Viewer
  {
    const res = await resolveProjectAccess(db, { uid: "user_proj_viewer", email: "proj_viewer@acmewidgets.com" }, "proj_acme_alpha");
    assertTest("1D. Project Viewer has access", res.hasAccess === true);
    assertTest("1D. Project Viewer resolved role is 'viewer'", res.role === 'viewer');
    assertTest("1D. Project Viewer canView is true", res.permissions.canView === true);
    assertTest("1D. Project Viewer CANNOT comment", res.permissions.canComment === false);
    assertTest("1D. Project Viewer CANNOT edit content", res.permissions.canEditContent === false);
    assertTest("1D. Project Viewer CANNOT manage members", res.permissions.canManageMembers === false);
    assertTest("1D. Project Viewer CANNOT delete project", res.permissions.canDeleteProject === false);
  }

  // 1E. No Project Membership (Ordinary Org Member)
  {
    const res = await resolveProjectAccess(db, { uid: "user_org_member_acme", email: "member@acmewidgets.com" }, "proj_acme_alpha");
    assertTest("1E. Ordinary org member without project membership is DENIED project access", res.hasAccess === false);
    assertTest("1E. Role is null for non-member", res.role === null);
  }

  // 1F. Organization Owner / Admin
  {
    const ownerRes = await resolveProjectAccess(db, { uid: "user_org_owner_acme", email: "owner@acmewidgets.com" }, "proj_acme_alpha");
    assertTest("1F. Org Owner has supervisory project access", ownerRes.hasAccess === true);
    assertTest("1F. Org Owner has admin/supervisory permissions", ownerRes.permissions.canManageProject === true && ownerRes.permissions.canDeleteProject === true);

    const adminRes = await resolveProjectAccess(db, { uid: "user_org_admin_acme", email: "admin@acmewidgets.com" }, "proj_acme_alpha");
    assertTest("1F. Org Admin has supervisory project access", adminRes.hasAccess === true);
    assertTest("1F. Org Admin canManageMembers is true", adminRes.permissions.canManageMembers === true);
  }

  // 1G. Platform Administrator Override
  {
    const platRes = await resolveProjectAccess(db, { uid: "user_platform_admin", email: "sec_ops@echonote.ai", platform_admin: true, role: "admin" }, "proj_acme_alpha");
    assertTest("1G. Platform admin has override access", platRes.hasAccess === true);
    assertTest("1G. Platform admin isPlatformAdmin is true", platRes.isPlatformAdmin === true);
    assertTest("1G. Platform admin has canDeleteProject", platRes.permissions.canDeleteProject === true);

    // Regular user asserting platform_admin: false or absent
    const regularUserRes = await resolveProjectAccess(db, { uid: "user_beta_member", email: "user@betaindustries.com", platform_admin: false }, "proj_acme_alpha");
    assertTest("1G. False platform admin assertion fails override", regularUserRes.isPlatformAdmin === false);
  }

  // 1H. Cross-Organization User
  {
    const crossRes = await resolveProjectAccess(db, { uid: "user_beta_member", email: "user@betaindustries.com" }, "proj_acme_alpha");
    assertTest("1H. Cross-organization user is DENIED access to Org Acme project", crossRes.hasAccess === false);
    assertTest("1H. Reason mentions tenant isolation", crossRes.reason?.includes("Tenant isolation") === true);
  }

  // 1I. Legacy Role ("editor" -> admin)
  {
    const legacyRes = await resolveProjectAccess(db, { uid: "user_proj_legacy_editor", email: "proj_editor@acmewidgets.com" }, "proj_acme_alpha");
    assertTest("1I. Legacy 'editor' has access", legacyRes.hasAccess === true);
    assertTest("1I. Legacy 'editor' normalizes to 'admin'", legacyRes.role === 'admin');
    assertTest("1I. Legacy 'editor' receives canEditContent", legacyRes.permissions.canEditContent === true);
    assertTest("1I. Legacy 'editor' receives canManageMembers", legacyRes.permissions.canManageMembers === true);
    assertTest("1I. Legacy 'editor' CANNOT delete project", legacyRes.permissions.canDeleteProject === false);
  }

  // 1J. Invalid Role
  {
    const invalidRes = await resolveProjectAccess(db, { uid: "user_proj_invalid_role", email: "proj_invalid@acmewidgets.com" }, "proj_acme_alpha");
    assertTest("1J. Invalid role normalizes to 'viewer'", invalidRes.role === 'viewer');
    assertTest("1J. Invalid role CANNOT edit content", invalidRes.permissions.canEditContent === false);
    assertTest("1J. Invalid role CANNOT manage members", invalidRes.permissions.canManageMembers === false);
    assertTest("1J. Invalid role CANNOT delete project", invalidRes.permissions.canDeleteProject === false);
  }

  // ==========================================================================
  // SECTION 2: TEST RECORDING AUTHORIZATION (authorizeRecordingAccess)
  // ==========================================================================
  console.log("\n--- SECTION 2: RECORDING AUTHORIZATION (authorizeRecordingAccess) ---");

  // Recording fixture inside proj_acme_alpha
  mockDb.store.set("recordings/rec_project_item", {
    id: "rec_project_item",
    userId: "user_rec_creator",
    projectId: "proj_acme_alpha",
    organizationId: "org_acme",
    title: "Executive Strategy Audio",
    collaborators: ["user_explicit_collab"]
  });
  mockDb.store.set("users/user_rec_creator", { uid: "user_rec_creator", email: "creator@acmewidgets.com" });
  mockDb.store.set("users/user_explicit_collab", { uid: "user_explicit_collab", email: "collab@acmewidgets.com" });
  mockDb.store.set("orgMembers/org_acme_user_rec_creator", { orgId: "org_acme", userId: "user_rec_creator", email: "creator@acmewidgets.com", role: "member", status: "active" });
  mockDb.store.set("orgMembers/org_acme_user_explicit_collab", { orgId: "org_acme", userId: "user_explicit_collab", email: "collab@acmewidgets.com", role: "member", status: "active" });

  const testRecAuth = async (caller: any, action?: 'VIEW' | 'COMMENT' | 'EDIT_CONTENT' | 'DELETE') => {
    return authorizeRecordingAccess(db, caller, "rec_project_item", { requiredAction: action });
  };

  // 2.1 Recording Owner
  {
    const caller = { uid: "user_rec_creator", email: "creator@acmewidgets.com" };
    const view = await testRecAuth(caller, 'VIEW');
    const comment = await testRecAuth(caller, 'COMMENT');
    const edit = await testRecAuth(caller, 'EDIT_CONTENT');
    const del = await testRecAuth(caller, 'DELETE');
    assertTest("2.1 Recording Owner can VIEW", view.authorized === true);
    assertTest("2.1 Recording Owner can COMMENT", comment.authorized === true);
    assertTest("2.1 Recording Owner can EDIT_CONTENT", edit.authorized === true);
    assertTest("2.1 Recording Owner can DELETE", del.authorized === true);
  }

  // 2.2 Explicit Collaborator
  {
    const caller = { uid: "user_explicit_collab", email: "collab@acmewidgets.com" };
    const view = await testRecAuth(caller, 'VIEW');
    const comment = await testRecAuth(caller, 'COMMENT');
    const edit = await testRecAuth(caller, 'EDIT_CONTENT');
    const del = await testRecAuth(caller, 'DELETE');
    assertTest("2.2 Collaborator can VIEW", view.authorized === true);
    assertTest("2.2 Collaborator can COMMENT", comment.authorized === true);
    assertTest("2.2 Collaborator CANNOT EDIT_CONTENT (403)", edit.authorized === false && edit.status === 403);
    assertTest("2.2 Collaborator CANNOT DELETE (403)", del.authorized === false && del.status === 403);
  }

  // 2.3 Project Owner
  {
    const caller = { uid: "user_proj_owner", email: "proj_owner@acmewidgets.com" };
    const view = await testRecAuth(caller, 'VIEW');
    const comment = await testRecAuth(caller, 'COMMENT');
    const edit = await testRecAuth(caller, 'EDIT_CONTENT');
    const del = await testRecAuth(caller, 'DELETE');
    assertTest("2.3 Project Owner can VIEW recording", view.authorized === true);
    assertTest("2.3 Project Owner can COMMENT on recording", comment.authorized === true);
    assertTest("2.3 Project Owner can EDIT_CONTENT on recording", edit.authorized === true);
    assertTest("2.3 Project Owner can DELETE recording", del.authorized === true);
  }

  // 2.4 Project Admin
  {
    const caller = { uid: "user_proj_admin", email: "proj_admin@acmewidgets.com" };
    const view = await testRecAuth(caller, 'VIEW');
    const comment = await testRecAuth(caller, 'COMMENT');
    const edit = await testRecAuth(caller, 'EDIT_CONTENT');
    const del = await testRecAuth(caller, 'DELETE');
    assertTest("2.4 Project Admin can VIEW recording", view.authorized === true);
    assertTest("2.4 Project Admin can COMMENT on recording", comment.authorized === true);
    assertTest("2.4 Project Admin can EDIT_CONTENT on recording", edit.authorized === true);
    assertTest("2.4 Project Admin CANNOT DELETE non-owned recording (403)", del.authorized === false && del.status === 403);
  }

  // 2.5 Project Commenter
  {
    const caller = { uid: "user_proj_commenter", email: "proj_commenter@acmewidgets.com" };
    const view = await testRecAuth(caller, 'VIEW');
    const comment = await testRecAuth(caller, 'COMMENT');
    const edit = await testRecAuth(caller, 'EDIT_CONTENT');
    const del = await testRecAuth(caller, 'DELETE');
    assertTest("2.5 Project Commenter can VIEW recording", view.authorized === true);
    assertTest("2.5 Project Commenter can COMMENT on recording", comment.authorized === true);
    assertTest("2.5 Project Commenter CANNOT EDIT_CONTENT (403)", edit.authorized === false && edit.status === 403);
    assertTest("2.5 Project Commenter CANNOT DELETE (403)", del.authorized === false && del.status === 403);
  }

  // 2.6 Project Viewer
  {
    const caller = { uid: "user_proj_viewer", email: "proj_viewer@acmewidgets.com" };
    const view = await testRecAuth(caller, 'VIEW');
    const comment = await testRecAuth(caller, 'COMMENT');
    const edit = await testRecAuth(caller, 'EDIT_CONTENT');
    const del = await testRecAuth(caller, 'DELETE');
    assertTest("2.6 Project Viewer can VIEW recording", view.authorized === true);
    assertTest("2.6 Project Viewer CANNOT COMMENT (403)", comment.authorized === false && comment.status === 403);
    assertTest("2.6 Project Viewer CANNOT EDIT_CONTENT (403)", edit.authorized === false && edit.status === 403);
    assertTest("2.6 Project Viewer CANNOT DELETE (403)", del.authorized === false && del.status === 403);
  }

  // 2.7 Ordinary Org Member without Project Membership
  {
    const caller = { uid: "user_org_member_acme", email: "member@acmewidgets.com" };
    const view = await testRecAuth(caller, 'VIEW');
    const edit = await testRecAuth(caller, 'EDIT_CONTENT');
    assertTest("2.7 Ordinary org member is DENIED VIEW (403)", view.authorized === false && view.status === 403);
    assertTest("2.7 Ordinary org member is DENIED EDIT_CONTENT (403)", edit.authorized === false && edit.status === 403);
  }

  // 2.8 Cross-Organization User
  {
    const caller = { uid: "user_beta_member", email: "user@betaindustries.com" };
    const view = await testRecAuth(caller, 'VIEW');
    const edit = await testRecAuth(caller, 'EDIT_CONTENT');
    assertTest("2.8 Cross-tenant user is DENIED VIEW with tenant isolation error (403)", view.authorized === false && view.status === 403);
    assertTest("2.8 Cross-tenant user message contains tenant isolation", view.message.includes("Tenant isolation") === true);
  }

  // 2.9 Platform Administrator
  {
    const caller = { uid: "user_platform_admin", email: "sec_ops@echonote.ai", platform_admin: true, role: "admin" };
    const view = await testRecAuth(caller, 'VIEW');
    const del = await testRecAuth(caller, 'DELETE');
    assertTest("2.9 Platform Admin can VIEW recording", view.authorized === true && view.isPlatformAdmin === true);
    assertTest("2.9 Platform Admin can DELETE recording", del.authorized === true);
  }

  // ==========================================================================
  // SECTION 3: TEST AI RESOURCE AUTHORIZATION (verifyAiResourceAccess)
  // ==========================================================================
  console.log("\n--- SECTION 3: AI RESOURCE AUTHORIZATION (verifyAiResourceAccess) ---");

  const protectedAiRoutes = [
    { path: "/api/ai/transcribe-audio", operation: "write" as const },
    { path: "/api/ai/summarize-transcript", operation: "read" as const },
    { path: "/api/ai/synthesize-speech", operation: "read" as const },
    { path: "/api/ai/analyze-strategically", operation: "read" as const },
    { path: "/api/ai/decision-intelligence", operation: "read" as const },
    { path: "/api/ai/unified-meeting-intelligence", operation: "read" as const },
    { path: "/api/ai/process-audio-transcription", operation: "write" as const },
    { path: "/api/ai/assistant-chat", operation: "read" as const },
    { path: "/api/convert-base64", operation: "read" as const },
    { path: "/api/convert-audio", operation: "read" as const }
  ];

  for (const route of protectedAiRoutes) {
    // 3.1 Authorized Project Owner
    const ownerRes = await verifyAiResourceAccess(db, { uid: "user_proj_owner", email: "proj_owner@acmewidgets.com" }, {
      recordingId: "rec_project_item",
      projectId: "proj_acme_alpha",
      operationType: route.operation
    });
    assertTest(`3.1 [${route.path}] Project Owner is allowed`, ownerRes.allowed === true);

    // 3.2 Authorized Project Admin
    const adminRes = await verifyAiResourceAccess(db, { uid: "user_proj_admin", email: "proj_admin@acmewidgets.com" }, {
      recordingId: "rec_project_item",
      projectId: "proj_acme_alpha",
      operationType: route.operation
    });
    assertTest(`3.2 [${route.path}] Project Admin is allowed`, adminRes.allowed === true);

    // 3.3 Commenter
    const commenterRes = await verifyAiResourceAccess(db, { uid: "user_proj_commenter", email: "proj_commenter@acmewidgets.com" }, {
      recordingId: "rec_project_item",
      projectId: "proj_acme_alpha",
      operationType: route.operation
    });
    if (route.operation === 'write') {
      assertTest(`3.3 [${route.path}] Commenter is REJECTED for write operation (403)`, commenterRes.allowed === false && commenterRes.status === 403);
    } else {
      assertTest(`3.3 [${route.path}] Commenter is allowed for read operation`, commenterRes.allowed === true);
    }

    // 3.4 Viewer
    const viewerRes = await verifyAiResourceAccess(db, { uid: "user_proj_viewer", email: "proj_viewer@acmewidgets.com" }, {
      recordingId: "rec_project_item",
      projectId: "proj_acme_alpha",
      operationType: route.operation
    });
    if (route.operation === 'write') {
      assertTest(`3.4 [${route.path}] Viewer is REJECTED for write operation (403)`, viewerRes.allowed === false && viewerRes.status === 403);
    } else {
      assertTest(`3.4 [${route.path}] Viewer is allowed for read operation`, viewerRes.allowed === true);
    }

    // 3.5 Ordinary Org Member without Project Membership
    const orgMemberRes = await verifyAiResourceAccess(db, { uid: "user_org_member_acme", email: "member@acmewidgets.com" }, {
      recordingId: "rec_project_item",
      projectId: "proj_acme_alpha",
      operationType: route.operation
    });
    assertTest(`3.5 [${route.path}] Ordinary org member without project membership is REJECTED (403)`, orgMemberRes.allowed === false && orgMemberRes.status === 403);

    // 3.6 Unauthenticated Caller
    const unauthRes = await verifyAiResourceAccess(db, null, {
      recordingId: "rec_project_item",
      projectId: "proj_acme_alpha",
      operationType: route.operation
    });
    assertTest(`3.6 [${route.path}] Unauthenticated caller is REJECTED (401)`, unauthRes.allowed === false && unauthRes.status === 401);

    // 3.7 Cross-Organization Caller
    const crossRes = await verifyAiResourceAccess(db, { uid: "user_beta_member", email: "user@betaindustries.com" }, {
      recordingId: "rec_project_item",
      projectId: "proj_acme_alpha",
      operationType: route.operation
    });
    assertTest(`3.7 [${route.path}] Cross-organization caller is REJECTED (403)`, crossRes.allowed === false && crossRes.status === 403);
  }

  // Cross-Resource Mismatch Check (Recording does not belong to specified project)
  mockDb.store.set("projects/proj_unrelated", {
    id: "proj_unrelated",
    name: "Unrelated Project",
    orgId: "org_acme",
    organizationId: "org_acme",
    userId: "user_proj_owner"
  });
  const mismatchRes = await verifyAiResourceAccess(db, { uid: "user_proj_owner", email: "proj_owner@acmewidgets.com" }, {
    recordingId: "rec_project_item",
    projectId: "proj_unrelated",
    operationType: "read"
  });
  assertTest("3.8 Cross-resource mismatch (recording from proj_alpha, passed with proj_unrelated) is REJECTED (400)", mismatchRes.allowed === false && mismatchRes.status === 400);

  // ==========================================================================
  // SECTION 4: TEST PROJECT MANAGEMENT
  // ==========================================================================
  console.log("\n--- SECTION 4: PROJECT MANAGEMENT AUTHORIZATION ---");

  // Helper simulating DELETE /api/projects/:projectId logic
  async function simulateDeleteProject(caller: any, projectId: string) {
    const projAccess = await resolveProjectAccess(db, caller, projectId, { requiredPermission: 'DELETE_PROJECT' });
    if (!projAccess.hasAccess || !projAccess.permissions.canDeleteProject) {
      return { status: projAccess.notFound ? 404 : 403, allowed: false };
    }
    return { status: 200, allowed: true };
  }

  // Helper simulating POST /api/projects/:projectId/transfer-ownership logic
  async function simulateTransferOwnership(caller: any, projectId: string, newOwnerId: string) {
    const projAccess = await resolveProjectAccess(db, caller, projectId, { requiredPermission: 'DELETE_PROJECT' });
    if (!projAccess.hasAccess || (!projAccess.isOwner && !projAccess.isPlatformAdmin && !projAccess.isOrgAdmin)) {
      return { status: projAccess.notFound ? 404 : 403, allowed: false, message: "Forbidden" };
    }
    const projectData = projAccess.project || {};
    const targetUserDoc = await db.collection("users").doc(newOwnerId).get();
    if (!targetUserDoc.exists) {
      return { status: 404, allowed: false, message: "Target user not found" };
    }
    const targetUserData = targetUserDoc.data() || {};
    if (projectData.organizationId) {
      const targetOrgMember = await checkOrgAccess(db, targetUserData.email, projectData.organizationId, ["owner", "org_admin", "team_manager", "member", "viewer"]);
      if (!targetOrgMember.hasAccess) {
        return { status: 400, allowed: false, message: "Target owner must be an active member of the project's organization to receive ownership." };
      }
    }
    return { status: 200, allowed: true, message: "Success" };
  }

  // Helper simulating POST /api/invite-member logic
  async function simulateInviteMember(caller: any, projectId: string, invitedRole: string) {
    const access = await resolveProjectAccess(db, caller, projectId, { requiredPermission: 'MANAGE_MEMBERS' });
    if (!access.hasAccess || !access.permissions.canManageMembers) {
      return { status: access.notFound ? 404 : 403, allowed: false, message: "Forbidden" };
    }
    const normalizedRole = normalizeProjectRole(invitedRole);
    if (normalizedRole === 'owner') {
      return { status: 400, allowed: false, message: "Cannot invite a member directly as owner. Use project transfer of ownership." };
    }
    return { status: 200, allowed: true, message: "Invite created" };
  }

  // Helper simulating POST /api/invite-expire logic
  async function simulateInviteExpire(caller: any, inviteToken: string) {
    const inviteDoc = await db.collection("invites").doc(inviteToken).get();
    if (!inviteDoc.exists) {
      return { status: 404, allowed: false };
    }
    const inviteData = inviteDoc.data() || {};
    const access = await resolveProjectAccess(db, caller, inviteData.projectId, { requiredPermission: 'MANAGE_MEMBERS' });
    if (!access.hasAccess && inviteData.ownerId !== caller.uid && inviteData.invitedBy !== caller.email) {
      return { status: 403, allowed: false };
    }
    return { status: 200, allowed: true };
  }

  // Test DELETE Project Across Roles
  {
    const ownerDel = await simulateDeleteProject({ uid: "user_proj_owner", email: "proj_owner@acmewidgets.com" }, "proj_acme_alpha");
    const adminDel = await simulateDeleteProject({ uid: "user_proj_admin", email: "proj_admin@acmewidgets.com" }, "proj_acme_alpha");
    const commenterDel = await simulateDeleteProject({ uid: "user_proj_commenter", email: "proj_commenter@acmewidgets.com" }, "proj_acme_alpha");
    const viewerDel = await simulateDeleteProject({ uid: "user_proj_viewer", email: "proj_viewer@acmewidgets.com" }, "proj_acme_alpha");
    const orgMemberDel = await simulateDeleteProject({ uid: "user_org_member_acme", email: "member@acmewidgets.com" }, "proj_acme_alpha");
    const orgAdminDel = await simulateDeleteProject({ uid: "user_org_admin_acme", email: "admin@acmewidgets.com" }, "proj_acme_alpha");
    const platAdminDel = await simulateDeleteProject({ uid: "user_platform_admin", email: "sec_ops@echonote.ai", platform_admin: true, role: "admin" }, "proj_acme_alpha");
    const crossTenantDel = await simulateDeleteProject({ uid: "user_beta_member", email: "user@betaindustries.com" }, "proj_acme_alpha");

    assertTest("4.1 DELETE project: Owner allowed", ownerDel.allowed === true && ownerDel.status === 200);
    assertTest("4.1 DELETE project: Project Admin REJECTED (403)", adminDel.allowed === false && adminDel.status === 403);
    assertTest("4.1 DELETE project: Commenter REJECTED (403)", commenterDel.allowed === false && commenterDel.status === 403);
    assertTest("4.1 DELETE project: Viewer REJECTED (403)", viewerDel.allowed === false && viewerDel.status === 403);
    assertTest("4.1 DELETE project: Ordinary Org Member REJECTED (403)", orgMemberDel.allowed === false && orgMemberDel.status === 403);
    assertTest("4.1 DELETE project: Org Admin allowed", orgAdminDel.allowed === true && orgAdminDel.status === 200);
    assertTest("4.1 DELETE project: Platform Admin allowed", platAdminDel.allowed === true && platAdminDel.status === 200);
    assertTest("4.1 DELETE project: Cross-Tenant user REJECTED (403)", crossTenantDel.allowed === false && crossTenantDel.status === 403);
  }

  // Test Transfer Ownership
  {
    const ownerCaller = { uid: "user_proj_owner", email: "proj_owner@acmewidgets.com" };
    const adminCaller = { uid: "user_proj_admin", email: "proj_admin@acmewidgets.com" };

    // Valid transfer within same org
    const validTransfer = await simulateTransferOwnership(ownerCaller, "proj_acme_alpha", "user_proj_admin");
    assertTest("4.2 Transfer ownership: Owner to same-org member allowed", validTransfer.allowed === true && validTransfer.status === 200);

    // Transfer to user in DIFFERENT org (Beta)
    const crossOrgTransfer = await simulateTransferOwnership(ownerCaller, "proj_acme_alpha", "user_beta_member");
    assertTest("4.2 Transfer ownership: Target in different org REJECTED (400)", crossOrgTransfer.allowed === false && crossOrgTransfer.status === 400);

    // Unauthorized caller (admin) attempting ownership transfer
    const unauthTransfer = await simulateTransferOwnership(adminCaller, "proj_acme_alpha", "user_org_member_acme");
    assertTest("4.2 Transfer ownership: Admin caller REJECTED (403)", unauthTransfer.allowed === false && unauthTransfer.status === 403);
  }

  // Test Invitations
  {
    const ownerCaller = { uid: "user_proj_owner", email: "proj_owner@acmewidgets.com" };
    const adminCaller = { uid: "user_proj_admin", email: "proj_admin@acmewidgets.com" };
    const commenterCaller = { uid: "user_proj_commenter", email: "proj_commenter@acmewidgets.com" };
    const viewerCaller = { uid: "user_proj_viewer", email: "proj_viewer@acmewidgets.com" };

    const ownerInvite = await simulateInviteMember(ownerCaller, "proj_acme_alpha", "commenter");
    const adminInvite = await simulateInviteMember(adminCaller, "proj_acme_alpha", "viewer");
    const commenterInvite = await simulateInviteMember(commenterCaller, "proj_acme_alpha", "viewer");
    const viewerInvite = await simulateInviteMember(viewerCaller, "proj_acme_alpha", "viewer");

    assertTest("4.3 Invite member: Owner allowed", ownerInvite.allowed === true && ownerInvite.status === 200);
    assertTest("4.3 Invite member: Admin allowed", adminInvite.allowed === true && adminInvite.status === 200);
    assertTest("4.3 Invite member: Commenter REJECTED (403)", commenterInvite.allowed === false && commenterInvite.status === 403);
    assertTest("4.3 Invite member: Viewer REJECTED (403)", viewerInvite.allowed === false && viewerInvite.status === 403);

    // Direct invitation to 'owner' role is rejected
    const ownerRoleInvite = await simulateInviteMember(ownerCaller, "proj_acme_alpha", "owner");
    assertTest("4.3 Invite member: Direct invite to 'owner' role REJECTED (400)", ownerRoleInvite.allowed === false && ownerRoleInvite.status === 400);

    // Invite Expire
    mockDb.store.set("invites/token_test_123", {
      id: "token_test_123",
      projectId: "proj_acme_alpha",
      email: "newinvitee@acmewidgets.com",
      ownerId: "user_proj_owner",
      invitedBy: "proj_owner@acmewidgets.com",
      status: "pending"
    });

    const ownerExpire = await simulateInviteExpire(ownerCaller, "token_test_123");
    const viewerExpire = await simulateInviteExpire(viewerCaller, "token_test_123");
    assertTest("4.4 Expire invite: Authorized member allowed", ownerExpire.allowed === true && ownerExpire.status === 200);
    assertTest("4.4 Expire invite: Unauthorized viewer REJECTED (403)", viewerExpire.allowed === false && viewerExpire.status === 403);
  }

  // ==========================================================================
  // SECTION 5: TEST SSO/JIT PRIVILEGE ESCALATION DEFENSES
  // ==========================================================================
  console.log("\n--- SECTION 5: SSO / JIT PRIVILEGE ESCALATION DEFENSES ---");

  // 5.1 Test sanitizeSsoClaims with malicious payloads
  {
    const injectionAttempt = {
      role: "owner",
      orgRole: "owner",
      platform_admin: true,
      admin: true,
      owner: true,
      isOwner: true,
      ownership: true,
      org_admin: true,
      super_admin: true,
      superadmin: true,
      is_owner: true,
      // Legitimate corporate claims
      department: "Legal & Compliance",
      jobTitle: "Lead Auditor",
      tenantId: "tenant-acme-prod",
      groups: ["Auditors", "Employees"]
    };

    const sanitized = sanitizeSsoClaims(injectionAttempt);
    assertTest("5.1 Sanitizer strips 'role'", sanitized.role === undefined);
    assertTest("5.1 Sanitizer strips 'orgRole'", sanitized.orgRole === undefined);
    assertTest("5.1 Sanitizer strips 'platform_admin'", sanitized.platform_admin === undefined);
    assertTest("5.1 Sanitizer strips 'admin'", sanitized.admin === undefined);
    assertTest("5.1 Sanitizer strips 'owner'", sanitized.owner === undefined);
    assertTest("5.1 Sanitizer strips 'isOwner'", sanitized.isOwner === undefined);
    assertTest("5.1 Sanitizer strips 'ownership'", sanitized.ownership === undefined);
    assertTest("5.1 Sanitizer strips 'org_admin'", sanitized.org_admin === undefined);
    assertTest("5.1 Sanitizer strips 'super_admin'", sanitized.super_admin === undefined);
    assertTest("5.1 Sanitizer strips 'superadmin'", sanitized.superadmin === undefined);
    assertTest("5.1 Sanitizer strips 'is_owner'", sanitized.is_owner === undefined);
    assertTest("5.1 Sanitizer preserves legitimate 'department'", sanitized.department === "Legal & Compliance");
    assertTest("5.1 Sanitizer preserves legitimate 'jobTitle'", sanitized.jobTitle === "Lead Auditor");
    assertTest("5.1 Sanitizer preserves legitimate 'tenantId'", sanitized.tenantId === "tenant-acme-prod");
  }

  // 5.2 Test JIT Provisioning Ceiling (Cannot provision above team_manager)
  {
    // Configure JIT mappings in mockDb attempting to map "Exec" to "owner" and "IT" to "org_admin"
    mockDb.store.set("orgIdentityMappings/map_owner_attempt", {
      orgId: "org_acme",
      provider: "all",
      sourceType: "group",
      sourceValue: "Executives",
      targetRole: "owner",
      enabled: true,
      priority: 10
    });

    const userCtx = {
      uid: "user_exec",
      email: "ceo@acmewidgets.com",
      provider: "saml" as const,
      groups: ["Executives"]
    };

    const jitRes = await evaluateIdentityMappings(db, "org_acme", userCtx, "member");
    assertTest("5.2 JIT mapping to 'owner' is downgraded to 'team_manager'", jitRes.targetRole === "team_manager");

    // Mapping to 'org_admin'
    mockDb.store.set("orgIdentityMappings/map_admin_attempt", {
      orgId: "org_acme",
      provider: "all",
      sourceType: "group",
      sourceValue: "IT_Admins",
      targetRole: "org_admin",
      enabled: true,
      priority: 10
    });

    const adminCtx = {
      uid: "user_it",
      email: "it@acmewidgets.com",
      provider: "saml" as const,
      groups: ["IT_Admins"]
    };

    const jitAdminRes = await evaluateIdentityMappings(db, "org_acme", adminCtx, "member");
    assertTest("5.2 JIT mapping to 'org_admin' is downgraded to 'team_manager'", jitAdminRes.targetRole === "team_manager");
  }

  // 5.3 Test Consumer Email Domains Blocked from SSO Discovery
  {
    const consumerEmails = [
      "hacker@gmail.com",
      "user@yahoo.com",
      "test@outlook.com",
      "person@hotmail.com",
      "vip@icloud.com"
    ];

    for (const email of consumerEmails) {
      const domain = normalizeDomain(email);
      assertTest(`5.3 Consumer domain '${domain}' is in PUBLIC_CONSUMER_DOMAINS`, PUBLIC_CONSUMER_DOMAINS.has(domain));
    }

    const enterpriseDomain = normalizeDomain("employee@corp.acmewidgets.com");
    assertTest("5.3 Enterprise domain is NOT in PUBLIC_CONSUMER_DOMAINS", !PUBLIC_CONSUMER_DOMAINS.has(enterpriseDomain));
  }

  // ==========================================================================
  // SECTION 6: IDOR (INSECURE DIRECT OBJECT REFERENCE) TESTS
  // ==========================================================================
  console.log("\n--- SECTION 6: IDOR (INSECURE DIRECT OBJECT REFERENCE) TESTS ---");

  // Fixture: User A (victim) owns Project A & Recording A
  // User B (attacker) knows the IDs of Project A & Recording A
  const victimProject = "proj_acme_alpha";
  const victimRecording = "rec_project_item";

  // Scenario 6.1: Attacker B (unaffiliated user) attempts to access victim's recording directly
  {
    const attacker = { uid: "user_attacker_unaffiliated", email: "intruder@external.io" };
    const recAuth = await authorizeRecordingAccess(db, attacker, victimRecording, { requiredAction: "VIEW" });
    assertTest("6.1 IDOR: Unaffiliated attacker knowing recordingId is DENIED (403)", recAuth.authorized === false && recAuth.status === 403);
  }

  // Scenario 6.2: Attacker B (in same org, but not in project) attempts to view/mutate victim's project & recording
  {
    const sameOrgAttacker = { uid: "user_org_member_acme", email: "member@acmewidgets.com" };

    const projView = await resolveProjectAccess(db, sameOrgAttacker, victimProject);
    assertTest("6.2 IDOR: Same-org non-member knowing projectId is DENIED project access", projView.hasAccess === false);

    const recView = await authorizeRecordingAccess(db, sameOrgAttacker, victimRecording, { requiredAction: "VIEW" });
    assertTest("6.2 IDOR: Same-org non-member knowing recordingId is DENIED recording access (403)", recView.authorized === false && recView.status === 403);

    const recMutate = await authorizeRecordingAccess(db, sameOrgAttacker, victimRecording, { requiredAction: "EDIT_CONTENT" });
    assertTest("6.2 IDOR: Same-org non-member attempting mutation is DENIED (403)", recMutate.authorized === false && recMutate.status === 403);
  }

  // Scenario 6.3: Attacker B (in another org) attempts access by substituting IDs
  {
    const crossOrgAttacker = { uid: "user_beta_member", email: "user@betaindustries.com" };

    const projAccess = await resolveProjectAccess(db, crossOrgAttacker, victimProject);
    assertTest("6.3 IDOR: Cross-tenant attacker knowing projectId is DENIED", projAccess.hasAccess === false);

    const recAccess = await authorizeRecordingAccess(db, crossOrgAttacker, victimRecording, { requiredAction: "VIEW" });
    assertTest("6.3 IDOR: Cross-tenant attacker knowing recordingId is DENIED (403)", recAccess.authorized === false && recAccess.status === 403);
  }

  // ==========================================================================
  // SUMMARY REPORT
  // ==========================================================================
  console.log("\n===============================================================");
  console.log(`STEP 2.5 VERIFICATION RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("===============================================================\n");

  if (failedCount > 0) {
    console.error("❌ THE FOLLOWING TESTS FAILED:");
    failures.forEach(f => console.error(`  - ${f}`));
    throw new Error(`${failedCount} verification tests failed.`);
  } else {
    console.log("🎉 ALL STEP 2.5 AUTHORIZATION VERIFICATION TESTS PASSED SUCCESSFULLY!\n");
  }

  return { passedCount, failedCount };
}

// Auto-run when executed directly via tsx
runStep2_5VerificationSuite().catch(err => {
  console.error("Suite execution error:", err);
  process.exit(1);
});
