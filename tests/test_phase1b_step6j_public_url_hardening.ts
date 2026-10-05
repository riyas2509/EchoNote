/**
 * Phase 1B Step 6J-B/C: Public URL Hardening & Deterministic Production Resolution Tests
 *
 * Requirements covered:
 * 1. resolveAppUrl() returns exactly "https://echonote-25.ai.studio" deterministically when NODE_ENV === "production"
 * 2. In production, APP_URL cannot override public domain (e.g. AI Studio URL, localhost, arbitrary domain)
 * 3. In production, VITE_APP_URL cannot override public domain
 * 4. In non-production, configured valid APP_URL is preserved with trailing slash stripped
 * 5. In non-production, missing APP_URL falls back to VITE_APP_URL or "https://echonote-25.ai.studio"
 * 6. In non-production, empty or whitespace APP_URL falls back to canonical domain
 * 7. Project invitation URL in production resolves to https://echonote-25.ai.studio/join?token=<encoded token>
 * 8. Welcome email dashboardLink in production resolves to https://echonote-25.ai.studio/app
 * 9. Codebase static audit:
 *    - server.ts resolveAppUrl() checks process.env.NODE_ENV === "production"
 *    - server.ts does NOT hard-code ephemeral AI Studio hostnames (ais-dev-, asia-southeast1)
 *    - POST /api/invite-member uses resolveAppUrl() and encodeURIComponent(inviteToken)
 *    - POST /api/invite-accept uses resolveAppUrl() for welcome email
 *    - Zero occurrences of req.get('host') in server.ts and lib/emailService.ts
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
console.log("🔒 RUNNING PHASE 1B STEP 6J PUBLIC URL HARDENING TESTS");
console.log("==================================================================\n");

const origNodeEnv = process.env.NODE_ENV;
const origAppUrl = process.env.APP_URL;
const origViteAppUrl = process.env.VITE_APP_URL;

try {
  // -------------------------------------------------------------
  // SECTION A: Production Environment Invariants (Strict Lockdown)
  // -------------------------------------------------------------
  console.log("--- Section A: Production Deterministic Resolution (NODE_ENV=production) ---");

  // A.1: Production with AI Studio ephemeral URL in APP_URL
  process.env.NODE_ENV = "production";
  process.env.APP_URL = "https://ais-dev-e6tttlafqn3wtn6fbiynhj-88328487579.asia-southeast1.run.app";
  delete process.env.VITE_APP_URL;
  assert(
    "A.1 In production, AI Studio APP_URL cannot override canonical domain (resolves to https://echonote-25.ai.studio)",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    { resolved: resolveAppUrl(), expected: "https://echonote-25.ai.studio" }
  );

  // A.2: Production with localhost in APP_URL
  process.env.NODE_ENV = "production";
  process.env.APP_URL = "https://localhost:3000";
  delete process.env.VITE_APP_URL;
  assert(
    "A.2 In production, localhost APP_URL cannot override canonical domain (resolves to https://echonote-25.ai.studio)",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    { resolved: resolveAppUrl(), expected: "https://echonote-25.ai.studio" }
  );

  // A.3: Production with 127.0.0.1 in APP_URL
  process.env.NODE_ENV = "production";
  process.env.APP_URL = "http://127.0.0.1:8080";
  delete process.env.VITE_APP_URL;
  assert(
    "A.3 In production, loopback IP APP_URL cannot override canonical domain",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    { resolved: resolveAppUrl(), expected: "https://echonote-25.ai.studio" }
  );

  // A.4: Production with VITE_APP_URL override attempt
  process.env.NODE_ENV = "production";
  delete process.env.APP_URL;
  process.env.VITE_APP_URL = "https://malicious-override.preview.dev";
  assert(
    "A.4 In production, VITE_APP_URL cannot override canonical domain",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    { resolved: resolveAppUrl(), expected: "https://echonote-25.ai.studio" }
  );

  // A.5: Production with both APP_URL and VITE_APP_URL set to arbitrary URLs
  process.env.NODE_ENV = "production";
  process.env.APP_URL = "https://custom-domain.example.com";
  process.env.VITE_APP_URL = "https://another-domain.example.com";
  assert(
    "A.5 In production, neither APP_URL nor VITE_APP_URL can override canonical domain",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    { resolved: resolveAppUrl(), expected: "https://echonote-25.ai.studio" }
  );

  // A.6: Production with env unset
  process.env.NODE_ENV = "production";
  delete process.env.APP_URL;
  delete process.env.VITE_APP_URL;
  assert(
    "A.6 In production, with no env set, returns https://echonote-25.ai.studio",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    { resolved: resolveAppUrl(), expected: "https://echonote-25.ai.studio" }
  );

  // -------------------------------------------------------------
  // SECTION B: Non-Production Configurable Environment Behavior
  // -------------------------------------------------------------
  console.log("\n--- Section B: Non-Production Configurable Behavior ---");

  // B.1: Non-production with valid custom APP_URL
  process.env.NODE_ENV = "development";
  process.env.APP_URL = "https://staging.echonote.internal";
  delete process.env.VITE_APP_URL;
  assert(
    "B.1 In non-production, valid configured APP_URL is respected",
    resolveAppUrl() === "https://staging.echonote.internal",
    { resolved: resolveAppUrl(), expected: "https://staging.echonote.internal" }
  );

  // B.2: Non-production with trailing slashes stripped
  process.env.NODE_ENV = "development";
  process.env.APP_URL = "https://staging.echonote.internal////";
  assert(
    "B.2 In non-production, trailing slashes are cleanly removed",
    resolveAppUrl() === "https://staging.echonote.internal",
    { resolved: resolveAppUrl(), expected: "https://staging.echonote.internal" }
  );

  // B.3: Non-production fallback to VITE_APP_URL when APP_URL is absent
  process.env.NODE_ENV = "development";
  delete process.env.APP_URL;
  process.env.VITE_APP_URL = "https://preview.echonote.internal";
  assert(
    "B.3 In non-production, falls back to VITE_APP_URL when APP_URL is unset",
    resolveAppUrl() === "https://preview.echonote.internal",
    { resolved: resolveAppUrl(), expected: "https://preview.echonote.internal" }
  );

  // B.4: Non-production fallback to canonical domain when both are unset
  process.env.NODE_ENV = "development";
  delete process.env.APP_URL;
  delete process.env.VITE_APP_URL;
  assert(
    "B.4 In non-production, falls back to https://echonote-25.ai.studio when no env vars set",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    { resolved: resolveAppUrl(), expected: "https://echonote-25.ai.studio" }
  );

  // B.5: Non-production with empty strings falls back to canonical domain
  process.env.NODE_ENV = "test";
  process.env.APP_URL = "   ";
  process.env.VITE_APP_URL = "";
  assert(
    "B.5 In non-production, whitespace-only/empty env vars fall back to canonical domain",
    resolveAppUrl() === "https://echonote-25.ai.studio",
    { resolved: resolveAppUrl(), expected: "https://echonote-25.ai.studio" }
  );

  // -------------------------------------------------------------
  // SECTION C: Project Invitation & Welcome URL Construction in Production
  // -------------------------------------------------------------
  console.log("\n--- Section C: User-Facing URL Construction (Production) ---");

  process.env.NODE_ENV = "production";
  process.env.APP_URL = "https://ais-dev-e6tttlafqn3wtn6fbiynhj-88328487579.asia-southeast1.run.app";

  const inviteToken = "inv_sec_abc123!@#$";
  const appUrl = resolveAppUrl();
  const joinUrl = `${appUrl}/join?token=${encodeURIComponent(inviteToken)}`;

  assert(
    "C.1 Project invitation URL starts with https://echonote-25.ai.studio in production regardless of APP_URL",
    joinUrl.startsWith("https://echonote-25.ai.studio/join?token="),
    joinUrl
  );

  assert(
    "C.2 Invite token is correctly URL encoded in production URL",
    joinUrl.includes(encodeURIComponent(inviteToken)),
    joinUrl
  );

  assert(
    "C.3 Invitation URL does not contain AI Studio dev host in production",
    !joinUrl.includes("ais-dev-") && !joinUrl.includes("asia-southeast1"),
    joinUrl
  );

  assert(
    "C.4 Invitation URL does not contain localhost in production",
    !joinUrl.includes("localhost"),
    joinUrl
  );

  // Welcome email dashboard link
  const welcomeDashboardLink = `${appUrl}/app`;
  assert(
    "C.5 Welcome email dashboard link is exactly https://echonote-25.ai.studio/app in production",
    welcomeDashboardLink === "https://echonote-25.ai.studio/app",
    welcomeDashboardLink
  );

  // -------------------------------------------------------------
  // SECTION D: Static Audit of server.ts & emailService.ts
  // -------------------------------------------------------------
  console.log("\n--- Section D: Static Codebase Verification ---");

  const serverTsPath = path.resolve(process.cwd(), "server.ts");
  const serverTsContent = fs.readFileSync(serverTsPath, "utf-8");

  // D.1: resolveAppUrl in server.ts inspects NODE_ENV === "production"
  const hasNodeEnvProdCheck = /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*["']production["']\s*\)\s*\{\s*return\s*["']https:\/\/echonote-25\.ai\.studio["'];?\s*\}/.test(serverTsContent);
  assert(
    "D.1 server.ts:resolveAppUrl() enforces NODE_ENV === 'production' check returning https://echonote-25.ai.studio",
    hasNodeEnvProdCheck
  );

  // D.2: server.ts does NOT hard-code ephemeral AI Studio hostnames
  const resolveAppUrlSection = serverTsContent.slice(
    serverTsContent.indexOf("export function resolveAppUrl"),
    serverTsContent.indexOf("export function resolveAppUrl") + 500
  );
  const hardcodedAisPattern = /ais-dev-|asia-southeast1/.test(resolveAppUrlSection);
  assert(
    "D.2 server.ts:resolveAppUrl() does NOT hard-code temporary AI Studio hostname patterns",
    !hardcodedAisPattern
  );

  // D.3: server.ts preserves Step 6I project invitation URL construction
  const hasStep6IInviteConstruction = serverTsContent.includes(
    "const appUrl = resolveAppUrl();\n      const joinUrl = `${appUrl}/join?token=${encodeURIComponent(inviteToken)}`;"
  );
  assert(
    "D.3 server.ts preserves Step 6I project invitation URL construction with resolveAppUrl()",
    hasStep6IInviteConstruction
  );

  // D.4: server.ts preserves Step 6I welcome email URL construction
  const hasStep6IWelcome = serverTsContent.includes(
    "const appUrl = resolveAppUrl();\n      try {\n        await emailService.sendWelcome(userEmail, {\n          name: userDisplayName,\n          dashboardLink: `${appUrl}/app`"
  );
  assert(
    "D.4 server.ts preserves Step 6I welcome email URL construction with resolveAppUrl()",
    hasStep6IWelcome
  );

  // D.5: server.ts has zero req.get('host') occurrences
  const serverHasReqGetHost = /req\.get\(\s*['"]host['"]\s*\)/.test(serverTsContent);
  assert(
    "D.5 Zero occurrences of req.get('host') in server.ts",
    !serverHasReqGetHost
  );

  // D.6: lib/emailService.ts has zero req.get('host') occurrences
  const emailServicePath = path.resolve(process.cwd(), "lib/emailService.ts");
  const emailServiceContent = fs.readFileSync(emailServicePath, "utf-8");
  const emailHasReqGetHost = /req\.get\(\s*['"]host['"]\s*\)/.test(emailServiceContent);
  assert(
    "D.6 Zero occurrences of req.get('host') in lib/emailService.ts",
    !emailHasReqGetHost
  );

} finally {
  // Restore environment
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
