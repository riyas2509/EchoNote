
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
export type AuthoritativeOrgRole = 'owner' | 'org_admin' | 'team_manager' | 'member' | 'viewer';
export type OrgRole = AuthoritativeOrgRole | 'super_admin' | 'admin' | 'team_lead' | 'guest';
export type ReadStatus = 'not-read' | 'in-progress' | 'read';

export interface CustomClaims {
  orgId?: string;
  orgRole?: AuthoritativeOrgRole;
  role?: 'admin' | 'user';
  platform_admin?: boolean;
  isOwner?: boolean;
}

export interface OrgAuditEvent {
  id?: string;
  organizationId: string;
  actorUserId: string;
  actorEmail: string;
  targetUserId?: string;
  targetUserEmail?: string;
  previousRole?: string;
  newRole?: string;
  action: 
    | 'ROLE_ASSIGNED' 
    | 'ROLE_CHANGED' 
    | 'ROLE_REVOKED' 
    | 'OWNER_TRANSFERRED' 
    | 'MEMBER_DEACTIVATED' 
    | 'MEMBER_REACTIVATED' 
    | 'MEMBER_INVITED' 
    | 'MEMBER_REMOVED' 
    | 'ORGANIZATION_CREATED' 
    | 'SECURITY_UPDATED' 
    | 'SSO_LOGIN_SUCCESS' 
    | 'SSO_LOGIN_FAILED' 
    | 'SSO_LOGIN_BLOCKED'
    | 'SSO_CONFIGURATION_CREATED'
    | 'SSO_CONFIGURATION_UPDATED' 
    | 'SSO_CONFIGURATION_DELETED'
    | 'SSO_BYPASS_BLOCKED' 
    | 'SSO_TENANT_MISMATCH' 
    | 'ENTERPRISE_LOGIN_SUCCESS'
    | 'ENTERPRISE_JIT_PROVISIONED'
    | 'SAML_CONFIGURATION_CREATED' 
    | 'SAML_CONFIGURATION_UPDATED' 
    | 'SAML_CONFIGURATION_ENABLED' 
    | 'SAML_CONFIGURATION_DISABLED' 
    | 'SAML_LOGIN_SUCCESS' 
    | 'SAML_LOGIN_FAILURE' 
    | 'SAML_LOGIN_BLOCKED' 
    | 'SAML_CONFIGURATION_ERROR' 
    | 'SSO_ENFORCEMENT_ENABLED' 
    | 'SSO_ENFORCEMENT_DISABLED' 
    | 'JIT_USER_CREATED' 
    | 'JIT_USER_UPDATED' 
    | 'JIT_MEMBER_CREATED' 
    | 'JIT_ROLE_ASSIGNED' 
    | 'JIT_ROLE_CHANGED' 
    | 'JIT_DEPARTMENT_ASSIGNED' 
    | 'JIT_MAPPING_APPLIED' 
    | 'JIT_MAPPING_CONFLICT' 
    | 'JIT_PROVISIONING_BLOCKED' 
    | 'JIT_USER_DEACTIVATED' 
    | 'JIT_USER_REACTIVATED' 
    | 'IDENTITY_MAPPING_CREATED' 
    | 'IDENTITY_MAPPING_UPDATED' 
    | 'IDENTITY_MAPPING_DELETED'
    | 'PROJECT_DELETED'
    | 'PROJECT_OWNERSHIP_TRANSFERRED'
    | 'MEMBER_ACCOUNT_CLOSED'
    | 'ORGANIZATION_DELETION_REQUESTED';
  timestamp: string;
  source: string;
  details?: string;
  metadata?: Record<string, any>;
}

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
  monthlyThinkingLimit?: number;
  monthlyThinkingUsed?: number;
  thinkingTopupBalance?: number;
  monthlyMinuteLimit?: number;
  monthlyMinutesUsed?: number;
  minuteTopupBalance?: number;
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
  storagePath?: string;
  deletedAt?: string; // ISO string when moved to trash
  _file?: Blob | File;
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
  storagePath?: string;
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
  PRODUCT_ANALYTICS = 'product-analytics',
  COLLABORATION_DASHBOARD = 'collaboration-dashboard',
  ORGANIZATION_DASHBOARD = 'organization-dashboard'
}

export enum ProductEventName {
  SIGNUP_COMPLETED = 'SIGNUP_COMPLETED',
  FIRST_APP_ENTRY = 'FIRST_APP_ENTRY',
  ONBOARDING_VIEWED = 'ONBOARDING_VIEWED',
  CAPTURE_STARTED = 'CAPTURE_STARTED',
  AUDIO_UPLOADED = 'AUDIO_UPLOADED',
  RECORDING_STARTED = 'RECORDING_STARTED',
  TRANSCRIPTION_STARTED = 'TRANSCRIPTION_STARTED',
  TRANSCRIPTION_COMPLETED = 'TRANSCRIPTION_COMPLETED',
  INTELLIGENCE_ANALYSIS_STARTED = 'INTELLIGENCE_ANALYSIS_STARTED',
  INTELLIGENCE_ANALYSIS_COMPLETED = 'INTELLIGENCE_ANALYSIS_COMPLETED',
  DECISION_VIEWED = 'DECISION_VIEWED',
  DECISION_SAVED = 'DECISION_SAVED',
  HISTORY_VIEWED = 'HISTORY_VIEWED',
  DECISION_SEARCHED = 'DECISION_SEARCHED',
  DECISION_RETRIEVED = 'DECISION_RETRIEVED',
  EXECUTION_ITEM_CREATED = 'EXECUTION_ITEM_CREATED',
  EXECUTION_ITEM_COMPLETED = 'EXECUTION_ITEM_COMPLETED',
  RETURN_SESSION = 'RETURN_SESSION',
  UPGRADE_STARTED = 'UPGRADE_STARTED',
  SUBSCRIPTION_STARTED = 'SUBSCRIPTION_STARTED'
}

export interface ProductEventPayload {
  eventName: ProductEventName | keyof typeof ProductEventName;
  userId?: string;
  organizationId?: string;
  teamId?: string;
  sessionId?: string;
  plan?: string;
  source?: string;
  entityType?: 'decision' | 'task' | 'recording' | 'search' | 'session' | 'subscription' | 'onboarding' | 'history';
  entityId?: string; // safe internal identifier
  isHistorical?: boolean; // true when retrieval represents accessing past memory, not current session
  metadata?: {
    durationMs?: number;
    decisionCount?: number;
    taskCount?: number;
    searchQueryLength?: number;
    retrievalMatchCount?: number;
    sessionIndex?: number;
    daysSinceFirstSeen?: number;
    [key: string]: string | number | boolean | undefined;
  };
}

export interface StoredProductEvent extends ProductEventPayload {
  id: string;
  timestamp: string; // ISO 8601 string
  createdAt?: any;
}

export interface OrgDomain {
  domain: string;
  orgId: string;
  status: 'verified' | 'unverified';
  dnsTxtRecord?: string;
  verifiedAt?: string;
  createdAt: string;
}

export type EnterpriseSsoProtocol = 'SAML' | 'OIDC';

export type EnterpriseProviderType = 
  | 'SAML' 
  | 'OIDC' 
  | 'MICROSOFT_ENTRA' 
  | 'GOOGLE_WORKSPACE' 
  | 'OKTA' 
  | 'PING' 
  | 'GENERIC_SAML' 
  | 'GENERIC_OIDC';

export interface OidcProviderConfig {
  issuer: string; // e.g. https://login.microsoftonline.com/{tenantId}/v2.0 or https://accounts.google.com
  clientId: string; // Client / Application ID
  clientSecretMasked?: string; // e.g. "••••••••" (secrets are never returned raw to client)
  hasClientSecret?: boolean;
  scopes?: string[]; // e.g. ['openid', 'email', 'profile']
  entraTenantId?: string; // Optional Microsoft Entra tenant ID
  entraClientId?: string;
  enabled: boolean;
  status: 'draft' | 'configured' | 'verified' | 'active';
  identityPlatformStatus?: 'synced' | 'local_fallback' | 'manual_required';
  lastTestedAt?: string;
  lastTestStatus?: 'success' | 'failed';
  lastTestError?: string;
  updatedAt?: string;
}

export interface EnterpriseSsoConfig {
  protocol: EnterpriseSsoProtocol;
  providerType: EnterpriseProviderType;
  providerId: string; // Deterministic collision-safe ID: e.g. saml.<orgId> or oidc.<orgId>
  displayName: string;
  identityPlatformTenantId?: string; // Associated Identity Platform Tenant ID
  enabled: boolean;
  enforceSso: boolean;
  status: 'draft' | 'configured' | 'verified' | 'active';
  identityPlatformStatus?: 'synced' | 'local_fallback' | 'manual_required';
  saml?: SamlProviderConfig;
  oidc?: OidcProviderConfig;
  lastTestedAt?: string;
  lastTestStatus?: 'success' | 'failed';
  lastTestState?: 'CONFIGURATION_VALID' | 'CONFIGURATION_INVALID' | 'EXTERNAL_AUTH_REQUIRED' | 'PROVIDER_NOT_CONFIGURED' | 'IDENTITY_PLATFORM_NOT_ENABLED';
  lastTestError?: string;
  configuredAt?: string;
  configuredBy?: string;
  updatedAt?: string;
}

export interface SamlProviderConfig {
  providerId: string; // Deterministic collision-safe ID: e.g. saml.<orgId>
  displayName: string; // e.g. "Okta", "OneLogin", "Ping Identity", "Enterprise SAML"
  entityId: string; // IdP Entity ID / Issuer URI
  ssoUrl: string; // IdP Single Sign-On HTTP-POST / HTTP-Redirect Service URL
  x509Certificates: string[]; // X.509 public signing certificates (supports rotation)
  spEntityId?: string; // Service Provider Entity ID / Audience
  callbackUrl?: string; // ACS Callback URL
  enabled: boolean;
  status: 'draft' | 'configured' | 'verified' | 'active';
  identityPlatformStatus?: 'synced' | 'local_fallback' | 'manual_required';
  lastTestedAt?: string;
  lastTestStatus?: 'success' | 'failed';
  lastTestError?: string;
  updatedAt?: string;
}

export type OrgSsoEnforcementState = 'SSO_DISABLED' | 'SSO_OPTIONAL' | 'SSO_REQUIRED' | 'SSO_CONFIGURATION_ERROR';

export type OrgAllowedAuthMethod = 'EMAIL_PASSWORD' | 'GOOGLE' | 'MICROSOFT' | 'OIDC' | 'SAML';

export type RemovedGroupBehavior = 'KEEP_ROLE' | 'REVERT_TO_DEFAULT_ROLE' | 'REMOVE_DEPARTMENT' | 'DEACTIVATE_MEMBER';

export type DeactivationBehavior = 'SUSPEND_ACCESS' | 'REVOKE_MEMBERSHIP';

export interface OrgSecurityHealthIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface OrgSecurityHealthSummary {
  status: 'HEALTHY' | 'WARNING' | 'CONFIGURATION_ERROR';
  issues: OrgSecurityHealthIssue[];
  summary: {
    verifiedDomainsCount: number;
    ssoState: OrgSsoEnforcementState;
    ssoProvider: string;
    ssoProtocol: 'OIDC' | 'SAML';
    allowedAuthMethods: OrgAllowedAuthMethod[];
    jitEnabled: boolean;
    invitationRequired: boolean;
    mappingsCount: number;
    sessionTimeoutMinutes: number;
    mfaRequirement: string;
    adminSafetyVerified: boolean;
  };
}

export interface AuthDiscoveryResult {
  authMode: 'standard' | 'enterprise';
  domain: string;
  ssoEnforced: boolean;
  ssoEnforcementState?: OrgSsoEnforcementState;
  organizationName?: string;
  ssoProvider?: string;
  ssoProviderType?: EnterpriseProviderType;
  ssoProtocol?: 'OIDC' | 'SAML';
  providerId?: string;
  samlProviderId?: string;
  ssoConfigurationError?: boolean;
  ssoErrorMessage?: string;
  entraTenantId?: string;
  identityPlatformTenantId?: string;
  allowedAuthMethods: ('sso' | 'password' | 'google' | 'microsoft')[];
  rawAllowedAuthMethods?: OrgAllowedAuthMethod[];
  orgId?: string;
  isDomainVerified?: boolean;
}

export interface OrgIdentityMapping {
  id: string;
  orgId: string;
  provider: 'entra' | 'saml' | 'google' | 'oidc' | 'all';
  sourceType: 'group' | 'department' | 'job_title' | 'claim';
  sourceValue: string;
  targetRole: AuthoritativeOrgRole;
  targetDepartmentId?: string;
  targetDepartmentName?: string;
  enabled: boolean;
  priority: number; // 1 to 100, higher number = evaluated first
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgJitSettings {
  jitProvisioningEnabled: boolean;
  provisioningMode: 'jit_allowed' | 'invitation_required';
  defaultJitRole: AuthoritativeOrgRole;
  defaultDepartmentId?: string;
  defaultDepartmentName?: string;
  roleManagementMode: 'manual' | 'idp_managed';
  syncIdentityAttributes: boolean;
  syncGroups: boolean;
  autoDeactivateRemovedUsers?: boolean;
  removedGroupBehavior?: RemovedGroupBehavior;
  deactivationBehavior?: DeactivationBehavior;
}

export interface OrgSecuritySettings {
  identityPlatformTenantId?: string;
  ssoStatus?: 'enabled' | 'disabled';
  ssoEnforcementState?: OrgSsoEnforcementState;
  ssoProtocol?: 'OIDC' | 'SAML';
  ssoProviderType?: EnterpriseProviderType;
  enforceSso?: boolean;
  allowedAuthMethods?: OrgAllowedAuthMethod[];
  entraTenantId?: string;
  entraClientId?: string;
  samlProvider?: SamlProviderConfig;
  oidcProvider?: OidcProviderConfig;
  ssoConfig?: EnterpriseSsoConfig | {
    enabled?: boolean;
    provider?: string;
    domainDiscovery?: boolean;
    jitEnabled?: boolean;
    defaultRole?: string;
  };
  allowedDomains?: string[] | string;
  enforceMfa?: boolean;
  mfaRequirement?: 'MFA_DISABLED' | 'MFA_OPTIONAL' | 'MFA_REQUIRED_ADMINS' | 'MFA_REQUIRED_ALL';
  sessionTimeoutMinutes?: number;
  enforceSessionTimeout?: boolean;
  twoFactorRequired?: boolean;
  allowedIpRanges?: string[];
  jitSettings?: OrgJitSettings;
  removedGroupBehavior?: RemovedGroupBehavior;
  deactivationBehavior?: DeactivationBehavior;
}

export interface Organization {
  id: string;
  name: string;
  domain?: string;
  domains?: OrgDomain[];
  ownerId: string;
  ownerEmail: string;
  plan: SubscriptionTier;
  createdAt: string;
  identityPlatformTenantId?: string;
  settings?: {
    allowedDomains?: string[];
    enforceMfa?: boolean;
    sessionTimeoutMinutes?: number;
    jitProvisioningEnabled?: boolean;
  };
  securitySettings?: OrgSecuritySettings;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  projectIds: string[];
  createdAt: string;
}

export interface Department {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  projectIds: string[];
  createdAt: string;
  minutesUsed?: number;
  aiCost?: number;
  aiUsage?: number;
  aiBudgetLimit?: number;
}

export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  email: string;
  name?: string;
  displayName?: string;
  role: OrgRole;
  departmentId?: string;
  departmentName?: string;
  teamId?: string;
  status: 'active' | 'pending' | 'deactivated';
  provisionedVia?: 'jit' | 'manual' | 'invitation';
  identityProvider?: string;
  syncedGroups?: string[];
  syncedAttributes?: Record<string, any>;
  lastActive?: string;
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
  monthlyThinkingLimit?: number;
  monthlyThinkingUsed?: number;
  thinkingTopupBalance?: number;
  monthlyMinuteLimit?: number;
  monthlyMinutesUsed?: number;
  minuteTopupBalance?: number;
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
