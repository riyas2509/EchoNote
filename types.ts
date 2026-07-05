
export interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface Transcript {
  id: string;
  recordingId: string;
  userId: string;
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
export type OrgRole = 'super_admin' | 'org_admin' | 'team_manager' | 'member' | 'viewer';
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
  userId: string;
  ownerEmail?: string;
  ownerName?: string;
  isDefault?: boolean;
  members: ProjectMember[];
  createdAt: string;
}

export interface SubscriptionEvent {
  type: 'upgrade' | 'downgrade' | 'renewal' | 'signup';
  from_plan?: SubscriptionTier;
  to_plan: SubscriptionTier;
  date: string;
  amount?: number;
}

export interface UserProfile {
  uid: string;
  email: string;
  name?: string;
  displayName?: string;
  photoURL?: string;
  avatarUrl?: string;
  role?: 'admin' | 'user';
  plan: SubscriptionTier;
  minutesUsed: number;
  extraMinutes?: number;
  thinkingUsed: number;
  billingStartDate?: string; // ISO string
  lastResetDate?: string; // ISO string
  planExpiresAt: string; // ISO string
  createdAt: string;
  subscriptionStartDate?: string; // ISO string
  billingCycle?: 'monthly' | 'yearly';
  nextRefreshDate?: string; // ISO string
  lastUsageResetDate?: string; // ISO string
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
  unresolvedTopics: UnifiedUnresolvedTopic[];
  decisionFramework: string;
  nextSteps: string[];
}

export interface DecisionIntelligenceResult {
  keyDecisions: string[];
  assumptions: string[];
  risksAndGaps: string[];
  alternativePerspectives: string[];
  ignoredQuestions: string[];
  unresolvedTopics: UnifiedUnresolvedTopic[];
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
  userId: string;
  date: string;
  fileName: string;
  sourceType: 'live' | 'recorded';
  originalAudioUrl?: string; 
  transcript: TranscriptSegment[];
  transcriptText?: string;
  speakers?: string[];
  summary?: CallSummary;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'draft';
  processingStep?: string; 
  errorMessage?: string; 
  readStatus: ReadStatus; 
  bookmarks: Bookmark[];
  qualityScore?: number;
  strategicAnalysis?: StrategicAnalysis;
  meetingIntelligence?: MeetingIntelligence;
  executionTracker?: ExecutionTracker;
  calendarReminders?: SmartReminderSystem;
  unifiedIntelligence?: UnifiedMeetingIntelligence;
  selectedModules?: string[];
  ownerEmail: string;
  speakerMap: SpeakerMapping;
  collaborators: ProjectMember[];
  group: string; 
  projectId?: string;
  deletedAt?: string; // ISO string when moved to trash
}

export interface TextToAudioRecord {
  id: string;
  userId: string;
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
  ADMIN_TRACKER = 'admin-tracker',
  COLLABORATION_DASHBOARD = 'collaboration-dashboard',
  ORGANIZATION_DASHBOARD = 'organization-dashboard'
}

export interface Organization {
  id: string;
  name: string;
  domain?: string;
  ownerId: string;
  ownerEmail: string;
  plan: SubscriptionTier;
  createdAt: string;
  settings?: {
    allowedDomains?: string[];
    enforceMfa?: boolean;
    sessionTimeoutMinutes?: number;
  };
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  projectIds: string[];
  createdAt: string;
}

export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  email: string;
  name?: string;
  role: 'owner' | 'admin' | 'team_lead' | 'member' | 'guest';
  status: 'active' | 'pending';
  joinedAt: string;
}

export interface OrgInvoice {
  id: string;
  orgId: string;
  date: string;
  amount: number;
  seats: number;
  status: 'paid' | 'pending' | 'overdue';
  plan: SubscriptionTier;
}

export interface ProjectActivity {
  id: string;
  projectId: string;
  userId: string;
  userEmail: string;
  userName: string;
  actionType: 'upload_file' | 'create_bookmark' | 'generate_decision' | 'create_transcript' | 'invite_member' | 'join_project' | 'decline_invite';
  description: string;
  createdAt: any;
  metadata?: any;
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
  aiRequestCount: number;
  aiRequestLimit: number | 'unlimited';
  thinkingLimit: number | 'unlimited';
  extraMinutes?: number;
  plan: SubscriptionTier;
  mode: 'guest' | 'free' | 'pro';
  renewalDate: string;
  minutesPerFileLimit: number;
}

export enum AuthStatus {
  UNAUTHENTICATED = 'unauthenticated',
  GUEST = 'guest',
  LOGGED_IN = 'logged-in'
}

export interface MeetingTopic {
  category: string;
  items: string[];
}

export interface UnifiedDecision {
  id: string;
  title: string;
  description: string;
  context: string;
  peopleInvolved: string[];
  confidenceLevel: 'High' | 'Medium' | 'Low';
  relatedTaskIds: string[];
}

export interface UnifiedTask {
  id: string;
  description: string;
  assignee: string;
  deadline?: string;
  priority: 'High' | 'Medium' | 'Low';
  relatedDecisionId?: string;
}

export interface UnifiedUnresolvedTopic {
  id: string;
  topic: string;
  context: string;
  reasonUnresolved: string;
  suggestedAction: string;
}

export interface MeetingIntelligence {
  productivityScore: number;
  productivityExplanation: string;
  clarityScore: number;
  clarityExplanation: string;
  actionabilityScore: number;
  actionabilityExplanation: string;
  effectivenessSummary: string;
  keyStrengths: string[];
  keyWeaknesses: string[];
}

export interface FollowUp {
  email: string;
  nextMeetingAgenda: string[];
  keyPendingItems: string[];
}

export interface ExecutionTask {
  id: string;
  description: string;
  assignee: string;
  status: 'Completed' | 'Pending' | 'Overdue' | 'In Progress';
}

export interface ExecutionTracker {
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  overdueTasks: number;
  completionRate: number;
  delayRate: number;
  tasks: ExecutionTask[];
  keyInsights: string[];
}

export interface CalendarReminder {
  id: string;
  title: string;
  description: string;
  suggestedDateTime: string; 
  priority: 'High' | 'Medium' | 'Low';
  group: 'Immediate' | 'Upcoming' | 'Long-term';
  calendarEventFormat: {
    title: string;
    description: string;
    location?: string;
    startTime: string;
    endTime: string;
  };
}

export interface SmartReminderSystem {
  reminders: CalendarReminder[];
  summary: string;
}

export interface UnifiedMeetingIntelligence {
  title: string;
  summary: string[];
  topics: MeetingTopic[];
  keyInsights: string[];
  decisions: UnifiedDecision[];
  tasks: UnifiedTask[];
  unresolvedTopics: UnifiedUnresolvedTopic[];
  meetingIntelligence: MeetingIntelligence;
  strategicAnalysis: StrategicAnalysis;
  executionTracker: ExecutionTracker;
  calendarReminders: SmartReminderSystem;
  followUp: FollowUp;
}

export interface PlaybackMetadata {
  id: string;
  title: string;
  url: string;
  segmentIndex?: number;
}

export type PlaybackStatus = 'playing' | 'paused' | 'stopped';
