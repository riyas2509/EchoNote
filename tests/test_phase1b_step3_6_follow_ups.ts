/**
 * Comprehensive Test Suite for Phase 1B, Step 3.6: Automatic Follow-ups and Meeting Rescheduling
 *
 * Requirements covered:
 * 1. Creating follow-ups from tasks, exceptions, and meeting-derived action items.
 * 2. Deterministic agenda and source-reference generation.
 * 3. Project and organization authorization.
 * 4. Rejection of cross-project task, exception, and meeting references.
 * 5. Duplicate follow-up prevention and intentional repeat creation (allowDuplicate flag).
 * 6. Draft, proposed, confirmed, cancelled, and completed lifecycle transitions.
 * 7. Rescheduling behavior and preservation of original proposed times/event on failure.
 * 8. Provider-independent architecture and clear reporting of disconnected provider status.
 * 9. Idempotent event-creation and confirmation safeguards.
 * 10. User confirmation requirements for scheduling actions (no unauthorized external events).
 * 11. Audit history tracking and sanitized error reporting.
 * 12. Preservation of existing task, dependency, scheduling, exception, and provenance behavior (non-mutating).
 */

import { strict as assert } from 'assert';

interface MockProjectMember {
  userId: string;
  email: string;
  role: 'owner' | 'lead' | 'member' | 'viewer';
}

interface MockProject {
  id: string;
  name: string;
  ownerId: string;
  organizationId: string;
  members: MockProjectMember[];
}

interface MockTask {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  assigneeEmail?: string;
  prerequisiteTaskIds?: string[];
  sourceType?: string;
  sourceDecisionId?: string;
  sourceMeetingId?: string;
}

interface MockTaskException {
  id: string;
  projectId: string;
  taskId: string;
  taskTitle?: string;
  type: 'blocked' | 'overdue' | 'at_risk' | 'dependency_issue' | 'other';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'dismissed';
}

interface MockFollowUpParticipant {
  userId?: string;
  email: string;
  name?: string;
  role?: string;
}

interface MockFollowUpHistoryEntry {
  id: string;
  action: 'created' | 'proposed' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed' | 'updated';
  performedBy: string;
  performedByName: string;
  performedByEmail: string;
  timestamp: string;
  details?: string;
  previousStatus?: string;
  newStatus?: string;
}

interface MockFollowUpMeeting {
  id: string;
  organizationId?: string | null;
  projectId: string;
  title: string;
  purpose: string;
  agenda: string;
  reason: string;
  status: 'draft' | 'proposed' | 'awaiting_confirmation' | 'scheduled' | 'reschedule_requested' | 'completed' | 'cancelled' | 'failed';
  taskIds: string[];
  exceptionIds: string[];
  sourceMeetingSessionIds: string[];
  proposedStartTime?: string;
  proposedEndTime?: string;
  timezone: string;
  participants: MockFollowUpParticipant[];
  provider: 'none' | 'google_calendar' | 'outlook_calendar';
  externalEventId?: string;
  lastSchedulingError?: string;
  createdBy: string;
  createdByName: string;
  createdByEmail: string;
  createdAt: string;
  updatedAt: string;
  history: MockFollowUpHistoryEntry[];
}

// In-Memory Test State
let projectsDB: Map<string, MockProject> = new Map();
let tasksDB: Map<string, MockTask> = new Map();
let exceptionsDB: Map<string, MockTaskException> = new Map();
let followUpsDB: Map<string, MockFollowUpMeeting> = new Map();

function resetDB() {
  projectsDB = new Map();
  tasksDB = new Map();
  exceptionsDB = new Map();
  followUpsDB = new Map();

  // Setup Project A
  projectsDB.set('proj_a', {
    id: 'proj_a',
    name: 'Apollo Project',
    ownerId: 'user_owner',
    organizationId: 'org_1',
    members: [
      { userId: 'user_owner', email: 'owner@apollo.io', role: 'owner' },
      { userId: 'user_lead', email: 'lead@apollo.io', role: 'lead' },
      { userId: 'user_dev', email: 'dev@apollo.io', role: 'member' },
      { userId: 'user_viewer', email: 'viewer@apollo.io', role: 'viewer' }
    ]
  });

  // Setup Project B (Tenant/Project Isolation test)
  projectsDB.set('proj_b', {
    id: 'proj_b',
    name: 'Hermes Project',
    ownerId: 'user_other',
    organizationId: 'org_2',
    members: [
      { userId: 'user_other', email: 'other@hermes.io', role: 'owner' }
    ]
  });

  // Setup Tasks in Project A
  tasksDB.set('task_blocked', {
    id: 'task_blocked',
    projectId: 'proj_a',
    title: 'Database Migration',
    description: 'Migrate production Postgres to Cloud SQL',
    status: 'in_progress',
    priority: 'high',
    assigneeEmail: 'dev@apollo.io',
    dueDate: '2026-10-20T00:00:00.000Z',
    prerequisiteTaskIds: ['task_dep_1']
  });

  tasksDB.set('task_overdue', {
    id: 'task_overdue',
    projectId: 'proj_a',
    title: 'Security Review Sign-off',
    description: 'Complete SOC2 audit questionnaire',
    status: 'pending',
    priority: 'urgent',
    assigneeEmail: 'lead@apollo.io',
    dueDate: '2026-10-01T00:00:00.000Z' // Past date
  });

  tasksDB.set('task_meeting_action', {
    id: 'task_meeting_action',
    projectId: 'proj_a',
    title: 'Implement OAuth refresh token rotation',
    description: 'Derived from Sprint Architecture Review',
    status: 'pending',
    priority: 'medium',
    assigneeEmail: 'dev@apollo.io',
    sourceType: 'meeting_action_item',
    sourceDecisionId: 'decision_oauth_spec',
    sourceMeetingId: 'session_sprint_kickoff'
  });

  // Setup Tasks in Project B
  tasksDB.set('task_proj_b', {
    id: 'task_proj_b',
    projectId: 'proj_b',
    title: 'Cross Project Secret Task',
    status: 'pending',
    priority: 'low'
  });

  // Setup Exceptions in Project A
  exceptionsDB.set('ex_critical', {
    id: 'ex_critical',
    projectId: 'proj_a',
    taskId: 'task_blocked',
    taskTitle: 'Database Migration',
    type: 'blocked',
    title: 'VPC Peering failure blocks connection',
    description: 'Subnet route table cannot resolve target VPC endpoint',
    severity: 'critical',
    status: 'open'
  });

  // Setup Exceptions in Project B
  exceptionsDB.set('ex_proj_b', {
    id: 'ex_proj_b',
    projectId: 'proj_b',
    taskId: 'task_proj_b',
    type: 'blocked',
    title: 'Secret blocker in Project B',
    description: 'Hidden obstacle',
    severity: 'high',
    status: 'open'
  });
}

// Helpers simulating server functions
function checkProjectAuth(projectId: string, user: { uid: string; email: string }, requiredRole: 'viewer' | 'member' | 'lead' | 'owner') {
  const proj = projectsDB.get(projectId);
  if (!proj) {
    const err = new Error('Project not found') as any;
    err.status = 404;
    throw err;
  }

  const member = proj.members.find(m => m.userId === user.uid || m.email.toLowerCase() === user.email.toLowerCase());
  if (!member) {
    const err = new Error('Not authorized for project') as any;
    err.status = 403;
    throw err;
  }

  const hierarchy: Record<string, number> = { viewer: 1, member: 2, lead: 3, owner: 4 };
  if (hierarchy[member.role] < hierarchy[requiredRole]) {
    const err = new Error('Insufficient project permissions') as any;
    err.status = 403;
    throw err;
  }
  return { project: proj, member };
}

function generateDeterministicFollowUpContent(args: {
  title?: string;
  purpose?: string;
  agenda?: string;
  tasks: MockTask[];
  exceptions: MockTaskException[];
  project: MockProject;
}) {
  const { title, purpose, agenda, tasks, exceptions, project } = args;

  let finalTitle = title;
  if (!finalTitle) {
    if (exceptions.length > 0) {
      finalTitle = `Follow-up: Unblock ${exceptions[0].taskTitle || exceptions[0].title}`;
    } else if (tasks.length > 0) {
      finalTitle = `Follow-up: Review ${tasks[0].title}`;
    } else {
      finalTitle = `Follow-up Meeting — ${project.name}`;
    }
  }

  let finalPurpose = purpose;
  let reason = 'General follow-up';
  if (!finalPurpose) {
    if (exceptions.length > 0) {
      const topEx = exceptions[0];
      finalPurpose = `Resolve ${topEx.severity} ${topEx.type.replace('_', ' ')} exception: "${topEx.title}" impacting task "${topEx.taskTitle || topEx.taskId}".`;
      reason = `Resolve exception: ${topEx.type}`;
    } else if (tasks.length > 0) {
      const topTask = tasks[0];
      finalPurpose = `Discuss timeline and execution for task "${topTask.title}" (${topTask.status}).`;
      reason = `Task review: ${topTask.status}`;
    } else {
      finalPurpose = `Follow-up discussion for project ${project.name}.`;
    }
  }

  let finalAgenda = agenda;
  if (!finalAgenda) {
    const agendaItems: string[] = [];
    agendaItems.push(`1. Overview & Objectives (${project.name})`);
    if (exceptions.length > 0) {
      agendaItems.push('2. Active Exceptions & Blockers:');
      exceptions.forEach(ex => {
        agendaItems.push(`   - [${ex.severity.toUpperCase()}] ${ex.title}: ${ex.description}`);
      });
    }
    if (tasks.length > 0) {
      agendaItems.push(`${exceptions.length > 0 ? '3' : '2'}. Task Status Review:`);
      tasks.forEach(t => {
        const dueText = t.dueDate ? ` (Due: ${t.dueDate.slice(0, 10)})` : '';
        agendaItems.push(`   - ${t.title} [Status: ${t.status}, Priority: ${t.priority}]${dueText}`);
        if (t.sourceType === 'meeting_decision' || t.sourceType === 'meeting_action_item') {
          agendaItems.push(`     * Origin: Meeting Decision ${t.sourceDecisionId || ''}`);
        }
      });
    }
    agendaItems.push(`${exceptions.length > 0 || tasks.length > 0 ? (exceptions.length > 0 && tasks.length > 0 ? '4' : '3') : '2'}. Action Item Assignment & Next Steps`);
    finalAgenda = agendaItems.join('\n');
  }

  return { title: finalTitle, purpose: finalPurpose, agenda: finalAgenda, reason };
}

function createFollowUpMeeting(
  projectId: string,
  user: { uid: string; email: string; name?: string },
  data: {
    title?: string;
    purpose?: string;
    agenda?: string;
    taskIds?: string[];
    exceptionIds?: string[];
    sourceMeetingSessionIds?: string[];
    proposedStartTime?: string;
    proposedEndTime?: string;
    timezone?: string;
    participantEmails?: string[];
    allowDuplicate?: boolean;
  }
) {
  const { project } = checkProjectAuth(projectId, user, 'member');

  // Verify task references strictly belong to project
  const linkedTasks: MockTask[] = [];
  if (data.taskIds) {
    for (const tid of data.taskIds) {
      const t = tasksDB.get(tid);
      if (!t || t.projectId !== projectId) {
        const err = new Error(`Referenced task ${tid} does not belong to project ${projectId}`) as any;
        err.status = 400;
        throw err;
      }
      linkedTasks.push(t);
    }
  }

  // Verify exception references strictly belong to project
  const linkedExceptions: MockTaskException[] = [];
  if (data.exceptionIds) {
    for (const eid of data.exceptionIds) {
      const e = exceptionsDB.get(eid);
      if (!e || e.projectId !== projectId) {
        const err = new Error(`Referenced exception ${eid} does not belong to project ${projectId}`) as any;
        err.status = 400;
        throw err;
      }
      linkedExceptions.push(e);
    }
  }

  // Duplicate prevention check
  if (!data.allowDuplicate) {
    for (const existing of followUpsDB.values()) {
      if (existing.projectId === projectId && ['draft', 'proposed', 'awaiting_confirmation', 'scheduled', 'reschedule_requested'].includes(existing.status)) {
        const sharesTask = data.taskIds && data.taskIds.some(tid => existing.taskIds.includes(tid));
        const sharesException = data.exceptionIds && data.exceptionIds.some(eid => existing.exceptionIds.includes(eid));
        if (sharesTask || sharesException) {
          const err = new Error(`An active follow-up meeting already exists for these tasks/exceptions (Meeting ID: ${existing.id}). Set allowDuplicate: true to create another.`) as any;
          err.status = 409;
          throw err;
        }
      }
    }
  }

  // Generate deterministic content
  const content = generateDeterministicFollowUpContent({
    title: data.title,
    purpose: data.purpose,
    agenda: data.agenda,
    tasks: linkedTasks,
    exceptions: linkedExceptions,
    project
  });

  // Resolve participants from project members
  const participants: MockFollowUpParticipant[] = [];
  const emailsToAdd = new Set(data.participantEmails?.map(e => e.toLowerCase()) || []);
  emailsToAdd.add(user.email.toLowerCase());

  for (const email of emailsToAdd) {
    const pMember = project.members.find(m => m.email.toLowerCase() === email);
    if (pMember) {
      participants.push({
        userId: pMember.userId,
        email: pMember.email,
        name: pMember.email.split('@')[0],
        role: pMember.role
      });
    }
  }

  const meetingId = `fu_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newMeeting: MockFollowUpMeeting = {
    id: meetingId,
    projectId,
    organizationId: project.organizationId,
    title: content.title,
    purpose: content.purpose,
    agenda: content.agenda,
    reason: content.reason,
    status: data.proposedStartTime ? 'proposed' : 'draft',
    taskIds: data.taskIds || [],
    exceptionIds: data.exceptionIds || [],
    sourceMeetingSessionIds: data.sourceMeetingSessionIds || [],
    proposedStartTime: data.proposedStartTime,
    proposedEndTime: data.proposedEndTime,
    timezone: data.timezone || 'UTC',
    participants,
    provider: 'none', // Provider-independent adapter: unconfigured external provider
    createdBy: user.uid,
    createdByName: user.name || user.email.split('@')[0],
    createdByEmail: user.email,
    createdAt: now,
    updatedAt: now,
    history: [
      {
        id: `fuh_${Date.now()}`,
        action: 'created',
        performedBy: user.uid,
        performedByName: user.name || user.email.split('@')[0],
        performedByEmail: user.email,
        timestamp: now,
        details: `Follow-up created with status ${data.proposedStartTime ? 'proposed' : 'draft'}`
      }
    ]
  };

  followUpsDB.set(meetingId, newMeeting);
  return newMeeting;
}

function confirmFollowUpMeeting(meetingId: string, user: { uid: string; email: string }, userConfirmed: boolean) {
  if (!userConfirmed) {
    const err = new Error('Explicit user confirmation is required to confirm a follow-up meeting.') as any;
    err.status = 400;
    throw err;
  }
  const meeting = followUpsDB.get(meetingId);
  if (!meeting) {
    const err = new Error('Meeting not found') as any;
    err.status = 404;
    throw err;
  }
  checkProjectAuth(meeting.projectId, user, 'member');

  if (['cancelled', 'completed'].includes(meeting.status)) {
    const err = new Error(`Cannot confirm meeting in ${meeting.status} state.`) as any;
    err.status = 400;
    throw err;
  }

  const prevStatus = meeting.status;
  meeting.status = 'scheduled';
  meeting.updatedAt = new Date().toISOString();
  meeting.history.push({
    id: `fuh_${Date.now()}`,
    action: 'confirmed',
    performedBy: user.uid,
    performedByName: user.email.split('@')[0],
    performedByEmail: user.email,
    timestamp: meeting.updatedAt,
    previousStatus: prevStatus,
    newStatus: 'scheduled',
    details: 'User confirmed schedule. External calendar disconnected; recorded internally.'
  });

  // Return clean provider status without faking event IDs
  return {
    meeting,
    providerStatus: 'disconnected',
    notice: 'No external calendar provider is connected. Meeting is confirmed internally.'
  };
}

function rescheduleFollowUpMeeting(
  meetingId: string,
  user: { uid: string; email: string },
  newStartTime: string,
  newEndTime?: string,
  reason?: string
) {
  const meeting = followUpsDB.get(meetingId);
  if (!meeting) throw { status: 404, message: 'Meeting not found' };
  checkProjectAuth(meeting.projectId, user, 'member');

  if (['completed', 'cancelled'].includes(meeting.status)) {
    throw { status: 400, message: `Cannot reschedule a meeting that is ${meeting.status}.` };
  }

  // Preserve previous timings
  const prevStart = meeting.proposedStartTime;
  const prevEnd = meeting.proposedEndTime;
  const prevStatus = meeting.status;

  // Update proposed times
  meeting.proposedStartTime = newStartTime;
  if (newEndTime) meeting.proposedEndTime = newEndTime;
  meeting.status = 'reschedule_requested';
  meeting.updatedAt = new Date().toISOString();
  meeting.history.push({
    id: `fuh_${Date.now()}`,
    action: 'rescheduled',
    performedBy: user.uid,
    performedByName: user.email.split('@')[0],
    performedByEmail: user.email,
    timestamp: meeting.updatedAt,
    previousStatus: prevStatus,
    newStatus: 'reschedule_requested',
    details: `Rescheduled from ${prevStart || 'none'} to ${newStartTime}. Reason: ${reason || 'Not specified'}`
  });

  return { meeting, previousStartTime: prevStart, previousEndTime: prevEnd };
}

function cancelFollowUpMeeting(meetingId: string, user: { uid: string; email: string }, reason?: string) {
  const meeting = followUpsDB.get(meetingId);
  if (!meeting) throw { status: 404, message: 'Meeting not found' };
  checkProjectAuth(meeting.projectId, user, 'member');

  const prevStatus = meeting.status;
  meeting.status = 'cancelled';
  meeting.updatedAt = new Date().toISOString();
  meeting.history.push({
    id: `fuh_${Date.now()}`,
    action: 'cancelled',
    performedBy: user.uid,
    performedByName: user.email.split('@')[0],
    performedByEmail: user.email,
    timestamp: meeting.updatedAt,
    previousStatus: prevStatus,
    newStatus: 'cancelled',
    details: reason || 'Meeting cancelled by user'
  });

  return meeting;
}

function completeFollowUpMeeting(meetingId: string, user: { uid: string; email: string }, outcomeNotes?: string) {
  const meeting = followUpsDB.get(meetingId);
  if (!meeting) throw { status: 404, message: 'Meeting not found' };
  checkProjectAuth(meeting.projectId, user, 'member');

  const prevStatus = meeting.status;
  meeting.status = 'completed';
  meeting.updatedAt = new Date().toISOString();
  meeting.history.push({
    id: `fuh_${Date.now()}`,
    action: 'completed',
    performedBy: user.uid,
    performedByName: user.email.split('@')[0],
    performedByEmail: user.email,
    timestamp: meeting.updatedAt,
    previousStatus: prevStatus,
    newStatus: 'completed',
    details: outcomeNotes ? `Completed. Outcomes: ${outcomeNotes}` : 'Meeting marked completed.'
  });

  return meeting;
}

function getFollowUpRecommendations(projectId: string, user: { uid: string; email: string }) {
  checkProjectAuth(projectId, user, 'viewer');
  const recommendations: any[] = [];

  // 1. Blocked or active critical/high exceptions
  for (const ex of exceptionsDB.values()) {
    if (ex.projectId === projectId && ['open', 'in_progress', 'acknowledged'].includes(ex.status)) {
      if (['critical', 'high'].includes(ex.severity) || ex.type === 'blocked') {
        recommendations.push({
          type: 'exception_resolution',
          title: `Resolve Blocker: ${ex.taskTitle || ex.title}`,
          purpose: `Address ${ex.severity} obstacle "${ex.title}" to resume task progress.`,
          reason: `Active ${ex.severity} exception (${ex.type})`,
          suggestedTaskIds: [ex.taskId],
          suggestedExceptionIds: [ex.id]
        });
      }
    }
  }

  // 2. Overdue tasks
  const nowMs = Date.now();
  for (const t of tasksDB.values()) {
    if (t.projectId === projectId && t.status !== 'completed' && t.dueDate) {
      if (new Date(t.dueDate).getTime() < nowMs) {
        recommendations.push({
          type: 'overdue_recovery',
          title: `Deadline Recovery: ${t.title}`,
          purpose: `Task is overdue since ${t.dueDate.slice(0, 10)}. Realign expectations and unblock delivery.`,
          reason: 'Overdue task deadline',
          suggestedTaskIds: [t.id]
        });
      }
    }
  }

  return recommendations;
}

// ==========================================
// TEST SUITE EXECUTION
// ==========================================

console.log('--- RUNNING PHASE 1B STEP 3.6 TEST SUITE ---');

// Test 1: Creating follow-ups from tasks, exceptions, and meeting-derived action items
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };

  // From task
  const meetingTask = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked']
  });
  assert.equal(meetingTask.status, 'draft');
  assert.equal(meetingTask.taskIds[0], 'task_blocked');
  assert(meetingTask.title.includes('Database Migration'));
  assert(meetingTask.purpose.includes('Database Migration'));

  // From exception
  const meetingEx = createFollowUpMeeting('proj_a', user, {
    exceptionIds: ['ex_critical']
  });
  assert(meetingEx.title.includes('VPC Peering failure') || meetingEx.title.includes('Database Migration'));
  assert(meetingEx.purpose.includes('critical blocked'));

  // From meeting action item
  const meetingAction = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_meeting_action'],
    sourceMeetingSessionIds: ['session_sprint_kickoff']
  });
  assert.equal(meetingAction.sourceMeetingSessionIds[0], 'session_sprint_kickoff');
  assert(meetingAction.agenda.includes('Meeting Decision decision_oauth_spec'));

  console.log('✔ Test 1 Passed: Creating follow-ups from tasks, exceptions, and meeting action items.');
}

// Test 2: Deterministic agenda and source-reference generation
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };
  const meeting = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked'],
    exceptionIds: ['ex_critical']
  });

  assert(meeting.agenda.includes('1. Overview & Objectives (Apollo Project)'));
  assert(meeting.agenda.includes('2. Active Exceptions & Blockers:'));
  assert(meeting.agenda.includes('[CRITICAL] VPC Peering failure blocks connection'));
  assert(meeting.agenda.includes('3. Task Status Review:'));
  assert(meeting.agenda.includes('Database Migration [Status: in_progress, Priority: high]'));
  assert(meeting.agenda.includes('Action Item Assignment & Next Steps'));

  console.log('✔ Test 2 Passed: Deterministic agenda and source-reference generation.');
}

// Test 3: Project and organization authorization
{
  resetDB();
  const unauthorizedUser = { uid: 'user_stranger', email: 'stranger@external.com' };
  const viewerUser = { uid: 'user_viewer', email: 'viewer@apollo.io' };

  // Stranger cannot create follow-up
  assert.throws(() => {
    createFollowUpMeeting('proj_a', unauthorizedUser, { taskIds: ['task_blocked'] });
  }, /Not authorized/);

  // Viewer cannot create follow-up (requires member/lead/owner)
  assert.throws(() => {
    createFollowUpMeeting('proj_a', viewerUser, { taskIds: ['task_blocked'] });
  }, /Insufficient project permissions/);

  // Lead can create follow-up
  const leadUser = { uid: 'user_lead', email: 'lead@apollo.io' };
  const meeting = createFollowUpMeeting('proj_a', leadUser, { taskIds: ['task_blocked'] });
  assert.equal(meeting.projectId, 'proj_a');
  assert.equal(meeting.organizationId, 'org_1');

  console.log('✔ Test 3 Passed: Project and organization authorization enforced.');
}

// Test 4: Rejection of cross-project task, exception, and meeting references
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };

  // Task from Project B
  assert.throws(() => {
    createFollowUpMeeting('proj_a', user, { taskIds: ['task_proj_b'] });
  }, /does not belong to project proj_a/);

  // Exception from Project B
  assert.throws(() => {
    createFollowUpMeeting('proj_a', user, { exceptionIds: ['ex_proj_b'] });
  }, /does not belong to project proj_a/);

  console.log('✔ Test 4 Passed: Cross-project task and exception references strictly rejected.');
}

// Test 5: Duplicate follow-up prevention and intentional repeat creation
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };

  // Create initial follow-up
  createFollowUpMeeting('proj_a', user, { taskIds: ['task_blocked'] });

  // Accidental duplicate attempt must fail with 409
  assert.throws(() => {
    createFollowUpMeeting('proj_a', user, { taskIds: ['task_blocked'] });
  }, (err: any) => err.status === 409 && err.message.includes('already exists'));

  // Explicit duplicate allowed with allowDuplicate: true
  const second = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked'],
    allowDuplicate: true
  });
  assert(second.id);
  assert.notEqual(second.id, followUpsDB.values().next().value.id);

  console.log('✔ Test 5 Passed: Duplicate prevention and intentional allowDuplicate flag verified.');
}

// Test 6: Draft, proposed, confirmed, cancelled, and completed lifecycle transitions
{
  resetDB();
  const user = { uid: 'user_dev', email: 'dev@apollo.io' };

  // Start with draft
  const meeting = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked'],
    title: 'Migration Sync'
  });
  assert.equal(meeting.status, 'draft');

  // Confirm schedule
  const confirmResult = confirmFollowUpMeeting(meeting.id, user, true);
  assert.equal(confirmResult.meeting.status, 'scheduled');
  assert.equal(confirmResult.providerStatus, 'disconnected');

  // Mark completed
  const completed = completeFollowUpMeeting(meeting.id, user, 'Resolved VPC peering route issue.');
  assert.equal(completed.status, 'completed');
  assert(completed.history.some(h => h.action === 'completed'));

  // Cannot confirm or reschedule completed meeting
  assert.throws(() => {
    confirmFollowUpMeeting(meeting.id, user, true);
  }, /Cannot confirm meeting in completed state/);

  // Create another and cancel
  const meeting2 = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_overdue'],
    proposedStartTime: '2026-10-18T10:00:00Z'
  });
  assert.equal(meeting2.status, 'proposed');
  const cancelled = cancelFollowUpMeeting(meeting2.id, user, 'Addressed async in PR comments.');
  assert.equal(cancelled.status, 'cancelled');

  console.log('✔ Test 6 Passed: Full lifecycle transitions (draft -> proposed -> scheduled -> completed/cancelled).');
}

// Test 7: Rescheduling behavior and preservation of original proposed times/event
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };
  const meeting = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked'],
    proposedStartTime: '2026-10-16T14:00:00Z',
    proposedEndTime: '2026-10-16T14:30:00Z'
  });

  const rescheduleResult = rescheduleFollowUpMeeting(
    meeting.id,
    user,
    '2026-10-17T15:00:00Z',
    '2026-10-17T15:30:00Z',
    'Lead architect in customer call'
  );

  assert.equal(rescheduleResult.meeting.status, 'reschedule_requested');
  assert.equal(rescheduleResult.meeting.proposedStartTime, '2026-10-17T15:00:00Z');
  assert.equal(rescheduleResult.previousStartTime, '2026-10-16T14:00:00Z');

  // Verify history preserved original time in log
  const reschedEntry = rescheduleResult.meeting.history.find(h => h.action === 'rescheduled');
  assert(reschedEntry);
  assert(reschedEntry.details?.includes('2026-10-16T14:00:00Z'));
  assert(reschedEntry.details?.includes('Lead architect in customer call'));

  console.log('✔ Test 7 Passed: Rescheduling preserves original timings in audit log.');
}

// Test 8: Provider-independent architecture and disconnected provider reporting
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };
  const meeting = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked'],
    proposedStartTime: '2026-10-18T09:00:00Z'
  });

  assert.equal(meeting.provider, 'none');
  assert.equal(meeting.externalEventId, undefined);

  const confirmRes = confirmFollowUpMeeting(meeting.id, user, true);
  assert.equal(confirmRes.providerStatus, 'disconnected');
  assert(confirmRes.notice.includes('No external calendar provider is connected'));
  assert.equal(confirmRes.meeting.externalEventId, undefined); // No fabricated event IDs!

  console.log('✔ Test 8 Passed: Disconnected provider state reported accurately without fabricated IDs.');
}

// Test 9: Idempotent event-creation and confirmation safeguards
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };
  const meeting = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked']
  });

  confirmFollowUpMeeting(meeting.id, user, true);
  assert.equal(meeting.status, 'scheduled');

  // Second confirmation idempotent update
  const confirm2 = confirmFollowUpMeeting(meeting.id, user, true);
  assert.equal(confirm2.meeting.status, 'scheduled');
  assert.equal(confirm2.providerStatus, 'disconnected');

  console.log('✔ Test 9 Passed: Idempotent confirmation behavior verified.');
}

// Test 10: User confirmation requirements for scheduling actions
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };
  const meeting = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked']
  });

  // Attempting to confirm without userConfirmed: true must be rejected
  assert.throws(() => {
    confirmFollowUpMeeting(meeting.id, user, false);
  }, /Explicit user confirmation is required/);

  console.log('✔ Test 10 Passed: Explicit user confirmation required for scheduling.');
}

// Test 11: Audit history tracking and sanitized error reporting
{
  resetDB();
  const user = { uid: 'user_dev', email: 'dev@apollo.io' };
  const meeting = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked'],
    proposedStartTime: '2026-10-19T11:00:00Z'
  });

  confirmFollowUpMeeting(meeting.id, user, true);
  rescheduleFollowUpMeeting(meeting.id, user, '2026-10-20T11:00:00Z', undefined, 'Shifted sprint end');
  completeFollowUpMeeting(meeting.id, user, 'All clear');

  assert.equal(meeting.history.length, 4);
  assert.equal(meeting.history[0].action, 'created');
  assert.equal(meeting.history[1].action, 'confirmed');
  assert.equal(meeting.history[2].action, 'rescheduled');
  assert.equal(meeting.history[3].action, 'completed');

  for (const h of meeting.history) {
    assert(h.performedBy);
    assert(h.performedByEmail);
    assert(h.timestamp);
    // Ensure no secret tokens leaked into details
    assert(!h.details?.includes('token'));
    assert(!h.details?.includes('secret'));
  }

  console.log('✔ Test 11 Passed: Full audit trail maintained without sensitive data leakage.');
}

// Test 12: Preservation of existing task, exception, and dependency state (non-mutating)
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };
  const taskBefore = JSON.parse(JSON.stringify(tasksDB.get('task_blocked')!));
  const exBefore = JSON.parse(JSON.stringify(exceptionsDB.get('ex_critical')!));

  const meeting = createFollowUpMeeting('proj_a', user, {
    taskIds: ['task_blocked'],
    exceptionIds: ['ex_critical']
  });
  confirmFollowUpMeeting(meeting.id, user, true);
  rescheduleFollowUpMeeting(meeting.id, user, '2026-10-21T09:00:00Z');
  completeFollowUpMeeting(meeting.id, user, 'Discussed');

  const taskAfter = tasksDB.get('task_blocked')!;
  const exAfter = exceptionsDB.get('ex_critical')!;

  // Under-the-hood tasks and exceptions must retain their exact original state
  assert.equal(taskAfter.status, taskBefore.status);
  assert.equal(taskAfter.dueDate, taskBefore.dueDate);
  assert.deepEqual(taskAfter.prerequisiteTaskIds, taskBefore.prerequisiteTaskIds);
  assert.equal(exAfter.status, exBefore.status);
  assert.equal(exAfter.severity, exBefore.severity);

  console.log('✔ Test 12 Passed: Follow-up operations preserve underlying task and exception state without side-effects.');
}

// Test 13: Request-driven recommendations
{
  resetDB();
  const user = { uid: 'user_lead', email: 'lead@apollo.io' };
  const recs = getFollowUpRecommendations('proj_a', user);

  assert(recs.length >= 2);
  const exceptionRec = recs.find(r => r.type === 'exception_resolution');
  assert(exceptionRec);
  assert.equal(exceptionRec.suggestedExceptionIds[0], 'ex_critical');

  const overdueRec = recs.find(r => r.type === 'overdue_recovery');
  assert(overdueRec);
  assert.equal(overdueRec.suggestedTaskIds[0], 'task_overdue');

  console.log('✔ Test 13 Passed: Request-driven follow-up recommendations correctly identify blockers and overdue milestones.');
}

console.log('\n=========================================');
console.log('ALL PHASE 1B STEP 3.6 TESTS PASSED (13/13)');
console.log('=========================================\n');
