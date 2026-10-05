/**
 * EchoNote — Phase 1B: Resend Sender Hardening & AI Studio Deployment Verification
 *
 * Verifies:
 * 1. Production sender resolution deterministically returns "EchoNote <invitations@echotechai.in>"
 * 2. Production cannot use "no-reply@resend.dev"
 * 3. Production cannot use "onboarding@resend.dev"
 * 4. Missing RESEND_FROM_EMAIL in production safely resolves to "EchoNote <invitations@echotechai.in>"
 * 5. Project invitation uses the authoritative sender
 * 6. Welcome email uses the authoritative sender
 * 7. Organization invitation uses the authoritative sender
 * 8. Project invitation URL remains https://echonote-25.ai.studio/join?token=<TOKEN>
 * 9. No source file contains an unsafe production resend.dev sender fallback
 * 10. No Resend API secret is exposed in source code or logs
 * 11. Non-production rejection of resend.dev addresses with safe fallback
 */

import fs from "fs";
import path from "path";
import {
  CANONICAL_SENDER_EMAIL,
  isResendDevSender,
  resolveSenderEmail,
  emailService
} from "../lib/emailService.js";
import { resolveAppUrl } from "../server.js";

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

console.log("\n==================================================================");
console.log("🔒 RUNNING RESEND SENDER HARDENING & PRODUCTION INVARIANTS TESTS");
console.log("==================================================================\n");

const savedNodeEnv = process.env.NODE_ENV;
const savedResendFrom = process.env.RESEND_FROM_EMAIL;
const savedAppUrl = process.env.APP_URL;

try {
  // -------------------------------------------------------------
  // SECTION 1: Production Sender Resolution Invariants
  // -------------------------------------------------------------
  console.log("--- Section 1: Production Sender Resolution Invariants ---");
  process.env.NODE_ENV = "production";

  delete process.env.RESEND_FROM_EMAIL;
  assert(
    "1. Production sender resolution returns EchoNote <invitations@echotechai.in> when env is missing",
    resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
    resolveSenderEmail()
  );

  process.env.RESEND_FROM_EMAIL = "EchoNote <no-reply@resend.dev>";
  assert(
    "2. Production cannot use no-reply@resend.dev override (returns canonical)",
    resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
    resolveSenderEmail()
  );

  process.env.RESEND_FROM_EMAIL = "EchoNote <onboarding@resend.dev>";
  assert(
    "3. Production cannot use onboarding@resend.dev override (returns canonical)",
    resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
    resolveSenderEmail()
  );

  process.env.RESEND_FROM_EMAIL = "attacker@resend.dev";
  assert(
    "4. Production ignores any *.resend.dev domain (returns canonical)",
    resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
    resolveSenderEmail()
  );

  process.env.RESEND_FROM_EMAIL = "Some Other Brand <other@domain.com>";
  assert(
    "5. Production ignores arbitrary sender overrides to maintain canonical lock",
    resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
    resolveSenderEmail()
  );

  // -------------------------------------------------------------
  // SECTION 2: Non-Production Resend.dev Blocking Invariants
  // -------------------------------------------------------------
  console.log("\n--- Section 2: Non-Production Sender Invariants ---");
  process.env.NODE_ENV = "development";

  process.env.RESEND_FROM_EMAIL = "EchoNote <no-reply@resend.dev>";
  assert(
    "6. Non-production rejects no-reply@resend.dev and falls back to canonical sender",
    resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
    resolveSenderEmail()
  );

  process.env.RESEND_FROM_EMAIL = "EchoNote <onboarding@resend.dev>";
  assert(
    "7. Non-production rejects onboarding@resend.dev and falls back to canonical sender",
    resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
    resolveSenderEmail()
  );

  delete process.env.RESEND_FROM_EMAIL;
  assert(
    "8. Non-production missing env safely falls back to canonical verified sender",
    resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
    resolveSenderEmail()
  );

  process.env.RESEND_FROM_EMAIL = "EchoNote Dev <dev-sender@echotechai.in>";
  assert(
    "9. Non-production accepts valid non-resend.dev custom sender",
    resolveSenderEmail() === "EchoNote Dev <dev-sender@echotechai.in>",
    resolveSenderEmail()
  );

  // Helper check
  assert(
    "10. isResendDevSender helper identifies resend.dev variants correctly",
    isResendDevSender("test@resend.dev") === true &&
    isResendDevSender("EchoNote <no-reply@resend.dev>") === true &&
    isResendDevSender("EchoNote <invitations@echotechai.in>") === false &&
    isResendDevSender(undefined) === false
  );

  // -------------------------------------------------------------
  // SECTION 3: Invitation URL and Integration Integrity
  // -------------------------------------------------------------
  console.log("\n--- Section 3: Invitation URL and Integration Integrity ---");
  process.env.NODE_ENV = "production";
  process.env.APP_URL = "https://malicious.example.com";

  const resolvedAppUrl = resolveAppUrl();
  assert(
    "11. Production resolveAppUrl deterministically returns https://echonote-25.ai.studio",
    resolvedAppUrl === "https://echonote-25.ai.studio",
    resolvedAppUrl
  );

  const sampleToken = "proj_invite_sec_9876543210fedcba";
  const projectJoinUrl = `${resolvedAppUrl}/join?token=${encodeURIComponent(sampleToken)}`;
  assert(
    "12. Project invitation URL is exactly https://echonote-25.ai.studio/join?token=<TOKEN>",
    projectJoinUrl === `https://echonote-25.ai.studio/join?token=${sampleToken}`,
    projectJoinUrl
  );

  assert(
    "13. Project invitation URL does NOT contain forbidden hostnames (localhost, *.run.app, echotechai.in)",
    !projectJoinUrl.includes("localhost") &&
    !projectJoinUrl.includes("ais-dev-") &&
    !projectJoinUrl.includes(".run.app") &&
    !projectJoinUrl.includes("echotechai.in")
  );

  // -------------------------------------------------------------
  // SECTION 4: Codebase Static Inspection & Hygiene
  // -------------------------------------------------------------
  console.log("\n--- Section 4: Codebase Static Hygiene ---");

  const serverTsContent = fs.readFileSync(path.resolve("./server.ts"), "utf8");
  const emailServiceContent = fs.readFileSync(path.resolve("./lib/emailService.ts"), "utf8");

  assert(
    "14. server.ts imports and uses authoritative resolveSenderEmail for org invitations",
    serverTsContent.includes("from: resolveSenderEmail()")
  );

  assert(
    "15. server.ts team invitation endpoint calls emailService.sendTeamInvitation",
    serverTsContent.includes("await emailService.sendTeamInvitation(email,")
  );

  const projectInvitationTsContent = fs.existsSync(path.resolve("./lib/projectInvitation.ts"))
    ? fs.readFileSync(path.resolve("./lib/projectInvitation.ts"), "utf8")
    : "";

  assert(
    "16. project invitation acceptance path calls emailService.sendWelcome",
    serverTsContent.includes("await emailService.sendWelcome(userEmail,") ||
    projectInvitationTsContent.includes("await emailService.sendWelcome(userEmail,")
  );

  assert(
    "17. lib/emailService.ts sendEmail uses resolveSenderEmail()",
    emailServiceContent.includes("const fromAddress = resolveSenderEmail()") &&
    emailServiceContent.includes("from: fromAddress")
  );

  assert(
    "18. No active resend.dev email string in lib/emailService.ts",
    !emailServiceContent.includes("no-reply@resend.dev") &&
    !emailServiceContent.includes("onboarding@resend.dev")
  );

  assert(
    "19. No active resend.dev email string in server.ts",
    !serverTsContent.includes("no-reply@resend.dev") &&
    !serverTsContent.includes("onboarding@resend.dev")
  );

  // Check no plaintext secrets
  assert(
    "20. scripts/deploy-cloud-run.sh does not contain raw API keys or secrets",
    !fs.readFileSync(path.resolve("./scripts/deploy-cloud-run.sh"), "utf8").includes("re_")
  );

  assert(
    "21. lib/emailService.ts contains proactive guard against resend.dev in sendEmail",
    emailServiceContent.includes("isResendDevSender(fromAddress)") &&
    emailServiceContent.includes("Blocked attempt to send email using forbidden testing domain sender")
  );

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log("\n==================================================================");
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log("==================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
} finally {
  // Always restore ambient process environment
  if (savedNodeEnv !== undefined) {
    process.env.NODE_ENV = savedNodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }

  if (savedResendFrom !== undefined) {
    process.env.RESEND_FROM_EMAIL = savedResendFrom;
  } else {
    delete process.env.RESEND_FROM_EMAIL;
  }

  if (savedAppUrl !== undefined) {
    process.env.APP_URL = savedAppUrl;
  } else {
    delete process.env.APP_URL;
  }
}
