import { db, doc, updateDoc, setDoc, getDoc } from '../firebase';

export interface AuditLog {
  id: string;
  action: string;
  actor: string;
  project: string;
  organization: string;
  ip: string;
  details: string;
  timestamp: string;
}

/**
 * Logs a significant administrative or system-wide action under the corporate organization profile.
 * Writes to BOTH the subcollection (/organizations/{orgId}/auditLogs) and prepends to the
 * securitySettings.auditLogs array for robust enterprise compliance and instant syncing.
 */
export async function logAction(orgId: string, payload: {
  action: string;
  actor: string;
  project?: string;
  organizationName?: string;
  ip?: string;
  details: string;
}) {
  if (!orgId) return;
  const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  
  const auditData: AuditLog = {
    id: logId,
    action: payload.action,
    actor: payload.actor,
    project: payload.project || 'Global',
    organization: payload.organizationName || orgId,
    ip: payload.ip || '192.168.1.1 (Simulated)',
    details: payload.details,
    timestamp: new Date().toISOString()
  };

  try {
    // 1. Write to the dedicated subcollection
    await setDoc(doc(db, 'organizations', orgId, 'auditLogs', logId), auditData);

    // 2. Prepend to securitySettings.auditLogs on the main Organization document for backward compatibility
    const orgDocRef = doc(db, 'organizations', orgId);
    const orgSnap = await getDoc(orgDocRef);
    if (orgSnap.exists()) {
      const orgData = orgSnap.data();
      const secSettings = orgData.securitySettings || {};
      const currentLogs = secSettings.auditLogs || [];
      const updatedLogs = [auditData, ...currentLogs].slice(0, 100);
      
      await updateDoc(orgDocRef, {
        'securitySettings.auditLogs': updatedLogs
      });
    }
  } catch (err) {
    console.warn("⚠️ Audit log synchronization error:", err);
  }
}
