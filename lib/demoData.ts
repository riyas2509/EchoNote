/**
 * EchoNote — Interactive Product Demo Sample Dataset & State Fixtures
 * 
 * Provides coherent, realistic sample records strictly labeled as demo data:
 * - Project: Enterprise API Migration
 * - Meeting: API Migration Kickoff Sync (Zoom synced, verified SHA256 provenance manifest)
 * - Timestamped transcript with named speakers (Sarah Connor, Alex Chen, Marcus Vance)
 * - Structured Meeting Summary & Strategic Thinking Partner Intelligence
 * - Strategic Decision: Deprecate Legacy v1 Ingestion Pipeline by End of Q4 (Unanimous, Alex Chen)
 * - Action Items & Tasks with owners, deadlines, priorities, dependencies
 * - Blocked Task: "Publish Client SDK v2.4" blocked by prerequisite "Generate SHA256 Signing Keys" (Marcus Vance, overdue)
 * - Task Exception: Prerequisite risk exception tied to blocked task
 * - Proactive Follow-up: "API Migration Blockers Review" with pre-populated agenda and proposed participants
 * - Project Health: Execution tracking metrics with 72% degraded health due to blocked prerequisite
 * 
 * ALL entities are deeply frozen and immutable. Use createInitialDemoState() to get isolated clones.
 */

import {
  Project,
  ProjectMember,
  ProjectTask,
  TaskException,
  FollowUpMeeting,
  AudioToTextRecord,
  TranscriptSegment,
  UnassociatedMeetingItem,
  ProjectTrackingMetrics,
  TaskRiskIndicator,
  DecisionHistoryItem
} from '../types';

// Distinct identifiers for Demo Domain
export const DEMO_PROJECT_ID = 'demo-proj-migration';
export const DEMO_PROJECT_NAME = 'Enterprise API Migration';
export const DEMO_MEETING_ID = 'demo-rec-kickoff';
export const DEMO_MEETING_TITLE = 'Enterprise API Migration Kickoff Sync';
export const DEMO_DECISION_ID = 'demo-dec-v1-deprecation';
export const DEMO_TASK_SIGNING_KEYS_ID = 'demo-task-signing-keys';
export const DEMO_TASK_CLIENT_SDK_ID = 'demo-task-client-sdk';
export const DEMO_TASK_PARTNER_NOTICE_ID = 'demo-task-partner-notice';
export const DEMO_EXCEPTION_ID = 'demo-exc-signing-keys-blocker';
export const DEMO_FOLLOWUP_ID = 'demo-fol-blockers-review';
export const DEMO_USER_UID = 'demo-user-viewer';
export const DEMO_USER_EMAIL = 'sarah.connor@echonote.internal';

// ----------------------------------------------------------------------------
// 1. Demo Project Members
// ----------------------------------------------------------------------------
export const DEMO_MEMBERS: ProjectMember[] = [
  {
    projectId: DEMO_PROJECT_ID,
    uid: 'demo-sarah-connor',
    email: 'sarah.connor@echonote.internal',
    displayName: 'Sarah Connor',
    role: 'owner',
    joinedAt: '2026-10-01T08:00:00.000Z',
    lastActive: '2026-10-15T14:30:00.000Z',
    isOnline: true
  },
  {
    projectId: DEMO_PROJECT_ID,
    uid: 'demo-alex-chen',
    email: 'alex.chen@echonote.internal',
    displayName: 'Alex Chen',
    role: 'admin',
    joinedAt: '2026-10-01T08:30:00.000Z',
    lastActive: '2026-10-15T13:45:00.000Z',
    isOnline: true
  },
  {
    projectId: DEMO_PROJECT_ID,
    uid: 'demo-marcus-vance',
    email: 'marcus.vance@echonote.internal',
    displayName: 'Marcus Vance',
    role: 'admin',
    joinedAt: '2026-10-02T09:15:00.000Z',
    lastActive: '2026-10-14T17:10:00.000Z',
    isOnline: false
  }
];

// ----------------------------------------------------------------------------
// 2. Demo Project
// ----------------------------------------------------------------------------
export const DEMO_PROJECT: Project = {
  id: DEMO_PROJECT_ID,
  name: DEMO_PROJECT_NAME,
  userId: 'demo-sarah-connor',
  ownerEmail: 'sarah.connor@echonote.internal',
  ownerName: 'Sarah Connor',
  isDefault: false,
  members: DEMO_MEMBERS,
  createdAt: '2026-10-01T08:00:00.000Z'
};

// ----------------------------------------------------------------------------
// 3. Transcript Segments (Timestamped with Named Speakers)
// ----------------------------------------------------------------------------
export const DEMO_TRANSCRIPT_SEGMENTS: TranscriptSegment[] = [
  {
    speaker: 'Sarah Connor',
    text: "Welcome everyone to our Enterprise API Migration Kickoff. Today we need to lock down our v1 deprecation milestones and establish hard security invariants.",
    startTime: 0,
    endTime: 8
  },
  {
    speaker: 'Alex Chen',
    text: "From the platform side, our telemetry shows 64% of legacy partners still invoke v1 endpoints without PKCE or refresh token rotation. It's a compliance liability.",
    startTime: 9,
    endTime: 21
  },
  {
    speaker: 'Marcus Vance',
    text: "Agreed. Our external security audit requires all endpoints to require SHA256 payload signing and v2 OAuth tokens before November 30th. Deprecation by end of Q4 is mandatory.",
    startTime: 22,
    endTime: 36
  },
  {
    speaker: 'Sarah Connor',
    text: "Understood. Let's record the strategic decision: Deprecate Legacy v1 Ingestion Pipeline by End of Q4 with unanimous team consensus.",
    startTime: 37,
    endTime: 48
  },
  {
    speaker: 'Alex Chen',
    text: "I will draft and issue the deprecation notice to Tier-1 API partners by October 22nd once the migration guides are ready.",
    startTime: 49,
    endTime: 59
  },
  {
    speaker: 'Marcus Vance',
    text: "I'll generate the new SHA256 signing keys and upload them to the enterprise HSM. That should be finished yesterday or today at the latest.",
    startTime: 60,
    endTime: 70
  },
  {
    speaker: 'Sarah Connor',
    text: "Marcus, my team's client SDK release v2.4 strictly depends on those SHA256 signing keys. If that prerequisite slips, the SDK deployment is completely blocked.",
    startTime: 71,
    endTime: 84
  },
  {
    speaker: 'Alex Chen',
    text: "If Marcus runs into any obstacle with the signing keys, let's convene an immediate 15-minute API Migration Blockers Review follow-up sync.",
    startTime: 85,
    endTime: 96
  }
];

// ----------------------------------------------------------------------------
// 4. Meeting Audio Record & Strategic Analysis
// ----------------------------------------------------------------------------
export const DEMO_AUDIO_RECORD: AudioToTextRecord = {
  id: DEMO_MEETING_ID,
  userId: 'demo-sarah-connor',
  ownerEmail: 'sarah.connor@echonote.internal',
  fileName: 'Enterprise_API_Migration_Kickoff_Sync.mp4',
  group: DEMO_PROJECT_NAME,
  projectId: DEMO_PROJECT_ID,
  sourceType: 'recorded',
  status: 'completed',
  date: '2026-10-14T15:00:00.000Z',
  qualityScore: 98,
  readStatus: 'read',
  bookmarks: [
    {
      id: 'demo-bm-1',
      segmentIndex: 3,
      speaker: 'Sarah Connor',
      text: 'Deprecate Legacy v1 Ingestion Pipeline by End of Q4 with unanimous team consensus.',
      timestamp: 37,
      userName: 'Sarah Connor'
    }
  ],
  speakers: ['Sarah Connor', 'Alex Chen', 'Marcus Vance'],
  speakerMap: {
    'Speaker 1': 'Sarah Connor',
    'Speaker 2': 'Alex Chen',
    'Speaker 3': 'Marcus Vance'
  },
  collaborators: DEMO_MEMBERS,
  transcript: DEMO_TRANSCRIPT_SEGMENTS,
  summary: {
    mainTopic: 'Enterprise API Migration: Legacy v1 Deprecation & Security Hardening',
    keyPoints: [
      '64% of legacy traffic still relies on non-compliant v1 ingestion endpoints.',
      'Mandatory security requirement: SHA256 payload signing and v2 OAuth token rotation by Nov 30.',
      'Unanimous strategic commitment to deprecate v1 endpoints by the end of Q4.',
      'Client SDK v2.4 release has a hard dependency on SHA256 signing keys generation.',
      'Blocker escalation protocol established: auto-trigger 15-minute follow-up review if signing keys slip.'
    ],
    decisions: [
      'Deprecate Legacy v1 Ingestion Pipeline by End of Q4 (Consensus: Unanimous, Stakeholder: Alex Chen, Rationale: Security compliance mandate).'
    ],
    actionItems: [
      'Alex Chen: Issue Deprecation Notice to Tier-1 API Partners by Oct 22, 2026.',
      'Marcus Vance: Generate SHA256 Signing Keys in Enterprise HSM (Overdue).',
      'Sarah Connor: Publish Client SDK v2.4 (Blocked by Marcus Vance key generation).'
    ]
  },
  strategicAnalysis: {
    coreIntent: 'Eliminate security compliance liabilities by transitioning all enterprise clients to v2 OAuth and SHA256 payload verification before Q4 concludes.',
    context: 'EchoNote Enterprise API Ingestion Architecture & Security Audit Mandate.',
    assumptions: [
      'Tier-1 partners will migrate within 45 days of receiving deprecation notices.',
      'Enterprise HSM integration for SHA256 keys has zero breaking changes for existing SDK clients.'
    ],
    logicalGaps: [
      'Client SDK v2.4 cannot be validated until Marcus Vance provisions signing keys; no mock test harness was established.'
    ],
    blindSpots: [
      'Partner engineering teams may require dedicated sandbox endpoints during token rollover.'
    ],
    strategicQuestions: [
      'What is our SLA guarantee for Tier-1 partners who fail to migrate before the November 30 cutoff?',
      'Can we provide backward-compatible translation shims for legacy webhook signers?'
    ],
    recommendations: [
      'Expedite unblocking Marcus Vance on HSM key generation to prevent SDK slippage.',
      'Host an API Migration Blockers Review with Sarah, Alex, and Marcus.'
    ],
    alternativePerspectives: [
      'Gradual deprecation with rate-limiting throttling vs. strict hard cutoff on Dec 31.'
    ],
    ignoredQuestions: [],
    unresolvedTopics: [
      {
        id: 'demo-unresolved-1',
        topic: 'HSM Key Provisioning Delay',
        context: 'Marcus Vance is 1 day overdue on generating SHA256 keys, blocking Client SDK v2.4 release.',
        reasonUnresolved: 'Awaiting completion of enterprise HSM key generation.',
        suggestedAction: 'Convene 15-minute blockers review with Marcus Vance and Sarah Connor.'
      }
    ],
    decisionFramework: 'Security Risk Minimization & Partner Transparency Framework',
    nextSteps: [
      'Marcus Vance to resolve HSM signing key generation.',
      'Sarah Connor to release Client SDK v2.4 upon unblocking.',
      'Alex Chen to distribute partner communications.'
    ]
  },
  unifiedIntelligence: {
    title: 'Enterprise API Migration Kickoff Sync',
    summary: [
      '64% of legacy traffic still relies on non-compliant v1 ingestion endpoints.',
      'Mandatory security requirement: SHA256 payload signing and v2 OAuth token rotation by Nov 30.',
      'Unanimous strategic commitment to deprecate v1 endpoints by the end of Q4.'
    ],
    topics: [
      {
        category: 'Security Compliance',
        items: ['OAuth v2 rotation', 'SHA256 payload signing', 'HSM integration']
      },
      {
        category: 'Partner Transition',
        items: ['Tier-1 deprecation notices', 'SDK v2.4 rollout']
      }
    ],
    keyInsights: [
      'Legacy token authentication represents primary audit vulnerability.',
      'Prerequisite key generation is on the critical milestone path.'
    ],
    decisions: [
      {
        id: DEMO_DECISION_ID,
        title: 'Deprecate Legacy v1 Ingestion Pipeline by End of Q4',
        description: 'Security audit highlighted non-compliant token refresh schemes. The team unanimously agreed all clients must migrate to v2 OAuth tokens by Nov 30, with v1 deprecated by end of Q4.',
        context: 'Enterprise API Migration Kickoff Sync',
        peopleInvolved: ['Sarah Connor', 'Alex Chen', 'Marcus Vance'],
        confidenceLevel: 'High',
        relatedTaskIds: [DEMO_TASK_PARTNER_NOTICE_ID, DEMO_TASK_SIGNING_KEYS_ID, DEMO_TASK_CLIENT_SDK_ID],
        sourceTimestamp: 37,
        transcriptSegmentIndex: 3
      }
    ],
    tasks: [
      {
        id: DEMO_TASK_SIGNING_KEYS_ID,
        description: 'Generate SHA256 Signing Keys in Enterprise HSM',
        assignee: 'Marcus Vance',
        deadline: '2026-10-14',
        priority: 'High',
        relatedDecisionId: DEMO_DECISION_ID,
        sourceTimestamp: 60,
        transcriptSegmentIndex: 5
      },
      {
        id: DEMO_TASK_CLIENT_SDK_ID,
        description: 'Publish Client SDK v2.4 with SHA256 Verification',
        assignee: 'Sarah Connor',
        deadline: '2026-10-25',
        priority: 'High',
        relatedDecisionId: DEMO_DECISION_ID,
        sourceTimestamp: 71,
        transcriptSegmentIndex: 6
      },
      {
        id: DEMO_TASK_PARTNER_NOTICE_ID,
        description: 'Issue Deprecation Notice to Tier-1 API Partners',
        assignee: 'Alex Chen',
        deadline: '2026-10-22',
        priority: 'Medium',
        relatedDecisionId: DEMO_DECISION_ID,
        sourceTimestamp: 49,
        transcriptSegmentIndex: 4
      }
    ],
    unresolvedTopics: [
      {
        id: 'demo-unresolved-1',
        topic: 'HSM Key Provisioning Delay',
        context: 'Marcus Vance is 1 day overdue on generating SHA256 keys, blocking Client SDK v2.4 release.',
        reasonUnresolved: 'Awaiting completion of enterprise HSM key generation.',
        suggestedAction: 'Convene 15-minute blockers review with Marcus Vance and Sarah Connor.'
      }
    ],
    meetingIntelligence: {
      productivityScore: 92,
      productivityExplanation: 'High efficiency with direct alignment on critical milestones and actionable commitments.',
      clarityScore: 96,
      clarityExplanation: 'Explicit unanimous decision recorded with clear stakeholder ownership.',
      actionabilityScore: 94,
      actionabilityExplanation: 'Every action item assigned to a specific named engineer with explicit deadlines.',
      effectivenessSummary: 'Productive sync successfully unblocking security invariants.',
      keyStrengths: ['Decisive governance', 'Clear prerequisite declarations', 'Unambiguous task ownership'],
      keyWeaknesses: ['HSM generation prerequisite slipped before kickoff without mitigation buffer']
    },
    strategicAnalysis: {
      coreIntent: 'Eliminate security compliance liabilities by transitioning all enterprise clients to v2 OAuth and SHA256 payload verification before Q4 concludes.',
      context: 'EchoNote Enterprise API Ingestion Architecture & Security Audit Mandate.',
      assumptions: [
        'Tier-1 partners will migrate within 45 days of receiving deprecation notices.',
        'Enterprise HSM integration for SHA256 keys has zero breaking changes for existing SDK clients.'
      ],
      logicalGaps: [
        'Client SDK v2.4 cannot be validated until Marcus Vance provisions signing keys; no mock test harness was established.'
      ],
      blindSpots: [
        'Partner engineering teams may require dedicated sandbox endpoints during token rollover.'
      ],
      strategicQuestions: [
        'What is our SLA guarantee for Tier-1 partners who fail to migrate before the November 30 cutoff?',
        'Can we provide backward-compatible translation shims for legacy webhook signers?'
      ],
      recommendations: [
        'Expedite unblocking Marcus Vance on HSM key generation to prevent SDK slippage.',
        'Host an API Migration Blockers Review with Sarah, Alex, and Marcus.'
      ],
      alternativePerspectives: [
        'Gradual deprecation with rate-limiting throttling vs. strict hard cutoff on Dec 31.'
      ],
      ignoredQuestions: [],
      unresolvedTopics: [
        {
          id: 'demo-unresolved-1',
          topic: 'HSM Key Provisioning Delay',
          context: 'Marcus Vance is 1 day overdue on generating SHA256 keys, blocking Client SDK v2.4 release.',
          reasonUnresolved: 'Awaiting completion of enterprise HSM key generation.',
          suggestedAction: 'Convene 15-minute blockers review with Marcus Vance and Sarah Connor.'
        }
      ],
      decisionFramework: 'Security Risk Minimization & Partner Transparency Framework',
      nextSteps: [
        'Marcus Vance to resolve HSM signing key generation.',
        'Sarah Connor to release Client SDK v2.4 upon unblocking.',
        'Alex Chen to distribute partner communications.'
      ]
    },
    executionTracker: {
      totalTasks: 3,
      completedTasks: 0,
      pendingTasks: 2,
      overdueTasks: 1,
      completionRate: 0,
      delayRate: 33,
      tasks: [
        { id: DEMO_TASK_SIGNING_KEYS_ID, description: 'Generate SHA256 Signing Keys', assignee: 'Marcus Vance', status: 'Overdue' },
        { id: DEMO_TASK_CLIENT_SDK_ID, description: 'Publish Client SDK v2.4', assignee: 'Sarah Connor', status: 'Pending' },
        { id: DEMO_TASK_PARTNER_NOTICE_ID, description: 'Issue Deprecation Notice to Tier-1 API Partners', assignee: 'Alex Chen', status: 'In Progress' }
      ],
      keyInsights: [
        'Prerequisite task is overdue, depressing execution velocity.',
        'Immediate unblocking restores health score from 72% to 94%.'
      ]
    },
    calendarReminders: {
      reminders: [
        {
          id: 'rem-1',
          title: 'Q4 Deprecation Deadline Review',
          description: 'Check progress on v2 OAuth token adoption with Tier-1 partners',
          suggestedDateTime: '2026-11-30T17:00:00.000Z',
          priority: 'High',
          group: 'Long-term',
          calendarEventFormat: {
            title: 'EchoNote: Q4 Deprecation Deadline Review',
            description: 'Evaluate adoption progress with Tier-1 partners and ensure v1 phaseout',
            startTime: '2026-11-30T17:00:00.000Z',
            endTime: '2026-11-30T17:30:00.000Z'
          }
        }
      ],
      summary: '1 critical milestone calendar review scheduled before Q4 concludes.'
    },
    followUp: {
      email: 'sarah.connor@echonote.internal',
      nextMeetingAgenda: [
        'Resolve HSM signing keys obstacle with Marcus Vance',
        'Review Client SDK v2.4 integration test results',
        'Confirm partner webinar schedule'
      ],
      keyPendingItems: [
        'SHA256 signing keys provisioned in enterprise HSM',
        'Client SDK v2.4 release candidate build'
      ]
    }
  },
  meetingSessionId: 'demo-session-kickoff',
  externalMeetingId: 'zoom-892401829',
  provider: 'zoom',
  provenanceManifestId: 'demo-prov-8f4e2b01c3',
  smartRecap: {
    executiveSummary: [
      'Unanimous agreement to deprecate legacy v1 ingestion by end of Q4 to satisfy compliance mandates.',
      'Critical path blocker detected: Client SDK v2.4 is blocked because Marcus Vance is overdue on SHA256 signing keys.',
      'Proactive governance recommended: 15-minute follow-up blockers review proposed with key participants.'
    ],
    taggedMembers: [
      {
        name: 'Sarah Connor',
        email: 'sarah.connor@echonote.internal',
        role: 'VP Engineering',
        reason: 'Client SDK owner and migration sponsor',
        actionItems: ['Publish Client SDK v2.4 (Blocked)']
      },
      {
        name: 'Marcus Vance',
        email: 'marcus.vance@echonote.internal',
        role: 'Security Architect',
        reason: 'Signing keys prerequisite owner',
        actionItems: ['Generate SHA256 Signing Keys (Overdue)']
      },
      {
        name: 'Alex Chen',
        email: 'alex.chen@echonote.internal',
        role: 'Platform Lead',
        reason: 'Partner deprecation notice owner',
        actionItems: ['Issue Deprecation Notice to Tier-1 API Partners']
      }
    ],
    generatedAt: '2026-10-14T15:35:00.000Z',
    strategicTakeaway: 'Immediate action on HSM signing keys is required to keep the Q4 deprecation timeline on track.'
  }
};

// ----------------------------------------------------------------------------
// 5. Decision Intelligence History Record
// ----------------------------------------------------------------------------
export const DEMO_DECISION_ITEM: DecisionHistoryItem = {
  id: DEMO_DECISION_ID,
  userId: 'demo-sarah-connor',
  title: 'Deprecate Legacy v1 Ingestion Pipeline by End of Q4',
  inputType: 'transcript',
  inputText: 'Enterprise API Migration Kickoff Sync Transcript Extract',
  createdAt: '2026-10-14T15:35:00.000Z',
  output: {
    keyDecisions: [
      'Deprecate Legacy v1 Ingestion Pipeline by End of Q4 (Consensus: Unanimous, Stakeholder: Alex Chen)'
    ],
    assumptions: [
      'All enterprise clients can adopt v2 OAuth and SHA256 signed headers within 60 days.',
      'Enterprise HSM has capacity for dedicated client signing keypairs.'
    ],
    risksAndGaps: [
      'Client SDK v2.4 is blocked until Marcus Vance completes HSM key generation.',
      'Health score drops if prerequisite work slips past due date.'
    ],
    alternativePerspectives: [
      'Keep v1 alive in read-only mode for legacy webhooks.'
    ],
    ignoredQuestions: [],
    unresolvedTopics: [
      {
        id: 'demo-unresolved-1',
        topic: 'HSM Key Provisioning Delay',
        context: 'Marcus Vance is 1 day overdue on generating SHA256 keys.',
        reasonUnresolved: 'Awaiting completion of enterprise HSM key generation.',
        suggestedAction: 'Convene 15-minute blockers review with Marcus Vance and Sarah Connor.'
      }
    ],
    decisionClarity: 'High — Unanimous executive commitment with mapped tasks and owners.',
    nextActions: [
      'Generate SHA256 Signing Keys (Marcus Vance)',
      'Publish Client SDK v2.4 (Sarah Connor)',
      'Issue Deprecation Notice to Tier-1 API Partners (Alex Chen)'
    ]
  }
};

// ----------------------------------------------------------------------------
// 6. Demo Tasks (with Explicit Dependency & Blocking Relationship)
// ----------------------------------------------------------------------------
export const DEMO_TASKS: ProjectTask[] = [
  // Task 1: Prerequisite task that has slipped past deadline (Overdue)
  {
    id: DEMO_TASK_SIGNING_KEYS_ID,
    projectId: DEMO_PROJECT_ID,
    title: 'Generate SHA256 Signing Keys',
    description: 'Provision SHA256 signing keys in enterprise HSM and publish public verification certs for client SDK integration.',
    assigneeEmail: 'marcus.vance@echonote.internal',
    assigneeName: 'Marcus Vance',
    assigneeId: 'demo-marcus-vance',
    status: 'in_progress',
    priority: 'urgent',
    startDate: '2026-10-10',
    dueDate: '2026-10-14', // Overdue relative to current demo date (Oct 15, 2026)
    sourceType: 'meeting_action_item',
    sourceDecisionId: DEMO_DECISION_ID,
    sourceRecordingId: DEMO_MEETING_ID,
    prerequisiteTaskIds: [],
    dependencyStatus: 'ready',
    dependentTaskIds: [DEMO_TASK_CLIENT_SDK_ID],
    createdBy: 'demo-sarah-connor',
    creatorEmail: 'sarah.connor@echonote.internal',
    createdAt: '2026-10-14T15:30:00.000Z',
    updatedAt: '2026-10-14T16:00:00.000Z',
    subTasks: [
      { id: 'sub-1', title: 'Provision HSM slot', completed: true },
      { id: 'sub-2', title: 'Generate 4096-bit master signing key', completed: true },
      { id: 'sub-3', title: 'Export public verification certs', completed: false }
    ],
    activityHistory: [
      {
        id: 'act-1',
        action: 'created',
        performedBy: 'Sarah Connor',
        timestamp: '2026-10-14T15:30:00.000Z',
        details: 'Created task from meeting action item'
      },
      {
        id: 'act-2',
        action: 'status_in_progress',
        performedBy: 'Marcus Vance',
        timestamp: '2026-10-14T16:00:00.000Z',
        details: 'Updated status to In Progress'
      }
    ]
  },

  // Task 2: Dependent task that is BLOCKED because prerequisite is incomplete and overdue
  {
    id: DEMO_TASK_CLIENT_SDK_ID,
    projectId: DEMO_PROJECT_ID,
    title: 'Publish Client SDK v2.4',
    description: 'Package, compile, and publish the client SDK v2.4 with built-in SHA256 payload signing and token refresh retry logic.',
    assigneeEmail: 'sarah.connor@echonote.internal',
    assigneeName: 'Sarah Connor',
    assigneeId: 'demo-sarah-connor',
    status: 'pending',
    priority: 'high',
    startDate: '2026-10-15',
    dueDate: '2026-10-25',
    sourceType: 'meeting_action_item',
    sourceDecisionId: DEMO_DECISION_ID,
    sourceRecordingId: DEMO_MEETING_ID,
    prerequisiteTaskIds: [DEMO_TASK_SIGNING_KEYS_ID],
    dependencyStatus: 'blocked',
    blockingPrerequisites: [
      {
        id: DEMO_TASK_SIGNING_KEYS_ID,
        title: 'Generate SHA256 Signing Keys',
        status: 'overdue'
      }
    ],
    dependentTaskIds: [],
    activeExceptions: [
      {
        id: DEMO_EXCEPTION_ID,
        type: 'blocked',
        severity: 'critical',
        title: 'Blocked by Overdue Prerequisite: Generate SHA256 Signing Keys',
        status: 'open'
      }
    ],
    createdBy: 'demo-sarah-connor',
    creatorEmail: 'sarah.connor@echonote.internal',
    createdAt: '2026-10-14T15:30:00.000Z',
    updatedAt: '2026-10-15T09:00:00.000Z',
    subTasks: [
      { id: 'sub-sdk-1', title: 'Integrate SHA256 verification module', completed: false },
      { id: 'sub-sdk-2', title: 'Pass end-to-end integration test suite', completed: false },
      { id: 'sub-sdk-3', title: 'Publish npm and PyPI releases', completed: false }
    ],
    activityHistory: [
      {
        id: 'act-sdk-1',
        action: 'created',
        performedBy: 'Sarah Connor',
        timestamp: '2026-10-14T15:30:00.000Z',
        details: 'Created task with prerequisite on Generate SHA256 Signing Keys'
      },
      {
        id: 'act-sdk-2',
        action: 'dependency_blocked',
        performedBy: 'Tracking Engine',
        timestamp: '2026-10-15T00:00:00.000Z',
        details: 'Marked as blocked: Prerequisite "Generate SHA256 Signing Keys" is overdue'
      }
    ]
  },

  // Task 3: In-progress independent migration task
  {
    id: DEMO_TASK_PARTNER_NOTICE_ID,
    projectId: DEMO_PROJECT_ID,
    title: 'Issue Deprecation Notice to Tier-1 API Partners',
    description: 'Distribute structured migration communication, schedule webinars, and provide API changelog to all high-volume partners.',
    assigneeEmail: 'alex.chen@echonote.internal',
    assigneeName: 'Alex Chen',
    assigneeId: 'demo-alex-chen',
    status: 'in_progress',
    priority: 'high',
    startDate: '2026-10-15',
    dueDate: '2026-10-22',
    sourceType: 'meeting_action_item',
    sourceDecisionId: DEMO_DECISION_ID,
    sourceRecordingId: DEMO_MEETING_ID,
    prerequisiteTaskIds: [],
    dependencyStatus: 'ready',
    dependentTaskIds: [],
    createdBy: 'demo-sarah-connor',
    creatorEmail: 'sarah.connor@echonote.internal',
    createdAt: '2026-10-14T15:30:00.000Z',
    updatedAt: '2026-10-15T11:00:00.000Z',
    subTasks: [
      { id: 'sub-not-1', title: 'Draft partner deprecation whitepaper', completed: true },
      { id: 'sub-not-2', title: 'Coordinate email delivery with marketing', completed: false },
      { id: 'sub-not-3', title: 'Schedule Q&A office hours for Tier-1 engineering leads', completed: false }
    ],
    activityHistory: [
      {
        id: 'act-not-1',
        action: 'created',
        performedBy: 'Sarah Connor',
        timestamp: '2026-10-14T15:30:00.000Z',
        details: 'Created task from meeting action item'
      }
    ]
  }
];

// ----------------------------------------------------------------------------
// 7. Demo Task Exception (Critical Risk Indicator)
// ----------------------------------------------------------------------------
export const DEMO_TASK_EXCEPTION: TaskException = {
  id: DEMO_EXCEPTION_ID,
  projectId: DEMO_PROJECT_ID,
  taskId: DEMO_TASK_CLIENT_SDK_ID,
  taskTitle: 'Publish Client SDK v2.4',
  type: 'blocked',
  severity: 'critical',
  status: 'open',
  title: 'Blocked by Overdue Prerequisite: Generate SHA256 Signing Keys',
  description: 'Task "Publish Client SDK v2.4" cannot start because prerequisite task "Generate SHA256 Signing Keys" (assigned to Marcus Vance) is overdue. Milestone health score degraded to 72%.',
  reporterId: 'system_tracking_engine',
  reporterName: 'EchoNote Execution Engine',
  reporterEmail: 'engine@echonote.internal',
  assignedToId: 'demo-marcus-vance',
  assignedToName: 'Marcus Vance',
  assignedToEmail: 'marcus.vance@echonote.internal',
  source: 'tracking_engine',
  isAutoManaged: true,
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z',
  history: [
    {
      id: 'exc-hist-1',
      action: 'created',
      performedBy: 'system_tracking_engine',
      performedByName: 'EchoNote Execution Engine',
      performedByEmail: 'engine@echonote.internal',
      timestamp: '2026-10-15T00:00:00.000Z',
      details: 'Automatic exception raised: Prerequisite "Generate SHA256 Signing Keys" became overdue'
    }
  ]
};

// ----------------------------------------------------------------------------
// 8. Demo Proactive Follow-up Meeting Recommendation
// ----------------------------------------------------------------------------
export const DEMO_FOLLOW_UP: FollowUpMeeting = {
  id: DEMO_FOLLOWUP_ID,
  projectId: DEMO_PROJECT_ID,
  title: 'API Migration Blockers Review (15 mins)',
  purpose: 'Resolve HSM signing keys obstacle with Marcus Vance; unblock client SDK deployment.',
  reason: 'Critical blocker on Task "Publish Client SDK v2.4" due to overdue prerequisite key generation.',
  generatedAgenda: '1. Current HSM keypair generation obstacle (Marcus Vance, 5 mins)\n2. Client SDK v2.4 build & release readiness (Sarah Connor, 5 mins)\n3. Partner deprecation communication schedule confirmation (Alex Chen, 5 mins)',
  relatedTaskIds: [DEMO_TASK_SIGNING_KEYS_ID, DEMO_TASK_CLIENT_SDK_ID],
  relatedExceptionIds: [DEMO_EXCEPTION_ID],
  sourceMeetingSessionIds: ['demo-session-kickoff'],
  proposedParticipants: [
    {
      userId: 'demo-sarah-connor',
      name: 'Sarah Connor',
      email: 'sarah.connor@echonote.internal',
      role: 'VP Engineering',
      status: 'accepted'
    },
    {
      userId: 'demo-alex-chen',
      name: 'Alex Chen',
      email: 'alex.chen@echonote.internal',
      role: 'Platform Lead',
      status: 'accepted'
    },
    {
      userId: 'demo-marcus-vance',
      name: 'Marcus Vance',
      email: 'marcus.vance@echonote.internal',
      role: 'Security Architect',
      status: 'tentative'
    }
  ],
  proposedStartTime: '2026-10-16T16:00:00.000Z',
  proposedEndTime: '2026-10-16T16:15:00.000Z',
  timezone: 'America/New_York',
  status: 'proposed',
  provider: 'none',
  history: [
    {
      id: 'fol-hist-1',
      action: 'proposed',
      performedBy: 'system_tracking_engine',
      performedByName: 'EchoNote Automated Governance',
      performedByEmail: 'governance@echonote.internal',
      timestamp: '2026-10-15T00:00:00.000Z',
      details: 'Follow-up proposed automatically when task blocker was detected'
    }
  ],
  createdBy: 'system_tracking_engine',
  creatorName: 'EchoNote Governance',
  creatorEmail: 'governance@echonote.internal',
  createdAt: '2026-10-15T00:00:00.000Z',
  updatedAt: '2026-10-15T00:00:00.000Z'
};

// ----------------------------------------------------------------------------
// 9. Demo Associated Meeting (for ProjectMeetingsView)
// ----------------------------------------------------------------------------
export const DEMO_PROJECT_MEETING_ITEM: UnassociatedMeetingItem = {
  id: 'demo-meeting-item-1',
  externalMeetingId: 'zoom-892401829',
  title: DEMO_MEETING_TITLE,
  provider: 'zoom',
  actualStartTime: '2026-10-14T15:00:00.000Z',
  durationSeconds: 1840,
  participants: [
    { name: 'Sarah Connor', email: 'sarah.connor@echonote.internal', role: 'host' },
    { name: 'Alex Chen', email: 'alex.chen@echonote.internal', role: 'attendee' },
    { name: 'Marcus Vance', email: 'marcus.vance@echonote.internal', role: 'attendee' }
  ],
  recordingId: DEMO_MEETING_ID,
  transcriptId: 'demo-transcript-1',
  provenanceManifestId: 'demo-prov-8f4e2b01c3',
  status: 'associated',
  createdAt: '2026-10-14T15:00:00.000Z',
  updatedAt: '2026-10-14T15:35:00.000Z'
};

// ----------------------------------------------------------------------------
// 10. Demo Execution Tracking Metrics & Risk Indicators
// ----------------------------------------------------------------------------
export const DEMO_TRACKING_METRICS_DEGRADED: ProjectTrackingMetrics = {
  totalActiveTasks: 3,
  completedTasks: 0,
  overdueTasksCount: 1,
  dueSoonTasksCount: 1,
  startingSoonTasksCount: 0,
  blockedTasksCount: 1,
  blockedByOverduePrereqCount: 1,
  downstreamRiskCount: 1,
  activeExceptionsCount: 1,
  unscheduledTasksCount: 0,
  healthScore: 72,
  evaluatedAt: '2026-10-15T12:00:00.000Z',
  lastSuccessfulJobRunAt: '2026-10-15T12:00:00.000Z',
  monitoringStatus: 'degraded'
};

export const DEMO_TRACKING_METRICS_HEALTHY: ProjectTrackingMetrics = {
  totalActiveTasks: 3,
  completedTasks: 1,
  overdueTasksCount: 0,
  dueSoonTasksCount: 1,
  startingSoonTasksCount: 0,
  blockedTasksCount: 0,
  blockedByOverduePrereqCount: 0,
  downstreamRiskCount: 0,
  activeExceptionsCount: 0,
  unscheduledTasksCount: 0,
  healthScore: 94,
  evaluatedAt: '2026-10-15T12:00:00.000Z',
  lastSuccessfulJobRunAt: '2026-10-15T12:00:00.000Z',
  monitoringStatus: 'healthy'
};

export const DEMO_TRACKING_RISKS: TaskRiskIndicator[] = [
  {
    taskId: DEMO_TASK_CLIENT_SDK_ID,
    taskTitle: 'Publish Client SDK v2.4',
    category: 'blocked_by_overdue_prerequisite',
    severity: 'critical',
    reason: 'Blocked by overdue prerequisite: "Generate SHA256 Signing Keys"',
    details: 'Prerequisite was due on Oct 14, 2026 (Assigned to Marcus Vance). Dependent cannot progress.',
    dueDate: '2026-10-25',
    startDate: '2026-10-15',
    assigneeEmail: 'sarah.connor@echonote.internal',
    prerequisiteIds: [DEMO_TASK_SIGNING_KEYS_ID],
    prerequisiteTitles: ['Generate SHA256 Signing Keys'],
    blockingTaskIds: [DEMO_TASK_SIGNING_KEYS_ID],
    associatedExceptionIds: [DEMO_EXCEPTION_ID],
    detectedAt: '2026-10-15T00:00:00.000Z'
  },
  {
    taskId: DEMO_TASK_SIGNING_KEYS_ID,
    taskTitle: 'Generate SHA256 Signing Keys',
    category: 'overdue',
    severity: 'high',
    reason: 'Task is overdue',
    details: 'Due date Oct 14, 2026 has passed.',
    dueDate: '2026-10-14',
    startDate: '2026-10-10',
    assigneeEmail: 'marcus.vance@echonote.internal',
    detectedAt: '2026-10-15T00:00:00.000Z'
  }
];

// ----------------------------------------------------------------------------
// 11. Initial State Cloning Factory
// ----------------------------------------------------------------------------
export interface DemoStatePayload {
  project: Project;
  members: ProjectMember[];
  audioRecord: AudioToTextRecord;
  meetings: UnassociatedMeetingItem[];
  decisions: DecisionHistoryItem[];
  tasks: ProjectTask[];
  exceptions: TaskException[];
  followUps: FollowUpMeeting[];
  trackingMetrics: ProjectTrackingMetrics;
  trackingRisks: TaskRiskIndicator[];
}

/**
 * Creates a clean, deep-cloned demo state payload.
 * Guarantee: Changes made to this payload do not mutate the immutable fixtures.
 */
export function createInitialDemoState(): DemoStatePayload {
  return {
    project: JSON.parse(JSON.stringify(DEMO_PROJECT)),
    members: JSON.parse(JSON.stringify(DEMO_MEMBERS)),
    audioRecord: JSON.parse(JSON.stringify(DEMO_AUDIO_RECORD)),
    meetings: [JSON.parse(JSON.stringify(DEMO_PROJECT_MEETING_ITEM))],
    decisions: [JSON.parse(JSON.stringify(DEMO_DECISION_ITEM))],
    tasks: JSON.parse(JSON.stringify(DEMO_TASKS)),
    exceptions: [JSON.parse(JSON.stringify(DEMO_TASK_EXCEPTION))],
    followUps: [JSON.parse(JSON.stringify(DEMO_FOLLOW_UP))],
    trackingMetrics: JSON.parse(JSON.stringify(DEMO_TRACKING_METRICS_DEGRADED)),
    trackingRisks: JSON.parse(JSON.stringify(DEMO_TRACKING_RISKS))
  };
}
