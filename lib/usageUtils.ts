
import { UserProfile, UsageStats } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';

export interface CalculatedUsage {
  used: number;
  limit: number;
  percentage: number;
  isExceeded: boolean;
  remaining: number;
  monthlyUsed: number;
  monthlyLimit: number;
  topupBalance: number;
  monthlyPercentage: number;
}

export interface CalculatedThinkingUsage {
  used: number;
  limit: number | 'unlimited';
  percentage: number;
  isExceeded: boolean;
  monthlyUsed: number;
  monthlyLimit: number | 'unlimited';
  topupBalance: number;
  monthlyPercentage: number;
}

export function getMinutesUsage(user: UserProfile | UsageStats): CalculatedUsage {
  const plan = user.plan || 'free';
  const features = PLAN_FEATURES[plan];
  
  // Base limit from plan config
  const baseLimit = features.totalMinutesLimit;
  
  // Extra minutes from top-ups
  const extraMinutes = user.minuteTopupBalance ?? user.extraMinutes ?? 0;
  
  const limit = baseLimit + extraMinutes;
  
  // Type-safe access to used minutes 
  let used = 0;
  if ('usedMinutes' in user) {
    used = user.usedMinutes;
  } else if ('minutesUsed' in user) {
    used = (user as UserProfile).minutesUsed;
  }

  const monthlyLimit = user.monthlyMinuteLimit ?? baseLimit;
  const monthlyUsed = user.monthlyMinutesUsed ?? used;
  const topupBalance = user.minuteTopupBalance ?? user.extraMinutes ?? 0;

  const isExceeded = (monthlyUsed >= monthlyLimit) && (topupBalance <= 0);

  return {
    used,
    limit,
    percentage: Math.min((used / (limit || 1)) * 100, 100),
    isExceeded,
    remaining: Math.max(0, limit - used),
    monthlyUsed,
    monthlyLimit,
    topupBalance,
    monthlyPercentage: Math.min((monthlyUsed / (monthlyLimit || 1)) * 100, 100),
  };
}

export function getThinkingUsage(user: UserProfile | UsageStats): CalculatedThinkingUsage {
  const plan = user.plan || 'free';
  const features = PLAN_FEATURES[plan];
  
  const limit = features.thinkingLimit;
  
  // Type-safe access to thinking usage
  let used = 0;
  if ('aiRequestCount' in user) {
    used = user.aiRequestCount;
  } else if ('thinkingUsed' in user) {
    used = (user as UserProfile).thinkingUsed;
  }

  const monthlyLimit = user.monthlyThinkingLimit ?? limit;
  const monthlyUsed = user.monthlyThinkingUsed ?? used;
  const topupBalance = user.thinkingTopupBalance ?? 0;

  let percentage = 0;
  let isExceeded = false;

  if (limit === 'unlimited') {
    percentage = 0;
    isExceeded = false;
  } else {
    percentage = Math.min((used / (limit || 1)) * 100, 100);
    isExceeded = (monthlyUsed >= (monthlyLimit as number)) && (topupBalance <= 0);
  }

  const monthlyPercentage = monthlyLimit === 'unlimited' ? 0 : Math.min((monthlyUsed / (monthlyLimit as number || 1)) * 100, 100);

  return {
    used,
    limit,
    percentage,
    isExceeded,
    monthlyUsed,
    monthlyLimit,
    topupBalance,
    monthlyPercentage,
  };
}

export function safeParseDate(val: any): Date {
  if (!val) return new Date();
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? new Date() : val;
  }
  // If it's a Firestore Timestamp (has toDate function)
  if (typeof val === 'object' && typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      return isNaN(d.getTime()) ? new Date() : d;
    } catch {
      return new Date();
    }
  }
  // If it's a Firestore Timestamp serialized object or similar structure with seconds
  if (typeof val === 'object' && val.seconds !== undefined && val.seconds !== null) {
    const d = new Date(Number(val.seconds) * 1000);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  // Try direct parsing
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) {
      return new Date();
    }
    return d;
  } catch {
    return new Date();
  }
}

export function calculateNextRefreshDate(
  subscriptionStartDateRaw: any,
  billingCycle: 'monthly' | 'yearly' | undefined,
  plan: string | undefined,
  createdAtRaw?: any
): Date {
  const planName = plan || 'free';
  const cycle = planName === 'free' ? 'monthly' : (billingCycle || 'monthly');
  
  // Base date is accountCreationDate (createdAtRaw) if Free, otherwise subscriptionStartDate
  const baseDateVal = planName === 'free' ? (createdAtRaw || subscriptionStartDateRaw) : subscriptionStartDateRaw;
  const baseDate = safeParseDate(baseDateVal);

  const nextRefresh = new Date(baseDate);
  if (cycle === 'yearly') {
    nextRefresh.setFullYear(nextRefresh.getFullYear() + 1);
  } else {
    nextRefresh.setMonth(nextRefresh.getMonth() + 1);
  }
  return nextRefresh;
}

export function shouldResetUsage(nextRefreshDateRaw: any): boolean {
  if (!nextRefreshDateRaw) return false;
  const now = new Date();
  const nextRefresh = safeParseDate(nextRefreshDateRaw);
  return now >= nextRefresh;
}

export function getAdvancedRefreshDate(
  currentNextRefreshDateRaw: any,
  billingCycle: 'monthly' | 'yearly' | undefined,
  plan: string | undefined
): Date {
  const planName = plan || 'free';
  const cycle = planName === 'free' ? 'monthly' : (billingCycle || 'monthly');
  const next = safeParseDate(currentNextRefreshDateRaw);
  const now = new Date();
  
  // Advance by 1 month or 1 year until next is strictly in the future relative to now
  let safetyCounter = 0;
  while (next <= now && safetyCounter < 1000) {
    safetyCounter++;
    if (cycle === 'yearly') {
      next.setFullYear(next.getFullYear() + 1);
    } else {
      next.setMonth(next.getMonth() + 1);
    }
  }
  return next;
}

export function migrateLegacyUserFields(user: any): {
  subscriptionStartDate: string;
  billingCycle: 'monthly' | 'yearly';
  nextRefreshDate: string;
  lastUsageResetDate: string;
} {
  const now = new Date();
  const createdAtVal = user.createdAt || user.billingStartDate || user.createdAtRaw || now.toISOString();
  const createdAt = safeParseDate(createdAtVal).toISOString();
  
  const planName = user.plan || 'free';
  const subscriptionStartDateVal = planName === 'free' ? createdAtVal : (user.billingStartDate || createdAtVal);
  const subscriptionStartDate = safeParseDate(subscriptionStartDateVal).toISOString();
  const billingCycle = user.billingCycle || 'monthly';
  
  let nextRefresh = calculateNextRefreshDate(subscriptionStartDate, billingCycle, planName, createdAt);
  
  // If the calculated nextRefresh is already in the past, advance it to future
  if (nextRefresh <= now) {
    nextRefresh = getAdvancedRefreshDate(nextRefresh, billingCycle, planName);
  }
  
  const lastUsageResetVal = user.lastResetDate || subscriptionStartDateVal;
  const lastUsageResetDate = safeParseDate(lastUsageResetVal).toISOString();

  return {
    subscriptionStartDate,
    billingCycle,
    nextRefreshDate: nextRefresh.toISOString(),
    lastUsageResetDate
  };
}

export function formatRefreshDate(nextRefreshDateRaw: any): string {
  if (!nextRefreshDateRaw) return 'N/A';
  const d = safeParseDate(nextRefreshDateRaw);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function getResetMilestone(billingStartDateRaw: string | undefined): Date {
  if (!billingStartDateRaw) return new Date();
  
  const now = new Date();
  const start = new Date(billingStartDateRaw);

  const monthsPassed =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());

  const milestone = new Date(start);
  milestone.setMonth(start.getMonth() + monthsPassed);

  return milestone;
}

export function shouldReset(billingStartDateRaw: string | undefined, lastResetDateRaw: string | undefined): boolean {
  if (!billingStartDateRaw) return false;
  
  const now = new Date();
  const milestone = getResetMilestone(billingStartDateRaw);

  return now >= milestone && (!lastResetDateRaw || new Date(lastResetDateRaw) < milestone);
}

export function getNextResetDate(billingStartDateRaw: string | undefined): string {
  if (!billingStartDateRaw) return 'Next Month';
  
  const now = new Date();
  const milestone = getResetMilestone(billingStartDateRaw);
  
  const nextReset = new Date(milestone);
  if (now >= milestone) {
    nextReset.setMonth(nextReset.getMonth() + 1);
  }
  
  return nextReset.toLocaleDateString();
}
