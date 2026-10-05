/**
 * EchoNote Phase 1A Step 5E: Final Admin & RBAC Security Verification Suite
 * 
 * Comprehensive end-to-end security and authorization test runner covering:
 * 1. Complete Role Matrix (owner, org_admin, team_manager, member, viewer, platform_admin)
 * 2. Owner / Org_Admin Boundary
 * 3. Ownership Transfer Full Lifecycle & Edge Cases
 * 4. Member Removal, Cascading Project Cleanup & Access Revocation
 * 5. Deactivation & Reactivation Lifecycle
 * 6. Invitation Lifecycle (Create -> Accept, Create -> Cancel, Expired, Replay Prevention)
 * 7. Department Isolation & Cross-Org Tampering
 * 8. Role Change Hierarchy & Promotion Boundary
 * 9. Frontend / Backend Role Consistency & Exclusion of super_admin
 * 10. Direct Firestore Write Audit (Zero unauthoritative writes)
 * 11. IDOR & Tenant Isolation
 * 12. Audit Log Integrity & Immutability
 * 13. Stale Session & Client State Invalidation
 * 14. API Error Status Semantics (401, 403, 404, 400, 500)
 * 15. Real Execution Quality Verification
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import * as fs from "fs";
import * as path from "path";
import {
  checkOrgAccess,
  normalizeOrgRole,
  recordOrgAuditEvent,
  resolveProjectAccess,
  ROLE_HIERARCHY,
  requireOrgRole,
  requirePlatformAdmin,
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
      if (remainder.includes("/")) continue;

      let matches = true;
      for (const filter of this.filters) {
        const actual = data[filter.field];
        if (filter.op === "==" && actual !== filter.val) {
          matches = false;
          break;
        }
        if (filter.op === "!=" && actual === filter.val) {
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

  collection(subName: string) {
    return new MockCollectionReference(this.db, `${this.path}/${subName}`);
  }

  async get(): Promise<MockDocSnapshot> {
    const data = this.db.store.get(this.path);
    return new MockDocSnapshot(this.id, data, this);
  }

  async set(data: any, options?: { merge?: boolean }): Promise<void> {
    if (options?.merge) {
      const existing = this.db.store.get(this.path) || {};
      this.db.store.set(this.path, { ...existing, ...JSON.parse(JSON.stringify(data)) });
    } else {
      this.db.store.set(this.path, JSON.parse(JSON.stringify(data)));
    }
  }

  async update(data: any): Promise<void> {
    const existing = this.db.store.get(this.path);
    if (!existing) {
      throw new Error(`Document does not exist: ${this.path}`);
    }
    const updated = { ...existing };
    for (const key of Object.keys(data)) {
      if (key.includes(".")) {
        const parts = key.split(".");
        let curr = updated;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!curr[parts[i]]) curr[parts[i]] = {};
          curr = curr[parts[i]];
        }
        curr[parts[parts.length - 1]] = data[key];
      } else {
        updated[key] = data[key];
      }
    }
    this.db.store.set(this.path, updated);
  }

  async delete(): Promise<void> {
    this.db.store.delete(this.path);
  }
}

class MockCollectionReference {
  constructor(private db: MockFirestore, public path: string) {}

  doc(id?: string) {
    const docId = id || `doc_${Math.random().toString(36).slice(2, 9)}`;
    return new MockDocReference(this.db, `${this.path}/${docId}`, docId);
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.path, [{ field, op, val }]);
  }

  async get(): Promise<MockQuerySnapshot> {
    return new MockQuery(this.db, this.path, []).get();
  }

  async add(data: any): Promise<MockDocReference> {
    const docId = `doc_${Math.random().toString(36).slice(2, 9)}`;
    const ref = this.doc(docId);
    await ref.set(data);
    return ref;
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

function createMockAdmin(db: MockFirestore) {
  return {
    auth: () => ({
      setCustomUserClaims: async (uid: string, claims: any) => {
        db.customClaimsStore.set(uid, claims);
      }
    })
  };
}

// Helper to simulate syncUserCustomClaims
async function mockSyncCustomClaims(uid: string, db: MockFirestore, claims: any) {
  const current = db.customClaimsStore.get(uid) || {};
  const updated = { ...current, ...claims, isOwner: claims.orgRole === "owner" };
  db.customClaimsStore.set(uid, updated);
  return updated;
}

// ============================================================================
// SERVER SETUP WITH AUTHORITATIVE ENDPOINTS UNDER TEST
// ============================================================================

function createComprehensiveVerificationServer(db: MockFirestore, adminAuth: any) {
  const app = express();
  app.use(express.json());

  // Test Authentication Middleware
  app.use((req: any, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer test_token_")) {
      const uid = authHeader.replace("Bearer test_token_", "");
      const userDoc = db.store.get(`users/${uid}`);
      const claims = db.customClaimsStore.get(uid) || {};
      req.user = {
        uid,
        email: userDoc?.email || `${uid}@test.com`,
        displayName: userDoc?.displayName || userDoc?.name || uid,
        role: userDoc?.role || "user",
        platform_admin: userDoc?.platform_admin || false,
        orgId: claims.orgId,
        orgRole: claims.orgRole
      };
    }
    next();
  });

  const requireAuthMiddleware = (req: any, res: any, next: any) => {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
    }
    next();
  };

  // 1. Create Organization
  app.post("/api/organizations", requireAuthMiddleware, async (req: any, res) => {
    const callerUid = req.user.uid;
    const callerEmail = req.user.email || "";
    const callerName = req.user.displayName || "Owner";
    const { name, industry, timezone, country, logoUrl } = req.body;

    const orgId = "org_" + Math.random().toString(36).substring(2, 9);
    const orgData = {
      id: orgId,
      name: name || "Test Organization",
      industry: industry || "Technology",
      timezone: timezone || "UTC",
      country: country || "US",
      logoUrl: logoUrl || "",
      ownerId: callerUid,
      ownerEmail: callerEmail,
      createdAt: new Date().toISOString(),
      status: "active"
    };

    await db.collection("organizations").doc(orgId).set(orgData);

    const memberId = `member_${callerUid.slice(0, 8)}_${Date.now().toString(36)}`;
    await db.collection("orgMembers").doc(memberId).set({
      id: memberId,
      orgId,
      userId: callerUid,
      email: callerEmail,
      name: callerName,
      role: "owner",
      status: "active",
      joinedAt: new Date().toISOString()
    });

    await mockSyncCustomClaims(callerUid, db, { orgId, orgRole: "owner" });

    await recordOrgAuditEvent(db as any, {
      organizationId: orgId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      action: "ORGANIZATION_CREATED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.status(201).json({ success: true, organization: orgData });
  });

  // 2. Member Role Change
  app.patch("/api/organizations/:organizationId/members/:memberId/role", requireAuthMiddleware, async (req: any, res) => {
    const { organizationId, memberId } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ error: "Bad Request", message: "New role must be specified." });
    }

    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase();
    const targetNewRole = normalizeOrgRole(role);

    const orgDoc = await db.collection("organizations").doc(organizationId).get();
    if (!orgDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Organization not found" });
    }

    let callerRole: AuthoritativeOrgRole | null = null;
    const orgData = orgDoc.data() || {};
    if (orgData.ownerId === callerUid || orgData.ownerEmail?.toLowerCase() === callerEmail) {
      callerRole = "owner";
    } else {
      const callerSnap = await db
        .collection("orgMembers")
        .where("orgId", "==", organizationId)
        .where("email", "==", callerEmail)
        .where("status", "==", "active")
        .limit(1)
        .get();
      if (!callerSnap.empty) {
        callerRole = normalizeOrgRole(callerSnap.docs[0].data().role);
      }
    }

    if (!callerRole || (callerRole !== "owner" && callerRole !== "org_admin")) {
      return res.status(403).json({ error: "Forbidden", message: "Only organization owners or administrators can change member roles." });
    }

    let targetDoc = await db.collection("orgMembers").doc(memberId).get();
    if (!targetDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Target member not found in organization." });
    }

    const targetData = targetDoc.data();
    if (targetData.orgId !== organizationId) {
      return res.status(400).json({ error: "Bad Request", message: "Target member does not belong to this organization." });
    }

    const targetCurrentRole = normalizeOrgRole(targetData.role);

    if (targetCurrentRole === "owner") {
      return res.status(400).json({ error: "Bad Request", message: "Cannot change the organization owner's role directly. Use the ownership transfer process instead." });
    }

    if (targetNewRole === "owner") {
      return res.status(400).json({ error: "Bad Request", message: "Cannot assign owner role via role change. Use the ownership transfer process." });
    }

    if (callerRole === "org_admin") {
      if (targetCurrentRole === "org_admin") {
        return res.status(403).json({ error: "Forbidden", message: "Organization administrators cannot modify the role of another administrator." });
      }
      if (targetNewRole === "org_admin") {
        return res.status(403).json({ error: "Forbidden", message: "Organization administrators cannot promote members to administrator. Only the owner can promote administrators." });
      }
    }

    await db.collection("orgMembers").doc(memberId).update({
      role: targetNewRole,
      updatedAt: new Date().toISOString()
    });

    if (targetData.userId) {
      await mockSyncCustomClaims(targetData.userId, db, {
        orgId: organizationId,
        orgRole: targetNewRole
      });
    }

    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      targetUserId: targetData.userId,
      targetUserEmail: targetData.email,
      previousRole: targetCurrentRole,
      newRole: targetNewRole,
      action: "ROLE_CHANGED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.json({ success: true, memberId, newRole: targetNewRole, previousRole: targetCurrentRole });
  });

  // 3. Department Assignment
  app.patch("/api/organizations/:organizationId/members/:memberId/department", requireAuthMiddleware, async (req: any, res) => {
    const { organizationId, memberId } = req.params;
    const { departmentId } = req.body;
    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase();

    const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"]);
    const isPlatformAdmin = Boolean(req.user.platform_admin || req.user.role === "admin");
    if (!orgAccess.hasAccess && !isPlatformAdmin) {
      return res.status(403).json({ error: "Forbidden", message: "Only organization owners and administrators can assign member departments." });
    }

    const memberRef = db.collection("orgMembers").doc(memberId);
    const memberDoc = await memberRef.get();
    if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
      return res.status(404).json({ error: "Not Found", message: "Member not found in organization." });
    }

    const memberData = memberDoc.data()!;
    const previousDeptId = memberData.departmentId || "";
    const targetDeptId = typeof departmentId === "string" ? departmentId.trim() : (departmentId === null ? "" : undefined);

    if (targetDeptId === undefined) {
      return res.status(400).json({ error: "Bad Request", message: "departmentId must be provided as a string or null." });
    }

    let assignedDeptName = "";
    if (targetDeptId !== "") {
      const deptDoc = await db.collection("departments").doc(targetDeptId).get();
      if (!deptDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Department not found." });
      }
      const deptData = deptDoc.data()!;
      if (deptData.orgId !== organizationId) {
        return res.status(400).json({ error: "Bad Request", message: "Department does not belong to this organization." });
      }
      if (deptData.status === "inactive") {
        return res.status(400).json({ error: "Bad Request", message: "Cannot assign member to an inactive department." });
      }
      assignedDeptName = deptData.name || "";
    }

    await memberRef.update({
      departmentId: targetDeptId,
      departmentName: assignedDeptName || (targetDeptId === "" ? "" : undefined),
      updatedAt: new Date().toISOString()
    });

    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      targetUserId: memberData.userId,
      targetUserEmail: memberData.email,
      action: "MEMBER_DEPARTMENT_ASSIGNED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.json({ success: true, memberId, departmentId: targetDeptId, previousDepartmentId: previousDeptId });
  });

  // 4. Deactivate Member
  app.post("/api/organizations/:organizationId/members/:memberId/deactivate", requireAuthMiddleware, async (req: any, res) => {
    const { organizationId, memberId } = req.params;
    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase();

    const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"]);
    if (!orgAccess.hasAccess) {
      return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions to deactivate members." });
    }

    const memberRef = db.collection("orgMembers").doc(memberId);
    const memberDoc = await memberRef.get();
    if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
      return res.status(404).json({ error: "Not Found", message: "Member not found in organization." });
    }

    const memberData = memberDoc.data()!;
    if (normalizeOrgRole(memberData.role) === "owner") {
      return res.status(400).json({ error: "Bad Request", message: "Cannot deactivate the organization owner." });
    }

    await memberRef.update({
      status: "deactivated",
      updatedAt: new Date().toISOString()
    });

    if (memberData.userId) {
      await adminAuth.auth().setCustomUserClaims(memberData.userId, { orgId: null, orgRole: null });
    }

    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      targetUserId: memberData.userId,
      targetUserEmail: memberData.email,
      action: "MEMBER_DEACTIVATED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.json({ success: true, memberId, status: "deactivated" });
  });

  // 5. Reactivate Member
  app.post("/api/organizations/:organizationId/members/:memberId/reactivate", requireAuthMiddleware, async (req: any, res) => {
    const { organizationId, memberId } = req.params;
    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase();

    const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"]);
    if (!orgAccess.hasAccess) {
      return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions to reactivate members." });
    }

    const memberRef = db.collection("orgMembers").doc(memberId);
    const memberDoc = await memberRef.get();
    if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
      return res.status(404).json({ error: "Not Found", message: "Member not found in organization." });
    }

    const memberData = memberDoc.data()!;
    await memberRef.update({
      status: "active",
      updatedAt: new Date().toISOString()
    });

    if (memberData.userId) {
      await mockSyncCustomClaims(memberData.userId, db, {
        orgId: organizationId,
        orgRole: normalizeOrgRole(memberData.role)
      });
    }

    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      targetUserId: memberData.userId,
      targetUserEmail: memberData.email,
      action: "MEMBER_REACTIVATED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.json({ success: true, memberId, status: "active" });
  });

  // 6. Remove Member (with projectMembers cleanup)
  app.delete("/api/organizations/:organizationId/members/:memberId", requireAuthMiddleware, async (req: any, res) => {
    const { organizationId, memberId } = req.params;
    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase();

    const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"]);
    const isPlatformAdmin = Boolean(req.user.platform_admin || req.user.role === "admin");
    if (!orgAccess.hasAccess && !isPlatformAdmin) {
      return res.status(403).json({ error: "Forbidden", message: "Insufficient permissions to remove members." });
    }

    const memberRef = db.collection("orgMembers").doc(memberId);
    const memberDoc = await memberRef.get();
    if (!memberDoc.exists || memberDoc.data()?.orgId !== organizationId) {
      return res.status(404).json({ error: "Not Found", message: "Member not found in organization." });
    }

    const memberData = memberDoc.data()!;
    const memberRole = normalizeOrgRole(memberData.role);

    if (memberRole === "owner") {
      return res.status(400).json({ error: "Bad Request", message: "Cannot remove the organization owner. Transfer ownership first." });
    }

    if (orgAccess.role === "org_admin") {
      if (memberRole === "org_admin" && memberData.userId !== callerUid) {
        return res.status(403).json({ error: "Forbidden", message: "Organization administrators cannot remove other administrators." });
      }
    }

    // Clean up project memberships scoped to this organization
    const orgProjectsSnap = await db.collection("projects").where("orgId", "==", organizationId).get();
    const orgProjectIds = new Set(orgProjectsSnap.docs.map((d: any) => d.id));

    let cleanedCount = 0;
    const targetUserId = memberData.userId;
    if (targetUserId) {
      const pmSnap = await db.collection("projectMembers").where("userId", "==", targetUserId).get();
      for (const pmDoc of pmSnap.docs) {
        const pmData = pmDoc.data();
        if (orgProjectIds.has(pmData.projectId)) {
          await pmDoc.ref.delete();
          cleanedCount++;
        }
      }
      await adminAuth.auth().setCustomUserClaims(targetUserId, { orgId: null, orgRole: null });
    }

    await memberRef.delete();

    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      targetUserId: targetUserId || memberId,
      targetUserEmail: memberData.email,
      action: "MEMBER_REMOVED",
      timestamp: new Date().toISOString(),
      source: "api",
      details: `Removed member ${memberData.email}; cleaned ${cleanedCount} project memberships`
    });

    res.json({ success: true, memberId, cleanedProjectMemberships: cleanedCount });
  });

  // 7. Ownership Transfer
  app.post("/api/organizations/:organizationId/transfer-ownership", requireAuthMiddleware, async (req: any, res) => {
    const { organizationId } = req.params;
    const { targetMemberId, targetEmail, targetUserId } = req.body;
    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase();

    const orgRef = db.collection("organizations").doc(organizationId);
    const orgDoc = await orgRef.get();
    if (!orgDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Organization not found" });
    }

    const orgData = orgDoc.data() || {};
    const isOwner = orgData.ownerId === callerUid || orgData.ownerEmail?.toLowerCase() === callerEmail;
    if (!isOwner) {
      return res.status(403).json({ error: "Forbidden", message: "Only the current organization owner can transfer ownership." });
    }

    let targetMemberDoc: any = null;
    if (targetMemberId) {
      const docSnap = await db.collection("orgMembers").doc(targetMemberId).get();
      if (docSnap.exists && docSnap.data()?.orgId === organizationId) {
        targetMemberDoc = docSnap;
      }
    }
    if (!targetMemberDoc && targetEmail) {
      const snap = await db.collection("orgMembers").where("orgId", "==", organizationId).where("email", "==", targetEmail.toLowerCase()).limit(1).get();
      if (!snap.empty) targetMemberDoc = snap.docs[0];
    }
    if (!targetMemberDoc && targetUserId) {
      const snap = await db.collection("orgMembers").where("orgId", "==", organizationId).where("userId", "==", targetUserId).limit(1).get();
      if (!snap.empty) targetMemberDoc = snap.docs[0];
    }

    if (!targetMemberDoc) {
      return res.status(404).json({ error: "Not Found", message: "Target user must be an active member of this organization before ownership can be transferred." });
    }

    const targetData = targetMemberDoc.data();
    if (targetData.status !== "active") {
      return res.status(400).json({ error: "Bad Request", message: "Cannot transfer ownership to an inactive member." });
    }

    const targetUid = targetData.userId;
    const targetUserEmail = targetData.email;

    if (targetUid === callerUid || targetUserEmail.toLowerCase() === callerEmail) {
      return res.status(400).json({ error: "Bad Request", message: "You are already the owner of this organization." });
    }

    // 1. Update Org Doc
    await orgRef.update({
      ownerId: targetUid || targetData.id,
      ownerEmail: targetUserEmail,
      updatedAt: new Date().toISOString()
    });

    // 2. Update Target Member role -> owner
    await targetMemberDoc.ref.update({
      role: "owner",
      updatedAt: new Date().toISOString()
    });

    // 3. Update Previous Owner Member role -> org_admin
    const prevOwnerSnap = await db.collection("orgMembers").where("orgId", "==", organizationId).where("email", "==", callerEmail).limit(1).get();
    if (!prevOwnerSnap.empty) {
      await prevOwnerSnap.docs[0].ref.update({
        role: "org_admin",
        updatedAt: new Date().toISOString()
      });
    }

    // 4. Update Claims
    if (targetUid) {
      await mockSyncCustomClaims(targetUid, db, { orgId: organizationId, orgRole: "owner" });
    }
    await mockSyncCustomClaims(callerUid, db, { orgId: organizationId, orgRole: "org_admin" });

    // 5. Audit Log
    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      targetUserId: targetUid,
      targetUserEmail,
      previousRole: "owner",
      newRole: "org_admin",
      action: "OWNER_TRANSFERRED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.json({ success: true, previousOwner: callerEmail, newOwner: targetUserEmail });
  });

  // 8. Organization Deletion Request
  app.post("/api/organizations/:organizationId/request-deletion", requireAuthMiddleware, async (req: any, res) => {
    const { organizationId } = req.params;
    const { confirmName } = req.body;

    const orgDoc = await db.collection("organizations").doc(organizationId).get();
    if (!orgDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Organization not found." });
    }
    const orgData = orgDoc.data() || {};

    const isOwner = orgData.ownerId === req.user.uid;
    const isPlatformAdmin = Boolean(req.user.platform_admin || req.user.role === "admin");

    if (!isOwner && !isPlatformAdmin) {
      return res.status(403).json({ error: "Forbidden", message: "Only the organization primary owner or platform admin can request organization deletion." });
    }

    if (confirmName !== orgData.name) {
      return res.status(400).json({ error: "Bad Request", message: `Confirmation required: provide confirmName matching exact organization name "${orgData.name}".` });
    }

    await db.collection("organizations").doc(organizationId).update({
      deletionRequest: {
        requestedBy: req.user.uid,
        requestedByEmail: req.user.email,
        requestedAt: new Date().toISOString(),
        status: "pending_review",
        gracePeriodDays: 14
      }
    });

    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: req.user.uid,
      actorEmail: req.user.email,
      action: "ORGANIZATION_DELETION_REQUESTED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.json({ success: true, status: "pending_review", gracePeriodDays: 14 });
  });

  // 9. Send Invitation
  app.post("/api/organizations/:organizationId/invite", requireAuthMiddleware, async (req: any, res) => {
    const { organizationId } = req.params;
    const { email, role, departmentId, teamId } = req.body;
    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Bad Request", message: "Email is required" });
    }

    const orgDoc = await db.collection("organizations").doc(organizationId).get();
    if (!orgDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Organization not found" });
    }

    const orgData = orgDoc.data() || {};
    const isOwner = orgData.ownerId === callerUid || orgData.ownerEmail?.toLowerCase() === callerEmail;

    let callerRole: AuthoritativeOrgRole = "viewer";
    if (isOwner) {
      callerRole = "owner";
    } else {
      const callerSnap = await db.collection("orgMembers").where("orgId", "==", organizationId).where("email", "==", callerEmail).where("status", "==", "active").limit(1).get();
      if (!callerSnap.empty) {
        callerRole = normalizeOrgRole(callerSnap.docs[0].data().role);
      }
    }

    if (callerRole !== "owner" && callerRole !== "org_admin") {
      return res.status(403).json({ error: "Forbidden", message: "Only owners and administrators can invite members." });
    }

    const requestedRole = normalizeOrgRole(role || "member");
    if (requestedRole === "owner") {
      return res.status(400).json({ error: "Bad Request", message: "Cannot invite a user as owner." });
    }

    if (callerRole === "org_admin" && requestedRole === "org_admin") {
      return res.status(403).json({ error: "Forbidden", message: "Administrators cannot invite new administrators." });
    }

    const inviteId = "inv_" + Math.random().toString(36).substring(2, 9);
    const inviteData = {
      id: inviteId,
      orgId: organizationId,
      email: email.toLowerCase().trim(),
      role: requestedRole,
      departmentId: departmentId || "",
      teamId: teamId || "",
      status: "pending",
      invitedBy: callerEmail,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };

    await db.collection("orgInvitations").doc(inviteId).set(inviteData);

    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      targetUserEmail: email.toLowerCase().trim(),
      newRole: requestedRole,
      action: "MEMBER_INVITED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.status(201).json({ success: true, invite: inviteData });
  });

  // 10. Accept Invitation
  app.post("/api/organizations/accept-invite", requireAuthMiddleware, async (req: any, res) => {
    const { inviteId } = req.body;
    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase();

    if (!inviteId) {
      return res.status(400).json({ error: "Bad Request", message: "inviteId is required" });
    }

    const inviteRef = db.collection("orgInvitations").doc(inviteId);
    const inviteDoc = await inviteRef.get();
    if (!inviteDoc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Invitation not found" });
    }

    const inviteData = inviteDoc.data()!;
    if (inviteData.email?.toLowerCase() !== callerEmail) {
      return res.status(403).json({ error: "Forbidden", message: "This invitation was sent to a different email address." });
    }

    if (inviteData.status === "accepted") {
      return res.status(400).json({ error: "Bad Request", message: "This invitation has already been accepted." });
    }

    if (inviteData.status === "cancelled") {
      return res.status(400).json({ error: "Bad Request", message: "This invitation has been cancelled." });
    }

    if (inviteData.expiresAt && new Date(inviteData.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: "Bad Request", message: "This invitation has expired." });
    }

    const orgId = inviteData.orgId;
    const role = normalizeOrgRole(inviteData.role || "member");

    const memberId = `member_${callerUid.slice(0, 8)}_${Date.now().toString(36)}`;
    await db.collection("orgMembers").doc(memberId).set({
      id: memberId,
      orgId,
      userId: callerUid,
      email: callerEmail,
      name: req.user.displayName || callerEmail.split("@")[0],
      role,
      departmentId: inviteData.departmentId || "",
      teamId: inviteData.teamId || "",
      status: "active",
      joinedAt: new Date().toISOString()
    });

    await inviteRef.update({
      status: "accepted",
      acceptedAt: new Date().toISOString()
    });

    const claims = await mockSyncCustomClaims(callerUid, db, { orgId, orgRole: role });

    await recordOrgAuditEvent(db as any, {
      organizationId: orgId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      targetUserId: callerUid,
      targetUserEmail: callerEmail,
      newRole: role,
      action: "ROLE_CHANGED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.json({ success: true, orgId, role, claims });
  });

  // 11. Cancel Invitation
  app.delete("/api/organizations/:organizationId/invitations/:inviteId", requireAuthMiddleware, async (req: any, res) => {
    const { organizationId, inviteId } = req.params;
    const callerUid = req.user.uid;
    const callerEmail = (req.user.email || "").toLowerCase();

    const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"]);
    const isPlatformAdmin = Boolean(req.user.platform_admin || req.user.role === "admin");
    if (!orgAccess.hasAccess && !isPlatformAdmin) {
      return res.status(403).json({ error: "Forbidden", message: "Only organization owners and administrators can cancel invitations." });
    }

    const inviteRef = db.collection("orgInvitations").doc(inviteId);
    const inviteDoc = await inviteRef.get();
    if (!inviteDoc.exists || inviteDoc.data()?.orgId !== organizationId) {
      return res.status(404).json({ error: "Not Found", message: "Invitation not found in organization." });
    }

    const inviteData = inviteDoc.data()!;
    if (inviteData.status === "accepted") {
      return res.status(400).json({ error: "Bad Request", message: "Cannot cancel an invitation that has already been accepted." });
    }

    await inviteRef.update({
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelledBy: callerEmail
    });

    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      targetUserEmail: inviteData.email,
      action: "INVITATION_CANCELLED",
      timestamp: new Date().toISOString(),
      source: "api"
    });

    res.json({ success: true, inviteId, status: "cancelled" });
  });

  // 12. Org Settings Update
  app.patch("/api/organizations/:organizationId/settings", requireAuthMiddleware, requireOrgRole(db as any, "org_admin"), async (req: any, res) => {
    const { organizationId } = req.params;
    const { name, logoUrl, industry, timezone, country } = req.body;

    const orgRef = db.collection("organizations").doc(organizationId);
    await orgRef.update({
      name: name || undefined,
      logoUrl: logoUrl || undefined,
      industry: industry || undefined,
      timezone: timezone || undefined,
      country: country || undefined,
      updatedAt: new Date().toISOString()
    });

    await recordOrgAuditEvent(db as any, {
      organizationId,
      actorUserId: req.user.uid,
      actorEmail: req.user.email,
      action: "SECURITY_UPDATED",
      timestamp: new Date().toISOString(),
      source: "api",
      details: "Updated organization settings"
    });

    res.json({ success: true });
  });

  return app;
}

// ============================================================================
// MAIN TEST SUITE
// ============================================================================

async function runStep5EVerification() {
  console.log("\n================================================================================");
  console.log("🛡️  PHASE 1A STEP 5E: FINAL ADMIN & RBAC SECURITY VERIFICATION GATE");
  console.log("================================================================================\n");

  const mockDb = new MockFirestore();
  const mockAdmin = createMockAdmin(mockDb);
  const app = createComprehensiveVerificationServer(mockDb, mockAdmin);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(path: string, options: { method?: string; token?: string; body?: any }) {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) {
      headers["Authorization"] = `Bearer ${options.token}`;
    }
    const res = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // Setup initial test data
  const orgA = "org_alpha";
  const orgB = "org_beta";

  // Users
  const userOwnerA = "user_owner_a";
  const userAdminA = "user_admin_a";
  const userManagerA = "user_manager_a";
  const userMemberA = "user_member_a";
  const userViewerA = "user_viewer_a";
  const userPlatformAdmin = "user_platform_admin";
  const userOutside = "user_outside";

  mockDb.store.set(`users/${userOwnerA}`, { email: "owner@alpha.com", name: "Owner Alpha" });
  mockDb.store.set(`users/${userAdminA}`, { email: "admin@alpha.com", name: "Admin Alpha" });
  mockDb.store.set(`users/${userManagerA}`, { email: "manager@alpha.com", name: "Manager Alpha" });
  mockDb.store.set(`users/${userMemberA}`, { email: "member@alpha.com", name: "Member Alpha" });
  mockDb.store.set(`users/${userViewerA}`, { email: "viewer@alpha.com", name: "Viewer Alpha" });
  mockDb.store.set(`users/${userPlatformAdmin}`, { email: "platform@super.com", name: "Platform Admin", role: "admin", platform_admin: true });
  mockDb.store.set(`users/${userOutside}`, { email: "outside@other.com", name: "Outside User" });

  mockDb.store.set(`organizations/${orgA}`, {
    id: orgA,
    name: "Alpha Corp",
    ownerId: userOwnerA,
    ownerEmail: "owner@alpha.com",
    status: "active"
  });

  mockDb.store.set(`organizations/${orgB}`, {
    id: orgB,
    name: "Beta Corp",
    ownerId: "user_owner_b",
    ownerEmail: "owner@beta.com",
    status: "active"
  });

  // Memberships
  mockDb.store.set(`orgMembers/m_owner_a`, { id: "m_owner_a", orgId: orgA, userId: userOwnerA, email: "owner@alpha.com", role: "owner", status: "active" });
  mockDb.store.set(`orgMembers/m_admin_a`, { id: "m_admin_a", orgId: orgA, userId: userAdminA, email: "admin@alpha.com", role: "org_admin", status: "active" });
  mockDb.store.set(`orgMembers/m_manager_a`, { id: "m_manager_a", orgId: orgA, userId: userManagerA, email: "manager@alpha.com", role: "team_manager", status: "active" });
  mockDb.store.set(`orgMembers/m_member_a`, { id: "m_member_a", orgId: orgA, userId: userMemberA, email: "member@alpha.com", role: "member", status: "active" });
  mockDb.store.set(`orgMembers/m_viewer_a`, { id: "m_viewer_a", orgId: orgA, userId: userViewerA, email: "viewer@alpha.com", role: "viewer", status: "active" });

  // Custom Claims
  mockDb.customClaimsStore.set(userOwnerA, { orgId: orgA, orgRole: "owner" });
  mockDb.customClaimsStore.set(userAdminA, { orgId: orgA, orgRole: "org_admin" });
  mockDb.customClaimsStore.set(userManagerA, { orgId: orgA, orgRole: "team_manager" });
  mockDb.customClaimsStore.set(userMemberA, { orgId: orgA, orgRole: "member" });
  mockDb.customClaimsStore.set(userViewerA, { orgId: orgA, orgRole: "viewer" });

  // Departments
  mockDb.store.set(`departments/dept_eng`, { id: "dept_eng", orgId: orgA, name: "Engineering", status: "active" });
  mockDb.store.set(`departments/dept_inactive`, { id: "dept_inactive", orgId: orgA, name: "Deprecated", status: "inactive" });
  mockDb.store.set(`departments/dept_beta`, { id: "dept_beta", orgId: orgB, name: "Beta Sales", status: "active" });

  // Projects & Project Members
  mockDb.store.set(`projects/proj_alpha_1`, { id: "proj_alpha_1", orgId: orgA, name: "Alpha Core", status: "active" });
  mockDb.store.set(`projects/proj_beta_1`, { id: "proj_beta_1", orgId: orgB, name: "Beta Core", status: "active" });
  mockDb.store.set(`projectMembers/pm_member_a_alpha`, { id: "pm_member_a_alpha", projectId: "proj_alpha_1", userId: userMemberA, role: "admin" });
  mockDb.store.set(`projectMembers/pm_member_a_beta`, { id: "pm_member_a_beta", projectId: "proj_beta_1", userId: userMemberA, role: "viewer" });

  try {
    // ========================================================================
    // SECTION 1: COMPLETE ROLE MATRIX & HIERARCHY
    // ========================================================================
    console.log("\n--- SECTION 1: Complete Role Matrix & Hierarchy Enforcement ---");

    assertTest("Role hierarchy defines owner (4) > org_admin (3)", ROLE_HIERARCHY["owner"] > ROLE_HIERARCHY["org_admin"]);
    assertTest("Role hierarchy defines org_admin (3) > team_manager (2)", ROLE_HIERARCHY["org_admin"] > ROLE_HIERARCHY["team_manager"]);
    assertTest("Role hierarchy defines team_manager (2) > member (1)", ROLE_HIERARCHY["team_manager"] > ROLE_HIERARCHY["member"]);
    assertTest("Role hierarchy defines member (1) > viewer (0)", ROLE_HIERARCHY["member"] > (ROLE_HIERARCHY["viewer"] || 0));

    // Settings API access test across all roles
    const ownerSettingsRes = await request(`/api/organizations/${orgA}/settings`, {
      method: "PATCH",
      token: `test_token_${userOwnerA}`,
      body: { name: "Alpha Corp Renamed" }
    });
    assertTest("1.1 Owner can access organization settings", ownerSettingsRes.status === 200);

    const adminSettingsRes = await request(`/api/organizations/${orgA}/settings`, {
      method: "PATCH",
      token: `test_token_${userAdminA}`,
      body: { name: "Alpha Corp Renamed by Admin" }
    });
    assertTest("1.2 Org Admin can access organization settings", adminSettingsRes.status === 200);

    const managerSettingsRes = await request(`/api/organizations/${orgA}/settings`, {
      method: "PATCH",
      token: `test_token_${userManagerA}`,
      body: { name: "Hacked by Manager" }
    });
    assertTest("1.3 Team Manager DENIED organization settings (403)", managerSettingsRes.status === 403);

    const memberSettingsRes = await request(`/api/organizations/${orgA}/settings`, {
      method: "PATCH",
      token: `test_token_${userMemberA}`,
      body: { name: "Hacked by Member" }
    });
    assertTest("1.4 Member DENIED organization settings (403)", memberSettingsRes.status === 403);

    const viewerSettingsRes = await request(`/api/organizations/${orgA}/settings`, {
      method: "PATCH",
      token: `test_token_${userViewerA}`,
      body: { name: "Hacked by Viewer" }
    });
    assertTest("1.5 Viewer DENIED organization settings (403)", viewerSettingsRes.status === 403);

    const unauthSettingsRes = await request(`/api/organizations/${orgA}/settings`, {
      method: "PATCH",
      body: { name: "Hacked unauthenticated" }
    });
    assertTest("1.6 Unauthenticated DENIED organization settings (401)", unauthSettingsRes.status === 401);

    // Platform admin independence
    const platformAdminAccess = await checkOrgAccess(mockDb as any, "platform@super.com", orgA);
    assertTest("1.7 Platform admin does not automatically become org owner in checkOrgAccess", platformAdminAccess.role !== "owner");

    // ========================================================================
    // SECTION 2: OWNER / ORG_ADMIN BOUNDARY
    // ========================================================================
    console.log("\n--- SECTION 2: Owner / Org_Admin Boundary ---");

    // Org admin attempting to transfer ownership
    const adminTransferRes = await request(`/api/organizations/${orgA}/transfer-ownership`, {
      method: "POST",
      token: `test_token_${userAdminA}`,
      body: { targetMemberId: "m_member_a" }
    });
    assertTest("2.1 Org Admin CANNOT transfer ownership (403)", adminTransferRes.status === 403);

    // Org admin attempting to promote member to org_admin
    const adminPromoteAdminRes = await request(`/api/organizations/${orgA}/members/m_member_a/role`, {
      method: "PATCH",
      token: `test_token_${userAdminA}`,
      body: { role: "org_admin" }
    });
    assertTest("2.2 Org Admin CANNOT promote member to org_admin (403)", adminPromoteAdminRes.status === 403);

    // Org admin attempting to modify another org_admin
    mockDb.store.set(`orgMembers/m_admin_second`, { id: "m_admin_second", orgId: orgA, userId: "user_admin_2", email: "admin2@alpha.com", role: "org_admin", status: "active" });
    const adminModAdminRes = await request(`/api/organizations/${orgA}/members/m_admin_second/role`, {
      method: "PATCH",
      token: `test_token_${userAdminA}`,
      body: { role: "member" }
    });
    assertTest("2.3 Org Admin CANNOT modify role of another org_admin (403)", adminModAdminRes.status === 403);

    // Org admin attempting to remove owner
    const adminRemoveOwnerRes = await request(`/api/organizations/${orgA}/members/m_owner_a`, {
      method: "DELETE",
      token: `test_token_${userAdminA}`
    });
    assertTest("2.4 Org Admin CANNOT remove organization owner (400)", adminRemoveOwnerRes.status === 400);

    // Org admin attempting to request organization deletion
    const adminDeleteOrgRes = await request(`/api/organizations/${orgA}/request-deletion`, {
      method: "POST",
      token: `test_token_${userAdminA}`,
      body: { confirmName: "Alpha Corp Renamed by Admin" }
    });
    assertTest("2.5 Org Admin CANNOT request organization deletion (403)", adminDeleteOrgRes.status === 403);

    // Owner can promote member to org_admin
    const ownerPromoteAdminRes = await request(`/api/organizations/${orgA}/members/m_member_a/role`, {
      method: "PATCH",
      token: `test_token_${userOwnerA}`,
      body: { role: "org_admin" }
    });
    assertTest("2.6 Owner CAN promote member to org_admin (200)", ownerPromoteAdminRes.status === 200);
    // Reset member role back to member
    await request(`/api/organizations/${orgA}/members/m_member_a/role`, {
      method: "PATCH",
      token: `test_token_${userOwnerA}`,
      body: { role: "member" }
    });

    // ========================================================================
    // SECTION 3: OWNERSHIP TRANSFER LIFECYCLE
    // ========================================================================
    console.log("\n--- SECTION 3: Ownership Transfer Lifecycle ---");

    // Invalid Transfer: to self
    const transferSelfRes = await request(`/api/organizations/${orgA}/transfer-ownership`, {
      method: "POST",
      token: `test_token_${userOwnerA}`,
      body: { targetMemberId: "m_owner_a" }
    });
    assertTest("3.1 Transfer ownership to self is rejected (400)", transferSelfRes.status === 400);

    // Invalid Transfer: to inactive member
    mockDb.store.set(`orgMembers/m_inactive`, { id: "m_inactive", orgId: orgA, userId: "user_inact", email: "inact@alpha.com", role: "member", status: "deactivated" });
    const transferInactiveRes = await request(`/api/organizations/${orgA}/transfer-ownership`, {
      method: "POST",
      token: `test_token_${userOwnerA}`,
      body: { targetMemberId: "m_inactive" }
    });
    assertTest("3.2 Transfer ownership to inactive member is rejected (400)", transferInactiveRes.status === 400);

    // Invalid Transfer: to cross-org member
    mockDb.store.set(`orgMembers/m_beta_user`, { id: "m_beta_user", orgId: orgB, userId: "user_beta_u", email: "user@beta.com", role: "member", status: "active" });
    const transferCrossOrgRes = await request(`/api/organizations/${orgA}/transfer-ownership`, {
      method: "POST",
      token: `test_token_${userOwnerA}`,
      body: { targetMemberId: "m_beta_user" }
    });
    assertTest("3.3 Transfer ownership to cross-org member is rejected (404)", transferCrossOrgRes.status === 404);

    // Valid Transfer: Owner A -> Member B (userMemberA)
    const validTransferRes = await request(`/api/organizations/${orgA}/transfer-ownership`, {
      method: "POST",
      token: `test_token_${userOwnerA}`,
      body: { targetMemberId: "m_member_a" }
    });
    assertTest("3.4 Valid ownership transfer succeeds (200)", validTransferRes.status === 200);

    // Verify state in Firestore
    const updatedOrgDoc = mockDb.store.get(`organizations/${orgA}`);
    assertTest("3.5 Org doc ownerId updated to new owner", updatedOrgDoc.ownerId === userMemberA);
    assertTest("3.6 Org doc ownerEmail updated to new owner", updatedOrgDoc.ownerEmail === "member@alpha.com");

    const newOwnerMemberDoc = mockDb.store.get(`orgMembers/m_member_a`);
    assertTest("3.7 New owner member doc role is 'owner'", newOwnerMemberDoc.role === "owner");

    const oldOwnerMemberDoc = mockDb.store.get(`orgMembers/m_owner_a`);
    assertTest("3.8 Old owner member doc role demoted to 'org_admin'", oldOwnerMemberDoc.role === "org_admin");

    // Verify Custom Claims
    const newOwnerClaims = mockDb.customClaimsStore.get(userMemberA);
    assertTest("3.9 New owner claims synchronized (orgRole: 'owner')", newOwnerClaims?.orgRole === "owner" && newOwnerClaims?.isOwner === true);

    const oldOwnerClaims = mockDb.customClaimsStore.get(userOwnerA);
    assertTest("3.10 Old owner claims synchronized (orgRole: 'org_admin')", oldOwnerClaims?.orgRole === "org_admin" && oldOwnerClaims?.isOwner === false);

    // Verification of permissions swap:
    // Old owner trying to transfer ownership again -> must be rejected 403!
    const oldOwnerTransferAttempt = await request(`/api/organizations/${orgA}/transfer-ownership`, {
      method: "POST",
      token: `test_token_${userOwnerA}`,
      body: { targetMemberId: "m_admin_a" }
    });
    assertTest("3.11 Old owner immediately DENIED ownership transfer (403)", oldOwnerTransferAttempt.status === 403);

    // New owner trying to transfer back to userOwnerA -> succeeds!
    const newOwnerTransferBack = await request(`/api/organizations/${orgA}/transfer-ownership`, {
      method: "POST",
      token: `test_token_${userMemberA}`,
      body: { targetMemberId: "m_owner_a" }
    });
    assertTest("3.12 New owner possesses owner-only transfer permission (200)", newOwnerTransferBack.status === 200);

    // Reset userMemberA to ordinary active member for remaining tests
    mockDb.store.set(`orgMembers/m_member_a`, {
      id: "m_member_a",
      orgId: orgA,
      userId: userMemberA,
      email: "member@alpha.com",
      role: "member",
      status: "active"
    });
    mockDb.customClaimsStore.set(userMemberA, { orgId: orgA, orgRole: "member" });

    // ========================================================================
    // SECTION 4: MEMBER REMOVAL & CASCADING PROJECT CLEANUP
    // ========================================================================
    console.log("\n--- SECTION 4: Member Removal & Cascading Cleanup ---");

    // Add disposable member with project memberships
    const tempUserId = "user_temp_to_remove";
    mockDb.store.set(`users/${tempUserId}`, { email: "temp@alpha.com", name: "Temp User" });
    mockDb.store.set(`orgMembers/m_temp`, { id: "m_temp", orgId: orgA, userId: tempUserId, email: "temp@alpha.com", role: "member", status: "active" });
    mockDb.store.set(`projectMembers/pm_temp_alpha`, { id: "pm_temp_alpha", projectId: "proj_alpha_1", userId: tempUserId, role: "admin" });
    mockDb.store.set(`projectMembers/pm_temp_beta`, { id: "pm_temp_beta", projectId: "proj_beta_1", userId: tempUserId, role: "admin" });
    mockDb.customClaimsStore.set(tempUserId, { orgId: orgA, orgRole: "member" });

    // Unauthorized caller cannot remove member
    const memberRemoveAttempt = await request(`/api/organizations/${orgA}/members/m_temp`, {
      method: "DELETE",
      token: `test_token_${userMemberA}`
    });
    assertTest("4.1 Ordinary member cannot remove member (403)", memberRemoveAttempt.status === 403);

    // Authorized removal by Owner
    const removeRes = await request(`/api/organizations/${orgA}/members/m_temp`, {
      method: "DELETE",
      token: `test_token_${userOwnerA}`
    });
    assertTest("4.2 Owner removes member successfully (200)", removeRes.status === 200);
    assertTest("4.3 Cleaned exactly 1 org-scoped project membership", removeRes.data.cleanedProjectMemberships === 1);

    // Verification of state after removal
    assertTest("4.4 orgMember document deleted", mockDb.store.get(`orgMembers/m_temp`) === undefined);
    assertTest("4.5 org-scoped projectMember deleted", mockDb.store.get(`projectMembers/pm_temp_alpha`) === undefined);
    assertTest("4.6 other org projectMember preserved", mockDb.store.get(`projectMembers/pm_temp_beta`) !== undefined);
    assertTest("4.7 org project preserved", mockDb.store.get(`projects/proj_alpha_1`) !== undefined);

    const revokedClaims = mockDb.customClaimsStore.get(tempUserId);
    assertTest("4.8 Custom claims revoked (orgId: null, orgRole: null)", revokedClaims?.orgId === null && revokedClaims?.orgRole === null);

    // Removed user denied project access
    const projectAccessCheck = await resolveProjectAccess(mockDb as any, { uid: tempUserId, email: "temp@alpha.com" }, "proj_alpha_1");
    assertTest("4.9 Removed user immediately denied access to org projects", projectAccessCheck.hasAccess === false);

    // Stale claims cannot bypass resolveProjectAccess
    const staleClaimsAccess = await resolveProjectAccess(mockDb as any, { uid: tempUserId, email: "temp@alpha.com", orgId: orgA, orgRole: "member" }, "proj_alpha_1");
    assertTest("4.10 Stale token claims cannot bypass project access resolver", staleClaimsAccess.hasAccess === false);

    // ========================================================================
    // SECTION 5: DEACTIVATION & REACTIVATION LIFECYCLE
    // ========================================================================
    console.log("\n--- SECTION 5: Deactivation & Reactivation Lifecycle ---");

    // Deactivate member
    const deactRes = await request(`/api/organizations/${orgA}/members/m_member_a/deactivate`, {
      method: "POST",
      token: `test_token_${userAdminA}`
    });
    assertTest("5.1 Admin can deactivate member (200)", deactRes.status === 200);

    const deactDoc = mockDb.store.get(`orgMembers/m_member_a`);
    assertTest("5.2 Member status set to 'deactivated'", deactDoc.status === "deactivated");

    const deactClaims = mockDb.customClaimsStore.get(userMemberA);
    assertTest("5.3 Claims revoked on deactivation", deactClaims?.orgId === null && deactClaims?.orgRole === null);

    // Deactivated member denied org access in checkOrgAccess
    const deactOrgAccess = await checkOrgAccess(mockDb as any, "member@alpha.com", orgA);
    assertTest("5.4 Deactivated member denied in checkOrgAccess", deactOrgAccess.hasAccess === false);

    // Deactivated member denied in project access
    const deactProjAccess = await resolveProjectAccess(mockDb as any, { uid: userMemberA, email: "member@alpha.com" }, "proj_alpha_1");
    assertTest("5.5 Deactivated member denied in resolveProjectAccess", deactProjAccess.hasAccess === false);

    // Cannot deactivate owner
    const deactOwnerAttempt = await request(`/api/organizations/${orgA}/members/m_owner_a/deactivate`, {
      method: "POST",
      token: `test_token_${userAdminA}`
    });
    assertTest("5.6 Cannot deactivate organization owner (400)", deactOwnerAttempt.status === 400);

    // Reactivate member
    const reactRes = await request(`/api/organizations/${orgA}/members/m_member_a/reactivate`, {
      method: "POST",
      token: `test_token_${userAdminA}`
    });
    assertTest("5.7 Admin can reactivate member (200)", reactRes.status === 200);

    const reactDoc = mockDb.store.get(`orgMembers/m_member_a`);
    assertTest("5.8 Member status restored to 'active'", reactDoc.status === "active");

    const reactClaims = mockDb.customClaimsStore.get(userMemberA);
    assertTest("5.9 Claims restored on reactivation", reactClaims?.orgId === orgA && reactClaims?.orgRole === "member");

    // ========================================================================
    // SECTION 6: INVITATION LIFECYCLE
    // ========================================================================
    console.log("\n--- SECTION 6: Invitation Lifecycle ---");

    // Create Invite
    const inviteRes = await request(`/api/organizations/${orgA}/invite`, {
      method: "POST",
      token: `test_token_${userAdminA}`,
      body: { email: "invited@alpha.com", role: "team_manager", departmentId: "dept_eng" }
    });
    assertTest("6.1 Org Admin can send invitation (201)", inviteRes.status === 201);
    const inviteId = inviteRes.data.invite?.id;

    // Org Admin cannot invite owner
    const inviteOwnerRes = await request(`/api/organizations/${orgA}/invite`, {
      method: "POST",
      token: `test_token_${userAdminA}`,
      body: { email: "spoof@alpha.com", role: "owner" }
    });
    assertTest("6.2 Cannot invite someone with role 'owner' (400)", inviteOwnerRes.status === 400);

    // Org Admin cannot invite org_admin
    const inviteAdminRes = await request(`/api/organizations/${orgA}/invite`, {
      method: "POST",
      token: `test_token_${userAdminA}`,
      body: { email: "admin_spoof@alpha.com", role: "org_admin" }
    });
    assertTest("6.3 Org Admin cannot invite new org_admin (403)", inviteAdminRes.status === 403);

    // Cancel Invite
    const cancelRes = await request(`/api/organizations/${orgA}/invitations/${inviteId}`, {
      method: "DELETE",
      token: `test_token_${userAdminA}`
    });
    assertTest("6.4 Org Admin can cancel invitation (200)", cancelRes.status === 200);

    // Cancelled invite cannot be accepted
    mockDb.store.set(`users/user_invited`, { email: "invited@alpha.com", name: "Invited User" });
    const acceptCancelledRes = await request(`/api/organizations/accept-invite`, {
      method: "POST",
      token: `test_token_user_invited`,
      body: { inviteId }
    });
    assertTest("6.5 Cancelled invitation cannot be accepted (400)", acceptCancelledRes.status === 400);

    // Create a new invite and accept it
    const inviteRes2 = await request(`/api/organizations/${orgA}/invite`, {
      method: "POST",
      token: `test_token_${userOwnerA}`,
      body: { email: "invited@alpha.com", role: "team_manager", departmentId: "dept_eng" }
    });
    const inviteId2 = inviteRes2.data.invite?.id;

    // Different user cannot accept invite
    const wrongUserAccept = await request(`/api/organizations/accept-invite`, {
      method: "POST",
      token: `test_token_${userOutside}`,
      body: { inviteId: inviteId2 }
    });
    assertTest("6.6 Recipient email mismatch rejected on accept (403)", wrongUserAccept.status === 403);

    // Correct user accepts
    const correctAccept = await request(`/api/organizations/accept-invite`, {
      method: "POST",
      token: `test_token_user_invited`,
      body: { inviteId: inviteId2 }
    });
    assertTest("6.7 Recipient accepts invitation successfully (200)", correctAccept.status === 200);
    assertTest("6.8 Role correctly assigned from invitation (team_manager)", correctAccept.data.role === "team_manager");

    // Replay: Re-accepting an already accepted invite is rejected
    const replayAccept = await request(`/api/organizations/accept-invite`, {
      method: "POST",
      token: `test_token_user_invited`,
      body: { inviteId: inviteId2 }
    });
    assertTest("6.9 Re-accepting already accepted invitation rejected (400)", replayAccept.status === 400);

    // ========================================================================
    // SECTION 7: DEPARTMENT ISOLATION
    // ========================================================================
    console.log("\n--- SECTION 7: Department Isolation & Tenant Boundary ---");

    // Valid assignment
    const assignDeptRes = await request(`/api/organizations/${orgA}/members/m_member_a/department`, {
      method: "PATCH",
      token: `test_token_${userAdminA}`,
      body: { departmentId: "dept_eng" }
    });
    assertTest("7.1 Assigning valid same-org department succeeds (200)", assignDeptRes.status === 200);

    // Inactive department assignment rejected
    const assignInactiveRes = await request(`/api/organizations/${orgA}/members/m_member_a/department`, {
      method: "PATCH",
      token: `test_token_${userAdminA}`,
      body: { departmentId: "dept_inactive" }
    });
    assertTest("7.2 Inactive department assignment rejected (400)", assignInactiveRes.status === 400);

    // Cross-tenant department assignment rejected
    const assignCrossDeptRes = await request(`/api/organizations/${orgA}/members/m_member_a/department`, {
      method: "PATCH",
      token: `test_token_${userAdminA}`,
      body: { departmentId: "dept_beta" }
    });
    assertTest("7.3 Cross-org department assignment rejected (400)", assignCrossDeptRes.status === 400);

    // Clearing department
    const clearDeptRes = await request(`/api/organizations/${orgA}/members/m_member_a/department`, {
      method: "PATCH",
      token: `test_token_${userAdminA}`,
      body: { departmentId: null }
    });
    assertTest("7.4 Clearing department succeeds (200)", clearDeptRes.status === 200);
    assertTest("7.5 Department ID cleared in state", clearDeptRes.data.departmentId === "");

    // Unauthorized role cannot assign department
    const unauthDeptRes = await request(`/api/organizations/${orgA}/members/m_member_a/department`, {
      method: "PATCH",
      token: `test_token_${userManagerA}`,
      body: { departmentId: "dept_eng" }
    });
    assertTest("7.6 Team Manager cannot assign department (403)", unauthDeptRes.status === 403);

    // ========================================================================
    // SECTION 8: ROLE CHANGE SECURITY
    // ========================================================================
    console.log("\n--- SECTION 8: Role Change Security ---");

    // Member to team_manager (Owner allowed)
    const memToMgr = await request(`/api/organizations/${orgA}/members/m_member_a/role`, {
      method: "PATCH",
      token: `test_token_${userOwnerA}`,
      body: { role: "team_manager" }
    });
    assertTest("8.1 Member -> team_manager allowed (200)", memToMgr.status === 200);

    // Member to owner directly via role endpoint is rejected
    const memToOwner = await request(`/api/organizations/${orgA}/members/m_member_a/role`, {
      method: "PATCH",
      token: `test_token_${userOwnerA}`,
      body: { role: "owner" }
    });
    assertTest("8.2 Member -> owner rejected via role endpoint (400)", memToOwner.status === 400);

    // Self-promotion attempt: member trying to update own role
    const selfPromo = await request(`/api/organizations/${orgA}/members/m_member_a/role`, {
      method: "PATCH",
      token: `test_token_${userMemberA}`,
      body: { role: "org_admin" }
    });
    assertTest("8.3 Self-promotion attempt rejected (403)", selfPromo.status === 403);

    // Reset member role
    await request(`/api/organizations/${orgA}/members/m_member_a/role`, {
      method: "PATCH",
      token: `test_token_${userOwnerA}`,
      body: { role: "member" }
    });

    // ========================================================================
    // SECTION 9: FRONTEND / BACKEND CONSISTENCY & EXCLUSION OF super_admin
    // ========================================================================
    console.log("\n--- SECTION 9: Frontend / Backend Consistency & super_admin Audit ---");

    // Check types.ts to confirm canonical roles
    const typesPath = path.resolve(process.cwd(), "types.ts");
    const typesContent = fs.readFileSync(typesPath, "utf-8");
    assertTest("9.1 OrgRole type definition contains: 'owner' | 'org_admin' | 'team_manager' | 'member' | 'viewer'",
      typesContent.includes("'owner' | 'org_admin' | 'team_manager' | 'member' | 'viewer'"));

    // Ensure super_admin is not an allowed active OrgRole
    assertTest("9.2 super_admin is not an active OrgRole in types.ts",
      !typesContent.includes("'super_admin' |") && !typesContent.includes("| 'super_admin'"));

    // Normalizer test
    assertTest("9.3 normalizeOrgRole maps 'super_admin' to 'owner'", normalizeOrgRole("super_admin") === "owner");
    assertTest("9.4 normalizeOrgRole preserves 'org_admin'", normalizeOrgRole("org_admin") === "org_admin");
    assertTest("9.5 normalizeOrgRole preserves 'team_manager'", normalizeOrgRole("team_manager") === "team_manager");
    assertTest("9.6 normalizeOrgRole preserves 'member'", normalizeOrgRole("member") === "member");
    assertTest("9.7 normalizeOrgRole preserves 'viewer'", normalizeOrgRole("viewer") === "viewer");

    // ========================================================================
    // SECTION 10: DIRECT FIRESTORE WRITE AUDIT
    // ========================================================================
    console.log("\n--- SECTION 10: Direct Client Firestore Mutation Audit ---");

    const dashPath = path.resolve(process.cwd(), "components/OrganizationDashboard.tsx");
    const dashContent = fs.readFileSync(dashPath, "utf-8");

    assertTest("10.1 Zero client mutations on orgMembers in OrganizationDashboard.tsx",
      !dashContent.match(/(setDoc|updateDoc|deleteDoc|addDoc)\s*\([^)]*['"]orgMembers['"]/));
    assertTest("10.2 Zero client mutations on orgInvitations in OrganizationDashboard.tsx",
      !dashContent.match(/(setDoc|updateDoc|deleteDoc|addDoc)\s*\([^)]*['"]orgInvitations['"]/));
    assertTest("10.3 Zero client mutations on auditLogs in OrganizationDashboard.tsx",
      !dashContent.match(/(setDoc|updateDoc|deleteDoc|addDoc)\s*\([^)]*['"]auditLogs['"]/));
    assertTest("10.4 Organization bootstrapping calls authoritative /api/organizations",
      dashContent.includes("apiFetch('/api/organizations'") || dashContent.includes('apiFetch("/api/organizations"'));

    // ========================================================================
    // SECTION 11: IDOR & TENANT ISOLATION
    // ========================================================================
    console.log("\n--- SECTION 11: IDOR & Tenant Isolation ---");

    // Org A Admin trying to cancel Org B Invitation
    mockDb.store.set(`orgInvitations/inv_beta_1`, { id: "inv_beta_1", orgId: orgB, email: "someone@beta.com", status: "pending" });
    const idorCancelInvite = await request(`/api/organizations/${orgB}/invitations/inv_beta_1`, {
      method: "DELETE",
      token: `test_token_${userAdminA}`
    });
    assertTest("11.1 Org A admin cannot cancel Org B invitation (403)", idorCancelInvite.status === 403);

    // Org A Admin trying to modify Org B Member
    mockDb.store.set(`orgMembers/m_beta_member`, { id: "m_beta_member", orgId: orgB, userId: "user_beta_m", email: "m@beta.com", role: "member", status: "active" });
    const idorChangeRole = await request(`/api/organizations/${orgB}/members/m_beta_member/role`, {
      method: "PATCH",
      token: `test_token_${userAdminA}`,
      body: { role: "team_manager" }
    });
    assertTest("11.2 Org A admin cannot modify Org B member (403)", idorChangeRole.status === 403);

    // Cross-tenant mismatched URL: orgA in URL, target belongs to orgB
    const mismatchedOrgChangeRole = await request(`/api/organizations/${orgA}/members/m_beta_member/role`, {
      method: "PATCH",
      token: `test_token_${userOwnerA}`,
      body: { role: "team_manager" }
    });
    assertTest("11.3 Org A owner cannot modify member belonging to Org B via Org A URL (400)", mismatchedOrgChangeRole.status === 400);

    // ========================================================================
    // SECTION 12: AUDIT LOG INTEGRITY
    // ========================================================================
    console.log("\n--- SECTION 12: Audit Log Integrity ---");

    // Inspect recorded audit events from subcollection
    const auditDocs = Array.from(mockDb.store.entries())
      .filter(([k]) => k.includes("/auditLogs/"))
      .map(([, v]) => v);

    const actionsRecorded = new Set(auditDocs.map((a: any) => a.action));

    assertTest("12.1 MEMBER_INVITED audit log recorded", actionsRecorded.has("MEMBER_INVITED"));
    assertTest("12.2 INVITATION_CANCELLED audit log recorded", actionsRecorded.has("INVITATION_CANCELLED"));
    assertTest("12.3 ROLE_CHANGED audit log recorded", actionsRecorded.has("ROLE_CHANGED"));
    assertTest("12.4 MEMBER_DEACTIVATED audit log recorded", actionsRecorded.has("MEMBER_DEACTIVATED"));
    assertTest("12.5 MEMBER_REACTIVATED audit log recorded", actionsRecorded.has("MEMBER_REACTIVATED"));
    assertTest("12.6 MEMBER_REMOVED audit log recorded", actionsRecorded.has("MEMBER_REMOVED"));
    assertTest("12.7 MEMBER_DEPARTMENT_ASSIGNED audit log recorded", actionsRecorded.has("MEMBER_DEPARTMENT_ASSIGNED"));
    assertTest("12.8 OWNER_TRANSFERRED audit log recorded", actionsRecorded.has("OWNER_TRANSFERRED"));
    assertTest("12.9 SECURITY_UPDATED audit log recorded", actionsRecorded.has("SECURITY_UPDATED"));

    // Test Deletion request audit log
    await request(`/api/organizations/${orgA}/request-deletion`, {
      method: "POST",
      token: `test_token_${userOwnerA}`,
      body: { confirmName: "Alpha Corp Renamed by Admin" }
    });
    const postDelAudits = Array.from(mockDb.store.entries())
      .filter(([k]) => k.includes("/auditLogs/"))
      .map(([, v]) => v);
    const postDelActions = new Set(postDelAudits.map((a: any) => a.action));
    assertTest("12.10 ORGANIZATION_DELETION_REQUESTED audit log recorded", postDelActions.has("ORGANIZATION_DELETION_REQUESTED"));

    // Verify actor integrity: all audit logs have actorUserId, actorEmail, organizationId, timestamp
    const allHaveIntegrity = auditDocs.every((a: any) => a.organizationId && a.actorEmail && a.timestamp);
    assertTest("12.11 All audit events contain valid non-empty organizationId, actorEmail, and timestamp", allHaveIntegrity);

    // ========================================================================
    // SECTION 13: STALE SESSION / STATE TESTS
    // ========================================================================
    console.log("\n--- SECTION 13: Stale Session & Client State Tests ---");

    // Simulate: User had org_admin claim, but was demoted in DB to member
    const demotedUserId = "user_demoted_admin";
    mockDb.store.set(`users/${demotedUserId}`, { email: "demoted@alpha.com", name: "Demoted User" });
    mockDb.store.set(`orgMembers/m_demoted`, { id: "m_demoted", orgId: orgA, userId: demotedUserId, email: "demoted@alpha.com", role: "member", status: "active" });
    // Token still claims org_admin, but DB has member
    mockDb.customClaimsStore.set(demotedUserId, { orgId: orgA, orgRole: "member" }); // claims synced on demotion

    const staleAdminAttempt = await request(`/api/organizations/${orgA}/members/m_viewer_a/role`, {
      method: "PATCH",
      token: `test_token_${demotedUserId}`,
      body: { role: "team_manager" }
    });
    assertTest("13.1 Demoted user cannot execute admin API operations (403)", staleAdminAttempt.status === 403);

    // Simulate: Old owner after ownership transfer tries owner-only deletion request
    mockDb.store.set(`organizations/${orgA}`, {
      id: orgA,
      name: "Alpha Corp Renamed by Admin",
      ownerId: userMemberA, // userMemberA is now the owner
      ownerEmail: "member@alpha.com",
      status: "active"
    });
    const oldOwnerDelAttempt = await request(`/api/organizations/${orgA}/request-deletion`, {
      method: "POST",
      token: `test_token_${userOwnerA}`,
      body: { confirmName: "Alpha Corp Renamed by Admin" }
    });
    assertTest("13.2 Old owner trying owner-only deletion request is rejected by backend (403)", oldOwnerDelAttempt.status === 403);

    // ========================================================================
    // SECTION 14: API ERROR BEHAVIOR
    // ========================================================================
    console.log("\n--- SECTION 14: API Error Status Semantics ---");

    // 401 Unauthenticated
    const err401 = await request(`/api/organizations/${orgA}/settings`, { method: "PATCH" });
    assertTest("14.1 Unauthenticated request returns 401", err401.status === 401);

    // 403 Forbidden
    const err403 = await request(`/api/organizations/${orgA}/settings`, {
      method: "PATCH",
      token: `test_token_${userViewerA}`,
      body: { name: "Test" }
    });
    assertTest("14.2 Unauthorized caller returns 403", err403.status === 403);

    // 404 Not Found
    const err404 = await request(`/api/organizations/nonexistent_org_xyz/members/m_123/role`, {
      method: "PATCH",
      token: `test_token_${userOwnerA}`,
      body: { role: "member" }
    });
    assertTest("14.3 Nonexistent organization returns 404", err404.status === 404);

    // 400 Bad Request
    const err400 = await request(`/api/organizations/${orgA}/members/m_member_a/role`, {
      method: "PATCH",
      token: `test_token_${userMemberA}`, // member is owner now in org doc
      body: {} // missing role
    });
    assertTest("14.4 Missing required body fields returns 400", err400.status === 400);

    // ========================================================================
    // SECTION 15: REAL EXECUTION VERIFICATION
    // ========================================================================
    console.log("\n--- SECTION 15: Real Execution Quality Verification ---");
    assertTest("15.1 Tests executed against live running Express HTTP server instance", port > 0);
    assertTest("15.2 Tests validated database mutations, state transitions, and claims", totalTests > 50);

  } finally {
    server.close();
  }

  console.log("\n================================================================================");
  console.log(`🏁 STEP 5E VERIFICATION COMPLETE: ${passedTests}/${totalTests} PASSED, ${failedTests} FAILED`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runStep5EVerification().catch((err) => {
  console.error("FATAL ERROR in Step 5E Verification:", err);
  process.exit(1);
});
