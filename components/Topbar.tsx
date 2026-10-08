import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { UsageStats, UserProfile, AuthStatus, AppWorkflow, AppNotification } from '../types';
import { formatRefreshDate } from '../lib/usageUtils';

interface TopbarProps {
  usageStats: UsageStats;
  userProfile?: UserProfile;
  authStatus: AuthStatus;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenUpgrade?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  showSearch?: boolean;
  selectedProjectName?: string | null;
  onToggleSidebar?: () => void;
  notifications?: AppNotification[];
  onMarkNotificationRead?: (id: string) => void;
  onClearNotifications?: () => void;
}

const Topbar: React.FC<TopbarProps> = ({ 
  usageStats, userProfile, authStatus, onLogout, onOpenSettings, onOpenUpgrade, searchQuery, onSearchChange, showSearch = true,
  selectedProjectName, onToggleSidebar, notifications = [], onMarkNotificationRead, onClearNotifications
}) => {
  const isFreePlan = (userProfile?.plan || usageStats.plan) === 'free';
  const [showNotifications, setShowNotifications] = useState(false);

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

  return (
    <div className="h-16 md:h-20 bg-white/80 backdrop-blur-md border-b border-brand-divider/10 flex items-center justify-between px-4 md:px-8 lg:px-12 sticky top-0 z-50">
      <div className="flex items-center space-x-4 md:space-x-6">
        <button 
          onClick={onToggleSidebar}
          className="lg:hidden p-2 -ml-2 text-brand-primary hover:bg-slate-100 rounded-lg transition-colors"
        >
          <i className="fa-solid fa-bars text-lg md:text-xl"></i>
        </button>

        <div className="flex lg:hidden items-center gap-2 md:gap-3">
          <Link to="/" className="flex items-center gap-2 md:gap-3 group cursor-pointer hover:opacity-80 transition-opacity">
            <div className="bg-brand-primary p-1 md:p-1.5 rounded-lg shadow-sm group-hover:scale-105 transition-transform">
              <img 
                src="/Logo-2.png" 
                alt="EchoNote" 
                className="h-4 w-4 md:h-5 md:w-5 object-contain" 
              />
            </div>
            <span className="font-bold text-brand-primary text-sm md:text-base tracking-tight">EchoNote</span>
          </Link>
        </div>
        {showSearch && (
          <div className="hidden md:flex items-center bg-brand-background/50 border border-brand-divider/20 rounded-xl px-4 py-2 w-48 lg:w-72 focus-within:bg-white focus-within:border-brand-primary/30 transition-all">
            <i className="fa-solid fa-magnifying-glass text-slate-300 text-xs mr-3"></i>
            <input 
              type="text" 
              placeholder="Search..." 
              className="bg-transparent border-none focus:ring-0 text-[12px] lg:text-[13px] font-medium text-brand-primary placeholder:text-slate-400 w-full"
              value={searchQuery || ''}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
            />
          </div>
        )}
        {selectedProjectName && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-blue-50/80 rounded-lg border border-blue-100 shadow-sm transition-all hover:bg-blue-100/80">
            <i className="fa-solid fa-folder text-[10px] text-brand-primary/60"></i>
            <span className="text-[11px] font-black text-brand-primary uppercase tracking-[0.1em]">{selectedProjectName}</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3 md:space-x-6">
        <div 
          onClick={onOpenUpgrade}
          className="hidden md:flex items-center space-x-2 px-4 py-2 rounded-lg shadow-sm border cursor-pointer transition-all hover:scale-105 active:scale-95 bg-[#F3F4FB] text-[#4F5B93] border-[#E8EAF3] hover:bg-brand-background"
        >
          <i className="fa-solid fa-crown text-[10px]"></i>
          <span className="text-[11px] font-black uppercase tracking-[0.15em]">
            {(() => {
              const plan = (userProfile?.plan || usageStats.plan || 'free').toLowerCase();
              if (plan === 'pro' || plan === 'team') {
                return 'Manage Plan';
              } else if (plan === 'enterprise') {
                return 'Manage Enterprise';
              } else {
                return 'Upgrade';
              }
            })()}
          </span>
        </div>

        {userProfile?.nextRefreshDate && (
          <div className="hidden md:flex flex-col text-right leading-tight pr-4 md:pr-5 border-r border-brand-divider/10 text-[10px] uppercase font-bold text-slate-400">
            <span className="text-[9px] opacity-65 font-bold">Refreshes On</span>
            <span className="text-slate-700 font-extrabold mt-0.5 tracking-wider">
              {formatRefreshDate(userProfile.nextRefreshDate)}
            </span>
          </div>
        )}

        {/* Notification Bell */}
        <div className="relative notification-container">
          <button 
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 md:p-2.5 rounded-xl text-slate-500 hover:text-brand-primary hover:bg-slate-100 transition-all duration-200 flex items-center justify-center cursor-pointer"
            title="Notifications"
            aria-label="View notifications"
          >
            <i className="fa-solid fa-bell text-base md:text-lg"></i>
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-yellow-400 text-[10px] font-black text-black h-4.5 min-w-[18px] px-1 rounded-full flex items-center justify-center shadow-sm">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="absolute right-0 top-12 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-brand-divider/20 z-[70] overflow-hidden"
              >
                <div className="flex justify-between items-center px-4 py-3 border-b border-brand-divider/10 bg-slate-50/70">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-brand-primary">
                      Notifications
                    </span>
                    {unreadCount > 0 && (
                      <span className="bg-yellow-400/30 text-yellow-800 text-[11px] font-black px-2 py-0.5 rounded-full">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  {onClearNotifications && notifications.length > 0 && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearNotifications();
                      }}
                      className="text-xs font-semibold text-brand-accent hover:underline cursor-pointer"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto custom-scrollbar">
                  {notifications.length === 0 ? (
                    <div className="text-center py-12 px-4 text-slate-400 text-sm space-y-2">
                      <i className="fa-regular fa-bell text-2xl text-slate-300"></i>
                      <p className="font-medium">No new notifications</p>
                    </div>
                  ) : (
                    notifications.slice(0, 10).map(n => (
                      <div 
                        key={n.id} 
                        onClick={() => {
                          if (onMarkNotificationRead) onMarkNotificationRead(n.id);
                          setShowNotifications(false);
                        }}
                        className={`flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors ${
                          !n.isRead ? 'bg-blue-50/30' : ''
                        }`}
                      >
                        <div className={`p-2 rounded-xl shrink-0 ${
                          n.type === 'error' ? 'bg-red-100 text-red-600' : 
                          n.type === 'success' ? 'bg-green-100 text-green-600' : 
                          'bg-blue-100 text-brand-accent'
                        }`}>
                          <i className={`fa-solid ${
                            n.type === 'audio' ? 'fa-microphone' : 
                            n.type === 'text' ? 'fa-keyboard' : 
                            n.type === 'error' ? 'fa-circle-exclamation' : 
                            n.type === 'success' ? 'fa-circle-check' : 
                            'fa-info-circle'
                          } text-xs`}></i>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">
                            {n.title}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5 leading-snug line-clamp-2">
                            {n.message}
                          </p>
                          <p className="text-[10px] text-slate-400 mt-1 font-medium">
                            {new Date(n.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        {!n.isRead && (
                          <div className="w-2 h-2 bg-brand-accent rounded-full mt-2 shrink-0"></div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center space-x-3 md:space-x-5 pl-4 md:pl-6 border-l border-brand-divider/10">
          <div className="text-right hidden lg:block leading-tight">
            <p className="text-[13px] font-medium text-slate-400 truncate max-w-[150px] mb-0.5">
              {authStatus === AuthStatus.LOGGED_IN ? (userProfile?.displayName || userProfile?.name || userProfile?.email) : 'Guest Account'}
            </p>
            <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest">
              {authStatus === AuthStatus.LOGGED_IN ? 'Authenticated' : 'Limited Access'}
            </p>
          </div>
          
          <div className="relative group">
            <div className="w-9 h-9 md:w-11 md:h-11 bg-brand-primary text-slate-900 flex items-center justify-center rounded-xl font-black text-[14px] md:text-[16px] shadow-lg shadow-brand-primary/20 cursor-pointer overflow-hidden transform hover:scale-105 transition-transform">
              {authStatus === AuthStatus.LOGGED_IN && (userProfile?.photoURL || userProfile?.avatarUrl) ? (
                <img 
                  src={userProfile.photoURL || userProfile.avatarUrl} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span>{(authStatus === AuthStatus.LOGGED_IN ? (userProfile?.displayName?.charAt(0) || userProfile?.name?.charAt(0) || userProfile?.email?.charAt(0) || 'r') : 'G').toLowerCase()}</span>
              )}
            </div>
            
            {/* Dropdown Menu */}
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-2xl border border-brand-divider/20 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[60] py-2">
              <button 
                onClick={onOpenSettings}
                className="w-full flex items-center space-x-3 px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-brand-background hover:text-brand-primary transition-colors"
              >
                <i className="fa-solid fa-user-gear w-4"></i>
                <span>Profile Settings</span>
              </button>
              <div className="h-px bg-brand-divider/20 my-2 mx-4" />
              <button 
                onClick={onLogout}
                className="w-full flex items-center space-x-3 px-4 py-2 text-[13px] font-medium text-red-500 hover:bg-red-50 transition-colors"
              >
                <i className="fa-solid fa-right-from-bracket w-4"></i>
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Topbar;
