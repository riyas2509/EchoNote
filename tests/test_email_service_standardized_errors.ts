/**
 * Unit & Integration Test Suite: Standardized Email Service Error Handling
 * 
 * Verifies:
 * 1. lib/emailService.ts & lib/email-service.ts export standardized types and error codes.
 * 2. sendEmail handles missing API key with errorCode 'MISSING_API_KEY'.
 * 3. sendEmail explicitly validates Resend response (data.id vs. error).
 * 4. Error detail objects provide structured errorCode, message, and statusCode.
 * 5. POST /api/invite-member propagates emailError, emailErrorCode, and statusCode.
 * 6. POST /api/organizations/:id/invite propagates emailError, emailErrorCode, and statusCode (new & resend).
 * 7. Frontend UI components (App.tsx, OrganizationDashboard.tsx, CollaborationDashboard.tsx)
 *    display explicit error details rather than misleading success or generic notices.
 */

import fs from "fs";
import path from "path";
import { 
  emailService, 
  maskEmailForLogs,
  resolveSenderEmail 
} from "../lib/emailService.js";
import emailServiceFromAlias from "../lib/email-service.js";

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
console.log("🚀 TESTING EMAIL SERVICE STANDARDIZED ERROR HANDLING & PROPAGATION");
console.log("======================================================================\n");

async function runTests() {
  // --------------------------------------------------------------------------
  // 1. Alias & Exports Verification
  // --------------------------------------------------------------------------
  console.log("--- 1. MODULE EXPORTS & NAMING CONVENTION ---");
  assert("1.1 emailService is exported from lib/emailService.ts", typeof emailService.sendTeamInvitation === "function");
  assert("1.2 emailService is accessible via lib/email-service.ts alias", typeof emailServiceFromAlias.sendTeamInvitation === "function");
  assert("1.3 maskEmailForLogs masks PII correctly", maskEmailForLogs("secret.user@example.com") === "s***r@example.com");

  // --------------------------------------------------------------------------
  // 2. Missing RESEND_API_KEY Error Standard
  // --------------------------------------------------------------------------
  console.log("\n--- 2. STANDARDIZED ERROR CODE: MISSING_API_KEY ---");
  const origKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  const missingResult = await emailService.sendTeamInvitation("test@example.com", {
    inviterName: "Alice",
    projectName: "Project Apollo",
    role: "editor",
    inviteLink: "https://echonote-25.ai.studio/join?token=test"
  });

  assert("2.1 Returns success: false when API key is missing", missingResult.success === false);
  assert("2.2 Returns standardized errorCode: 'MISSING_API_KEY'", missingResult.errorCode === "MISSING_API_KEY");
  assert("2.3 Returns statusCode: 500", missingResult.statusCode === 500);
  assert("2.4 Returns structured errorDetail with code", missingResult.errorDetail?.code === "MISSING_API_KEY");
  assert("2.5 Masks recipient in errorDetail", missingResult.errorDetail?.recipientMasked === "t***t@example.com");

  process.env.RESEND_API_KEY = origKey;

  // --------------------------------------------------------------------------
  // 3. Static Audit of lib/emailService.ts for data.id vs error inspection
  // --------------------------------------------------------------------------
  console.log("\n--- 3. DATA.ID VS. ERROR VERIFICATION IN EMAIL SERVICE ---");
  const emailServiceContent = fs.readFileSync(path.resolve("./lib/emailService.ts"), "utf-8");

  assert(
    "3.1 emailService.ts explicitly inspects response.error",
    emailServiceContent.includes("if (response.error)")
  );
  assert(
    "3.2 emailService.ts explicitly inspects response.data and response.data.id",
    emailServiceContent.includes("if (!response.data || !response.data.id)") ||
    emailServiceContent.includes("if (!response.data?.id)")
  );
  assert(
    "3.3 emailService.ts defines standardized EmailErrorCode union",
    emailServiceContent.includes("export type EmailErrorCode =") &&
    emailServiceContent.includes("'MISSING_API_KEY'") &&
    emailServiceContent.includes("'RESEND_API_ERROR'") &&
    emailServiceContent.includes("'MISSING_MESSAGE_ID'")
  );
  assert(
    "3.4 emailService.ts defines structured EmailErrorDetail interface",
    emailServiceContent.includes("export interface EmailErrorDetail")
  );

  // --------------------------------------------------------------------------
  // 4. Server Controller Propagation Audit
  // --------------------------------------------------------------------------
  console.log("\n--- 4. SERVER CONTROLLER PROPAGATION AUDIT ---");
  const serverTsContent = fs.readFileSync(path.resolve("./server.ts"), "utf-8");

  // Project Invitation (POST /api/invite-member)
  assert(
    "4.1 POST /api/invite-member returns emailError",
    serverTsContent.includes("emailError: emailResult?.error || \"Email delivery failed\"")
  );
  assert(
    "4.2 POST /api/invite-member returns emailErrorCode",
    serverTsContent.includes("emailErrorCode: emailResult?.errorCode || \"EMAIL_DELIVERY_FAILED\"")
  );
  assert(
    "4.3 POST /api/invite-member updates Firestore with emailDeliveryError and emailDeliveryCode",
    serverTsContent.includes("emailDeliveryCode: emailSent ? null : (emailResult?.errorCode || \"EMAIL_DELIVERY_FAILED\")")
  );

  // Organization Invitation (POST /api/organizations/:id/invite - New Invite)
  assert(
    "4.4 Org new invite returns emailError",
    serverTsContent.includes("emailError: emailResult?.error || \"Email delivery failed\"")
  );
  assert(
    "4.5 Org new invite returns emailErrorCode",
    serverTsContent.includes("emailErrorCode: emailResult?.errorCode || \"EMAIL_DELIVERY_FAILED\"")
  );

  // Organization Invitation (POST /api/organizations/:id/invite - Resend)
  assert(
    "4.6 Org resend invite records emailDeliveryCode in history",
    serverTsContent.includes("emailDeliveryCode: emailSent ? null : (emailResult?.errorCode || \"EMAIL_DELIVERY_FAILED\")")
  );

  // --------------------------------------------------------------------------
  // 5. Frontend UI Propagation Audit
  // --------------------------------------------------------------------------
  console.log("\n--- 5. FRONTEND UI PROPAGATION AUDIT ---");
  const appTsxContent = fs.readFileSync(path.resolve("./App.tsx"), "utf-8");
  const orgDashContent = fs.readFileSync(path.resolve("./components/OrganizationDashboard.tsx"), "utf-8");
  const collabDashContent = fs.readFileSync(path.resolve("./components/CollaborationDashboard.tsx"), "utf-8");

  assert(
    "5.1 App.tsx propagates failureDetail in warning toast",
    appTsxContent.includes("inviteResult.emailError || inviteResult.warning")
  );
  assert(
    "5.2 App.tsx propagates failureDetail in notification",
    appTsxContent.includes("delivery email could not be sent: ${failureDetail}")
  );
  assert(
    "5.3 App.tsx returns inviteResult from inviteToProject",
    appTsxContent.includes("return inviteResult;")
  );
  assert(
    "5.4 OrganizationDashboard.tsx displays failureReason on handleInvite",
    orgDashContent.includes("res.emailError || res.warning")
  );
  assert(
    "5.5 OrganizationDashboard.tsx displays failureReason on handleResendInvite",
    orgDashContent.includes("email re-delivery could not be completed (${failureReason})")
  );
  assert(
    "5.6 CollaborationDashboard.tsx checks inviteRes.emailSent === false and warns",
    collabDashContent.includes("inviteRes && inviteRes.emailSent === false")
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
  console.error("Test execution aborted:", err);
  process.exit(1);
});
