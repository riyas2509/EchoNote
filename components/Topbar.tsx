import React from 'react';
import { Link } from 'react-router-dom';
import { UsageStats, UserProfile, AuthStatus, AppWorkflow } from '../types';
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
}

const Topbar: React.FC<TopbarProps> = ({ 
  usageStats, userProfile, authStatus, onLogout, onOpenSettings, onOpenUpgrade, searchQuery, onSearchChange, showSearch = true,
  selectedProjectName, onToggleSidebar
}) => {
  const isFreePlan = (userProfile?.plan || usageStats.plan) === 'free';

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
          onClick={isFreePlan ? onOpenUpgrade : undefined}
          className={`hidden md:flex items-center space-x-2 px-4 py-2 rounded-lg shadow-sm border transition-all ${
            isFreePlan 
              ? 'bg-[#F3F4FB] text-[#4F5B93] border-[#E8EAF3] cursor-pointer hover:bg-brand-background hover:scale-105 active:scale-95' 
              : 'bg-emerald-50 text-emerald-700 border-emerald-100'
          }`}
        >
          <i className={`fa-solid ${isFreePlan ? 'fa-crown' : 'fa-check-circle'} text-[10px]`}></i>
          <span className="text-[11px] font-black uppercase tracking-[0.15em]">
            {usageStats.plan === 'guest' ? 'GUEST' : (isFreePlan ? 'Upgrade' : 'Pro')}
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
