import React from 'react';
import { Mic, Cpu, GitBranch, Users, CheckCircle2, Database, ArrowRight } from 'lucide-react';

interface ProductMemoryFlowProps {
  className?: string;
  theme?: 'dark' | 'light';
  title?: string;
}

export const ProductMemoryFlow: React.FC<ProductMemoryFlowProps> = ({ 
  className = '', 
  theme = 'dark',
  title = "How EchoNote Builds Organizational Memory"
}) => {
  const steps = [
    { name: "Conversation", icon: <Mic size={16} />, color: "text-blue-400 bg-blue-500/10 border-blue-500/30", label: "Spoken Input" },
    { name: "Decision", icon: <Cpu size={16} />, color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30", label: "Agreement Isolated" },
    { name: "Context", icon: <GitBranch size={16} />, color: "text-purple-400 bg-purple-500/10 border-purple-500/30", label: "Why & Rationale" },
    { name: "Owner", icon: <Users size={16} />, color: "text-sky-400 bg-sky-500/10 border-sky-500/30", label: "Accountability" },
    { name: "Execution", icon: <CheckCircle2 size={16} />, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", label: "Follow-through" },
    { name: "Memory", icon: <Database size={16} />, color: "text-amber-400 bg-amber-500/10 border-amber-500/30", label: "Persistent Record" },
  ];

  const isDark = theme === 'dark';

  return (
    <div className={`p-6 sm:p-8 rounded-3xl border ${isDark ? 'bg-slate-900 border-slate-800 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'} ${className}`}>
      {title && (
        <div className="text-center mb-6">
          <span className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
            Product Memory Pipeline
          </span>
          <h3 className={`text-xl sm:text-2xl font-bold mt-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {title}
          </h3>
        </div>
      )}

      {/* Pipeline Chain */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {steps.map((step, idx) => (
          <div 
            key={step.name} 
            className={`relative p-3.5 rounded-2xl border flex flex-col items-center text-center space-y-2 transition-all ${
              isDark ? 'bg-slate-800/80 border-slate-700/80' : 'bg-white border-slate-200 shadow-sm'
            }`}
          >
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${step.color}`}>
              {step.icon}
            </div>
            <div>
              <div className={`text-xs font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                {step.name}
              </div>
              <div className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'} mt-0.5`}>
                {step.label}
              </div>
            </div>
            {idx < steps.length - 1 && (
              <div className="hidden lg:block absolute -right-3.5 top-1/2 -translate-y-1/2 text-slate-500 z-10">
                <ArrowRight size={12} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProductMemoryFlow;
