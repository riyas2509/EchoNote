import React, { useState, useEffect } from 'react';
import {
  X,
  History,
  Download,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  FileText,
  Mail,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import type { RecurringSchedule } from '../types';
import type { RecurringScheduleOccurrenceHistoryItem } from '../lib/apiClient';

interface RecurringScheduleHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  schedule: RecurringSchedule;
  fetchHistoryFn: (projectId: string, scheduleId: string) => Promise<{ occurrences: RecurringScheduleOccurrenceHistoryItem[] }>;
}

export const RecurringScheduleHistoryModal: React.FC<RecurringScheduleHistoryModalProps> = ({
  isOpen,
  onClose,
  schedule,
  fetchHistoryFn,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [occurrences, setOccurrences] = useState<RecurringScheduleOccurrenceHistoryItem[]>([]);

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchHistoryFn(schedule.projectId, schedule.id);
      setOccurrences(res.occurrences || []);
    } catch (err: any) {
      console.error('[RecurringScheduleHistoryModal] Load history failed:', err);
      setError(err.message || 'Failed to load execution and delivery history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen, schedule.id]);

  if (!isOpen) return null;

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-history-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden my-8">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <span className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
              <History className="w-5 h-5" />
            </span>
            <div>
              <h2 id="schedule-history-modal-title" className="text-lg font-black text-slate-900 tracking-tight">
                Execution & Report History
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {schedule.title}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadHistory}
              disabled={loading}
              title="Refresh history"
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6">
          {loading && occurrences.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
              <p className="text-xs font-semibold uppercase tracking-wider">Loading history...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-800 text-xs font-semibold">
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <p>{error}</p>
                <button
                  type="button"
                  onClick={loadHistory}
                  className="mt-2 text-indigo-600 hover:text-indigo-800 underline font-bold"
                >
                  Try Again
                </button>
              </div>
            </div>
          ) : occurrences.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400 text-center">
              <Clock className="w-8 h-8 text-slate-300" />
              <div>
                <p className="text-sm font-bold text-slate-700">No Occurrence Executions Yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  This recurring schedule has not executed an occurrence run yet. When the scheduled time arrives, reports and delivery receipts will appear here.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {occurrences.map(occ => {
                const isSuccess = occ.status === 'succeeded';
                const isFailed = occ.status === 'failed';
                const isProcessing = occ.status === 'processing';

                return (
                  <div
                    key={occ.id}
                    className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-3 transition-all hover:border-slate-300"
                  >
                    {/* Occurrence Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isSuccess
                              ? 'bg-emerald-500'
                              : isFailed
                              ? 'bg-rose-500'
                              : isProcessing
                              ? 'bg-amber-500 animate-pulse'
                              : 'bg-slate-400'
                          }`}
                        />
                        <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                          Occurrence: {new Date(occ.scheduledFor).toLocaleString()}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            isSuccess
                              ? 'bg-emerald-100 text-emerald-800'
                              : isFailed
                              ? 'bg-rose-100 text-rose-800'
                              : isProcessing
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {occ.status}
                        </span>
                      </div>
                      {occ.completedAt && (
                        <span className="text-[11px] text-slate-500 font-medium">
                          Completed: {new Date(occ.completedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>

                    {/* Occurrence Error if any */}
                    {occ.error && (
                      <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs font-medium flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                        <span>Execution Error: {occ.error}</span>
                      </div>
                    )}

                    {/* Generated Artifacts */}
                    {occ.artifacts && occ.artifacts.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                          Generated Report Artifacts
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {occ.artifacts.map(art => (
                            <div
                              key={art.id}
                              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg shadow-2xs text-xs font-semibold text-slate-800"
                            >
                              <FileText className="w-3.5 h-3.5 text-indigo-600" />
                              <span className="uppercase">{art.format}</span>
                              <span className="text-slate-400 text-[10px] font-normal">
                                ({formatFileSize(art.fileSizeBytes)})
                              </span>
                              {art.downloadUrl ? (
                                <a
                                  href={art.downloadUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-1 inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-bold"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>Download</span>
                                </a>
                              ) : (
                                <span className="ml-1 text-[10px] text-slate-400">
                                  No download access
                                </span>
                              )}
                            </div>
                        ))}
                      </div>
                  </div>
                )}

                    {/* Report Notification Deliveries */}
                    {occ.deliveries && occ.deliveries.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                          Notification Deliveries ({occ.deliveries.length})
                        </span>
                        <div className="space-y-1">
                          {occ.deliveries.map(deliv => (
                            <div
                              key={deliv.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-1 bg-white/70 border border-slate-200/80 rounded-md text-xs font-medium text-slate-700"
                            >
                              <div className="flex items-center gap-2">
                                <Mail className="w-3.5 h-3.5 text-slate-400" />
                                <span>{deliv.recipientEmail}</span>
                                <span className="text-[10px] text-slate-400">
                                  ({deliv.notificationType.replace('_', ' ')})
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                                    deliv.status === 'sent'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : deliv.status === 'processing'
                                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                    : deliv.status === 'queued'
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                                }`}
                                >
                                  {deliv.status}
                                </span>
                                {deliv.lastError && (
                                  <span className="text-[10px] text-rose-600 truncate max-w-xs" title={deliv.lastError}>
                                    {deliv.lastError}
                                </span>
                              )}
                            </div>
                          </div>
                      ))}
                    </div>
                  </div>
                )}
                </div>
              );
            })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
