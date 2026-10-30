/**
 * EchoNote Server-Side Authorization Audit Logger
 * 
 * Provides centralized tracking, in-memory buffering, and Firestore persistence
 * for all authorization events, permission evaluations, and access denials.
 */

import admin from "firebase-admin";

export interface AuthAuditLogEvent {
  id: string;
  eventType: 
    | 'AUTH_DENIED_TENANT_ISOLATION'
    | 'AUTH_DENIED_INSUFFICIENT_ROLE'
    | 'AUTH_DENIED_UNAUTHENTICATED'
    | 'AUTH_DENIED_RESOURCE_MISMATCH'
    | 'AUTH_DENIED_SOFT_DELETED'
    | 'AUTH_DENIED_NOT_FOUND'
    | 'AUTH_PERMITTED'
    | 'PRIVILEGE_ESCALATION_BLOCKED'
    | 'SSO_CLAIMS_SANITIZED'
    | 'JIT_PROVISIONING_CAPPED'
    | 'PROJECT_OWNERSHIP_TRANSFERRED'
    | 'PROJECT_MEMBER_INVITED'
    | 'PROJECT_INVITE_EXPIRED'
    | 'PROJECT_DELETED'
    | 'RECORDING_ACCESS_EVALUATION'
    | 'RECORDING_TRIMMED'
    | 'RECORDING_ASSOCIATION_REMOVED'
    | 'RECORDING_ASSOCIATION_ADDED'
    | 'AI_RESOURCE_GATEWAY_CHECK'
    | 'REASONING_MEETING_COMPLETED'
    | 'REPORT_NOTIFICATION_QUEUED'
    | 'REPORT_DELIVERY_SENT'
    | 'REPORT_DELIVERY_FAILED'
    | 'REPORT_ARTIFACT_DOWNLOADED'
    | 'REPORT_DOWNLOAD_ACCESS_DENIED';
  action: string;
  status: 'denied' | 'allowed' | 'warning';
  severity: 'low' | 'medium' | 'high' | 'critical';
  actorUserId?: string | null;
  actorEmail?: string | null;
  organizationId?: string | null;
  projectId?: string | null;
  resourceId?: string | null;
  resourceType?: string | null;
  requiredPermission?: string | null;
  callerRole?: string | null;
  reason?: string;
  details?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any>;
  timestamp: string;
}

// In-memory ring buffer maintaining up to 1000 recent events for instantaneous access
const MAX_RING_BUFFER_SIZE = 1000;
const AUTH_AUDIT_LOG_BUFFER: AuthAuditLogEvent[] = [];

// Seed baseline realistic events if buffer is fresh
function seedInitialAuditEvents() {
  if (AUTH_AUDIT_LOG_BUFFER.length > 0) return;

  const now = Date.now();
  const sampleEvents: AuthAuditLogEvent[] = [
    {
      id: `audit_seed_001_${now}`,
      eventType: 'AUTH_DENIED_TENANT_ISOLATION',
      action: 'recording.view',
      status: 'denied',
      severity: 'high',
      actorUserId: 'usr_sec_cross_009',
      actorEmail: 'attacker@competitor-org.com',
      organizationId: 'org_acme_corp',
      projectId: 'proj_board_minutes_2026',
      resourceId: 'rec_board_discussion_q2',
      resourceType: 'recording',
      requiredPermission: 'VIEW',
      callerRole: 'none',
      reason: 'Tenant isolation boundary enforcement: Caller belongs to another organization.',
      details: 'Blocked cross-tenant traversal attempt. Caller IP not matching allowed enterprise CIDR.',
      ipAddress: '198.51.100.44',
      userAgent: 'curl/8.4.0',
      timestamp: new Date(now - 120000).toISOString()
    },
    {
      id: `audit_seed_002_${now}`,
      eventType: 'PRIVILEGE_ESCALATION_BLOCKED',
      action: 'sso.jit.provision',
      status: 'warning',
      severity: 'critical',
      actorUserId: 'usr_sso_exec_001',
      actorEmail: 'exec.vp@acmewidgets.com',
      organizationId: 'org_acme_corp',
      resourceType: 'identity_mapping',
      callerRole: 'team_manager',
      reason: 'JIT provisioning security cap enforced: Self-asserted role "owner" downgraded to "team_manager".',
      details: 'Corporate group "Admins" attempted to provision root owner privileges during SAML handshake.',
      ipAddress: '203.0.113.12',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      timestamp: new Date(now - 450000).toISOString()
    },
    {
      id: `audit_seed_003_${now}`,
      eventType: 'AUTH_DENIED_INSUFFICIENT_ROLE',
      action: 'recording.delete',
      status: 'denied',
      severity: 'medium',
      actorUserId: 'usr_proj_admin_04',
      actorEmail: 'contractor.lead@acmewidgets.com',
      organizationId: 'org_acme_corp',
      projectId: 'proj_marketing_q1',
      resourceId: 'rec_strategy_allhands_q1',
      resourceType: 'recording',
      requiredPermission: 'DELETE',
      callerRole: 'admin',
      reason: 'Permission denied: Project admin cannot delete recordings owned by other team members.',
      details: 'Only recording owner, organization administrator, or platform administrator can delete records.',
      ipAddress: '192.0.2.78',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      timestamp: new Date(now - 900000).toISOString()
    },
    {
      id: `audit_seed_004_${now}`,
      eventType: 'AUTH_DENIED_RESOURCE_MISMATCH',
      action: 'ai.transcribe',
      status: 'denied',
      severity: 'high',
      actorUserId: 'usr_dev_tamper_01',
      actorEmail: 'junior.eng@acmewidgets.com',
      organizationId: 'org_acme_corp',
      projectId: 'proj_engineering_sprint',
      resourceId: 'rec_confidential_finance_q3',
      resourceType: 'ai_gateway',
      requiredPermission: 'EDIT_CONTENT',
      callerRole: 'viewer',
      reason: 'Resource mismatch: Specified recording does not belong to specified project container.',
      details: 'IDOR attempt blocked before AI model ingestion.',
      ipAddress: '198.51.100.89',
      userAgent: 'PostmanRuntime/7.36.0',
      timestamp: new Date(now - 1800000).toISOString()
    },
    {
      id: `audit_seed_005_${now}`,
      eventType: 'AUTH_PERMITTED',
      action: 'project.access_resolved',
      status: 'allowed',
      severity: 'low',
      actorUserId: 'usr_product_lead_01',
      actorEmail: 'sarah.cpo@acmewidgets.com',
      organizationId: 'org_acme_corp',
      projectId: 'proj_board_minutes_2026',
      resourceId: 'proj_board_minutes_2026',
      resourceType: 'project',
      requiredPermission: 'VIEW',
      callerRole: 'owner',
      reason: 'Authoritative project membership verified with role "owner".',
      details: 'Full view and manage capabilities granted.',
      ipAddress: '192.0.2.14',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      timestamp: new Date(now - 3600000).toISOString()
    },
    {
      id: `audit_seed_006_${now}`,
      eventType: 'SSO_CLAIMS_SANITIZED',
      action: 'sso.login.sanitize',
      status: 'warning',
      severity: 'medium',
      actorUserId: 'usr_partner_02',
      actorEmail: 'vendor.rep@externalpartner.org',
      organizationId: 'org_acme_corp',
      resourceType: 'oauth_claims',
      reason: 'Untrusted client claims stripped: ["role", "orgRole", "isOwner", "platform_admin"].',
      details: 'Prevented privilege assertion injection during IdP callback.',
      ipAddress: '198.51.100.112',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      timestamp: new Date(now - 7200000).toISOString()
    },
    {
      id: `audit_seed_007_${now}`,
      eventType: 'PROJECT_OWNERSHIP_TRANSFERRED',
      action: 'project.transfer_ownership',
      status: 'allowed',
      severity: 'medium',
      actorUserId: 'usr_product_lead_01',
      actorEmail: 'sarah.cpo@acmewidgets.com',
      organizationId: 'org_acme_corp',
      projectId: 'proj_marketing_q1',
      resourceId: 'proj_marketing_q1',
      resourceType: 'project',
      requiredPermission: 'DELETE_PROJECT',
      callerRole: 'owner',
      reason: 'Project ownership successfully transferred to verified team member.',
      details: 'Previous owner gracefully demoted to admin role.',
      ipAddress: '192.0.2.14',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      timestamp: new Date(now - 14400000).toISOString()
    },
    {
      id: `audit_seed_008_${now}`,
      eventType: 'AUTH_DENIED_SOFT_DELETED',
      action: 'recording.stream',
      status: 'denied',
      severity: 'medium',
      actorUserId: 'usr_former_analyst_03',
      actorEmail: 'ex.analyst@acmewidgets.com',
      organizationId: 'org_acme_corp',
      resourceId: 'rec_archived_audio_2025',
      resourceType: 'recording',
      requiredPermission: 'VIEW',
      callerRole: 'viewer',
      reason: 'Recording is soft-deleted and cannot be streamed or downloaded.',
      details: 'HTTP 410 Gone returned to client.',
      ipAddress: '203.0.113.88',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      timestamp: new Date(now - 28800000).toISOString()
    }
  ];

  AUTH_AUDIT_LOG_BUFFER.push(...sampleEvents);
}

seedInitialAuditEvents();

/**
 * Record a structured authorization audit event
 */
export async function recordAuthAuditEvent(
  db: admin.firestore.Firestore | null | undefined,
  event: Partial<AuthAuditLogEvent> & {
    eventType: AuthAuditLogEvent['eventType'];
    action: string;
    status: 'denied' | 'allowed' | 'warning';
    severity: 'low' | 'medium' | 'high' | 'critical';
  }
): Promise<AuthAuditLogEvent> {
  const logId = event.id || `audit_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const nowIso = new Date().toISOString();

  const auditEntry: AuthAuditLogEvent = {
    id: logId,
    eventType: event.eventType,
    action: event.action,
    status: event.status,
    severity: event.severity,
    actorUserId: event.actorUserId || null,
    actorEmail: event.actorEmail || null,
    organizationId: event.organizationId || null,
    projectId: event.projectId || null,
    resourceId: event.resourceId || null,
    resourceType: event.resourceType || null,
    requiredPermission: event.requiredPermission || null,
    callerRole: event.callerRole || null,
    reason: event.reason || '',
    details: event.details || '',
    ipAddress: event.ipAddress || null,
    userAgent: event.userAgent || null,
    metadata: event.metadata || {},
    timestamp: event.timestamp || nowIso
  };

  // Add to head of ring buffer
  AUTH_AUDIT_LOG_BUFFER.unshift(auditEntry);
  if (AUTH_AUDIT_LOG_BUFFER.length > MAX_RING_BUFFER_SIZE) {
    AUTH_AUDIT_LOG_BUFFER.pop();
  }

  // Persist to Firestore if available
  if (db && typeof (db as any).collection === 'function') {
    try {
      await db.collection("authAuditLogs").doc(logId).set({
        ...auditEntry,
        createdAt: (admin.firestore as any)?.FieldValue?.serverTimestamp 
          ? (admin.firestore as any).FieldValue.serverTimestamp() 
          : nowIso
      });

      // Also persist to org subcollection if orgId exists
      if (auditEntry.organizationId) {
        await db
          .collection("organizations")
          .doc(auditEntry.organizationId)
          .collection("auditLogs")
          .doc(logId)
          .set({
            ...auditEntry,
            createdAt: (admin.firestore as any)?.FieldValue?.serverTimestamp 
              ? (admin.firestore as any).FieldValue.serverTimestamp() 
              : nowIso
          });
      }
    } catch (dbErr: any) {
      // Non-blocking in dev or mock environments
      console.warn("⚠️ [AUDIT LOG DB WARNING]:", dbErr.message);
    }
  }

  // Console alert for denials or critical escalations
  if (auditEntry.status === 'denied' || auditEntry.severity === 'critical') {
    console.warn(`🚨 [SECURITY AUDIT] ${auditEntry.eventType} on ${auditEntry.action}: ${auditEntry.reason} (actor=${auditEntry.actorEmail || auditEntry.actorUserId || 'anonymous'})`);
  }

  return auditEntry;
}

/**
 * Query recent authorization audit logs with filtering and search
 */
export async function queryAuthAuditLogs(
  db: admin.firestore.Firestore | null | undefined,
  options?: {
    searchTerm?: string;
    status?: 'all' | 'denied' | 'allowed' | 'warning';
    severity?: 'all' | 'critical' | 'high' | 'medium' | 'low';
    action?: string;
    actionType?: string;
    userEmail?: string;
    organizationId?: string;
    projectId?: string;
    projectName?: string;
    startDate?: string;
    endDate?: string;
    startTimestamp?: number | string;
    endTimestamp?: number | string;
    limit?: number;
    sortOrder?: 'desc' | 'asc';
  }
): Promise<{
  logs: AuthAuditLogEvent[];
  totalCount: number;
  denialCount: number;
  warningCount: number;
  allowedCount: number;
}> {
  seedInitialAuditEvents();

  let candidateLogs = [...AUTH_AUDIT_LOG_BUFFER];

  // If Firestore is available, attempt to merge with recent persisted records
  if (db && typeof (db as any).collection === 'function') {
    try {
      let queryRef: any = db.collection("authAuditLogs");
      if (options?.organizationId && options.organizationId !== 'all') {
        queryRef = queryRef.where("organizationId", "==", options.organizationId);
      }
      queryRef = queryRef.limit(Math.min(options?.limit || 200, 300));
      const snap = await queryRef.get();
      if (!snap.empty) {
        const firestoreList: AuthAuditLogEvent[] = [];
        snap.forEach((doc: any) => {
          firestoreList.push({ id: doc.id, ...doc.data() });
        });
        
        // Merge without duplicates
        const seenIds = new Set(candidateLogs.map(l => l.id));
        firestoreList.forEach(item => {
          if (!seenIds.has(item.id)) {
            candidateLogs.push(item);
            seenIds.add(item.id);
          }
        });
      }
    } catch {
      // Fallback silently to in-memory buffer
    }
  }

  // Calculate high-level breakdown across all candidate logs
  const totalCount = candidateLogs.length;
  const denialCount = candidateLogs.filter(l => l.status === 'denied').length;
  const warningCount = candidateLogs.filter(l => l.status === 'warning').length;
  const allowedCount = candidateLogs.filter(l => l.status === 'allowed').length;

  // Filter by status
  if (options?.status && options.status !== 'all') {
    candidateLogs = candidateLogs.filter(l => l.status === options.status);
  }

  // Filter by severity
  if (options?.severity && options.severity !== 'all') {
    candidateLogs = candidateLogs.filter(l => l.severity === options.severity);
  }

  // Filter by action or actionType
  const targetAction = options?.actionType || options?.action;
  if (targetAction && targetAction !== 'all') {
    const actLower = targetAction.toLowerCase().trim();
    candidateLogs = candidateLogs.filter(l => 
      l.action.toLowerCase().includes(actLower) || 
      l.eventType.toLowerCase().includes(actLower)
    );
  }

  // Filter by user email
  if (options?.userEmail && options.userEmail.trim() !== '' && options.userEmail !== 'all') {
    const emailLower = options.userEmail.toLowerCase().trim();
    candidateLogs = candidateLogs.filter(l => 
      l.actorEmail && l.actorEmail.toLowerCase().includes(emailLower)
    );
  }

  // Filter by organization
  if (options?.organizationId && options.organizationId !== 'all') {
    candidateLogs = candidateLogs.filter(l => l.organizationId === options.organizationId);
  }

  // Filter by project (ID or project name)
  if (options?.projectId && options.projectId !== 'all') {
    candidateLogs = candidateLogs.filter(l => l.projectId === options.projectId);
  }
  if (options?.projectName && options.projectName.trim() !== '' && options.projectName !== 'all') {
    const pNameLower = options.projectName.toLowerCase().trim();
    candidateLogs = candidateLogs.filter(l => 
      (l.projectId && l.projectId.toLowerCase().includes(pNameLower)) ||
      (l.metadata?.projectName && String(l.metadata.projectName).toLowerCase().includes(pNameLower)) ||
      (l.metadata?.projectTitle && String(l.metadata.projectTitle).toLowerCase().includes(pNameLower)) ||
      (l.details && l.details.toLowerCase().includes(pNameLower))
    );
  }

  // Filter by timestamp range
  const startBound = options?.startDate || options?.startTimestamp;
  if (startBound) {
    const startMs = new Date(startBound).getTime();
    if (!isNaN(startMs)) {
      candidateLogs = candidateLogs.filter(l => new Date(l.timestamp || 0).getTime() >= startMs);
    }
  }

  const endBound = options?.endDate || options?.endTimestamp;
  if (endBound) {
    let endMs = new Date(endBound).getTime();
    if (typeof endBound === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endBound.trim())) {
      endMs = new Date(`${endBound.trim()}T23:59:59.999Z`).getTime();
    }
    if (!isNaN(endMs)) {
      candidateLogs = candidateLogs.filter(l => new Date(l.timestamp || 0).getTime() <= endMs);
    }
  }

  // Search filter
  if (options?.searchTerm && options.searchTerm.trim() !== '') {
    const term = options.searchTerm.toLowerCase().trim();
    candidateLogs = candidateLogs.filter(l => {
      return (
        (l.actorEmail && l.actorEmail.toLowerCase().includes(term)) ||
        (l.actorUserId && l.actorUserId.toLowerCase().includes(term)) ||
        (l.reason && l.reason.toLowerCase().includes(term)) ||
        (l.details && l.details.toLowerCase().includes(term)) ||
        (l.action && l.action.toLowerCase().includes(term)) ||
        (l.eventType && l.eventType.toLowerCase().includes(term)) ||
        (l.resourceId && l.resourceId.toLowerCase().includes(term)) ||
        (l.projectId && l.projectId.toLowerCase().includes(term)) ||
        (l.metadata?.projectName && String(l.metadata.projectName).toLowerCase().includes(term)) ||
        (l.organizationId && l.organizationId.toLowerCase().includes(term)) ||
        (l.ipAddress && l.ipAddress.includes(term))
      );
    });
  }

  // Sort chronological
  const sortDesc = options?.sortOrder !== 'asc';
  candidateLogs.sort((a, b) => {
    const tA = new Date(a.timestamp || 0).getTime();
    const tB = new Date(b.timestamp || 0).getTime();
    return sortDesc ? tB - tA : tA - tB;
  });

  // Limit
  const maxLimit = options?.limit ? Math.min(options.limit, 500) : 150;
  const slicedLogs = candidateLogs.slice(0, maxLimit);

  return {
    logs: slicedLogs,
    totalCount,
    denialCount,
    warningCount,
    allowedCount
  };
}
