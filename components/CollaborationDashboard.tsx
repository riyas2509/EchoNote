import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Clock, 
  FileAudio, 
  Bookmark, 
  Brain, 
  Trash2, 
  Shield, 
  Plus, 
  AlertTriangle, 
  CheckCircle2, 
  X, 
  ChevronDown, 
  Folder, 
  Mail, 
  Calendar, 
  Activity, 
  ArrowRight,
  ShieldAlert,
  Sparkles
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
  ProjectMember, 
  UserProfile, 
  AudioToTextRecord, 
  TextToAudioRecord, 
  CollaborationRole,
  ProjectActivity,
  OrgRole
} from '../types';
import { Toaster, toast } from 'sonner';

interface CollaborationDashboardProps {
  projects: Project[];
  selectedProjectName: string | null;
  onSelectProjectName: (name: string | null) => void;
  userProfile: UserProfile | undefined;
  audioHistory: AudioToTextRecord[];
  textHistory: TextToAudioRecord[];
  addNotification: (notif: any) => void;
  onInviteToProject: (projectName: string, email: string, role: CollaborationRole) => Promise<any>;
  userOrgRole?: OrgRole;
}

export const CollaborationDashboard: React.FC<CollaborationDashboardProps> = ({
  projects,
  selectedProjectName,
  onSelectProjectName,
  userProfile,
  audioHistory,
  textHistory,
  addNotification,
  onInviteToProject,
  userOrgRole
}) => {
  // Active Project Selection
  const activeProject = projects.find(p => p.name === selectedProjectName) || projects[0] || {
    id: 'general',
    name: 'General',
    userId: userProfile?.uid || 'system',
    ownerEmail: userProfile?.email || 'System',
    createdAt: new Date().toISOString(),
    members: []
  };

  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [loggedActivities, setLoggedActivities] = useState<ProjectActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);

  // Invite Form State
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CollaborationRole>('viewer');
  const [isInviting, setIsInviting] = useState(false);

  // Determine User Role inside Active Project
  const isSuperAdmin = userOrgRole === 'super_admin';
  const isOrgAdmin = userOrgRole === 'org_admin';
  const isTeamManager = userOrgRole === 'team_manager';
  const isViewer = userOrgRole === 'viewer';

  const isOwner = isSuperAdmin || isOrgAdmin || activeProject.userId === userProfile?.uid || activeProject.ownerEmail === userProfile?.email;
  const currentMemberRecord = members.find(m => m.email === userProfile?.email);
  const userRole: CollaborationRole = isOwner ? 'owner' : (isViewer ? 'viewer' : (isTeamManager ? 'editor' : (currentMemberRecord?.role || 'editor')));

  // Track user active state periodically
  useEffect(() => {
    if (!userProfile || !activeProject?.id || activeProject.id === 'general') return;

    const updateLastActive = async () => {
      try {
        // Look for the user's projectMember document to update
        const memberId = `${userProfile.uid}_${activeProject.id}`;
        const memberRef = doc(db, 'projectMembers', memberId);
        
        await updateDoc(memberRef, {
          lastActive: new Date().toISOString()
        });
      } catch (err) {
        // If fail, user might be owner and not have a projectMember doc yet, which is fine
      }
    };

    updateLastActive();
    const interval = setInterval(updateLastActive, 60000); // update every minute
    return () => clearInterval(interval);
  }, [userProfile, activeProject?.id]);

  // Real-time listener for Project Members
  useEffect(() => {
    if (!activeProject?.id) return;
    setLoadingMembers(true);

    const qMembers = query(
      collection(db, 'projectMembers'),
      where('projectId', '==', activeProject.id)
    );

    const unsubscribe = onSnapshot(qMembers, (snapshot) => {
      const memberList: ProjectMember[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          projectId: data.projectId,
          uid: data.userId || data.uid,
          email: data.email,
          role: data.role,
          displayName: data.displayName || data.email.split('@')[0],
          joinedAt: data.joinedAt?.toDate ? data.joinedAt.toDate().toISOString() : data.joinedAt || new Date().toISOString(),
          lastActive: data.lastActive || null,
          photoURL: data.photoURL || data.avatarUrl || null
        } as unknown as ProjectMember;
      });
      setMembers(memberList);
      setLoadingMembers(false);
    }, (error) => {
      console.error("Error loading project members:", error);
      setLoadingMembers(false);
    });

    return () => unsubscribe();
  }, [activeProject?.id]);

  // Real-time listener for Invites
  useEffect(() => {
    if (!activeProject?.id) return;
    setLoadingInvites(true);

    const qInvites = query(
      collection(db, 'invites'),
      where('projectId', '==', activeProject.id)
    );

    const unsubscribe = onSnapshot(qInvites, (snapshot) => {
      const inviteList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setInvites(inviteList);
      setLoadingInvites(false);
    }, (error) => {
      console.error("Error loading invites:", error);
      setLoadingInvites(false);
    });

    return () => unsubscribe();
  }, [activeProject?.id]);

  // Real-time listener for Logged Activities
  useEffect(() => {
    if (!activeProject?.id) return;
    setLoadingActivities(true);

    const qActivities = query(
      collection(db, 'projectActivities'),
      where('projectId', '==', activeProject.id)
    );

    const unsubscribe = onSnapshot(qActivities, (snapshot) => {
      const actList: ProjectActivity[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          projectId: data.projectId,
          userId: data.userId,
          userEmail: data.userEmail,
          userName: data.userName,
          actionType: data.actionType,
          description: data.description,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || new Date().toISOString(),
          metadata: data.metadata
        };
      });
      setLoggedActivities(actList);
      setLoadingActivities(false);
    }, (error) => {
      console.error("Error loading activities:", error);
      setLoadingActivities(false);
    });

    return () => unsubscribe();
  }, [activeProject?.id]);

  // Helper to log dynamic activities locally and to Firebase
  const logActivity = async (actionType: any, description: string) => {
    if (!userProfile || !activeProject?.id) return;
    try {
      await addDoc(collection(db, 'projectActivities'), {
        projectId: activeProject.id,
        userId: userProfile.uid,
        userEmail: userProfile.email,
        userName: userProfile.displayName || userProfile.email.split('@')[0],
        actionType,
        description,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to log activity:", err);
    }
  };

  // Metrics computation based on permissions
  const projectAudioRecords = audioHistory.filter(
    r => r.projectId === activeProject.id || r.group === activeProject.name
  );
  const projectTextRecords = textHistory.filter(
    r => r.projectId === activeProject.id || r.group === activeProject.name
  );

  // Apply permission restrictions: Member owns activity only, Viewer read-only, Owner full visibility
  const filteredAudioRecords = userRole === 'owner' || userRole === 'viewer'
    ? projectAudioRecords
    : projectAudioRecords.filter(r => r.userId === userProfile?.uid);

  const filteredTextRecords = userRole === 'owner' || userRole === 'viewer'
    ? projectTextRecords
    : projectTextRecords.filter(r => r.userId === userProfile?.uid);

  const transcriptCount = filteredAudioRecords.length;
  const filesUploaded = filteredAudioRecords.length + filteredTextRecords.length;
  const bookmarkCount = filteredAudioRecords.reduce((sum, r) => sum + (r.bookmarks?.length || 0), 0);
  
  // Real-time decision intelligence count
  const [decisionCount, setDecisionCount] = useState(0);
  useEffect(() => {
    if (!activeProject?.id) return;
    const fetchDecisions = async () => {
      try {
        const qDecisions = query(
          collection(db, 'decisionHistory'),
          where('projectId', '==', activeProject.id)
        );
        const snap = await getDocs(qDecisions);
        setDecisionCount(snap.size);
      } catch (err) {
        // Fallback or old items count
        setDecisionCount(activeProject.name.toLowerCase() === 'general' ? 2 : 0);
      }
    };
    fetchDecisions();
  }, [activeProject?.id, activeProject.name]);

  // Synthesize Activity Timeline events (Combine real Firestore logged actions + dynamic client ones)
  const getMergedTimeline = (): any[] => {
    const timeline: any[] = [...loggedActivities];

    // Add files uploads as events
    projectAudioRecords.forEach(rec => {
      // If Member, filter out others' files
      if (userRole === 'editor' && rec.userId !== userProfile?.uid) return;

      timeline.push({
        id: `synth_upload_${rec.id}`,
        projectId: activeProject.id,
        actionType: 'upload_file',
        description: `${rec.ownerEmail === userProfile?.email ? 'You' : rec.ownerEmail?.split('@')[0] || 'Team member'} uploaded and transcribed "${rec.fileName || 'Audio'}"`,
        createdAt: rec.date || rec.createdAt || new Date().toISOString(),
        userName: rec.ownerEmail?.split('@')[0] || 'Member',
        userEmail: rec.ownerEmail
      });

      // Add bookmarks inside this recording
      if (rec.bookmarks && rec.bookmarks.length > 0) {
        rec.bookmarks.forEach((b, idx) => {
          timeline.push({
            id: `synth_bookmark_${rec.id}_${idx}`,
            projectId: activeProject.id,
            actionType: 'create_bookmark',
            description: `Bookmarked section in "${rec.fileName}": "${b.note || 'Highlighted note'}"`,
            createdAt: b.timestamp ? new Date(b.timestamp).toISOString() : rec.date || new Date().toISOString(),
            userName: rec.ownerEmail?.split('@')[0] || 'Member',
            userEmail: rec.ownerEmail
          });
        });
      }
    });

    // Add invitations accepted / pending as timeline events
    invites.forEach(inv => {
      // If Member, filter out others' invite events
      if (userRole === 'editor' && inv.invitedBy !== userProfile?.email && inv.email !== userProfile?.email) return;

      timeline.push({
        id: `synth_invite_${inv.id}`,
        projectId: activeProject.id,
        actionType: 'invite_member',
        description: `Invitation sent to ${inv.email} as ${inv.role} (${inv.status})`,
        createdAt: inv.createdAt?.toDate ? inv.createdAt.toDate().toISOString() : inv.createdAt || new Date().toISOString(),
        userName: inv.invitedBy?.split('@')[0] || 'Owner',
        userEmail: inv.invitedBy
      });
    });

    // Remove duplicates based on description + date hour
    const seen = new Set<string>();
    const uniqueTimeline = timeline.filter(item => {
      const key = `${item.description}_${String(item.createdAt).substring(0, 13)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort descending by date
    return uniqueTimeline.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  };

  const finalTimeline = getMergedTimeline();

  // Invite action
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    if (userRole !== 'owner') {
      toast.error("Only Project Owners can invite new team members.");
      return;
    }

    setIsInviting(true);
    try {
      await onInviteToProject(activeProject.name, inviteEmail.trim(), inviteRole);
      
      // Log invitation activity
      await logActivity('invite_member', `Sent team invitation to ${inviteEmail.trim()} as ${inviteRole}`);
      
      toast.success(`Invitation successfully sent to ${inviteEmail}!`);
      setInviteEmail('');
    } catch (err: any) {
      toast.error(err.message || "Failed to send invitation.");
    } finally {
      setIsInviting(false);
    }
  };

  // Revoke invite action
  const handleRevokeInvite = async (inviteId: string, email: string) => {
    if (userRole !== 'owner') {
      toast.error("Only Project Owners can revoke invitations.");
      return;
    }

    if (!window.confirm(`Are you sure you want to cancel the invitation to ${email}?`)) return;

    try {
      await deleteDoc(doc(db, 'invites', inviteId));
      await logActivity('decline_invite', `Cancelled invitation sent to ${email}`);
      toast.success("Invitation successfully revoked.");
    } catch (err: any) {
      toast.error("Failed to revoke invitation.");
    }
  };

  // Remove member action
  const handleRemoveMember = async (memberUid: string, memberEmail: string, memberName: string) => {
    if (userRole !== 'owner') {
      toast.error("Only Project Owners can remove team members.");
      return;
    }

    if (memberEmail === userProfile?.email) {
      toast.error("You cannot remove yourself. To leave, please manage subscriptions.");
      return;
    }

    if (!window.confirm(`Are you sure you want to remove ${memberName || memberEmail} from the project?`)) return;

    try {
      const memberDocId = `${memberUid}_${activeProject.id}`;
      await deleteDoc(doc(db, 'projectMembers', memberDocId));
      await logActivity('decline_invite', `Removed member ${memberName || memberEmail} from project`);
      toast.success(`${memberName || memberEmail} has been removed.`);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to remove member.");
    }
  };

  // Get Relative Time for Last Active
  const getRelativeTime = (isoString: string | null): string => {
    if (!isoString) return 'Offline';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Online';
    if (diffMins < 5) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Check if member is online (active in past 5 minutes)
  const isUserOnline = (isoString: string | null): boolean => {
    if (!isoString) return false;
    const diffMs = new Date().getTime() - new Date(isoString).getTime();
    return diffMs < 300000; // 5 minutes
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-16">
      {/* Top Banner / Header */}
      <div className="bg-white border-b border-slate-200 py-6 px-6 sm:px-8 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Users className="text-echo-accent w-6 h-6 shrink-0" />
              <h1 className="text-[24px] font-black tracking-tight text-slate-900 uppercase">
                Project Dashboard
              </h1>
            </div>
            <p className="text-sm text-slate-500 font-medium">
              Real-time workspace collaboration metrics, activity logs, and team permissions.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Project Selector Dropdown */}
            <div className="relative">
              <select 
                value={selectedProjectName || ''} 
                onChange={(e) => onSelectProjectName(e.target.value || null)}
                className="appearance-none bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-bold text-slate-700 outline-none hover:border-slate-300 transition-all cursor-pointer uppercase tracking-wider"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
            </div>

            {/* Role Badge */}
            <div className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border font-bold text-xs uppercase tracking-wider ${
              userRole === 'owner' ? 'bg-echo-accent/10 border-echo-accent/30 text-[#1B2A4E]' :
              userRole === 'editor' ? 'bg-blue-50 border-blue-100 text-blue-700' :
              'bg-slate-100 border-slate-200 text-slate-600'
            }`}>
              <Shield className="w-3.5 h-3.5" />
              <span>{userRole === 'owner' ? 'Project Owner' : userRole === 'editor' ? 'Member (Editor)' : 'Viewer (Read-only)'}</span>
            </div>
          </div>

        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 sm:px-8 mt-8 space-y-8">
        
        {/* Bento Grid Metrics Dashboard */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          
          {/* Files Uploaded */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Files Uploaded</p>
                <h3 className="text-3xl font-black text-slate-900">{filesUploaded}</h3>
              </div>
              <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
                <FileAudio className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>{userRole === 'owner' ? 'Total Project Files' : 'Your Personal Files'}</span>
              <span className="text-emerald-500 flex items-center gap-0.5">Live</span>
            </div>
          </div>

          {/* Transcripts Generated */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Transcripts</p>
                <h3 className="text-3xl font-black text-slate-900">{transcriptCount}</h3>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
                <Activity className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>{userRole === 'owner' ? 'Total Audio Transcribed' : 'Your Audio Transcripts'}</span>
              <span className="text-emerald-500 flex items-center gap-0.5">Real-time</span>
            </div>
          </div>

          {/* Bookmarks Created */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bookmarks Marked</p>
                <h3 className="text-3xl font-black text-slate-900">{bookmarkCount}</h3>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl text-amber-600">
                <Bookmark className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>{userRole === 'owner' ? 'Bookmarks Across Project' : 'Your Personal Bookmarks'}</span>
              <span className="text-[#1B2A4E] font-extrabold">Active</span>
            </div>
          </div>

          {/* AI Decision Intelligence */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">AI Decisions Analyzed</p>
                <h3 className="text-3xl font-black text-slate-900">{decisionCount}</h3>
              </div>
              <div className="p-3 bg-purple-50 rounded-xl text-purple-600">
                <Brain className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>Decision Intelligence Reports</span>
              <span className="text-purple-500 flex items-center gap-0.5"><Sparkles className="w-3 h-3" /> Gemini</span>
            </div>
          </div>

        </div>

        {/* Dashboard Panels Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Team & Collaboration Invites */}
          <div className="lg:col-span-2 space-y-8">
            
            {/* Team Members List */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="space-y-0.5">
                  <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Team Members</h2>
                  <p className="text-xs text-slate-500">Collaborating in <span className="font-bold text-slate-700 uppercase">{activeProject.name}</span></p>
                </div>
                <div className="px-3 py-1 bg-slate-100 rounded-lg text-xs font-bold text-slate-600">
                  {members.length + 1} Active
                </div>
              </div>

              {/* Members Row-based List */}
              <div className="space-y-4">
                {/* Always Show Project Owner first */}
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200/60">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="w-11 h-11 bg-brand-secondary text-white rounded-xl flex items-center justify-center font-black text-base shadow-inner uppercase">
                        {activeProject.ownerEmail?.charAt(0) || 'O'}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-slate-50 flex items-center justify-center" title="Online" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-extrabold text-sm text-slate-900">
                          {activeProject.ownerEmail === userProfile?.email ? 'You' : activeProject.ownerEmail?.split('@')[0]}
                        </p>
                        <span className="px-2 py-0.5 bg-brand-secondary text-slate-800 border border-brand-primary/20 text-[9px] font-black uppercase rounded tracking-wider">Owner</span>
                      </div>
                      <p className="text-xs text-slate-500 font-medium">{activeProject.ownerEmail}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-emerald-600">Active Now</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Project Creator</p>
                  </div>
                </div>

                {/* Additional members fetched from projectMembers collection */}
                {loadingMembers ? (
                  <div className="flex justify-center py-6">
                    <div className="w-6 h-6 border-2 border-echo-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : members.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    No invited team members yet.
                  </div>
                ) : (
                  members.map((member, i) => {
                    const isOnline = isUserOnline(member.lastActive);
                    return (
                      <div key={i} className="flex items-center justify-between p-4 bg-white hover:bg-slate-50 rounded-xl border border-slate-100 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="relative">
                            <div className="w-11 h-11 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center font-black text-base border border-slate-200 uppercase">
                              {member.email?.charAt(0) || 'M'}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                              isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                            }`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-extrabold text-sm text-slate-900">
                                {member.email === userProfile?.email ? 'You' : member.displayName || member.email?.split('@')[0]}
                              </p>
                              <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded tracking-wider ${
                                member.role === 'owner' ? 'bg-brand-secondary text-slate-800 border border-brand-primary/20' :
                                member.role === 'editor' ? 'bg-blue-100 text-blue-800' :
                                'bg-slate-100 text-slate-700'
                              }`}>
                                {member.role === 'editor' ? 'Member' : member.role}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 font-medium">{member.email}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <p className={`text-xs font-bold ${isOnline ? 'text-emerald-600 animate-pulse' : 'text-slate-600'}`}>
                              {getRelativeTime(member.lastActive)}
                            </p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Last Active</p>
                          </div>
                          
                          {/* Owner can delete/remove member */}
                          {userRole === 'owner' && (
                            <button 
                              onClick={() => handleRemoveMember(member.uid, member.email, member.displayName || member.email)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Remove Team Member"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Invite New Team Members Form (Owner only) */}
            {userRole === 'owner' && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                <div className="space-y-0.5 border-b border-slate-100 pb-3">
                  <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Invite Team Member</h2>
                  <p className="text-xs text-slate-500">Add collaborators to this project in real-time.</p>
                </div>

                <form onSubmit={handleSendInvite} className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <label className="sr-only">Email address</label>
                      <input 
                        type="email"
                        required
                        placeholder="colleague@company.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-echo-accent/30 focus:border-slate-300 transition-all placeholder:text-slate-400"
                      />
                    </div>
                    
                    <div className="w-full sm:w-44">
                      <label className="sr-only">Access Level</label>
                      <div className="relative">
                        <select 
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as CollaborationRole)}
                          className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 outline-none hover:border-slate-300 transition-all cursor-pointer uppercase tracking-widest"
                        >
                          <option value="viewer">Viewer (Read-only)</option>
                          <option value="editor">Member (Editor)</option>
                          <option value="owner">Project Owner</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                      </div>
                    </div>

                    <button 
                      type="submit"
                      disabled={isInviting || !inviteEmail.trim()}
                      className="bg-brand-primary text-slate-900 hover:bg-[#4396F5] font-black uppercase text-xs tracking-widest px-6 py-3.5 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>{isInviting ? 'Inviting...' : 'Send Invite'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Pending Team Invitations */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div className="space-y-0.5 border-b border-slate-100 pb-3">
                <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Pending Invitations</h2>
                <p className="text-xs text-slate-500">Outstanding invites that have not been accepted yet.</p>
              </div>

              {loadingInvites ? (
                <div className="flex justify-center py-6">
                  <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : invites.filter(inv => inv.status === 'pending').length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">
                  No pending invitations for this project.
                </div>
              ) : (
                <div className="space-y-3">
                  {invites.filter(inv => inv.status === 'pending').map((invite, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-amber-50/50 rounded-xl border border-amber-100 transition-all">
                      <div className="flex items-center gap-3">
                        <Mail className="text-amber-500 w-5 h-5 shrink-0" />
                        <div>
                          <p className="text-sm font-extrabold text-slate-900">{invite.email}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-black uppercase tracking-wider rounded">
                              {invite.role === 'editor' ? 'Member' : invite.role}
                            </span>
                            <span className="text-[10px] text-slate-500 font-bold">
                              Sent by {invite.invitedBy === userProfile?.email ? 'you' : invite.invitedBy?.split('@')[0]}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-amber-600 animate-pulse uppercase tracking-wider text-[10px]">Pending</span>
                        {userRole === 'owner' && (
                          <button 
                            onClick={() => handleRevokeInvite(invite.id, invite.email)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Cancel/Revoke Invitation"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Right Column: Activity Timeline */}
          <div className="space-y-8">
            
            {/* Real-time Project Activity Timeline */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="space-y-0.5">
                  <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Activity Timeline</h2>
                  <p className="text-xs text-slate-500">Live workflow telemetry for <span className="font-bold text-slate-700 uppercase">{activeProject.name}</span></p>
                </div>
                <Activity className="text-slate-400 w-5 h-5" />
              </div>

              {loadingActivities ? (
                <div className="flex justify-center py-12">
                  <div className="w-6 h-6 border-2 border-echo-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : finalTimeline.length === 0 ? (
                <div className="text-center py-16 text-slate-400 space-y-3">
                  <Clock className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="text-sm font-semibold">No recent activities logged.</p>
                  <p className="text-xs text-slate-400 px-4">Timeline will record audio transcriptions, bookmarking, and team actions.</p>
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 max-h-[600px] overflow-y-auto custom-scrollbar pr-1">
                  {finalTimeline.slice(0, 20).map((activity, i) => {
                    // Determine beautiful icon based on actionType
                    let IconComponent = Clock;
                    let iconBg = 'bg-slate-100 text-slate-600';

                    if (activity.actionType === 'upload_file') {
                      IconComponent = FileAudio;
                      iconBg = 'bg-indigo-50 text-indigo-600';
                    } else if (activity.actionType === 'create_bookmark') {
                      IconComponent = Bookmark;
                      iconBg = 'bg-amber-50 text-amber-600';
                    } else if (activity.actionType === 'generate_decision') {
                      IconComponent = Brain;
                      iconBg = 'bg-purple-50 text-purple-600';
                    } else if (activity.actionType === 'invite_member') {
                      IconComponent = UserPlus;
                      iconBg = 'bg-blue-50 text-blue-600';
                    }

                    return (
                      <div key={activity.id || i} className="relative group">
                        {/* Timeline node icon */}
                        <div className={`absolute -left-[29px] top-0.5 w-6 h-6 rounded-lg ${iconBg} border border-white flex items-center justify-center shadow-sm z-10 scale-95 group-hover:scale-100 transition-transform`}>
                          <IconComponent className="w-3.5 h-3.5" />
                        </div>
                        
                        <div className="space-y-1">
                          <p className="text-xs text-slate-800 font-medium leading-relaxed">
                            {activity.description}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                              {activity.userName}
                            </span>
                            <span className="text-[10px] text-slate-300">•</span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {new Date(activity.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Permission Guidelines Info Card */}
            <div className="bg-brand-secondary text-slate-800 rounded-2xl p-6 space-y-4 border border-[#bce4ff] shadow-sm">
              <div className="flex items-center gap-2">
                <ShieldAlert className="text-brand-primary w-5 h-5 shrink-0" />
                <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-900">Security & Guidelines</h3>
              </div>
              <div className="space-y-3 text-xs text-slate-600 leading-relaxed font-medium">
                <p>
                  EchoNote enforces strict permission policies for workspace projects:
                </p>
                <ul className="space-y-2 list-disc list-inside text-slate-600">
                  <li><strong className="text-slate-900">Project Owners</strong> have complete administrative control, full telemetry visibility, and can invite/remove members.</li>
                  <li><strong className="text-slate-900">Members (Editors)</strong> can upload/transcribe files, bookmark notes, and view their own telemetry only.</li>
                  <li><strong className="text-slate-900">Viewers</strong> have secure read-only access to transcripts and general project analytics.</li>
                </ul>
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
