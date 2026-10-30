import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Calendar,
  Clock,
  FileText,
  Mail,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Info,
  CalendarClock
} from 'lucide-react';
import type {
  RecurringSchedule,
  RecurrenceFrequency,
  ReportType,
  ReportFormat,
  ReportCoverageScope,
  CreateRecurringScheduleRequest,
  UpdateRecurringScheduleRequest
} from '../types';

interface RecurringScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  scheduleToEdit?: RecurringSchedule | null;
  onSuccess: (savedSchedule: RecurringSchedule) => void;
  createScheduleFn: (projectId: string, payload: CreateRecurringScheduleRequest) => Promise<{ schedule: RecurringSchedule }>;
  updateScheduleFn: (projectId: string, scheduleId: string, payload: UpdateRecurringScheduleRequest) => Promise<{ schedule: RecurringSchedule }>;
}

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney'
];

export const RecurringScheduleModal: React.FC<RecurringScheduleModalProps> = ({
  isOpen,
  onClose,
  projectId,
  scheduleToEdit,
  onSuccess,
  createScheduleFn,
  updateScheduleFn
}) => {
  const isEditMode = Boolean(scheduleToEdit);

  // Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [quarterMonthOffset, setQuarterMonthOffset] = useState(1);
  const [timeOfDay, setTimeOfDay] = useState('09:00');
  const [timeZone, setTimeZone] = useState('UTC');
  const [anchorDate, setAnchorDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Report & Delivery State
  const [reportType, setReportType] = useState<ReportType>('project_status');
  const [formats, setFormats] = useState<ReportFormat[]>(['pptx', 'xlsx']);
  const [coverageScope, setCoverageScope] = useState<ReportCoverageScope>('since_last_run');
  const [recipientEmailsText, setRecipientEmailsText] = useState('');
  const [notifyOnFailure, setNotifyOnFailure] = useState(true);

  // Follow-up Meeting Automation State
  const [enableFollowUp, setEnableFollowUp] = useState(false);
  const [followUpTitle, setFollowUpTitle] = useState('');
  const [followUpDurationMinutes, setFollowUpDurationMinutes] = useState(30);

  // Status & Validation State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const modalRef = useRef<HTMLDivElement>(null);

  // Initialize or reset form
  useEffect(() => {
    if (!isOpen) return;

    if (scheduleToEdit) {
      setTitle(scheduleToEdit.title || '');
      setDescription(scheduleToEdit.description || '');
      setFrequency(scheduleToEdit.recurrence.frequency || 'weekly');
      setDayOfWeek(scheduleToEdit.recurrence.dayOfWeek ?? 1);
      setDayOfMonth(scheduleToEdit.recurrence.dayOfMonth ?? 1);
      setQuarterMonthOffset(scheduleToEdit.recurrence.quarterMonthOffset ?? 1);
      setTimeOfDay(scheduleToEdit.recurrence.timeOfDay || '09:00');
      setTimeZone(scheduleToEdit.recurrence.timeZone || 'UTC');
      setAnchorDate(scheduleToEdit.recurrence.anchorDate ? scheduleToEdit.recurrence.anchorDate.slice(0, 10) : '');
      setStartDate(scheduleToEdit.recurrence.startDate ? scheduleToEdit.recurrence.startDate.slice(0, 10) : '');
      setEndDate(scheduleToEdit.recurrence.endDate ? scheduleToEdit.recurrence.endDate.slice(0, 10) : '');

      setReportType(scheduleToEdit.report.reportType || 'project_status');
      setFormats(scheduleToEdit.report.formats && scheduleToEdit.report.formats.length > 0 ? scheduleToEdit.report.formats : ['pptx', 'xlsx']);
      setCoverageScope(scheduleToEdit.report.coverage?.scope || 'since_last_run');
      setRecipientEmailsText((scheduleToEdit.delivery.recipientEmails || []).join(', '));
      setNotifyOnFailure(scheduleToEdit.delivery.notifyOnFailure !== false);

      if (scheduleToEdit.meetingAutomation?.createMeeting) {
        setEnableFollowUp(true);
        setFollowUpTitle(scheduleToEdit.meetingAutomation.meetingTitleTemplate || '');
        setFollowUpDurationMinutes(scheduleToEdit.meetingAutomation.durationMinutes || 30);
      } else {
        setEnableFollowUp(false);
        setFollowUpTitle('');
        setFollowUpDurationMinutes(30);
      }
    } else {
      // Default new schedule
      const today = new Date().toISOString().slice(0, 10);
      setTitle('');
      setDescription('');
      setFrequency('weekly');
      setDayOfWeek(1);
      setDayOfMonth(1);
      setQuarterMonthOffset(1);
      setTimeOfDay('09:00');
      try {
        const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setTimeZone(userTz || 'UTC');
      } catch {
        setTimeZone('UTC');
      }
      setAnchorDate(today);
      setStartDate(today);
      setEndDate('');

      setReportType('project_status');
      setFormats(['pptx', 'xlsx']);
      setCoverageScope('since_last_run');
      setRecipientEmailsText('');
      setNotifyOnFailure(true);

      setEnableFollowUp(false);
      setFollowUpTitle('');
      setFollowUpDurationMinutes(30);
    }

    setErrorMessage(null);
    setFieldErrors({});
    setIsSubmitting(false);
  }, [isOpen, scheduleToEdit]);

  // Trap focus & Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const toggleFormat = (format: ReportFormat) => {
    setFormats(prev => {
      if (prev.includes(format)) {
        if (prev.length === 1) return prev; // Must have at least one format
        return prev.filter(f => f !== format);
      } else {
        return [...prev, format];
      }
    });
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!title.trim()) {
      errors.title = 'Schedule title is required';
    }

    if (!timeOfDay.match(/^([01]\d|2[0-3]):[0-5]\d$/)) {
      errors.timeOfDay = 'Time of day must be in HH:MM (24-hour) format';
    }

    if (frequency === 'biweekly' && !anchorDate) {
      errors.anchorDate = 'Anchor date is required for biweekly schedules to anchor the fortnightly cycle';
    }

    if (formats.length === 0) {
      errors.formats = 'At least one output format (PowerPoint or Excel) must be selected';
    }

    const emails = recipientEmailsText
      .split(',')
      .map(e => e.trim())
      .filter(Boolean);

    if (emails.length === 0) {
      errors.recipients = 'At least one recipient email address is required';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalid = emails.filter(e => !emailRegex.test(e));
      if (invalid.length > 0) {
        errors.recipients = `Invalid email format: ${invalid.join(', ')}`;
      }
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      errors.endDate = 'End date cannot be earlier than start date';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const recurrence: any = {
      frequency,
      timeOfDay,
      timeZone,
    };

    if (frequency === 'weekly') {
      recurrence.dayOfWeek = Number(dayOfWeek);
    } else if (frequency === 'biweekly') {
      recurrence.dayOfWeek = Number(dayOfWeek);
      recurrence.anchorDate = anchorDate ? new Date(anchorDate).toISOString() : undefined;
    } else if (frequency === 'monthly') {
      recurrence.dayOfMonth = Number(dayOfMonth);
    } else if (frequency === 'quarterly') {
      recurrence.dayOfMonth = Number(dayOfMonth);
      recurrence.quarterMonthOffset = Number(quarterMonthOffset);
    }

    if (startDate) recurrence.startDate = new Date(startDate).toISOString();
    if (endDate) recurrence.endDate = new Date(endDate).toISOString();

    const recipientEmails = recipientEmailsText
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    const payload: any = {
      title: title.trim(),
      description: description.trim() || undefined,
      recurrence,
      report: {
        reportType,
        formats,
        coverage: {
          scope: coverageScope,
        },
      },
      delivery: {
        recipientEmails,
        notifyOnFailure,
      },
    };

    if (enableFollowUp) {
      payload.meetingAutomation = {
        createMeeting: true,
        meetingTitleTemplate: followUpTitle.trim() || undefined,
        durationMinutes: Number(followUpDurationMinutes),
      };
    } else {
      payload.meetingAutomation = {
        createMeeting: false,
      };
    }

    try {
      if (isEditMode && scheduleToEdit) {
        const res = await updateScheduleFn(projectId, scheduleToEdit.id, payload);
        onSuccess(res.schedule);
      } else {
        const res = await createScheduleFn(projectId, payload);
        onSuccess(res.schedule);
      }
      onClose();
    } catch (err: any) {
      console.error('[RecurringScheduleModal] Submit failed:', err);
      setErrorMessage(err.message || 'Failed to save recurring schedule. Please check your inputs.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recurring-schedule-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
    >
      <div
        ref={modalRef}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden my-8"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <span className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
              <CalendarClock className="w-5 h-5" />
            </span>
            <div>
              <h2 id="recurring-schedule-modal-title" className="text-lg font-black text-slate-900 tracking-tight">
                {isEditMode ? 'Edit Recurring Schedule' : 'Create Recurring Schedule'}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Automate PowerPoint and Excel reports on a predictable calendar cycle
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="mx-6 mt-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-800 text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Section 1: Title & Description */}
          <div className="space-y-4">
            <div>
              <label htmlFor="sched-title" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Schedule Title <span className="text-rose-500">*</span>
              </label>
              <input
                id="sched-title"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g., Weekly Executive Status Digest"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                  fieldErrors.title
                    ? 'border-rose-300 bg-rose-50/30 focus:ring-rose-500'
                    : 'border-slate-200 focus:ring-indigo-500'
                } focus:outline-hidden focus:ring-2`}
              />
              {fieldErrors.title && <p className="mt-1 text-xs text-rose-600">{fieldErrors.title}</p>}
            </div>

            <div>
              <label htmlFor="sched-desc" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Description <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </label>
              <textarea
                id="sched-desc"
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Briefly state the reporting objective or stakeholders"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Section 2: Recurrence Configuration */}
          <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-600" />
              Recurrence Schedule
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="sched-freq" className="block text-xs font-bold text-slate-700 mb-1">
                  Frequency
                </label>
                <select
                  id="sched-freq"
                  value={frequency}
                  onChange={e => setFrequency(e.target.value as RecurrenceFrequency)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly (Every 2 Weeks)</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>

              <div>
                <label htmlFor="sched-time" className="block text-xs font-bold text-slate-700 mb-1">
                  Time of Day (24-Hour) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="sched-time"
                  type="text"
                  value={timeOfDay}
                  onChange={e => setTimeOfDay(e.target.value)}
                  placeholder="09:00"
                  className={`w-full px-3 py-2 rounded-xl border text-sm font-medium ${
                    fieldErrors.timeOfDay ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200'
                  } focus:outline-hidden focus:ring-2 focus:ring-indigo-500`}
                />
                {fieldErrors.timeOfDay && <p className="mt-1 text-xs text-rose-600">{fieldErrors.timeOfDay}</p>}
              </div>
            </div>

            {(frequency === 'weekly' || frequency === 'biweekly') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sched-dow" className="block text-xs font-bold text-slate-700 mb-1">
                    Day of the Week
                  </label>
                  <select
                    id="sched-dow"
                    value={dayOfWeek}
                    onChange={e => setDayOfWeek(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                    <option value={0}>Sunday</option>
                  </select>
                </div>

                {frequency === 'biweekly' && (
                  <div>
                    <label htmlFor="sched-anchor" className="block text-xs font-bold text-slate-700 mb-1">
                      Cycle Anchor Date <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="sched-anchor"
                      type="date"
                      value={anchorDate}
                      onChange={e => setAnchorDate(e.target.value)}
                      className={`w-full px-3 py-2 rounded-xl border text-sm font-medium ${
                        fieldErrors.anchorDate ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200'
                      } focus:outline-hidden focus:ring-2 focus:ring-indigo-500`}
                    />
                    {fieldErrors.anchorDate && <p className="mt-1 text-xs text-rose-600">{fieldErrors.anchorDate}</p>}
                  </div>
                )}
            </div>
            )}

            {(frequency === 'monthly' || frequency === 'quarterly') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sched-dom" className="block text-xs font-bold text-slate-700 mb-1">
                    Day of the Month
                  </label>
                  <select
                    id="sched-dom"
                    value={dayOfMonth}
                    onChange={e => setDayOfMonth(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value={1}>1st of month</option>
                    <option value={15}>15th of month</option>
                    <option value={28}>28th of month</option>
                    <option value={-1}>Last day of month (-1)</option>
                  </select>
                </div>

                {frequency === 'quarterly' && (
                  <div>
                    <label htmlFor="sched-qtr-offset" className="block text-xs font-bold text-slate-700 mb-1">
                      Quarter Month Offset
                    </label>
                    <select
                      id="sched-qtr-offset"
                      value={quarterMonthOffset}
                      onChange={e => setQuarterMonthOffset(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value={1}>1st Month (Jan, Apr, Jul, Oct)</option>
                      <option value={2}>2nd Month (Feb, May, Aug, Nov)</option>
                      <option value={3}>3rd Month (Mar, Jun, Sep, Dec)</option>
                    </select>
                  </div>
                )}
            </div>
            )}

            {/* Timezone */}
            <div>
              <label htmlFor="sched-tz" className="block text-xs font-bold text-slate-700 mb-1">
                Time Zone (IANA)
              </label>
              <select
                id="sched-tz"
                value={timeZone}
                onChange={e => setTimeZone(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 3: Report & Delivery Settings */}
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              Report & Output Settings
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="sched-rpt-type" className="block text-xs font-bold text-slate-700 mb-1">
                  Report Type
                </label>
                <select
                  id="sched-rpt-type"
                  value={reportType}
                  onChange={e => setReportType(e.target.value as ReportType)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="project_status">Project Status Report</option>
                  <option value="meeting_summary">Meeting Summary Report</option>
                  <option value="management_review">Management Review Report</option>
                </select>
              </div>

              <div>
                <label htmlFor="sched-coverage" className="block text-xs font-bold text-slate-700 mb-1">
                  Reporting Coverage
                </label>
                <select
                  id="sched-coverage"
                  value={coverageScope}
                  onChange={e => setCoverageScope(e.target.value as ReportCoverageScope)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="since_last_run">Since Last Run</option>
                  <option value="rolling_7_days">Rolling 7 Days</option>
                  <option value="rolling_30_days">Rolling 30 Days</option>
                  <option value="all_time">All Time</option>
                </select>
              </div>
            </div>

            {/* Output Formats */}
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Output Formats <span className="text-rose-500">*</span>
              </span>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formats.includes('pptx')}
                    onChange={() => toggleFormat('pptx')}
                    className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-semibold text-slate-800">PowerPoint (.pptx)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formats.includes('xlsx')}
                    onChange={() => toggleFormat('xlsx')}
                    className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-semibold text-slate-800">Excel (.xlsx)</span>
                </label>
              </div>
              {fieldErrors.formats && <p className="mt-1 text-xs text-rose-600">{fieldErrors.formats}</p>}
            </div>

            {/* Recipients */}
            <div>
              <label htmlFor="sched-recipients" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Authorized Recipients (Comma-Separated) <span className="text-rose-500">*</span>
              </label>
              <input
                id="sched-recipients"
                type="text"
                value={recipientEmailsText}
                onChange={e => setRecipientEmailsText(e.target.value)}
                placeholder="stakeholder@company.com, pm@company.com"
                className={`w-full px-3.5 py-2.5 rounded-xl border text-sm font-medium ${
                  fieldErrors.recipients ? 'border-rose-300 bg-rose-50/30' : 'border-slate-200'
                } focus:outline-hidden focus:ring-2 focus:ring-indigo-500`}
              />
              <p className="mt-1 text-xs text-slate-500">
                Recipients receive individual notifications with signed, short-lived download links.
              </p>
              {fieldErrors.recipients && <p className="mt-1 text-xs text-rose-600">{fieldErrors.recipients}</p>}
            </div>

            {/* Failure Alerts Toggle */}
            <div className="pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifyOnFailure}
                  onChange={e => setNotifyOnFailure(e.target.checked)}
                  className="rounded-sm border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Notify recipients immediately if scheduled report generation fails
                </span>
              </label>
            </div>
          </div>

          {/* Section 4: Follow-up Meeting Automation (Optional) */}
          <div className="p-4 bg-purple-50/50 border border-purple-200 rounded-xl space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableFollowUp}
                onChange={e => setEnableFollowUp(e.target.checked)}
                className="rounded-sm border-purple-300 text-purple-600 focus:ring-purple-500"
              />
              <span className="text-xs font-bold uppercase tracking-wider text-purple-900">
                Optionally Create Review Meeting Automatically
              </span>
            </label>

            {enableFollowUp && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label htmlFor="sched-m-title" className="block text-xs font-medium text-purple-900 mb-1">
                    Meeting Title Template
                  </label>
                  <input
                    id="sched-m-title"
                    type="text"
                    value={followUpTitle}
                    onChange={e => setFollowUpTitle(e.target.value)}
                    placeholder="e.g., Weekly Report Review"
                    className="w-full px-3 py-1.5 rounded-lg border border-purple-200 text-xs font-medium bg-white focus:outline-hidden focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label htmlFor="sched-m-dur" className="block text-xs font-medium text-purple-900 mb-1">
                    Duration (Minutes)
                  </label>
                  <input
                    id="sched-m-dur"
                    type="number"
                    min={15}
                    max={120}
                    step={15}
                    value={followUpDurationMinutes}
                    onChange={e => setFollowUpDurationMinutes(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-lg border border-purple-200 text-xs font-medium bg-white focus:outline-hidden focus:ring-2 focus:ring-purple-500"
                />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>{isEditMode ? 'Update Schedule' : 'Create Schedule'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
