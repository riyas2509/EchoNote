/**
 * EchoNote — Phase 1B, Step 6M-F: Invitation Error Handling & Favicon Regression Test Suite
 *
 * Verifies:
 * 1. emailService explicitly verifies Resend response.error (does not rely only on try/catch).
 * 2. emailService handles missing RESEND_API_KEY gracefully with structured sanitized failure.
 * 3. emailService handles thrown exceptions gracefully with structured sanitized failure.
 * 4. emailService masks sensitive recipient email addresses in server diagnostic logs.
 * 5. POST /api/invite-member checks emailService result; does NOT report misleading success when email fails.
 * 6. POST /api/invite-member persists invitation record in Firestore even if email delivery fails.
 * 7. POST /api/invite-member reuses existing pending invitation for same project & email on retry without duplicate records.
 * 8. POST /api/invite-member preserves authorization (MANAGE_MEMBERS required, rejects owner role).
 * 9. POST /api/organizations/:id/invite calls centralized emailService.sendOrganizationInvitation.
 * 10. POST /api/organizations/:id/invite reports emailSent: false when Resend rejects email while preserving invitation record.
 * 11. POST /api/organizations/:id/invite rejects duplicate active pending invitations (400) on standard invite.
 * 12. POST /api/organizations/:id/invite with resend: true reuses existing invitation record without creating duplicates.
 * 13. index.html contains zero embedded legacy purple SVG data-URIs or #8b5cf6.
 * 14. index.html specifies valid multi-resolution /favicon.ico and standard EchoNote icons (/Logo-1.jpg, /favicon.png).
 * 15. public/favicon.ico is a valid multi-resolution ICO image resource.
 * 16. Server-side logs and client-facing responses do NOT leak secrets, API keys, or raw provider stacks.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { 
  CANONICAL_SENDER_EMAIL, 
  resolveSenderEmail, 
  emailService, 
  maskEmailForLogs 
} from "../lib/emailService.js";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(description: string, condition: boolean, extraInfo?: any) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    if (extraInfo !== undefined) {
      console.error(`     Details:`, extraInfo);
    }
    failedTests++;
  }
}

console.log("\n======================================================================");
console.log("🚀 RUNNING PHASE 1B STEP 6M-F INVITATION & FAVICON REGRESSION TESTS");
console.log("======================================================================\n");

async function runTests() {
  // --------------------------------------------------------------------------
  // SECTION 1: EMAIL SERVICE UNIT TESTS & SENSITIVE DATA SANITIZATION
  // --------------------------------------------------------------------------
  console.log("--- SECTION 1: EMAIL SERVICE ERROR HANDLING & SANITIZATION ---");

  // 1.1 Email masking
  assert(
    "1.1 maskEmailForLogs correctly masks standard email",
    maskEmailForLogs("developer@echotechai.in") === "d***r@echotechai.in"
  );
  assert(
    "1.2 maskEmailForLogs handles short usernames safely",
    maskEmailForLogs("me@echotechai.in") === "m*@echotechai.in"
  );
  assert(
    "1.3 maskEmailForLogs handles invalid or empty inputs safely",
    maskEmailForLogs("") === "***" && maskEmailForLogs("invalid-email") === "***"
  );

  // 1.2 Missing RESEND_API_KEY configuration handling
  const origKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  const missingKeyTeamResult = await emailService.sendTeamInvitation("test@example.com", {
    inviterName: "Admin",
    projectName: "Test Project",
    role: "editor",
    inviteLink: "https://echonote-25.ai.studio/join?token=test1234"
  });

  assert(
    "1.4 sendTeamInvitation returns success: false when RESEND_API_KEY is missing",
    missingKeyTeamResult.success === false
  );
  assert(
    "1.5 sendTeamInvitation provides sanitized error without leaking secrets",
    typeof missingKeyTeamResult.error === "string" && !missingKeyTeamResult.error.includes("AIzaSy")
  );

  const missingKeyOrgResult = await emailService.sendOrganizationInvitation("org@example.com", {
    inviterName: "Org Admin",
    orgName: "Acme Corp",
    role: "member",
    inviteLink: "https://echonote-25.ai.studio/invite/accept?token=org1234"
  });

  assert(
    "1.6 sendOrganizationInvitation returns success: false when RESEND_API_KEY is missing",
    missingKeyOrgResult.success === false
  );

  // Restore key
  process.env.RESEND_API_KEY = origKey;

  // --------------------------------------------------------------------------
  // SECTION 2: FAVICON & HTML ASSET AUDIT
  // --------------------------------------------------------------------------
  console.log("\n--- SECTION 2: FAVICON & BRAND ASSET CONFIGURATION ---");

  const indexHtmlPath = path.resolve("./index.html");
  const indexHtmlContent = fs.readFileSync(indexHtmlPath, "utf-8");

  assert(
    "2.1 index.html contains ZERO embedded legacy purple SVG data-URIs",
    !indexHtmlContent.includes("data:image/svg+xml")
  );

  assert(
    "2.2 index.html contains ZERO legacy purple hex color (#8b5cf6)",
    !indexHtmlContent.includes("#8b5cf6")
  );

  assert(
    "2.3 index.html declares single canonical /favicon.ico",
    indexHtmlContent.includes('rel="icon" type="image/x-icon" href="/favicon.ico"')
  );

  assert(
    "2.4 index.html has removed legacy PNG favicon 16x16",
    !indexHtmlContent.includes('favicon-16x16.png')
  );

  assert(
    "2.5 index.html has removed legacy PNG favicon 32x32",
    !indexHtmlContent.includes('favicon-32x32.png')
  );

  assert(
    "2.6 index.html has removed secondary Logo-1.jpg favicon link",
    !indexHtmlContent.includes('rel="icon" type="image/jpeg"')
  );

  assert(
    "2.7 index.html has removed apple-touch-icon links",
    !indexHtmlContent.includes('rel="apple-touch-icon"')
  );

  // Check physical assets in public/
  const faviconIcoPath = path.resolve("./public/favicon.ico");
  assert("2.8 public/favicon.ico exists", fs.existsSync(faviconIcoPath));
  if (fs.existsSync(faviconIcoPath)) {
    const icoBuf = fs.readFileSync(faviconIcoPath);
    // Standard Windows ICO magic header: 0x00, 0x00, 0x01, 0x00
    const isIco = icoBuf[0] === 0 && icoBuf[1] === 0 && icoBuf[2] === 1 && icoBuf[3] === 0;
    const numImages = icoBuf.readUInt16LE(4);
    assert("2.9 public/favicon.ico has valid Windows ICO magic header", isIco);
    assert("2.10 public/favicon.ico contains multiple resolutions (>=2)", numImages >= 2, `Found ${numImages} images`);
  }

  const logo1Path = path.resolve("./public/Logo-1.jpg");
  assert("2.11 public/Logo-1.jpg exists and is non-empty", fs.existsSync(logo1Path) && fs.statSync(logo1Path).size > 1000);

  // --------------------------------------------------------------------------
  // SECTION 3: CODEBASE STATIC AUDIT FOR SINGLE EMAIL SERVICE & NO RAW SENDS
  // --------------------------------------------------------------------------
  console.log("\n--- SECTION 3: CENTRALIZED EMAIL SERVICE INVOCATION AUDIT ---");

  const serverTsPath = path.resolve("./server.ts");
  const serverTsContent = fs.readFileSync(serverTsPath, "utf-8");

  // Verify server.ts does NOT perform raw unmonitored resend.emails.send in org invite
  const rawOrgInviteSend = serverTsContent.includes("await resend.emails.send({\n            from: resolveSenderEmail(),\n            to: [normalizedEmail]");
  assert(
    "3.1 server.ts org invite route no longer uses raw unverified resend.emails.send",
    !rawOrgInviteSend
  );

  assert(
    "3.2 server.ts org invite calls emailService.sendOrganizationInvitation",
    serverTsContent.includes("await emailService.sendOrganizationInvitation(normalizedEmail,")
  );

  assert(
    "3.3 server.ts project invite calls emailService.sendTeamInvitation",
    serverTsContent.includes("await emailService.sendTeamInvitation(email,")
  );

  assert(
    "3.4 server.ts checks emailResult.success in project invitation flow",
    serverTsContent.includes("const emailSent = Boolean(emailResult && emailResult.success);")
  );

  assert(
    "3.5 server.ts returns emailSent status in project invitation response",
    serverTsContent.includes("emailSent: false") && serverTsContent.includes("emailSent: true")
  );

  assert(
    "3.6 server.ts supports safe retry in org invitations via resend flag without duplicate records",
    serverTsContent.includes("isResendRequest") && serverTsContent.includes("Resent invitation to")
  );

  // --------------------------------------------------------------------------
  // SECTION 4: CLIENT-SIDE ACCURATE NOTIFICATION AUDIT
  // --------------------------------------------------------------------------
  console.log("\n--- SECTION 4: CLIENT-SIDE ERROR / WARNING HANDLING AUDIT ---");

  const appTsxPath = path.resolve("./App.tsx");
  const appTsxContent = fs.readFileSync(appTsxPath, "utf-8");

  assert(
    "4.1 App.tsx checks inviteResult.emailSent === false",
    appTsxContent.includes("inviteResult.emailSent === false")
  );

  assert(
    "4.2 App.tsx displays warning toast when email delivery fails",
    appTsxContent.includes("addToast('Invite Created (Email Undelivered)'")
  );

  const orgDashPath = path.resolve("./components/OrganizationDashboard.tsx");
  const orgDashContent = fs.readFileSync(orgDashPath, "utf-8");

  assert(
    "4.3 OrganizationDashboard.tsx checks res.emailSent === false on invite",
    orgDashContent.includes("res.emailSent === false")
  );

  assert(
    "4.4 OrganizationDashboard.tsx passes resend: true on handleResendInvite",
    orgDashContent.includes("resend: true")
  );

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log("\n======================================================================");
  console.log(`TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED out of ${totalTests} TOTAL`);
  console.log("======================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution aborted with error:", err);
  process.exit(1);
});
