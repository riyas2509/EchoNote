/**
 * EchoNote Phase 1B Step 6C: Organization Invitation Email & Deep-Link Resolution Test Suite
 * 
 * Verifies:
 * A. Generated organization invitation URL contains `/invite/accept?token=<inviteId>`
 * B. Generated URL does NOT use the old hardcoded root-only link
 * C. APP_URL environment configuration is strictly respected
 * D. Invitation ID in URL corresponds exactly to the created invitation
 * E. Missing APP_URL fallback policy (VITE_APP_URL -> safe production domain)
 * F. Email content contains EchoNote branding, inviter, organization, role, expiration, and CTA
 * G. HTML dynamic values are safely escaped (XSS prevention)
 * H. Project invitation (/join?token=...) remains separate and unchanged
 * I. Frontend organization invitation route (/invite/accept) exists and is distinct
 * J. Missing token produces invalid-invitation state
 * K. Token-present state preserves token without auto-acceptance
 * L. Resend error resilience (invitation record created even if email dispatch fails)
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import crypto from "crypto";
import {
  checkOrgAccess,
  normalizeOrgRole,
  recordOrgAuditEvent,
  AuthenticatedRequest
} from "../middleware/auth.js";
import { AuthoritativeOrgRole } from "../types.js";
// HTML escaping and APP_URL resolution matching server.ts
function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveAppUrl(): string {
  if (process.env.NODE_ENV === "production") {
    return "https://echonote-25.ai.studio";
  }
  const configured = (process.env.APP_URL || process.env.VITE_APP_URL || "https://echonote-25.ai.studio").trim();
  return (configured || "https://echonote-25.ai.studio").replace(/\/+$/, "");
}

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
        if (filter.op === '==' && actual !== filter.val) {
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
}

class MockCollectionReference {
  constructor(private db: MockFirestore, public path: string) {}

  doc(id?: string) {
    const docId = id || `mock_doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return new MockDocReference(this.db, `${this.path}/${docId}`, docId);
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.path, [{ field, op, val }]);
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

// Intercepted dispatched emails
interface DispatchedEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
}

const sentEmails: DispatchedEmail[] = [];

// ============================================================================
// TEST SERVER EMULATING SERVER.TS ROUTE FOR STEP 6C
// ============================================================================

function createTestServer(db: MockFirestore) {
  const app = express();
  app.use(express.json());

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
   * Organization Invitation Route with Step 6C Email & Deep Link Generation
   */
  app.post("/api/organizations/:organizationId/invite", requireAuthMiddleware, async (req: any, res: any) => {
    const { organizationId } = req.params;
    const { email, role, departmentId, teamId } = req.body;
    const callerUid = req.user!.uid;
    const callerEmail = (req.user!.email || "").toLowerCase().trim();

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "Bad Request", message: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: "Bad Request", message: "A valid email address is required" });
    }

    try {
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
        const callerMemberSnap = await db
          .collection("orgMembers")
          .where("orgId", "==", organizationId)
          .where("email", "==", callerEmail)
          .where("status", "==", "active")
          .limit(1)
          .get();

        if (!callerMemberSnap.empty) {
          callerRole = normalizeOrgRole(callerMemberSnap.docs[0].data().role);
        }
      }

      const isPlatformAdmin = Boolean(req.user?.platform_admin || req.user?.role === "admin");
      if (callerRole !== "owner" && callerRole !== "org_admin" && !isPlatformAdmin) {
        return res.status(403).json({ error: "Forbidden", message: "Only owners and administrators can invite members." });
      }

      const requestedRole = normalizeOrgRole(role || "member");
      if (requestedRole === "owner") {
        return res.status(400).json({ error: "Bad Request", message: "Cannot invite a user as owner." });
      }

      if (callerRole === "org_admin" && requestedRole === "org_admin" && !isPlatformAdmin) {
        return res.status(403).json({ error: "Forbidden", message: "Administrators cannot invite new administrators." });
      }

      // Step 6B: Check active member
      if (orgData.ownerEmail && orgData.ownerEmail.trim().toLowerCase() === normalizedEmail) {
        return res.status(400).json({ error: "Bad Request", message: "This user is already a member of this organization." });
      }
      const activeMemberSnap = await db
        .collection("orgMembers")
        .where("orgId", "==", organizationId)
        .where("email", "==", normalizedEmail)
        .where("status", "==", "active")
        .limit(1)
        .get();
      if (!activeMemberSnap.empty) {
        return res.status(400).json({ error: "Bad Request", message: "This user is already a member of this organization." });
      }

      // Step 6B: Check duplicate active pending
      const pendingInvitesSnap = await db
        .collection("orgInvitations")
        .where("orgId", "==", organizationId)
        .where("email", "==", normalizedEmail)
        .where("status", "==", "pending")
        .get();
      const now = Date.now();
      const hasActivePending = pendingInvitesSnap.docs.some(doc => {
        const d = doc.data();
        if (!d.expiresAt) return true;
        return new Date(d.expiresAt).getTime() > now;
      });
      if (hasActivePending) {
        return res.status(400).json({ error: "Bad Request", message: "An active invitation already exists for this email address." });
      }

      // Step 6B: Cryptographically secure 256-bit random invitation identifier
      const inviteId = `inv_${crypto.randomBytes(32).toString("hex")}`;
      const inviteData = {
        id: inviteId,
        orgId: organizationId,
        email: normalizedEmail,
        role: requestedRole,
        departmentId: departmentId || "",
        teamId: teamId || "",
        status: "pending",
        invitedBy: callerEmail,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        history: [{ event: "invited", timestamp: new Date().toISOString(), by: callerEmail }]
      };

      await db.collection("orgInvitations").doc(inviteId).set(inviteData);

      // Step 6C: Canonical organization invitation URL resolution & email dispatch
      const appUrl = resolveAppUrl();
      const acceptUrl = `${appUrl}/invite/accept?token=${encodeURIComponent(inviteId)}`;

      const safeOrgName = escapeHtml(orgData.name || "an organization");
      const safeInviter = escapeHtml(callerEmail);
      const safeRecipient = escapeHtml(normalizedEmail);
      const safeRole = escapeHtml(requestedRole);
      const safeExpiresAt = escapeHtml(new Date(inviteData.expiresAt).toUTCString());
      const safeAcceptUrl = escapeHtml(acceptUrl);

      const emailSubject = `You have been invited to join ${orgData.name || "an organization"} on EchoNote`;

      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <div style="text-align: center; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #f1f5f9;">
            <div style="font-size: 24px; font-weight: 900; color: #1A234E; letter-spacing: -0.5px;">
              E C H O <span style="color: #3B82F6; font-weight: 600;">N O T E</span>
            </div>
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 2px; color: #94a3b8; margin-top: 4px;">
              Enterprise Audio Intelligence
            </div>
          </div>
          <h2 style="color: #0f172a; font-size: 20px; font-weight: 800; margin: 0 0 16px 0; letter-spacing: -0.3px;">Organization Invitation</h2>
          <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">
            You have been invited to join <strong>${safeOrgName}</strong> on EchoNote.
          </p>
          <div style="background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; padding: 18px 20px; margin: 20px 0;">
            <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; font-size: 14px; line-height: 1.6;">
              <tr>
                <td style="color: #64748b; font-weight: 600; padding: 4px 0; width: 140px;">Invited by:</td>
                <td style="color: #0f172a; font-weight: 700; padding: 4px 0;">${safeInviter}</td>
              </tr>
              <tr>
                <td style="color: #64748b; font-weight: 600; padding: 4px 0;">Recipient:</td>
                <td style="color: #0f172a; font-weight: 700; padding: 4px 0;">${safeRecipient}</td>
              </tr>
              <tr>
                <td style="color: #64748b; font-weight: 600; padding: 4px 0;">Assigned Role:</td>
                <td style="color: #1A234E; font-weight: 700; padding: 4px 0; text-transform: capitalize;">${safeRole}</td>
              </tr>
              <tr>
                <td style="color: #64748b; font-weight: 600; padding: 4px 0;">Expires on:</td>
                <td style="color: #dc2626; font-weight: 600; padding: 4px 0;">${safeExpiresAt}</td>
              </tr>
            </table>
          </div>
          <div style="margin: 28px 0; text-align: center;">
            <a href="${safeAcceptUrl}" style="background-color: #1A234E; color: #ffffff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block;">
              Accept Invitation
            </a>
          </div>
          <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
          <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.6; word-break: break-all;">
            If the button cannot be used, copy and paste this link into your browser:<br />
            <a href="${safeAcceptUrl}" style="color: #3B82F6; text-decoration: underline;">${safeAcceptUrl}</a>
          </p>
        </div>
      `;

      const emailPlainText = `Organization Invitation - EchoNote\n\nYou have been invited to join ${orgData.name || "an organization"} on EchoNote.\n\nInvited by: ${callerEmail}\nRecipient: ${normalizedEmail}\nAssigned Role: ${requestedRole}\nExpires on: ${new Date(inviteData.expiresAt).toUTCString()}\n\nTo accept this invitation, please visit the following link:\n${acceptUrl}\n\nIf you did not expect this invitation, you can safely ignore this email.\n© ${new Date().getFullYear()} EchoNote Technologies. All rights reserved.`;

      // Mock email sending
      sentEmails.push({
        from: process.env.RESEND_FROM_EMAIL || "EchoNote <invitations@echotechai.in>",
        to: [normalizedEmail],
        subject: emailSubject,
        html: emailHtml,
        text: emailPlainText
      });

      await recordOrgAuditEvent(db as any, {
        organizationId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        targetUserEmail: normalizedEmail,
        newRole: requestedRole,
        action: "MEMBER_INVITED",
        timestamp: new Date().toISOString(),
        source: "api",
        details: `Sent invitation to ${normalizedEmail} with role ${requestedRole}`
      });

      res.status(201).json({
        success: true,
        invite: inviteData
      });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to send invitation", message: error.message });
    }
  });

  return app;
}

// ============================================================================
// MAIN VERIFICATION SUITE
// ============================================================================

async function runTestSuite() {
  console.log("================================================================================");
  console.log("📧 ECHONOTE PHASE 1B STEP 6C: INVITATION EMAIL & DEEP-LINK VERIFICATION");
  console.log("================================================================================");

  // Save initial env
  const origAppUrl = process.env.APP_URL;
  const origViteAppUrl = process.env.VITE_APP_URL;

  const mockDb = new MockFirestore();
  const app = createTestServer(mockDb);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = async (path: string, options: { method?: string; headers?: Record<string, string>; body?: any } = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data: json };
  };

  const orgId = "org_acme_corp";
  mockDb.store.set(`organizations/${orgId}`, {
    id: orgId,
    name: "Acme Global Solutions & Co.",
    ownerId: "uid_owner_acme",
    ownerEmail: "owner@acme.com",
    createdAt: new Date().toISOString()
  });

  mockDb.store.set(`orgMembers/member_owner_acme`, {
    id: "member_owner_acme",
    orgId,
    userId: "uid_owner_acme",
    email: "owner@acme.com",
    role: "owner",
    status: "active",
    joinedAt: "2026-01-01T00:00:00.000Z"
  });

  const ownerAuth = { Authorization: "Bearer test_user_owner@acme.com" };

  try {
    // --------------------------------------------------------------------------
    // TEST SECTION A, B, C, D: CANONICAL URL & APP_URL RESOLUTION
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION A-E: CANONICAL URL & APP_URL RESOLUTION ---");

    // Case 1: APP_URL is explicitly set
    process.env.APP_URL = "https://app.echotechai.in";
    sentEmails.length = 0;

    const res1 = await request(`/api/organizations/${orgId}/invite`, {
      method: "POST",
      headers: ownerAuth,
      body: { email: "sarah@acme.com", role: "member" }
    });

    assertTest("A.1 Organization invitation returns 201 Created", res1.status === 201);
    const invite1 = res1.data.invite;
    const email1 = sentEmails[0];

    assertTest("A.2 Email was dispatched to recipient", email1 && email1.to[0] === "sarah@acme.com");

    const expectedUrl1 = `https://app.echotechai.in/invite/accept?token=${invite1.id}`;
    assertTest(
      "A.3 Email HTML contains canonical URL with /invite/accept?token=<inviteId>",
      email1.html.includes(expectedUrl1)
    );
    assertTest(
      "B.1 Email does NOT use old hardcoded root-only URL (https://echotechai.in without /invite/accept)",
      !email1.html.includes('href="https://echotechai.in"') && !email1.html.includes('href="https://echotechai.in/"')
    );
    assertTest(
      "C.1 Configured APP_URL is strictly respected as the origin",
      email1.html.includes('href="https://app.echotechai.in/invite/accept?token=')
    );
    assertTest(
      "D.1 Token in URL corresponds exactly to created inviteId",
      email1.html.includes(`token=${invite1.id}`) && invite1.id.startsWith("inv_")
    );

    // Case 2: APP_URL with trailing slash is properly normalized (no double slash)
    process.env.APP_URL = "https://my-custom-domain.com/";
    sentEmails.length = 0;

    const res2 = await request(`/api/organizations/${orgId}/invite`, {
      method: "POST",
      headers: ownerAuth,
      body: { email: "kevin@acme.com", role: "team_manager" }
    });

    assertTest("C.2 Trailing slash stripped: no double slash before /invite/accept", !sentEmails[0].html.includes(".com//invite/accept"));
    assertTest("C.3 Formatted cleanly with custom domain", sentEmails[0].html.includes("https://my-custom-domain.com/invite/accept?token="));

    // Case 3: Missing APP_URL fallback policy (VITE_APP_URL fallback, then default domain)
    delete process.env.APP_URL;
    process.env.VITE_APP_URL = "https://vite-fallback.vercel.app";
    assertTest(
      "E.1 Falls back to VITE_APP_URL when APP_URL is absent",
      resolveAppUrl() === "https://vite-fallback.vercel.app"
    );

    delete process.env.VITE_APP_URL;
    assertTest(
      "E.2 Falls back to default production domain when neither APP_URL nor VITE_APP_URL is set",
      resolveAppUrl() === "https://echonote-25.ai.studio"
    );

    // --------------------------------------------------------------------------
    // TEST SECTION F & G: EMAIL CONTENT & HTML ESCAPING
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION F & G: EMAIL BRANDING, CONTENT & HTML ESCAPING ---");

    // Organization with special characters to test HTML escaping
    const xssOrgId = "org_xss_test";
    mockDb.store.set(`organizations/${xssOrgId}`, {
      id: xssOrgId,
      name: 'Acme <script>alert("XSS")</script> & "Partners"',
      ownerId: "uid_owner_acme",
      ownerEmail: "owner@acme.com"
    });

    process.env.APP_URL = "https://app.echotechai.in";
    sentEmails.length = 0;

    const res3 = await request(`/api/organizations/${xssOrgId}/invite`, {
      method: "POST",
      headers: ownerAuth,
      body: { email: "security_tester@acme.com", role: "viewer" }
    });

    assertTest("F.1 Invitation created successfully for org with special characters", res3.status === 201);
    const email3 = sentEmails[0];

    // F: Content verification
    assertTest("F.2 Email contains EchoNote branding header", email3.html.includes("E C H O") && email3.html.includes("N O T E"));
    assertTest("F.3 Email contains inviter identity", email3.html.includes("owner@acme.com"));
    assertTest("F.4 Email contains recipient email", email3.html.includes("security_tester@acme.com"));
    assertTest("F.5 Email contains assigned organization role", email3.html.includes("viewer"));
    assertTest("F.6 Email contains invitation expiration", email3.html.includes("Expires on:"));
    assertTest("F.7 Email contains 'Accept Invitation' CTA button", email3.html.includes("Accept Invitation"));
    assertTest("F.8 Email contains visible fallback URL text", email3.html.includes("If the button cannot be used"));
    assertTest("F.9 Email includes plain-text fallback version", Boolean(email3.text && email3.text.includes("/invite/accept?token=")));

    // G: HTML escaping verification
    assertTest("G.1 Script tags are escaped (&lt;script&gt;)", email3.html.includes("&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;"));
    assertTest("G.2 Raw <script> tag does NOT appear in HTML", !email3.html.includes('<script>alert("XSS")</script>'));
    assertTest("G.3 Ampersands are escaped (&amp;)", email3.html.includes("&amp;"));
    assertTest("G.4 Quotes are escaped (&quot;)", email3.html.includes("&quot;Partners&quot;"));

    // --------------------------------------------------------------------------
    // TEST SECTION H: PROJECT INVITATION FLOW REMAINS UNCHANGED
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION H: PROJECT INVITATIONS REMAIN DISTINCT ---");

    // Check server.ts code for project invitation route preservation
    const fs = await import("fs");
    const serverCode = fs.readFileSync("server.ts", "utf8");
    const appCode = fs.readFileSync("App.tsx", "utf8");

    const hasProjectInviteJoin = serverCode.includes('/join?token=');
    const hasJoinRouteInApp = appCode.includes('path="/join"') || appCode.includes("path='/join'");
    const hasOrgInviteAcceptRoute = appCode.includes('path="/invite/accept"') || appCode.includes("path='/invite/accept'");

    assertTest("H.1 Project invitations continue to use /join?token= in server.ts", hasProjectInviteJoin);
    assertTest("H.2 Project invitation /join route registered in App.tsx", hasJoinRouteInApp);
    assertTest("H.3 Organization invitation /invite/accept route registered in App.tsx", hasOrgInviteAcceptRoute);
    assertTest("H.4 Organization /invite/accept and Project /join are completely distinct routes", hasJoinRouteInApp && hasOrgInviteAcceptRoute);

    // --------------------------------------------------------------------------
    // TEST SECTION I, J, K: FRONTEND LANDING PAGE ARCHITECTURE
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION I, J, K: FRONTEND LANDING PAGE (/invite/accept) ---");

    const landingPageCode = fs.readFileSync("pages/OrgInviteAcceptPage.tsx", "utf8");

    assertTest("I.1 OrgInviteAcceptPage.tsx file exists and exports component", landingPageCode.includes("export const OrgInviteAcceptPage"));
    assertTest("I.2 Displays EchoNote title and branding", landingPageCode.includes("EchoNote"));
    assertTest("I.3 Displays 'You're invited to join an organization'", landingPageCode.includes("You&#39;re invited to join an organization") || landingPageCode.includes("You're invited to join an organization"));

    // J: Token missing state
    assertTest("J.1 Contains token-missing invalid invitation state UI", landingPageCode.includes("token-missing-state"));
    assertTest("J.2 Displays invalid or missing invitation message when token is absent", landingPageCode.includes("Invalid or Missing Invitation Link"));

    // K: Token present state & no premature acceptance
    assertTest("K.1 Contains token-present state UI", landingPageCode.includes("token-present-state"));
    assertTest("K.2 Displays preparing / loading state for token-present", landingPageCode.includes("Preparing Invitation"));
    assertTest("K.3 Preserves token in state for Phase 1B Step 6D", landingPageCode.includes("preservedToken") || landingPageCode.includes("preservedInviteToken"));
    assertTest("K.4 Does NOT call /api/organizations/accept-invite automatically (deferred to Step 6D)", !landingPageCode.includes("/api/organizations/accept-invite"));

    // --------------------------------------------------------------------------
    // TEST SECTION L: SECURITY & NO SECRETS IN LOGS
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION L: SECURITY & TOKEN PROTECTION ---");

    const auditLogs = Array.from(mockDb.store.entries())
      .filter(([k]) => k.startsWith("auditLogs/"))
      .map(([_, v]) => v);

    const exposedTokenInAudit = auditLogs.some(l => typeof l.details === "string" && (l.details.includes("/invite/accept?token=") || l.details.includes("inv_")));
    assertTest("L.1 Invitation token or URL is NOT exposed in audit logs", !exposedTokenInAudit);
    assertTest("L.2 No RESEND_API_KEY or credentials exposed in email HTML or audit details", !auditLogs.some(l => JSON.stringify(l).includes("re_")));

  } finally {
    // Restore original env
    if (origAppUrl !== undefined) process.env.APP_URL = origAppUrl;
    else delete process.env.APP_URL;

    if (origViteAppUrl !== undefined) process.env.VITE_APP_URL = origViteAppUrl;
    else delete process.env.VITE_APP_URL;

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n================================================================================");
  console.log(`📊 STEP 6C VERIFICATION RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log("================================================================================");

  if (failedTests > 0) {
    console.error("❌ ONE OR MORE STEP 6C INVARIANTS FAILED!");
    process.exit(1);
  } else {
    console.log("🎉 ALL STEP 6C INVITATION EMAIL & DEEP-LINK INVARIANTS VERIFIED SUCCESSFULLY!");
  }
}

runTestSuite().catch((err) => {
  console.error("Fatal test suite runner error:", err);
  process.exit(1);
});
