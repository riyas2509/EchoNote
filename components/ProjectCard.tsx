import React from 'react';
import { 
  Folder, 
  CheckSquare, 
  CheckCircle2, 
  Clock, 
  FileAudio, 
  Brain, 
  ArrowRight, 
  Users, 
  Sparkles,
  Layers
} from 'lucide-react';
import { Project } from '../types';

export interface ProjectActivityItem {
  id: string;
  type: 'Upload' | 'Decision' | 'Task' | 'Activity';
  title: string;
  description: string;
  timestamp: string;
  userName?: string;
}

export interface ProjectCardProps {
  project: Project;
  isActive: boolean;
  onSelect: (projectName: string) => void;
  tasksCount: {
    completed: number;
    total: number;
  };
  recentActivities: ProjectActivityItem[];
  userRole?: string;
  recordingsCount?: number;
  membersCount?: number;
}

export const formatRelativeTime = (dateInput?: string | number | null): string => {
  if (!dateInput) return 'Recently';
  try {
    const time = typeof dateInput === 'string' ? new Date(dateInput).getTime() : dateInput;
    if (isNaN(time)) return 'Recently';
    const now = Date.now();
    const diffSec = Math.max(0, Math.floor((now - time) / 1000));

    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return 'Recently';
  }
};

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  isActive,
  onSelect,
  tasksCount,
  recentActivities = [],
  userRole,
  recordingsCount = 0,
  membersCount
}) => {
  const { completed, total } = tasksCount;
  const progressPercentage = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  // Determine progress color
  const getProgressColor = () => {
    if (total === 0) return 'bg-slate-300';
    if (completed === total) return 'bg-emerald-500';
    if (progressPercentage >= 50) return 'bg-indigo-600';
    return 'bg-amber-500';
  };

  const effectiveMembersCount = membersCount !== undefined 
    ? membersCount 
    : (project.members?.length ? project.members.length : 1);

  return (
    <div 
      id={`project-card-${project.id}`}
      data-project-id={project.id}
      onClick={() => onSelect(project.name)}
      className={`relative bg-white rounded-2xl border transition-all duration-300 p-6 flex flex-col justify-between group cursor-pointer ${
        isActive 
          ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-lg bg-gradient-to-b from-indigo-50/25 via-white to-white' 
          : 'border-slate-200/90 hover:border-indigo-300 hover:shadow-xl shadow-sm'
      }`}
    >
      {/* Top Banner / Project Info */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
              isActive 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30' 
                : 'bg-indigo-50 border border-indigo-100 text-indigo-600 group-hover:bg-indigo-100'
            }`}>
              <Folder className="w-5 h-5" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight truncate">
                  {project.name}
                </h3>
                {isActive && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-indigo-600 text-white shrink-0 shadow-xs">
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-medium truncate mt-0.5">
                {project.ownerEmail || 'Shared Workspace'}
              </p>
            </div>
          </div>

          <button 
            type="button"
            className={`text-xs font-bold flex items-center gap-1 transition-all shrink-0 px-2.5 py-1.5 rounded-lg ${
              isActive 
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 font-extrabold' 
                : 'text-slate-500 hover:text-indigo-600 group-hover:translate-x-0.5'
            }`}
          >
            <span>{isActive ? 'Current' : 'Select'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Task Completion Visual Indicator */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <CheckSquare className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Tasks Progress
              </span>
            </div>

            {/* Visual Indicator Numbers: Completed versus Total Tasks */}
            <div className="flex items-baseline gap-1 font-mono">
              <span className="text-sm font-black text-slate-900">
                {completed}
              </span>
              <span className="text-xs text-slate-400 font-bold">/</span>
              <span className="text-xs font-bold text-slate-600">
                {total}
              </span>
              <span className="text-[11px] text-slate-400 font-sans ml-1">
                Completed
              </span>
            </div>
          </div>

          {/* Visual Progress Bar */}
          <div className="space-y-1.5">
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden p-0.5 border border-slate-200/50">
              <div 
                className={`h-full rounded-full transition-all duration-700 ${getProgressColor()}`}
                style={{ width: `${total > 0 ? progressPercentage : 0}%` }}
              />
            </div>
            
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-500 flex items-center gap-1">
                {total === 0 ? (
                  <span className="text-slate-400 italic">No tasks created yet</span>
                ) : completed === total ? (
                  <span className="text-emerald-700 font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> All {total} tasks finished!
                  </span>
                ) : (
                  <span>{total - completed} pending / in progress</span>
                )}
              </span>

              <span className="font-black text-slate-700 font-mono">
                {total > 0 ? `${progressPercentage}%` : '0%'}
              </span>
            </div>
          </div>
        </div>

        {/* Recent Activity Feed (Last 3 actions performed within this specific project) */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Recent Activity
              </h4>
            </div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-100 px-2 py-0.5 rounded-full">
              Last 3 Actions
            </span>
          </div>

          {recentActivities.length > 0 ? (
            <div className="space-y-2">
              {recentActivities.slice(0, 3).map((act) => (
                <div 
                  key={act.id} 
                  className="p-2.5 bg-slate-50 hover:bg-slate-100/90 rounded-xl border border-slate-100 flex items-start gap-2.5 transition-colors"
                >
                  {/* Action Badge */}
                  <div className="shrink-0 mt-0.5">
                    {act.type === 'Upload' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-black uppercase tracking-wider">
                        <FileAudio className="w-3 h-3 text-blue-600" />
                        <span>Upload</span>
                      </span>
                    )}
                    {act.type === 'Decision' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-black uppercase tracking-wider">
                        <Brain className="w-3 h-3 text-purple-600" />
                        <span>Decision</span>
                      </span>
                    )}
                    {act.type === 'Task' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase tracking-wider">
                        <CheckSquare className="w-3 h-3 text-emerald-600" />
                        <span>Task</span>
                      </span>
                    )}
                    {act.type === 'Activity' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-black uppercase tracking-wider">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>Action</span>
                      </span>
                    )}
                  </div>

                  {/* Action Description & Timestamp */}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-800 font-medium line-clamp-1 leading-snug" title={act.description}>
                      {act.description}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 font-medium">
                      <span>{formatRelativeTime(act.timestamp)}</span>
                      {act.userName && (
                        <>
                          <span>•</span>
                          <span className="truncate max-w-[100px]">{act.userName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-3.5 px-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
              <p className="text-xs text-slate-400 font-medium">
                No recent activity in this project
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Upload recordings or log decisions to populate feed
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Card Footer: Metadata Badges */}
      <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <span>{effectiveMembersCount} {effectiveMembersCount === 1 ? 'member' : 'members'}</span>
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <FileAudio className="w-3.5 h-3.5 text-slate-400" />
            <span>{recordingsCount} {recordingsCount === 1 ? 'recording' : 'recordings'}</span>
          </span>
        </div>

        {userRole && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {userRole}
          </span>
        )}
      </div>
    </div>
  );
};
