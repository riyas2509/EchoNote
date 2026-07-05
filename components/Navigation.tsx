
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Crown } from 'lucide-react';
import { AppWorkflow, AuthStatus, UserProfile, AppNotification, UsageStats, Project, CollaborationRole, OrgRole } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';
import { db, collection, query, where, getDocs, onSnapshot } from '../firebase';
import { getMinutesUsage, getThinkingUsage, getNextResetDate } from '../lib/usageUtils';

interface NavigationProps {
  currentTab: AppWorkflow;
  setTab: (tab: AppWorkflow) => void;
  groups: string[];
  projects: Project[];
  onSelectGroup: (name: string) => void;
  onRenameGroup?: (old: string, next: string) => void;
  onDeleteGroup: (name: string, deleteAssets: boolean) => void;
  onInviteToProject: (projectName: string, email: string, role: CollaborationRole) => void;
  selectedGroupFilter: string | null;
  authStatus: AuthStatus;
  userProfile?: UserProfile;
  onSignInClick: () => void;
  onAddGroup: (name: string) => void;
  onOpenSettings: () => void;
  notifications: AppNotification[];
  onMarkNotificationRead: (id: string) => void;
  onClearNotifications: () => void;
  onOpenUpgrade?: () => void;
  usageStats: UsageStats;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  lastRefreshed?: Date | null;
  userOrgRole?: OrgRole;
}

const Navigation: React.FC<NavigationProps> = ({ 
  currentTab, setTab, groups, projects, onSelectGroup, onRenameGroup, onDeleteGroup, onInviteToProject, selectedGroupFilter, authStatus, userProfile, onSignInClick, onAddGroup, onOpenSettings,
  notifications, onMarkNotificationRead, onClearNotifications, onOpenUpgrade, usageStats,
  isCollapsed, setIsCollapsed, isOpen, setIsOpen, lastRefreshed, userOrgRole
}) => {
  const isGuestMode = usageStats.mode === 'guest';
  const minutesUsage = getMinutesUsage(usageStats);
  const thinkingUsageRes = getThinkingUsage(usageStats);

  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [isModuleAccessCollapsed, setIsModuleAccessCollapsed] = useState(false);
  const [isProjectsCollapsed, setIsProjectsCollapsed] = useState(false);
  
  const [projectToManage, setProjectToManage] = useState<Project | null>(null);
  const [projectMembers, setProjectMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CollaborationRole>('viewer');

  useEffect(() => {
    if (!projectToManage) {
      setProjectMembers([]);
      return;
    }

    setLoadingMembers(true);
    const q = query(
      collection(db, 'projectMembers'),
      where('projectId', '==', projectToManage.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const members = snapshot.docs.map(doc => doc.data());
      setProjectMembers(members);
      setLoadingMembers(false);
    }, (err) => {
      console.error("Error fetching members:", err);
      setLoadingMembers(false);
    });

    return () => unsubscribe();
  }, [projectToManage]);

  // Click outside to close notifications
  useEffect(() => {
    if (!showNotifications) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.notification-container')) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const tabs = [
    { id: AppWorkflow.HOME, label: 'Workspace Home', icon: 'fa-house' },
    { id: AppWorkflow.AUDIO_TO_TEXT, label: 'Transcription', icon: 'fa-microphone' },
    { id: AppWorkflow.TEXT_TO_AUDIO, label: 'Speech Synthesis', icon: 'fa-keyboard' },
    { id: AppWorkflow.HISTORY, label: 'Intelligence Archive', icon: 'fa-box-archive' },
    { id: AppWorkflow.DECISION_INTELLIGENCE, label: 'Decision Intelligence', icon: 'fa-brain' },
    { id: AppWorkflow.DECISION_HISTORY, label: 'Decision History', icon: 'fa-clock-rotate-left' },
  ];

  if (authStatus === AuthStatus.LOGGED_IN) {
    tabs.push({ id: AppWorkflow.COLLABORATION_DASHBOARD, label: 'Project Dashboard', icon: 'fa-users' });
    tabs.push({ id: AppWorkflow.ORGANIZATION_DASHBOARD, label: 'Organization', icon: 'fa-building' });
  }

  if (userProfile?.role === 'admin') {
    tabs.push({ id: AppWorkflow.ADMIN_TRACKER, label: 'Admin Cost Tracker', icon: 'fa-shield' });
  }

  const isTabLocked = (tabId: AppWorkflow) => {
    const isGuest = authStatus === AuthStatus.GUEST;
    const isFree = authStatus === AuthStatus.LOGGED_IN && userProfile?.plan === 'free';
    
    if (isGuest) {
      const restricted = [
        AppWorkflow.HISTORY,
        AppWorkflow.DECISION_HISTORY,
        AppWorkflow.DECISION_INTELLIGENCE,
        AppWorkflow.COLLABORATION_DASHBOARD,
        AppWorkflow.ORGANIZATION_DASHBOARD
      ];
      return restricted.includes(tabId);
    }
    
    if (isFree) {
      return false;
    }
    
    return false;
  };

  const startRename = (e: React.MouseEvent, group: string) => {
    e.stopPropagation();
    setEditingGroup(group);
    setRenameValue(group);
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingGroup && renameValue.trim() && renameValue !== editingGroup && onRenameGroup) {
      onRenameGroup(editingGroup, renameValue.trim());
    }
    setEditingGroup(null);
  };

  return (
    <>
      {/* Mobile Overlay Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/50 z-[55] md:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      <nav className={`
        bg-[#1B2A4E] h-full fixed top-0 left-0 z-[60]
        flex flex-col shrink-0 border-r border-white/10 shadow-lg
        transition-all duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${isCollapsed ? 'w-20' : 'w-72 lg:w-64 xl:w-72'}
        ${!isOpen ? 'hidden lg:flex' : 'flex'}
      `}>
        {/* Fixed Header */}
        <div className={`p-4 flex items-center justify-between relative ${isCollapsed ? 'flex-col gap-4' : ''}`}>
          <Link to="/" className={`flex items-center gap-3 px-2 py-2 cursor-pointer group hover:bg-white/5 rounded-xl transition-all duration-200 ${isCollapsed ? 'justify-center' : ''}`}>
            <div className="bg-white/10 p-1 rounded-xl shadow-md group-hover:scale-105 transition-transform shrink-0">
              <img 
                src="/Logo-2.png" 
                alt="EchoNote"
                className="h-8 w-8 md:h-10 md:w-10 object-contain"
              />
            </div>

            {!isCollapsed && (
              <span className="text-white font-semibold text-sm md:text-base tracking-wide truncate">
                EchoNote
              </span>
            )}
          </Link>
          
          <div className={`flex items-center gap-2 ${isCollapsed ? 'flex-col' : ''}`}>
            {/* Notification Bell */}
            <div className={`relative notification-container ${isCollapsed ? 'flex justify-center' : ''}`}>
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-md hover:bg-white/10 transition text-white/70 hover:text-white"
            >
              <i className="fa-solid fa-bell text-base md:text-lg"></i>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-yellow-400 text-[10px] font-bold text-black px-1.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {showNotifications && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className={`absolute top-12 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden ${isCollapsed ? 'left-12' : 'right-0 md:left-0 md:right-auto'}`}
                >
                  <div className="flex justify-between items-center px-4 py-3 border-b">
                    <span className="text-sm font-semibold text-gray-800">
                      Notifications
                    </span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearNotifications();
                      }}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Clear all
                    </button>
                  </div>
                  <div className="max-h-96 overflow-y-auto custom-scrollbar">
                    {notifications.length === 0 ? (
                      <div className="text-center py-10 text-gray-500 text-sm">
                        No new notifications
                      </div>
                    ) : (
                      notifications.slice(0, 8).map(n => (
                        <div 
                          key={n.id} 
                          onClick={() => {
                            onMarkNotificationRead(n.id);
                            setShowNotifications(false);
                          }}
                          className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
                        >
                          <div className={`p-2 rounded-md shrink-0 ${
                            n.type === 'error' ? 'bg-red-100 text-red-600' : 
                            n.type === 'success' ? 'bg-green-100 text-green-600' : 
                            'bg-blue-100 text-blue-600'
                          }`}>
                            <i className={`fa-solid ${
                              n.type === 'audio' ? 'fa-microphone' : 
                              n.type === 'text' ? 'fa-keyboard' : 
                              n.type === 'error' ? 'fa-circle-exclamation' : 
                              n.type === 'success' ? 'fa-circle-check' : 
                              'fa-info-circle'
                            } text-xs`}></i>
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-800">
                              {n.title}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {n.message}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              {new Date(n.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          {!n.isRead && <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 shrink-0"></div>}
                        </div>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Toggle Button (Desktop Only) */}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex w-8 h-8 rounded-lg items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all"
          >
            <i className={`fa-solid ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-left'} text-sm`}></i>
          </button>
        </div>
      </div>
        
        {/* Scrollable Body */}
        <div className={`flex-1 overflow-y-auto custom-scrollbar py-4 space-y-1.5 ${isCollapsed ? 'px-2' : 'px-4 md:px-6'}`}>
          <div className={`px-4 flex items-center justify-between mb-4 ${isCollapsed ? 'justify-center px-0' : ''}`}>
            {!isCollapsed ? (
              <>
                <p className="text-[10px] md:text-[12px] font-bold uppercase tracking-widest text-white/30">Module access</p>
                <button 
                  onClick={() => setIsModuleAccessCollapsed(!isModuleAccessCollapsed)}
                  className="text-white/30 hover:text-white transition-colors"
                >
                  <i className={`fa-solid ${isModuleAccessCollapsed ? 'fa-plus' : 'fa-minus'} text-[8px] md:text-[10px]`}></i>
                </button>
              </>
            ) : (
              <div className="h-px w-8 bg-white/10" />
            )}
          </div>
          
          {!isModuleAccessCollapsed && tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setTab(tab.id);
                if (window.innerWidth < 1024) setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group text-sm md:text-base font-medium tracking-wide ${isCollapsed ? 'justify-center' : ''} ${
                currentTab === tab.id && selectedGroupFilter === null
                  ? 'bg-brand-secondary text-white shadow-lg shadow-black/10' 
                  : 'hover:bg-brand-secondary text-white/70 hover:text-white'
              }`}
              title={isCollapsed ? tab.label : ''}
            >
              <i className={`fa-solid ${tab.icon} w-5 text-center shrink-0`}></i>
              {!isCollapsed && <span className="truncate">{tab.label}</span>}
              {!isCollapsed && isTabLocked(tab.id) && (
                <i className="fa-solid fa-lock text-[10px] ml-auto text-white/40"></i>
              )}
            </button>
          ))}

          {/* Projects Section */}
          {authStatus === AuthStatus.LOGGED_IN && (
            <div className="mt-8">
              <div className={`px-4 flex items-center justify-between mb-2 ${isCollapsed ? 'justify-center px-0' : ''}`}>
                {!isCollapsed ? (
                  <>
                    <p className="text-[10px] md:text-[12px] font-bold uppercase tracking-widest text-white/30">Projects</p>
                    <div className="flex items-center space-x-3">
                      <button 
                        onClick={() => onAddGroup('')} 
                        className="text-brand-accent hover:scale-110 transition-transform"
                        title="New Project"
                      >
                        <i className="fa-solid fa-plus text-[8px] md:text-[10px]"></i>
                      </button>
                      <button 
                        onClick={() => setIsProjectsCollapsed(!isProjectsCollapsed)}
                        className="text-white/30 hover:text-white transition-colors"
                      >
                        <i className={`fa-solid ${isProjectsCollapsed ? 'fa-plus' : 'fa-minus'} text-[8px] md:text-[10px]`}></i>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="h-px w-8 bg-white/10" />
                )}
              </div>
              
              {!isProjectsCollapsed && (
                <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                  {[...groups].sort((a, b) => {
                    if (a === 'General') return -1;
                    if (b === 'General') return 1;
                    return a.localeCompare(b);
                  }).map(group => {
                        const project = projects.find(p => p.name === group);
                        const isOwner = userOrgRole === 'super_admin' || userOrgRole === 'org_admin' || project?.ownerEmail === userProfile?.email;
                        const member = project?.members?.find(m => m.email === userProfile?.email);
                        const isEditor = userOrgRole === 'super_admin' || userOrgRole === 'org_admin' || userOrgRole === 'team_manager' || member?.role === 'editor';
                        const isDefault = project?.isDefault || group === 'General';
                        
                        // Allow collaboration for all logged-in users (Free/Pro/Enterprise)
                        const isCollaborationEnabled = usageStats.mode !== 'guest';
                        const canInvite = isCollaborationEnabled && (isOwner || isEditor) && userOrgRole !== 'viewer';
                        const canDelete = isOwner && !isDefault && userOrgRole !== 'viewer';

                        return (
                          <div key={group} className="relative group">
                            {editingGroup === group ? (
                              <form onSubmit={handleRenameSubmit} className="px-2">
                                <input 
                                  autoFocus
                                  onBlur={() => setEditingGroup(null)}
                                  className="w-full bg-white/10 border border-brand-accent rounded-lg px-2 py-1.5 text-[12px] md:text-[13px] text-white outline-none shadow-md"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                />
                              </form>
                            ) : (
                              <div className="flex items-center group/item">
                                <button
                                  onClick={() => {
                                    onSelectGroup(group);
                                    if (window.innerWidth < 1024) setIsOpen(false);
                                  }}
                                  className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-sm md:text-base font-medium tracking-wide ${isCollapsed ? 'justify-center' : ''} ${
                                    selectedGroupFilter === group
                                      ? 'bg-brand-secondary text-white shadow-lg shadow-black/10'
                                      : 'hover:bg-brand-secondary text-white/70 hover:text-white'
                                  }`}
                                  title={isCollapsed ? group : ''}
                                >
                                  <i className="fa-solid fa-folder text-[10px] md:text-xs w-5 text-center opacity-60 shrink-0"></i>
                                  {!isCollapsed && (
                                    <span className="truncate flex-1 text-left flex items-center gap-2">
                                      {group}
                                      {isDefault && (
                                        <span className={`text-[7px] md:text-[8px] px-1.5 py-0.5 rounded-sm font-black uppercase tracking-[0.1em] border transition-colors ${
                                          selectedGroupFilter === group 
                                            ? 'bg-white text-brand-secondary border-white' 
                                            : 'bg-slate-100 text-slate-500 border-slate-200'
                                        }`}>
                                          Default
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </button>
                                
                                {!isDefault && !isCollapsed && (
                                  <div className="flex items-center pr-2 space-x-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); setProjectToManage(project || null); }}
                                      className="p-1.5 text-white/40 hover:text-brand-accent transition-colors"
                                      title="Collaboration & Invites"
                                    >
                                      <i className="fa-solid fa-user-group text-[10px]"></i>
                                    </button>
                                    {canDelete && (
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(group); }}
                                        className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                                        title="Delete Project"
                                      >
                                        <i className="fa-solid fa-trash-can text-[10px]"></i>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
              )}
            </div>
          )}
        </div>

        {/* Usage Meter */}
        {!isCollapsed ? (
          <div className="mx-4 mb-4 p-5 rounded-[1.5rem] bg-white/5 border border-white/10 space-y-6">
            {isGuestMode && (
              <div className="flex items-center space-x-2 px-4 py-2 bg-black/40 border border-white/5 rounded-xl">
                <div className="w-1.5 h-1.5 bg-[#00D1FF] rounded-full shadow-[0_0_8px_rgba(0,209,255,0.6)]" />
                <span className="text-[10px] font-black text-[#00D1FF] uppercase tracking-[0.2em]">Guest Mode</span>
              </div>
            )}
            {/* Transcription Section */}
            <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                <span>Transcription</span>
                <span className="text-yellow-400">
                  {Math.round(minutesUsage.percentage)}% used
                </span>
              </div>

              <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-yellow-400 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(250,204,21,0.4)]"
                  style={{ width: `${minutesUsage.percentage}%` }}
                />
              </div>

              <div className="flex justify-between items-center">
                <div className="text-[11px] text-white/60 font-bold">
                  {minutesUsage.used} / {minutesUsage.limit} minutes used
                </div>
                {minutesUsage.isExceeded && (
                  <div className="text-[9px] text-yellow-400 font-bold animate-pulse">
                    Limit exceeded
                  </div>
                )}
              </div>
            </div>

            {/* Thinking Engine Section */}
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                <span>Thinking Engine</span>
                <span className="text-purple-400">
                  {isGuestMode ? (
                    "NOT AVAILABLE IN GUEST MODE"
                  ) : (
                    `${Math.round(thinkingUsageRes.percentage)}% used`
                  )}
                </span>
              </div>

              <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(168,85,247,0.4)]"
                  style={{ width: `${thinkingUsageRes.percentage}%` }}
                />
              </div>

              <div className="flex justify-between items-center">
                <div className="text-[11px] text-white/60 font-bold">
                  {!isGuestMode && (
                    `${thinkingUsageRes.used} / ${thinkingUsageRes.limit === 'unlimited' ? '∞' : thinkingUsageRes.limit} used`
                  )}
                </div>
                {!isGuestMode && thinkingUsageRes.isExceeded && (
                  <div className="text-[9px] text-purple-400 font-bold animate-pulse">
                    Limit exceeded
                  </div>
                )}
              </div>
            </div>

            {/* Upgrade Warning & Reset Date */}
            <div className="pt-2 space-y-3">
              {userProfile?.plan !== 'pro' && (
                <button 
                  onClick={onOpenUpgrade}
                  className="w-full p-2.5 rounded-lg bg-echo-accent/10 border border-echo-accent/20 text-center hover:bg-echo-accent transition-all group"
                >
                  <p className="text-[10px] text-brand-primary font-black uppercase tracking-widest flex items-center justify-center gap-2">
                    <Crown size={12} className="text-brand-primary" />
                    <span>Upgrade</span>
                  </p>
                </button>
              )}
              
              <div className="text-[10px] text-white/30 font-bold uppercase tracking-widest text-center">
                Refreshes on: {getNextResetDate(userProfile?.billingStartDate)}
              </div>

              {lastRefreshed && (
                <div className="pt-3 border-t border-white/5 mt-3 text-center text-[10px] text-white/30 font-bold uppercase tracking-widest leading-[1.4]">
                  <div className="opacity-50 text-[9px]">Last refreshed:</div>
                  <div className="text-white/60 font-extrabold mt-0.5">
                    {lastRefreshed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                  <div className="text-white/40 font-medium normal-case">
                    {lastRefreshed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-4 mb-4 flex justify-center">
            <div className="w-10 h-10 rounded-full bg-white/10 text-white/40 flex items-center justify-center shadow-lg">
              <i className="fa-solid fa-chart-pie text-sm"></i>
            </div>
          </div>
        )}


        {/* Project Deletion Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-md w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <i className="fa-solid fa-triangle-exclamation text-red-500 text-3xl"></i>
              </div>
              <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Delete Project</h2>
              <p className="text-slate-500 text-[16px] font-medium">How would you like to handle the assets within <span className="text-brand-primary font-bold">{showDeleteConfirm}</span>?</p>
            </div>
            
            <div className="space-y-3">
              <button 
                onClick={() => { onDeleteGroup(showDeleteConfirm, false); setShowDeleteConfirm(null); }}
                className="w-full flex items-center justify-between p-4 rounded-lg border-2 border-brand-divider/20 hover:border-brand-primary hover:bg-brand-primary/5 transition-all group"
              >
                <div className="text-left">
                  <p className="font-bold text-slate-900 text-sm">Delete project only</p>
                  <p className="text-xs text-slate-500">Assets will be moved to <span className="font-bold">General</span></p>
                </div>
                <i className="fa-solid fa-arrow-right-to-bracket text-slate-300 group-hover:text-brand-primary"></i>
              </button>
              
              <button 
                onClick={() => { onDeleteGroup(showDeleteConfirm, true); setShowDeleteConfirm(null); }}
                className="w-full flex items-center justify-between p-4 rounded-lg border-2 border-red-100 hover:border-red-500 hover:bg-red-50 transition-all group"
              >
                <div className="text-left">
                  <p className="font-bold text-red-600 text-sm">Delete project and assets</p>
                  <p className="text-xs text-red-400">All transcripts will be moved to trash</p>
                </div>
                <i className="fa-solid fa-trash-can text-red-200 group-hover:text-red-500"></i>
              </button>
            </div>
            
            <button 
              onClick={() => setShowDeleteConfirm(null)}
              className="w-full py-4 text-slate-400 font-semibold tracking-widest text-[11px] hover:text-slate-600 transition-colors"
            >
              CANCEL DELETION
            </button>
          </div>
        </div>
      )}

      {/* Collaboration Settings Modal */}
      {projectToManage && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6 sm:p-0">
          <div className="bg-white rounded-2xl p-7 max-w-[320px] w-full space-y-7 shadow-2xl animate-in zoom-in-95 border border-brand-divider/20">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h2 className="text-[22px] font-black text-brand-primary tracking-tight leading-tight uppercase">Project <br/>Collaboration</h2>
                <p className="text-slate-500 text-[12px] font-bold leading-tight">
                  Manage access for <span className="text-brand-primary font-black uppercase">{projectToManage.name}</span>
                </p>
              </div>
              <button 
                onClick={() => setProjectToManage(null)} 
                className="text-slate-400 hover:text-brand-primary transition-colors p-1"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <div className="space-y-6">
              {/* Invite Section */}
              {(() => {
                const isOwner = projectToManage.ownerEmail === userProfile?.email;
                const member = projectToManage.members?.find(m => m.email === userProfile?.email);
                const isEditor = member?.role === 'editor';
                const canInvite = isOwner || (usageStats.plan === 'enterprise' && isEditor);

                if (!canInvite) {
                  return (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Read-only project view</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Invite new member</label>
                    <div className="space-y-2">
                      <input 
                        type="email"
                        placeholder="colleague@company.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[13px] font-medium outline-none focus:ring-2 focus:ring-brand-primary/30 transition-all placeholder:text-slate-400"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <select 
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[12px] font-black text-brand-primary outline-none focus:ring-2 focus:ring-brand-primary/30 transition-all appearance-none cursor-pointer uppercase tracking-widest"
                            value={inviteRole}
                            onChange={(e) => setInviteRole(e.target.value as CollaborationRole)}
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                            <option value="owner">Owner</option>
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-primary opacity-50">
                            <i className="fa-solid fa-chevron-down text-[10px]"></i>
                          </div>
                        </div>
                        <button 
                          disabled={isInviting || !inviteEmail.trim()}
                          onClick={async () => {
                            if (inviteEmail.trim()) {
                              setIsInviting(true);
                              try {
                                await onInviteToProject(projectToManage.name, inviteEmail.trim(), inviteRole);
                                setInviteEmail('');
                              } finally {
                                setIsInviting(false);
                              }
                            }
                          }}
                          className="bg-brand-primary text-white px-5 py-3 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] hover:shadow-lg active:scale-95 transition-all shadow-md shadow-brand-primary/20 disabled:opacity-50"
                        >
                          {isInviting ? '...' : 'INVITE'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Members List */}
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Team members</label>
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 bg-brand-primary text-white rounded-xl flex items-center justify-center text-[12px] font-black shadow-lg shadow-brand-primary/20 overflow-hidden">
                        {projectToManage.ownerEmail === userProfile?.email && (userProfile?.photoURL || userProfile?.avatarUrl) ? (
                          <img 
                            src={userProfile.photoURL || userProfile.avatarUrl} 
                            alt="Owner" 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span>{(projectToManage.ownerEmail?.charAt(0) || 'U').toUpperCase()}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-black text-brand-primary leading-tight truncate">{projectToManage.ownerEmail === userProfile?.email ? 'You' : (projectToManage as any).ownerName || projectToManage.ownerEmail?.split('@')[0]}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Project Owner</p>
                      </div>
                    </div>
                  </div>

                  {loadingMembers ? (
                    <div className="flex justify-center py-4">
                      <div className="w-5 h-5 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : projectMembers.map((member, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 bg-slate-100 text-slate-400 rounded-xl flex items-center justify-center text-[11px] font-black border border-slate-200 uppercase overflow-hidden">
                          {member.photoURL || member.avatarUrl ? (
                            <img 
                              src={member.photoURL || member.avatarUrl} 
                              alt="Member" 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span>{(member.displayName?.charAt(0) || member.email?.charAt(0) || 'U').toUpperCase()}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-black text-brand-primary leading-tight truncate">{member.email === userProfile?.email ? 'You' : (member as any).displayName || member.email?.split('@')[0]}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{member.role}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button 
                onClick={() => setProjectToManage(null)}
                className="w-full py-4.5 bg-brand-primary text-white rounded-xl font-black tracking-[0.2em] text-[12px] shadow-2xl shadow-brand-primary/30 active:scale-[0.98] transition-all uppercase"
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
    </>
  );
};

export default Navigation;
