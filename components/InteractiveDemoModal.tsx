import React, { useState } from 'react';
import { 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  X, 
  Video, 
  FileText, 
  CheckSquare, 
  AlertTriangle, 
  CalendarClock, 
  Activity,
  Layers,
  Info
} from 'lucide-react';

interface InteractiveDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DemoStep {
  step: number;
  stageName: string;
  title: string;
  description: string;
  badge: string;
  badgeColor: string;
  content: React.ReactNode;
}

export const InteractiveDemoModal: React.FC<InteractiveDemoModalProps> = ({
  isOpen,
  onClose
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Accessibility: Escape to dismiss, Arrow keys to navigate stages
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        setCurrentStepIndex(prev => Math.min(prev + 1, 5));
      } else if (e.key === 'ArrowLeft') {
        setCurrentStepIndex(prev => Math.max(prev - 1, 0));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const demoSteps: DemoStep[] = [
    {
      step: 1,
      stageName: 'Conversation Ingestion',
      title: '1. Zoom Cloud Sync & Meeting Session',
      badge: 'PROVENANCE VERIFIED',
      badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-200',
      description: 'Incoming customer demo or executive sync audio is ingested with tamper-evident provenance hashes and associated directly to a project.',
      content: (
        <div className="space-y-3">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-slate-900 flex items-center gap-2">
                <Video className="w-4 h-4 text-indigo-600" />
                <span>Enterprise API Migration Kickoff</span>
              </span>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                Synced via Zoom
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Participants: Sarah Connor (Engineering VP), Alex Chen (Platform Lead), Marcus Vance (Security Architect)
            </p>
            <div className="text-[11px] bg-white p-2.5 rounded-xl border border-slate-200/80 font-mono text-slate-600">
              SHA256: 8f4e2b01c3...d912 (Provenance Manifest Recorded)
            </div>
          </div>
        </div>
      )
    },
    {
      step: 2,
      stageName: 'Decision Intelligence',
      title: '2. Structured Decision Extraction',
      badge: 'CONSENSUS EXTRACTED',
      badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
      description: 'EchoNote extracts explicit decisions and commitments so leadership never wonders what was decided or why.',
      content: (
        <div className="space-y-3">
          <div className="p-4 bg-amber-50/50 rounded-2xl border border-amber-200 space-y-2">
            <div className="flex items-center gap-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-amber-600" />
              <span>Key Decision Made</span>
            </div>
            <h4 className="text-sm font-bold text-slate-900">
              Deprecate Legacy v1 Ingestion Pipeline by End of Q4
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Rationale: Security audit highlighted non-compliant token refresh schemes. The team agreed all clients must migrate to v2 OAuth tokens by Nov 30.
            </p>
            <div className="text-[11px] text-slate-500 pt-1 border-t border-amber-200/50 flex gap-4">
              <span><strong>Consensus:</strong> Unanimous</span>
              <span><strong>Stakeholder:</strong> Alex Chen</span>
            </div>
          </div>
        </div>
      )
    },
    {
      step: 3,
      stageName: 'Task & Ownership Assignment',
      title: '3. Meeting-Derived Tasks with Owners',
      badge: 'OWNERSHIP LOCKED',
      badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      description: 'Action items turn into concrete project tasks with clear owners and priority levels. No ambiguous shared ownership.',
      content: (
        <div className="space-y-3">
          <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-emerald-600" />
                <span>Issue Deprecation Notice to Tier-1 API Partners</span>
              </span>
              <span className="text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-bold">
                HIGH PRIORITY
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1">
              <div><strong>Owner:</strong> Sarah Connor</div>
              <div><strong>Start Date:</strong> Oct 15, 2026</div>
              <div><strong>Due Date:</strong> Oct 22, 2026</div>
              <div><strong>State:</strong> In Progress</div>
            </div>
          </div>
        </div>
      )
    },
    {
      step: 4,
      stageName: 'Deadlines & Prerequisite Dependencies',
      title: '4. Dependency Readiness & Blocking Alerts',
      badge: 'DEPENDENCY ENGINE',
      badgeColor: 'bg-rose-100 text-rose-800 border-rose-200',
      description: 'Tasks declare prerequisites. If prerequisite work slips, the execution engine proactively marks dependents as blocked and flags deadline risks.',
      content: (
        <div className="space-y-3">
          <div className="p-4 bg-rose-50/60 rounded-2xl border border-rose-200 space-y-2">
            <div className="flex items-center gap-2 text-rose-900 font-bold text-xs uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Prerequisite Risk Detected</span>
            </div>
            <h4 className="text-xs font-bold text-slate-900">
              Task: "Publish Client SDK v2.4" is BLOCKED
            </h4>
            <p className="text-xs text-slate-600">
              Blocked by prerequisite: "Generate SHA256 Signing Keys" (Assigned to Marcus Vance — Due yesterday, overdue).
            </p>
            <div className="text-[11px] bg-white p-2 rounded-lg border border-rose-200/80 font-bold text-rose-700">
              Health score degraded to 72% • Exception automatically raised
            </div>
          </div>
        </div>
      )
    },
    {
      step: 5,
      stageName: 'Automated Follow-ups',
      title: '5. Follow-up Meeting Recommendations',
      badge: 'AUTOMATED GOVERNANCE',
      badgeColor: 'bg-purple-100 text-purple-800 border-purple-200',
      description: 'When blockers or overdue tasks threaten milestone health, EchoNote generates recommended follow-ups with pre-populated agendas.',
      content: (
        <div className="space-y-3">
          <div className="p-4 bg-purple-50/60 rounded-2xl border border-purple-200 space-y-2">
            <div className="flex items-center gap-2 text-purple-900 font-bold text-xs uppercase tracking-wider">
              <CalendarClock className="w-4 h-4 text-purple-600" />
              <span>Recommended Follow-up</span>
            </div>
            <h4 className="text-xs font-bold text-slate-900">
              API Migration Blockers Review (15 mins)
            </h4>
            <p className="text-xs text-slate-600">
              Agenda auto-generated: Resolve signing keys obstacle with Marcus Vance; unblock client SDK deployment.
            </p>
            <div className="text-[11px] text-purple-700 font-bold pt-1">
              Participants: Sarah Connor, Alex Chen, Marcus Vance
            </div>
          </div>
        </div>
      )
    },
    {
      step: 6,
      stageName: 'Execution Tracking',
      title: '6. Real-Time Project Health & Recovery',
      badge: 'CONTINUOUS ALIGNMENT',
      badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
      description: 'The Execution Tracking dashboard monitors progress continuously. Resolving an exception automatically clears the block and recovers health score.',
      content: (
        <div className="space-y-3">
          <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-2 shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-slate-500 tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                <span>Project Health Score</span>
              </span>
              <span className="text-xl font-black text-emerald-600">94%</span>
            </div>
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div className="bg-emerald-500 h-full w-[94%]" />
            </div>
            <p className="text-[11px] text-slate-500 pt-1">
              0 Critical Blockers • 1 Upcoming Milestone (3 days) • 14 Decisions Recorded
            </p>
          </div>
        </div>
      )
    }
  ];

  const currentStep = demoSteps[currentStepIndex];

  const handleNext = () => {
    if (currentStepIndex < demoSteps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      onClose();
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  return (
    <div 
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div 
        tabIndex={-1}
        className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] max-h-[92dvh] focus:outline-none"
      >
        {/* Banner with Clear "SAMPLE DATA" Watermark Badge */}
        <div className="bg-[#112250] text-white p-6 relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Exit interactive demo"
            className="absolute top-5 right-5 text-white/60 hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950 shadow-xs">
              Interactive Demo • Sample Data
            </span>
            <span className="text-xs text-white/60 font-semibold">
              Step {currentStep.step} of {demoSteps.length}
            </span>
          </div>

          <h2 id="demo-modal-title" className="text-xl md:text-2xl font-black tracking-tight text-white">
            {currentStep.title}
          </h2>
        </div>

        {/* Demo Content */}
        <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar flex-1 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Stage: {currentStep.stageName}
            </span>
            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${currentStep.badgeColor}`}>
              {currentStep.badge}
            </span>
          </div>

          <p className="text-xs md:text-sm text-slate-600 leading-relaxed font-medium">
            {currentStep.description}
          </p>

          <div className="pt-2">
            {currentStep.content}
          </div>

          <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl text-[11px] text-slate-500 font-medium">
            <Info className="w-4 h-4 text-indigo-500 shrink-0" />
            <span>Sample data is strictly isolated in this interactive overlay. No actual records or calendar events are generated.</span>
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="p-4 md:px-8 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
          >
            Exit Demo
          </button>

          <div className="flex items-center gap-2">
            {currentStepIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-all flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className="px-5 py-2.5 bg-[#112250] hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
            >
              <span>{currentStepIndex === demoSteps.length - 1 ? 'Finish Demo' : 'Next Stage'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
