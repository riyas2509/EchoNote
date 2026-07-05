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
  Info
} from 'lucide-react';
import { 
  db, 
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
  OrgRole
} from '../types';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area, Legend } from 'recharts';
import { Toaster, toast } from 'sonner';

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
  // Current Active Tab inside Organization Dashboard
  const [activeTab, setActiveTab] = useState<'overview' | 'teams' | 'projects' | 'members' | 'usage' | 'billing'>('overview');

  // Firestore States
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [invoices, setInvoices] = useState<OrgInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [isBootstrapping, setIsBootstrapping] = useState(false);

  // Form States
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [selectedProjectsForTeam, setSelectedProjectsForTeam] = useState<string[]>([]);
  
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'owner' | 'admin' | 'team_lead' | 'member' | 'guest'>('member');
  const [newMemberTeamId, setNewMemberTeamId] = useState<string>('');

  const [additionalSeats, setAdditionalSeats] = useState<number>(5);
  const [orgDomainInput, setOrgDomainInput] = useState('');
  const [enforceMfa, setEnforceMfa] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState(60);

  // Load Organization data
  useEffect(() => {
    if (!userProfile?.uid) return;

    setLoading(true);
    // Find organization where user is owner or member
    const orgQuery = query(
      collection(db, 'organizations'),
      where('ownerEmail', '==', userProfile.email)
    );

    const unsubscribeOrg = onSnapshot(orgQuery, async (snapshot) => {
      if (snapshot.empty) {
        // Look up memberships as backup
        const memberQuery = query(
          collection(db, 'orgMembers'),
          where('email', '==', userProfile.email)
        );
        const memberSnap = await getDocs(memberQuery);
        if (memberSnap.empty) {
          setOrganization(null);
          setLoading(false);
          return;
        }
        
        // Load first membership org
        const firstMember = memberSnap.docs[0].data() as OrgMember;
        const orgDocRef = doc(db, 'organizations', firstMember.orgId);
        const unsubscribeSubOrg = onSnapshot(orgDocRef, (orgDoc) => {
          if (orgDoc.exists()) {
            setOrganization({ id: orgDoc.id, ...orgDoc.data() } as Organization);
            loadOrgSubcollections(orgDoc.id);
          } else {
            setOrganization(null);
          }
          setLoading(false);
        });
        return () => unsubscribeSubOrg();
      }

      const orgDoc = snapshot.docs[0];
      const orgData = { id: orgDoc.id, ...orgDoc.data() } as Organization;
      setOrganization(orgData);
      setOrgDomainInput(orgData.domain || '');
      setEnforceMfa(orgData.settings?.enforceMfa || false);
      setSessionTimeout(orgData.settings?.sessionTimeoutMinutes || 60);
      loadOrgSubcollections(orgDoc.id);
      setLoading(false);
    }, (error) => {
      console.error("Error loading organizations:", error);
      setLoading(false);
    });

    return () => {
      unsubscribeOrg();
    };
  }, [userProfile?.uid, userProfile?.email]);

  const loadOrgSubcollections = (orgId: string) => {
    // 1. Teams
    const qTeams = query(collection(db, 'teams'), where('orgId', '==', orgId));
    const unsubTeams = onSnapshot(qTeams, (snap) => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() } as Team)));
    });

    // 2. Org Members
    const qMembers = query(collection(db, 'orgMembers'), where('orgId', '==', orgId));
    const unsubMembers = onSnapshot(qMembers, (snap) => {
      setOrgMembers(snap.docs.map(d => ({ id: d.id, ...d.data() } as OrgMember)));
    });

    // 3. Invoices
    const qInvoices = query(collection(db, 'orgInvoices'), where('orgId', '==', orgId));
    const unsubInvoices = onSnapshot(qInvoices, (snap) => {
      setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() } as OrgInvoice)));
    });

    return () => {
      unsubTeams();
      unsubMembers();
      unsubInvoices();
    };
  };

  // Bootstrap / Seed an Enterprise Organization
  const handleBootstrapOrganization = async () => {
    if (!userProfile) return;
    setIsBootstrapping(true);
    const toastId = toast.loading("Bootstrapping Enterprise Organization...");

    try {
      const orgId = 'org_' + Math.random().toString(36).substring(2, 9);
      const emailDomain = userProfile.email.split('@')[1] || 'acme.com';
      const companyName = emailDomain.split('.')[0].toUpperCase() + " Corporation";

      // 1. Create Organization Document
      const orgDocRef = doc(db, 'organizations', orgId);
      const orgPayload: Omit<Organization, 'id'> = {
        name: companyName,
        domain: emailDomain,
        ownerId: userProfile.uid,
        ownerEmail: userProfile.email,
        plan: 'enterprise',
        createdAt: new Date().toISOString(),
        settings: {
          allowedDomains: [emailDomain],
          enforceMfa: true,
          sessionTimeoutMinutes: 60
        }
      };
      await setDoc(orgDocRef, orgPayload);

      // 2. Create Teams
      const defaultTeams = [
        { name: "Engineering & QA", desc: "Core software platform developers, cloud architecture, and test automation engineers." },
        { name: "Growth Marketing", desc: "Brand management, customer acquisition campaigns, and inbound demand gen." },
        { name: "Product Strategy & Design", desc: "User research, mockups, design systems, and product management roadmap coordination." },
        { name: "Executive Leadership", desc: "Global corporate steering, investment strategies, and administrative operations." }
      ];

      const createdTeamIds: string[] = [];
      for (const t of defaultTeams) {
        const teamId = 'team_' + Math.random().toString(36).substring(2, 9);
        const teamDocRef = doc(db, 'teams', teamId);
        
        // Assign some existing projects to the engineering and marketing teams if available
        let assignedProjects: string[] = [];
        if (t.name.startsWith("Engineering") && projects.length > 0) {
          assignedProjects = [projects[0]?.id];
        } else if (t.name.startsWith("Growth") && projects.length > 1) {
          assignedProjects = [projects[1]?.id];
        }

        await setDoc(teamDocRef, {
          orgId,
          name: t.name,
          description: t.desc,
          projectIds: assignedProjects,
          createdAt: new Date().toISOString()
        });
        createdTeamIds.push(teamId);
      }

      // 3. Create Seeded Members
      const seedMembers = [
        { email: userProfile.email, name: userProfile.displayName || "You", role: 'owner', status: 'active' },
        { email: `sarah.jenkins@${emailDomain}`, name: "Sarah Jenkins", role: 'admin', status: 'active' },
        { email: `david.chen@${emailDomain}`, name: "David Chen", role: 'team_lead', status: 'active' },
        { email: `emily.rodriguez@${emailDomain}`, name: "Emily Rodriguez", role: 'member', status: 'active' },
        { email: `james.wilson@${emailDomain}`, name: "James Wilson", role: 'member', status: 'active' },
        { email: `priya.sharma@${emailDomain}`, name: "Priya Sharma", role: 'member', status: 'active' },
        { email: `robert.taylor@external.com`, name: "Robert Taylor", role: 'guest', status: 'active' },
        { email: `mark.cuban@${emailDomain}`, name: "Mark Cuban", role: 'member', status: 'pending' }
      ];

      for (const m of seedMembers) {
        const memberId = 'member_' + Math.random().toString(36).substring(2, 9);
        await setDoc(doc(db, 'orgMembers', memberId), {
          orgId,
          userId: m.email === userProfile.email ? userProfile.uid : 'user_' + Math.random().toString(36).substring(2, 9),
          email: m.email,
          name: m.name,
          role: m.role,
          status: m.status,
          joinedAt: new Date().toISOString()
        });
      }

      // 4. Create Mock Invoices
      const mockInvoices = [
        { date: '2026-05-01', amount: 15000, seats: 15, status: 'paid', plan: 'enterprise' },
        { date: '2026-06-01', amount: 15000, seats: 15, status: 'paid', plan: 'enterprise' },
        { date: '2026-07-01', amount: 18000, seats: 18, status: 'paid', plan: 'enterprise' }
      ];

      for (const inv of mockInvoices) {
        const invoiceId = 'invoice_' + Math.random().toString(36).substring(2, 9);
        await setDoc(doc(db, 'orgInvoices', invoiceId), {
          orgId,
          date: inv.date,
          amount: inv.amount,
          seats: inv.seats,
          status: inv.status,
          plan: inv.plan
        });
      }

      toast.success("Enterprise Organization successfully bootstrapped!", { id: toastId });
      addNotification({
        title: 'Enterprise Provisioned',
        message: `Successfully provisioned ${companyName} with departmental teams, active seats, and mock billing accounts.`,
        type: 'success',
        createdAt: new Date().toISOString()
      });
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to bootstrap organization: " + err.message, { id: toastId });
    } finally {
      setIsBootstrapping(false);
    }
  };

  // Add a new departmental Team
  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !newTeamName.trim()) return;

    try {
      const teamId = 'team_' + Math.random().toString(36).substring(2, 9);
      await setDoc(doc(db, 'teams', teamId), {
        orgId: organization.id,
        name: newTeamName.trim(),
        description: newTeamDesc.trim(),
        projectIds: selectedProjectsForTeam,
        createdAt: new Date().toISOString()
      });

      toast.success(`Team "${newTeamName}" created successfully!`);
      setNewTeamName('');
      setNewTeamDesc('');
      setSelectedProjectsForTeam([]);
    } catch (err: any) {
      toast.error("Failed to create team: " + err.message);
    }
  };

  // Delete a Team
  const handleDeleteTeam = async (teamId: string, teamName: string) => {
    if (!window.confirm(`Are you sure you want to delete the team "${teamName}"?`)) return;

    try {
      await deleteDoc(doc(db, 'teams', teamId));
      toast.success(`Team "${teamName}" removed.`);
    } catch (err: any) {
      toast.error("Failed to delete team: " + err.message);
    }
  };

  // Associate project to a specific team
  const handleAssignProjectToTeam = async (projectId: string, teamId: string | 'none') => {
    try {
      // Find team containing project, remove it
      for (const t of teams) {
        if (t.projectIds.includes(projectId)) {
          const updatedProjIds = t.projectIds.filter(id => id !== projectId);
          await updateDoc(doc(db, 'teams', t.id), { projectIds: updatedProjIds });
        }
      }

      // Add to new team if specified
      if (teamId !== 'none') {
        const targetTeam = teams.find(t => t.id === teamId);
        if (targetTeam) {
          const updatedProjIds = [...targetTeam.projectIds, projectId];
          await updateDoc(doc(db, 'teams', teamId), { projectIds: updatedProjIds });
        }
      }

      toast.success("Project assignment updated successfully.");
    } catch (err: any) {
      toast.error("Failed to reassign project: " + err.message);
    }
  };

  // Invite corporate team member
  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !newMemberEmail.trim()) return;

    try {
      const memberId = 'member_' + Math.random().toString(36).substring(2, 9);
      await setDoc(doc(db, 'orgMembers', memberId), {
        orgId: organization.id,
        userId: 'user_' + Math.random().toString(36).substring(2, 9), // Simulated signup ID
        email: newMemberEmail.trim().toLowerCase(),
        name: newMemberName.trim() || newMemberEmail.split('@')[0],
        role: newMemberRole,
        teamId: newMemberTeamId || '',
        status: 'pending',
        joinedAt: new Date().toISOString()
      });

      toast.success(`Invitation sent to ${newMemberEmail}`);
      setNewMemberEmail('');
      setNewMemberName('');
      setNewMemberRole('member');
      setNewMemberTeamId('');
    } catch (err: any) {
      toast.error("Failed to invite member: " + err.message);
    }
  };

  // Update a member's team assignment
  const handleUpdateMemberTeam = async (memberId: string, teamId: string) => {
    try {
      await updateDoc(doc(db, 'orgMembers', memberId), { teamId });
      toast.success("User team assignment updated.");
    } catch (err: any) {
      toast.error("Failed to update team assignment: " + err.message);
    }
  };

  // Update a member's role
  const handleUpdateMemberRole = async (memberId: string, role: any) => {
    try {
      await updateDoc(doc(db, 'orgMembers', memberId), { role });
      toast.success("User access role updated.");
    } catch (err: any) {
      toast.error("Failed to update role: " + err.message);
    }
  };

  // Remove member from Organization
  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (!window.confirm(`Are you sure you want to remove ${memberName} from the organization?`)) return;

    try {
      await deleteDoc(doc(db, 'orgMembers', memberId));
      toast.success(`${memberName} has been removed from organization.`);
    } catch (err: any) {
      toast.error("Failed to remove member: " + err.message);
    }
  };

  // Update organization security settings
  const handleUpdateSecuritySettings = async () => {
    if (!organization) return;
    try {
      await updateDoc(doc(db, 'organizations', organization.id), {
        domain: orgDomainInput.trim(),
        'settings.enforceMfa': enforceMfa,
        'settings.sessionTimeoutMinutes': sessionTimeout
      });
      toast.success("Corporate security policies updated.");
    } catch (err: any) {
      toast.error("Failed to save security settings: " + err.message);
    }
  };

  // Manage Enterprise seats & purchase add-ons
  const handlePurchaseSeats = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization) return;

    try {
      // Find latest invoice to see seat count or append mock
      const currentInvoices = [...invoices].sort((a, b) => b.date.localeCompare(a.date));
      const latestSeatCount = currentInvoices[0]?.seats || 15;
      const newSeatTotal = latestSeatCount + additionalSeats;
      const incrementalCost = additionalSeats * 999; // ₹999 per corporate seat

      // Create a persistent invoice record in Firestore
      const invoiceId = 'invoice_' + Math.random().toString(36).substring(2, 9);
      await setDoc(doc(db, 'orgInvoices', invoiceId), {
        orgId: organization.id,
        date: new Date().toISOString().split('T')[0],
        amount: incrementalCost,
        seats: newSeatTotal,
        status: 'paid',
        plan: organization.plan
      });

      toast.success(`Purchased ${additionalSeats} additional enterprise seats! Active seats capacity is now ${newSeatTotal}.`);
      setAdditionalSeats(5);
    } catch (err: any) {
      toast.error("Failed to update seat subscription: " + err.message);
    }
  };

  // Mock Usage Metrics
  const teamUsageData = teams.map((team, idx) => {
    // Generate simulated yet realistic numbers based on projects inside the team
    const allocatedProjectsCount = team.projectIds?.length || 0;
    const minutes = allocatedProjectsCount * 120 + (idx * 45) + 30;
    const aiCost = Math.round(minutes * 0.45 * 100) / 100;
    return {
      name: team.name,
      'Minutes Transcribed': minutes,
      'Estimated Spend (₹)': aiCost * 80, // convert mock dollar rate to rupees
      projectsCount: allocatedProjectsCount
    };
  });

  const aggregateMetrics = {
    totalTeams: teams.length,
    activeProjects: projects.length,
    totalMembers: orgMembers.length,
    allocatedSeats: invoices.sort((a, b) => b.date.localeCompare(a.date))[0]?.seats || 15,
    totalMinutesTranscribed: teamUsageData.reduce((acc, curr) => acc + curr['Minutes Transcribed'], 0),
    totalAICosts: teamUsageData.reduce((acc, curr) => acc + curr['Estimated Spend (₹)'], 0)
  };

  // If loading, show elegant skeleton loader
  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-6">
        <div className="h-8 w-64 bg-slate-200 animate-pulse rounded-md"></div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-slate-100 animate-pulse rounded-2xl"></div>
          ))}
        </div>
        <div className="h-96 bg-slate-50 animate-pulse rounded-3xl"></div>
      </div>
    );
  }

  // If no Organization has been initialized, render beautiful onboarding screen
  if (!organization) {
    return (
      <div className="p-8 max-w-4xl mx-auto flex flex-col items-center justify-center text-center space-y-8 min-h-[70vh]">
        <div className="w-20 h-20 bg-brand-primary/5 rounded-3xl flex items-center justify-center shadow-lg text-brand-primary">
          <Building2 size={44} />
        </div>
        
        <div className="space-y-4">
          <h1 className="text-4xl font-extrabold tracking-tight text-brand-primary">Corporate Organization Dashboard</h1>
          <p className="text-brand-secondary/60 max-w-2xl mx-auto text-lg leading-relaxed">
            Welcome to the enterprise-grade organization manager. Design departmental departments, assign active projects, monitor exact workspace telemetry, configure corporate sign-on, and orchestrate seat-allocations in real-time.
          </p>
        </div>

        <div className="p-6 bg-amber-50/50 border border-amber-200/50 rounded-2xl max-w-xl text-left flex items-start space-x-4">
          <Info className="text-amber-600 w-5 h-5 mt-0.5 shrink-0" />
          <p className="text-amber-800 text-sm leading-relaxed">
            <strong>Direct Seeding Available:</strong> No active corporate organization was found associated with your credentials. Click the button below to instantly populate and bootstrap custom department templates, billing logs, and mock team members in Firestore.
          </p>
        </div>

        <button
          onClick={handleBootstrapOrganization}
          disabled={isBootstrapping}
          className="px-8 py-4 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-2xl font-bold uppercase tracking-wider text-xs shadow-xl hover:shadow-2xl transition-all flex items-center space-x-3 disabled:opacity-50"
        >
          {isBootstrapping ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
              <span>Initializing Organization...</span>
            </>
          ) : (
            <>
              <Sparkles size={16} />
              <span>Bootstrap Enterprise Organization</span>
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Toast Notification Container */}
      <Toaster position="bottom-right" theme="light" />

      {/* Header and Branding */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-brand-divider/10">
        <div className="space-y-1">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-brand-primary/5 rounded-xl text-brand-primary shadow-sm">
              <Building2 size={24} />
            </div>
            <h1 className="text-3xl font-black text-slate-950 tracking-tight uppercase">{organization.name}</h1>
          </div>
          <p className="text-sm text-brand-secondary/60 flex items-center space-x-2">
            <span>Corporate Account URL Domain:</span>
            <span className="font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs">{organization.domain}</span>
            <span>•</span>
            <span className="capitalize font-semibold text-brand-accent">{organization.plan} subscription</span>
          </p>
        </div>

        {/* Dashboard Navigation Tabs */}
        <div className="flex flex-wrap gap-2 bg-slate-100 p-1.5 rounded-2xl self-start md:self-center">
          {[
            { id: 'overview', label: 'Overview', icon: <BarChart3 size={14} /> },
            { id: 'teams', label: 'Teams', icon: <Layers size={14} /> },
            { id: 'projects', label: 'Projects', icon: <Briefcase size={14} /> },
            { id: 'members', label: 'Members & Roles', icon: <Users size={14} /> },
            { id: 'usage', label: 'Resource Limits', icon: <Sliders size={14} /> },
            { id: 'billing', label: 'Billing & Seats', icon: <CreditCard size={14} /> }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-brand-primary shadow-md'
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
          transition={{ duration: 0.2 }}
        >
          {/* TAB 1: OVERVIEW (BENTO GRID WITH CHARTS) */}
          {activeTab === 'overview' && (
            <div className="space-y-8">
              {/* Stat Bento Blocks */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { title: "Departmental Teams", value: aggregateMetrics.totalTeams, desc: "Configured departments", icon: <Layers className="text-indigo-600" /> },
                  { title: "Managed Projects", value: aggregateMetrics.activeProjects, desc: "Active workspace folders", icon: <Briefcase className="text-sky-600" /> },
                  { title: "Active Members", value: `${aggregateMetrics.totalMembers} / ${aggregateMetrics.allocatedSeats}`, desc: "Seats filled vs capacity", icon: <Users className="text-emerald-600" /> },
                  { title: "Total Transcription", value: `${aggregateMetrics.totalMinutesTranscribed} min`, desc: "Aggregate volume", icon: <BarChart3 className="text-amber-600" /> }
                ].map((stat, i) => (
                  <div key={i} className="bg-white border border-brand-divider/20 p-6 rounded-3xl shadow-sm space-y-4 flex flex-col justify-between hover:shadow-md transition-all">
                    <div className="flex justify-between items-start">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-400">{stat.title}</span>
                      <div className="p-2 bg-slate-50 rounded-xl">{stat.icon}</div>
                    </div>
                    <div>
                      <div className="text-3xl font-black text-slate-950 tracking-tight">{stat.value}</div>
                      <p className="text-[11px] text-slate-400 font-medium">{stat.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Chart 1: Team usage volume */}
                <div className="bg-white border border-brand-divider/20 p-6 rounded-[32px] shadow-sm space-y-4">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-slate-950">Transcription Minutes per Team</h3>
                    <p className="text-xs text-slate-400 mt-1">Real-time recording consumption segmented by corporate departments</p>
                  </div>
                  <div className="h-80 w-full">
                    {teamUsageData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={teamUsageData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" fontSize={11} stroke="#94a3b8" />
                          <YAxis fontSize={11} stroke="#94a3b8" />
                          <Tooltip cursor={{ fill: '#f8fafc' }} />
                          <Bar dataKey="Minutes Transcribed" fill="#0f172a" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-400 text-sm">No team projects found. Add projects to populate.</div>
                    )}
                  </div>
                </div>

                {/* Chart 2: Cost metrics */}
                <div className="bg-white border border-brand-divider/20 p-6 rounded-[32px] shadow-sm space-y-4">
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-slate-950">Estimated AI Cost per Department (INR)</h3>
                    <p className="text-xs text-slate-400 mt-1">Estimated monthly spending based on volume processed</p>
                  </div>
                  <div className="h-80 w-full">
                    {teamUsageData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={teamUsageData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" fontSize={11} stroke="#94a3b8" />
                          <YAxis fontSize={11} stroke="#94a3b8" />
                          <Tooltip cursor={{ fill: '#f8fafc' }} />
                          <Bar dataKey="Estimated Spend (₹)" fill="#10b981" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-400 text-sm">No team projects found. Add projects to populate.</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Corporate SSO Status Indicator */}
              <div className="bg-emerald-50/50 border border-emerald-200/50 p-6 rounded-3xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start space-x-4">
                  <ShieldCheck className="text-emerald-600 w-10 h-10 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-extrabold text-emerald-950 uppercase tracking-tight">Active SSO Authentication Enabled</h4>
                    <p className="text-xs text-emerald-800 leading-relaxed max-w-2xl">
                      Members of your organization can log in seamlessly using corporate Google Accounts and Microsoft corporate credentials. Security policy validates credentials at the Firestore level before providing workspace access.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('usage')}
                  className="px-5 py-2.5 bg-slate-950 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:brightness-110 shrink-0 self-start md:self-center"
                >
                  Configure Domain Controls
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: TEAMS MANAGEMENT */}
          {activeTab === 'teams' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Team list (2/3 columns) */}
              <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Departmental Teams</h2>
                    <p className="text-xs text-slate-400 mt-1">Configure business groups and select who gets allocated to designated tasks</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {teams.map(team => {
                    const assignedProjs = projects.filter(p => team.projectIds?.includes(p.id));
                    return (
                      <div key={team.id} className="bg-white border border-brand-divider/20 p-6 rounded-3xl shadow-sm flex flex-col justify-between hover:shadow-md transition-all space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between items-start">
                            <h3 className="font-bold text-slate-950 text-base">{team.name}</h3>
                            <button
                              onClick={() => handleDeleteTeam(team.id, team.name)}
                              className="text-slate-400 hover:text-red-500 p-1 rounded transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                          <p className="text-slate-400 text-xs leading-relaxed min-h-[40px]">{team.description || "No description provided."}</p>
                        </div>

                        <div className="border-t border-brand-divider/10 pt-4 space-y-3">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Assigned Projects ({assignedProjs.length})</span>
                          <div className="flex flex-wrap gap-1.5">
                            {assignedProjs.map(p => (
                              <span key={p.id} className="text-[10px] font-bold bg-slate-100 text-slate-700 px-2 py-1 rounded-md">
                                {p.name}
                              </span>
                            ))}
                            {assignedProjs.length === 0 && (
                              <span className="text-[10px] italic text-slate-400">No projects assigned</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Create Team Form */}
              <div className="bg-white border border-brand-divider/20 p-8 rounded-[32px] shadow-sm space-y-6 self-start">
                <div className="space-y-1 pb-4 border-b border-brand-divider/10">
                  <h3 className="font-black text-slate-950 text-sm uppercase tracking-wider">Create New Department</h3>
                  <p className="text-xs text-slate-400">Define a new corporate workgroup with specialized project files</p>
                </div>

                <form onSubmit={handleCreateTeam} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Department Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Sales Development"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-brand-divider/20 text-sm focus:outline-none focus:border-brand-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Description</label>
                    <textarea
                      placeholder="Summarize the core operational focus of this department"
                      value={newTeamDesc}
                      onChange={(e) => setNewTeamDesc(e.target.value)}
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-brand-divider/20 text-sm focus:outline-none focus:border-brand-primary resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Assign Projects</label>
                    <div className="max-h-40 overflow-y-auto border border-brand-divider/10 rounded-xl p-3 space-y-2">
                      {projects.map(proj => (
                        <label key={proj.id} className="flex items-center space-x-2 text-xs font-medium text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedProjectsForTeam.includes(proj.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedProjectsForTeam([...selectedProjectsForTeam, proj.id]);
                              } else {
                                setSelectedProjectsForTeam(selectedProjectsForTeam.filter(id => id !== proj.id));
                              }
                            }}
                            className="rounded text-brand-primary"
                          />
                          <span>{proj.name}</span>
                        </label>
                      ))}
                      {projects.length === 0 && (
                        <span className="text-xs italic text-slate-400">No project workspace active yet</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-3.5 bg-brand-primary text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all flex items-center justify-center space-x-2"
                  >
                    <Plus size={14} />
                    <span>Create Team</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 3: PROJECTS MANAGEMENT */}
          {activeTab === 'projects' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Enterprise Projects</h2>
                <p className="text-xs text-slate-400 mt-1">Associate active projects to departmental teams to synchronize files and manage visibility</p>
              </div>

              <div className="bg-white border border-brand-divider/20 rounded-[32px] overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-brand-divider/10 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        <th className="py-4 px-6">Project Name</th>
                        <th className="py-4 px-6">Workspace Owner</th>
                        <th className="py-4 px-6">Assigned Department</th>
                        <th className="py-4 px-6">Collaborators</th>
                        <th className="py-4 px-6">Date Created</th>
                        <th className="py-4 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-divider/10 text-sm">
                      {projects.map(p => {
                        // Find current assigned team
                        const assignedTeam = teams.find(t => t.projectIds?.includes(p.id));
                        return (
                          <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-4 px-6 font-bold text-brand-primary">{p.name}</td>
                            <td className="py-4 px-6 text-slate-500">{p.ownerEmail || 'System'}</td>
                            <td className="py-4 px-6">
                              <select
                                value={assignedTeam?.id || 'none'}
                                onChange={(e) => handleAssignProjectToTeam(p.id, e.target.value)}
                                className="px-3 py-1.5 rounded-lg border border-brand-divider/15 text-xs font-semibold focus:outline-none bg-white text-slate-700"
                              >
                                <option value="none">Unassigned / General</option>
                                {teams.map(t => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-4 px-6 text-xs text-slate-500">
                              {p.members?.length || 1} members
                            </td>
                            <td className="py-4 px-6 text-xs text-slate-400">
                              {new Date(p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                            </td>
                            <td className="py-4 px-6 text-right">
                              <button
                                onClick={() => handleAssignProjectToTeam(p.id, 'none')}
                                className="text-xs text-slate-400 hover:text-slate-900 transition-colors"
                              >
                                Clear Assignment
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {projects.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-8 text-center italic text-slate-400 text-sm">
                            No projects found. Add a folder workspace on Workspace Home first.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: MEMBERS & ROLES */}
          {activeTab === 'members' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Member directory table */}
              <div className="lg:col-span-2 space-y-6">
                <div>
                  <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Organization Directory</h2>
                  <p className="text-xs text-slate-400 mt-1">Manage corporate staff, define access roles, or revoke user sessions instantly</p>
                </div>

                <div className="bg-white border border-brand-divider/20 rounded-[32px] overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-brand-divider/10 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                          <th className="py-4 px-6">Name & Email</th>
                          <th className="py-4 px-6">Corporate Role</th>
                          <th className="py-4 px-6">Team / Department</th>
                          <th className="py-4 px-6">Status</th>
                          <th className="py-4 px-6">Joined Date</th>
                          <th className="py-4 px-6 text-right">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-brand-divider/10 text-sm">
                        {orgMembers.map(member => (
                          <tr key={member.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="py-4 px-6">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-950">{member.name || 'Invited Staff'}</span>
                                <span className="text-xs text-slate-400">{member.email}</span>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              {member.role === 'owner' ? (
                                <span className="px-3 py-1 bg-brand-primary text-white rounded-full text-[10px] font-black uppercase tracking-wider">
                                  Owner (Org Admin)
                                </span>
                              ) : (
                                <select
                                  value={member.role}
                                  disabled={userOrgRole !== 'super_admin' && userOrgRole !== 'org_admin'}
                                  onChange={(e) => handleUpdateMemberRole(member.id, e.target.value as any)}
                                  className="px-2.5 py-1.5 rounded-lg border border-brand-divider/20 text-xs font-semibold bg-white text-slate-700 focus:outline-none disabled:opacity-75 disabled:cursor-not-allowed"
                                >
                                  <option value="admin">Organization Admin</option>
                                  <option value="team_lead">Team Manager</option>
                                  <option value="member">Member</option>
                                  <option value="guest">Viewer</option>
                                </select>
                              )}
                            </td>
                            <td className="py-4 px-6">
                              <select
                                value={member.teamId || ''}
                                disabled={userOrgRole !== 'super_admin' && userOrgRole !== 'org_admin'}
                                onChange={(e) => handleUpdateMemberTeam(member.id, e.target.value)}
                                className="px-2.5 py-1.5 rounded-lg border border-brand-divider/20 text-xs font-semibold bg-white text-slate-700 focus:outline-none disabled:opacity-75 disabled:cursor-not-allowed"
                              >
                                <option value="">Unassigned</option>
                                {teams.map(t => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-4 px-6">
                              {member.status === 'active' ? (
                                <span className="inline-flex items-center space-x-1.5 text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-full">
                                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                                  <span>Active</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center space-x-1.5 text-xs text-amber-600 font-bold bg-amber-50 px-2.5 py-1 rounded-full">
                                  <span>Pending</span>
                                </span>
                              )}
                            </td>
                            <td className="py-4 px-6 text-xs text-slate-400">
                              {new Date(member.joinedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                            </td>
                            <td className="py-4 px-6 text-right">
                              {member.role !== 'owner' ? (
                                <button
                                  onClick={() => handleRemoveMember(member.id, member.name || member.email)}
                                  disabled={userOrgRole !== 'super_admin' && userOrgRole !== 'org_admin'}
                                  className="text-slate-400 hover:text-red-500 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <Trash2 size={15} />
                                </button>
                              ) : (
                                <span className="text-xs text-slate-300 font-semibold italic">Immune</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Invite corporate member form */}
              <div className="bg-white border border-brand-divider/20 p-8 rounded-[32px] shadow-sm space-y-6 self-start">
                <div className="space-y-1 pb-4 border-b border-brand-divider/10">
                  <h3 className="font-black text-slate-950 text-sm uppercase tracking-wider">Invite Team Member</h3>
                  <p className="text-xs text-slate-400">Add an authorized seat to your company organization</p>
                </div>

                <form onSubmit={handleInviteMember} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-3.5 text-slate-400 w-4.5 h-4.5" />
                      <input
                        type="email"
                        required
                        placeholder="e.g. employee@company.com"
                        value={newMemberEmail}
                        onChange={(e) => setNewMemberEmail(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-brand-divider/20 text-sm focus:outline-none focus:border-brand-primary"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Sarah Jenkins"
                      value={newMemberName}
                      onChange={(e) => setNewMemberName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-brand-divider/20 text-sm focus:outline-none focus:border-brand-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Access Role</label>
                    <select
                      value={newMemberRole}
                      disabled={userOrgRole !== 'super_admin' && userOrgRole !== 'org_admin'}
                      onChange={(e) => setNewMemberRole(e.target.value as any)}
                      className="w-full px-4 py-3 rounded-xl border border-brand-divider/20 text-sm bg-white text-slate-700 focus:outline-none focus:border-brand-primary disabled:opacity-75 disabled:cursor-not-allowed"
                    >
                      <option value="admin">Organization Admin</option>
                      <option value="team_lead">Team Manager</option>
                      <option value="member">Member</option>
                      <option value="guest">Viewer</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Assign Team / Department</label>
                    <select
                      value={newMemberTeamId}
                      disabled={userOrgRole !== 'super_admin' && userOrgRole !== 'org_admin'}
                      onChange={(e) => setNewMemberTeamId(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-brand-divider/20 text-sm bg-white text-slate-700 focus:outline-none focus:border-brand-primary disabled:opacity-75 disabled:cursor-not-allowed"
                    >
                      <option value="">Unassigned</option>
                      {teams.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={userOrgRole !== 'super_admin' && userOrgRole !== 'org_admin'}
                    className="w-full py-3.5 bg-brand-primary text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <UserPlus size={14} />
                    <span>Send Invite</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: RESOURCE LIMITS & POLICIES */}
          {activeTab === 'usage' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Sliders and limits panels */}
              <div className="lg:col-span-2 space-y-6">
                <div>
                  <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Department Limits & Thresholds</h2>
                  <p className="text-xs text-slate-400 mt-1">Impose quota caps on active minutes and AI thinking budgets to control expenditures</p>
                </div>

                <div className="space-y-4">
                  {teams.map((team, idx) => {
                    // Simulate usage metrics
                    const limitMinutes = 1000 - (idx * 150);
                    const usedMinutes = 450 - (idx * 80);
                    const percentage = Math.round((usedMinutes / limitMinutes) * 100);

                    return (
                      <div key={team.id} className="bg-white border border-brand-divider/20 p-6 rounded-3xl shadow-sm space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <span className="font-bold text-slate-950">{team.name}</span>
                            <span className="text-slate-400 text-xs ml-2">({team.projectIds?.length || 0} active projects)</span>
                          </div>
                          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                            {usedMinutes} / {limitMinutes} Minutes Used ({percentage}%)
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-500 ${
                              percentage > 85 ? 'bg-red-500' : percentage > 50 ? 'bg-amber-500' : 'bg-brand-primary'
                            }`}
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>

                        {/* Departmental caps sliders */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Configure Max Transcription Volume</span>
                            <input
                              type="range"
                              min="200"
                              max="3000"
                              step="100"
                              defaultValue={limitMinutes}
                              className="w-full accent-slate-950 cursor-pointer"
                              onChange={(e) => {
                                toast.success(`${team.name} transcription cap set to ${e.target.value} minutes.`);
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Configure Thinking Budget (₹)</span>
                            <input
                              type="range"
                              min="1000"
                              max="10000"
                              step="500"
                              defaultValue={Math.round(limitMinutes * 80 * 0.4)}
                              className="w-full accent-slate-950 cursor-pointer"
                              onChange={(e) => {
                                toast.success(`${team.name} AI thinking expenditure limit set to ₹${e.target.value}.`);
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Security & domain policies */}
              <div className="bg-white border border-brand-divider/20 p-8 rounded-[32px] shadow-sm space-y-6 self-start">
                <div className="space-y-1 pb-4 border-b border-brand-divider/10">
                  <h3 className="font-black text-slate-950 text-sm uppercase tracking-wider">Corporate Security Rules</h3>
                  <p className="text-xs text-slate-400">Implement company-wide access controls and verification models</p>
                </div>

                <div className="space-y-5">
                  {/* Domain locks */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                      <span>Restricted Signup Domain</span>
                      <Globe size={13} className="text-slate-400" />
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. company.com"
                      value={orgDomainInput}
                      onChange={(e) => setOrgDomainInput(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-brand-divider/20 text-sm focus:outline-none focus:border-brand-primary"
                    />
                    <p className="text-[10px] text-slate-400 leading-normal">
                      Only users registering with emails matching this domain can automatically discover or join this organization workspace.
                    </p>
                  </div>

                  {/* MFA */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl">
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-950">Enforce Multi-Factor Auth</span>
                      <p className="text-[10px] text-slate-400">Require MFA verification for admins</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enforceMfa}
                        onChange={(e) => setEnforceMfa(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-primary"></div>
                    </label>
                  </div>

                  {/* Session timeout */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                      <span>Session Expiry Timeout</span>
                      <Lock size={13} className="text-slate-400" />
                    </label>
                    <div className="flex items-center space-x-3">
                      <input
                        type="number"
                        min="15"
                        max="1440"
                        value={sessionTimeout}
                        onChange={(e) => setSessionTimeout(Number(e.target.value))}
                        className="w-24 px-3 py-2 rounded-xl border border-brand-divider/20 text-sm font-semibold focus:outline-none"
                      />
                      <span className="text-xs text-slate-500 font-medium">Minutes before auto-logout</span>
                    </div>
                  </div>

                  <button
                    onClick={handleUpdateSecuritySettings}
                    className="w-full py-3.5 bg-slate-950 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:brightness-110 transition-all"
                  >
                    Save Security Policies
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: BILLING & SEAT LICENSING */}
          {activeTab === 'billing' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Billing Info and seat manager */}
              <div className="lg:col-span-2 space-y-6">
                <div>
                  <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Corporate Subscription & Billing</h2>
                  <p className="text-xs text-slate-400 mt-1">Manage corporate plan tiers, check invoice logs, and orchestrate seat inventory</p>
                </div>

                {/* Plan detail card */}
                <div className="bg-white border border-brand-divider/20 rounded-[32px] p-8 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-8 items-center">
                  <div className="space-y-4">
                    <div className="inline-flex items-center space-x-2 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold uppercase tracking-wider">
                      <Building2 size={12} />
                      <span>{organization.plan} subscription</span>
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-2xl font-black text-slate-950 tracking-tight">₹1,499 / Seat / Mo</h3>
                      <p className="text-xs text-slate-400">All-inclusive enterprise-grade translation & strategic analysis suite</p>
                    </div>
                    <ul className="text-xs text-slate-500 space-y-2">
                      <li className="flex items-center space-x-2">
                        <Check size={12} className="text-emerald-600" />
                        <span>Dedicated isolated API computing environment</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <Check size={12} className="text-emerald-600" />
                        <span>Bulletproof Firestore rules & role restrictions</span>
                      </li>
                      <li className="flex items-center space-x-2">
                        <Check size={12} className="text-emerald-600" />
                        <span>Zero-Training corporate AI policy guarantee</span>
                      </li>
                    </ul>
                  </div>

                  <div className="bg-slate-50 p-6 rounded-3xl border border-brand-divider/5 space-y-4">
                    <div className="flex justify-between items-center text-xs text-slate-400 font-bold uppercase tracking-wider">
                      <span>Seat Allocation Usage</span>
                      <span>{aggregateMetrics.totalMembers} / {aggregateMetrics.allocatedSeats} Seats Used</span>
                    </div>

                    {/* Progress seats bar */}
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-brand-primary rounded-full transition-all"
                        style={{ width: `${(aggregateMetrics.totalMembers / aggregateMetrics.allocatedSeats) * 100}%` }}
                      ></div>
                    </div>

                    <p className="text-[10px] text-slate-400 leading-normal">
                      Each active corporate user, manager, or auditor occupies one billing seat. Additional seats can be provisioned instantly at any time below.
                    </p>
                  </div>
                </div>

                {/* Invoice log */}
                <div className="space-y-3">
                  <h3 className="font-black text-slate-950 text-sm uppercase tracking-wider">Payment Invoice Archive</h3>
                  <div className="bg-white border border-brand-divider/20 rounded-[32px] overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-brand-divider/10 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                            <th className="py-4 px-6">Invoice Period</th>
                            <th className="py-4 px-6">Subscription Tier</th>
                            <th className="py-4 px-6">Active Seats</th>
                            <th className="py-4 px-6">Amount Paid</th>
                            <th className="py-4 px-6 text-right">Receipt Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-divider/10 text-sm">
                          {invoices.sort((a, b) => b.date.localeCompare(a.date)).map(inv => (
                            <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="py-4 px-6 font-bold text-brand-primary">
                                {new Date(inv.date).toLocaleDateString([], { month: 'long', year: 'numeric' })}
                              </td>
                              <td className="py-4 px-6 text-xs font-semibold capitalize text-indigo-700">{inv.plan}</td>
                              <td className="py-4 px-6 text-slate-500">{inv.seats} licenses</td>
                              <td className="py-4 px-6 font-mono font-bold text-slate-950">
                                ₹{inv.amount?.toLocaleString()}
                              </td>
                              <td className="py-4 px-6 text-right">
                                <span className="inline-flex items-center space-x-1 text-xs text-emerald-700 font-black uppercase bg-emerald-50 px-2.5 py-1 rounded-full">
                                  <Check size={11} />
                                  <span>Paid</span>
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              {/* Purchase additional licenses */}
              <div className="bg-white border border-brand-divider/20 p-8 rounded-[32px] shadow-sm space-y-6 self-start">
                <div className="space-y-1 pb-4 border-b border-brand-divider/10">
                  <h3 className="font-black text-slate-950 text-sm uppercase tracking-wider font-mono">Expand Workspace Seats</h3>
                  <p className="text-xs text-slate-400">Instantly provision additional corporate seat licenses</p>
                </div>

                <form onSubmit={handlePurchaseSeats} className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Number of Seats</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      required
                      value={additionalSeats}
                      onChange={(e) => setAdditionalSeats(Number(e.target.value))}
                      className="w-full px-4 py-3 rounded-xl border border-brand-divider/20 text-sm font-bold text-slate-950 focus:outline-none focus:border-brand-primary"
                    />
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl space-y-2.5">
                    <div className="flex justify-between text-xs text-slate-500 font-semibold">
                      <span>Incremental Cost:</span>
                      <span>₹999 / seat</span>
                    </div>
                    <div className="flex justify-between text-xs font-bold text-slate-950 border-t border-brand-divider/10 pt-2">
                      <span>Total Invoice addition:</span>
                      <span className="font-mono text-emerald-600">₹{(additionalSeats * 999).toLocaleString()}</span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 bg-brand-primary text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:opacity-95 shadow-md flex items-center justify-center space-x-2"
                  >
                    <Plus size={14} />
                    <span>Purchase & Provision Seats</span>
                  </button>
                </form>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
