import { SubscriptionTier } from '../types';

export interface PlanFeatures {
  transcription: boolean;
  thinkingLimit: number | 'unlimited';
  decisionHistoryLimit: number | 'unlimited';
  export: boolean;
  team: boolean;
  minutesPerFileLimit: number;
  totalMinutesLimit: number;
  aiRequestLimit: number | 'unlimited';
  advancedSecurity?: boolean;
  meetingContinuity: boolean;
  executionTracking: 'none' | 'limited' | 'full';
  historicalInsights: boolean;
  smartReminders: boolean;
  decisionExtraction: 'none' | 'limited' | 'full';
  taskExtraction: 'none' | 'limited' | 'full';
  meetingIntelligence: 'none' | 'basic' | 'advanced';
  persistence: 'session' | 'persistent';
}

export const PLAN_FEATURES: Record<SubscriptionTier, PlanFeatures> = {
  guest: {
    transcription: true,
    thinkingLimit: 3,
    decisionHistoryLimit: 0,
    export: false,
    team: false,
    minutesPerFileLimit: 5,
    totalMinutesLimit: 15,
    aiRequestLimit: 5,
    meetingContinuity: false,
    executionTracking: 'none',
    historicalInsights: false,
    smartReminders: false,
    decisionExtraction: 'none',
    taskExtraction: 'none',
    meetingIntelligence: 'none',
    persistence: 'session'
  },
  free: {
    transcription: true,
    thinkingLimit: 10,
    decisionHistoryLimit: 5,
    export: true,
    team: true,
    minutesPerFileLimit: 15,
    totalMinutesLimit: 60,
    aiRequestLimit: 10,
    meetingContinuity: true,
    executionTracking: 'full',
    historicalInsights: true,
    smartReminders: true,
    decisionExtraction: 'full',
    taskExtraction: 'full',
    meetingIntelligence: 'advanced',
    persistence: 'persistent'
  },
  pro: {
    transcription: true,
    thinkingLimit: 250,
    decisionHistoryLimit: 1000,
    export: true,
    team: true,
    minutesPerFileLimit: 120,
    totalMinutesLimit: 1200,
    aiRequestLimit: 250,
    meetingContinuity: true,
    executionTracking: 'full',
    historicalInsights: true,
    smartReminders: true,
    decisionExtraction: 'full',
    taskExtraction: 'full',
    meetingIntelligence: 'advanced',
    persistence: 'persistent'
  },
  team: {
    transcription: true,
    thinkingLimit: 1500,
    decisionHistoryLimit: 'unlimited',
    export: true,
    team: true,
    minutesPerFileLimit: 180,
    totalMinutesLimit: 5000,
    aiRequestLimit: 1500,
    meetingContinuity: true,
    executionTracking: 'full',
    historicalInsights: true,
    smartReminders: true,
    decisionExtraction: 'full',
    taskExtraction: 'full',
    meetingIntelligence: 'advanced',
    persistence: 'persistent'
  },
  enterprise: {
    transcription: true,
    thinkingLimit: 10000,
    decisionHistoryLimit: 'unlimited',
    export: true,
    team: true,
    minutesPerFileLimit: 300,
    totalMinutesLimit: 25000,
    aiRequestLimit: 10000,
    advancedSecurity: true,
    meetingContinuity: true,
    executionTracking: 'full',
    historicalInsights: true,
    smartReminders: true,
    decisionExtraction: 'full',
    taskExtraction: 'full',
    meetingIntelligence: 'advanced',
    persistence: 'persistent'
  }
};

export const canUseFeature = (plan: SubscriptionTier, feature: keyof PlanFeatures): boolean => {
  const features = PLAN_FEATURES[plan];
  const value = features[feature];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (value === 'unlimited') return true;
  if (value === 'none') return false;
  return true;
};

/**
 * Authoritative Server-Side Pricing Definitions (Amounts in Paise for INR)
 */
export const SUBSCRIPTION_PRICING = {
  pro: {
    monthly: { price: 99900, label: '₹999/month' },
    yearly: { price: 79900 * 12, label: '₹799/mo (₹9,588 billed yearly)' }
  },
  team: {
    monthly: { price: 249900, label: '₹2,499/month' },
    yearly: { price: 199900 * 12, label: '₹1,999/mo (₹23,988 billed yearly)' }
  }
} as const;

export const MINUTE_TOPUP_PACKAGES = {
  100: {
    minutes: 100,
    amountInPaise: 9900,
    amount: 99,
    label: "+100 Minutes",
    popular: false,
    badge: "Starter"
  },
  350: {
    minutes: 350,
    amountInPaise: 29900,
    amount: 299,
    label: "+350 Minutes",
    popular: true,
    badge: "Best Value"
  },
} as const;

export const AI_REQUEST_TOPUP_PACKAGES = {
  100: {
    requests: 100,
    amountInPaise: 9900,
    amount: 99,
    label: "+100 AI Requests",
    popular: false,
    badge: "Starter"
  },
  500: {
    requests: 500,
    amountInPaise: 39900,
    amount: 399,
    label: "+500 AI Requests",
    popular: true,
    badge: "Professional"
  },
  1500: {
    requests: 1500,
    amountInPaise: 99900,
    amount: 999,
    label: "+1500 AI Requests",
    popular: false,
    badge: "Business"
  },
} as const;

export const TOPUP_PRICING: Record<number, number> = {
  100: 9900,   // ₹99
  350: 29900   // ₹299
};

export const THINKING_TOPUP_PRICING: Record<number, number> = {
  100: 9900,    // ₹99
  500: 39900,   // ₹399
  1500: 99900   // ₹999
};

