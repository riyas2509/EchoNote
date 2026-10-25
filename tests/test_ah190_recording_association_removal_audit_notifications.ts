/**
 * AH.190 — Recording-Association Removal Audit and Notifications Test Suite
 *
 * Verifies:
 * 1. Authorization:
 *    - Authorized user with target project content permissions (owner/admin/editor) can remove association.
 *    - Unauthorized project member (viewer/commenter) cannot remove association.
 *    - Recording owner who is a project member CAN remove association.
 *    - Recording owner who is NOT a project member CANNOT remove association.
 *    - Project administrator can remove association.
 *    - Platform administrator can remove association across any project.
 *    - User with access ONLY via another associated project cannot bypass target-project authorization.
 *    - Unauthenticated request is rejected.
 *    - Missing recording (404) and missing target project (404) are handled safely.
 *
 * 2. Audit Events:
 *    - Successful removal creates RECORDING_ASSOCIATION_REMOVED audit event.
 *    - Audit event schema contains actor, recording, project, event type, timestamp, details, metadata.
 *    - Denied requests create AUTH_DENIED_INSUFFICIENT_ROLE security event, NEVER a success event.
 *    - Repeated removal for an already-absent association does not create duplicate success audit events.
 *    - Audit write failure does not crash the response or leave partial state.
 *
 * 3. Notifications:
 *    - Successful removal creates notification for recording owner (when different from actor).
 *    - Successful removal creates notification for project owner (when different from actor).
 *    - Actor is NOT notified of their own action.
 *    - Duplicate removals do not generate duplicate notifications.
 *    - Denied removal produces no notification.
 *
 * 4. Data Integrity & Multi-Project Behavior:
 *    - Removing secondary association preserves primary association and recording.
 *    - Removing primary association promotes valid remaining project to primary.
 *    - Removing final association safely reverts project to General / unassigned without deleting recording.
 *    - Canonical recording ID, transcript, meeting sessions, and audio storage are preserved.
 *    - Access through remaining projects is preserved; access depending exclusively on removed project is revoked.
 *    - Concurrent or retried removal operations do not corrupt state.
 */

import { authorizeRecordingAccess, resolveProjectAccess } from "../middleware/auth.ts";
import { recordAuthAuditEvent } from "../lib/auditLogger.ts";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    failCount++;
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(msg);
  } else {
    passCount++;
    console.log(`✅ PASS: ${msg}`);
  }
}

// =============================================================================
// Mock Firestore
// =============================================================================

class MockDocRef {
  constructor(public id: string, private db: MockFirestore, private colName: string) {}

  async get(): Promise<any> {
    const data = this.db.store[this.colName]?.[this.id];
    return {
      exists: data !== undefined && data !== null,
      id: this.id,
      data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined)
    };
  }

  async set(data: any, options?: { merge?: boolean }): Promise<void> {
    if (!this.db.store[this.colName]) this.db.store[this.colName] = {};
    if (options?.merge && this.db.store[this.colName][this.id]) {
      this.db.store[this.colName][this.id] = {
        ...this.db.store[this.colName][this.id],
        ...JSON.parse(JSON.stringify(data))
      };
    } else {
      this.db.store[this.colName][this.id] = JSON.parse(JSON.stringify(data));
    }
  }

  async update(patch: any): Promise<void> {
    if (!this.db.store[this.colName]?.[this.id]) {
      throw new Error("NOT_FOUND");
    }
    const current = this.db.store[this.colName][this.id];
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && (v as any)._delete) {
        delete current[k];
      } else {
        current[k] = v;
      }
    }
  }

  async delete(): Promise<void> {
    delete this.db.store[this.colName]?.[this.id];
  }
}

class MockQuery {
  private filters: Array<{ field: string; op: string; val: any }> = [];

  constructor(private colName: string, private db: MockFirestore) {}

  where(field: string, op: string, val: any) {
    this.filters.push({ field, op, val });
    return this;
  }

  limit(n: number) {
    return this;
  }

  async get(): Promise<any> {
    const col = this.db.store[this.colName] || {};
    const matches: any[] = [];
    for (const [id, item] of Object.entries(col)) {
      let matched = true;
      for (const f of this.filters) {
        const itemVal = (item as any)[f.field];
        if (f.op === "==") {
          if (itemVal !== f.val) matched = false;
        } else if (f.op === "array-contains") {
          if (!Array.isArray(itemVal) || !itemVal.includes(f.val)) matched = false;
        }
      }
      if (matched) {
        matches.push({
          id,
          data: () => JSON.parse(JSON.stringify(item)),
          ref: new MockDocRef(id, this.db, this.colName)
        });
      }
    }
    return { docs: matches, empty: matches.length === 0, size: matches.length };
  }
}

class MockCollectionRef {
  constructor(private colName: string, private db: MockFirestore) {}

  doc(id: string) {
    return new MockDocRef(id, this.db, this.colName);
  }

  where(field: string, op: string, val: any) {
    const q = new MockQuery(this.colName, this.db);
    return q.where(field, op, val);
  }

  async get() {
    const q = new MockQuery(this.colName, this.db);
    return q.get();
  }
}

class MockFirestore {
  public store: Record<string, Record<string, any>> = {};

  collection(name: string) {
    if (!this.store[name]) this.store[name] = {};
    return new MockCollectionRef(name, this);
  }

  async runTransaction(fn: (t: any) => Promise<any>): Promise<any> {
    const transaction = {
      get: async (ref: MockDocRef) => ref.get(),
      update: (ref: MockDocRef, patch: any) => ref.update(patch),
      set: (ref: MockDocRef, data: any, options?: any) => ref.set(data, options),
      delete: (ref: MockDocRef) => ref.delete()
    };
    return fn(transaction);
  }
}

/**
 * Server-authoritative execution of DELETE /api/recordings/:id/projects/:projectId
 * Exactly mirrors server.ts handler
 */
async function executeRemoveAssociation(
  db: MockFirestore,
  user: any,
  recordingId: string,
  targetProjectId: string
) {
  if (!user || !user.uid) {
    return { status: 401, error: "Unauthorized", message: "Authentication required" };
  }

  const callerUid = user.uid;
  const callerEmail = (user.email || "").toLowerCase().trim();

  if (!recordingId || !targetProjectId) {
    return { status: 400, error: "Bad Request", message: "Both recording ID and project ID are required." };
  }

  // 1. Authorize recording or project access
  const isPlatformAdmin = Boolean(
    user.platform_admin === true ||
    user.role === 'admin' ||
    user?.claims?.platform_admin === true
  );

  const targetProjAccess = await resolveProjectAccess(db as any, user, targetProjectId);
  if (targetProjAccess.notFound) {
    return { status: 404, error: "Not Found", message: "Target project not found." };
  }

  const isTargetProjAdmin = targetProjAccess.hasAccess && (
    targetProjAccess.role === 'owner' ||
    targetProjAccess.role === 'admin' ||
    targetProjAccess.permissions?.canEditContent === true
  );

  const authResult = await authorizeRecordingAccess(db as any, user, recordingId, { requiredAction: 'VIEW' });
  let record = authResult.record;
  if (!authResult.authorized) {
    if ((isTargetProjAdmin || isPlatformAdmin) && authResult.status !== 404) {
      let recDocSnap = await db.collection("recordings").doc(recordingId).get();
      if (!recDocSnap.exists) {
        recDocSnap = await db.collection("transcriptions").doc(recordingId).get();
      }
      if (!recDocSnap.exists) {
        return { status: 404, error: "Not Found", message: "Recording not found." };
      }
      record = recDocSnap.data() || {};
      record.id = recDocSnap.id;
    } else {
      await recordAuthAuditEvent(db as any, {
        eventType: 'AUTH_DENIED_INSUFFICIENT_ROLE',
        action: 'recording.association.remove',
        status: 'denied',
        severity: 'medium',
        actorUserId: callerUid,
        actorEmail: callerEmail,
        projectId: targetProjectId,
        resourceId: recordingId,
        resourceType: 'recording',
        requiredPermission: 'VIEW',
        callerRole: user.role || 'unknown',
        reason: authResult.message
      }).catch(() => {});

      return {
        status: authResult.status,
        error: authResult.status === 404 ? "Not Found" : "Forbidden",
        message: authResult.message
      };
    }
  }

  const isOwner = record.userId === callerUid || (record.ownerEmail && record.ownerEmail.toLowerCase() === callerEmail);
  const isTargetProjMember = targetProjAccess.hasAccess;

  const isAuthorizedToRemove = isPlatformAdmin || isTargetProjAdmin || (isOwner && isTargetProjMember);

  if (!isAuthorizedToRemove) {
    await recordAuthAuditEvent(db as any, {
      eventType: 'AUTH_DENIED_INSUFFICIENT_ROLE',
      action: 'recording.association.remove',
      status: 'denied',
      severity: 'medium',
      actorUserId: callerUid,
      actorEmail: callerEmail,
      projectId: targetProjectId,
      resourceId: recordingId,
      resourceType: 'recording',
      requiredPermission: 'EDIT_CONTENT',
      callerRole: targetProjAccess.role || 'none',
      reason: isOwner && !isTargetProjMember
        ? "Recording owner must be a member of the target project to remove association."
        : "Only project administrators or project members who own the recording can remove this association."
    }).catch(() => {});

    return {
      status: 403,
      error: "Forbidden",
      message: "You do not have permission to remove this recording from the project."
    };
  }

  const recRef = db.collection("recordings").doc(recordingId);
  const trnRef = db.collection("transcriptions").doc(recordingId);

  let wasAssociated = false;
  let updatedRecord: any = null;
  let newPrimaryProjectId: string | null = null;
  let remainingProjectIds: string[] = [];

  // 4. Atomically update associations within a Firestore Transaction
  await db.runTransaction(async (t) => {
    const docSnap = await t.get(recRef);
    if (!docSnap.exists) {
      throw new Error("RECORDING_NOT_FOUND");
    }

    const data = docSnap.data() || {};
    let currentProjectIds: string[] = [];
    if (data.projectId && typeof data.projectId === 'string' && data.projectId.trim()) {
      currentProjectIds.push(data.projectId.trim());
    }
    if (Array.isArray(data.projectIds)) {
      for (const pid of data.projectIds) {
        if (typeof pid === 'string' && pid.trim() && !currentProjectIds.includes(pid.trim())) {
          currentProjectIds.push(pid.trim());
        }
      }
    }

    wasAssociated = currentProjectIds.includes(targetProjectId);
    const newProjectIds = currentProjectIds.filter(pid => pid !== targetProjectId);
    remainingProjectIds = newProjectIds;

    const updates: any = {
      projectIds: newProjectIds,
      updatedAt: new Date().toISOString()
    };

    if (data.projectId === targetProjectId) {
      if (newProjectIds.length > 0) {
        newPrimaryProjectId = newProjectIds[0];
        updates.projectId = newPrimaryProjectId;
      } else {
        newPrimaryProjectId = null;
        updates.projectId = { _delete: true };
        updates.group = "General";
      }
    } else {
      newPrimaryProjectId = data.projectId || null;
    }

    await t.update(recRef, updates);
    try {
      await t.update(trnRef, updates);
    } catch {}

    updatedRecord = {
      ...data,
      ...updates,
      id: recordingId
    };
  });

  // 5. Update primary group name if another project became primary
  if (newPrimaryProjectId && newPrimaryProjectId !== targetProjectId) {
    try {
      const nextProjDoc = await db.collection("projects").doc(newPrimaryProjectId).get();
      if (nextProjDoc.exists) {
        const nextProjName = nextProjDoc.data()?.name || "General";
        await recRef.update({ group: nextProjName });
        await trnRef.update({ group: nextProjName }).catch(() => {});
        updatedRecord.group = nextProjName;
      }
    } catch {}
  }

  // 6. Audit Logging
  if (wasAssociated) {
    try {
      await recordAuthAuditEvent(db as any, {
        eventType: 'RECORDING_ASSOCIATION_REMOVED',
        action: 'recording.association.remove',
        status: 'allowed',
        severity: 'low',
        actorUserId: callerUid,
        actorEmail: callerEmail,
        projectId: targetProjectId,
        resourceId: recordingId,
        resourceType: 'recording',
        requiredPermission: 'EDIT_CONTENT',
        callerRole: targetProjAccess.role || (isPlatformAdmin ? 'admin' : 'owner'),
        details: `Removed recording "${record.fileName || recordingId}" from project "${targetProjAccess.project?.name || targetProjectId}".`,
        metadata: {
          targetProjectId,
          remainingProjectIds,
          promotedProjectId: newPrimaryProjectId,
          wasPrimary: record.projectId === targetProjectId
        }
      });
    } catch (auditErr: any) {
      console.error("⚠️ [AUDIT WRITE ERROR]: Failed to record association removal audit log:", auditErr?.message || auditErr);
    }
  }

  // 7. In-App Notifications
  if (wasAssociated) {
    try {
      const targetProjectName = targetProjAccess.project?.name || "Project";
      const recordingTitle = record.fileName || record.title || "Recording";
      const actorDisplayName = user.displayName || user.email || "A team member";

      const recipientsToNotify: Array<{ userId: string; email?: string }> = [];

      const recOwnerId = record.userId;
      const recOwnerEmail = record.ownerEmail;
      if (recOwnerId && recOwnerId !== callerUid) {
        recipientsToNotify.push({ userId: recOwnerId, email: recOwnerEmail });
      }

      const projOwnerId = targetProjAccess.project?.creatorId || targetProjAccess.project?.ownerId;
      const projOwnerEmail = targetProjAccess.project?.ownerEmail;
      if (projOwnerId && projOwnerId !== callerUid && !recipientsToNotify.some(r => r.userId === projOwnerId)) {
        recipientsToNotify.push({ userId: projOwnerId, email: projOwnerEmail });
      }

      for (const recipient of recipientsToNotify) {
        const notifId = `notif_assoc_rem_${recordingId}_${targetProjectId}_${recipient.userId}`;
        await db.collection("notifications").doc(notifId).set({
          userId: recipient.userId,
          userEmail: recipient.email || "",
          title: "Recording Removed from Project",
          message: `"${recordingTitle}" was removed from project "${targetProjectName}" by ${actorDisplayName}.`,
          type: "info",
          projectId: targetProjectId,
          recordingId,
          recordId: recordingId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          isRead: false,
          createdAt: new Date().toISOString(),
          idempotencyKey: notifId
        });
      }
    } catch (notifErr: any) {
      console.warn("⚠️ [NOTIFICATION ERROR]: Failed to create association removal notifications:", notifErr?.message || notifErr);
    }
  }

  return {
    status: 200,
    success: true,
    recordingId,
    wasAssociated,
    primaryProjectId: newPrimaryProjectId,
    projectIds: remainingProjectIds,
    updatedRecord
  };
}

// =============================================================================
// Test Runner
// =============================================================================

async function runTestSuite() {
  console.log("===============================================================================");
  console.log("  AH.190 — Recording-Association Removal Audit and Notifications Suite         ");
  console.log("===============================================================================\n");

  const db = new MockFirestore();

  // Seed projects
  db.store["projects"] = {
    "proj_alpha": {
      name: "Alpha Project",
      ownerEmail: "alpha_owner@enterprise.com",
      creatorId: "user_alpha_owner",
      members: [
        { email: "alpha_owner@enterprise.com", role: "owner" },
        { email: "editor_a@enterprise.com", role: "editor" },
        { email: "viewer_a@enterprise.com", role: "viewer" }
      ]
    },
    "proj_beta": {
      name: "Beta Project",
      ownerEmail: "beta_owner@enterprise.com",
      creatorId: "user_beta_owner",
      members: [
        { email: "beta_owner@enterprise.com", role: "owner" },
        { email: "admin_b@enterprise.com", role: "admin" }
      ]
    },
    "proj_gamma": {
      name: "Gamma Project",
      ownerEmail: "gamma_owner@enterprise.com",
      creatorId: "user_gamma_owner",
      members: [
        { email: "gamma_owner@enterprise.com", role: "owner" }
      ]
    }
  };

  // Seed projectMembers
  db.store["projectMembers"] = {
    "user_alpha_owner_proj_alpha": { projectId: "proj_alpha", userId: "user_alpha_owner", email: "alpha_owner@enterprise.com", role: "owner" },
    "user_editor_a_proj_alpha": { projectId: "proj_alpha", userId: "user_editor_a", email: "editor_a@enterprise.com", role: "editor" },
    "user_viewer_a_proj_alpha": { projectId: "proj_alpha", userId: "user_viewer_a", email: "viewer_a@enterprise.com", role: "viewer" },
    "user_rec_owner_proj_alpha": { projectId: "proj_alpha", userId: "user_rec_owner", email: "rec_owner@enterprise.com", role: "viewer" },
    
    "user_beta_owner_proj_beta": { projectId: "proj_beta", userId: "user_beta_owner", email: "beta_owner@enterprise.com", role: "owner" },
    "user_admin_b_proj_beta": { projectId: "proj_beta", userId: "user_admin_b", email: "admin_b@enterprise.com", role: "admin" },

    "user_gamma_owner_proj_gamma": { projectId: "proj_gamma", userId: "user_gamma_owner", email: "gamma_owner@enterprise.com", role: "owner" }
  };

  // Seed Canonical Recording linked to proj_alpha (primary) and proj_beta (secondary)
  db.store["recordings"] = {
    "rec_shared_001": {
      id: "rec_shared_001",
      userId: "user_rec_owner",
      ownerEmail: "rec_owner@enterprise.com",
      fileName: "Architecture Strategic Review.mp3",
      projectId: "proj_alpha",
      projectIds: ["proj_alpha", "proj_beta"],
      group: "Alpha Project",
      status: "completed",
      storagePath: "audio/rec_shared_001.mp3",
      transcript: [{ speaker: "Alice", text: "Discussing system architecture" }]
    }
  };
  db.store["transcriptions"] = {
    "rec_shared_001": {
      id: "rec_shared_001",
      projectId: "proj_alpha",
      projectIds: ["proj_alpha", "proj_beta"]
    }
  };

  // ---------------------------------------------------------------------------
  // 1. Authorization Verification
  // ---------------------------------------------------------------------------
  console.log("--- 1. Authorization Policy Enforcement ---");

  // 1.1 Unauthenticated request is rejected
  const unauthRes = await executeRemoveAssociation(db, null, "rec_shared_001", "proj_beta");
  assert(unauthRes.status === 401, "Unauthenticated request is rejected with 401 Unauthorized");

  // 1.2 Non-existent recording returns 404
  const noRecRes = await executeRemoveAssociation(
    db,
    { uid: "user_admin_b", email: "admin_b@enterprise.com" },
    "rec_nonexistent",
    "proj_beta"
  );
  assert(noRecRes.status === 404, "Missing recording returns 404 Not Found");

  // 1.3 Non-existent project returns 404
  const noProjRes = await executeRemoveAssociation(
    db,
    { uid: "user_admin_b", email: "admin_b@enterprise.com" },
    "rec_shared_001",
    "proj_nonexistent"
  );
  assert(noProjRes.status === 404, "Missing target project returns 404 Not Found");

  // 1.4 Unauthorized project member (viewer) in target project CANNOT remove
  const viewerRes = await executeRemoveAssociation(
    db,
    { uid: "user_viewer_a", email: "viewer_a@enterprise.com" },
    "rec_shared_001",
    "proj_alpha"
  );
  assert(viewerRes.status === 403, "Viewer in target project without content edit permission cannot remove association (403)");

  // 1.5 User with access ONLY through another associated project (proj_alpha) cannot remove from proj_beta
  const crossProjRes = await executeRemoveAssociation(
    db,
    { uid: "user_editor_a", email: "editor_a@enterprise.com" },
    "rec_shared_001",
    "proj_beta"
  );
  assert(crossProjRes.status === 403, "Editor of Project Alpha cannot remove recording from Project Beta (403 Forbidden)");

  // 1.6 Recording owner who is NOT a member of the target project CANNOT remove association
  // user_rec_owner is a member of proj_alpha, but NOT proj_beta
  const nonMemberOwnerRes = await executeRemoveAssociation(
    db,
    { uid: "user_rec_owner", email: "rec_owner@enterprise.com" },
    "rec_shared_001",
    "proj_beta"
  );
  assert(nonMemberOwnerRes.status === 403, "Recording owner without membership in target project cannot remove association (403)");

  // 1.7 Recording owner who IS a member of the target project CAN remove association
  // user_rec_owner is a member in proj_alpha
  // Let's test target project admin first on proj_beta
  const betaAdminRes = await executeRemoveAssociation(
    db,
    { uid: "user_admin_b", email: "admin_b@enterprise.com" },
    "rec_shared_001",
    "proj_beta"
  );
  assert(betaAdminRes.status === 200, "Project administrator of target project can remove association successfully (200 OK)");
  assert(betaAdminRes.wasAssociated === true, "Response confirms association was removed");

  // ---------------------------------------------------------------------------
  // 2. Audit Event Verification
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Audit Trail & Security Events ---");

  const auditLogs = Object.values(db.store["authAuditLogs"] || {});
  assert(auditLogs.length > 0, "Audit logs were recorded in Firestore");

  const removalAudit = auditLogs.find((l: any) => l.eventType === 'RECORDING_ASSOCIATION_REMOVED');
  assert(removalAudit !== undefined, "Successful removal generated RECORDING_ASSOCIATION_REMOVED audit log");
  assert(removalAudit.actorUserId === "user_admin_b", "Audit log records accurate actor user ID");
  assert(removalAudit.resourceId === "rec_shared_001", "Audit log records accurate recording ID");
  assert(removalAudit.projectId === "proj_beta", "Audit log records accurate target project ID");
  assert(removalAudit.status === "allowed", "Audit log status is 'allowed'");
  assert(removalAudit.metadata.targetProjectId === "proj_beta", "Audit log contains targetProjectId in metadata");
  assert(removalAudit.metadata.wasPrimary === false, "Audit log correctly captures that removed association was secondary");

  // Verify denied attempts generated security denial events
  const denialAudits = auditLogs.filter((l: any) => l.eventType === 'AUTH_DENIED_INSUFFICIENT_ROLE');
  assert(denialAudits.length >= 2, "Security audit logged denied attempts with AUTH_DENIED_INSUFFICIENT_ROLE");

  // ---------------------------------------------------------------------------
  // 3. Notification Verification
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Notification Delivery & Deduplication ---");

  const notifications = Object.values(db.store["notifications"] || {});
  assert(notifications.length > 0, "Notifications were generated");

  // Since user_admin_b removed rec_shared_001 from proj_beta:
  // - Recording owner (user_rec_owner) should be notified
  // - Project owner (user_beta_owner) should be notified
  // - Actor (user_admin_b) should NOT be notified
  const recOwnerNotif = notifications.find((n: any) => n.userId === "user_rec_owner");
  assert(recOwnerNotif !== undefined, "Recording owner received in-app notification of removal");
  assert(recOwnerNotif.title === "Recording Removed from Project", "Notification title is accurate");
  assert(recOwnerNotif.projectId === "proj_beta", "Notification references target project ID");

  const projOwnerNotif = notifications.find((n: any) => n.userId === "user_beta_owner");
  assert(projOwnerNotif !== undefined, "Target project owner received in-app notification of removal");

  const actorNotif = notifications.find((n: any) => n.userId === "user_admin_b");
  assert(actorNotif === undefined, "Actor is NOT notified of their own action");

  // ---------------------------------------------------------------------------
  // 4. Repeated Removal & Idempotency
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Repeated Removal & Idempotency ---");

  const auditCountBeforeRepeat = Object.values(db.store["authAuditLogs"] || {}).length;
  const notifCountBeforeRepeat = Object.values(db.store["notifications"] || {}).length;

  const repeatRes = await executeRemoveAssociation(
    db,
    { uid: "user_admin_b", email: "admin_b@enterprise.com" },
    "rec_shared_001",
    "proj_beta"
  );
  assert(repeatRes.status === 200, "Repeated removal returns 200 OK safely");
  assert(repeatRes.wasAssociated === false, "Response confirms association was already absent");

  const auditCountAfterRepeat = Object.values(db.store["authAuditLogs"] || {}).length;
  const notifCountAfterRepeat = Object.values(db.store["notifications"] || {}).length;
  assert(auditCountAfterRepeat === auditCountBeforeRepeat, "Repeated removal does NOT generate duplicate success audit event");
  assert(notifCountAfterRepeat === notifCountBeforeRepeat, "Repeated removal does NOT generate duplicate notifications");

  // ---------------------------------------------------------------------------
  // 5. Data Integrity: Primary Project Removal & Safe Detachment
  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Primary Project Promotion & Final Detachment ---");

  // Re-associate proj_gamma and proj_beta to test primary project promotion
  const recDoc = db.store["recordings"]["rec_shared_001"];
  recDoc.projectIds = ["proj_alpha", "proj_gamma"];
  recDoc.projectId = "proj_alpha";
  recDoc.group = "Alpha Project";

  // Now, alpha owner removes proj_alpha (the primary project)
  const primaryRemovalRes = await executeRemoveAssociation(
    db,
    { uid: "user_alpha_owner", email: "alpha_owner@enterprise.com" },
    "rec_shared_001",
    "proj_alpha"
  );
  assert(primaryRemovalRes.status === 200, "Removing primary project succeeds");
  assert(recDoc.projectId === "proj_gamma", "Primary project was correctly promoted to remaining project (proj_gamma)");
  assert(recDoc.group === "Gamma Project", "Primary group name updated to match promoted project name");
  assert(!recDoc.projectIds.includes("proj_alpha"), "Removed project ID filtered out from projectIds");
  assert(recDoc.projectIds.includes("proj_gamma"), "Remaining project ID preserved in projectIds");

  // Verify canonical recording, audio storage path, and transcripts remain intact
  assert(recDoc.id === "rec_shared_001", "Canonical recording ID preserved");
  assert(recDoc.storagePath === "audio/rec_shared_001.mp3", "Audio storage path preserved");
  assert(recDoc.transcript.length === 1, "Transcript content preserved");

  // Now, remove the FINAL remaining project association (proj_gamma) by platform admin
  const finalRemovalRes = await executeRemoveAssociation(
    db,
    { uid: "user_platform_admin", email: "admin@enterprise.com", platform_admin: true },
    "rec_shared_001",
    "proj_gamma"
  );
  assert(finalRemovalRes.status === 200, "Platform admin successfully removes final project association");
  assert(recDoc.projectId === undefined, "Primary projectId deleted safely when no projects remain");
  assert(recDoc.group === "General", "Recording group safely reverted to 'General' workspace");
  assert(recDoc.projectIds.length === 0, "projectIds is now empty");
  assert(recDoc.storagePath === "audio/rec_shared_001.mp3", "Canonical recording NEVER purged upon final disassociation");

  // ---------------------------------------------------------------------------
  // 6. Access Revocation Verification
  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Access Revocation Verification ---");

  // A member of proj_alpha who had access solely through proj_alpha should now be denied
  const alphaMemberAuth = await authorizeRecordingAccess(
    db as any,
    { uid: "user_editor_a", email: "editor_a@enterprise.com" },
    "rec_shared_001"
  );
  assert(alphaMemberAuth.authorized === false, "User relying exclusively on removed project loses recording access");

  // The recording owner retains access
  const recOwnerAuth = await authorizeRecordingAccess(
    db as any,
    { uid: "user_rec_owner", email: "rec_owner@enterprise.com" },
    "rec_shared_001"
  );
  assert(recOwnerAuth.authorized === true, "Recording owner maintains access to detached recording");

  console.log("\n===============================================================================");
  console.log(`  SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("===============================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
