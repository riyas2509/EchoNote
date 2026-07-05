import React, { useState } from 'react';
import { AppWorkflow, AuthStatus, UserProfile, UsageStats } from '../types';
import { getMinutesUsage, getThinkingUsage, formatRefreshDate } from '../lib/usageUtils';

interface HomeViewProps {
  setTab: (tab: AppWorkflow) => void;
  authStatus: AuthStatus;
  userProfile?: UserProfile;
  onSignInClick?: () => void;
  onAddGroup: (name: string) => void;
  usageStats?: UsageStats;
}

const HomeView: React.FC<HomeViewProps> = ({ setTab, authStatus, userProfile, onSignInClick, onAddGroup, usageStats }) => {
  const firstName = (userProfile?.displayName || userProfile?.name)?.split(' ')[0] || userProfile?.email?.split('@')[0] || 'User';
  const [isCreating, setIsCreating] = useState(false);
  const [newGroup, setNewGroup] = useState('');
  
  const minutesUsage = usageStats ? getMinutesUsage(usageStats) : null;
  const thinkingUsageRes = usageStats ? getThinkingUsage(usageStats) : null;

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (newGroup.trim()) {
      onAddGroup(newGroup.trim());
      setNewGroup('');
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-8 md:space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-700 h-full">
      <header className="space-y-4 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2 md:space-y-4 text-left">
          <div className="inline-block px-3 py-1.5 bg-slate-100 text-slate-600 rounded-md text-[11px] font-bold mb-2 md:mb-4 border border-slate-200 uppercase tracking-[0.2em]">
            Executive command center
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-brand-primary tracking-tight leading-tight">
            Welcome, {authStatus === AuthStatus.GUEST ? 'guest operator' : firstName}.
          </h1>
          <p className="text-slate-500 max-w-2xl text-lg font-medium leading-relaxed">
            The intelligence platform for high-fidelity audio assets. Transcribe, narrate, and collaborate within secure project environments.
          </p>
        </div>
        
        {authStatus === AuthStatus.LOGGED_IN && (
          <div className="shrink-0 flex items-center space-x-3">
             {isCreating ? (
                <form onSubmit={handleCreateGroup} className="flex animate-in fade-in slide-in-from-right-2 duration-300">
                  <input 
                    autoFocus
                    className="bg-white border border-brand-divider rounded-l-lg px-4 py-3 text-[16px] text-brand-primary focus:ring-1 focus:ring-brand-primary outline-none"
                    placeholder="Project Name..."
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                  />
                  <button type="submit" className="bg-brand-primary text-white px-4 rounded-r-lg"><i className="fa-solid fa-check"></i></button>
                  <button onClick={() => setIsCreating(false)} className="ml-2 text-slate-300 hover:text-slate-500"><i className="fa-solid fa-xmark"></i></button>
                </form>
             ) : (
              <button onClick={() => setIsCreating(true)} className="px-6 py-3 bg-white border border-brand-divider/30 rounded-lg text-[13px] font-semibold tracking-widest text-brand-primary shadow-sm hover:shadow-md transition-all flex items-center space-x-2">
                <i className="fa-solid fa-folder-plus text-brand-accent"></i>
                <span>Initialize group</span>
              </button>
             )}
          </div>
        )}
      </header>

      {authStatus === AuthStatus.LOGGED_IN && usageStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-500">
          <div className="bg-white border border-brand-divider/20 rounded-2xl p-6 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-slate-50 flex items-center justify-center rounded-xl text-brand-primary">
                <i className="fa-solid fa-clock opacity-40"></i>
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Minutes</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-[18px] font-bold text-brand-primary">{minutesUsage?.used} / {minutesUsage?.limit}</p>
                  {minutesUsage?.isExceeded && <span className="text-[9px] text-red-500 font-black uppercase tracking-widest">Limit reached</span>}
                </div>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Refreshes On: {formatRefreshDate(userProfile?.nextRefreshDate)}</p>
              </div>
            </div>
            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
               <div 
                 className="h-full bg-brand-primary transition-all duration-500" 
                 style={{ width: `${minutesUsage?.percentage}%` }}
               />
            </div>
          </div>

          <div className="bg-white border border-brand-divider/20 rounded-2xl p-6 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-slate-50 flex items-center justify-center rounded-xl text-brand-primary">
                <i className="fa-solid fa-brain opacity-40"></i>
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Intelligence</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-[18px] font-bold text-brand-primary">{thinkingUsageRes?.used} / {thinkingUsageRes?.limit === 'unlimited' ? '∞' : thinkingUsageRes?.limit}</p>
                  {thinkingUsageRes?.isExceeded && <span className="text-[9px] text-red-500 font-black uppercase tracking-widest">Limit reached</span>}
                </div>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Refreshes On: {formatRefreshDate(userProfile?.nextRefreshDate)}</p>
              </div>
            </div>
            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
               <div 
                 className="h-full bg-brand-primary transition-all duration-500" 
                 style={{ width: `${thinkingUsageRes?.percentage}%` }}
               />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
        <button 
          onClick={() => setTab(AppWorkflow.AUDIO_TO_TEXT)}
          className="group relative bg-white p-8 md:p-12 rounded-[32px] shadow-sm border border-slate-100 text-left hover:shadow-2xl hover:-translate-y-1 transition-all duration-500"
        >
          <div className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center mb-8 md:mb-12 group-hover:bg-brand-primary group-hover:border-brand-primary transition-all duration-300">
            <i className="fa-solid fa-microphone text-brand-primary text-2xl md:text-3xl group-hover:text-white transition-colors duration-300"></i>
          </div>
          <h2 className="text-3xl font-bold text-brand-primary mb-4 tracking-tight">Intelligence transcription</h2>
          <p className="text-slate-500 mb-8 font-medium text-lg leading-relaxed">
            Analyze complex audio files with multi-speaker detection and secure collaboration.
          </p>
        </button>

        <button 
          onClick={() => setTab(AppWorkflow.TEXT_TO_AUDIO)}
          className="group relative bg-white p-8 md:p-12 rounded-[32px] shadow-sm border border-slate-100 text-left hover:shadow-2xl hover:-translate-y-1 transition-all duration-500"
        >
          <div className="w-16 h-16 md:w-20 md:h-20 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center mb-8 md:mb-12 group-hover:bg-brand-primary group-hover:border-brand-primary transition-all duration-300">
            <i className="fa-solid fa-keyboard text-brand-primary text-2xl md:text-3xl group-hover:text-white transition-colors duration-300"></i>
          </div>
          <h2 className="text-3xl font-bold text-brand-primary mb-4 tracking-tight">Narrative synthesis</h2>
          <p className="text-slate-500 mb-8 font-medium text-lg leading-relaxed">
            Transform text documentation into high-fidelity masculine or feminine narrations with project integration.
          </p>
        </button>
      </div>

      {authStatus === AuthStatus.GUEST && (
        <div className="bg-white rounded-lg p-10 flex flex-col md:flex-row items-center justify-between gap-8 shadow-xl border border-brand-divider/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-64 h-64 bg-brand-primary/5 blur-3xl -mr-32 -mt-32 rounded-full"></div>
          <div className="space-y-1 relative z-10 text-left">
            <p className="text-brand-primary text-[20px] font-medium">Authorized account required</p>
            <p className="text-slate-500 font-medium text-[16px] max-w-md">Gain persistent archive access, collaboration permissions, and custom project grouping.</p>
          </div>
          <button 
            onClick={onSignInClick}
            className="px-10 py-5 bg-brand-primary text-white rounded-lg font-semibold text-[13px] tracking-[0.2em] hover:brightness-110 transition-all active:scale-95 shadow-xl relative z-10"
          >
            Authenticate identity
          </button>
        </div>
      )}
    </div>
  );
};

export default HomeView;