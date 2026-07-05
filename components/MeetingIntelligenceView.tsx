
import React from 'react';
import { Target, Zap, Lightbulb, CheckCircle, AlertTriangle, Sparkles, TrendingUp, Info } from 'lucide-react';
import { motion } from 'motion/react';
import { MeetingIntelligence } from '../types';

interface MeetingIntelligenceViewProps {
  intelligence: MeetingIntelligence;
}

const MeetingIntelligenceView: React.FC<MeetingIntelligenceViewProps> = ({ intelligence }) => {
  const scores = [
    { 
      label: 'Productivity', 
      score: intelligence.productivityScore, 
      explanation: intelligence.productivityExplanation,
      icon: <Zap size={20} className="text-amber-500" />,
      color: 'bg-amber-500'
    },
    { 
      label: 'Clarity', 
      score: intelligence.clarityScore, 
      explanation: intelligence.clarityExplanation,
      icon: <Target size={20} className="text-blue-500" />,
      color: 'bg-blue-500'
    },
    { 
      label: 'Actionability', 
      score: intelligence.actionabilityScore, 
      explanation: intelligence.actionabilityExplanation,
      icon: <TrendingUp size={20} className="text-emerald-500" />,
      color: 'bg-emerald-500'
    }
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Overall Effectiveness */}
      <div className="bg-brand-primary/5 border border-brand-primary/10 rounded-2xl p-8 space-y-4">
        <div className="flex items-center space-x-3">
          <Sparkles size={24} className="text-brand-primary" />
          <h3 className="text-xl font-bold text-brand-primary uppercase tracking-widest">Meeting Effectiveness</h3>
        </div>
        <p className="text-slate-700 text-lg leading-relaxed font-medium italic">
          "{intelligence.effectivenessSummary}"
        </p>
      </div>

      {/* Scores Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {scores.map((s, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 flex flex-col"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {s.icon}
                <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest">{s.label}</h4>
              </div>
              <div className="text-2xl font-black text-slate-900">{s.score}<span className="text-xs text-slate-400 font-bold">/100</span></div>
            </div>
            
            {/* Progress Bar */}
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${s.score}%` }}
                transition={{ duration: 1, delay: 0.5 }}
                className={`h-full ${s.color}`}
              />
            </div>

            <div className="flex-1">
              <div className="flex items-start space-x-2">
                <Info size={14} className="text-slate-400 mt-1 flex-shrink-0" />
                <p className="text-slate-600 text-xs font-medium leading-relaxed italic">
                  {s.explanation}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 space-y-6">
          <div className="flex items-center space-x-3 border-b border-slate-100 pb-4">
            <CheckCircle size={20} className="text-emerald-500" />
            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Key Strengths</h4>
          </div>
          <ul className="space-y-4">
            {intelligence.keyStrengths.map((strength, i) => (
              <li key={i} className="flex items-start space-x-3 text-sm font-medium text-slate-600 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 flex-shrink-0" />
                <span>{strength}</span>
              </li>
            ))}
            {intelligence.keyStrengths.length === 0 && (
              <li className="text-slate-400 text-sm italic">No specific strengths identified.</li>
            )}
          </ul>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-8 space-y-6">
          <div className="flex items-center space-x-3 border-b border-slate-100 pb-4">
            <AlertTriangle size={20} className="text-amber-500" />
            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-widest">Key Weaknesses</h4>
          </div>
          <ul className="space-y-4">
            {intelligence.keyWeaknesses.map((weakness, i) => (
              <li key={i} className="flex items-start space-x-3 text-sm font-medium text-slate-600 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-2 flex-shrink-0" />
                <span>{weakness}</span>
              </li>
            ))}
            {intelligence.keyWeaknesses.length === 0 && (
              <li className="text-slate-400 text-sm italic">No specific weaknesses identified.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default MeetingIntelligenceView;
