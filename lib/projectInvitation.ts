import { FieldValue } from "firebase-admin/firestore";
import { emailService } from "./emailService.js";
import { isProductionEnvironment } from "../middleware/billingFulfillment.ts";

export interface SanitizeTokenResult {
  valid: boolean;
  token?: string;
  error?: string;
  message?: string;
}

/**
 * Sanitizes and validates an incoming invitation token string.
 * Strips leading/trailing whitespace, validates non-empty string, bounds length,
 * and rejects dangerous control characters.
 */
export function sanitizeInvitationToken(rawToken: unknown): SanitizeTokenResult {
  if (rawToken === undefined || rawToken === null) {
    return {
      valid: false,
      error: "Missing invitation token",
      message: "A valid invitation token string is required."
    };
  }
  if (typeof rawToken !== "string") {
    return {
      valid: false,
      error: "Invalid invitation token",
      message: "Invitation token must be a string."
    };
  }
  const trimmed = rawToken.trim();
  if (!trimmed) {
    return {
      valid: false,
      error: "Missing invitation token",
      message: "A valid invitation token string is required."
    };
  }
  if (trimmed.length > 256) {
    return {
      valid: false,
      error: "Invalid invitation token",
      message: "Token exceeds maximum permissible length."
    };
  }
  // Reject unsafe control characters or newlines
  if (/[\r\n\t\x00-\x1f\x7f]/.test(trimmed)) {
    return {
      valid: false,
      error: "Invalid invitation token",
      message: "Token contains invalid characters."
    };
  }
  return {
    valid: true,
    token: trimmed
  };
}

export interface AcceptProjectInvitationOptions {
  rawToken: unknown;
  userId: string;
  userEmail: string;
  userDisplayName?: string;
  appUrl?: string;
  pendingInvitesStore?: Map<string, any>;
  projectMembersFallbackStore?: Map<string, any>;
}

export interface AcceptProjectInvitationResult {
  status: number;
  body: {
    success?: boolean;
    alreadyMember?: boolean;
    message?: string;
    projectId?: string;
    projectName?: string;
    role?: string;
    error?: string;
    status?: string;
  };
}

/**
 * Robust invitation acceptance processor:
 * 1. Sanitizes token defensively.
 * 2. Explicitly distinguishes Firestore infrastructure read failures from genuine nonexistent tokens.
 * 3. Enforces recipient identity, expiration, cancellation, and replay protections.
 * 4. Persists membership and invitation status update atomically inside a Firestore transaction.
 * 5. Guarantees durable membership persistence before returning HTTP 200 OK.
 * 6. Never falls back to in-memory store in production environments.
 */
export async function acceptProjectInvitation(
  db: FirebaseFirestore.Firestore,
  options: AcceptProjectInvitationOptions
): Promise<AcceptProjectInvitationResult> {
  const { rawToken, userId, userEmail, userDisplayName, appUrl, pendingInvitesStore, projectMembersFallbackStore } = options;

  // 1. Sanitize token
  const tokenValidation = sanitizeInvitationToken(rawToken);
  if (!tokenValidation.valid || !tokenValidation.token) {
    return {
      status: 400,
      body: {
        error: tokenValidation.error || "Missing invitation token",
        message: tokenValidation.message || "A valid invitation token string is required."
      }
    };
  }
  const token = tokenValidation.token;

  if (!userEmail || !userId) {
    return {
      status: 400,
      body: {
        error: "BadRequest",
        message: "Authenticated user must have a valid user ID and email address to accept invitations."
      }
    };
  }

  const effectiveDisplayName = userDisplayName || userEmail.split('@')[0] || 'User';

  try {
    let targetInviteRef: FirebaseFirestore.DocumentReference | null = null;
    let initialInviteData: any = null;

    // 2. Explicit Firestore Read with isolated error handling (Distinguish DB Error from 404)
    try {
      // Primary: Canonical lookup by document ID
      const canonicalRef = db.collection("invites").doc(token);
      const canonicalSnap = await canonicalRef.get();
      if (canonicalSnap.exists) {
        targetInviteRef = canonicalRef;
        initialInviteData = canonicalSnap.data() || {};
        if (!initialInviteData.id) {
          initialInviteData.id = canonicalSnap.id;
        }
      } else {
        // Fallback: Resilient indexed queries for id or token fields
        const idSnap = await db.collection("invites").where("id", "==", token).limit(1).get();
        if (!idSnap.empty) {
          targetInviteRef = idSnap.docs[0].ref;
          initialInviteData = idSnap.docs[0].data() || {};
          if (!initialInviteData.id) {
            initialInviteData.id = idSnap.docs[0].id;
          }
        } else {
          const tokenSnap = await db.collection("invites").where("token", "==", token).limit(1).get();
          if (!tokenSnap.empty) {
            targetInviteRef = tokenSnap.docs[0].ref;
            initialInviteData = tokenSnap.docs[0].data() || {};
            if (!initialInviteData.id) {
              initialInviteData.id = tokenSnap.docs[0].id;
            }
          }
        }
      }
    } catch (readErr: any) {
      console.error("🚨 [INVITE ACCEPT] Firestore database error during invitation lookup:", {
        tokenPrefix: token.slice(0, 8),
        errorMessage: readErr?.message || String(readErr)
      });
      return {
        status: 500,
        body: {
          error: "DatabaseError",
          message: "A database error occurred while verifying the invitation. Please try again."
        }
      };
    }

    // 3. Genuine non-existent token handling
    if (!targetInviteRef || !initialInviteData) {
      if (!isProductionEnvironment() && pendingInvitesStore && pendingInvitesStore.has(token)) {
        initialInviteData = pendingInvitesStore.get(token);
      }
      if (!initialInviteData) {
        return {
          status: 404,
          body: {
            error: "NotFound",
            message: "Invitation not found or invalid token."
          }
        };
      }
    }

    // 4. Pre-transaction validation of recipient and status invariants
    const currentStatus = String(initialInviteData.status || "pending").toLowerCase();

    // Check cancellation / revocation / rejection
    if (currentStatus === "cancelled" || currentStatus === "revoked" || currentStatus === "rejected") {
      return {
        status: 400,
        body: {
          error: "Invalid invitation",
          message: "This invitation has been cancelled.",
          status: currentStatus
        }
      };
    }

    // Check expiration status
    if (currentStatus === "expired") {
      return {
        status: 400,
        body: {
          error: "Invalid invitation",
          message: "This invitation has expired.",
          status: "expired"
        }
      };
    }

    // Check expiration timestamp if configured on the invitation
    if (initialInviteData.expiresAt) {
      const expiresMs = initialInviteData.expiresAt?.toMillis
        ? initialInviteData.expiresAt.toMillis()
        : initialInviteData.expiresAt?.toDate
        ? initialInviteData.expiresAt.toDate().getTime()
        : new Date(initialInviteData.expiresAt).getTime();
      if (!isNaN(expiresMs) && expiresMs < Date.now()) {
        return {
          status: 400,
          body: {
            error: "Invalid invitation",
            message: "This invitation has expired.",
            status: "expired"
          }
        };
      }
    }

    // Strict email matching: verified user email must match invite email
    if (initialInviteData.email && initialInviteData.email.toLowerCase().trim() !== userEmail.toLowerCase().trim()) {
      return {
        status: 403,
        body: {
          error: "Forbidden",
          message: `This invitation was issued to ${initialInviteData.email}. You are currently authenticated as ${userEmail}.`
        }
      };
    }

    // Verify project still exists
    try {
      const projSnap = await db.collection("projects").doc(initialInviteData.projectId).get();
      if (!projSnap.exists && isProductionEnvironment()) {
        return {
          status: 404,
          body: {
            error: "NotFound",
            message: "The project for this invitation no longer exists."
          }
        };
      }
    } catch (projErr) {
      // Non-blocking query failure fallback for dev/emulator environments
    }

    const memberId = `${userId}_${initialInviteData.projectId}`;
    const memberDocRef = db.collection("projectMembers").doc(memberId);

    // Early idempotent check: If already a project member
    try {
      const existingMemberSnap = await memberDocRef.get();
      if (existingMemberSnap.exists) {
        if (targetInviteRef && currentStatus === "pending") {
          try {
            await targetInviteRef.update({
              status: "accepted",
              acceptedAt: FieldValue.serverTimestamp(),
              acceptedBy: userId,
              acceptedUserEmail: userEmail
            });
          } catch (e) {}
        }
        return {
          status: 200,
          body: {
            success: true,
            alreadyMember: true,
            message: "You are already a member of this project.",
            projectId: initialInviteData.projectId,
            projectName: initialInviteData.projectName || "EchoNote Workspace",
            role: initialInviteData.role || "viewer"
          }
        };
      }
    } catch (existingMemberErr) {}

    // 5. Idempotent check for already-accepted invitations
    if (currentStatus === "accepted") {
      const isSameRecipient = (initialInviteData.acceptedBy && initialInviteData.acceptedBy === userId) ||
        (initialInviteData.email && initialInviteData.email.toLowerCase().trim() === userEmail.toLowerCase().trim());
      
      if (isSameRecipient) {
        try {
          const memberSnap = await memberDocRef.get();
          if (memberSnap.exists) {
            return {
              status: 200,
              body: {
                success: true,
                alreadyMember: true,
                message: "You have already joined this project.",
                projectId: initialInviteData.projectId,
                projectName: initialInviteData.projectName || "EchoNote Workspace",
                role: initialInviteData.role || "viewer"
              }
            };
          }
        } catch (checkErr) {
          // Fall through to replay error if member check fails
        }
      }
      return {
        status: 400,
        body: {
          error: "Invalid invitation",
          message: "This invitation has already been accepted.",
          status: "accepted"
        }
      };
    }

    if (currentStatus !== "pending") {
      return {
        status: 400,
        body: {
          error: "Invalid invitation",
          message: `This invitation is not valid for acceptance (status: ${currentStatus}).`,
          status: currentStatus
        }
      };
    }

    // 6. Construct durable membership record
    const memberRecord = {
      userId,
      email: userEmail,
      displayName: effectiveDisplayName,
      projectId: initialInviteData.projectId,
      ownerId: initialInviteData.ownerId || null,
      projectName: initialInviteData.projectName || "EchoNote Workspace",
      role: initialInviteData.role || "viewer",
      status: "active",
      joinedAt: FieldValue.serverTimestamp()
    };

    // 7. Atomic transaction: create member record & transition invite to accepted
    let isAlreadyAcceptedBySameUser = false;
    if (targetInviteRef) {
      try {
        await db.runTransaction(async (transaction) => {
          const freshInviteSnap = await transaction.get(targetInviteRef!);
          const freshMemberSnap = await transaction.get(memberDocRef);

          if (!freshInviteSnap.exists) {
            throw new Error("INVITE_NOT_FOUND");
          }
          const freshInvite = freshInviteSnap.data() || {};
          const freshStatus = String(freshInvite.status || "pending").toLowerCase();
          if (freshStatus !== "pending") {
            if (freshStatus === "accepted") {
              const isSameRecipient = (freshInvite.acceptedBy && freshInvite.acceptedBy === userId) ||
                (freshInvite.email && freshInvite.email.toLowerCase().trim() === userEmail.toLowerCase().trim()) ||
                (freshInvite.acceptedUserEmail && freshInvite.acceptedUserEmail.toLowerCase().trim() === userEmail.toLowerCase().trim());
              if (isSameRecipient) {
                // Concurrent or repeated acceptance by same user: ensure member record is active
                transaction.set(memberDocRef, memberRecord, { merge: true });
                isAlreadyAcceptedBySameUser = true;
                return;
              }
              throw new Error("ALREADY_ACCEPTED");
            }
            if (freshStatus === "cancelled" || freshStatus === "revoked" || freshStatus === "rejected") throw new Error("CANCELLED");
            if (freshStatus === "expired") throw new Error("EXPIRED");
            throw new Error("INVALID_STATUS");
          }

          // Persist membership record in transaction
          transaction.set(memberDocRef, memberRecord, { merge: true });

          // Update invite status to accepted in transaction
          transaction.update(targetInviteRef!, {
            status: "accepted",
            acceptedAt: FieldValue.serverTimestamp(),
            acceptedBy: userId,
            acceptedUserEmail: userEmail
          });
        });

        if (isAlreadyAcceptedBySameUser) {
          return {
            status: 200,
            body: {
              success: true,
              alreadyMember: true,
              message: "You have already joined this project.",
              projectId: initialInviteData.projectId,
              projectName: initialInviteData.projectName || "EchoNote Workspace",
              role: initialInviteData.role || "viewer"
            }
          };
        }
      } catch (txErr: any) {
        if (txErr.message === "ALREADY_ACCEPTED") {
          return { status: 400, body: { error: "Invalid invitation", message: "This invitation has already been accepted.", status: "accepted" } };
        }
        if (txErr.message === "CANCELLED") {
          return { status: 400, body: { error: "Invalid invitation", message: "This invitation has been cancelled.", status: "cancelled" } };
        }
        if (txErr.message === "EXPIRED") {
          return { status: 400, body: { error: "Invalid invitation", message: "This invitation has expired.", status: "expired" } };
        }
        if (txErr.message === "INVITE_NOT_FOUND") {
          return { status: 404, body: { error: "NotFound", message: "Invitation not found or invalid token." } };
        }

        console.error("🚨 [INVITE ACCEPT] Transaction failed to persist project membership:", {
          projectId: initialInviteData.projectId,
          userId,
          errorMessage: txErr?.message || String(txErr)
        });
        return {
          status: 500,
          body: {
            error: "TransactionFailed",
            message: "Failed to securely persist project membership. Please try again."
          }
        };
      }
    } else {
      // In-memory fallback strictly for non-production development environments
      if (isProductionEnvironment()) {
        return {
          status: 500,
          body: {
            error: "DatabaseUnavailable",
            message: "Production database reference unavailable."
          }
        };
      }
      if (projectMembersFallbackStore) {
        projectMembersFallbackStore.set(memberId, { ...memberRecord, joinedAt: new Date().toISOString() });
      }
      initialInviteData.status = "accepted";
      initialInviteData.acceptedAt = new Date().toISOString();
      initialInviteData.acceptedBy = userId;
      if (pendingInvitesStore) {
        pendingInvitesStore.set(token, initialInviteData);
      }
    }

    // 8. Non-blocking post-transaction side effects (Activities & Welcome Email)
    try {
      await db.collection("projectActivities").add({
        projectId: initialInviteData.projectId,
        userId: userId,
        userEmail: userEmail,
        userName: effectiveDisplayName,
        actionType: "join_project",
        description: `${effectiveDisplayName} joined project "${initialInviteData.projectName || 'Workspace'}"`,
        createdAt: FieldValue.serverTimestamp()
      });
    } catch (e: any) {
      console.warn("⚠️ Server-side projectActivities add note:", e?.message || e);
    }

    const inviteOrgId = initialInviteData.orgId || initialInviteData.organizationId;
    if (inviteOrgId) {
      try {
        await db.collection("auditLogs").add({
          organizationId: inviteOrgId,
          actorUserId: userId,
          actorEmail: userEmail,
          targetUserEmail: userEmail,
          newRole: initialInviteData.role || "viewer",
          action: "PROJECT_INVITATION_ACCEPTED",
          timestamp: new Date().toISOString(),
          details: `Accepted project invitation for project ${initialInviteData.projectId}`
        });
      } catch (auditErr) {}
    }

    if (appUrl && !isAlreadyAcceptedBySameUser) {
      try {
        await emailService.sendWelcome(userEmail, {
          name: effectiveDisplayName,
          dashboardLink: `${appUrl}/app`
        });
      } catch (welcomeErr: any) {
        console.warn("⚠️ Failed to send welcome onboarding email:", welcomeErr?.message || welcomeErr);
      }
    }

    // 9. Return success after durable membership confirmed
    return {
      status: 200,
      body: {
        success: true,
        alreadyMember: false,
        message: `Successfully joined ${initialInviteData.projectName || 'the project'} as ${initialInviteData.role || 'member'}`,
        projectId: initialInviteData.projectId,
        projectName: initialInviteData.projectName || "EchoNote Workspace",
        role: initialInviteData.role || "viewer"
      }
    };
  } catch (error: any) {
    console.error("🚨 [INVITE ACCEPT] Unexpected error:", error?.message || String(error));
    return {
      status: 500,
      body: {
        error: "InternalError",
        message: "Failed to process invitation acceptance."
      }
    };
  }
}
