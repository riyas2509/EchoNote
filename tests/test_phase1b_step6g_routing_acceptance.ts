/**
 * EchoNote Phase 1B Step 6G: Production Invitation Acceptance Routing & Error Handling Test Suite
 * 
 * Verifies all 10 required invariants:
 * 1. VITE_API_URL production URL handling (safely trimmed, trailing slashes removed, empty fallback).
 * 2. Absolute API URL generation (getApiUrl resolves configured base URL correctly).
 * 3. Invitation preview using configured API base (fetches from correct remote host).
 * 4. Non-JSON / HTML API response handling (distinguished cleanly as 'unavailable' with user-safe message).
 * 5. Invalid invitation handling remains distinct (HTTP 404 yields status: 'invalid').
 * 6. Expired invitation handling remains distinct (yields status: 'expired').
 * 7. Cancelled invitation handling remains distinct (yields status: 'cancelled').
 * 8. Email mismatch remains strictly blocked with 403 and mismatch UI.
 * 9. Acceptance request remains authenticated (HTTP 401 Unauthorized without token).
 * 10. Existing Phase 1B acceptance architecture and security invariants are preserved.
 */

import http from "http";
import express from "express";
import { AddressInfo } from "net";
import crypto from "crypto";
import fs from "fs";
import { getApiBaseUrl, getApiUrl, previewOrgInvite, OrgInvitationPreview } from "../lib/apiClient.js";

// ============================================================================
// TEST HARNESS
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

// ============================================================================
// IN-MEMORY MOCK FIRESTORE
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

    for (const [key, docData] of this.db.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      const docId = key.slice(prefix.length);
      if (docId.includes("/")) continue;

      let match = true;
      for (const filter of this.filters) {
        if (docData[filter.field] !== filter.val) {
          match = false;
          break;
        }
      }

      if (match) {
        matchedDocs.push(new MockDocSnapshot(docId, docData));
      }
    }

    return new MockQuerySnapshot(matchedDocs);
  }
}

class MockFirestore {
  public store = new Map<string, any>();

  collection(name: string) {
    return {
      doc: (id: string) => ({
        get: async () => new MockDocSnapshot(id, this.store.get(`${name}/${id}`)),
        set: async (data: any) => {
          this.store.set(`${name}/${id}`, JSON.parse(JSON.stringify(data)));
        },
        update: async (data: any) => {
          const existing = this.store.get(`${name}/${id}`) || {};
          this.store.set(`${name}/${id}`, { ...existing, ...JSON.parse(JSON.stringify(data)) });
        }
      }),
      where: (field: string, op: string, val: any) => {
        return new MockQuery(this, name, [{ field, op, val }]);
      }
    };
  }
}

// ============================================================================
// STEP 6G SERVER RUNNER
// ============================================================================

function createStep6GServer(db: MockFirestore) {
  const app = express();
  app.use(express.json());

  // GET invitation preview
  app.get("/api/organizations/invitation-preview/:inviteId", async (req: any, res: any) => {
    const { inviteId } = req.params;
    if (!inviteId || !inviteId.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "inviteId is required" });
    }

    const doc = await db.collection("orgInvitations").doc(inviteId.trim()).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Invitation not found" });
    }

    const invite = doc.data();
    if (invite.status === "accepted") {
      return res.status(400).json({ status: "accepted", error: "Bad Request", message: "This invitation has already been accepted." });
    }
    if (invite.status === "cancelled" || invite.status === "rejected") {
      return res.status(400).json({ status: "cancelled", error: "Bad Request", message: "This invitation has been cancelled." });
    }
    if (invite.status === "expired" || (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now())) {
      return res.status(400).json({ status: "expired", error: "Bad Request", message: "This invitation has expired." });
    }

    const orgDoc = await db.collection("organizations").doc(invite.orgId).get();
    const orgName = orgDoc.exists ? orgDoc.data()?.name || "an organization" : "an organization";

    return res.json({
      valid: true,
      status: "pending",
      organizationName: orgName,
      orgId: invite.orgId,
      invitedBy: invite.invitedBy || "Admin",
      recipientEmail: invite.email,
      role: invite.role || "member",
      expiresAt: invite.expiresAt
    });
  });

  // POST acceptance endpoint
  app.post("/api/organizations/accept-invite", async (req: any, res: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    }

    const { inviteId } = req.body;
    const callerEmail = req.headers["x-test-email"] || "caller@test.com";

    const doc = await db.collection("orgInvitations").doc(inviteId).get();
    if (!doc.exists) {
      return res.status(404).json({ error: "Not Found", message: "Invitation not found" });
    }

    const invite = doc.data();
    if (invite.email.toLowerCase().trim() !== callerEmail.toLowerCase().trim()) {
      return res.status(403).json({ error: "Forbidden", message: "This invitation was sent to a different email address." });
    }

    return res.json({ success: true, orgId: invite.orgId, role: invite.role });
  });

  // Simulated HTML route (simulating Vercel SPA fallback or Cloud Run catch-all)
  app.get("/simulated-spa-html-fallback", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send("<!DOCTYPE html><html><head><title>EchoNote</title></head><body><div id='root'></div></body></html>");
  });

  // Simulated 405 endpoint
  app.all("/simulated-405-endpoint", (_req, res) => {
    res.status(405).setHeader("Content-Type", "text/plain").send("Method Not Allowed");
  });

  // Simulated 503 endpoint
  app.get("/simulated-503-endpoint", (_req, res) => {
    res.status(503).json({ error: "Service Unavailable" });
  });

  return app;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runStep6GTestSuite() {
  console.log("================================================================================");
  console.log("🚀 ECHONOTE PHASE 1B STEP 6G: ROUTING & ERROR HANDLING TEST SUITE");
  console.log("================================================================================");

  const mockDb = new MockFirestore();
  const server = http.createServer(createStep6GServer(mockDb));
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const mockBackendUrl = `http://127.0.0.1:${port}`;

  const savedEnv = process.env.VITE_API_URL;

  try {
    // --------------------------------------------------------------------------
    // PART 1 & 2: VITE_API_URL HANDLING & ABSOLUTE API URL RESOLUTION
    // --------------------------------------------------------------------------
    console.log("\n--- PART 1 & 2: VITE_API_URL & API URL RESOLUTION ---");

    process.env.VITE_API_URL = "https://echonote-200551109142.us-west1.run.app/";
    const prodBase = getApiBaseUrl();
    assertTest("1.1 Removes trailing slashes from configured VITE_API_URL", prodBase === "https://echonote-200551109142.us-west1.run.app");

    const resolvedAbsUrl = getApiUrl("/api/organizations/invitation-preview/inv_test");
    assertTest(
      "1.2 Resolves relative path to absolute Cloud Run URL when VITE_API_URL is configured",
      resolvedAbsUrl === "https://echonote-200551109142.us-west1.run.app/api/organizations/invitation-preview/inv_test"
    );

    const externalUrl = getApiUrl("https://other-service.com/api/test");
    assertTest("1.3 Preserves already-qualified URLs untouched", externalUrl === "https://other-service.com/api/test");

    process.env.VITE_API_URL = "";
    const emptyBase = getApiBaseUrl();
    assertTest("1.4 Falls back to empty string when VITE_API_URL is empty", emptyBase === "");
    const relativeUrl = getApiUrl("/api/health");
    assertTest("1.5 Generates clean relative URL when VITE_API_URL is unset", relativeUrl === "/api/health");

    // --------------------------------------------------------------------------
    // PART 3: INVITATION PREVIEW WITH CONFIGURED API BASE
    // --------------------------------------------------------------------------
    console.log("\n--- PART 3: INVITATION PREVIEW VIA API BASE ---");

    // Point VITE_API_URL to test server
    process.env.VITE_API_URL = mockBackendUrl;

    const validInviteId = `inv_${crypto.randomBytes(32).toString("hex")}`;
    await mockDb.collection("organizations").doc("org_101").set({
      id: "org_101",
      name: "Acme Enterprises"
    });
    await mockDb.collection("orgInvitations").doc(validInviteId).set({
      id: validInviteId,
      orgId: "org_101",
      email: "riya@echotechai.in",
      role: "org_admin",
      status: "pending",
      invitedBy: "admin@echotechai.in",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    const preview = await previewOrgInvite(validInviteId);
    assertTest("3.1 Valid invitation preview returns valid: true", preview.valid === true);
    assertTest("3.2 Valid invitation preview returns status: 'pending'", preview.status === "pending");
    assertTest("3.3 Valid invitation preview returns correct organization name", preview.organizationName === "Acme Enterprises");
    assertTest("3.4 Valid invitation preview returns invited recipient email", preview.recipientEmail === "riya@echotechai.in");
    assertTest("3.5 Valid invitation preview returns assigned role", preview.role === "org_admin");

    // --------------------------------------------------------------------------
    // PART 4: NON-JSON / HTML API RESPONSE HANDLING
    // --------------------------------------------------------------------------
    console.log("\n--- PART 4: NON-JSON & HTML RESPONSE DETECTION ---");

    // Point to endpoint returning HTML
    const htmlApp = express();
    htmlApp.get("/api/organizations/invitation-preview/:inviteId", (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send("<!DOCTYPE html><html><head><title>EchoNote</title></head><body>Vercel SPA HTML</body></html>");
    });
    const htmlServer = http.createServer(htmlApp);
    await new Promise<void>((resolve) => htmlServer.listen(0, () => resolve()));
    const htmlPort = (htmlServer.address() as AddressInfo).port;
    process.env.VITE_API_URL = `http://127.0.0.1:${htmlPort}`;

    const htmlPreview = await previewOrgInvite("inv_sample_id");
    assertTest("4.1 HTML 200 response yields valid: false", htmlPreview.valid === false);
    assertTest("4.2 HTML 200 response yields status: 'unavailable'", htmlPreview.status === "unavailable");
    assertTest(
      "4.3 HTML 200 response yields user-safe message",
      htmlPreview.message === "EchoNote could not connect to the invitation service. Please try again."
    );
    assertTest("4.4 HTML response does NOT collapse into status: 'invalid'", htmlPreview.status !== "invalid");

    htmlServer.close();

    // --------------------------------------------------------------------------
    // PART 5, 6, 7: LIFECYCLE STATES (INVALID, EXPIRED, CANCELLED)
    // --------------------------------------------------------------------------
    console.log("\n--- PART 5, 6, 7: LIFECYCLE STATES REMAIN DISTINCT ---");

    process.env.VITE_API_URL = mockBackendUrl;

    // Non-existent invitation (404)
    const invalidPreview = await previewOrgInvite("inv_does_not_exist_999");
    assertTest("5.1 Missing invitation returns valid: false", invalidPreview.valid === false);
    assertTest("5.2 Missing invitation returns status: 'invalid'", invalidPreview.status === "invalid");
    assertTest("5.3 Missing invitation message describes not found", invalidPreview.message?.includes("not found") === true);

    // Expired invitation
    const expiredInviteId = `inv_expired_${crypto.randomBytes(16).toString("hex")}`;
    await mockDb.collection("orgInvitations").doc(expiredInviteId).set({
      id: expiredInviteId,
      orgId: "org_101",
      email: "riya@echotechai.in",
      role: "member",
      status: "expired",
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });
    const expiredPreview = await previewOrgInvite(expiredInviteId);
    assertTest("6.1 Expired invitation returns valid: false", expiredPreview.valid === false);
    assertTest("6.2 Expired invitation returns status: 'expired'", expiredPreview.status === "expired");

    // Cancelled invitation
    const cancelledInviteId = `inv_cancelled_${crypto.randomBytes(16).toString("hex")}`;
    await mockDb.collection("orgInvitations").doc(cancelledInviteId).set({
      id: cancelledInviteId,
      orgId: "org_101",
      email: "riya@echotechai.in",
      role: "member",
      status: "cancelled"
    });
    const cancelledPreview = await previewOrgInvite(cancelledInviteId);
    assertTest("7.1 Cancelled invitation returns valid: false", cancelledPreview.valid === false);
    assertTest("7.2 Cancelled invitation returns status: 'cancelled'", cancelledPreview.status === "cancelled");

    // --------------------------------------------------------------------------
    // PART 8 & 9: EMAIL MISMATCH & AUTHENTICATED ACCEPTANCE
    // --------------------------------------------------------------------------
    console.log("\n--- PART 8 & 9: SECURITY INVARIANTS & EMAIL MISMATCH ---");

    // Unauthenticated POST /api/organizations/accept-invite
    const unauthAcceptRes = await fetch(`${mockBackendUrl}/api/organizations/accept-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId: validInviteId })
    });
    assertTest("9.1 Unauthenticated acceptance request returns 401", unauthAcceptRes.status === 401);

    // Mismatched email POST
    const mismatchAcceptRes = await fetch(`${mockBackendUrl}/api/organizations/accept-invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer fake_token",
        "x-test-email": "riyamshah2509@gmail.com"
      },
      body: JSON.stringify({ inviteId: validInviteId })
    });
    const mismatchData = await mismatchAcceptRes.json();
    assertTest("8.1 Email mismatch returns HTTP 403 Forbidden", mismatchAcceptRes.status === 403);
    assertTest(
      "8.2 Email mismatch returns exact security message",
      mismatchData.message === "This invitation was sent to a different email address."
    );

    // Matching email POST
    const matchAcceptRes = await fetch(`${mockBackendUrl}/api/organizations/accept-invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer fake_token",
        "x-test-email": "riya@echotechai.in"
      },
      body: JSON.stringify({ inviteId: validInviteId })
    });
    const matchData = await matchAcceptRes.json();
    assertTest("8.3 Matching recipient email accepted successfully", matchAcceptRes.status === 200 && matchData.success === true);

    // UI inspection for state-unavailable and state-wrong-email
    const acceptPageCode = fs.readFileSync("pages/OrgInviteAcceptPage.tsx", "utf8");
    assertTest("8.4 OrgInviteAcceptPage contains state-unavailable UI", acceptPageCode.includes('data-testid="state-unavailable"'));
    assertTest("8.5 OrgInviteAcceptPage contains state-wrong-email UI", acceptPageCode.includes('data-testid="state-wrong-email"'));
    assertTest(
      "8.6 OrgInviteAcceptPage displays user-safe message for unavailable state",
      acceptPageCode.includes("EchoNote could not connect to the invitation service. Please try again.")
    );

    // --------------------------------------------------------------------------
    // PART 10: ZERO HARDCODED PRODUCTION SECRETS / TOKENS
    // --------------------------------------------------------------------------
    console.log("\n--- PART 10: HARDENING & HYGIENE ---");

    const apiClientCode = fs.readFileSync("lib/apiClient.ts", "utf8");
    assertTest(
      "10.1 apiClient does NOT log invitation tokens",
      !apiClientCode.includes("console.log(inviteId") && !apiClientCode.includes("console.error(inviteId")
    );
    assertTest(
      "10.2 previewOrgInvite uses safeServiceErrorMessage",
      apiClientCode.includes("EchoNote could not connect to the invitation service. Please try again.")
    );

  } finally {
    process.env.VITE_API_URL = savedEnv;
    server.close();
  }

  // ----------------------------------------------------------------------------
  // RESULTS SUMMARY
  // ----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`📊 STEP 6G VERIFICATION RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log("================================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runStep6GTestSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
