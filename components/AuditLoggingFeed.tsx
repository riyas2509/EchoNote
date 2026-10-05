import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AuthAuditLog, UserProfile } from '../types';
import { apiFetch } from '../lib/apiClient';
import { exportAuditLogsToCsv } from '../lib/auditCsvExporter';

interface AuditLoggingFeedProps {
  userProfile?: UserProfile;
  initialFilter?: 'all' | 'denied' | 'warning' | 'allowed';
  initialActionType?: string;
  initialUserEmail?: string;
  initialProjectName?: string;
  initialStartDate?: string;
  initialEndDate?: string;
}

export const AuditLoggingFeed: React.FC<AuditLoggingFeedProps> = ({ 
  userProfile,
  initialFilter = 'all',
  initialActionType = 'all',
  initialUserEmail = '',
  initialProjectName = '',
  initialStartDate = '',
  initialEndDate = ''
}) => {
  const [logs, setLogs] = useState<AuthAuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [actionTypeFilter, setActionTypeFilter] = useState<string>(initialActionType);
  const [userEmailFilter, setUserEmailFilter] = useState<string>(initialUserEmail);
  const [projectNameFilter, setProjectNameFilter] = useState<string>(initialProjectName);
  const [timestampPreset, setTimestampPreset] = useState<'all' | 'today' | '7days' | '30days' | 'custom'>('all');
  const [startDate, setStartDate] = useState<string>(initialStartDate);
  const [endDate, setEndDate] = useState<string>(initialEndDate);
  const [statusFilter, setStatusFilter] = useState<'all' | 'denied' | 'warning' | 'allowed'>(initialFilter);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);

  // Inspector modal
  const [selectedEvent, setSelectedEvent] = useState<AuthAuditLog | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Counts from backend
  const [stats, setStats] = useState({
    totalCount: 0,
    denialCount: 0,
    warningCount: 0,
    allowedCount: 0
  });

  const handleTimestampPresetChange = (preset: 'all' | 'today' | '7days' | '30days' | 'custom') => {
    setTimestampPreset(preset);
    const now = new Date();
    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'today') {
      const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      setStartDate(past24h.toISOString().slice(0, 10));
      setEndDate(now.toISOString().slice(0, 10));
    } else if (preset === '7days') {
      const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setStartDate(past7d.toISOString().slice(0, 10));
      setEndDate(now.toISOString().slice(0, 10));
    } else if (preset === '30days') {
      const past30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(past30d.toISOString().slice(0, 10));
      setEndDate(now.toISOString().slice(0, 10));
    }
  };

  const resetAllFilters = () => {
    setSearchTerm('');
    setActionTypeFilter('all');
    setUserEmailFilter('');
    setProjectNameFilter('');
    setTimestampPreset('all');
    setStartDate('');
    setEndDate('');
    setStatusFilter('all');
    setSeverityFilter('all');
    setCategoryFilter('all');
  };

  const isAnyFilterActive = 
    searchTerm.trim() !== '' ||
    actionTypeFilter !== 'all' ||
    userEmailFilter.trim() !== '' ||
    projectNameFilter.trim() !== '' ||
    startDate !== '' ||
    endDate !== '' ||
    statusFilter !== 'all' ||
    severityFilter !== 'all' ||
    categoryFilter !== 'all';

  const fetchAuditLogs = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    setErrorStatus(null);

    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (severityFilter !== 'all') params.append('severity', severityFilter);
      if (categoryFilter !== 'all') params.append('action', categoryFilter);
      if (actionTypeFilter !== 'all') params.append('actionType', actionTypeFilter);
      if (userEmailFilter.trim()) params.append('userEmail', userEmailFilter.trim());
      if (projectNameFilter.trim()) params.append('projectName', projectNameFilter.trim());
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (searchTerm.trim()) params.append('searchTerm', searchTerm.trim());
      params.append('sortOrder', sortOrder);
      params.append('limit', '200');

      const res = await apiFetch(`/api/admin/audit-logs?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.logs) {
          setLogs(json.logs);
          setStats({
            totalCount: json.totalCount ?? json.logs.length,
            denialCount: json.denialCount ?? json.logs.filter((l: any) => l.status === 'denied').length,
            warningCount: json.warningCount ?? json.logs.filter((l: any) => l.status === 'warning').length,
            allowedCount: json.allowedCount ?? json.logs.filter((l: any) => l.status === 'allowed').length
          });
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        setErrorStatus(errJson.message || `Failed to fetch audit logs (HTTP ${res.status})`);
      }
    } catch (err: any) {
      console.error("Audit log fetch error:", err);
      setErrorStatus(err?.message || "Network error loading audit logs");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, severityFilter, categoryFilter, actionTypeFilter, userEmailFilter, projectNameFilter, startDate, endDate, searchTerm, sortOrder]);

  // Initial fetch and dependency update
  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  // Unique suggestions derived from logs
  const distinctEmails = useMemo(() => {
    const set = new Set<string>();
    logs.forEach(l => {
      if (l.actorEmail && l.actorEmail.trim()) set.add(l.actorEmail.trim());
    });
    return Array.from(set).sort();
  }, [logs]);

  const distinctProjects = useMemo(() => {
    const set = new Set<string>();
    logs.forEach(l => {
      if (l.projectId && l.projectId.trim()) set.add(l.projectId.trim());
      if (l.metadata?.projectName && String(l.metadata.projectName).trim()) set.add(String(l.metadata.projectName).trim());
    });
    return Array.from(set).sort();
  }, [logs]);

  const distinctActionTypes = useMemo(() => {
    const set = new Set<string>([
      'recording.view',
      'recording.create',
      'recording.update',
      'recording.delete',
      'recording.stream',
      'project.delete',
      'project.transfer_ownership',
      'project.invite_member',
      'project.member.expire',
      'sso.jit.provision',
      'ai.assistant.chat',
      'ai.summarize',
      'ai.gateway.check',
      'tenant.boundary.cross_access'
    ]);
    logs.forEach(l => {
      if (l.action && l.action.trim()) set.add(l.action.trim());
    });
    return Array.from(set).sort();
  }, [logs]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchAuditLogs(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchAuditLogs]);

  // Client-side instant filter refinement for responsive UI
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Status
      if (statusFilter !== 'all' && log.status !== statusFilter) return false;
      // Severity
      if (severityFilter !== 'all' && log.severity !== severityFilter) return false;
      // Category / Action
      if (categoryFilter !== 'all') {
        const cat = categoryFilter.toLowerCase();
        const matchesCategory = 
          log.action.toLowerCase().includes(cat) || 
          log.eventType.toLowerCase().includes(cat);
        if (!matchesCategory) return false;
      }
      // Action Type
      if (actionTypeFilter !== 'all') {
        const actLower = actionTypeFilter.toLowerCase();
        const matchesAction = 
          log.action.toLowerCase().includes(actLower) || 
          log.eventType.toLowerCase().includes(actLower);
        if (!matchesAction) return false;
      }
      // User Email
      if (userEmailFilter.trim() !== '') {
        const emailLower = userEmailFilter.toLowerCase().trim();
        if (!log.actorEmail || !log.actorEmail.toLowerCase().includes(emailLower)) {
          return false;
        }
      }
      // Project Name / ID
      if (projectNameFilter.trim() !== '') {
        const projLower = projectNameFilter.toLowerCase().trim();
        const matchesProject = 
          (log.projectId && log.projectId.toLowerCase().includes(projLower)) ||
          (log.metadata?.projectName && String(log.metadata.projectName).toLowerCase().includes(projLower)) ||
          (log.metadata?.projectTitle && String(log.metadata.projectTitle).toLowerCase().includes(projLower)) ||
          (log.resourceId && log.resourceId.toLowerCase().includes(projLower)) ||
          (log.details && log.details.toLowerCase().includes(projLower));
        if (!matchesProject) return false;
      }
      // Timestamp range
      if (startDate) {
        const startMs = new Date(startDate).getTime();
        if (!isNaN(startMs) && new Date(log.timestamp || 0).getTime() < startMs) {
          return false;
        }
      }
      if (endDate) {
        let endMs = new Date(endDate).getTime();
        if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
          endMs = new Date(`${endDate.trim()}T23:59:59.999Z`).getTime();
        }
        if (!isNaN(endMs) && new Date(log.timestamp || 0).getTime() > endMs) {
          return false;
        }
      }
      // Search
      if (searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase().trim();
        const matches = 
          (log.actorEmail && log.actorEmail.toLowerCase().includes(term)) ||
          (log.actorUserId && log.actorUserId.toLowerCase().includes(term)) ||
          (log.reason && log.reason.toLowerCase().includes(term)) ||
          (log.action && log.action.toLowerCase().includes(term)) ||
          (log.eventType && log.eventType.toLowerCase().includes(term)) ||
          (log.resourceId && log.resourceId.toLowerCase().includes(term)) ||
          (log.projectId && log.projectId.toLowerCase().includes(term)) ||
          (log.metadata?.projectName && String(log.metadata.projectName).toLowerCase().includes(term)) ||
          (log.organizationId && log.organizationId.toLowerCase().includes(term)) ||
          (log.ipAddress && log.ipAddress.includes(term)) ||
          (log.details && log.details.toLowerCase().includes(term));
        if (!matches) return false;
      }
      return true;
    });
  }, [logs, statusFilter, severityFilter, categoryFilter, actionTypeFilter, userEmailFilter, projectNameFilter, startDate, endDate, searchTerm]);

  // Relative time helper
  const getRelativeTime = (isoString?: string) => {
    if (!isoString) return 'Just now';
    try {
      const deltaMs = Date.now() - new Date(isoString).getTime();
      const deltaSec = Math.floor(deltaMs / 1000);
      if (deltaSec < 60) return `${deltaSec}s ago`;
      const deltaMin = Math.floor(deltaSec / 60);
      if (deltaMin < 60) return `${deltaMin}m ago`;
      const deltaHr = Math.floor(deltaMin / 60);
      if (deltaHr < 24) return `${deltaHr}h ago`;
      const deltaDays = Math.floor(deltaHr / 24);
      return `${deltaDays}d ago`;
    } catch {
      return 'Recently';
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportToJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `echonote-auth-audit-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const [downloadToast, setDownloadToast] = useState<string | null>(null);

  const exportToCsv = useCallback(() => {
    const success = exportAuditLogsToCsv(filteredLogs);
    if (success) {
      setDownloadToast(`Successfully downloaded ${filteredLogs.length} filtered audit log ${filteredLogs.length === 1 ? 'entry' : 'entries'} as CSV for external review.`);
      setTimeout(() => setDownloadToast(null), 4000);
    }
  }, [filteredLogs]);

  // Listen for global download audit CSV event triggered from parent views (e.g. AdminTrackerView header)
  useEffect(() => {
    const handleDownloadEvent = () => {
      exportToCsv();
    };
    window.addEventListener('echonote:download-audit-csv', handleDownloadEvent);
    return () => {
      window.removeEventListener('echonote:download-audit-csv', handleDownloadEvent);
    };
  }, [exportToCsv]);

  return (
    <div id="audit-logging-component" className="space-y-6">
      {/* Toast Alert for Download Feedback */}
      <AnimatePresence>
        {downloadToast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between shadow-xs"
          >
            <div className="flex items-center gap-2.5 text-xs font-semibold">
              <i className="fa-solid fa-circle-check text-emerald-600 text-sm" />
              <span>{downloadToast}</span>
            </div>
            <button
              onClick={() => setDownloadToast(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs px-2 py-0.5 rounded cursor-pointer"
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Banner & KPI Metrics */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-100 text-red-600">
                <i className="fa-solid fa-shield-halved text-sm" />
              </span>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Authorization & Security Audit Feed</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-2xl">
              Real-time, server-authoritative audit log tracking resource authorization evaluations, access denials, tenant boundary enforcement, and privilege escalation blocks.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              id="admin-download-csv-btn"
              data-testid="admin-download-csv-btn"
              onClick={exportToCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
              title="Download currently filtered audit log entries as CSV for external review"
            >
              <i className="fa-solid fa-file-csv text-emerald-600" />
              Download CSV
            </button>

            <button
              id="audit-export-json-btn"
              onClick={exportToJson}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
              title="Export visible events as JSON"
            >
              <i className="fa-solid fa-download text-slate-400" />
              JSON
            </button>

            <button
              id="audit-auto-refresh-toggle"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                autoRefresh 
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title="Toggle live 15-second polling"
            >
              <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
              Auto-poll
            </button>

            <button
              id="audit-manual-refresh-btn"
              onClick={() => fetchAuditLogs()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
            >
              <i className={`fa-solid fa-rotate-right ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* KPI Counter Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-6">
          {/* 1. Access Denials */}
          <div 
            onClick={() => setStatusFilter(statusFilter === 'denied' ? 'all' : 'denied')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              statusFilter === 'denied' 
                ? 'bg-red-50/80 border-red-300 ring-2 ring-red-400/20' 
                : 'bg-slate-50/60 border-slate-100 hover:border-red-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-600">Access Denials</span>
              <span className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs">
                <i className="fa-solid fa-ban" />
              </span>
            </div>
            <div className="text-2xl font-black text-red-600 mt-2">{stats.denialCount}</div>
            <p className="text-[11px] text-slate-500 mt-0.5">Rejected unauthorized requests</p>
          </div>

          {/* 2. Security Warnings & Capped Escalations */}
          <div 
            onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              statusFilter === 'warning' 
                ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-400/20' 
                : 'bg-slate-50/60 border-slate-100 hover:border-amber-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Security Warnings</span>
              <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs">
                <i className="fa-solid fa-triangle-exclamation" />
              </span>
            </div>
            <div className="text-2xl font-black text-amber-700 mt-2">{stats.warningCount}</div>
            <p className="text-[11px] text-slate-500 mt-0.5">SSO sanitizations & JIT caps</p>
          </div>

          {/* 3. Permitted Authorizations */}
          <div 
            onClick={() => setStatusFilter(statusFilter === 'allowed' ? 'all' : 'allowed')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              statusFilter === 'allowed' 
                ? 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-400/20' 
                : 'bg-slate-50/60 border-slate-100 hover:border-emerald-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Authorizations Allowed</span>
              <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs">
                <i className="fa-solid fa-check" />
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-700 mt-2">{stats.allowedCount}</div>
            <p className="text-[11px] text-slate-500 mt-0.5">Verified verified access checks</p>
          </div>

          {/* 4. Total Events */}
          <div 
            onClick={() => setStatusFilter('all')}
            className={`p-4 rounded-xl border transition-all cursor-pointer ${
              statusFilter === 'all' 
                ? 'bg-slate-100 border-slate-300 ring-2 ring-slate-400/20' 
                : 'bg-slate-50/60 border-slate-100 hover:border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Total Audit Feed</span>
              <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-xs">
                <i className="fa-solid fa-list-check" />
              </span>
            </div>
            <div className="text-2xl font-black text-slate-900 mt-2">{stats.totalCount}</div>
            <p className="text-[11px] text-slate-500 mt-0.5">Evaluations in audit window</p>
          </div>
        </div>
      </div>

      {/* Search, Filter, and Controls Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
        {/* Row 1: Primary Search Bar & Sort / Severity Controls */}
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          {/* Universal Search Box */}
          <div className="relative flex-1">
            <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
            <input
              id="audit-search-input"
              type="text"
              placeholder="Search by action type, user email, project name, denial reason, resource ID, or IP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition-all"
            />
            {searchTerm && (
              <button
                id="audit-clear-search-btn"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                title="Clear search query"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            )}
          </div>

          {/* Severity Filter & Sort Order Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Severity Filter */}
            <select
              id="audit-severity-filter"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              aria-label="Filter by severity level"
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 cursor-pointer"
            >
              <option value="all">All Severities</option>
              <option value="critical">🔴 Critical Only</option>
              <option value="high">🟠 High Severity</option>
              <option value="medium">🟡 Medium Severity</option>
              <option value="low">🟢 Low Severity</option>
            </select>

            {/* Chronological Sort Toggle */}
            <button
              id="audit-sort-order-toggle"
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
              title="Toggle Chronological Direction"
            >
              <i className={`fa-solid ${sortOrder === 'desc' ? 'fa-arrow-down-wide-short' : 'fa-arrow-up-short-wide'} text-slate-400`} />
              {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
            </button>
          </div>
        </div>

        {/* Row 2: Granular Filter Controls Grid (Action Type, User Email, Project Name, Timestamp Range) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
          {/* 1. Action Type Filter */}
          <div className="space-y-1">
            <label htmlFor="audit-action-type-filter" className="block text-[11px] font-bold text-slate-600 tracking-wide flex items-center gap-1">
              <i className="fa-solid fa-bolt text-amber-500 text-[10px]" />
              Action Type
            </label>
            <select
              id="audit-action-type-filter"
              value={actionTypeFilter}
              onChange={(e) => setActionTypeFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-medium rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 cursor-pointer"
            >
              <option value="all">All Action Types</option>
              <optgroup label="Recordings Access">
                <option value="recording.view">recording.view (View Recording)</option>
                <option value="recording.create">recording.create (Create / Upload)</option>
                <option value="recording.update">recording.update (Update Metadata)</option>
                <option value="recording.delete">recording.delete (Delete Recording)</option>
                <option value="recording.stream">recording.stream (Audio Stream / Play)</option>
              </optgroup>
              <optgroup label="Projects & Collaboration">
                <option value="project.delete">project.delete (Delete Project)</option>
                <option value="project.transfer_ownership">project.transfer_ownership (Transfer Ownership)</option>
                <option value="project.invite_member">project.invite_member (Invite Member)</option>
                <option value="project.member.expire">project.member.expire (Expire Membership)</option>
              </optgroup>
              <optgroup label="Identity, SSO & Boundaries">
                <option value="sso.jit.provision">sso.jit.provision (SSO / JIT Provisioning)</option>
                <option value="tenant.boundary.cross_access">tenant.boundary.cross_access (Tenant Boundary)</option>
              </optgroup>
              <optgroup label="AI Services & Gateway">
                <option value="ai.assistant.chat">ai.assistant.chat (AI Assistant Chat)</option>
                <option value="ai.summarize">ai.summarize (Strategic Summarization)</option>
                <option value="ai.gateway.check">ai.gateway.check (AI Gateway Access)</option>
              </optgroup>
              {distinctActionTypes.filter(act => ![
                'recording.view', 'recording.create', 'recording.update', 'recording.delete', 'recording.stream',
                'project.delete', 'project.transfer_ownership', 'project.invite_member', 'project.member.expire',
                'sso.jit.provision', 'tenant.boundary.cross_access', 'ai.assistant.chat', 'ai.summarize', 'ai.gateway.check'
              ].includes(act)).map(act => (
                <option key={act} value={act}>{act}</option>
              ))}
            </select>
          </div>

          {/* 2. User Email Filter */}
          <div className="space-y-1">
            <label htmlFor="audit-user-email-filter" className="block text-[11px] font-bold text-slate-600 tracking-wide flex items-center gap-1">
              <i className="fa-regular fa-envelope text-blue-500 text-[10px]" />
              User Email
            </label>
            <div className="relative">
              <input
                id="audit-user-email-filter"
                type="text"
                list="audit-emails-datalist"
                value={userEmailFilter}
                onChange={(e) => setUserEmailFilter(e.target.value)}
                placeholder="Filter by actor email..."
                className="w-full pl-2.5 pr-7 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10"
              />
              {userEmailFilter && (
                <button
                  id="audit-clear-email-filter-btn"
                  onClick={() => setUserEmailFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                  title="Clear email filter"
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
              <datalist id="audit-emails-datalist">
                {distinctEmails.map(email => (
                  <option key={email} value={email} />
                ))}
              </datalist>
            </div>
          </div>

          {/* 3. Project Name Filter */}
          <div className="space-y-1">
            <label htmlFor="audit-project-name-filter" className="block text-[11px] font-bold text-slate-600 tracking-wide flex items-center gap-1">
              <i className="fa-solid fa-folder-tree text-emerald-500 text-[10px]" />
              Project Name
            </label>
            <div className="relative">
              <input
                id="audit-project-name-filter"
                type="text"
                list="audit-projects-datalist"
                value={projectNameFilter}
                onChange={(e) => setProjectNameFilter(e.target.value)}
                placeholder="Filter by project name or ID..."
                className="w-full pl-2.5 pr-7 py-1.5 text-xs rounded-xl border border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10"
              />
              {projectNameFilter && (
                <button
                  id="audit-clear-project-filter-btn"
                  onClick={() => setProjectNameFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                  title="Clear project filter"
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
              <datalist id="audit-projects-datalist">
                {distinctProjects.map(proj => (
                  <option key={proj} value={proj} />
                ))}
              </datalist>
            </div>
          </div>

          {/* 4. Timestamp Range Filter Preset */}
          <div className="space-y-1">
            <label htmlFor="audit-timestamp-preset" className="block text-[11px] font-bold text-slate-600 tracking-wide flex items-center gap-1">
              <i className="fa-regular fa-clock text-indigo-500 text-[10px]" />
              Timestamp Range
            </label>
            <select
              id="audit-timestamp-preset"
              value={timestampPreset}
              onChange={(e) => handleTimestampPresetChange(e.target.value as any)}
              className="w-full px-2.5 py-1.5 text-xs font-medium rounded-xl border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 cursor-pointer"
            >
              <option value="all">All Time</option>
              <option value="today">Last 24 Hours</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>
        </div>

        {/* Custom Date Range Picker Inputs (when active or custom) */}
        {(timestampPreset === 'custom' || startDate || endDate) && (
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
              <i className="fa-regular fa-calendar-days text-indigo-500" />
              Custom Range:
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium">From</span>
              <input
                id="audit-start-date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setTimestampPreset('custom');
                }}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium">To</span>
              <input
                id="audit-end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setTimestampPreset('custom');
                }}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
            {(startDate || endDate) && (
              <button
                id="audit-clear-date-range-btn"
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setTimestampPreset('all');
                }}
                className="text-xs text-slate-500 hover:text-slate-800 underline ml-auto font-medium cursor-pointer"
              >
                Reset Dates
              </button>
            )}
          </div>
        )}

        {/* Active Filter Badges & Reset Bar */}
        {isAnyFilterActive && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">Active Filters:</span>
            
            {actionTypeFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                <i className="fa-solid fa-bolt text-[10px]" />
                Action: {actionTypeFilter}
                <button onClick={() => setActionTypeFilter('all')} className="ml-1 text-amber-600 hover:text-amber-900 cursor-pointer">×</button>
              </span>
            )}

            {userEmailFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 text-xs font-semibold">
                <i className="fa-regular fa-envelope text-[10px]" />
                User: {userEmailFilter}
                <button onClick={() => setUserEmailFilter('')} className="ml-1 text-blue-600 hover:text-blue-900 cursor-pointer">×</button>
              </span>
            )}

            {projectNameFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
                <i className="fa-solid fa-folder text-[10px]" />
                Project: {projectNameFilter}
                <button onClick={() => setProjectNameFilter('')} className="ml-1 text-emerald-600 hover:text-emerald-900 cursor-pointer">×</button>
              </span>
            )}

            {(startDate || endDate) && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 text-xs font-semibold">
                <i className="fa-regular fa-clock text-[10px]" />
                {startDate && endDate ? `${startDate} to ${endDate}` : startDate ? `From ${startDate}` : `Until ${endDate}`}
                <button onClick={() => { setStartDate(''); setEndDate(''); setTimestampPreset('all'); }} className="ml-1 text-indigo-600 hover:text-indigo-900 cursor-pointer">×</button>
              </span>
            )}

            {searchTerm && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-200 text-xs font-semibold">
                Search: "{searchTerm}"
                <button onClick={() => setSearchTerm('')} className="ml-1 text-slate-500 hover:text-slate-800 cursor-pointer">×</button>
              </span>
            )}

            {statusFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-800 border border-red-200 text-xs font-semibold">
                Status: {statusFilter}
                <button onClick={() => setStatusFilter('all')} className="ml-1 text-red-600 hover:text-red-900 cursor-pointer">×</button>
              </span>
            )}

            {severityFilter !== 'all' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200 text-xs font-semibold">
                Severity: {severityFilter}
                <button onClick={() => setSeverityFilter('all')} className="ml-1 text-purple-600 hover:text-purple-900 cursor-pointer">×</button>
              </span>
            )}

            <button
              id="audit-clear-all-filters-btn"
              onClick={resetAllFilters}
              className="ml-auto text-xs font-bold text-red-600 hover:text-red-800 underline transition-colors cursor-pointer"
            >
              Clear All Filters
            </button>
          </div>
        )}

        {/* Quick Status Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">Status:</span>
            
            <button
              id="audit-filter-status-all"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              All Events ({stats.totalCount})
            </button>

            <button
              id="audit-filter-status-denied"
              onClick={() => setStatusFilter('denied')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'denied'
                  ? 'bg-red-600 text-white ring-2 ring-red-400/30'
                  : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200/60'
              }`}
            >
              <i className="fa-solid fa-ban text-[10px]" />
              Denials ({stats.denialCount})
            </button>

            <button
              id="audit-filter-status-warning"
              onClick={() => setStatusFilter('warning')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'warning'
                  ? 'bg-amber-600 text-white ring-2 ring-amber-400/30'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200/60'
              }`}
            >
              <i className="fa-solid fa-triangle-exclamation text-[10px]" />
              Warnings ({stats.warningCount})
            </button>

            <button
              id="audit-filter-status-allowed"
              onClick={() => setStatusFilter('allowed')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'allowed'
                  ? 'bg-emerald-600 text-white ring-2 ring-emerald-400/30'
                  : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200/60'
              }`}
            >
              <i className="fa-solid fa-check text-[10px]" />
              Allowed ({stats.allowedCount})
            </button>
          </div>

          <div className="text-xs font-semibold text-slate-500">
            Showing <span className="font-bold text-slate-900">{filteredLogs.length}</span> of <span className="font-bold text-slate-900">{stats.totalCount}</span> events
          </div>
        </div>
      </div>

      {/* Error Notice */}
      {errorStatus && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
          <i className="fa-solid fa-triangle-exclamation text-red-600 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-red-900">Audit Feed Notice</h4>
            <p className="text-xs text-red-700 mt-0.5">{errorStatus}</p>
          </div>
        </div>
      )}

      {/* Feed List Container */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <i className="fa-solid fa-circle-notch animate-spin text-slate-400 text-2xl mb-3" />
            <p className="text-xs font-semibold text-slate-500">Loading authorization audit events...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <i className="fa-solid fa-shield text-xl" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">No Matching Audit Events</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              No authorization events match the specified search query or active filter criteria.
            </p>
            <button
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
                setSeverityFilter('all');
                setCategoryFilter('all');
              }}
              className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors"
            >
              Clear Filters
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLogs.map((log) => {
              const isDenied = log.status === 'denied';
              const isWarning = log.status === 'warning';
              const isAllowed = log.status === 'allowed';

              const severityColors: Record<string, string> = {
                critical: 'bg-red-600 text-white',
                high: 'bg-orange-500 text-white',
                medium: 'bg-amber-500 text-white',
                low: 'bg-slate-500 text-white'
              };

              const borderHighlight = isDenied 
                ? 'border-l-4 border-l-red-500' 
                : isWarning 
                  ? 'border-l-4 border-l-amber-500' 
                  : 'border-l-4 border-l-emerald-500';

              return (
                <div
                  key={log.id}
                  id={`audit-event-${log.id}`}
                  className={`bg-white rounded-xl border border-slate-200/90 shadow-2xs hover:shadow-xs transition-all p-4 ${borderHighlight}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    {/* Status & Event Header */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Status Pill */}
                      {isDenied && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-black tracking-wide uppercase">
                          <i className="fa-solid fa-ban text-[10px]" />
                          Access Denied
                        </span>
                      )}
                      {isWarning && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-black tracking-wide uppercase">
                          <i className="fa-solid fa-triangle-exclamation text-[10px]" />
                          Escalation Blocked
                        </span>
                      )}
                      {isAllowed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-black tracking-wide uppercase">
                          <i className="fa-solid fa-circle-check text-[10px]" />
                          Authorized
                        </span>
                      )}

                      {/* Severity Badge */}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${severityColors[log.severity] || 'bg-slate-600 text-white'}`}>
                        {log.severity}
                      </span>

                      {/* Event Type / Action Tag */}
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px] font-semibold">
                        {log.action}
                      </span>

                      <span className="text-slate-300">•</span>
                      <span className="text-xs font-semibold text-slate-500">{log.eventType}</span>
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                      <i className="fa-regular fa-clock" />
                      <span className="font-semibold text-slate-600">{getRelativeTime(log.timestamp)}</span>
                      <span className="hidden sm:inline text-slate-300">({new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})</span>
                    </div>
                  </div>

                  {/* Event Core Body */}
                  <div className="pt-3 space-y-2">
                    {/* Reason Banner */}
                    <div className={`p-2.5 rounded-lg text-xs leading-relaxed ${
                      isDenied 
                        ? 'bg-red-50/70 text-red-950 font-medium border border-red-100' 
                        : isWarning 
                          ? 'bg-amber-50/70 text-amber-950 font-medium border border-amber-100' 
                          : 'bg-slate-50 text-slate-700'
                    }`}>
                      <div className="flex items-start gap-2">
                        <i className={`mt-0.5 ${
                          isDenied 
                            ? 'fa-solid fa-circle-xmark text-red-600' 
                            : isWarning 
                              ? 'fa-solid fa-triangle-exclamation text-amber-600' 
                              : 'fa-solid fa-circle-info text-slate-400'
                        }`} />
                        <div>
                          <span className="font-bold">{log.reason || 'Authorization check evaluated.'}</span>
                          {log.details && (
                            <p className="mt-1 text-[11px] opacity-90">{log.details}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Metadata Context Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                      {/* Actor */}
                      <div className="p-2 rounded bg-slate-50 border border-slate-100">
                        <span className="text-slate-400 uppercase font-bold text-[10px] block">Actor</span>
                        <div className="font-medium text-slate-800 truncate" title={log.actorEmail || log.actorUserId || 'Anonymous'}>
                          {log.actorEmail || log.actorUserId || 'Anonymous Caller'}
                        </div>
                        {log.callerRole && (
                          <span className="text-[10px] text-slate-500 font-mono">Role: {log.callerRole}</span>
                        )}
                      </div>

                      {/* Resource */}
                      <div className="p-2 rounded bg-slate-50 border border-slate-100">
                        <span className="text-slate-400 uppercase font-bold text-[10px] block">Target Resource</span>
                        <div className="font-mono text-slate-800 truncate" title={log.resourceId || 'N/A'}>
                          {log.resourceId || 'N/A'}
                        </div>
                        {log.resourceType && (
                          <span className="text-[10px] text-slate-500">Type: {log.resourceType}</span>
                        )}
                      </div>

                      {/* Context (Org / Project) */}
                      <div className="p-2 rounded bg-slate-50 border border-slate-100">
                        <span className="text-slate-400 uppercase font-bold text-[10px] block">Context / Boundary</span>
                        <div className="text-slate-800 truncate" title={`Org: ${log.organizationId || 'None'} | Proj: ${log.projectId || 'None'}`}>
                          {log.projectId ? `Proj: ${log.projectId}` : log.organizationId ? `Org: ${log.organizationId}` : 'Global Context'}
                        </div>
                        {log.requiredPermission && (
                          <span className="text-[10px] text-slate-500 font-mono">Needs: {log.requiredPermission}</span>
                        )}
                      </div>

                      {/* Network & Source */}
                      <div className="p-2 rounded bg-slate-50 border border-slate-100">
                        <span className="text-slate-400 uppercase font-bold text-[10px] block">Source IP</span>
                        <div className="font-mono text-slate-800 truncate" title={log.ipAddress || 'Internal'}>
                          {log.ipAddress || 'Internal / Proxy'}
                        </div>
                        <span className="text-[10px] text-slate-500 truncate block" title={log.userAgent || 'API'}>
                          {log.userAgent ? log.userAgent.split(' ')[0] : 'Backend'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions Footer */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-[10px] text-slate-400 font-mono">Event ID: {log.id}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(JSON.stringify(log, null, 2), log.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900 transition-colors px-2 py-1 rounded hover:bg-slate-100"
                      >
                        <i className={`fa-solid ${copiedId === log.id ? 'fa-check text-emerald-600' : 'fa-copy'}`} />
                        {copiedId === log.id ? 'Copied' : 'Copy'}
                      </button>

                      <button
                        onClick={() => setSelectedEvent(log)}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors px-2 py-1 rounded hover:bg-indigo-50"
                      >
                        <i className="fa-solid fa-code" />
                        Inspect Security Trace
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Security Event Inspector Modal */}
      <AnimatePresence>
        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${
                    selectedEvent.status === 'denied' 
                      ? 'bg-red-100 text-red-600' 
                      : selectedEvent.status === 'warning' 
                        ? 'bg-amber-100 text-amber-700' 
                        : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    <i className={
                      selectedEvent.status === 'denied' 
                        ? 'fa-solid fa-ban' 
                        : selectedEvent.status === 'warning' 
                          ? 'fa-solid fa-triangle-exclamation' 
                          : 'fa-solid fa-check'
                    } />
                  </span>
                  <div>
                    <h3 className="text-base font-black text-slate-900">Security Audit Trace: {selectedEvent.eventType}</h3>
                    <p className="text-xs text-slate-500 font-mono">ID: {selectedEvent.id}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <i className="fa-solid fa-xmark text-sm" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-6 overflow-y-auto space-y-5">
                {/* Summary Box */}
                <div className={`p-4 rounded-xl border ${
                  selectedEvent.status === 'denied' 
                    ? 'bg-red-50/60 border-red-200 text-red-950' 
                    : selectedEvent.status === 'warning' 
                      ? 'bg-amber-50/60 border-amber-200 text-amber-950' 
                      : 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                }`}>
                  <h4 className="text-xs font-bold uppercase tracking-wider mb-1">Enforced Authorization Rule</h4>
                  <p className="text-sm font-semibold">{selectedEvent.reason || 'Check complete.'}</p>
                  {selectedEvent.details && (
                    <p className="text-xs mt-1.5 opacity-90">{selectedEvent.details}</p>
                  )}
                </div>

                {/* Key Context Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Status / Severity</span>
                    <span className="font-bold uppercase text-slate-800">{selectedEvent.status} ({selectedEvent.severity})</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Action / Route</span>
                    <span className="font-mono font-semibold text-slate-800">{selectedEvent.action}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Caller Role</span>
                    <span className="font-mono text-slate-800">{selectedEvent.callerRole || 'Unauthenticated'}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Required Permission</span>
                    <span className="font-mono text-slate-800">{selectedEvent.requiredPermission || 'None'}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Organization ID</span>
                    <span className="font-mono text-slate-800">{selectedEvent.organizationId || 'Global / N/A'}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Project ID</span>
                    <span className="font-mono text-slate-800">{selectedEvent.projectId || 'None'}</span>
                  </div>
                </div>

                {/* Raw JSON Payload */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Raw Event Payload (JSON)</span>
                    <button
                      onClick={() => handleCopy(JSON.stringify(selectedEvent, null, 2), 'modal')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                    >
                      <i className={`fa-solid ${copiedId === 'modal' ? 'fa-check text-emerald-600' : 'fa-copy'}`} />
                      {copiedId === 'modal' ? 'Copied' : 'Copy JSON'}
                    </button>
                  </div>
                  <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto max-h-60 leading-relaxed scrollbar-thin">
                    {JSON.stringify(selectedEvent, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-slate-200 bg-slate-50/50 flex justify-end">
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors"
                >
                  Close Inspector
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
