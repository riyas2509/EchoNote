import { AuthAuditLog } from '../types';

/**
 * Generates and triggers the download of a CSV file containing audit log entries.
 * Properly escapes fields (quotes, commas, linebreaks) for compliance with RFC 4180.
 *
 * @param logs The array of AuthAuditLog items to export
 * @param filenamePrefix Optional prefix for the downloaded file
 * @returns boolean indicating success
 */
export function exportAuditLogsToCsv(logs: AuthAuditLog[], filenamePrefix = 'echonote-auth-audit'): boolean {
  try {
    const headers = [
      "Event ID",
      "Timestamp",
      "Status",
      "Severity",
      "Event Type",
      "Action",
      "Actor Email",
      "Actor UID",
      "Caller Role",
      "Required Permission",
      "Organization ID",
      "Project ID",
      "Resource Type",
      "Resource ID",
      "Reason",
      "Details",
      "Source IP",
      "User Agent"
    ];

    const escapeCsv = (val: any): string => {
      if (val === null || val === undefined) return '""';
      const str = String(val);
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = (logs || []).map(l => [
      escapeCsv(l.id),
      escapeCsv(l.timestamp || ''),
      escapeCsv(l.status),
      escapeCsv(l.severity),
      escapeCsv(l.eventType),
      escapeCsv(l.action),
      escapeCsv(l.actorEmail || ''),
      escapeCsv(l.actorUserId || ''),
      escapeCsv(l.callerRole || ''),
      escapeCsv(l.requiredPermission || ''),
      escapeCsv(l.organizationId || ''),
      escapeCsv(l.projectId || ''),
      escapeCsv(l.resourceType || ''),
      escapeCsv(l.resourceId || ''),
      escapeCsv(l.reason || ''),
      escapeCsv(l.details || ''),
      escapeCsv(l.ipAddress || ''),
      escapeCsv(l.userAgent || '')
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("href", url);
    link.setAttribute("download", `${filenamePrefix}-${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error("Failed to export audit logs to CSV:", err);
    return false;
  }
}
