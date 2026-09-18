/**
 * ECHO NOTE — STEP 1F: BILLING RELIABILITY & IDEMPOTENCY AUDIT SUITE
 * 
 * Verifies:
 * 1. Top-up order fulfillment atomicity and entitlement granting
 * 2. Subscription fulfillment atomicity and tier limit updates
 * 3. Double-credit protection across verify-payment and webhook (Idempotency)
 * 4. Concurrent execution race condition prevention
 * 5. Cross-user tenant isolation (user ownership verification)
 * 6. Package tampering / amount mismatch rejection
 * 7. Missing order / invalid parameter handling
 */

import { 
  fulfillTopupOrder, 
  fulfillSubscriptionPayment, 
  SERVER_PLAN_LIMITS, 
  MINUTE_TOPUP_PACKAGES, 
  AI_REQUEST_TOPUP_PACKAGES,
  pendingSubscriptionsStore,
  pendingOrdersStore,
  processedPaymentsStore,
  isProductionEnvironment
} from "../middleware/billingFulfillment.ts";

class MockInMemoryFirestore {
  public store: Map<string, any> = new Map();
  public errorToThrow: any = null;
  private txnLock: Promise<void> = Promise.resolve();

  private getKey(collection: string, docId: string): string {
    return `${collection}/${docId}`;
  }

  public collection(collectionName: string) {
    const self = this;
    return {
      doc(docId: string) {
        const key = self.getKey(collectionName, docId);
        return {
          id: docId,
          path: key,
          async get() {
            const has = self.store.has(key);
            const val = has ? JSON.parse(JSON.stringify(self.store.get(key))) : undefined;
            return {
              exists: has,
              id: docId,
              data: () => val
            };
          },
          async set(data: any, options?: { merge?: boolean }) {
            if (options?.merge && self.store.has(key)) {
              const current = self.store.get(key);
              const merged = { ...current };
              self.applyData(merged, data);
              self.store.set(key, merged);
            } else {
              const obj: any = {};
              self.applyData(obj, data);
              self.store.set(key, obj);
            }
          }
        };
      }
    };
  }

  public applyData(target: any, patch: any) {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object") {
        if ("operand" in v) {
          target[k] = (target[k] || 0) + (v as any).operand;
          continue;
        }
        if (v.constructor?.name === "ServerTimestampTransform" || (v as any).__serverTimestamp) {
          target[k] = new Date().toISOString();
          continue;
        }
      }
      target[k] = v;
    }
  }

  public async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    const prevLock = this.txnLock;
    let release: () => void;
    this.txnLock = new Promise((resolve) => { release = resolve; });

    await prevLock;
    try {
      if (this.errorToThrow) {
        throw this.errorToThrow;
      }
      const stagedWrites: Array<() => void> = [];
      const self = this;

      const mockTxn = {
        async get(docRef: any) {
          return await docRef.get();
        },
        set(docRef: any, data: any, options?: { merge?: boolean }) {
          stagedWrites.push(() => {
            const key = docRef.path;
            if (options?.merge && self.store.has(key)) {
              const current = self.store.get(key);
              const merged = { ...current };
              self.applyData(merged, data);
              self.store.set(key, merged);
            } else {
              const obj: any = {};
              self.applyData(obj, data);
              self.store.set(key, obj);
            }
          });
        }
      };

      const result = await updateFunction(mockTxn);
      for (const write of stagedWrites) {
        write();
      }
      return result;
    } finally {
      release!();
    }
  }
}

async function runTests() {
  console.log("===============================================================");
  console.log("🚀 STARTING ECHO NOTE BILLING RELIABILITY & IDEMPOTENCY TESTS");
  console.log("===============================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`• ${testName}... ✅ PASSED`);
      passed++;
    } else {
      console.error(`• ${testName}... ❌ FAILED ${detail ? `(${detail})` : ""}`);
      failed++;
    }
  }

  // TEST 1: Top-Up Minute Fulfillment creates all documents correctly
  {
    const db = new MockInMemoryFirestore();
    const userId = "user-alice";
    const orderId = "order_min_001";
    const paymentId = "pay_min_001";

    // Seed User and Order
    await db.collection("users").doc(userId).set({
      plan: "free",
      extraMinutes: 0,
      minuteTopupBalance: 0
    });
    await db.collection("orders").doc(orderId).set({
      orderId,
      userId,
      amount: 9900,
      amountInPaise: 9900,
      type: "minutes",
      minutes: 100,
      status: "created"
    });

    const res = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      callerUserId: userId,
      source: "verify-payment"
    });

    const userDoc = await db.collection("users").doc(userId).get();
    const orderDoc = await db.collection("orders").doc(orderId).get();
    const txnDoc = await db.collection("transactions").doc(paymentId).get();

    assert(
      res.success === true &&
      res.alreadyProcessed === false &&
      res.minutes === 100 &&
      userDoc.data().extraMinutes === 100 &&
      userDoc.data().minuteTopupBalance === 100 &&
      orderDoc.data().status === "paid" &&
      orderDoc.data().paymentId === paymentId &&
      txnDoc.data().status === "success" &&
      txnDoc.data().minutes === 100,
      "Top-up order fulfills minutes and writes ledger transaction atomically"
    );
  }

  // TEST 2: Double-Credit Protection (Webhook + verify-payment idempotency)
  {
    const db = new MockInMemoryFirestore();
    const userId = "user-bob";
    const orderId = "order_min_002";
    const paymentId = "pay_min_002";

    await db.collection("users").doc(userId).set({
      plan: "free",
      extraMinutes: 50,
      minuteTopupBalance: 50
    });
    await db.collection("orders").doc(orderId).set({
      orderId,
      userId,
      amount: 29900,
      amountInPaise: 29900,
      type: "minutes",
      minutes: 350,
      status: "created"
    });

    // Step 1: verify-payment finishes first
    const res1 = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      callerUserId: userId,
      source: "verify-payment"
    });

    // Step 2: Webhook arrives later for the same paymentId
    const res2 = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      source: "webhook"
    });

    const userDoc = await db.collection("users").doc(userId).get();

    assert(
      res1.success === true &&
      res1.alreadyProcessed === false &&
      res2.success === true &&
      res2.alreadyProcessed === true &&
      userDoc.data().extraMinutes === 400 && // 50 initial + 350 once = exactly 400, not 750!
      userDoc.data().minuteTopupBalance === 400,
      "Idempotency: Webhook arriving after verify-payment does NOT double-credit minutes"
    );
  }

  // TEST 3: Concurrent calls simulate both arriving in flight
  {
    const db = new MockInMemoryFirestore();
    const userId = "user-charlie";
    const orderId = "order_ai_001";
    const paymentId = "pay_ai_001";

    await db.collection("users").doc(userId).set({
      plan: "pro",
      thinkingTopupBalance: 20
    });
    await db.collection("orders").doc(orderId).set({
      orderId,
      userId,
      amount: 39900,
      amountInPaise: 39900,
      type: "ai_requests",
      requests: 500,
      status: "created"
    });

    // Simulate parallel requests
    const [callA, callB] = await Promise.all([
      fulfillTopupOrder(db as any, {
        orderId,
        paymentId,
        callerUserId: userId,
        source: "verify-payment"
      }),
      fulfillTopupOrder(db as any, {
        orderId,
        paymentId,
        source: "webhook"
      })
    ]);

    const userDoc = await db.collection("users").doc(userId).get();

    const oneProcessed = (callA.alreadyProcessed && !callB.alreadyProcessed) || (!callA.alreadyProcessed && callB.alreadyProcessed);

    assert(
      callA.success && callB.success &&
      oneProcessed &&
      userDoc.data().thinkingTopupBalance === 520, // 20 + 500 = exactly 520, not 1020!
      "Concurrent top-up order calls result in exactly one fulfillment and one duplicate detection"
    );
  }

  // TEST 4: Subscription Fulfillment activates plan and updates limits
  {
    const db = new MockInMemoryFirestore();
    const userId = "user-david";
    const subscriptionId = "sub_pro_001";
    const paymentId = "pay_sub_001";

    await db.collection("users").doc(userId).set({
      plan: "free",
      monthlyMinuteLimit: 60,
      monthlyThinkingLimit: 10
    });
    await db.collection("subscriptions").doc(subscriptionId).set({
      subscriptionId,
      userId,
      planId: "pro",
      billingCycle: "monthly",
      status: "created"
    });

    const res = await fulfillSubscriptionPayment(db as any, {
      subscriptionId,
      paymentId,
      callerUserId: userId,
      source: "verify-payment"
    });

    const userDoc = await db.collection("users").doc(userId).get();
    const subDoc = await db.collection("subscriptions").doc(subscriptionId).get();
    const txnDoc = await db.collection("transactions").doc(paymentId).get();

    assert(
      res.success === true &&
      res.alreadyProcessed === false &&
      userDoc.data().plan === "pro" &&
      userDoc.data().monthlyMinuteLimit === SERVER_PLAN_LIMITS.pro.minutes &&
      userDoc.data().monthlyThinkingLimit === SERVER_PLAN_LIMITS.pro.thinking &&
      subDoc.data().status === "active" &&
      txnDoc.data().status === "success" &&
      txnDoc.data().planId === "pro",
      "Subscription fulfillment activates PRO plan and updates limits atomically"
    );
  }

  // TEST 5: Subscription Idempotency prevents duplicate activation charges
  {
    const db = new MockInMemoryFirestore();
    const userId = "user-eve";
    const subscriptionId = "sub_team_001";
    const paymentId = "pay_team_001";

    await db.collection("users").doc(userId).set({ plan: "free" });
    await db.collection("subscriptions").doc(subscriptionId).set({
      subscriptionId,
      userId,
      planId: "team",
      billingCycle: "yearly",
      status: "created"
    });

    const res1 = await fulfillSubscriptionPayment(db as any, {
      subscriptionId,
      paymentId,
      callerUserId: userId,
      source: "verify-payment"
    });

    const res2 = await fulfillSubscriptionPayment(db as any, {
      subscriptionId,
      paymentId,
      source: "webhook"
    });

    const userDoc = await db.collection("users").doc(userId).get();

    assert(
      res1.success === true &&
      res1.alreadyProcessed === false &&
      res2.success === true &&
      res2.alreadyProcessed === true &&
      userDoc.data().plan === "team" &&
      userDoc.data().monthlyMinuteLimit === SERVER_PLAN_LIMITS.team.minutes,
      "Subscription idempotency returns alreadyProcessed on duplicate webhook payment"
    );
  }

  // TEST 6: Tenant Isolation — Caller User ID mismatch is strictly rejected
  {
    const db = new MockInMemoryFirestore();
    const legitimateOwner = "user-alice";
    const attacker = "user-mallory";
    const orderId = "order_min_hack";
    const paymentId = "pay_min_hack";

    await db.collection("orders").doc(orderId).set({
      orderId,
      userId: legitimateOwner,
      amount: 9900,
      type: "minutes",
      minutes: 100,
      status: "created"
    });

    const res = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      callerUserId: attacker, // Attacker tries to claim Alice's order
      source: "verify-payment"
    });

    assert(
      res.success === false &&
      res.statusCode === 403 &&
      res.errorCode === "FORBIDDEN",
      "Tenant Isolation: Order claim with mismatched caller UID is rejected with 403 Forbidden"
    );
  }

  // TEST 7: Tampering Protection — Amount mismatch with package definition is rejected
  {
    const db = new MockInMemoryFirestore();
    const userId = "user-frank";
    const orderId = "order_tampered";
    const paymentId = "pay_tampered";

    // Tampered order claiming 1000 minutes for only 9900 paise
    await db.collection("orders").doc(orderId).set({
      orderId,
      userId,
      amount: 9900,
      type: "minutes",
      minutes: 1000, // Tampered!
      status: "created"
    });

    const res = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      callerUserId: userId,
      source: "verify-payment"
    });

    // Our server-authoritative logic forces validated minutes to 100 based on verified 9900 amount
    assert(
      res.success === true &&
      res.minutes === 100, // Validated against verified amount, not caller's 1000!
      "Server-authoritative entitlement resolves package strictly from verified amount"
    );
  }

  // TEST 8: Missing Order Record yields 404
  {
    const db = new MockInMemoryFirestore();
    const res = await fulfillTopupOrder(db as any, {
      orderId: "order_non_existent",
      paymentId: "pay_unknown",
      source: "verify-payment"
    });

    assert(
      res.success === false &&
      res.statusCode === 404 &&
      res.errorCode === "ORDER_NOT_FOUND",
      "Missing order document returns 404 ORDER_NOT_FOUND"
    );
  }

  // TEST 9: Plan Limits Consistency
  {
    assert(
      SERVER_PLAN_LIMITS.free.minutes === 60 &&
      SERVER_PLAN_LIMITS.pro.minutes === 1200 &&
      SERVER_PLAN_LIMITS.team.minutes === 5000 &&
      SERVER_PLAN_LIMITS.enterprise.minutes === 25000,
      "SERVER_PLAN_LIMITS are exactly consistent with documented tier quotas"
    );
  }

  // =========================================================================
  // STEP 1K PRODUCTION-SAFE BILLING FALLBACK BOUNDARY TESTS
  // =========================================================================

  // TEST 10: Production Firestore PERMISSION_DENIED on topup fulfillment fails closed
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.RAZORPAY_MODE;

    const db = new MockInMemoryFirestore();
    const orderId = "order_prod_perm_fail";
    const paymentId = "pay_prod_perm_fail";

    // Set permission denied error
    db.errorToThrow = {
      message: "7 PERMISSION_DENIED: Missing or insufficient permissions.",
      code: 7
    };

    const res = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      callerUserId: "user-prod-fail",
      source: "verify-payment"
    });

    assert(
      res.success === false &&
      res.statusCode === 500 &&
      res.errorCode === "DATABASE_TRANSACTION_FAILED" &&
      !processedPaymentsStore.has(paymentId),
      "Production PERMISSION_DENIED fails closed: returns 500 DATABASE_TRANSACTION_FAILED, no memory fallback"
    );

    process.env.NODE_ENV = originalEnv;
  }

  // TEST 11: Production Firestore PERMISSION_DENIED on subscription fulfillment fails closed
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.RAZORPAY_MODE;

    const db = new MockInMemoryFirestore();
    const subscriptionId = "sub_prod_perm_fail";
    const paymentId = "pay_sub_prod_perm_fail";

    db.errorToThrow = {
      message: "7 PERMISSION_DENIED: Missing or insufficient permissions.",
      code: 7
    };

    const res = await fulfillSubscriptionPayment(db as any, {
      subscriptionId,
      paymentId,
      callerUserId: "user-sub-fail",
      source: "verify-payment",
      planIdHint: "pro",
      billingCycleHint: "monthly"
    });

    assert(
      res.success === false &&
      res.statusCode === 500 &&
      res.errorCode === "DATABASE_TRANSACTION_FAILED" &&
      !processedPaymentsStore.has(paymentId),
      "Production subscription PERMISSION_DENIED fails closed: returns 500 DATABASE_TRANSACTION_FAILED, no tier upgrade"
    );

    process.env.NODE_ENV = originalEnv;
  }

  // TEST 12: Production Firestore UNAVAILABLE / transaction failure fails closed
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.RAZORPAY_MODE;

    const db = new MockInMemoryFirestore();
    db.errorToThrow = {
      message: "14 UNAVAILABLE: The service is currently unavailable.",
      code: 14
    };

    const topupRes = await fulfillTopupOrder(db as any, {
      orderId: "order_prod_unavail",
      paymentId: "pay_prod_unavail",
      source: "verify-payment"
    });

    const subRes = await fulfillSubscriptionPayment(db as any, {
      subscriptionId: "sub_prod_unavail",
      paymentId: "pay_sub_prod_unavail",
      source: "verify-payment"
    });

    assert(
      topupRes.success === false &&
      topupRes.statusCode === 500 &&
      topupRes.errorCode === "DATABASE_TRANSACTION_FAILED" &&
      subRes.success === false &&
      subRes.statusCode === 500 &&
      subRes.errorCode === "DATABASE_TRANSACTION_FAILED",
      "Production Firestore UNAVAILABLE fails closed with 500 DATABASE_TRANSACTION_FAILED"
    );

    process.env.NODE_ENV = originalEnv;
  }

  // TEST 13: Non-production Firestore permission failure triggers fallback safely
  {
    const originalEnv = process.env.NODE_ENV;
    const originalMode = process.env.RAZORPAY_MODE;
    process.env.NODE_ENV = "development";
    delete process.env.RAZORPAY_MODE;

    const db = new MockInMemoryFirestore();
    const orderId = "order_dev_fallback_001";
    const paymentId = "pay_dev_fallback_001";
    const userId = "user-dev-fallback";

    // In non-prod dev, seed pending order in memory
    pendingOrdersStore.set(orderId, {
      orderId,
      userId,
      amount: 9900,
      currency: "INR",
      type: "minutes",
      minutes: 100,
      requests: 0,
      status: "created",
      createdAt: new Date()
    });

    // Simulate IAM permission denied
    db.errorToThrow = {
      message: "7 PERMISSION_DENIED: Missing or insufficient permissions.",
      code: 7
    };

    const res = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      callerUserId: userId,
      source: "verify-payment"
    });

    assert(
      res.success === true &&
      res.minutes === 100 &&
      processedPaymentsStore.has(paymentId),
      "Non-production Firestore permission failure permits safe development in-memory fallback"
    );

    // Clean up memory store
    pendingOrdersStore.delete(orderId);
    processedPaymentsStore.delete(paymentId);
    process.env.NODE_ENV = originalEnv;
    if (originalMode) process.env.RAZORPAY_MODE = originalMode;
  }

  // TEST 14: Duplicate verification in production
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.RAZORPAY_MODE;

    const db = new MockInMemoryFirestore();
    const userId = "user-dup-prod";
    const orderId = "order_dup_prod_001";
    const paymentId = "pay_dup_prod_001";

    await db.collection("users").doc(userId).set({
      plan: "free",
      extraMinutes: 0,
      minuteTopupBalance: 0
    });

    await db.collection("orders").doc(orderId).set({
      orderId,
      userId,
      amount: 9900,
      type: "minutes",
      minutes: 100,
      status: "created"
    });

    // First verification
    const res1 = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      callerUserId: userId,
      source: "verify-payment"
    });

    // Second (duplicate) verification
    const res2 = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      callerUserId: userId,
      source: "verify-payment"
    });

    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();

    assert(
      res1.success === true &&
      res1.alreadyProcessed === false &&
      res2.success === true &&
      res2.alreadyProcessed === true &&
      userData.extraMinutes === 100, // Exactly 100, not double credited!
      "Duplicate verification in production is idempotent and returns alreadyProcessed: true without double-credit"
    );

    process.env.NODE_ENV = originalEnv;
  }

  // TEST 15: Concurrent verification in production
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.RAZORPAY_MODE;

    const db = new MockInMemoryFirestore();
    const userId = "user-conc-prod";
    const orderId = "order_conc_prod_001";
    const paymentId = "pay_conc_prod_001";

    await db.collection("users").doc(userId).set({
      plan: "free",
      extraMinutes: 0,
      minuteTopupBalance: 0
    });

    await db.collection("orders").doc(orderId).set({
      orderId,
      userId,
      amount: 9900,
      type: "minutes",
      minutes: 100,
      status: "created"
    });

    // Run 5 concurrent verify attempts
    const results = await Promise.all([
      fulfillTopupOrder(db as any, { orderId, paymentId, callerUserId: userId, source: "verify-payment" }),
      fulfillTopupOrder(db as any, { orderId, paymentId, callerUserId: userId, source: "verify-payment" }),
      fulfillTopupOrder(db as any, { orderId, paymentId, callerUserId: userId, source: "verify-payment" }),
      fulfillTopupOrder(db as any, { orderId, paymentId, callerUserId: userId, source: "verify-payment" }),
      fulfillTopupOrder(db as any, { orderId, paymentId, callerUserId: userId, source: "verify-payment" })
    ]);

    const initialFulfillments = results.filter(r => r.success && !r.alreadyProcessed);
    const idempotentFulfillments = results.filter(r => r.success && r.alreadyProcessed);

    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();

    assert(
      initialFulfillments.length === 1 &&
      idempotentFulfillments.length === 4 &&
      userData.extraMinutes === 100,
      "Concurrent verification race in production resolves with exactly 1 credit and 4 idempotent results"
    );

    process.env.NODE_ENV = originalEnv;
  }

  // TEST 16: Webhook + verify-payment race in production
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.RAZORPAY_MODE;

    const db = new MockInMemoryFirestore();
    const userId = "user-race-prod";
    const subscriptionId = "sub_race_prod_001";
    const paymentId = "pay_race_prod_001";

    await db.collection("users").doc(userId).set({
      plan: "free",
      monthlyMinuteLimit: 60
    });

    await db.collection("subscriptions").doc(subscriptionId).set({
      subscriptionId,
      userId,
      planId: "pro",
      billingCycle: "monthly",
      status: "created"
    });

    // Simulate parallel race between client verify-payment call and Razorpay webhook
    const [clientRes, webhookRes] = await Promise.all([
      fulfillSubscriptionPayment(db as any, {
        subscriptionId,
        paymentId,
        callerUserId: userId,
        source: "verify-payment"
      }),
      fulfillSubscriptionPayment(db as any, {
        subscriptionId,
        paymentId,
        callerUserId: userId,
        source: "webhook"
      })
    ]);

    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();

    const nonDupCount = [clientRes, webhookRes].filter(r => r.success && !r.alreadyProcessed).length;
    const dupCount = [clientRes, webhookRes].filter(r => r.success && r.alreadyProcessed).length;

    assert(
      clientRes.success &&
      webhookRes.success &&
      nonDupCount === 1 &&
      dupCount === 1 &&
      userData.plan === "pro" &&
      userData.monthlyMinuteLimit === 1200,
      "Webhook + verify-payment race in production resolves atomically to active Pro tier without conflict"
    );

    process.env.NODE_ENV = originalEnv;
  }

  // TEST 17: Missing order / missing subscription in production fails closed (no memory fallback)
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.RAZORPAY_MODE;

    const db = new MockInMemoryFirestore();
    const missingOrderId = "order_prod_missing_999";
    const missingSubId = "sub_prod_missing_999";

    // Even if memory stores happen to hold records, production must ignore them
    pendingOrdersStore.set(missingOrderId, {
      orderId: missingOrderId,
      userId: "user-attacker",
      amount: 9900,
      currency: "INR",
      type: "minutes",
      minutes: 100,
      status: "created",
      createdAt: new Date()
    });

    pendingSubscriptionsStore.set(missingSubId, {
      subscriptionId: missingSubId,
      userId: "user-attacker",
      planId: "team",
      billingCycle: "yearly",
      status: "created",
      createdAt: new Date()
    });

    const topupRes = await fulfillTopupOrder(db as any, {
      orderId: missingOrderId,
      paymentId: "pay_missing_order",
      source: "verify-payment"
    });

    const subRes = await fulfillSubscriptionPayment(db as any, {
      subscriptionId: missingSubId,
      paymentId: "pay_missing_sub",
      source: "verify-payment"
    });

    assert(
      topupRes.success === false &&
      topupRes.statusCode === 404 &&
      topupRes.errorCode === "ORDER_NOT_FOUND" &&
      subRes.success === false &&
      subRes.statusCode === 404 &&
      subRes.errorCode === "SUBSCRIPTION_NOT_FOUND",
      "Missing records in production fail closed with 404; in-memory fallback stores are strictly ignored"
    );

    // Clean up test items from memory store
    pendingOrdersStore.delete(missingOrderId);
    pendingSubscriptionsStore.delete(missingSubId);
    process.env.NODE_ENV = originalEnv;
  }

  // TEST 18: Verification with tampered amount / package in production
  {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    delete process.env.RAZORPAY_MODE;

    const db = new MockInMemoryFirestore();
    const userId = "user-tamper-prod";
    const orderId = "order_tamper_prod_001";
    const paymentId = "pay_tamper_prod_001";

    // Order created with amount 29900 (350 minutes)
    await db.collection("orders").doc(orderId).set({
      orderId,
      userId,
      amount: 29900,
      type: "minutes",
      minutes: 99999, // Tampered client payload
      status: "created"
    });

    await db.collection("users").doc(userId).set({
      plan: "free",
      extraMinutes: 0
    });

    const res = await fulfillTopupOrder(db as any, {
      orderId,
      paymentId,
      callerUserId: userId,
      source: "verify-payment"
    });

    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();

    assert(
      res.success === true &&
      res.minutes === 350 &&
      userData.extraMinutes === 350,
      "Verification in production strictly enforces server-authoritative package quotas over tampered amounts"
    );

    process.env.NODE_ENV = originalEnv;
  }

  console.log("===============================================================");
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
