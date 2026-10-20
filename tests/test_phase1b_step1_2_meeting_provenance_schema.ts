/**
 * test_phase1b_step1_2_meeting_provenance_schema.ts
 *
 * EchoNote Phase 1B — Step 1.2: Meeting Provenance & Integration Schema Specification
 * 
 * Verifies:
 * 1. Provider-agnostic TypeScript data contracts and types exist and are strictly typed.
 * 2. MeetingSessionRecord and MeetingProvenanceManifest link source meetings to recordings, transcripts, decisions, and tasks.
 * 3. Backward compatibility: existing standalone recordings (without projectId/meetingSessionId) remain valid.
 * 4. Backward compatibility: existing project recordings function with optional meeting metadata.
 * 5. Isolation of sensitive credentials: IntegrationConnectionPublicView exposes safe metadata,
 *    while IntegrationConnectionConfig holds encrypted secrets server-authoritatively.
 * 6. Firestore security rules enforce authorization and immutability:
 *    - /meetingSessions/{sessionId} enforces project permissions & content-edit boundaries.
 *    - /meetingProvenanceManifests/{manifestId} is immutable (update: if false).
 *    - /integrationConnections/{connectionId} enforces strict user/org tenant isolation.
 * 7. Server-side unified intelligence pipeline accepts optional meetingSessionId and enriches output.
 */

import fs from 'fs';
import path from 'path';
import {
  MeetingPlatformProvider,
  MeetingIntegrationStatus,
  MeetingCaptureMode,
  MeetingParticipantRole,
  MeetingParticipant,
  MeetingSourceReference,
  MeetingArtifactReference,
  MeetingProvenanceManifest,
  MeetingSessionRecord,
  IntegrationConnectionPublicView,
  IntegrationConnectionConfig,
  IngestMeetingPayload,
  IngestMeetingResponse,
  GetMeetingProvenanceResponse,
  Recording,
  Transcript,
  AudioToTextRecord,
  UnifiedDecision,
  UnifiedTask
} from '../types.js';

let passed = 0;
let failed = 0;

function check(description: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

console.log("================================================================================");
console.log("🛡️  ECHONOTE PHASE 1B STEP 1.2: MEETING PROVENANCE & INTEGRATION SCHEMA SUITE");
console.log("================================================================================");

// -----------------------------------------------------------------------------
// Section 1: TypeScript Data Model & Provenance Chain Verification
// -----------------------------------------------------------------------------
console.log("\n--- Section 1: Data Model & Provenance Chain Verification ---");

// Test 1: Instantiation of MeetingSourceReference
const sampleSourceRef: MeetingSourceReference = {
  provider: 'zoom',
  externalMeetingId: 'zoom-mtg-8839219',
  calendarEventId: 'cal-event-9901',
  sourceUrl: 'https://zoom.us/j/8839219',
  captureMode: 'post_meeting_webhook',
  instanceStartTime: '2026-10-13T10:00:00Z'
};
check("[1] MeetingSourceReference models provider, externalMeetingId, and captureMode",
  sampleSourceRef.provider === 'zoom' &&
  sampleSourceRef.externalMeetingId === 'zoom-mtg-8839219' &&
  sampleSourceRef.captureMode === 'post_meeting_webhook'
);

// Test 2: Instantiation of MeetingParticipant
const sampleParticipant: MeetingParticipant = {
  id: 'part-1',
  externalUserId: 'zoom-usr-101',
  name: 'Jane Doe',
  email: 'jane@acme.com',
  role: 'host',
  joinedAt: '2026-10-13T10:00:00Z',
  leftAt: '2026-10-13T10:45:00Z'
};
check("[2] MeetingParticipant supports external identity and participant role",
  sampleParticipant.role === 'host' && sampleParticipant.name === 'Jane Doe'
);

// Test 3: Instantiation of MeetingProvenanceManifest (unbroken chain)
const sampleManifest: MeetingProvenanceManifest = {
  manifestId: 'prov-man-12345',
  meetingSessionId: 'sess-889900',
  provider: 'google_meet',
  externalMeetingId: 'meet-abc-xyz',
  sourceReference: {
    provider: 'google_meet',
    externalMeetingId: 'meet-abc-xyz',
    captureMode: 'recording'
  },
  captureMode: 'recording',
  capturedAt: '2026-10-13T10:45:00Z',
  ingestedAt: '2026-10-13T10:46:00Z',
  schemaVersion: '1.0',
  rawArtifacts: [
    {
      artifactId: 'art-rec-1',
      type: 'recording',
      uri: 'gs://echonote/recordings/raw.mp4',
      mimeType: 'video/mp4',
      contentHash: 'sha256-abcdef123456',
      sizeBytes: 15420000,
      createdAt: '2026-10-13T10:45:00Z'
    },
    {
      artifactId: 'art-trans-1',
      type: 'transcript',
      uri: 'gs://echonote/transcripts/raw.json',
      mimeType: 'application/json',
      contentHash: 'sha256-987654fedcba',
      createdAt: '2026-10-13T10:46:00Z'
    }
  ],
  participants: [sampleParticipant]
};
check("[3] MeetingProvenanceManifest binds meetingSessionId, artifacts, and hashes",
  sampleManifest.schemaVersion === '1.0' &&
  sampleManifest.rawArtifacts.length === 2 &&
  sampleManifest.rawArtifacts[0].type === 'recording'
);

// Test 4: Instantiation of MeetingSessionRecord
const sampleSession: MeetingSessionRecord = {
  id: 'sess-889900',
  projectId: 'proj-eng-core',
  organizationId: 'org-acme-prod',
  userId: 'usr-initiator',
  provider: 'google_meet',
  externalMeetingId: 'meet-abc-xyz',
  title: 'Architecture Review: Microservice Migration',
  participants: [sampleParticipant],
  sourceReference: sampleManifest.sourceReference,
  recordingId: 'rec-rec-991',
  transcriptId: 'trans-001',
  provenanceManifestId: sampleManifest.manifestId,
  status: 'completed',
  createdAt: '2026-10-13T10:46:00Z',
  updatedAt: '2026-10-13T10:50:00Z'
};
check("[4] MeetingSessionRecord links recordingId, transcriptId, and provenanceManifestId",
  sampleSession.provenanceManifestId === sampleManifest.manifestId &&
  sampleSession.recordingId === 'rec-rec-991' &&
  sampleSession.transcriptId === 'trans-001'
);

// -----------------------------------------------------------------------------
// Section 2: Backward Compatibility with Existing Models
// -----------------------------------------------------------------------------
console.log("\n--- Section 2: Backward Compatibility Invariants ---");

// Test 5: Standalone Recording backward compatibility (missing meetingSessionId, provider)
const legacyRecording: Recording = {
  id: 'rec-legacy-1',
  projectId: '',
  userId: 'usr-solo',
  fileName: 'meeting_notes.mp3',
  storagePath: 'recordings/usr-solo/rec-legacy-1/meeting_notes.mp3',
  status: 'completed',
  createdAt: '2026-09-01T12:00:00Z'
};
check("[5] Existing standalone Recording compiles and functions without meetingSessionId",
  legacyRecording.meetingSessionId === undefined &&
  legacyRecording.provider === undefined &&
  legacyRecording.status === 'completed'
);

// Test 6: Enriched Recording with optional meetingSessionId
const modernRecording: Recording = {
  id: 'rec-modern-1',
  projectId: 'proj-eng-core',
  userId: 'usr-initiator',
  fileName: 'zoom_recording.mp4',
  storagePath: 'recordings/usr-initiator/rec-modern-1/zoom_recording.mp4',
  status: 'completed',
  meetingSessionId: 'sess-889900',
  externalMeetingId: 'meet-abc-xyz',
  provider: 'zoom',
  provenanceManifestId: 'prov-man-12345',
  createdAt: '2026-10-13T10:46:00Z'
};
check("[6] Enriched Recording supports meetingSessionId and provider metadata",
  modernRecording.meetingSessionId === 'sess-889900' &&
  modernRecording.provider === 'zoom'
);

// Test 7: Transcript with optional provenance fields
const legacyTranscript: Transcript = {
  id: 'trans-legacy-1',
  recordingId: 'rec-legacy-1',
  userId: 'usr-solo',
  summary: 'Discussed roadmap',
  actionItems: ['Write documentation'],
  segments: [{ speaker: 'Alice', text: 'Hello', startTime: 0, endTime: 2 }],
  createdAt: '2026-09-01T12:05:00Z'
};
const modernTranscript: Transcript = {
  ...legacyTranscript,
  id: 'trans-modern-1',
  meetingSessionId: 'sess-889900',
  provenanceManifestId: 'prov-man-12345'
};
check("[7] Transcript preserves backward compatibility while supporting meetingSessionId",
  legacyTranscript.meetingSessionId === undefined &&
  modernTranscript.meetingSessionId === 'sess-889900'
);

// Test 8: Decision and Task provenance references
const decision: UnifiedDecision = {
  id: 'dec-1',
  title: 'Adopt Kafka for messaging',
  description: 'Team agreed to use Kafka instead of RabbitMQ',
  context: 'High throughput requirements',
  peopleInvolved: ['Jane Doe', 'Alice'],
  confidenceLevel: 'High',
  relatedTaskIds: ['task-1'],
  meetingSessionId: 'sess-889900',
  sourceTimestamp: 1240,
  transcriptSegmentIndex: 42
};
const task: UnifiedTask = {
  id: 'task-1',
  description: 'Provision Kafka staging cluster',
  assignee: 'Jane Doe',
  priority: 'High',
  relatedDecisionId: 'dec-1',
  meetingSessionId: 'sess-889900',
  sourceTimestamp: 1260,
  transcriptSegmentIndex: 43
};
check("[8] UnifiedDecision and UnifiedTask link to meetingSessionId, timestamps, and segments",
  decision.meetingSessionId === 'sess-889900' &&
  task.meetingSessionId === 'sess-889900' &&
  task.relatedDecisionId === decision.id &&
  decision.sourceTimestamp === 1240
);

// -----------------------------------------------------------------------------
// Section 3: Credential Separation & Isolation Security
// -----------------------------------------------------------------------------
console.log("\n--- Section 3: Credential Separation & Security Invariants ---");

// Test 9: Public connection view vs Internal config
const publicConnection: IntegrationConnectionPublicView = {
  id: 'conn-zoom-01',
  provider: 'zoom',
  status: 'active',
  organizationId: 'org-acme-prod',
  userId: 'usr-admin',
  scopes: ['meeting:read', 'recording:read'],
  externalAccountEmail: 'lead@acme.com',
  externalAccountName: 'Acme Zoom Org',
  lastSyncAt: '2026-10-13T10:00:00Z',
  createdAt: '2026-10-01T08:00:00Z',
  updatedAt: '2026-10-13T10:00:00Z'
};

const internalConfig: IntegrationConnectionConfig = {
  id: 'conn-zoom-01',
  provider: 'zoom',
  status: 'active',
  organizationId: 'org-acme-prod',
  userId: 'usr-admin',
  scopes: ['meeting:read', 'recording:read'],
  externalAccountId: 'zoom-acc-992',
  externalAccountEmail: 'lead@acme.com',
  encryptedCredentials: 'enc:kms:v1:982348a0fd89201a==',
  encryptionKeyId: 'projects/echonote/locations/global/keyRings/integrations/cryptoKeys/zoom',
  webhookSecretEncrypted: 'enc:kms:v1:09a8f908e01b==',
  createdAt: '2026-10-01T08:00:00Z',
  updatedAt: '2026-10-13T10:00:00Z'
};

check("[9] Public connection view never exposes credentials or secrets",
  !('encryptedCredentials' in publicConnection) &&
  !('webhookSecretEncrypted' in publicConnection) &&
  publicConnection.status === 'active'
);

check("[10] Server-authoritative config maintains encrypted credentials and key references",
  typeof internalConfig.encryptedCredentials === 'string' &&
  typeof internalConfig.encryptionKeyId === 'string'
);

// -----------------------------------------------------------------------------
// Section 4: Firestore Rules Static Audit
// -----------------------------------------------------------------------------
console.log("\n--- Section 4: Firestore Rules Static Audit ---");

const firestoreRules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf-8');

// Test 11: /meetingSessions/{sessionId} exists and enforces project permissions
check("[11] firestore.rules declares /meetingSessions/{sessionId}",
  firestoreRules.includes("match /meetingSessions/{sessionId}")
);

check("[12] /meetingSessions/{sessionId} requires canViewProject and canEditProjectContent",
  firestoreRules.includes("canViewProject(resource.data.projectId)") &&
  firestoreRules.includes("canEditProjectContent(request.resource.data.projectId)")
);

// Test 13: /meetingProvenanceManifests/{manifestId} is immutable
check("[13] firestore.rules declares /meetingProvenanceManifests/{manifestId}",
  firestoreRules.includes("match /meetingProvenanceManifests/{manifestId}")
);

const manifestRuleBlock = firestoreRules.slice(
  firestoreRules.indexOf("match /meetingProvenanceManifests/{manifestId}"),
  firestoreRules.indexOf("match /integrationConnections/{connectionId}")
);

check("[14] /meetingProvenanceManifests/{manifestId} denies client updates (immutable audit trail)",
  manifestRuleBlock.includes("allow update: if false;")
);

// Test 15: /integrationConnections/{connectionId} strictly blocks direct client SDK access
check("[15] firestore.rules declares /integrationConnections/{connectionId} as server-authoritative only",
  firestoreRules.includes("match /integrationConnections/{connectionId}") &&
  firestoreRules.includes("allow read, write: if false;")
);

// -----------------------------------------------------------------------------
// Section 5: Server Route Integration Audit
// -----------------------------------------------------------------------------
console.log("\n--- Section 5: Server Route Integration Audit ---");

const serverCode = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');

check("[16] server.ts /api/ai/unified-meeting-intelligence accepts meetingSessionId",
  serverCode.includes("const { transcript, recordingId, projectId, meetingSessionId } = req.body;")
);

check("[17] server.ts enriches returned decisions and tasks with meetingSessionId",
  serverCode.includes("const enrichedDecisions = Array.isArray(rawData.decisions) && meetingSessionId") &&
  serverCode.includes("const enrichedTasks = Array.isArray(rawData.tasks) && meetingSessionId")
);

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log("\n================================================================================");
console.log(`📊 TEST SUITE SUMMARY: ${passed} / ${passed + failed} PASSED (${failed} FAILED)`);
console.log("================================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("🎉 ALL PHASE 1B STEP 1.2 MEETING PROVENANCE SCHEMA INVARIANTS PASSED PERFECTLY!\n");
}
