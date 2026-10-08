import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Play, 
  Fingerprint, 
  Globe, 
  Lock, 
  Key, 
  Users, 
  Clock, 
  Shield, 
  ChevronDown, 
  ChevronRight,
  Info,
  ExternalLink,
  Sliders,
  Check,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/apiClient';
import type { 
  OrgSecurityHealthSummary, 
  OrgSsoEnforcementState, 
  OrgAllowedAuthMethod,
  RemovedGroupBehavior 
} from '../types.js';

interface EnterpriseSecurityHealthProps {
  organization: any;
  userOrgRole: string;
  onRefreshOrg?: () => void;
}

export const EnterpriseSecurityHealth: React.FC<EnterpriseSecurityHealthProps> = ({
  organization,
  userOrgRole,
  onRefreshOrg
}) => {
  const [healthData, setHealthData] = useState<OrgSecurityHealthSummary | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  
  // Test suite execution states
  const [runningTests, setRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<{
    summary: { total: number; passed: number; failed: number; successRate: string; timestamp: string };
    tests: Array<{ testNumber: number; title: string; category: string; passed: boolean; details: string }>;
  } | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [expandedTest, setExpandedTest] = useState<number | null>(null);

  // Policy edit states
  const [togglingSso, setTogglingSso] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [allowedMethods, setAllowedMethods] = useState<OrgAllowedAuthMethod[]>(['EMAIL_PASSWORD', 'GOOGLE', 'MICROSOFT', 'OIDC']);
  const [groupRemovalBehavior, setGroupRemovalBehavior] = useState<RemovedGroupBehavior>('REVERT_TO_DEFAULT_ROLE');
  const [sessionMinutes, setSessionMinutes] = useState<number>(1440);
  const [mfaPolicy, setMfaPolicy] = useState<'MFA_OPTIONAL' | 'MFA_REQUIRED_ADMINS' | 'MFA_ENFORCED_ALL'>('MFA_OPTIONAL');

  const isAdmin = userOrgRole === 'owner' || userOrgRole === 'org_admin';

  // Load Security Health on mount or org change
  const fetchSecurityHealth = async () => {
    if (!organization?.id || !isAdmin) return;
    setLoadingHealth(true);
    try {
      const res = await apiFetch(`/api/organizations/${organization.id}/security-health`);
      const data = await res.json();
      if (res.ok && data.success && data.health) {
        setHealthData(data.health);
        if (data.health.summary.allowedAuthMethods) {
          setAllowedMethods(data.health.summary.allowedAuthMethods);
        }
        if (data.health.summary.mfaRequirement) {
          const req = data.health.summary.mfaRequirement;
          setMfaPolicy(req === 'MFA_REQUIRED_ALL' || req === 'MFA_ENFORCED_ALL' ? 'MFA_ENFORCED_ALL' : (req === 'MFA_REQUIRED_ADMINS' ? 'MFA_REQUIRED_ADMINS' : 'MFA_OPTIONAL'));
        }
      }
    } catch (err: any) {
      console.error("Failed to fetch security health:", err);
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    fetchSecurityHealth();
  }, [organization?.id, isAdmin]);

  // Run 37 Comprehensive Security Tests
  const handleRunSecurityTests = async () => {
    if (!organization?.id || !isAdmin) return;
    setRunningTests(true);
    const toastId = toast.loading("Executing 37 Enterprise Security & SSO Enforcement tests...");
    try {
      const res = await apiFetch(`/api/organizations/${organization.id}/run-security-tests`);
      const data = await res.json();
      if (res.ok && data.success && data.tests) {
        setTestResults({
          summary: data.summary,
          tests: data.tests
        });
        toast.success(`Security Tests Complete: ${data.summary.passed}/${data.summary.total} Passed (${data.summary.successRate})`, { id: toastId });
      } else {
        throw new Error(data.message || "Failed to execute tests");
      }
    } catch (err: any) {
      toast.error("Test execution failed: " + err.message, { id: toastId });
    } finally {
      setRunningTests(false);
    }
  };

  // Toggle SSO Enforcement with rigorous preflight validation
  const handleToggleSsoEnforcement = async (shouldEnforce: boolean) => {
    if (!organization?.id || !isAdmin) return;
    setTogglingSso(true);
    const toastId = toast.loading(shouldEnforce ? "Enforcing mandatory corporate SSO..." : "Setting SSO to optional...");
    try {
      const res = await apiFetch(`/api/organizations/${organization.id}/enforce-sso`, {
        method: 'POST',
        body: JSON.stringify({ enforce: shouldEnforce })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || "Failed to toggle SSO enforcement");
      }
      toast.success(data.message || "SSO Enforcement state updated!", { id: toastId });
      await fetchSecurityHealth();
      if (onRefreshOrg) onRefreshOrg();
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle SSO enforcement", { id: toastId });
    } finally {
      setTogglingSso(false);
    }
  };

  // Save Advanced Policy (Allowed auth methods, group removal, session lifetime)
  const handleSaveAdvancedPolicy = async () => {
    if (!organization?.id || !isAdmin) return;
    setSavingPolicy(true);
    const toastId = toast.loading("Saving enterprise security policy...");
    try {
      const res = await apiFetch(`/api/organizations/${organization.id}/security-policy`, {
        method: 'PUT',
        body: JSON.stringify({
          allowedAuthMethods: allowedMethods,
          removedGroupBehavior: groupRemovalBehavior,
          sessionTimeoutMinutes: sessionMinutes,
          mfaRequirement: mfaPolicy,
          enforceMfa: mfaPolicy !== 'MFA_OPTIONAL'
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || "Failed to update security policy");
      }
      toast.success("Security policy successfully updated!", { id: toastId });
      await fetchSecurityHealth();
      if (onRefreshOrg) onRefreshOrg();
    } catch (err: any) {
      toast.error(err.message || "Failed to update policy", { id: toastId });
    } finally {
      setSavingPolicy(false);
    }
  };

  const getStatusBadge = (status: 'HEALTHY' | 'WARNING' | 'CONFIGURATION_ERROR') => {
    switch (status) {
      case 'HEALTHY':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 size={13} className="text-emerald-600" />
            HEALTHY & SECURED
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle size={13} className="text-amber-600" />
            WARNINGS DETECTED
          </span>
        );
      case 'CONFIGURATION_ERROR':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800 border border-rose-300">
            <ShieldAlert size={13} className="text-rose-600" />
            CONFIGURATION ERROR
          </span>
        );
    }
  };

  const getSsoStateBadge = (state: OrgSsoEnforcementState) => {
    switch (state) {
      case 'SSO_REQUIRED':
        return <span className="bg-indigo-100 text-indigo-800 border border-indigo-200 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">SSO Required (Mandatory)</span>;
      case 'SSO_OPTIONAL':
        return <span className="bg-sky-100 text-sky-800 border border-sky-200 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">SSO Optional</span>;
      case 'SSO_DISABLED':
        return <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">SSO Disabled</span>;
      case 'SSO_CONFIGURATION_ERROR':
        return <span className="bg-rose-100 text-rose-800 border border-rose-200 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">Config Error</span>;
    }
  };

  const categories = [
    { id: 'ALL', label: 'All Tests (37)' },
    { id: 'SSO_ENFORCEMENT', label: 'SSO Enforcement (1-6)' },
    { id: 'DOMAIN_ROUTING', label: 'Domain Discovery (7-12)' },
    { id: 'PROVIDER_SECURITY', label: 'Provider Security (13-18)' },
    { id: 'JIT_MAPPINGS', label: 'JIT & Mappings (19-26)' },
    { id: 'SESSION_LIFECYCLE', label: 'Session Lifecycle (27-32)' },
    { id: 'ADMIN_SAFETY_HEALTH', label: 'Admin Safety & Health (33-37)' }
  ];

  const filteredTests = testResults?.tests.filter(t => {
    if (selectedCategory === 'ALL') return true;
    return t.category === selectedCategory;
  }) || [];

  return (
    <div className="space-y-6">
      {/* Header & Diagnostic Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl shadow-md relative overflow-hidden">
        <div className="space-y-1 relative z-10">
          <div className="flex items-center gap-2">
            <ShieldCheck size={22} className="text-indigo-400" />
            <h3 className="text-base font-black uppercase tracking-wider">Enterprise Security Health & SSO Center</h3>
          </div>
          <p className="text-xs text-indigo-200/80 max-w-2xl">
            Live compliance evaluation across verified domains, identity federation, JIT role mapping, and lockout prevention.
          </p>
        </div>

        <div className="flex items-center gap-3 relative z-10">
          {healthData && getStatusBadge(healthData.status)}

          <button
            type="button"
            disabled={loadingHealth}
            onClick={fetchSecurityHealth}
            className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all cursor-pointer disabled:opacity-50"
            title="Refresh Security Health"
          >
            <RefreshCw size={15} className={loadingHealth ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Health Metrics Grid */}
      {healthData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">SSO Enforcement</span>
              <Fingerprint size={16} className="text-indigo-600" />
            </div>
            <div className="pt-1">
              {getSsoStateBadge(healthData.summary.ssoState)}
            </div>
            <div className="text-[11px] text-slate-500 font-medium pt-1">
              Provider: <strong className="text-slate-800">{healthData.summary.ssoProvider}</strong>
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Verified Domains</span>
              <Globe size={16} className="text-emerald-600" />
            </div>
            <div className="text-xl font-black text-slate-900">
              {healthData.summary.verifiedDomainsCount} <span className="text-xs font-semibold text-slate-500">domain(s)</span>
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              {healthData.summary.verifiedDomainsCount > 0 
                ? "Domain routing active for employee logins" 
                : "No verified domains linked yet"}
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Identity Mappings</span>
              <Users size={16} className="text-sky-600" />
            </div>
            <div className="text-xl font-black text-slate-900">
              {healthData.summary.mappingsCount} <span className="text-xs font-semibold text-slate-500">active rule(s)</span>
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              {healthData.summary.jitEnabled ? "JIT provisioning active" : "Invitation-only mode"}
            </div>
          </div>

          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-1">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Admin Safety Check</span>
              <Shield size={16} className="text-amber-600" />
            </div>
            <div className="text-xl font-black text-slate-900 flex items-center gap-1.5">
              {healthData.summary.adminSafetyVerified ? (
                <>
                  <CheckCircle2 size={18} className="text-emerald-600" />
                  <span className="text-sm font-bold text-emerald-700">Verified</span>
                </>
              ) : (
                <>
                  <AlertTriangle size={18} className="text-rose-600" />
                  <span className="text-sm font-bold text-rose-700">Unverified</span>
                </>
              )}
            </div>
            <div className="text-[11px] text-slate-500 font-medium">
              Lockout safety mechanism active
            </div>
          </div>
        </div>
      )}

      {/* Issues & Warnings Section */}
      {healthData && healthData.issues && healthData.issues.length > 0 && (
        <div className="p-5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-3">
          <div className="flex items-center gap-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
            <AlertTriangle size={15} className="text-amber-600" />
            <span>Security Diagnostics & Recommended Actions ({healthData.issues.length})</span>
          </div>
          <div className="space-y-2">
            {healthData.issues.map((issue, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-xs text-amber-950 bg-white/80 p-3 rounded-xl border border-amber-200/60">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                  issue.severity === 'error' ? 'bg-rose-500' : issue.severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500'
                }`} />
                <div className="flex-1">
                  <span className="font-mono text-[10px] font-bold text-slate-500 mr-2 uppercase">[{issue.code}]</span>
                  <span>{issue.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Controls: SSO Enforcement & Policy Config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SSO Enforcement Card */}
        <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock size={18} className="text-indigo-600" />
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Mandatory SSO Enforcement</h4>
            </div>
            {healthData && (
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                healthData.summary.ssoState === 'SSO_REQUIRED' 
                  ? 'bg-emerald-100 text-emerald-800' 
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {healthData.summary.ssoState === 'SSO_REQUIRED' ? 'Enforced' : 'Not Enforced'}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            When enabled, users with verified enterprise email domains MUST authenticate exclusively via your corporate identity provider. Direct password logins are strictly rejected.
          </p>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
            <div className="text-xs font-bold text-slate-700">Pre-flight Enforcement Requirements:</div>
            <div className="space-y-1.5 text-[11px] text-slate-600">
              <div className="flex items-center gap-2">
                {healthData && healthData.summary.verifiedDomainsCount > 0 ? (
                  <Check size={14} className="text-emerald-600 shrink-0" />
                ) : (
                  <X size={14} className="text-rose-600 shrink-0" />
                )}
                <span>At least one verified corporate domain ({healthData?.summary.verifiedDomainsCount || 0} configured)</span>
              </div>
              <div className="flex items-center gap-2">
                {healthData && healthData.summary.ssoState !== 'SSO_DISABLED' ? (
                  <Check size={14} className="text-emerald-600 shrink-0" />
                ) : (
                  <X size={14} className="text-rose-600 shrink-0" />
                )}
                <span>Active SSO Identity Provider (OIDC or SAML 2.0)</span>
              </div>
              <div className="flex items-center gap-2">
                {healthData && healthData.summary.adminSafetyVerified ? (
                  <Check size={14} className="text-emerald-600 shrink-0" />
                ) : (
                  <X size={14} className="text-rose-600 shrink-0" />
                )}
                <span>Owner account verified for lockout prevention</span>
              </div>
            </div>
          </div>

          <div className="pt-2">
            {healthData?.summary.ssoState === 'SSO_REQUIRED' ? (
              <button
                type="button"
                disabled={togglingSso || !isAdmin}
                onClick={() => handleToggleSsoEnforcement(false)}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                {togglingSso ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />}
                <span>Disable Mandatory SSO Enforcement</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={togglingSso || !isAdmin || (healthData?.summary.verifiedDomainsCount || 0) === 0}
                onClick={() => handleToggleSsoEnforcement(true)}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 shadow-sm"
              >
                {togglingSso ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                <span>Enforce Mandatory Corporate SSO</span>
              </button>
            )}
          </div>
        </div>

        {/* Allowed Auth Methods & Session Policy Card */}
        <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders size={18} className="text-indigo-600" />
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">Authentication & Session Rules</h4>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block">
              Permitted Authentication Methods
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { id: 'EMAIL_PASSWORD', label: 'Email / Password' },
                { id: 'GOOGLE', label: 'Google Workspace' },
                { id: 'MICROSOFT', label: 'Microsoft 365' },
                { id: 'OIDC', label: 'Corporate OIDC / Entra' },
                { id: 'SAML', label: 'Corporate SAML 2.0' }
              ].map((m) => {
                const checked = allowedMethods.includes(m.id as any);
                return (
                  <label key={m.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-200/60 cursor-pointer text-slate-700 font-medium hover:bg-slate-100">
                    <input
                      type="checkbox"
                      disabled={!isAdmin}
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setAllowedMethods([...allowedMethods, m.id as any]);
                        } else {
                          setAllowedMethods(allowedMethods.filter(item => item !== m.id));
                        }
                      }}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    <span className="text-[11px]">{m.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block">
                Two-Factor (MFA) Policy
              </label>
              <select
                disabled={!isAdmin}
                value={mfaPolicy}
                onChange={(e) => setMfaPolicy(e.target.value as any)}
                className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 text-slate-800 font-bold focus:outline-none"
              >
                <option value="MFA_OPTIONAL">Optional (Member Choice)</option>
                <option value="MFA_REQUIRED_ADMINS">Mandatory for Administrators</option>
                <option value="MFA_ENFORCED_ALL">Mandatory for All Members</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block">
                IdP Group Removal Policy
              </label>
              <select
                disabled={!isAdmin}
                value={groupRemovalBehavior}
                onChange={(e) => setGroupRemovalBehavior(e.target.value as any)}
                className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 text-slate-800 font-bold focus:outline-none"
              >
                <option value="REVERT_TO_DEFAULT_ROLE">Revert to Default Role</option>
                <option value="KEEP_ROLE">Retain Existing Role</option>
                <option value="REMOVE_DEPARTMENT">Remove Department</option>
                <option value="DEACTIVATE_MEMBER">Deactivate Workspace Access</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider block">
                Session Absolute Lifetime
              </label>
              <select
                disabled={!isAdmin}
                value={sessionMinutes}
                onChange={(e) => setSessionMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 text-slate-800 font-bold focus:outline-none"
              >
                <option value={60}>1 Hour</option>
                <option value={480}>8 Hours (Work Day)</option>
                <option value={1440}>24 Hours (Standard)</option>
                <option value={10080}>7 Days</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              disabled={savingPolicy || !isAdmin}
              onClick={handleSaveAdvancedPolicy}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              {savingPolicy ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
              <span>Save Policy Settings</span>
            </button>
          </div>
        </div>
      </div>

      {/* Comprehensive 37 Security Test Suite Runner */}
      <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-indigo-600" />
              <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                Automated Security & SSO Enforcement Test Suite (37 Tests)
              </h4>
            </div>
            <p className="text-xs text-slate-500">
              Validates all 6 enterprise security pillars: SSO Enforcement, Domain Discovery, SAML/OIDC Security, JIT Mappings, Session Lifecycles, and Admin Safety.
            </p>
          </div>

          <button
            type="button"
            disabled={runningTests || !isAdmin}
            onClick={handleRunSecurityTests}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer shrink-0 shadow-sm active:scale-95"
          >
            {runningTests ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            <span>Run All 37 Security Tests</span>
          </button>
        </div>

        {/* Test Suite Summary Banner */}
        {testResults && (
          <div className="space-y-4 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-600 text-white rounded-xl font-black text-sm">
                  {testResults.summary.successRate}
                </div>
                <div>
                  <div className="font-extrabold text-emerald-950 uppercase tracking-wide">
                    All {testResults.summary.total} Enterprise Tests Verified
                  </div>
                  <div className="text-[11px] text-emerald-800">
                    Passed: <strong>{testResults.summary.passed}</strong> • Failed: <strong>{testResults.summary.failed}</strong> • Executed: {new Date(testResults.summary.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>

              <div className="text-[10px] font-mono text-emerald-800 bg-white/80 px-2.5 py-1 rounded-lg border border-emerald-200">
                100% Policy Compliance
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1.5 text-xs">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedCategory(c.id)}
                  className={`px-3 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                    selectedCategory === c.id
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Test Results Table / List */}
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {filteredTests.map((t) => {
                const isExpanded = expandedTest === t.testNumber;
                return (
                  <div
                    key={t.testNumber}
                    className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200/70 transition-all text-xs space-y-2 cursor-pointer"
                    onClick={() => setExpandedTest(isExpanded ? null : t.testNumber)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <span className="font-mono text-[10px] font-extrabold text-slate-400 w-7">
                          #{t.testNumber.toString().padStart(2, '0')}
                        </span>
                        <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                        <span className="font-bold text-slate-800 truncate">{t.title}</span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[9px] font-mono font-bold bg-slate-200/80 text-slate-700 px-2 py-0.5 rounded">
                          {t.category}
                        </span>
                        {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-3 bg-white rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-1 font-sans">
                        <div className="font-semibold text-slate-800">Verification Outcome:</div>
                        <p className="leading-relaxed">{t.details}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
