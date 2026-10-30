import React, { useState, useEffect, useMemo } from 'react';
import {
  CalendarClock,
  Plus,
  Play,
  Pause,
  Trash2,
  Edit2,
  History,
  FileText,
  Mail,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  Globe,
  Check,
  ShieldAlert
} from 'lucide-react';
import type { RecurringSchedule } from '../types';
import {
  listRecurringSchedules,
  createRecurringSchedule,
  updateRecurringSchedule,
  deleteRecurringSchedule,
  getRecurringScheduleHistory
} from '../lib/apiClient';
import { RecurringScheduleModal } from './RecurringScheduleModal';
import { RecurringScheduleHistoryModal } from './RecurringScheduleHistoryModal';

interface RecurringScheduleManagerProps {
  projectId: string;
  projectName?: string;
  userRole?: string;
}

export const RecurringScheduleManager: React.FC<RecurringScheduleManagerProps> = ({
  projectId,
  projectName,
  userRole
}) => {
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [scheduleToEdit, setScheduleToEdit] = useState<RecurringSchedule | null>(null);

  const [historySchedule, setHistorySchedule] = useState<RecurringSchedule | null>(null);

  // Deletion Confirmation Modal State
  const [scheduleToDelete, setScheduleToDelete] = useState<RecurringSchedule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Pause / Resume in-flight IDs
  const [togglingScheduleId, setTogglingScheduleId] = useState<string | null>(null);

  const canEdit = userRole !== 'viewer';

  const fetchSchedules = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listRecurringSchedules(projectId);
      setSchedules(res.schedules || []);
    } catch (err: any) {
      console.error('[RecurringScheduleManager] Failed to fetch schedules:', err);
      setError(err.message || 'Failed to load recurring schedules for this project.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      fetchSchedules();
    }
  }, [projectId]);

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => {
      setSuccessToast(null);
    }, 4000);
  };

  const handleToggleActive = async (schedule: RecurringSchedule) => {
    if (!canEdit) return;
    setTogglingScheduleId(schedule.id);
    const newActive = !schedule.active;
    try {
      const res = await updateRecurringSchedule(projectId, schedule.id, {
        active: newActive
      });
      setSchedules(prev => prev.map(s => (s.id === schedule.id ? res.schedule : s)));
      showToast(`Schedule "${schedule.title}" ${newActive ? 'resumed' : 'paused'} successfully.`);
    } catch (err: any) {
      console.error('[RecurringScheduleManager] Toggle active failed:', err);
      setError(err.message || `Failed to ${newActive ? 'resume' : 'pause'} schedule.`);
    } finally {
      setTogglingScheduleId(null);
    }
  };

  const confirmDelete = async () => {
    if (!scheduleToDelete || !canEdit) return;
    setIsDeleting(true);
    try {
      await deleteRecurringSchedule(projectId, scheduleToDelete.id);
      setSchedules(prev => prev.filter(s => s.id !== scheduleToDelete.id));
      showToast(`Schedule "${scheduleToDelete.title}" deleted.`);
      setScheduleToDelete(null);
    } catch (err: any) {
      console.error('[RecurringScheduleManager] Delete failed:', err);
      setError(err.message || 'Failed to delete schedule.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaved = (saved: RecurringSchedule) => {
    setSchedules(prev => {
      const idx = prev.findIndex(s => s.id === saved.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = saved;
        return copy;
      }
      return [saved, ...prev];
    });
    showToast(`Schedule "${saved.title}" saved successfully.`);
  };

  const formatRecurrenceSummary = (rec: RecurringSchedule['schedule']): string => {
    const time = `${rec.timeOfDay} ${rec.timeZone || 'UTC'}`;
    if (rec.frequency === 'weekly') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = rec.dayOfWeek !== undefined ? days[rec.dayOfWeek] : 'Monday';
      return `Every ${dayName} at ${time}`;
    }
    if (rec.frequency === 'biweekly') {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = rec.dayOfWeek !== undefined ? days[rec.dayOfWeek] : 'Monday';
      return `Every 2 weeks on ${dayName} at ${time}`;
    }
    if (rec.frequency === 'monthly') {
      const dayStr = rec.dayOfMonth === -1 ? 'last day of month' : `day ${rec.dayOfMonth}`;
      return `Monthly on ${dayStr} at ${time}`;
    }
    if (rec.frequency === 'quarterly') {
      const dayStr = rec.dayOfMonth === -1 ? 'last day' : `day ${rec.dayOfMonth}`;
      return `Quarterly (${dayStr}) at ${time}`;
    }
    return `${rec.frequency} at ${time}`;
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <CalendarClock className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>Recurring Reports & Automated Delivery</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-bold uppercase tracking-wider">
                  Requirement 24
                </span>
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Generate and distribute PowerPoint (.pptx) and Excel (.xlsx) digest reports on automated cycles
              </p>
            </div>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={fetchSchedules}
            disabled={loading}
            title="Refresh list"
            className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl border border-slate-200 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {canEdit && (
            <button
              type="button"
              id="btn-create-recurring-schedule"
              onClick={() => {
                setScheduleToEdit(null);
                setIsFormModalOpen(true);
              }}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>New Schedule</span>
            </button>
          )}
        </div>
      </div>

      {/* Success Toast */}
      {successToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-800 text-xs font-semibold">
          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            <button
              type="button"
              onClick={fetchSchedules}
              className="mt-2 text-indigo-600 hover:text-indigo-800 underline font-bold"
            >
              Reload Schedules
            </button>
          </div>
        </div>
      )}

      {/* Schedules List or Empty State */}
      {loading && schedules.length === 0 ? (
        <div className="py-16 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <p className="text-xs font-semibold uppercase tracking-wider">Loading recurring schedules...</p>
        </div>
      ) : schedules.length === 0 ? (
        <div className="py-16 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-3 text-center p-6">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
            <CalendarClock className="w-8 h-8" />
          </div>
          <h4 className="text-base font-black text-slate-900">No Recurring Schedules Configured</h4>
          <p className="text-xs text-slate-500 max-w-md">
            Automate routine reporting for {projectName || 'this project'}. Set up weekly or monthly PowerPoint and Excel digests delivered directly to authorized stakeholders.
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setScheduleToEdit(null);
                setIsFormModalOpen(true);
              }}
              className="mt-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Schedule</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {schedules.map(schedule => {
            const isToggling = togglingScheduleId === schedule.id;

            return (
              <div
                key={schedule.id}
                className={`bg-white border rounded-2xl p-5 shadow-xs transition-all ${
                  schedule.active ? 'border-slate-200' : 'border-slate-200/60 bg-slate-50/40 opacity-80'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Title & Metadata */}
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          schedule.active
                            ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                      >
                        {schedule.active ? 'Active' : 'Paused'}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900">{schedule.title}</h4>
                      <span className="text-slate-400 text-xs font-medium">•</span>
                      <span className="text-xs font-semibold text-indigo-600 capitalize">
                        {schedule.report.reportType.replace('_', ' ')}
                      </span>
                    </div>

                    {schedule.description && (
                      <p className="text-xs text-slate-600">{schedule.description}</p>
                    )}

                    {/* Recurrence & Next Run Pills */}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-medium pt-1">
                      <span className="flex items-center gap-1 text-slate-700">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatRecurrenceSummary(schedule.schedule)}</span>
                      </span>

                      {schedule.nextRunAt && schedule.active && (
                        <span className="flex items-center gap-1 text-indigo-700 font-semibold bg-indigo-50/70 px-2.5 py-0.5 rounded-md">
                          <CalendarClock className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Next run: {new Date(schedule.nextRunAt).toLocaleString()}</span>
                        </span>
                      )}

                      <span className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        <span className="uppercase font-bold text-slate-700">
                          {schedule.report.formats.join(', ')}
                        </span>
                      </span>

                      <span className="flex items-center gap-1 text-slate-600">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>{schedule.delivery.recipientEmails.length} recipient(s)</span>
                      </span>
                    </div>

                    {/* Execution metadata if available */}
                    {schedule.execution && (
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 pt-0.5">
                        <span>Last run: {schedule.execution.lastRunAt ? new Date(schedule.execution.lastRunAt).toLocaleString() : 'Never'}</span>
                        {schedule.execution.lastExecutionStatus && (
                          <span
                            className={`px-1.5 py-0.2 rounded-full font-bold uppercase ${
                              schedule.execution.lastExecutionStatus === 'succeeded'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {schedule.execution.lastExecutionStatus}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions Bar */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                    {/* History Button */}
                    <button
                      type="button"
                      onClick={() => setHistorySchedule(schedule)}
                      title="View occurrence and report delivery history"
                      className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>History</span>
                    </button>

                    {/* Pause / Resume Button */}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleToggleActive(schedule)}
                        disabled={isToggling}
                        title={schedule.active ? 'Pause automated runs' : 'Resume automated runs'}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all flex items-center gap-1.5 ${
                          schedule.active
                            ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {isToggling ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : schedule.active ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                        <span>{schedule.active ? 'Pause' : 'Resume'}</span>
                      </button>
                    )}

                    {/* Edit Button */}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setScheduleToEdit(schedule);
                          setIsFormModalOpen(true);
                        }}
                        title="Edit schedule configuration"
                        className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl border border-slate-200 transition-all"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Delete Button */}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setScheduleToDelete(schedule)}
                        title="Delete recurring schedule"
                        className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl border border-rose-200 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {isFormModalOpen && (
        <RecurringScheduleModal
          isOpen={isFormModalOpen}
          onClose={() => {
            setIsFormModalOpen(false);
            setScheduleToEdit(null);
          }}
          projectId={projectId}
          scheduleToEdit={scheduleToEdit}
          onSuccess={handleSaved}
          createScheduleFn={createRecurringSchedule}
          updateScheduleFn={updateRecurringSchedule}
        />
      )}

      {/* History Modal */}
      {historySchedule && (
        <RecurringScheduleHistoryModal
          isOpen={Boolean(historySchedule)}
          onClose={() => setHistorySchedule(null)}
          schedule={historySchedule}
          onRefresh={fetchSchedules}
          fetchHistoryFn={getRecurringScheduleHistory}
        />
      )}

      {/* Delete Confirmation Modal */}
      {scheduleToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="p-2.5 bg-rose-50 text-rose-600 rounded-xl">
                <Trash2 className="w-5 h-5" />
              </span>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Recurring Schedule?</h3>
                <p className="text-xs text-slate-500">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Are you sure you want to delete <span className="font-bold text-slate-900">"{scheduleToDelete.title}"</span>? Future report generation runs will stop immediately. Existing generated reports and history records will remain safely archived.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setScheduleToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete Schedule</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
