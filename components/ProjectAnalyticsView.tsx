import React, { useState, useMemo } from 'react';
import { 
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { 
  TrendingUp, CheckCircle2, Clock, AlertCircle, Calendar, 
  Users, Brain, Filter, Download, ArrowUpRight, BarChart3, 
  Target, Sparkles, Shield, ChevronDown, Check, Activity
} from 'lucide-react';
import { Project, ProjectTask, ProjectMember, AudioToTextRecord } from '../types';
import { ProjectTimelinesView } from './ProjectTimelinesView';

interface ProjectAnalyticsViewProps {
  project: Project;
  tasks: ProjectTask[];
  members: ProjectMember[];
  recordings: AudioToTextRecord[];
  decisionHistory: any[];
  initialTab?: 'trends' | 'timelines';
}

export const ProjectAnalyticsView: React.FC<ProjectAnalyticsViewProps> = ({
  project,
  tasks,
  members,
  recordings,
  decisionHistory,
  initialTab = 'trends'
}) => {
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState<'trends' | 'timelines'>(initialTab);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [selectedMember, setSelectedMember] = useState<string>('all');

  // Filter tasks based on selected assignee
  const filteredTasks = useMemo(() => {
    if (selectedMember === 'all') return tasks;
    return tasks.filter(t => t.assigneeEmail === selectedMember || t.assigneeName === selectedMember);
  }, [tasks, selectedMember]);

  // Overall Task Metrics
  const taskMetrics = useMemo(() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter(t => t.status === 'completed').length;
    const inProgress = filteredTasks.filter(t => t.status === 'in_progress').length;
    const pending = filteredTasks.filter(t => t.status === 'pending').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, inProgress, pending, completionRate };
  }, [filteredTasks]);

  // Decision Metrics (from decisionHistory + recording intelligence decisions)
  const decisionList = useMemo(() => {
    const fromHistory = decisionHistory.map(d => ({
      id: d.id,
      title: d.title || d.statement || 'Strategic Decision',
      date: d.createdAt || d.timestamp || d.date || new Date().toISOString(),
      category: d.category || 'Strategic',
      impact: d.impact || 'High'
    }));

    const fromRecordings: any[] = [];
    recordings.forEach(rec => {
      const date = rec.date || new Date().toISOString();
      if (rec.summary?.decisions) {
        rec.summary.decisions.forEach((decStr: string, idx: number) => {
          fromRecordings.push({
            id: `${rec.id}-dec-${idx}`,
            title: decStr,
            date,
            category: 'Operational',
            impact: 'Medium'
          });
        });
      }
      if (rec.unifiedIntelligence?.decisions) {
        rec.unifiedIntelligence.decisions.forEach((d: any, idx: number) => {
          fromRecordings.push({
            id: `${rec.id}-unified-dec-${idx}`,
            title: d.decision || d.title || 'Executive Decision',
            date,
            category: d.category || 'Architectural',
            impact: d.impact || 'High'
          });
        });
      }
    });

    return [...fromHistory, ...fromRecordings];
  }, [decisionHistory, recordings]);

  // Time-Series Task Completion Trends Data
  const taskCompletionTrendData = useMemo(() => {
    const now = new Date();
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 60;
    
    // Create interval buckets (e.g. daily for 7d/30d, weekly for 90d/all)
    const points = [];
    const intervalDays = timeRange === '7d' ? 1 : timeRange === '30d' ? 3 : 7;
    const numBuckets = Math.ceil(days / intervalDays);

    for (let i = numBuckets - 1; i >= 0; i--) {
      const bucketDate = new Date(now.getTime() - i * intervalDays * 24 * 60 * 60 * 1000);
      const label = bucketDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });

      // Filter tasks up to this timestamp
      const timestamp = bucketDate.getTime();
      const createdUpTo = filteredTasks.filter(t => new Date(t.createdAt || now).getTime() <= timestamp);
      const completedUpTo = createdUpTo.filter(t => t.status === 'completed' && new Date(t.updatedAt || t.createdAt || now).getTime() <= timestamp);

      const createdCount = createdUpTo.length;
      const completedCount = completedUpTo.length;
      const rate = createdCount > 0 ? Math.round((completedCount / createdCount) * 100) : 0;

      // Also compute delta in this interval
      const intervalStart = timestamp - intervalDays * 24 * 60 * 60 * 1000;
      const newlyCompleted = filteredTasks.filter(t => 
        t.status === 'completed' && 
        new Date(t.updatedAt || t.createdAt || now).getTime() > intervalStart &&
        new Date(t.updatedAt || t.createdAt || now).getTime() <= timestamp
      ).length;

      points.push({
        date: label,
        created: createdCount,
        completed: completedCount,
        newlyCompleted,
        completionRate: rate
      });
    }

    return points;
  }, [filteredTasks, timeRange]);

  // Decision Trends Over Time
  const decisionTrendData = useMemo(() => {
    const now = new Date();
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 60;
    const intervalDays = timeRange === '7d' ? 1 : timeRange === '30d' ? 3 : 7;
    const numBuckets = Math.ceil(days / intervalDays);

    const points = [];
    for (let i = numBuckets - 1; i >= 0; i--) {
      const bucketDate = new Date(now.getTime() - i * intervalDays * 24 * 60 * 60 * 1000);
      const intervalStart = bucketDate.getTime() - intervalDays * 24 * 60 * 60 * 1000;
      const label = bucketDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      // Decisions in this interval
      const inInterval = decisionList.filter(d => {
        const t = new Date(d.date).getTime();
        return t > intervalStart && t <= bucketDate.getTime();
      });

      const strategic = inInterval.filter(d => d.category.toLowerCase().includes('strat')).length;
      const architectural = inInterval.filter(d => d.category.toLowerCase().includes('arch') || d.category.toLowerCase().includes('tech')).length;
      const operational = inInterval.length - strategic - architectural;

      points.push({
        date: label,
        total: inInterval.length,
        strategic,
        architectural,
        operational: operational > 0 ? operational : 0
      });
    }

    return points;
  }, [decisionList, timeRange]);

  // Member Task Completion Matrix
  const memberPerformanceData = useMemo(() => {
    // Collect all assignees from tasks and members
    const memberMap: Record<string, { name: string; completed: number; pending: number; total: number; rate: number }> = {};

    members.forEach(m => {
      const key = m.email || m.displayName || 'Member';
      memberMap[key] = {
        name: m.displayName || m.email.split('@')[0],
        completed: 0,
        pending: 0,
        total: 0,
        rate: 0
      };
    });

    tasks.forEach(t => {
      const key = t.assigneeEmail || t.assigneeName || 'Unassigned';
      if (!memberMap[key]) {
        memberMap[key] = {
          name: t.assigneeName || key.split('@')[0],
          completed: 0,
          pending: 0,
          total: 0,
          rate: 0
        };
      }
      memberMap[key].total += 1;
      if (t.status === 'completed') {
        memberMap[key].completed += 1;
      } else {
        memberMap[key].pending += 1;
      }
    });

    return Object.values(memberMap)
      .filter(m => m.total > 0)
      .map(m => ({
        ...m,
        rate: m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8); // Top 8 members
  }, [tasks, members]);

  // Priority Breakdown
  const priorityData = useMemo(() => {
    const counts = { urgent: 0, high: 0, medium: 0, low: 0 };
    const completedCounts = { urgent: 0, high: 0, medium: 0, low: 0 };

    filteredTasks.forEach(t => {
      const pri = (t.priority || 'medium') as keyof typeof counts;
      if (counts[pri] !== undefined) {
        counts[pri]++;
        if (t.status === 'completed') completedCounts[pri]++;
      }
    });

    return [
      { name: 'Urgent', total: counts.urgent, completed: completedCounts.urgent, fill: '#ef4444' },
      { name: 'High', total: counts.high, completed: completedCounts.high, fill: '#f97316' },
      { name: 'Medium', total: counts.medium, completed: completedCounts.medium, fill: '#3b82f6' },
      { name: 'Low', total: counts.low, completed: completedCounts.low, fill: '#10b981' }
    ];
  }, [filteredTasks]);

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header & Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                <BarChart3 className="w-4 h-4" />
              </div>
              <h2 className="text-xl font-black text-slate-950 uppercase tracking-tight">
                Project Analytics & Trends
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200">
                Recharts Live
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Historical task completion velocity and decision intelligence trends for <span className="font-bold text-slate-800 uppercase">{project.name}</span>
            </p>
          </div>

          {/* Time Range & Member Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Time Filter */}
            <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200/60 text-xs font-bold">
              {(['7d', '30d', '90d', 'all'] as const).map(range => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    timeRange === range
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : range === '90d' ? '90 Days' : 'All Time'}
                </button>
              ))}
            </div>

            {/* Member Filter Dropdown */}
            <div className="relative">
              <select
                value={selectedMember}
                onChange={(e) => setSelectedMember(e.target.value)}
                className="appearance-none bg-slate-100 hover:bg-slate-200/70 border border-slate-200/80 rounded-xl px-3.5 py-2 pr-8 text-xs font-bold text-slate-800 outline-none transition-colors cursor-pointer"
              >
                <option value="all">All Assignees</option>
                {members.map(m => (
                  <option key={m.email} value={m.email}>
                    {m.displayName || m.email}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Analytics Sub-Views Navigation */}
        <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
          <button
            onClick={() => setActiveAnalyticsTab('trends')}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
              activeAnalyticsTab === 'trends'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Overview & Trends</span>
          </button>
          <button
            onClick={() => setActiveAnalyticsTab('timelines')}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
              activeAnalyticsTab === 'timelines'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Timelines & Milestones</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
              activeAnalyticsTab === 'timelines' ? 'bg-indigo-500/50 text-white' : 'bg-indigo-100 text-indigo-700'
            }`}>
              Gantt Recharts
            </span>
          </button>
        </div>
      </div>

      {activeAnalyticsTab === 'timelines' ? (
        <ProjectTimelinesView
          project={project}
          tasks={tasks}
          members={members}
        />
      ) : (
        <>
      {/* KPI Highlight Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Completion Rate */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              Task Completion Rate
            </span>
            <div className={`p-2 rounded-xl ${taskMetrics.completionRate >= 70 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-950 tracking-tight">
              {taskMetrics.completionRate}%
            </span>
            <span className="text-xs text-slate-400 font-bold">
              ({taskMetrics.completed}/{taskMetrics.total} tasks)
            </span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                taskMetrics.completionRate >= 70 ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(100, taskMetrics.completionRate)}%` }}
            />
          </div>
        </div>

        {/* Total Tasks Active */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              Active Workflow Tasks
            </span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-950 tracking-tight">
              {taskMetrics.inProgress + taskMetrics.pending}
            </span>
            <span className="text-xs text-blue-600 font-bold">
              In Flight
            </span>
          </div>
          <p className="text-[11px] text-slate-500 font-medium">
            {taskMetrics.inProgress} in progress · {taskMetrics.pending} pending assignment
          </p>
        </div>

        {/* Strategic Decisions */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              Decisions Logged
            </span>
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600">
              <Brain className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-950 tracking-tight">
              {decisionList.length}
            </span>
            <span className="text-xs text-purple-600 font-bold">
              Indexed
            </span>
          </div>
          <p className="text-[11px] text-slate-500 font-medium">
            Sourced from meetings and decision intelligence
          </p>
        </div>

        {/* Decision Velocity */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              Audio Intelligence
            </span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-slate-950 tracking-tight">
              {recordings.length}
            </span>
            <span className="text-xs text-amber-600 font-bold">
              Recordings
            </span>
          </div>
          <p className="text-[11px] text-slate-500 font-medium">
            Providing grounding for task & decision context
          </p>
        </div>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Chart 1: Task Completion Rate Over Time */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <span>Task Completion Rates Over Time</span>
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Cumulative tasks completed vs overall created & completion % rate
              </p>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {timeRange.toUpperCase()}
            </span>
          </div>

          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={taskCompletionTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 11, fill: '#64748b' }} 
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 11, fill: '#64748b' }} 
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '12px',
                    border: 'none',
                    color: '#fff',
                    fontSize: '12px'
                  }}
                  formatter={(value: any, name: any) => {
                    if (name === 'completionRate') return [`${value}%`, 'Completion Rate'];
                    if (name === 'completed') return [value, 'Tasks Completed'];
                    if (name === 'created') return [value, 'Tasks Created'];
                    return [value, name];
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  height={36} 
                  wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="created" 
                  name="Tasks Created" 
                  stroke="#6366f1" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorCreated)" 
                />
                <Area 
                  type="monotone" 
                  dataKey="completed" 
                  name="Tasks Completed" 
                  stroke="#10b981" 
                  strokeWidth={2.5}
                  fillOpacity={1} 
                  fill="url(#colorCompleted)" 
                />
                <Line 
                  type="monotone" 
                  dataKey="completionRate" 
                  name="Completion %" 
                  stroke="#f59e0b" 
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#f59e0b' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Decision Trends Over Time */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-600" />
                <span>Decision Trends Over Time</span>
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Decision velocity categorized by Strategic, Architectural, & Operational
              </p>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Velocity
            </span>
          </div>

          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={decisionTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 11, fill: '#64748b' }} 
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 11, fill: '#64748b' }} 
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '12px',
                    border: 'none',
                    color: '#fff',
                    fontSize: '12px'
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  height={36} 
                  wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                />
                <Bar dataKey="strategic" name="Strategic" stackId="a" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                <Bar dataKey="architectural" name="Architectural" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                <Bar dataKey="operational" name="Operational" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Secondary Analytics Row: Assignee Matrix & Priority Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Assignee Completion Performance */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                <span>Team Member Task Completion Matrix</span>
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Completed vs Pending task volume per collaborator
              </p>
            </div>
            <span className="text-[10px] font-bold text-slate-400">
              Accountability
            </span>
          </div>

          {memberPerformanceData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-slate-400 font-medium">
              No assigned task data available yet for team members.
            </div>
          ) : (
            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={memberPerformanceData} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    tick={{ fontSize: 11, fill: '#334155', fontWeight: 'bold' }} 
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickLine={false}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderRadius: '12px',
                      border: 'none',
                      color: '#fff',
                      fontSize: '12px'
                    }}
                    formatter={(val: any, name: any) => [val, name === 'completed' ? 'Completed Tasks' : 'Pending Tasks']}
                  />
                  <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                  <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="pending" name="Pending" fill="#94a3b8" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Priority & Completion Breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-500" />
              <span>Priority Completion Status</span>
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              Resolution breakdown across priority levels
            </p>
          </div>

          <div className="space-y-4 pt-1">
            {priorityData.map((item, idx) => {
              const rate = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;
              return (
                <div key={idx} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.fill }} />
                      {item.name} Priority
                    </span>
                    <span className="text-slate-500 font-medium">
                      <strong className="text-slate-900">{item.completed}</strong>/{item.total} ({rate}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-500"
                      style={{ 
                        width: `${rate}%`,
                        backgroundColor: item.fill 
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Decision Memory Summary */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 mt-4">
            <div className="flex items-center gap-1.5 text-xs font-black uppercase text-slate-800">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>Organizational Insight</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Task completion velocity tracks strongest in meetings with explicit owner tagging and clear 3-bullet recap follow-throughs.
            </p>
          </div>
        </div>

      </div>
        </>
      )}
    </div>
  );
};
