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
    aiRequestLimit: 20,
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
    thinkingLimit: 1000,
    decisionHistoryLimit: 1000,
    export: true,
    team: true,
    minutesPerFileLimit: 120,
    totalMinutesLimit: 1200,
    aiRequestLimit: 1000,
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
    thinkingLimit: 'unlimited',
    decisionHistoryLimit: 'unlimited',
    export: true,
    team: true,
    minutesPerFileLimit: 180,
    totalMinutesLimit: 5000,
    aiRequestLimit: 'unlimited',
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
    thinkingLimit: 'unlimited',
    decisionHistoryLimit: 'unlimited',
    export: true,
    team: true,
    minutesPerFileLimit: 300,
    totalMinutesLimit: 50000,
    aiRequestLimit: 'unlimited',
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
