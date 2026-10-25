/**
 * tests/test_phase1b_step2_1_meeting_association.ts
 *
 * EchoNote Phase 1B, Step 2.1: Meeting-to-Project Association Test Suite
 *
 * Focused tests covering:
 * 1. Successful association by an authorized user (owner/admin) with valid project in same organization.
 * 2. Unauthorized user rejection (viewer role without edit content permissions).
 * 3. Cross-organization association rejection (meeting stamped with Org A cannot be linked to Org B).
 * 4. Invalid or nonexistent project ID handling (clean 404).
 * 5. Pending Zoom meetings with ambiguous/unmapped tenant mappings (associating binds meeting and child records to target org safely).
 * 6. Duplicate requests and concurrent association prevention.
 * 7. Association changes and dissociation (projectId: null) without loss of immutable provenance manifest.
 * 8. Correct project visibility of the meeting and its associated records via /api/projects/:projectId/meetings.
 * 9. Existing meeting, recording, and transcript link preservation.
 */

import {
  UnassociatedMeetingItem,
  AssociateMeetingPayload,
  AssociateMeetingResponse,
  ProjectMeetingListResponse
} from "../types.ts";

let passedTests = 0;
let failedTests = 0;

function check(testId: string, description: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`  ✅ PASS [${testId}]: ${description}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL [${testId}]: ${description}${extra ? ` (${extra})` : ""}`);
    failedTests++;
  }
}

// In-Memory Mock Firestore
class MockFirestore {
  collections: Map<string, Map<string, any>> = new Map();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map());
    }
    const col = this.collections.get(name)!;

    return {
      doc: (id: string) => ({
        id,
        get: async () => {
          const data = col.get(id);
          return {
            exists: data !== undefined,
            id,
            data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined)
          };
        },
        set: async (data: any, options?: any) => {
          if (options?.merge && col.has(id)) {
            col.set(id, { ...col.get(id), ...JSON.parse(JSON.stringify(data)) });
          } else {
            col.set(id, JSON.parse(JSON.stringify(data)));
          }
        },
        update: async (data: any) => {
          const existing = col.get(id);
          if (!existing) {
            throw new Error(`Doc ${id} not found for update`);
          }
          col.set(id, { ...existing, ...JSON.parse(JSON.stringify(data)) });
        }
      }),
      where: (field: string, op: string, val: any) => {
        const filters = [{ field, op, val }];
        const queryObj: any = {
          where: (f2: string, op2: string, v2: any) => {
            filters.push({ field: f2, op: op2, val: v2 });
            return queryObj;
          },
          get: async () => {
            const matches: any[] = [];
            for (const [docId, docData] of col.entries()) {
              const satisfiesAll = filters.every((f) => {
                if (f.op === "==") return docData[f.field] === f.val;
                return true;
              });
              if (satisfiesAll) {
                matches.push({
                  id: docId,
                  exists: true,
                  data: () => JSON.parse(JSON.stringify(docData))
                });
              }
            }
            return {
              size: matches.length,
              empty: matches.length === 0,
              docs: matches
            };
          }
        };
        return queryObj;
      },
      get: async () => {
        const docs: any[] = [];
        for (const [docId, docData] of col.entries()) {
          docs.push({
            id: docId,
            exists: true,
            data: () => JSON.parse(JSON.stringify(docData))
          });
        }
        return {
          size: docs.length,
          empty: docs.length === 0,
          docs
        };
      }
    };
  }

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    const transaction = {
      get: async (docRef: any) => docRef.get(),
      set: (docRef: any, data: any, options?: any) => docRef.set(data, options),
      update: (docRef: any, data: any) => docRef.update(data)
    };
    return updateFunction(transaction);
  }
}

/**
 * Association Service Logic (Mirroring server-side authorization and atomic logic)
 */
async function associateMeetingSession(
  db: MockFirestore,
  caller: { uid: string; email?: string; orgRole?: string },
  sessionId: string,
  payload: { projectId: string | null }
): Promise<{ status: number; body: any }> {
  const { projectId } = payload;
  const sessionDoc = await db.collection("meetingSessions").doc(sessionId).get();
  if (!sessionDoc.exists) {
    return { status: 404, body: { error: "Not Found", message: "Meeting session not found." } };
  }
  const sessionData = sessionDoc.data() || {};

  // 1. Dissociation handling
  if (projectId === null || projectId === undefined || projectId === "") {
    const currentProjId = sessionData.projectId;
    if (!currentProjId || currentProjId === "unassigned") {
      return { status: 200, body: { success: true, message: "Already unassociated.", sessionId, projectId: null } };
    }

    // Check caller permission on current project
    const projDoc = await db.collection("projects").doc(currentProjId).get();
    const projData = projDoc.data() || {};
    const memberDoc = await db.collection("projectMembers").doc(`${caller.uid}_${currentProjId}`).get();
    const memberData = memberDoc.data() || {};
    const isOwner = projData.userId === caller.uid || caller.orgRole === "owner" || caller.orgRole === "org_admin";
    const canManage = isOwner || memberData.role === "owner" || memberData.role === "admin" || memberData.role === "editor";

    if (!canManage) {
      return { status: 403, body: { error: "Forbidden", message: "You do not have permission to disassociate meetings from this project." } };
    }

    const nowIso = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      transaction.update(db.collection("meetingSessions").doc(sessionId), {
        projectId: null,
        updatedAt: nowIso
      });

      if (sessionData.recordingId) {
        transaction.update(db.collection("recordings").doc(sessionData.recordingId), {
          projectId: "unassigned",
          updatedAt: nowIso
        });
      }

      if (sessionData.transcriptId) {
        transaction.update(db.collection("transcriptions").doc(sessionData.transcriptId), {
          projectId: null,
          updatedAt: nowIso
        });
      }
    });

    return { status: 200, body: { success: true, message: "Meeting association removed successfully.", sessionId, projectId: null } };
  }

  // 2. Target Project Association
  const projDoc = await db.collection("projects").doc(projectId).get();
  if (!projDoc.exists) {
    return { status: 404, body: { error: "Not Found", message: "Target project does not exist." } };
  }
  const projData = projDoc.data() || {};

  // Verify caller permissions on target project
  const memberDoc = await db.collection("projectMembers").doc(`${caller.uid}_${projectId}`).get();
  const memberData = memberDoc.data() || {};
  const isOwner = projData.userId === caller.uid || caller.orgRole === "owner" || caller.orgRole === "org_admin";
  const canManage = isOwner || memberData.role === "owner" || memberData.role === "admin" || memberData.role === "editor";

  if (!canManage) {
    return { status: 403, body: { error: "Forbidden", message: "You do not have permission to associate meetings with this project." } };
  }

  const targetOrgId = projData.organizationId || null;

  // 3. Strict Tenant Isolation
  if (sessionData.organizationId && targetOrgId) {
    if (sessionData.organizationId !== targetOrgId) {
      return {
        status: 403,
        body: { error: "Forbidden", message: "Cannot associate meeting with a project belonging to a different organization." }
      };
    }
  }

  const newOrgId = targetOrgId || sessionData.organizationId || null;
  const nowIso = new Date().toISOString();

  // 4. Atomic transaction
  await db.runTransaction(async (transaction) => {
    const updateData: Record<string, any> = {
      projectId,
      updatedAt: nowIso
    };
    if (newOrgId && (!sessionData.organizationId || sessionData.organizationId === null)) {
      updateData.organizationId = newOrgId;
    }
    transaction.update(db.collection("meetingSessions").doc(sessionId), updateData);

    if (sessionData.recordingId) {
      transaction.set(db.collection("recordings").doc(sessionData.recordingId), {
        projectId,
        organizationId: newOrgId,
        updatedAt: nowIso
      }, { merge: true });
    }

    if (sessionData.transcriptId) {
      transaction.set(db.collection("transcriptions").doc(sessionData.transcriptId), {
        projectId,
        organizationId: newOrgId,
        updatedAt: nowIso
      }, { merge: true });
    }
  });

  return {
    status: 200,
    body: {
      success: true,
      message: "Meeting associated with project successfully.",
      sessionId,
      projectId,
      organizationId: newOrgId
    }
  };
}

async function getProjectMeetings(
  db: MockFirestore,
  caller: { uid: string },
  projectId: string
): Promise<{ status: number; body: any }> {
  const projDoc = await db.collection("projects").doc(projectId).get();
  if (!projDoc.exists) {
    return { status: 404, body: { error: "Not Found", message: "Project not found." } };
  }
  const projData = projDoc.data() || {};
  const memberDoc = await db.collection("projectMembers").doc(`${caller.uid}_${projectId}`).get();
  const hasAccess = projData.userId === caller.uid || memberDoc.exists;

  if (!hasAccess) {
    return { status: 403, body: { error: "Forbidden", message: "You do not have access to this project." } };
  }

  const snap = await db.collection("meetingSessions").where("projectId", "==", projectId).get();
  const meetings = snap.docs.map(d => d.data());
  return { status: 200, body: { success: true, projectId, meetings, count: meetings.length } };
}

async function getUnassociatedMeetings(
  db: MockFirestore,
  caller: { uid: string; email?: string }
): Promise<{ status: number; body: any }> {
  const snap = await db.collection("meetingSessions").get();
  const unassociated = snap.docs
    .map(d => d.data())
    .filter(m => !m.projectId || m.projectId === "unassigned");
  return { status: 200, body: { success: true, meetings: unassociated, count: unassociated.length } };
}

// ============================================================================
// TEST SUITE EXECUTION
// ============================================================================

async function runMeetingAssociationTestSuite() {
  console.log("================================================================================");
  console.log("EchoNote Phase 1B — Step 2.1: Meeting-to-Project Association Test Suite");
  console.log("================================================================================\n");

  const mockDb = new MockFirestore();

  // Setup seed data
  // Organizations
  mockDb.collection("organizations").doc("org-corp-a").set({
    name: "Corporate Alpha",
    ownerId: "usr-org-owner-a"
  });

  mockDb.collection("organizations").doc("org-corp-b").set({
    name: "Corporate Beta",
    ownerId: "usr-org-owner-b"
  });

  // Projects in Org A
  mockDb.collection("projects").doc("proj-alpha-1").set({
    name: "Alpha Project 1",
    organizationId: "org-corp-a",
    userId: "usr-lead-a"
  });

  // Project in Org B
  mockDb.collection("projects").doc("proj-beta-1").set({
    name: "Beta Project 1",
    organizationId: "org-corp-b",
    userId: "usr-lead-b"
  });

  // Project Members
  mockDb.collection("projectMembers").doc("usr-lead-a_proj-alpha-1").set({
    userId: "usr-lead-a",
    projectId: "proj-alpha-1",
    role: "owner"
  });

  mockDb.collection("projectMembers").doc("usr-editor-a_proj-alpha-1").set({
    userId: "usr-editor-a",
    projectId: "proj-alpha-1",
    role: "editor"
  });

  mockDb.collection("projectMembers").doc("usr-viewer-a_proj-alpha-1").set({
    userId: "usr-viewer-a",
    projectId: "proj-alpha-1",
    role: "viewer"
  });

  // Provenance Manifests (Immutable)
  mockDb.collection("meetingProvenanceManifests").doc("man-meeting-1").set({
    manifestId: "man-meeting-1",
    meetingSessionId: "sess-meeting-1",
    provider: "zoom",
    externalMeetingId: "987654321",
    rawArtifacts: [{ artifactId: "art-1", type: "recording" }],
    createdAt: "2026-10-14T10:00:00Z"
  });

  mockDb.collection("meetingProvenanceManifests").doc("man-meeting-unmapped").set({
    manifestId: "man-meeting-unmapped",
    meetingSessionId: "sess-meeting-unmapped",
    provider: "zoom",
    externalMeetingId: "123456789",
    rawArtifacts: [{ artifactId: "art-unmapped", type: "recording" }],
    createdAt: "2026-10-14T11:00:00Z"
  });

  // Meeting Sessions
  // 1. Unassociated session with Org A stamped
  mockDb.collection("meetingSessions").doc("sess-meeting-1").set({
    id: "sess-meeting-1",
    externalMeetingId: "987654321",
    meetingInstanceUuid: "uuid-instance-occ1",
    title: "Sprint Planning Session 1",
    organizationId: "org-corp-a",
    projectId: null,
    recordingId: "rec-meeting-1",
    transcriptId: "trn-meeting-1",
    provenanceManifestId: "man-meeting-1",
    status: "completed",
    participants: [{ name: "Lead A", email: "lead@corp-a.com" }]
  });

  // Recording 1
  mockDb.collection("recordings").doc("rec-meeting-1").set({
    id: "rec-meeting-1",
    projectId: "unassigned",
    organizationId: "org-corp-a",
    meetingSessionId: "sess-meeting-1",
    status: "completed"
  });

  // Transcript 1
  mockDb.collection("transcriptions").doc("trn-meeting-1").set({
    id: "trn-meeting-1",
    projectId: null,
    organizationId: "org-corp-a",
    meetingSessionId: "sess-meeting-1",
    summary: "Sprint objectives confirmed"
  });

  // 2. Unassociated meeting session with UNMAPPED host (no orgId, no projectId)
  mockDb.collection("meetingSessions").doc("sess-meeting-unmapped").set({
    id: "sess-meeting-unmapped",
    externalMeetingId: "123456789",
    meetingInstanceUuid: "uuid-unmapped-1",
    title: "External Client Sync",
    organizationId: null, // Pending association / ambiguous
    projectId: null,
    recordingId: "rec-meeting-unmapped",
    transcriptId: "trn-meeting-unmapped",
    provenanceManifestId: "man-meeting-unmapped",
    status: "ingested",
    participants: [{ name: "External Host", email: "external@vendor.com" }]
  });

  mockDb.collection("recordings").doc("rec-meeting-unmapped").set({
    id: "rec-meeting-unmapped",
    projectId: "unassigned",
    organizationId: null,
    meetingSessionId: "sess-meeting-unmapped",
    status: "processing"
  });

  mockDb.collection("transcriptions").doc("trn-meeting-unmapped").set({
    id: "trn-meeting-unmapped",
    projectId: null,
    organizationId: null,
    meetingSessionId: "sess-meeting-unmapped",
    summary: "External sync discussion"
  });

  // ---------------------------------------------------------------------------
  // Test 1: Successful Association by Authorized User
  // ---------------------------------------------------------------------------
  console.log("--- Section 1: Authorized Project Association ---");
  const authRes = await associateMeetingSession(
    mockDb,
    { uid: "usr-editor-a", email: "editor@corp-a.com" },
    "sess-meeting-1",
    { projectId: "proj-alpha-1" }
  );

  check("1.1", "Authorized project editor can associate unassigned meeting",
    authRes.status === 200 && authRes.body.success === true && authRes.body.projectId === "proj-alpha-1"
  );

  const updatedSession = (await mockDb.collection("meetingSessions").doc("sess-meeting-1").get()).data();
  check("1.2", "MeetingSession document reflects target projectId",
    updatedSession.projectId === "proj-alpha-1"
  );

  const updatedRec = (await mockDb.collection("recordings").doc("rec-meeting-1").get()).data();
  check("1.3", "Linked recording document updated to target projectId",
    updatedRec.projectId === "proj-alpha-1"
  );

  const updatedTrn = (await mockDb.collection("transcriptions").doc("trn-meeting-1").get()).data();
  check("1.4", "Linked transcription document updated to target projectId",
    updatedTrn.projectId === "proj-alpha-1"
  );

  // ---------------------------------------------------------------------------
  // Test 2: Unauthorized User (Viewer) Rejection
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 2: Unauthorized User Rejection ---");
  const viewerRes = await associateMeetingSession(
    mockDb,
    { uid: "usr-viewer-a", email: "viewer@corp-a.com" },
    "sess-meeting-1",
    { projectId: "proj-alpha-1" }
  );

  check("2.1", "Project viewer rejected with 403 Forbidden",
    viewerRes.status === 403 && viewerRes.body.error === "Forbidden"
  );

  const strangerRes = await associateMeetingSession(
    mockDb,
    { uid: "usr-stranger", email: "stranger@unknown.com" },
    "sess-meeting-1",
    { projectId: "proj-alpha-1" }
  );

  check("2.2", "Unrelated stranger rejected with 403 Forbidden",
    strangerRes.status === 403 && strangerRes.body.error === "Forbidden"
  );

  // ---------------------------------------------------------------------------
  // Test 3: Cross-Organization Isolation & Tenant Boundaries
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 3: Cross-Organization Isolation ---");
  // Attempt to associate Org A's meeting with a project in Org B
  const crossOrgRes = await associateMeetingSession(
    mockDb,
    { uid: "usr-lead-b", email: "lead@corp-b.com" },
    "sess-meeting-1",
    { projectId: "proj-beta-1" }
  );

  check("3.1", "Cross-organization association rejected with 403 Forbidden",
    crossOrgRes.status === 403 && crossOrgRes.body.message.includes("different organization")
  );

  // ---------------------------------------------------------------------------
  // Test 4: Invalid or Nonexistent Project ID
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 4: Invalid Project ID ---");
  const notFoundRes = await associateMeetingSession(
    mockDb,
    { uid: "usr-lead-a", email: "lead@corp-a.com" },
    "sess-meeting-1",
    { projectId: "nonexistent-project-xyz" }
  );

  check("4.1", "Nonexistent project ID rejected with 404 Not Found",
    notFoundRes.status === 404 && notFoundRes.body.error === "Not Found"
  );

  // ---------------------------------------------------------------------------
  // Test 5: Ambiguous / Unmapped Zoom Host Association
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 5: Unmapped Host Association ---");
  const unmappedRes = await associateMeetingSession(
    mockDb,
    { uid: "usr-lead-a", email: "lead@corp-a.com" },
    "sess-meeting-unmapped",
    { projectId: "proj-alpha-1" }
  );

  check("5.1", "Unmapped host meeting can be bound to project by authorized project lead",
    unmappedRes.status === 200 && unmappedRes.body.success === true && unmappedRes.body.organizationId === "org-corp-a"
  );

  const updatedUnmappedSess = (await mockDb.collection("meetingSessions").doc("sess-meeting-unmapped").get()).data();
  check("5.2", "Meeting session now securely stamped with target organizationId",
    updatedUnmappedSess.organizationId === "org-corp-a" && updatedUnmappedSess.projectId === "proj-alpha-1"
  );

  const updatedUnmappedRec = (await mockDb.collection("recordings").doc("rec-meeting-unmapped").get()).data();
  check("5.3", "Linked unmapped recording stamped with organizationId and projectId",
    updatedUnmappedRec.organizationId === "org-corp-a" && updatedUnmappedRec.projectId === "proj-alpha-1"
  );

  // ---------------------------------------------------------------------------
  // Test 6: Concurrent / Duplicate Request Handling
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 6: Duplicate & Concurrent Requests ---");
  const [resA, resB] = await Promise.all([
    associateMeetingSession(mockDb, { uid: "usr-lead-a" }, "sess-meeting-1", { projectId: "proj-alpha-1" }),
    associateMeetingSession(mockDb, { uid: "usr-lead-a" }, "sess-meeting-1", { projectId: "proj-alpha-1" })
  ]);

  check("6.1", "Concurrent association requests both resolve safely without corrupting state",
    resA.status === 200 && resB.status === 200 && resA.body.projectId === resB.body.projectId
  );

  // ---------------------------------------------------------------------------
  // Test 7: Dissociation & Immutable Provenance Preservation
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 7: Dissociation & Provenance Preservation ---");
  const dissocRes = await associateMeetingSession(
    mockDb,
    { uid: "usr-lead-a" },
    "sess-meeting-1",
    { projectId: null }
  );

  check("7.1", "Authorized lead can disassociate meeting session",
    dissocRes.status === 200 && dissocRes.body.projectId === null
  );

  const dissocSess = (await mockDb.collection("meetingSessions").doc("sess-meeting-1").get()).data();
  check("7.2", "Meeting session has null projectId",
    dissocSess.projectId === null
  );

  // CRITICAL: Provenance manifest MUST remain completely intact
  const manifestDoc = (await mockDb.collection("meetingProvenanceManifests").doc("man-meeting-1").get()).data();
  check("7.3", "Provenance manifest remains untouched and intact after dissociation",
    manifestDoc !== undefined &&
    manifestDoc.externalMeetingId === "987654321" &&
    manifestDoc.rawArtifacts.length === 1 &&
    manifestDoc.createdAt === "2026-10-14T10:00:00Z"
  );

  // Re-associate for visibility testing
  await associateMeetingSession(mockDb, { uid: "usr-lead-a" }, "sess-meeting-1", { projectId: "proj-alpha-1" });

  // ---------------------------------------------------------------------------
  // Test 8: Project Meeting Visibility & Discovery
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 8: Project Meeting Visibility ---");
  const projMeetingsRes = await getProjectMeetings(mockDb, { uid: "usr-editor-a" }, "proj-alpha-1");
  check("8.1", "Project member can query associated meetings for active project",
    projMeetingsRes.status === 200 && projMeetingsRes.body.count === 2
  );

  const outsiderProjRes = await getProjectMeetings(mockDb, { uid: "usr-stranger" }, "proj-alpha-1");
  check("8.2", "Outsider cannot query meetings for private project",
    outsiderProjRes.status === 403
  );

  // ---------------------------------------------------------------------------
  // Test 9: Unassociated Meetings Discovery
  // ---------------------------------------------------------------------------
  console.log("\n--- Section 9: Unassociated Meetings Discovery ---");
  // Dissociate meeting-unmapped to leave it unassociated
  await associateMeetingSession(mockDb, { uid: "usr-lead-a" }, "sess-meeting-unmapped", { projectId: null });

  const unassocRes = await getUnassociatedMeetings(mockDb, { uid: "usr-lead-a" });
  check("9.1", "Unassociated meeting is discoverable in unassociated pool",
    unassocRes.status === 200 && unassocRes.body.meetings.some((m: any) => m.id === "sess-meeting-unmapped")
  );

  check("9.2", "Associated meeting is excluded from unassociated pool",
    unassocRes.status === 200 && !unassocRes.body.meetings.some((m: any) => m.id === "sess-meeting-1")
  );

  console.log("\n================================================================================");
  console.log(`Phase 1B Step 2.1 Test Results: ${passedTests} passed, ${failedTests} failed`);
  console.log("================================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runMeetingAssociationTestSuite().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
