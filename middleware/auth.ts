import { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import { getAdminFirestore, getFirebaseConfig } from "../lib/firebaseAdmin.ts";
import { isProductionEnvironment } from "./billingFulfillment.ts";
import { 
  AuthoritativeOrgRole, 
  CustomClaims, 
  OrgAuditEvent,
  TargetProjectRole,
  ProjectPermission,
  ProjectPermissions,
  ProjectAccessResolution,
  getProjectRolePermissions,
  normalizeProjectRole
} from "../types.js";

function parseFirestoreRestFields(fields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(fields || {})) {
    if (!val || typeof val !== 'object') continue;
    if (val.stringValue !== undefined) result[key] = val.stringValue;
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.integerValue !== undefined) result[key] = Number(val.integerValue);
    else if (val.doubleValue !== undefined) result[key] = Number(val.doubleValue);
    else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
    else if (val.nullValue !== undefined) result[key] = null;
    else if (val.mapValue !== undefined) result[key] = parseFirestoreRestFields(val.mapValue.fields || {});
    else if (val.arrayValue !== undefined) {
      result[key] = (val.arrayValue.values || []).map((v: any) => {
        if (!v || typeof v !== 'object') return v;
        if (v.stringValue !== undefined) return v.stringValue;
        if (v.booleanValue !== undefined) return v.booleanValue;
        if (v.integerValue !== undefined) return Number(v.integerValue);
        if (v.mapValue !== undefined) return parseFirestoreRestFields(v.mapValue.fields || {});
        return Object.values(v)[0];
      });
    } else {
      result[key] = Object.values(val)[0];
    }
  }
  return result;
}

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken & {
    orgId?: string;
    orgRole?: AuthoritativeOrgRole;
    role?: 'admin' | 'user';
    platform_admin?: boolean;
    isOwner?: boolean;
    idToken?: string;
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
    userClaims.idToken = token;
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
 * Centralized Server-side Project Authorization Resolver.
 * Authoritatively determines effective project role, permissions, and tenant boundaries:
 * - Differentiates between owner, admin, commenter, and viewer
 * - Normalizes legacy 'editor' role to 'admin' using canonical normalizeProjectRole()
 * - Strictly prevents organization-wide access leakage: regular org members do NOT auto-inherit project access
 * - Preserves supervisory override for Org Owner / Org Admin on organization projects
 * - Preserves Platform Administrator operational override
 * - Enforces tenant isolation (users from Org A cannot access projects in Org B)
 */
export async function resolveProjectAccess(
  db: admin.firestore.Firestore,
  user: { uid: string; email?: string; platform_admin?: boolean; role?: string; idToken?: string; [key: string]: any } | string,
  projectId: string,
  options?: {
    requiredPermission?: ProjectPermission;
    requiredRoles?: string[];
    callerClaimedOwnerId?: string;
  }
): Promise<ProjectAccessResolution> {
  const userId = typeof user === 'string' ? user : user?.uid;
  let userEmail = typeof user === 'object' && user?.email ? user.email.toLowerCase().trim() : '';
  const isPlatformAdmin = typeof user === 'object' && Boolean(
    user?.platform_admin === true || 
    user?.role === 'admin' || 
    (user as any)?.claims?.platform_admin === true
  );

  const emptyResolution = (reason: string, notFound = false): ProjectAccessResolution => ({
    hasAccess: false,
    role: null,
    isOwner: false,
    isDirectCreator: false,
    isOrgAdmin: false,
    isPlatformAdmin: false,
    permissions: getProjectRolePermissions(null),
    reason,
    notFound
  });

  if (!userId || !projectId) {
    return emptyResolution("Missing userId or projectId");
  }

  try {
    // 1. Fetch project document
    let projectData: any = null;

    try {
      const projectDoc = await db.collection("projects").doc(projectId).get();
      if (!projectDoc.exists) {
        return emptyResolution("Project not found", true);
      }
      projectData = projectDoc.data() || {};
      projectData.id = projectDoc.id;
    } catch (docErr: any) {
      const isPermissionDenied = docErr?.code === 7 || (docErr?.message && docErr.message.includes("PERMISSION_DENIED"));
      if (isPermissionDenied) {
        // Attempt REST API fetch using caller's verified ID token if available
        const idToken = typeof user === 'object' ? user?.idToken : undefined;
        if (idToken) {
          try {
            const config = getFirebaseConfig();
            const restUrl = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/projects/${projectId}`;
            const restResp = await fetch(restUrl, {
              headers: { Authorization: `Bearer ${idToken}` }
            });
            if (restResp.ok) {
              const restJson: any = await restResp.json();
              projectData = parseFirestoreRestFields(restJson.fields || {});
              projectData.id = projectId;
            } else if (restResp.status === 404) {
              return emptyResolution("Project not found", true);
            }
          } catch (restErr) {
            console.warn("⚠️ REST fallback query failed:", restErr);
          }
        }

        // If still no projectData and we are in non-production, check callerClaimedOwnerId
        if (!projectData && !isProductionEnvironment()) {
          if (options?.callerClaimedOwnerId === userId) {
            projectData = { id: projectId, userId, name: "Workspace Project" };
          }
        }
      }

      if (!projectData) {
        throw docErr;
      }
    }

    const projectOrgId = projectData.orgId || projectData.organizationId || null;
    const isDirectCreator = projectData.userId === userId;

    // 2. Platform Administrator Operational Override
    if (isPlatformAdmin) {
      return {
        hasAccess: true,
        role: 'owner',
        isOwner: true,
        isDirectCreator,
        isOrgAdmin: true,
        isPlatformAdmin: true,
        organizationId: projectOrgId,
        project: projectData,
        permissions: getProjectRolePermissions('owner'),
        reason: "Authorized as platform administrator"
      };
    }

    // Attempt to load userEmail if not provided in user object
    if (!userEmail) {
      try {
        const uDoc = await db.collection("users").doc(userId).get();
        if (uDoc.exists) {
          userEmail = (uDoc.data()?.email || "").toLowerCase().trim();
        }
      } catch (e) {
        // Fallback gracefully
      }
    }

    // 3. Organization Scoping & Supervisory Access Check
    let isOrgSupervisor = false;
    let isOrgMember = false;

    if (projectOrgId) {
      if (userEmail) {
        // Check organization owner in Firestore
        try {
          const orgDoc = await db.collection("organizations").doc(projectOrgId).get();
          if (orgDoc.exists) {
            const oData = orgDoc.data() || {};
            if (oData.ownerId === userId || (oData.ownerEmail && oData.ownerEmail.toLowerCase() === userEmail)) {
              isOrgSupervisor = true;
              isOrgMember = true;
            }
          }
        } catch (e) {
          console.warn("⚠️ Could not fetch organization doc:", e);
        }

        // Check organization membership & role
        if (!isOrgSupervisor) {
          const orgAccess = await checkOrgAccess(db, userEmail, projectOrgId, ["owner", "org_admin", "team_manager", "member", "viewer"]);
          if (orgAccess.hasAccess) {
            isOrgMember = true;
            if (orgAccess.role === 'owner' || orgAccess.role === 'org_admin') {
              isOrgSupervisor = true;
            }
          }
        }
      }

      // Tenant boundary enforcement: If a project belongs to an organization,
      // the user MUST belong to that organization to access it (even as creator or collaborator)
      if (!isOrgMember) {
        return emptyResolution("Tenant isolation: User does not belong to the organization owning this project");
      }

      // Org Owner / Org Admin retain supervisory access to all organization projects
      if (isOrgSupervisor) {
        const supervisoryRole: TargetProjectRole = isDirectCreator ? 'owner' : 'admin';
        const supervisoryPermissions: ProjectPermissions = {
          canView: true,
          canComment: true,
          canEditContent: true,
          canManageProject: true,
          canManageMembers: true,
          canDeleteProject: true
        };

        // Validate required permission if specified
        if (options?.requiredPermission && !supervisoryPermissions[getPermissionField(options.requiredPermission)]) {
          return {
            hasAccess: false,
            role: supervisoryRole,
            isOwner: isDirectCreator,
            isDirectCreator,
            isOrgAdmin: true,
            isPlatformAdmin: false,
            organizationId: projectOrgId,
            project: projectData,
            permissions: supervisoryPermissions,
            reason: `Required permission ${options.requiredPermission} denied`
          };
        }

        return {
          hasAccess: true,
          role: supervisoryRole,
          isOwner: isDirectCreator,
          isDirectCreator,
          isOrgAdmin: true,
          isPlatformAdmin: false,
          organizationId: projectOrgId,
          project: projectData,
          permissions: supervisoryPermissions,
          reason: "Authorized as organization administrator"
        };
      }
    }

    // 4. Direct Creator Ownership (within tenant boundary)
    if (isDirectCreator) {
      const creatorPermissions = getProjectRolePermissions('owner');
      return {
        hasAccess: true,
        role: 'owner',
        isOwner: true,
        isDirectCreator: true,
        isOrgAdmin: false,
        isPlatformAdmin: false,
        organizationId: projectOrgId,
        project: projectData,
        permissions: creatorPermissions,
        reason: "Authorized as project creator"
      };
    }

    // 5. Explicit Project Membership via projectMembers
    let memberDoc: any = null;
    try {
      memberDoc = await db.collection("projectMembers").doc(`${userId}_${projectId}`).get();
      if (!memberDoc.exists) {
        // Fallback query by userId and projectId
        const qSnap = await db.collection("projectMembers")
          .where("projectId", "==", projectId)
          .where("userId", "==", userId)
          .limit(1)
          .get();
        if (!qSnap.empty) {
          memberDoc = qSnap.docs[0];
        } else if (userEmail) {
          // Fallback query by email and projectId
          const eSnap = await db.collection("projectMembers")
            .where("projectId", "==", projectId)
            .where("email", "==", userEmail)
            .limit(1)
            .get();
          if (!eSnap.empty) {
            memberDoc = eSnap.docs[0];
          }
        }
      }
    } catch (pmErr: any) {
      console.warn("⚠️ projectMembers Firestore query failed:", pmErr?.message || pmErr);
    }

    if (memberDoc && memberDoc.exists) {
      const memberData = memberDoc.data() || {};
      const rawRole = memberData.role;
      // Canonical normalization (e.g. editor -> admin, unknown -> viewer)
      const normalizedRole = normalizeProjectRole(rawRole);
      const permissions = getProjectRolePermissions(normalizedRole);

      // Verify required permission if specified
      if (options?.requiredPermission) {
        const field = getPermissionField(options.requiredPermission);
        if (!permissions[field]) {
          return {
            hasAccess: false,
            role: normalizedRole,
            rawRole,
            isOwner: normalizedRole === 'owner',
            isDirectCreator: false,
            isOrgAdmin: false,
            isPlatformAdmin: false,
            organizationId: projectOrgId,
            project: projectData,
            permissions,
            reason: `Role ${normalizedRole} lacks required permission ${options.requiredPermission}`
          };
        }
      }

      // Verify required roles if specified
      if (options?.requiredRoles && options.requiredRoles.length > 0) {
        const allowed = options.requiredRoles.map(r => normalizeProjectRole(r));
        if (!allowed.includes(normalizedRole)) {
          return {
            hasAccess: false,
            role: normalizedRole,
            rawRole,
            isOwner: normalizedRole === 'owner',
            isDirectCreator: false,
            isOrgAdmin: false,
            isPlatformAdmin: false,
            organizationId: projectOrgId,
            project: projectData,
            permissions,
            reason: `Role ${normalizedRole} not in required roles list`
          };
        }
      }

      return {
        hasAccess: true,
        role: normalizedRole,
        rawRole,
        isOwner: normalizedRole === 'owner',
        isDirectCreator: false,
        isOrgAdmin: false,
        isPlatformAdmin: false,
        organizationId: projectOrgId,
        project: projectData,
        permissions,
        reason: "Authorized via project membership"
      };
    }

    // 6. User has neither direct creation, nor supervisory override, nor explicit project membership
    return emptyResolution("User is not a member of this project");

  } catch (error: any) {
    console.error(`⚠️ resolveProjectAccess error for user ${userId} on project ${projectId}:`, error?.message);
    return emptyResolution(`Error evaluating project access: ${error?.message}`);
  }
}

function getPermissionField(permission: ProjectPermission): keyof ProjectPermissions {
  switch (permission) {
    case 'VIEW': return 'canView';
    case 'COMMENT': return 'canComment';
    case 'EDIT_CONTENT': return 'canEditContent';
    case 'MANAGE_PROJECT': return 'canManageProject';
    case 'MANAGE_MEMBERS': return 'canManageMembers';
    case 'DELETE_PROJECT': return 'canDeleteProject';
  }
}

/**
 * Server-side Project Authorization Helper.
 * Backward-compatible wrapper around resolveProjectAccess.
 */
export async function checkProjectAccess(
  db: admin.firestore.Firestore,
  userId: string,
  projectId: string,
  requiredRoles: string[] = ["owner", "admin", "member", "viewer"]
): Promise<{ 
  hasAccess: boolean; 
  isOwner: boolean; 
  role?: string;
  permissions?: ProjectPermissions;
  resolution?: ProjectAccessResolution;
}> {
  if (!userId || !projectId) {
    return { hasAccess: false, isOwner: false };
  }

  const resolution = await resolveProjectAccess(db, userId, projectId, { requiredRoles });
  return {
    hasAccess: resolution.hasAccess,
    isOwner: resolution.isOwner,
    role: resolution.role || undefined,
    permissions: resolution.permissions,
    resolution
  };
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

/**
 * Authoritative Platform Administrator Middleware Generator.
 * Enforces that caller is authenticated and possesses the platform 'admin' role.
 * Distinguishes platform administrators from tenant/organization roles (owner, org_admin, etc.).
 * Verifies via trusted Firebase ID Token custom claims first, with authoritative Firestore database fallback.
 */
export function requireAdmin(db: admin.firestore.Firestore) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user || !req.user.uid) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required."
      });
      return;
    }

    const userUid = req.user.uid;

    // 1. Authoritative check via verified token custom claims
    // The custom claim `role` is set strictly server-side to 'admin' | 'user'.
    // Tenant-scoped roles ('owner', 'org_admin', 'team_manager', 'member', 'viewer') do NOT grant platform admin access.
    if (req.user.role === 'admin') {
      next();
      return;
    }

    // 2. Authoritative Database verification fallback in Firestore /users/{uid}
    try {
      const userDoc = await db.collection("users").doc(userUid).get();
      if (userDoc.exists) {
        const userData = userDoc.data() || {};
        if (userData.role === 'admin') {
          // Sync custom claims in background for subsequent requests
          syncUserCustomClaims(userUid, db, { role: 'admin' }).catch(err => {
            console.warn("Background admin claim sync notice:", err?.message);
          });
          req.user.role = 'admin';
          next();
          return;
        }
      }

      // User is authenticated but is not a platform administrator
      console.warn(`🔒 [requireAdmin] Unauthorized access attempt to ${req.originalUrl || req.path} by user ${userUid} (email: ${req.user?.email || 'unknown'})`);
      res.status(403).json({
        error: "Forbidden",
        message: "Access denied. Platform administrator privileges required."
      });
      return;
    } catch (err: any) {
      console.error("⚠️ requireAdmin verification error:", err?.message || err);
      res.status(403).json({
        error: "Forbidden",
        message: "Access denied."
      });
      return;
    }
  };
}

/**
 * Authoritative Platform Administrator Middleware.
 * Validates the Firebase ID token and verifies that the caller has:
 * 1. The 'platform_admin' custom claim (or platform role 'admin') set server-side
 *    OR
 * 2. Authoritative role 'admin' in Firestore /users/{uid} document.
 * 
 * Tenant-scoped roles (owner, org_admin, etc.) and hardcoded emails DO NOT grant platform admin access.
 */
export async function requirePlatformAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. Validate Firebase Token if not already decoded
  if (!req.user) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Missing or invalid Authorization header. Expected 'Bearer <token>'."
      });
      return;
    }

    const token = authHeader.split("Bearer ")[1]?.trim();
    if (!token) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication token missing from Authorization header."
      });
      return;
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      const userClaims: any = { ...decodedToken };
      if (decodedToken.orgRole) {
        userClaims.orgRole = normalizeOrgRole(decodedToken.orgRole as string);
      }
      req.user = userClaims;
    } catch (error: any) {
      console.error("🔒 [requirePlatformAdmin] Token verification failed:", error?.message || error);
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid, expired, or revoked authentication token.",
        code: error?.code || "auth/invalid-token"
      });
      return;
    }
  }

  // 2. Authoritative check: verified server-side custom claim
  const hasPlatformAdminClaim = Boolean(
    req.user.platform_admin === true ||
    req.user.role === "admin" ||
    (req.user as any)?.claims?.platform_admin === true
  );

  if (hasPlatformAdminClaim) {
    next();
    return;
  }

  // 3. Fallback: Authoritative server database lookup in Firestore /users/{uid}
  try {
    const db = getAdminFirestore();
    const userDoc = await db.collection("users").doc(req.user.uid).get();
    if (userDoc.exists) {
      const userData = userDoc.data() || {};
      if (userData.role === "admin" || userData.platform_admin === true) {
        req.user.role = "admin";
        req.user.platform_admin = true;
        // Background sync claims for subsequent requests
        syncUserCustomClaims(req.user.uid, db, { role: "admin" }).catch(err => {
          console.warn("Background admin claim sync notice:", err?.message);
        });
        next();
        return;
      }
    }
  } catch (dbErr: any) {
    console.warn("🔒 [requirePlatformAdmin] Firestore lookup error:", dbErr?.message);
  }

  // 4. Unauthorized
  console.warn(`🔒 [requirePlatformAdmin] Unauthorized platform admin attempt by ${req.user.uid} (${req.user.email || 'unknown'}) on ${req.originalUrl || req.path}`);
  res.status(403).json({
    error: "Forbidden",
    message: "Access denied. Platform administrator privileges required."
  });
}

/**
 * Sanitizes incoming client claims to prevent privilege escalation in enterprise SSO & JIT flows.
 */
export function sanitizeSsoClaims(claims: any): Record<string, any> {
  if (!claims || typeof claims !== 'object') return {};
  const sanitized: Record<string, any> = {};
  const blockedKeys = new Set([
    'role', 'orgrole', 'platform_admin', 'admin', 'owner', 'isowner', 
    'org_admin', 'super_admin', 'superadmin', 'is_owner', 'ownership'
  ]);
  for (const [k, v] of Object.entries(claims)) {
    if (!blockedKeys.has(k.toLowerCase().trim())) {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

/**
 * Authorizes recording access for an authenticated user.
 */
export async function authorizeRecordingAccess(
  db: admin.firestore.Firestore,
  user: { uid: string; email?: string; platform_admin?: boolean; role?: string; orgRole?: string; [key: string]: any },
  recordingId: string,
  options?: { 
    allowDeleted?: boolean;
    requiredAction?: 'VIEW' | 'COMMENT' | 'EDIT_CONTENT' | 'DELETE';
  }
): Promise<{ 
  authorized: boolean; 
  record?: any; 
  status: number; 
  message: string;
  role?: TargetProjectRole | null;
  isOwner?: boolean;
  isPlatformAdmin?: boolean;
  isOrgAdmin?: boolean;
  permissions?: {
    canView: boolean;
    canComment: boolean;
    canEditContent: boolean;
    canDelete: boolean;
  };
}> {
  if (!user || !user.uid) {
    return { authorized: false, status: 401, message: "Authentication required" };
  }

  const isPlatformAdmin = Boolean(
    user.platform_admin === true ||
    user.role === 'admin' ||
    (user as any)?.claims?.platform_admin === true
  );

  // 1. Fetch record from 'recordings' or fallback to 'transcriptions'
  let recordDoc = await db.collection("recordings").doc(recordingId).get();
  if (!recordDoc.exists) {
    recordDoc = await db.collection("transcriptions").doc(recordingId).get();
  }

  if (!recordDoc.exists) {
    return { authorized: false, status: 404, message: "Recording not found" };
  }

  const record = recordDoc.data() || {};
  record.id = recordDoc.id;

  // Block access to soft-deleted recordings unless explicitly allowed
  if (record.deletedAt && !options?.allowDeleted) {
    return { authorized: false, status: 410, message: "Recording has been deleted and cannot be accessed." };
  }

  // Platform administrator operational override
  if (isPlatformAdmin) {
    return { 
      authorized: true, 
      record, 
      status: 200, 
      message: "Authorized as platform admin",
      role: 'owner',
      isOwner: true,
      isPlatformAdmin: true,
      permissions: { canView: true, canComment: true, canEditContent: true, canDelete: true }
    };
  }

  const userEmail = (user.email || "").toLowerCase().trim();
  const recordOrgId = record.orgId || record.organizationId;
  let isOrgSupervisor = false;

  // 2. Organization Scoping & Tenant Boundary Check
  if (recordOrgId) {
    if (userEmail) {
      try {
        const orgDoc = await db.collection("organizations").doc(recordOrgId).get();
        if (orgDoc.exists) {
          const orgData = orgDoc.data() || {};
          if (orgData.ownerId === user.uid || (orgData.ownerEmail && orgData.ownerEmail.toLowerCase() === userEmail)) {
            isOrgSupervisor = true;
          }
        }
      } catch (e) {
        // ignore
      }

      if (!isOrgSupervisor) {
        const orgAccess = await checkOrgAccess(db, userEmail, recordOrgId, ["owner", "org_admin", "team_manager", "member", "viewer"]);
        if (!orgAccess.hasAccess) {
          // Tenant isolation: caller does not belong to the organization owning this recording!
          return { authorized: false, status: 403, message: "Tenant isolation: Access denied to organization recording." };
        }
        if (orgAccess.role === 'owner' || orgAccess.role === 'org_admin') {
          isOrgSupervisor = true;
        }
      }
    } else {
      return { authorized: false, status: 403, message: "Tenant isolation: Missing verified email for organization verification." };
    }

    // Org Owner / Org Admin retain supervisory access to all organization recordings
    if (isOrgSupervisor) {
      return {
        authorized: true,
        record,
        status: 200,
        message: "Authorized via organization administrative supervisor",
        role: 'admin',
        isOwner: record.userId === user.uid,
        isOrgAdmin: true,
        permissions: { canView: true, canComment: true, canEditContent: true, canDelete: true }
      };
    }
  }

  // 3. Project-level membership resolution
  const projectId = record.projectId;
  if (projectId) {
    const projAccess = await resolveProjectAccess(db, user, projectId);
    if (projAccess.hasAccess) {
      const pRole = projAccess.role;
      const isRecOwner = record.userId === user.uid;
      const isProjOwner = projAccess.isOwner || projAccess.isDirectCreator;

      const canView = true;
      const canComment = pRole === 'owner' || pRole === 'admin' || pRole === 'commenter';
      const canEditContent = pRole === 'owner' || pRole === 'admin' || isRecOwner;
      const canDelete = isRecOwner || isProjOwner || projAccess.isOrgAdmin;

      if (options?.requiredAction === 'DELETE' && !canDelete) {
        return { authorized: false, status: 403, message: "Permission denied: Only the recording owner or project administrator can delete this recording." };
      }
      if (options?.requiredAction === 'EDIT_CONTENT' && !canEditContent) {
        return { authorized: false, status: 403, message: "Permission denied: Your role does not allow editing or mutating this recording." };
      }
      if (options?.requiredAction === 'COMMENT' && !canComment) {
        return { authorized: false, status: 403, message: "Permission denied: Your role does not allow commenting on this recording." };
      }

      return {
        authorized: true,
        record,
        status: 200,
        message: `Authorized via project ${pRole} role`,
        role: pRole,
        isOwner: isRecOwner || isProjOwner,
        permissions: { canView, canComment, canEditContent, canDelete }
      };
    }
  }

  // 4. Direct ownership of the recording
  if (record.userId === user.uid) {
    return {
      authorized: true,
      record,
      status: 200,
      message: "Authorized as recording owner",
      role: 'owner',
      isOwner: true,
      permissions: { canView: true, canComment: true, canEditContent: true, canDelete: true }
    };
  }

  // 5. Explicit collaborators list (read/comment only; no edit content or deletion)
  if (Array.isArray(record.collaborators)) {
    const isCollaborator = record.collaborators.some((c: any) => 
      c === user.uid ||
      c?.userId === user.uid ||
      (c?.email && userEmail && c.email.toLowerCase() === userEmail)
    );
    if (isCollaborator) {
      if (options?.requiredAction === 'DELETE' || options?.requiredAction === 'EDIT_CONTENT') {
        return { authorized: false, status: 403, message: "Collaborators have view and comment access only." };
      }
      return { 
        authorized: true, 
        record, 
        status: 200, 
        message: "Authorized as collaborator",
        role: 'commenter',
        isOwner: false,
        permissions: { canView: true, canComment: true, canEditContent: false, canDelete: false }
      };
    }
  }

  return { authorized: false, status: 403, message: "Access denied. You do not have permission to access this recording." };
}

/**
 * Unified resource access verification for AI inference and media conversion pipelines.
 */
export async function verifyAiResourceAccess(
  db: admin.firestore.Firestore,
  user: any,
  options: {
    recordingId?: string | null;
    projectId?: string | null;
    operationType: 'read' | 'write';
  }
): Promise<{
  allowed: boolean;
  status: number;
  message: string;
  record?: any;
  project?: any;
  role?: TargetProjectRole | null;
}> {
  if (!user || !user.uid) {
    return { allowed: false, status: 401, message: "Authentication required" };
  }

  let resolvedRecord: any = null;
  let resolvedProject: any = null;
  let effectiveRole: TargetProjectRole | null = null;

  // 1. Verify recording if supplied
  if (options.recordingId && typeof options.recordingId === 'string' && options.recordingId.trim() !== '' && options.recordingId !== 'none') {
    const recAuth = await authorizeRecordingAccess(db, user, options.recordingId.trim(), {
      requiredAction: options.operationType === 'write' ? 'EDIT_CONTENT' : 'VIEW'
    });
    if (!recAuth.authorized) {
      return { allowed: false, status: recAuth.status, message: recAuth.message };
    }
    resolvedRecord = recAuth.record;
    effectiveRole = recAuth.role || null;
  }

  // 2. Verify project if supplied
  if (options.projectId && typeof options.projectId === 'string' && options.projectId.trim() !== '' && options.projectId !== 'none') {
    const projAuth = await resolveProjectAccess(db, user, options.projectId.trim(), {
      requiredPermission: options.operationType === 'write' ? 'EDIT_CONTENT' : 'VIEW'
    });
    if (!projAuth.hasAccess) {
      return { 
        allowed: false, 
        status: projAuth.notFound ? 404 : 403, 
        message: projAuth.reason || "Access denied to requested project." 
      };
    }
    resolvedProject = projAuth.project;
    if (!effectiveRole) {
      effectiveRole = projAuth.role;
    }
  }

  // 3. Verify cross-resource match if both recordingId and projectId were supplied
  if (resolvedRecord && options.projectId && typeof options.projectId === 'string' && options.projectId.trim() !== '' && options.projectId !== 'none') {
    const recProjId = resolvedRecord.projectId;
    if (recProjId && recProjId !== options.projectId.trim()) {
      return {
        allowed: false,
        status: 400,
        message: "Resource mismatch: Specified recording does not belong to the specified project."
      };
    }
  }

  return {
    allowed: true,
    status: 200,
    message: "Authorized",
    record: resolvedRecord,
    project: resolvedProject,
    role: effectiveRole
  };
}


