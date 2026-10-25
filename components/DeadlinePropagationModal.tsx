import React, { useEffect, useRef } from 'react';
import { 
  AlertTriangle, 
  ArrowRight, 
  Calendar, 
  CalendarClock, 
  CheckCircle2, 
  Info, 
  Loader2, 
  X, 
  AlertCircle 
} from 'lucide-react';
import { PropagationPreviewResult } from '../lib/taskScheduling.ts';

export interface DeadlinePropagationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoadingPreview: boolean;
  isExecuting: boolean;
  targetTaskTitle: string;
  proposedDate: {
    startDate?: string;
    dueDate?: string;
  };
  preview: PropagationPreviewResult | null;
  error: string | null;
  onRefreshPreview?: () => void;
}

export const DeadlinePropagationModal: React.FC<DeadlinePropagationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isLoadingPreview,
  isExecuting,
  targetTaskTitle,
  proposedDate,
  preview,
  error,
  onRefreshPreview
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExecuting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    if (confirmBtnRef.current && !isLoadingPreview && preview && !preview.hasConflicts) {
      confirmBtnRef.current.focus();
    }

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExecuting, isLoadingPreview, preview, onClose]);

  if (!isOpen) return null;

  const downstreamTasks = (preview?.affectedTasks || []).filter(t => !t.isDirectTarget);
  const downstreamCount = downstreamTasks.length;
  const hasConflicts = preview?.hasConflicts || (preview?.affectedCompletedTasks && preview.affectedCompletedTasks.length > 0);
  const hasUnresolved = preview?.unresolvedTasks && preview.unresolvedTasks.length > 0;
  const isExecutionDisabled = isExecuting || isLoadingPreview || hasConflicts || hasUnresolved || !preview;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deadline-propagation-title"
    >
      <div 
        ref={modalRef}
        className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h2 id="deadline-propagation-title" className="text-base font-black text-slate-900">
                Deadline Change & Downstream Impact
              </h2>
              <p className="text-xs text-slate-500">
                Review how updating this schedule affects dependent tasks
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isExecuting}
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Target Task Summary Card */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target Task</span>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-black text-slate-900">{targetTaskTitle}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
                  {proposedDate.startDate !== undefined && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      Proposed Start: <strong className="text-slate-800">{proposedDate.startDate || 'Cleared'}</strong>
                    </span>
                  )}
                  {proposedDate.dueDate !== undefined && (
                    <span className="flex items-center gap-1">
                      <CalendarClock className="w-3.5 h-3.5 text-indigo-500" />
                      Proposed Due: <strong className="text-indigo-900">{proposedDate.dueDate || 'Cleared'}</strong>
                    </span>
                  )}
                </div>
              </div>
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] font-bold rounded-md shrink-0">
                Direct Target
              </span>
            </div>
          </div>

          {/* Loading Preview Spinner */}
          {isLoadingPreview && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-xs font-bold text-slate-600">Analyzing dependency graph and calculating shifts...</p>
            </div>
          )}

          {/* Error Message Alert */}
          {error && !isLoadingPreview && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-xs text-red-800">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Unable to apply deadline changes</p>
                <p>{error}</p>
                {onRefreshPreview && (
                  <button
                    type="button"
                    onClick={onRefreshPreview}
                    className="mt-2 px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-bold rounded text-[11px] transition-colors"
                  >
                    Refresh Preview
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Server Conflicts Alert */}
          {preview && preview.hasConflicts && !isLoadingPreview && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-xs text-red-800">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Dependency Conflict Detected</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {preview.conflicts.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-red-600 mt-1">
                  Automatic propagation is disabled to prevent inconsistent schedules or cyclic dependencies.
                </p>
              </div>
            </div>
          )}

          {/* Completed Downstream Tasks Protection Alert */}
          {preview && preview.affectedCompletedTasks && preview.affectedCompletedTasks.length > 0 && !isLoadingPreview && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-xs text-amber-900">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Completed Downstream Tasks Cannot Be Shifted Automatically</p>
                <p>
                  The following completed tasks depend on this work. Completed tasks cannot be rescheduled automatically:
                </p>
                <ul className="list-disc list-inside font-bold text-amber-950">
                  {preview.affectedCompletedTasks.map((t, i) => (
                    <li key={i}>{t.title} ({t.taskId})</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Unresolved Dates Warning */}
          {preview && preview.unresolvedTasks && preview.unresolvedTasks.length > 0 && !isLoadingPreview && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-xs text-amber-900">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">Unresolved Task Dates</p>
                <p>Some downstream tasks lack scheduled dates and cannot be shifted automatically:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {preview.unresolvedTasks.map((u, i) => (
                    <li key={i}><strong>{u.title}</strong>: {u.reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* General Warnings */}
          {preview && preview.warnings && preview.warnings.length > 0 && !isLoadingPreview && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2.5 text-xs text-blue-800">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {preview.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          )}

          {/* Downstream Tasks Diff List */}
          {preview && !isLoadingPreview && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Impacted Downstream Tasks ({downstreamCount})
                </h3>
                <span className="text-[11px] text-slate-500">
                  {preview.unaffectedCount} project task(s) unaffected
                </span>
              </div>

              {downstreamCount === 0 ? (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center text-xs text-slate-500">
                  No downstream tasks will be shifted by this change.
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {downstreamTasks.map((item) => (
                    <div 
                      key={item.taskId}
                      className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-900">{item.title}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.isCompleted ? (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded">
                              Completed (Protected)
                            </span>
                          ) : item.shiftDays !== null && item.shiftDays > 0 ? (
                            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold rounded">
                              +{item.shiftDays} days
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded">
                              No shift
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Date Comparison Diff */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-50 p-2 rounded-lg border border-slate-100">
                        <div>
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">Start Date</span>
                          <div className="flex items-center gap-1 text-slate-700">
                            <span>{item.currentStartDate || 'None'}</span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <strong className="text-slate-900">{item.proposedStartDate || 'None'}</strong>
                          </div>
                        </div>

                        <div>
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">Due Date</span>
                          <div className="flex items-center gap-1 text-slate-700">
                            <span>{item.currentDueDate || 'None'}</span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <strong className="text-indigo-900">{item.proposedDueDate || 'None'}</strong>
                          </div>
                        </div>
                      </div>

                      {item.warnings && item.warnings.length > 0 && (
                        <div className="text-[10px] text-amber-700 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>{item.warnings.join(' ')}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <p className="text-xs text-slate-500">
            {isExecutionDisabled && hasConflicts
              ? 'Resolve conflicts before changes can be applied.'
              : isExecutionDisabled && hasUnresolved
              ? 'Provide dates for all tasks to apply propagation.'
              : 'Applying will atomically update all listed task schedules.'}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isExecuting}
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              disabled={isExecutionDisabled}
              onClick={onConfirm}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Applying Changes...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Confirm & Propagate</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
