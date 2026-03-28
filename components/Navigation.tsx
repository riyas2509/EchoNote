
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { AppWorkflow, AuthStatus, UserProfile, AppNotification, UsageStats, Project, CollaborationRole } from '../types';
import { PLAN_FEATURES } from '../config/planConfig';

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
  usageStats: UsageStats;
}

const Navigation: React.FC<NavigationProps> = ({ 
  currentTab, setTab, groups, projects, onSelectGroup, onRenameGroup, onDeleteGroup, onInviteToProject, selectedGroupFilter, authStatus, userProfile, onSignInClick, onAddGroup, onOpenSettings,
  notifications, onMarkNotificationRead, onClearNotifications, usageStats
}) => {
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [isModuleAccessCollapsed, setIsModuleAccessCollapsed] = useState(false);
  const [isProjectsCollapsed, setIsProjectsCollapsed] = useState(false);
  
  const [projectToManage, setProjectToManage] = useState<Project | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CollaborationRole>('viewer');

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
    { id: AppWorkflow.AUDIO_TO_TEXT, label: 'Transcription', icon: 'fa-microphone-lines' },
    { id: AppWorkflow.TEXT_TO_AUDIO, label: 'Speech Synthesis', icon: 'fa-keyboard' },
    { id: AppWorkflow.HISTORY, label: 'Intelligence Archive', icon: 'fa-box-archive' },
    { id: AppWorkflow.DECISION_INTELLIGENCE, label: 'Decision Intelligence', icon: 'fa-brain' },
    { id: AppWorkflow.DECISION_HISTORY, label: 'Decision History', icon: 'fa-clock-rotate-left' },
    { id: AppWorkflow.SUBSCRIPTION, label: 'Subscription & Usage', icon: 'fa-credit-card' },
  ];

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
    <nav className="hidden md:flex md:w-72 bg-brand-primary text-white/70 flex-col shrink-0 border-r border-white/10 shadow-sm z-20 h-screen">
      {/* Fixed Header */}
      <div className="p-4 pb-4 flex items-center justify-between relative">
        <Link to="/" className="flex items-center gap-3 px-4 py-4 cursor-pointer group hover:bg-white/5 rounded-xl transition-all duration-200">
          <div className="bg-white/10 p-1 rounded-xl shadow-md group-hover:scale-105 transition-transform">
            <img 
              src="/Logo-2.png" 
              alt="EchoNote"
              className="h-14 w-14 object-contain"
            />
          </div>

          <span className="text-white font-semibold text-base tracking-wide">
            EchoNote
          </span>
        </Link>
        
        {/* Notification Bell */}
        <div className="relative notification-container">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-md hover:bg-white/10 transition text-white/70 hover:text-white"
          >
            <i className="fa-solid fa-bell text-lg"></i>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-yellow-400 text-xs font-bold text-black px-1.5 rounded-full">
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
                className="absolute right-0 top-12 w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden md:left-0 md:right-auto"
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
      </div>
      
      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4 space-y-1.5">
        <div className="px-4 flex items-center justify-between mb-4">
          <p className="text-[12px] font-bold uppercase tracking-widest text-white/30">Module access</p>
          <button 
            onClick={() => setIsModuleAccessCollapsed(!isModuleAccessCollapsed)}
            className="text-white/30 hover:text-white transition-colors"
          >
            <i className={`fa-solid ${isModuleAccessCollapsed ? 'fa-plus' : 'fa-minus'} text-[10px]`}></i>
          </button>
        </div>
        
        {!isModuleAccessCollapsed && tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setTab(tab.id);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group text-base font-medium tracking-wide ${
              currentTab === tab.id && selectedGroupFilter === null
                ? 'bg-brand-secondary text-white shadow-lg shadow-black/10' 
                : 'hover:bg-brand-secondary text-white/70 hover:text-white'
            }`}
          >
            <i className={`fa-solid ${tab.icon} w-5 text-center`}></i>
            <span>{tab.label}</span>
            {tab.id === AppWorkflow.HISTORY && authStatus === AuthStatus.GUEST && (
              <i className="fa-solid fa-lock text-[10px] ml-auto opacity-40"></i>
            )}
          </button>
        ))}

        {/* Projects Section */}
        {authStatus === AuthStatus.LOGGED_IN && (
          <div className="mt-8">
            <div className="px-4 flex items-center justify-between mb-2">
              <p className="text-[12px] font-bold uppercase tracking-widest text-white/30">Projects</p>
              <div className="flex items-center space-x-3">
                <button 
                  onClick={() => onAddGroup()} 
                  className="text-brand-accent hover:scale-110 transition-transform"
                  title="New Project"
                >
                  <i className="fa-solid fa-plus text-[10px]"></i>
                </button>
                <button 
                  onClick={() => setIsProjectsCollapsed(!isProjectsCollapsed)}
                  className="text-white/30 hover:text-white transition-colors"
                >
                  <i className={`fa-solid ${isProjectsCollapsed ? 'fa-plus' : 'fa-minus'} text-[10px]`}></i>
                </button>
              </div>
            </div>
            
            {!isProjectsCollapsed && (
              <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                {[...groups].sort((a, b) => {
                  if (a === 'General') return -1;
                  if (b === 'General') return 1;
                  return a.localeCompare(b);
                }).map(group => {
                      const project = projects.find(p => p.name === group);
                      const isOwner = project?.ownerEmail === userProfile?.email;
                      const member = project?.members?.find(m => m.email === userProfile?.email);
                      const isEditor = member?.role === 'editor';
                      const isDefault = project?.isDefault || group === 'General';
                      
                      // Only owners can invite/delete in Pro. Enterprise allows editors to invite too.
                      const isCollaborationEnabled = usageStats.plan === 'pro' || usageStats.plan === 'enterprise';
                      const canInvite = isCollaborationEnabled && (isOwner || (usageStats.plan === 'enterprise' && isEditor));
                      const canDelete = isOwner && !isDefault;

                      return (
                        <div key={group} className="relative group">
                          {editingGroup === group ? (
                            <form onSubmit={handleRenameSubmit} className="px-2">
                              <input 
                                autoFocus
                                onBlur={() => setEditingGroup(null)}
                                className="w-full bg-white/10 border border-brand-accent rounded-lg px-2 py-1.5 text-[13px] text-white outline-none shadow-md"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                              />
                            </form>
                          ) : (
                            <div className="flex items-center group/item">
                              <button
                                onClick={() => onSelectGroup(group)}
                                className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 text-base font-medium tracking-wide ${
                                  selectedGroupFilter === group
                                    ? 'bg-brand-secondary text-white shadow-lg shadow-black/10'
                                    : 'hover:bg-brand-secondary text-white/70 hover:text-white'
                                }`}
                              >
                                <i className="fa-solid fa-folder text-xs w-5 text-center opacity-60"></i>
                                <span className="truncate flex-1 text-left flex items-center gap-2">
                                  {group}
                                  {isDefault && (
                                    <span className="text-[10px] bg-gray-200 text-gray-700 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                                      Default
                                    </span>
                                  )}
                                </span>
                              </button>
                              
                              {!isDefault && (
                                <div className="flex items-center pr-2 space-x-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                  {canInvite && (
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); setProjectToManage(project || null); }}
                                      className="p-1.5 text-white/40 hover:text-brand-accent transition-colors"
                                      title="Invite Members"
                                    >
                                      <i className="fa-solid fa-user-plus text-[10px]"></i>
                                    </button>
                                  )}
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); setProjectToManage(project || null); }}
                                    className="p-1.5 text-white/40 hover:text-brand-accent transition-colors"
                                    title="Collaboration Settings"
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
      <div className="mx-4 mb-4 p-4 rounded-xl bg-white/5 border border-white/10">
        <div className="flex justify-between text-xs text-gray-400">
          <span className="font-bold uppercase tracking-wider">{usageStats.plan}</span>
          <span className="text-yellow-400 font-semibold">
            {Math.round((usageStats.usedMinutes / usageStats.totalMinutes) * 100)}% used
          </span>
        </div>

        <div className="w-full h-2 bg-gray-700 rounded-full mt-2 overflow-hidden">
          <div 
            className="h-full bg-yellow-400 transition-all duration-500"
            style={{ width: `${Math.min(100, (usageStats.usedMinutes / usageStats.totalMinutes) * 100)}%` }}
          />
        </div>

        <div className="mt-2 text-xs text-gray-300">
          {usageStats.usedMinutes} / {usageStats.totalMinutes} minutes used
        </div>

        {/* Thinking Usage */}
        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
          <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-white/30">
            <span>Thinking Engine</span>
            <span className={PLAN_FEATURES[usageStats.plan].thinkingLimit !== 'unlimited' && userProfile && userProfile.thinkingUsageCount >= (PLAN_FEATURES[usageStats.plan].thinkingLimit as number) ? 'text-red-400' : 'text-purple-400'}>
              {PLAN_FEATURES[usageStats.plan].thinkingLimit === 'unlimited' 
                ? 'Unlimited' 
                : `${userProfile?.thinkingUsageCount || 0} / ${PLAN_FEATURES[usageStats.plan].thinkingLimit} used`}
            </span>
          </div>
          {PLAN_FEATURES[usageStats.plan].thinkingLimit !== 'unlimited' && (
            <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-purple-400 transition-all duration-500"
                style={{ width: `${Math.min(100, ((userProfile?.thinkingUsageCount || 0) / (PLAN_FEATURES[usageStats.plan].thinkingLimit as number)) * 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="text-xs text-gray-500 mt-2">
          Renews {usageStats.renewalDate}
        </div>

        {/* Action Buttons for high usage */}
        {usageStats.usedMinutes / usageStats.totalMinutes >= 0.8 && (
          <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-500">
            {authStatus === AuthStatus.GUEST ? (
              <button 
                onClick={onSignInClick}
                className="w-full py-2 rounded-lg text-[10px] font-bold tracking-widest bg-yellow-400 text-brand-primary hover:brightness-110 transition-all"
              >
                SIGN UP
              </button>
            ) : (
              <button 
                onClick={() => setTab(AppWorkflow.SUBSCRIPTION)}
                className="w-full py-2 rounded-lg text-[10px] font-bold tracking-widest bg-yellow-400 text-brand-primary hover:brightness-110 transition-all"
              >
                UPGRADE
              </button>
            )}
          </div>
        )}
      </div>

      {/* Fixed Footer */}
      <div className="p-6 border-t border-white/10">
        <div className="flex items-center justify-center px-2 mb-4">
          <p className="text-[8px] font-black tracking-[0.2em] text-white/20 uppercase">Enterprise v2.4</p>
        </div>
      </div>
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
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-lg w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Project Collaboration</h2>
                <p className="text-slate-500 text-[14px] font-medium">Manage access for <span className="text-brand-primary font-bold">{projectToManage.name}</span></p>
              </div>
              <button onClick={() => setProjectToManage(null)} className="text-slate-400 hover:text-slate-600">
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
                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center">
                      <p className="text-[11px] font-medium text-slate-500">Only project owners can invite new members.</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Invite new member</label>
                    <div className="flex space-x-2">
                      <input 
                        type="email"
                        placeholder="colleague@company.com"
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-primary/20"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                      <select 
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-primary/20"
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as CollaborationRole)}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button 
                        onClick={() => {
                          if (inviteEmail.trim()) {
                            onInviteToProject(projectToManage.name, inviteEmail.trim(), inviteRole);
                            setInviteEmail('');
                            // Update local state to show the new member immediately
                            setProjectToManage({
                              ...projectToManage,
                              members: [...projectToManage.members, { email: inviteEmail.trim(), role: inviteRole, status: 'not-read' }]
                            });
                          }
                        }}
                        className="bg-brand-primary text-white px-6 py-2.5 rounded-lg text-xs font-bold tracking-widest hover:opacity-90 transition-opacity"
                      >
                        INVITE
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Members List */}
              <div className="space-y-3">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Team members</label>
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-brand-primary text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                        {(projectToManage.ownerEmail?.charAt(0) || 'U').toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{projectToManage.ownerEmail}</p>
                        <p className="text-[10px] text-slate-500">Project Owner</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-brand-primary/10 text-brand-primary text-[10px] font-bold rounded uppercase tracking-widest">Owner</span>
                  </div>

                  {projectToManage.members.map((member, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-slate-200 text-slate-500 rounded-full flex items-center justify-center text-[10px] font-bold">
                          {(member.email?.charAt(0) || 'U').toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{member.email}</p>
                          <p className="text-[10px] text-slate-500">{member.status === 'read' ? 'Active' : 'Pending invite'}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <select 
                          className="bg-transparent text-[10px] font-bold text-slate-500 uppercase tracking-widest outline-none cursor-pointer"
                          value={member.role}
                          onChange={(e) => onInviteToProject(projectToManage.name, member.email, e.target.value as CollaborationRole)}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="owner">Owner</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <button 
                onClick={() => setProjectToManage(null)}
                className="w-full py-4 bg-brand-primary text-white rounded-lg font-semibold tracking-widest text-[13px] shadow-xl active:scale-95 transition-all"
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navigation;
