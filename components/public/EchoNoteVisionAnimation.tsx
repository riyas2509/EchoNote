import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { 
  Mic, 
  Sparkles, 
  CheckCircle2, 
  Users, 
  ArrowRight, 
  Database, 
  RotateCcw, 
  Play, 
  Pause,
  GitBranch,
  ShieldCheck,
  Clock,
  Layers,
  Check,
  MessageSquare
} from 'lucide-react';

interface EchoNoteVisionAnimationProps {
  className?: string;
  autoPlay?: boolean;
}

type AnimationPhase = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const EchoNoteVisionAnimation: React.FC<EchoNoteVisionAnimationProps> = ({
  className = '',
  autoPlay = true
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<AnimationPhase>(shouldReduceMotion ? 7 : 1);
  const [isPlaying, setIsPlaying] = useState(!shouldReduceMotion && autoPlay);
  const [hasCompletedOnce, setHasCompletedOnce] = useState(shouldReduceMotion ? true : false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Phase durations in milliseconds
  const phaseDurations: Record<AnimationPhase, number> = {
    1: 2200, // Conversation
    2: 2000, // Understanding
    3: 2000, // Decision
    4: 1800, // Ownership
    5: 2200, // Execution
    6: 2200, // Memory
    7: 0     // Final stable EchoNote state
  };

  const stepsConfig = [
    { id: 1 as const, name: 'Conversation', label: 'Spoken Dialogue', icon: <Mic size={14} /> },
    { id: 2 as const, name: 'Understanding', label: 'AI Synthesis', icon: <Sparkles size={14} /> },
    { id: 3 as const, name: 'Decision', label: 'Agreement Isolated', icon: <CheckCircle2 size={14} /> },
    { id: 4 as const, name: 'Ownership', label: 'Accountability', icon: <Users size={14} /> },
    { id: 5 as const, name: 'Execution', label: 'Follow-Through', icon: <GitBranch size={14} /> },
    { id: 6 as const, name: 'Memory', label: 'Persistent Knowledge', icon: <Database size={14} /> },
  ];

  // Progression logic
  useEffect(() => {
    if (shouldReduceMotion) {
      setPhase(7);
      setHasCompletedOnce(true);
      setIsPlaying(false);
      return;
    }

    if (!isPlaying) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    if (phase < 7) {
      const duration = phaseDurations[phase];
      timerRef.current = setTimeout(() => {
        setPhase((prev) => {
          const next = (prev + 1) as AnimationPhase;
          if (next === 7) {
            setIsPlaying(false);
            setHasCompletedOnce(true);
          }
          return next;
        });
      }, duration);
    } else {
      setIsPlaying(false);
      setHasCompletedOnce(true);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, isPlaying, shouldReduceMotion]);

  const handleManualPhase = (targetPhase: AnimationPhase) => {
    setIsPlaying(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase(targetPhase);
  };

  const handleReplay = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase(1);
    setIsPlaying(true);
  };

  return (
    <div 
      className={`w-full max-w-5xl mx-auto rounded-3xl bg-slate-900 border border-slate-800 text-white shadow-2xl overflow-hidden relative ${className}`}
      aria-label="EchoNote Brand & Decision Memory Vision Animation"
    >
      {/* Background ambient lighting */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none -z-0" />
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none -z-0" />

      {/* Top Bar: Concept Breadcrumb & Interactive Controls */}
      <div className="px-6 py-4 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3 relative z-10 bg-slate-900/60 backdrop-blur-sm">
        <div className="flex items-center space-x-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
            Vision Architecture
          </span>
          <span className="text-slate-600 text-xs">•</span>
          <span className="text-slate-300 text-xs font-medium">
            How Conversations Become Organizational Memory
          </span>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center space-x-2 text-xs">
          {phase < 7 ? (
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center space-x-1.5 border border-slate-700"
              title={isPlaying ? "Pause animation" : "Resume animation"}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} />}
              <span className="text-[11px] font-medium">{isPlaying ? 'Pause' : 'Play'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReplay}
              className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 transition-colors flex items-center space-x-1.5 border border-blue-500/30"
              title="Replay vision flow"
            >
              <RotateCcw size={12} />
              <span className="text-[11px] font-medium">Replay Vision</span>
            </button>
          )}

          <div className="text-[11px] font-mono text-slate-400 pl-1">
            {phase === 7 ? 'RESOLVED' : `STAGE ${phase}/6`}
          </div>
        </div>
      </div>

      {/* Main Interactive Stage */}
      <div className="p-6 sm:p-10 relative z-10 min-h-[360px] sm:min-h-[380px] flex flex-col justify-between">
        
        {/* Active Stage Render */}
        <div className="w-full my-auto">
          <AnimatePresence mode="wait">
            
            {/* ========================================================================= */}
            {/* PHASE 1: CONVERSATION (Subtle dialogue nodes & spoken exchange)          */}
            {/* ========================================================================= */}
            {phase === 1 && (
              <motion.div
                key="phase-1"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4 }}
                className="space-y-6 text-center"
              >
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider">
                  <Mic size={13} />
                  <span>Phase 1 — Spoken Conversation</span>
                </div>

                <div className="max-w-xl mx-auto space-y-2">
                  <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Conversations happen every day across your organization.
                  </h3>
                  <p className="text-sm text-slate-400">
                    Ideas are debated, trade-offs are evaluated, and crucial agreements are spoken out loud.
                  </p>
                </div>

                {/* Abstract Conversation Signals Visual */}
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2 max-w-2xl mx-auto">
                  {[
                    { speaker: "Speaker 1", text: "Should we move enterprise pricing to annual billing?" },
                    { speaker: "Speaker 2", text: "It improves ARR predictability and procurement cycles." },
                    { speaker: "Speaker 3", text: "Let's commit to launching it next quarter." }
                  ].map((item, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, scale: 0.9, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ delay: idx * 0.25, duration: 0.4 }}
                      className="px-4 py-2.5 rounded-2xl bg-slate-800/90 border border-slate-700/80 text-left space-y-1 shadow-md"
                    >
                      <div className="flex items-center space-x-2 text-[10px] font-bold uppercase tracking-wider text-blue-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span>{item.speaker}</span>
                      </div>
                      <p className="text-xs text-slate-200 font-medium italic">
                        "{item.text}"
                      </p>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ========================================================================= */}
            {/* PHASE 2: AI UNDERSTANDING (Semantic synthesis & clustering)               */}
            {/* ========================================================================= */}
            {phase === 2 && (
              <motion.div
                key="phase-2"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4 }}
                className="space-y-6 text-center"
              >
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
                  <Sparkles size={13} />
                  <span>Phase 2 — AI Understanding & Synthesis</span>
                </div>

                <div className="max-w-xl mx-auto space-y-2">
                  <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    EchoNote filters noise and identifies the core intent.
                  </h3>
                  <p className="text-sm text-slate-400">
                    Natural language intelligence maps spoken discourse into structured points of agreement and trade-offs.
                  </p>
                </div>

                {/* Synthesis Converging Nodes */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto pt-2">
                  <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-indigo-500/30 text-left space-y-1">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Semantic Parse</span>
                    <p className="text-xs text-slate-200 font-semibold">Agreement Detected</p>
                    <p className="text-[11px] text-slate-400 leading-tight">Consensus reached on contract structure.</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/50 text-left space-y-1 relative">
                    <span className="text-[10px] font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1">
                      <Sparkles size={11} />
                      Synthesizing
                    </span>
                    <p className="text-xs text-white font-semibold">Strategic Rationale</p>
                    <p className="text-[11px] text-indigo-200 leading-tight">Predictability over quarterly churn risk.</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-800/80 border border-indigo-500/30 text-left space-y-1">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Accountability</span>
                    <p className="text-xs text-slate-200 font-semibold">Owner Designated</p>
                    <p className="text-[11px] text-slate-400 leading-tight">Action assigned to Revenue Operations.</p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ========================================================================= */}
            {/* PHASE 3: DECISION (Clear, authoritative decision object)                 */}
            {/* ========================================================================= */}
            {phase === 3 && (
              <motion.div
                key="phase-3"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4 }}
                className="space-y-6 text-center"
              >
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs font-semibold uppercase tracking-wider">
                  <CheckCircle2 size={13} className="text-blue-400" />
                  <span>Phase 3 — Decision Formulated</span>
                </div>

                <div className="max-w-xl mx-auto space-y-2">
                  <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    The conversation crystallizes into an explicit decision.
                  </h3>
                  <p className="text-sm text-slate-400">
                    No ambiguity. The chosen path and the underlying rationale are locked in with high fidelity.
                  </p>
                </div>

                {/* Structured Decision Card */}
                <div className="max-w-lg mx-auto p-5 rounded-2xl bg-slate-800/95 border border-blue-500/40 text-left space-y-3 shadow-xl">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-400" />
                      Key Decision
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">Timestamp: 42:18</span>
                  </div>
                  <div className="text-base font-bold text-white leading-snug">
                    Move enterprise tier to mandatory annual billing contracts.
                  </div>
                  <div className="pt-2 border-t border-slate-700/80 flex items-center justify-between text-xs text-slate-300">
                    <span><strong>Why:</strong> Protect annual cash flow predictability</span>
                    <span className="text-emerald-400 font-medium">Consensus: Unanimous</span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ========================================================================= */}
            {/* PHASE 4: OWNERSHIP (Accountability attached)                             */}
            {/* ========================================================================= */}
            {phase === 4 && (
              <motion.div
                key="phase-4"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4 }}
                className="space-y-6 text-center"
              >
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-semibold uppercase tracking-wider">
                  <Users size={13} className="text-sky-400" />
                  <span>Phase 4 — Assigned Ownership & Accountability</span>
                </div>

                <div className="max-w-xl mx-auto space-y-2">
                  <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Every decision has a named owner and clear deliverables.
                  </h3>
                  <p className="text-sm text-slate-400">
                    Eliminate the "who was supposed to do that?" breakdown before the meeting adjourns.
                  </p>
                </div>

                {/* Owner Attachment Visualization */}
                <div className="max-w-lg mx-auto p-5 rounded-2xl bg-slate-800/90 border border-sky-500/30 text-left space-y-3 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assigned Team / Lead</span>
                      <div className="text-base font-bold text-white flex items-center gap-2">
                        <Users size={16} className="text-sky-400" />
                        <span>Revenue Operations</span>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[11px] font-semibold">
                      Owner Designated
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700/80 text-xs text-slate-300 space-y-1">
                    <div className="font-semibold text-white">Action Commitment:</div>
                    <p className="text-slate-400 leading-snug">
                      Update MSA contract templates and coordinate billing gateway configurations by Sep 02.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ========================================================================= */}
            {/* PHASE 5: EXECUTION (Progression tracker through completion)             */}
            {/* ========================================================================= */}
            {phase === 5 && (
              <motion.div
                key="phase-5"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4 }}
                className="space-y-6 text-center"
              >
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold uppercase tracking-wider">
                  <GitBranch size={13} className="text-emerald-400" />
                  <span>Phase 5 — Execution & Follow-Through</span>
                </div>

                <div className="max-w-xl mx-auto space-y-2">
                  <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Track the arc from discussion to implementation.
                  </h3>
                  <p className="text-sm text-slate-400">
                    Maintain visibility on how the decision unfolded across subsequent weeks.
                  </p>
                </div>

                {/* Progression Flow Timeline */}
                <div className="max-w-2xl mx-auto p-4 sm:p-5 rounded-2xl bg-slate-800/90 border border-emerald-500/30 space-y-3 text-left">
                  <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-700">
                    <span className="font-bold text-emerald-400 uppercase tracking-wider">Implementation Milestone Trail</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">Complete</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 space-y-1">
                      <div className="flex items-center gap-1.5 text-blue-400 font-bold text-[11px]">
                        <Check size={12} />
                        <span>Aug 18 • Formulated</span>
                      </div>
                      <p className="text-slate-300 text-[11px]">Agreement reached in Strategy Review.</p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-700/80 space-y-1">
                      <div className="flex items-center gap-1.5 text-indigo-400 font-bold text-[11px]">
                        <Check size={12} />
                        <span>Aug 21 • In Progress</span>
                      </div>
                      <p className="text-slate-300 text-[11px]">Contract templates finalized by Legal.</p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 space-y-1">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                        <CheckCircle2 size={12} />
                        <span>Sep 02 • Implemented</span>
                      </div>
                      <p className="text-emerald-200 text-[11px]">Live in enterprise sales agreements.</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ========================================================================= */}
            {/* PHASE 6: MEMORY (Persistent organizational knowledge registry)            */}
            {/* ========================================================================= */}
            {phase === 6 && (
              <motion.div
                key="phase-6"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.4 }}
                className="space-y-6 text-center"
              >
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold uppercase tracking-wider">
                  <Database size={13} className="text-amber-400" />
                  <span>Phase 6 — Persistent Organizational Memory</span>
                </div>

                <div className="max-w-xl mx-auto space-y-2">
                  <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    The conversation becomes indelible institutional memory.
                  </h3>
                  <p className="text-sm text-slate-400">
                    Months later, any team member can query what was decided, why, and who was responsible.
                  </p>
                </div>

                {/* Persistent Memory Registry Card */}
                <div className="max-w-xl mx-auto p-5 rounded-2xl bg-slate-800/90 border border-amber-500/40 text-left space-y-3 shadow-2xl">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Database size={13} />
                      Connected Knowledge Graph
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">ID: DEC-2026-0818</span>
                  </div>
                  <div className="text-sm font-bold text-white">
                    "Why did we stop offering monthly billing for enterprise clients?"
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-700/80 text-xs text-slate-300 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Source: Pricing Strategy Review (42:18)</span>
                      <span className="text-emerald-400">Status: Verified Record</span>
                    </div>
                    <p className="text-slate-200">
                      Decided on Aug 18, 2026 to improve ARR predictability. Owned by Revenue Operations.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ========================================================================= */}
            {/* PHASE 7: ECHONOTE (Full brand resolution & core vision message)           */}
            {/* ========================================================================= */}
            {phase === 7 && (
              <motion.div
                key="phase-7"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="space-y-8 text-center"
              >
                {/* Brand Wordmark with subtle illumination */}
                <div className="space-y-3">
                  <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[11px] font-bold uppercase tracking-wider">
                    <ShieldCheck size={13} className="text-blue-400" />
                    <span>The Organizational Memory Platform</span>
                  </div>

                  <div className="flex items-center justify-center space-x-3">
                    <span className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white">
                      Echo<span className="text-blue-400">Note</span>
                    </span>
                  </div>

                  <div className="text-xl sm:text-2xl font-extrabold text-blue-100 tracking-tight">
                    Conversations fade. <span className="text-blue-400">EchoNote remembers.</span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto font-medium">
                    Decision & Execution Memory for Coordination-Heavy Teams
                  </p>
                </div>

                {/* Compact Pipeline Summary Chips */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 max-w-3xl mx-auto pt-2">
                  {stepsConfig.map((step) => (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => handleManualPhase(step.id)}
                      className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 transition-all flex flex-col items-center text-center space-y-1 group"
                    >
                      <div className="text-blue-400 group-hover:text-blue-300">
                        {step.icon}
                      </div>
                      <div className="text-[11px] font-bold text-slate-200 group-hover:text-white">
                        {step.name}
                      </div>
                      <div className="text-[9px] text-slate-400">
                        {step.label}
                      </div>
                    </button>
                  ))}
                </div>

              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Bottom Interactive Step Scrubber */}
        <div className="pt-8 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* Step Pill Indicators */}
          <div className="flex items-center space-x-1.5 sm:space-x-2 overflow-x-auto max-w-full pb-1 sm:pb-0">
            {stepsConfig.map((step) => {
              const isActive = phase === step.id;
              const isPast = phase > step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => handleManualPhase(step.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400'
                      : isPast
                      ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      : 'bg-slate-900/60 text-slate-500 hover:text-slate-400 hover:bg-slate-800/40'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : isPast ? 'bg-blue-400' : 'bg-slate-600'}`} />
                  <span>{step.name}</span>
                </button>
              );
            })}
            
            <button
              type="button"
              onClick={() => handleManualPhase(7)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 whitespace-nowrap ${
                phase === 7
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                  : 'bg-slate-900/60 text-slate-500 hover:text-slate-300'
              }`}
            >
              <span>EchoNote</span>
            </button>
          </div>

          {/* Quick Caption */}
          <div className="text-[11px] text-slate-400 text-center sm:text-right">
            <span>Decision Provenance & Institutional Memory</span>
          </div>

        </div>

      </div>
    </div>
  );
};

export default EchoNoteVisionAnimation;
