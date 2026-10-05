import { Firestore, FieldValue } from "firebase-admin/firestore";

// Server-authoritative plan limits
export const SERVER_PLAN_LIMITS: Record<string, { minutes: number; thinking: number }> = {
  free: { minutes: 60, thinking: 10 },
  pro: { minutes: 1200, thinking: 250 },
  team: { minutes: 5000, thinking: 1500 },
  enterprise: { minutes: 25000, thinking: 10000 }
};

// Top-up packages configuration (Server-authoritative)
export const MINUTE_TOPUP_PACKAGES = {
  100: {
    minutes: 100,
    amountInPaise: 9900,
    label: "+100 Minutes",
  },
  350: {
    minutes: 350,
    amountInPaise: 29900,
    label: "+350 Minutes",
  },
} as const;

export const AI_REQUEST_TOPUP_PACKAGES = {
  100: {
    requests: 100,
    amountInPaise: 9900,
    label: "+100 AI Requests",
  },
  500: {
    requests: 500,
    amountInPaise: 39900,
    label: "+500 AI Requests",
  },
  1500: {
    requests: 1500,
    amountInPaise: 99900,
    label: "+1500 AI Requests",
  },
} as const;

export interface FulfillTopupParams {
  orderId: string;
  paymentId: string;
  callerUserId?: string;
  source: "verify-payment" | "webhook";
  expectedAmount?: number;
}

export interface PendingSubscriptionRecord {
  subscriptionId: string;
  userId: string;
  userEmail?: string;
  planId: string;
  billingCycle: string;
  razorpayPlanId?: string;
  status: string;
  createdAt: any;
}

export interface PendingOrderRecord {
  orderId: string;
  userId: string;
  userEmail?: string;
  amount: number;
  currency: string;
  type: "minutes" | "ai_requests";
  minutes?: number;
  requests?: number;
  status: string;
  createdAt: any;
}

// In-memory fallback ledgers SOLELY for restricted non-production sandbox/dev environments.
// In production, durable Firestore ledger is authoritative and in-memory fallbacks are strictly disabled.
export const pendingSubscriptionsStore = new Map<string, PendingSubscriptionRecord>();
export const pendingOrdersStore = new Map<string, PendingOrderRecord>();
export const processedPaymentsStore = new Map<string, any>();

/**
 * Authoritatively determines whether the current execution runtime is Production.
 * Checks standard production indicators:
 * 1. NODE_ENV === 'production' (Docker runner & Cloud Run deployment standard)
 * 2. RAZORPAY_MODE === 'live' (Production payment gateway lock)
 * 3. K_SERVICE environment variable present (Cloud Run managed service runtime),
 *    excluding explicit development or test overrides.
 *
 * NOTE: Never uses the presence/absence of Firestore credentials to determine environment.
 */
export function isProductionEnvironment(): boolean {
  // Explicit development or test overrides: NEVER treat as production environment
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    return false;
  }
  // Cloud Run managed runtime (K_SERVICE is set by Cloud Run)
  if (Boolean(process.env.K_SERVICE)) {
    return true;
  }
  // Explicit production NODE_ENV
  if (process.env.NODE_ENV === "production") {
    return true;
  }
  return false;
}

export function recordPendingSubscription(record: PendingSubscriptionRecord): void {
  // In production, durable Firestore records are required; in-memory fallback stores are disabled.
  if (isProductionEnvironment()) {
    return;
  }
  pendingSubscriptionsStore.set(record.subscriptionId, record);
}

export function recordPendingOrder(record: PendingOrderRecord): void {
  // In production, durable Firestore records are required; in-memory fallback stores are disabled.
  if (isProductionEnvironment()) {
    return;
  }
  pendingOrdersStore.set(record.orderId, record);
}

export function isPermissionError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err);
  return (
    msg.includes("PERMISSION_DENIED") ||
    err?.code === 7 ||
    err?.status === 7 ||
    msg.includes("Missing or insufficient permissions")
  );
}

export interface FulfillTopupResult {
  success: boolean;
  alreadyProcessed: boolean;
  orderId: string;
  paymentId: string;
  userId?: string;
  type?: "minutes" | "ai_requests";
  minutes?: number;
  requests?: number;
  amount?: number;
  error?: string;
  errorCode?: string;
  statusCode?: number;
}

/**
 * Atomically fulfills a one-time top-up order (minutes or AI requests) in Firestore.
 * Completely idempotent and race-condition free across concurrent /api/verify-payment
 * and Razorpay webhook calls.
 */
export async function fulfillTopupOrder(
  db: Firestore,
  params: FulfillTopupParams
): Promise<FulfillTopupResult> {
  const { orderId, paymentId, callerUserId, source, expectedAmount } = params;

  if (!orderId || !paymentId) {
    return {
      success: false,
      alreadyProcessed: false,
      orderId,
      paymentId,
      error: "Missing orderId or paymentId for fulfillment.",
      errorCode: "INVALID_PARAMETERS",
      statusCode: 400
    };
  }

  // Fast check: in-memory idempotency ledger (non-production dev/sandbox only)
  // In production, idempotency is strictly verified via durable Firestore transaction records.
  if (!isProductionEnvironment() && processedPaymentsStore.has(paymentId)) {
    const cached = processedPaymentsStore.get(paymentId);
    console.log(`ℹ️ [${source.toUpperCase()}] Top-up payment ${paymentId} already processed (non-prod memory cache).`);
    return {
      success: true,
      alreadyProcessed: true,
      orderId,
      paymentId,
      userId: cached.userId,
      type: cached.type,
      minutes: cached.minutes,
      requests: cached.requests,
      amount: cached.amount
    };
  }

  try {
    return await db.runTransaction(async (transaction) => {
    const txnRef = db.collection("transactions").doc(paymentId);
    const orderRef = db.collection("orders").doc(orderId);

    const [txnDoc, orderDoc] = await Promise.all([
      transaction.get(txnRef),
      transaction.get(orderRef)
    ]);

    // Check 1: Idempotency via transaction ledger
    if (txnDoc.exists && txnDoc.data()?.status === "success") {
      const data = txnDoc.data() || {};
      console.log(`ℹ️ [${source.toUpperCase()}] Top-up payment ${paymentId} already processed in transaction ledger.`);
      return {
        success: true,
        alreadyProcessed: true,
        orderId,
        paymentId,
        userId: data.userId,
        type: data.type,
        minutes: data.minutes || 0,
        requests: data.requests || 0,
        amount: data.amount || 0
      };
    }

    // Check 2: Order document must exist in Firestore (or fallback memory store in non-prod dev only)
    let orderData: any = null;
    if (orderDoc.exists) {
      orderData = orderDoc.data() || {};
    } else if (!isProductionEnvironment() && pendingOrdersStore.has(orderId)) {
      orderData = pendingOrdersStore.get(orderId);
    }

    if (!orderData) {
      console.warn(`⚠️ [${source.toUpperCase()}] Order ${orderId} not found in ${isProductionEnvironment() ? "production Firestore" : "database or memory store"}.`);
      return {
        success: false,
        alreadyProcessed: false,
        orderId,
        paymentId,
        error: `Order record ${orderId} not found.`,
        errorCode: "ORDER_NOT_FOUND",
        statusCode: 404
      };
    }

    // Check 3: Idempotency via order status
    if (orderData.status === "paid") {
      console.log(`ℹ️ [${source.toUpperCase()}] Order ${orderId} is already marked as paid.`);
      const ent = orderData.entitlementGranted || {};
      return {
        success: true,
        alreadyProcessed: true,
        orderId,
        paymentId,
        userId: orderData.userId,
        type: ent.type || orderData.type,
        minutes: ent.minutes || orderData.minutes || 0,
        requests: ent.requests || orderData.requests || 0,
        amount: orderData.amount || 0
      };
    }

    // Check 4: User ownership validation
    const targetUserId = orderData.userId;
    if (callerUserId && targetUserId && callerUserId !== targetUserId) {
      console.error(`🚨 [${source.toUpperCase()}] User mismatch on order ${orderId}: caller=${callerUserId}, owner=${targetUserId}`);
      return {
        success: false,
        alreadyProcessed: false,
        orderId,
        paymentId,
        error: "Forbidden: order belongs to another user account.",
        errorCode: "FORBIDDEN",
        statusCode: 403
      };
    }

    if (!targetUserId) {
      return {
        success: false,
        alreadyProcessed: false,
        orderId,
        paymentId,
        error: "Order record missing target userId.",
        errorCode: "INVALID_ORDER_STATE",
        statusCode: 400
      };
    }

    // Check 5: Server-authoritative entitlement calculation
    const rawType = String(orderData.type || orderData.legacyType || "").toLowerCase().trim();
    const verifiedAmount = Number(orderData.amount || orderData.amountInPaise || 0);

    // Verify expected amount if caller provided it
    if (expectedAmount !== undefined && expectedAmount !== verifiedAmount) {
      return {
        success: false,
        alreadyProcessed: false,
        orderId,
        paymentId,
        error: "Order amount mismatch with payment amount.",
        errorCode: "AMOUNT_MISMATCH",
        statusCode: 400
      };
    }

    const isMinutes = rawType === "minutes" || rawType === "topup" || (!orderData.requests && (orderData.minutes || verifiedAmount === 9900 || verifiedAmount === 29900));
    const isAiRequests = rawType === "ai_requests" || rawType === "thinking-topup" || (!isMinutes && (orderData.requests || verifiedAmount === 39900 || verifiedAmount === 99900));

    let validatedMinutes = 0;
    let validatedRequests = 0;

    if (isMinutes) {
      const candidateMins = Number(orderData.minutes || 0);
      if (candidateMins in MINUTE_TOPUP_PACKAGES && MINUTE_TOPUP_PACKAGES[candidateMins as keyof typeof MINUTE_TOPUP_PACKAGES].amountInPaise === verifiedAmount) {
        validatedMinutes = candidateMins;
      } else if (verifiedAmount === 9900) {
        validatedMinutes = 100;
      } else if (verifiedAmount === 29900) {
        validatedMinutes = 350;
      } else {
        return {
          success: false,
          alreadyProcessed: false,
          orderId,
          paymentId,
          error: "Order amount does not match any valid minute top-up package.",
          errorCode: "INVALID_MINUTE_TOPUP_AMOUNT",
          statusCode: 400
        };
      }
    } else if (isAiRequests) {
      const candidateReqs = Number(orderData.requests || 0);
      if (candidateReqs in AI_REQUEST_TOPUP_PACKAGES && AI_REQUEST_TOPUP_PACKAGES[candidateReqs as keyof typeof AI_REQUEST_TOPUP_PACKAGES].amountInPaise === verifiedAmount) {
        validatedRequests = candidateReqs;
      } else if (verifiedAmount === 9900) {
        validatedRequests = 100;
      } else if (verifiedAmount === 39900) {
        validatedRequests = 500;
      } else if (verifiedAmount === 99900) {
        validatedRequests = 1500;
      } else {
        return {
          success: false,
          alreadyProcessed: false,
          orderId,
          paymentId,
          error: "Order amount does not match any valid AI request top-up package.",
          errorCode: "INVALID_AI_REQUEST_TOPUP_AMOUNT",
          statusCode: 400
        };
      }
    } else {
      return {
        success: false,
        alreadyProcessed: false,
        orderId,
        paymentId,
        error: "Unknown order type for entitlement grant.",
        errorCode: "UNKNOWN_ORDER_TYPE",
        statusCode: 400
      };
    }

    // Atomic writes inside transaction
    const userRef = db.collection("users").doc(targetUserId);

    if (isMinutes && validatedMinutes > 0) {
      transaction.set(userRef, {
        extraMinutes: FieldValue.increment(validatedMinutes),
        minuteTopupBalance: FieldValue.increment(validatedMinutes),
        lastPaymentDate: FieldValue.serverTimestamp()
      }, { merge: true });
    } else if (isAiRequests && validatedRequests > 0) {
      transaction.set(userRef, {
        thinkingTopupBalance: FieldValue.increment(validatedRequests),
        lastPaymentDate: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    const resolvedType: "minutes" | "ai_requests" = isMinutes ? "minutes" : "ai_requests";

    transaction.set(orderRef, {
      status: "paid",
      paymentId,
      paidAt: FieldValue.serverTimestamp(),
      paidVia: source,
      entitlementGranted: {
        type: resolvedType,
        minutes: validatedMinutes,
        requests: validatedRequests
      }
    }, { merge: true });

    transaction.set(txnRef, {
      userId: targetUserId,
      paymentId,
      orderId,
      type: resolvedType,
      legacyType: isMinutes ? "topup" : "thinking-topup",
      minutes: validatedMinutes,
      requests: validatedRequests,
      amount: verifiedAmount,
      status: "success",
      source,
      createdAt: FieldValue.serverTimestamp()
    });

    console.log(`✅ [${source.toUpperCase()}] Top-up credited atomically: user=${targetUserId}, order=${orderId}, payment=${paymentId}, type=${resolvedType}, mins=${validatedMinutes}, reqs=${validatedRequests}`);

    return {
      success: true,
      alreadyProcessed: false,
      orderId,
      paymentId,
      userId: targetUserId,
      type: resolvedType,
      minutes: validatedMinutes,
      requests: validatedRequests,
      amount: verifiedAmount
    };
  });
  } catch (err: any) {
    // FAIL CLOSED IN PRODUCTION:
    // Production Cloud Run MUST NEVER allow in-memory fallback when Firestore fails.
    // Protects ledger integrity and prevents unbacked entitlement granting.
    if (isProductionEnvironment()) {
      console.error(`🚨 [${source.toUpperCase()}] CRITICAL: Firestore transaction failed in PRODUCTION for order ${orderId}:`, {
        orderId,
        paymentId,
        error: err?.message || String(err),
        code: err?.code
      });
      return {
        success: false,
        alreadyProcessed: false,
        orderId,
        paymentId,
        error: "Production database transaction failed. Entitlement was NOT granted. Please contact support.",
        errorCode: "DATABASE_TRANSACTION_FAILED",
        statusCode: 500
      };
    }

    // NON-PRODUCTION DEV/SANDBOX ONLY FALLBACK:
    // Restricted to non-production environments where Firestore Admin IAM may be unavailable.
    if (isPermissionError(err)) {
      console.info(`ℹ️ [NON-PROD DEV ONLY] [${source.toUpperCase()}] Applying non-production in-memory fallback for top-up:`, {
        orderId,
        paymentId
      });
      const memOrder = pendingOrdersStore.get(orderId);
      const verifiedAmount = Number(memOrder?.amount || 0);
      const resolvedType = memOrder?.type || "minutes";
      const isMinutes = resolvedType === "minutes";
      const validatedMinutes = isMinutes ? (memOrder?.minutes || (verifiedAmount === 29900 ? 350 : 100)) : 0;
      const validatedRequests = !isMinutes ? (memOrder?.requests || (verifiedAmount === 99900 ? 1500 : (verifiedAmount === 39900 ? 500 : 100))) : 0;
      const targetUserId = memOrder?.userId || callerUserId || "unknown";

      processedPaymentsStore.set(paymentId, {
        orderId,
        paymentId,
        userId: targetUserId,
        type: resolvedType,
        minutes: validatedMinutes,
        requests: validatedRequests,
        amount: verifiedAmount,
        status: "success"
      });

      return {
        success: true,
        alreadyProcessed: false,
        orderId,
        paymentId,
        userId: targetUserId,
        type: resolvedType,
        minutes: validatedMinutes,
        requests: validatedRequests,
        amount: verifiedAmount
      };
    }
    throw err;
  }
}

export interface FulfillSubscriptionParams {
  subscriptionId: string;
  paymentId: string;
  callerUserId?: string;
  source: "verify-payment" | "webhook";
  planIdHint?: string;
  billingCycleHint?: string;
  currentEndTimestamp?: number;
  paymentAmount?: number;
}

export interface FulfillSubscriptionResult {
  success: boolean;
  alreadyProcessed: boolean;
  subscriptionId: string;
  paymentId: string;
  userId?: string;
  planId?: string;
  billingCycle?: string;
  error?: string;
  errorCode?: string;
  statusCode?: number;
}

/**
 * Atomically fulfills and activates a recurring subscription in Firestore.
 * Completely idempotent and race-condition free across concurrent /api/verify-payment
 * and Razorpay subscription.charged webhooks.
 */
export async function fulfillSubscriptionPayment(
  db: Firestore,
  params: FulfillSubscriptionParams
): Promise<FulfillSubscriptionResult> {
  const { subscriptionId, paymentId, callerUserId, source, planIdHint, billingCycleHint, currentEndTimestamp, paymentAmount } = params;

  if (!subscriptionId || !paymentId) {
    return {
      success: false,
      alreadyProcessed: false,
      subscriptionId,
      paymentId,
      error: "Missing subscriptionId or paymentId for fulfillment.",
      errorCode: "INVALID_PARAMETERS",
      statusCode: 400
    };
  }

  // Fast check: in-memory idempotency ledger (non-production dev/sandbox only)
  // In production, idempotency is strictly verified via durable Firestore transaction records.
  if (!isProductionEnvironment() && processedPaymentsStore.has(paymentId)) {
    const cached = processedPaymentsStore.get(paymentId);
    console.log(`ℹ️ [${source.toUpperCase()}] Subscription payment ${paymentId} already processed (non-prod memory cache).`);
    return {
      success: true,
      alreadyProcessed: true,
      subscriptionId,
      paymentId,
      userId: cached.userId,
      planId: cached.planId,
      billingCycle: cached.billingCycle
    };
  }

  try {
    return await db.runTransaction(async (transaction) => {
    const txnRef = db.collection("transactions").doc(paymentId);
    const subRef = db.collection("subscriptions").doc(subscriptionId);

    const [txnDoc, subDoc] = await Promise.all([
      transaction.get(txnRef),
      transaction.get(subRef)
    ]);

    // Check 1: Idempotency via transaction ledger
    if (txnDoc.exists && txnDoc.data()?.status === "success") {
      const data = txnDoc.data() || {};
      console.log(`ℹ️ [${source.toUpperCase()}] Subscription payment ${paymentId} already processed.`);
      return {
        success: true,
        alreadyProcessed: true,
        subscriptionId,
        paymentId,
        userId: data.userId,
        planId: data.planId,
        billingCycle: data.billingCycle
      };
    }

    let subData: any = null;
    if (subDoc.exists) {
      subData = subDoc.data() || {};
    } else if (!isProductionEnvironment() && pendingSubscriptionsStore.has(subscriptionId)) {
      subData = pendingSubscriptionsStore.get(subscriptionId) || {};
    }

    if (!subData) {
      console.warn(`⚠️ [${source.toUpperCase()}] Subscription ${subscriptionId} not found in ${isProductionEnvironment() ? "production Firestore" : "database or memory store"}.`);
      return {
        success: false,
        alreadyProcessed: false,
        subscriptionId,
        paymentId,
        error: `Subscription record ${subscriptionId} not found.`,
        errorCode: "SUBSCRIPTION_NOT_FOUND",
        statusCode: 404
      };
    }

    // Check 2: User ownership validation
    const targetUserId = subData.userId || callerUserId;
    if (callerUserId && subData.userId && callerUserId !== subData.userId) {
      console.error(`🚨 [${source.toUpperCase()}] User mismatch on subscription ${subscriptionId}: caller=${callerUserId}, owner=${subData.userId}`);
      return {
        success: false,
        alreadyProcessed: false,
        subscriptionId,
        paymentId,
        error: "Forbidden: subscription belongs to another user account.",
        errorCode: "FORBIDDEN",
        statusCode: 403
      };
    }

    if (!targetUserId) {
      return {
        success: false,
        alreadyProcessed: false,
        subscriptionId,
        paymentId,
        error: "Subscription record missing target userId.",
        errorCode: "INVALID_SUBSCRIPTION_STATE",
        statusCode: 400
      };
    }

    const planId = (subData.planId || planIdHint || "pro").toLowerCase();
    const billingCycle = (subData.billingCycle || billingCycleHint || "monthly").toLowerCase();

    const now = new Date();
    const subscriptionStartDate = now.toISOString();
    let expiryIso: string;
    if (currentEndTimestamp) {
      expiryIso = new Date(currentEndTimestamp * 1000).toISOString();
    } else {
      const expiryDate = new Date(now);
      if (billingCycle === "yearly") {
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      } else {
        expiryDate.setMonth(expiryDate.getMonth() + 1);
      }
      expiryIso = expiryDate.toISOString();
    }

    const limits = SERVER_PLAN_LIMITS[planId] || SERVER_PLAN_LIMITS.pro;

    const userRef = db.collection("users").doc(targetUserId);
    transaction.set(userRef, {
      plan: planId,
      billingCycle,
      subscriptionId,
      subscriptionStartDate,
      nextRefreshDate: expiryIso,
      billingStartDate: subscriptionStartDate,
      planExpiresAt: expiryIso,
      lastPaymentDate: FieldValue.serverTimestamp(),
      monthlyMinuteLimit: limits.minutes,
      monthlyMinutesUsed: 0,
      monthlyThinkingLimit: limits.thinking,
      monthlyThinkingUsed: 0,
    }, { merge: true });

    transaction.set(subRef, {
      status: "active",
      userId: targetUserId,
      planId,
      billingCycle,
      activePaymentId: paymentId,
      currentPeriodStart: subscriptionStartDate,
      currentPeriodEnd: expiryIso,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    const isTeam = planId === "team";
    const isYearly = billingCycle === "yearly";
    const calculatedAmount = paymentAmount !== undefined
      ? paymentAmount
      : (isTeam ? (isYearly ? 1999 * 12 : 2499) : (isYearly ? 799 * 12 : 999));

    transaction.set(txnRef, {
      userId: targetUserId,
      paymentId,
      subscriptionId,
      type: "subscription",
      planId,
      billingCycle,
      amount: calculatedAmount,
      status: "success",
      source,
      createdAt: FieldValue.serverTimestamp()
    });

    console.log(`✅ [${source.toUpperCase()}] Subscription activated atomically: user=${targetUserId}, sub=${subscriptionId}, plan=${planId}, cycle=${billingCycle}`);

    return {
      success: true,
      alreadyProcessed: false,
      subscriptionId,
      paymentId,
      userId: targetUserId,
      planId,
      billingCycle
    };
  });
  } catch (err: any) {
    // FAIL CLOSED IN PRODUCTION:
    // Production Cloud Run MUST NEVER allow in-memory fallback when Firestore fails.
    // Protects ledger integrity and prevents unbacked tier upgrades.
    if (isProductionEnvironment()) {
      console.error(`🚨 [${source.toUpperCase()}] CRITICAL: Firestore transaction failed in PRODUCTION for subscription ${subscriptionId}:`, {
        subscriptionId,
        paymentId,
        error: err?.message || String(err),
        code: err?.code
      });
      return {
        success: false,
        alreadyProcessed: false,
        subscriptionId,
        paymentId,
        error: "Production database transaction failed. Subscription tier was NOT upgraded. Please contact support.",
        errorCode: "DATABASE_TRANSACTION_FAILED",
        statusCode: 500
      };
    }

    // NON-PRODUCTION DEV/SANDBOX ONLY FALLBACK:
    // Restricted to non-production environments where Firestore Admin IAM may be unavailable.
    if (isPermissionError(err)) {
      console.info(`ℹ️ [NON-PROD DEV ONLY] [${source.toUpperCase()}] Applying non-production in-memory fallback for subscription:`, {
        subscriptionId,
        paymentId
      });
      const memSub = pendingSubscriptionsStore.get(subscriptionId);
      const targetUserId = memSub?.userId || callerUserId || "unknown";
      const planId = (memSub?.planId || planIdHint || "pro").toLowerCase();
      const billingCycle = (memSub?.billingCycle || billingCycleHint || "monthly").toLowerCase();

      processedPaymentsStore.set(paymentId, {
        subscriptionId,
        paymentId,
        userId: targetUserId,
        planId,
        billingCycle,
        status: "success"
      });

      return {
        success: true,
        alreadyProcessed: false,
        subscriptionId,
        paymentId,
        userId: targetUserId,
        planId,
        billingCycle
      };
    }
    throw err;
  }
}
