
import { UserProfile, UsageStats } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';

export interface CalculatedUsage {
  used: number;
  limit: number;
  percentage: number;
  isExceeded: boolean;
  remaining: number;
}

export interface CalculatedThinkingUsage {
  used: number;
  limit: number | 'unlimited';
  percentage: number;
  isExceeded: boolean;
}

export function getMinutesUsage(user: UserProfile | UsageStats): CalculatedUsage {
  const plan = user.plan || 'free';
  const features = PLAN_FEATURES[plan];
  
  // Base limit from plan config
  const baseLimit = features.totalMinutesLimit;
  
  // Extra minutes from top-ups
  const extraMinutes = user.extraMinutes || 0;
  
  const limit = baseLimit + extraMinutes;
  
  // Type-safe access to used minutes 
  let used = 0;
  if ('usedMinutes' in user) {
    used = user.usedMinutes;
  } else if ('minutesUsed' in user) {
    used = (user as UserProfile).minutesUsed;
  }

  return {
    used,
    limit,
    percentage: Math.min((used / (limit || 1)) * 100, 100),
    isExceeded: used > limit,
    remaining: Math.max(0, limit - used)
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

  let percentage = 0;
  let isExceeded = false;

  if (limit === 'unlimited') {
    percentage = 0;
    isExceeded = false;
  } else {
    percentage = Math.min((used / (limit || 1)) * 100, 100);
    isExceeded = used > limit;
  }

  return {
    used,
    limit,
    percentage,
    isExceeded
  };
}

export function getResetMilestone(billingStartDateRaw: string | undefined): Date {
  if (!billingStartDateRaw) return new Date();
  
  const now = new Date();
  const start = new Date(billingStartDateRaw);

  // Calculate how many full months have passed since the start date
  const monthsPassed =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());

  // Calculate the reset date for the CURRENT month period
  const milestone = new Date(start);
  milestone.setMonth(start.getMonth() + monthsPassed);

  return milestone;
}

export function shouldReset(billingStartDateRaw: string | undefined, lastResetDateRaw: string | undefined): boolean {
  if (!billingStartDateRaw) return false;
  
  const now = new Date();
  const milestone = getResetMilestone(billingStartDateRaw);

  // If we have reached the milestone date AND we haven't reset since that milestone
  return now >= milestone && (!lastResetDateRaw || new Date(lastResetDateRaw) < milestone);
}

export function getNextResetDate(billingStartDateRaw: string | undefined): string {
  if (!billingStartDateRaw) return 'Next Month';
  
  const now = new Date();
  const milestone = getResetMilestone(billingStartDateRaw);
  
  // If we haven't reached the milestone yet, the milestone IS the next reset date
  // If we HAVE passed the milestone, the NEXT reset is one month after the milestone
  const nextReset = new Date(milestone);
  if (now >= milestone) {
    nextReset.setMonth(nextReset.getMonth() + 1);
  }
  
  return nextReset.toLocaleDateString();
}
