
import React from 'react';
import { MessageSquareOff, ArrowRight, CheckCircle, AlertCircle } from 'lucide-react';
import { UnifiedUnresolvedTopic } from '../types';

interface UnresolvedTopicsDetectorProps {
  unresolvedTopics: UnifiedUnresolvedTopic[];
}

const UnresolvedTopicsDetector: React.FC<UnresolvedTopicsDetectorProps> = ({ unresolvedTopics = [] }) => {
  const topics = Array.isArray(unresolvedTopics) ? unresolvedTopics : [];
  
  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center space-x-5">
           <div className="w-14 h-14 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-500 shadow-sm border border-rose-100/50">
            <MessageSquareOff size={28} />
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Unresolved Topics Detector</h3>
            <p className="text-[11px] text-slate-400 font-black tracking-[0.2em] uppercase">Identifying meaningful gaps and open discussions</p>
          </div>
        </div>
      </div>
      
      <div className="space-y-6">
        {topics.map((topic) => (
          <div 
            key={topic.id} 
            className="bg-white rounded-[20px] border border-[#f1f5f9] shadow-[0_6px_20px_rgba(0,0,0,0.04)] p-6 md:p-7 hover:shadow-[0_10px_30px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-300 group relative overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-[1.2fr,2fr,1.2fr] gap-8 items-start">
              
              {/* Left Section: Title + Status */}
              <div className="flex flex-col gap-4">
                <div className="w-11 h-11 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center shrink-0 border border-rose-100/50">
                  <AlertCircle size={22} />
                </div>
                <div className="space-y-2.5">
                  <h4 className="text-[20px] font-semibold text-[#111827] tracking-tight leading-tight group-hover:text-rose-600 transition-colors">
                    {topic.topic}
                  </h4>
                  <div className="pt-0.5">
                    <span className="bg-[rgba(255,77,79,0.08)] text-[#ef4444] px-3.5 py-1.5 rounded-full text-[12px] font-medium tracking-tight border border-rose-100/50 inline-block shadow-sm">
                      Pending Resolution
                    </span>
                  </div>
                </div>
              </div>

              {/* Center Section: Context + Gap */}
              <div className="flex flex-col gap-6 md:px-8 md:border-l border-[#f1f5f9]">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-[1.2px]">Context</p>
                  <p className="text-[14px] text-[#374151] font-medium leading-[1.6]">
                    {topic.context}
                  </p>
                </div>
                
                <div className="bg-[#fef2f2] border-l-3 border-[#ef4444] p-4 rounded-[10px] shadow-sm">
                  <p className="text-[14px] text-[#374151] font-bold leading-[1.6] italic">
                    "{topic.reasonUnresolved}"
                  </p>
                </div>
              </div>

              {/* Right Section: Action + Buttons */}
              <div className="flex flex-col gap-6 md:border-l border-[#f1f5f9] md:pl-8">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-[#9ca3af] uppercase tracking-[1.2px]">Suggested Action</p>
                  <p className="text-[14px] text-[#374151] font-bold leading-[1.6]">
                    {topic.suggestedAction}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5 pt-3">
                  <button className="flex-1 min-w-[90px] bg-[#111827] text-white px-4 py-2.5 rounded-[10px] text-[11px] font-bold uppercase tracking-wider hover:bg-slate-800 transition-all active:scale-95 shadow-md shadow-slate-900/10">
                    Resolve
                  </button>
                  <button className="flex-1 min-w-[90px] bg-[#eef2ff] text-[#3730a3] px-4 py-2.5 rounded-[10px] text-[11px] font-bold uppercase tracking-wider hover:bg-[#e0e7ff] transition-all active:scale-95">
                    Assign
                  </button>
                  <button className="w-full bg-transparent text-[#6b7280] px-3 py-2 rounded-[10px] text-[11px] font-bold uppercase tracking-wider hover:text-slate-600 hover:bg-slate-50 transition-all text-left flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                    Ignore
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
        
        {unresolvedTopics.length === 0 && (
          <div className="col-span-full bg-slate-50 rounded-3xl border border-dashed border-slate-200 p-16 text-center space-y-4">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle size={32} />
            </div>
            <div className="space-y-1">
              <h4 className="text-lg font-bold text-slate-800">Clear Skies</h4>
              <p className="text-slate-500 font-medium max-w-xs mx-auto">
                No unresolved topics detected. Every discussion point reached a definitive conclusion or decision.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UnresolvedTopicsDetector;
