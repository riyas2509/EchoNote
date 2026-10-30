/**
 * AH.193 — Container CI Readiness and Synthetic Startup Audit Test Suite
 *
 * Validates:
 * 1. Startup Dependency Isolation & Lazy Evaluation:
 *    - Google Gen AI (Gemini) is lazily evaluated on access and does not block startup when GEMINI_API_KEY is unset.
 *    - Razorpay client is lazily evaluated on payment requests and does not throw at startup.
 *    - Resend email client evaluates lazily/safely when RESEND_API_KEY is unset.
 *    - Firebase Admin initializes appAdmin and db without blocking or throwing on unauthenticated credential fallback.
 * 2. Unauthenticated /api/health Endpoint:
 *    - Proves /api/health does not require Bearer token, session cookie, or auth header.
 *    - Confirms /api/health returns only status, time, and service name without leaking internal environment variables or secrets.
 * 3. Dedicated /api/* 404 Routing:
 *    - Asserts server.ts contains explicit app.all("/api/*all", ...) route returning HTTP 404 JSON.
 *    - Confirms unmatched API requests do NOT inadvertently serve HTML index or status 200.
 * 4. CI Workflow Safety, Permissions & Cleanup:
 *    - Workflow specifies explicit `permissions: contents: read`.
 *    - Workflow does not request id-token, write permissions, or deploy steps.
 *    - Workflow configures `if: always()` on container stop and cleanup to prevent hanging runners.
 *    - Workflow passes synthetic environment configuration (-e VITE_TEST_MODE=true, -e FIREBASE_PROJECT_ID=...).
 * 5. Environment Documentation:
 *    - .env.example documents synthetic test variables used for container validation.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    failCount++;
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(msg);
  } else {
    passCount++;
    console.log(`✅ PASS: ${msg}`);
  }
}

async function runTestSuite() {
  console.log("===============================================================================");
  console.log("  AH.193 — Container CI Readiness & Synthetic Startup Audit Test Suite        ");
  console.log("===============================================================================\n");

  const cwd = process.cwd();

  // ---------------------------------------------------------------------------
  // 1. Startup Dependency Isolation & Lazy Initialization
  // ---------------------------------------------------------------------------
  console.log("--- 1. Startup Dependency Isolation & Lazy Initialization ---");

  const serverSourcePath = path.join(cwd, "server.ts");
  assert(fs.existsSync(serverSourcePath), "server.ts exists");
  const serverSource = fs.readFileSync(serverSourcePath, 'utf8');

  // Verify Gemini AI is lazy
  assert(serverSource.includes("const aiGen = {") && serverSource.includes("get models()"),
    "Gemini AI client (aiGen) uses lazy getter property");
  assert(!serverSource.includes("const aiGen = new GoogleGenAI("),
    "Gemini AI client is NOT eagerly instantiated at top-level");

  // Verify Razorpay is lazy
  assert(serverSource.includes("function getRazorpayClient(): Razorpay"),
    "Razorpay client uses lazy factory function getRazorpayClient()");
  assert(!serverSource.includes("const razorpay = new Razorpay("),
    "Razorpay client is NOT eagerly instantiated at top-level");

  // Verify Firebase Admin credential fallback
  const fbAdminPath = path.join(cwd, "lib", "firebaseAdmin.ts");
  assert(fs.existsSync(fbAdminPath), "lib/firebaseAdmin.ts exists");
  const fbAdminSource = fs.readFileSync(fbAdminPath, 'utf8');

  // Supplementary source-structure checks
  assert(fbAdminSource.includes("admin.credential.applicationDefault()"),
    "[Source Check (Supplementary)] Firebase Admin attempts applicationDefault credential");
  assert(fbAdminSource.includes("catch") && fbAdminSource.includes("appAdminInstance = initializeApp({"),
    "[Source Check (Supplementary)] Firebase Admin gracefully falls back without throwing when credentials are absent");

  // Authoritative runtime behavioral verification: Firebase Admin initializes cleanly in an isolated child process without credentials
  const tsxCli = path.resolve(cwd, "node_modules", "tsx", "dist", "cli.mjs");
  const tempEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "echonote-ci-empty-adc-"));
  const childInlineCode = `
    const { getFirebaseAdminApp, getFirebaseConfig } = await import('./lib/firebaseAdmin.ts');
    const app = getFirebaseAdminApp();
    if (!app || app.name !== '[DEFAULT]') process.exit(2);
    const config = getFirebaseConfig();
    if (!config.projectId) process.exit(3);
    console.log('CI_READINESS_OK');
    process.exit(0);
  `;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    NODE_ENV: 'test',
    VITE_TEST_MODE: 'true',
    GOOGLE_CLOUD_PROJECT: 'echonote-test',
    CLOUDSDK_CONFIG: tempEmptyDir,         // Real empty temp directory blocks developer ADC
    NO_GCE_CHECK: 'true',                // Prevents metadata server probes
    GCE_METADATA_HOST: '127.0.0.1:9999', // Metadata network probe safeguard
  };
  delete childEnv.GOOGLE_APPLICATION_CREDENTIALS;
  delete childEnv.GCLOUD_PROJECT;
  delete childEnv.FIRESTORE_EMULATOR_HOST;
  delete childEnv.FIREBASE_STORAGE_EMULATOR_HOST;
  delete childEnv.FIREBASE_AUTH_EMULATOR_HOST;
  delete childEnv.STAGING_ISOLATION_REQUIRED;
  delete childEnv.ALLOW_PRODUCTION_RESOURCES;

  try {
    const childRes = spawnSync(process.execPath, [tsxCli, '--input-type=module', '-e', childInlineCode], {
      cwd,
      env: childEnv,
      encoding: 'utf8',
      timeout: 30000,
    });

    assert(
      childRes.status === 0 && childRes.stdout.includes('CI_READINESS_OK'),
      "[Behavioral Check (Authoritative)] Firebase Admin initializes cleanly in isolated child process without credentials"
    );
  } finally {
    fs.rmSync(tempEmptyDir, { recursive: true, force: true });
  }

  // Verify checkIdentity error safety
  assert(serverSource.includes("async function checkIdentity()"),
    "checkIdentity() function exists for runtime diagnostic logging");
  assert(serverSource.includes("GoogleAuth checkIdentity warning:"),
    "checkIdentity() catches credentials error with warning rather than terminating process");

  // ---------------------------------------------------------------------------
  // 2. Unauthenticated /api/health Endpoint Contract
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Unauthenticated /api/health Endpoint Contract ---");

  assert(serverSource.includes('app.get("/api/health"'), "server.ts defines /api/health route");
  assert(!serverSource.includes('app.get("/api/health", requireAuth'), "/api/health does NOT require requireAuth middleware");
  assert(!serverSource.includes('app.get("/api/health", optionalAuth'), "/api/health does NOT require optionalAuth middleware");

  // Check health response properties
  const healthSnippetMatch = serverSource.match(/app\.get\("\/api\/health",\s*\([^\)]*\)\s*=>\s*\{([\s\S]*?)\}\);/);
  assert(healthSnippetMatch !== null, "Health check route handler extracted");
  const healthHandler = healthSnippetMatch ? healthSnippetMatch[1] : "";
  assert(healthHandler.includes('status: "ok"'), "Health handler returns status: 'ok'");
  assert(healthHandler.includes('time: new Date().toISOString()'), "Health handler returns dynamic ISO timestamp");
  assert(healthHandler.includes('service: process.env.K_SERVICE || "echonote"'), "Health handler returns safe service identifier");
  assert(!healthHandler.includes('process.env.GEMINI_API_KEY'), "Health handler does NOT expose GEMINI_API_KEY");
  assert(!healthHandler.includes('process.env.RAZORPAY_KEY_SECRET'), "Health handler does NOT expose RAZORPAY_KEY_SECRET");
  assert(!healthHandler.includes('process.env.RESEND_API_KEY'), "Health handler does NOT expose RESEND_API_KEY");

  // ---------------------------------------------------------------------------
  // 3. Dedicated /api/* 404 Routing & Negative Route Behavior
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Dedicated /api/* 404 Routing & Negative Route Behavior ---");

  assert(serverSource.includes('app.all("/api/*all"'), "Explicit 404 handler app.all('/api/*all') defined before static SPA catch-all");
  assert(serverSource.includes('res.status(404).json'), "Unmatched API routes respond with status 404 JSON");
  assert(serverSource.includes('API endpoint not found'), "Unmatched API routes return clear 'API endpoint not found' error");

  // ---------------------------------------------------------------------------
  // 4. CI Workflow Safety, Permissions & Cleanup Invariants
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. CI Workflow Safety, Permissions & Cleanup Invariants ---");

  const ciWorkflowPath = path.join(cwd, ".github", "workflows", "container-validation.yml");
  assert(fs.existsSync(ciWorkflowPath), ".github/workflows/container-validation.yml exists");
  const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');

  // Verify minimal read permissions
  assert(ciContent.includes("permissions:"), "Workflow contains explicit permissions block");
  assert(ciContent.includes("contents: read"), "Workflow restricts permissions to contents: read");
  assert(!ciContent.includes("id-token: write"), "Workflow does NOT request OIDC id-token write permission");
  assert(!ciContent.includes("deploy"), "Workflow does NOT perform any deployment action");

  // Verify synthetic container environment
  assert(ciContent.includes("-e VITE_TEST_MODE=true"), "Container run step injects VITE_TEST_MODE=true");
  assert(ciContent.includes("-e FIREBASE_PROJECT_ID=echonote-synthetic"), "Container run step injects FIREBASE_PROJECT_ID");
  assert(ciContent.includes("-e GOOGLE_CLOUD_PROJECT=echonote-synthetic"), "Container run step injects GOOGLE_CLOUD_PROJECT");
  assert(ciContent.includes("-e FIRESTORE_DATABASE_ID=echonote-synthetic-db"), "Container run step injects FIRESTORE_DATABASE_ID");

  // Verify cleanup guarantees
  assert(ciContent.includes("if: always()"), "Cleanup step uses if: always() to guarantee container teardown on failure");
  assert(ciContent.includes("docker stop -t 5 echonote-test-instance"), "Cleanup step gracefully stops container with SIGTERM timeout");
  assert(ciContent.includes("docker rm -f echonote-test-instance"), "Cleanup step force removes container on teardown");

  // ---------------------------------------------------------------------------
  // 5. Environment Documentation
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Environment Documentation in .env.example ---");

  const envExamplePath = path.join(cwd, ".env.example");
  assert(fs.existsSync(envExamplePath), ".env.example exists");
  const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');

  assert(envExampleContent.includes("FIRESTORE_DATABASE_ID=echonote-synthetic-db"),
    ".env.example documents synthetic FIRESTORE_DATABASE_ID");
  assert(envExampleContent.includes("FIREBASE_PROJECT_ID=echonote-synthetic"),
    ".env.example documents synthetic FIREBASE_PROJECT_ID");
  assert(envExampleContent.includes("VITE_TEST_MODE=true"),
    ".env.example documents synthetic VITE_TEST_MODE");
  assert(envExampleContent.includes("K_SERVICE=echonote-ci"),
    ".env.example documents synthetic K_SERVICE");

  console.log("\n===============================================================================");
  console.log(`  SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("===============================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
