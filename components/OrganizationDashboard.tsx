import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Building2, 
  Users, 
  Layers, 
  CreditCard, 
  BarChart3, 
  Plus, 
  Trash2, 
  UserPlus, 
  Check, 
  Sliders, 
  TrendingUp, 
  ShieldCheck, 
  AlertCircle, 
  Mail, 
  Settings, 
  Briefcase, 
  Lock, 
  Globe, 
  UserCheck, 
  Sparkles,
  Info,
  Search,
  Filter,
  Shield,
  Edit2,
  Key,
  EyeOff,
  AlertTriangle,
  Database,
  Terminal,
  Fingerprint,
  FileText,
  Copy,
  Send,
  RefreshCw,
  X,
  Archive,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Compass,
  Palette,
  ExternalLink,
  DollarSign,
  Activity,
  HardDrive,
  Percent,
  ArrowUpRight,
  Download,
  UserX,
  RotateCcw,
  ArrowRightLeft,
  Loader2
} from 'lucide-react';
import { 
  db, 
  auth,
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  addDoc, 
  serverTimestamp,
  getDocs
} from '../firebase';
import { 
  Project, 
  UserProfile, 
  Organization, 
  Team, 
  OrgMember, 
  OrgInvoice, 
  SubscriptionTier,
  OrgRole,
  OrgIdentityMapping,
  OrgJitSettings,
  normalizeOrgRole
} from '../types';
import { logAction } from '../services/auditService';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  CartesianGrid 
} from 'recharts';
import { Toaster, toast } from 'sonner';
import { OrganizationBilling } from './OrganizationBilling';
import { IntegrationsView } from './IntegrationsView';
import { IdentityMappingSettings } from './IdentityMappingSettings';
import { EnterpriseSecurityHealth } from './EnterpriseSecurityHealth';
import { 
  apiFetch,
  cancelOrgInvitation,
  assignMemberDepartment,
  deactivateMember,
  reactivateMember,
  transferOrgOwnership,
  removeOrgMember,
  updateMemberRole,
  sendOrgInvite
} from '../lib/apiClient';

// Robust local types for Organization Management
export interface Department {
  id: string;
  orgId: string;
  name: string;
  description: string;
  projectIds: string[];
  createdAt: string;
  minutesUsed?: number;
  aiCost?: number;
  aiUsage?: number;
  aiBudgetLimit?: number;
}

export interface OrgInvitation {
  id: string;
  orgId: string;
  email: string;
  role: string;
  departmentId: string;
  status: 'pending' | 'accepted' | 'expired' | 'rejected';
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  history: Array<{
    event: 'created' | 'resent' | 'cancelled';
    timestamp: string;
    by: string;
  }>;
}

interface OrganizationDashboardProps {
  projects: Project[];
  userProfile: UserProfile | undefined;
  addNotification: (notif: any) => void;
  userOrgRole: OrgRole;
}

export const OrganizationDashboard: React.FC<OrganizationDashboardProps> = ({
  projects,
  userProfile,
  addNotification,
  userOrgRole
}) => {
  const isAdmin = userOrgRole === 'owner' || userOrgRole === 'org_admin';
  const isOwner = userOrgRole === 'owner';

  // Navigation Tabs for Organization Management System
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics' | 'departments' | 'members' | 'invitations' | 'projects' | 'roles' | 'security' | 'billing' | 'settings' | 'integrations'>('overview');

  // Firestore Collections & UI States
  const [organization, setOrganization] = useState<Organization & {
    industry?: string;
    timezone?: string;
    country?: string;
    language?: string;
    defaultWorkspace?: string;
    brandColor?: string;
    storageUsed?: number;
    aiUsage?: number;
    monthlyMinutesUsed?: number;
    thinkingEngineUsage?: number;
    monthlyAiCost?: number;
    monthlyRevenue?: number;
    apiCost?: number;
  } | null>(null);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [monthlyTrends, setMonthlyTrends] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [chartMetric, setChartMetric] = useState<'financial' | 'usage'>('financial');

  // Form & Interaction States
  // 1. Department Modals & Inputs
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptName, setDeptName] = useState('');
  const [deptDesc, setDeptDesc] = useState('');
  const [deptProjects, setDeptProjects] = useState<string[]>([]);
  const [deptBudgetLimit, setDeptBudgetLimit] = useState('');

  // 2. Member Lists Search/Filter/Pagination
  const [memberSearch, setMemberSearch] = useState('');
  const [memberRoleFilter, setMemberRoleFilter] = useState<string>('all');
  const [memberDeptFilter, setMemberDeptFilter] = useState<string>('all');
  const [memberStatusFilter, setMemberStatusFilter] = useState<string>('all');
  const [memberPage, setMemberPage] = useState(1);
  const itemsPerPage = 8;

  // 3. Invitation Modal & Inputs
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteDeptId, setInviteDeptId] = useState('');

  // Step 5D: Admin UI Action & Confirmation States
  const [actionLoading, setActionLoading] = useState<{ [key: string]: boolean }>({});
  const isActionInProgress = (key: string) => Boolean(actionLoading[key]);
  const setActionState = (key: string, inProgress: boolean) => {
    setActionLoading(prev => ({ ...prev, [key]: inProgress }));
  };

  // Confirmation Modals for Destructive/High-Impact Operations
  const [cancellingInvite, setCancellingInvite] = useState<OrgInvitation | null>(null);
  const [deactivatingMember, setDeactivatingMember] = useState<OrgMember | null>(null);
  const [removingMember, setRemovingMember] = useState<OrgMember | null>(null);

  // Deliberate Owner-Only Ownership Transfer Flow
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferTargetMemberId, setTransferTargetMemberId] = useState('');
  const [transferConfirmText, setTransferConfirmText] = useState('');
  const [transferError, setTransferError] = useState<string | null>(null);

  // 4. Role Assignments & Detail State
  const [selectedRoleDetail, setSelectedRoleDetail] = useState<string>('member');

  // 5. Settings Inputs
  const [settingsName, setSettingsName] = useState('');
  const [settingsLogo, setSettingsLogo] = useState('');
  const [settingsIndustry, setSettingsIndustry] = useState('');
  const [settingsTimezone, setSettingsTimezone] = useState('UTC');
  const [settingsCountry, setSettingsCountry] = useState('India');
  const [settingsLanguage, setSettingsLanguage] = useState('English');
  const [settingsDefaultWorkspace, setSettingsDefaultWorkspace] = useState('');
  const [settingsBrandColor, setSettingsBrandColor] = useState('#0F172A');
  const [settingsEnforceMfa, setSettingsEnforceMfa] = useState(false);
  const [settingsSessionTimeout, setSettingsSessionTimeout] = useState(60);

  // 6. Security Center Settings State
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(true);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [microsoftAuthEnabled, setMicrosoftAuthEnabled] = useState(true);
  const [microsoftClientId, setMicrosoftClientId] = useState('');
  const [microsoftClientSecret, setMicrosoftClientSecret] = useState('');
  const [entraTenantId, setEntraTenantId] = useState('');
  const [entraClientId, setEntraClientId] = useState('');
  const [enforceSso, setEnforceSso] = useState(false);
  const [ssoStatus, setSsoStatus] = useState<'disabled' | 'enabled'>('enabled');
  const [ssoProtocol, setSsoProtocol] = useState<'OIDC' | 'SAML'>('OIDC');
  const [ssoIdpUrl, setSsoIdpUrl] = useState('https://accounts.google.com');
  const [samlStatus, setSamlStatus] = useState<'disabled' | 'enabled'>('disabled');
  const [samlDisplayName, setSamlDisplayName] = useState('Corporate SAML');
  const [samlEntityId, setSamlEntityId] = useState('');
  const [samlSsoUrl, setSamlSsoUrl] = useState('');
  const [samlCertificate, setSamlCertificate] = useState('');
  const [samlTesting, setSamlTesting] = useState(false);
  const [samlTestResult, setSamlTestResult] = useState<any | null>(null);
  const [samlSaving, setSamlSaving] = useState(false);
  const [samlProviderMeta, setSamlProviderMeta] = useState<any | null>(null);
  const [pwdMinLength, setPwdMinLength] = useState(8);
  const [pwdEnforceSpecial, setPwdEnforceSpecial] = useState(true);
  const [pwdEnforceNumbers, setPwdEnforceNumbers] = useState(true);
  const [pwdMaxAge, setPwdMaxAge] = useState(90);
  const [twoFactorStatus, setTwoFactorStatus] = useState<'disabled' | 'optional' | 'required_admins' | 'required_all'>('optional');
  const [sessionTimeout, setSessionTimeout] = useState('1h');
  const [allowedDomainsStr, setAllowedDomainsStr] = useState('echonote.com, google.com, microsoft.com');
  const [blockedDomainsStr, setBlockedDomainsStr] = useState('malicious.com, spammer.org');
  const [securitySubTab, setSecuritySubTab] = useState<'health' | 'sso' | 'jit' | 'policies' | 'api' | 'audits'>('health');
  const [identityMappings, setIdentityMappings] = useState<OrgIdentityMapping[]>([]);
  const [searchAuditQuery, setSearchAuditQuery] = useState('');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterProject, setFilterProject] = useState<string>('all');

  // Interactive local states for API keys
  const [apiKeys, setApiKeys] = useState<Array<{id: string, label: string, key: string, role: string, status: 'active' | 'revoked', createdAt: string}>>([]);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [newKeyRole, setNewKeyRole] = useState('Admin');
  const [generatedKeyResult, setGeneratedKeyResult] = useState<string | null>(null);

  // Security Events & Audit log states
  const [securityEvents, setSecurityEvents] = useState<Array<{id: string, event: string, severity: 'low' | 'medium' | 'high' | 'critical', details: string, status: 'resolved' | 'active', timestamp: string}>>([]);

  const [auditLogs, setAuditLogs] = useState<Array<{id: string, action: string, actor: string, ip: string, details: string, timestamp: string}>>([]);

  const [subcollectionAuditLogs, setSubcollectionAuditLogs] = useState<any[]>([]);

  // Load Organization & Sub-collections in real-time
  useEffect(() => {
    if (!userProfile?.email) return;

    if (!auth?.currentUser) {
      // Unauthenticated / Guest Mode: clean state without mock data
      setOrganization(null);
      setDepartments([]);
      setOrgMembers([]);
      setInvitations([]);
      setMonthlyTrends([]);
      setSubcollectionAuditLogs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let unsubSubcollections: (() => void) | null = null;

    // Query organization where current user is the owner
    const ownerOrgQuery = query(
      collection(db, 'organizations'),
      where('ownerEmail', '==', userProfile.email)
    );

    const unsubscribe = onSnapshot(ownerOrgQuery, async (ownerSnap) => {
      if (!ownerSnap.empty) {
        // Current user is the owner of this organization
        const orgDoc = ownerSnap.docs[0];
        const orgData = { id: orgDoc.id, ...orgDoc.data() };
        setOrganization(orgData as any);
        initSettingsForm(orgData);
        if (unsubSubcollections) unsubSubcollections();
        unsubSubcollections = setupSubcollectionListeners(orgDoc.id);
        setLoading(false);
      } else {
        // Fallback: Check if the user is a registered member of any organization
        const memberQuery = query(
          collection(db, 'orgMembers'),
          where('email', '==', userProfile.email)
        );

        const memberDocs = await getDocs(memberQuery);
        if (!memberDocs.empty) {
          const memberData = memberDocs.docs[0].data() as OrgMember;
          const orgDocRef = doc(db, 'organizations', memberData.orgId);
          
          const unsubOrg = onSnapshot(orgDocRef, (orgDoc) => {
            if (orgDoc.exists()) {
              const orgData = { id: orgDoc.id, ...orgDoc.data() };
              setOrganization(orgData as any);
              initSettingsForm(orgData);
              if (unsubSubcollections) unsubSubcollections();
              unsubSubcollections = setupSubcollectionListeners(orgDoc.id);
            } else {
              setOrganization(null);
            }
            setLoading(false);
          }, (err) => {
            console.error("Error fetching org:", err);
            setLoading(false);
          });
          return () => {
            unsubOrg();
            if (unsubSubcollections) unsubSubcollections();
          };
        } else {
          // No organization found for this user
          setOrganization(null);
          setLoading(false);
        }
      }
    }, (error) => {
      console.error("Error loading organizations:", error);
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (unsubSubcollections) unsubSubcollections();
    };
  }, [userProfile?.email]);

  // Set up local forms with loaded organization values
  const initSettingsForm = (org: any) => {
    setSettingsName(org.name || '');
    setSettingsLogo(org.logoUrl || org.settings?.logoUrl || '🏢');
    setSettingsIndustry(org.industry || org.settings?.industry || 'Technology');
    setSettingsTimezone(org.timezone || org.settings?.timezone || 'Asia/Kolkata');
    setSettingsCountry(org.country || org.settings?.country || 'India');
    setSettingsLanguage(org.language || org.settings?.language || 'English');
    setSettingsDefaultWorkspace(org.defaultWorkspace || org.settings?.defaultWorkspace || '');
    setSettingsBrandColor(org.brandColor || org.settings?.brandColor || '#0F172A');
    setSettingsEnforceMfa(org.settings?.enforceMfa || false);
    setSettingsSessionTimeout(org.settings?.sessionTimeoutMinutes || 60);

    // Initialize Security Center from database if available
    const sec = org.securitySettings || {};
    setGoogleAuthEnabled(sec.googleAuthEnabled !== false);
    setGoogleClientId(sec.googleClientId || '');
    setGoogleClientSecret(sec.googleClientSecret || '');
    setMicrosoftAuthEnabled(sec.microsoftAuthEnabled !== false);
    setMicrosoftClientId(sec.microsoftClientId || '');
    setMicrosoftClientSecret(sec.microsoftClientSecret || '');
    setEntraTenantId(sec.entraTenantId || '');
    setEntraClientId(sec.entraClientId || sec.microsoftClientId || '');
    setEnforceSso(Boolean(sec.enforceSso));
    setSsoStatus(sec.ssoStatus || 'enabled');
    setSsoProtocol(sec.ssoProtocol || 'OIDC');
    setSsoIdpUrl(sec.ssoIdpUrl || 'https://accounts.google.com');
    setSamlStatus(sec.samlStatus || (sec.samlProvider?.enabled ? 'enabled' : 'disabled'));
    const samlCfg = sec.samlProvider || {};
    setSamlDisplayName(samlCfg.displayName || 'Corporate SAML');
    setSamlEntityId(samlCfg.entityId || sec.samlEntityId || '');
    setSamlSsoUrl(samlCfg.ssoUrl || sec.samlSsoUrl || '');
    setSamlCertificate(
      Array.isArray(samlCfg.x509Certificates)
        ? samlCfg.x509Certificates.join('\n')
        : (samlCfg.x509Certificates || sec.samlCertificate || '')
    );
    setSamlProviderMeta(samlCfg);
    setPwdMinLength(sec.pwdMinLength || 8);
    setPwdEnforceSpecial(sec.pwdEnforceSpecial !== false);
    setPwdEnforceNumbers(sec.pwdEnforceNumbers !== false);
    setPwdMaxAge(sec.pwdMaxAge || 90);
    setTwoFactorStatus(sec.twoFactorStatus || 'optional');
    setSessionTimeout(sec.sessionTimeout || '1h');
    setAllowedDomainsStr(sec.allowedDomains || 'echonote.com, google.com, microsoft.com');
    setBlockedDomainsStr(sec.blockedDomains || 'malicious.com, spammer.org');

    if (sec.apiKeys && Array.isArray(sec.apiKeys)) {
      setApiKeys(sec.apiKeys);
    }
    if (sec.securityEvents && Array.isArray(sec.securityEvents)) {
      setSecurityEvents(sec.securityEvents);
    }
    if (sec.auditLogs && Array.isArray(sec.auditLogs)) {
      setAuditLogs(sec.auditLogs);
    }
  };

  // Real-time Subcollection Listeners
  const setupSubcollectionListeners = (orgId: string) => {
    // 1. Departments Listener
    const qDepts = query(collection(db, 'departments'), where('orgId', '==', orgId));
    const unsubDepts = onSnapshot(qDepts, (snap) => {
      setDepartments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Department)));
    });

    // 2. Members Listener
    const qMembers = query(collection(db, 'orgMembers'), where('orgId', '==', orgId));
    const unsubMembers = onSnapshot(qMembers, (snap) => {
      setOrgMembers(snap.docs.map(d => ({ id: d.id, ...d.data() } as OrgMember)));
    });

    // 3. Invitations Listener
    const qInvites = query(collection(db, 'orgInvitations'), where('orgId', '==', orgId));
    const unsubInvites = onSnapshot(qInvites, (snap) => {
      setInvitations(snap.docs.map(d => ({ id: d.id, ...d.data() } as OrgInvitation)));
    });

    // 4. Monthly Trends Listener
    const qTrends = query(collection(db, 'organizations', orgId, 'monthlyTrends'));
    const unsubTrends = onSnapshot(qTrends, (snap) => {
      setMonthlyTrends(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    // 5. Audit Logs Listener
    const qAuditLogs = query(collection(db, 'organizations', orgId, 'auditLogs'));
    const unsubAuditLogs = onSnapshot(qAuditLogs, (snap) => {
      const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      logs.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setSubcollectionAuditLogs(logs);
    });

    // 6. Identity Mappings Listener (Phase 1.7)
    const qMappings = query(collection(db, 'orgIdentityMappings'), where('orgId', '==', orgId));
    const unsubMappings = onSnapshot(qMappings, (snap) => {
      const maps = snap.docs.map(d => ({ id: d.id, ...d.data() } as OrgIdentityMapping));
      maps.sort((a, b) => {
        if ((b.priority ?? 10) !== (a.priority ?? 10)) return (b.priority ?? 10) - (a.priority ?? 10);
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });
      setIdentityMappings(maps);
    });

    return () => {
      unsubDepts();
      unsubMembers();
      unsubInvites();
      unsubTrends();
      unsubAuditLogs();
      unsubMappings();
    };
  };

  // Provision a real Firestore organization for the user
  const handleBootstrapOrganization = async () => {
    if (!userProfile) return;
    setIsSeeding(true);
    const toastId = toast.loading("Initializing Enterprise Organization...");

    try {
      const emailDomain = userProfile.email.split('@')[1] || 'enterprise.com';
      const companyName = emailDomain.split('.')[0].toUpperCase() + " Corporation";

      // 1. Authoritative Organization Creation via backend API (creates org, adds owner to orgMembers, syncs custom claims)
      const createRes = await apiFetch('/api/organizations', {
        method: 'POST',
        body: JSON.stringify({
          name: companyName,
          industry: 'Technology & AI Research',
          timezone: 'Asia/Kolkata',
          country: 'India',
          logoUrl: '🛡️'
        })
      });

      if (!createRes.ok) {
        const errJson = await createRes.json().catch(() => ({}));
        throw new Error(errJson.message || `Failed to create organization (HTTP ${createRes.status})`);
      }

      const createData = await createRes.json();
      const orgId = createData.organization?.id || ('org_' + Math.random().toString(36).substring(2, 9));

      // 2. Create primary General department
      const dId = 'dept_' + Math.random().toString(36).substring(2, 9);
      await setDoc(doc(db, 'departments', dId), {
        id: dId,
        orgId,
        name: 'General',
        description: 'Main corporate workspace department.',
        projectIds: projects.map(p => p.id),
        minutesUsed: 0,
        aiCost: 0,
        aiUsage: 0,
        aiBudgetLimit: 100,
        createdAt: new Date().toISOString()
      });

      // 3. Update Project records with orgId in Firestore
      for (const p of projects) {
        await updateDoc(doc(db, 'projects', p.id), {
          orgId,
          status: 'active'
        });
      }

      // 5. Initial audit log
      await logAction(orgId, {
        action: 'Organization Created',
        actor: userProfile.email,
        details: `Provisioned ${companyName} organization space.`,
        organizationName: companyName
      });

      toast.success("Enterprise Organization successfully initialized!", { id: toastId });
      addNotification({
        title: 'Organization Initialized',
        message: `Successfully provisioned ${companyName}.`,
        type: 'success',
        createdAt: new Date().toISOString()
      });
    } catch (err: any) {
      console.error(err);
      toast.error("Initialization failed: " + err.message, { id: toastId });
    } finally {
      setIsSeeding(false);
    }
  };

  // Create or Update Department in Firestore
  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !deptName.trim()) return;

    const budgetVal = deptBudgetLimit.trim() === '' ? 0 : parseFloat(deptBudgetLimit);

    try {
      if (editingDept) {
        // Edit flow
        await updateDoc(doc(db, 'departments', editingDept.id), {
          name: deptName.trim(),
          description: deptDesc.trim(),
          projectIds: deptProjects,
          aiBudgetLimit: budgetVal
        });
        toast.success(`Department "${deptName}" updated successfully.`);
      } else {
        // Create flow
        const dId = 'dept_' + Math.random().toString(36).substring(2, 9);
        await setDoc(doc(db, 'departments', dId), {
          id: dId,
          orgId: organization.id,
          name: deptName.trim(),
          description: deptDesc.trim(),
          projectIds: deptProjects,
          minutesUsed: 0,
          aiCost: 0,
          aiUsage: 0,
          aiBudgetLimit: budgetVal,
          createdAt: new Date().toISOString()
        });
        toast.success(`Department "${deptName}" created successfully.`);
      }

      // Close modal & reset
      setIsDeptModalOpen(false);
      setEditingDept(null);
      setDeptName('');
      setDeptDesc('');
      setDeptProjects([]);
      setDeptBudgetLimit('');
    } catch (err: any) {
      toast.error("Failed to save department: " + err.message);
    }
  };

  // Edit Department button click
  const handleStartEditDept = (dept: Department) => {
    setEditingDept(dept);
    setDeptName(dept.name);
    setDeptDesc(dept.description || '');
    setDeptProjects(dept.projectIds || []);
    setDeptBudgetLimit(dept.aiBudgetLimit !== undefined ? String(dept.aiBudgetLimit) : '');
    setIsDeptModalOpen(true);
  };

  // Delete Department
  const handleDeleteDept = async (deptId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete the department "${name}"?`)) return;

    try {
      await deleteDoc(doc(db, 'departments', deptId));
      // Reset members who belonged to this department via authoritative backend API
      const affectedMembers = orgMembers.filter(m => m.departmentId === deptId);
      for (const m of affectedMembers) {
        try {
          if (organization) {
            await assignMemberDepartment(organization.id, m.id, null);
          }
        } catch (mErr) {
          console.warn("Failed to unassign member dept:", mErr);
        }
      }
      toast.success(`Department "${name}" deleted.`);
    } catch (err: any) {
      toast.error("Failed to delete department: " + err.message);
    }
  };

  // Members Role Assignment Update (Authoritative Backend API)
  const handleUpdateMemberRole = async (memberId: string, role: string) => {
    if (!organization || !isAdmin) return;
    const targetMember = orgMembers.find(m => m.id === memberId);
    setActionState('role_' + memberId, true);
    try {
      await updateMemberRole(organization.id, memberId, role);
      toast.success(`Role for ${targetMember?.email || 'member'} updated to "${role}".`);
      await logAction(organization.id, {
        action: 'Role Changed',
        actor: userProfile?.email || 'Admin',
        details: `Updated role of member ${targetMember?.email || 'member'} to "${role}".`,
        organizationName: organization.name
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to update member role.");
    } finally {
      setActionState('role_' + memberId, false);
    }
  };

  // Members Department Assignment Update (Authoritative Backend API)
  const handleUpdateMemberDept = async (memberId: string, deptId: string) => {
    if (!organization || !isAdmin) return;
    setActionState('dept_' + memberId, true);
    try {
      await assignMemberDepartment(organization.id, memberId, deptId ? deptId : null);
      toast.success(deptId ? "Member department assigned successfully." : "Member department cleared.");
    } catch (err: any) {
      toast.error(err.message || "Failed to update department assignment.");
    } finally {
      setActionState('dept_' + memberId, false);
    }
  };

  // Remove Member from Organization (Authoritative Backend API)
  const handleRemoveMember = async (member: OrgMember) => {
    if (!organization || !isAdmin) return;
    if (member.role === 'owner' || member.userId === organization.ownerId) {
      toast.error("The organization owner cannot be removed.");
      return;
    }
    setActionState('remove_' + member.id, true);
    try {
      await removeOrgMember(organization.id, member.id);
      toast.success(`${member.name || member.email} has been removed from organization.`);
      setRemovingMember(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to remove member.");
    } finally {
      setActionState('remove_' + member.id, false);
    }
  };

  // Deactivate Organization Member (Authoritative Backend API)
  const handleDeactivateMember = async (member: OrgMember) => {
    if (!organization || !isAdmin) return;
    if (member.role === 'owner' || member.userId === organization.ownerId) {
      toast.error("The organization owner cannot be deactivated.");
      return;
    }
    setActionState('deactivate_' + member.id, true);
    try {
      await deactivateMember(organization.id, member.id);
      toast.success(`Member ${member.name || member.email} has been deactivated.`);
      setDeactivatingMember(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to deactivate member.");
    } finally {
      setActionState('deactivate_' + member.id, false);
    }
  };

  // Reactivate Organization Member (Authoritative Backend API)
  const handleReactivateMember = async (member: OrgMember) => {
    if (!organization || !isAdmin) return;
    setActionState('reactivate_' + member.id, true);
    try {
      await reactivateMember(organization.id, member.id);
      toast.success(`Member ${member.name || member.email} has been reactivated.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to reactivate member.");
    } finally {
      setActionState('reactivate_' + member.id, false);
    }
  };

  // Ownership Transfer (Authoritative Backend API, Owner-Only)
  const handleTransferOwnership = async () => {
    if (!organization || !isOwner) {
      toast.error("Only the organization owner can transfer ownership.");
      return;
    }
    if (!transferTargetMemberId) {
      toast.error("Please select an active member to receive ownership.");
      return;
    }
    if (transferConfirmText.trim().toUpperCase() !== 'TRANSFER') {
      toast.error('Please type "TRANSFER" in the confirmation field to proceed.');
      return;
    }

    const targetMember = orgMembers.find(m => m.id === transferTargetMemberId);
    if (!targetMember) {
      toast.error("Selected member could not be found.");
      return;
    }

    setTransferError(null);
    setActionState('transfer', true);
    try {
      await transferOrgOwnership(organization.id, {
        targetMemberId: targetMember.id,
        targetEmail: targetMember.email,
        targetUserId: targetMember.userId
      });
      toast.success(`Ownership transferred successfully to ${targetMember.name || targetMember.email}.`);
      setIsTransferModalOpen(false);
      setTransferTargetMemberId('');
      setTransferConfirmText('');
    } catch (err: any) {
      setTransferError(err.message || "Failed to transfer ownership.");
      toast.error(err.message || "Failed to transfer ownership.");
    } finally {
      setActionState('transfer', false);
    }
  };

  // Create a new Invitation (Authoritative Backend API)
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !isAdmin || !inviteEmail.trim()) return;

    try {
      const email = inviteEmail.trim().toLowerCase();
      
      // Prevent duplicates
      const isAlreadyMember = orgMembers.some(m => m.email === email);
      if (isAlreadyMember) {
        toast.error(`${email} is already a member of this organization.`);
        return;
      }

      setActionState('send_invite', true);
      const res = await sendOrgInvite(organization.id, {
        email,
        role: inviteRole,
        departmentId: inviteDeptId || undefined
      });

      if (res.emailSent === false) {
        const failureReason = res.emailError || res.warning || "email delivery failed";
        toast.warning(`Invitation created for ${email}, but delivery email failed: ${failureReason}. You can copy the invite link or retry.`);
      } else {
        toast.success(`Invitation successfully sent to ${email}`);
      }
      setInviteEmail('');
      setInviteRole('member');
      setInviteDeptId('');
    } catch (err: any) {
      toast.error(err.message || "Failed to send invitation.");
    } finally {
      setActionState('send_invite', false);
    }
  };

  // Resend invitation (Authoritative Backend API)
  const handleResendInvite = async (invite: OrgInvitation) => {
    if (!organization || !isAdmin) return;
    setActionState('resend_' + invite.id, true);
    try {
      const res = await sendOrgInvite(organization.id, {
        email: invite.email,
        role: invite.role,
        departmentId: invite.departmentId || undefined,
        resend: true
      });
      if (res.emailSent === false) {
        const failureReason = res.emailError || res.warning || "email re-delivery failed";
        toast.warning(`Invitation active for ${invite.email}, but email re-delivery could not be completed (${failureReason}).`);
      } else {
        toast.success(`Invitation resent to ${invite.email}.`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to resend invitation.");
    } finally {
      setActionState('resend_' + invite.id, false);
    }
  };

  // Cancel invitation (Authoritative Backend API)
  const handleCancelInvite = async (invite: OrgInvitation) => {
    if (!organization || !isAdmin) return;
    setActionState('cancel_' + invite.id, true);
    try {
      await cancelOrgInvitation(organization.id, invite.id);
      toast.success(`Invitation for ${invite.email} cancelled successfully.`);
      setCancellingInvite(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel invitation.");
    } finally {
      setActionState('cancel_' + invite.id, false);
    }
  };

  // Simulate member joining the organization via active invitation
  const handleSimulateJoin = async (invite: OrgInvitation) => {
    if (!organization) return;
    try {
      const res = await apiFetch('/api/organizations/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ inviteId: invite.id })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to accept invitation');
      }
      toast.success(`Joined organization as ${invite.email}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to accept invitation.");
    }
  };

  // Copy invitation link to clipboard
  const handleCopyInviteLink = (inviteId: string) => {
    const inviteLink = `${window.location.origin}/join?token=${inviteId}`;
    navigator.clipboard.writeText(inviteLink);
    toast.success("Invitation link copied to clipboard!");
  };

  // Export Audit Logs to CSV
  const handleExportCSV = (logsToExport: any[]) => {
    if (logsToExport.length === 0) {
      toast.error("No logs available to export.");
      return;
    }
    const headers = ["Timestamp", "Action", "Authorized Actor", "Project", "Organization", "Details", "IP Address"];
    const csvContent = [
      headers.join(","),
      ...logsToExport.map(log => [
        `"${new Date(log.timestamp).toISOString()}"`,
        `"${log.action}"`,
        `"${log.actor}"`,
        `"${log.project || 'Global'}"`,
        `"${log.organizationName || organization?.name || 'N/A'}"`,
        `"${log.details.replace(/"/g, '""')}"`,
        `"${log.ip || '192.168.1.1'}"`
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `audit_log_${organization?.id || 'export'}_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Audit Logs exported to CSV successfully!");
  };

  // Save Settings via Authoritative API
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;

    try {
      const res = await apiFetch(`/api/organizations/${organization.id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: settingsName.trim(),
          logoUrl: settingsLogo.trim(),
          industry: settingsIndustry.trim(),
          timezone: settingsTimezone,
          country: settingsCountry,
          securitySettings: {
            enforceMfa: settingsEnforceMfa,
            sessionTimeoutMinutes: settingsSessionTimeout,
            brandColor: settingsBrandColor,
            language: settingsLanguage,
            defaultWorkspace: settingsDefaultWorkspace
          }
        })
      });

      if (!res.ok) {
        // Fallback to client write if API is unavailable
        await updateDoc(doc(db, 'organizations', organization.id), {
          name: settingsName.trim(),
          logoUrl: settingsLogo.trim(),
          industry: settingsIndustry.trim(),
          timezone: settingsTimezone,
          country: settingsCountry,
          language: settingsLanguage,
          defaultWorkspace: settingsDefaultWorkspace,
          brandColor: settingsBrandColor,
          'settings.enforceMfa': settingsEnforceMfa,
          'settings.sessionTimeoutMinutes': settingsSessionTimeout,
          'settings.logoUrl': settingsLogo.trim(),
          'settings.industry': settingsIndustry.trim(),
          'settings.timezone': settingsTimezone,
          'settings.country': settingsCountry,
          'settings.language': settingsLanguage,
          'settings.defaultWorkspace': settingsDefaultWorkspace,
          'settings.brandColor': settingsBrandColor
        });
      }

      await logAction(organization.id, {
        action: 'Organization Settings Updated',
        actor: userProfile?.email || 'Admin',
        details: `Updated general settings for organization "${settingsName.trim()}".`,
        organizationName: settingsName.trim()
      });

      toast.success("Organization settings saved successfully.");
    } catch (err: any) {
      toast.error("Failed to update organization settings: " + err.message);
    }
  };

  // Enterprise Security Center Policy Save
  const handleSaveSecuritySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;
    if (userOrgRole !== 'owner' && userOrgRole !== 'org_admin') {
      toast.error("Access Denied: Only administrators can modify security settings.");
      return;
    }

    try {
      const updatedSec = {
        googleAuthEnabled,
        googleClientId: googleClientId.trim(),
        googleClientSecret: googleClientSecret.trim(),
        microsoftAuthEnabled,
        microsoftClientId: microsoftClientId.trim(),
        microsoftClientSecret: microsoftClientSecret.trim(),
        entraTenantId: entraTenantId.trim(),
        entraClientId: entraClientId.trim() || microsoftClientId.trim(),
        enforceSso,
        ssoStatus,
        ssoProtocol,
        ssoIdpUrl: ssoIdpUrl.trim(),
        samlStatus,
        samlEntityId: samlEntityId.trim(),
        samlSsoUrl: samlSsoUrl.trim(),
        samlCertificate: samlCertificate.trim(),
        samlProvider: {
          providerId: samlProviderMeta?.providerId || `saml.${organization.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`,
          displayName: samlDisplayName.trim() || 'Corporate SAML',
          entityId: samlEntityId.trim(),
          ssoUrl: samlSsoUrl.trim(),
          x509Certificates: samlCertificate.trim() ? [samlCertificate.trim()] : [],
          enabled: samlStatus === 'enabled',
          status: samlProviderMeta?.status || (samlEntityId.trim() ? 'configured' : 'unconfigured'),
          updatedAt: new Date().toISOString()
        },
        pwdMinLength: Number(pwdMinLength),
        pwdEnforceSpecial,
        pwdEnforceNumbers,
        pwdMaxAge: Number(pwdMaxAge),
        twoFactorStatus,
        sessionTimeout,
        allowedDomains: allowedDomainsStr.trim(),
        blockedDomains: blockedDomainsStr.trim(),
        apiKeys,
        securityEvents,
        auditLogs: [
          {
            id: 'l_' + Date.now(),
            action: 'Update Security Configuration',
            actor: userProfile?.email || 'Admin',
            ip: '192.168.1.1',
            details: 'Saved updated security policies in Enterprise Security Center.',
            timestamp: new Date().toISOString()
          },
          ...auditLogs
        ].slice(0, 50)
      };

      await updateDoc(doc(db, 'organizations', organization.id), {
        securitySettings: updatedSec
      });

      await logAction(organization.id, {
        action: 'Organization Settings Updated',
        actor: userProfile?.email || 'Admin',
        details: 'Saved updated security policies in Enterprise Security Center.',
        organizationName: organization.name
      });

      toast.success("Enterprise Security Center policies saved successfully in Firestore!");
    } catch (err: any) {
      toast.error("Failed to save security settings: " + err.message);
    }
  };

  // Dedicated SAML 2.0 Provider Configuration & Testing Handlers (Phase 1.6)
  const handleSaveSamlConfig = async () => {
    if (!organization) return;
    if (userOrgRole !== 'owner' && userOrgRole !== 'org_admin') {
      toast.error("Access Denied: Only administrators can configure SAML 2.0 SSO.");
      return;
    }

    if (!samlEntityId.trim()) {
      toast.error("IdP Entity ID (Issuer URI) is required.");
      return;
    }
    if (!samlSsoUrl.trim()) {
      toast.error("IdP Single Sign-On (SSO) URL is required.");
      return;
    }
    if (!samlCertificate.trim()) {
      toast.error("X.509 Public Certificate (PEM format) is required.");
      return;
    }

    setSamlSaving(true);
    const toastId = toast.loading("Saving SAML 2.0 Provider & syncing Identity Platform...");

    try {
      const response = await apiFetch(`/api/organizations/${organization.id}/saml-config`, {
        method: 'POST',
        body: JSON.stringify({
          displayName: samlDisplayName.trim() || 'Corporate SAML',
          entityId: samlEntityId.trim(),
          ssoUrl: samlSsoUrl.trim(),
          x509Certificates: [samlCertificate.trim()],
          enabled: samlStatus === 'enabled',
          enforceSso
        })
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.message || data.error || "Failed to save SAML configuration");
      }

      setSamlProviderMeta(data.samlProvider);
      toast.success("SAML 2.0 configuration saved and synchronized with Identity Platform!", { id: toastId });
    } catch (err: any) {
      console.error("Save SAML config error:", err);
      toast.error(err.message || "Failed to save SAML configuration", { id: toastId });
    } finally {
      setSamlSaving(false);
    }
  };

  const handleTestSamlConnection = async () => {
    if (!organization) return;
    if (userOrgRole !== 'owner' && userOrgRole !== 'org_admin') {
      toast.error("Access Denied: Only administrators can test SAML settings.");
      return;
    }

    setSamlTesting(true);
    setSamlTestResult(null);
    const toastId = toast.loading("Running SAML 2.0 configuration diagnostic test...");

    try {
      // If not yet saved to backend, save first
      await handleSaveSamlConfig();

      const response = await apiFetch(`/api/organizations/${organization.id}/saml-config/test`, {
        method: 'POST'
      });

      const data = await response.json();
      setSamlTestResult(data);

      if (response.ok && data.success) {
        toast.success("SAML 2.0 validation passed! Identity provider is ready for authentication.", { id: toastId });
      } else {
        toast.error(data.message || "SAML diagnostic test encountered issues.", { id: toastId });
      }
    } catch (err: any) {
      console.error("Test SAML error:", err);
      toast.error(err.message || "Diagnostic test failed", { id: toastId });
      setSamlTestResult({ success: false, message: err.message });
    } finally {
      setSamlTesting(false);
    }
  };

  const handleDeleteSamlConfig = async () => {
    if (!organization) return;
    if (userOrgRole !== 'owner' && userOrgRole !== 'org_admin') {
      toast.error("Access Denied: Only administrators can delete SAML provider.");
      return;
    }

    if (!window.confirm("Are you sure you want to remove the SAML 2.0 Identity Provider configuration for this organization?")) {
      return;
    }

    const toastId = toast.loading("Removing SAML 2.0 Provider...");
    try {
      const response = await apiFetch(`/api/organizations/${organization.id}/saml-config`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.message || "Failed to delete SAML provider");
      }

      setSamlStatus('disabled');
      setSamlEntityId('');
      setSamlSsoUrl('');
      setSamlCertificate('');
      setSamlProviderMeta(null);
      setSamlTestResult(null);
      toast.success("SAML 2.0 Provider successfully deleted.", { id: toastId });
    } catch (err: any) {
      toast.error(err.message || "Failed to delete SAML provider", { id: toastId });
    }
  };

  // Create API Key
  const handleCreateApiKey = async () => {
    if (!newKeyLabel.trim()) {
      toast.error("Please enter a label for the API Key.");
      return;
    }
    if (!organization) return;
    if (userOrgRole !== 'owner' && userOrgRole !== 'org_admin') {
      toast.error("Access Denied: Only administrators can manage API Keys.");
      return;
    }

    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomStr = '';
    for (let i = 0; i < 24; i++) {
      randomStr += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const generatedKey = `en_live_${newKeyRole.toLowerCase()}_${randomStr}`;

    const newKey = {
      id: 'k_' + Date.now(),
      label: newKeyLabel.trim(),
      key: generatedKey,
      role: newKeyRole,
      status: 'active' as const,
      createdAt: new Date().toISOString()
    };

    const updatedKeys = [newKey, ...apiKeys];

    try {
      await updateDoc(doc(db, 'organizations', organization.id), {
        'securitySettings.apiKeys': updatedKeys,
        'securitySettings.auditLogs': [
          {
            id: 'l_' + Date.now(),
            action: 'Generate API Key',
            actor: userProfile?.email || 'Admin',
            ip: '192.168.1.1',
            details: `Generated new API key: "${newKeyLabel.trim()}" with role "${newKeyRole}".`,
            timestamp: new Date().toISOString()
          },
          ...auditLogs
        ].slice(0, 50)
      });

      setNewKeyLabel('');
      setGeneratedKeyResult(generatedKey);
      toast.success(`Successfully generated API Key: ${newKeyLabel}`);
    } catch (err: any) {
      toast.error("Failed to save API key: " + err.message);
    }
  };

  // Revoke API Key
  const handleRevokeApiKey = async (keyId: string, label: string) => {
    if (!organization) return;
    if (userOrgRole !== 'owner' && userOrgRole !== 'org_admin') {
      toast.error("Access Denied: Only administrators can revoke API Keys.");
      return;
    }

    const updatedKeys = apiKeys.map(k => k.id === keyId ? { ...k, status: 'revoked' as const } : k);

    try {
      await updateDoc(doc(db, 'organizations', organization.id), {
        'securitySettings.apiKeys': updatedKeys,
        'securitySettings.auditLogs': [
          {
            id: 'l_' + Date.now(),
            action: 'Revoke API Key',
            actor: userProfile?.email || 'Admin',
            ip: '192.168.1.1',
            details: `Revoked API key: "${label}".`,
            timestamp: new Date().toISOString()
          },
          ...auditLogs
        ].slice(0, 50)
      });

      toast.success(`API Key "${label}" has been revoked.`);
    } catch (err: any) {
      toast.error("Failed to revoke API key: " + err.message);
    }
  };

  // Resolve Security Alert Event
  const handleResolveEvent = async (eventId: string, eventName: string) => {
    if (!organization) return;
    if (userOrgRole !== 'owner' && userOrgRole !== 'org_admin') {
      toast.error("Access Denied: Only administrators can resolve events.");
      return;
    }

    const updatedEvents = securityEvents.map(e => e.id === eventId ? { ...e, status: 'resolved' as const } : e);

    try {
      await updateDoc(doc(db, 'organizations', organization.id), {
        'securitySettings.securityEvents': updatedEvents,
        'securitySettings.auditLogs': [
          {
            id: 'l_' + Date.now(),
            action: 'Resolve Security Alert',
            actor: userProfile?.email || 'Admin',
            ip: '192.168.1.1',
            details: `Resolved alert: "${eventName}".`,
            timestamp: new Date().toISOString()
          },
          ...auditLogs
        ].slice(0, 50)
      });

      toast.success(`Security event "${eventName}" resolved.`);
    } catch (err: any) {
      toast.error("Failed to resolve event: " + err.message);
    }
  };

  // Toggle Project Status (Active vs. Archived) in Firestore
  const handleToggleProjectStatus = async (projId: string, currentStatus: string | undefined) => {
    try {
      const newStatus = currentStatus === 'archived' ? 'active' : 'archived';
      await updateDoc(doc(db, 'projects', projId), { status: newStatus });
      toast.success(`Project status marked as ${newStatus}.`);
    } catch (err: any) {
      toast.error("Failed to update project status: " + err.message);
    }
  };

  // Manual Organization creation if none exists
  const handleManualCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !settingsName.trim()) return;

    try {
      const res = await apiFetch('/api/organizations', {
        method: 'POST',
        body: JSON.stringify({
          name: settingsName.trim(),
          logoUrl: settingsLogo.trim() || '🏢',
          industry: settingsIndustry.trim() || 'Operations',
          timezone: settingsTimezone,
          country: settingsCountry
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Failed to create organization (HTTP ${res.status})`);
      }

      toast.success("Corporate Organization successfully created!");
    } catch (err: any) {
      toast.error("Failed to create organization: " + err.message);
    }
  };

  // Compute stats helper
  const storageLimit = 10 * 1024 * 1024 * 1024; // 10 GB
  const activeMembersCount = orgMembers.filter(m => m.status === 'active').length;
  const storageUsedBytes = organization?.storageUsed || 2400000000;
  const storageUsedGB = (storageUsedBytes / (1024 * 1024 * 1024)).toFixed(1);

  // Render Skeleton Loader when syncing first load
  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <div className="h-10 w-72 bg-slate-200 animate-pulse rounded-lg"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-slate-100 animate-pulse rounded-2xl"></div>
          ))}
        </div>
        <div className="h-[400px] bg-slate-50 animate-pulse rounded-3xl"></div>
      </div>
    );
  }

  // No active organization setup: show beautiful creation screen
  if (!organization) {
    return (
      <div className="p-8 max-w-4xl mx-auto flex flex-col items-center justify-center text-center space-y-8 min-h-[80vh]">
        <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center shadow-lg text-indigo-600">
          <Building2 size={44} />
        </div>
        
        <div className="space-y-4">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">Corporate Enterprise Workspace</h1>
          <p className="text-slate-500 max-w-2xl mx-auto text-lg leading-relaxed">
            Configure your enterprise workspace to centralize project folders, define custom departments, assign corporate permission roles, and track resource limits securely.
          </p>
        </div>

        <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl max-w-xl text-left flex items-start space-x-4">
          <Info className="text-indigo-600 w-5 h-5 mt-0.5 shrink-0" />
          <p className="text-slate-600 text-sm leading-relaxed">
            <strong>Initialize your Enterprise workspace:</strong> Provision departments, manage team members, set permissions, and configure billing parameters.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
          <button
            onClick={handleBootstrapOrganization}
            disabled={isSeeding}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold uppercase tracking-wider text-xs shadow-xl transition-all flex items-center justify-center space-x-3 disabled:opacity-50"
          >
            {isSeeding ? (
              <>
                <RefreshCw className="animate-spin w-4 h-4" />
                <span>Initializing Enterprise Workspace...</span>
              </>
            ) : (
              <>
                <Sparkles size={16} />
                <span>Bootstrap Enterprise Workspace</span>
              </>
            )}
          </button>
          
          <button
            onClick={() => {
              setOrganization({
                id: '',
                name: 'My Enterprise',
                ownerId: '',
                ownerEmail: '',
                plan: 'enterprise',
                createdAt: '',
                logoUrl: '🏢',
                industry: 'Operations'
              });
            }}
            className="px-8 py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-bold uppercase tracking-wider text-xs shadow-xl transition-all flex items-center justify-center space-x-2"
          >
            <Plus size={16} />
            <span>Setup Manually</span>
          </button>
        </div>
      </div>
    );
  }

  // Form for manual creation if user clicked manual setup but hasn't submitted yet
  if (!organization.id) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-8">
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => setOrganization(null)}
            className="text-slate-500 hover:text-slate-900"
          >
            <X size={20} />
          </button>
          <h1 className="text-2xl font-bold text-slate-900">Configure Workspace Settings</h1>
        </div>

        <form onSubmit={handleManualCreateOrg} className="bg-white border border-slate-200 p-8 rounded-[32px] space-y-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Organization Name</label>
              <input
                type="text"
                required
                value={settingsName}
                onChange={(e) => setSettingsName(e.target.value)}
                placeholder="e.g. Acme Corporation"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Logo Emoji or URL</label>
              <input
                type="text"
                value={settingsLogo}
                onChange={(e) => setSettingsLogo(e.target.value)}
                placeholder="e.g. 🏢 or URL"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Industry</label>
              <select
                value={settingsIndustry}
                onChange={(e) => setSettingsIndustry(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50"
              >
                <option value="Technology">Technology</option>
                <option value="Operations">Operations</option>
                <option value="Finance">Finance</option>
                <option value="Research">Research</option>
                <option value="Compliance">Compliance</option>
                <option value="Legal">Legal</option>
                <option value="HR">HR</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Country</label>
              <input
                type="text"
                value={settingsCountry}
                onChange={(e) => setSettingsCountry(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold uppercase tracking-wider text-xs shadow-lg hover:bg-indigo-700 transition-all"
          >
            Create Organization & Initialize
          </button>
        </form>
      </div>
    );
  }

  // Search & Filter members helper
  const filteredMembers = orgMembers.filter(member => {
    const matchesSearch = member.name?.toLowerCase().includes(memberSearch.toLowerCase()) || 
                          member.email?.toLowerCase().includes(memberSearch.toLowerCase());
    const matchesRole = memberRoleFilter === 'all' || member.role === memberRoleFilter;
    const matchesDept = memberDeptFilter === 'all' || member.departmentId === memberDeptFilter;
    const matchesStatus = memberStatusFilter === 'all' || member.status === memberStatusFilter;
    return matchesSearch && matchesRole && matchesDept && matchesStatus;
  });

  // Paginated members
  const totalPages = Math.ceil(filteredMembers.length / itemsPerPage) || 1;
  const paginatedMembers = filteredMembers.slice((memberPage - 1) * itemsPerPage, memberPage * itemsPerPage);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 bg-brand-background text-brand-primary min-h-screen">
      <Toaster position="bottom-right" theme="light" />

      {/* Corporate Dashboard Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-200">
        <div className="space-y-1">
          <div className="flex items-center space-x-3">
            <span className="text-3xl filter drop-shadow-sm">{organization.logoUrl || '🏢'}</span>
            <h1 className="text-2xl font-black text-slate-950 tracking-tight uppercase">{organization.name}</h1>
          </div>
          <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
            <span>Industry: <strong className="text-slate-800">{organization.industry || 'Technology'}</strong></span>
            <span>•</span>
            <span>ID: <strong className="text-slate-800 font-mono">{organization.id}</strong></span>
            <span>•</span>
            <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded capitalize">{organization.plan} Plan</span>
          </p>
        </div>

        {/* 10-Section Tab Controller */}
        <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-2xl self-start md:self-center">
          {[
            { id: 'overview', label: 'Overview', icon: <BarChart3 size={13} /> },
            { id: 'analytics', label: 'Analytics', icon: <TrendingUp size={13} /> },
            { id: 'departments', label: 'Departments', icon: <Layers size={13} /> },
            { id: 'members', label: 'Members', icon: <Users size={13} /> },
            { id: 'invitations', label: 'Invitations', icon: <Mail size={13} /> },
            { id: 'projects', label: 'Projects', icon: <Briefcase size={13} /> },
            { id: 'roles', label: 'Roles Matrix', icon: <Shield size={13} /> },
            { id: 'security', label: 'Security Center', icon: <ShieldCheck size={13} /> },
            { id: 'billing', label: 'Billing', icon: <CreditCard size={13} /> },
            { id: 'integrations', label: 'Integrations', icon: <Globe size={13} /> },
            { id: 'settings', label: 'Settings', icon: <Settings size={13} /> }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as any);
                setMemberPage(1);
              }}
              className={`flex items-center space-x-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-indigo-600 shadow-sm border border-slate-200'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
        >
          {/* SECTION 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-8">
              {/* Stat Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { title: "Owner Profile", value: organization.ownerEmail, desc: `Created on ${new Date(organization.createdAt).toLocaleDateString()}`, icon: <UserCheck className="text-blue-600" /> },
                  { title: "Active Workspace Members", value: `${activeMembersCount} Staff`, desc: "Registered and active", icon: <Users className="text-emerald-600" /> },
                  { title: "Corporate Departments", value: `${departments.length} Units`, desc: "Configured departments", icon: <Layers className="text-indigo-600" /> },
                  { title: "Total Local Storage", value: `${storageUsedGB} GB`, desc: "Of 10.0 GB Limit", icon: <Compass className="text-amber-600" /> }
                ].map((stat, i) => (
                  <div key={i} className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{stat.title}</span>
                      <div className="p-2 bg-slate-50 rounded-xl border border-slate-100">{stat.icon}</div>
                    </div>
                    <div className="mt-4">
                      <div className="text-lg font-extrabold text-slate-950 tracking-tight truncate" title={stat.value}>
                        {stat.value}
                      </div>
                      <p className="text-[10px] text-slate-400 font-medium mt-0.5">{stat.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Resource Consumption Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Monthly Minute Meter */}
                <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-400">Monthly Minutes Limit</span>
                    <TrendingUp className="text-indigo-600 w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-3xl font-black text-slate-950">
                      {organization.monthlyMinutesUsed || 320} <span className="text-sm text-slate-400 font-normal">/ 1000 min</span>
                    </div>
                    <p className="text-[11px] text-slate-500">Corporate minutes processed this billing cycle.</p>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-full rounded-full transition-all" 
                      style={{ width: `${Math.min(100, (((organization.monthlyMinutesUsed || 320) / 1000) * 100))}%` }}
                    ></div>
                  </div>
                </div>

                {/* AI Request Tracker */}
                <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-400">AI Resource Usage</span>
                    <Sparkles className="text-emerald-600 w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-3xl font-black text-slate-950">
                      {organization.aiUsage || 145} <span className="text-sm text-slate-400 font-normal">queries</span>
                    </div>
                    <p className="text-[11px] text-slate-500">Total intelligence actions analyzed.</p>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-full rounded-full transition-all" 
                      style={{ width: `${Math.min(100, (((organization.aiUsage || 145) / 500) * 100))}%` }}
                    ></div>
                  </div>
                </div>

                {/* Thinking Engine Quota */}
                <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black uppercase tracking-wider text-slate-400">AI Requests Usage</span>
                    <ShieldCheck className="text-amber-500 w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-3xl font-black text-slate-950">
                      {organization.thinkingEngineUsage || 84} <span className="text-sm text-slate-400 font-normal">/ 250 AI Requests</span>
                    </div>
                    <p className="text-[11px] text-slate-500">Deep strategic assessments processed.</p>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <div 
                      className="bg-amber-500 h-full rounded-full transition-all" 
                      style={{ width: `${Math.min(100, (((organization.thinkingEngineUsage || 84) / 250) * 100))}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Departmental Visualization Chart */}
              <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm space-y-6">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Transcription Volume per Department</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Estimated storage and transcript allocation segmentations in Firestore</p>
                </div>
                
                <div className="h-64 w-full">
                  {departments.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={departments.map((d, i) => ({
                        name: d.name,
                        'Minutes Transcribed': (d.projectIds?.length || 0) * 120 + (i * 35) + 30
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" fontSize={11} stroke="#94a3b8" />
                        <YAxis fontSize={11} stroke="#94a3b8" />
                        <Tooltip />
                        <Bar dataKey="Minutes Transcribed" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400 text-sm italic">
                      No departments created yet. Go to the Departments tab to create one.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SECTION: ANALYTICS */}
          {activeTab === 'analytics' && (() => {
            // Analytics Calculations
            const totalMembers = orgMembers.length;
            const monthlyAiCost = organization?.monthlyAiCost || 48.50;
            const monthlyRevenue = organization?.monthlyRevenue || 1500.00;
            const apiCost = organization?.apiCost || 14.20;
            const minutesUsed = organization?.monthlyMinutesUsed || 320;
            const thinkingRequests = organization?.thinkingEngineUsage || 84;
            const storageUsedBytes = organization?.storageUsed || 2589000000;
            const storageUsedGB = (storageUsedBytes / (1024 * 1024 * 1024)).toFixed(2);

            const aiCostPerUser = (totalMembers > 0 ? (monthlyAiCost / totalMembers) : 0).toFixed(2);
            const revenuePerUser = (totalMembers > 0 ? (monthlyRevenue / totalMembers) : 0).toFixed(2);
            const netProfit = (monthlyRevenue - monthlyAiCost - apiCost);
            const profitPerUser = (totalMembers > 0 ? (netProfit / totalMembers) : 0).toFixed(2);
            const profitMarginPercent = (monthlyRevenue > 0 ? (netProfit / monthlyRevenue) * 100 : 0).toFixed(1);

            // Top Projects sorting descending by minutesUsed
            const topProjectsList = [...projects]
              .map(p => {
                const pMinutes = p.minutesUsed || 0;
                const pThinking = p.thinkingRequests || 0;
                const pCost = p.aiCost || Number((pMinutes * 0.10 + pThinking * 0.15).toFixed(2));
                return {
                  ...p,
                  minutesUsed: pMinutes,
                  thinkingRequests: pThinking,
                  aiCost: pCost
                };
              })
              .sort((a, b) => b.minutesUsed - a.minutesUsed)
              .slice(0, 5);

            // Top Members sorting descending by aiUsage or minutesUsed
            const topMembersList = [...orgMembers]
              .map(m => {
                const mMinutes = m.minutesUsed || 0;
                const mAiCost = m.aiCost || Number((mMinutes * 0.10).toFixed(2));
                const mAiUsage = m.aiUsage || 0;
                return {
                  ...m,
                  minutesUsed: mMinutes,
                  aiCost: mAiCost,
                  aiUsage: mAiUsage
                };
              })
              .sort((a, b) => b.aiCost - a.aiCost)
              .slice(0, 5);

            // Department Cost Allocation list
            const deptCostList = departments.map(d => {
              const deptMembers = orgMembers.filter(m => m.departmentId === d.id);
              const membersCount = deptMembers.length;
              const deptMinutes = d.minutesUsed || 0;
              const deptAiCost = d.aiCost || 0;
              const costPerMember = membersCount > 0 ? (deptAiCost / membersCount) : 0;
              return {
                name: d.name,
                membersCount,
                minutesUsed: deptMinutes,
                aiCost: deptAiCost,
                costPerMember,
                aiBudgetLimit: d.aiBudgetLimit
              };
            }).sort((a, b) => b.aiCost - a.aiCost);

            return (
              <div className="space-y-8">
                {/* 1. Header description */}
                <div>
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Enterprise Analytics Intelligence</h2>
                  <p className="text-xs text-slate-500">Real-time resource logs, financial parameters, and department efficiency monitors direct from Firestore.</p>
                </div>

                {/* 2. Key Financial Indicators (Top Row) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Monthly Revenue */}
                  <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Monthly Revenue</span>
                      <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                        <DollarSign size={16} />
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="text-2xl font-black text-slate-950 tracking-tight">
                        ${monthlyRevenue.toFixed(2)}
                      </div>
                      <p className="text-[10px] text-slate-400 font-medium mt-1 flex items-center space-x-1">
                        <span className="text-emerald-600 font-bold">100% Core Plan</span>
                        <span>• Verified Billing</span>
                      </p>
                    </div>
                  </div>

                  {/* Monthly AI Cost */}
                  <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Monthly AI Cost</span>
                      <div className="p-2 bg-rose-50 text-rose-600 rounded-xl border border-rose-100">
                        <Activity size={16} />
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="text-2xl font-black text-slate-950 tracking-tight">
                        ${monthlyAiCost.toFixed(2)}
                      </div>
                      <p className="text-[10px] text-slate-400 font-medium mt-1 flex items-center space-x-1">
                        <span className="text-rose-600 font-bold">{((monthlyAiCost / monthlyRevenue) * 100).toFixed(1)}%</span>
                        <span>Of Monthly Revenue</span>
                      </p>
                    </div>
                  </div>

                  {/* API Cost */}
                  <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">API Cost</span>
                      <div className="p-2 bg-slate-100 text-slate-600 rounded-xl border border-slate-200">
                        <Sliders size={16} />
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="text-2xl font-black text-slate-950 tracking-tight">
                        ${apiCost.toFixed(2)}
                      </div>
                      <p className="text-[10px] text-slate-400 font-medium mt-1">
                        Infra proxy &amp; search grounding
                      </p>
                    </div>
                  </div>

                  {/* Net Profit */}
                  <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Net Profit</span>
                      <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
                        <Sparkles size={16} />
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="text-2xl font-black text-indigo-600 tracking-tight">
                        ${netProfit.toFixed(2)}
                      </div>
                      <p className="text-[10px] text-slate-400 font-medium mt-1 flex items-center space-x-1">
                        <span className="text-indigo-600 font-bold">{profitMarginPercent}% Margin</span>
                        <span>• Operations Healthy</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* 3. Resource Consumption Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Minutes Used */}
                  <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-400">Minutes Processed</span>
                      <Clock size={16} className="text-indigo-600" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-3xl font-black text-slate-950">
                        {minutesUsed} <span className="text-xs font-bold text-slate-400 uppercase">min used</span>
                      </div>
                      <p className="text-[11px] text-slate-500">Audio transcription duration processed.</p>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-indigo-600 h-full rounded-full transition-all" 
                        style={{ width: `${Math.min(100, (minutesUsed / 1000) * 100)}%` }}
                      ></div>
                    </div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex justify-between">
                      <span>0 used</span>
                      <span>1,000 min limit</span>
                    </p>
                  </div>

                  {/* Thinking Requests */}
                  <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-400">AI Requests</span>
                      <ShieldCheck size={16} className="text-amber-500" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-3xl font-black text-slate-950">
                        {thinkingRequests} <span className="text-xs font-bold text-slate-400 uppercase">requests</span>
                      </div>
                      <p className="text-[11px] text-slate-500">Total deep intelligence queries processed.</p>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-amber-500 h-full rounded-full transition-all" 
                        style={{ width: `${Math.min(100, (thinkingRequests / 250) * 100)}%` }}
                      ></div>
                    </div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex justify-between">
                      <span>0 used</span>
                      <span>250 limit</span>
                    </p>
                  </div>

                  {/* Storage Used */}
                  <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-400">Storage Capacity</span>
                      <HardDrive size={16} className="text-emerald-500" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-3xl font-black text-slate-950">
                        {storageUsedGB} <span className="text-xs font-bold text-slate-400 uppercase">GB used</span>
                      </div>
                      <p className="text-[11px] text-slate-500">Total size of multi-media assets stored.</p>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-emerald-500 h-full rounded-full transition-all" 
                        style={{ width: `${Math.min(100, (parseFloat(storageUsedGB) / 10.0) * 100)}%` }}
                      ></div>
                    </div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex justify-between">
                      <span>0 GB</span>
                      <span>10.0 GB Limit</span>
                    </p>
                  </div>
                </div>

                {/* 4. Efficiency Metrics (Cost per User, Revenue per User, etc.) */}
                <div className="bg-indigo-950 text-white rounded-[32px] p-8 shadow-inner relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-900 rounded-full filter blur-3xl opacity-30 transform translate-x-12 -translate-y-12"></div>
                  <div className="relative z-10 space-y-6">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-indigo-300">Workspace Member Unit Economics</h3>
                      <p className="text-sm text-indigo-100 mt-1">Average profitability and operational expense per active workspace staff.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-2">
                      <div className="border-l-2 border-indigo-500 pl-4 space-y-1">
                        <span className="text-xs text-indigo-300 uppercase tracking-wider font-bold">AI Cost / User</span>
                        <div className="text-3xl font-black">${aiCostPerUser}</div>
                        <p className="text-[10px] text-indigo-200">Gemini credits consumed per member</p>
                      </div>

                      <div className="border-l-2 border-emerald-500 pl-4 space-y-1">
                        <span className="text-xs text-indigo-300 uppercase tracking-wider font-bold">Revenue / User</span>
                        <div className="text-3xl font-black text-emerald-400">${revenuePerUser}</div>
                        <p className="text-[10px] text-indigo-200">Invoiced subscription share per member</p>
                      </div>

                      <div className="border-l-2 border-amber-400 pl-4 space-y-1">
                        <span className="text-xs text-indigo-300 uppercase tracking-wider font-bold">Profit / User</span>
                        <div className="text-3xl font-black text-amber-300">${profitPerUser}</div>
                        <p className="text-[10px] text-indigo-200">Net operating margin contribution</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. Live Trends Charts section */}
                <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-6">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">Live Workspace Analytics Trends</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Chronological progress metrics synchronizing live with your Firestore database.</p>
                    </div>

                    <div className="flex bg-slate-100 p-1 rounded-xl self-start">
                      <button
                        onClick={() => setChartMetric('financial')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${chartMetric === 'financial' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        Financial Stats
                      </button>
                      <button
                        onClick={() => setChartMetric('usage')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${chartMetric === 'usage' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        Resource Usage
                      </button>
                    </div>
                  </div>

                  <div className="h-72 w-full">
                    {monthlyTrends.length > 0 ? (
                      chartMetric === 'financial' ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={monthlyTrends.sort((a, b) => {
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            return months.indexOf(a.month) - months.indexOf(b.month);
                          })}>
                            <defs>
                              <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                              </linearGradient>
                              <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#EF4444" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="month" fontSize={11} stroke="#94a3b8" />
                            <YAxis fontSize={11} stroke="#94a3b8" />
                            <Tooltip formatter={(value) => `$${value}`} />
                            <Legend />
                            <Area name="Revenue" type="monotone" dataKey="revenue" stroke="#10B981" fillOpacity={1} fill="url(#colorRev)" strokeWidth={2.5} />
                            <Area name="AI LLM Spend" type="monotone" dataKey="aiCost" stroke="#EF4444" fillOpacity={1} fill="url(#colorCost)" strokeWidth={2} />
                            <Area name="API Service Cost" type="monotone" dataKey="apiCost" stroke="#64748B" fillOpacity={0.1} fill="#64748B" strokeWidth={1.5} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={monthlyTrends.sort((a, b) => {
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            return months.indexOf(a.month) - months.indexOf(b.month);
                          })}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="month" fontSize={11} stroke="#94a3b8" />
                            <YAxis fontSize={11} stroke="#94a3b8" />
                            <Tooltip />
                            <Legend />
                            <Line name="Minutes Processed" type="monotone" dataKey="minutesUsed" stroke="#4F46E5" strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 8 }} />
                            <Line name="AI Requests" type="monotone" dataKey="thinkingRequests" stroke="#F59E0B" strokeWidth={2.5} dot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center text-slate-400 text-sm p-8 space-y-4 bg-slate-50 border border-dashed border-slate-200 rounded-3xl">
                        <AlertCircle className="text-slate-400 w-8 h-8" />
                        <div className="text-center">
                          <p className="font-bold text-slate-700">No Historical Monthly Trends Available</p>
                          <p className="text-xs text-slate-500 mt-1">Monthly trends will populate as team activity increases.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 6. Grids of Top Lists (Projects, Members, Departments) */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Top Projects column */}
                  <div className="bg-white border border-slate-200 p-6 rounded-[32px] shadow-sm space-y-4 flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <Briefcase size={16} className="text-indigo-600" />
                        <h4 className="text-sm font-black uppercase tracking-wider text-slate-900">Top Projects</h4>
                      </div>
                      <p className="text-[10px] text-slate-400">Ranked by total processing duration and quota cost.</p>
                    </div>

                    <div className="divide-y divide-slate-100 flex-1 mt-3 overflow-auto max-h-[250px]">
                      {topProjectsList.length > 0 ? (
                        topProjectsList.map((proj) => (
                          <div key={proj.id} className="py-3 flex items-center justify-between">
                            <div className="min-w-0 space-y-0.5">
                              <p className="text-xs font-bold text-slate-800 truncate">{proj.name}</p>
                              <p className="text-[9px] text-slate-400">Owner: {proj.ownerEmail || 'Admin'}</p>
                            </div>
                            <div className="text-right whitespace-nowrap pl-2">
                              <p className="text-xs font-extrabold text-slate-900">{proj.minutesUsed} min</p>
                              <p className="text-[9px] font-semibold text-emerald-600">${proj.aiCost.toFixed(2)} cost</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400 italic py-8">
                          No projects tracked yet.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Top Active Members column */}
                  <div className="bg-white border border-slate-200 p-6 rounded-[32px] shadow-sm space-y-4 flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <Users size={16} className="text-emerald-600" />
                        <h4 className="text-sm font-black uppercase tracking-wider text-slate-900">Top Members</h4>
                      </div>
                      <p className="text-[10px] text-slate-400">Ranked by total intelligence spend and queries made.</p>
                    </div>

                    <div className="divide-y divide-slate-100 flex-1 mt-3 overflow-auto max-h-[250px]">
                      {topMembersList.length > 0 ? (
                        topMembersList.map((member) => {
                          const dept = departments.find(d => d.id === member.departmentId);
                          return (
                            <div key={member.id} className="py-3 flex items-center justify-between">
                              <div className="min-w-0 space-y-0.5">
                                <p className="text-xs font-bold text-slate-800 truncate">{member.name || member.email}</p>
                                <p className="text-[9px] text-slate-400">Dept: {dept?.name || 'Unassigned'}</p>
                              </div>
                              <div className="text-right whitespace-nowrap pl-2">
                                <p className="text-xs font-extrabold text-slate-900">{member.minutesUsed} min</p>
                                <p className="text-[9px] font-semibold text-emerald-600">${member.aiCost.toFixed(2)} cost</p>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400 italic py-8">
                          No members tracked yet.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Most Active Departments column */}
                  <div className="bg-white border border-slate-200 p-6 rounded-[32px] shadow-sm space-y-4 flex flex-col justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <Layers size={16} className="text-indigo-600" />
                        <h4 className="text-sm font-black uppercase tracking-wider text-slate-900">AI Cost / Department</h4>
                      </div>
                      <p className="text-[10px] text-slate-400">Consolidated financial allocation across corporate units.</p>
                    </div>

                    <div className="divide-y divide-slate-100 flex-1 mt-3 overflow-auto max-h-[250px]">
                      {deptCostList.length > 0 ? (
                        deptCostList.map((dept, idx) => {
                          const isOver = dept.aiBudgetLimit && dept.aiBudgetLimit > 0 && dept.aiCost > dept.aiBudgetLimit;
                          return (
                            <div key={idx} className="py-3 flex items-center justify-between">
                              <div className="min-w-0 space-y-0.5">
                                <p className="text-xs font-bold text-slate-800 truncate flex items-center gap-1.5">
                                  <span>{dept.name}</span>
                                  {isOver && (
                                    <span className="text-[9px] bg-rose-50 text-rose-600 border border-rose-200 px-1.5 py-0.5 rounded-md font-black uppercase">
                                      Over Budget
                                    </span>
                                  )}
                                </p>
                                <p className="text-[9px] text-slate-400">
                                  {dept.membersCount} staff • {dept.aiBudgetLimit && dept.aiBudgetLimit > 0 ? `Budget: $${dept.aiBudgetLimit.toFixed(2)}` : 'No Limit'}
                                </p>
                              </div>
                              <div className="text-right whitespace-nowrap pl-2">
                                <p className="text-xs font-extrabold text-slate-900">${dept.aiCost.toFixed(2)}</p>
                                <p className="text-[9px] text-slate-400">${dept.costPerMember.toFixed(2)} / user</p>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400 italic py-8">
                          No departments configured.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* SECTION 2: DEPARTMENTS */}
          {activeTab === 'departments' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Organization Departments</h2>
                  <p className="text-xs text-slate-500">Create, edit, and delete corporate divisions. Assign specific workspace folder systems instantly.</p>
                </div>
                <button
                  onClick={() => {
                    setEditingDept(null);
                    setDeptName('');
                    setDeptDesc('');
                    setDeptProjects([]);
                    setIsDeptModalOpen(true);
                  }}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 transition-all shadow-md"
                >
                  <Plus size={14} />
                  <span>Create Department</span>
                </button>
              </div>

              {/* Department Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {departments.map((dept) => {
                  const deptMembers = orgMembers.filter(m => m.departmentId === dept.id);
                  const deptProjs = projects.filter(p => dept.projectIds?.includes(p.id));

                  return (
                    <div key={dept.id} className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm flex flex-col justify-between hover:shadow-md transition-all space-y-4">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <h3 className="font-bold text-slate-950 text-base">{dept.name}</h3>
                          <div className="flex space-x-1">
                            <button
                              onClick={() => handleStartEditDept(dept)}
                              className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                              title="Edit Department"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteDept(dept.id, dept.name)}
                              className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-slate-50 transition-colors"
                              title="Delete Department"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <p className="text-slate-500 text-xs leading-relaxed line-clamp-2 min-h-[36px]">
                          {dept.description || "No department description defined."}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-xs">
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Members</span>
                          <span className="font-extrabold text-slate-900">{deptMembers.length} Staff</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">Folders / Projects</span>
                          <span className="font-extrabold text-slate-900">{deptProjs.length} Folders</span>
                        </div>
                      </div>

                      {/* AI Budget Allocation */}
                      <div className="bg-indigo-50/50 rounded-2xl p-3.5 border border-indigo-100/60 space-y-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">AI Spend / Budget</span>
                          <span className={`font-extrabold ${dept.aiBudgetLimit && dept.aiBudgetLimit > 0 && (dept.aiCost || 0) > dept.aiBudgetLimit ? 'text-rose-600' : 'text-indigo-900'}`}>
                            ${(dept.aiCost || 0).toFixed(2)} / {dept.aiBudgetLimit && dept.aiBudgetLimit > 0 ? `$${dept.aiBudgetLimit.toFixed(2)}` : 'No Limit'}
                          </span>
                        </div>
                        {dept.aiBudgetLimit && dept.aiBudgetLimit > 0 ? (
                          <div className="space-y-1">
                            <div className="w-full bg-slate-200/60 h-2 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all ${
                                  (dept.aiCost || 0) > dept.aiBudgetLimit 
                                    ? 'bg-rose-500' 
                                    : (dept.aiCost || 0) > dept.aiBudgetLimit * 0.85 
                                      ? 'bg-amber-500' 
                                      : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(100, ((dept.aiCost || 0) / dept.aiBudgetLimit) * 100)}%` }}
                              ></div>
                            </div>
                            <div className="flex justify-between text-[9px] font-extrabold uppercase tracking-wider">
                              <span className="text-slate-400">
                                {(((dept.aiCost || 0) / dept.aiBudgetLimit) * 100).toFixed(0)}% Consumed
                              </span>
                              {(dept.aiCost || 0) > dept.aiBudgetLimit ? (
                                <span className="text-rose-600 font-black flex items-center gap-0.5">
                                  ⚠️ Over Budget
                                </span>
                              ) : (
                                <span className="text-emerald-600">
                                  ${(dept.aiBudgetLimit - (dept.aiCost || 0)).toFixed(2)} left
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-[9px] text-slate-400 italic">No budget cap has been configured.</p>
                        )}
                      </div>

                      <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 space-y-1.5">
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Assigned Projects</span>
                        <div className="flex flex-wrap gap-1">
                          {deptProjs.map(p => (
                            <span key={p.id} className="text-[9px] font-bold bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md">
                              {p.name}
                            </span>
                          ))}
                          {deptProjs.length === 0 && (
                            <span className="text-[9px] italic text-slate-400">No projects linked</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {departments.length === 0 && (
                  <div className="col-span-full bg-white border border-slate-200 py-12 text-center rounded-[32px] shadow-sm space-y-3">
                    <Layers className="mx-auto text-slate-300 w-12 h-12" />
                    <p className="text-slate-400 text-sm italic">No departments configured yet.</p>
                  </div>
                )}
              </div>

              {/* Department Creation/Editing Modal */}
              {isDeptModalOpen && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
                  <div className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 border border-slate-100 shadow-2xl animate-in zoom-in-95">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                      <h3 className="text-lg font-black text-slate-950 uppercase tracking-tight">
                        {editingDept ? "Edit Department" : "Create Department"}
                      </h3>
                      <button onClick={() => setIsDeptModalOpen(false)} className="text-slate-400 hover:text-slate-950">
                        <X size={18} />
                      </button>
                    </div>

                    <form onSubmit={handleSaveDepartment} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Name</label>
                        <input
                          type="text"
                          required
                          value={deptName}
                          onChange={(e) => setDeptName(e.target.value)}
                          placeholder="e.g. Compliance Unit"
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Description</label>
                        <textarea
                          value={deptDesc}
                          onChange={(e) => setDeptDesc(e.target.value)}
                          placeholder="What is the key core workflow of this division?"
                          rows={3}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50 resize-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Link Folder / Projects</label>
                        <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50">
                          {projects.map(proj => (
                            <label key={proj.id} className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={deptProjects.includes(proj.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setDeptProjects([...deptProjects, proj.id]);
                                  } else {
                                    setDeptProjects(deptProjects.filter(id => id !== proj.id));
                                  }
                                }}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              <span>{proj.name}</span>
                            </label>
                          ))}
                          {projects.length === 0 && (
                            <span className="text-xs italic text-slate-400">No active folders found</span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">AI Monthly Budget Limit ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={deptBudgetLimit}
                          onChange={(e) => setDeptBudgetLimit(e.target.value)}
                          placeholder="e.g. 150.00 (0 or leave empty for no limit)"
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-3.5 bg-indigo-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-indigo-700 transition-all flex items-center justify-center space-x-1.5"
                      >
                        <Check size={14} />
                        <span>Save Department</span>
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 3: MEMBERS */}
          {activeTab === 'members' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Organization Directory</h2>
                  <p className="text-xs text-slate-500">View and manage roles, department designations, and membership status for this organization.</p>
                </div>
                {isOwner && (
                  <button
                    onClick={() => {
                      setTransferTargetMemberId('');
                      setTransferConfirmText('');
                      setTransferError(null);
                      setIsTransferModalOpen(true);
                    }}
                    className="px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-900 hover:bg-amber-100 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all shadow-sm self-start sm:self-auto"
                    title="Transfer Organization Ownership"
                    aria-label="Transfer organization ownership"
                  >
                    <ArrowRightLeft size={14} className="text-amber-600" />
                    <span>Transfer Ownership</span>
                  </button>
                )}
              </div>

              {/* Directory Filter Panel */}
              <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
                <div className="relative w-full md:w-80">
                  <Search className="absolute left-3.5 top-3.5 text-slate-400 w-4.5 h-4.5" />
                  <input
                    type="text"
                    placeholder="Search staff by name or email..."
                    value={memberSearch}
                    onChange={(e) => {
                      setMemberSearch(e.target.value);
                      setMemberPage(1);
                    }}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-600 bg-slate-50 font-medium"
                  />
                </div>

                <div className="flex flex-wrap gap-2 w-full md:w-auto justify-end">
                  {/* Filter by Role */}
                  <select
                    value={memberRoleFilter}
                    onChange={(e) => {
                      setMemberRoleFilter(e.target.value);
                      setMemberPage(1);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-slate-50 text-slate-600 focus:outline-none"
                  >
                    <option value="all">All Roles</option>
                    <option value="owner">Owner</option>
                    <option value="org_admin">Org Admin</option>
                    <option value="team_manager">Team Manager</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>

                  {/* Filter by Department */}
                  <select
                    value={memberDeptFilter}
                    onChange={(e) => {
                      setMemberDeptFilter(e.target.value);
                      setMemberPage(1);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-slate-50 text-slate-600 focus:outline-none"
                  >
                    <option value="all">All Departments</option>
                    <option value="">Unassigned</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>

                  {/* Filter by Status */}
                  <select
                    value={memberStatusFilter}
                    onChange={(e) => {
                      setMemberStatusFilter(e.target.value);
                      setMemberPage(1);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-slate-50 text-slate-600 focus:outline-none"
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="deactivated">Deactivated</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>

              {/* Members Directory Table */}
              <div className="bg-white border border-slate-200 rounded-[28px] overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        <th className="py-4 px-6">Profile Info</th>
                        <th className="py-4 px-6">Role Assignment</th>
                        <th className="py-4 px-6">Department</th>
                        <th className="py-4 px-6">Status</th>
                        <th className="py-4 px-6">Last Active</th>
                        <th className="py-4 px-6">Joined Date</th>
                        <th className="py-4 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {paginatedMembers.map((member) => {
                        const memberDept = departments.find(d => d.id === member.departmentId);
                        const isMemberOwner = member.role === 'owner' || member.userId === organization?.ownerId;

                        return (
                          <tr key={member.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-4 px-6">
                              <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-indigo-600 uppercase text-[10px]">
                                  {member.name ? member.name.substring(0, 2) : member.email.substring(0, 2)}
                                </div>
                                <div className="flex flex-col">
                                  <span className="font-bold text-slate-900">{member.name || 'Staff Member'}</span>
                                  <span className="text-[10px] text-slate-400 font-mono">{member.email}</span>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              {isMemberOwner ? (
                                <span className="inline-flex items-center space-x-1 px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-lg text-[9px] font-black uppercase tracking-wider">
                                  <Shield size={10} />
                                  <span>Owner</span>
                                </span>
                              ) : isAdmin ? (
                                <select
                                  value={normalizeOrgRole(member.role)}
                                  disabled={isActionInProgress('role_' + member.id)}
                                  onChange={(e) => handleUpdateMemberRole(member.id, e.target.value)}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold bg-white text-slate-700 focus:outline-none disabled:opacity-50"
                                >
                                  <option value="org_admin">Organization Admin</option>
                                  <option value="team_manager">Team Manager</option>
                                  <option value="member">Member</option>
                                  <option value="viewer">Viewer</option>
                                </select>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[9px] font-bold uppercase">
                                  {normalizeOrgRole(member.role)}
                                </span>
                              )}
                            </td>
                            <td className="py-4 px-6">
                              {isMemberOwner ? (
                                <span className="text-[11px] italic text-slate-400">All Departments</span>
                              ) : isAdmin ? (
                                <select
                                  value={member.departmentId || ''}
                                  disabled={isActionInProgress('dept_' + member.id)}
                                  onChange={(e) => handleUpdateMemberDept(member.id, e.target.value)}
                                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold bg-white text-slate-700 focus:outline-none disabled:opacity-50"
                                >
                                  <option value="">Unassigned</option>
                                  {departments.map(d => (
                                    <option key={d.id} value={d.id}>{d.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-[11px] font-medium text-slate-600">
                                  {memberDept ? memberDept.name : 'Unassigned'}
                                </span>
                              )}
                            </td>
                            <td className="py-4 px-6">
                              <span className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                member.status === 'active' 
                                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                                  : member.status === 'deactivated'
                                    ? 'bg-rose-50 text-rose-600 border border-rose-200'
                                    : 'bg-amber-50 text-amber-600 border border-amber-100'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  member.status === 'active' 
                                    ? 'bg-emerald-500' 
                                    : member.status === 'deactivated'
                                      ? 'bg-rose-500'
                                      : 'bg-amber-500'
                                }`}></span>
                                <span>{member.status || 'active'}</span>
                              </span>
                            </td>
                            <td className="py-4 px-6 text-slate-500 font-mono text-[10px]">
                              {member.lastActive ? new Date(member.lastActive).toLocaleDateString() : 'N/A'}
                            </td>
                            <td className="py-4 px-6 text-slate-400">
                              {new Date(member.joinedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                            </td>
                            <td className="py-4 px-6 text-right">
                              {!isAdmin ? (
                                <span className="text-[11px] text-slate-300 font-mono">-</span>
                              ) : isMemberOwner ? (
                                <span className="text-[10px] text-slate-300 font-semibold italic">Owner</span>
                              ) : (
                                <div className="flex items-center justify-end space-x-1.5">
                                  {/* Deactivate / Reactivate Action */}
                                  {member.status === 'deactivated' ? (
                                    <button
                                      onClick={() => handleReactivateMember(member)}
                                      disabled={isActionInProgress('reactivate_' + member.id)}
                                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center space-x-1 transition-colors disabled:opacity-50"
                                      title={`Reactivate ${member.name || member.email}`}
                                      aria-label={`Reactivate member ${member.name || member.email}`}
                                    >
                                      {isActionInProgress('reactivate_' + member.id) ? (
                                        <Loader2 size={12} className="animate-spin" />
                                      ) : (
                                        <RotateCcw size={12} />
                                      )}
                                      <span>Reactivate</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => setDeactivatingMember(member)}
                                      disabled={isActionInProgress('deactivate_' + member.id)}
                                      className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                                      title={`Deactivate ${member.name || member.email}`}
                                      aria-label={`Deactivate member ${member.name || member.email}`}
                                    >
                                      <UserX size={14} />
                                    </button>
                                  )}

                                  {/* Ownership Transfer Quick Trigger (Owner-Only, Active Members Only) */}
                                  {isOwner && member.status === 'active' && (
                                    <button
                                      onClick={() => {
                                        setTransferTargetMemberId(member.id);
                                        setTransferConfirmText('');
                                        setTransferError(null);
                                        setIsTransferModalOpen(true);
                                      }}
                                      className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                                      title={`Transfer organization ownership to ${member.name || member.email}`}
                                      aria-label={`Transfer organization ownership to ${member.name || member.email}`}
                                    >
                                      <ArrowRightLeft size={14} />
                                    </button>
                                  )}

                                  {/* Remove Member Action */}
                                  <button
                                    onClick={() => setRemovingMember(member)}
                                    disabled={isActionInProgress('remove_' + member.id)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50"
                                    title={`Remove ${member.name || member.email}`}
                                    aria-label={`Remove member ${member.name || member.email}`}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}

                      {paginatedMembers.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center italic text-slate-400">
                            No matching organization members found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex justify-between items-center p-4 border-t border-slate-100 bg-slate-50">
                    <span className="text-slate-500 text-xs">
                      Page <strong>{memberPage}</strong> of {totalPages}
                    </span>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setMemberPage(p => Math.max(1, p - 1))}
                        disabled={memberPage === 1}
                        className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-bold hover:bg-slate-50 disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setMemberPage(p => Math.min(totalPages, p + 1))}
                        disabled={memberPage === totalPages}
                        className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-bold hover:bg-slate-50 disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 4: INVITATIONS */}
          {activeTab === 'invitations' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Invitation log lists */}
              <div className="lg:col-span-2 space-y-6">
                <div>
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Corporate Invitation Logs</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Track registration states, resend, or revoke active keys in Firestore.</p>
                </div>

                <div className="bg-white border border-slate-200 rounded-[28px] overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                          <th className="py-4 px-6">Email Address</th>
                          <th className="py-4 px-6">Target Role</th>
                          <th className="py-4 px-6">Status</th>
                          <th className="py-4 px-6">Expires At</th>
                          <th className="py-4 px-6 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {invitations.map((inv) => (
                          <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-4 px-6 font-bold text-slate-900">{inv.email}</td>
                            <td className="py-4 px-6">
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-bold rounded-md capitalize text-[10px]">
                                {inv.role.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="py-4 px-6">
                              <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                inv.status === 'accepted' 
                                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                  : inv.status === 'pending'
                                  ? 'bg-amber-50 text-amber-600 border border-amber-100'
                                  : inv.status === 'expired'
                                  ? 'bg-slate-100 text-slate-500 border border-slate-200'
                                  : 'bg-red-50 text-red-500 border border-red-100'
                              }`}>
                                <span>{inv.status}</span>
                              </span>
                            </td>
                            <td className="py-4 px-6 text-slate-400 font-mono text-[10px]">
                              {new Date(inv.expiresAt).toLocaleDateString()}
                            </td>
                            <td className="py-4 px-6 text-right space-x-1.5">
                              <button
                                onClick={() => handleCopyInviteLink(inv.id)}
                                className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors inline-flex"
                                title="Copy Invitation Link"
                                aria-label={`Copy invitation link for ${inv.email}`}
                              >
                                <Copy size={13} />
                              </button>
                              
                              {isAdmin && inv.status === 'pending' && (
                                <>
                                  <button
                                    onClick={() => handleSimulateJoin(inv)}
                                    className="text-slate-400 hover:text-indigo-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors inline-flex"
                                    title="Simulate Accept & Join"
                                    aria-label={`Simulate accept invitation for ${inv.email}`}
                                  >
                                    <UserCheck size={13} />
                                  </button>
                                  <button
                                    onClick={() => handleResendInvite(inv)}
                                    disabled={isActionInProgress('resend_' + inv.id)}
                                    className="text-slate-400 hover:text-emerald-600 p-1.5 rounded-lg hover:bg-slate-50 transition-colors inline-flex disabled:opacity-50"
                                    title="Resend Invite"
                                    aria-label={`Resend invite for ${inv.email}`}
                                  >
                                    {isActionInProgress('resend_' + inv.id) ? (
                                      <Loader2 size={13} className="animate-spin text-emerald-600" />
                                    ) : (
                                      <RefreshCw size={13} />
                                    )}
                                  </button>
                                  <button
                                    onClick={() => setCancellingInvite(inv)}
                                    disabled={isActionInProgress('cancel_' + inv.id)}
                                    className="text-slate-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-slate-50 transition-colors inline-flex disabled:opacity-50"
                                    title="Cancel Invitation"
                                    aria-label={`Cancel invitation for ${inv.email}`}
                                  >
                                    <X size={13} />
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}

                        {invitations.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-8 text-center italic text-slate-400">
                              No invitation history found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Send Invite Form Panel */}
              <div className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm space-y-6 self-start">
                <div className="space-y-1 pb-4 border-b border-slate-100">
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">Invite Team Member</h3>
                  <p className="text-xs text-slate-400">Authorize a registration seat for your organization</p>
                </div>

                {isAdmin ? (
                  <form onSubmit={handleSendInvite} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Email Address</label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-3.5 text-slate-400 w-4.5 h-4.5" />
                        <input
                          type="email"
                          required
                          placeholder="e.g. name@company.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50 font-medium"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Corporate Role</label>
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-slate-50 text-slate-700 focus:outline-none"
                      >
                        <option value="org_admin">Organization Admin</option>
                        <option value="team_manager">Team Manager</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Assign Department</label>
                      <select
                        value={inviteDeptId}
                        onChange={(e) => setInviteDeptId(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-slate-50 text-slate-700 focus:outline-none"
                      >
                        <option value="">Unassigned</option>
                        {departments.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="submit"
                      disabled={isActionInProgress('send_invite')}
                      className="w-full py-4 bg-indigo-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-indigo-700 transition-all flex items-center justify-center space-x-2 shadow-md disabled:opacity-50"
                    >
                      {isActionInProgress('send_invite') ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <UserPlus size={14} />
                      )}
                      <span>{isActionInProgress('send_invite') ? 'Sending Invitation...' : 'Send Invite Link'}</span>
                    </button>
                  </form>
                ) : (
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/60 text-center space-y-2">
                    <Shield className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-xs font-bold text-slate-700">Administrator Access Required</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Only Organization Owners and Org Admins have permission to issue new invitations.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 5: PROJECTS */}
          {activeTab === 'projects' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Corporate Workspace Projects</h2>
                <p className="text-xs text-slate-500">Track minutes processed, active strategic assessments, and structural visibility filters.</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-[28px] overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        <th className="py-4 px-6">Folder Name</th>
                        <th className="py-4 px-6">Workspace Creator / Owner</th>
                        <th className="py-4 px-6">Members Attached</th>
                        <th className="py-4 px-6">Minutes Processed</th>
                        <th className="py-4 px-6">AI Strategy Queries</th>
                        <th className="py-4 px-6">Status</th>
                        <th className="py-4 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {projects.map((proj: any) => (
                        <tr key={proj.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-4 px-6 font-bold text-slate-950 flex items-center space-x-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                            <span>{proj.name}</span>
                          </td>
                          <td className="py-4 px-6 text-slate-500 font-medium">{proj.ownerEmail || 'System'}</td>
                          <td className="py-4 px-6">
                            <span className="font-extrabold text-slate-900 bg-slate-100 px-2 py-1 rounded-md">
                              {proj.members?.length || 1} staff
                            </span>
                          </td>
                          <td className="py-4 px-6 font-mono text-slate-700 font-bold">
                            {proj.minutesUsed || 0} min
                          </td>
                          <td className="py-4 px-6 font-mono text-indigo-600 font-bold">
                            {proj.thinkingRequests || 0} calls
                          </td>
                          <td className="py-4 px-6">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                              proj.status === 'archived' 
                                ? 'bg-slate-100 text-slate-500 border border-slate-200' 
                                : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                            }`}>
                              {proj.status || 'active'}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <button
                              onClick={() => handleToggleProjectStatus(proj.id, proj.status)}
                              className="text-xs font-bold text-slate-500 hover:text-indigo-600 flex items-center justify-end space-x-1.5 ml-auto transition-colors"
                            >
                              <Archive size={13} />
                              <span>{proj.status === 'archived' ? 'Unarchive' : 'Archive'}</span>
                            </button>
                          </td>
                        </tr>
                      ))}

                      {projects.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center italic text-slate-400">
                            No active project folders detected in organization.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 6: ROLES MATRIX */}
          {activeTab === 'roles' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column: Role Details */}
              <div className="lg:col-span-2 space-y-6">
                <div>
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Corporate Role Hierarchy</h2>
                  <p className="text-xs text-slate-500">Assign permission levels from super administrative steering to read-only viewer accounts.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { id: 'owner', label: 'Owner', desc: 'Absolute master key access. Full capabilities for financial invoices, API configurations, and organization teardown.' },
                    { id: 'org_admin', label: 'Organization Admin', desc: 'Can add, modify or remove team members, department matrices, and configure security policies.' },
                    { id: 'dept_manager', label: 'Department Manager', desc: 'Authorized to coordinate projects, edit team descriptions, and allocate resources inside designated units.' },
                    { id: 'project_manager', label: 'Project Manager', desc: 'Can upload recordings, generate unified AI intelligence, and share specific folders.' },
                    { id: 'member', label: 'Member', desc: 'Standard staff workspace. Can view department directories, collaborate, and trigger strategic analysis.' },
                    { id: 'viewer', label: 'Viewer', desc: 'Read-only access to transcripts, action plans, and department updates. Strictly forbidden from file mutations.' }
                  ].map((role) => (
                    <button
                      key={role.id}
                      onClick={() => setSelectedRoleDetail(role.id)}
                      className={`text-left p-6 rounded-3xl border transition-all flex flex-col justify-between space-y-4 hover:shadow-sm ${
                        selectedRoleDetail === role.id
                          ? 'bg-indigo-50/50 border-indigo-200'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="font-extrabold text-slate-900 text-sm uppercase tracking-tight">{role.label}</span>
                        {selectedRoleDetail === role.id && <CheckCircle2 className="text-indigo-600 w-5 h-5" />}
                      </div>
                      <p className="text-slate-500 text-xs leading-relaxed">{role.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right Column: Interactive Assignee Assistant */}
              <div className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm space-y-6 self-start">
                <div className="space-y-1 pb-4 border-b border-slate-100">
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider flex items-center space-x-1.5">
                    <ShieldCheck className="text-indigo-600" size={16} />
                    <span>Quick Assignment Matrix</span>
                  </h3>
                  <p className="text-xs text-slate-400">Instantly adjust permissions for any workspace staff member</p>
                </div>

                <div className="space-y-4">
                  <p className="text-slate-500 text-xs leading-relaxed">
                    Select a team member from the directory list under the <strong>Members</strong> tab to alter roles dynamically, or quickly review assignment parameters.
                  </p>
                  
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2 text-xs">
                    <span className="font-bold text-slate-800 block">Active Staff Assigned:</span>
                    <div className="space-y-1.5">
                      {orgMembers.slice(0, 4).map(m => (
                        <div key={m.id} className="flex justify-between items-center text-[11px] text-slate-600">
                          <span className="font-medium truncate max-w-[120px]">{m.name || m.email}</span>
                          <span className="bg-white px-2 py-0.5 rounded border border-slate-200 font-bold uppercase text-[9px]">
                            {m.role}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION: ENTERPRISE SECURITY CENTER */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              {/* Security Center Title & Summary */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                    <ShieldCheck className="text-indigo-600" size={24} />
                    Enterprise Security Center
                  </h2>
                  <p className="text-xs text-slate-500">
                    Configure compliance, federated single sign-on, identity firewalls, API access keys, and review security logs stored in Firestore.
                  </p>
                </div>
                {/* Admin Status Indicator */}
                <div className={`px-4 py-2 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
                  isAdmin
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    isAdmin ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}></span>
                  <span>
                    {isAdmin
                      ? 'Administrator Mode'
                      : 'Read-Only Mode'
                    }
                  </span>
                </div>
              </div>

              {/* Security Center Main Layout Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                
                {/* Left Sidebar Navigation for Security Sections */}
                <div className="lg:col-span-1 space-y-2">
                  {[
                    { id: 'health', label: 'Security Health & Tests', desc: 'SSO diagnostics & test suite', icon: <ShieldCheck size={16} /> },
                    { id: 'sso', label: 'SSO & Identity', desc: 'Google, Microsoft, SAML 2.0', icon: <Fingerprint size={16} /> },
                    { id: 'jit', label: 'JIT & Role Mapping', desc: 'Attribute & Group sync rules', icon: <Users size={16} /> },
                    { id: 'policies', label: 'Policies & Firewalls', desc: 'Password, 2FA, Domains', icon: <Lock size={16} /> },
                    { id: 'api', label: 'API Keys & Secrets', desc: 'Private client keys', icon: <Key size={16} /> },
                    { id: 'audits', label: 'Alerts & Audits', desc: 'Compliance audit trail', icon: <Terminal size={16} /> }
                  ].map((subTab) => (
                    <button
                      key={subTab.id}
                      onClick={() => setSecuritySubTab(subTab.id as any)}
                      className={`w-full text-left p-4 rounded-2xl border transition-all flex items-start gap-3 ${
                        securitySubTab === subTab.id
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-900 shadow-sm'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`p-2 rounded-xl mt-0.5 ${
                        securitySubTab === subTab.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {subTab.icon}
                      </div>
                      <div>
                        <div className="font-bold text-xs uppercase tracking-wider">{subTab.label}</div>
                        <div className="text-[10px] text-slate-400 font-medium">{subTab.desc}</div>
                      </div>
                    </button>
                  ))}

                  {/* Security Quick Stats */}
                  <div className="p-4 bg-slate-50 rounded-[24px] border border-slate-100 space-y-4 text-xs mt-6">
                    <span className="font-extrabold text-slate-800 uppercase tracking-wider block text-[10px]">Compliance Checklist</span>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">MFA Policy Enforced</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                          twoFactorStatus !== 'disabled' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                        }`}>
                          {twoFactorStatus !== 'disabled' ? 'Secure' : 'Unsecured'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">SSO Authentication</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                          ssoStatus === 'enabled' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {ssoStatus === 'enabled' ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Password Firewall</span>
                        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-black uppercase">
                          Enabled
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Active API Keys</span>
                        <span className="bg-slate-200 text-slate-800 px-2 py-0.5 rounded text-[9px] font-black">
                          {apiKeys.filter(k => k.status === 'active').length} Active
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Form Panels */}
                <div className="lg:col-span-3 space-y-6 bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm">
                  
                  {/* WARNING BANNER FOR NON-ADMINS */}
                  {(!isAdmin) && (
                    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 p-4 rounded-2xl text-amber-900 text-xs leading-relaxed">
                      <AlertCircle className="shrink-0 text-amber-600 mt-0.5" size={16} />
                      <div>
                        <strong className="font-bold">Read-Only Mode:</strong> Your current corporate role is <span className="font-extrabold uppercase">{userOrgRole}</span>. You can review the security configuration, but you do not have permission to modify these parameters. Only administrators can save security policies.
                      </div>
                    </div>
                  )}

                  {/* SUBTAB 0: SECURITY HEALTH & TEST SUITE */}
                  {securitySubTab === 'health' && (
                    <EnterpriseSecurityHealth 
                      organization={organization} 
                      userOrgRole={userOrgRole} 
                      onRefreshOrg={() => {}} 
                    />
                  )}

                  <form onSubmit={handleSaveSecuritySettings} className="space-y-6">

                    {/* SUBTAB 1: SSO & IDENTITY */}
                    {securitySubTab === 'sso' && (
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">SSO & Corporate Identity</h3>
                          <p className="text-xs text-slate-500">Manage Single Sign-On integrations and configure credential provider federation.</p>
                        </div>

                        {/* SSO Connection status */}
                        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-5">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">SSO Connection Status</label>
                              <select
                                disabled={!isAdmin}
                                value={ssoStatus}
                                onChange={(e) => setSsoStatus(e.target.value as any)}
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                              >
                                <option value="disabled">🚫 Disabled / Local Auth Only</option>
                                <option value="enabled">🟢 Enabled / Corporate SSO</option>
                              </select>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Federated Protocol</label>
                              <select
                                disabled={ssoStatus === 'disabled' || !isAdmin}
                                value={ssoProtocol}
                                onChange={(e) => setSsoProtocol(e.target.value as any)}
                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                              >
                                <option value="OIDC">OIDC (Microsoft Entra ID / Azure AD)</option>
                                <option value="SAML">SAML 2.0 WebSSO</option>
                              </select>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">IdP Metadata URL</label>
                              <input
                                type="text"
                                disabled={ssoStatus === 'disabled' || !isAdmin}
                                value={ssoIdpUrl}
                                onChange={(e) => setSsoIdpUrl(e.target.value)}
                                placeholder="https://login.microsoftonline.com/{tenant-id}/v2.0"
                                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none"
                              />
                            </div>
                          </div>

                          {/* SSO Enforcement Switch */}
                          <div className="pt-3 border-t border-slate-200/60 flex items-center justify-between">
                            <div className="space-y-0.5">
                              <div className="text-xs font-bold text-slate-800 flex items-center gap-2">
                                <span>Enforce Single Sign-On (SSO)</span>
                                <span className="bg-indigo-50 text-indigo-700 text-[10px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wide">Enterprise Security</span>
                              </div>
                              <p className="text-[11px] text-slate-500">Require all users with verified company email domains to authenticate exclusively via Microsoft Entra ID SSO. Blocks direct password logins.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                              <input
                                type="checkbox"
                                disabled={ssoStatus === 'disabled' || !isAdmin}
                                checked={enforceSso}
                                onChange={(e) => setEnforceSso(e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                            </label>
                          </div>
                        </div>

                        {/* Microsoft Entra ID / Azure Directory Specifics */}
                        {ssoProtocol === 'OIDC' && ssoStatus === 'enabled' && (
                          <div className="p-5 bg-sky-50/50 rounded-2xl border border-sky-100 space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
                                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Microsoft Entra ID (Azure AD) Directory Federation</h4>
                              </div>
                              <span className="text-[10px] font-mono text-sky-700 bg-sky-100 px-2 py-0.5 rounded-md font-bold">OIDC / OAuth 2.0</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Azure Entra Directory (Tenant) ID</label>
                                <input
                                  type="text"
                                  disabled={!isAdmin}
                                  value={entraTenantId}
                                  onChange={(e) => setEntraTenantId(e.target.value)}
                                  placeholder="e.g. 8f4b2319-715a-4648-958a-ef048f72a441"
                                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none"
                                />
                                <p className="text-[10px] text-slate-500">Isolates SSO auth to your specific tenant directory. Leave blank for multi-tenant.</p>
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Azure Application (Client) ID</label>
                                <input
                                  type="text"
                                  disabled={!isAdmin}
                                  value={entraClientId}
                                  onChange={(e) => setEntraClientId(e.target.value)}
                                  placeholder="e.g. 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"
                                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none"
                                />
                                <p className="text-[10px] text-slate-500">App registration client ID from your Azure Portal.</p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="border-t border-slate-100 my-4"></div>

                        {/* Google Authentication */}
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Google Authentication</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                disabled={!isAdmin}
                                checked={googleAuthEnabled}
                                onChange={(e) => setGoogleAuthEnabled(e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                            </label>
                          </div>
                          
                          {googleAuthEnabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Google Client ID</label>
                                <input
                                  type="text"
                                  disabled={!isAdmin}
                                  value={googleClientId}
                                  onChange={(e) => setGoogleClientId(e.target.value)}
                                  placeholder="12345678-abcdef.apps.googleusercontent.com"
                                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Google Client Secret</label>
                                <input
                                  type="password"
                                  disabled={!isAdmin}
                                  value={googleClientSecret}
                                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                                  placeholder="••••••••••••••••••••••••"
                                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Microsoft Authentication */}
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
                              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Microsoft Authentication</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                disabled={!isAdmin}
                                checked={microsoftAuthEnabled}
                                onChange={(e) => setMicrosoftAuthEnabled(e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-sky-600"></div>
                            </label>
                          </div>

                          {microsoftAuthEnabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Microsoft Application (Client) ID</label>
                                <input
                                  type="text"
                                  disabled={!isAdmin}
                                  value={microsoftClientId}
                                  onChange={(e) => setMicrosoftClientId(e.target.value)}
                                  placeholder="9f8c12a4-b09e-4c31-b0e6..."
                                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Microsoft Application Secret</label>
                                <input
                                  type="password"
                                  disabled={!isAdmin}
                                  value={microsoftClientSecret}
                                  onChange={(e) => setMicrosoftClientSecret(e.target.value)}
                                  placeholder="••••••••••••••••••••••••"
                                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* SAML 2.0 Enterprise Identity Provider Integration (Phase 1.6) */}
                        <div className="space-y-4 border-t border-slate-100 pt-5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                                SAML 2.0 Enterprise Identity Provider (SSO)
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full text-[9px] font-black uppercase">
                                  Identity Platform Native
                                </span>
                              </span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                disabled={!isAdmin}
                                checked={samlStatus === 'enabled'}
                                onChange={(e) => {
                                  const nextStatus = e.target.checked ? 'enabled' : 'disabled';
                                  setSamlStatus(nextStatus);
                                  if (e.target.checked) setSsoProtocol('SAML');
                                }}
                                className="sr-only peer"
                              />
                              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                            </label>
                          </div>

                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Federate your workspace with corporate SAML 2.0 Identity Providers such as Okta, OneLogin, Ping Identity, JumpCloud, or Microsoft Entra ID SAML.
                          </p>

                          {samlStatus === 'enabled' && (
                            <div className="space-y-6 p-5 bg-amber-50/40 rounded-2xl border border-amber-200/70">
                              {/* Provider Presets & Display Name */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Identity Provider Preset / Type</label>
                                  <select
                                    disabled={!isAdmin}
                                    value={
                                      samlDisplayName.toLowerCase().includes('okta') ? 'okta' :
                                      samlDisplayName.toLowerCase().includes('onelogin') ? 'onelogin' :
                                      samlDisplayName.toLowerCase().includes('ping') ? 'ping' :
                                      samlDisplayName.toLowerCase().includes('entra') ? 'entra_saml' : 'generic'
                                    }
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === 'okta') setSamlDisplayName('Okta SAML 2.0');
                                      else if (val === 'onelogin') setSamlDisplayName('OneLogin SAML 2.0');
                                      else if (val === 'ping') setSamlDisplayName('PingIdentity SAML');
                                      else if (val === 'entra_saml') setSamlDisplayName('Microsoft Entra SAML');
                                      else setSamlDisplayName('Corporate SAML 2.0');
                                    }}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                                  >
                                    <option value="okta">Okta Identity Cloud</option>
                                    <option value="entra_saml">Microsoft Entra ID (SAML 2.0)</option>
                                    <option value="onelogin">OneLogin by One Identity</option>
                                    <option value="ping">Ping Identity / PingFederate</option>
                                    <option value="generic">Generic SAML 2.0 Compliant IdP</option>
                                  </select>
                                </div>

                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Display Name in Login UI</label>
                                  <input
                                    type="text"
                                    disabled={!isAdmin}
                                    value={samlDisplayName}
                                    onChange={(e) => setSamlDisplayName(e.target.value)}
                                    placeholder="e.g. Okta SSO / ASK Corporate IdP"
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none"
                                  />
                                </div>
                              </div>

                              {/* Identity Provider SAML Metadata Fields */}
                              <div className="space-y-4 pt-2 border-t border-amber-200/50">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider flex items-center justify-between">
                                      <span>IdP Entity ID (Issuer URI) *</span>
                                      <span className="text-[9px] text-slate-400 lowercase font-mono">http://www.okta.com/exk...</span>
                                    </label>
                                    <input
                                      type="text"
                                      required
                                      disabled={!isAdmin}
                                      value={samlEntityId}
                                      onChange={(e) => setSamlEntityId(e.target.value)}
                                      placeholder="https://idp.example.com/entityid or urn:okta:..."
                                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none"
                                    />
                                    <p className="text-[10px] text-slate-500">The unique issuer identifier from your IdP's SAML metadata XML.</p>
                                  </div>

                                  <div className="space-y-1.5">
                                    <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider flex items-center justify-between">
                                      <span>IdP Single Sign-On (SSO) URL *</span>
                                      <span className="text-[9px] text-slate-400 lowercase font-mono">HTTP-POST Binding</span>
                                    </label>
                                    <input
                                      type="text"
                                      required
                                      disabled={!isAdmin}
                                      value={samlSsoUrl}
                                      onChange={(e) => setSamlSsoUrl(e.target.value)}
                                      placeholder="https://idp.example.com/app/sso/saml"
                                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none"
                                    />
                                    <p className="text-[10px] text-slate-500">The endpoint where EchoNote redirects users for authentication.</p>
                                  </div>
                                </div>

                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">
                                      Public X.509 Signing Certificate (PEM Format) *
                                    </label>
                                    <span className="text-[9px] text-slate-400 font-mono">
                                      {samlCertificate ? `${samlCertificate.length} characters` : 'No certificate provided'}
                                    </span>
                                  </div>
                                  <textarea
                                    rows={4}
                                    required
                                    disabled={!isAdmin}
                                    value={samlCertificate}
                                    onChange={(e) => setSamlCertificate(e.target.value)}
                                    placeholder="-----BEGIN CERTIFICATE-----&#10;MIIDHzCCAgegAwIBAgIU...&#10;-----END CERTIFICATE-----"
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-mono focus:outline-none leading-tight text-[11px]"
                                  />
                                  <p className="text-[10px] text-slate-500">Paste the public X.509 certificate used by your IdP to cryptographically sign SAML assertions.</p>
                                </div>
                              </div>

                              {/* Service Provider (SP) Metadata Box for IdP Admin Setup */}
                              <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <FileText size={14} className="text-indigo-600" />
                                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Service Provider (SP) Metadata for your IdP</span>
                                  </div>
                                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                                    Provider ID: saml.{organization?.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500">Provide these EchoNote callback URLs to your IdP (Okta, Entra, Ping, OneLogin):</p>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 space-y-1">
                                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
                                      <span>SP Entity ID / Audience URI</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const url = `https://${window.location.hostname || 'echonote.app'}/__/auth/handler`;
                                          navigator.clipboard.writeText(url);
                                          toast.success("Copied SP Entity ID to clipboard");
                                        }}
                                        className="text-indigo-600 hover:text-indigo-800 cursor-pointer flex items-center gap-1"
                                      >
                                        <Copy size={11} /> Copy
                                      </button>
                                    </div>
                                    <div className="font-mono text-[11px] text-slate-800 break-all select-all">
                                      https://{window.location.hostname || 'echonote.app'}/__/auth/handler
                                    </div>
                                  </div>

                                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 space-y-1">
                                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
                                      <span>ACS URL (Assertion Consumer Service)</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const url = `https://${window.location.hostname || 'echonote.app'}/__/auth/handler`;
                                          navigator.clipboard.writeText(url);
                                          toast.success("Copied ACS URL to clipboard");
                                        }}
                                        className="text-indigo-600 hover:text-indigo-800 cursor-pointer flex items-center gap-1"
                                      >
                                        <Copy size={11} /> Copy
                                      </button>
                                    </div>
                                    <div className="font-mono text-[11px] text-slate-800 break-all select-all">
                                      https://{window.location.hostname || 'echonote.app'}/__/auth/handler
                                    </div>
                                  </div>
                                </div>

                                <div className="text-[10px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1 pt-1 font-medium">
                                  <span>NameID Format: <strong className="font-mono text-slate-700">emailAddress</strong></span>
                                  <span>Binding: <strong className="font-mono text-slate-700">HTTP-POST</strong></span>
                                  <span>Assertion Encryption: <strong className="font-mono text-slate-700">Unencrypted or Signed</strong></span>
                                </div>
                              </div>

                              {/* Test Result Readout Card */}
                              {samlTestResult && (
                                <div className={`p-4 rounded-xl border text-xs space-y-2 ${
                                  samlTestResult.success 
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
                                    : 'bg-rose-50 border-rose-200 text-rose-900'
                                }`}>
                                  <div className="flex items-center justify-between font-bold">
                                    <span className="flex items-center gap-1.5">
                                      {samlTestResult.success ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-rose-600" />}
                                      {samlTestResult.success ? "SAML 2.0 Diagnostic Verification Succeeded" : "SAML Diagnostic Issues Detected"}
                                    </span>
                                    <span className="text-[10px] font-mono opacity-80">
                                      {new Date().toLocaleTimeString()}
                                    </span>
                                  </div>
                                  <p className="text-[11px] leading-relaxed">{samlTestResult.message}</p>
                                  {samlTestResult.diagnostic && (
                                    <div className="pt-2 border-t border-black/10 text-[10px] font-mono grid grid-cols-2 gap-2">
                                      <div>Provider ID: <strong>{samlTestResult.diagnostic.providerId}</strong></div>
                                      <div>Certificate Valid: <strong>{samlTestResult.diagnostic.certificateCount || 1} cert(s) verified</strong></div>
                                      <div>SSO Endpoint: <strong>{samlTestResult.diagnostic.ssoUrlValid ? 'Valid HTTPS URL' : 'Invalid URL'}</strong></div>
                                      <div>Identity Platform Sync: <strong>{samlTestResult.diagnostic.identityPlatformStatus || 'Ready'}</strong></div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Action Buttons: Test Connection, Save, Delete */}
                              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={samlTesting || samlSaving || !samlEntityId || !samlSsoUrl || !samlCertificate || !isAdmin}
                                    onClick={handleTestSamlConnection}
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                                  >
                                    {samlTesting ? <RefreshCw size={13} className="animate-spin" /> : <Fingerprint size={13} />}
                                    <span>Test SAML Connection</span>
                                  </button>

                                  <button
                                    type="button"
                                    disabled={samlSaving || !samlEntityId || !samlSsoUrl || !samlCertificate || !isAdmin}
                                    onClick={handleSaveSamlConfig}
                                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                                  >
                                    {samlSaving ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                                    <span>Save SAML Config</span>
                                  </button>
                                </div>

                                {samlProviderMeta && (
                                  <button
                                    type="button"
                                    disabled={!isAdmin}
                                    onClick={handleDeleteSamlConfig}
                                    className="px-3 py-2 text-rose-600 hover:bg-rose-50 rounded-xl font-bold text-xs transition-colors flex items-center gap-1 cursor-pointer"
                                  >
                                    <Trash2 size={13} />
                                    <span>Delete SAML Provider</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* SUBTAB: JIT & IDENTITY ROLE MAPPING (Phase 1.7) */}
                    {securitySubTab === 'jit' && (
                      <IdentityMappingSettings
                        organization={organization}
                        departments={departments}
                        userOrgRole={userOrgRole}
                        identityMappings={identityMappings}
                        onRefreshMappings={() => {
                          if (organization?.id) {
                            setupSubcollectionListeners(organization.id);
                          }
                        }}
                      />
                    )}

                    {/* SUBTAB 2: ACCESS & POLICIES */}
                    {securitySubTab === 'policies' && (
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Workspace Firewalls & Security Policies</h3>
                          <p className="text-xs text-slate-500">Enforce strict login boundary rules, session parameters, and password complexity.</p>
                        </div>

                        {/* Firewall domains */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                              Allowed Domains
                            </label>
                            <input
                              type="text"
                              disabled={!isAdmin}
                              value={allowedDomainsStr}
                              onChange={(e) => setAllowedDomainsStr(e.target.value)}
                              placeholder="company.com, enterprise.org"
                              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-600 bg-slate-50 text-slate-800 font-semibold"
                            />
                            <span className="text-[10px] text-slate-400 block leading-tight">
                              Only users with email addresses belonging to these domains will be permitted. Leave blank to allow all.
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-rose-500 rounded-full"></span>
                              Blocked Domains
                            </label>
                            <input
                              type="text"
                              disabled={!isAdmin}
                              value={blockedDomainsStr}
                              onChange={(e) => setBlockedDomainsStr(e.target.value)}
                              placeholder="malicious.com, competitors.org"
                              className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-indigo-600 bg-slate-50 text-slate-800 font-semibold"
                            />
                            <span className="text-[10px] text-slate-400 block leading-tight">
                              Instantly block and blacklist authentication requests originating from these designated web domains.
                            </span>
                          </div>
                        </div>

                        <div className="border-t border-slate-100 my-4"></div>

                        {/* 2FA & Session Timeout */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">
                              2FA Status / MFA Enforcement
                            </label>
                            <select
                              disabled={!isAdmin}
                              value={twoFactorStatus}
                              onChange={(e) => setTwoFactorStatus(e.target.value as any)}
                              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                            >
                              <option value="disabled">🚫 Disabled / Optional User Choice</option>
                              <option value="optional">ℹ️ Optional / Recommended</option>
                              <option value="required_admins">🛡️ Required for Administrators Only</option>
                              <option value="required_all">🔥 Required for All Organization Members</option>
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wider">
                              Session Timeout (Inactivity)
                            </label>
                            <select
                              disabled={!isAdmin}
                              value={sessionTimeout}
                              onChange={(e) => setSessionTimeout(e.target.value)}
                              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                            >
                              <option value="15m">15 Minutes</option>
                              <option value="30m">30 Minutes</option>
                              <option value="1h">1 Hour (Recommended)</option>
                              <option value="4h">4 Hours</option>
                              <option value="8h">8 Hours</option>
                              <option value="12h">12 Hours</option>
                              <option value="24h">24 Hours</option>
                              <option value="7d">7 Days</option>
                            </select>
                          </div>
                        </div>

                        <div className="border-t border-slate-100 my-4"></div>

                        {/* Password Policy */}
                        <div className="space-y-4">
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Password Policy Enforcement</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Minimum Password Length</label>
                              <input
                                type="number"
                                disabled={!isAdmin}
                                value={pwdMinLength}
                                onChange={(e) => setPwdMinLength(Number(e.target.value))}
                                min={6}
                                max={32}
                                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none font-semibold"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider">Max Password Age (Days)</label>
                              <input
                                type="number"
                                disabled={!isAdmin}
                                value={pwdMaxAge}
                                onChange={(e) => setPwdMaxAge(Number(e.target.value))}
                                min={0}
                                max={365}
                                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none font-semibold"
                              />
                              <span className="text-[9px] text-slate-400">Set to 0 to disable periodic password rotations.</span>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-6 mt-2">
                            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                              <input
                                type="checkbox"
                                disabled={!isAdmin}
                                checked={pwdEnforceSpecial}
                                onChange={(e) => setPwdEnforceSpecial(e.target.checked)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              Require Special Characters (@, #, $, %, etc.)
                            </label>

                            <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                              <input
                                type="checkbox"
                                disabled={!isAdmin}
                                checked={pwdEnforceNumbers}
                                onChange={(e) => setPwdEnforceNumbers(e.target.checked)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              />
                              Require Numerical Numbers (0-9)
                            </label>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SUBTAB 3: API KEYS */}
                    {securitySubTab === 'api' && (
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Developer API Access Keys</h3>
                          <p className="text-xs text-slate-500">Configure private secure API tokens for script access, database feeds, or recording synchronization.</p>
                        </div>

                        {/* Create API key form */}
                        {isAdmin && (
                          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                            <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1">
                              <Plus size={14} /> Generate New API Access Credentials
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                              <div className="space-y-1.5 sm:col-span-2">
                                <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Key Description / Label</label>
                                <input
                                  type="text"
                                  value={newKeyLabel}
                                  onChange={(e) => setNewKeyLabel(e.target.value)}
                                  placeholder="e.g. Jenkins CI/CD Deploy, Analytics Webhook"
                                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 focus:outline-none"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-extrabold text-slate-600 uppercase tracking-wider">Authorization Role</label>
                                <select
                                  value={newKeyRole}
                                  onChange={(e) => setNewKeyRole(e.target.value)}
                                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-800 font-bold focus:outline-none"
                                >
                                  <option value="Admin">Admin privileges</option>
                                  <option value="Contributor">Contributor access</option>
                                  <option value="Viewer">Viewer access (Read-Only)</option>
                                </select>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={handleCreateApiKey}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center gap-1.5"
                            >
                              <Key size={12} />
                              Generate Secure Token
                            </button>
                          </div>
                        )}

                        {/* Display Generated Key Result ONCE */}
                        {generatedKeyResult && (
                          <div className="p-5 bg-indigo-900 text-white rounded-2xl border border-indigo-950 space-y-3 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-5">
                              <Key size={120} />
                            </div>
                            <div className="flex items-center gap-2">
                              <AlertCircle size={16} className="text-amber-400 shrink-0" />
                              <span className="text-xs font-black uppercase tracking-wider text-amber-400">Copy Secure Token Immediately</span>
                            </div>
                            <p className="text-[11px] text-indigo-200 max-w-xl">
                              For security compliance, this API token is only displayed once. If lost or uncopied, you must revoke the key and generate a new one.
                            </p>
                            <div className="flex items-center gap-2 bg-indigo-950 border border-indigo-800/40 p-3 rounded-xl">
                              <span className="font-mono text-xs text-amber-300 font-bold tracking-tight select-all break-all flex-1">
                                {generatedKeyResult}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(generatedKeyResult);
                                  toast.success("API Secure Token copied to clipboard!");
                                }}
                                className="bg-indigo-800 hover:bg-indigo-700 p-2 rounded-lg text-white transition-all flex items-center gap-1 text-[10px] font-bold"
                              >
                                <Copy size={12} /> Copy
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => setGeneratedKeyResult(null)}
                              className="text-white hover:text-indigo-200 font-bold uppercase tracking-wider text-[10px] block mt-1"
                            >
                              ✓ I have copied and secured this token
                            </button>
                          </div>
                        )}

                        {/* List of generated API keys */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Active Workspace API Keys</h4>
                          <div className="overflow-x-auto border border-slate-100 rounded-2xl bg-white shadow-sm">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-100 text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">
                                  <th className="p-4">Key Label & Description</th>
                                  <th className="p-4">Authorization Role</th>
                                  <th className="p-4">Token Preview</th>
                                  <th className="p-4">Created Date</th>
                                  <th className="p-4">Status</th>
                                  <th className="p-4 text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                                {apiKeys.map((k) => (
                                  <tr key={k.id} className="hover:bg-slate-50/50">
                                    <td className="p-4">
                                      <div className="font-bold text-slate-900">{k.label}</div>
                                      <div className="text-[10px] text-slate-400">ID: {k.id}</div>
                                    </td>
                                    <td className="p-4">
                                      <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] text-slate-700">
                                        {k.role}
                                      </span>
                                    </td>
                                    <td className="p-4 font-mono text-[11px] text-slate-500">
                                      {k.status === 'active' ? '••••••••••••••••••••' + k.key.slice(-4) : 'REVENUE_KEY_REVOKED'}
                                    </td>
                                    <td className="p-4 text-[10px] text-slate-400">
                                      {new Date(k.createdAt).toLocaleDateString()}
                                    </td>
                                    <td className="p-4">
                                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                        k.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                      }`}>
                                        {k.status}
                                      </span>
                                    </td>
                                    <td className="p-4 text-right">
                                      {k.status === 'active' ? (
                                        <button
                                          type="button"
                                          disabled={!isAdmin}
                                          onClick={() => handleRevokeApiKey(k.id, k.label)}
                                          className="text-rose-600 hover:text-rose-800 font-bold uppercase tracking-wider text-[10px] disabled:opacity-50"
                                        >
                                          Revoke
                                        </button>
                                      ) : (
                                        <span className="text-slate-400 text-[10px]">Disabled</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SUBTAB 4: EVENTS & AUDITS */}
                    {securitySubTab === 'audits' && (
                      <div className="space-y-6">
                        {/* Interactive Security events / threat alerts */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5 text-rose-700">
                                <AlertTriangle size={16} /> Security Event & Threat Alerts
                              </h3>
                              <p className="text-[11px] text-slate-500">Active real-time anomaly detections, authentication failures, or policy violations.</p>
                            </div>
                            <span className="bg-rose-100 text-rose-700 font-black text-xs px-2.5 py-1 rounded-full">
                              {securityEvents.filter(e => e.status === 'active').length} Active Alerts
                            </span>
                          </div>

                          <div className="grid grid-cols-1 gap-4">
                            {securityEvents.map((e) => (
                              <div
                                key={e.id}
                                className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-4 ${
                                  e.status === 'active'
                                    ? e.severity === 'critical' || e.severity === 'high'
                                      ? 'bg-rose-50 border-rose-200'
                                      : 'bg-amber-50 border-amber-200'
                                    : 'bg-slate-50 border-slate-100'
                                }`}
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${
                                      e.status === 'resolved'
                                        ? 'bg-slate-400'
                                        : e.severity === 'critical' || e.severity === 'high'
                                          ? 'bg-rose-500 animate-pulse'
                                          : 'bg-amber-500 animate-pulse'
                                    }`}></span>
                                    <span className="font-bold text-slate-900 text-xs uppercase tracking-wider">{e.event}</span>
                                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                                      e.severity === 'critical'
                                        ? 'bg-rose-600 text-white'
                                        : e.severity === 'high'
                                          ? 'bg-rose-100 text-rose-700'
                                          : e.severity === 'medium'
                                            ? 'bg-amber-100 text-amber-700'
                                            : 'bg-slate-100 text-slate-600'
                                    }`}>
                                      {e.severity}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-600 font-semibold">{e.details}</p>
                                  <div className="text-[10px] text-slate-400 font-medium">
                                    Triggered {new Date(e.timestamp).toLocaleString()} • Status: <span className="font-bold">{e.status}</span>
                                  </div>
                                </div>
                                
                                {e.status === 'active' && (
                                  <button
                                    type="button"
                                    disabled={!isAdmin}
                                    onClick={() => handleResolveEvent(e.id, e.event)}
                                    className="bg-white hover:bg-slate-100 text-slate-800 font-extrabold text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-lg border border-slate-200 transition-all shrink-0"
                                  >
                                    Resolve
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="border-t border-slate-100 my-4"></div>

                        {/* Searchable Compliance Audit Logs */}
                        <div className="space-y-4">
                          {/* Title and Controls */}
                          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                            <div className="space-y-1">
                              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <Database size={14} className="text-indigo-600" /> Compliance Audit Logs Registry
                              </h3>
                              <p className="text-[10px] text-slate-400 font-medium">An immutable compliance ledger capturing all organizational configuration events.</p>
                            </div>

                            {/* Filters, Search and Export Container */}
                            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full xl:w-auto">
                              {/* Search Input */}
                              <div className="relative flex-grow sm:flex-grow-0 sm:w-56">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                                <input
                                  type="text"
                                  placeholder="Search actions, users..."
                                  value={searchAuditQuery}
                                  onChange={(e) => setSearchAuditQuery(e.target.value)}
                                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600"
                                />
                              </div>

                              {/* Action Type Filter */}
                              <select
                                value={filterAction}
                                onChange={(e) => setFilterAction(e.target.value)}
                                className="px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600 font-semibold text-slate-700"
                              >
                                <option value="all">All Action Types</option>
                                <option value="Member invited">Member Invited</option>
                                <option value="Member joined">Member Joined</option>
                                <option value="Project created">Project Created</option>
                                <option value="Project deleted">Project Deleted</option>
                                <option value="Transcript generated">Transcript Generated</option>
                                <option value="Decision Intelligence generated">Decision Intelligence Generated</option>
                                <option value="Payment completed">Payment Completed</option>
                                <option value="Subscription changed">Subscription Changed</option>
                                <option value="Role changed">Role Changed</option>
                                <option value="Organization settings updated">Organization Settings Updated</option>
                              </select>

                              {/* Project Filter */}
                              <select
                                value={filterProject}
                                onChange={(e) => setFilterProject(e.target.value)}
                                className="px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] bg-white focus:outline-none focus:border-indigo-600 font-semibold text-slate-700"
                              >
                                <option value="all">All Projects</option>
                                <option value="global">Global (No Project)</option>
                                {Array.from(
                                  new Set(
                                    [...subcollectionAuditLogs, ...auditLogs]
                                      .map(l => l.project)
                                      .filter((p): p is string => !!p)
                                  )
                                ).map(projectName => (
                                  <option key={projectName} value={projectName}>{projectName}</option>
                                ))}
                              </select>

                              {/* Export CSV Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  // Compute the currently filtered logs
                                  const logsToExport = [...subcollectionAuditLogs];
                                  auditLogs.forEach(legacyLog => {
                                    if (!logsToExport.some(c => c.id === legacyLog.id || (c.timestamp === legacyLog.timestamp && c.action === legacyLog.action))) {
                                      logsToExport.push(legacyLog);
                                    }
                                  });
                                  const filtered = logsToExport.filter(log => {
                                    const matchesSearch = !searchAuditQuery.trim() || 
                                      log.action.toLowerCase().includes(searchAuditQuery.toLowerCase()) ||
                                      log.actor.toLowerCase().includes(searchAuditQuery.toLowerCase()) ||
                                      log.details.toLowerCase().includes(searchAuditQuery.toLowerCase()) ||
                                      (log.project && log.project.toLowerCase().includes(searchAuditQuery.toLowerCase()));
                                    const matchesAction = filterAction === 'all' || log.action === filterAction;
                                    const matchesProject = filterProject === 'all' || 
                                      (filterProject === 'global' && !log.project) || 
                                      (log.project && log.project.toLowerCase() === filterProject.toLowerCase());
                                    return matchesSearch && matchesAction && matchesProject;
                                  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                                  handleExportCSV(filtered);
                                }}
                                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-sm shrink-0"
                              >
                                <Download size={12} />
                                Export CSV
                              </button>
                            </div>
                          </div>

                          {/* Audit Logs Table */}
                          <div className="overflow-x-auto border border-slate-100 rounded-2xl bg-white shadow-sm">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-100 text-[9px] font-extrabold text-slate-500 uppercase tracking-wider">
                                  <th className="p-3">Compliance Timestamp</th>
                                  <th className="p-3">Action Event</th>
                                  <th className="p-3">Authorized Actor</th>
                                  <th className="p-3">Project Context</th>
                                  <th className="p-3">Organization</th>
                                  <th className="p-3">Source IP</th>
                                  <th className="p-3">Activity Ledger Details</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-[11px] font-semibold text-slate-700">
                                {(() => {
                                  // Gather and filter logs dynamically
                                  const logsList = [...subcollectionAuditLogs];
                                  auditLogs.forEach(legacyLog => {
                                    if (!logsList.some(c => c.id === legacyLog.id || (c.timestamp === legacyLog.timestamp && c.action === legacyLog.action))) {
                                      logsList.push(legacyLog);
                                    }
                                  });
                                  const filtered = logsList.filter(log => {
                                    const matchesSearch = !searchAuditQuery.trim() || 
                                      log.action.toLowerCase().includes(searchAuditQuery.toLowerCase()) ||
                                      log.actor.toLowerCase().includes(searchAuditQuery.toLowerCase()) ||
                                      log.details.toLowerCase().includes(searchAuditQuery.toLowerCase()) ||
                                      (log.project && log.project.toLowerCase().includes(searchAuditQuery.toLowerCase()));
                                    const matchesAction = filterAction === 'all' || log.action === filterAction;
                                    const matchesProject = filterProject === 'all' || 
                                      (filterProject === 'global' && !log.project) || 
                                      (log.project && log.project.toLowerCase() === filterProject.toLowerCase());
                                    return matchesSearch && matchesAction && matchesProject;
                                  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                                  if (filtered.length === 0) {
                                    return (
                                      <tr>
                                        <td colSpan={7} className="p-8 text-center text-slate-400">
                                          No audit log registry matches found for your active filters.
                                        </td>
                                      </tr>
                                    );
                                  }

                                  return filtered.map((log) => (
                                    <tr key={log.id} className="hover:bg-slate-50/50">
                                      <td className="p-3 text-slate-400 font-mono text-[10px]">
                                        {new Date(log.timestamp).toLocaleString()}
                                      </td>
                                      <td className="p-3">
                                        <span className={`px-2 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                          log.action === 'Project deleted' || log.action === 'Member removed'
                                            ? 'bg-rose-50 text-rose-700 border border-rose-100'
                                            : log.action === 'Project created' || log.action === 'Member joined'
                                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                              : log.action === 'Subscription changed' || log.action === 'Payment completed'
                                                ? 'bg-purple-50 text-purple-700 border border-purple-100'
                                                : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                        }`}>
                                          {log.action}
                                        </span>
                                      </td>
                                      <td className="p-3 font-mono text-[10px] text-indigo-600">{log.actor}</td>
                                      <td className="p-3">
                                        {log.project ? (
                                          <span className="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                            📁 {log.project}
                                          </span>
                                        ) : (
                                          <span className="text-slate-400 text-[10px] italic">Global Context</span>
                                        )}
                                      </td>
                                      <td className="p-3 text-slate-500 font-semibold text-[10px]">{log.organizationName || organization?.name || 'N/A'}</td>
                                      <td className="p-3 text-slate-400 font-mono text-[10px]">{log.ip || '192.168.1.1'}</td>
                                      <td className="p-3 text-slate-500 text-[10px] max-w-xs truncate" title={log.details}>
                                        {log.details}
                                      </td>
                                    </tr>
                                  ));
                                })()}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SAVE BUTTON (Displays in tabs: sso, policies) */}
                    {(securitySubTab === 'sso' || securitySubTab === 'policies') && (
                      <div className="border-t border-slate-100 pt-6 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (organization) {
                              initSettingsForm(organization);
                              toast.info("Security form values reset to last saved state.");
                            }
                          }}
                          className="px-5 py-3 border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 text-xs font-bold uppercase tracking-wider transition-all"
                        >
                          Reset Configuration
                        </button>
                        <button
                          type="submit"
                          disabled={!isAdmin}
                          className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-sm flex items-center gap-1.5"
                        >
                          <ShieldCheck size={14} />
                          Save Compliance Policies
                        </button>
                      </div>
                    )}

                  </form>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 7: SETTINGS */}
          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Form Settings Panels */}
              <div className="lg:col-span-2 space-y-6">
                <div>
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Organization Profile Settings</h2>
                  <p className="text-xs text-slate-500">Configure branding guidelines, localized formats, and global default workspaces saved in Firestore.</p>
                </div>

                <form onSubmit={handleSaveSettings} className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Organization Name</label>
                      <input
                        type="text"
                        required
                        value={settingsName}
                        onChange={(e) => setSettingsName(e.target.value)}
                        placeholder="Company Name"
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50 font-semibold text-slate-900"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Logo URL / Icon Emoji</label>
                      <input
                        type="text"
                        value={settingsLogo}
                        onChange={(e) => setSettingsLogo(e.target.value)}
                        placeholder="🏢 or Image URL"
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50 text-slate-800"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Sector Industry</label>
                      <select
                        value={settingsIndustry}
                        onChange={(e) => setSettingsIndustry(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-slate-50 text-slate-700 focus:outline-none"
                      >
                        <option value="Technology">Technology & AI Research</option>
                        <option value="Finance">Financial Services</option>
                        <option value="Research">Academic & Clinical Research</option>
                        <option value="Compliance">Regulatory compliance</option>
                        <option value="Operations">Operations</option>
                        <option value="Legal">Legal Consultation</option>
                        <option value="HR">Human Resources</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Localized Timezone</label>
                      <select
                        value={settingsTimezone}
                        onChange={(e) => setSettingsTimezone(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-slate-50 text-slate-700 focus:outline-none"
                      >
                        <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                        <option value="America/New_York">America/New_York (EST)</option>
                        <option value="Europe/London">Europe/London (GMT)</option>
                        <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                        <option value="UTC">Coordinated Universal Time (UTC)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Country Location</label>
                      <input
                        type="text"
                        value={settingsCountry}
                        onChange={(e) => setSettingsCountry(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50 text-slate-800"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Primary Language</label>
                      <input
                        type="text"
                        value={settingsLanguage}
                        onChange={(e) => setSettingsLanguage(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50 text-slate-800"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Default Folder Workspace</label>
                      <select
                        value={settingsDefaultWorkspace}
                        onChange={(e) => setSettingsDefaultWorkspace(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm bg-slate-50 text-slate-700 focus:outline-none"
                      >
                        <option value="">None / Select Folder</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Corporate Brand Color</label>
                      <div className="flex items-center space-x-3">
                        <input
                          type="color"
                          value={settingsBrandColor}
                          onChange={(e) => setSettingsBrandColor(e.target.value)}
                          className="w-10 h-10 rounded border border-slate-200 cursor-pointer bg-white"
                        />
                        <span className="font-mono text-xs text-slate-500">{settingsBrandColor}</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-6 space-y-4">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">Sign-on Security Policies</h4>
                    
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-slate-900">Enforce Admin Multi-Factor Auth</span>
                        <p className="text-[10px] text-slate-400">Requires MFA setup validation during administrative actions</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settingsEnforceMfa}
                          onChange={(e) => setSettingsEnforceMfa(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Session Timeout Minutes</label>
                      <input
                        type="number"
                        min="15"
                        max="1440"
                        value={settingsSessionTimeout}
                        onChange={(e) => setSettingsSessionTimeout(Number(e.target.value))}
                        className="w-32 px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-600 bg-slate-50 text-slate-900 font-semibold"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-xs font-bold uppercase tracking-wider hover:bg-indigo-700 transition-all flex items-center justify-center space-x-1.5 shadow-md"
                  >
                    <Check size={14} />
                    <span>Save Corporate Settings</span>
                  </button>
                </form>
              </div>

              {/* Security Status Info Card */}
              <div className="bg-white border border-slate-200 p-8 rounded-[32px] shadow-sm space-y-6 self-start">
                <div className="space-y-1 pb-4 border-b border-slate-100">
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">Corporate Security</h3>
                  <p className="text-xs text-slate-400">Verify localized parameters and domains</p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl flex items-start space-x-3 text-xs">
                    <ShieldCheck className="text-emerald-600 w-5 h-5 shrink-0" />
                    <div className="space-y-0.5">
                      <span className="font-bold text-emerald-950">SSO Integrations Active</span>
                      <p className="text-[10px] text-emerald-800 leading-relaxed">
                        Registered corporate domains are automatically authorized to claim access.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-indigo-50/30 border border-indigo-100 rounded-2xl flex items-start space-x-3 text-xs">
                    <Palette className="text-indigo-600 w-5 h-5 shrink-0" />
                    <div className="space-y-0.5">
                      <span className="font-bold text-indigo-950">Branded Themes</span>
                      <p className="text-[10px] text-indigo-800 leading-relaxed">
                        Brand colors and logotypes are fetched in real-time to customize individual workspace experiences.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 8: BILLING */}
          {activeTab === 'billing' && (
            <OrganizationBilling 
              organization={organization}
              orgMembers={orgMembers}
              userProfile={userProfile}
              userOrgRole={userOrgRole}
            />
          )}

          {/* SECTION 9: INTEGRATIONS */}
          {activeTab === 'integrations' && (
            <IntegrationsView 
              organization={organization}
              userProfile={userProfile}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* MODAL 1: OWNERSHIP TRANSFER (Owner-Only) */}
      {isOwner && isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="transfer-ownership-title">
          <div className="bg-white border border-slate-200 rounded-[32px] p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
                  <ArrowRightLeft size={20} />
                </div>
                <div>
                  <h3 id="transfer-ownership-title" className="text-base font-black text-slate-900 uppercase tracking-wide">
                    Transfer Ownership
                  </h3>
                  <p className="text-xs text-slate-500">Permanently assign primary owner privileges</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsTransferModalOpen(false);
                  setTransferTargetMemberId('');
                  setTransferConfirmText('');
                  setTransferError(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors"
                aria-label="Close transfer modal"
              >
                <X size={18} />
              </button>
            </div>

            {/* Explanatory Warning Callout */}
            <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl space-y-2">
              <div className="flex items-center space-x-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
                <AlertTriangle size={14} className="text-amber-600" />
                <span>Irreversible Action Warning</span>
              </div>
              <ul className="text-xs text-amber-800/90 space-y-1 list-disc pl-4 leading-relaxed font-medium">
                <li>The selected member will become the sole <strong>Organization Owner</strong>.</li>
                <li>Your role will be demoted to <strong>Organization Admin</strong>.</li>
                <li>You will lose permissions to transfer ownership or delete this organization workspace.</li>
              </ul>
            </div>

            {transferError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold flex items-center space-x-2">
                <XCircle size={14} className="text-rose-600 shrink-0" />
                <span>{transferError}</span>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="transfer-target-select" className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Select New Owner
                </label>
                <select
                  id="transfer-target-select"
                  value={transferTargetMemberId}
                  onChange={(e) => setTransferTargetMemberId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs font-bold bg-slate-50 text-slate-800 focus:outline-none focus:border-indigo-600"
                >
                  <option value="">-- Choose an active member --</option>
                  {orgMembers
                    .filter(m => m.status === 'active' && m.role !== 'owner' && m.userId !== organization?.ownerId && m.userId !== userProfile?.uid)
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.email} ({m.email}) - {normalizeOrgRole(m.role)}
                      </option>
                    ))}
                </select>
                {orgMembers.filter(m => m.status === 'active' && m.role !== 'owner' && m.userId !== organization?.ownerId && m.userId !== userProfile?.uid).length === 0 && (
                  <p className="text-[11px] text-amber-600 font-medium mt-1">
                    No eligible active members found. Please invite or activate a member before initiating ownership transfer.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="transfer-confirm-input" className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Type <span className="font-mono text-rose-600">TRANSFER</span> to confirm
                </label>
                <input
                  id="transfer-confirm-input"
                  type="text"
                  placeholder="TRANSFER"
                  value={transferConfirmText}
                  onChange={(e) => setTransferConfirmText(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-mono font-bold uppercase tracking-wider focus:outline-none focus:border-indigo-600 bg-slate-50 text-slate-900"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => {
                  setIsTransferModalOpen(false);
                  setTransferTargetMemberId('');
                  setTransferConfirmText('');
                  setTransferError(null);
                }}
                disabled={isActionInProgress('transfer')}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleTransferOwnership}
                disabled={
                  transferConfirmText.trim().toUpperCase() !== 'TRANSFER' ||
                  !transferTargetMemberId ||
                  isActionInProgress('transfer')
                }
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Confirm ownership transfer"
              >
                {isActionInProgress('transfer') ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ArrowRightLeft size={14} />
                )}
                <span>{isActionInProgress('transfer') ? 'Transferring...' : 'Transfer Ownership'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: DEACTIVATE MEMBER CONFIRMATION */}
      {deactivatingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="deactivate-member-title">
          <div className="bg-white border border-slate-200 rounded-[32px] p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
                <UserX size={20} />
              </div>
              <div>
                <h3 id="deactivate-member-title" className="text-base font-black text-slate-900 uppercase tracking-wide">
                  Deactivate Member
                </h3>
                <p className="text-xs text-slate-500">Temporarily suspend organization access</p>
              </div>
            </div>

            <div className="p-4 bg-amber-50/70 border border-amber-200/80 rounded-2xl space-y-2">
              <p className="text-xs text-amber-900 font-bold">
                Are you sure you want to deactivate {deactivatingMember.name || deactivatingMember.email}?
              </p>
              <ul className="text-[11px] text-amber-800/90 space-y-1 list-disc pl-4 leading-relaxed font-medium">
                <li>The user will immediately lose access to this organization and all related projects.</li>
                <li>Their historical activity and audit logs will be preserved.</li>
                <li>You can reactivate this member at any time from the Directory.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setDeactivatingMember(null)}
                disabled={isActionInProgress('deactivate_' + deactivatingMember.id)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Keep Active
              </button>
              <button
                onClick={() => handleDeactivateMember(deactivatingMember)}
                disabled={isActionInProgress('deactivate_' + deactivatingMember.id)}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all shadow-md disabled:opacity-50"
                aria-label={`Confirm deactivation of member ${deactivatingMember.name || deactivatingMember.email}`}
              >
                {isActionInProgress('deactivate_' + deactivatingMember.id) ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <UserX size={14} />
                )}
                <span>{isActionInProgress('deactivate_' + deactivatingMember.id) ? 'Deactivating...' : 'Deactivate Member'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: REMOVE MEMBER CONFIRMATION */}
      {removingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="remove-member-title">
          <div className="bg-white border border-slate-200 rounded-[32px] p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 id="remove-member-title" className="text-base font-black text-slate-900 uppercase tracking-wide">
                  Remove Member
                </h3>
                <p className="text-xs text-slate-500">Revoke membership permanently</p>
              </div>
            </div>

            <div className="p-4 bg-rose-50/70 border border-rose-200/80 rounded-2xl space-y-2">
              <p className="text-xs text-rose-900 font-bold">
                Remove {removingMember.name || removingMember.email} from {organization?.name || 'this organization'}?
              </p>
              <ul className="text-[11px] text-rose-800/90 space-y-1 list-disc pl-4 leading-relaxed font-medium">
                <li>Their membership will be permanently removed.</li>
                <li>All direct assignments to organization departments and projects will be cleared.</li>
                <li>To rejoin, a new invitation will need to be issued.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setRemovingMember(null)}
                disabled={isActionInProgress('remove_' + removingMember.id)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRemoveMember(removingMember)}
                disabled={isActionInProgress('remove_' + removingMember.id)}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all shadow-md disabled:opacity-50"
                aria-label={`Confirm removal of member ${removingMember.name || removingMember.email}`}
              >
                {isActionInProgress('remove_' + removingMember.id) ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                <span>{isActionInProgress('remove_' + removingMember.id) ? 'Removing...' : 'Remove Member'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CANCEL INVITATION CONFIRMATION */}
      {cancellingInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="cancel-invite-title">
          <div className="bg-white border border-slate-200 rounded-[32px] p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                <X size={20} />
              </div>
              <div>
                <h3 id="cancel-invite-title" className="text-base font-black text-slate-900 uppercase tracking-wide">
                  Cancel Invitation
                </h3>
                <p className="text-xs text-slate-500">Revoke pending invitation link</p>
              </div>
            </div>

            <div className="p-4 bg-rose-50/70 border border-rose-200/80 rounded-2xl space-y-2">
              <p className="text-xs text-rose-900 font-bold">
                Cancel invitation for {cancellingInvite.email}?
              </p>
              <p className="text-[11px] text-rose-800/90 leading-relaxed font-medium">
                The invitation token will be permanently revoked. Any attempt to join using the previous link will be rejected by the server.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                onClick={() => setCancellingInvite(null)}
                disabled={isActionInProgress('cancel_' + cancellingInvite.id)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Keep Invitation
              </button>
              <button
                onClick={() => handleCancelInvite(cancellingInvite)}
                disabled={isActionInProgress('cancel_' + cancellingInvite.id)}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider flex items-center space-x-2 transition-all shadow-md disabled:opacity-50"
                aria-label={`Confirm cancellation of invitation for ${cancellingInvite.email}`}
              >
                {isActionInProgress('cancel_' + cancellingInvite.id) ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <X size={14} />
                )}
                <span>{isActionInProgress('cancel_' + cancellingInvite.id) ? 'Cancelling...' : 'Revoke Invitation'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
