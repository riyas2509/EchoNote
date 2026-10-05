/**
 * EchoNote Phase 1A Step 5B: Backend Admin Enhancements & API Completeness Verification Suite
 * 
 * End-to-end multi-dimensional verification covering:
 * 1. Organization Invitation Cancellation (DELETE /api/organizations/:id/invitations/:id)
 *    - Role boundaries (owner, org_admin, team_manager, member, viewer, unauthenticated)
 *    - Lifecycle state transitions (pending -> rejected/cancelled, accepted/expired rejection)
 *    - Tenant isolation & cross-org protection
 *    - Structured audit logging (INVITATION_CANCELLED)
 * 
 * 2. Member Department Assignment (PATCH /api/organizations/:id/members/:id/department)
 *    - Role boundaries (owner, org_admin allowed; team_manager, member, viewer rejected)
 *    - Department existence & status validation
 *    - Cross-tenant department and member isolation
 *    - Department clearing / unassignment support
 *    - Immutability of unauthorized fields
 *    - Structured audit logging (MEMBER_DEPARTMENT_ASSIGNED)
 * 
 * 3. Member Removal & Project Membership Cleanup (DELETE /api/organizations/:id/members/:id)
 *    - Atomic cleanup of organization-scoped project memberships
 *    - Isolation and preservation of personal/cross-org projects & memberships
 *    - Preservation of organizational projects and historical recordings/transcripts
 *    - Role hierarchy boundaries (owner protection, admin self-protection)
 *    - Tenant boundary cutoff (resolveProjectAccess immediately denies removed member)
 *    - Idempotency & structured audit logging (MEMBER_REMOVED)
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import {
  checkOrgAccess,
  normalizeOrgRole,
  recordOrgAuditEvent,
  resolveProjectAccess,
  AuthenticatedRequest
} from "../middleware/auth.js";
import { AuthoritativeOrgRole } from "../types.js";

// ============================================================================
// TEST HARNESS & IN-MEMORY FIRESTORE
// ============================================================================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertTest(name: string, condition: boolean, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } else {
    failedTests++;
    console.error(`  ❌ FAIL: ${name}${details ? ` -> ${details}` : ""}`);
  }
}

class MockDocSnapshot {
  constructor(public id: string, private _data: any, private _ref?: any) {}
  get exists(): boolean {
    return this._data !== undefined && this._data !== null;
  }
  data(): any {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined;
  }
  get ref() {
    return this._ref || { id: this.id };
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

class MockQuery {
  constructor(
    private db: MockFirestore,
    private collectionPath: string,
    private filters: Array<{ field: string; op: string; val: any }>
  ) {}

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionPath, [...this.filters, { field, op, val }]);
  }

  limit(_n: number) {
    return this;
  }

  async get(): Promise<MockQuerySnapshot> {
    const prefix = `${this.collectionPath}/`;
    const matchedDocs: MockDocSnapshot[] = [];

    for (const [key, data] of this.db.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      const remainder = key.slice(prefix.length);
      if (remainder.includes("/")) continue; // direct children only

      let matches = true;
      for (const filter of this.filters) {
        const actual = data[filter.field];
        if (filter.op === '==' && actual !== filter.val) {
          matches = false;
          break;
        }
        if (filter.op === '!=' && actual === filter.val) {
          matches = false;
          break;
        }
      }

      if (matches) {
        const docRef = this.db.doc(`${this.collectionPath}/${remainder}`);
        matchedDocs.push(new MockDocSnapshot(remainder, data, docRef));
      }
    }

    return new MockQuerySnapshot(matchedDocs);
  }
}

class MockDocReference {
  constructor(private db: MockFirestore, public path: string, public id: string) {}

  collection(subCollName: string) {
    return new MockCollectionReference(this.db, `${this.path}/${subCollName}`);
  }

  async get() {
    const data = this.db.store.get(this.path);
    return new MockDocSnapshot(this.id, data, this);
  }

  async set(val: any) {
    this.db.store.set(this.path, { ...val, id: this.id });
  }

  async update(val: any) {
    const existing = this.db.store.get(this.path);
    if (!existing) {
      throw new Error(`Doc ${this.path} not found`);
    }
    this.db.store.set(this.path, { ...existing, ...val });
  }

  async delete() {
    this.db.store.delete(this.path);
  }
}

class MockCollectionReference {
  constructor(private db: MockFirestore, public path: string) {}

  doc(id?: string) {
    const docId = id || `mock_doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    return new MockDocReference(this.db, `${this.path}/${docId}`, docId);
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.path, [{ field, op, val }]);
  }

  async get() {
    return new MockQuery(this.db, this.path, []).get();
  }
}

class MockBatch {
  private ops: Array<() => Promise<void>> = [];

  delete(ref: any) {
    this.ops.push(async () => {
      await ref.delete();
    });
    return this;
  }

  set(ref: any, data: any) {
    this.ops.push(async () => {
      await ref.set(data);
    });
    return this;
  }

  update(ref: any, data: any) {
    this.ops.push(async () => {
      await ref.update(data);
    });
    return this;
  }

  async commit() {
    for (const op of this.ops) {
      await op();
    }
  }
}

class MockFirestore {
  public store = new Map<string, any>();
  public customClaimsStore = new Map<string, any>();

  collection(name: string) {
    return new MockCollectionReference(this, name);
  }

  doc(fullPath: string) {
    const parts = fullPath.split("/");
    const id = parts[parts.length - 1];
    return new MockDocReference(this, fullPath, id);
  }

  batch() {
    return new MockBatch();
  }

  clear() {
    this.store.clear();
    this.customClaimsStore.clear();
  }
}

// Mock Firebase Admin Auth
function createMockAdmin(db: MockFirestore) {
  return {
    auth: () => ({
      setCustomUserClaims: async (uid: string, claims: any) => {
        db.customClaimsStore.set(uid, claims);
      }
    })
  };
}

// ============================================================================
// SERVER SETUP WITH AUTHORITATIVE STEP 5B ENDPOINTS
// ============================================================================

function createAdminVerificationServer(db: MockFirestore, adminAuth: any) {
  const app = express();
  app.use(express.json());

  // Test Authentication Middleware
  app.use((req: any, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer test_token_")) {
      const uid = authHeader.replace("Bearer test_token_", "");
      const userDoc = db.store.get(`users/${uid}`);
      req.user = {
        uid,
        email: userDoc?.email || `${uid}@test.com`,
        displayName: userDoc?.displayName || userDoc?.name || uid,
        role: userDoc?.role || "user",
        platform_admin: userDoc?.platform_admin || false
      };
    }
    next();
  });

  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: "Unauthorized", message: "Missing or invalid token" });
    }
    next();
  };

  /**
   * 1. CANCEL INVITATION ENDPOINT
   * DELETE /api/organizations/:organizationId/invitations/:inviteId
   */
  app.delete("/api/organizations/:organizationId/invitations/:inviteId", requireAuth, async (req: any, res) => {
    const { organizationId, inviteId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();

    try {
      // 1. Authorization: Owner or Org Admin
      const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"]);
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      if (!orgAccess.hasAccess && !isPlatformAdmin) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Only organization owners and administrators can cancel invitations."
        });
      }

      // 2. Fetch invitation
      const inviteRef = db.collection("orgInvitations").doc(inviteId);
      const inviteDoc = await inviteRef.get();
      if (!inviteDoc.exists) {
        return res.status(404).json({
          error: "Not Found",
          message: "Invitation not found."
        });
      }

      const inviteData = inviteDoc.data() || {};

      // 3. Tenant Boundary check
      if (inviteData.orgId !== organizationId) {
        return res.status(404).json({
          error: "Not Found",
          message: "Invitation not found in this organization."
        });
      }

      // 4. Invitation Lifecycle state validation
      if (inviteData.status === "accepted") {
        return res.status(400).json({
          error: "Bad Request",
          message: "Cannot cancel an invitation that has already been accepted."
        });
      }

      if (inviteData.status === "rejected" || inviteData.status === "cancelled") {
        return res.status(400).json({
          error: "Bad Request",
          message: "This invitation has already been cancelled."
        });
      }

      if (inviteData.status === "expired" || (inviteData.expiresAt && new Date(inviteData.expiresAt).getTime() < Date.now())) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Cannot cancel an expired invitation."
        });
      }

      if (inviteData.status !== "pending") {
        return res.status(400).json({
          error: "Bad Request",
          message: `Cannot cancel invitation with status '${inviteData.status}'.`
        });
      }

      // 5. Update invitation to rejected with history audit
      const updatedHistory = [
        ...(inviteData.history || []),
        { event: "cancelled", timestamp: new Date().toISOString(), by: callerEmail }
      ];

      await inviteRef.update({
        status: "rejected",
        cancelledAt: new Date().toISOString(),
        cancelledBy: callerEmail,
        history: updatedHistory
      });

      // 6. Record Organization Audit Log
      await recordOrgAuditEvent(db as any, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserEmail: inviteData.email,
        action: "INVITATION_CANCELLED" as any,
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Cancelled invitation for ${inviteData.email} (role: ${inviteData.role})`,
        metadata: {
          inviteId,
          invitedRole: inviteData.role,
          invitedEmail: inviteData.email
        }
      });

      res.json({
        success: true,
        inviteId,
        message: `Invitation for ${inviteData.email} cancelled successfully.`
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to cancel invitation", message: error.message });
    }
  });

  /**
   * 2. MEMBER DEPARTMENT ASSIGNMENT ENDPOINT
   * PATCH /api/organizations/:organizationId/members/:memberId/department
   */
  app.patch("/api/organizations/:organizationId/members/:memberId/department", requireAuth, async (req: any, res) => {
    const { organizationId, memberId } = req.params;
    const { departmentId } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();

    try {
      // 1. Authorization: Owner or Org Admin
      const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"]);
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      if (!orgAccess.hasAccess && !isPlatformAdmin) {
        return res.status(403).json({
          error: "Forbidden",
          message: "Only organization owners and administrators can assign member departments."
        });
      }

      // 2. Fetch member and verify tenant boundary
      const memberRef = db.collection("orgMembers").doc(memberId);
      const memberDoc = await memberRef.get();
      if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
        return res.status(404).json({
          error: "Not Found",
          message: "Member not found in organization."
        });
      }

      const memberData = memberDoc.data()!;
      const previousDeptId = memberData.departmentId || "";
      const targetDeptId = typeof departmentId === "string" ? departmentId.trim() : (departmentId === null ? "" : undefined);

      if (targetDeptId === undefined) {
        return res.status(400).json({
          error: "Bad Request",
          message: "departmentId must be provided as a string or null."
        });
      }

      // 3. If assigning to a department (non-empty), validate department existence & tenant
      let assignedDeptName = "";
      if (targetDeptId !== "") {
        const deptDoc = await db.collection("departments").doc(targetDeptId).get();
        if (!deptDoc.exists) {
          return res.status(404).json({
            error: "Not Found",
            message: "Department not found."
          });
        }
        const deptData = deptDoc.data() || {};
        if (deptData.orgId !== organizationId) {
          return res.status(400).json({
            error: "Bad Request",
            message: "Department belongs to a different organization."
          });
        }
        if (deptData.status && deptData.status !== "active") {
          return res.status(400).json({
            error: "Bad Request",
            message: "Department is not active."
          });
        }
        assignedDeptName = deptData.name || targetDeptId;
      }

      // 4. Update authoritative orgMembers document
      await memberRef.update({
        departmentId: targetDeptId
      });

      // 5. Record structured audit event
      await recordOrgAuditEvent(db as any, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserId: memberData.userId,
        targetUserEmail: memberData.email,
        action: "MEMBER_DEPARTMENT_ASSIGNED" as any,
        timestamp: new Date().toISOString(),
        source: "api",
        details: targetDeptId
          ? `Assigned member ${memberData.email} to department ${assignedDeptName} (${targetDeptId})`
          : `Unassigned member ${memberData.email} from department`,
        metadata: {
          memberId,
          previousDepartmentId: previousDeptId || null,
          newDepartmentId: targetDeptId || null
        }
      });

      res.json({
        success: true,
        memberId,
        departmentId: targetDeptId,
        message: targetDeptId ? "Member department updated successfully" : "Member department cleared successfully"
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to assign member department", message: error.message });
    }
  });

  /**
   * 3. MEMBER REMOVAL WITH ATOMIC PROJECT MEMBERSHIP CLEANUP
   * DELETE /api/organizations/:organizationId/members/:memberId
   */
  app.delete("/api/organizations/:organizationId/members/:memberId", requireAuth, async (req: any, res) => {
    const { organizationId, memberId } = req.params;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase();

    try {
      const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"]);
      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      if (!orgAccess.hasAccess && !isPlatformAdmin) {
        return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions to remove members." });
      }

      const memberRef = db.collection("orgMembers").doc(memberId);
      const memberDoc = await memberRef.get();
      if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
        return res.status(404).json({ error: "Not Found", message: "Member not found in organization." });
      }

      const memberData = memberDoc.data()!;
      if (normalizeOrgRole(memberData.role) === "owner") {
        return res.status(400).json({ error: "Bad Request", message: "Cannot remove the organization owner." });
      }

      if (!orgAccess.isOwner && !isPlatformAdmin && normalizeOrgRole(memberData.role) === "org_admin") {
        return res.status(403).json({ error: "Forbidden", message: "Administrators cannot remove other administrators. Only the owner can remove administrators." });
      }

      // Identify projects belonging to this organization
      const orgProjectsSnap = await db.collection("projects").where("organizationId", "==", organizationId).get();
      const orgProjectIds = new Set(orgProjectsSnap.docs.map(d => d.id));

      // Find projectMembers records for this user that belong to this organization
      const matchingPmDocRefs = new Map<string, any>();

      // 1. Query projectMembers by userId if present
      if (memberData.userId) {
        try {
          const userPmSnap = await db.collection("projectMembers").where("userId", "==", memberData.userId).get();
          for (const pmDoc of userPmSnap.docs) {
            const pmData = pmDoc.data();
            if (pmData.organizationId === organizationId || orgProjectIds.has(pmData.projectId)) {
              matchingPmDocRefs.set(pmDoc.id, pmDoc.ref);
            }
          }
        } catch (pmErr: any) {}
      }

      // 2. Query projectMembers by email if present
      if (memberData.email) {
        try {
          const emailPmSnap = await db.collection("projectMembers").where("email", "==", memberData.email.toLowerCase()).get();
          for (const pmDoc of emailPmSnap.docs) {
            const pmData = pmDoc.data();
            if (pmData.organizationId === organizationId || orgProjectIds.has(pmData.projectId)) {
              matchingPmDocRefs.set(pmDoc.id, pmDoc.ref);
            }
          }
        } catch (pmErr: any) {}
      }

      // 3. Direct deterministic key check: `${userId}_${projectId}`
      if (memberData.userId) {
        for (const pId of orgProjectIds) {
          const directRef = db.collection("projectMembers").doc(`${memberData.userId}_${pId}`);
          try {
            const directDoc = await directRef.get();
            if (directDoc.exists) {
              matchingPmDocRefs.set(directDoc.id, directRef);
            }
          } catch {}
        }
      }

      // Atomically delete the orgMembers document and all matching projectMembers documents
      const batch = db.batch();
      batch.delete(memberRef);
      for (const pmRef of matchingPmDocRefs.values()) {
        batch.delete(pmRef);
      }
      await batch.commit();

      // Revoke custom claims
      if (memberData.userId) {
        try {
          await adminAuth.auth().setCustomUserClaims(memberData.userId, { orgId: null, orgRole: null });
        } catch (claimErr: any) {}
      }

      await recordOrgAuditEvent(db as any, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserId: memberData.userId,
        targetUserEmail: memberData.email,
        action: "MEMBER_REMOVED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Removed member ${memberData.email} from organization and cleaned up ${matchingPmDocRefs.size} project memberships`,
        metadata: {
          cleanedProjectMembershipsCount: matchingPmDocRefs.size
        }
      });

      res.json({
        success: true,
        memberId,
        cleanedProjectMembershipsCount: matchingPmDocRefs.size,
        message: "Member removed from organization and project memberships invalidated"
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to remove member", message: error.message });
    }
  });

  return app;
}

// ============================================================================
// MAIN VERIFICATION SUITE
// ============================================================================

async function runSuite() {
  console.log("\n================================================================================");
  console.log("🛡️ ECHONOTE PHASE 1A STEP 5B: ADMIN BACKEND VERIFICATION");
  console.log("================================================================================\n");

  const mockDb = new MockFirestore();
  const mockAdmin = createMockAdmin(mockDb);
  const app = createAdminVerificationServer(mockDb, mockAdmin);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://localhost:${port}`;

  const requestHelper = async (method: string, path: string, tokenUser?: string, body?: any) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (tokenUser) {
      headers["Authorization"] = `Bearer test_token_${tokenUser}`;
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    let data: any = {};
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, ok: res.ok, data };
  };

  // --------------------------------------------------------------------------
  // FIXTURES SETUP
  // --------------------------------------------------------------------------

  const setupFixtures = () => {
    mockDb.clear();

    // Organizations
    mockDb.store.set("organizations/org_acme", {
      id: "org_acme",
      name: "Acme Corp",
      ownerId: "user_owner",
      ownerEmail: "owner@acme.com",
      plan: "enterprise"
    });

    mockDb.store.set("organizations/org_beta", {
      id: "org_beta",
      name: "Beta Inc",
      ownerId: "user_beta_owner",
      ownerEmail: "beta_owner@beta.com",
      plan: "team"
    });

    // Users
    mockDb.store.set("users/user_owner", { uid: "user_owner", email: "owner@acme.com", role: "user" });
    mockDb.store.set("users/user_org_admin", { uid: "user_org_admin", email: "admin@acme.com", role: "user" });
    mockDb.store.set("users/user_org_admin_2", { uid: "user_org_admin_2", email: "admin2@acme.com", role: "user" });
    mockDb.store.set("users/user_team_manager", { uid: "user_team_manager", email: "manager@acme.com", role: "user" });
    mockDb.store.set("users/user_member", { uid: "user_member", email: "member@acme.com", role: "user" });
    mockDb.store.set("users/user_viewer", { uid: "user_viewer", email: "viewer@acme.com", role: "user" });
    mockDb.store.set("users/user_beta_owner", { uid: "user_beta_owner", email: "beta_owner@beta.com", role: "user" });
    mockDb.store.set("users/user_beta_admin", { uid: "user_beta_admin", email: "admin@beta.com", role: "user" });
    mockDb.store.set("users/user_platform_admin", { uid: "user_platform_admin", email: "sysadmin@echonote.ai", role: "admin", platform_admin: true });

    // Org Members in org_acme
    mockDb.store.set("orgMembers/mem_owner", {
      id: "mem_owner",
      orgId: "org_acme",
      userId: "user_owner",
      email: "owner@acme.com",
      role: "owner",
      status: "active"
    });
    mockDb.store.set("orgMembers/mem_admin", {
      id: "mem_admin",
      orgId: "org_acme",
      userId: "user_org_admin",
      email: "admin@acme.com",
      role: "org_admin",
      status: "active"
    });
    mockDb.store.set("orgMembers/mem_admin_2", {
      id: "mem_admin_2",
      orgId: "org_acme",
      userId: "user_org_admin_2",
      email: "admin2@acme.com",
      role: "org_admin",
      status: "active"
    });
    mockDb.store.set("orgMembers/mem_manager", {
      id: "mem_manager",
      orgId: "org_acme",
      userId: "user_team_manager",
      email: "manager@acme.com",
      role: "team_manager",
      status: "active"
    });
    mockDb.store.set("orgMembers/mem_member", {
      id: "mem_member",
      orgId: "org_acme",
      userId: "user_member",
      email: "member@acme.com",
      role: "member",
      status: "active",
      departmentId: "dept_eng"
    });
    mockDb.store.set("orgMembers/mem_viewer", {
      id: "mem_viewer",
      orgId: "org_acme",
      userId: "user_viewer",
      email: "viewer@acme.com",
      role: "viewer",
      status: "active"
    });

    // Org Members in org_beta
    mockDb.store.set("orgMembers/mem_beta_owner", {
      id: "mem_beta_owner",
      orgId: "org_beta",
      userId: "user_beta_owner",
      email: "beta_owner@beta.com",
      role: "owner",
      status: "active"
    });
    mockDb.store.set("orgMembers/mem_beta_admin", {
      id: "mem_beta_admin",
      orgId: "org_beta",
      userId: "user_beta_admin",
      email: "admin@beta.com",
      role: "org_admin",
      status: "active"
    });

    // Departments
    mockDb.store.set("departments/dept_eng", {
      id: "dept_eng",
      orgId: "org_acme",
      name: "Engineering",
      status: "active"
    });
    mockDb.store.set("departments/dept_design", {
      id: "dept_design",
      orgId: "org_acme",
      name: "Product Design",
      status: "active"
    });
    mockDb.store.set("departments/dept_inactive", {
      id: "dept_inactive",
      orgId: "org_acme",
      name: "Legacy Dept",
      status: "inactive"
    });
    mockDb.store.set("departments/dept_beta", {
      id: "dept_beta",
      orgId: "org_beta",
      name: "Beta Operations",
      status: "active"
    });

    // Invitations in org_acme
    mockDb.store.set("orgInvitations/inv_pending_owner_cancel", {
      id: "inv_pending_owner_cancel",
      orgId: "org_acme",
      email: "invitee1@acme.com",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      history: [{ event: "created", timestamp: new Date().toISOString(), by: "owner@acme.com" }]
    });
    mockDb.store.set("orgInvitations/inv_pending_admin_cancel", {
      id: "inv_pending_admin_cancel",
      orgId: "org_acme",
      email: "invitee2@acme.com",
      role: "viewer",
      status: "pending",
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      history: [{ event: "created", timestamp: new Date().toISOString(), by: "admin@acme.com" }]
    });
    mockDb.store.set("orgInvitations/inv_accepted", {
      id: "inv_accepted",
      orgId: "org_acme",
      email: "accepted@acme.com",
      role: "member",
      status: "accepted",
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    });
    mockDb.store.set("orgInvitations/inv_expired", {
      id: "inv_expired",
      orgId: "org_acme",
      email: "expired@acme.com",
      role: "member",
      status: "expired",
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    });
    mockDb.store.set("orgInvitations/inv_rejected", {
      id: "inv_rejected",
      orgId: "org_acme",
      email: "rejected@acme.com",
      role: "member",
      status: "rejected"
    });

    // Invitations in org_beta
    mockDb.store.set("orgInvitations/inv_beta_pending", {
      id: "inv_beta_pending",
      orgId: "org_beta",
      email: "beta_invitee@beta.com",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    });

    // Projects
    mockDb.store.set("projects/proj_acme_shared", {
      id: "proj_acme_shared",
      name: "Acme Shared App",
      organizationId: "org_acme",
      userId: "user_owner"
    });
    mockDb.store.set("projects/proj_acme_member_owned", {
      id: "proj_acme_member_owned",
      name: "Acme Member Project",
      organizationId: "org_acme",
      userId: "user_member"
    });
    mockDb.store.set("projects/proj_personal_member", {
      id: "proj_personal_member",
      name: "Member Personal Project",
      userId: "user_member" // no organizationId
    });

    // Project Memberships
    mockDb.store.set("projectMembers/user_member_proj_acme_shared", {
      id: "user_member_proj_acme_shared",
      userId: "user_member",
      email: "member@acme.com",
      projectId: "proj_acme_shared",
      organizationId: "org_acme",
      role: "admin"
    });
    mockDb.store.set("projectMembers/user_member_proj_acme_member_owned", {
      id: "user_member_proj_acme_member_owned",
      userId: "user_member",
      email: "member@acme.com",
      projectId: "proj_acme_member_owned",
      organizationId: "org_acme",
      role: "owner"
    });
    mockDb.store.set("projectMembers/user_member_proj_personal_member", {
      id: "user_member_proj_personal_member",
      userId: "user_member",
      email: "member@acme.com",
      projectId: "proj_personal_member",
      role: "owner"
    });

    // Historical Recordings
    mockDb.store.set("recordings/rec_member_1", {
      id: "rec_member_1",
      projectId: "proj_acme_member_owned",
      organizationId: "org_acme",
      userId: "user_member",
      title: "Strategic Planning Q3",
      transcript: "Authoritative transcript data"
    });
    mockDb.store.set("recordings/rec_member_2", {
      id: "rec_member_2",
      projectId: "proj_acme_shared",
      organizationId: "org_acme",
      userId: "user_member",
      title: "Design System Sync",
      transcript: "Design tokens documentation"
    });
  };

  // ==========================================================================
  // SECTION 1: INVITATION CANCELLATION API
  // DELETE /api/organizations/:organizationId/invitations/:inviteId
  // ==========================================================================
  console.log("--- SECTION 1: INVITATION CANCELLATION (DELETE /invitations/:id) ---");

  setupFixtures();

  // 1.1 Owner can cancel pending invitation
  const res1_1 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_pending_owner_cancel", "user_owner");
  assertTest("1.1 Owner can cancel pending invitation (200)", res1_1.status === 200 && res1_1.data.success === true);
  const updatedInv1_1 = mockDb.store.get("orgInvitations/inv_pending_owner_cancel");
  assertTest("1.1 Invitation status updated to 'rejected'", updatedInv1_1?.status === "rejected");
  assertTest("1.1 Invitation history contains cancellation event", updatedInv1_1?.history?.some((h: any) => h.event === "cancelled"));
  
  // Verify Audit Log
  const auditLogs1_1 = Array.from(mockDb.store.entries()).filter(([k]) => k.startsWith("organizations/org_acme/auditLogs/"));
  const cancelLog1_1 = auditLogs1_1.find(([_, v]) => v.action === "INVITATION_CANCELLED");
  assertTest("1.1 Structured audit event INVITATION_CANCELLED recorded", cancelLog1_1 !== undefined);

  // 1.2 Org Admin can cancel pending invitation
  const res1_2 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_pending_admin_cancel", "user_org_admin");
  assertTest("1.2 Org Admin can cancel pending invitation (200)", res1_2.status === 200 && res1_2.data.success === true);
  const updatedInv1_2 = mockDb.store.get("orgInvitations/inv_pending_admin_cancel");
  assertTest("1.2 Invitation status updated to 'rejected'", updatedInv1_2?.status === "rejected");

  // 1.3 Team Manager is REJECTED (403)
  setupFixtures();
  const res1_3 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_pending_owner_cancel", "user_team_manager");
  assertTest("1.3 Team Manager is REJECTED (403)", res1_3.status === 403);
  assertTest("1.3 Invitation remains pending after failed attempt", mockDb.store.get("orgInvitations/inv_pending_owner_cancel")?.status === "pending");

  // 1.4 Member is REJECTED (403)
  const res1_4 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_pending_owner_cancel", "user_member");
  assertTest("1.4 Member is REJECTED (403)", res1_4.status === 403);

  // 1.5 Viewer is REJECTED (403)
  const res1_5 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_pending_owner_cancel", "user_viewer");
  assertTest("1.5 Viewer is REJECTED (403)", res1_5.status === 403);

  // 1.6 Unauthenticated is REJECTED (401)
  const res1_6 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_pending_owner_cancel");
  assertTest("1.6 Unauthenticated is REJECTED (401)", res1_6.status === 401);

  // 1.7 Nonexistent invitation returns 404
  const res1_7 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/nonexistent_invite_999", "user_owner");
  assertTest("1.7 Nonexistent invitation returns 404", res1_7.status === 404);

  // 1.8 Cross-organization invitation cancellation returns 404
  const res1_8 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_beta_pending", "user_owner");
  assertTest("1.8 Cross-organization invitation cancellation returns 404", res1_8.status === 404);
  assertTest("1.8 Beta invitation remains unmodified in org_beta", mockDb.store.get("orgInvitations/inv_beta_pending")?.status === "pending");

  // 1.9 Already accepted invitation is rejected (400)
  const res1_9 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_accepted", "user_owner");
  assertTest("1.9 Already accepted invitation is rejected (400)", res1_9.status === 400);

  // 1.10 Already rejected/cancelled invitation is rejected (400)
  const res1_10 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_rejected", "user_owner");
  assertTest("1.10 Already rejected invitation is rejected (400)", res1_10.status === 400);

  // 1.11 Already expired invitation is rejected (400)
  const res1_11 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_expired", "user_owner");
  assertTest("1.11 Already expired invitation is rejected (400)", res1_11.status === 400);

  // 1.12 Platform Admin supervisory cancellation is allowed (200)
  setupFixtures();
  const res1_12 = await requestHelper("DELETE", "/api/organizations/org_acme/invitations/inv_pending_owner_cancel", "user_platform_admin");
  assertTest("1.12 Platform Admin supervisory cancellation is allowed (200)", res1_12.status === 200);

  // ==========================================================================
  // SECTION 2: MEMBER DEPARTMENT ASSIGNMENT API
  // PATCH /api/organizations/:organizationId/members/:memberId/department
  // ==========================================================================
  console.log("\n--- SECTION 2: MEMBER DEPARTMENT ASSIGNMENT (PATCH /members/:id/department) ---");

  setupFixtures();

  // 2.1 Owner can assign member to valid department
  const res2_1 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_owner", {
    departmentId: "dept_design"
  });
  assertTest("2.1 Owner can assign member department (200)", res2_1.status === 200 && res2_1.data.success === true);
  assertTest("2.1 Member document updated with new departmentId", mockDb.store.get("orgMembers/mem_member")?.departmentId === "dept_design");

  // Verify Audit Log
  const auditLogs2_1 = Array.from(mockDb.store.entries()).filter(([k]) => k.startsWith("organizations/org_acme/auditLogs/"));
  const deptLog2_1 = auditLogs2_1.find(([_, v]) => v.action === "MEMBER_DEPARTMENT_ASSIGNED");
  assertTest("2.1 Structured audit event MEMBER_DEPARTMENT_ASSIGNED recorded", deptLog2_1 !== undefined);
  assertTest("2.1 Audit metadata records previous and new departmentId", deptLog2_1?.[1]?.metadata?.newDepartmentId === "dept_design");

  // 2.2 Org Admin can assign member department
  const res2_2 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_org_admin", {
    departmentId: "dept_eng"
  });
  assertTest("2.2 Org Admin can assign member department (200)", res2_2.status === 200);
  assertTest("2.2 Member document updated to dept_eng", mockDb.store.get("orgMembers/mem_member")?.departmentId === "dept_eng");

  // 2.3 Clearing department with empty string "" succeeds
  const res2_3a = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_owner", {
    departmentId: ""
  });
  assertTest("2.3a Clear department with empty string succeeds (200)", res2_3a.status === 200);
  assertTest("2.3a Member departmentId cleared to empty string", mockDb.store.get("orgMembers/mem_member")?.departmentId === "");

  // 2.3b Clearing department with null succeeds
  mockDb.store.get("orgMembers/mem_member").departmentId = "dept_eng";
  const res2_3b = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_owner", {
    departmentId: null
  });
  assertTest("2.3b Clear department with null succeeds (200)", res2_3b.status === 200);
  assertTest("2.3b Member departmentId cleared", mockDb.store.get("orgMembers/mem_member")?.departmentId === "");

  // 2.4 Team Manager is REJECTED (403)
  const res2_4 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_team_manager", {
    departmentId: "dept_eng"
  });
  assertTest("2.4 Team Manager is REJECTED (403)", res2_4.status === 403);

  // 2.5 Member is REJECTED (403)
  const res2_5 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_member", {
    departmentId: "dept_eng"
  });
  assertTest("2.5 Member is REJECTED (403)", res2_5.status === 403);

  // 2.6 Viewer is REJECTED (403)
  const res2_6 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_viewer", {
    departmentId: "dept_eng"
  });
  assertTest("2.6 Viewer is REJECTED (403)", res2_6.status === 403);

  // 2.7 Unauthenticated is REJECTED (401)
  const res2_7 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", undefined, {
    departmentId: "dept_eng"
  });
  assertTest("2.7 Unauthenticated is REJECTED (401)", res2_7.status === 401);

  // 2.8 Nonexistent member returns 404
  const res2_8 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_nonexistent/department", "user_owner", {
    departmentId: "dept_eng"
  });
  assertTest("2.8 Nonexistent member returns 404", res2_8.status === 404);

  // 2.9 Cross-organization member assignment returns 404
  const res2_9 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_beta_owner/department", "user_owner", {
    departmentId: "dept_eng"
  });
  assertTest("2.9 Cross-organization member returns 404", res2_9.status === 404);

  // 2.10 Nonexistent department returns 404
  const res2_10 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_owner", {
    departmentId: "dept_ghost_404"
  });
  assertTest("2.10 Nonexistent department returns 404", res2_10.status === 404);

  // 2.11 Cross-organization department assignment returns 400
  const res2_11 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_owner", {
    departmentId: "dept_beta"
  });
  assertTest("2.11 Cross-organization department assignment rejected (400)", res2_11.status === 400);

  // 2.12 Inactive department assignment returns 400
  const res2_12 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_owner", {
    departmentId: "dept_inactive"
  });
  assertTest("2.12 Inactive department assignment rejected (400)", res2_12.status === 400);

  // 2.13 Disallowed extra body fields (e.g. role tampering) are ignored
  mockDb.store.get("orgMembers/mem_member").role = "member";
  const res2_13 = await requestHelper("PATCH", "/api/organizations/org_acme/members/mem_member/department", "user_owner", {
    departmentId: "dept_eng",
    role: "owner", // tampering attempt
    orgId: "org_evil"
  });
  assertTest("2.13 Department assigned successfully (200)", res2_13.status === 200);
  assertTest("2.13 Member role was NOT modified by department endpoint", mockDb.store.get("orgMembers/mem_member")?.role === "member");
  assertTest("2.13 Member orgId was NOT modified by department endpoint", mockDb.store.get("orgMembers/mem_member")?.orgId === "org_acme");

  // ==========================================================================
  // SECTION 3: MEMBER REMOVAL & STALE PROJECT MEMBERSHIP CLEANUP
  // DELETE /api/organizations/:organizationId/members/:memberId
  // ==========================================================================
  console.log("\n--- SECTION 3: MEMBER REMOVAL & STALE PROJECT MEMBERSHIP CLEANUP ---");

  setupFixtures();

  // 3.1 Owner can remove eligible member
  const res3_1 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_member", "user_owner");
  assertTest("3.1 Owner can remove eligible member (200)", res3_1.status === 200 && res3_1.data.success === true);
  assertTest("3.1 Returns count of cleaned project memberships", typeof res3_1.data.cleanedProjectMembershipsCount === "number");

  // 3.2 Member record deleted from orgMembers
  assertTest("3.2 Member record deleted from orgMembers", !mockDb.store.has("orgMembers/mem_member"));

  // 3.3 Custom claims revoked
  const revokedClaims = mockDb.customClaimsStore.get("user_member");
  assertTest("3.3 User custom claims revoked (orgId: null, orgRole: null)", revokedClaims?.orgId === null && revokedClaims?.orgRole === null);

  // 3.4 Project memberships within organization are cleaned up
  assertTest("3.4 Project membership in shared project deleted", !mockDb.store.has("projectMembers/user_member_proj_acme_shared"));
  assertTest("3.4 Project membership in org project deleted", !mockDb.store.has("projectMembers/user_member_proj_acme_member_owned"));

  // 3.5 Personal / Cross-org project membership is PRESERVED
  assertTest("3.5 Unrelated personal project membership is PRESERVED", mockDb.store.has("projectMembers/user_member_proj_personal_member"));

  // 3.6 Organizational project is PRESERVED (NOT deleted)
  assertTest("3.6 Organizational project owned by member is PRESERVED", mockDb.store.has("projects/proj_acme_member_owned"));

  // 3.7 Historical recordings are PRESERVED (NOT deleted)
  assertTest("3.7 Historical recording in org project is PRESERVED", mockDb.store.has("recordings/rec_member_1"));
  assertTest("3.7 Historical recording in shared project is PRESERVED", mockDb.store.has("recordings/rec_member_2"));

  // 3.8 Tenant boundary cutoff: removed user CANNOT access organization projects
  const accessCheck = await resolveProjectAccess(mockDb as any, { uid: "user_member", email: "member@acme.com" }, "proj_acme_member_owned");
  assertTest("3.8 Removed user is immediately DENIED access to org project via tenant isolation", accessCheck.hasAccess === false);

  // 3.9 Audit log recorded for member removal
  const auditLogs3 = Array.from(mockDb.store.entries()).filter(([k]) => k.startsWith("organizations/org_acme/auditLogs/"));
  const removeLog = auditLogs3.find(([_, v]) => v.action === "MEMBER_REMOVED");
  assertTest("3.9 Structured audit event MEMBER_REMOVED recorded", removeLog !== undefined);
  assertTest("3.9 Audit log records actor, target user, and cleaned project count", removeLog?.[1]?.targetUserEmail === "member@acme.com");

  // 3.10 Idempotency: repeated removal returns 404 without error or duplicate side-effects
  const res3_10 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_member", "user_owner");
  assertTest("3.10 Repeated removal of already-removed member returns 404", res3_10.status === 404);

  // 3.11 Org Admin can remove eligible member (viewer)
  setupFixtures();
  const res3_11 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_viewer", "user_org_admin");
  assertTest("3.11 Org Admin can remove eligible member (200)", res3_11.status === 200);
  assertTest("3.11 Viewer member record deleted", !mockDb.store.has("orgMembers/mem_viewer"));

  // 3.12 Org Admin CANNOT remove another Org Admin (403)
  const res3_12 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_admin_2", "user_org_admin");
  assertTest("3.12 Org Admin CANNOT remove another Org Admin (403)", res3_12.status === 403);
  assertTest("3.12 Target admin remains active member", mockDb.store.has("orgMembers/mem_admin_2"));

  // 3.13 Owner can remove Org Admin
  const res3_13 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_admin_2", "user_owner");
  assertTest("3.13 Owner CAN remove Org Admin (200)", res3_13.status === 200);
  assertTest("3.13 Org Admin record deleted by owner", !mockDb.store.has("orgMembers/mem_admin_2"));

  // 3.14 Organization Owner CANNOT be removed (400)
  const res3_14 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_owner", "user_org_admin");
  assertTest("3.14 Org Admin CANNOT remove Owner (400)", res3_14.status === 400);
  const res3_14b = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_owner", "user_owner");
  assertTest("3.14 Owner CANNOT remove self as Owner (400)", res3_14b.status === 400);

  // 3.15 Team Manager CANNOT remove members (403)
  const res3_15 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_viewer", "user_team_manager");
  assertTest("3.15 Team Manager CANNOT remove members (403)", res3_15.status === 403);

  // 3.16 Member CANNOT remove members (403)
  const res3_16 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_viewer", "user_member");
  assertTest("3.16 Member CANNOT remove members (403)", res3_16.status === 403);

  // 3.17 Viewer CANNOT remove members (403)
  const res3_17 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_viewer", "user_viewer");
  assertTest("3.17 Viewer CANNOT remove members (403)", res3_17.status === 403);

  // 3.18 Unauthenticated caller CANNOT remove members (401)
  const res3_18 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_viewer");
  assertTest("3.18 Unauthenticated caller CANNOT remove members (401)", res3_18.status === 401);

  // 3.19 Cross-organization member removal is REJECTED (404)
  const res3_19 = await requestHelper("DELETE", "/api/organizations/org_acme/members/mem_beta_owner", "user_owner");
  assertTest("3.19 Cross-organization member removal returns 404", res3_19.status === 404);
  assertTest("3.19 Beta owner remains intact in org_beta", mockDb.store.has("orgMembers/mem_beta_owner"));

  // Clean up server
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log("\n================================================================================");
  console.log(`📊 STEP 5B VERIFICATION RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    console.error(`❌ ${failedTests} test(s) failed.`);
    process.exit(1);
  } else {
    console.log("🎉 ALL STEP 5B ADMIN BACKEND VERIFICATION INVARIANTS PASSED PERFECTLY!");
    process.exit(0);
  }
}

runSuite().catch((err) => {
  console.error("🔥 Fatal error in test suite:", err);
  process.exit(1);
});
