import { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import { AuthoritativeOrgRole, CustomClaims, OrgAuditEvent } from "../types.js";

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken & {
    orgId?: string;
    orgRole?: AuthoritativeOrgRole;
    role?: 'admin' | 'user';
    isOwner?: boolean;
  };
}

export const ROLE_HIERARCHY: Record<AuthoritativeOrgRole, number> = {
  owner: 5,
  org_admin: 4,
  team_manager: 3,
  member: 2,
  viewer: 1
};

export const PUBLIC_CONSUMER_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'zoho.com',
  'proton.me',
  'protonmail.com',
  'mail.com',
  'gmx.com'
]);

export function normalizeDomain(domain: string): string {
  if (!domain) return '';
  let d = domain.trim().toLowerCase();
  // Strip protocol if user pasted URL
  d = d.replace(/^https?:\/\//i, '');
  // Strip trailing slashes or paths
  d = d.split('/')[0];
  // Strip mailto:
  d = d.replace(/^mailto:/i, '');
  // If email passed, take domain portion
  if (d.includes('@')) {
    d = d.split('@')[1];
  }
  return d;
}

export function isValidDomain(domain: string): boolean {
  if (!domain || typeof domain !== 'string') return false;
  const d = normalizeDomain(domain);
  if (d.length < 3 || d.length > 253) return false;
  // Domain regex check
  const domainRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
  return domainRegex.test(d);
}

export function normalizeOrgRole(role?: string): AuthoritativeOrgRole {
  if (!role) return 'viewer';
  const r = role.toLowerCase().trim();
  if (r === 'owner' || r === 'super_admin') return 'owner';
  if (r === 'org_admin' || r === 'admin') return 'org_admin';
  if (r === 'team_manager' || r === 'team_lead' || r === 'manager') return 'team_manager';
  if (r === 'member') return 'member';
  return 'viewer';
}

/**
 * Record a structured audit event to the organization's audit log collection
 */
export async function recordOrgAuditEvent(
  db: admin.firestore.Firestore,
  event: OrgAuditEvent
): Promise<void> {
  try {
    const logId = event.id || `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const logData = {
      id: logId,
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      actorEmail: event.actorEmail,
      targetUserId: event.targetUserId || null,
      targetUserEmail: event.targetUserEmail || null,
      previousRole: event.previousRole || null,
      newRole: event.newRole || null,
      action: event.action,
      timestamp: event.timestamp || new Date().toISOString(),
      source: event.source || 'api',
      details: event.details || '',
      metadata: event.metadata || {}
    };

    // Store in subcollection /organizations/{orgId}/auditLogs/{logId}
    await db
      .collection("organizations")
      .doc(event.organizationId)
      .collection("auditLogs")
      .doc(logId)
      .set(logData);

    console.log(`📋 [AUDIT LOG] ${event.action} by ${event.actorEmail} on org ${event.organizationId}`);
  } catch (err: any) {
    console.error("⚠️ Failed to record organization audit log:", err.message);
  }
}

/**
 * Synchronize and issue authoritative Firebase Custom Claims for a user
 */
export async function syncUserCustomClaims(
  uid: string,
  db: admin.firestore.Firestore,
  explicitClaims?: Partial<CustomClaims>
): Promise<CustomClaims> {
  try {
    let targetOrgId: string | undefined = explicitClaims?.orgId;
    let targetOrgRole: AuthoritativeOrgRole | undefined = explicitClaims?.orgRole;
    let platformRole: 'admin' | 'user' | undefined = explicitClaims?.role;

    // 1. Fetch user profile from Firestore to check platform role & email
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data() || {};
    const userEmail = (userData.email || "").toLowerCase();
    
    if (userData.role === 'admin') {
      platformRole = 'admin';
    }

    // 2. If org claims not explicitly provided, find active authoritative organization
    if (!targetOrgId || !targetOrgRole) {
      // Check if user is an Organization owner
      const ownedOrgSnap = await db
        .collection("organizations")
        .where("ownerId", "==", uid)
        .limit(1)
        .get();

      if (!ownedOrgSnap.empty) {
        targetOrgId = ownedOrgSnap.docs[0].id;
        targetOrgRole = 'owner';
      } else if (userEmail) {
        // Check by ownerEmail as fallback
        const ownedByEmailSnap = await db
          .collection("organizations")
          .where("ownerEmail", "==", userEmail)
          .limit(1)
          .get();

        if (!ownedByEmailSnap.empty) {
          targetOrgId = ownedByEmailSnap.docs[0].id;
          targetOrgRole = 'owner';
        }
      }

      // If not owner, check active orgMemberships
      if (!targetOrgId && userEmail) {
        const memberSnap = await db
          .collection("orgMembers")
          .where("email", "==", userEmail)
          .where("status", "==", "active")
          .limit(1)
          .get();

        if (!memberSnap.empty) {
          const memberData = memberSnap.docs[0].data();
          targetOrgId = memberData.orgId || memberData.organizationId;
          targetOrgRole = normalizeOrgRole(memberData.role);
        }
      }
    }

    const claims: CustomClaims = {
      orgId: targetOrgId || undefined,
      orgRole: targetOrgRole || undefined,
      role: platformRole,
      isOwner: targetOrgRole === 'owner'
    };

    // Firebase custom claims must stay lightweight (< 1000 bytes)
    await admin.auth().setCustomUserClaims(uid, claims);
    console.log(`🔐 Set Custom Claims for ${uid} (${userEmail}):`, claims);
    return claims;
  } catch (error: any) {
    console.error(`⚠️ Failed to set custom claims for user ${uid}:`, error.message);
    throw error;
  }
}

/**
 * Require valid Firebase ID Token in Authorization header.
 * Rejects with 401 if missing, invalid, or expired.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. Expected 'Bearer <token>'.",
    });
    return;
  }

  const token = authHeader.split("Bearer ")[1]?.trim();

  if (!token) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Authentication token missing from Authorization header.",
    });
    return;
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Normalize custom claims into request user object
    const userClaims: any = { ...decodedToken };
    if (decodedToken.orgRole) {
      userClaims.orgRole = normalizeOrgRole(decodedToken.orgRole as string);
    }
    req.user = userClaims;

    // Enterprise Session Security Check:
    // If user's organization enforces session timeout, verify auth_time
    if (decodedToken.orgId && typeof decodedToken.auth_time === 'number') {
      // In fast-path, check if token auth_time exceeded standard threshold or org threshold
      const authTimeSeconds = decodedToken.auth_time;
      const nowSeconds = Math.floor(Date.now() / 1000);
      const sessionElapsedMinutes = (nowSeconds - authTimeSeconds) / 60;

      // Check if session exceeded 24 hours default max or org-configured timeout
      if (sessionElapsedMinutes > 1440) { // 24 hours absolute maximum
        res.status(401).json({
          error: "Unauthorized",
          code: "SESSION_TIMEOUT",
          message: "Enterprise authentication session has expired (exceeded 24 hours). Please sign in again."
        });
        return;
      }
    }

    next();
  } catch (error: any) {
    console.error("🔒 Auth Token Verification Failed:", error?.message || error);
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid, expired, or revoked authentication token.",
      code: error?.code || "auth/invalid-token",
    });
  }
}

/**
 * Optional authentication middleware.
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split("Bearer ")[1]?.trim();
    if (token) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const userClaims: any = { ...decodedToken };
        if (decodedToken.orgRole) {
          userClaims.orgRole = normalizeOrgRole(decodedToken.orgRole as string);
        }
        req.user = userClaims;
      } catch (error: any) {
        console.warn("⚠️ Optional auth token verification failed:", error?.message);
      }
    }
  }

  next();
}

/**
 * Server-side Project Authorization Helper.
 */
export async function checkProjectAccess(
  db: admin.firestore.Firestore,
  userId: string,
  projectId: string,
  requiredRoles: string[] = ["owner", "admin", "member", "viewer"]
): Promise<{ hasAccess: boolean; isOwner: boolean; role?: string }> {
  if (!userId || !projectId) {
    return { hasAccess: false, isOwner: false };
  }

  try {
    const projectDoc = await db.collection("projects").doc(projectId).get();
    if (projectDoc.exists) {
      const projectData = projectDoc.data() || {};
      if (projectData.userId === userId) {
        return { hasAccess: true, isOwner: true, role: "owner" };
      }
    }

    const memberDocId = `${userId}_${projectId}`;
    const memberDoc = await db.collection("projectMembers").doc(memberDocId).get();
    if (memberDoc.exists) {
      const memberData = memberDoc.data() || {};
      const userRole = (memberData.role || "member").toLowerCase();
      if (requiredRoles.map((r) => r.toLowerCase()).includes(userRole)) {
        return { hasAccess: true, isOwner: userRole === "owner", role: userRole };
      }
    }

    return { hasAccess: false, isOwner: false };
  } catch (error: any) {
    console.error(`⚠️ checkProjectAccess error for user ${userId} on project ${projectId}:`, error?.message);
    return { hasAccess: false, isOwner: false };
  }
}

/**
 * Server-side Organization Authorization Helper.
 * Checks authoritative organization access using verified Custom Claims first,
 * with secure Firestore database fallback.
 */
export async function checkOrgAccess(
  db: admin.firestore.Firestore,
  userEmail: string,
  orgId: string,
  requiredRoles: string[] = ["owner", "org_admin", "team_manager", "member"]
): Promise<{ hasAccess: boolean; isOwner: boolean; role?: AuthoritativeOrgRole }> {
  if (!userEmail || !orgId) {
    return { hasAccess: false, isOwner: false };
  }

  try {
    // 1. Check if user is Organization Owner in Firestore
    const orgDoc = await db.collection("organizations").doc(orgId).get();
    if (orgDoc.exists) {
      const orgData = orgDoc.data() || {};
      if (orgData.ownerEmail?.toLowerCase() === userEmail.toLowerCase()) {
        return { hasAccess: true, isOwner: true, role: "owner" };
      }
    }

    // 2. Query orgMembers by email & orgId
    const membersSnapshot = await db
      .collection("orgMembers")
      .where("orgId", "==", orgId)
      .where("email", "==", userEmail.toLowerCase())
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (!membersSnapshot.empty) {
      const memberData = membersSnapshot.docs[0].data();
      const normalizedRole = normalizeOrgRole(memberData.role);
      const reqNormalized = requiredRoles.map(r => normalizeOrgRole(r));
      if (reqNormalized.includes(normalizedRole)) {
        return { hasAccess: true, isOwner: normalizedRole === 'owner', role: normalizedRole };
      }
    }

    return { hasAccess: false, isOwner: false };
  } catch (error: any) {
    console.error(`⚠️ checkOrgAccess error for email ${userEmail} on org ${orgId}:`, error?.message);
    return { hasAccess: false, isOwner: false };
  }
}

/**
 * Authoritative Organization Permission Middleware Generator.
 * Enforces that caller is authenticated and holds at least `minRole` in `req.params.organizationId` or `req.params.orgId`.
 */
export function requireOrgRole(
  db: admin.firestore.Firestore,
  minRole: AuthoritativeOrgRole
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const orgId = req.params.organizationId || req.params.orgId || req.body.orgId || req.query.orgId as string;
    if (!orgId) {
      res.status(400).json({ error: "Bad Request", message: "organizationId is required" });
      return;
    }

    if (!req.user) {
      res.status(401).json({ error: "Unauthorized", message: "User not authenticated" });
      return;
    }

    const userUid = req.user.uid;
    const userEmail = (req.user.email || "").toLowerCase();
    const tokenOrgId = req.user.orgId;
    const tokenOrgRole = req.user.orgRole;

    const minRank = ROLE_HIERARCHY[minRole] || 1;

    // 1. Authoritative check via verified token custom claims if matching org
    if (tokenOrgId === orgId && tokenOrgRole) {
      const tokenRank = ROLE_HIERARCHY[tokenOrgRole] || 0;
      if (tokenRank >= minRank) {
        next();
        return;
      } else {
        res.status(403).json({
          error: "Forbidden",
          message: `Insufficient permissions. Requires '${minRole}', caller has '${tokenOrgRole}'.`
        });
        return;
      }
    }

    // 2. Authoritative Database verification fallback
    try {
      const orgDoc = await db.collection("organizations").doc(orgId).get();
      if (!orgDoc.exists) {
        res.status(404).json({ error: "Not Found", message: "Organization not found" });
        return;
      }

      const orgData = orgDoc.data() || {};
      let userRole: AuthoritativeOrgRole | null = null;

      if (orgData.ownerId === userUid || orgData.ownerEmail?.toLowerCase() === userEmail) {
        userRole = 'owner';
      } else {
        const memberSnap = await db
          .collection("orgMembers")
          .where("orgId", "==", orgId)
          .where("email", "==", userEmail)
          .where("status", "==", "active")
          .limit(1)
          .get();

        if (!memberSnap.empty) {
          userRole = normalizeOrgRole(memberSnap.docs[0].data().role);
        }
      }

      if (!userRole) {
        res.status(403).json({
          error: "Forbidden",
          message: "You are not an active member of this organization."
        });
        return;
      }

      const userRank = ROLE_HIERARCHY[userRole] || 0;
      if (userRank < minRank) {
        res.status(403).json({
          error: "Forbidden",
          message: `Insufficient permissions. Requires '${minRole}', caller has '${userRole}'.`
        });
        return;
      }

      // Sync claims for future requests in the background
      syncUserCustomClaims(userUid, db, { orgId, orgRole: userRole }).catch(err => {
        console.warn("Background claim sync note:", err.message);
      });

      next();
    } catch (err: any) {
      console.error("⚠️ requireOrgRole verification failed:", err.message);
      res.status(500).json({ error: "Internal Server Error", message: "Authorization check failed" });
    }
  };
}
