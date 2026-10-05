import React, { useState } from 'react';
import { 
  Sparkles, CheckCircle2, UserCheck, AlertCircle, 
  ArrowRight, FileText, Clock, RefreshCw, X, Tag,
  ExternalLink, Layers
} from 'lucide-react';
import { Project, ProjectTask, ProjectMember, AudioToTextRecord, AutomatedTaggingDetection, AutomatedTaggingResult } from '../types';
import { runAutomatedTaggingService } from '../services/automatedTaggingService';
import { toast } from 'sonner';

interface AutomatedTaggingModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  tasks: ProjectTask[];
  members: ProjectMember[];
  recordings: AudioToTextRecord[];
  currentUser?: {
    uid?: string;
    email?: string;
    displayName?: string;
  };
  onSuccess?: () => void;
}

export const AutomatedTaggingModal: React.FC<AutomatedTaggingModalProps> = ({
  isOpen,
  onClose,
  project,
  tasks,
  members,
  recordings,
  currentUser,
  onSuccess
}) => {
  const [selectedRecordingId, setSelectedRecordingId] = useState<string>(
    recordings.length > 0 ? recordings[0].id : ''
  );
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<AutomatedTaggingResult | null>(null);
  const [autoCreateTasks, setAutoCreateTasks] = useState<boolean>(true);

  if (!isOpen) return null;

  const selectedRecord = recordings.find(r => r.id === selectedRecordingId) || recordings[0];

  const handleRunTagging = async () => {
    if (!selectedRecord) {
      toast.error('Please select a meeting recording to analyze.');
      return;
    }

    const transcript = selectedRecord.transcript;
    if (!transcript || (Array.isArray(transcript) && transcript.length === 0)) {
      toast.error('The selected recording does not contain a transcript.');
      return;
    }

    setIsProcessing(true);
    setResult(null);

    try {
      const taggingResult = await runAutomatedTaggingService({
        transcript,
        projectId: project.id,
        recordingId: selectedRecord.id,
        members,
        tasks,
        currentUser,
        autoApply: true,
        autoCreateTasks
      });

      setResult(taggingResult);
      if (taggingResult.updatedTasksCount > 0 || (taggingResult.createdTasksCount && taggingResult.createdTasksCount > 0)) {
        toast.success(
          `AI Tagging complete: ${taggingResult.updatedTasksCount} task(s) updated, ${taggingResult.createdTasksCount || 0} created in database!`
        );
        if (onSuccess) onSuccess();
      } else if (taggingResult.detections.length === 0) {
        toast.info('No explicit team member task assignments were detected in this transcript.');
      }
    } catch (err: any) {
      console.error('Error during automated tagging:', err);
      toast.error(err.message || 'Failed to analyze transcript for team mentions.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/30 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <UserCheck className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight">AI Automated Member Tagging</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  Gemini API
                </span>
              </div>
              <p className="text-xs text-indigo-200/80">
                Detects team member commitments in meeting transcripts and updates database task assignments automatically.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Transcript / Meeting Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Select Project Meeting Recording</span>
            </label>
            {recordings.length > 0 ? (
              <select
                value={selectedRecordingId}
                onChange={(e) => setSelectedRecordingId(e.target.value)}
                disabled={isProcessing}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all disabled:opacity-60"
              >
                {recordings.map((rec) => (
                  <option key={rec.id} value={rec.id}>
                    {rec.title || 'Untitled Meeting'} ({new Date(rec.date).toLocaleDateString()} - {rec.transcript?.length || 0} segments)
                  </option>
                ))}
              </select>
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 text-amber-800 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600" />
                <span>No recordings found in this project. Please record or upload a meeting first to scan for team member mentions.</span>
              </div>
            )}
          </div>

          {/* Roster & Target Tasks Overview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Active Team Roster ({members.length})
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                {members.slice(0, 6).map((m, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border border-slate-200 text-slate-700"
                  >
                    {m.displayName || m.email.split('@')[0]}
                  </span>
                ))}
                {members.length > 6 && (
                  <span className="text-[10px] text-slate-400 self-center">+{members.length - 6} more</span>
                )}
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Project Tasks to Correlate ({tasks.length})
              </span>
              <div className="text-xs text-slate-600">
                {tasks.length > 0 ? (
                  <p className="line-clamp-2">
                    {tasks.filter(t => t.status !== 'completed').length} active task(s) available for automated mention mapping.
                  </p>
                ) : (
                  <p className="text-amber-600">No existing tasks. New tasks will be created automatically.</p>
                )}
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="p-3 bg-indigo-50/60 border border-indigo-100 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-indigo-600" />
              <div>
                <span className="text-xs font-bold text-indigo-950 block">Auto-create new tasks for new deliverables</span>
                <span className="text-[11px] text-indigo-700">Creates unlisted action items mentioned in transcript and tags the member directly in Firestore.</span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={autoCreateTasks}
              onChange={(e) => setAutoCreateTasks(e.target.checked)}
              disabled={isProcessing}
              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
            />
          </div>

          {/* Action Button */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRunTagging}
              disabled={isProcessing || recordings.length === 0}
              className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 disabled:opacity-50 flex items-center gap-2 transition-all"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Analyzing Mentions with Gemini...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Detect & Update Tasks</span>
                </>
              )}
            </button>
          </div>

          {/* Results section */}
          {result && (
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <h4 className="text-sm font-bold text-slate-900">
                    Detection Results ({result.detections.length} Mention{result.detections.length === 1 ? '' : 's'})
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                    {result.updatedTasksCount} Updated in DB
                  </span>
                  {result.createdTasksCount > 0 && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                      {result.createdTasksCount} Created in DB
                    </span>
                  )}
                </div>
              </div>

              {result.detections.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center text-xs text-slate-500">
                  No member mentions or task commitments found in the provided transcript.
                </div>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {result.detections.map((det, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl transition-all space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center">
                            {det.memberName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="text-xs font-bold text-slate-900 block leading-tight">
                              {det.memberName}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {det.memberEmail}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200/80 text-slate-700">
                            {Math.round(det.confidence * 100)}% Confidence
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Database Updated</span>
                          </span>
                        </div>
                      </div>

                      {/* Task assignment info */}
                      <div className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200/60">
                        <div className="font-semibold text-slate-900 mb-0.5 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Task: {det.taskTitle}</span>
                        </div>
                        {det.actionDescription && (
                          <p className="text-slate-600 text-[11px] mb-1.5">{det.actionDescription}</p>
                        )}
                        <blockquote className="border-l-2 border-indigo-400 pl-2 text-[11px] italic text-slate-600 bg-indigo-50/40 py-1 rounded-r">
                          "{det.transcriptQuote}"
                        </blockquote>
                        {det.detectedDeadline && (
                          <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-amber-700">
                            <Clock className="w-3 h-3 text-amber-500" />
                            <span>Detected Deadline: {det.detectedDeadline}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
