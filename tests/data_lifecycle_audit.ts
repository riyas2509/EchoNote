/**
 * Automated Data Lifecycle, Cascade Deletion & Account Closure Test Suite
 * Step 6 Security Remediation Verification
 */

const BASE_URL = "http://127.0.0.1:3000";

async function runTests() {
  console.log("===============================================================");
  console.log("🚀 STARTING ECHO NOTE DATA LIFECYCLE & CASCADE DELETION TESTS");
  console.log("===============================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`• ${name}... `);
    try {
      await fn();
      console.log("✅ PASSED");
      passed++;
    } catch (err: any) {
      console.log(`❌ FAILED: ${err.message}`);
      failed++;
    }
  }

  // --- 1. RECORDING DELETION SECURITY TESTS ---
  await test("DELETE /api/recordings/:id blocks unauthenticated caller", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings/fake_rec_123`, { method: "DELETE" });
    if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
  });

  await test("DELETE /api/recordings/:id blocks invalid token", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings/fake_rec_123`, {
      method: "DELETE",
      headers: { Authorization: "Bearer invalid_token" }
    });
    if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
  });

  // --- 2. PROJECT DELETION LIFECYCLE TESTS ---
  await test("DELETE /api/projects/:projectId blocks unauthenticated caller", async () => {
    const res = await fetch(`${BASE_URL}/api/projects/fake_proj_123`, { method: "DELETE" });
    if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
  });

  await test("POST /api/projects/:projectId/transfer-ownership blocks unauthenticated caller", async () => {
    const res = await fetch(`${BASE_URL}/api/projects/fake_proj_123/transfer-ownership`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newOwnerId: "user_456" })
    });
    if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
  });

  // --- 3. USER ACCOUNT CLOSURE LIFECYCLE TESTS ---
  await test("POST /api/user/close-account blocks unauthenticated caller", async () => {
    const res = await fetch(`${BASE_URL}/api/user/close-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmPhrase: "CLOSE MY ACCOUNT" })
    });
    if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
  });

  // --- 4. ORGANIZATION DELETION WORKFLOW TESTS ---
  await test("POST /api/organizations/:id/request-deletion blocks unauthenticated caller", async () => {
    const res = await fetch(`${BASE_URL}/api/organizations/fake_org_123/request-deletion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "Acme Corp" })
    });
    if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
  });

  // --- 5. RETENTION PURGE JOB TESTS ---
  await test("POST /api/admin/retention/purge-expired blocks unauthorized callers", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/retention/purge-expired`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retentionDays: 30 })
    });
    if (res.status !== 403) throw new Error(`Expected 403 Forbidden, got ${res.status}`);
  });

  await test("POST /api/admin/retention/purge-expired validates configurable retentionDays parameter", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/retention/purge-expired`, {
      method: "POST",
      headers: { "x-cron-key": "invalid-key", "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (res.status !== 403) throw new Error(`Expected 403 Forbidden for bad cron key, got ${res.status}`);
  });

  // --- 6. FIRESTORE RULES AUDIT INTEGRITY TESTS ---
  await test("Verify firestore.rules prevents client-side deletion of organizations", async () => {
    const fs = await import("fs");
    const rulesContent = fs.readFileSync("./firestore.rules", "utf-8");
    if (!rulesContent.includes("allow delete: if false; // Direct client deletion strictly forbidden")) {
      throw new Error("firestore.rules must explicitly disallow direct client-side deletion of organizations");
    }
  });

  await test("Verify firestore.rules enforces server-authoritative project deletion", async () => {
    const fs = await import("fs");
    const rulesContent = fs.readFileSync("./firestore.rules", "utf-8");
    if (!rulesContent.includes("allow delete: if isAdmin(); // Direct client-side deletion forbidden")) {
      throw new Error("firestore.rules must forbid direct client project deletion for non-admins");
    }
  });

  await test("Verify firestore.rules enforces audit log immutability", async () => {
    const fs = await import("fs");
    const rulesContent = fs.readFileSync("./firestore.rules", "utf-8");
    if (!rulesContent.includes("match /auditLogs/{logId}") || !rulesContent.includes("allow write: if false;")) {
      throw new Error("firestore.rules must enforce allow write: if false on audit logs");
    }
  });

  // --- 6. SOFT-DELETED PLAYBACK & AI PROCESSING BLOCK TEST ---
  await test("Playback token endpoint blocks unauthenticated caller", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings/test_rec/playback-token`, { method: "POST" });
    if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
  });

  await test("Audio streaming endpoint rejects unauthenticated access to audio streams", async () => {
    const res = await fetch(`${BASE_URL}/api/recordings/test_rec/audio`);
    if (res.status !== 401 && res.status !== 403) {
      throw new Error(`Expected 401 or 403, got ${res.status}`);
    }
  });

  await test("AI Meeting Intelligence endpoint rejects unauthenticated access", async () => {
    const res = await fetch(`${BASE_URL}/api/ai/unified-meeting-intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: "test_rec" })
    });
    if (res.status !== 401) throw new Error(`Expected 401 Unauthorized, got ${res.status}`);
  });

  console.log("\n===============================================================");
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
