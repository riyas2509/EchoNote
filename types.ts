
export interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface Transcript {
  id: string;
  recordingId: string;
  summary: string;
  actionItems: string[];
  segments: TranscriptSegment[];
  entities?: string[];
  createdAt: string;
}

export interface Recording {
  id: string;
  projectId: string;
  userId: string;
  fileName: string;
  storagePath: string;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  duration?: number;
  mimeType?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface CallSummary {
  mainTopic: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: string[];
}

export interface Bookmark {
  id: string;
  segmentIndex: number;
  speaker: string;
  text: string;
  timestamp: number;
  userName?: string;
}

export interface SpeakerMapping {
  [label: string]: string; // "Speaker 1" -> "John Doe"
}

export type CollaborationRole = 'owner' | 'editor' | 'viewer';
export type ReadStatus = 'not-read' | 'in-progress' | 'read';

export interface ProjectMember {
  projectId: string;
  uid: string;
  email: string;
  role: CollaborationRole;
  status?: ReadStatus;
  isOnline?: boolean;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  projectId: string;
  role: CollaborationRole;
  status: 'pending' | 'accepted' | 'declined';
  invitedBy: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail?: string;
  isDefault?: boolean;
  members: ProjectMember[];
  createdAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  name?: string;
  role?: 'admin' | 'user';
  plan: SubscriptionTier;
  subscriptionStatus?: 'active' | 'past_due' | 'canceled' | 'incomplete' | 'created' | 'authenticated' | 'activated';
  razorpayCustomerId?: string;
  minutesUsed: number;
  minutesLimit: number;
  minutes_remaining?: number;
  billing_cycle?: 'monthly' | 'yearly';
  thinkingUsageCount: number;
  teamId?: string;
  createdAt: string;
}

export interface Subscription {
  id: string;
  userId: string;
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  status: string;
  razorpaySubscriptionId: string;
  razorpayPlanId: string;
  currentPeriodEnd: string;
  billingCycle?: string;
}

export interface Usage {
  userId: string;
  minutesUsed: number;
  monthlyLimit: number;
}

export type VoiceGender = 'male' | 'female';

export interface StrategicAnalysis {
  coreIntent: string;
  context: string;
  assumptions: string[];
  logicalGaps: string[];
  blindSpots: string[];
  strategicQuestions: string[];
  recommendations: string[];
  alternativePerspectives: string[];
  ignoredQuestions: string[];
  decisionFramework: string;
  nextSteps: string[];
}

export interface DecisionIntelligenceResult {
  keyDecisions: string[];
  assumptions: string[];
  risksAndGaps: string[];
  alternativePerspectives: string[];
  ignoredQuestions: string[];
  decisionClarity: string;
  nextActions: string[];
}

export interface DecisionHistoryItem {
  id: string;
  userId: string;
  title: string;
  inputType: 'transcript' | 'summary';
  inputText: string;
  output: DecisionIntelligenceResult;
  createdAt: string;
}

export interface AudioToTextRecord {
  id: string;
  date: string;
  fileName: string;
  sourceType: 'live' | 'recorded';
  originalAudioUrl?: string; 
  transcript: TranscriptSegment[];
  summary?: CallSummary;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'draft';
  processingStep?: string; 
  errorMessage?: string; 
  readStatus: ReadStatus; 
  bookmarks: Bookmark[];
  qualityScore?: number;
  strategicAnalysis?: StrategicAnalysis;
  ownerEmail: string;
  speakerMap: SpeakerMapping;
  collaborators: ProjectMember[];
  group: string; 
  projectId?: string;
  deletedAt?: string; // ISO string when moved to trash
}

export interface TextToAudioRecord {
  id: string;
  date: string;
  textPreview: string;
  fullText: string;
  audioUrl: string;
  gender: VoiceGender;
  group: string;
  projectId?: string;
  collaborators: ProjectMember[];
  deletedAt?: string; // ISO string when moved to trash
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  timestamp: number;
  isRead: boolean;
  type: 'audio' | 'text' | 'error' | 'success' | 'info';
  link?: string;
  recordId?: string;
}

export enum AppWorkflow {
  HOME = 'home',
  AUDIO_TO_TEXT = 'audio-to-text',
  TEXT_TO_AUDIO = 'text-to-audio',
  DECISION_INTELLIGENCE = 'decision-intelligence',
  DECISION_HISTORY = 'decision-history',
  HISTORY = 'history',
  SUBSCRIPTION = 'subscription'
}

export enum MainView {
  LANDING = 'landing',
  APP = 'app',
  AUTH = 'auth',
  PRIVACY = 'privacy',
  TERMS = 'terms',
  SECURITY = 'security',
  CONTACT = 'contact',
  DEMO = 'demo'
}

export type SubscriptionTier = 'guest' | 'free' | 'pro' | 'team' | 'enterprise';

export interface UsageStats {
  usedMinutes: number;
  totalMinutes: number;
  plan: SubscriptionTier;
  renewalDate: string;
  minutesPerFileLimit: number;
}

export enum AuthStatus {
  UNAUTHENTICATED = 'unauthenticated',
  GUEST = 'guest',
  LOGGED_IN = 'logged-in'
}

export interface PlaybackMetadata {
  id: string;
  title: string;
  url: string;
  segmentIndex?: number;
}

export type PlaybackStatus = 'playing' | 'paused' | 'stopped';
