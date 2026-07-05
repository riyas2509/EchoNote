import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { calculateCost } from "./geminiPricing.js";

let dbInstance: admin.firestore.Firestore | null = null;

export function getDb(): admin.firestore.Firestore {
  if (!dbInstance) {
    const firebaseConfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8")
    );
    const appAdmin = !getApps().length
      ? initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId: process.env.GOOGLE_CLOUD_PROJECT || firebaseConfig.projectId || "echonote-2509",
        })
      : getApps()[0];
    dbInstance = getFirestore(appAdmin, firebaseConfig.firestoreDatabaseId);
  }
  return dbInstance;
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

/**
 * Tracks AI resource usage and updates granular logs, user aggregates,
 * team/project metrics, feature balances, and monthly snapshots.
 * Zero-read writes utilizing set with merge & native increments to guarantee high scale.
 */
export async function trackAIUsage(payload: AIUsagePayload): Promise<void> {
  try {
    const db = getDb();
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
    
    console.log("TRACKING STARTED");
    console.log("TRACKING USER", userId);
    console.log("TRACKING FEATURE", featureName);
    
    // 1. Core Pricing calculations
    const estimatedCost = calculateCost(modelUsed, inputTokens, outputTokens);
    const totalTokens = inputTokens + outputTokens;
    const timestampVal = FieldValue.serverTimestamp();
    const requestId = crypto.randomUUID();

    // 2. Map user to dynamic Team & Organization (respecting company corporate domains)
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
    // Assume average top-up values if present (e.g. extra minutes tracked or we can sync it)
    const topupRevenue = 0.00; // Updated when payments happen. We keep a field for aggregate
    const lifetimeRevenue = subscriptionRevenue + topupRevenue;

    // Feature minutes classification
    let featureMinutes = minutesUsed || 0;
    if (!featureMinutes && (featureName === "Intelligence Transcription" || featureName === "Live Transcription" || featureName === "Uploaded Audio Analysis")) {
      // If none set, let's estimate 1.5 minutes per audio AI processing request as standard baseline
      featureMinutes = 1.5;
    }

    // 4. Initialize Database References & Batch
    const batch = db.batch();

    // A. aiUsageLogs doc
    const logRef = db.collection("aiUsageLogs").doc(requestId);
    batch.set(logRef, {
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
      timestamp: timestampVal,
      createdAt: timestampVal
    });

    // B. userCostAnalytics doc (compat with Admin Dashboard UI)
    const userCostAnalyticsRef = db.collection("userCostAnalytics").doc(userId);
    batch.set(userCostAnalyticsRef, {
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

    // C. userAnalytics doc (rich extended profile metrics requested)
    const userAnalyticsRef = db.collection("userAnalytics").doc(userId);
    batch.set(userAnalyticsRef, {
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
      [`featureUsageBreakdown.${featureName.replace(/\s+/g, '_')}`]: FieldValue.increment(1)
    }, { merge: true });

    // D. teamAnalytics doc
    const teamAnalyticsRef = db.collection("teamAnalytics").doc(teamId);
    batch.set(teamAnalyticsRef, {
      teamId,
      teamName,
      organizationId,
      totalMembers: FieldValue.increment(1), // Estimated increment representing unique member touches
      totalMinutesUsed: FieldValue.increment(featureMinutes),
      totalInputTokens: FieldValue.increment(inputTokens),
      totalOutputTokens: FieldValue.increment(outputTokens),
      totalTokens: FieldValue.increment(totalTokens),
      totalAIRequests: FieldValue.increment(1),
      totalAICost: FieldValue.increment(estimatedCost),
      totalRevenue: FieldValue.increment(plan === 'team' ? 30.00 : 0.00),
      profitability: FieldValue.increment((plan === 'team' ? 30.00 : 0.00) - estimatedCost)
    }, { merge: true });

    // E. Monthly aggregates (e.g. "2026-05")
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthlyRef = db.collection("monthlyAnalytics").doc(monthKey);
    batch.set(monthlyRef, {
      month: monthKey,
      totalUsers: FieldValue.increment(1), // Estimator of dynamic metrics
      activeUsers: FieldValue.increment(1),
      totalMinutes: FieldValue.increment(featureMinutes),
      totalInputTokens: FieldValue.increment(inputTokens),
      totalOutputTokens: FieldValue.increment(outputTokens),
      totalTokens: FieldValue.increment(totalTokens),
      totalAISpend: FieldValue.increment(estimatedCost),
      totalRevenue: FieldValue.increment(subscriptionRevenue),
      profitEstimate: FieldValue.increment(subscriptionRevenue - estimatedCost)
    }, { merge: true });

    // F. Feature Analytics Aggregators
    const featureSlug = featureName.replace(/\s+/g, '_').toLowerCase();
    const featureRef = db.collection("featureAnalytics").doc(featureSlug);
    batch.set(featureRef, {
      featureName,
      totalRequests: FieldValue.increment(1),
      totalInputTokens: FieldValue.increment(inputTokens),
      totalOutputTokens: FieldValue.increment(outputTokens),
      totalTokens: FieldValue.increment(totalTokens),
      totalAICost: FieldValue.increment(estimatedCost),
      totalResponseTime: FieldValue.increment(requestDuration)
    }, { merge: true });

    // Commit everything atomically
    await batch.commit();
    console.log("TRACKING SUCCESS");
    console.log(`[aiTracker] Fully tracked and aggregated usage for ${normalizedEmail} (${featureName}) - Cost: $${estimatedCost.toFixed(6)}`);
  } catch (error) {
    console.error("❌ Failed to track AI usage on backend:", error);
  }
}
