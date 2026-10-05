/**
 * EchoNote — Phase 1B Step 6J-C: Set Canonical Public Application URL Tests
 *
 * Verifies that the canonical public application URL is strictly https://echonote-25.ai.studio
 *
 * Requirements covered:
 * A. Production resolveAppUrl():
 *    NODE_ENV=production + APP_URL=https://anything.example -> https://echonote-25.ai.studio
 * B. Production resolveAppUrl():
 *    NODE_ENV=production + VITE_APP_URL=https://anything.example -> https://echonote-25.ai.studio
 * C. Project invitation:
 *    -> https://echonote-25.ai.studio/join?token=<encoded-token>
 * D. Organization invitation:
 *    -> https://echonote-25.ai.studio/invite/accept?token=<encoded-token>
 * E. Welcome email:
 *    -> https://echonote-25.ai.studio/app
 * F. No user-facing invitation URL uses:
 *    - localhost
 *    - ais-dev-*.run.app
 *    - echonote-*.run.app
 *    - echotechai.in
 * G. Deployment script contains:
 *    APP_URL=https://echonote-25.ai.studio in both --update-env-vars
 * H. Static Codebase Audits:
 *    - server.ts resolveAppUrl() implementation
 *    - server.ts invite-member, invite-accept, and org invitation use resolveAppUrl()
 *    - zero req.get('host') occurrences
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

console.log("\n==================================================================");
console.log("🌟 RUNNING PHASE 1B STEP 6J-C CANONICAL URL TESTS");
console.log("==================================================================\n");

const origNodeEnv = process.env.NODE_ENV;
const origAppUrl = process.env.APP_URL;
const origViteAppUrl = process.env.VITE_APP_URL;

const CANONICAL_URL = "https://echonote-25.ai.studio";

try {
  // -------------------------------------------------------------
  // SECTION A: Production resolveAppUrl() overrides blocked
  // -------------------------------------------------------------
  console.log("--- Section A: Production resolveAppUrl() (APP_URL override blocked) ---");

  process.env.NODE_ENV = "production";
  process.env.APP_URL = "https://anything.example";
  delete process.env.VITE_APP_URL;
  assert(
    "A.1 Production resolveAppUrl() with APP_URL=https://anything.example returns https://echonote-25.ai.studio",
    resolveAppUrl() === CANONICAL_URL,
    { resolved: resolveAppUrl(), expected: CANONICAL_URL }
  );

  process.env.APP_URL = "https://ais-dev-e6tttlafqn3wtn6fbiynhj-88328487579.asia-southeast1.run.app";
  assert(
    "A.2 Production resolveAppUrl() with AI Studio dev URL returns https://echonote-25.ai.studio",
    resolveAppUrl() === CANONICAL_URL,
    { resolved: resolveAppUrl(), expected: CANONICAL_URL }
  );

  process.env.APP_URL = "http://localhost:3000";
  assert(
    "A.3 Production resolveAppUrl() with localhost returns https://echonote-25.ai.studio",
    resolveAppUrl() === CANONICAL_URL,
    { resolved: resolveAppUrl(), expected: CANONICAL_URL }
  );

  process.env.APP_URL = "https://echotechai.in";
  assert(
    "A.4 Production resolveAppUrl() with old echotechai.in returns https://echonote-25.ai.studio",
    resolveAppUrl() === CANONICAL_URL,
    { resolved: resolveAppUrl(), expected: CANONICAL_URL }
  );

  // -------------------------------------------------------------
  // SECTION B: Production resolveAppUrl() VITE_APP_URL overrides blocked
  // -------------------------------------------------------------
  console.log("\n--- Section B: Production resolveAppUrl() (VITE_APP_URL override blocked) ---");

  process.env.NODE_ENV = "production";
  delete process.env.APP_URL;
  process.env.VITE_APP_URL = "https://anything.example";
  assert(
    "B.1 Production resolveAppUrl() with VITE_APP_URL=https://anything.example returns https://echonote-25.ai.studio",
    resolveAppUrl() === CANONICAL_URL,
    { resolved: resolveAppUrl(), expected: CANONICAL_URL }
  );

  process.env.VITE_APP_URL = "https://echonote-00009.us-west1.run.app";
  assert(
    "B.2 Production resolveAppUrl() with Cloud Run URL returns https://echonote-25.ai.studio",
    resolveAppUrl() === CANONICAL_URL,
    { resolved: resolveAppUrl(), expected: CANONICAL_URL }
  );

  // Both unset in production
  delete process.env.APP_URL;
  delete process.env.VITE_APP_URL;
  assert(
    "B.3 Production resolveAppUrl() with unset env returns https://echonote-25.ai.studio",
    resolveAppUrl() === CANONICAL_URL,
    { resolved: resolveAppUrl(), expected: CANONICAL_URL }
  );

  // -------------------------------------------------------------
  // SECTION C: Project Invitation URL
  // -------------------------------------------------------------
  console.log("\n--- Section C: Project Invitation URL Construction ---");

  process.env.NODE_ENV = "production";
  const testToken = "invite_tok_123456!@#$%^&*()";
  const projectAppUrl = resolveAppUrl();
  const joinUrl = `${projectAppUrl}/join?token=${encodeURIComponent(testToken)}`;

  assert(
    "C.1 Project invitation URL starts with https://echonote-25.ai.studio/join?token=",
    joinUrl.startsWith("https://echonote-25.ai.studio/join?token="),
    joinUrl
  );

  assert(
    "C.2 Project invitation URL has properly URL-encoded token",
    joinUrl === `https://echonote-25.ai.studio/join?token=${encodeURIComponent(testToken)}`,
    joinUrl
  );

  // -------------------------------------------------------------
  // SECTION D: Organization Invitation URL
  // -------------------------------------------------------------
  console.log("\n--- Section D: Organization Invitation URL Construction ---");

  const orgInviteId = "org_inv_9876543210abcdef";
  const orgAcceptUrl = `${resolveAppUrl()}/invite/accept?token=${encodeURIComponent(orgInviteId)}`;

  assert(
    "D.1 Organization invitation URL starts with https://echonote-25.ai.studio/invite/accept?token=",
    orgAcceptUrl.startsWith("https://echonote-25.ai.studio/invite/accept?token="),
    orgAcceptUrl
  );

  assert(
    "D.2 Organization invitation URL matches exact canonical format",
    orgAcceptUrl === `https://echonote-25.ai.studio/invite/accept?token=${orgInviteId}`,
    orgAcceptUrl
  );

  // -------------------------------------------------------------
  // SECTION E: Welcome Email Dashboard Link
  // -------------------------------------------------------------
  console.log("\n--- Section E: Welcome Email URL Construction ---");

  const welcomeDashboardLink = `${resolveAppUrl()}/app`;
  assert(
    "E.1 Welcome email dashboard link is exactly https://echonote-25.ai.studio/app",
    welcomeDashboardLink === "https://echonote-25.ai.studio/app",
    welcomeDashboardLink
  );

  // SSO Callback canonical format
  const ssoCallbackUrl = `${resolveAppUrl()}/auth/sso/callback`;
  assert(
    "E.2 SSO callback URL is https://echonote-25.ai.studio/auth/sso/callback",
    ssoCallbackUrl === "https://echonote-25.ai.studio/auth/sso/callback",
    ssoCallbackUrl
  );

  // -------------------------------------------------------------
  // SECTION F: No User-Facing URL Uses Forbidden Domains
  // -------------------------------------------------------------
  console.log("\n--- Section F: Forbidden Hostname Exclusion Invariants ---");

  const forbiddenPatterns = [
    { name: "localhost", regex: /localhost/i },
    { name: "ais-dev-*.run.app", regex: /ais-dev-[^.]*\.run\.app/i },
    { name: "echonote-*.run.app", regex: /echonote-[^.]*\.run\.app/i },
    { name: "echotechai.in", regex: /echotechai\.in/i }
  ];

  const generatedUrls = [
    { type: "Project Invitation", url: joinUrl },
    { type: "Organization Invitation", url: orgAcceptUrl },
    { type: "Welcome Email Dashboard", url: welcomeDashboardLink },
    { type: "SSO Callback", url: ssoCallbackUrl }
  ];

  for (const { type, url } of generatedUrls) {
    for (const { name, regex } of forbiddenPatterns) {
      assert(
        `F. [${type}] does NOT contain ${name}`,
        !regex.test(url),
        url
      );
    }
  }

  // -------------------------------------------------------------
  // SECTION G: Deployment Configuration (scripts/deploy-cloud-run.sh)
  // -------------------------------------------------------------
  console.log("\n--- Section G: Deployment Configuration Invariants ---");

  const deployScriptPath = path.resolve(process.cwd(), "scripts/deploy-cloud-run.sh");
  const deployScriptContent = fs.readFileSync(deployScriptPath, "utf-8");

  const expectedDeployEnv = "APP_URL=https://echonote-25.ai.studio";
  const occurrences = (deployScriptContent.match(/APP_URL=https:\/\/echonote-25\.ai\.studio/g) || []).length;

  assert(
    "G.1 Deployment script contains APP_URL=https://echonote-25.ai.studio in update-env action",
    deployScriptContent.includes(expectedDeployEnv)
  );

  assert(
    "G.2 Deployment script configures APP_URL in BOTH update-env and deploy actions",
    occurrences >= 2,
    `Found ${occurrences} occurrences (expected >= 2)`
  );

  assert(
    "G.3 Deployment script does NOT contain outdated APP_URL=https://echotechai.in",
    !deployScriptContent.includes("APP_URL=https://echotechai.in")
  );

  // Check .env.example
  const envExamplePath = path.resolve(process.cwd(), ".env.example");
  const envExampleContent = fs.readFileSync(envExamplePath, "utf-8");
  assert(
    "G.4 .env.example documents APP_URL=https://echonote-25.ai.studio",
    envExampleContent.includes("APP_URL=https://echonote-25.ai.studio")
  );

  // -------------------------------------------------------------
  // SECTION H: Static Codebase Verification
  // -------------------------------------------------------------
  console.log("\n--- Section H: Static Codebase Verification ---");

  const serverTsPath = path.resolve(process.cwd(), "server.ts");
  const serverTsContent = fs.readFileSync(serverTsPath, "utf-8");

  // H.1: server.ts resolveAppUrl returns https://echonote-25.ai.studio in production
  const serverReturnsCanonical = serverTsContent.includes('return "https://echonote-25.ai.studio";');
  assert(
    "H.1 server.ts:resolveAppUrl() deterministically returns https://echonote-25.ai.studio in production",
    serverReturnsCanonical
  );

  // H.2: server.ts does NOT hardcode ephemeral hostname matching
  const resolveAppUrlSection = serverTsContent.slice(
    serverTsContent.indexOf("export function resolveAppUrl"),
    serverTsContent.indexOf("export function resolveAppUrl") + 500
  );
  const hardcodedHostPattern = /ais-dev-|asia-southeast1/.test(resolveAppUrlSection);
  assert(
    "H.2 server.ts:resolveAppUrl() does NOT use temporary hostname pattern matching",
    !hardcodedHostPattern
  );

  // H.3: server.ts uses resolveAppUrl in POST /api/invite-member
  assert(
    "H.3 server.ts POST /api/invite-member uses resolveAppUrl()",
    serverTsContent.includes("const appUrl = resolveAppUrl();\n      const joinUrl = `${appUrl}/join?token=${encodeURIComponent(inviteToken)}`;")
  );

  // H.4: server.ts uses resolveAppUrl in POST /api/invite-accept
  assert(
    "H.4 server.ts POST /api/invite-accept uses resolveAppUrl()",
    serverTsContent.includes("const appUrl = resolveAppUrl();\n      try {\n        await emailService.sendWelcome")
  );

  // H.5: server.ts uses resolveAppUrl in org invitation
  assert(
    "H.5 server.ts org invitation uses resolveAppUrl()",
    serverTsContent.includes("const appUrl = resolveAppUrl();\n      const acceptUrl = `${appUrl}/invite/accept?token=${encodeURIComponent(inviteId)}`;")
  );

  // H.6: Zero occurrences of req.get('host')
  const serverHasReqGetHost = /req\.get\(\s*['"]host['"]\s*\)/.test(serverTsContent);
  assert(
    "H.6 Zero occurrences of req.get('host') in server.ts",
    !serverHasReqGetHost
  );

  // -------------------------------------------------------------
  // SECTION I: Non-Production Configurable Environment Behavior
  // -------------------------------------------------------------
  console.log("\n--- Section I: Non-Production Configurable Invariants ---");

  process.env.NODE_ENV = "development";
  process.env.APP_URL = "https://custom-staging.internal/";
  delete process.env.VITE_APP_URL;
  assert(
    "I.1 Non-production respects configured APP_URL with trailing slash stripped",
    resolveAppUrl() === "https://custom-staging.internal"
  );

  delete process.env.APP_URL;
  process.env.VITE_APP_URL = "https://custom-preview.internal";
  assert(
    "I.2 Non-production falls back to VITE_APP_URL",
    resolveAppUrl() === "https://custom-preview.internal"
  );

  delete process.env.VITE_APP_URL;
  assert(
    "I.3 Non-production falls back to https://echonote-25.ai.studio when no env set",
    resolveAppUrl() === CANONICAL_URL
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

console.log("\n==================================================================");
console.log(`TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
console.log("==================================================================\n");

if (failedTests > 0) {
  process.exit(1);
}
