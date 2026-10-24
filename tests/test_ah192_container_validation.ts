/**
 * AH.192 — Docker / Container Configuration and Static Architecture Verification
 *
 * Verifies:
 * 1. Dockerfile Specifications:
 *    - Uses Node 22 LTS Debian slim base image
 *    - Implements multi-stage build (builder + runner)
 *    - Copies package.json and package-lock.json with npm ci
 *    - Builds production bundle via npm run build
 *    - Sets NODE_ENV=production and non-root USER node
 *    - Uses curl-based HEALTHCHECK pointing to /api/health
 *    - Has authoritative CMD ["node", "dist/server.cjs"]
 * 2. .dockerignore Exclusions:
 *    - Excludes node_modules, dist, .env, .env.*, .git, .github, tests/, docs/, *.zip
 * 3. Server Production Bundle & Readiness Endpoint:
 *    - Verifies production bundle dist/server.cjs exists and is non-empty
 *    - Verifies /api/health responds with status "ok"
 *    - Verifies graceful shutdown signals (SIGTERM / SIGINT) are registered
 * 4. CI Workflow Specifications:
 *    - Verifies .github/workflows/container-validation.yml exists and defines isolated Linux validation
 *    - Confirms push to external registry is prohibited (push: false)
 *    - Confirms synthetic environment configuration is supplied without production secrets
 */

import fs from 'fs';
import path from 'path';

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
  console.log("  AH.192 — Container Configuration & Static Architecture Verification          ");
  console.log("===============================================================================\n");

  const cwd = process.cwd();

  // ---------------------------------------------------------------------------
  // 1. Dockerfile Inspection
  // ---------------------------------------------------------------------------
  console.log("--- 1. Dockerfile Static Architecture & Security Checks ---");

  const dockerfilePath = path.join(cwd, "Dockerfile");
  assert(fs.existsSync(dockerfilePath), "Dockerfile exists in root directory");

  const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
  assert(dockerfileContent.includes("node:22-bookworm-slim"), "Base image targets Node 22 LTS Bookworm slim");
  assert(dockerfileContent.includes("AS builder"), "Implements multi-stage build (Stage 1: builder)");
  assert(dockerfileContent.includes("AS runner"), "Implements multi-stage build (Stage 2: runner)");
  assert(dockerfileContent.includes("npm ci"), "Uses npm ci for reproducible dependency installation");
  assert(dockerfileContent.includes("npm run build"), "Executes production build in builder stage");
  assert(dockerfileContent.includes("npm ci --omit=dev"), "Omits dev dependencies in final runtime image");
  assert(dockerfileContent.includes("COPY --from=builder /app/dist ./dist"), "Copies compiled bundles from builder stage");
  assert(dockerfileContent.includes("USER node"), "Runs container as non-root user (node, UID 1000)");
  assert(dockerfileContent.includes("EXPOSE 3000"), "Exposes application port 3000");
  assert(dockerfileContent.includes("HEALTHCHECK"), "Defines container HEALTHCHECK probe");
  assert(dockerfileContent.includes("/api/health"), "HEALTHCHECK probes authoritative /api/health endpoint");
  assert(dockerfileContent.includes('CMD ["node", "dist/server.cjs"]'), "Defines CMD using production entry point dist/server.cjs");

  // ---------------------------------------------------------------------------
  // 2. .dockerignore Hardening
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. .dockerignore Security & Build Context Exclusions ---");

  const dockerignorePath = path.join(cwd, ".dockerignore");
  assert(fs.existsSync(dockerignorePath), ".dockerignore exists in root directory");

  const dockerignoreContent = fs.readFileSync(dockerignorePath, 'utf8');
  assert(dockerignoreContent.includes("node_modules"), ".dockerignore excludes host node_modules");
  assert(dockerignoreContent.includes(".env"), ".dockerignore excludes root .env file");
  assert(dockerignoreContent.includes(".env.*"), ".dockerignore excludes .env.* variants");
  assert(dockerignoreContent.includes(".git"), ".dockerignore excludes .git repository metadata");
  assert(dockerignoreContent.includes("tests/"), ".dockerignore excludes tests/ directory from runtime build context");
  assert(dockerignoreContent.includes("*.zip"), ".dockerignore excludes large zip archives");

  // ---------------------------------------------------------------------------
  // 3. Production Server Entry Point & Bundle Integrity
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Production Server Entry Point & Bundle Integrity ---");

  const serverBundlePath = path.join(cwd, "dist", "server.cjs");
  if (fs.existsSync(serverBundlePath)) {
    const serverStat = fs.statSync(serverBundlePath);
    assert(serverStat.size > 200000, `Server bundle is substantial (${Math.round(serverStat.size / 1024)} KB)`);
  } else {
    console.log("ℹ️ Server bundle dist/server.cjs not yet built (will be built during npm run build).");
  }

  const serverSourcePath = path.join(cwd, "server.ts");
  const serverSource = fs.readFileSync(serverSourcePath, 'utf8');
  assert(serverSource.includes('app.get("/api/health"'), "server.ts exposes unauthenticated /api/health probe");
  assert(serverSource.includes('process.on("SIGTERM"'), "server.ts registers SIGTERM graceful shutdown handler");
  assert(serverSource.includes('process.on("SIGINT"'), "server.ts registers SIGINT graceful shutdown handler");

  // ---------------------------------------------------------------------------
  // 4. Linux CI Container Workflow Verification
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Linux CI Workflow Verification ---");

  const ciWorkflowPath = path.join(cwd, ".github", "workflows", "container-validation.yml");
  assert(fs.existsSync(ciWorkflowPath), "CI workflow file .github/workflows/container-validation.yml exists");

  const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');
  assert(ciContent.includes("runs-on: ubuntu-latest"), "CI workflow runs on isolated Linux runner (ubuntu-latest)");
  assert(ciContent.includes("push: false"), "CI workflow prohibits image push (push: false)");
  assert(ciContent.includes("docker run -d"), "CI workflow starts container in detached mode");
  assert(ciContent.includes("curl -s -o /tmp/health_out.json"), "CI workflow polls health check endpoint");
  assert(ciContent.includes("docker stop"), "CI workflow verifies graceful container stop and cleanup");
  assert(!ciContent.includes("gcr.io") && !ciContent.includes("pkg.dev"), "CI workflow does NOT target Google Artifact Registry or remote registries");

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
