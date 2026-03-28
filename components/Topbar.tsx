import React from 'react';
import { UsageStats, UserProfile, AuthStatus, AppWorkflow } from '../types';

interface TopbarProps {
  usageStats: UsageStats;
  userProfile?: UserProfile;
  authStatus: AuthStatus;
  onNavigateToSubscription: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  showSearch?: boolean;
  selectedProjectName?: string | null;
}

const Topbar: React.FC<TopbarProps> = ({ 
  usageStats, userProfile, authStatus, onNavigateToSubscription, onLogout, onOpenSettings, searchQuery, onSearchChange, showSearch = true,
  selectedProjectName
}) => {
  return (
    <div className="h-16 md:h-20 bg-white/80 backdrop-blur-md border-b border-brand-divider/10 flex items-center justify-between px-6 md:px-12 sticky top-0 z-50">
      <div className="flex items-center space-x-6">
        <div className="md:hidden flex items-center gap-3">
          <div className="bg-brand-primary p-1.5 rounded-lg shadow-sm">
            <img 
              src="/Logo-2.png" 
              alt="EchoNote" 
              className="h-5 w-5 object-contain" 
            />
          </div>
          <span className="font-bold text-brand-primary text-base tracking-tight">EchoNote</span>
        </div>
        {showSearch && (
          <div className="hidden md:flex items-center bg-brand-background/50 border border-brand-divider/20 rounded-xl px-4 py-2 w-72 focus-within:bg-white focus-within:border-brand-primary/30 transition-all">
            <i className="fa-solid fa-magnifying-glass text-slate-300 text-xs mr-3"></i>
            <input 
              type="text" 
              placeholder="Search intelligence..." 
              className="bg-transparent border-none focus:ring-0 text-[13px] font-medium text-brand-primary placeholder:text-slate-400 w-full"
              value={searchQuery || ''}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
            />
          </div>
        )}
        {selectedProjectName && (
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200">
            <i className="fa-solid fa-folder text-[10px] text-slate-400"></i>
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">{selectedProjectName}</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-4">
        <button 
          onClick={onNavigateToSubscription}
          className="hidden sm:flex items-center space-x-2 px-4 py-2 bg-slate-50 border border-slate-100 text-brand-primary rounded-xl hover:bg-slate-100 transition-all group"
        >
          <i className="fa-solid fa-crown text-[10px] text-brand-accent group-hover:scale-110 transition-transform"></i>
          <span className="text-[11px] font-bold uppercase tracking-widest">{usageStats.plan === 'guest' ? 'Guest' : usageStats.plan}</span>
        </button>

        <div className="flex items-center space-x-4 pl-4 border-l border-brand-divider/10">
          <div className="text-right hidden lg:block">
            <p className="text-[14px] font-medium text-brand-primary leading-none mb-1">
              {authStatus === AuthStatus.LOGGED_IN ? (userProfile?.name || userProfile?.email || 'Authenticated User') : 'Guest User'}
            </p>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none">
              {authStatus === AuthStatus.LOGGED_IN ? 'Authenticated' : 'Limited'}
            </p>
          </div>
          
          <div className="relative group">
            <div className="w-10 h-10 bg-brand-primary text-brand-accent flex items-center justify-center rounded-lg font-medium text-[13px] shadow-lg shadow-brand-primary/20 cursor-pointer">
              {authStatus === AuthStatus.LOGGED_IN ? (userProfile?.name?.charAt(0) || userProfile?.email?.charAt(0) || 'U') : 'G'}
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
              <button 
                onClick={onNavigateToSubscription}
                className="w-full flex items-center space-x-3 px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-brand-background hover:text-brand-primary transition-colors"
              >
                <i className="fa-solid fa-credit-card w-4"></i>
                <span>Billing & Usage</span>
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
