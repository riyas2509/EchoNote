import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Presentation, 
  FileSpreadsheet, 
  Download, 
  X, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  Layers, 
  Sparkles,
  Info
} from 'lucide-react';
import { ReportType, ReportFormat, GenerateReportRequest, Project, AudioToTextRecord } from '../types';
import { downloadReport } from '../lib/apiClient';

interface ReportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType?: ReportType;
  projectId?: string;
  projectName?: string;
  meetingId?: string;
  meetingTitle?: string;
  availableProjects?: Project[];
  availableMeetings?: AudioToTextRecord[];
}

export const ReportExportModal: React.FC<ReportExportModalProps> = ({
  isOpen,
  onClose,
  defaultType = 'project_status',
  projectId: initialProjectId,
  projectName: initialProjectName,
  meetingId: initialMeetingId,
  meetingTitle: initialMeetingTitle,
  availableProjects = [],
  availableMeetings = []
}) => {
  const [reportType, setReportType] = useState<ReportType>(defaultType);
  const [format, setFormat] = useState<ReportFormat>('pptx');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || (availableProjects[0]?.id || ''));
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>(initialMeetingId || (availableMeetings[0]?.id || ''));
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Sync state whenever modal is opened or target identifiers change
  useEffect(() => {
    if (isOpen) {
      setReportType(defaultType);
      setSelectedProjectId(initialProjectId || (availableProjects[0]?.id || ''));
      setSelectedMeetingId(initialMeetingId || (availableMeetings[0]?.id || ''));
      setStatusMessage(null);
    }
  }, [isOpen, defaultType, initialProjectId, initialMeetingId, availableProjects, availableMeetings]);

  if (!isOpen) return null;

  const handleExport = async () => {
    setStatusMessage(null);
    setIsExporting(true);

    try {
      const payload: GenerateReportRequest = {
        reportType,
        format,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined
      };

      if (reportType === 'meeting_summary') {
        if (!selectedMeetingId) {
          throw new Error('Please select a meeting to generate the summary report.');
        }
        payload.meetingId = selectedMeetingId;
      } else if (reportType === 'project_status') {
        if (!selectedProjectId) {
          throw new Error('Please select a project for the status report.');
        }
        payload.projectId = selectedProjectId;
      } else if (reportType === 'management_review') {
        // Optional project filter
        if (selectedProjectId) {
          payload.projectId = selectedProjectId;
        }
      }

      const res = await downloadReport(payload);
      if (!res.ok) {
        throw new Error(res.error || `Failed to export ${format.toUpperCase()} report.`);
      }
      setStatusMessage({
        type: 'success',
        text: `Report generated and downloaded successfully as .${format}!`
      });
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      console.error('Report export failure:', err);
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to generate report. Please try again.'
      });
    } finally {
      setIsExporting(false);
    }
  };

  const getFormatDescription = () => {
    if (format === 'pptx') {
      return 'Generates an editable 16:9 widescreen PowerPoint presentation with EchoNote theme, KPI summary cards, structured slides, and source references.';
    }
    return 'Generates an enterprise Excel workbook with summary KPI sheets, detailed data tables, frozen headers, and auto-filters. Sanitized against formula injection.';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-indigo-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shadow-inner">
              <FileText className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black uppercase tracking-tight text-white">Generate Executive Report</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  AH.184
                </span>
              </div>
              <p className="text-xs text-indigo-200/70 truncate max-w-md font-medium">
                Export meeting intelligence, project progress, and management reviews to PowerPoint and Excel
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isExporting}
            className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-all disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Report Type Selector */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-2">
              1. Select Report Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setReportType('project_status')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                  reportType === 'project_status'
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-950 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-sm mb-1">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>Project Status</span>
                </div>
                <p className="text-xs text-slate-500">
                  Task counts, upcoming deadlines, dependency risks, and meeting outcomes.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setReportType('meeting_summary')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                  reportType === 'meeting_summary'
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-950 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-sm mb-1">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  <span>Meeting Summary</span>
                </div>
                <p className="text-xs text-slate-500">
                  Topic recap, key discussion points, recorded decisions, and action items.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setReportType('management_review')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                  reportType === 'management_review'
                    ? 'border-indigo-600 bg-indigo-50/60 text-indigo-950 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-sm mb-1">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <span>Management Review</span>
                </div>
                <p className="text-xs text-slate-500">
                  High-level executive briefing, overdue blockers, and strategic milestones.
                </p>
              </button>
            </div>
          </div>

          {/* Format Selector */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-2">
              2. Select Export Format
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormat('pptx')}
                className={`p-3.5 rounded-2xl border-2 flex items-center gap-3 transition-all ${
                  format === 'pptx'
                    ? 'border-orange-500 bg-orange-50/60 text-orange-950 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
                  <Presentation className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-sm">PowerPoint Presentation</div>
                  <div className="text-xs text-slate-500">Editable .pptx slides with KPI cards</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setFormat('xlsx')}
                className={`p-3.5 rounded-2xl border-2 flex items-center gap-3 transition-all ${
                  format === 'xlsx'
                    ? 'border-emerald-600 bg-emerald-50/60 text-emerald-950 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300 bg-slate-50/50 text-slate-700'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <div className="font-bold text-sm">Excel Workbook</div>
                  <div className="text-xs text-slate-500">Tabular .xlsx with frozen headers &amp; filters</div>
                </div>
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{getFormatDescription()}</span>
            </p>
          </div>

          {/* Context Scope Selection */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-4">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
              3. Report Scope &amp; Target
            </h4>

            {reportType === 'meeting_summary' && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Select Meeting Recording
                </label>
                {availableMeetings.length > 0 ? (
                  <select
                    value={selectedMeetingId}
                    onChange={(e) => setSelectedMeetingId(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-indigo-500"
                  >
                    {availableMeetings.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fileName || m.id} ({new Date(m.createdAt).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-xs text-slate-500 italic">
                    {initialMeetingTitle ? `Meeting: ${initialMeetingTitle}` : 'No meeting recordings available in this view.'}
                  </div>
                )}
              </div>
            )}

            {(reportType === 'project_status' || reportType === 'management_review') && (
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Target Project {reportType === 'management_review' && '(Optional)'}
                </label>
                {availableProjects.length > 0 ? (
                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-indigo-500"
                  >
                    {reportType === 'management_review' && (
                      <option value="">All Authorized Projects</option>
                    )}
                    {availableProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-xs text-slate-500 italic">
                    {initialProjectName ? `Project: ${initialProjectName}` : 'All authorized organization projects.'}
                  </div>
                )}
              </div>
            )}

            {/* Optional Date Range Filter */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  Start Date (Optional)
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  End Date (Optional)
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Feedback messages */}
          {statusMessage && (
            <div
              className={`p-3.5 rounded-2xl flex items-center gap-2.5 text-xs font-semibold ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Export format: <span className="font-bold uppercase text-slate-700">.{format}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              id="btn-confirm-export-report"
              onClick={handleExport}
              disabled={isExporting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-500/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className={`w-4 h-4 ${isExporting ? 'animate-bounce' : ''}`} />
              <span>{isExporting ? 'Generating Report...' : `Export .${format.toUpperCase()}`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
