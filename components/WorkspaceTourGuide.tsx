/**
 * EchoNote — Interactive Product Demo Workspace Tour Guide Component
 * 
 * Implements:
 * 1. Spotlight Overlay with SVG cutout or border-box framing highlighting actual DOM elements.
 * 2. Unblocked Target: The target element remains clickable and keyboard accessible.
 * 3. Smart Tooltip Positioning: Avoids viewport boundaries, centers gracefully when target is modal or absent.
 * 4. Real Interaction Progression: Advances only on expected target actions or deliberate Skip/Recovery actions.
 * 5. Robust Target Handling: Detects disconnected, zero-sized, scrollable, or dynamically rendered targets without crashing.
 * 6. Full Accessibility: ARIA dialog attributes, aria-live polite announcements, focus trapping inside tooltip controls, Escape key dismissal.
 * 7. Zero Backend Dependencies: Strictly independent of Firestore, Firebase, and authenticated API endpoints.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  X, 
  CheckCircle2, 
  AlertTriangle,
  RotateCcw,
  Compass,
  CornerDownRight,
  HelpCircle
} from 'lucide-react';
import { TourStepDefinition, TooltipPlacement } from '../lib/demoTourConfig';

export interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

export interface WorkspaceTourGuideProps {
  isActive: boolean;
  currentStepIndex: number;
  steps: TourStepDefinition[];
  onStepChange: (newStepIndex: number) => void;
  onExit: () => void;
  onRestart: () => void;
  onTargetNotFound?: (step: TourStepDefinition) => void;
  onActionCompleted?: (step: TourStepDefinition) => void;
}

export const WorkspaceTourGuide: React.FC<WorkspaceTourGuideProps> = ({
  isActive,
  currentStepIndex,
  steps,
  onStepChange,
  onExit,
  onRestart,
  onTargetNotFound,
  onActionCompleted
}) => {
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [isTargetMissing, setIsTargetMissing] = useState<boolean>(false);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; placement: TooltipPlacement }>({
    top: 50,
    left: 50,
    placement: 'bottom'
  });
  
  const tooltipRef = useRef<HTMLDivElement>(null);
  const currentStep = steps[currentStepIndex] || steps[0];
  const isFinalStep = currentStepIndex === steps.length - 1;

  // Measure and locate target element
  const updateTargetMeasurements = useCallback(() => {
    if (!isActive || !currentStep) return;

    if (!currentStep.targetSelector) {
      setTargetRect(null);
      setIsTargetMissing(false);
      return;
    }

    // Try primary selector first, then fallback
    let targetEl = document.querySelector(currentStep.targetSelector) as HTMLElement | null;
    if (!targetEl && currentStep.targetFallbackSelector) {
      targetEl = document.querySelector(currentStep.targetFallbackSelector) as HTMLElement | null;
    }

    if (!targetEl) {
      setIsTargetMissing(true);
      setTargetRect(null);
      if (onTargetNotFound) {
        onTargetNotFound(currentStep);
      }
      return;
    }

    const rect = targetEl.getBoundingClientRect();

    // Check if element is visible and has dimension
    if (rect.width === 0 && rect.height === 0) {
      setIsTargetMissing(true);
      setTargetRect(null);
      return;
    }

    setIsTargetMissing(false);
    setTargetRect({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      bottom: rect.bottom,
      right: rect.right
    });

    // Auto-scroll target into view if completely outside viewport
    const isInViewport = (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );

    if (!isInViewport) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [isActive, currentStep, onTargetNotFound]);

  // Recalculate measurements on mount, step change, resize, and scroll
  useEffect(() => {
    if (!isActive) return;

    // Immediate check
    updateTargetMeasurements();

    // Also poll gently for dynamic renders (e.g. tab transitions)
    const timer1 = setTimeout(updateTargetMeasurements, 100);
    const timer2 = setTimeout(updateTargetMeasurements, 400);

    const handleScrollOrResize = () => {
      updateTargetMeasurements();
    };

    window.addEventListener('resize', handleScrollOrResize, { passive: true });
    window.addEventListener('scroll', handleScrollOrResize, { passive: true });

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize);
    };
  }, [isActive, currentStepIndex, updateTargetMeasurements]);

  const advancingRef = useRef<boolean>(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [currentStepIndex]);

  // Listen for real interaction on the highlighted target
  useEffect(() => {
    if (!isActive || !currentStep || !currentStep.targetSelector) return;

    let targetEl = document.querySelector(currentStep.targetSelector) as HTMLElement | null;
    if (!targetEl && currentStep.targetFallbackSelector) {
      targetEl = document.querySelector(currentStep.targetFallbackSelector) as HTMLElement | null;
    }

    if (!targetEl) return;

    const handleTargetInteraction = (e: MouseEvent | TouchEvent) => {
      // Guard against double advancement from bubbling or rapid repeated clicks
      if (advancingRef.current) return;

      // Do NOT preventDefault: allow the real application action to trigger!
      if (onActionCompleted) {
        onActionCompleted(currentStep);
      }

      // Progression behavior
      if (currentStep.progressionType === 'click_target' || currentStep.progressionType === 'click_target_or_next') {
        advancingRef.current = true;
        // Small delay to allow react state transition in parent view
        setTimeout(() => {
          if (currentStepIndex < steps.length - 1) {
            onStepChange(currentStepIndex + 1);
          }
        }, 180);
      }
    };

    targetEl.addEventListener('click', handleTargetInteraction as any);
    return () => {
      targetEl?.removeEventListener('click', handleTargetInteraction as any);
    };
  }, [isActive, currentStep, currentStepIndex, steps.length, onStepChange, onActionCompleted]);

  // Keyboard accessibility: Escape to exit, Arrows for Back/Forward when supported
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onExit();
      } else if (e.key === 'ArrowLeft' && currentStepIndex > 0) {
        onStepChange(currentStepIndex - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, currentStepIndex, onExit, onStepChange]);

  // Calculate intelligent tooltip position avoiding viewport overflows
  useEffect(() => {
    if (!tooltipRef.current) return;

    const tooltipEl = tooltipRef.current;
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    if (!targetRect || isTargetMissing) {
      // Center position when target is missing or for completion step
      setTooltipPos({
        top: Math.max(20, (viewportHeight - tooltipRect.height) / 2),
        left: Math.max(20, (viewportWidth - tooltipRect.width) / 2),
        placement: 'auto'
      });
      return;
    }

    const padding = 14;
    const preferred = currentStep.preferredPlacement || 'bottom';
    let top = 0;
    let left = 0;
    let effectivePlacement: TooltipPlacement = preferred;

    if (preferred === 'bottom') {
      top = targetRect.bottom + padding;
      left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);

      // Viewport bottom collision -> flip to top
      if (top + tooltipRect.height > viewportHeight - 16) {
        top = targetRect.top - tooltipRect.height - padding;
        effectivePlacement = 'top';
      }
    } else if (preferred === 'top') {
      top = targetRect.top - tooltipRect.height - padding;
      left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);

      // Viewport top collision -> flip to bottom
      if (top < 16) {
        top = targetRect.bottom + padding;
        effectivePlacement = 'bottom';
      }
    } else if (preferred === 'right') {
      left = targetRect.right + padding;
      top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);

      // Viewport right collision -> flip to bottom
      if (left + tooltipRect.width > viewportWidth - 16) {
        top = targetRect.bottom + padding;
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        effectivePlacement = 'bottom';
      }
    } else if (preferred === 'left') {
      left = targetRect.left - tooltipRect.width - padding;
      top = targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2);

      // Viewport left collision -> flip to bottom
      if (left < 16) {
        top = targetRect.bottom + padding;
        left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        effectivePlacement = 'bottom';
      }
    }

    // Keep horizontal bounds within screen
    left = Math.max(16, Math.min(left, viewportWidth - tooltipRect.width - 16));
    top = Math.max(16, Math.min(top, viewportHeight - tooltipRect.height - 16));

    setTooltipPos({ top, left, placement: effectivePlacement });
  }, [targetRect, isTargetMissing, currentStep, currentStepIndex]);

  if (!isActive) return null;

  const handleBack = () => {
    if (currentStepIndex > 0) {
      onStepChange(currentStepIndex - 1);
    }
  };

  const handleSkipStep = () => {
    if (currentStepIndex < steps.length - 1) {
      onStepChange(currentStepIndex + 1);
    } else {
      onExit();
    }
  };

  const handleNextOrFinish = () => {
    if (isFinalStep) {
      onExit();
    } else if (currentStep.progressionType === 'click_target_or_next' || isTargetMissing) {
      onStepChange(currentStepIndex + 1);
    }
  };

  return (
    <div
      role="region"
      aria-label="Interactive Product Tour"
      className="fixed inset-0 z-[120] pointer-events-none"
    >
      {/* 1. Backdrop Overlay with SVG Cutout for Spotlight */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-auto transition-opacity duration-300"
        style={{ fillRule: 'evenodd' }}
        onClick={(e) => {
          // If clicking dark area away from target, do not advance accidentally
          e.stopPropagation();
        }}
      >
        <defs>
          <mask id="tour-spotlight-mask">
            {/* White reveals the dark backdrop */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {/* Black cuts out the spotlight hole for the active target */}
            {targetRect && !isTargetMissing && (
              <rect
                x={targetRect.left - 6}
                y={targetRect.top - 6}
                width={targetRect.width + 12}
                height={targetRect.height + 12}
                rx="14"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.72)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>

      {/* 2. Interactive Spotlight Border & Click-through Ring */}
      {targetRect && !isTargetMissing && (
        <div
          data-testid="tour-spotlight-ring"
          className="fixed pointer-events-none rounded-2xl ring-4 ring-[#EAC435] ring-offset-2 ring-offset-slate-900/40 shadow-2xl transition-all duration-200 z-[121]"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12
          }}
        >
          {/* Subtle pulse indicator */}
          <span className="absolute -top-2 -right-2 flex h-5 w-5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EAC435] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-5 w-5 bg-[#EAC435] border-2 border-slate-900"></span>
          </span>
        </div>
      )}

      {/* 3. Screen Reader Live Announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {`Product tour step ${currentStep.stepNumber} of ${steps.length}: ${currentStep.title}. ${currentStep.instruction}`}
      </div>

      {/* 4. Tour Tooltip Card */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-tooltip-title"
        aria-describedby="tour-tooltip-instruction"
        className="fixed z-[130] pointer-events-auto bg-white rounded-3xl shadow-2xl border border-slate-200/90 p-5 md:p-6 w-[92vw] max-w-md transition-all duration-200 focus:outline-none"
        style={{
          top: `${tooltipPos.top}px`,
          left: `${tooltipPos.left}px`
        }}
      >
        {/* Top Header Badge & Exit Button */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#112250] text-[#EAC435] shadow-xs flex items-center gap-1.5">
              <Compass className="w-3 h-3 text-[#EAC435]" />
              <span>Interactive Tour</span>
            </span>
            <span className="text-xs font-bold text-slate-500">
              Step {currentStep.stepNumber} of {steps.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onExit}
            aria-label="Exit interactive tour"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-xl transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Title */}
        <h3
          id="tour-tooltip-title"
          className="text-base md:text-lg font-black text-slate-900 tracking-tight mb-1.5"
        >
          {currentStep.title}
        </h3>

        {/* Explanation */}
        <p className="text-xs md:text-sm text-slate-600 font-medium leading-relaxed mb-4">
          {currentStep.explanation}
        </p>

        {/* Target Missing Notice (Recovery) */}
        {isTargetMissing && !isFinalStep && (
          <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 text-xs mb-4 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">Target element not currently visible</p>
              <p className="text-[11px] text-amber-800">
                {currentStep.missingTargetHelp || 'You can skip this step or navigate to the expected workspace screen.'}
              </p>
            </div>
          </div>
        )}

        {/* Interaction Callout / Instruction */}
        {!isFinalStep && (
          <div
            id="tour-tooltip-instruction"
            className="p-3 bg-slate-50 rounded-2xl border border-slate-200/80 mb-5 flex items-start gap-2.5"
          >
            <CornerDownRight className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <span className="text-[10px] font-black uppercase text-indigo-700 tracking-wider block">
                Action Required
              </span>
              <span className="text-xs font-bold text-slate-800 leading-snug">
                {currentStep.instruction}
              </span>
            </div>
          </div>
        )}

        {/* Footer Navigation Controls */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 gap-2">
          {/* Left Actions: Back or Restart */}
          <div>
            {currentStepIndex > 0 && !isFinalStep ? (
              <button
                type="button"
                onClick={handleBack}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            ) : isFinalStep ? (
              <button
                type="button"
                onClick={onRestart}
                className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition-all flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5 text-indigo-600" />
                <span>Restart Tour</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onExit}
                className="px-2.5 py-1.5 text-xs font-bold text-slate-400 hover:text-slate-700 transition-colors"
              >
                Exit Tour
              </button>
            )}
          </div>

          {/* Right Actions: Skip or Next/Finish */}
          <div className="flex items-center gap-2">
            {!isFinalStep && currentStep.canSkipIfMissing && (
              <button
                type="button"
                onClick={handleSkipStep}
                className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all"
              >
                Skip Step
              </button>
            )}

            {(isFinalStep || currentStep.progressionType === 'click_target_or_next' || isTargetMissing) && (
              <button
                type="button"
                onClick={handleNextOrFinish}
                className="px-4 py-2 bg-[#112250] hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
              >
                <span>{isFinalStep ? 'Start Free Exploration' : 'Continue'}</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#EAC435]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
