import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Shield, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw, 
  Sliders, 
  ArrowRight, 
  Terminal, 
  Layers, 
  Building2, 
  Briefcase, 
  Sparkles,
  Info,
  Key,
  ShieldCheck,
  AlertTriangle,
  Play
} from 'lucide-react';
import { OrgIdentityMapping, OrgJitSettings, OrgRole, Department } from '../types';
import { apiFetch } from '../lib/apiClient';
import { toast } from 'sonner';

interface IdentityMappingSettingsProps {
  organization: any;
  departments: Department[];
  userOrgRole: OrgRole;
  identityMappings: OrgIdentityMapping[];
  onRefreshMappings: () => void;
}

export const IdentityMappingSettings: React.FC<IdentityMappingSettingsProps> = ({
  organization,
  departments,
  userOrgRole,
  identityMappings,
  onRefreshMappings
}) => {
  const isAuthorizedAdmin = userOrgRole === 'owner' || userOrgRole === 'org_admin';

  // JIT Settings State
  const initialJit = organization?.securitySettings?.jitSettings || {};
  const [jitEnabled, setJitEnabled] = useState<boolean>(initialJit.jitProvisioningEnabled !== false);
  const [provisioningMode, setProvisioningMode] = useState<'jit_allowed' | 'invitation_required'>(
    initialJit.provisioningMode || 'jit_allowed'
  );
  const [roleMode, setRoleMode] = useState<'manual' | 'idp_managed'>(
    initialJit.roleManagementMode || 'idp_managed'
  );
  const [defaultRole, setDefaultRole] = useState<OrgRole>(
    initialJit.defaultJitRole || 'member'
  );
  const [defaultDeptId, setDefaultDeptId] = useState<string>(
    initialJit.defaultDepartmentId || ''
  );
  const [syncAttributes, setSyncAttributes] = useState<boolean>(
    initialJit.syncIdentityAttributes !== false
  );
  const [syncGroups, setSyncGroups] = useState<boolean>(
    initialJit.syncGroups !== false
  );
  const [autoDeactivate, setAutoDeactivate] = useState<boolean>(
    Boolean(initialJit.autoDeactivateRemovedUsers)
  );
  const [isSavingJit, setIsSavingJit] = useState<boolean>(false);

  // Mapping Form / Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingMapping, setEditingMapping] = useState<OrgIdentityMapping | null>(null);
  const [formProvider, setFormProvider] = useState<'all' | 'entra' | 'saml' | 'google' | 'oidc'>('all');
  const [formSourceType, setFormSourceType] = useState<'group' | 'department' | 'job_title' | 'claim'>('group');
  const [formSourceValue, setFormSourceValue] = useState<string>('');
  const [formTargetRole, setFormTargetRole] = useState<OrgRole>('member');
  const [formTargetDeptId, setFormTargetDeptId] = useState<string>('');
  const [formPriority, setFormPriority] = useState<number>(10);
  const [formEnabled, setFormEnabled] = useState<boolean>(true);
  const [isSavingMapping, setIsSavingMapping] = useState<boolean>(false);

  // Search & Filter State
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Simulator State
  const [testEmail, setTestEmail] = useState<string>('');
  const [testGroups, setTestGroups] = useState<string>('');
  const [testDept, setTestDept] = useState<string>('');
  const [testJobTitle, setTestJobTitle] = useState<string>('');
  const [testProvider, setTestProvider] = useState<'all' | 'entra' | 'saml' | 'google' | 'oidc'>('all');
  const [isRunningTest, setIsRunningTest] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<any | null>(null);

  // Update form if org security settings change
  useEffect(() => {
    if (organization?.securitySettings?.jitSettings) {
      const jit = organization.securitySettings.jitSettings;
      setJitEnabled(jit.jitProvisioningEnabled !== false);
      setProvisioningMode(jit.provisioningMode || 'jit_allowed');
      setRoleMode(jit.roleManagementMode || 'idp_managed');
      setDefaultRole(jit.defaultJitRole || 'member');
      setDefaultDeptId(jit.defaultDepartmentId || '');
      setSyncAttributes(jit.syncIdentityAttributes !== false);
      setSyncGroups(jit.syncGroups !== false);
      setAutoDeactivate(Boolean(jit.autoDeactivateRemovedUsers));
    }
  }, [organization?.securitySettings?.jitSettings]);

  // Open Modal for Create / Edit
  const handleOpenCreateModal = () => {
    setEditingMapping(null);
    setFormProvider('all');
    setFormSourceType('group');
    setFormSourceValue('');
    setFormTargetRole('member');
    setFormTargetDeptId('');
    setFormPriority(10);
    setFormEnabled(true);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (mapping: OrgIdentityMapping) => {
    setEditingMapping(mapping);
    setFormProvider(mapping.provider || 'all');
    setFormSourceType(mapping.sourceType || 'group');
    setFormSourceValue(mapping.sourceValue || '');
    setFormTargetRole(mapping.targetRole || 'member');
    setFormTargetDeptId(mapping.targetDepartmentId || '');
    setFormPriority(mapping.priority ?? 10);
    setFormEnabled(mapping.enabled !== false);
    setIsModalOpen(true);
  };

  // Save JIT Settings
  const handleSaveJitSettings = async () => {
    if (!organization?.id || !isAuthorizedAdmin) {
      toast.error("Access Denied: Only administrators can update JIT settings.");
      return;
    }

    setIsSavingJit(true);
    const toastId = toast.loading("Updating JIT Provisioning Configuration...");

    try {
      const selectedDept = departments.find(d => d.id === defaultDeptId);
      const res = await apiFetch(`/api/organizations/${organization.id}/jit-settings`, {
        method: 'POST',
        body: JSON.stringify({
          jitProvisioningEnabled: jitEnabled,
          provisioningMode,
          roleManagementMode: roleMode,
          defaultJitRole: defaultRole,
          defaultDepartmentId: defaultDeptId || null,
          defaultDepartmentName: selectedDept ? selectedDept.name : null,
          syncIdentityAttributes: syncAttributes,
          syncGroups,
          autoDeactivateRemovedUsers: autoDeactivate
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || "Failed to save JIT settings");
      }

      toast.success("JIT Provisioning settings saved successfully!", { id: toastId });
    } catch (err: any) {
      console.error("Save JIT error:", err);
      toast.error(err.message || "Failed to save JIT settings", { id: toastId });
    } finally {
      setIsSavingJit(false);
    }
  };

  // Save (Create or Update) Mapping Rule
  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization?.id || !isAuthorizedAdmin) {
      toast.error("Access Denied: Only administrators can configure identity mappings.");
      return;
    }

    if (!formSourceValue.trim()) {
      toast.error("Please enter a valid source attribute or group name.");
      return;
    }

    if (formTargetRole === 'owner') {
      toast.error("Owner role cannot be assigned via automated identity mapping.");
      return;
    }

    setIsSavingMapping(true);
    const toastId = toast.loading(editingMapping ? "Updating Mapping Rule..." : "Creating Mapping Rule...");

    try {
      const selectedDept = departments.find(d => d.id === formTargetDeptId);
      const payload = {
        provider: formProvider,
        sourceType: formSourceType,
        sourceValue: formSourceValue.trim(),
        targetRole: formTargetRole,
        targetDepartmentId: formTargetDeptId || null,
        targetDepartmentName: selectedDept ? selectedDept.name : null,
        priority: Number(formPriority) || 10,
        enabled: formEnabled
      };

      const url = editingMapping
        ? `/api/organizations/${organization.id}/identity-mappings/${editingMapping.id}`
        : `/api/organizations/${organization.id}/identity-mappings`;

      const method = editingMapping ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || "Failed to save identity mapping rule");
      }

      toast.success(
        editingMapping ? "Mapping rule updated successfully!" : "Identity mapping rule created!",
        { id: toastId }
      );
      setIsModalOpen(false);
      onRefreshMappings();
    } catch (err: any) {
      console.error("Save mapping error:", err);
      toast.error(err.message || "Failed to save mapping rule", { id: toastId });
    } finally {
      setIsSavingMapping(false);
    }
  };

  // Toggle Rule Status (Enable/Disable)
  const handleToggleMapping = async (mapping: OrgIdentityMapping) => {
    if (!organization?.id || !isAuthorizedAdmin) return;

    try {
      const res = await apiFetch(`/api/organizations/${organization.id}/identity-mappings/${mapping.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !mapping.enabled })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Rule "${mapping.sourceValue}" ${!mapping.enabled ? 'enabled' : 'disabled'}.`);
        onRefreshMappings();
      } else {
        toast.error(data.message || "Failed to toggle rule state.");
      }
    } catch (err: any) {
      toast.error("Error updating rule: " + err.message);
    }
  };

  // Delete Mapping Rule
  const handleDeleteMapping = async (mappingId: string, sourceValue: string) => {
    if (!organization?.id || !isAuthorizedAdmin) return;

    if (!window.confirm(`Are you sure you want to delete the mapping rule for "${sourceValue}"?`)) {
      return;
    }

    const toastId = toast.loading("Deleting mapping rule...");
    try {
      const res = await apiFetch(`/api/organizations/${organization.id}/identity-mappings/${mappingId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.message || "Failed to delete mapping rule");
      }

      toast.success("Mapping rule deleted.", { id: toastId });
      onRefreshMappings();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete mapping", { id: toastId });
    }
  };

  // Run Test Simulation
  const handleRunSimulation = async () => {
    if (!organization?.id || !isAuthorizedAdmin) return;
    if (!testEmail.trim()) {
      toast.error("Please enter a test user email.");
      return;
    }

    setIsRunningTest(true);
    setTestResult(null);
    const toastId = toast.loading("Evaluating identity rules against simulated claims...");

    try {
      const parsedGroups = testGroups
        .split(',')
        .map(g => g.trim())
        .filter(g => g.length > 0);

      const res = await apiFetch(`/api/organizations/${organization.id}/identity-mappings/test-preview`, {
        method: 'POST',
        body: JSON.stringify({
          email: testEmail.trim(),
          provider: testProvider,
          groups: parsedGroups,
          department: testDept.trim() || undefined,
          jobTitle: testJobTitle.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || "Simulation evaluation failed");
      }

      setTestResult(data.simulation);
      toast.success("Simulation complete!", { id: toastId });
    } catch (err: any) {
      console.error("Simulation error:", err);
      toast.error(err.message || "Failed to run simulation", { id: toastId });
    } finally {
      setIsRunningTest(false);
    }
  };

  // Filter mappings
  const filteredMappings = identityMappings.filter(m => {
    if (filterProvider !== 'all' && m.provider !== 'all' && m.provider !== filterProvider) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchVal = (m.sourceValue || '').toLowerCase().includes(q);
      const matchRole = (m.targetRole || '').toLowerCase().includes(q);
      const matchDept = (m.targetDepartmentName || '').toLowerCase().includes(q);
      return matchVal || matchRole || matchDept;
    }
    return true;
  });

  return (
    <div className="space-y-8" id="identity-mapping-settings-container">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
              Just-In-Time (JIT) Provisioning & Identity Role Mapping
            </h3>
            <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-full text-[9px] font-black uppercase">
              Phase 1.7 Enterprise
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Map enterprise IdP security groups, departments, and job titles directly into authoritative EchoNote roles and Firebase Custom Claims.
          </p>
        </div>

        {isAuthorizedAdmin && (
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all cursor-pointer active:scale-95 shrink-0"
          >
            <Plus size={14} />
            <span>Add Mapping Rule</span>
          </button>
        )}
      </div>

      {/* SECTION 1: JIT PROVISIONING SETTINGS */}
      <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200/60 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-indigo-600" />
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              JIT Lifecycle & Account Provisioning Policy
            </h4>
          </div>
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
            jitEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
          }`}>
            {jitEnabled ? 'JIT Active' : 'JIT Disabled'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* JIT Master Switch */}
          <div className="space-y-2">
            <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider flex items-center justify-between">
              <span>Enable JIT Provisioning</span>
            </label>
            <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200">
              <span className="text-xs font-medium text-slate-700">Auto-create user account on first SSO login</span>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                <input
                  type="checkbox"
                  disabled={!isAuthorizedAdmin}
                  checked={jitEnabled}
                  onChange={(e) => setJitEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            <p className="text-[10px] text-slate-500">Allows employees from verified domains to join without manual pre-invitations.</p>
          </div>

          {/* Provisioning Mode */}
          <div className="space-y-2">
            <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">
              Account Registration Mode
            </label>
            <select
              disabled={!isAuthorizedAdmin || !jitEnabled}
              value={provisioningMode}
              onChange={(e) => setProvisioningMode(e.target.value as any)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none disabled:opacity-60"
            >
              <option value="jit_allowed">🟢 Just-In-Time Allowed (Auto-provision)</option>
              <option value="invitation_required">🔒 Invitation Required (Pre-invite only)</option>
            </select>
            <p className="text-[10px] text-slate-500">Enforce invitations or permit automatic entry for verified domains.</p>
          </div>

          {/* Role Management Mode */}
          <div className="space-y-2">
            <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">
              Role Authority Mode
            </label>
            <select
              disabled={!isAuthorizedAdmin}
              value={roleMode}
              onChange={(e) => setRoleMode(e.target.value as any)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none disabled:opacity-60"
            >
              <option value="idp_managed">⚡ IdP Managed (Sync roles via group mapping)</option>
              <option value="manual">👤 Manual (Assign default role; admin managed)</option>
            </select>
            <p className="text-[10px] text-slate-500">Controls whether IdP group changes continuously update member roles.</p>
          </div>
        </div>

        {/* Defaults for Unmapped Users */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-200/60">
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">
              Default Fallback Role for Unmapped Users
            </label>
            <select
              disabled={!isAuthorizedAdmin}
              value={defaultRole}
              onChange={(e) => setDefaultRole(e.target.value as OrgRole)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
            >
              <option value="member">Member (Standard Access)</option>
              <option value="team_manager">Team Manager (Department Lead)</option>
              <option value="org_admin">Organization Admin (Administrative Access)</option>
            </select>
            <p className="text-[10px] text-slate-500">Applied when no specific group or attribute mapping matches the user.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">
              Default Fallback Department
            </label>
            <select
              disabled={!isAuthorizedAdmin}
              value={defaultDeptId}
              onChange={(e) => setDefaultDeptId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
            >
              <option value="">No Default Department (Unassigned)</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500">Initial department assignment for provisioned users without a specific mapping.</p>
          </div>
        </div>

        {/* Sync Checkboxes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200/60">
          <label className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              disabled={!isAuthorizedAdmin}
              checked={syncAttributes}
              onChange={(e) => setSyncAttributes(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <div className="text-xs font-bold text-slate-800">Synchronize Profile Attributes on Login</div>
              <div className="text-[10px] text-slate-500">Update display name, department name, and job title from IdP claims.</div>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              disabled={!isAuthorizedAdmin}
              checked={syncGroups}
              onChange={(e) => setSyncGroups(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <div className="text-xs font-bold text-slate-800">Synchronize IdP Groups on Every Login</div>
              <div className="text-[10px] text-slate-500">Refresh security groups and re-evaluate mapping rules on every authentication.</div>
            </div>
          </label>
        </div>

        {/* Save JIT Settings Button */}
        {isAuthorizedAdmin && (
          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={isSavingJit}
              onClick={handleSaveJitSettings}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all cursor-pointer active:scale-95"
            >
              {isSavingJit ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
              <span>Save JIT Configuration</span>
            </button>
          </div>
        )}
      </div>

      {/* SECTION 2: CONFIGURED IDENTITY MAPPING RULES */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <span>Configured Identity Mapping Rules</span>
              <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-black">
                {filteredMappings.length} Active Rules
              </span>
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Deterministic priority evaluation: Rules with higher priority take precedence. Conflicting equal priorities fail safe to lowest privilege.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-700 font-bold focus:outline-none"
            >
              <option value="all">All Providers</option>
              <option value="entra">Microsoft Entra ID</option>
              <option value="saml">SAML 2.0</option>
              <option value="google">Google OIDC</option>
            </select>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search mappings..."
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none w-44"
            />
          </div>
        </div>

        {/* Mappings Table */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                  <th className="py-3.5 px-4">Priority</th>
                  <th className="py-3.5 px-4">Provider</th>
                  <th className="py-3.5 px-4">Match Condition</th>
                  <th className="py-3.5 px-4">Assigned Role</th>
                  <th className="py-3.5 px-4">Target Department</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMappings.map((mapping) => (
                  <tr key={mapping.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                        (mapping.priority || 10) >= 80 
                          ? 'bg-amber-100 text-amber-900 border border-amber-200'
                          : (mapping.priority || 10) >= 50
                          ? 'bg-indigo-50 text-indigo-800 border border-indigo-100'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}>
                        P{mapping.priority || 10}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-700">
                      <span className="capitalize text-[11px]">
                        {mapping.provider === 'all' ? '🌐 All Providers' : mapping.provider.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                          {mapping.sourceType}
                        </span>
                        <span className="font-bold text-slate-900 font-mono text-[11px]">
                          {mapping.sourceValue}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase ${
                        mapping.targetRole === 'org_admin'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : mapping.targetRole === 'team_manager'
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}>
                        <Shield size={11} />
                        <span>{mapping.targetRole.replace('_', ' ')}</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 font-medium">
                      {mapping.targetDepartmentName || (
                        mapping.targetDepartmentId 
                          ? departments.find(d => d.id === mapping.targetDepartmentId)?.name || 'Mapped Dept'
                          : <span className="text-slate-400 italic text-[10px]">Unchanged</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        disabled={!isAuthorizedAdmin}
                        onClick={() => handleToggleMapping(mapping)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase transition-all ${
                          mapping.enabled !== false 
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' 
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${mapping.enabled !== false ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        <span>{mapping.enabled !== false ? 'Active' : 'Disabled'}</span>
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {isAuthorizedAdmin && (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(mapping)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Edit Mapping"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMapping(mapping.id, mapping.sourceValue)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete Mapping"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}

                {filteredMappings.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 italic text-xs">
                      No identity mappings configured. Click "Add Mapping Rule" to map IdP groups to EchoNote roles.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* SECTION 3: INTERACTIVE RULE SIMULATOR & TEST BENCH */}
      <div className="p-6 bg-slate-900 text-white rounded-2xl border border-slate-800 space-y-6 shadow-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Play size={16} className="text-indigo-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Identity Mapping Diagnostic & Resolution Simulator
            </h4>
          </div>
          <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-800">
            Real-time Sandbox
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Simulate incoming identity claims from Microsoft Entra ID or SAML 2.0 to preview which role and department will be resolved and verify that conflict resolution rules behave as expected.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Test User Email *</label>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="alex.chen@enterprise.com"
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">SSO Provider</label>
            <select
              value={testProvider}
              onChange={(e) => setTestProvider(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white font-bold focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All / Generic SSO</option>
              <option value="entra">Microsoft Entra ID (OIDC)</option>
              <option value="saml">SAML 2.0 WebSSO</option>
              <option value="google">Google Workspace</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Simulated IdP Groups</label>
            <input
              type="text"
              value={testGroups}
              onChange={(e) => setTestGroups(e.target.value)}
              placeholder="sg-cloud-admins, devops-lead"
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Simulated Department</label>
            <input
              type="text"
              value={testDept}
              onChange={(e) => setTestDept(e.target.value)}
              placeholder="Engineering"
              className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-[10px] text-slate-400 font-mono">
            Evaluates active Firestore mapping rules against deterministic sorting & fail-safe resolution.
          </span>

          <button
            type="button"
            disabled={isRunningTest || !testEmail.trim()}
            onClick={handleRunSimulation}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer"
          >
            {isRunningTest ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            <span>Run Rule Evaluation</span>
          </button>
        </div>

        {/* Simulation Output Card */}
        {testResult && (
          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-3 font-mono text-xs text-slate-300">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="flex items-center gap-2 font-bold text-emerald-400">
                <CheckCircle2 size={15} />
                <span>Simulation Evaluation Result</span>
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                testResult.mode === 'MAPPED' ? 'bg-indigo-900/80 text-indigo-300' : 'bg-slate-800 text-slate-400'
              }`}>
                Mode: {testResult.mode}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
              <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Resolved Org Role</span>
                <span className="text-base font-bold text-white uppercase">{testResult.resolvedRole}</span>
              </div>
              <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Resolved Department</span>
                <span className="text-sm font-bold text-white">{testResult.resolvedDepartmentName || 'Unchanged / Default'}</span>
              </div>
              <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800">
                <span className="text-slate-500 block text-[10px] uppercase font-bold">Conflict State</span>
                <span className={`text-sm font-bold ${testResult.conflictDetected ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {testResult.conflictDetected ? '⚠️ Equal Priority Conflict (Resolved Safe)' : 'Clean Match'}
                </span>
              </div>
            </div>

            {testResult.appliedMapping && (
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 text-[10px] text-slate-400 space-y-1">
                <div className="text-slate-300 font-bold">Matched Rule:</div>
                <div>Rule ID: <span className="text-indigo-300">{testResult.appliedMapping.id}</span></div>
                <div>Matched On: <span className="text-white">{testResult.appliedMapping.sourceType} = "{testResult.appliedMapping.sourceValue}"</span> (Priority {testResult.appliedMapping.priority})</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CREATE / EDIT MAPPING MODAL */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                    <Sliders size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                      {editingMapping ? 'Edit Identity Mapping Rule' : 'Add New Identity Mapping Rule'}
                    </h3>
                    <p className="text-[11px] text-slate-500">Configure deterministic attribute-to-role binding</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveMapping} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Identity Provider</label>
                    <select
                      value={formProvider}
                      onChange={(e) => setFormProvider(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                    >
                      <option value="all">All Providers</option>
                      <option value="entra">Microsoft Entra ID (OIDC)</option>
                      <option value="saml">SAML 2.0</option>
                      <option value="google">Google Workspace</option>
                      <option value="oidc">Generic OIDC</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Source Claim Type</label>
                    <select
                      value={formSourceType}
                      onChange={(e) => setFormSourceType(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                    >
                      <option value="group">Security Group (MemberOf / Groups)</option>
                      <option value="department">Department Attribute</option>
                      <option value="job_title">Job Title Attribute</option>
                      <option value="claim">Custom Token Claim</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">
                    Source Value to Match *
                  </label>
                  <input
                    type="text"
                    required
                    value={formSourceValue}
                    onChange={(e) => setFormSourceValue(e.target.value)}
                    placeholder={formSourceType === 'group' ? 'e.g. sg-cloud-administrators' : formSourceType === 'department' ? 'e.g. Engineering' : 'e.g. Senior Architect'}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[10px] text-slate-500">Case-insensitive exact matching is applied against the incoming token assertion.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Target Organization Role</label>
                    <select
                      value={formTargetRole}
                      onChange={(e) => setFormTargetRole(e.target.value as OrgRole)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                    >
                      <option value="member">Member (Standard Access)</option>
                      <option value="team_manager">Team Manager (Department Lead)</option>
                      <option value="org_admin">Organization Admin (Administrative Access)</option>
                    </select>
                    <span className="text-[9px] text-slate-400 block italic">The "Owner" role cannot be assigned via IdP mapping.</span>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Target Department</label>
                    <select
                      value={formTargetDeptId}
                      onChange={(e) => setFormTargetDeptId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                    >
                      <option value="">Leave Unchanged / None</option>
                      {departments.map((dept) => (
                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center pt-1">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Rule Priority (1 - 100)</label>
                      <span className="text-xs font-mono font-bold text-indigo-600">{formPriority}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={formPriority}
                      onChange={(e) => setFormPriority(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                    <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                      <span>Low (1)</span>
                      <span>Normal (10)</span>
                      <span>High (100)</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Rule State</label>
                    <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                      <span className="text-xs font-bold text-slate-700">{formEnabled ? 'Active' : 'Disabled'}</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formEnabled}
                          onChange={(e) => setFormEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingMapping || !formSourceValue.trim()}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                  >
                    {isSavingMapping ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                    <span>{editingMapping ? 'Save Changes' : 'Create Rule'}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
