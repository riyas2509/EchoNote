
import React, { useState } from 'react';
import { ClipboardList, CheckCircle2, Clock, AlertCircle, TrendingUp, Info, User } from 'lucide-react';
import { motion } from 'motion/react';
import { ExecutionTracker, ExecutionTask } from '../types';

interface ExecutionTrackerViewProps {
  tracker: ExecutionTracker;
  onChangeTracker?: (updatedTracker: ExecutionTracker) => void;
}

const ExecutionTrackerView: React.FC<ExecutionTrackerViewProps> = ({ tracker, onChangeTracker }) => {
  const [activeDropdownTaskId, setActiveDropdownTaskId] = useState<string | null>(null);

  const stats = [
    { 
      label: 'Total Tasks', 
      value: tracker.totalTasks, 
      icon: <ClipboardList size={20} className="text-slate-500" />,
      color: 'text-slate-900'
    },
    { 
      label: 'Completed', 
      value: tracker.completedTasks, 
      icon: <CheckCircle2 size={20} className="text-emerald-500" />,
      color: 'text-emerald-600'
    },
    { 
      label: 'Pending', 
      value: tracker.pendingTasks, 
      icon: <Clock size={20} className="text-amber-500" />,
      color: 'text-amber-600'
    },
    { 
      label: 'Overdue', 
      value: tracker.overdueTasks, 
      icon: <AlertCircle size={20} className="text-rose-500" />,
      color: 'text-rose-600'
    }
  ];

  const handleStatusChange = (taskId: string, newStatus: 'Pending' | 'In Progress' | 'Completed' | 'Overdue') => {
    if (!onChangeTracker) return;

    const updatedTasks = tracker.tasks.map((t) => {
      if (t.id === taskId) {
        return { ...t, status: newStatus };
      }
      return t;
    });

    const total = updatedTasks.length;
    const completedTasks = updatedTasks.filter(t => t.status === 'Completed').length;
    const pendingTasks = updatedTasks.filter(t => t.status === 'Pending' || t.status === 'In Progress').length;
    const overdueTasks = updatedTasks.filter(t => t.status === 'Overdue').length;
    const completionRate = total > 0 ? Math.round((completedTasks / total) * 100) : 0;
    const delayRate = total > 0 ? Math.round((overdueTasks / total) * 100) : 0;

    const updatedTracker: ExecutionTracker = {
      ...tracker,
      totalTasks: total,
      completedTasks,
      pendingTasks,
      overdueTasks,
      completionRate,
      delayRate,
      tasks: updatedTasks
    };

    onChangeTracker(updatedTracker);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header & Insights */}
      <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-2xl p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <TrendingUp size={24} className="text-brand-primary" />
            <h3 className="text-xl font-bold text-brand-primary uppercase tracking-widest">Execution Intelligence</h3>
          </div>
          <div className="flex items-center space-x-6">
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Completion Rate</p>
              <p className="text-2xl font-black text-emerald-600">{tracker.completionRate}%</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Delay Rate</p>
              <p className="text-2xl font-black text-rose-600">{tracker.delayRate}%</p>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tracker.keyInsights.map((insight, idx) => (
            <div key={idx} className="flex items-center space-x-3 bg-white/50 p-3 rounded-xl border border-brand-primary/5">
              <div className="w-2 h-2 rounded-full bg-brand-primary" />
              <p className="text-sm font-bold text-slate-700">{insight}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-2"
          >
            <div className="flex items-center space-x-2">
              {s.icon}
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{s.label}</span>
            </div>
            <p className={`text-3xl font-black ${s.color}`}>{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Task List */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-8 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Task Breakdown</h4>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">Status Tracking</span>
        </div>
        <div className="divide-y divide-slate-100">
          {tracker.tasks.map((task) => (
            <div key={task.id} className="p-6 hover:bg-slate-50 transition-colors flex items-center justify-between group">
              <div className="flex items-start space-x-4">
                <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                  task.status === 'Completed' ? 'bg-emerald-500' : 
                  task.status === 'In Progress' ? 'bg-blue-500' :
                  task.status === 'Overdue' ? 'bg-rose-500' : 'bg-amber-500'
                }`} />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-800 group-hover:text-brand-primary transition-colors">{task.description}</p>
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-1.5">
                      <User size={12} className="text-slate-400" />
                      <span className="text-xs font-medium text-slate-500">{task.assignee}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-4 relative">
                <button
                  disabled={!onChangeTracker}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onChangeTracker) {
                      setActiveDropdownTaskId(activeDropdownTaskId === task.id ? null : task.id);
                    }
                  }}
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-150 ${
                    task.status === 'Completed' ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 
                    task.status === 'In Progress' ? 'bg-blue-50 border-blue-100 text-blue-600' :
                    task.status === 'Overdue' ? 'bg-rose-50 border-rose-100 text-rose-600' : 
                    'bg-amber-50 border-amber-100 text-amber-600'
                  } ${onChangeTracker ? 'hover:opacity-80 active:scale-95 cursor-pointer' : 'cursor-default'}`}
                >
                  {task.status}
                </button>

                {activeDropdownTaskId === task.id && (
                  <>
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveDropdownTaskId(null);
                      }} 
                    />
                    <div className="absolute right-0 mt-8 w-36 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20 animate-in fade-in slide-in-from-top-1 duration-150 text-left">
                      {(['Pending', 'In Progress', 'Completed', 'Overdue'] as const).map((status) => (
                        <button
                          key={status}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStatusChange(task.id, status);
                            setActiveDropdownTaskId(null);
                          }}
                          className={`w-full text-left px-4 py-2 text-[10px] font-black uppercase tracking-widest flex items-center space-x-2 hover:bg-slate-50 ${
                            task.status === status ? 'text-brand-primary bg-slate-50' : 'text-slate-600'
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full shrink-0 ${
                            status === 'Completed' ? 'bg-emerald-500' :
                            status === 'In Progress' ? 'bg-blue-500' :
                            status === 'Overdue' ? 'bg-rose-500' : 'bg-amber-500'
                          }`} />
                          <span>{status}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          {tracker.tasks.length === 0 && (
            <div className="p-12 text-center">
              <p className="text-slate-400 text-sm italic">No tasks found for execution tracking.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExecutionTrackerView;
