import admin from "firebase-admin";
import { 
  AuthoritativeOrgRole, 
  OrgIdentityMapping, 
  OrgJitSettings, 
  OrgMember 
} from "../types.js";
import { 
  normalizeOrgRole, 
  ROLE_HIERARCHY, 
  syncUserCustomClaims, 
  recordOrgAuditEvent 
} from "../middleware/auth.js";

export interface JitUserContext {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  provider: 'entra' | 'saml' | 'google' | 'oidc';
  groups?: string[];
  department?: string;
  jobTitle?: string;
  claims?: Record<string, any>;
  tenantId?: string;
}

export interface JitEvaluationResult {
  allowed: boolean;
  isMember: boolean;
  role?: AuthoritativeOrgRole;
  departmentId?: string;
  departmentName?: string;
  status: 'active' | 'pending' | 'deactivated';
  isNewUser?: boolean;
  wasProvisioned?: boolean;
  roleChanged?: boolean;
  departmentChanged?: boolean;
  conflictDetected?: boolean;
  reason?: string;
  message: string;
}

/**
 * Evaluate group and attribute mappings against an incoming enterprise identity context.
 * Implements deterministic priority sorting, conflict resolution (safest lower privilege),
 * and high-privilege protection (Owner is NEVER assigned via JIT).
 */
export async function evaluateIdentityMappings(
  db: admin.firestore.Firestore,
  orgId: string,
  userContext: JitUserContext,
  defaultRole: AuthoritativeOrgRole = 'member',
  defaultDepartmentId?: string
): Promise<{
  targetRole: AuthoritativeOrgRole;
  targetDepartmentId?: string;
  targetDepartmentName?: string;
  appliedMapping?: OrgIdentityMapping;
  conflictDetected?: boolean;
}> {
  try {
    // 1. Fetch active identity mappings for this organization
    const mappingsSnap = await db
      .collection("orgIdentityMappings")
      .where("orgId", "==", orgId)
      .where("enabled", "==", true)
      .get();

    if (mappingsSnap.empty) {
      return {
        targetRole: defaultRole,
        targetDepartmentId: defaultDepartmentId || undefined
      };
    }

    const allMappings: OrgIdentityMapping[] = mappingsSnap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        orgId: data.orgId,
        provider: data.provider || 'all',
        sourceType: data.sourceType || 'group',
        sourceValue: (data.sourceValue || '').trim(),
        targetRole: normalizeOrgRole(data.targetRole),
        targetDepartmentId: data.targetDepartmentId || undefined,
        targetDepartmentName: data.targetDepartmentName || undefined,
        enabled: data.enabled !== false,
        priority: typeof data.priority === 'number' ? data.priority : 10,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      };
    });

    // 2. Filter matching mappings
    const matchedMappings: OrgIdentityMapping[] = [];

    for (const mapping of allMappings) {
      // Provider matching
      if (mapping.provider !== 'all' && mapping.provider !== userContext.provider) {
        continue;
      }

      const matchVal = mapping.sourceValue.toLowerCase();

      if (mapping.sourceType === 'group' && Array.isArray(userContext.groups)) {
        const hasGroup = userContext.groups.some(g => (g || '').toLowerCase().trim() === matchVal);
        if (hasGroup) matchedMappings.push(mapping);
      } else if (mapping.sourceType === 'department' && userContext.department) {
        if (userContext.department.toLowerCase().trim() === matchVal) {
          matchedMappings.push(mapping);
        }
      } else if (mapping.sourceType === 'job_title' && userContext.jobTitle) {
        if (userContext.jobTitle.toLowerCase().trim() === matchVal) {
          matchedMappings.push(mapping);
        }
      } else if (mapping.sourceType === 'claim' && userContext.claims) {
        // e.g. key=value match
        if (mapping.sourceValue.includes('=')) {
          const [cKey, cVal] = mapping.sourceValue.split('=').map(s => s.trim().toLowerCase());
          const actualClaimVal = String(userContext.claims[cKey] || '').toLowerCase().trim();
          if (actualClaimVal === cVal) {
            matchedMappings.push(mapping);
          }
        }
      }
    }

    if (matchedMappings.length === 0) {
      return {
        targetRole: defaultRole,
        targetDepartmentId: defaultDepartmentId || undefined
      };
    }

    // 3. Sort matches by priority DESC, createdAt ASC
    matchedMappings.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    const topPriority = matchedMappings[0].priority;
    const topMatches = matchedMappings.filter(m => m.priority === topPriority);

    // 4. Conflict Resolution for equal top-priority mappings
    if (topMatches.length > 1) {
      // Check if roles conflict
      const uniqueRoles = Array.from(new Set(topMatches.map(m => m.targetRole)));
      let chosenRole = topMatches[0].targetRole;
      let conflictDetected = false;

      if (uniqueRoles.length > 1) {
        conflictDetected = true;
        // Deterministic Safe rule: Pick the lower privilege rank to fail safely
        topMatches.sort((a, b) => (ROLE_HIERARCHY[a.targetRole] || 1) - (ROLE_HIERARCHY[b.targetRole] || 1));
        chosenRole = topMatches[0].targetRole;

        console.warn(`⚠️ [JIT CONFLICT] Equal priority mapping conflict for ${userContext.email}. Resolved safely to lowest privilege: ${chosenRole}`);
      }

      // Owner is NEVER assigned via JIT
      if (chosenRole === 'owner') {
        chosenRole = 'org_admin';
      }

      const chosenMapping = topMatches[0];
      return {
        targetRole: chosenRole,
        targetDepartmentId: chosenMapping.targetDepartmentId || defaultDepartmentId || undefined,
        targetDepartmentName: chosenMapping.targetDepartmentName || undefined,
        appliedMapping: chosenMapping,
        conflictDetected
      };
    }

    // Single top match
    const primary = topMatches[0];
    let role = primary.targetRole;
    if (role === 'owner') {
      role = 'org_admin';
    }

    return {
      targetRole: role,
      targetDepartmentId: primary.targetDepartmentId || defaultDepartmentId || undefined,
      targetDepartmentName: primary.targetDepartmentName || undefined,
      appliedMapping: primary,
      conflictDetected: false
    };

  } catch (error: any) {
    console.error("⚠️ evaluateIdentityMappings failed:", error);
    return {
      targetRole: defaultRole,
      targetDepartmentId: defaultDepartmentId || undefined
    };
  }
}

/**
 * Authoritatively process Just-In-Time Provisioning or Identity Attribute Synchronization.
 * Called directly during enterprise SSO validation (Entra ID, SAML 2.0, Google Enterprise OIDC).
 */
export async function processEnterpriseJitOrSync(
  db: admin.firestore.Firestore,
  orgId: string,
  orgData: any,
  userContext: JitUserContext
): Promise<JitEvaluationResult> {
  const callerUid = userContext.uid;
  const callerEmail = userContext.email.toLowerCase().trim();
  const callerName = userContext.displayName || callerEmail.split('@')[0] || "Enterprise User";
  const callerPhoto = userContext.photoURL || "";

  // 1. Read Organization Security & JIT Settings
  const sec = orgData.securitySettings || {};
  const jitCfg: OrgJitSettings = sec.jitSettings || {
    jitProvisioningEnabled: sec.ssoConfig?.jitEnabled !== false && orgData.settings?.jitProvisioningEnabled !== false,
    provisioningMode: 'jit_allowed',
    defaultJitRole: 'member',
    roleManagementMode: 'manual',
    syncIdentityAttributes: true,
    syncGroups: true,
    autoDeactivateRemovedUsers: false
  };

  const isJitEnabled = jitCfg.jitProvisioningEnabled !== false && jitCfg.provisioningMode !== 'invitation_required';
  const defaultJitRole = normalizeOrgRole(jitCfg.defaultJitRole || 'member');
  const defaultDeptId = jitCfg.defaultDepartmentId;

  // 2. Check for existing organization membership
  const memberSnap = await db
    .collection("orgMembers")
    .where("orgId", "==", orgId)
    .where("email", "==", callerEmail)
    .limit(1)
    .get();

  if (!memberSnap.empty) {
    // -------------------------------------------------------------
    // EXISTING MEMBER FLOW: Synchronize safe identity fields & IdP-Managed roles
    // -------------------------------------------------------------
    const memberDoc = memberSnap.docs[0];
    const memberData = memberDoc.data() || {};

    // 2a. Check if deactivated
    if (memberData.status === 'deactivated') {
      await admin.auth().setCustomUserClaims(callerUid, { orgId: null, orgRole: null });

      await recordOrgAuditEvent(db, {
        organizationId: orgId,
        actorUserId: callerUid,
        actorEmail: callerEmail,
        action: "JIT_PROVISIONING_BLOCKED",
        timestamp: new Date().toISOString(),
        source: `sso_${userContext.provider}`,
        details: `Deactivated member ${callerEmail} attempted SSO login. Access denied.`,
        metadata: { reason: "MEMBER_DEACTIVATED", provider: userContext.provider }
      });

      return {
        allowed: false,
        isMember: true,
        status: 'deactivated',
        reason: 'MEMBER_DEACTIVATED',
        message: "Your organization membership has been deactivated by an administrator."
      };
    }

    // 2b. Sync safe user profile fields in users collection (preserve usage/plan/billing)
    try {
      const userRef = db.collection("users").doc(callerUid);
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        await userRef.update({
          lastLoginAt: new Date().toISOString(),
          identityProvider: userContext.provider,
          ...(callerName ? { displayName: callerName } : {}),
          ...(callerPhoto ? { photoURL: callerPhoto } : {})
        });

        await recordOrgAuditEvent(db, {
          organizationId: orgId,
          actorUserId: callerUid,
          actorEmail: callerEmail,
          action: "JIT_USER_UPDATED",
          timestamp: new Date().toISOString(),
          source: `sso_${userContext.provider}`,
          details: `Synchronized profile for existing user ${callerEmail}`,
          metadata: { provider: userContext.provider }
        });
      }
    } catch (e: any) {
      console.warn("⚠️ JIT User profile sync notice:", e.message);
    }

    let currentRole = normalizeOrgRole(memberData.role);
    let currentDeptId = memberData.departmentId;
    let roleChanged = false;
    let deptChanged = false;

    // 2c. If IDP-Managed Role mode is active, evaluate group and attribute synchronization
    if (jitCfg.roleManagementMode === 'idp_managed' && (jitCfg.syncGroups || jitCfg.syncIdentityAttributes)) {
      // Owner is protected from IdP group modifications
      if (currentRole !== 'owner') {
        const mappingResult = await evaluateIdentityMappings(
          db, 
          orgId, 
          userContext, 
          defaultJitRole, 
          defaultDeptId
        );

        const removedGroupBehavior = jitCfg.removedGroupBehavior || (jitCfg.autoDeactivateRemovedUsers ? 'DEACTIVATE_MEMBER' : 'REVERT_TO_DEFAULT_ROLE');

        // Check if user matched any active mapping
        if (!mappingResult.appliedMapping) {
          // User was removed from IdP groups / has no matching rule
          if (removedGroupBehavior === 'DEACTIVATE_MEMBER') {
            // Apply deactivation policy
            await memberDoc.ref.update({
              status: 'deactivated',
              lastActive: new Date().toISOString(),
              deactivatedAt: new Date().toISOString(),
              deactivationReason: 'IDP_GROUP_REMOVED'
            });

            await admin.auth().setCustomUserClaims(callerUid, { orgId: null, orgRole: null });

            await recordOrgAuditEvent(db, {
              organizationId: orgId,
              actorUserId: callerUid,
              actorEmail: callerEmail,
              action: "MEMBER_DEACTIVATED",
              timestamp: new Date().toISOString(),
              source: `sso_${userContext.provider}`,
              details: `User ${callerEmail} was deactivated per organization policy because they no longer belong to any mapped IdP groups.`,
              metadata: { removedGroupBehavior: 'DEACTIVATE_MEMBER', provider: userContext.provider }
            });

            return {
              allowed: false,
              isMember: true,
              status: 'deactivated',
              reason: 'MEMBER_DEACTIVATED',
              message: "Your organization membership has been deactivated per organization identity policy."
            };
          } else if (removedGroupBehavior === 'REVERT_TO_DEFAULT_ROLE') {
            if (currentRole !== defaultJitRole) {
              const oldRole = currentRole;
              currentRole = defaultJitRole;
              roleChanged = true;

              await recordOrgAuditEvent(db, {
                organizationId: orgId,
                actorUserId: callerUid,
                actorEmail: callerEmail,
                previousRole: oldRole,
                newRole: currentRole,
                action: "JIT_ROLE_CHANGED",
                timestamp: new Date().toISOString(),
                source: `sso_${userContext.provider}`,
                details: `User ${callerEmail} reverted from ${oldRole} to default role ${currentRole} due to IdP group removal.`,
                metadata: { removedGroupBehavior: 'REVERT_TO_DEFAULT_ROLE' }
              });
            }
          } else if (removedGroupBehavior === 'REMOVE_DEPARTMENT') {
            if (currentDeptId) {
              currentDeptId = null;
              deptChanged = true;

              await recordOrgAuditEvent(db, {
                organizationId: orgId,
                actorUserId: callerUid,
                actorEmail: callerEmail,
                action: "JIT_DEPARTMENT_ASSIGNED",
                timestamp: new Date().toISOString(),
                source: `sso_${userContext.provider}`,
                details: `Department membership cleared for ${callerEmail} per group removal policy.`,
                metadata: { removedGroupBehavior: 'REMOVE_DEPARTMENT' }
              });
            }
          }
        } else {
          // User matched an active mapping
          if (mappingResult.targetRole && mappingResult.targetRole !== currentRole) {
            const oldRole = currentRole;
            currentRole = mappingResult.targetRole;
            roleChanged = true;

            await recordOrgAuditEvent(db, {
              organizationId: orgId,
              actorUserId: callerUid,
              actorEmail: callerEmail,
              previousRole: oldRole,
              newRole: currentRole,
              action: "JIT_ROLE_CHANGED",
              timestamp: new Date().toISOString(),
              source: `sso_${userContext.provider}`,
              details: `IDP-Managed role sync updated ${callerEmail} from ${oldRole} to ${currentRole}`,
              metadata: { 
                mappingId: mappingResult.appliedMapping?.id,
                sourceValue: mappingResult.appliedMapping?.sourceValue
              }
            });
          }

          if (mappingResult.targetDepartmentId && mappingResult.targetDepartmentId !== currentDeptId) {
            currentDeptId = mappingResult.targetDepartmentId;
            deptChanged = true;

            await recordOrgAuditEvent(db, {
              organizationId: orgId,
              actorUserId: callerUid,
              actorEmail: callerEmail,
              action: "JIT_DEPARTMENT_ASSIGNED",
              timestamp: new Date().toISOString(),
              source: `sso_${userContext.provider}`,
              details: `Assigned department ${mappingResult.targetDepartmentName || currentDeptId} to ${callerEmail}`,
              metadata: { departmentId: currentDeptId }
            });
          }
        }
      }
    }

    // 2d. Update member document with latest sync metadata
    const updatePayload: any = {
      userId: callerUid,
      lastActive: new Date().toISOString(),
      ...(roleChanged ? { role: currentRole } : {}),
      ...(deptChanged ? { departmentId: currentDeptId } : {}),
      syncedGroups: userContext.groups || memberData.syncedGroups || [],
      syncedAttributes: {
        department: userContext.department || null,
        jobTitle: userContext.jobTitle || null
      }
    };

    await memberDoc.ref.update(updatePayload);

    // Synchronize custom claims
    await syncUserCustomClaims(callerUid, db, {
      orgId,
      orgRole: currentRole
    });

    return {
      allowed: true,
      isMember: true,
      role: currentRole,
      departmentId: currentDeptId,
      status: 'active',
      isNewUser: false,
      wasProvisioned: false,
      roleChanged,
      departmentChanged: deptChanged,
      message: "Enterprise identity synchronized successfully."
    };
  }

  // -------------------------------------------------------------
  // NEW USER / JIT PROVISIONING FLOW
  // -------------------------------------------------------------
  if (!isJitEnabled) {
    // JIT is disabled or Invitation Required
    await recordOrgAuditEvent(db, {
      organizationId: orgId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      action: "JIT_PROVISIONING_BLOCKED",
      timestamp: new Date().toISOString(),
      source: `sso_${userContext.provider}`,
      details: `JIT Provisioning blocked for ${callerEmail} (Organization requires invitation or JIT is disabled).`,
      metadata: { 
        provisioningMode: jitCfg.provisioningMode,
        jitProvisioningEnabled: jitCfg.jitProvisioningEnabled
      }
    });

    return {
      allowed: false,
      isMember: false,
      status: 'pending',
      reason: 'INVITATION_REQUIRED',
      message: "Authenticated successfully with enterprise IdP. Organization membership requires an invitation from an administrator."
    };
  }

  // 3. JIT is ENABLED: Evaluate initial role and department
  const mappingResult = await evaluateIdentityMappings(
    db, 
    orgId, 
    userContext, 
    defaultJitRole, 
    defaultDeptId
  );

  const initialRole = mappingResult.targetRole;
  const initialDeptId = mappingResult.targetDepartmentId || defaultDeptId || null;
  const initialDeptName = mappingResult.targetDepartmentName || null;

  // 4. Ensure User document exists in `users` collection
  const userRef = db.collection("users").doc(callerUid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    await userRef.set({
      id: callerUid,
      email: callerEmail,
      displayName: callerName,
      photoURL: callerPhoto,
      role: 'user',
      plan: orgData.plan || 'enterprise',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      identityProvider: userContext.provider
    });

    await recordOrgAuditEvent(db, {
      organizationId: orgId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      action: "JIT_USER_CREATED",
      timestamp: new Date().toISOString(),
      source: `sso_${userContext.provider}`,
      details: `Created new EchoNote user profile for ${callerEmail} via JIT`,
      metadata: { provider: userContext.provider }
    });
  } else {
    await userRef.update({
      lastLoginAt: new Date().toISOString(),
      identityProvider: userContext.provider,
      ...(callerName ? { displayName: callerName } : {}),
      ...(callerPhoto ? { photoURL: callerPhoto } : {})
    });
  }

  // 5. Create Organization Membership in `orgMembers`
  const memberId = `member_${callerUid.slice(0, 8)}_${Date.now().toString(36)}`;
  await db.collection("orgMembers").doc(memberId).set({
    id: memberId,
    orgId,
    userId: callerUid,
    email: callerEmail,
    name: callerName,
    displayName: callerName,
    role: initialRole,
    departmentId: initialDeptId,
    departmentName: initialDeptName,
    status: 'active',
    provisionedVia: 'jit',
    identityProvider: userContext.provider,
    syncedGroups: userContext.groups || [],
    syncedAttributes: {
      department: userContext.department || null,
      jobTitle: userContext.jobTitle || null
    },
    joinedAt: new Date().toISOString(),
    lastActive: new Date().toISOString()
  });

  // 6. Synchronize Firebase Custom Claims
  await syncUserCustomClaims(callerUid, db, {
    orgId,
    orgRole: initialRole
  });

  // 7. Record JIT Audit Events
  await recordOrgAuditEvent(db, {
    organizationId: orgId,
    actorUserId: callerUid,
    actorEmail: callerEmail,
    action: "JIT_MEMBER_CREATED",
    timestamp: new Date().toISOString(),
    source: `sso_${userContext.provider}`,
    details: `JIT provisioned organization member ${callerEmail} with role ${initialRole}`,
    metadata: {
      memberId,
      role: initialRole,
      departmentId: initialDeptId,
      provider: userContext.provider,
      mappingId: mappingResult.appliedMapping?.id || null
    }
  });

  await recordOrgAuditEvent(db, {
    organizationId: orgId,
    actorUserId: callerUid,
    actorEmail: callerEmail,
    newRole: initialRole,
    action: "JIT_ROLE_ASSIGNED",
    timestamp: new Date().toISOString(),
    source: `sso_${userContext.provider}`,
    details: `Assigned initial role ${initialRole} to ${callerEmail}`,
    metadata: {
      role: initialRole,
      wasMapped: Boolean(mappingResult.appliedMapping)
    }
  });

  if (initialDeptId) {
    await recordOrgAuditEvent(db, {
      organizationId: orgId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      action: "JIT_DEPARTMENT_ASSIGNED",
      timestamp: new Date().toISOString(),
      source: `sso_${userContext.provider}`,
      details: `Assigned department ${initialDeptName || initialDeptId} to ${callerEmail}`,
      metadata: { departmentId: initialDeptId }
    });
  }

  if (mappingResult.appliedMapping) {
    await recordOrgAuditEvent(db, {
      organizationId: orgId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      action: "JIT_MAPPING_APPLIED",
      timestamp: new Date().toISOString(),
      source: `sso_${userContext.provider}`,
      details: `Applied identity mapping (${mappingResult.appliedMapping.sourceType}:${mappingResult.appliedMapping.sourceValue} → ${mappingResult.appliedMapping.targetRole}) to ${callerEmail}`,
      metadata: {
        mappingId: mappingResult.appliedMapping.id,
        sourceType: mappingResult.appliedMapping.sourceType,
        sourceValue: mappingResult.appliedMapping.sourceValue,
        targetRole: mappingResult.appliedMapping.targetRole
      }
    });
  }

  if (mappingResult.conflictDetected) {
    await recordOrgAuditEvent(db, {
      organizationId: orgId,
      actorUserId: callerUid,
      actorEmail: callerEmail,
      action: "JIT_MAPPING_CONFLICT",
      timestamp: new Date().toISOString(),
      source: `sso_${userContext.provider}`,
      details: `Detected conflicting role mappings for ${callerEmail}. Safely applied lowest privilege: ${initialRole}`,
      metadata: { resolvedRole: initialRole }
    });
  }

  return {
    allowed: true,
    isMember: true,
    role: initialRole,
    departmentId: initialDeptId || undefined,
    departmentName: initialDeptName || undefined,
    status: 'active',
    isNewUser: true,
    wasProvisioned: true,
    conflictDetected: mappingResult.conflictDetected,
    message: `Enterprise Just-In-Time provisioning complete. Welcome to ${orgData.name || 'EchoNote'}!`
  };
}
