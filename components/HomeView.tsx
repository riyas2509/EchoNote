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
            Organizational Decision & Execution Memory
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-brand-primary tracking-tight leading-tight">
            Welcome, {authStatus === AuthStatus.GUEST ? 'guest operator' : firstName}.
          </h1>
          <p className="text-slate-500 max-w-2xl text-lg font-medium leading-relaxed">
            Remember what your organization decided — and what happened next. Turn high-stakes conversations into searchable decisions, clear ownership, and persistent memory.
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
              <div className="w-12 h-12 bg-slate-50 flex items-center justify-center rounded-xl text-brand-primary shrink-0">
                <i className="fa-solid fa-clock opacity-40"></i>
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Transcription Minutes</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-[18px] font-bold text-brand-primary">Monthly: {minutesUsage?.monthlyUsed} / {minutesUsage?.monthlyLimit}</p>
                  {minutesUsage?.isExceeded && <span className="text-[9px] text-red-500 font-black uppercase tracking-widest">Limit reached</span>}
                </div>
                <p className="text-[11px] font-bold text-brand-accent/80 uppercase tracking-widest mt-0.5">Top-Up Balance: {minutesUsage?.topupBalance} minutes</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Refreshes On: {formatRefreshDate(userProfile?.nextRefreshDate)}</p>
              </div>
            </div>
            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
               <div 
                 className="h-full bg-brand-primary transition-all duration-500" 
                 style={{ width: `${minutesUsage?.monthlyPercentage}%` }}
               />
            </div>
          </div>

          <div className="bg-white border border-brand-divider/20 rounded-2xl p-6 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-slate-50 flex items-center justify-center rounded-xl text-brand-primary shrink-0">
                <i className="fa-solid fa-brain opacity-40"></i>
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">AI Requests</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-[18px] font-bold text-brand-primary">Monthly: {thinkingUsageRes?.monthlyUsed} / {thinkingUsageRes?.monthlyLimit === 'unlimited' ? '∞' : thinkingUsageRes?.monthlyLimit} AI Requests</p>
                  {thinkingUsageRes?.isExceeded && <span className="text-[9px] text-red-500 font-black uppercase tracking-widest">Limit reached</span>}
                </div>
                <p className="text-[11px] font-bold text-brand-accent/80 uppercase tracking-widest mt-0.5">Top-Up: {thinkingUsageRes?.topupBalance} AI Requests</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Refreshes On: {formatRefreshDate(userProfile?.nextRefreshDate)}</p>
              </div>
            </div>
            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
               <div 
                 className="h-full bg-brand-primary transition-all duration-500" 
                 style={{ width: `${thinkingUsageRes?.monthlyPercentage}%` }}
               />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
        <button 
          onClick={() => setTab(AppWorkflow.AUDIO_TO_TEXT)}
          className="group relative bg-white p-8 rounded-3xl shadow-sm border border-slate-200/80 text-left hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between"
        >
          <div>
            <div className="w-14 h-14 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-emerald-600 transition-all duration-300">
              <i className="fa-solid fa-microphone text-emerald-700 text-xl group-hover:text-white transition-colors duration-300"></i>
            </div>
            <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded uppercase tracking-wider">Primary Core Flow</span>
            <h2 className="text-2xl font-bold text-slate-900 mt-2 mb-3 tracking-tight">Decision & Memory Capture</h2>
            <p className="text-slate-500 font-medium text-sm leading-relaxed">
              Capture conversations, extract decisions, identify owners, and index into organizational memory.
            </p>
          </div>
          <div className="pt-6 flex items-center text-xs font-bold text-emerald-700 group-hover:text-emerald-800">
            <span>Launch Capture & Retrieval Flow</span>
            <i className="fa-solid fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform"></i>
          </div>
        </button>

        <button 
          onClick={() => setTab(AppWorkflow.DECISION_HISTORY)}
          className="group relative bg-white p-8 rounded-3xl shadow-sm border border-slate-200/80 text-left hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between"
        >
          <div>
            <div className="w-14 h-14 bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-slate-900 transition-all duration-300">
              <i className="fa-solid fa-brain text-slate-700 text-xl group-hover:text-white transition-colors duration-300"></i>
            </div>
            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded uppercase tracking-wider">Historical Memory</span>
            <h2 className="text-2xl font-bold text-slate-900 mt-2 mb-3 tracking-tight">Decision Search & Recall</h2>
            <p className="text-slate-500 font-medium text-sm leading-relaxed">
              Query past consensus, rationale, and follow-through across your entire organizational timeline.
            </p>
          </div>
          <div className="pt-6 flex items-center text-xs font-bold text-slate-700 group-hover:text-slate-900">
            <span>Search Decision Memory</span>
            <i className="fa-solid fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform"></i>
          </div>
        </button>

        <button 
          onClick={() => setTab(AppWorkflow.TEXT_TO_AUDIO)}
          className="group relative bg-white p-8 rounded-3xl shadow-sm border border-slate-200/80 text-left hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between"
        >
          <div>
            <div className="w-14 h-14 bg-slate-100 border border-slate-200 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-slate-900 transition-all duration-300">
              <i className="fa-solid fa-keyboard text-slate-700 text-xl group-hover:text-white transition-colors duration-300"></i>
            </div>
            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded uppercase tracking-wider">Audio Briefings</span>
            <h2 className="text-2xl font-bold text-slate-900 mt-2 mb-3 tracking-tight">Narrative Synthesis</h2>
            <p className="text-slate-500 font-medium text-sm leading-relaxed">
              Transform written memos and summaries into high-fidelity voice briefings with studio presets.
            </p>
          </div>
          <div className="pt-6 flex items-center text-xs font-bold text-slate-700 group-hover:text-slate-900">
            <span>Synthesize Voice Briefing</span>
            <i className="fa-solid fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform"></i>
          </div>
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