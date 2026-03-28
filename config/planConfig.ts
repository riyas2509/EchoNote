import { SubscriptionTier } from '../types';

export interface PlanFeatures {
  transcription: boolean;
  thinkingLimit: number | 'unlimited';
  decisionHistoryLimit: number | 'unlimited';
  export: boolean;
  team: boolean;
  minutesPerFileLimit: number;
  totalMinutesLimit: number;
  advancedSecurity?: boolean;
}

export const PLAN_FEATURES: Record<SubscriptionTier, PlanFeatures> = {
  guest: {
    transcription: true,
    thinkingLimit: 1,
    decisionHistoryLimit: 1,
    export: false,
    team: false,
    minutesPerFileLimit: 5,
    totalMinutesLimit: 30
  },
  free: {
    transcription: true,
    thinkingLimit: 3,
    decisionHistoryLimit: 5,
    export: false,
    team: false,
    minutesPerFileLimit: 15,
    totalMinutesLimit: 60
  },
  pro: {
    transcription: true,
    thinkingLimit: 'unlimited',
    decisionHistoryLimit: 'unlimited',
    export: true,
    team: false,
    minutesPerFileLimit: 60,
    totalMinutesLimit: 600
  },
  team: {
    transcription: true,
    thinkingLimit: 'unlimited',
    decisionHistoryLimit: 'unlimited',
    export: true,
    team: true,
    minutesPerFileLimit: 120,
    totalMinutesLimit: 1000
  },
  enterprise: {
    transcription: true,
    thinkingLimit: 'unlimited',
    decisionHistoryLimit: 'unlimited',
    export: true,
    team: true,
    minutesPerFileLimit: 300,
    totalMinutesLimit: 10000,
    advancedSecurity: true
  }
};
