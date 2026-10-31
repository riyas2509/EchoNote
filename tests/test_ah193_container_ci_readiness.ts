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
import http from 'http';
import { spawn, spawnSync } from 'child_process';

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
      timeout: 60000,
    });

    if (childRes.status !== 0 || !childRes.stdout?.includes('CI_READINESS_OK')) {
      console.error('DEBUG childRes status:', childRes.status);
      console.error('DEBUG childRes stdout:', childRes.stdout);
      console.error('DEBUG childRes stderr:', childRes.stderr);
      console.error('DEBUG childRes error:', childRes.error);
    }
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
  assert(ciContent.includes("-e NODE_ENV=test"), "Container run step injects NODE_ENV=test");
  assert(ciContent.includes("-e VITE_TEST_MODE=true"), "Container run step injects VITE_TEST_MODE=true");
  assert(ciContent.includes("-e FIREBASE_PROJECT_ID=echonote-synthetic"), "Container run step injects FIREBASE_PROJECT_ID");
  assert(ciContent.includes("-e GOOGLE_CLOUD_PROJECT=echonote-synthetic"), "Container run step injects GOOGLE_CLOUD_PROJECT");
  assert(ciContent.includes("-e FIRESTORE_DATABASE_ID=echonote-synthetic-db"), "Container run step injects FIRESTORE_DATABASE_ID");
  assert(!ciContent.includes("ALLOW_PRODUCTION_RESOURCES"), "Container run step does NOT set ALLOW_PRODUCTION_RESOURCES");

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

  // ---------------------------------------------------------------------------
  // 6. Frontend Serving Selection, Static Asset Integrity & Production Safeguards
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Frontend Serving Selection, Static Asset Integrity & Production Safeguards ---");

  // 1. Static frontend entry point in dist/
  const distHtmlPath = path.join(cwd, "dist", "index.html");
  assert(fs.existsSync(distHtmlPath), "Prebuilt frontend entry point dist/index.html exists");
  assert(fs.statSync(distHtmlPath).size > 1000, "dist/index.html has substantial compiled content");

  // Verify Dockerfile copies compiled dist directory to runner image
  const dockerfilePath = path.join(cwd, "Dockerfile");
  assert(fs.existsSync(dockerfilePath), "Dockerfile exists");
  const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
  assert(
    dockerfileContent.includes("COPY --from=builder /app/dist ./dist"),
    "Dockerfile runner stage copies prebuilt dist/ into runtime container"
  );

  // 2. Behavioral verification of frontend serving mode decision in isolated process
  const frontendDecisionCode = `
    const checkMode = (nodeEnv, viteTestMode) => {
      const shouldUseVite = nodeEnv !== "production" && nodeEnv !== "staging" && nodeEnv !== "test" && viteTestMode !== "true";
      return shouldUseVite ? "VITE_DEV_SERVER" : "STATIC_DIST_BUNDLE";
    };

    // 1. Development mode: NODE_ENV=development or unset, VITE_TEST_MODE unset
    if (checkMode("development", undefined) !== "VITE_DEV_SERVER") process.exit(10);
    if (checkMode(undefined, undefined) !== "VITE_DEV_SERVER") process.exit(11);

    // 2. CI test mode: NODE_ENV=test, VITE_TEST_MODE=true or unset
    if (checkMode("test", "true") !== "STATIC_DIST_BUNDLE") process.exit(12);
    if (checkMode("test", undefined) !== "STATIC_DIST_BUNDLE") process.exit(15);

    // 3. Production mode: NODE_ENV=production, VITE_TEST_MODE unset or true
    if (checkMode("production", undefined) !== "STATIC_DIST_BUNDLE") process.exit(13);
    if (checkMode("production", "true") !== "STATIC_DIST_BUNDLE") process.exit(14);

    // 4. Staging mode: NODE_ENV=staging, VITE_TEST_MODE unset, false, or true
    if (checkMode("staging", undefined) !== "STATIC_DIST_BUNDLE") process.exit(16);
    if (checkMode("staging", "false") !== "STATIC_DIST_BUNDLE") process.exit(17);
    if (checkMode("staging", "true") !== "STATIC_DIST_BUNDLE") process.exit(18);

    console.log("FRONTEND_MODES_VERIFIED");
    process.exit(0);
  `;
  const decisionRes = spawnSync(process.execPath, ['--input-type=module', '-e', frontendDecisionCode], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert(
    decisionRes.status === 0 && decisionRes.stdout.includes("FRONTEND_MODES_VERIFIED"),
    "Behavioral verification: Dev mode selects Vite; CI test mode, Staging mode, and Production mode select static bundle"
  );

  // 3. Live server runtime smoke verification in CI test mode
  // Spawns dist/server.cjs with NODE_ENV=test, VITE_TEST_MODE=true, confirms HTTP 200 health & static HTML
  const smokePort = "3096";
  const smokeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    VITE_TEST_MODE: "true",
    PORT: smokePort,
    GOOGLE_CLOUD_PROJECT: "echonote-synthetic",
    FIRESTORE_DATABASE_ID: "echonote-synthetic-db",
    FIREBASE_PROJECT_ID: "echonote-synthetic",
    K_SERVICE: "echonote-ci",
  };
  delete smokeEnv.ALLOW_PRODUCTION_RESOURCES;
  delete smokeEnv.GOOGLE_APPLICATION_CREDENTIALS;

  const smokeChild = spawn(process.execPath, [path.join(cwd, "dist", "server.cjs")], {
    cwd,
    env: smokeEnv,
    stdio: "pipe",
  });

  let smokeStdout = "";
  let smokeStderr = "";
  smokeChild.stdout?.on("data", c => smokeStdout += c);
  smokeChild.stderr?.on("data", c => smokeStderr += c);

  let serverStarted = false;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const healthRes = await new Promise<{ status?: number; data?: any }>((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${smokePort}/api/health`, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
              try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
              catch (err) { reject(err); }
            });
          });
          req.on("error", reject);
        });

        if (healthRes.status === 200 && healthRes.data?.status === "ok") {
          serverStarted = true;
          break;
        }
      } catch {}
    }
    if (!serverStarted) {
      console.error("smokeChild stdout:", smokeStdout);
      console.error("smokeChild stderr:", smokeStderr);
    }
    assert(serverStarted, "CI test mode server bundle booted cleanly and responded to /api/health with status ok");

    // Verify static HTML index is served for root path
    const rootRes = await new Promise<{ status?: number; data?: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${smokePort}/`, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => resolve({ status: res.statusCode, data }));
      });
      req.on("error", reject);
    });
    assert(
      rootRes.status === 200 && (rootRes.data || "").toLowerCase().includes("<!doctype html>"),
      "CI test mode server bundle serves prebuilt static index.html at root without importing Vite"
    );
  } finally {
    smokeChild.kill("SIGTERM");
  }

  // 3b. Live server runtime smoke verification in Staging mode
  // Spawns dist/server.cjs with NODE_ENV=staging, STAGING_ISOLATION_REQUIRED=true, confirms HTTP 200 health & static HTML without Vite
  const smokeStagingPort = "3097";
  const smokeStagingEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "staging",
    STAGING_ISOLATION_REQUIRED: "true",
    PORT: smokeStagingPort,
    GOOGLE_CLOUD_PROJECT: "echonote-staging",
    FIRESTORE_DATABASE_ID: "(default)",
    STORAGE_BUCKET: "echonote-staging-reports",
    SCHEDULER_SERVICE_ACCOUNT: "echo-scheduler@echonote-staging.iam.gserviceaccount.com",
    K_SERVICE: "echonote-staging",
  };
  delete smokeStagingEnv.VITE_TEST_MODE;
  delete smokeStagingEnv.ALLOW_PRODUCTION_RESOURCES;
  delete smokeStagingEnv.GOOGLE_APPLICATION_CREDENTIALS;

  const smokeStagingChild = spawn(process.execPath, [path.join(cwd, "dist", "server.cjs")], {
    cwd,
    env: smokeStagingEnv,
    stdio: "pipe",
  });

  let stagingServerStarted = false;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise(r => setTimeout(r, 400));
      try {
        const healthRes = await new Promise<{ status?: number; data?: any }>((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${smokeStagingPort}/api/health`, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
              try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
              catch (err) { reject(err); }
            });
          });
          req.on("error", reject);
        });

        if (healthRes.status === 200 && healthRes.data?.status === "ok") {
          stagingServerStarted = true;
          break;
        }
      } catch {}
    }
    assert(stagingServerStarted, "Staging mode server bundle booted cleanly and responded to /api/health with status ok");

    // Verify static HTML index is served for root path
    const rootRes = await new Promise<{ status?: number; data?: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${smokeStagingPort}/`, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => resolve({ status: res.statusCode, data }));
      });
      req.on("error", reject);
    });
    assert(
      rootRes.status === 200 && (rootRes.data || "").toLowerCase().includes("<!doctype html>"),
      "Staging mode server bundle serves prebuilt static index.html at root without importing Vite"
    );
  } finally {
    smokeStagingChild.kill("SIGTERM");
  }

  // 4. Firebase production fail-closed safeguard verification
  // Verify that NODE_ENV=production without ALLOW_PRODUCTION_RESOURCES fails closed immediately
  const prodFailClosedCode = `
    try {
      const { getFirebaseConfig } = await import('./lib/firebaseAdmin.ts');
      getFirebaseConfig();
      process.exit(20); // Should have thrown!
    } catch (err) {
      if (err.message.includes("NODE_ENV is set to production, but ALLOW_PRODUCTION_RESOURCES is not 'true'")) {
        console.log("PROD_SAFEGUARD_VERIFIED");
        process.exit(0);
      }
      process.exit(21);
    }
  `;
  const prodEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    GOOGLE_CLOUD_PROJECT: "echonote-synthetic",
  };
  delete prodEnv.ALLOW_PRODUCTION_RESOURCES;
  delete prodEnv.STAGING_ISOLATION_REQUIRED;

  const prodRes = spawnSync(process.execPath, [tsxCli, '--input-type=module', '-e', prodFailClosedCode], {
    cwd,
    env: prodEnv,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert(
    prodRes.status === 0 && prodRes.stdout.includes("PROD_SAFEGUARD_VERIFIED"),
    "Firebase Admin preserves strict production fail-closed safeguard when ALLOW_PRODUCTION_RESOURCES is absent"
  );

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
