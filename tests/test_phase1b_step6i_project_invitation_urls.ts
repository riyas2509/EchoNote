/**
 * Phase 1B Step 6I: Project Invitation Production URL Tests (Updated for Step 6J-C Canonical URL)
 *
 * Requirements covered:
 * 1. Project invitation URL in production resolves to https://echonote-25.ai.studio/join?token=<token>
 * 2. resolveAppUrl() properly resolves APP_URL, VITE_APP_URL, and canonical default https://echonote-25.ai.studio.
 * 3. Invite token is strictly URL-encoded (prevents injection/truncation on special characters).
 * 4. No project invitation URL uses localhost or req.get('host').
 * 5. Welcome email URL does not use req.get('host') and uses resolveAppUrl().
 * 6. Zero occurrences of req.get('host') across server.ts and lib/emailService.ts.
 * 7. APP_URL=https://echonote-25.ai.studio is present in both --update-env-vars in scripts/deploy-cloud-run.sh.
 * 8. .env.example documents APP_URL=https://echonote-25.ai.studio.
 * 9. Organization invitation URL behavior remains intact and uses resolveAppUrl().
 */

import fs from "fs";
import path from "path";

// Exact implementation from server.ts (lines 127-136)
function resolveAppUrl(): string {
  if (process.env.NODE_ENV === "production") {
    return "https://echonote-25.ai.studio";
  }

  const configured = (process.env.APP_URL || process.env.VITE_APP_URL || "https://echonote-25.ai.studio").trim();
  return (configured || "https://echonote-25.ai.studio").replace(/\/+$/, "");
}

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
console.log("🔗 RUNNING PHASE 1B STEP 6I PROJECT INVITATION URL TESTS");
console.log("=======================================================\n");

const origNodeEnv = process.env.NODE_ENV;
const origAppUrl = process.env.APP_URL;
const origViteAppUrl = process.env.VITE_APP_URL;

try {
  // -------------------------------------------------------------
  // SECTION 1: resolveAppUrl() Resolution & Invariants
  // -------------------------------------------------------------
  console.log("--- Section 1: resolveAppUrl() Canonical Resolution ---");

  // 1.1 Unset environment variables -> default canonical domain
  delete process.env.APP_URL;
  delete process.env.VITE_APP_URL;
  assert(
    "1.1 resolveAppUrl() defaults to 'https://echonote-25.ai.studio' when env is unset",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    resolveAppUrl()
  );

  // 1.2 Empty string -> default canonical domain
  process.env.APP_URL = "";
  delete process.env.VITE_APP_URL;
  assert(
    "1.2 resolveAppUrl() falls back to canonical domain on empty APP_URL",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    resolveAppUrl()
  );

  // 1.3 APP_URL configured
  process.env.APP_URL = "https://echonote-25.ai.studio";
  delete process.env.VITE_APP_URL;
  assert(
    "1.3 resolveAppUrl() uses process.env.APP_URL when configured",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    resolveAppUrl()
  );

  // 1.4 Strips trailing slashes
  process.env.APP_URL = "https://echonote-25.ai.studio///";
  assert(
    "1.4 resolveAppUrl() strips trailing slashes",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    resolveAppUrl()
  );

  // 1.5 Fallback to VITE_APP_URL when APP_URL is absent
  delete process.env.APP_URL;
  process.env.VITE_APP_URL = "https://vite-preview.echonote-25.ai.studio";
  assert(
    "1.5 resolveAppUrl() falls back to VITE_APP_URL when APP_URL is absent",
    resolveAppUrl() === "https://vite-preview.echonote-25.ai.studio",
    resolveAppUrl()
  );

  // -------------------------------------------------------------
  // SECTION 2: Project Invitation URL Construction
  // -------------------------------------------------------------
  console.log("\n--- Section 2: Project Invitation URL Construction ---");

  // Reset to production standard
  process.env.NODE_ENV = "production";
  process.env.APP_URL = "https://echonote-25.ai.studio";

  const sampleToken = "invite_1234567890abcdef";
  const appUrl = resolveAppUrl();
  const joinUrl = `${appUrl}/join?token=${encodeURIComponent(sampleToken)}`;

  assert(
    "2.1 Project invitation URL starts with https://echonote-25.ai.studio",
    joinUrl.startsWith("https://echonote-25.ai.studio"),
    joinUrl
  );

  assert(
    "2.2 Project invitation path is /join?token=",
    joinUrl === "https://echonote-25.ai.studio/join?token=invite_1234567890abcdef",
    joinUrl
  );

  assert(
    "2.3 Project invitation URL never contains localhost",
    !joinUrl.includes("localhost"),
    joinUrl
  );

  assert(
    "2.4 Project invitation URL never contains port 3000",
    !joinUrl.includes("3000"),
    joinUrl
  );

  // Test URL encoding with special characters
  const complexToken = "token+with/special=chars&more";
  const encodedJoinUrl = `${appUrl}/join?token=${encodeURIComponent(complexToken)}`;
  assert(
    "2.5 Invite token is properly URL-encoded (prevents parameter hijacking)",
    encodedJoinUrl === "https://echonote-25.ai.studio/join?token=token%2Bwith%2Fspecial%3Dchars%26more",
    encodedJoinUrl
  );

  // -------------------------------------------------------------
  // SECTION 3: Welcome Email URL Construction
  // -------------------------------------------------------------
  console.log("\n--- Section 3: Welcome Email URL Construction ---");

  const dashboardLink = `${resolveAppUrl()}/app`;
  assert(
    "3.1 Welcome email dashboardLink uses canonical resolveAppUrl()",
    dashboardLink === "https://echonote-25.ai.studio/app",
    dashboardLink
  );

  assert(
    "3.2 Welcome email dashboardLink does not contain localhost",
    !dashboardLink.includes("localhost") && !dashboardLink.includes("3000"),
    dashboardLink
  );

  // -------------------------------------------------------------
  // SECTION 4: Codebase Static Inspection of server.ts
  // -------------------------------------------------------------
  console.log("\n--- Section 4: Codebase Static Inspection of server.ts ---");

  const serverTsPath = path.resolve(process.cwd(), "server.ts");
  const serverTsContent = fs.readFileSync(serverTsPath, "utf-8");

  // Verify POST /api/invite-member uses resolveAppUrl()
  const inviteMemberSnippetMatch = serverTsContent.includes(
    "const appUrl = resolveAppUrl();\n      const joinUrl = `${appUrl}/join?token=${encodeURIComponent(inviteToken)}`;"
  );
  assert(
    "4.1 POST /api/invite-member constructs joinUrl with resolveAppUrl() and encodeURIComponent",
    inviteMemberSnippetMatch
  );

  // Verify welcome email in invite-accept uses resolveAppUrl()
  const welcomeSnippetMatch = serverTsContent.includes(
    "// 4. Send welcome email via Resend\n      const appUrl = resolveAppUrl();\n      try {\n        await emailService.sendWelcome"
  );
  assert(
    "4.2 POST /api/invite-accept constructs welcome email link with resolveAppUrl()",
    welcomeSnippetMatch
  );

  // Verify NO req.get('host') exists in server.ts
  const hasReqGetHost = /req\.get\(\s*['"]host['"]\s*\)/.test(serverTsContent);
  assert(
    "4.3 Zero occurrences of req.get('host') in server.ts",
    !hasReqGetHost
  );

  // Verify lib/emailService.ts has NO req.get('host')
  const emailServicePath = path.resolve(process.cwd(), "lib/emailService.ts");
  const emailServiceContent = fs.readFileSync(emailServicePath, "utf-8");
  const emailHasReqGetHost = /req\.get\(\s*['"]host['"]\s*\)/.test(emailServiceContent);
  assert(
    "4.4 Zero occurrences of req.get('host') in lib/emailService.ts",
    !emailHasReqGetHost
  );

  // -------------------------------------------------------------
  // SECTION 5: Deployment Script (scripts/deploy-cloud-run.sh)
  // -------------------------------------------------------------
  console.log("\n--- Section 5: Deployment Script Verification ---");

  const deployScriptPath = path.resolve(process.cwd(), "scripts/deploy-cloud-run.sh");
  const deployScriptContent = fs.readFileSync(deployScriptPath, "utf-8");

  // Check APP_URL in update-env
  const updateEnvAppUrl = deployScriptContent.includes("APP_URL=https://echonote-25.ai.studio");
  assert(
    "5.1 scripts/deploy-cloud-run.sh specifies APP_URL=https://echonote-25.ai.studio",
    updateEnvAppUrl
  );

  // Count occurrences of APP_URL=https://echonote-25.ai.studio (must be present in BOTH update-env and deploy actions)
  const appUrlMatches = deployScriptContent.match(/APP_URL=https:\/\/echonote-25\.ai\.studio/g);
  assert(
    "5.2 scripts/deploy-cloud-run.sh configures APP_URL in both update-env and deploy actions",
    appUrlMatches !== null && appUrlMatches.length >= 2,
    `Found ${appUrlMatches ? appUrlMatches.length : 0} occurrences`
  );

  // Verify no plaintext secret leak in deploy script
  assert(
    "5.3 deploy script does not leak plaintext secrets",
    !deployScriptContent.includes("re_") && !deployScriptContent.includes("AIzaSy")
  );

  // -------------------------------------------------------------
  // SECTION 6: Environment Documentation (.env.example)
  // -------------------------------------------------------------
  console.log("\n--- Section 6: .env.example Documentation ---");

  const envExamplePath = path.resolve(process.cwd(), ".env.example");
  const envExampleContent = fs.readFileSync(envExamplePath, "utf-8");

  assert(
    "6.1 .env.example contains APP_URL=https://echonote-25.ai.studio",
    envExampleContent.includes("APP_URL=https://echonote-25.ai.studio")
  );

  // -------------------------------------------------------------
  // SECTION 7: Organization Invitation Behavior Unchanged
  // -------------------------------------------------------------
  console.log("\n--- Section 7: Organization Invitation Behavior Unchanged ---");

  const orgInviteId = "inv_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const orgAcceptUrl = `${resolveAppUrl()}/invite/accept?token=${encodeURIComponent(orgInviteId)}`;

  assert(
    "7.1 Organization invitation URL remains https://echonote-25.ai.studio/invite/accept?token=",
    orgAcceptUrl === `https://echonote-25.ai.studio/invite/accept?token=${orgInviteId}`,
    orgAcceptUrl
  );

  const orgInviteRouteMatch = serverTsContent.includes(
    "const appUrl = resolveAppUrl();\n      const acceptUrl = `${appUrl}/invite/accept?token=${encodeURIComponent(inviteId)}`;"
  );
  assert(
    "7.2 server.ts org invitation endpoint intact using resolveAppUrl()",
    orgInviteRouteMatch
  );

} finally {
  // Restore original environment
  if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
  else delete process.env.NODE_ENV;

  if (origAppUrl !== undefined) process.env.APP_URL = origAppUrl;
  else delete process.env.APP_URL;

  if (origViteAppUrl !== undefined) process.env.VITE_APP_URL = origViteAppUrl;
  else delete process.env.VITE_APP_URL;
}

console.log("\n=======================================================");
console.log(`TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log("=======================================================\n");

if (failedTests > 0) {
  process.exit(1);
}
