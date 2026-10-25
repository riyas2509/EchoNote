import React, { useState } from 'react';
import { 
  FileAudio, 
  CheckCircle2, 
  HelpCircle, 
  BarChart3, 
  Sparkles, 
  Info,
  CheckCheck,
  CheckSquare,
  Clock,
  Brain
} from 'lucide-react';
import { formatRelativeTime } from './ProjectCard';

export interface SummaryStatsWidgetProps {
  projectName: string;
  projectId?: string;
  activeRecordingsCount: number;
  completedDecisionsCount: number;
  readyRecordingsCount?: number;
  inProgressRecordingsCount?: number;
  totalRecordingsCount?: number;
  trashedRecordingsCount?: number;
  decisionsFromRecordings?: number;
  decisionsFromIntelligence?: number;
  isLiveSyncing?: boolean;
  tasksCount?: {
    completed: number;
    total: number;
  };
  recentActivities?: Array<{
    id: string;
    type: 'Upload' | 'Decision' | 'Task' | 'Activity';
    title: string;
    description: string;
    timestamp: string;
    userName?: string;
  }>;
}

export const SummaryStatsWidget: React.FC<SummaryStatsWidgetProps> = ({
  projectName,
  activeRecordingsCount,
  completedDecisionsCount,
  readyRecordingsCount = 0,
  inProgressRecordingsCount = 0,
  totalRecordingsCount = 0,
  trashedRecordingsCount = 0,
  decisionsFromRecordings = 0,
  decisionsFromIntelligence = 0,
  isLiveSyncing = true,
  tasksCount,
  recentActivities = []
}) => {
  const [activeRecordingTooltipOpen, setActiveRecordingTooltipOpen] = useState(false);
  const [completedDecisionTooltipOpen, setCompletedDecisionTooltipOpen] = useState(false);
  const [tasksTooltipOpen, setTasksTooltipOpen] = useState(false);

  const completedTasks = tasksCount?.completed ?? 0;
  const totalTasks = tasksCount?.total ?? 0;
  const taskProgressPercentage = totalTasks > 0 ? Math.min(100, Math.round((completedTasks / totalTasks) * 100)) : 0;

  return (
    <div 
      id="summary-stats-widget-container" 
      className="bg-brand-secondary rounded-2xl border border-brand-primary/30 shadow-sm p-6 space-y-5 transition-all duration-200"
    >
      {/* Header bar of the styled card */}
      <div 
        id="summary-stats-widget-header"
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-brand-primary/20 pb-4"
      >
        <div className="flex items-center gap-3">
          <div 
            id="summary-stats-brand-badge"
            className="p-2.5 bg-brand-primary text-[#0F172A] rounded-xl shadow-sm flex items-center justify-center font-bold"
          >
            <BarChart3 className="w-5 h-5 text-[#0F172A]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900 tracking-tight uppercase">
                Project Summary Stats
              </h2>
              <span 
                id="summary-stats-project-name"
                className="px-2.5 py-0.5 rounded-lg text-xs font-black uppercase tracking-wider bg-white/80 text-slate-800 border border-brand-primary/30 shadow-xs"
              >
                {projectName}
              </span>
            </div>
            <p className="text-xs text-slate-600 font-medium mt-0.5">
              Live operational metrics & key decision deliverables for this project
            </p>
          </div>
        </div>

        {isLiveSyncing && (
          <div 
            id="summary-stats-sync-badge"
            className="flex items-center gap-2 px-3 py-1.5 bg-white/70 border border-brand-primary/20 rounded-xl text-xs font-bold text-slate-700 self-start sm:self-auto shadow-xs"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11px] uppercase tracking-wider">Live Sync</span>
          </div>
        )}
      </div>

      {/* Grid of Summary Stats */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${tasksCount !== undefined ? 'lg:grid-cols-3' : ''} gap-4 sm:gap-6`}>
        
        {/* Active Recordings Card */}
        <div 
          id="stat-card-active-recordings"
          className="relative bg-white/90 backdrop-blur-xs rounded-xl p-5 border border-brand-primary/25 shadow-sm flex flex-col justify-between hover:bg-white transition-all duration-200"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                  Active Recordings
                </span>

                {/* Hover Tooltip Anchor */}
                <div 
                  className="relative inline-flex items-center"
                  onMouseEnter={() => setActiveRecordingTooltipOpen(true)}
                  onMouseLeave={() => setActiveRecordingTooltipOpen(false)}
                  onFocus={() => setActiveRecordingTooltipOpen(true)}
                  onBlur={() => setActiveRecordingTooltipOpen(false)}
                >
                  <button 
                    type="button"
                    id="tooltip-trigger-active-recordings"
                    aria-label="Explanation of Active Recordings calculation"
                    className="p-1 text-slate-400 hover:text-slate-800 focus:text-slate-900 rounded-md transition-colors cursor-help outline-none"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>

                  {/* Tooltip Content Popover */}
                  {activeRecordingTooltipOpen && (
                    <div 
                      id="tooltip-content-active-recordings"
                      role="tooltip"
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-slate-900 text-white text-xs rounded-xl p-3.5 shadow-2xl border border-slate-700 z-50 pointer-events-none transform transition-all duration-150 animate-in fade-in zoom-in-95"
                    >
                      <div className="flex items-center gap-1.5 font-bold text-brand-primary mb-1">
                        <Info className="w-3.5 h-3.5 text-brand-primary" />
                        <span>How Active Recordings Are Calculated</span>
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        Calculated from all audio recordings and active transcription entries assigned to <strong>{projectName}</strong> that are not moved to trash (<code className="bg-slate-800 px-1 py-0.5 rounded text-[10px] text-brand-secondary">!deletedAt</code>).
                      </p>
                      <div className="mt-2.5 pt-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>Ready: {readyRecordingsCount}</span>
                        <span>Processing: {inProgressRecordingsCount}</span>
                        {trashedRecordingsCount > 0 && <span>Trashed: {trashedRecordingsCount}</span>}
                      </div>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-900" />
                    </div>
                  )}
                </div>

                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase tracking-wider rounded">
                  Active
                </span>
              </div>

              <div className="flex items-baseline gap-2 pt-1">
                <h3 id="stat-active-recordings-number" className="text-3xl font-black text-slate-950 tracking-tight">
                  {activeRecordingsCount}
                </h3>
                <span className="text-xs font-bold text-slate-500">
                  {activeRecordingsCount === 1 ? 'file available' : 'files available'}
                </span>
              </div>
            </div>

            {/* Icon highlight using brand-primary (Azure Blue) */}
            <div 
              id="stat-icon-active-recordings"
              className="p-3 bg-brand-primary text-[#0F172A] rounded-xl shadow-md shadow-brand-primary/25 shrink-0 flex items-center justify-center font-bold"
            >
              <FileAudio className="w-6 h-6 text-[#0F172A]" />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 font-medium">
            <span>
              {activeRecordingsCount === 0 
                ? "No active project recordings" 
                : `${readyRecordingsCount} ready for collaboration`}
            </span>
            {inProgressRecordingsCount > 0 ? (
              <span className="text-amber-700 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                {inProgressRecordingsCount} processing
              </span>
            ) : activeRecordingsCount > 0 ? (
              <span className="text-emerald-700 font-bold flex items-center gap-0.5">
                <CheckCheck className="w-3.5 h-3.5 text-emerald-600" /> Synced
              </span>
            ) : null}
          </div>
        </div>

        {/* Completed Decisions Card */}
        <div 
          id="stat-card-completed-decisions"
          data-tour="meeting-decision-panel"
          data-tour-decision="decision-card-v1"
          className="relative bg-white/90 backdrop-blur-xs rounded-xl p-5 border border-brand-primary/25 shadow-sm flex flex-col justify-between hover:bg-white transition-all duration-200"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span 
                  data-tour="decision-intelligence-badge"
                  className="text-xs font-extrabold uppercase tracking-wider text-slate-600"
                >
                  Completed Decisions
                </span>

                {/* Hover Tooltip Anchor */}
                <div 
                  className="relative inline-flex items-center"
                  onMouseEnter={() => setCompletedDecisionTooltipOpen(true)}
                  onMouseLeave={() => setCompletedDecisionTooltipOpen(false)}
                  onFocus={() => setCompletedDecisionTooltipOpen(true)}
                  onBlur={() => setCompletedDecisionTooltipOpen(false)}
                >
                  <button 
                    type="button"
                    id="tooltip-trigger-completed-decisions"
                    aria-label="Explanation of Completed Decisions calculation"
                    className="p-1 text-slate-400 hover:text-slate-800 focus:text-slate-900 rounded-md transition-colors cursor-help outline-none"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>

                  {/* Tooltip Content Popover */}
                  {completedDecisionTooltipOpen && (
                    <div 
                      id="tooltip-content-completed-decisions"
                      role="tooltip"
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-slate-900 text-white text-xs rounded-xl p-3.5 shadow-2xl border border-slate-700 z-50 pointer-events-none transform transition-all duration-150 animate-in fade-in zoom-in-95"
                    >
                      <div className="flex items-center gap-1.5 font-bold text-brand-primary mb-1">
                        <Info className="w-3.5 h-3.5 text-brand-primary" />
                        <span>How Completed Decisions Are Calculated</span>
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        Sum of finalized action points and meeting agreements extracted from session transcripts (Call Summaries & Unified Intelligence) plus verified AI Decision Intelligence reports saved for <strong>{projectName}</strong>.
                      </p>
                      <div className="mt-2.5 pt-2 border-t border-slate-800 flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>From Transcripts: {decisionsFromRecordings}</span>
                        <span>From AI Engine: {decisionsFromIntelligence}</span>
                      </div>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-900" />
                    </div>
                  )}
                </div>

                <span className="px-2 py-0.5 bg-purple-100 text-purple-800 text-[9px] font-black uppercase tracking-wider rounded">
                  Concluded
                </span>
              </div>

              <div className="flex items-baseline gap-2 pt-1">
                <h3 id="stat-completed-decisions-number" className="text-3xl font-black text-slate-950 tracking-tight">
                  {completedDecisionsCount}
                </h3>
                <span className="text-xs font-bold text-slate-500">
                  {completedDecisionsCount === 1 ? 'decision documented' : 'decisions documented'}
                </span>
              </div>
            </div>

            {/* Icon highlight using brand-primary (Azure Blue) */}
            <div 
              id="stat-icon-completed-decisions"
              className="p-3 bg-brand-primary text-[#0F172A] rounded-xl shadow-md shadow-brand-primary/25 shrink-0 flex items-center justify-center font-bold"
            >
              <CheckCircle2 className="w-6 h-6 text-[#0F172A]" />
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 font-medium">
            <span>
              {decisionsFromRecordings > 0 
                ? `${decisionsFromRecordings} from transcripts • ${decisionsFromIntelligence} from AI`
                : `${completedDecisionsCount} documented decisions`}
            </span>
            <span className="text-purple-700 font-bold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              Verified
            </span>
          </div>
        </div>

        {/* Tasks Completion Card (Visual Indicator: Completed vs Total Tasks) */}
        {tasksCount !== undefined && (
          <div 
            id="stat-card-completed-tasks"
            className="relative bg-white/90 backdrop-blur-xs rounded-xl p-5 border border-brand-primary/25 shadow-sm flex flex-col justify-between hover:bg-white transition-all duration-200"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 w-full">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
                    Tasks Progress
                  </span>

                  {/* Tooltip */}
                  <div 
                    className="relative inline-flex items-center"
                    onMouseEnter={() => setTasksTooltipOpen(true)}
                    onMouseLeave={() => setTasksTooltipOpen(false)}
                    onFocus={() => setTasksTooltipOpen(true)}
                    onBlur={() => setTasksTooltipOpen(false)}
                  >
                    <button 
                      type="button"
                      id="tooltip-trigger-tasks-progress"
                      aria-label="Tasks Progress overview"
                      className="p-1 text-slate-400 hover:text-slate-800 rounded-md transition-colors cursor-help outline-none"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>

                    {tasksTooltipOpen && (
                      <div 
                        role="tooltip"
                        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-slate-900 text-white text-xs rounded-xl p-3 shadow-2xl border border-slate-700 z-50 pointer-events-none transform transition-all duration-150 animate-in fade-in"
                      >
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          Visual indicator of completed tasks vs total tasks assigned to team members within <strong>{projectName}</strong>.
                        </p>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-900" />
                      </div>
                    )}
                  </div>

                  <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded ${
                    totalTasks > 0 && completedTasks === totalTasks 
                      ? 'bg-emerald-100 text-emerald-800' 
                      : 'bg-indigo-100 text-indigo-800'
                  }`}>
                    {totalTasks > 0 && completedTasks === totalTasks ? 'Completed' : 'In Flight'}
                  </span>
                </div>

                {/* Completed Tasks versus Total Tasks Numbers */}
                <div className="flex items-baseline gap-2 pt-1 font-mono">
                  <h3 id="stat-completed-tasks-number" className="text-3xl font-black text-slate-950 tracking-tight">
                    {completedTasks}
                  </h3>
                  <span className="text-lg font-bold text-slate-400">/</span>
                  <span id="stat-total-tasks-number" className="text-xl font-bold text-slate-600">
                    {totalTasks}
                  </span>
                  <span className="text-xs font-sans text-slate-500 font-bold ml-1">
                    tasks done
                  </span>
                </div>

                {/* Progress Bar Indicator */}
                <div className="mt-3 space-y-1">
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200/60">
                    <div 
                      className={`h-full rounded-full transition-all duration-700 ${
                        totalTasks === 0 ? 'bg-slate-300' :
                        completedTasks === totalTasks ? 'bg-emerald-500' : 'bg-indigo-600'
                      }`}
                      style={{ width: `${taskProgressPercentage}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                    <span>{totalTasks === 0 ? 'No tasks' : `${totalTasks - completedTasks} remaining`}</span>
                    <span className="font-bold text-slate-700 font-mono">{taskProgressPercentage}%</span>
                  </div>
                </div>
              </div>

              {/* Icon */}
              <div 
                id="stat-icon-completed-tasks"
                className="p-3 bg-brand-primary text-[#0F172A] rounded-xl shadow-md shadow-brand-primary/25 shrink-0 flex items-center justify-center font-bold"
              >
                <CheckSquare className="w-6 h-6 text-[#0F172A]" />
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 font-medium">
              <span>{completedTasks} completed out of {totalTasks} total</span>
              {totalTasks > 0 && completedTasks === totalTasks ? (
                <span className="text-emerald-700 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Done
                </span>
              ) : null}
            </div>
          </div>
        )}

      </div>

      {/* Recent Activity Feed (Shows last 3 actions such as Uploads or Decisions) */}
      {recentActivities && recentActivities.length > 0 && (
        <div id="summary-stats-recent-activity" className="mt-4 pt-4 border-t border-brand-primary/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-600" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Recent Activity in {projectName}
              </h3>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white/70 px-2 py-0.5 rounded-full border border-brand-primary/20">
              Last 3 Actions
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {recentActivities.slice(0, 3).map((act) => (
              <div 
                key={act.id} 
                className="bg-white/80 border border-brand-primary/20 rounded-xl p-3 shadow-2xs hover:bg-white transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    {act.type === 'Upload' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-black uppercase">
                        <FileAudio className="w-3 h-3 text-blue-600" />
                        <span>Upload</span>
                      </span>
                    )}
                    {act.type === 'Decision' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-black uppercase">
                        <Brain className="w-3 h-3 text-purple-600" />
                        <span>Decision</span>
                      </span>
                    )}
                    {act.type === 'Task' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase">
                        <CheckSquare className="w-3 h-3 text-emerald-600" />
                        <span>Task</span>
                      </span>
                    )}
                    {act.type === 'Activity' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-black uppercase">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>Action</span>
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 font-medium">
                      {formatRelativeTime(act.timestamp)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-800 font-semibold line-clamp-2" title={act.description}>
                    {act.description}
                  </p>
                </div>

                {act.userName && (
                  <p className="text-[10px] text-slate-400 mt-2 font-medium">
                    by {act.userName}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
export default SummaryStatsWidget;
