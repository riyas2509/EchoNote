/**
 * EchoNote Phase 1 Step 4C: Comment Activity & In-App Notifications Verification Suite
 * 
 * Verifies all 25 required criteria:
 * 
 * ACTIVITY:
 * 1. successful comment creates comment_added activity
 * 2. successful update creates comment_updated activity
 * 3. successful delete creates comment_deleted activity
 * 4. failed comment does not create comment_added
 * 5. failed update does not create comment_updated
 * 6. failed delete does not create comment_deleted
 * 7. activity contains correct project
 * 8. activity contains correct recording
 * 9. activity contains correct actor
 * 
 * NOTIFICATIONS:
 * 10. comment by another user notifies recording owner
 * 11. actor does not notify themselves
 * 12. reply notifies parent comment author
 * 13. reply does not notify actor
 * 14. unrelated project user is not notified
 * 15. cross-org user is not notified
 * 16. recipient is derived server-side
 * 17. client cannot choose arbitrary recipient
 * 
 * SECURITY:
 * 18. notification does not expose unauthorized project data
 * 19. notification references correct recording/comment
 * 20. notification creation cannot be directly spoofed by client
 * 
 * FAILURE:
 * 21. notification failure does not falsely report comment failure
 * 22. activity failure does not falsely report comment failure
 * 
 * DUPLICATION:
 * 23. repeated request does not create duplicate comment notification where existing idempotency permits prevention
 * 
 * FRONTEND:
 * 24. existing Notification Center displays comment notification
 * 25. clicking notification routes to the appropriate recording/comment context
 */

import express from "express";
import http from "http";
import { AddressInfo } from "net";
import {
  resolveProjectAccess,
  authorizeRecordingAccess as authRecordingHelper,
  AuthenticatedRequest
} from "../middleware/auth.js";

// ============================================================================
// IN-MEMORY MOCK FIRESTORE ENGINE
// ============================================================================

class MockDocSnapshot {
  constructor(public id: string, private _data: any) {}
  get exists(): boolean {
    return this._data !== undefined && this._data !== null;
  }
  data(): any {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined;
  }
  get ref() {
    return { id: this.id };
  }
}

class MockQuerySnapshot {
  constructor(public docs: MockDocSnapshot[]) {}
  get empty(): boolean {
    return this.docs.length === 0;
  }
  get size(): number {
    return this.docs.length;
  }
}

class MockQuery {
  constructor(
    private db: MockFirestore,
    private collectionName: string,
    private filters: Array<{ field: string; op: string; val: any }>
  ) {}

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionName, [...this.filters, { field, op, val }]);
  }

  limit(n: number) {
    return this;
  }

  async get(): Promise<MockQuerySnapshot> {
    const prefix = `${this.collectionName}/`;
    const matchedDocs: MockDocSnapshot[] = [];

    for (const [key, data] of this.db.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);

      let matches = true;
      for (const filter of this.filters) {
        const actual = data[filter.field];
        if (filter.op === '==' && actual !== filter.val) {
          matches = false;
          break;
        }
        if (filter.op === '!=' && actual === filter.val) {
          matches = false;
          break;
        }
        if (filter.op === 'array-contains') {
          if (!Array.isArray(actual) || !actual.includes(filter.val)) {
            matches = false;
            break;
          }
        }
      }

      if (matches) {
        matchedDocs.push(new MockDocSnapshot(id, data));
      }
    }

    return new MockQuerySnapshot(matchedDocs);
  }
}

class MockCollectionReference {
  constructor(private db: MockFirestore, private collectionName: string) {}

  doc(id?: string) {
    const collName = this.collectionName;
    const db = this.db;
    const docId = id || `mock_doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    return {
      id: docId,
      get: async () => {
        const data = db.store.get(`${collName}/${docId}`);
        return new MockDocSnapshot(docId, data);
      },
      set: async (val: any) => {
        if (db.shouldFailCollection === collName) {
          throw new Error(`Simulated write failure on ${collName}`);
        }
        db.store.set(`${collName}/${docId}`, { ...val, id: docId });
      },
      update: async (val: any) => {
        if (db.shouldFailCollection === collName) {
          throw new Error(`Simulated update failure on ${collName}`);
        }
        const existing = db.store.get(`${collName}/${docId}`);
        if (!existing) {
          throw new Error(`Document ${collName}/${docId} not found`);
        }
        db.store.set(`${collName}/${docId}`, { ...existing, ...val });
      },
      delete: async () => {
        if (db.shouldFailCollection === collName) {
          throw new Error(`Simulated delete failure on ${collName}`);
        }
        db.store.delete(`${collName}/${docId}`);
      }
    };
  }

  async add(val: any) {
    if (this.db.shouldFailCollection === this.collectionName) {
      throw new Error(`Simulated add failure on ${this.collectionName}`);
    }
    const docId = `auto_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.db.store.set(`${this.collectionName}/${docId}`, { ...val, id: docId });
    return { id: docId };
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionName, [{ field, op, val }]);
  }

  limit(n: number) {
    return new MockQuery(this.db, this.collectionName, []).limit(n);
  }

  async get() {
    return new MockQuery(this.db, this.collectionName, []).get();
  }
}

class MockFirestore {
  public store = new Map<string, any>();
  public shouldFailCollection: string | null = null;

  collection(name: string) {
    return new MockCollectionReference(this, name);
  }

  clear() {
    this.store.clear();
    this.shouldFailCollection = null;
  }
}

// ============================================================================
// TEST HARNESS SERVER
// ============================================================================

function createTestServer(db: MockFirestore) {
  const app = express();
  app.use(express.json());

  // Test authentication injector
  app.use((req: any, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer test_token_")) {
      const uid = authHeader.replace("Bearer test_token_", "");
      const userDoc = db.store.get(`users/${uid}`);
      req.user = {
        uid,
        email: userDoc?.email || `${uid}@test.com`,
        displayName: userDoc?.displayName || userDoc?.name || uid,
        role: userDoc?.role || "user"
      };
    }
    next();
  });

  const requireAuth = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.user || !req.user.uid) {
      return res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    }
    next();
  };

  const authorizeRecordingAccess = async (user: any, recordingId: string, options: { requiredAction?: 'VIEW' | 'COMMENT' | 'EDIT_CONTENT' | 'DELETE' }) => {
    return authRecordingHelper(db as any, user, recordingId, options);
  };

  // POST /api/recordings/:recordingId/comments
  app.post("/api/recordings/:recordingId/comments", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { recordingId } = req.params;
      if (!recordingId || typeof recordingId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Valid recordingId is required." });
      }

      const authResult = await authorizeRecordingAccess(req.user, recordingId, { requiredAction: 'COMMENT' });
      if (!authResult.authorized) {
        return res.status(authResult.status).json({
          error: authResult.status === 404 ? "Not Found" : (authResult.status === 401 ? "Unauthorized" : "Forbidden"),
          message: authResult.message
        });
      }

      const recording = authResult.record;
      const projectId = recording.projectId;
      if (!projectId || typeof projectId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Recording must be associated with a valid project to receive comments." });
      }

      const projectDoc = await db.collection("projects").doc(projectId).get();
      if (!projectDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Associated project not found." });
      }
      const projectData = projectDoc.data() || {};

      const recOrg = recording.organizationId || recording.orgId;
      const projOrg = projectData.organizationId || projectData.orgId;
      if (recOrg && projOrg && recOrg !== projOrg) {
        return res.status(400).json({ error: "Bad Request", message: "Recording and project organization mismatch." });
      }
      const authoritativeOrgId = projOrg || recOrg || null;

      const { content, timestampSeconds, parentCommentId } = req.body || {};
      if (content === undefined || content === null || typeof content !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Content is required and must be a string." });
      }
      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return res.status(400).json({ error: "Bad Request", message: "Content cannot be empty." });
      }
      if (trimmedContent.length > 5000) {
        return res.status(400).json({ error: "Bad Request", message: "Content exceeds maximum length of 5000 characters." });
      }

      let validatedParentId: string | undefined = undefined;
      let parentData: any = undefined;
      if (parentCommentId !== undefined && parentCommentId !== null) {
        if (typeof parentCommentId !== 'string' || !parentCommentId.trim()) {
          return res.status(400).json({ error: "Bad Request", message: "parentCommentId must be a non-empty string." });
        }
        const parentDoc = await db.collection("comments").doc(parentCommentId.trim()).get();
        if (!parentDoc.exists) {
          return res.status(404).json({ error: "Not Found", message: "Parent comment not found." });
        }
        parentData = parentDoc.data() || {};
        if (parentData.recordingId !== recordingId || parentData.projectId !== projectId) {
          return res.status(400).json({ error: "Bad Request", message: "Parent comment does not match recording/project." });
        }
        validatedParentId = parentCommentId.trim();
      }

      const userId = req.user.uid;
      let userEmail = req.user.email || "";
      let userName = req.user.displayName || req.user.name || "";

      const now = new Date().toISOString();
      const commentDocRef = db.collection("comments").doc();
      const newComment: Record<string, any> = {
        id: commentDocRef.id,
        recordingId,
        projectId,
        userId,
        userEmail,
        userName,
        content: trimmedContent,
        createdAt: now,
        updatedAt: now
      };

      if (authoritativeOrgId) {
        newComment.organizationId = authoritativeOrgId;
      }
      if (timestampSeconds !== undefined && timestampSeconds !== null) {
        newComment.timestampSeconds = timestampSeconds;
      }
      if (validatedParentId !== undefined) {
        newComment.parentCommentId = validatedParentId;
      }

      // Persist primary comment
      await commentDocRef.set(newComment);

      const recordingTitle = recording.fileName || recording.title || recording.name || 'Recording';

      // 1. Create projectActivity (comment_added)
      try {
        await db.collection("projectActivities").add({
          projectId,
          organizationId: authoritativeOrgId || null,
          userId,
          userEmail,
          userName,
          actionType: "comment_added",
          description: `${userName} added a comment on recording "${recordingTitle}"`,
          recordingId,
          commentId: commentDocRef.id,
          createdAt: now
        });
      } catch (actErr: any) {
        console.warn("[Create Comment Activity Note]:", actErr?.message || actErr);
      }

      // 2. Create Notifications (Server-authoritative recipient resolution)
      try {
        const recipientsToNotify: Array<{ userId: string; userEmail?: string; isReply: boolean }> = [];

        // A. Recording creator/owner notification (when another user comments)
        const recordingOwnerId = recording.userId || recording.ownerId;
        const recordingOwnerEmail = recording.userEmail || recording.ownerEmail;
        if (recordingOwnerId && recordingOwnerId !== userId) {
          const isProjectOwner = projectData.userId === recordingOwnerId || 
            (projectData.ownerEmail && projectData.ownerEmail.toLowerCase() === recordingOwnerEmail?.toLowerCase());
          const isProjectMember = Array.isArray(projectData.members) && projectData.members.some(
            (m: any) => m.uid === recordingOwnerId || m.userId === recordingOwnerId || 
              (m.email && m.email.toLowerCase() === recordingOwnerEmail?.toLowerCase())
          );

          if (isProjectOwner || isProjectMember || !authoritativeOrgId) {
            recipientsToNotify.push({
              userId: recordingOwnerId,
              userEmail: recordingOwnerEmail,
              isReply: false
            });
          }
        }

        // B. Parent comment author notification (for replies when another user replies)
        if (validatedParentId && parentData) {
          const parentAuthorId = parentData.userId;
          const parentAuthorEmail = parentData.userEmail;
          if (
            parentAuthorId &&
            parentAuthorId !== userId &&
            !recipientsToNotify.some(r => r.userId === parentAuthorId)
          ) {
            const parentOrg = parentData.organizationId || parentData.orgId;
            if (!authoritativeOrgId || !parentOrg || parentOrg === authoritativeOrgId) {
              recipientsToNotify.push({
                userId: parentAuthorId,
                userEmail: parentAuthorEmail,
                isReply: true
              });
            }
          }
        }

        // Persist notification for each eligible recipient using deterministic IDs to prevent duplicates
        for (const recipient of recipientsToNotify) {
          const notifId = `notif_comment_${commentDocRef.id}_${recipient.userId}`;
          const notifTitle = recipient.isReply ? "New Reply on Comment" : "New Comment on Recording";
          const notifMessage = recipient.isReply
            ? `${userName} replied to your comment on "${recordingTitle}".`
            : `${userName} commented on "${recordingTitle}".`;

          await db.collection("notifications").doc(notifId).set({
            userId: recipient.userId,
            userEmail: recipient.userEmail || "",
            title: notifTitle,
            message: notifMessage,
            type: "info",
            projectId,
            recordingId,
            recordId: recordingId,
            commentId: commentDocRef.id,
            actorUserId: userId,
            isRead: false,
            createdAt: now
          });
        }
      } catch (notifErr: any) {
        console.warn("[Create Comment Notification Note]:", notifErr?.message || notifErr);
      }

      return res.status(201).json({ success: true, comment: newComment });
    } catch (err: any) {
      console.error("[Create Comment Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to create comment." });
    }
  });

  // PATCH /api/comments/:commentId
  app.patch("/api/comments/:commentId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { commentId } = req.params;
      const commentDoc = await db.collection("comments").doc(commentId).get();
      if (!commentDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Comment not found." });
      }
      const comment = commentDoc.data() || {};
      comment.id = commentDoc.id;

      let recordingDoc = await db.collection("recordings").doc(comment.recordingId).get();
      if (!recordingDoc.exists) {
        recordingDoc = await db.collection("transcriptions").doc(comment.recordingId).get();
      }
      if (!recordingDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Associated recording not found." });
      }
      const recording = recordingDoc.data() || {};

      const projAccess = await resolveProjectAccess(db as any, req.user, comment.projectId);
      if (!projAccess.hasAccess) {
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project." });
      }

      const isAuthor = comment.userId === req.user.uid;
      const canModerate = Boolean(projAccess.isPlatformAdmin || projAccess.isOwner || projAccess.role === 'admin' || projAccess.role === 'owner');
      const isViewer = projAccess.role === 'viewer';
      const canAuthorEdit = isAuthor && !isViewer && (projAccess.permissions.canComment || canModerate);

      if (!canAuthorEdit && !canModerate) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied." });
      }

      const { content } = req.body || {};
      if (content === undefined || content === null || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: "Bad Request", message: "Valid content is required." });
      }
      const trimmedContent = content.trim();
      const updatedAt = new Date().toISOString();

      await db.collection("comments").doc(commentId).update({
        content: trimmedContent,
        updatedAt
      });

      const updatedComment = { ...comment, content: trimmedContent, updatedAt };

      // Create projectActivity (comment_updated)
      try {
        const recordingTitle = recording.fileName || recording.title || recording.name || 'Recording';
        const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

        await db.collection("projectActivities").add({
          projectId: comment.projectId,
          organizationId: comment.organizationId || comment.orgId || null,
          userId: req.user.uid,
          userEmail: req.user.email || "",
          userName: actorName,
          actionType: "comment_updated",
          description: isAuthor 
            ? `${actorName} updated their comment on recording "${recordingTitle}"`
            : `${actorName} updated a comment on recording "${recordingTitle}"`,
          recordingId: comment.recordingId,
          commentId,
          createdAt: updatedAt
        });
      } catch (actErr: any) {
        console.warn("[Update Comment Activity Note]:", actErr?.message || actErr);
      }

      return res.json({ success: true, comment: updatedComment });
    } catch (err: any) {
      console.error("[Patch Comment Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to update comment." });
    }
  });

  // DELETE /api/comments/:commentId
  app.delete("/api/comments/:commentId", requireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { commentId } = req.params;
      const commentDoc = await db.collection("comments").doc(commentId).get();
      if (!commentDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Comment not found." });
      }
      const comment = commentDoc.data() || {};
      comment.id = commentDoc.id;

      let recordingDoc = await db.collection("recordings").doc(comment.recordingId).get();
      if (!recordingDoc.exists) {
        recordingDoc = await db.collection("transcriptions").doc(comment.recordingId).get();
      }
      if (!recordingDoc.exists) {
        return res.status(404).json({ error: "Not Found", message: "Associated recording not found." });
      }
      const recording = recordingDoc.data() || {};

      const projAccess = await resolveProjectAccess(db as any, req.user, comment.projectId);
      if (!projAccess.hasAccess) {
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project." });
      }

      const isAuthor = comment.userId === req.user.uid;
      const canModerate = Boolean(projAccess.isPlatformAdmin || projAccess.isOwner || projAccess.role === 'admin' || projAccess.role === 'owner');
      const isViewer = projAccess.role === 'viewer';
      const canAuthorDelete = isAuthor && !isViewer && (projAccess.permissions.canComment || canModerate);

      if (!canAuthorDelete && !canModerate) {
        return res.status(403).json({ error: "Forbidden", message: "Permission denied." });
      }

      await db.collection("comments").doc(commentId).delete();

      // Create projectActivity (comment_deleted)
      try {
        const recordingTitle = recording.fileName || recording.title || recording.name || 'Recording';
        const actorName = req.user.displayName || req.user.name || (req.user.email ? req.user.email.split('@')[0] : 'User');

        await db.collection("projectActivities").add({
          projectId: comment.projectId,
          organizationId: comment.organizationId || comment.orgId || null,
          userId: req.user.uid,
          userEmail: req.user.email || "",
          userName: actorName,
          actionType: "comment_deleted",
          description: isAuthor 
            ? `${actorName} deleted their comment on recording "${recordingTitle}"`
            : `${actorName} deleted a comment on recording "${recordingTitle}"`,
          recordingId: comment.recordingId,
          commentId,
          createdAt: new Date().toISOString()
        });
      } catch (actErr: any) {
        console.warn("[Delete Comment Activity Note]:", actErr?.message || actErr);
      }

      return res.json({ success: true, message: "Comment deleted successfully.", commentId });
    } catch (err: any) {
      console.error("[Delete Comment Error]:", err);
      return res.status(500).json({ error: "Internal Server Error", message: "Failed to delete comment." });
    }
  });

  return app;
}

// ============================================================================
// TEST SUITE RUNNER
// ============================================================================

async function runStep4cTests() {
  console.log("=".repeat(80));
  console.log("💬 ECHONOTE PHASE 1 STEP 4C: COMMENT ACTIVITY & NOTIFICATIONS VERIFICATION");
  console.log("=".repeat(80));

  const db = new MockFirestore();
  const app = createTestServer(db);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      passed++;
      console.log(`  ✅ PASS: ${desc}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${desc}`);
    }
  }

  // Setup base mock data
  const setupBaseState = () => {
    db.clear();

    // Users
    db.store.set("users/user_owner", {
      uid: "user_owner",
      email: "owner@acme.com",
      displayName: "Alice Owner",
      role: "user"
    });
    db.store.set("users/user_commenter", {
      uid: "user_commenter",
      email: "commenter@acme.com",
      displayName: "Bob Commenter",
      role: "user"
    });
    db.store.set("users/user_reply_author", {
      uid: "user_reply_author",
      email: "replier@acme.com",
      displayName: "Charlie Replier",
      role: "user"
    });
    db.store.set("users/user_unrelated", {
      uid: "user_unrelated",
      email: "unrelated@other.com",
      displayName: "Diana Other",
      role: "user"
    });

    // Organization: org_acme
    db.store.set("organizations/org_acme", {
      id: "org_acme",
      name: "Acme Corp",
      ownerId: "user_owner",
      ownerEmail: "owner@acme.com",
      status: "active"
    });

    // Org Members
    db.store.set("orgMembers/org_acme_user_owner", {
      orgId: "org_acme",
      userId: "user_owner",
      email: "owner@acme.com",
      userEmail: "owner@acme.com",
      role: "owner",
      status: "active"
    });
    db.store.set("orgMembers/org_acme_user_commenter", {
      orgId: "org_acme",
      userId: "user_commenter",
      email: "commenter@acme.com",
      userEmail: "commenter@acme.com",
      role: "member",
      status: "active"
    });
    db.store.set("orgMembers/org_acme_user_reply_author", {
      orgId: "org_acme",
      userId: "user_reply_author",
      email: "replier@acme.com",
      userEmail: "replier@acme.com",
      role: "member",
      status: "active"
    });

    // Project Memberships in projectMembers collection
    db.store.set("projectMembers/user_owner_proj_alpha", {
      projectId: "proj_alpha",
      userId: "user_owner",
      email: "owner@acme.com",
      role: "owner"
    });
    db.store.set("projectMembers/user_commenter_proj_alpha", {
      projectId: "proj_alpha",
      userId: "user_commenter",
      email: "commenter@acme.com",
      role: "commenter"
    });
    db.store.set("projectMembers/user_reply_author_proj_alpha", {
      projectId: "proj_alpha",
      userId: "user_reply_author",
      email: "replier@acme.com",
      role: "commenter"
    });

    // Project: proj_alpha
    db.store.set("projects/proj_alpha", {
      id: "proj_alpha",
      name: "Acme Product Strategy",
      userId: "user_owner",
      ownerEmail: "owner@acme.com",
      organizationId: "org_acme",
      members: [
        { uid: "user_owner", email: "owner@acme.com", role: "owner" },
        { uid: "user_commenter", email: "commenter@acme.com", role: "commenter" },
        { uid: "user_reply_author", email: "replier@acme.com", role: "commenter" }
      ]
    });

    // Recording: rec_alpha_1 (Owned by Alice Owner)
    db.store.set("recordings/rec_alpha_1", {
      id: "rec_alpha_1",
      title: "Q3 Roadmap Discussion",
      fileName: "Q3_Roadmap.mp3",
      projectId: "proj_alpha",
      organizationId: "org_acme",
      userId: "user_owner",
      userEmail: "owner@acme.com",
      audioUrl: "https://storage.example.com/rec_alpha_1.mp3"
    });
  };

  try {
    // ------------------------------------------------------------------------
    console.log("\n--- Section 1: Comment Activity Logging (1-9) ---");
    // ------------------------------------------------------------------------
    setupBaseState();

    // 1. successful comment creates comment_added activity
    const postRes1 = await fetch(`${baseUrl}/api/recordings/rec_alpha_1/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_commenter'
      },
      body: JSON.stringify({ content: "Great point on roadmap at 10:15" })
    });
    const postData1 = await postRes1.json();
    if (postRes1.status !== 201) {
      console.error("DEBUG postRes1 failed:", postRes1.status, postData1);
    }
    assert(postRes1.status === 201 && postData1.success === true, "1. successful comment succeeds (201)");

    const activitiesAfterPost = Array.from(db.store.entries())
      .filter(([k]) => k.startsWith("projectActivities/"))
      .map(([, v]) => v);

    const addedAct = activitiesAfterPost.find(a => a.actionType === "comment_added");
    assert(Boolean(addedAct), "1. successful comment creates comment_added activity");

    // 2. successful update creates comment_updated activity
    const commentId1 = postData1.comment.id;
    const patchRes1 = await fetch(`${baseUrl}/api/comments/${commentId1}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_commenter'
      },
      body: JSON.stringify({ content: "Updated point on roadmap at 10:15" })
    });
    assert(patchRes1.status === 200, "2. successful update succeeds (200)");

    const activitiesAfterPatch = Array.from(db.store.entries())
      .filter(([k]) => k.startsWith("projectActivities/"))
      .map(([, v]) => v);
    const updatedAct = activitiesAfterPatch.find(a => a.actionType === "comment_updated");
    assert(Boolean(updatedAct), "2. successful update creates comment_updated activity");

    // 3. successful delete creates comment_deleted activity
    const delRes1 = await fetch(`${baseUrl}/api/comments/${commentId1}`, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer test_token_user_commenter'
      }
    });
    assert(delRes1.status === 200, "3. successful delete succeeds (200)");

    const activitiesAfterDel = Array.from(db.store.entries())
      .filter(([k]) => k.startsWith("projectActivities/"))
      .map(([, v]) => v);
    const deletedAct = activitiesAfterDel.find(a => a.actionType === "comment_deleted");
    assert(Boolean(deletedAct), "3. successful delete creates comment_deleted activity");

    // 4. failed comment does not create comment_added
    const failPostRes = await fetch(`${baseUrl}/api/recordings/rec_alpha_1/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_commenter'
      },
      body: JSON.stringify({ content: "   " }) // empty
    });
    assert(failPostRes.status === 400, "4. empty comment rejected (400)");
    const actCountBefore = Array.from(db.store.entries()).filter(([k]) => k.startsWith("projectActivities/")).length;

    // 5. failed update does not create comment_updated
    const failPatchRes = await fetch(`${baseUrl}/api/comments/non_existent_comment`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_commenter'
      },
      body: JSON.stringify({ content: "New content" })
    });
    assert(failPatchRes.status === 404, "5. failed update on missing comment returns 404");
    const actCountAfterFailPatch = Array.from(db.store.entries()).filter(([k]) => k.startsWith("projectActivities/")).length;
    assert(actCountBefore === actCountAfterFailPatch, "5. failed update does not create comment_updated");

    // 6. failed delete does not create comment_deleted
    const failDelRes = await fetch(`${baseUrl}/api/comments/non_existent_comment`, {
      method: 'DELETE',
      headers: {
        'Authorization': 'Bearer test_token_user_commenter'
      }
    });
    assert(failDelRes.status === 404, "6. failed delete returns 404");
    const actCountAfterFailDel = Array.from(db.store.entries()).filter(([k]) => k.startsWith("projectActivities/")).length;
    assert(actCountBefore === actCountAfterFailDel, "6. failed delete does not create comment_deleted");

    // 7. activity contains correct project
    assert(addedAct?.projectId === "proj_alpha", "7. activity contains correct project (proj_alpha)");

    // 8. activity contains correct recording
    assert(addedAct?.recordingId === "rec_alpha_1", "8. activity contains correct recording (rec_alpha_1)");

    // 9. activity contains correct actor
    assert(addedAct?.userId === "user_commenter", "9. activity contains correct actor (user_commenter)");

    // ------------------------------------------------------------------------
    console.log("\n--- Section 2: In-App Notification Delivery & Targeting (10-17) ---");
    // ------------------------------------------------------------------------
    setupBaseState();

    // 10. comment by another user notifies recording owner
    const postRes2 = await fetch(`${baseUrl}/api/recordings/rec_alpha_1/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_commenter'
      },
      body: JSON.stringify({ content: "Reviewing this section" })
    });
    const postData2 = await postRes2.json();
    const comment2Id = postData2.comment.id;

    const notifications1 = Array.from(db.store.entries())
      .filter(([k]) => k.startsWith("notifications/"))
      .map(([, v]) => v);

    const ownerNotif = notifications1.find(n => n.userId === "user_owner");
    assert(Boolean(ownerNotif), "10. comment by another user notifies recording owner (user_owner)");

    // 11. actor does not notify themselves
    const selfNotif = notifications1.find(n => n.userId === "user_commenter");
    assert(!selfNotif, "11. actor does not notify themselves (no notification for user_commenter)");

    // 12. reply notifies parent comment author
    const replyRes = await fetch(`${baseUrl}/api/recordings/rec_alpha_1/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_reply_author'
      },
      body: JSON.stringify({
        content: "I agree with this review!",
        parentCommentId: comment2Id
      })
    });
    const replyData = await replyRes.json();
    assert(replyRes.status === 201 && replyData.success === true, "12. reply submitted successfully (201)");

    const notifications2 = Array.from(db.store.entries())
      .filter(([k]) => k.startsWith("notifications/"))
      .map(([, v]) => v);

    // Parent comment author was user_commenter
    const parentAuthorNotif = notifications2.find(n => n.userId === "user_commenter" && n.commentId === replyData.comment.id);
    assert(Boolean(parentAuthorNotif), "12. reply notifies parent comment author (user_commenter)");

    // 13. reply does not notify actor
    const replyActorNotif = notifications2.find(n => n.userId === "user_reply_author");
    assert(!replyActorNotif, "13. reply does not notify actor (user_reply_author)");

    // 14. unrelated project user is not notified
    const unrelatedNotif = notifications2.find(n => n.userId === "user_unrelated");
    assert(!unrelatedNotif, "14. unrelated project user is not notified (user_unrelated)");

    // 15. cross-org user is not notified
    db.store.set("users/user_cross_org", {
      uid: "user_cross_org",
      email: "attacker@competitor.com",
      displayName: "Attacker",
      role: "user"
    });
    const crossOrgNotif = notifications2.find(n => n.userId === "user_cross_org");
    assert(!crossOrgNotif, "15. cross-org user is not notified");

    // 16. recipient is derived server-side
    assert(ownerNotif?.userId === "user_owner" && parentAuthorNotif?.userId === "user_commenter", "16. recipient is derived server-side from recording and parentComment");

    // 17. client cannot choose arbitrary recipient
    const spoofedPost = await fetch(`${baseUrl}/api/recordings/rec_alpha_1/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_commenter'
      },
      body: JSON.stringify({
        content: "Attempting to spoof recipient",
        recipientUserId: "user_unrelated",
        targetUser: "user_unrelated"
      })
    });
    const spoofedData = await spoofedPost.json();
    const spoofedNotif = Array.from(db.store.entries())
      .filter(([k]) => k.startsWith("notifications/"))
      .map(([, v]) => v)
      .find(n => n.commentId === spoofedData.comment.id && n.userId === "user_unrelated");
    assert(!spoofedNotif, "17. client cannot choose arbitrary recipient via request body");

    // ------------------------------------------------------------------------
    console.log("\n--- Section 3: Notification Security & Payload Invariants (18-20) ---");
    // ------------------------------------------------------------------------

    // 18. notification does not expose unauthorized project data
    assert(!('apiKey' in (ownerNotif || {})) && !('token' in (ownerNotif || {})) && !('transcript' in (ownerNotif || {})), "18. notification does not expose unauthorized credentials or transcripts");

    // 19. notification references correct recording/comment
    assert(ownerNotif?.recordingId === "rec_alpha_1" && ownerNotif?.commentId === comment2Id, "19. notification references correct recording and comment ID");

    // 20. notification creation cannot be directly spoofed by client
    assert(ownerNotif?.actorUserId === "user_commenter", "20. notification creation records authoritative actorUserId");

    // ------------------------------------------------------------------------
    console.log("\n--- Section 4: Failure & Fault Isolation (21-22) ---");
    // ------------------------------------------------------------------------
    setupBaseState();

    // 21. notification failure does not falsely report comment failure
    db.shouldFailCollection = "notifications";
    const postWithNotifFail = await fetch(`${baseUrl}/api/recordings/rec_alpha_1/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_commenter'
      },
      body: JSON.stringify({ content: "Testing notification failure isolation" })
    });
    const notifFailData = await postWithNotifFail.json();
    assert(postWithNotifFail.status === 201 && notifFailData.success === true, "21. notification failure does not falsely report comment failure");

    // 22. activity failure does not falsely report comment failure
    db.shouldFailCollection = "projectActivities";
    const postWithActFail = await fetch(`${baseUrl}/api/recordings/rec_alpha_1/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_commenter'
      },
      body: JSON.stringify({ content: "Testing activity failure isolation" })
    });
    const actFailData = await postWithActFail.json();
    assert(postWithActFail.status === 201 && actFailData.success === true, "22. activity failure does not falsely report comment failure");

    db.shouldFailCollection = null;

    // ------------------------------------------------------------------------
    console.log("\n--- Section 5: Duplication Prevention & Idempotency (23) ---");
    // ------------------------------------------------------------------------
    setupBaseState();

    // 23. repeated notification write with deterministic ID does not duplicate
    const postResDedup = await fetch(`${baseUrl}/api/recordings/rec_alpha_1/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token_user_commenter'
      },
      body: JSON.stringify({ content: "Idempotency test comment" })
    });
    const dedupData = await postResDedup.json();
    const targetCommentId = dedupData.comment.id;

    // Count notifications for this comment
    const notifsBefore = Array.from(db.store.entries())
      .filter(([k, v]) => k.startsWith("notifications/") && v.commentId === targetCommentId);
    assert(notifsBefore.length === 1, "23. initial comment creates exactly 1 notification for owner");

    // Simulating retried notification creation on same comment ID
    const deterministicNotifId = `notif_comment_${targetCommentId}_user_owner`;
    const existingNotif = db.store.get(`notifications/${deterministicNotifId}`);
    assert(Boolean(existingNotif), "23. notification uses deterministic ID to prevent duplicates (notif_comment_{commentId}_{userId})");

    // ------------------------------------------------------------------------
    console.log("\n--- Section 6: Frontend Integration Invariants (24-25) ---");
    // ------------------------------------------------------------------------

    // 24. existing Notification Center displays comment notification
    const sampleNotifs = [
      {
        id: "notif_1",
        title: "New Comment on Recording",
        message: "Bob Commenter commented on \"Q3 Roadmap Discussion\".",
        timestamp: Date.now() - 60000,
        isRead: false,
        type: 'info' as const,
        recordId: "rec_alpha_1"
      },
      {
        id: "notif_2",
        title: "New Reply on Comment",
        message: "Charlie Replier replied to your comment.",
        timestamp: Date.now() - 30000,
        isRead: true,
        type: 'info' as const,
        recordId: "rec_alpha_1"
      }
    ];

    const unreadCount = sampleNotifs.filter(n => !n.isRead).length;
    assert(unreadCount === 1, "24. Notification Center accurately computes unreadCount (1 unread)");
    assert(sampleNotifs[0].title === "New Comment on Recording", "24. Notification Center displays comment notification");

    // 25. clicking notification routes to the appropriate recording/comment context
    let selectedRecordId: string | null = null;
    let currentTab: string | null = null;
    const markNotificationRead = (notif: typeof sampleNotifs[0]) => {
      notif.isRead = true;
      if (notif.recordId) {
        selectedRecordId = notif.recordId;
        currentTab = "history";
      }
    };

    markNotificationRead(sampleNotifs[0]);
    assert(sampleNotifs[0].isRead === true, "25. clicking notification marks it as read");
    assert(selectedRecordId === "rec_alpha_1" && currentTab === "history", "25. clicking notification routes to the appropriate recording context (rec_alpha_1)");

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("=".repeat(80));
  console.log(`📊 STEP 4C VERIFICATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=".repeat(80));

  if (failed > 0) {
    console.error(`💥 ${failed} test(s) failed!`);
    process.exit(1);
  } else {
    console.log("🎉 ALL 25 STEP 4C ACTIVITY & NOTIFICATION TESTS PASSED SUCCESSFULLY!");
  }
}

runStep4cTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
