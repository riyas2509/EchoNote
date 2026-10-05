import React, { useState, useMemo } from 'react';
import { 
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { 
  Calendar, Clock, CheckCircle2, AlertTriangle, 
  Filter, Flag, User, Layers, ArrowRight, ShieldCheck, 
  ChevronRight, Sparkles, TrendingUp, AlertCircle
} from 'lucide-react';
import { Project, ProjectTask, ProjectMember, TimelineGanttItem, ProjectMilestone } from '../types';

interface ProjectTimelinesViewProps {
  project: Project;
  tasks: ProjectTask[];
  members: ProjectMember[];
}

export const ProjectTimelinesView: React.FC<ProjectTimelinesViewProps> = ({
  project,
  tasks,
  members
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [viewScope, setViewScope] = useState<'all' | 'high_priority' | 'milestones_only'>('all');

  // Compute Project Start reference date (earliest task createdAt or project createdAt or 14 days ago)
  const timelineBase = useMemo(() => {
    let earliest = new Date();
    earliest.setDate(earliest.getDate() - 14);

    tasks.forEach(t => {
      if (t.createdAt) {
        const cDate = new Date(t.createdAt);
        if (!isNaN(cDate.getTime()) && cDate < earliest) {
          earliest = cDate;
        }
      }
    });

    return earliest;
  }, [tasks]);

  const today = useMemo(() => new Date(), []);
  const todayOffsetDays = useMemo(() => {
    const diffTime = today.getTime() - timelineBase.getTime();
    return Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
  }, [today, timelineBase]);

  // Generate dynamic or defined milestones from project tasks
  const milestones: ProjectMilestone[] = useMemo(() => {
    // Group tasks by dueDate week or milestone tag
    const milestoneMap = new Map<string, {
      title: string;
      tasks: ProjectTask[];
      dueDate: Date;
      startDate: Date;
    }>();

    // Default canonical milestones if project has tasks
    if (tasks.length === 0) {
      return [];
    }

    // Categorize into milestone sprints based on task dates or order
    const sortedTasks = [...tasks].sort((a, b) => {
      const dateA = a.dueDate ? new Date(a.dueDate).getTime() : new Date(a.createdAt).getTime();
      const dateB = b.dueDate ? new Date(b.dueDate).getTime() : new Date(b.createdAt).getTime();
      return dateA - dateB;
    });

    const sprintChunkSize = Math.max(2, Math.ceil(sortedTasks.length / 3));
    const sprintNames = [
      'Sprint 1: Architecture & Foundation',
      'Sprint 2: Core Speech & Intelligence Engine',
      'Sprint 3: Enterprise Integration & Launch'
    ];

    sprintNames.forEach((sprintName, idx) => {
      const chunkTasks = sortedTasks.slice(idx * sprintChunkSize, (idx + 1) * sprintChunkSize);
      if (chunkTasks.length > 0) {
        let minStart = new Date(chunkTasks[0].createdAt || timelineBase);
        let maxDue = chunkTasks[chunkTasks.length - 1].dueDate 
          ? new Date(chunkTasks[chunkTasks.length - 1].dueDate!) 
          : new Date(today.getTime() + (idx + 1) * 7 * 24 * 60 * 60 * 1000);

        milestoneMap.set(sprintName, {
          title: sprintName,
          tasks: chunkTasks,
          startDate: minStart,
          dueDate: maxDue
        });
      }
    });

    const result: ProjectMilestone[] = [];
    milestoneMap.forEach((val, key) => {
      const total = val.tasks.length;
      const completed = val.tasks.filter(t => t.status === 'completed').length;
      const inProgress = val.tasks.filter(t => t.status === 'in_progress').length;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

      const isOverdue = val.dueDate < today && pct < 100;
      const isAtRisk = !isOverdue && val.dueDate.getTime() - today.getTime() < 3 * 24 * 60 * 60 * 1000 && pct < 50;

      let status: ProjectMilestone['status'] = 'pending';
      if (pct === 100) status = 'completed';
      else if (isOverdue) status = 'overdue';
      else if (isAtRisk) status = 'at_risk';
      else if (inProgress > 0 || pct > 0) status = 'in_progress';

      result.push({
        id: `ms-${key.toLowerCase().replace(/\s+/g, '-')}`,
        projectId: project.id,
        title: val.title,
        startDate: val.startDate.toISOString().split('T')[0],
        dueDate: val.dueDate.toISOString().split('T')[0],
        status,
        progressPercentage: pct,
        totalTasks: total,
        completedTasks: completed,
        ownerName: val.tasks[0]?.assigneeName || 'Team Lead'
      });
    });

    return result;
  }, [tasks, project.id, timelineBase, today]);

  // Prepare Gantt Chart Data using Recharts horizontal stacked BarChart
  const ganttData: TimelineGanttItem[] = useMemo(() => {
    let dataset = [...tasks];

    // Filter by Assignee
    if (filterAssignee !== 'all') {
      dataset = dataset.filter(t => 
        t.assigneeEmail.toLowerCase() === filterAssignee.toLowerCase() ||
        t.assigneeName?.toLowerCase() === filterAssignee.toLowerCase()
      );
    }

    // Filter by Status
    if (filterStatus !== 'all') {
      if (filterStatus === 'overdue') {
        dataset = dataset.filter(t => {
          if (t.status === 'completed') return false;
          if (!t.dueDate) return false;
          return new Date(t.dueDate) < today;
        });
      } else {
        dataset = dataset.filter(t => t.status === filterStatus);
      }
    }

    // Filter by Scope
    if (viewScope === 'high_priority') {
      dataset = dataset.filter(t => t.priority === 'high' || t.priority === 'urgent');
    }

    const items: TimelineGanttItem[] = [];

    // Add Milestones to Gantt if view allows
    if (viewScope !== 'high_priority') {
      milestones.forEach(ms => {
        const msStart = new Date(ms.startDate);
        const msDue = new Date(ms.dueDate);
        const startDiff = Math.max(0, Math.floor((msStart.getTime() - timelineBase.getTime()) / (1000 * 60 * 60 * 24)));
        const duration = Math.max(3, Math.ceil((msDue.getTime() - msStart.getTime()) / (1000 * 60 * 60 * 24)));
        const completedDays = Math.round(duration * (ms.progressPercentage / 100));
        const remainingDays = duration - completedDays;
        const daysToDue = Math.ceil((msDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        items.push({
          id: ms.id,
          name: `🚩 ${ms.title}`,
          category: 'Milestone',
          assignee: ms.ownerName || 'Milestone Lead',
          status: ms.status === 'at_risk' ? 'in_progress' : ms.status,
          priority: 'urgent',
          startDateStr: ms.startDate,
          dueDateStr: ms.dueDate,
          startOffsetDays: startDiff,
          completedDays,
          remainingDays,
          totalDurationDays: duration,
          progress: ms.progressPercentage,
          daysRemaining: daysToDue,
          isOverdue: ms.status === 'overdue',
          details: `${ms.completedTasks}/${ms.totalTasks} Tasks Completed`
        });
      });
    }

    if (viewScope !== 'milestones_only') {
      dataset.forEach(task => {
        const taskCreated = task.createdAt ? new Date(task.createdAt) : timelineBase;
        const taskDue = task.dueDate ? new Date(task.dueDate) : new Date(taskCreated.getTime() + 7 * 24 * 60 * 60 * 1000);

        const startDiff = Math.max(0, Math.floor((taskCreated.getTime() - timelineBase.getTime()) / (1000 * 60 * 60 * 24)));
        const duration = Math.max(2, Math.ceil((taskDue.getTime() - taskCreated.getTime()) / (1000 * 60 * 60 * 24)));
        
        let progress = 0;
        if (task.status === 'completed') progress = 100;
        else if (task.status === 'in_progress') progress = 50;

        const completedDays = Math.round(duration * (progress / 100));
        const remainingDays = duration - completedDays;
        const daysToDue = Math.ceil((taskDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const isOverdue = daysToDue < 0 && task.status !== 'completed';

        items.push({
          id: task.id,
          name: task.title,
          category: 'Task',
          assignee: task.assigneeName || task.assigneeEmail.split('@')[0] || 'Unassigned',
          status: isOverdue ? 'overdue' : task.status,
          priority: task.priority || 'medium',
          startDateStr: taskCreated.toISOString().split('T')[0],
          dueDateStr: taskDue.toISOString().split('T')[0],
          startOffsetDays: startDiff,
          completedDays,
          remainingDays,
          totalDurationDays: duration,
          progress,
          daysRemaining: daysToDue,
          isOverdue,
          details: task.description || ''
        });
      });
    }

    return items;
  }, [tasks, milestones, filterAssignee, filterStatus, viewScope, timelineBase, today]);

  // Deadline tracking alerts
  const deadlineMetrics = useMemo(() => {
    let overdueCount = 0;
    let dueNext7Days = 0;
    let completedOnSchedule = 0;

    tasks.forEach(t => {
      if (t.status === 'completed') {
        completedOnSchedule++;
        return;
      }
      if (t.dueDate) {
        const d = new Date(t.dueDate);
        const diffDays = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) overdueCount++;
        else if (diffDays <= 7) dueNext7Days++;
      }
    });

    return { overdueCount, dueNext7Days, completedOnSchedule };
  }, [tasks, today]);

  // Urgent upcoming deadlines
  const upcomingUrgentDeadlines = useMemo(() => {
    return tasks
      .filter(t => t.status !== 'completed' && t.dueDate)
      .map(t => {
        const d = new Date(t.dueDate!);
        const diffDays = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return {
          ...t,
          diffDays
        };
      })
      .sort((a, b) => a.diffDays - b.diffDays)
      .slice(0, 5);
  }, [tasks, today]);

  // Custom Gantt Tooltip
  const CustomGanttTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item: TimelineGanttItem = payload[0].payload;
      return (
        <div className="bg-slate-900 text-white p-3.5 rounded-xl shadow-xl border border-slate-700 text-xs space-y-2 max-w-xs pointer-events-none">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <span className="font-bold text-slate-100 text-sm truncate">{item.name}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
              item.category === 'Milestone' 
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
            }`}>
              {item.category}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300">
            <div>
              <span className="text-slate-500 block text-[10px]">Assignee</span>
              <span className="font-semibold text-slate-200">{item.assignee}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">Priority</span>
              <span className="font-semibold capitalize text-slate-200">{item.priority}</span>
            </div>
          </div>

          <div className="space-y-1 pt-1 border-t border-slate-800/80">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Timeline Window:</span>
              <span className="font-mono text-slate-200">{item.startDateStr} → {item.dueDateStr}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Duration:</span>
              <span className="font-semibold text-slate-200">{item.totalDurationDays} days</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Progress:</span>
              <span className="font-bold text-emerald-400">{item.progress}%</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Deadline Status:</span>
              <span className={`font-bold ${
                item.isOverdue 
                  ? 'text-red-400' 
                  : item.daysRemaining <= 3 
                    ? 'text-amber-400' 
                    : 'text-emerald-400'
              }`}>
                {item.isOverdue 
                  ? `Overdue by ${Math.abs(item.daysRemaining)} day(s)` 
                  : item.daysRemaining === 0 
                    ? 'Due Today' 
                    : `Due in ${item.daysRemaining} day(s)`}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Project Timelines & Gantt Visualizer</h3>
            <p className="text-xs text-slate-500">Track milestone progress, completion duration, and deadline tracking</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Scope switch */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setViewScope('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewScope === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Items
            </button>
            <button
              onClick={() => setViewScope('milestones_only')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewScope === 'milestones_only' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Milestones
            </button>
            <button
              onClick={() => setViewScope('high_priority')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewScope === 'high_priority' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Urgent & High
            </button>
          </div>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">Status: All</option>
            <option value="in_progress">In Progress</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="overdue">Overdue</option>
          </select>

          {/* Member filter */}
          <select
            value={filterAssignee}
            onChange={(e) => setFilterAssignee(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">Member: All</option>
            {members.map((m, idx) => (
              <option key={idx} value={m.email}>
                {m.displayName || m.email.split('@')[0]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Quick Deadline KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Due Next 7 Days</span>
            <span className="text-2xl font-black text-slate-900 mt-1 block">{deadlineMetrics.dueNext7Days}</span>
            <span className="text-xs text-amber-600 font-medium">Deliverables approaching deadline</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Overdue Deliverables</span>
            <span className="text-2xl font-black text-slate-900 mt-1 block">{deadlineMetrics.overdueCount}</span>
            <span className={`text-xs font-medium ${deadlineMetrics.overdueCount > 0 ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
              {deadlineMetrics.overdueCount > 0 ? 'Require immediate attention' : 'All deliverables on schedule'}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Completed on Track</span>
            <span className="text-2xl font-black text-slate-900 mt-1 block">{deadlineMetrics.completedOnSchedule}</span>
            <span className="text-xs text-emerald-600 font-medium">Finalized deliverables</span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Project Milestones Progress Summary Cards */}
      {milestones.length > 0 && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-indigo-600" />
              <h4 className="text-sm font-bold text-slate-900">Project Milestone Progress</h4>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {milestones.filter(m => m.status === 'completed').length} of {milestones.length} Milestones Completed
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {milestones.map((ms) => (
              <div
                key={ms.id}
                className="p-4 rounded-xl border border-slate-200/90 bg-slate-50/50 hover:bg-slate-50 transition-all space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900 line-clamp-1">{ms.title}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider flex-shrink-0 ${
                    ms.status === 'completed'
                      ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                      : ms.status === 'overdue'
                        ? 'bg-red-100 text-red-700 border border-red-200'
                        : ms.status === 'at_risk'
                          ? 'bg-amber-100 text-amber-700 border border-amber-200'
                          : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                  }`}>
                    {ms.status.replace('_', ' ')}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span>Progress: {ms.completedTasks}/{ms.totalTasks} Tasks</span>
                    <span className="font-bold text-slate-900">{ms.progressPercentage}%</span>
                  </div>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        ms.status === 'completed' ? 'bg-emerald-500' : ms.status === 'overdue' ? 'bg-red-500' : 'bg-indigo-600'
                      }`}
                      style={{ width: `${ms.progressPercentage}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    Target: {ms.dueDate}
                  </span>
                  <span className="font-medium text-slate-600 truncate max-w-[100px]">{ms.ownerName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Gantt-Style Visualization with Recharts */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <h4 className="text-sm font-bold text-slate-900">Gantt-Style Timeline Schedule</h4>
            <span className="text-xs text-slate-500">({ganttData.length} timeline items)</span>
          </div>

          {/* Color Legend */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-emerald-500"></span>
              <span>Completed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-indigo-500"></span>
              <span>Active Progress</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-500"></span>
              <span>In Progress / Near Due</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-red-500"></span>
              <span>Overdue</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-300"></span>
              <span>Remaining Scope</span>
            </div>
          </div>
        </div>

        {ganttData.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
            No tasks or milestones match the selected timeline filters.
          </div>
        ) : (
          <div className="w-full" style={{ height: Math.max(340, ganttData.length * 48) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={ganttData}
                margin={{ top: 10, right: 30, left: 140, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={true} stroke="#F1F5F9" />
                <XAxis 
                  type="number" 
                  unit="d" 
                  stroke="#94A3B8" 
                  fontSize={11}
                  label={{ value: 'Days from Timeline Start', position: 'insideBottom', offset: -10, fill: '#64748B', fontSize: 11 }}
                />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  stroke="#475569" 
                  fontSize={11}
                  width={130}
                  tickFormatter={(val: string) => val.length > 20 ? val.substring(0, 18) + '...' : val}
                />
                <Tooltip content={<CustomGanttTooltip />} />
                
                {/* "Today" marker line */}
                <ReferenceLine 
                  x={todayOffsetDays} 
                  stroke="#6366F1" 
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  label={{ value: 'TODAY', position: 'top', fill: '#6366F1', fontSize: 10, fontWeight: 'bold' }} 
                />

                {/* Invisible offset bar to position start date */}
                <Bar dataKey="startOffsetDays" stackId="gantt" fill="transparent" isAnimationActive={false} />

                {/* Completed progress portion */}
                <Bar dataKey="completedDays" stackId="gantt" radius={[4, 0, 0, 4]}>
                  {ganttData.map((entry, index) => (
                    <Cell 
                      key={`comp-${index}`} 
                      fill={entry.status === 'completed' ? '#10B981' : '#6366F1'} 
                    />
                  ))}
                </Bar>

                {/* Remaining scope portion */}
                <Bar dataKey="remainingDays" stackId="gantt" radius={[0, 4, 4, 0]}>
                  {ganttData.map((entry, index) => (
                    <Cell 
                      key={`rem-${index}`} 
                      fill={
                        entry.isOverdue 
                          ? '#EF4444' 
                          : entry.status === 'in_progress' 
                            ? '#F59E0B' 
                            : '#CBD5E1'
                      } 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Urgent Upcoming Deadlines Tracking Panel */}
      {upcomingUrgentDeadlines.length > 0 && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              <h4 className="text-sm font-bold text-slate-900">Deadline Tracking Radar</h4>
            </div>
            <span className="text-xs text-slate-500">Next critical action items</span>
          </div>

          <div className="space-y-2">
            {upcomingUrgentDeadlines.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 transition-all text-xs"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    task.diffDays < 0 ? 'bg-red-500' : task.diffDays <= 2 ? 'bg-amber-500' : 'bg-indigo-500'
                  }`} />
                  <div>
                    <span className="font-bold text-slate-900 block">{task.title}</span>
                    <span className="text-[11px] text-slate-500">
                      Assigned to: {task.assigneeName || task.assigneeEmail.split('@')[0]}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                    task.diffDays < 0
                      ? 'bg-red-100 text-red-700 border border-red-200'
                      : task.diffDays === 0
                        ? 'bg-amber-100 text-amber-800 border border-amber-200'
                        : 'bg-slate-200/80 text-slate-700'
                  }`}>
                    {task.diffDays < 0 
                      ? `Overdue by ${Math.abs(task.diffDays)}d` 
                      : task.diffDays === 0 
                        ? 'Due Today' 
                        : `Due in ${task.diffDays}d`}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">{task.dueDate}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
