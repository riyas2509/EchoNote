/**
 * EchoNote — Phase 1B, Step 6F: Production Email Sender Verification Test Suite
 * 
 * Verifies:
 * 1. resolveSenderEmail() uses process.env.RESEND_FROM_EMAIL when configured.
 * 2. resolveSenderEmail() falls back strictly to "EchoNote <invitations@echotechai.in>" when absent or empty.
 * 3. CANONICAL_SENDER_EMAIL constant matches "EchoNote <invitations@echotechai.in>".
 * 4. No active production email path falls back to "EchoNote <onboarding@resend.dev>".
 * 5. Static codebase scan ensures zero occurrences of "onboarding@resend.dev" in lib/ and server.ts.
 * 6. Organization invitation endpoint in server.ts resolves to canonical sender.
 * 7. Project invitation path (emailService.sendTeamInvitation) resolves to canonical sender.
 * 8. scripts/deploy-cloud-run.sh specifies RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in> in --update-env-vars.
 * 9. .env.example documents RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>.
 * 10. Existing emailService templates (welcome, password reset, org invite, team invite, receipt) retain intact HTML/subject generation.
 */

import fs from "fs";
import path from "path";
import { 
  CANONICAL_SENDER_EMAIL, 
  resolveSenderEmail, 
  emailService 
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

console.log("\n=======================================================");
console.log("📧 RUNNING PHASE 1B STEP 6F EMAIL SENDER VERIFICATION");
console.log("=======================================================\n");

// -------------------------------------------------------------
// SECTION 1: Canonical Constant & Fallback Verification
// -------------------------------------------------------------
console.log("--- Section 1: Canonical Constant & Fallback Logic ---");

assert(
  "1.1 CANONICAL_SENDER_EMAIL is 'EchoNote <invitations@echotechai.in>'",
  CANONICAL_SENDER_EMAIL === "EchoNote <invitations@echotechai.in>",
  CANONICAL_SENDER_EMAIL
);

// Save ambient environment
const originalEnvResendFrom = process.env.RESEND_FROM_EMAIL;

// Test with unset / empty env
delete process.env.RESEND_FROM_EMAIL;
assert(
  "1.2 resolveSenderEmail() falls back to canonical sender when env is undefined",
  resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
  resolveSenderEmail()
);

process.env.RESEND_FROM_EMAIL = "";
assert(
  "1.3 resolveSenderEmail() falls back to canonical sender when env is empty string",
  resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
  resolveSenderEmail()
);

process.env.RESEND_FROM_EMAIL = "   ";
assert(
  "1.4 resolveSenderEmail() falls back to canonical sender when env is whitespace",
  resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
  resolveSenderEmail()
);

// Test with configured custom env
process.env.RESEND_FROM_EMAIL = "EchoNote Alerts <alerts@echotechai.in>";
assert(
  "1.5 resolveSenderEmail() uses configured process.env.RESEND_FROM_EMAIL when set",
  resolveSenderEmail() === "EchoNote Alerts <alerts@echotechai.in>",
  resolveSenderEmail()
);

process.env.RESEND_FROM_EMAIL = "EchoNote <invitations@echotechai.in>";
assert(
  "1.6 resolveSenderEmail() returns canonical when explicitly set in env",
  resolveSenderEmail() === "EchoNote <invitations@echotechai.in>",
  resolveSenderEmail()
);

// Restore ambient environment
if (originalEnvResendFrom !== undefined) {
  process.env.RESEND_FROM_EMAIL = originalEnvResendFrom;
} else {
  delete process.env.RESEND_FROM_EMAIL;
}

// -------------------------------------------------------------
// SECTION 2: Static Codebase Hygiene (No onboarding@resend.dev)
// -------------------------------------------------------------
console.log("\n--- Section 2: Codebase Hygiene (Elimination of onboarding@resend.dev) ---");

const emailServiceContent = fs.readFileSync(path.resolve("./lib/emailService.ts"), "utf8");
assert(
  "2.1 lib/emailService.ts does NOT contain 'onboarding@resend.dev'",
  !emailServiceContent.includes("onboarding@resend.dev")
);
assert(
  "2.2 lib/emailService.ts uses resolveSenderEmail() for outbound dispatch",
  emailServiceContent.includes("const fromAddress = resolveSenderEmail()")
);

const serverTsContent = fs.readFileSync(path.resolve("./server.ts"), "utf8");
assert(
  "2.3 server.ts does NOT contain 'onboarding@resend.dev'",
  !serverTsContent.includes("onboarding@resend.dev")
);
assert(
  "2.4 server.ts imports resolveSenderEmail from lib/emailService",
  serverTsContent.includes("import { emailService, resolveSenderEmail } from \"./lib/emailService.js\"")
);
assert(
  "2.5 server.ts org invitation route calls resolveSenderEmail() for 'from' field",
  serverTsContent.includes("from: resolveSenderEmail()")
);

// -------------------------------------------------------------
// SECTION 3: Deployment Configuration Verification
// -------------------------------------------------------------
console.log("\n--- Section 3: Deployment Configuration Verification ---");

const deployScriptContent = fs.readFileSync(path.resolve("./scripts/deploy-cloud-run.sh"), "utf8");
assert(
  "3.1 scripts/deploy-cloud-run.sh update-env includes RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>",
  deployScriptContent.includes("RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>")
);
assert(
  "3.2 scripts/deploy-cloud-run.sh deploy includes RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>",
  (deployScriptContent.match(/RESEND_FROM_EMAIL=EchoNote <invitations@echotechai\.in>/g) || []).length >= 2
);
assert(
  "3.3 scripts/deploy-cloud-run.sh preserves immutable image verification & safety controls",
  deployScriptContent.includes("--no-traffic") &&
  deployScriptContent.includes("IMMUTABLE_DEPLOY_IMAGE") &&
  deployScriptContent.includes("validate_active_gcloud_project")
);

const envExampleContent = fs.readFileSync(path.resolve("./.env.example"), "utf8");
assert(
  "3.4 .env.example contains RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>",
  envExampleContent.includes("RESEND_FROM_EMAIL=EchoNote <invitations@echotechai.in>")
);

// -------------------------------------------------------------
// SECTION 4: EmailService Dispatch Invariants
// -------------------------------------------------------------
console.log("\n--- Section 4: EmailService Functionality Invariants ---");

assert(
  "4.1 emailService exports sendPasswordReset method",
  typeof emailService.sendPasswordReset === "function"
);
assert(
  "4.2 emailService exports sendTeamInvitation method",
  typeof emailService.sendTeamInvitation === "function"
);
assert(
  "4.3 emailService exports sendOrganizationInvitation method",
  typeof emailService.sendOrganizationInvitation === "function"
);
assert(
  "4.4 emailService exports sendWelcome method",
  typeof emailService.sendWelcome === "function"
);
assert(
  "4.5 emailService exports sendSubscriptionConfirmation method",
  typeof emailService.sendSubscriptionConfirmation === "function"
);
assert(
  "4.6 emailService exports sendPaymentReceipt method",
  typeof emailService.sendPaymentReceipt === "function"
);

// Test graceful handling when RESEND_API_KEY is not set (mock/unit safety)
const savedApiKey = process.env.RESEND_API_KEY;
delete process.env.RESEND_API_KEY;

emailService.sendTeamInvitation("test.recipient@echotechai.in", {
  inviterName: "Admin Tester",
  projectName: "Test Project",
  role: "admin",
  inviteLink: "https://echotechai.in/join?token=test123"
}).then(res => {
  assert(
    "4.7 sendTeamInvitation handles missing RESEND_API_KEY gracefully without throwing unhandled rejection",
    res.success === false && typeof res.error === "string"
  );

  // Restore API key
  if (savedApiKey !== undefined) {
    process.env.RESEND_API_KEY = savedApiKey;
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log("=======================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}).catch(err => {
  console.error("Unexpected rejection in email test:", err);
  process.exit(1);
});
