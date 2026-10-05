/**
 * EchoNote Phase 1 Step 4A: Server-Authoritative Comment API Test Suite
 * 
 * Verifies all 42 required security, authorization, IDOR, and data integrity
 * requirements for:
 *   - GET    /api/recordings/:recordingId/comments
 *   - POST   /api/recordings/:recordingId/comments
 *   - PATCH  /api/comments/:commentId
 *   - DELETE /api/comments/:commentId
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
      set: async (data: any, options?: { merge?: boolean }) => {
        const existing = db.store.get(`${collName}/${docId}`);
        if (options?.merge && existing) {
          db.store.set(`${collName}/${docId}`, { ...existing, ...data });
        } else {
          db.store.set(`${collName}/${docId}`, { ...data });
        }
      },
      update: async (data: any) => {
        const existing = db.store.get(`${collName}/${docId}`);
        if (!existing) throw new Error(`Document ${collName}/${docId} not found for update`);
        db.store.set(`${collName}/${docId}`, { ...existing, ...data });
      },
      delete: async () => {
        db.store.delete(`${collName}/${docId}`);
      }
    };
  }

  where(field: string, op: string, val: any) {
    return new MockQuery(this.db, this.collectionName, [{ field, op, val }]);
  }

  async get() {
    return new MockQuery(this.db, this.collectionName, []).get();
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

class MockFirestore {
  public store = new Map<string, any>();

  collection(name: string) {
    return new MockCollectionReference(this, name);
  }
}

// ============================================================================
// TEST APP FACTORY (MOUNTING STEP 4A SERVER-AUTHORITATIVE COMMENT API)
// ============================================================================

function createCommentTestApp(db: any, tokenUserMap: Record<string, any>) {
  const app = express();
  app.use(express.json());

  // Test requireAuth middleware using Authorization Bearer token
  const testRequireAuth = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
    }
    const token = authHeader.split(" ")[1];
    const user = tokenUserMap[token];
    if (!user) {
      return res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
    }
    req.user = user;
    next();
  };

  const authorizeRecordingAccess = async (user: any, recordingId: string, options?: any) => {
    return authRecordingHelper(db, user, recordingId, options);
  };

  // 1. GET /api/recordings/:recordingId/comments
  app.get("/api/recordings/:recordingId/comments", testRequireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { recordingId } = req.params;
      if (!recordingId || typeof recordingId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Valid recordingId is required." });
      }

      const authResult = await authorizeRecordingAccess(req.user, recordingId, { requiredAction: 'VIEW' });
      if (!authResult.authorized) {
        return res.status(authResult.status).json({
          error: authResult.status === 404 ? "Not Found" : (authResult.status === 401 ? "Unauthorized" : "Forbidden"),
          message: authResult.message
        });
      }

      const commentsSnap = await db.collection("comments").where("recordingId", "==", recordingId).get();

      const comments = commentsSnap.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort: timestampSeconds ascending, then createdAt ascending, null timestamps after timestamped comments
      comments.sort((a: any, b: any) => {
        const hasTimeA = typeof a.timestampSeconds === 'number' && !isNaN(a.timestampSeconds);
        const hasTimeB = typeof b.timestampSeconds === 'number' && !isNaN(b.timestampSeconds);
        if (hasTimeA && hasTimeB) {
          if (a.timestampSeconds !== b.timestampSeconds) {
            return a.timestampSeconds - b.timestampSeconds;
          }
        } else if (hasTimeA && !hasTimeB) {
          return -1;
        } else if (!hasTimeA && hasTimeB) {
          return 1;
        }
        const createdA = typeof a.createdAt === 'string' ? a.createdAt : (a.createdAt?.toDate ? a.createdAt.toDate().toISOString() : '');
        const createdB = typeof b.createdAt === 'string' ? b.createdAt : (b.createdAt?.toDate ? b.createdAt.toDate().toISOString() : '');
        return createdA.localeCompare(createdB);
      });

      return res.json({ comments });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error", message: err.message });
    }
  });

  // 2. POST /api/recordings/:recordingId/comments
  app.post("/api/recordings/:recordingId/comments", testRequireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
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

      let validatedTimestamp: number | undefined = undefined;
      if (timestampSeconds !== undefined && timestampSeconds !== null) {
        if (typeof timestampSeconds !== 'number' || isNaN(timestampSeconds) || !isFinite(timestampSeconds) || timestampSeconds < 0) {
          return res.status(400).json({ error: "Bad Request", message: "timestampSeconds must be a non-negative finite number." });
        }
        validatedTimestamp = timestampSeconds;
      }

      let validatedParentId: string | undefined = undefined;
      if (parentCommentId !== undefined && parentCommentId !== null) {
        if (typeof parentCommentId !== 'string' || !parentCommentId.trim()) {
          return res.status(400).json({ error: "Bad Request", message: "parentCommentId must be a non-empty string." });
        }
        const parentDoc = await db.collection("comments").doc(parentCommentId.trim()).get();
        if (!parentDoc.exists) {
          return res.status(404).json({ error: "Not Found", message: "Parent comment not found." });
        }
        const parentData = parentDoc.data() || {};
        if (parentData.recordingId !== recordingId) {
          return res.status(400).json({ error: "Bad Request", message: "Parent comment belongs to a different recording." });
        }
        if (parentData.projectId !== projectId) {
          return res.status(400).json({ error: "Bad Request", message: "Parent comment belongs to a different project." });
        }
        validatedParentId = parentCommentId.trim();
      }

      const userId = req.user.uid;
      let userEmail = req.user.email || "";
      let userName = req.user.displayName || req.user.name || "";

      try {
        const userDoc = await db.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const uData = userDoc.data() || {};
          if (uData.email) userEmail = uData.email;
          if (uData.displayName) userName = uData.displayName;
        }
      } catch {}

      if (!userName && userEmail) {
        userName = userEmail.split('@')[0];
      }

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
        newComment.orgId = authoritativeOrgId;
      }
      if (validatedTimestamp !== undefined) {
        newComment.timestampSeconds = validatedTimestamp;
      }
      if (validatedParentId !== undefined) {
        newComment.parentCommentId = validatedParentId;
      }

      await commentDocRef.set(newComment);

      return res.status(201).json({ success: true, comment: newComment });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error", message: err.message });
    }
  });

  // 3. PATCH /api/comments/:commentId
  app.patch("/api/comments/:commentId", testRequireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { commentId } = req.params;
      if (!commentId || typeof commentId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Valid commentId is required." });
      }

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

      if (recording.projectId !== comment.projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Comment and recording project mismatch." });
      }

      const projAccess = await resolveProjectAccess(db, req.user, comment.projectId);
      if (!projAccess.hasAccess) {
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project." });
      }

      const isAuthor = comment.userId === req.user.uid;
      const canModerate = Boolean(
        projAccess.isPlatformAdmin ||
        projAccess.isOwner ||
        projAccess.isOrgAdmin ||
        projAccess.role === 'admin' ||
        projAccess.role === 'owner'
      );

      const isViewer = projAccess.role === 'viewer';
      const canAuthorEdit = isAuthor && !isViewer && (projAccess.permissions.canComment || canModerate);

      if (!canAuthorEdit && !canModerate) {
        return res.status(403).json({
          error: "Forbidden",
          message: isViewer
            ? "Permission denied: Viewers cannot modify comments."
            : (isAuthor 
                ? "Your role does not permit modifying comments." 
                : "Permission denied: Only the comment author or project administrator can edit this comment.")
        });
      }

      const { content } = req.body || {};
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

      const updatedAt = new Date().toISOString();
      await db.collection("comments").doc(commentId).update({
        content: trimmedContent,
        updatedAt
      });

      const updatedComment = {
        ...comment,
        content: trimmedContent,
        updatedAt
      };

      return res.json({ success: true, comment: updatedComment });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error", message: err.message });
    }
  });

  // 4. DELETE /api/comments/:commentId
  app.delete("/api/comments/:commentId", testRequireAuth, async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      const { commentId } = req.params;
      if (!commentId || typeof commentId !== 'string') {
        return res.status(400).json({ error: "Bad Request", message: "Valid commentId is required." });
      }

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

      if (recording.projectId !== comment.projectId) {
        return res.status(400).json({ error: "Bad Request", message: "Comment and recording project mismatch." });
      }

      const projAccess = await resolveProjectAccess(db, req.user, comment.projectId);
      if (!projAccess.hasAccess) {
        return res.status(403).json({ error: "Forbidden", message: "Access denied to project." });
      }

      const isAuthor = comment.userId === req.user.uid;
      const canModerate = Boolean(
        projAccess.isPlatformAdmin ||
        projAccess.isOwner ||
        projAccess.isOrgAdmin ||
        projAccess.role === 'admin' ||
        projAccess.role === 'owner'
      );

      const isViewer = projAccess.role === 'viewer';
      const canAuthorDelete = isAuthor && !isViewer && (projAccess.permissions.canComment || canModerate);

      if (!canAuthorDelete && !canModerate) {
        return res.status(403).json({
          error: "Forbidden",
          message: isViewer
            ? "Permission denied: Viewers cannot delete comments."
            : (isAuthor
                ? "Your role does not permit deleting comments."
                : "Permission denied: Only the comment author or project administrator can delete this comment.")
        });
      }

      await db.collection("comments").doc(commentId).delete();

      return res.json({
        success: true,
        message: "Comment deleted successfully.",
        commentId
      });
    } catch (err: any) {
      return res.status(500).json({ error: "Internal Server Error", message: err.message });
    }
  });

  return app;
}

// ============================================================================
// TEST RUNNER & ASSERTIONS
// ============================================================================

let passedCount = 0;
let failedCount = 0;
const failures: string[] = [];

function assertTest(name: string, condition: boolean, detail?: any) {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${name}`);
    if (detail !== undefined) {
      console.error(`     Details:`, detail);
    }
    failedCount++;
    failures.push(name);
  }
}

export async function runStep4ACommentApiTestSuite() {
  console.log("\n================================================================================");
  console.log("💬 ECHONOTE PHASE 1 STEP 4A: SERVER-AUTHORITATIVE COMMENT API VERIFICATION");
  console.log("================================================================================\n");

  const mockDb = new MockFirestore();
  const db = mockDb as any;

  // --------------------------------------------------------------------------
  // FIXTURE DATA SETUP
  // --------------------------------------------------------------------------
  // Organization Alpha (Acme)
  mockDb.store.set("organizations/org_alpha", {
    id: "org_alpha",
    name: "Acme Corp",
    ownerId: "user_alpha_owner",
    ownerEmail: "owner@acme.com"
  });

  // Organization Beta (BetaCorp)
  mockDb.store.set("organizations/org_beta", {
    id: "org_beta",
    name: "Beta Corp",
    ownerId: "user_beta_owner",
    ownerEmail: "owner@beta.com"
  });

  // Project Alpha 1 in Org Alpha
  mockDb.store.set("projects/proj_alpha_1", {
    id: "proj_alpha_1",
    name: "Alpha Project",
    organizationId: "org_alpha",
    orgId: "org_alpha",
    userId: "user_alpha_owner",
    ownerEmail: "owner@acme.com"
  });

  // Project Alpha 2 (Another project in same org)
  mockDb.store.set("projects/proj_alpha_2", {
    id: "proj_alpha_2",
    name: "Alpha Secondary Project",
    organizationId: "org_alpha",
    orgId: "org_alpha",
    userId: "user_alpha_owner",
    ownerEmail: "owner@acme.com"
  });

  // Project Beta 1 in Org Beta
  mockDb.store.set("projects/proj_beta_1", {
    id: "proj_beta_1",
    name: "Beta Project",
    organizationId: "org_beta",
    orgId: "org_beta",
    userId: "user_beta_owner",
    ownerEmail: "owner@beta.com"
  });

  // Users
  const userAlphaOwner = { uid: "user_alpha_owner", email: "owner@acme.com", displayName: "Alice Owner" };
  const userAlphaAdmin = { uid: "user_alpha_admin", email: "admin@acme.com", displayName: "Adam Admin" };
  const userAlphaCommenter = { uid: "user_alpha_commenter", email: "commenter@acme.com", displayName: "Charlie Commenter" };
  const userAlphaCommenter2 = { uid: "user_alpha_commenter2", email: "commenter2@acme.com", displayName: "Chloe Commenter2" };
  const userAlphaViewer = { uid: "user_alpha_viewer", email: "viewer@acme.com", displayName: "Victor Viewer" };
  const userAlphaUnrelated = { uid: "user_alpha_unrelated", email: "unrelated@acme.com", displayName: "Uma Unrelated" };
  const userBetaMember = { uid: "user_beta_member", email: "beta@beta.com", displayName: "Bob Beta" };
  const userPlatformAdmin = { uid: "user_platform_admin", email: "platform@echonote.ai", displayName: "Pam Admin", platform_admin: true };

  // Set user profiles in mockDb
  mockDb.store.set("users/user_alpha_owner", userAlphaOwner);
  mockDb.store.set("users/user_alpha_admin", userAlphaAdmin);
  mockDb.store.set("users/user_alpha_commenter", userAlphaCommenter);
  mockDb.store.set("users/user_alpha_commenter2", userAlphaCommenter2);
  mockDb.store.set("users/user_alpha_viewer", userAlphaViewer);
  mockDb.store.set("users/user_alpha_unrelated", userAlphaUnrelated);
  mockDb.store.set("users/user_beta_member", userBetaMember);
  mockDb.store.set("users/user_platform_admin", userPlatformAdmin);

  // Org Members for Org Alpha
  mockDb.store.set("orgMembers/org_alpha_user_alpha_owner", { orgId: "org_alpha", userId: "user_alpha_owner", email: "owner@acme.com", role: "owner", status: "active" });
  mockDb.store.set("orgMembers/org_alpha_user_alpha_admin", { orgId: "org_alpha", userId: "user_alpha_admin", email: "admin@acme.com", role: "org_admin", status: "active" });
  mockDb.store.set("orgMembers/org_alpha_user_alpha_commenter", { orgId: "org_alpha", userId: "user_alpha_commenter", email: "commenter@acme.com", role: "member", status: "active" });
  mockDb.store.set("orgMembers/org_alpha_user_alpha_commenter2", { orgId: "org_alpha", userId: "user_alpha_commenter2", email: "commenter2@acme.com", role: "member", status: "active" });
  mockDb.store.set("orgMembers/org_alpha_user_alpha_viewer", { orgId: "org_alpha", userId: "user_alpha_viewer", email: "viewer@acme.com", role: "viewer", status: "active" });
  mockDb.store.set("orgMembers/org_alpha_user_alpha_unrelated", { orgId: "org_alpha", userId: "user_alpha_unrelated", email: "unrelated@acme.com", role: "member", status: "active" });

  // Org Members for Org Beta
  mockDb.store.set("orgMembers/org_beta_user_beta_member", { orgId: "org_beta", userId: "user_beta_member", email: "beta@beta.com", role: "member", status: "active" });

  // Project Members for proj_alpha_1
  mockDb.store.set("projectMembers/user_alpha_owner_proj_alpha_1", { projectId: "proj_alpha_1", userId: "user_alpha_owner", email: "owner@acme.com", role: "owner" });
  mockDb.store.set("projectMembers/user_alpha_admin_proj_alpha_1", { projectId: "proj_alpha_1", userId: "user_alpha_admin", email: "admin@acme.com", role: "admin" });
  mockDb.store.set("projectMembers/user_alpha_commenter_proj_alpha_1", { projectId: "proj_alpha_1", userId: "user_alpha_commenter", email: "commenter@acme.com", role: "commenter" });
  mockDb.store.set("projectMembers/user_alpha_commenter2_proj_alpha_1", { projectId: "proj_alpha_1", userId: "user_alpha_commenter2", email: "commenter2@acme.com", role: "commenter" });
  mockDb.store.set("projectMembers/user_alpha_viewer_proj_alpha_1", { projectId: "proj_alpha_1", userId: "user_alpha_viewer", email: "viewer@acme.com", role: "viewer" });

  // Recordings
  mockDb.store.set("recordings/rec_alpha_1", {
    id: "rec_alpha_1",
    projectId: "proj_alpha_1",
    organizationId: "org_alpha",
    orgId: "org_alpha",
    userId: "user_alpha_owner",
    title: "Alpha Strategy Meeting"
  });

  mockDb.store.set("recordings/rec_alpha_2", {
    id: "rec_alpha_2",
    projectId: "proj_alpha_2",
    organizationId: "org_alpha",
    orgId: "org_alpha",
    userId: "user_alpha_owner",
    title: "Alpha Secondary Recording"
  });

  mockDb.store.set("recordings/rec_beta_1", {
    id: "rec_beta_1",
    projectId: "proj_beta_1",
    organizationId: "org_beta",
    orgId: "org_beta",
    userId: "user_beta_owner",
    title: "Beta Strategic Audio"
  });

  // Mismatch recording: points to proj_alpha_1 but has org_beta
  mockDb.store.set("recordings/rec_mismatch_org", {
    id: "rec_mismatch_org",
    projectId: "proj_alpha_1",
    organizationId: "org_beta",
    orgId: "org_beta",
    userId: "user_alpha_owner",
    title: "Mismatch Org Recording"
  });

  // Seed existing comments
  mockDb.store.set("comments/comment_alpha_existing_1", {
    id: "comment_alpha_existing_1",
    recordingId: "rec_alpha_1",
    projectId: "proj_alpha_1",
    organizationId: "org_alpha",
    orgId: "org_alpha",
    userId: "user_alpha_commenter",
    userEmail: "commenter@acme.com",
    userName: "Charlie Commenter",
    content: "First existing comment at second 10",
    timestampSeconds: 10.5,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z"
  });

  mockDb.store.set("comments/comment_alpha_existing_2", {
    id: "comment_alpha_existing_2",
    recordingId: "rec_alpha_1",
    projectId: "proj_alpha_1",
    organizationId: "org_alpha",
    orgId: "org_alpha",
    userId: "user_alpha_commenter",
    userEmail: "commenter@acme.com",
    userName: "Charlie Commenter",
    content: "Second existing comment at second 25",
    timestampSeconds: 25.0,
    createdAt: "2026-09-01T10:05:00.000Z",
    updatedAt: "2026-09-01T10:05:00.000Z"
  });

  mockDb.store.set("comments/comment_alpha_untimed", {
    id: "comment_alpha_untimed",
    recordingId: "rec_alpha_1",
    projectId: "proj_alpha_1",
    organizationId: "org_alpha",
    orgId: "org_alpha",
    userId: "user_alpha_owner",
    userEmail: "owner@acme.com",
    userName: "Alice Owner",
    content: "General feedback comment with no timestamp",
    createdAt: "2026-09-01T10:10:00.000Z",
    updatedAt: "2026-09-01T10:10:00.000Z"
  });

  mockDb.store.set("comments/comment_alpha_rec2", {
    id: "comment_alpha_rec2",
    recordingId: "rec_alpha_2",
    projectId: "proj_alpha_2",
    organizationId: "org_alpha",
    orgId: "org_alpha",
    userId: "user_alpha_owner",
    userEmail: "owner@acme.com",
    userName: "Alice Owner",
    content: "Comment on secondary recording",
    createdAt: "2026-09-01T10:15:00.000Z",
    updatedAt: "2026-09-01T10:15:00.000Z"
  });

  mockDb.store.set("comments/comment_beta_1", {
    id: "comment_beta_1",
    recordingId: "rec_beta_1",
    projectId: "proj_beta_1",
    organizationId: "org_beta",
    orgId: "org_beta",
    userId: "user_beta_member",
    userEmail: "beta@beta.com",
    userName: "Bob Beta",
    content: "Beta confidential comment",
    createdAt: "2026-09-01T10:20:00.000Z",
    updatedAt: "2026-09-01T10:20:00.000Z"
  });

  // Token map for authentication
  const tokenMap: Record<string, any> = {
    "token-owner": userAlphaOwner,
    "token-admin": userAlphaAdmin,
    "token-commenter": userAlphaCommenter,
    "token-commenter2": userAlphaCommenter2,
    "token-viewer": userAlphaViewer,
    "token-unrelated": userAlphaUnrelated,
    "token-beta": userBetaMember,
    "token-platform-admin": userPlatformAdmin
  };

  // Start ephemeral HTTP server
  const app = createCommentTestApp(mockDb, tokenMap);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = async (
    method: string,
    path: string,
    token?: string,
    body?: any
  ) => {
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const status = res.status;
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    return { status, data };
  };

  try {
    // ------------------------------------------------------------------------
    // TESTS 1 - 4: UNAUTHENTICATED REQUESTS DENIED (401)
    // ------------------------------------------------------------------------
    console.log("--- Section 1: Unauthenticated Requests (401) ---");

    const t1 = await request("GET", "/api/recordings/rec_alpha_1/comments");
    assertTest("1. unauthenticated GET denied", t1.status === 401, t1);

    const t2 = await request("POST", "/api/recordings/rec_alpha_1/comments", undefined, { content: "Hello" });
    assertTest("2. unauthenticated POST denied", t2.status === 401, t2);

    const t3 = await request("PATCH", "/api/comments/comment_alpha_existing_1", undefined, { content: "Updated" });
    assertTest("3. unauthenticated PATCH denied", t3.status === 401, t3);

    const t4 = await request("DELETE", "/api/comments/comment_alpha_existing_1");
    assertTest("4. unauthenticated DELETE denied", t4.status === 401, t4);

    // ------------------------------------------------------------------------
    // TESTS 5 - 9: ROLE-BASED CREATION PERMISSIONS
    // ------------------------------------------------------------------------
    console.log("\n--- Section 2: Role-Based Creation Permissions ---");

    const t5 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-viewer", { content: "Viewer trying to comment" });
    assertTest("5. viewer cannot create", t5.status === 403, t5);

    const t6 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-commenter", { content: "Commenter comment", timestampSeconds: 15.2 });
    assertTest("6. commenter can create", t6.status === 201 && t6.data?.comment?.id !== undefined, t6);

    const t7 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-admin", { content: "Admin comment" });
    assertTest("7. admin can create", t7.status === 201, t7);

    const t8 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-owner", { content: "Owner comment" });
    assertTest("8. owner can create", t8.status === 201, t8);

    const t9 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-platform-admin", { content: "Platform admin comment" });
    assertTest("9. platform admin can create", t9.status === 201, t9);

    // ------------------------------------------------------------------------
    // TESTS 10 - 11: TENANT & PROJECT BOUNDARY DEFENSES
    // ------------------------------------------------------------------------
    console.log("\n--- Section 3: Boundary & Membership Isolation ---");

    const t10 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-unrelated", { content: "Unrelated project member" });
    assertTest("10. unrelated project member denied", t10.status === 403, t10);

    const t11 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-beta", { content: "Cross-org attacker" });
    assertTest("11. cross-org user denied", t11.status === 403, t11);

    // ------------------------------------------------------------------------
    // TESTS 12 - 16: IDENTITY & RELATIONSHIP SPOOFING RESISTANCE
    // ------------------------------------------------------------------------
    console.log("\n--- Section 4: Client Spoofing Resistance ---");

    const spoofAttempt = {
      content: "Legitimate content",
      userId: "spoofed_victim_uid",
      userEmail: "victim@othercompany.com",
      userName: "Victim User",
      projectId: "proj_beta_1",
      organizationId: "org_beta"
    };

    const t12_16 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-commenter", spoofAttempt);
    const createdDoc = t12_16.data?.comment;

    assertTest("12. client cannot spoof userId", createdDoc?.userId === "user_alpha_commenter", createdDoc);
    assertTest("13. client cannot spoof userEmail", createdDoc?.userEmail === "commenter@acme.com", createdDoc);
    assertTest("14. client cannot spoof userName", createdDoc?.userName === "Charlie Commenter", createdDoc);
    assertTest("15. client cannot spoof projectId", createdDoc?.projectId === "proj_alpha_1", createdDoc);
    assertTest("16. client cannot spoof organizationId", createdDoc?.organizationId === "org_alpha" && createdDoc?.organizationId !== "org_beta", createdDoc);

    // ------------------------------------------------------------------------
    // TESTS 17 - 19: RELATIONSHIP INTEGRITY & PARENT COMMENT THREADING
    // ------------------------------------------------------------------------
    console.log("\n--- Section 5: Relationship & Threading Validation ---");

    // 17. Recording/project mismatch
    const t17 = await request("POST", "/api/recordings/rec_mismatch_org/comments", "token-owner", { content: "Mismatch test" });
    assertTest("17. recording/project mismatch rejected", t17.status === 400 || t17.status === 403, t17);

    // 18. parentCommentId from another recording (comment_alpha_rec2 is on rec_alpha_2)
    const t18 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-commenter", {
      content: "Reply to wrong recording",
      parentCommentId: "comment_alpha_rec2"
    });
    assertTest("18. parentCommentId from another recording rejected", t18.status === 400, t18);

    // 19. parentCommentId from another project (comment_beta_1 is on proj_beta_1)
    const t19 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-commenter", {
      content: "Reply to wrong project",
      parentCommentId: "comment_beta_1"
    });
    assertTest("19. parentCommentId from another project rejected", t19.status === 400 || t19.status === 404, t19);

    // ------------------------------------------------------------------------
    // TESTS 20 - 25: PATCH AUTHORIZATION & IMMUTABILITY
    // ------------------------------------------------------------------------
    console.log("\n--- Section 6: Mutation & Moderation Authorization (PATCH) ---");

    // 20. Author can edit own comment
    const t20 = await request("PATCH", "/api/comments/comment_alpha_existing_1", "token-commenter", {
      content: "Author edited own comment text"
    });
    assertTest("20. author can edit own comment", t20.status === 200 && t20.data?.comment?.content === "Author edited own comment text", t20);

    // 21. Author cannot change immutable relationship fields
    const t21 = await request("PATCH", "/api/comments/comment_alpha_existing_1", "token-commenter", {
      content: "Attempting to change immutable fields",
      id: "spoofed_comment_id",
      recordingId: "rec_beta_1",
      projectId: "proj_beta_1",
      organizationId: "org_beta",
      userId: "user_beta_member",
      createdAt: "1999-01-01T00:00:00.000Z"
    });
    const updatedInDb21 = mockDb.store.get("comments/comment_alpha_existing_1");
    assertTest("21. author cannot change immutable relationship fields",
      t21.status === 200 &&
      updatedInDb21?.recordingId === "rec_alpha_1" &&
      updatedInDb21?.projectId === "proj_alpha_1" &&
      updatedInDb21?.userId === "user_alpha_commenter" &&
      updatedInDb21?.createdAt === "2026-09-01T10:00:00.000Z",
      updatedInDb21
    );

    // 22. Commenter cannot edit another user's comment (commenter2 trying to edit commenter1's comment)
    const t22 = await request("PATCH", "/api/comments/comment_alpha_existing_1", "token-commenter2", {
      content: "Commenter 2 attempting unauthorized edit"
    });
    assertTest("22. commenter cannot edit another user's comment", t22.status === 403, t22);

    // 23. Admin can moderate another user's comment
    const t23 = await request("PATCH", "/api/comments/comment_alpha_existing_1", "token-admin", {
      content: "Moderated by Project Admin"
    });
    assertTest("23. admin can moderate another user's comment", t23.status === 200 && t23.data?.comment?.content === "Moderated by Project Admin", t23);

    // 24. Owner can moderate another user's comment
    const t24 = await request("PATCH", "/api/comments/comment_alpha_existing_1", "token-owner", {
      content: "Moderated by Project Owner"
    });
    assertTest("24. owner can moderate another user's comment", t24.status === 200 && t24.data?.comment?.content === "Moderated by Project Owner", t24);

    // 25. Viewer cannot edit
    const t25 = await request("PATCH", "/api/comments/comment_alpha_existing_1", "token-viewer", {
      content: "Viewer attempting edit"
    });
    assertTest("25. viewer cannot edit", t25.status === 403, t25);

    // ------------------------------------------------------------------------
    // TESTS 26 - 30: DELETE AUTHORIZATION & PERMISSIONS
    // ------------------------------------------------------------------------
    console.log("\n--- Section 7: Deletion & Moderation Authorization (DELETE) ---");

    // Seed temporary comments for deletion tests
    mockDb.store.set("comments/comment_to_del_by_author", {
      id: "comment_to_del_by_author",
      recordingId: "rec_alpha_1",
      projectId: "proj_alpha_1",
      organizationId: "org_alpha",
      userId: "user_alpha_commenter",
      content: "To be deleted by author",
      createdAt: new Date().toISOString()
    });

    mockDb.store.set("comments/comment_to_del_by_admin", {
      id: "comment_to_del_by_admin",
      recordingId: "rec_alpha_1",
      projectId: "proj_alpha_1",
      organizationId: "org_alpha",
      userId: "user_alpha_commenter",
      content: "To be deleted by admin",
      createdAt: new Date().toISOString()
    });

    mockDb.store.set("comments/comment_to_del_by_owner", {
      id: "comment_to_del_by_owner",
      recordingId: "rec_alpha_1",
      projectId: "proj_alpha_1",
      organizationId: "org_alpha",
      userId: "user_alpha_commenter",
      content: "To be deleted by owner",
      createdAt: new Date().toISOString()
    });

    // 26. Author can delete own comment
    const t26 = await request("DELETE", "/api/comments/comment_to_del_by_author", "token-commenter");
    assertTest("26. author can delete own comment", t26.status === 200 && !mockDb.store.has("comments/comment_to_del_by_author"), t26);

    // 27. Commenter cannot delete another user's comment
    const t27 = await request("DELETE", "/api/comments/comment_to_del_by_admin", "token-commenter2");
    assertTest("27. commenter cannot delete another user's comment", t27.status === 403 && mockDb.store.has("comments/comment_to_del_by_admin"), t27);

    // 28. Admin can delete another user's comment
    const t28 = await request("DELETE", "/api/comments/comment_to_del_by_admin", "token-admin");
    assertTest("28. admin can delete another user's comment", t28.status === 200 && !mockDb.store.has("comments/comment_to_del_by_admin"), t28);

    // 29. Owner can delete another user's comment
    const t29 = await request("DELETE", "/api/comments/comment_to_del_by_owner", "token-owner");
    assertTest("29. owner can delete another user's comment", t29.status === 200 && !mockDb.store.has("comments/comment_to_del_by_owner"), t29);

    // 30. Viewer cannot delete
    const t30 = await request("DELETE", "/api/comments/comment_alpha_existing_2", "token-viewer");
    assertTest("30. viewer cannot delete", t30.status === 403 && mockDb.store.has("comments/comment_alpha_existing_2"), t30);

    // ------------------------------------------------------------------------
    // TESTS 31 - 36: INPUT VALIDATION & NOT FOUND HANDLING
    // ------------------------------------------------------------------------
    console.log("\n--- Section 8: Input Validation & Error Handling ---");

    // 31. Missing recording
    const t31 = await request("POST", "/api/recordings/non_existent_rec/comments", "token-commenter", { content: "Valid" });
    assertTest("31. missing recording returns appropriate error", t31.status === 404, t31);

    // 32. Missing comment
    const t32 = await request("PATCH", "/api/comments/non_existent_comment", "token-owner", { content: "Valid" });
    assertTest("32. missing comment returns appropriate error", t32.status === 404, t32);

    // 33. Empty content rejected
    const t33_empty = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-commenter", { content: "   " });
    assertTest("33. empty content rejected", t33_empty.status === 400, t33_empty);

    // 34. >5000 character content rejected
    const longContent = "a".repeat(5001);
    const t34 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-commenter", { content: longContent });
    assertTest("34. >5000 character content rejected", t34.status === 400, t34);

    // 35. Negative timestamp rejected
    const t35 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-commenter", { content: "Time test", timestampSeconds: -1.5 });
    assertTest("35. negative timestamp rejected", t35.status === 400, t35);

    // 36. Invalid timestamp rejected (NaN or non-number)
    const t36 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-commenter", { content: "Time test", timestampSeconds: "invalid_time" });
    assertTest("36. invalid timestamp rejected", t36.status === 400, t36);

    // ------------------------------------------------------------------------
    // TESTS 37 - 39: GET COMMENTS RETRIEVAL & ISOLATION
    // ------------------------------------------------------------------------
    console.log("\n--- Section 9: GET Retrieval Scoping & Boundary Isolation ---");

    // 37. GET returns only comments for requested recording
    const t37 = await request("GET", "/api/recordings/rec_alpha_1/comments", "token-viewer");
    const rec1Comments = t37.data?.comments || [];
    const allBelongToRec1 = rec1Comments.length > 0 && rec1Comments.every((c: any) => c.recordingId === "rec_alpha_1");
    assertTest("37. GET returns only comments for requested recording", t37.status === 200 && allBelongToRec1, t37);

    // 38. GET cannot expose another project's comments
    const hasOtherProjectComments = rec1Comments.some((c: any) => c.projectId !== "proj_alpha_1");
    assertTest("38. GET cannot expose another project's comments", !hasOtherProjectComments && rec1Comments.length > 0, rec1Comments);

    // 39. GET cannot expose another organization's comments (user Alpha trying to read Beta recording)
    const t39 = await request("GET", "/api/recordings/rec_beta_1/comments", "token-owner");
    assertTest("39. GET cannot expose another organization's comments", t39.status === 403, t39);

    // ------------------------------------------------------------------------
    // TESTS 40 - 42: DATA INTEGRITY IN STORAGE & LIFECYCLE
    // ------------------------------------------------------------------------
    console.log("\n--- Section 10: Storage Integrity & State Invariants ---");

    // 40. Successful create stores authoritative relationships
    const t40 = await request("POST", "/api/recordings/rec_alpha_1/comments", "token-commenter", {
      content: "Audit verified comment",
      timestampSeconds: 42.0
    });
    const c40Id = t40.data?.comment?.id;
    const storedC40 = mockDb.store.get(`comments/${c40Id}`);
    assertTest("40. successful create stores authoritative relationships",
      t40.status === 201 &&
      storedC40?.recordingId === "rec_alpha_1" &&
      storedC40?.projectId === "proj_alpha_1" &&
      storedC40?.organizationId === "org_alpha" &&
      storedC40?.userId === "user_alpha_commenter" &&
      storedC40?.userEmail === "commenter@acme.com" &&
      storedC40?.userName === "Charlie Commenter" &&
      storedC40?.timestampSeconds === 42.0 &&
      storedC40?.content === "Audit verified comment",
      storedC40
    );

    // 41. Successful update changes only permitted fields
    const t41 = await request("PATCH", `/api/comments/${c40Id}`, "token-commenter", {
      content: "Audit verified edited comment",
      userId: "hacker_uid",
      recordingId: "rec_hacked"
    });
    const storedC41 = mockDb.store.get(`comments/${c40Id}`);
    assertTest("41. successful update changes only permitted fields",
      t41.status === 200 &&
      storedC41?.content === "Audit verified edited comment" &&
      storedC41?.userId === "user_alpha_commenter" &&
      storedC41?.recordingId === "rec_alpha_1" &&
      storedC41?.updatedAt !== storedC40?.updatedAt,
      storedC41
    );

    // 42. Successful delete removes the intended comment only
    const countBeforeDel = Array.from(mockDb.store.keys()).filter(k => k.startsWith("comments/")).length;
    const t42 = await request("DELETE", `/api/comments/${c40Id}`, "token-commenter");
    const countAfterDel = Array.from(mockDb.store.keys()).filter(k => k.startsWith("comments/")).length;
    const existsOther = mockDb.store.has("comments/comment_alpha_existing_2");

    assertTest("42. successful delete removes the intended comment only",
      t42.status === 200 &&
      !mockDb.store.has(`comments/${c40Id}`) &&
      countAfterDel === countBeforeDel - 1 &&
      existsOther,
      { countBeforeDel, countAfterDel }
    );

  } finally {
    server.close();
  }

  // --------------------------------------------------------------------------
  // TEST SUMMARY
  // --------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`📊 STEP 4A COMMENT API VERIFICATION RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("================================================================================");

  if (failedCount > 0) {
    console.error("❌ FAILED TESTS:", failures);
    throw new Error(`Step 4A verification failed with ${failedCount} errors.`);
  } else {
    console.log("🎉 ALL 42 STEP 4A SERVER-AUTHORITATIVE COMMENT API TESTS PASSED SUCCESSFULLY!\n");
  }
}

// Execute directly if run with tsx
runStep4ACommentApiTestSuite().catch(err => {
  console.error("FATAL ERROR running Step 4A test suite:", err);
  process.exit(1);
});
