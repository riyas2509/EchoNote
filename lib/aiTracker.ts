import fs from "fs";
import path from "path";
import { FieldValue } from "firebase-admin/firestore";
import admin from "firebase-admin";
import crypto from "crypto";
import { calculateCost } from "./geminiPricing.js";
import { getAdminFirestore } from "./firebaseAdmin.ts";

export function getDb(): admin.firestore.Firestore | null {
  try {
    return getAdminFirestore();
  } catch (err) {
    console.warn("[aiTracker] Firebase Admin init notice:", err);
    return null;
  }
}

export interface AIUsagePayload {
  userId: string;
  email: string;
  plan: string;
  featureName: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  requestDuration: number; // millisecond duration
  status: "success" | "failure";
  errorMessage?: string;
  minutesUsed?: number; // estimated transcription minutes
}

/**
 * Standard USD Pricing mapping for Revenue computation
 */
export const SUB_REVENUE_MAPPING: Record<string, number> = {
  "guest": 0,
  "free": 0,
  "pro": 12.00,
  "team": 30.00,
  "enterprise": 120.00
};

// In-Memory & File-backed Store for robust analytics persistence
interface LocalUsageStore {
  logs: any[];
  userCostAnalytics: Record<string, any>;
  userAnalytics: Record<string, any>;
  teamAnalytics: Record<string, any>;
  monthlyAnalytics: Record<string, any>;
  featureAnalytics: Record<string, any>;
}

const STORE_PATH = path.join(process.cwd(), "data", "ai_usage_store.json");

function loadStore(): LocalUsageStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    }
  } catch (e) {
    // ignore read error
  }
  return {
    logs: [],
    userCostAnalytics: {},
    userAnalytics: {},
    teamAnalytics: {},
    monthlyAnalytics: {},
    featureAnalytics: {}
  };
}

let storeMemory: LocalUsageStore = loadStore();

function saveStore(): void {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(storeMemory, null, 2), "utf8");
  } catch (e) {
    // ignore write error
  }
}

export function getAiUsageOverview() {
  return {
    userCostAnalytics: Object.values(storeMemory.userCostAnalytics),
    userAnalytics: Object.values(storeMemory.userAnalytics),
    teamAnalytics: Object.values(storeMemory.teamAnalytics),
    monthlyAnalytics: Object.values(storeMemory.monthlyAnalytics).sort((a: any, b: any) => b.month.localeCompare(a.month)),
    featureAnalytics: Object.values(storeMemory.featureAnalytics)
  };
}

export function getRecentAiUsageLogs(maxCount: number = 100) {
  return storeMemory.logs.slice(-maxCount).reverse();
}

/**
 * Tracks AI resource usage and updates granular logs, user aggregates,
 * team/project metrics, feature balances, and monthly snapshots.
 */
export async function trackAIUsage(payload: AIUsagePayload): Promise<void> {
  try {
    const { 
      userId, 
      email, 
      plan, 
      featureName, 
      modelUsed, 
      inputTokens, 
      outputTokens, 
      requestDuration, 
      status,
      errorMessage,
      minutesUsed
    } = payload;
    
    // 1. Core Pricing calculations
    const estimatedCost = calculateCost(modelUsed, inputTokens, outputTokens);
    const totalTokens = inputTokens + outputTokens;
    const nowIso = new Date().toISOString();
    const requestId = crypto.randomUUID();

    // 2. Map user to dynamic Team & Organization
    const normalizedEmail = (email || "anonymous@echotechai.in").toLowerCase();
    const emailDomain = normalizedEmail.split('@')[1] || 'generic';
    const isCompanyDomain = !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'mail.com', 'icloud.com'].includes(emailDomain);

    const organizationId = isCompanyDomain ? emailDomain.replace(/\./g, '_') : `org_${userId}`;
    const organizationName = isCompanyDomain ? `${emailDomain.split('.')[0].toUpperCase()} Org` : `${normalizedEmail.split('@')[0]}'s Organization`;

    let teamId = `team_${userId}`;
    let teamName = `${normalizedEmail.split('@')[0]}'s Team`;

    if (plan === 'team' || plan === 'enterprise') {
      teamId = isCompanyDomain ? `team_${emailDomain.replace(/\./g, '_')}` : `team_${userId}`;
      teamName = isCompanyDomain ? `${emailDomain.split('.')[0].toUpperCase()} Shared Team` : `${normalizedEmail.split('@')[0]} Collaborative Team`;
    }

    // 3. Compute subscription and topup revenue
    const subscriptionRevenue = SUB_REVENUE_MAPPING[plan] || 0;
    const topupRevenue = 0.00;
    const lifetimeRevenue = subscriptionRevenue + topupRevenue;

    let featureMinutes = minutesUsed || 0;
    if (!featureMinutes && (featureName === "Intelligence Transcription" || featureName === "Live Transcription" || featureName === "Uploaded Audio Analysis")) {
      featureMinutes = 1.5;
    }

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const featureSlug = featureName.replace(/\s+/g, '_').toLowerCase();

    // Log payload
    const logItem = {
      id: requestId,
      requestId,
      userId,
      email: normalizedEmail,
      organizationId,
      teamId,
      plan: plan || "free",
      featureName,
      modelUsed,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost,
      requestDuration,
      status,
      errorMessage: errorMessage || null,
      timestamp: nowIso,
      createdAt: nowIso
    };

    // 4. Update In-Memory & Local File Store
    storeMemory.logs.push(logItem);
    if (storeMemory.logs.length > 2000) {
      storeMemory.logs = storeMemory.logs.slice(-2000);
    }

    // User Cost Analytics
    const prevCost = storeMemory.userCostAnalytics[userId] || {
      id: userId,
      userId,
      email: normalizedEmail,
      plan: plan || "free",
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalEstimatedCost: 0,
      lastUpdated: nowIso
    };
    storeMemory.userCostAnalytics[userId] = {
      ...prevCost,
      totalRequests: prevCost.totalRequests + 1,
      totalInputTokens: prevCost.totalInputTokens + inputTokens,
      totalOutputTokens: prevCost.totalOutputTokens + outputTokens,
      totalTokens: prevCost.totalTokens + totalTokens,
      totalEstimatedCost: prevCost.totalEstimatedCost + estimatedCost,
      lastUpdated: nowIso
    };

    // Rich User Analytics
    const prevUser = storeMemory.userAnalytics[userId] || {
      id: userId,
      userId,
      email: normalizedEmail,
      displayName: normalizedEmail.split('@')[0],
      plan: plan || "free",
      transcriptionMinutesUsed: 0,
      intelligenceRequestsUsed: 0,
      totalAIRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalAICost: 0,
      monthlyAICost: 0,
      lifetimeAICost: 0,
      subscriptionRevenue: subscriptionRevenue,
      topupRevenue: 0,
      lifetimeRevenue: 0,
      revenueMinusCost: 0,
      lastActiveAt: nowIso,
      featureUsageBreakdown: {}
    };
    const featureBreakdown = { ...(prevUser.featureUsageBreakdown || {}) };
    featureBreakdown[featureSlug] = (featureBreakdown[featureSlug] || 0) + 1;
    storeMemory.userAnalytics[userId] = {
      ...prevUser,
      transcriptionMinutesUsed: prevUser.transcriptionMinutesUsed + featureMinutes,
      intelligenceRequestsUsed: prevUser.intelligenceRequestsUsed + 1,
      totalAIRequests: prevUser.totalAIRequests + 1,
      totalInputTokens: prevUser.totalInputTokens + inputTokens,
      totalOutputTokens: prevUser.totalOutputTokens + outputTokens,
      totalTokens: prevUser.totalTokens + totalTokens,
      totalAICost: prevUser.totalAICost + estimatedCost,
      monthlyAICost: prevUser.monthlyAICost + estimatedCost,
      lifetimeAICost: prevUser.lifetimeAICost + estimatedCost,
      subscriptionRevenue,
      topupRevenue: prevUser.topupRevenue + topupRevenue,
      lifetimeRevenue: prevUser.lifetimeRevenue + lifetimeRevenue,
      revenueMinusCost: prevUser.revenueMinusCost + (lifetimeRevenue - estimatedCost),
      lastActiveAt: nowIso,
      featureUsageBreakdown: featureBreakdown
    };

    // Team Analytics
    const prevTeam = storeMemory.teamAnalytics[teamId] || {
      id: teamId,
      teamId,
      teamName,
      organizationId,
      totalMembers: 1,
      totalMinutesUsed: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalAIRequests: 0,
      totalAICost: 0,
      totalRevenue: 0,
      profitability: 0
    };
    storeMemory.teamAnalytics[teamId] = {
      ...prevTeam,
      totalMinutesUsed: prevTeam.totalMinutesUsed + featureMinutes,
      totalInputTokens: prevTeam.totalInputTokens + inputTokens,
      totalOutputTokens: prevTeam.totalOutputTokens + outputTokens,
      totalTokens: prevTeam.totalTokens + totalTokens,
      totalAIRequests: prevTeam.totalAIRequests + 1,
      totalAICost: prevTeam.totalAICost + estimatedCost,
      totalRevenue: prevTeam.totalRevenue + (plan === 'team' ? 30.00 : 0.00),
      profitability: prevTeam.profitability + ((plan === 'team' ? 30.00 : 0.00) - estimatedCost)
    };

    // Monthly Analytics
    const prevMonth = storeMemory.monthlyAnalytics[monthKey] || {
      id: monthKey,
      month: monthKey,
      totalUsers: 1,
      activeUsers: 1,
      totalMinutes: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalAISpend: 0,
      totalRevenue: 0,
      profitEstimate: 0
    };
    storeMemory.monthlyAnalytics[monthKey] = {
      ...prevMonth,
      totalMinutes: prevMonth.totalMinutes + featureMinutes,
      totalInputTokens: prevMonth.totalInputTokens + inputTokens,
      totalOutputTokens: prevMonth.totalOutputTokens + outputTokens,
      totalTokens: prevMonth.totalTokens + totalTokens,
      totalAISpend: prevMonth.totalAISpend + estimatedCost,
      totalRevenue: prevMonth.totalRevenue + subscriptionRevenue,
      profitEstimate: prevMonth.profitEstimate + (subscriptionRevenue - estimatedCost)
    };

    // Feature Analytics
    const prevFeature = storeMemory.featureAnalytics[featureSlug] || {
      id: featureSlug,
      featureName,
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalAICost: 0,
      totalResponseTime: 0
    };
    storeMemory.featureAnalytics[featureSlug] = {
      ...prevFeature,
      totalRequests: prevFeature.totalRequests + 1,
      totalInputTokens: prevFeature.totalInputTokens + inputTokens,
      totalOutputTokens: prevFeature.totalOutputTokens + outputTokens,
      totalTokens: prevFeature.totalTokens + totalTokens,
      totalAICost: prevFeature.totalAICost + estimatedCost,
      totalResponseTime: prevFeature.totalResponseTime + requestDuration
    };

    saveStore();

    // 5. Attempt Cloud Firestore persistence if available
    const db = getDb();
    if (db) {
      try {
        const batch = db.batch();
        const timestampVal = FieldValue.serverTimestamp();

        batch.set(db.collection("aiUsageLogs").doc(requestId), {
          ...logItem,
          timestamp: timestampVal,
          createdAt: timestampVal
        });

        batch.set(db.collection("userCostAnalytics").doc(userId), {
          userId,
          email: normalizedEmail,
          plan: plan || "free",
          totalRequests: FieldValue.increment(1),
          totalInputTokens: FieldValue.increment(inputTokens),
          totalOutputTokens: FieldValue.increment(outputTokens),
          totalTokens: FieldValue.increment(totalTokens),
          totalEstimatedCost: FieldValue.increment(estimatedCost),
          lastUpdated: timestampVal
        }, { merge: true });

        batch.set(db.collection("userAnalytics").doc(userId), {
          userId,
          email: normalizedEmail,
          displayName: normalizedEmail.split('@')[0],
          plan: plan || "free",
          transcriptionMinutesUsed: FieldValue.increment(featureMinutes),
          intelligenceRequestsUsed: FieldValue.increment(1),
          totalAIRequests: FieldValue.increment(1),
          totalInputTokens: FieldValue.increment(inputTokens),
          totalOutputTokens: FieldValue.increment(outputTokens),
          totalTokens: FieldValue.increment(totalTokens),
          totalAICost: FieldValue.increment(estimatedCost),
          monthlyAICost: FieldValue.increment(estimatedCost),
          lifetimeAICost: FieldValue.increment(estimatedCost),
          subscriptionRevenue: subscriptionRevenue,
          topupRevenue: FieldValue.increment(topupRevenue),
          lifetimeRevenue: FieldValue.increment(lifetimeRevenue),
          revenueMinusCost: FieldValue.increment(lifetimeRevenue - estimatedCost),
          lastActiveAt: timestampVal,
          [`featureUsageBreakdown.${featureSlug}`]: FieldValue.increment(1)
        }, { merge: true });

        batch.set(db.collection("teamAnalytics").doc(teamId), {
          teamId,
          teamName,
          organizationId,
          totalMembers: FieldValue.increment(1),
          totalMinutesUsed: FieldValue.increment(featureMinutes),
          totalInputTokens: FieldValue.increment(inputTokens),
          totalOutputTokens: FieldValue.increment(outputTokens),
          totalTokens: FieldValue.increment(totalTokens),
          totalAIRequests: FieldValue.increment(1),
          totalAICost: FieldValue.increment(estimatedCost),
          totalRevenue: FieldValue.increment(plan === 'team' ? 30.00 : 0.00),
          profitability: FieldValue.increment((plan === 'team' ? 30.00 : 0.00) - estimatedCost)
        }, { merge: true });

        batch.set(db.collection("monthlyAnalytics").doc(monthKey), {
          month: monthKey,
          totalUsers: FieldValue.increment(1),
          activeUsers: FieldValue.increment(1),
          totalMinutes: FieldValue.increment(featureMinutes),
          totalInputTokens: FieldValue.increment(inputTokens),
          totalOutputTokens: FieldValue.increment(outputTokens),
          totalTokens: FieldValue.increment(totalTokens),
          totalAISpend: FieldValue.increment(estimatedCost),
          totalRevenue: FieldValue.increment(subscriptionRevenue),
          profitEstimate: FieldValue.increment(subscriptionRevenue - estimatedCost)
        }, { merge: true });

        batch.set(db.collection("featureAnalytics").doc(featureSlug), {
          featureName,
          totalRequests: FieldValue.increment(1),
          totalInputTokens: FieldValue.increment(inputTokens),
          totalOutputTokens: FieldValue.increment(outputTokens),
          totalTokens: FieldValue.increment(totalTokens),
          totalAICost: FieldValue.increment(estimatedCost),
          totalResponseTime: FieldValue.increment(requestDuration)
        }, { merge: true });

        await batch.commit();
      } catch (firestoreErr: any) {
        // Log at debug level only; store is already safely preserved in storeMemory
        console.log(`[aiTracker] Firestore Admin write bypassed (${firestoreErr?.message || firestoreErr}). In-memory and local persistent store updated.`);
      }
    }
  } catch (error) {
    console.warn("[aiTracker] Usage tracking handled with local fallback:", error);
  }
}
