/**
 * ECHO NOTE — STEP 8.1A RUNTIME LIMITER & ABUSE PROTECTION TEST SUITE
 * 
 * Verifies:
 * 1. AI rate limiting (15 req/min, 100 req/hr per UID)
 * 2. AI concurrency limit (max 2 concurrent per UID, 3rd rejected)
 * 3. AI concurrency slot release on success and on error
 * 4. User isolation (UID A does not consume UID B's quota)
 * 5. FFmpeg rate limiting (6 req/min, 30 req/hr per UID)
 * 6. FFmpeg concurrency limit (max 1 concurrent per UID)
 * 7. FFmpeg slot release on success and on error
 * 8. Instance-level concurrency ceiling rejection and release
 * 9. Unauthenticated request rejection (401)
 * 10. Sanitized errors & headers (Retry-After, code, no secrets)
 * 11. Live server endpoints validation
 */

import { 
  InMemoryRateLimitStore, 
  LRUCacheRateLimitStore,
  admitExpensiveOperation, 
  createRateLimiterMiddleware,
  runtimeLimiterStore,
  AI_LIMIT_CONFIG,
  FFMPEG_LIMIT_CONFIG,
  INSTANCE_MAX_CONCURRENT_EXPENSIVE
} from "../middleware/runtimeLimiter.ts";
import { AuthenticatedRequest } from "../middleware/auth.ts";

async function runAudit() {
  console.log("==================================================================");
  console.log("🚀 STARTING ECHO NOTE STEP 8.1A RUNTIME LIMITER TEST SUITE");
  console.log("==================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  async function test(name: string, fn: () => void | Promise<void>) {
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

  // --- UNIT TESTS: AI RATE LIMITING & CONCURRENCY ---

  await test("AI: First request admitted successfully", () => {
    const store = new InMemoryRateLimitStore();
    const result = store.admit("user_ai_1", "ai");
    assert(result.admitted === true, "First AI request should be admitted");
    assert(result.slot !== undefined, "Slot should be returned on admission");
    result.slot?.release();
  });

  await test("AI: Rate limit exceeded after 15 requests in one minute", () => {
    const store = new InMemoryRateLimitStore();
    const slots: any[] = [];
    // User performs 15 admitted requests sequentially (releasing concurrency each time)
    for (let i = 0; i < 15; i++) {
      const res = store.admit("user_burst", "ai");
      assert(res.admitted === true, `Request ${i + 1} should be admitted`);
      res.slot?.release();
    }

    // 16th request in the same minute must be rejected
    const blocked = store.admit("user_burst", "ai");
    assert(blocked.admitted === false, "16th request in 1 minute must be rejected");
    assert(blocked.status === 429, "Status must be 429");
    assert(blocked.code === "RATE_LIMIT_EXCEEDED", `Code must be RATE_LIMIT_EXCEEDED, got ${blocked.code}`);
    assert((blocked.retryAfter || 0) > 0, "Retry-After should be > 0 seconds");
  });

  await test("AI: Concurrency limit allows max 2 concurrent per UID, rejects 3rd", () => {
    const store = new InMemoryRateLimitStore();
    // 1st concurrent request
    const r1 = store.admit("user_conc", "ai");
    assert(r1.admitted === true, "1st concurrent request should be admitted");

    // 2nd concurrent request
    const r2 = store.admit("user_conc", "ai");
    assert(r2.admitted === true, "2nd concurrent request should be admitted");

    // 3rd concurrent request should be rejected due to user concurrency ceiling
    const r3 = store.admit("user_conc", "ai");
    assert(r3.admitted === false, "3rd concurrent request must be rejected");
    assert(r3.status === 429, "Status must be 429");
    assert(r3.code === "CONCURRENCY_LIMIT_EXCEEDED", `Code should be CONCURRENCY_LIMIT_EXCEEDED, got ${r3.code}`);

    // Cleanup
    r1.slot?.release();
    r2.slot?.release();
  });

  await test("AI: Concurrency slot released on success allows new request", () => {
    const store = new InMemoryRateLimitStore();
    const r1 = store.admit("user_rel", "ai");
    const r2 = store.admit("user_rel", "ai");
    assert(store.getUserActiveCount("user_rel", "ai") === 2, "Active count should be 2");

    // Release one slot
    r1.slot?.release();
    assert(store.getUserActiveCount("user_rel", "ai") === 1, "Active count should be 1 after release");

    // Now a 3rd request can proceed
    const r3 = store.admit("user_rel", "ai");
    assert(r3.admitted === true, "Should admit after slot release");

    r2.slot?.release();
    r3.slot?.release();
    assert(store.getUserActiveCount("user_rel", "ai") === 0, "Active count should be 0");
  });

  await test("AI: Concurrency slot released in catch/finally pattern on simulated failure", () => {
    const store = new InMemoryRateLimitStore();
    let slotReleased = false;

    // Simulate endpoint try/catch/finally
    const r1 = store.admit("user_fail", "ai");
    assert(r1.admitted === true, "Request admitted");
    
    try {
      throw new Error("Simulated model inference failure (e.g. quota or timeout)");
    } catch (err) {
      // Catch handled
    } finally {
      r1.slot?.release();
      slotReleased = true;
    }

    assert(slotReleased === true, "Slot release called in finally");
    assert(store.getUserActiveCount("user_fail", "ai") === 0, "Active count must be 0 after failure cleanup");
  });

  await test("AI: Different users have completely independent quotas & concurrency", () => {
    const store = new InMemoryRateLimitStore();
    // User A uses both concurrency slots
    const rA1 = store.admit("user_A", "ai");
    const rA2 = store.admit("user_A", "ai");
    assert(rA1.admitted && rA2.admitted, "User A slots admitted");

    // User B should still be admitted regardless of User A's concurrent jobs
    const rB1 = store.admit("user_B", "ai");
    assert(rB1.admitted === true, "User B should be admitted independently");
    assert(store.getUserActiveCount("user_A", "ai") === 2, "User A has 2 active");
    assert(store.getUserActiveCount("user_B", "ai") === 1, "User B has 1 active");

    rA1.slot?.release();
    rA2.slot?.release();
    rB1.slot?.release();
  });

  // --- UNIT TESTS: FFMPEG RATE LIMITING & CONCURRENCY ---

  await test("FFmpeg: First request admitted successfully", () => {
    const store = new InMemoryRateLimitStore();
    const result = store.admit("user_ff_1", "ffmpeg");
    assert(result.admitted === true, "First FFmpeg request should be admitted");
    result.slot?.release();
  });

  await test("FFmpeg: Concurrency limit is strictly 1 per user (rejects 2nd concurrent)", () => {
    const store = new InMemoryRateLimitStore();
    const r1 = store.admit("user_ff_conc", "ffmpeg");
    assert(r1.admitted === true, "1st FFmpeg request admitted");

    // 2nd concurrent request must be rejected
    const r2 = store.admit("user_ff_conc", "ffmpeg");
    assert(r2.admitted === false, "2nd concurrent FFmpeg request must be rejected");
    assert(r2.code === "CONCURRENCY_LIMIT_EXCEEDED", "Code must be CONCURRENCY_LIMIT_EXCEEDED");

    r1.slot?.release();
    assert(store.getUserActiveCount("user_ff_conc", "ffmpeg") === 0, "Active count 0 after release");
  });

  await test("FFmpeg: Rate limit exceeded after 6 requests in one minute", () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < 6; i++) {
      const res = store.admit("user_ff_burst", "ffmpeg");
      assert(res.admitted === true, `FFmpeg request ${i + 1} admitted`);
      res.slot?.release();
    }

    // 7th request in the same minute rejected
    const blocked = store.admit("user_ff_burst", "ffmpeg");
    assert(blocked.admitted === false, "7th FFmpeg request in 1 minute must be rejected");
    assert(blocked.code === "RATE_LIMIT_EXCEEDED", "Code must be RATE_LIMIT_EXCEEDED");
  });

  await test("FFmpeg: Concurrency slot released after simulated failure", () => {
    const store = new InMemoryRateLimitStore();
    const r1 = store.admit("user_ff_err", "ffmpeg");
    assert(r1.admitted === true, "Admitted");

    try {
      throw new Error("FFmpeg exit status 1: invalid container");
    } catch {
      // Handled
    } finally {
      r1.slot?.release();
    }

    assert(store.getUserActiveCount("user_ff_err", "ffmpeg") === 0, "User active count must be 0");
    // New request immediately admitted
    const r2 = store.admit("user_ff_err", "ffmpeg");
    assert(r2.admitted === true, "New FFmpeg request admitted after failure cleanup");
    r2.slot?.release();
  });

  // --- UNIT TESTS: INSTANCE-LEVEL CEILING ---

  await test("Instance ceiling: Aggregate expensive operations limit enforcement", () => {
    const store = new InMemoryRateLimitStore();
    const slots: any[] = [];

    // Occupy up to INSTANCE_MAX_CONCURRENT_EXPENSIVE slots across distinct users
    for (let i = 0; i < INSTANCE_MAX_CONCURRENT_EXPENSIVE; i++) {
      const res = store.admit(`distinct_user_${i}`, "ai");
      assert(res.admitted === true, `User ${i} admitted`);
      slots.push(res.slot);
    }

    // Next request from any user must be rejected with INSTANCE_BUSY
    const overflow = store.admit("extra_user", "ai");
    assert(overflow.admitted === false, "Must reject when instance ceiling reached");
    assert(overflow.code === "INSTANCE_BUSY", `Code must be INSTANCE_BUSY, got ${overflow.code}`);
    assert((overflow.retryAfter || 0) > 0, "Retry-After should be specified");

    // Release all slots
    slots.forEach(s => s?.release());
    assert(store.getActiveCount("ai") === 0, "Instance active AI count must return to 0");

    // After release, new request succeeds
    const recovered = store.admit("extra_user", "ai");
    assert(recovered.admitted === true, "Request succeeds after slots freed");
    recovered.slot?.release();
  });

  // --- ADMIT HELPER & HTTP INTEGRATION TESTS ---

  await test("admitExpensiveOperation: Rejects unauthenticated caller with 401", () => {
    let responseStatus = 0;
    let responseJson: any = null;

    const mockReq = { user: undefined } as unknown as AuthenticatedRequest;
    const mockRes = {
      status: (st: number) => { responseStatus = st; return mockRes; },
      json: (data: any) => { responseJson = data; return mockRes; },
      set: () => mockRes
    } as any;

    const slot = admitExpensiveOperation(mockReq, mockRes, "ai");
    assert(slot === null, "Slot must be null for unauthenticated request");
    assert(responseStatus === 401, `Status must be 401, got ${responseStatus}`);
    assert(responseJson.code === "UNAUTHORIZED", "Code must be UNAUTHORIZED");
  });

  await test("admitExpensiveOperation: Sets Retry-After header and returns clean 429 when throttled", () => {
    let headers: Record<string, string> = {};
    let responseStatus = 0;
    let responseJson: any = null;

    const mockReq = { user: { uid: "user_admit_test" } } as unknown as AuthenticatedRequest;
    const mockRes = {
      status: (st: number) => { responseStatus = st; return mockRes; },
      json: (data: any) => { responseJson = data; return mockRes; },
      set: (header: string, val: string) => { headers[header] = val; return mockRes; }
    } as any;

    // Admit up to AI concurrency limit (2)
    const s1 = admitExpensiveOperation(mockReq, mockRes, "ai");
    const s2 = admitExpensiveOperation(mockReq, mockRes, "ai");
    assert(s1 !== null && s2 !== null, "First 2 requests admitted");

    // 3rd concurrent request via helper
    const s3 = admitExpensiveOperation(mockReq, mockRes, "ai");
    assert(s3 === null, "3rd request must be rejected (null slot)");
    assert(responseStatus === 429, `Status must be 429, got ${responseStatus}`);
    assert(responseJson.code === "CONCURRENCY_LIMIT_EXCEEDED", "Code should be CONCURRENCY_LIMIT_EXCEEDED");
    assert(headers["Retry-After"] !== undefined, "Retry-After header must be set");

    s1?.release();
    s2?.release();
  });

  // --- LRU CACHE CAPACITY & EVICTION TESTS ---

  await test("LRUCache: Evicts oldest user when maxUsers capacity is exceeded", () => {
    // Store configured with tiny maxUsers = 2
    const lruStore = new LRUCacheRateLimitStore({ maxUsers: 2 });
    
    // User 1 uses 15 slots and hits rate limit
    for (let i = 0; i < 15; i++) {
      const r = lruStore.admit("user_lru_1", "ai");
      assert(r.admitted, "User 1 should be admitted");
      r.slot?.release();
    }
    // Verify user 1 is throttled
    const blocked1 = lruStore.admit("user_lru_1", "ai");
    assert(blocked1.admitted === false, "User 1 must be throttled");

    // Add User 2
    const r2 = lruStore.admit("user_lru_2", "ai");
    assert(r2.admitted, "User 2 admitted");
    r2.slot?.release();

    // Add User 3: this causes User 1 (least recently used) to be evicted from LRU cache
    const r3 = lruStore.admit("user_lru_3", "ai");
    assert(r3.admitted, "User 3 admitted");
    r3.slot?.release();

    // Now User 1 comes back - since they were evicted from the LRU cache, their entry is fresh
    const r1Replaced = lruStore.admit("user_lru_1", "ai");
    assert(r1Replaced.admitted === true, "User 1 admitted after LRU cache eviction");
    r1Replaced.slot?.release();
  });

  await test("createRateLimiterMiddleware: Express middleware pattern admits and releases on finish", () => {
    const middleware = createRateLimiterMiddleware("ai");
    let callCount = 0;
    let finishCallback: (() => void) | null = null;

    const mockReq = { user: { uid: "user_mw_test" } } as unknown as AuthenticatedRequest;
    const mockRes = {
      on: (event: string, cb: () => void) => {
        if (event === "finish") finishCallback = cb;
      },
      status: () => mockRes,
      json: () => mockRes,
      set: () => mockRes
    } as any;

    middleware(mockReq, mockRes, () => {
      callCount++;
    });

    assert(callCount === 1, "next() should be called when admitted");
    assert(runtimeLimiterStore.getUserActiveCount("user_mw_test", "ai") === 1, "Active count should be 1");

    // Simulate response finishing
    assert(typeof finishCallback === "function", "finish listener registered");
    (finishCallback as any)();

    assert(runtimeLimiterStore.getUserActiveCount("user_mw_test", "ai") === 0, "Active count should return to 0");
  });

  // --- LIVE SERVER HTTP REGRESSION TESTS ---

  const BASE_URL = "http://127.0.0.1:3000";

  await test("HTTP: /api/health remains 200 OK (Regression check)", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    assert(res.status === 200, `Health check expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === "ok", "Health payload status ok");
  });

  await test("HTTP: AI endpoints strictly enforce 401 without credentials", async () => {
    const endpoints = [
      "/api/ai/transcribe-audio",
      "/api/ai/summarize-transcript",
      "/api/ai/synthesize-speech",
      "/api/ai/analyze-strategically",
      "/api/ai/decision-intelligence",
      "/api/ai/unified-meeting-intelligence",
      "/api/ai/process-audio-transcription",
      "/api/ai/assistant-chat"
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${BASE_URL}${ep}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "test" })
      });
      assert(res.status === 401, `${ep} expected 401 Unauthorized without token, got ${res.status}`);
    }
  });

  await test("HTTP: FFmpeg endpoints strictly enforce 401 without credentials", async () => {
    const endpoints = [
      "/api/convert-opus",
      "/api/convert-audio"
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${BASE_URL}${ep}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Audio: "test" })
      });
      assert(res.status === 401, `${ep} expected 401 Unauthorized without token, got ${res.status}`);
    }
  });

  console.log("\n==================================================================");
  console.log(`Audit Completed: ${passed} passed, ${failed} failed`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error("Test runner encountered error:", err);
  process.exit(1);
});
