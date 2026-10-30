import React, { useState, useEffect, useRef, useId } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  User,
  Users,
  X,
  AlertCircle
} from 'lucide-react';
import type {
  FollowUpMeeting,
  ProjectTask,
  TaskException,
  CompleteReasoningMeetingRequest,
  CompleteReasoningMeetingResponse
} from '../types';
import {
  previewDeadlinePropagation,
  completeReasoningMeeting,
  PropagationPreviewResultData
} from '../lib/apiClient';

export interface ReasoningMeetingCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  meeting: FollowUpMeeting | null;
  targetTask: ProjectTask | null;
  exceptions?: TaskException[];
  onSuccess: (response: CompleteReasoningMeetingResponse) => void;
}


export const ReasoningMeetingCompletionModal: React.FC<ReasoningMeetingCompletionModalProps> = ({
  isOpen,
  onClose,
  meeting,
  targetTask,
  exceptions = [],
  onSuccess
}) => {
  const rootCauseId = useId();
  const startDateId = useId();
  const dueDateId = useId();

  // Form State
  const [rootCause, setRootCause] = useState('');
  const [agreedStartDate, setAgreedStartDate] = useState('');
  const [agreedDueDate, setAgreedDueDate] = useState('');
  const [autoPropagateDownstream, setAutoPropagateDownstream] = useState<boolean>(true);
  const [selectedExceptionIds, setSelectedExceptionIds] = useState<Set<string>>(new Set());

  // Concurrency & Preview State
  const [scheduleVersionToken, setScheduleVersionToken] = useState<string>('');
  const [previewResult, setPreviewResult] = useState<PropagationPreviewResultData | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isStaleSchedule, setIsStaleSchedule] = useState(false);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);


  // Initialize or reset form state when modal opens or meeting/task changes
  useEffect(() => {
    if (!isOpen) return;

    setRootCause('');
    const initialDue = targetTask?.dueDate || '';
    const initialStart = targetTask?.startDate || '';
    setAgreedDueDate(initialDue);
    setAgreedStartDate(initialStart);
    setAutoPropagateDownstream(true);
    setSelectedExceptionIds(new Set());
    setScheduleVersionToken('');
    setPreviewResult(null);
    setPreviewError(null);
    setIsStaleSchedule(false);
    setSubmitError(null);
    setIsSubmitting(false);
    setIsLoadingPreview(false);
  }, [isOpen, meeting?.id, targetTask?.id]);

  // Keyboard accessibility: ESC key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);


  // Request deterministic schedule preview when propagation is enabled
  const fetchPreview = async (startDateToUse: string, dueDateToUse: string) => {
    if (!meeting?.projectId || !targetTask?.id) return;
    if (!dueDateToUse || !dueDateToUse.match(/^\d{4}-\d{2}-\d{2}$/)) {
      setPreviewError('A valid calendar due date (YYYY-MM-DD) is required to calculate downstream impact.');
      setPreviewResult(null);
      return;
    }

    if (startDateToUse && startDateToUse > dueDateToUse) {
      setPreviewError('Start date cannot be later than the due date.');
      setPreviewResult(null);
      return;
    }

    isSubmitting || setIsLoadingPreview(true);
    setPreviewError(null);
    try {
      const response = await previewDeadlinePropagation(meeting.projectId, targetTask.id, {
        newStartDate: startDateToUse || null,
        newDueDate: dueDateToUse || null
      });

      if (response && response.preview) {
        setPreviewResult(response.preview);
        setScheduleVersionToken(response.preview.scheduleVersionToken || '');
        setIsStaleSchedule(false);
      } else {
        setPreviewError(response?.error || response?.message || 'Failed to generate deadline propagation preview.');
      }
    } catch (err: any) {
      const msg = err.message || err.error || 'Failed to preview deadline propagation.';
      setPreviewError(msg);
      setPreviewResult(null);
    } finally {
      setIsLoadingPreview(false);
    }
  };


  // Trigger preview when dates change and downstream propagation is active
  useEffect(() => {
    if (!isOpen || !autoPropagateDownstream || !meeting?.projectId || !targetTask?.id) {
      return;
    }

    if (agreedDueDate && agreedDueDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      fetchPreview(agreedStartDate, agreedDueDate);
    }
  }, [isOpen, autoPropagateDownstream, agreedStartDate, agreedDueDate, meeting?.projectId, targetTask?.id]);

  if (!isOpen) return null;

  // Validation Calculations
  const trimmedRootCause = rootCause.trim();
  const isRootCauseValid = trimmedRootCause.length >= 1 && trimmedRootCause.length <= 3000;
  const isDueDateValid = Boolean(agreedDueDate && agreedDueDate.match(/^\d{4}-\d{2}-\d{2}$/));
  const isDateOrderValid = !agreedStartDate || !isDueDateValid || agreedStartDate <= agreedDueDate;

  const hasConflicts = Boolean(
    previewResult?.hasConflicts ||
    (previewResult?.affectedCompletedTasks && previewResult.affectedCompletedTasks.length > 0)
  );

  const isFormValid =
    Boolean(targetTask) &&
    isRootCauseValid &&
    isDueDateValid &&
    isDateOrderValid &&
    (!autoPropagateDownstream || (!isLoadingPreview && Boolean(scheduleVersionToken) && !hasConflicts && !isStaleSchedule));

  // Filter associated exceptions for this meeting/task
  const meetingAssociatedExceptionIds = new Set(meeting?.relatedExceptionIds || []);
  const eligibleExceptions = exceptions.filter(
    ex => (meetingAssociatedExceptionIds.has(ex.id) || ex.taskId === targetTask?.id) &&
          ex.status !== 'resolved' &&
          ex.status !== 'dismissed'
  );

  // Exception checkbox toggling
  const handleToggleException = (exId: string) => {
    setSelectedExceptionIds(prev => {
      const next = new Set(prev);
      if (next.has(exId)) {
        next.delete(exId);
      } else {
        next.add(exId);
      }
      return next;
    });
  };


  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmitting || !meeting?.id) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const payload: CompleteReasoningMeetingRequest = {
      rootCause: trimmedRootCause,
      agreedDueDate,
      agreedStartDate: agreedStartDate || undefined,
      scheduleVersionToken: autoPropagateDownstream ? scheduleVersionToken : (scheduleVersionToken || 'no-propagation'),
      autoPropagateDownstream,
      resolveExceptionIds: selectedExceptionIds.size > 0 ? Array.from(selectedExceptionIds) : undefined
    };

    try {
      const response = await completeReasoningMeeting(meeting.id, payload);
      if (response && response.success) {
        onSuccess(response);
        onClose();
      } else {
        setSubmitError(response?.message || 'Failed to complete reasoning meeting.');
      }
    } catch (err: any) {
      if (err.status === 409 || err.code === 'STALE_VERSION') {
        setIsStaleSchedule(true);
        const freshToken = err.data?.currentScheduleVersionToken;
        if (freshToken) {
          setScheduleVersionToken(freshToken);
        }
        setSubmitError(
          'Schedule version conflict: The project schedule was updated by another user. Please refresh the impact preview and review before completing.'
        );
      } else if (err.status === 413 || err.code === 'TRANSACTION_LIMIT_EXCEEDED') {
        setSubmitError('Schedule update exceeds transaction write limits. Please reschedule tasks in smaller batches.');
      } else {
        const errorMsg = err.message || err.error || ('Request failed (' + (err.status || 'Network error') + ')');
        setSubmitError(errorMsg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const downstreamTasks = (previewResult?.affectedTasks || []).filter(t => !t.isDirectTarget);


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reasoning-modal-title"
    >
      <div
        ref={modalRef}
        className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[NNvh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl border border-amber-100">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h2 id="reasoning-modal-title" className="text-base font-black text-slate-900">
                Complete Reasoning Meeting
              </h2>
              <p className="text-xs text-slate-500">
                Capture delay root causes, agree new deadlines, and resolve downstream schedules
              </p>
            </div>
          </div>


          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-6 space-y-6 flex-1 text-sm text-slate-700">
          {/* Missing Task Warning */}
          {!targetTask && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-800">
              <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">No associated task found</p>
                <p className="text-xs text-rose-700 mt-0.5">
                  This reasoning meeting does not reference a valid task. Reasoning meetings can only be completed for active, incomplete tasks.
                </p>
              </div>
            </div>
          )}


          {/* Context Card: Meeting & Task Information */}
          {targetTask && (
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
              <div className="flex itemu-start justify-between gap-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Target Task</span>
                  <h3 className="font-bold text-slate-900 text-sm mt-0.5">{targetTask.title}</h3>
                </div>
                <span className={'px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider ' + (
                  targetTask.status === 'completed'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                )}>
                  {targetTask.status.replace('_', ' ')}
                </span>
              </div>



              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-200/60 text-xs">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">
                    Assignee: <span className="font-medium text-slate-900">{targetTask.assigneeName || targetTask.assigneeEmail || 'Unassigned'}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>
                    Current Due: <span className="font-medium text-slate-900">{targetTask.dueDate || 'None'}</span>
                  </span>
                </div>
              </div>

              {meeting?.proposedParticipants && meeting.proposedParticipants.length > 0 && (
                <div className="pt-2 border-t border-slate-200/60 flex items-center gap-1.5 text-xs text-slate-600">
                  <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-slate-500">Participants:</span>
                  <span className="font-medium text-slate-800 truncate">
                    {meeting.proposedParticipants.map(p => p.name || p.email).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}


          {/* Root Cause Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={rootCauseId} className="font-bold text-slate-900 flex items-center gap-1.5">
                Root Cause Explanation <span className="text-rose-500">*</span>
              </label>
              <span className={'text-xs ' + (trimmedRootCause.length > 3000 ? 'text-rose-600 font-bold' : 'text-slate-400')}>
                {trimmedRootCause.length} / 3000
              </span>
            </div>
            <textarea
              id={rootCauseId}
              rows={3}
              value={rootCause}
              onChange={e => setRootCause(e.target.value)}
              placeholder="State why the task could not be completed on time..."
              disabled={isSubmitting || !targetTask}
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus)ring-amber-500 focus:border-amber-500 disabled:bg-slate-100 disabled:text-slate-500 resize-none"
            />
            {rootCause.length > 0 && trimmedRootCause.length === 0 && (
              <p className="text-xs text-rose-600">Root cause cannot be only whitespace.</p>
            )}
            {trimmedRootCause.length > 3000 && (
              <p className="text-xs text-rose-600">Root cause exceeds the maximum 3,000 character limit.</p>
            )}
          </div>


          {/* Agreed New Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor={startDateId} className="font-bold text-slate-900 flex items-center gap-1.5">
                Agreed Start Date
                <span className="text-xs font-normal text-slate-400">(Optional)</span>
              </label>
              <input
                id={startDateId}
                type="date"
                value={agreedStartDate}
                onChange={e => setAgreedStartDate(e.target.value)}
                disabled={isSubmitting || !targetTask}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:bg-slate-100 disabled:text-slate-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor={dueDateId} className="font-bold text-slate-900 flex items-center gap-1.5">
                Agreed New Deadline <span className="text-rose-500">*</span>
              </label>
              <input
                id={dueDateId}
                type="date"
                value={agreedDueDate}
                onChange={e => setAgreedDueDate(e.target.value)}
                disabled={isSubmitting || !targetTask}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:bg-slate-100 disabled:text-slate-500"
              />
            </div>
          </div>

          {/* Date Validation Errors */}
          {!isDateOrderValid && (
            <p className="text-xs text-rose-600 font-medium">
              Agreed start date ({agreedStartDate}) cannot be after the agreed deadline ({agreedDueDate}).
            </p>
          )}


          {/* Explicit Downstream Propagation Decision */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="font-bold text-slate-900 block text-sm">Reschedule Downstream Tasks</span>
                <span className="text-xs text-slate-500 block">
                  Automatically adjust start and due dates for dependent tasks based on precedence.
                </span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                  <input
                    type="radio"
                    name="propagationChoice"
                    checked={autoPropagateDownstream}
                    onChange={() => setAutoPropagateDownstream(true)}
                    disabled={isSubmitting || !targetTask}
                    className="text-amber-600 focus:ring-amber-500"
                  />
                  Yes, Reschedule
                </label>
                <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                  <input
                    type="radio"
                    name="propagationChoice"
                    checked={!autoPropagateDownstream}
                    onChange={() => setAutoPropagateDownstream(false)}
                    disabled={isSubmitting || !targetTask}
                    className="text-amber-600 focus:ring-amber-500"
                  />
                  Target Only
                </label>
              </div>
            </div>


            {/* Downstream Impact Preview Section */}
            {autoPropagateDownstream && (
              <div className="mt-3 pt-3 border-t border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Downstream Schedule Impact
                  </span>
                  <button
                    type="button"
                    onClick={() => fetchPreview(agreedStartDate, agreedDueDate)}
                    disabled={isLoadingPreview || isSubmitting || !agreedDueDate}
                    className="text-xs text-amber-600 hover:text-amber-700 font-semibold flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className={'w-3 h-3 ' + (isLoadingPreview ? 'animate-spin' : '')} />
                    Refresh Impact
                  </button>
                </div>

                {isLoadingPreview && (
                  <div className="p-4 bg-white rounded-lg border border-slate-200 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                    Calculating dependency chain and schedule token...
                  </div>
                )}


                {previewError && !isLoadingPreview && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{previewError}</span>
                  </div>
                )}

                {!isLoadingPreview && previewResult && (
                  <>
                    {/* Conflict Warnings */}
                    {hasConflicts && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>Schedule Conflict Detected</span>
                        </div>
                        <ul className="list-disc list-inside space-y-0.5 text-amber-700 pl-1">
                          {previewResult.conflicts.map((c, idx) => (
                            <li key={idx}>{c}</li>
                          ))}
                          {previewResult.affectedCompletedTasks?.map(ct => (
                            <li key={ct.taskId}>Completed task "{ct.title}" would be rescheduled.</li>
                          ))}
                        </ul>
                      </div>
                    )}


                    {/* Affected Tasks Table */}
                    {downstreamTasks.length === 0 ? (
                      <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs text-slate-500 flex items-center gap-2">
                        <Info className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>No downstream dependent tasks will be affected by this deadline change.</span>
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden text-xs">
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-700 flex justify-between">
                          <span>{downstreamTasks.length} Dependent Task{downstreamTasks.length > 1 ? 's' : ''} Affected</span>
                          <span className="text-slate-400 font-normal">ScheduleToken Active</span>
                        </div>
                        <div className="max-h-40 overflow-y-auto divide-y divide-slate-100">
                          {downstreamTasks.map(task => (
                            <div key={task.taskId} className="p-2.5 flex items-center justify-between gap-2">
                              <div className="truncate max-w-[50%;">
                                <span className="font-medium text-slate-900 block truncate">{task.title}</span>
                                <span className="text-[10px] text-slate-400 capitalize">{task.status.replace('_', ' ')}</span>
                              </div>
                              <div className="flex items-center gap-2 text-right shrink-0">
                                <div className="text-slate-500">
                                  <span className="line-through">{task.currentDueDate || 'None'}</span>
                                  <ArrowRight className="w-3 h-3 inline mx-1 text-slate-400" />
                                  <span className="font-bold text-amber-600">{task.proposedDueDate}</span>
                                </div>
                                {task.shiftDays !== null && task.shiftDays !== 0 && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-mono">
                                    +{task.shiftDays}d
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>


          {/* Task Exception Resolution Selection */}
          {eligibleExceptions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-900 text-sm">Associated Task Exceptions</label>
                <span className="text-xs text-slate-400">Select exceptions to mark resolved</span>
              </div>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden text-xs">
                {eligibleExceptions.map(ex => {
                   const isBlocked = ex.type === 'blocked';
                   const isSelected = selectedExceptionIds.has(ex.id);
                   return (
                     <label
                       key={ex.id}
                       className={'p-3 flex items-start gap-3 cursor-pointer hover:bg-slate-50 transition-colors ' + (
                         isSelected ? 'bg-amber-50/40' : '')
                       }>
                       <input
                         type="checkbox"
                         checked={isSelected}
                         onChange={() => handleToggleException(ex.id)}
                         disabled={isSubmitting}
                         className="mt-0.5 rounded text-amber-600 focus:ring-amber-500"
                       />
                       <div className="space-y-0.5 flex-1">
                         <div className="flex items-center gap-2">
                           <span className="font-bold text-slate-900">{ex.title}</span>
                           <span className={'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ' + (
                             isBlocked ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                           )}>
                             {ex.type}
                           </span>
                         </div>
                         <p className="text-slate-500 line-clamp-1">{ex.description}</p>
                         {isBlocked && (
                           <p className="text-[11px] text-amber-700 flex items-center gap-1 font-medium mt-1">
                             <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                             Blocker exception. Confirm obstacle is removed before checking.
                           </p>
                         )}
                       </div>
                     </label>
                   );
                 })}
              </div>
            </div>
          )}


          {/* Stale Schedule & Error Messages */}
          {isStaleSchedule && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Concurrent Schedule Modification</span>
                  <span>The schedule was modified by another user. Review the updated impact preview before completing.</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => fetchPreview(agreedStartDate, agreedDueDate)}
                disabled={isLoadingPreview}
                className="px-2.5 py-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-semibold shrink-0"
              >
                Refresh Preview
              </button>
            </div>
          )}

          {submitError && !isStaleSchedule && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Action Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="px-5 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Completing Meeting...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Confirm & Complete
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
