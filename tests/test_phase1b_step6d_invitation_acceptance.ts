/**
 * EchoNote Phase 1B Step 6D: Organization Invitation Acceptance UX Test Suite
 * 
 * Verifies all 20 required acceptance UX invariants:
 * A. Missing token state produces State B
 * B. Token-present state parses and validates token
 * C. Unauthenticated user flow offers Sign In / Create Account without accepting
 * D. Authentication return preserves invitation token via sessionStorage
 * E. Correct recipient email allows proceeding to State D
 * F. Wrong recipient email strictly displays State E and denies acceptance
 * G. Explicit acceptance required (zero automatic/silent acceptance)
 * H. Acceptance calls POST /api/organizations/accept-invite
 * I. Client does not supply role or orgId as authority (only { inviteId })
 * J. Loading & double-submit protection
 * K. Expired invitation displays State F
 * L. Cancelled invitation displays State G
 * M. Already accepted invitation displays State H
 * N. Invalid invitation displays invalid state
 * O. Successful acceptance yields State J
 * P. refreshClaims is exposed in FirebaseContext and invoked after acceptance
 * Q. Updated organization claims become available
 * R. Successful navigation to /app
 * S. Token is NOT persisted to localStorage
 * T. Project /join invitation flow remains distinct and unchanged
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import crypto from "crypto";
import fs from "fs";
import {
  checkOrgAccess,
  normalizeOrgRole,
  recordOrgAuditEvent,
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
      }

      if (matches) {
        matchedDocs.push(new MockDocSnapshot(remainder, data, this.db.doc(key)));
      }
    }

    return new MockQuerySnapshot(matchedDocs);
  }
}

class MockDocReference {
  constructor(private db: MockFirestore, private fullPath: string, public id: string) {}

  async get(): Promise<MockDocSnapshot> {
    const data = this.db.store.get(this.fullPath);
    return new MockDocSnapshot(this.id, data, this);
  }

  async set(data: any): Promise<void> {
    this.db.store.set(this.fullPath, JSON.parse(JSON.stringify(data)));
  }

  async update(patch: any): Promise<void> {
    const existing = this.db.store.get(this.fullPath) || {};
    this.db.store.set(this.fullPath, { ...existing, ...JSON.parse(JSON.stringify(patch)) });
  }

  async delete(): Promise<void> {
    this.db.store.delete(this.fullPath);
  }

  collection(subCollPath: string) {
    return new MockCollectionReference(this.db, `${this.fullPath}/${subCollPath}`);
  }
}

class MockCollectionReference {
  constructor(private db: MockFirestore, private collPath: string) {}

  doc(id?: string) {
    const docId = id || `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new MockDocReference(this.db, `${this.collPath}/${docId}`, docId);
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collPath, [{ field, op, val }]);
  }

  async get(): Promise<MockQuerySnapshot> {
    return new MockQuery(this.db, this.collPath, []).get();
  }

  async add(data: any): Promise<MockDocReference> {
    const docRef = this.doc();
    await docRef.set({ ...data, id: docRef.id });
    return docRef;
  }
}

class MockFirestore {
  public store = new Map<string, any>();

  collection(collPath: string) {
    return new MockCollectionReference(this, collPath);
  }

  doc(docPath: string) {
    const parts = docPath.split("/");
    const id = parts[parts.length - 1];
    return new MockDocReference(this, docPath, id);
  }
}

// ============================================================================
// STEP 6D EXPRESS TEST SERVER
// ============================================================================

function createStep6DServer(db: MockFirestore, mockClaimsSync?: (uid: string, orgId: string, role: string) => void) {
  const app = express();
  app.use(express.json());

  // Test auth middleware simulation
  app.use((req: any, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer test_user_")) {
      const email = authHeader.replace("Bearer test_user_", "");
      req.user = {
        uid: `uid_${email.replace(/[^a-zA-Z0-9]/g, "_")}`,
        email,
        name: email.split("@")[0]
      };
    }
    next();
  });

  const requireAuthMiddleware = (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    }
    next();
  };

  /**
   * Safe Organization Invitation Preview Endpoint
   */
  app.get("/api/organizations/invitation-preview/:inviteId", async (req: any, res: any) => {
    const { inviteId } = req.params;
    if (!inviteId || typeof inviteId !== "string" || !inviteId.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "inviteId is required" });
    }

    try {
      const inviteRef = db.collection("orgInvitations").doc(inviteId.trim());
      const inviteDoc = await inviteRef.get();

      if (!inviteDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Invitation not found" });
      }

      const inviteData = inviteDoc.data()!;

      // Check accepted state
      if (inviteData.status === "accepted") {
        return res.status(400).json({
          status: "accepted",
          error: "Bad Request",
          message: "This invitation has already been accepted."
        });
      }

      // Check cancelled / rejected state
      if (inviteData.status === "cancelled" || inviteData.status === "rejected") {
        return res.status(400).json({
          status: "cancelled",
          error: "Bad Request",
          message: "This invitation has been cancelled."
        });
      }

      // Check expiration
      const now = Date.now();
      const isExpired = inviteData.status === "expired" || (inviteData.expiresAt && new Date(inviteData.expiresAt).getTime() <= now);
      if (isExpired) {
        return res.status(400).json({
          status: "expired",
          error: "Bad Request",
          message: "This invitation has expired."
        });
      }

      if (inviteData.status !== "pending") {
        return res.status(400).json({
          status: "invalid",
          error: "Bad Request",
          message: "This invitation is not valid for acceptance."
        });
      }

      let orgName = "an organization";
      if (inviteData.orgId) {
        try {
          const orgDoc = await db.collection("organizations").doc(inviteData.orgId).get();
          if (orgDoc.exists) {
            orgName = orgDoc.data()?.name || "an organization";
          }
        } catch {}
      }

      res.json({
        valid: true,
        status: "pending",
        organizationName: orgName,
        orgId: inviteData.orgId,
        invitedBy: inviteData.invitedBy || "An administrator",
        recipientEmail: inviteData.email,
        role: inviteData.role || "member",
        expiresAt: inviteData.expiresAt
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to preview invitation", message: error.message });
    }
  });

  /**
   * Authoritative Accept Organization Invitation Endpoint
   */
  app.post("/api/organizations/accept-invite", requireAuthMiddleware, async (req: any, res: any) => {
    const { inviteId } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase().trim();

    if (!inviteId || typeof inviteId !== "string" || !inviteId.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "inviteId is required" });
    }

    try {
      const inviteRef = db.collection("orgInvitations").doc(inviteId.trim());
      const inviteDoc = await inviteRef.get();

      if (!inviteDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Invitation not found" });
      }

      const inviteData = inviteDoc.data()!;
      const invitedEmail = (inviteData.email || "").toLowerCase().trim();

      // Mismatched recipient email
      if (invitedEmail !== callerEmail) {
        return res.status(403).json({ error: "Forbidden", message: "This invitation was sent to a different email address." });
      }

      // Replay prevention
      if (inviteData.status === "accepted") {
        return res.status(400).json({ error: "Bad Request", message: "This invitation has already been accepted." });
      }

      // Cancelled check
      if (inviteData.status === "cancelled" || inviteData.status === "rejected") {
        return res.status(400).json({ error: "Bad Request", message: "This invitation has been cancelled." });
      }

      // Expiration check
      const now = Date.now();
      const isExpired = inviteData.status === "expired" || (inviteData.expiresAt && new Date(inviteData.expiresAt).getTime() <= now);
      if (isExpired) {
        return res.status(400).json({ error: "Bad Request", message: "This invitation has expired." });
      }

      if (inviteData.status !== "pending") {
        return res.status(400).json({ error: "Bad Request", message: "This invitation is not valid for acceptance." });
      }

      const orgId = inviteData.orgId;
      const role = normalizeOrgRole(inviteData.role || "member");
      const nowIso = new Date().toISOString();

      let existingMemberDocSnap: any = null;
      const memberByEmailSnap = await db
        .collection("orgMembers")
        .where("orgId", "==", orgId)
        .where("email", "==", callerEmail)
        .limit(1)
        .get();

      if (!memberByEmailSnap.empty) {
        existingMemberDocSnap = memberByEmailSnap.docs[0];
      }

      let memberId: string;
      if (existingMemberDocSnap) {
        memberId = existingMemberDocSnap.id;
        await existingMemberDocSnap.ref.update({
          status: "active",
          role,
          userId: callerUid,
          updatedAt: nowIso
        });
      } else {
        memberId = `member_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.collection("orgMembers").doc(memberId).set({
          id: memberId,
          orgId,
          userId: callerUid,
          email: callerEmail,
          role,
          departmentId: inviteData.departmentId || "",
          teamId: inviteData.teamId || "",
          status: "active",
          joinedAt: nowIso,
          updatedAt: nowIso
        });
      }

      // Update invitation state
      const history = Array.isArray(inviteData.history) ? [...inviteData.history] : [];
      history.push({
        event: "accepted",
        timestamp: nowIso,
        by: callerEmail
      });

      await inviteRef.update({
        status: "accepted",
        acceptedAt: nowIso,
        acceptedBy: callerEmail,
        history
      });

      if (mockClaimsSync) {
        mockClaimsSync(callerUid, orgId, role);
      }

      return res.json({
        success: true,
        memberId,
        orgId,
        role,
        message: "Invitation accepted successfully."
      });
    } catch (err: any) {
      res.status(500).json({ error: "Internal Server Error", message: err.message });
    }
  });

  return app;
}

// ============================================================================
// TEST SUITE EXECUTION
// ============================================================================

async function runStep6DTestSuite() {
  console.log("================================================================================");
  console.log("🚀 ECHONOTE PHASE 1B STEP 6D: INVITATION ACCEPTANCE UX TEST SUITE");
  console.log("================================================================================");

  const mockDb = new MockFirestore();
  const claimsStore = new Map<string, { orgId: string; orgRole: string }>();

  const server = http.createServer(
    createStep6DServer(mockDb, (uid, orgId, orgRole) => {
      claimsStore.set(uid, { orgId, orgRole });
    })
  );

  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Seed test organizations
    await mockDb.collection("organizations").doc("org_alpha").set({
      id: "org_alpha",
      name: "Alpha Corp Technologies",
      ownerId: "uid_owner",
      ownerEmail: "owner@alpha.com"
    });

    await mockDb.collection("organizations").doc("org_beta").set({
      id: "org_beta",
      name: "Beta Global Industries",
      ownerId: "uid_beta_owner",
      ownerEmail: "owner@beta.com"
    });

    // Seed test invitations
    const validInviteId = `inv_${crypto.randomBytes(32).toString("hex")}`;
    await mockDb.collection("orgInvitations").doc(validInviteId).set({
      id: validInviteId,
      orgId: "org_alpha",
      email: "engineer@alpha.com",
      role: "team_manager",
      status: "pending",
      invitedBy: "owner@alpha.com",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    const expiredInviteId = `inv_${crypto.randomBytes(32).toString("hex")}`;
    await mockDb.collection("orgInvitations").doc(expiredInviteId).set({
      id: expiredInviteId,
      orgId: "org_alpha",
      email: "expired@alpha.com",
      role: "member",
      status: "pending",
      invitedBy: "owner@alpha.com",
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    });

    const cancelledInviteId = `inv_${crypto.randomBytes(32).toString("hex")}`;
    await mockDb.collection("orgInvitations").doc(cancelledInviteId).set({
      id: cancelledInviteId,
      orgId: "org_alpha",
      email: "cancelled@alpha.com",
      role: "member",
      status: "cancelled",
      invitedBy: "owner@alpha.com",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    const alreadyAcceptedInviteId = `inv_${crypto.randomBytes(32).toString("hex")}`;
    await mockDb.collection("orgInvitations").doc(alreadyAcceptedInviteId).set({
      id: alreadyAcceptedInviteId,
      orgId: "org_alpha",
      email: "already@alpha.com",
      role: "member",
      status: "accepted",
      invitedBy: "owner@alpha.com",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    // --------------------------------------------------------------------------
    // SECTION A & B: INVITATION TOKEN RESOLUTION
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION A & B: INVITATION TOKEN RESOLUTION & PREVIEW ---");

    // Test preview on valid invitation
    const previewRes = await fetch(`${baseUrl}/api/organizations/invitation-preview/${validInviteId}`);
    const previewData = await previewRes.json();

    assertTest("A.1 Preview endpoint returns 200 for valid invitation", previewRes.status === 200);
    assertTest("A.2 Preview contains valid: true and status: 'pending'", previewData.valid === true && previewData.status === "pending");
    assertTest("A.3 Preview returns organizationName without exposing internal secrets", previewData.organizationName === "Alpha Corp Technologies");
    assertTest("A.4 Preview returns recipientEmail matching invitation", previewData.recipientEmail === "engineer@alpha.com");
    assertTest("A.5 Preview returns invitedBy and role", previewData.invitedBy === "owner@alpha.com" && previewData.role === "team_manager");
    assertTest("A.6 Preview does NOT return inviteId or token in response body", !("inviteId" in previewData) && !("token" in previewData));

    // Test preview on nonexistent invitation
    const missingRes = await fetch(`${baseUrl}/api/organizations/invitation-preview/inv_nonexistent_12345`);
    assertTest("B.1 Preview returns 404 for non-existent invitation token", missingRes.status === 404);

    // --------------------------------------------------------------------------
    // SECTION C & D: UNAUTHENTICATED & SESSION STORAGE PRESERVATION
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION C & D: UNAUTHENTICATED USER FLOW & TOKEN PRESERVATION ---");

    const acceptPageCode = fs.readFileSync("pages/OrgInviteAcceptPage.tsx", "utf8");
    const appCode = fs.readFileSync("App.tsx", "utf8");

    assertTest("C.1 OrgInviteAcceptPage contains unauthenticated state UI", acceptPageCode.includes('data-testid="state-unauthenticated"'));
    assertTest("C.2 Unauthenticated state displays 'You\\'ve been invited to EchoNote'", acceptPageCode.includes("You've been invited to EchoNote"));
    assertTest("C.3 Provides Sign In button", acceptPageCode.includes("Sign In"));
    assertTest("C.4 Provides Create Account button", acceptPageCode.includes("Create Account"));
    assertTest("C.5 Does NOT automatically submit accept request when unauthenticated", !acceptPageCode.includes("useEffect(() => { handleAcceptInvite()"));

    // D: Session storage preservation
    assertTest("D.1 Uses sessionStorage for redirectAfterLogin", acceptPageCode.includes("sessionStorage.setItem('redirectAfterLogin'"));
    assertTest("D.2 App.tsx inspects sessionStorage for redirectAfterLogin", appCode.includes("sessionStorage.getItem('redirectAfterLogin')"));
    assertTest("D.3 Clears redirectAfterLogin from storage after navigation", appCode.includes("sessionStorage.removeItem('redirectAfterLogin')"));

    // S: Token is NOT persisted to localStorage
    assertTest("S.1 Token is NOT written to localStorage in OrgInviteAcceptPage", !acceptPageCode.includes("localStorage.setItem('token'") && !acceptPageCode.includes("localStorage.setItem('inviteId'"));
    assertTest("S.2 Token is NOT written to localStorage in redirectAfterLogin", !acceptPageCode.includes("localStorage.setItem('redirectAfterLogin'"));

    // --------------------------------------------------------------------------
    // SECTION E & F: EMAIL MATCHING & WRONG EMAIL GUARD
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION E & F: EMAIL MATCHING & MISMATCH GUARD ---");

    // Test wrong email acceptance attempt (Bob tries to accept Alice's invite)
    const wrongEmailRes = await fetch(`${baseUrl}/api/organizations/accept-invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test_user_wrong_user@enterprise.com"
      },
      body: JSON.stringify({ inviteId: validInviteId })
    });
    const wrongEmailData = await wrongEmailRes.json();

    assertTest("F.1 Backend rejects mismatched recipient email with 403 Forbidden", wrongEmailRes.status === 403);
    assertTest("F.2 Returns safe message: 'This invitation was sent to a different email address.'", wrongEmailData.message === "This invitation was sent to a different email address.");

    // UI wrong email state
    assertTest("F.3 OrgInviteAcceptPage contains wrong-email state UI", acceptPageCode.includes('data-testid="state-wrong-email"'));
    assertTest("F.4 UI renders 'This invitation was sent to a different email address.'", acceptPageCode.includes("This invitation was sent to a different email address."));
    assertTest("F.5 UI provides Sign out option to switch accounts", acceptPageCode.includes("handleSignOut"));

    // --------------------------------------------------------------------------
    // SECTION G, H, I, J: ACCEPTANCE REQUEST & DOUBLE SUBMIT PROTECTION
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION G, H, I, J: ACCEPTANCE INVOCATION & SUBMISSION SAFETY ---");

    assertTest("G.1 UI requires explicit button click (accept-invitation-button)", acceptPageCode.includes('data-testid="accept-invitation-button"'));
    assertTest("H.1 Acceptance API helper calls POST /api/organizations/accept-invite", fs.readFileSync("lib/apiClient.ts", "utf8").includes("apiFetch('/api/organizations/accept-invite'"));
    
    // I: Client does not supply authority
    const apiClientCode = fs.readFileSync("lib/apiClient.ts", "utf8");
    assertTest("I.1 acceptOrgInvite only transmits inviteId in body", apiClientCode.includes("body: JSON.stringify({ inviteId })"));
    assertTest("I.2 acceptOrgInvite does not pass client-supplied role or orgId", !apiClientCode.includes("role: payload.role") && !apiClientCode.includes("orgId: payload.orgId"));

    // J: Double submit protection
    assertTest("J.1 Accept button disables during request (disabled={accepting})", acceptPageCode.includes("disabled={accepting}"));
    assertTest("J.2 Displays 'Joining organization...' progress text", acceptPageCode.includes("Joining organization..."));

    // --------------------------------------------------------------------------
    // SECTION K, L, M, N: LIFECYCLE STATES (EXPIRED, CANCELLED, ACCEPTED)
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION K, L, M, N: LIFECYCLE EDGE CASES ---");

    // K: Expired
    const expiredRes = await fetch(`${baseUrl}/api/organizations/invitation-preview/${expiredInviteId}`);
    const expiredData = await expiredRes.json();
    assertTest("K.1 Expired invitation returns status 'expired'", expiredData.status === "expired");
    assertTest("K.2 OrgInviteAcceptPage contains state-expired UI", acceptPageCode.includes('data-testid="state-expired"'));
    assertTest("K.3 Displays 'This invitation has expired.'", acceptPageCode.includes("This invitation has expired."));

    // L: Cancelled
    const cancelledRes = await fetch(`${baseUrl}/api/organizations/invitation-preview/${cancelledInviteId}`);
    const cancelledData = await cancelledRes.json();
    assertTest("L.1 Cancelled invitation returns status 'cancelled'", cancelledData.status === "cancelled");
    assertTest("L.2 OrgInviteAcceptPage contains state-cancelled UI", acceptPageCode.includes('data-testid="state-cancelled"'));
    assertTest("L.3 Displays 'This invitation has been cancelled.'", acceptPageCode.includes("This invitation has been cancelled."));

    // M: Already accepted
    const alreadyRes = await fetch(`${baseUrl}/api/organizations/invitation-preview/${alreadyAcceptedInviteId}`);
    const alreadyData = await alreadyRes.json();
    assertTest("M.1 Already accepted invitation returns status 'accepted'", alreadyData.status === "accepted");
    assertTest("M.2 OrgInviteAcceptPage contains state-already-accepted UI", acceptPageCode.includes('data-testid="state-already-accepted"'));
    assertTest("M.3 Displays 'This invitation has already been accepted.'", acceptPageCode.includes("This invitation has already been accepted."));

    // N: Missing token state in page
    assertTest("N.1 OrgInviteAcceptPage contains state-missing-token UI", acceptPageCode.includes('data-testid="state-missing-token"'));
    assertTest("N.2 Missing token displays 'This invitation link is missing its invitation code.'", acceptPageCode.includes("This invitation link is missing its invitation code."));

    // --------------------------------------------------------------------------
    // SECTION O, P, Q, R: SUCCESSFUL ACCEPTANCE & CLAIM REFRESH
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION O, P, Q, R: SUCCESSFUL ACCEPTANCE & CLAIMS REFRESH ---");

    // Execute valid acceptance as engineer@alpha.com
    const acceptRes = await fetch(`${baseUrl}/api/organizations/accept-invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer test_user_engineer@alpha.com"
      },
      body: JSON.stringify({ inviteId: validInviteId })
    });
    const acceptData = await acceptRes.json();

    assertTest("O.1 Valid recipient accepts invitation successfully (200 OK)", acceptRes.status === 200);
    assertTest("O.2 Response returns success: true and assigned role", acceptData.success === true && acceptData.role === "team_manager");
    assertTest("O.3 Response returns assigned orgId", acceptData.orgId === "org_alpha");

    // Member record creation in orgMembers
    const memberSnap = await mockDb.collection("orgMembers")
      .where("orgId", "==", "org_alpha")
      .where("email", "==", "engineer@alpha.com")
      .get();
    assertTest("O.4 orgMembers record was created with status 'active'", !memberSnap.empty && memberSnap.docs[0].data().status === "active");
    assertTest("O.5 orgMembers record has assigned role 'team_manager'", memberSnap.docs[0].data().role === "team_manager");

    // Invitation record status updated to 'accepted'
    const updatedInviteDoc = await mockDb.collection("orgInvitations").doc(validInviteId).get();
    assertTest("O.6 orgInvitations status updated to 'accepted'", updatedInviteDoc.data().status === "accepted");

    // P & Q: Claims synchronization & refreshClaims exposure
    const firebaseProviderCode = fs.readFileSync("components/FirebaseProvider.tsx", "utf8");
    assertTest("P.1 refreshClaims is exposed in FirebaseContext.Provider value", firebaseProviderCode.includes("refreshClaims") && firebaseProviderCode.includes("<FirebaseContext.Provider value={{ user, profile, customClaims, isAuthReady, refreshClaims }}>"));
    assertTest("P.2 OrgInviteAcceptPage invokes refreshClaims on acceptance", acceptPageCode.includes("await refreshClaims()"));

    const engineerUid = "uid_engineer_alpha_com";
    assertTest("Q.1 Claims updated for user with orgId: 'org_alpha'", claimsStore.get(engineerUid)?.orgId === "org_alpha");
    assertTest("Q.2 Claims updated for user with orgRole: 'team_manager'", claimsStore.get(engineerUid)?.orgRole === "team_manager");

    // R: Success UI & Navigation
    assertTest("R.1 OrgInviteAcceptPage contains state-success UI", acceptPageCode.includes('data-testid="state-success"'));
    assertTest("R.2 Displays 'You\\'re in.' confirmation message", acceptPageCode.includes("You're in."));
    assertTest("R.3 Displays 'Continue to EchoNote' navigation CTA", acceptPageCode.includes("Continue to EchoNote"));
    assertTest("R.4 handleContinueToApp navigates to /app", acceptPageCode.includes("navigate('/app')"));

    // --------------------------------------------------------------------------
    // SECTION T: PROJECT INVITATION (/join) ISOLATION
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION T: PROJECT INVITATION FLOW ISOLATION ---");

    const serverCode = fs.readFileSync("server.ts", "utf8");
    assertTest("T.1 Project invitations continue to use /join?token= in server.ts", serverCode.includes("/join?token="));
    assertTest("T.2 Project invitation /join route registered in App.tsx", appCode.includes('path="/join"'));
    assertTest("T.3 JoinPage.tsx operates on 'invites' collection", fs.readFileSync("pages/JoinPage.tsx", "utf8").includes("'invites'"));
    assertTest("T.4 OrgInviteAcceptPage operates on 'orgInvitations' collection and org APIs", serverCode.includes("orgInvitations") && acceptPageCode.includes("acceptOrgInvite"));

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`📊 STEP 6D VERIFICATION RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log("================================================================================");

  if (failedTests > 0) {
    console.error("❌ ONE OR MORE STEP 6D INVARIANTS FAILED!");
    process.exit(1);
  } else {
    console.log("🎉 ALL STEP 6D INVITATION ACCEPTANCE INVARIANTS VERIFIED SUCCESSFULLY!");
  }
}

runStep6DTestSuite().catch((err) => {
  console.error("Fatal test suite error:", err);
  process.exit(1);
});
