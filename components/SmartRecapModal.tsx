import React, { useState } from 'react';
import { Sparkles, Users, CheckCircle2, Copy, Check, X, Shield, ArrowUpRight, Clock, Target, Calendar, UserCheck } from 'lucide-react';
import { SmartRecap, TaggedTeamMember } from '../types';

interface SmartRecapModalProps {
  isOpen: boolean;
  onClose: () => void;
  recap: SmartRecap | null;
  recordingTitle?: string;
  isGenerating?: boolean;
  onRegenerate?: () => void;
}

export const SmartRecapModal: React.FC<SmartRecapModalProps> = ({
  isOpen,
  onClose,
  recap,
  recordingTitle,
  isGenerating,
  onRegenerate
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedMember, setCopiedMember] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopySummary = () => {
    if (!recap) return;
    const text = [
      `📋 AI SMART RECAP: ${recordingTitle || recap.meetingTopic || 'Meeting Intelligence'}`,
      `Generated: ${new Date(recap.generatedAt).toLocaleString()}`,
      '',
      '📌 3-BULLET EXECUTIVE SUMMARY:',
      ...recap.executiveSummary.map((b, i) => `${i + 1}. ${b}`),
      '',
      '👥 TAGGED TEAM MEMBERS & OWNERSHIP:',
      ...recap.taggedMembers.map(m => `- @${m.name} (${m.role || 'Member'}): ${m.reason}${m.actionItems?.length ? ` [Tasks: ${m.actionItems.join('; ')}]` : ''}`)
    ].join('\n');

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopyMemberTag = (member: TaggedTeamMember) => {
    const text = `@${member.name} (${member.role || 'Member'}): ${member.reason}`;
    navigator.clipboard.writeText(text);
    setCopiedMember(member.name);
    setTimeout(() => setCopiedMember(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-indigo-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shadow-inner">
              <Sparkles className="w-5 h-5 text-indigo-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black uppercase tracking-tight text-white">AI Smart Recap</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  3-Point Briefing
                </span>
              </div>
              <p className="text-xs text-indigo-200/70 truncate max-w-md font-medium">
                {recordingTitle || recap?.meetingTopic || 'Audio Recording Intelligence'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {recap && (
              <button
                onClick={handleCopySummary}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all active:scale-95"
                title="Copy Full Recap"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy Recap'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isGenerating ? (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 rounded-2xl border-4 border-indigo-500/20 border-t-indigo-600 animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-indigo-600 animate-pulse" />
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Synthesizing Executive Recap</h4>
                <p className="text-xs text-slate-500 max-w-sm">
                  Distilling transcript into a 3-point briefing and extracting member ownership tags via Gemini...
                </p>
              </div>
            </div>
          ) : !recap ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm text-slate-500 font-medium">No smart recap generated yet for this recording.</p>
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all inline-flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Generate AI Smart Recap</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Executive 3-Bullet Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-indigo-600" />
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">
                      3-Bullet Point Executive Briefing
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">
                    {recap.generatedAt ? new Date(recap.generatedAt).toLocaleDateString() : 'Live AI Synthesis'}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {recap.executiveSummary.map((bullet, idx) => {
                    const badgeLabels = ['Strategic Context', 'Key Decision & Consensus', 'Execution Trajectory'];
                    const badgeStyles = [
                      'bg-indigo-50 text-indigo-700 border-indigo-200',
                      'bg-emerald-50 text-emerald-700 border-emerald-200',
                      'bg-amber-50 text-amber-700 border-amber-200'
                    ];

                    return (
                      <div 
                        key={idx} 
                        className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80 hover:border-slate-300 transition-all space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${badgeStyles[idx] || badgeStyles[0]}`}>
                            Point {idx + 1}: {badgeLabels[idx] || 'Action Brief'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                        </div>
                        <p className="text-sm font-medium text-slate-800 leading-relaxed">
                          {bullet}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Tagged Team Members Section */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-600" />
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-900">
                      Automatically Tagged Team Members ({recap.taggedMembers?.length || 0})
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
                    Role & Accountability Matched
                  </span>
                </div>

                {(!recap.taggedMembers || recap.taggedMembers.length === 0) ? (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center">
                    <p className="text-xs text-slate-500 font-medium italic">
                      No specific individual members or owners were tagged in this recording.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {recap.taggedMembers.map((member, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-2xl bg-white border border-slate-200 hover:border-purple-300 hover:shadow-sm transition-all flex flex-col justify-between space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center text-xs font-black shrink-0 shadow-sm">
                              {member.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <h5 className="text-xs font-bold text-slate-900 truncate">
                                {member.name}
                              </h5>
                              <div className="flex items-center gap-1.5">
                                {member.role && (
                                  <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-100">
                                    {member.role}
                                  </span>
                                )}
                                {member.email && (
                                  <span className="text-[10px] text-slate-400 truncate max-w-[110px]" title={member.email}>
                                    {member.email}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={() => handleCopyMemberTag(member)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50 transition-all shrink-0"
                            title="Copy tag reference"
                          >
                            {copiedMember === member.name ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {/* Tag Reason */}
                        <div className="p-2 rounded-xl bg-purple-50/60 border border-purple-100/80 text-[11px] text-purple-950 font-medium leading-relaxed">
                          <span className="font-bold text-purple-800">Tagged for: </span>
                          {member.reason}
                        </div>

                        {/* Action items if any */}
                        {member.actionItems && member.actionItems.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-slate-100">
                            <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">
                              Assigned Items:
                            </span>
                            <ul className="space-y-1">
                              {member.actionItems.map((act, aIdx) => (
                                <li key={aIdx} className="text-[11px] text-slate-700 flex items-start gap-1.5">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                                  <span>{act}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <Shield className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>AI intelligence grounded in audio recording transcripts</span>
          </div>

          <div className="flex items-center gap-2">
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={isGenerating}
                className="px-3.5 py-2 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 font-bold transition-all disabled:opacity-50"
              >
                Re-synthesize
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
