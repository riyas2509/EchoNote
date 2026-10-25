/**
 * AH.184 — Report Generation Service for PowerPoint (.pptx) and Excel (.xlsx)
 *
 * Provides deterministic, structured generation of:
 * 1. Meeting Summary Reports
 * 2. Project Status Reports
 * 3. Management Review Reports
 *
 * Implements security hardening:
 * - Spreadsheet Formula Injection Prevention (sanitizes '=', '+', '-', '@', '\t', '\r')
 * - Type-safe cell population with frozen header rows and auto-filters
 * - Presentation styling with title slides, metrics summaries, tables, and pagination
 */

import ExcelJS from 'exceljs';
import pptxgen from 'pptxgenjs';
import {
  MeetingReportData,
  ProjectReportData,
  ManagementReviewData
} from '../types.ts';

// Robust constructor resolution across ESM and CommonJS runtimes
const PptxGenClass: any = (pptxgen as any).default || pptxgen;

// EchoNote Brand Colors
const BRAND_PRIMARY = '0F172A'; // Slate 900
const BRAND_ACCENT = '2563EB';  // Blue 600
const BRAND_BG = 'F8FAFC';      // Slate 50
const BRAND_SUCCESS = '10B981'; // Emerald 500
const BRAND_WARNING = 'F59E0B'; // Amber 500
const BRAND_DANGER = 'EF4444';  // Red 500
const BRAND_MUTED = '64748B';   // Slate 500

/**
 * Sanitizes untrusted user text to prevent spreadsheet formula injection.
 * If text starts with dangerous characters ('=', '+', '-', '@', '\t', '\r'),
 * prepends a single apostrophe (') so spreadsheet software evaluates it strictly as text.
 */
export function sanitizeSpreadsheetText(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=\+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

// ============================================================================
// EXCEL REPORT BUILDERS
// ============================================================================

/**
 * Builds an Excel workbook for an individual Meeting Summary.
 */
export async function generateMeetingExcel(data: MeetingReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EchoNote Enterprise Intelligence';
  workbook.created = new Date();

  // Sheet 1: Overview & Summary
  const overviewSheet = workbook.addWorksheet('Meeting Overview', {
    views: [{ showGridLines: true }]
  });

  overviewSheet.columns = [
    { header: 'Property', key: 'prop', width: 25 },
    { header: 'Details', key: 'val', width: 75 }
  ];

  overviewSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  overviewSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_PRIMARY}` }
  };

  overviewSheet.addRow({ prop: 'Meeting Title', val: sanitizeSpreadsheetText(data.title) });
  overviewSheet.addRow({ prop: 'Meeting Date', val: data.date });
  overviewSheet.addRow({ prop: 'Primary Project', val: sanitizeSpreadsheetText(data.primaryProjectName) });
  overviewSheet.addRow({ prop: 'Associated Projects', val: sanitizeSpreadsheetText(data.associatedProjects.join(', ') || 'None') });
  overviewSheet.addRow({ prop: 'Recording Owner', val: sanitizeSpreadsheetText(data.ownerEmail) });
  overviewSheet.addRow({ prop: 'Speakers Detected', val: sanitizeSpreadsheetText(data.speakers.join(', ') || 'N/A') });
  overviewSheet.addRow({ prop: 'Main Discussion Topic', val: sanitizeSpreadsheetText(data.summary.mainTopic || 'General discussion') });
  overviewSheet.addRow({});

  // Key Discussion Points
  overviewSheet.addRow({ prop: 'KEY DISCUSSION POINTS', val: '' });
  const keyPointsRow = overviewSheet.lastRow;
  if (keyPointsRow) {
    keyPointsRow.font = { bold: true, color: { argb: `FF${BRAND_ACCENT}` } };
  }
  if (data.summary.keyPoints && data.summary.keyPoints.length > 0) {
    data.summary.keyPoints.forEach((point, idx) => {
      overviewSheet.addRow({ prop: `Point ${idx + 1}`, val: sanitizeSpreadsheetText(point) });
    });
  } else {
    overviewSheet.addRow({ prop: 'Key Points', val: 'No explicit key points recorded.' });
  }

  // Executive Summary if available
  if (data.executiveSummary && data.executiveSummary.length > 0) {
    overviewSheet.addRow({});
    overviewSheet.addRow({ prop: 'EXECUTIVE SUMMARY', val: '' });
    overviewSheet.lastRow!.font = { bold: true, color: { argb: `FF${BRAND_ACCENT}` } };
    data.executiveSummary.forEach((bullet, idx) => {
      overviewSheet.addRow({ prop: `Takeaway ${idx + 1}`, val: sanitizeSpreadsheetText(bullet) });
    });
  }

  // Sheet 2: Decisions & Action Items
  const actionsSheet = workbook.addWorksheet('Decisions & Action Items', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: true }]
  });

  actionsSheet.columns = [
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Item / Description', key: 'desc', width: 45 },
    { header: 'Owner / Assignee', key: 'owner', width: 25 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Due Date', key: 'dueDate', width: 15 }
  ];

  actionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  actionsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_PRIMARY}` }
  };
  actionsSheet.autoFilter = 'A1:F1';

  // Decisions
  if (data.summary.decisions && data.summary.decisions.length > 0) {
    data.summary.decisions.forEach(dec => {
      actionsSheet.addRow({
        type: 'Decision',
        desc: sanitizeSpreadsheetText(dec),
        owner: 'Meeting Consensus',
        status: 'Decided',
        priority: 'Normal',
        dueDate: data.date
      });
    });
  }

  // Action Items / Converted Tasks
  if (data.tasks && data.tasks.length > 0) {
    data.tasks.forEach(t => {
      actionsSheet.addRow({
        type: 'Action Item',
        desc: sanitizeSpreadsheetText(t.title),
        owner: sanitizeSpreadsheetText(t.assigneeName || t.assigneeEmail),
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate || 'No Deadline'
      });
    });
  } else if (data.summary.actionItems && data.summary.actionItems.length > 0) {
    data.summary.actionItems.forEach(ai => {
      actionsSheet.addRow({
        type: 'Action Item',
        desc: sanitizeSpreadsheetText(ai),
        owner: 'Unassigned',
        status: 'Pending',
        priority: 'Normal',
        dueDate: 'Unspecified'
      });
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Builds an Excel workbook for a Project Status Report.
 */
export async function generateProjectStatusExcel(data: ProjectReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EchoNote Enterprise Intelligence';
  workbook.created = new Date();

  // Sheet 1: Project KPI Dashboard
  const summarySheet = workbook.addWorksheet('Status Summary', {
    views: [{ showGridLines: true }]
  });

  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 32 },
    { header: 'Value', key: 'value', width: 20 },
    { header: 'Description', key: 'desc', width: 50 }
  ];

  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_PRIMARY}` }
  };

  summarySheet.addRow({ metric: 'Project Name', value: sanitizeSpreadsheetText(data.projectName), desc: 'Target Workspace Container' });
  summarySheet.addRow({ metric: 'Reporting Date', value: data.reportingDate, desc: 'Generated timestamp' });
  summarySheet.addRow({ metric: 'Total Tasks Tracked', value: data.metrics.totalTasks, desc: 'All active tasks' });
  summarySheet.addRow({ metric: 'Completed Tasks', value: data.metrics.completedTasks, desc: 'Status = completed' });
  summarySheet.addRow({ metric: 'In Progress Tasks', value: data.metrics.inProgressTasks, desc: 'Status = in_progress' });
  summarySheet.addRow({ metric: 'Pending Tasks', value: data.metrics.pendingTasks, desc: 'Status = pending' });
  summarySheet.addRow({ metric: 'Overdue Tasks', value: data.metrics.overdueTasks, desc: 'Due date passed & incomplete' });
  summarySheet.addRow({ metric: 'Tasks Lacking Deadline', value: data.metrics.tasksWithoutDeadline, desc: 'No due date assigned' });
  summarySheet.addRow({ metric: 'Tasks Due Within 7 Days', value: data.metrics.tasksDueNext7Days, desc: 'Urgent commitments' });
  summarySheet.addRow({ metric: 'Blocked Tasks', value: data.metrics.blockedTasks, desc: 'Prerequisite dependencies incomplete' });
  summarySheet.addRow({ metric: 'Associated Meetings', value: data.meetings.length, desc: 'Canonical meeting sessions linked' });

  // Sheet 2: Detailed Task Register
  const taskSheet = workbook.addWorksheet('Tasks Register', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: true }]
  });

  taskSheet.columns = [
    { header: 'Task ID', key: 'id', width: 14 },
    { header: 'Title', key: 'title', width: 35 },
    { header: 'Assignee', key: 'assignee', width: 25 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Priority', key: 'priority', width: 12 },
    { header: 'Start Date', key: 'startDate', width: 14 },
    { header: 'Due Date', key: 'dueDate', width: 14 },
    { header: 'Overdue?', key: 'isOverdue', width: 12 },
    { header: 'Dependency Status', key: 'depStatus', width: 18 }
  ];

  taskSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  taskSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_PRIMARY}` }
  };
  taskSheet.autoFilter = 'A1:I1';

  data.tasks.forEach(t => {
    taskSheet.addRow({
      id: t.id,
      title: sanitizeSpreadsheetText(t.title),
      assignee: sanitizeSpreadsheetText(t.assigneeName || t.assigneeEmail),
      status: t.status,
      priority: t.priority,
      startDate: t.startDate || '-',
      dueDate: t.dueDate || 'Unset',
      isOverdue: t.isOverdue ? 'YES' : 'NO',
      depStatus: t.dependencyStatus || 'ready'
    });
  });

  // Sheet 3: Decisions & Meeting Intelligence
  const meetingSheet = workbook.addWorksheet('Meetings & Decisions', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: true }]
  });

  meetingSheet.columns = [
    { header: 'Category', key: 'cat', width: 15 },
    { header: 'Title / Subject', key: 'title', width: 45 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Context / Details', key: 'context', width: 40 }
  ];

  meetingSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  meetingSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_PRIMARY}` }
  };
  meetingSheet.autoFilter = 'A1:D1';

  data.meetings.forEach(m => {
    meetingSheet.addRow({
      cat: 'Meeting',
      title: sanitizeSpreadsheetText(m.title),
      date: m.date,
      context: sanitizeSpreadsheetText(m.summaryTopic || 'Meeting Session')
    });
  });

  data.decisions.forEach(d => {
    meetingSheet.addRow({
      cat: 'Decision',
      title: sanitizeSpreadsheetText(d.title),
      date: d.date,
      context: sanitizeSpreadsheetText(`Source: ${d.source}`)
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Builds an Excel workbook for an Executive Management Review.
 */
export async function generateManagementReviewExcel(data: ManagementReviewData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EchoNote Enterprise Intelligence';
  workbook.created = new Date();

  // Sheet 1: Executive Dashboard
  const execSheet = workbook.addWorksheet('Executive Dashboard', {
    views: [{ showGridLines: true }]
  });

  execSheet.columns = [
    { header: 'Section', key: 'sec', width: 26 },
    { header: 'Content', key: 'content', width: 75 }
  ];

  execSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  execSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_PRIMARY}` }
  };

  execSheet.addRow({ sec: 'Scope Context', content: sanitizeSpreadsheetText(data.projectName || 'All Projects Portfolio') });
  execSheet.addRow({ sec: 'Reporting Period', content: `${data.reportingPeriod.startDate} to ${data.reportingPeriod.endDate}` });
  execSheet.addRow({ sec: 'Report Generated At', content: data.generatedAt });
  execSheet.addRow({});

  execSheet.addRow({ sec: 'EXECUTIVE SUMMARY', content: '' });
  execSheet.lastRow!.font = { bold: true, color: { argb: `FF${BRAND_ACCENT}` } };
  data.executiveSummary.forEach((bullet, idx) => {
    execSheet.addRow({ sec: `Key Takeaway ${idx + 1}`, content: sanitizeSpreadsheetText(bullet) });
  });

  execSheet.addRow({});
  execSheet.addRow({ sec: 'PORTFOLIO KPI SUMMARY', content: '' });
  execSheet.lastRow!.font = { bold: true, color: { argb: `FF${BRAND_ACCENT}` } };
  execSheet.addRow({ sec: 'Total Tasks Tracked', content: String(data.metrics.totalTasks) });
  execSheet.addRow({ sec: 'Completed Deliverables', content: String(data.metrics.completedTasks) });
  execSheet.addRow({ sec: 'Overdue Commitments', content: String(data.metrics.overdueTasks) });
  execSheet.addRow({ sec: 'Blocked Tasks with Dependency Risks', content: String(data.metrics.blockedTasks) });

  // Sheet 2: Blockers, Risks & Overdue Commitments
  const risksSheet = workbook.addWorksheet('Risks & Overdue Work', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: true }]
  });

  risksSheet.columns = [
    { header: 'Category', key: 'cat', width: 16 },
    { header: 'Task / Item', key: 'item', width: 35 },
    { header: 'Owner', key: 'owner', width: 25 },
    { header: 'Severity / Priority', key: 'sev', width: 18 },
    { header: 'Due Date / Age', key: 'due', width: 20 },
    { header: 'Risk Rationale', key: 'rationale', width: 45 }
  ];

  risksSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  risksSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_PRIMARY}` }
  };
  risksSheet.autoFilter = 'A1:F1';

  data.overdueCommitments.forEach(c => {
    risksSheet.addRow({
      cat: 'Overdue Commitment',
      item: sanitizeSpreadsheetText(c.taskTitle),
      owner: sanitizeSpreadsheetText(c.owner),
      sev: c.priority,
      due: `${c.dueDate} (${c.daysOverdue} days late)`,
      rationale: 'Task deadline passed without completion'
    });
  });

  data.blockersAndRisks.forEach(b => {
    risksSheet.addRow({
      cat: 'Dependency Blocker',
      item: sanitizeSpreadsheetText(b.taskTitle),
      owner: sanitizeSpreadsheetText(b.owner),
      sev: b.severity,
      due: 'Blocked',
      rationale: sanitizeSpreadsheetText(b.blockerReason)
    });
  });

  // Sheet 3: Key Decisions
  const decisionsSheet = workbook.addWorksheet('Decisions for Management', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: true }]
  });

  decisionsSheet.columns = [
    { header: 'Decision', key: 'decision', width: 45 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Context / Rationale', key: 'context', width: 45 }
  ];

  decisionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  decisionsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${BRAND_PRIMARY}` }
  };
  decisionsSheet.autoFilter = 'A1:C1';

  data.keyDecisions.forEach(d => {
    decisionsSheet.addRow({
      decision: sanitizeSpreadsheetText(d.decision),
      date: d.date,
      context: sanitizeSpreadsheetText(d.context || 'Recorded during meeting')
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================================
// POWERPOINT REPORT BUILDERS
// ============================================================================

/**
 * Builds a PowerPoint presentation for an individual Meeting Summary.
 */
export async function generateMeetingPowerPoint(data: MeetingReportData): Promise<Buffer> {
  const pptx = new PptxGenClass();
  pptx.layout = 'LAYOUT_16x9';

  // Slide 1: Title Slide
  const slide1 = pptx.addSlide();
  slide1.bkgd = BRAND_PRIMARY;

  slide1.addText('ECHONOTE EXECUTIVE REPORT', {
    x: 0.8,
    y: 1.5,
    w: 8.5,
    fontSize: 14,
    color: '94A3B8',
    bold: true,
    fontFace: 'Arial'
  });

  slide1.addText(data.title || 'Meeting Summary', {
    x: 0.8,
    y: 2.2,
    w: 11.5,
    fontSize: 32,
    color: 'FFFFFF',
    bold: true,
    fontFace: 'Arial'
  });

  slide1.addText(`Date: ${data.date}   |   Project: ${data.primaryProjectName}   |   Owner: ${data.ownerEmail}`, {
    x: 0.8,
    y: 4.8,
    w: 11.5,
    fontSize: 14,
    color: 'CBD5E1',
    fontFace: 'Arial'
  });

  slide1.addText(`Associated Projects: ${data.associatedProjects.join(', ') || 'None'}`, {
    x: 0.8,
    y: 5.3,
    w: 11.5,
    fontSize: 12,
    color: '94A3B8',
    fontFace: 'Arial'
  });

  // Slide 2: Executive Summary & Main Topic
  const slide2 = pptx.addSlide();
  slide2.addText('Meeting Overview & Core Topic', {
    x: 0.8,
    y: 0.6,
    w: 11.5,
    fontSize: 22,
    bold: true,
    color: BRAND_PRIMARY
  });

  slide2.addText('Discussion Subject', {
    x: 0.8,
    y: 1.4,
    w: 11.5,
    fontSize: 14,
    bold: true,
    color: BRAND_ACCENT
  });

  slide2.addText(data.summary.mainTopic || 'General team collaboration and sync session.', {
    x: 0.8,
    y: 1.8,
    w: 11.5,
    h: 1.0,
    fontSize: 13,
    color: '334155'
  });

  slide2.addText('Executive Takeaways', {
    x: 0.8,
    y: 3.0,
    w: 11.5,
    fontSize: 14,
    bold: true,
    color: BRAND_ACCENT
  });

  const summaryBullets = data.executiveSummary && data.executiveSummary.length > 0
    ? data.executiveSummary
    : data.summary.keyPoints.slice(0, 4);

  if (summaryBullets.length > 0) {
    const textItems = summaryBullets.map(b => ({
      text: b,
      options: { bullet: true, fontSize: 13, color: '334155', breakLine: true }
    }));
    slide2.addText(textItems, { x: 0.8, y: 3.4, w: 11.5, h: 2.8 });
  } else {
    slide2.addText('No detailed executive bullets extracted.', { x: 0.8, y: 3.4, w: 11.5, fontSize: 12, color: BRAND_MUTED });
  }

  // Slide 3: Key Decisions
  const slide3 = pptx.addSlide();
  slide3.addText('Strategic Decisions Made', {
    x: 0.8,
    y: 0.6,
    w: 11.5,
    fontSize: 22,
    bold: true,
    color: BRAND_PRIMARY
  });

  if (data.summary.decisions && data.summary.decisions.length > 0) {
    const decTable = [
      [
        { text: '#', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
        { text: 'Decision Agreed Upon', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
        { text: 'Impact / Source', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } }
      ],
      ...data.summary.decisions.map((dec, i) => [
        { text: String(i + 1) },
        { text: dec },
        { text: 'Consensus' }
      ])
    ];

    slide3.addTable(decTable, {
      x: 0.8,
      y: 1.4,
      w: 11.5,
      colW: [0.8, 8.2, 2.5],
      fontSize: 11,
      border: { pt: 0.5, color: 'CBD5E1' }
    });
  } else {
    slide3.addText('No strategic decisions were explicitly finalized during this meeting.', {
      x: 0.8,
      y: 2.0,
      w: 11.5,
      fontSize: 13,
      color: BRAND_MUTED
    });
  }

  // Slide 4: Action Items & Task Assignees (Paginated if > 5 items)
  const actionItems = data.tasks.length > 0
    ? data.tasks.map(t => ({
        title: t.title,
        owner: t.assigneeName || t.assigneeEmail,
        status: t.status,
        dueDate: t.dueDate || 'Unset'
      }))
    : data.summary.actionItems.map(ai => ({
        title: ai,
        owner: 'Unassigned',
        status: 'pending',
        dueDate: 'Unspecified'
      }));

  const pageSize = 5;
  const pageCount = Math.ceil(Math.max(actionItems.length, 1) / pageSize);

  for (let p = 0; p < pageCount; p++) {
    const pageItems = actionItems.slice(p * pageSize, (p + 1) * pageSize);
    const slideAction = pptx.addSlide();
    slideAction.addText(`Action Items & Deliverables ${pageCount > 1 ? `(${p + 1}/${pageCount})` : ''}`, {
      x: 0.8,
      y: 0.6,
      w: 11.5,
      fontSize: 22,
      bold: true,
      color: BRAND_PRIMARY
    });

    if (pageItems.length > 0) {
      const taskTable = [
        [
          { text: 'Action Item / Deliverable', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
          { text: 'Owner', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
          { text: 'Status', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
          { text: 'Deadline', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } }
        ],
        ...pageItems.map(item => [
          { text: item.title },
          { text: item.owner },
          { text: item.status.toUpperCase() },
          { text: item.dueDate }
        ])
      ];

      slideAction.addTable(taskTable, {
        x: 0.8,
        y: 1.4,
        w: 11.5,
        colW: [5.5, 2.5, 1.7, 1.8],
        fontSize: 11,
        border: { pt: 0.5, color: 'CBD5E1' }
      });
    } else {
      slideAction.addText('No actionable deliverables were recorded for this meeting.', {
        x: 0.8,
        y: 2.0,
        w: 11.5,
        fontSize: 13,
        color: BRAND_MUTED
      });
    }
  }

  const rawBuffer = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer as ArrayBuffer);
}

/**
 * Builds a PowerPoint presentation for a Project Status Report.
 */
export async function generateProjectStatusPowerPoint(data: ProjectReportData): Promise<Buffer> {
  const pptx = new PptxGenClass();
  pptx.layout = 'LAYOUT_16x9';

  // Slide 1: Title Slide
  const s1 = pptx.addSlide();
  s1.bkgd = BRAND_PRIMARY;
  s1.addText('PROJECT STATUS & EXECUTION REPORT', {
    x: 0.8,
    y: 1.5,
    w: 8.5,
    fontSize: 14,
    color: '94A3B8',
    bold: true
  });
  s1.addText(data.projectName, {
    x: 0.8,
    y: 2.2,
    w: 11.5,
    fontSize: 34,
    color: 'FFFFFF',
    bold: true
  });
  s1.addText(`Reporting Date: ${data.reportingDate}   |   EchoNote Workspace Intelligence`, {
    x: 0.8,
    y: 5.0,
    w: 11.5,
    fontSize: 14,
    color: 'CBD5E1'
  });

  // Slide 2: KPI Dashboard
  const s2 = pptx.addSlide();
  s2.addText('Key Project Performance Indicators', {
    x: 0.8,
    y: 0.6,
    w: 11.5,
    fontSize: 22,
    bold: true,
    color: BRAND_PRIMARY
  });

  const cards = [
    { label: 'Total Tasks', value: String(data.metrics.totalTasks), color: BRAND_PRIMARY },
    { label: 'Completed', value: String(data.metrics.completedTasks), color: BRAND_SUCCESS },
    { label: 'In Progress', value: String(data.metrics.inProgressTasks), color: BRAND_ACCENT },
    { label: 'Overdue Work', value: String(data.metrics.overdueTasks), color: BRAND_DANGER }
  ];

  cards.forEach((card, idx) => {
    const xPos = 0.8 + idx * 2.9;
    s2.addShape(pptx.ShapeType.rect, {
      x: xPos,
      y: 1.5,
      w: 2.7,
      h: 1.6,
      fill: { color: BRAND_BG },
      line: { color: 'CBD5E1', width: 1 }
    });
    s2.addText(card.value, {
      x: xPos,
      y: 1.7,
      w: 2.7,
      fontSize: 30,
      bold: true,
      color: card.color,
      align: 'center'
    });
    s2.addText(card.label, {
      x: xPos,
      y: 2.4,
      w: 2.7,
      fontSize: 12,
      color: BRAND_MUTED,
      align: 'center'
    });
  });

  s2.addText('Operational Deadlines & Dependencies', {
    x: 0.8,
    y: 3.5,
    w: 11.5,
    fontSize: 16,
    bold: true,
    color: BRAND_PRIMARY
  });

  const subStats = [
    `• Due within 7 Days: ${data.metrics.tasksDueNext7Days} tasks`,
    `• Missing Target Deadlines: ${data.metrics.tasksWithoutDeadline} tasks`,
    `• Blocked by Prerequisites: ${data.metrics.blockedTasks} tasks`,
    `• Canonical Meetings Synchronized: ${data.meetings.length} sessions`
  ];
  s2.addText(subStats.map(s => ({ text: s, options: { breakLine: true, fontSize: 13, color: '334155' } })), {
    x: 0.8,
    y: 4.0,
    w: 11.5,
    h: 2.0
  });

  // Slide 3+: Task Register (Paginated in chunks of 5)
  const taskChunks = [];
  for (let i = 0; i < data.tasks.length; i += 5) {
    taskChunks.push(data.tasks.slice(i, i + 5));
  }

  if (taskChunks.length === 0) {
    const sTask = pptx.addSlide();
    sTask.addText('Project Task Register', { x: 0.8, y: 0.6, w: 11.5, fontSize: 22, bold: true, color: BRAND_PRIMARY });
    sTask.addText('No active tasks logged for this project container.', { x: 0.8, y: 2.0, w: 11.5, fontSize: 13, color: BRAND_MUTED });
  } else {
    taskChunks.forEach((chunk, pageIdx) => {
      const sTask = pptx.addSlide();
      sTask.addText(`Task Register ${taskChunks.length > 1 ? `(${pageIdx + 1}/${taskChunks.length})` : ''}`, {
        x: 0.8,
        y: 0.6,
        w: 11.5,
        fontSize: 22,
        bold: true,
        color: BRAND_PRIMARY
      });

      const tableData = [
        [
          { text: 'Task Title', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
          { text: 'Assignee', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
          { text: 'Status', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
          { text: 'Due Date', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
          { text: 'Overdue?', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } }
        ],
        ...chunk.map(t => [
          { text: t.title },
          { text: t.assigneeName || t.assigneeEmail },
          { text: t.status.toUpperCase() },
          { text: t.dueDate || 'Unset' },
          { text: t.isOverdue ? 'YES' : 'No' }
        ])
      ];

      sTask.addTable(tableData, {
        x: 0.8,
        y: 1.4,
        w: 11.5,
        colW: [4.8, 2.5, 1.5, 1.5, 1.2],
        fontSize: 11,
        border: { pt: 0.5, color: 'CBD5E1' }
      });
    });
  }

  const rawBuffer = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer as ArrayBuffer);
}

/**
 * Builds a PowerPoint presentation for an Executive Management Review.
 */
export async function generateManagementReviewPowerPoint(data: ManagementReviewData): Promise<Buffer> {
  const pptx = new PptxGenClass();
  pptx.layout = 'LAYOUT_16x9';

  // Slide 1: Title Slide
  const s1 = pptx.addSlide();
  s1.bkgd = BRAND_PRIMARY;
  s1.addText('MANAGEMENT REVIEW & STRATEGIC BRIEFING', {
    x: 0.8,
    y: 1.5,
    w: 8.5,
    fontSize: 14,
    color: '94A3B8',
    bold: true
  });
  s1.addText(data.projectName || 'Portfolio Review', {
    x: 0.8,
    y: 2.2,
    w: 11.5,
    fontSize: 34,
    color: 'FFFFFF',
    bold: true
  });
  s1.addText(`Period: ${data.reportingPeriod.startDate} to ${data.reportingPeriod.endDate}   |   Generated: ${data.generatedAt}`, {
    x: 0.8,
    y: 5.0,
    w: 11.5,
    fontSize: 14,
    color: 'CBD5E1'
  });

  // Slide 2: Executive Summary
  const s2 = pptx.addSlide();
  s2.addText('Executive Summary & Progress', {
    x: 0.8,
    y: 0.6,
    w: 11.5,
    fontSize: 22,
    bold: true,
    color: BRAND_PRIMARY
  });

  const bullets = data.executiveSummary.map(b => ({
    text: b,
    options: { bullet: true, fontSize: 13, color: '334155', breakLine: true }
  }));
  s2.addText(bullets, { x: 0.8, y: 1.5, w: 11.5, h: 4.5 });

  // Slide 3: Blockers, Risks & Critical Overdue Items
  const s3 = pptx.addSlide();
  s3.addText('Critical Risks & Overdue Commitments', {
    x: 0.8,
    y: 0.6,
    w: 11.5,
    fontSize: 22,
    bold: true,
    color: BRAND_PRIMARY
  });

  const riskRows = [
    ...data.overdueCommitments.slice(0, 3).map(c => [
      { text: 'Overdue' },
      { text: c.taskTitle },
      { text: c.owner },
      { text: `${c.dueDate} (${c.daysOverdue}d late)` },
      { text: c.priority.toUpperCase() }
    ]),
    ...data.blockersAndRisks.slice(0, 3).map(b => [
      { text: 'Blocker' },
      { text: b.taskTitle },
      { text: b.owner },
      { text: b.blockerReason },
      { text: b.severity.toUpperCase() }
    ])
  ];

  if (riskRows.length > 0) {
    const riskTable = [
      [
        { text: 'Type', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
        { text: 'Item', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
        { text: 'Owner', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
        { text: 'Details / Deadline', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
        { text: 'Severity', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } }
      ],
      ...riskRows
    ];

    s3.addTable(riskTable, {
      x: 0.8,
      y: 1.4,
      w: 11.5,
      colW: [1.5, 4.0, 2.2, 2.5, 1.3],
      fontSize: 10,
      border: { pt: 0.5, color: 'CBD5E1' }
    });
  } else {
    s3.addText('No critical blockers or overdue commitments requiring immediate escalation.', {
      x: 0.8,
      y: 2.0,
      w: 11.5,
      fontSize: 13,
      color: BRAND_SUCCESS
    });
  }

  // Slide 4: Key Decisions Requiring Management Attention
  const s4 = pptx.addSlide();
  s4.addText('Decisions Requiring Attention', {
    x: 0.8,
    y: 0.6,
    w: 11.5,
    fontSize: 22,
    bold: true,
    color: BRAND_PRIMARY
  });

  if (data.keyDecisions && data.keyDecisions.length > 0) {
    const decTable = [
      [
        { text: 'Strategic Decision', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
        { text: 'Date', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } },
        { text: 'Context / Rationale', options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY } } }
      ],
      ...data.keyDecisions.slice(0, 6).map(d => [
        { text: d.decision },
        { text: d.date },
        { text: d.context || 'Meeting outcome' }
      ])
    ];

    s4.addTable(decTable, {
      x: 0.8,
      y: 1.4,
      w: 11.5,
      colW: [5.0, 1.5, 5.0],
      fontSize: 10,
      border: { pt: 0.5, color: 'CBD5E1' }
    });
  } else {
    s4.addText('No outstanding strategic decisions currently recorded.', {
      x: 0.8,
      y: 2.0,
      w: 11.5,
      fontSize: 13,
      color: BRAND_MUTED
    });
  }

  const rawBuffer = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer as ArrayBuffer);
}

// ============================================================================
// AH.191: BOUNDED REPORT DATA COLLECTION & RESOURCE LIMITS
// ============================================================================

export const REPORT_BOUNDS = {
  /** Maximum tasks loaded and processed per report */
  MAX_TASKS_PER_REPORT: 500,
  /** Maximum meeting recordings loaded and processed per report */
  MAX_RECORDINGS_PER_REPORT: 200,
  /** Maximum decisions extracted across meetings per report */
  MAX_DECISIONS_PER_REPORT: 300,
  /** Maximum action items extracted across meetings per report */
  MAX_ACTION_ITEMS_PER_REPORT: 300,
  /** Firestore page fetch batch size */
  PAGE_BATCH_SIZE: 100
};

export interface BoundedReportResult {
  projectData: ProjectReportData;
  isTruncated: boolean;
  warnings?: string[];
  metricsSummary: {
    totalTasksScanned: number;
    totalRecordingsScanned: number;
    tasksBounded: boolean;
    recordingsBounded: boolean;
  };
}

/**
 * Bounded helper to collect verified project tasks and metrics for reporting.
 * Paginates queries with deterministic cursor ordering and bounds in-memory arrays.
 */
export async function collectProjectReportData(
  firestoreDb: any,
  projectId: string,
  projectName: string,
  dateRange?: { startDate?: string; endDate?: string }
): Promise<BoundedReportResult> {
  const warnings: string[] = [];
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const in7DaysMs = todayMs + (7 * 24 * 60 * 60 * 1000);

  const tasksList: any[] = [];
  let completedCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;
  let overdueCount = 0;
  let noDeadlineCount = 0;
  let dueNext7DaysCount = 0;
  let blockedCount = 0;

  let totalTasksScanned = 0;
  let tasksBounded = false;
  let lastTaskId: string | null = null;
  let hasMoreTasks = true;

  // 1. Paged task collection bounded by MAX_TASKS_PER_REPORT
  while (hasMoreTasks && totalTasksScanned < REPORT_BOUNDS.MAX_TASKS_PER_REPORT) {
    const fetchLimit = Math.min(
      REPORT_BOUNDS.PAGE_BATCH_SIZE,
      REPORT_BOUNDS.MAX_TASKS_PER_REPORT - totalTasksScanned
    );

    let query = firestoreDb
      .collection("projectTasks")
      .where("projectId", "==", projectId);

    if (typeof query.orderBy === 'function') {
      query = query.orderBy("__name__");
    }
    if (lastTaskId && typeof query.startAfter === 'function') {
      query = query.startAfter(lastTaskId);
    }
    if (typeof query.limit === 'function') {
      query = query.limit(fetchLimit);
    }

    const taskSnap = await query.get().catch(() => ({ docs: [] }));
    if (!taskSnap.docs || taskSnap.docs.length === 0) {
      hasMoreTasks = false;
      break;
    }

    for (const tDoc of taskSnap.docs) {
      totalTasksScanned++;
      lastTaskId = tDoc.id;

      const t = typeof tDoc.data === 'function' ? tDoc.data() : tDoc.data;
      const taskCreatedMs = t.createdAt ? new Date(t.createdAt).getTime() : 0;

      // Date range filtering if requested
      if (dateRange?.startDate) {
        const startMs = new Date(dateRange.startDate).getTime();
        if (!isNaN(startMs) && taskCreatedMs < startMs) continue;
      }
      if (dateRange?.endDate) {
        const endMs = new Date(dateRange.endDate).getTime() + 86400000;
        if (!isNaN(endMs) && taskCreatedMs > endMs) continue;
      }

      const isCompleted = t.status === 'completed';
      const isInProgress = t.status === 'in_progress';
      const isPending = t.status === 'pending' || !t.status;

      if (isCompleted) completedCount++;
      else if (isInProgress) inProgressCount++;
      else pendingCount++;

      let isOverdue = false;
      if (!isCompleted && t.dueDate) {
        const dueMs = new Date(t.dueDate).getTime();
        if (!isNaN(dueMs) && dueMs < todayMs) {
          isOverdue = true;
          overdueCount++;
        } else if (!isNaN(dueMs) && dueMs <= in7DaysMs) {
          dueNext7DaysCount++;
        }
      } else if (!t.dueDate && !isCompleted) {
        noDeadlineCount++;
      }

      if (t.dependencyStatus === 'blocked' || (Array.isArray(t.blockingPrerequisites) && t.blockingPrerequisites.length > 0)) {
        blockedCount++;
      }

      tasksList.push({
        id: tDoc.id,
        title: t.title || "Untitled Task",
        description: t.description || "",
        assigneeName: t.assigneeName || "",
        assigneeEmail: t.assigneeEmail || "Unassigned",
        status: t.status || "pending",
        priority: t.priority || "medium",
        startDate: t.startDate || null,
        dueDate: t.dueDate || null,
        isOverdue,
        dependencyStatus: t.dependencyStatus || "ready",
        blockingPrerequisitesCount: Array.isArray(t.blockingPrerequisites) ? t.blockingPrerequisites.length : 0
      });

      if (totalTasksScanned >= REPORT_BOUNDS.MAX_TASKS_PER_REPORT) {
        tasksBounded = true;
        hasMoreTasks = false;
        break;
      }
    }

    if (taskSnap.docs.length < fetchLimit) {
      hasMoreTasks = false;
    }
  }

  if (tasksBounded) {
    warnings.push(`Task results reached the maximum report limit of ${REPORT_BOUNDS.MAX_TASKS_PER_REPORT}. Additional tasks omitted for performance.`);
  }

  // 2. Bounded Recording Collection (Primary & Multi-Project Associations)
  const seenRecIds = new Set<string>();
  const meetings: any[] = [];
  const decisions: any[] = [];
  const outstandingActionItems: any[] = [];

  let totalRecordingsScanned = 0;
  let recordingsBounded = false;

  const fetchRecordingsBounded = async (filterField: string, filterOp: string, val: any) => {
    let lastRecId: string | null = null;
    let hasMore = true;

    while (hasMore && totalRecordingsScanned < REPORT_BOUNDS.MAX_RECORDINGS_PER_REPORT) {
      const fetchLimit = Math.min(
        REPORT_BOUNDS.PAGE_BATCH_SIZE,
        REPORT_BOUNDS.MAX_RECORDINGS_PER_REPORT - totalRecordingsScanned
      );

      let q = firestoreDb
        .collection("recordings")
        .where(filterField, filterOp, val);

      if (typeof q.orderBy === 'function') {
        q = q.orderBy("__name__");
      }
      if (lastRecId && typeof q.startAfter === 'function') {
        q = q.startAfter(lastRecId);
      }
      if (typeof q.limit === 'function') {
        q = q.limit(fetchLimit);
      }

      const snap = await q.get().catch(() => ({ docs: [] }));
      if (!snap.docs || snap.docs.length === 0) {
        break;
      }

      for (const rDoc of snap.docs) {
        lastRecId = rDoc.id;
        if (seenRecIds.has(rDoc.id)) continue;
        seenRecIds.add(rDoc.id);

        totalRecordingsScanned++;

        const r = typeof rDoc.data === 'function' ? rDoc.data() : rDoc.data;
        if (r.deletedAt) continue;

        const summary = r.summary || {};
        const decList = Array.isArray(summary.decisions) ? summary.decisions : [];
        const aiList = Array.isArray(summary.actionItems) ? summary.actionItems : [];

        meetings.push({
          id: rDoc.id,
          title: r.fileName || "Meeting Session",
          date: r.date || "Unknown",
          summaryTopic: summary.mainTopic || "",
          decisionsCount: decList.length,
          actionItemsCount: aiList.length
        });

        // Bounded decision extraction
        for (const d of decList) {
          if (decisions.length < REPORT_BOUNDS.MAX_DECISIONS_PER_REPORT) {
            decisions.push({
              title: typeof d === 'string' ? d : (d?.title || 'Decision'),
              source: r.fileName || "Meeting",
              date: r.date || "Recent"
            });
          }
        }

        // Bounded action items extraction
        for (const ai of aiList) {
          if (outstandingActionItems.length < REPORT_BOUNDS.MAX_ACTION_ITEMS_PER_REPORT) {
            outstandingActionItems.push({
              title: typeof ai === 'string' ? ai : (ai?.title || 'Action Item'),
              owner: (ai && typeof ai === 'object' && ai.owner) ? ai.owner : "Team Member",
              dueDate: (ai && typeof ai === 'object' && ai.dueDate) ? ai.dueDate : (r.date || "Unspecified"),
              priority: (ai && typeof ai === 'object' && ai.priority) ? ai.priority : "Normal",
              status: "pending"
            });
          }
        }

        if (totalRecordingsScanned >= REPORT_BOUNDS.MAX_RECORDINGS_PER_REPORT) {
          recordingsBounded = true;
          hasMore = false;
          break;
        }
      }

      if (snap.docs.length < fetchLimit) {
        hasMore = false;
      }
    }
  };

  // Fetch primary recordings
  await fetchRecordingsBounded("projectId", "==", projectId);
  // Fetch secondary associated recordings if bounds allow
  if (!recordingsBounded) {
    await fetchRecordingsBounded("projectIds", "array-contains", projectId);
  }

  if (recordingsBounded) {
    warnings.push(`Meeting recordings reached the maximum report limit of ${REPORT_BOUNDS.MAX_RECORDINGS_PER_REPORT}. Additional sessions omitted for performance.`);
  }

  const isTruncated = tasksBounded || recordingsBounded;

  const projectData: ProjectReportData = {
    projectId,
    projectName,
    reportingDate: new Date().toISOString().split("T")[0],
    metrics: {
      totalTasks: tasksList.length,
      completedTasks: completedCount,
      inProgressTasks: inProgressCount,
      pendingTasks: pendingCount,
      overdueTasks: overdueCount,
      tasksWithoutDeadline: noDeadlineCount,
      tasksDueNext7Days: dueNext7DaysCount,
      blockedTasks: blockedCount
    },
    tasks: tasksList,
    meetings,
    decisions,
    outstandingActionItems
  };

  return {
    projectData,
    isTruncated,
    warnings: warnings.length > 0 ? warnings : undefined,
    metricsSummary: {
      totalTasksScanned,
      totalRecordingsScanned,
      tasksBounded,
      recordingsBounded
    }
  };
}

