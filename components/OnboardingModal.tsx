import React, { useState } from 'react';
import { 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  X, 
  Building2, 
  FolderTree, 
  Workflow, 
  HelpCircle,
  PlayCircle
} from 'lucide-react';
import { Project, UserProfile } from '../types';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onLaunchDemo: () => void;
  userProfile?: UserProfile;
  projects: Project[];
  currentOrg?: any;
  onCreateProject?: (name: string) => Promise<any>;
  onSelectProject?: (projectName: string) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  onLaunchDemo,
  userProfile,
  projects,
  currentOrg,
  onCreateProject,
  onSelectProject
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedExistingProject, setSelectedExistingProject] = useState<string>(
    projects.length > 0 ? projects[0].name : ''
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projectError, setProjectError] = useState('');

  // Accessibility: Escape key dismisses the modal (called unconditionally before early returns to preserve hook ordering)
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const totalSteps = 5;

  const handleComplete = async () => {
    setIsSubmitting(true);
    setProjectError('');
    try {
      await onComplete();
    } catch (err: any) {
      setProjectError(err?.message || 'Failed to complete onboarding. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleCreateOrSelectProject = async () => {
    if (newProjectName.trim()) {
      setIsSubmitting(true);
      setProjectError('');
      try {
        if (onCreateProject) {
          await onCreateProject(newProjectName.trim());
          if (onSelectProject) onSelectProject(newProjectName.trim());
        }
        handleNext();
      } catch (err: any) {
        setProjectError(err?.message || 'Failed to create project');
      } finally {
        setIsSubmitting(false);
      }
    } else if (selectedExistingProject) {
      if (onSelectProject) onSelectProject(selectedExistingProject);
      handleNext();
    } else {
      setProjectError('Please name a new project or select an existing one.');
    }
  };

  return (
    <div 
      role="dialog" 
      aria-modal="true" 
      aria-labelledby="onboarding-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div 
        tabIndex={-1}
        className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] max-h-[90dvh] focus:outline-none"
      >
        {/* Top Header & Progress Indicator */}
        <div className="bg-[#112250] text-white p-6 relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Skip onboarding"
            className="absolute top-5 right-5 text-white/60 hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-widest text-amber-400">
            <Sparkles className="w-4 h-4" />
            <span>Welcome to EchoNote</span>
          </div>

          <h2 id="onboarding-title" className="text-xl md:text-2xl font-black tracking-tight text-white">
            {currentStep === 1 && "The Coordination Layer for High-Stakes Teams"}
            {currentStep === 2 && "Your Workspace & Organization"}
            {currentStep === 3 && "Projects Connect Everything"}
            {currentStep === 4 && "Turn Conversations into Real Execution"}
            {currentStep === 5 && "You're All Set!"}
          </h2>

          {/* Stepper Dots */}
          <div className="flex items-center gap-2 mt-4">
            {Array.from({ length: totalSteps }).map((_, idx) => {
              const stepNumber = idx + 1;
              const isActive = stepNumber === currentStep;
              const isPast = stepNumber < currentStep;
              return (
                <div
                  key={stepNumber}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    isActive 
                      ? 'w-8 bg-amber-400' 
                      : isPast 
                      ? 'w-4 bg-white/60' 
                      : 'w-2 bg-white/20'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar flex-1 space-y-6 text-slate-700">
          {/* STEP 1: WELCOME & VALUE PROPOSITION */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <p className="text-sm md:text-base leading-relaxed text-slate-600 font-medium">
                EchoNote turns conversations into structured organizational memory: verified decisions, clear task ownership, deadline tracking, and automated follow-ups.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 space-y-1.5">
                  <span className="font-bold text-xs uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
                    <Workflow className="w-4 h-4 text-indigo-600" />
                    <span>No Lost Decisions</span>
                  </span>
                  <p className="text-xs text-slate-600">
                    Never ask "who was supposed to do that?" or "what did we agree to?" again.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-100 space-y-1.5">
                  <span className="font-bold text-xs uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-amber-600" />
                    <span>Proactive Delivery</span>
                  </span>
                  <p className="text-xs text-slate-600">
                    Execution tracking automatically flags prerequisite blockers before milestones slip.
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-900">Want to see it in action first?</p>
                  <p className="text-[11px] text-slate-500">Explore our interactive sample scenario without touching real data.</p>
                </div>
                <button
                  type="button"
                  onClick={onLaunchDemo}
                  className="px-3.5 py-2 bg-amber-400 hover:bg-amber-500 text-slate-950 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-xs shrink-0"
                >
                  <PlayCircle className="w-4 h-4" />
                  <span>Launch Demo</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: WORKSPACE & TENANT CONTEXT */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <Building2 className="w-8 h-8 text-indigo-600 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {currentOrg?.name ? currentOrg.name : 'Personal Workspace'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {currentOrg?.id 
                      ? 'You are operating within an authenticated organization workspace.' 
                      : 'You are using your individual workspace. You can create or join an organization anytime.'}
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-600 font-medium">
                <p>
                  Workspaces provide strict tenant boundaries. All transcripts, task exceptions, and recordings are cryptographically isolated and governed by organization security policies (including SSO & MFA).
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: PROJECT CREATION & SELECTION */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600 font-medium">
                Projects are where conversations, action items, task templates, and risk metrics live together. Select an existing project or create your first one:
              </p>

              {projects.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                    Choose Existing Project
                  </label>
                  <select
                    value={selectedExistingProject}
                    onChange={(e) => setSelectedExistingProject(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-3 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                  {projects.length > 0 ? 'Or create a new one' : 'Create your first project'}
                </span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                  New Project Name
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g., Q4 Product Launch, Infrastructure Migration"
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                {projectError && (
                  <p className="text-xs text-rose-600 font-medium">{projectError}</p>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: WORKFLOW ARCHITECTURE */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600 font-medium">
                Here is the lifecycle of how EchoNote powers coordination:
              </p>

              <div className="space-y-2.5">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Meeting Ingestion</h4>
                    <p className="text-[11px] text-slate-500">Record locally or import Zoom Cloud recordings with cryptographic provenance manifests.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    2
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Decision & Action Extraction</h4>
                    <p className="text-[11px] text-slate-500">AI extracts structured decisions, unblocks, and concrete task assignments with owners.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    3
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Deadline & Dependency Engine</h4>
                    <p className="text-[11px] text-slate-500">Background workers evaluate milestone dependencies, raise exceptions on delays, and recommend follow-ups.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: READY TO ENTER */}
          {currentStep === 5 && (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border-2 border-emerald-200">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-black text-slate-900">Ready to enter your workspace!</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Your profile and project workspace are initialized. You can revisit this walkthrough or launch the interactive demo anytime from the Topbar.
                </p>
              </div>

              {projectError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center justify-between gap-2 max-w-sm mx-auto text-left">
                  <span>{projectError}</span>
                  <button 
                    type="button" 
                    onClick={() => setProjectError('')}
                    className="text-red-500 hover:text-red-700 p-0.5"
                    aria-label="Dismiss error"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 md:px-8 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between">
          <div>
            {currentStep > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-all flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {currentStep < totalSteps && (
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-bold text-slate-500 hover:text-slate-700"
              >
                Skip
              </button>
            )}

            {currentStep === 3 ? (
              <button
                type="button"
                onClick={handleCreateOrSelectProject}
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Saving...' : 'Continue'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : currentStep < totalSteps ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleComplete}
                disabled={isSubmitting}
                className="px-6 py-2.5 bg-[#112250] hover:bg-slate-900 text-amber-400 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Entering...' : 'Enter Workspace'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
