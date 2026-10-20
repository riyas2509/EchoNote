
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
  meetingSessionId?: string;
  provenanceManifestId?: string;
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
  meetingSessionId?: string;
  externalMeetingId?: string;
  provider?: MeetingPlatformProvider;
  provenanceManifestId?: string;
  isTrimmedVersion?: boolean;
  parentRecordingId?: string;
  trimRange?: {
    startTime: number;
    endTime: number;
    duration: number;
  };
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

// ============================================================================
// PROJECT COLLABORATION ROLES (Phase 1 Target Model & Backward Compatibility)
// ============================================================================

/**
 * Target canonical project collaboration roles:
 * - owner: Full project control, deletion, settings, and member management.
 * - admin: Manage project members/invites, edit/manage recordings, transcripts, and tasks.
 * - commenter: View permitted project recordings and transcripts; create and manage own comments.
 * - viewer: Read-only access to permitted project recordings and transcripts.
 */
export type TargetProjectRole = 'owner' | 'admin' | 'commenter' | 'viewer';

/**
 * Legacy project collaboration role preserved for non-destructive, backward-compatible
 * reading of existing Firestore documents without requiring immediate database migration.
 */
export type LegacyProjectRole = 'editor';

/**
 * Authoritative project collaboration role type representing both canonical target roles
 * and legacy stored roles.
 */
export type CollaborationRole = TargetProjectRole | LegacyProjectRole;

/**
 * Explicit alias to clearly distinguish Project-level collaboration role from Organization-level role.
 */
export type ProjectCollaborationRole = CollaborationRole;

/**
 * Normalizes any project collaboration role string (including legacy 'editor')
 * into the canonical target role: 'owner' | 'admin' | 'commenter' | 'viewer'.
 * 
 * Non-destructive mapping:
 * - editor -> admin
 * - admin -> admin
 * - owner -> owner
 * - commenter -> commenter
 * - viewer -> viewer
 * 
 * Safe default:
 * Unknown, missing, or invalid role values safely resolve to 'viewer' (least privilege).
 * Unknown values NEVER become admin.
 */
export function normalizeProjectRole(role?: string | null): TargetProjectRole {
  if (!role || typeof role !== 'string') return 'viewer';
  const normalized = role.toLowerCase().trim();
  switch (normalized) {
    case 'owner':
      return 'owner';
    case 'admin':
    case 'editor':
      return 'admin';
    case 'commenter':
      return 'commenter';
    case 'viewer':
      return 'viewer';
    default:
      return 'viewer';
  }
}

/**
 * Granular project capability permissions evaluated during server-side authorization.
 */
export type ProjectPermission = 
  | 'VIEW'
  | 'COMMENT'
  | 'EDIT_CONTENT'
  | 'MANAGE_PROJECT'
  | 'MANAGE_MEMBERS'
  | 'DELETE_PROJECT';

export interface ProjectPermissions {
  canView: boolean;
  canComment: boolean;
  canEditContent: boolean;
  canManageProject: boolean;
  canManageMembers: boolean;
  canDeleteProject: boolean;
}

export interface ProjectAccessResolution {
  hasAccess: boolean;
  role: TargetProjectRole | null;
  rawRole?: string | null;
  isOwner: boolean;
  isDirectCreator: boolean;
  isOrgAdmin: boolean;
  isPlatformAdmin: boolean;
  organizationId?: string | null;
  project?: any;
  permissions: ProjectPermissions;
  reason?: string;
  notFound?: boolean;
  mfaRequired?: boolean;
  mfaRequirement?: string;
  mfaEnrolled?: boolean;
}

/**
 * Maps a canonical TargetProjectRole to its default permission capabilities.
 */
export function getProjectRolePermissions(role: TargetProjectRole | null): ProjectPermissions {
  if (!role) {
    return {
      canView: false,
      canComment: false,
      canEditContent: false,
      canManageProject: false,
      canManageMembers: false,
      canDeleteProject: false
    };
  }
  switch (role) {
    case 'owner':
      return {
        canView: true,
        canComment: true,
        canEditContent: true,
        canManageProject: true,
        canManageMembers: true,
        canDeleteProject: true
      };
    case 'admin':
      return {
        canView: true,
        canComment: true,
        canEditContent: true,
        canManageProject: true,
        canManageMembers: true,
        canDeleteProject: false
      };
    case 'commenter':
      return {
        canView: true,
        canComment: true,
        canEditContent: false,
        canManageProject: false,
        canManageMembers: false,
        canDeleteProject: false
      };
    case 'viewer':
    default:
      return {
        canView: true,
        canComment: false,
        canEditContent: false,
        canManageProject: false,
        canManageMembers: false,
        canDeleteProject: false
      };
  }
}

// ============================================================================
// ORGANIZATION ROLES (Preserved for Custom Claims and Enterprise Hierarchy)
// ============================================================================
export type AuthoritativeOrgRole = 'owner' | 'org_admin' | 'team_manager' | 'member' | 'viewer';
export type OrgRole = AuthoritativeOrgRole;

/**
 * Normalizes any legacy or arbitrary role string into an authoritative OrgRole.
 * Legacy mapping:
 * - 'owner', 'super_admin' -> 'owner'
 * - 'org_admin', 'admin' -> 'org_admin'
 * - 'team_manager', 'team_lead', 'manager', 'dept_manager', 'project_manager' -> 'team_manager'
 * - 'member' -> 'member'
 * - 'viewer', 'guest', or anything else -> 'viewer'
 */
export function normalizeOrgRole(role?: string | null): OrgRole {
  if (!role || typeof role !== 'string') return 'viewer';
  const r = role.toLowerCase().trim();
  if (r === 'owner' || r === 'super_admin') return 'owner';
  if (r === 'org_admin' || r === 'admin') return 'org_admin';
  if (r === 'team_manager' || r === 'team_lead' || r === 'manager' || r === 'dept_manager' || r === 'project_manager') return 'team_manager';
  if (r === 'member') return 'member';
  return 'viewer';
}

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
    | 'INVITATION_CANCELLED'
    | 'MEMBER_DEPARTMENT_ASSIGNED'
    | 'ORGANIZATION_CREATED' 
    | 'SECURITY_UPDATED' 
    | 'DOMAIN_ADDED'
    | 'DOMAIN_VERIFIED'
    | 'DOMAIN_VERIFICATION_FAILED'
    | 'DOMAIN_REMOVED'
    | 'SSO_LOGIN_SUCCESS' 
    | 'SSO_LOGIN_FAILED' 
    | 'SSO_LOGIN_BLOCKED'
    | 'SSO_CONFIGURATION_CREATED'
    | 'SSO_CONFIGURATION_UPDATED' 
    | 'SSO_CONFIGURATION_DELETED'
    | 'SSO_BYPASS_BLOCKED' 
    | 'SSO_TENANT_MISMATCH' 
    | 'SSO_AUDIENCE_MISMATCH'
    | 'SSO_IDENTITY_MISMATCH'
    | 'SSO_TOKEN_TYPE_INVALID'
    | 'SSO_TOKEN_REPLAYED'
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
    | 'PROJECT_INVITATION_CREATED'
    | 'PROJECT_INVITATION_ACCEPTED'
    | 'PROJECT_INVITATION_REVOKED'
    | 'MFA_ENROLLMENT_STARTED'
    | 'MFA_ENABLED'
    | 'MFA_DISABLED'
    | 'MFA_CHALLENGE_SUCCESS'
    | 'MFA_CHALLENGE_FAILURE'
    | 'MFA_RECOVERY_USED'
    | 'MFA_RECOVERY_CODES_GENERATED'
    | 'MFA_RECOVERY_CODE_REDEEMED'
    | 'MEMBER_ACCOUNT_CLOSED'
    | 'ORGANIZATION_DELETION_REQUESTED'
    | 'INTEGRATION_CONFIG_UPDATED'
    | 'INTEGRATION_DISCONNECTED';
  timestamp: string;
  source?: string;
  details?: string;
  metadata?: Record<string, any>;
}

export interface ProjectMember {
  projectId: string;
  uid: string;
  userId?: string;
  email: string;
  role: CollaborationRole;
  status?: ReadStatus;
  isOnline?: boolean;
  joinedAt: string;
  displayName?: string;
  lastActive?: string | null;
  photoURL?: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  projectId: string;
  projectName?: string;
  role: CollaborationRole;
  status: 'pending' | 'accepted' | 'declined';
  invitedBy: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  recordingId: string;
  projectId: string;
  organizationId?: string;
  userId: string;
  userEmail: string;
  userName: string;
  content: string;
  timestampSeconds?: number;
  parentCommentId?: string;
  createdAt: string;
  updatedAt?: string;
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
  lastUsageResetDate?: string; // ISO string (backward compatible alias)
  planExpiresAt: string; // ISO string
  createdAt: string;
  subscriptionStartDate?: string; // ISO string
  billingCycle?: 'monthly' | 'yearly';
  nextRefreshDate?: string; // ISO string
  mfaEnabled?: boolean;
  mfaEnrolledAt?: string; // ISO string
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: string; // ISO string
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

export interface TaggedTeamMember {
  name: string;
  email?: string;
  role?: string;
  reason: string;
  actionItems?: string[];
  avatarUrl?: string;
}

export interface SmartRecap {
  executiveSummary: [string, string, string] | string[]; // Exactly 3-bullet point executive summary
  taggedMembers: TaggedTeamMember[];
  generatedAt: string;
  recordingId?: string;
  meetingTopic?: string;
  strategicTakeaway?: string;
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
  smartRecap?: SmartRecap;
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
  meetingSessionId?: string;
  externalMeetingId?: string;
  provider?: MeetingPlatformProvider;
  provenanceManifestId?: string;
  isTrimmedVersion?: boolean;
  parentRecordingId?: string;
  trimRange?: {
    startTime: number;
    endTime: number;
    duration: number;
  };
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
  mfaRequirement?: 'MFA_DISABLED' | 'MFA_OPTIONAL' | 'MFA_REQUIRED_ADMINS' | 'MFA_REQUIRED_ALL' | 'MFA_ENFORCED_ALL';
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
  actionType: 'upload_file' | 'create_bookmark' | 'generate_decision' | 'create_transcript' | 'invite_member' | 'join_project' | 'decline_invite' | 'comment_added' | 'comment_updated' | 'comment_deleted';
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
  meetingSessionId?: string;
  sourceTimestamp?: number;
  transcriptSegmentIndex?: number;
}

export interface UnifiedTask {
  id: string;
  description: string;
  assignee: string;
  deadline?: string;
  priority: 'High' | 'Medium' | 'Low';
  relatedDecisionId?: string;
  meetingSessionId?: string;
  sourceTimestamp?: number;
  transcriptSegmentIndex?: number;
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

export interface SubTask {
  id: string;
  title: string;
  completed: boolean;
}

export interface TaskActivity {
  id: string;
  action: string;
  performedBy: string;
  timestamp: string;
  details?: string;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  assigneeEmail: string;
  assigneeName?: string;
  assigneeId?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  startDate?: string;
  milestoneId?: string;
  milestoneTitle?: string;
  sourceType?: 'manual' | 'meeting_decision' | 'meeting_action_item' | 'transcript_mention';
  sourceDecisionId?: string;
  sourceActionItem?: string;
  sourceMeetingSessionId?: string;
  sourceRecordingId?: string;
  isAiSuggested?: boolean;
  acceptedBy?: string;
  acceptedAt?: string;
  subTasks?: SubTask[];
  activityHistory?: TaskActivity[];
  prerequisiteTaskIds?: string[];
  dependencyStatus?: 'ready' | 'blocked' | 'completed';
  blockingPrerequisites?: Array<{ id: string; title: string; status: string }>;
  dependentTaskIds?: string[];
  activeExceptions?: Array<{ id: string; type: string; severity: string; title: string; status: string }>;
  createdBy: string;
  creatorEmail?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TaskTemplateItem {
  id: string; // Template-internal identifier (e.g. "tpl_task_1")
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  startOffsetDays?: number; // Relative start date offset in days from instantiation anchor date
  dueOffsetDays?: number;   // Relative due date offset in days from instantiation anchor date
  prerequisiteTemplateItemIds?: string[]; // IDs of other template tasks within the same template that must finish first
  order?: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  scope: 'organization' | 'project';
  organizationId?: string;
  projectId?: string;
  tasks: TaskTemplateItem[];
  createdBy: string;
  creatorEmail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskExceptionHistoryEntry {
  id: string;
  action: 'created' | 'acknowledged' | 'in_progress' | 'resolved' | 'dismissed' | 'reopened' | 'updated' | 'assigned';
  performedBy: string; // User ID
  performedByName: string;
  performedByEmail: string;
  timestamp: string;
  details?: string;
  previousStatus?: string;
  newStatus?: string;
}

export type TaskExceptionType = 'blocked' | 'overdue' | 'at_risk' | 'dependency_issue' | 'other';
export type TaskExceptionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type TaskExceptionStatus = 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'dismissed';

export interface TaskException {
  id: string;
  organizationId?: string;
  projectId: string;
  taskId: string;
  taskTitle?: string;
  type: TaskExceptionType;
  title: string;
  description: string;
  severity: TaskExceptionSeverity;
  status: TaskExceptionStatus;
  reporterId: string;
  reporterName: string;
  reporterEmail: string;
  assignedToId?: string;
  assignedToName?: string;
  assignedToEmail?: string;
  resolutionSummary?: string;
  resolvedAt?: string;
  resolvedById?: string;
  dismissalReason?: string;
  dismissedAt?: string;
  dismissedById?: string;
  history: TaskExceptionHistoryEntry[];
  source?: 'manual' | 'tracking_engine';
  deduplicationKey?: string;
  isAutoManaged?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// Phase 1B, Step 3.7: Dependency & Deadline Tracking Models
// ==========================================

export type TrackingRiskLevel = 'critical' | 'high' | 'medium' | 'low';

export type TrackingRiskCategory =
  | 'overdue'
  | 'due_soon'
  | 'starting_soon'
  | 'blocked_by_prerequisite'
  | 'blocked_by_overdue_prerequisite'
  | 'downstream_deadline_at_risk'
  | 'unresolved_exception'
  | 'unscheduled_active_task';

export interface TaskRiskIndicator {
  taskId: string;
  taskTitle: string;
  category: TrackingRiskCategory;
  severity: TrackingRiskLevel;
  reason: string;
  details: string;
  dueDate?: string | null;
  startDate?: string | null;
  assigneeEmail?: string | null;
  prerequisiteIds?: string[];
  prerequisiteTitles?: string[];
  blockingTaskIds?: string[];
  associatedExceptionIds?: string[];
  detectedAt: string;
}

export interface ProjectTrackingMetrics {
  totalActiveTasks: number;
  completedTasks: number;
  overdueTasksCount: number;
  dueSoonTasksCount: number;
  startingSoonTasksCount: number;
  blockedTasksCount: number;
  blockedByOverduePrereqCount: number;
  downstreamRiskCount: number;
  activeExceptionsCount: number;
  unscheduledTasksCount: number;
  healthScore: number; // 0 - 100
  evaluatedAt: string;
  lastSuccessfulJobRunAt?: string | null;
  monitoringStatus: 'healthy' | 'degraded' | 'pending' | 'never_run';
}

export interface ProjectTrackingReport {
  projectId: string;
  organizationId?: string | null;
  metrics: ProjectTrackingMetrics;
  risks: TaskRiskIndicator[];
  evaluatedAt: string;
  source: 'live_evaluation' | 'persisted_job';
}

export type MonitoringJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'retryable_failed';

export interface TrackingMonitoringJob {
  id: string;
  projectId: string;
  organizationId?: string | null;
  scope: 'project' | 'organization';
  status: MonitoringJobStatus;
  attempts: number;
  maxAttempts: number;
  leaseExpiresAt?: number | null;
  workerId?: string | null;
  lastError?: string | null;
  lastRunAt?: string | null;
  completedAt?: string | null;
  nextRetryAt?: number | null;
  summary?: {
    tasksEvaluated: number;
    risksDetected: number;
    exceptionsCreated: number;
    exceptionsResolved: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export type FollowUpMeetingStatus =
  | 'draft'
  | 'proposed'
  | 'awaiting_confirmation'
  | 'scheduled'
  | 'reschedule_requested'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface FollowUpParticipant {
  userId?: string;
  name: string;
  email: string;
  role?: string;
  status?: 'invited' | 'accepted' | 'declined' | 'tentative';
}

export interface FollowUpHistoryEntry {
  id: string;
  action: 'created' | 'proposed' | 'confirmed' | 'reschedule_requested' | 'rescheduled' | 'completed' | 'cancelled' | 'failed' | 'updated';
  performedBy: string; // User ID
  performedByName: string;
  performedByEmail: string;
  timestamp: string;
  details?: string;
  previousStatus?: string;
  newStatus?: string;
}

export interface FollowUpMeeting {
  id: string;
  organizationId?: string | null;
  projectId: string;
  relatedTaskIds: string[];
  relatedExceptionIds: string[];
  sourceMeetingSessionIds?: string[];
  title: string;
  purpose: string;
  generatedAgenda: string;
  reason: string;
  proposedParticipants: FollowUpParticipant[];
  proposedStartTime: string; // ISO 8601 string
  proposedEndTime: string;   // ISO 8601 string
  timezone: string;
  status: FollowUpMeetingStatus;
  provider: 'none' | 'google_calendar' | 'outlook_calendar' | 'zoom';
  externalEventId?: string | null;
  externalEventUrl?: string | null;
  lastSchedulingError?: string | null;
  confirmedAt?: string | null;
  rescheduledAt?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  history: FollowUpHistoryEntry[];
  createdBy: string;
  creatorName: string;
  creatorEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomatedTaggingDetection {
  memberEmail: string;
  memberName: string;
  memberUid?: string;
  taskId?: string;
  taskTitle: string;
  actionDescription: string;
  transcriptQuote: string;
  confidence: number;
  detectedDeadline?: string;
  applied?: boolean;
}

export interface AutomatedTaggingResult {
  success: boolean;
  detections: AutomatedTaggingDetection[];
  updatedTasksCount: number;
  createdTasksCount: number;
  updatedTaskIds: string[];
  createdTaskIds?: string[];
  message?: string;
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  startDate: string;
  dueDate: string;
  status: 'completed' | 'in_progress' | 'pending' | 'at_risk' | 'overdue';
  progressPercentage: number;
  totalTasks: number;
  completedTasks: number;
  targetDeliverable?: string;
  ownerName?: string;
}

export interface TimelineGanttItem {
  id: string;
  name: string;
  category: 'Milestone' | 'Task';
  assignee: string;
  status: 'completed' | 'in_progress' | 'pending' | 'overdue';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  startDateStr: string;
  dueDateStr: string;
  startOffsetDays: number;
  completedDays: number;
  remainingDays: number;
  totalDurationDays: number;
  progress: number;
  daysRemaining: number;
  isOverdue: boolean;
  details?: string;
}

export interface AuthAuditLog {
  id: string;
  eventType: string;
  action: string;
  status: 'denied' | 'allowed' | 'warning';
  severity: 'low' | 'medium' | 'high' | 'critical';
  actorUserId?: string | null;
  actorEmail?: string | null;
  organizationId?: string | null;
  projectId?: string | null;
  resourceId?: string | null;
  resourceType?: string | null;
  requiredPermission?: string | null;
  callerRole?: string | null;
  reason?: string;
  details?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any>;
  timestamp: string;
}

// ============================================================================
// PHASE 1B: MEETING PROVENANCE & INTEGRATION SCHEMAS (Provider-Agnostic)
// ============================================================================

export type MeetingPlatformProvider = 
  | 'zoom' 
  | 'google_meet' 
  | 'microsoft_teams' 
  | 'webex' 
  | 'native_upload' 
  | 'custom';

export type MeetingIntegrationStatus = 
  | 'active' 
  | 'disconnected' 
  | 'error' 
  | 'pending_auth' 
  | 'rate_limited' 
  | 'suspended';

export type MeetingCaptureMode = 
  | 'recording' 
  | 'live_transcript' 
  | 'post_meeting_webhook' 
  | 'manual_upload';

export type MeetingParticipantRole = 
  | 'host' 
  | 'co_host' 
  | 'presenter' 
  | 'attendee' 
  | 'guest';

export interface MeetingParticipant {
  id?: string;
  externalUserId?: string;
  name: string;
  email?: string;
  role: MeetingParticipantRole;
  joinedAt?: string;
  leftAt?: string;
}

export interface MeetingSourceReference {
  provider: MeetingPlatformProvider;
  externalMeetingId: string;
  calendarEventId?: string;
  sourceUrl?: string;
  seriesId?: string;
  captureMode: MeetingCaptureMode;
  instanceStartTime?: string;
}

export interface MeetingArtifactReference {
  artifactId: string;
  type: 'recording' | 'transcript' | 'summary' | 'decision_log' | 'task_manifest' | 'trimmed_recording';
  uri: string;
  mimeType?: string;
  contentHash?: string;
  sizeBytes?: number;
  derivedFromArtifactId?: string;
  trimRange?: {
    startTime: number;
    endTime: number;
    duration: number;
  };
  createdAt: string;
}

export interface MeetingProvenanceManifest {
  manifestId: string;
  meetingSessionId: string;
  provider: MeetingPlatformProvider;
  externalMeetingId: string;
  sourceReference: MeetingSourceReference;
  captureMode: MeetingCaptureMode;
  capturedAt: string;
  ingestedAt: string;
  schemaVersion: '1.0';
  rawArtifacts: MeetingArtifactReference[];
  participants: MeetingParticipant[];
  metadataHash?: string;
}

export interface MeetingSessionRecord {
  id: string;
  projectId?: string;
  organizationId?: string;
  userId: string;
  provider: MeetingPlatformProvider;
  externalMeetingId: string;
  calendarEventId?: string;
  title: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  durationSeconds?: number;
  participants: MeetingParticipant[];
  sourceReference: MeetingSourceReference;
  recordingId?: string;
  transcriptId?: string;
  provenanceManifestId: string;
  status: 'scheduled' | 'capturing' | 'ingested' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationConnectionPublicView {
  id: string;
  provider: MeetingPlatformProvider;
  status: MeetingIntegrationStatus;
  organizationId?: string;
  userId: string;
  scopes: string[];
  externalAccountEmail?: string;
  externalAccountName?: string;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationConnectionConfig {
  id: string;
  provider: MeetingPlatformProvider;
  status: MeetingIntegrationStatus;
  organizationId?: string;
  userId: string;
  scopes: string[];
  externalAccountId?: string;
  externalAccountEmail?: string;
  externalAccountName?: string;
  encryptedCredentials?: string;
  encryptionKeyId?: string;
  webhookSecretEncrypted?: string;
  refreshTokenExpiresAt?: string;
  lastSyncAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgIntegrationPublicView {
  id: string;
  enabled: boolean;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  config: Record<string, any>;
  updatedAt?: string | null;
  hasEncryptedSecrets?: boolean;
  encryptionKeyId?: string;
}

export interface OrgIntegrationListResponse {
  success: boolean;
  organizationId: string;
  integrations: Record<string, OrgIntegrationPublicView>;
}

export interface OrgIntegrationDetailResponse {
  success: boolean;
  integration: OrgIntegrationPublicView;
}

export interface IngestMeetingPayload {
  provider: MeetingPlatformProvider;
  externalMeetingId: string;
  title: string;
  projectId?: string;
  organizationId?: string;
  calendarEventId?: string;
  startTime?: string;
  endTime?: string;
  participants: MeetingParticipant[];
  sourceReference: MeetingSourceReference;
  artifacts?: {
    recordingAudioBase64?: string;
    recordingMimeType?: string;
    recordingStoragePath?: string;
    transcriptText?: string;
    transcriptSegments?: TranscriptSegment[];
  };
}

export interface IngestMeetingResponse {
  meetingSessionId: string;
  provenanceManifestId: string;
  recordingId?: string;
  transcriptId?: string;
  status: 'ingested' | 'processing' | 'completed';
}

export interface GetMeetingProvenanceResponse {
  meetingSession: MeetingSessionRecord;
  provenanceManifest: MeetingProvenanceManifest;
  recording?: Recording | null;
  transcript?: Transcript | null;
  intelligence?: {
    decisions: UnifiedDecision[];
    tasks: UnifiedTask[];
  };
}

export interface UnassociatedMeetingItem {
  id: string;
  externalMeetingId: string;
  meetingInstanceUuid?: string | null;
  title: string;
  provider: MeetingPlatformProvider;
  actualStartTime?: string | null;
  durationSeconds?: number | null;
  participants: MeetingParticipant[];
  recordingId?: string | null;
  transcriptId?: string | null;
  provenanceManifestId?: string | null;
  organizationId?: string | null;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AssociateMeetingPayload {
  projectId: string | null;
}

export interface AssociateMeetingResponse {
  success: boolean;
  message: string;
  sessionId: string;
  projectId: string | null;
  organizationId?: string | null;
}

export interface ProjectMeetingListResponse {
  success: boolean;
  projectId: string;
  meetings: UnassociatedMeetingItem[];
  count: number;
}

export type ProjectSearchResultType = 'meeting' | 'transcript' | 'decision' | 'task' | 'unresolved_topic';

export interface ProjectSearchResultItem {
  id: string;
  type: ProjectSearchResultType;
  title: string;
  excerpt: string;
  date?: string | null;
  score: number;
  metadata: {
    meetingSessionId?: string | null;
    externalMeetingId?: string | null;
    meetingTitle?: string | null;
    recordingId?: string | null;
    transcriptId?: string | null;
    provenanceManifestId?: string | null;
    speaker?: string | null;
    timestampSeconds?: number | null;
    assignee?: string | null;
    status?: string | null;
    priority?: string | null;
    confidenceLevel?: string | null;
    sourceType?: 'evidence' | 'intelligence' | 'execution';
  };
}

export interface ProjectSearchResponse {
  success: boolean;
  projectId: string;
  query: string;
  totalMatches: number;
  countsByType: Record<ProjectSearchResultType, number>;
  results: ProjectSearchResultItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SearchHistoryFilters {
  selectedTypes?: ProjectSearchResultType[];
  startDate?: string | null;
  endDate?: string | null;
}

export interface SearchHistoryEntry {
  id: string;
  userId: string;
  organizationId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  query: string;
  scope: 'global' | 'project';
  filters?: SearchHistoryFilters;
  createdAt: string;
  lastUsedAt: string;
}

export interface SearchHistoryListResponse {
  success: boolean;
  entries: SearchHistoryEntry[];
}

// ============================================================================
// TASK & DEADLINE NOTIFICATIONS (Phase 3 Step 3.1)
// ============================================================================

export type TaskNotificationType =
  | 'task_assignment'
  | 'upcoming_deadline'
  | 'overdue_task'
  | 'blocked_task';

export type TaskNotificationDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'dispatching'
  | 'sent'
  | 'retryable_failed'
  | 'permanently_failed'
  | 'ambiguous_delivery';


export interface TaskNotificationPayload {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName?: string;
  organizationId?: string | null;
  recipientEmail: string;
  recipientName?: string;
  dueDate?: string | null;
  priority?: string | null;
  status?: string | null;
  exceptionId?: string | null;
  exceptionTitle?: string | null;
  exceptionSeverity?: string | null;
  details?: string | null;
  appUrl?: string;
}

export interface TaskNotificationRecord {
  id: string; // Deterministic deduplication key
  taskId: string;
  projectId: string;
  organizationId: string | null;
  type: TaskNotificationType;
  recipientEmail: string;
  recipientName?: string;
  eventHash: string;
  status: TaskNotificationDeliveryStatus;
  leaseExpiresAt: number | null;
  workerId: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  providerMessageId: string | null;
  payload: TaskNotificationPayload;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  dispatchStartedAt?: string | null;
  quarantinedAt?: string | null;
  reconciliation?: {
    reconciledBy: string;
    reconciledAt: string;
    reconciliationReason: string;
    reconciliationDecision: string;
  } | null;
}




