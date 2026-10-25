/**
 * EchoNote Phase 1A Step 5.2: Session Freshness & Member Deactivation Hardening (SEC-01)
 *
 * Deterministic test suite verifying:
 * 1. Active member can perform protected organization and project actions.
 * 2. Deactivation flow successfully updates Firestore membership status to 'deactivated'.
 * 3. Deactivated member is immediately rejected from protected actions (HTTP 403),
 *    even when presenting an unexpired Firebase ID token with stale cached claims.
 * 4. Token revocation: refresh tokens revoked via Firebase Admin SDK when member has no other orgs.
 * 5. Claim safety: orgId/orgRole cleared without wiping unrelated or platform-level claims.
 * 6. Multi-organization preservation: if user belongs to multiple organizations, deactivation
 *    in one org preserves valid session and claims in the other org.
 * 7. Transactional safety & rollback: auth failure rolls back membership state to prevent split-brain.
 * 8. Reactivation restores active status and permissions.
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import {
  checkOrgAccess,
  handleMemberDeactivationAuth,
  normalizeOrgRole,
  recordOrgAuditEvent,
  resolveProjectAccess,
  requireOrgRole,
  syncUserCustomClaims,
  ROLE_HIERARCHY,
  AuthenticatedRequest
} from "../middleware/auth.js";
import { AuthoritativeOrgRole } from "../types.js";

// ============================================================================
// TEST HARNESS & IN-MEMORY FIRESTORE + MOCK FIREBASE ADMIN
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

  async set(data: any): Promise<void> {
    this.db.store.set(this.path, JSON.parse(JSON.stringify(data)));
  }

  async update(patch: any): Promise<void> {
    const existing = this.db.store.get(this.path);
    if (!existing) {
      throw new Error(`Document ${this.path} not found for update`);
    }
    const updated = { ...existing, ...JSON.parse(JSON.stringify(patch)) };
    this.db.store.set(this.path, updated);
  }

  async delete(): Promise<void> {
    this.db.store.delete(this.path);
  }
}

class MockCollectionReference {
  constructor(private db: MockFirestore, public path: string) {}

  doc(id?: string): MockDocReference {
    const docId = id || "doc_" + Math.random().toString(36).substring(2, 9);
    return new MockDocReference(this.db, `${this.path}/${docId}`, docId);
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.path, [{ field, op, val }]);
  }

  async add(data: any): Promise<MockDocReference> {
    const docRef = this.doc();
    await docRef.set(data);
    return docRef;
  }

  async get(): Promise<MockQuerySnapshot> {
    return new MockQuery(this.db, this.path, []).get();
  }
}

class MockFirestore {
  public store = new Map<string, any>();
  public customClaimsStore = new Map<string, any>();
  public revokedTokensStore = new Set<string>();

  collection(path: string): MockCollectionReference {
    return new MockCollectionReference(this, path);
  }

  doc(fullPath: string): MockDocReference {
    const parts = fullPath.split("/");
    const id = parts[parts.length - 1];
    return new MockDocReference(this, fullPath, id);
  }

  batch() {
    const operations: Array<() => Promise<void>> = [];
    return {
      set: (ref: MockDocReference, data: any) => {
        operations.push(() => ref.set(data));
      },
      update: (ref: MockDocReference, patch: any) => {
        operations.push(() => ref.update(patch));
      },
      delete: (ref: MockDocReference) => {
        operations.push(() => ref.delete());
      },
      commit: async () => {
        for (const op of operations) await op();
      }
    };
  }

  clear() {
    this.store.clear();
    this.customClaimsStore.clear();
    this.revokedTokensStore.clear();
  }
}

// Mock Firebase Admin Auth
function createMockAdminAuth(db: MockFirestore) {
  return {
    getUser: async (uid: string) => {
      const claims = db.customClaimsStore.get(uid) || {};
      return { uid, customClaims: claims };
    },
    setCustomUserClaims: async (uid: string, claims: any) => {
      db.customClaimsStore.set(uid, claims);
    },
    revokeRefreshTokens: async (uid: string) => {
      db.revokedTokensStore.add(uid);
    }
  };
}

// ============================================================================
// EXPRESS SERVER HARNESS (Testing Real HTTP Rejection Behavior)
// ============================================================================

function createTestServer(db: MockFirestore, adminAuth: any) {
  const app = express();
  app.use(express.json());

  // Simulates requireAuth token decoding
  app.use((req: any, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer test_token_")) {
      const tokenPayloadStr = authHeader.replace("Bearer test_token_", "");
      try {
        const payload = JSON.parse(Buffer.from(tokenPayloadStr, "base64").toString("utf-8"));
        req.user = payload;
      } catch {
        const uid = tokenPayloadStr;
        const claims = db.customClaimsStore.get(uid) || {};
        req.user = {
          uid,
          email: `${uid}@test.com`,
          ...claims
        };
      }
    }
    next();
  });

  const requireAuthMiddleware = (req: any, res: any, next: any) => {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
    }
    next();
  };

  // Protected organization endpoint using requireOrgRole
  app.get(
    "/api/organizations/:organizationId/settings",
    requireAuthMiddleware,
    requireOrgRole(db as any, "member"),
    async (_req: any, res: any) => {
      res.json({ success: true, settings: { name: "Protected Org Settings" } });
    }
  );

  // Protected org admin endpoint
  app.get(
    "/api/organizations/:organizationId/admin-action",
    requireAuthMiddleware,
    requireOrgRole(db as any, "org_admin"),
    async (_req: any, res: any) => {
      res.json({ success: true, message: "Admin action executed" });
    }
  );

  // Member Deactivation Endpoint (mirrors server.ts)
  app.post(
    "/api/organizations/:organizationId/members/:memberId/deactivate",
    requireAuthMiddleware,
    async (req: any, res: any) => {
      const { organizationId, memberId } = req.params;
      const callerUid = req.user.uid;
      const callerEmail = (req.user.email || "").toLowerCase();

      try {
        const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
        const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"], req.user);
        if (!orgAccess.hasAccess && !isPlatformAdmin) {
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

        if (!orgAccess.isOwner && !isPlatformAdmin && normalizeOrgRole(memberData.role) === "org_admin") {
          return res.status(403).json({
            error: "Forbidden",
            message: "Organization admins cannot deactivate fellow organization admins. Only the organization owner can perform this action."
          });
        }

        await memberRef.update({
          status: "deactivated",
          updatedAt: new Date().toISOString()
        });

        // SEC-01 Hardening: credentials revocation & claim sync
        try {
          if (req.query.simulateAuthFailure === "true") {
            throw new Error("Simulated Firebase Auth network failure");
          }

          if (memberData.userId) {
            // Check other active memberships
            let otherActiveOrg: { orgId: string; role: AuthoritativeOrgRole } | null = null;
            const allMembers = await db.collection("orgMembers").where("userId", "==", memberData.userId).where("status", "==", "active").get();
            for (const d of allMembers.docs) {
              if (d.data().orgId !== organizationId) {
                otherActiveOrg = { orgId: d.data().orgId, role: normalizeOrgRole(d.data().role) };
                break;
              }
            }

            const existingClaims = (await adminAuth.getUser(memberData.userId)).customClaims || {};
            const updatedClaims = { ...existingClaims };

            if (otherActiveOrg) {
              if (updatedClaims.orgId === organizationId || !updatedClaims.orgId) {
                updatedClaims.orgId = otherActiveOrg.orgId;
                updatedClaims.orgRole = otherActiveOrg.role;
                updatedClaims.isOwner = otherActiveOrg.role === "owner";
              }
            } else {
              updatedClaims.orgId = null;
              updatedClaims.orgRole = null;
              updatedClaims.isOwner = false;
              await adminAuth.revokeRefreshTokens(memberData.userId);
            }

            await adminAuth.setCustomUserClaims(memberData.userId, updatedClaims);
          }
        } catch (authErr: any) {
          // Rollback on auth failure
          try {
            await memberRef.update({ status: "active", updatedAt: new Date().toISOString() });
          } catch {}
          return res.status(500).json({
            error: "Internal Server Error",
            message: `Failed to revoke credentials: ${authErr?.message}`
          });
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
      } catch (err: any) {
        res.status(500).json({ error: "Failed to deactivate member", message: err.message });
      }
    }
  );

  // Member Reactivation Endpoint (mirrors server.ts)
  app.post(
    "/api/organizations/:organizationId/members/:memberId/reactivate",
    requireAuthMiddleware,
    async (req: any, res: any) => {
      const { organizationId, memberId } = req.params;
      const callerUid = req.user.uid;
      const callerEmail = (req.user.email || "").toLowerCase();

      try {
        const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
        const orgAccess = await checkOrgAccess(db as any, callerEmail, organizationId, ["owner", "org_admin"], req.user);
        if (!orgAccess.hasAccess && !isPlatformAdmin) {
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
          const currentClaims = (await adminAuth.getUser(memberData.userId)).customClaims || {};
          await adminAuth.setCustomUserClaims(memberData.userId, {
            ...currentClaims,
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
      } catch (err: any) {
        res.status(500).json({ error: "Failed to reactivate member", message: err.message });
      }
    }
  );

  return app;
}

// Helper to make test HTTP calls
function makeRequest(
  port: number,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = { ...headers };
    if (postData) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: reqHeaders
      },
      res => {
        let rawData = "";
        res.on("data", chunk => (rawData += chunk));
        res.on("end", () => {
          try {
            const parsed = rawData ? JSON.parse(rawData) : {};
            resolve({ status: res.statusCode || 500, body: parsed });
          } catch {
            resolve({ status: res.statusCode || 500, body: rawData });
          }
        });
      }
    );

    req.on("error", reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function makeToken(payload: any): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// ============================================================================
// MAIN TEST BATTERY
// ============================================================================

async function runSessionFreshnessTestSuite() {
  console.log("\n================================================================================");
  console.log("🛡️  ECHONOTE STEP 5.2: SESSION FRESHNESS & MEMBER DEACTIVATION HARENING (SEC-01)");
  console.log("================================================================================\n");

  const db = new MockFirestore();
  const adminAuth = createMockAdminAuth(db);
  const app = createTestServer(db, adminAuth);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  try {
    // --------------------------------------------------------------------------
    // Test Setup: Seed Organization, Projects, and Members
    // --------------------------------------------------------------------------
    const orgAlphaId = "org_alpha";
    const orgBetaId = "org_beta";
    const ownerUid = "usr_owner_alpha";
    const adminUid = "usr_admin_alpha";
    const targetMemberUid = "usr_target_member";
    const multiMemberUid = "usr_multi_member";

    await db.collection("organizations").doc(orgAlphaId).set({
      id: orgAlphaId,
      name: "Alpha Corp",
      ownerId: ownerUid,
      ownerEmail: "owner@alpha.com",
      status: "active"
    });

    await db.collection("organizations").doc(orgBetaId).set({
      id: orgBetaId,
      name: "Beta Industries",
      ownerId: "usr_owner_beta",
      ownerEmail: "owner@beta.com",
      status: "active"
    });

    // Owner member doc
    await db.collection("orgMembers").doc("mem_owner_alpha").set({
      id: "mem_owner_alpha",
      orgId: orgAlphaId,
      userId: ownerUid,
      email: "owner@alpha.com",
      role: "owner",
      status: "active"
    });

    // Admin member doc
    await db.collection("orgMembers").doc("mem_admin_alpha").set({
      id: "mem_admin_alpha",
      orgId: orgAlphaId,
      userId: adminUid,
      email: "admin@alpha.com",
      role: "org_admin",
      status: "active"
    });

    // Target member doc in Org Alpha
    await db.collection("orgMembers").doc("mem_target_alpha").set({
      id: "mem_target_alpha",
      orgId: orgAlphaId,
      userId: targetMemberUid,
      email: "target@alpha.com",
      role: "member",
      status: "active"
    });

    // Seed target member custom claims (bound to Org Alpha)
    db.customClaimsStore.set(targetMemberUid, {
      orgId: orgAlphaId,
      orgRole: "member",
      isOwner: false,
      role: "user"
    });

    // Multi-org member in both Org Alpha and Org Beta
    await db.collection("orgMembers").doc("mem_multi_alpha").set({
      id: "mem_multi_alpha",
      orgId: orgAlphaId,
      userId: multiMemberUid,
      email: "multi@user.com",
      role: "member",
      status: "active"
    });

    await db.collection("orgMembers").doc("mem_multi_beta").set({
      id: "mem_multi_beta",
      orgId: orgBetaId,
      userId: multiMemberUid,
      email: "multi@user.com",
      role: "team_manager",
      status: "active"
    });

    db.customClaimsStore.set(multiMemberUid, {
      orgId: orgAlphaId,
      orgRole: "member",
      isOwner: false,
      role: "user"
    });

    // Seed Project belonging to Org Alpha
    const projectAlphaId = "proj_alpha_docs";
    await db.collection("projects").doc(projectAlphaId).set({
      id: projectAlphaId,
      name: "Alpha Internal Project",
      organizationId: orgAlphaId,
      ownerId: ownerUid,
      members: { [targetMemberUid]: "member" }
    });

    await db.collection("projectMembers").doc(`${targetMemberUid}_${projectAlphaId}`).set({
      id: `${targetMemberUid}_${projectAlphaId}`,
      projectId: projectAlphaId,
      userId: targetMemberUid,
      organizationId: orgAlphaId,
      role: "member"
    });

    // ==========================================================================
    // 1. ACTIVE MEMBER ACCESS BASELINE
    // ==========================================================================
    console.log("--- 1. Baseline Access Verification (Active Member) ---");

    const activeMemberToken = makeToken({
      uid: targetMemberUid,
      email: "target@alpha.com",
      orgId: orgAlphaId,
      orgRole: "member"
    });

    const activeSettingsRes = await makeRequest(port, `/api/organizations/${orgAlphaId}/settings`, "GET", {
      Authorization: `Bearer test_token_${activeMemberToken}`
    });
    assertTest("1.1 Active member can access protected organization settings (200 OK)", activeSettingsRes.status === 200);

    const activeAccessCheck = await checkOrgAccess(
      db as any,
      "target@alpha.com",
      orgAlphaId,
      ["member"],
      { uid: targetMemberUid, email: "target@alpha.com" }
    );
    assertTest("1.2 checkOrgAccess confirms active access for active member", activeAccessCheck.hasAccess === true && activeAccessCheck.role === "member");

    const activeProjAccess = await resolveProjectAccess(
      db as any,
      { uid: targetMemberUid, email: "target@alpha.com" },
      projectAlphaId,
      { requiredPermission: "VIEW" }
    );
    assertTest("1.3 resolveProjectAccess permits active member to view org project", activeProjAccess.hasAccess === true);

    // ==========================================================================
    // 2. MEMBER DEACTIVATION EXECUTION & RESTRICTIONS
    // ==========================================================================
    console.log("\n--- 2. Deactivation Flow Execution & Invariants ---");

    const adminToken = makeToken({
      uid: adminUid,
      email: "admin@alpha.com",
      orgId: orgAlphaId,
      orgRole: "org_admin"
    });

    // 2.1 Owner cannot be deactivated
    const deactOwnerRes = await makeRequest(
      port,
      `/api/organizations/${orgAlphaId}/members/mem_owner_alpha/deactivate`,
      "POST",
      { Authorization: `Bearer test_token_${adminToken}` }
    );
    assertTest("2.1 Deactivating organization owner is rejected (400 Bad Request)", deactOwnerRes.status === 400);

    // 2.2 Unprivileged caller cannot deactivate
    const unprivRes = await makeRequest(
      port,
      `/api/organizations/${orgAlphaId}/members/mem_target_alpha/deactivate`,
      "POST",
      { Authorization: `Bearer test_token_${activeMemberToken}` }
    );
    assertTest("2.2 Regular member cannot deactivate another member (403 Forbidden)", unprivRes.status === 403);

    // 2.3 Successful deactivation by Admin
    const deactRes = await makeRequest(
      port,
      `/api/organizations/${orgAlphaId}/members/mem_target_alpha/deactivate`,
      "POST",
      { Authorization: `Bearer test_token_${adminToken}` }
    );
    assertTest("2.3 Org Admin successfully deactivates member (200 OK)", deactRes.status === 200 && deactRes.body.status === "deactivated");

    // 2.4 Verify Firestore membership state persisted as 'deactivated'
    const memberDocAfter = await db.collection("orgMembers").doc("mem_target_alpha").get();
    assertTest(
      "2.4 Firestore orgMembers document status updated to 'deactivated'",
      memberDocAfter.data()?.status === "deactivated"
    );

    // ==========================================================================
    // 3. IMMEDIATE REJECTION OF STALE TOKENS & CLAIMS (ZERO-LATENCY DEFENSE)
    // ==========================================================================
    console.log("\n--- 3. Stale Token Defense & Zero-Latency Rejection ---");

    // The deactivated user still holds their old, unexpired token carrying orgId: org_alpha and orgRole: member
    const staleMemberToken = activeMemberToken; // Contains claims orgId: org_alpha, orgRole: member

    const staleSettingsRes = await makeRequest(port, `/api/organizations/${orgAlphaId}/settings`, "GET", {
      Authorization: `Bearer test_token_${staleMemberToken}`
    });
    assertTest(
      "3.1 Deactivated member with unexpired token immediately denied from protected route (403 Forbidden)",
      staleSettingsRes.status === 403
    );

    const staleAccessCheck = await checkOrgAccess(
      db as any,
      "target@alpha.com",
      orgAlphaId,
      ["member"],
      { uid: targetMemberUid, email: "target@alpha.com", orgId: orgAlphaId, orgRole: "member" }
    );
    assertTest(
      "3.2 checkOrgAccess immediately rejects deactivated member despite caller passing valid email & UID",
      staleAccessCheck.hasAccess === false
    );

    const staleProjAccess = await resolveProjectAccess(
      db as any,
      { uid: targetMemberUid, email: "target@alpha.com", orgId: orgAlphaId, orgRole: "member" },
      projectAlphaId,
      { requiredPermission: "VIEW" }
    );
    assertTest(
      "3.3 resolveProjectAccess rejects deactivated member due to tenant boundary enforcement",
      staleProjAccess.hasAccess === false &&
        (staleProjAccess.reason?.includes("Tenant isolation") || staleProjAccess.reason?.includes("does not belong"))
    );

    // ==========================================================================
    // 4. REFRESH TOKEN REVOCATION & CUSTOM CLAIM LIFECYCLE
    // ==========================================================================
    console.log("\n--- 4. Refresh Token Revocation & Claim Clearing (Single-Org User) ---");

    assertTest(
      "4.1 Firebase Admin revokeRefreshTokens called for single-org deactivated member",
      db.revokedTokensStore.has(targetMemberUid)
    );

    const updatedClaims = db.customClaimsStore.get(targetMemberUid);
    assertTest("4.2 Organization custom claims cleared (orgId: null)", updatedClaims?.orgId === null);
    assertTest("4.3 Organization custom claims cleared (orgRole: null)", updatedClaims?.orgRole === null);
    assertTest("4.4 isOwner claim cleared (isOwner: false)", updatedClaims?.isOwner === false);
    assertTest("4.5 User base role preserved (role: 'user')", updatedClaims?.role === "user");

    // ==========================================================================
    // 5. MULTI-ORGANIZATION PRESERVATION & PLATFORM ROLE RETENTION
    // ==========================================================================
    console.log("\n--- 5. Multi-Organization Access Preservation ---");

    // Deactivate multi-member in Org Alpha
    const deactMultiRes = await makeRequest(
      port,
      `/api/organizations/${orgAlphaId}/members/mem_multi_alpha/deactivate`,
      "POST",
      { Authorization: `Bearer test_token_${adminToken}` }
    );
    assertTest("5.1 Multi-org member deactivated in Org Alpha (200 OK)", deactMultiRes.status === 200);

    const multiAlphaDoc = await db.collection("orgMembers").doc("mem_multi_alpha").get();
    const multiBetaDoc = await db.collection("orgMembers").doc("mem_multi_beta").get();

    assertTest("5.2 Org Alpha membership status is 'deactivated'", multiAlphaDoc.data()?.status === "deactivated");
    assertTest("5.3 Org Beta membership status remains 'active'", multiBetaDoc.data()?.status === "active");

    // Because user is active in Org Beta, refresh tokens must NOT be revoked
    assertTest(
      "5.4 Refresh tokens NOT revoked because user has another active organization (Org Beta)",
      !db.revokedTokensStore.has(multiMemberUid)
    );

    const multiClaims = db.customClaimsStore.get(multiMemberUid);
    assertTest("5.5 Custom claims automatically switched to Org Beta", multiClaims?.orgId === orgBetaId);
    assertTest("5.6 Custom claims role switched to Org Beta role ('team_manager')", multiClaims?.orgRole === "team_manager");

    // Verify access isolation: denied in Org Alpha, permitted in Org Beta
    const multiAlphaAccess = await checkOrgAccess(
      db as any,
      "multi@user.com",
      orgAlphaId,
      ["member"],
      { uid: multiMemberUid, email: "multi@user.com" }
    );
    assertTest("5.7 Multi-member denied in Org Alpha (hasAccess: false)", multiAlphaAccess.hasAccess === false);

    const multiBetaAccess = await checkOrgAccess(
      db as any,
      "multi@user.com",
      orgBetaId,
      ["team_manager", "member"],
      { uid: multiMemberUid, email: "multi@user.com" }
    );
    assertTest("5.8 Multi-member permitted in Org Beta (hasAccess: true)", multiBetaAccess.hasAccess === true);

    // ==========================================================================
    // 6. ATOMICITY & ROLLBACK ON AUTH CREDENTIALS FAILURE
    // ==========================================================================
    console.log("\n--- 6. Atomicity & Rollback on Credentials Error ---");

    // Re-seed a temporary active member
    const tempMemberUid = "usr_temp_member";
    await db.collection("orgMembers").doc("mem_temp_alpha").set({
      id: "mem_temp_alpha",
      orgId: orgAlphaId,
      userId: tempMemberUid,
      email: "temp@alpha.com",
      role: "member",
      status: "active"
    });

    // Attempt deactivation with simulated auth failure
    const failedDeactRes = await makeRequest(
      port,
      `/api/organizations/${orgAlphaId}/members/mem_temp_alpha/deactivate?simulateAuthFailure=true`,
      "POST",
      { Authorization: `Bearer test_token_${adminToken}` }
    );
    assertTest("6.1 Auth failure returns HTTP 500 error", failedDeactRes.status === 500);

    const tempDocAfterFail = await db.collection("orgMembers").doc("mem_temp_alpha").get();
    assertTest(
      "6.2 Membership status rolled back to 'active' on auth failure (preventing partial state)",
      tempDocAfterFail.data()?.status === "active"
    );

    // ==========================================================================
    // 7. REACTIVATION LIFECYCLE
    // ==========================================================================
    console.log("\n--- 7. Reactivation Lifecycle ---");

    const reactivateRes = await makeRequest(
      port,
      `/api/organizations/${orgAlphaId}/members/mem_target_alpha/reactivate`,
      "POST",
      { Authorization: `Bearer test_token_${adminToken}` }
    );
    assertTest("7.1 Reactivate endpoint returns 200 OK", reactivateRes.status === 200 && reactivateRes.body.status === "active");

    const reactivatedDoc = await db.collection("orgMembers").doc("mem_target_alpha").get();
    assertTest("7.2 Member document restored to 'active'", reactivatedDoc.data()?.status === "active");

    const restoredClaims = db.customClaimsStore.get(targetMemberUid);
    assertTest("7.3 Custom claims restored on reactivation", restoredClaims?.orgId === orgAlphaId && restoredClaims?.orgRole === "member");

    const reactivatedAccess = await checkOrgAccess(
      db as any,
      "target@alpha.com",
      orgAlphaId,
      ["member"],
      { uid: targetMemberUid, email: "target@alpha.com" }
    );
    assertTest("7.4 checkOrgAccess allows reactivated member", reactivatedAccess.hasAccess === true);

    // ==========================================================================
    // 8. AUDIT LOG INTEGRITY
    // ==========================================================================
    console.log("\n--- 8. Audit Log Invariants ---");

    const auditSnap = await db.collection("organizations").doc(orgAlphaId).collection("auditLogs").get();
    const deactEvents = auditSnap.docs.filter(d => d.data().action === "MEMBER_DEACTIVATED");
    const reactEvents = auditSnap.docs.filter(d => d.data().action === "MEMBER_REACTIVATED");

    assertTest("8.1 MEMBER_DEACTIVATED audit logs recorded in Firestore", deactEvents.length >= 2);
    assertTest("8.2 MEMBER_REACTIVATED audit logs recorded in Firestore", reactEvents.length >= 1);
    assertTest("8.3 Audit records contain actor and target identity", deactEvents[0]?.data()?.actorUserId === adminUid && deactEvents[0]?.data()?.targetUserId === targetMemberUid);

  } finally {
    server.close();
  }

  console.log("\n================================================================================");
  console.log(`📊 STEP 5.2 VERIFICATION SUMMARY: ${passedTests}/${totalTests} PASSED, ${failedTests} FAILED`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSessionFreshnessTestSuite().catch(err => {
  console.error("❌ Fatal error in test runner:", err);
  process.exit(1);
});
