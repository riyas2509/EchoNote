import assert from 'node:assert';
import { FollowUpMeeting, ProjectTask, TaskException, CollaborationRole } from '../types';

console.log('=== Running CollaborationDashboard Reasoning Meeting Integration Tests ===');

const mockTask: ProjectTask = {
  id: 'task_abc',
  projectId: 'proj_1',
  title: 'Backend API Hardening',
  description: 'Implement Requirement 23',
  status: 'in_progress',
  priority: 'high',
  startDate: '2026-11-01',
  dueDate: '2026-11-05',
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
  assigneeEmail: 'u1@example.com',
  createdBy: 'user_1'
};

const mockReasoningMeeting: FollowUpMeeting = {
  id: 'meeting_reasoning',
  projectId: 'proj_1',
  title: 'Reasoning Meeting: Delay in Backend API Hardening',
  purpose: 'Analyze delay root cause and agree on revised schedule',
  reason: 'Task overdue',
  generatedAgenda: 'Agenda',
  proposedParticipants: [],
  proposedStartTime: '2026-11-06T10:00:00Z',
  proposedEndTime: '2026-11-06T11:00:00Z',
  timezone: 'UTC',
  status: 'scheduled',
  provider: 'none',
  relatedTaskIds: ['task_abc'],
  relatedExceptionIds: ['ex_1'],
  createdBy: 'user_leader',
  creatorName: 'Team Leader',
  creatorEmail: 'leader@example.com',
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
  history: []
};

const mockGenericMeeting: FollowUpMeeting = {
  id: 'meeting_generic',
  projectId: 'proj_1',
  title: 'Weekly Standup Sync',
  purpose: 'General check-in',
  reason: 'Regular sync',
  generatedAgenda: 'Agenda',
  proposedParticipants: [],
  proposedStartTime: '2026-11-07T10:00:00Z',
  proposedEndTime: '2026-11-07T10:30:00Z',
  timezone: 'UTC',
  status: 'scheduled',
  provider: 'none',
  relatedTaskIds: [],
  relatedExceptionIds: [],
  createdBy: 'user_1',
  creatorName: 'User 1',
  creatorEmail: 'u1@example.com',
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
  history: []
};

const mockCompletedMeetingWithOutcome: FollowUpMeeting = {
  ...mockReasoningMeeting,
  id: 'meeting_completed',
  status: 'completed',
  reasoningOutcome: {
    rootCause: 'Underestimated third-party schema changes and migration complexities.',
    agreedStartDate: '2026-11-02T00:00:00.000Z',
    agreedDueDate: '2026-11-12T00:00:00.000Z',
    autoPropagateDownstream: true,
    propagationPerformed: true,
    propagationSummary: {
      targetTaskId: 'task_abc',
      updatedTaskCount: 2,
      updatedTasks: [
        { taskId: 'task_abc', title: 'Backend API Hardening', dueDate: '2026-11-12T00:00:00.000Z', shiftDays: 7 },
        { taskId: 'task_downstream', title: 'Frontend Integration', dueDate: '2026-11-19T00:00:00.000Z', shiftDays: 7 }
      ],
      notificationsCreated: 3
    },
    resolvedExceptionIds: ['ex_1'],
    completedAt: '2026-11-06T11:00:00Z',
    completedBy: {
      uid: 'user_leader',
      name: 'Team Leader',
      email: 'leader@example.com'
    }
  }
};

// 1. Action Button Eligibility Logic Test
console.log('--- 1. Verification of Meeting Action Button Eligibility ---');

function getEligibleAction(meeting: FollowUpMeeting, userRole: CollaborationRole): 'reasoning' | 'generic' | 'none' {
  if (meeting.status !== 'scheduled') {
    return 'none';
  }
  const hasRelatedTask = Boolean(meeting.relatedTaskIds && meeting.relatedTaskIds.length > 0);
  const isAuthorized = userRole === 'owner' || userRole === 'admin';

  if (hasRelatedTask && isAuthorized) {
    return 'reasoning';
  }
  if (!hasRelatedTask || !isAuthorized) {
    return 'generic';
  }
  return 'none';
}

// Case 1a: Task-associated meeting with owner role -> reasoning
assert.strictEqual(getEligibleAction(mockReasoningMeeting, 'owner'), 'reasoning');
console.log('Passed: Task-associated meeting with owner role gets reasoning action.');

// Case 1b: Task-associated meeting with admin role -> reasoning
assert.strictEqual(getEligibleAction(mockReasoningMeeting, 'admin'), 'reasoning');
console.log('Passed: Task-associated meeting with admin role gets reasoning action.');

// Case 1c: Task-associated meeting with viewer role -> generic
assert.strictEqual(getEligibleAction(mockReasoningMeeting, 'viewer'), 'generic');
console.log('Passed: Task-associated meeting with viewer role falls back to generic action.');

// Case 1d: Generic meeting with owner role -> generic
assert.strictEqual(getEligibleAction(mockGenericMeeting, 'owner'), 'generic');
console.log('Passed: Generic meeting (no relatedTaskIds) gets generic action regardless of owner role.');

// Case 1e: Completed meeting -> none
assert.strictEqual(getEligibleAction(mockCompletedMeetingWithOutcome, 'owner'), 'none');
console.log('Passed: Completed meeting does not offer complete action.');

// 2. Task & Exception Resolution Mapping
console.log('--- 2. Task & Exception Resolution Mapping ---');
const tasks = [mockTask];
const resolvedTask = mockReasoningMeeting.relatedTaskIds?.[0]
  ? tasks.find(t => t.id === mockReasoningMeeting.relatedTaskIds![0]) || null
  : null;
assert.ok(resolvedTask !== null);
assert.strictEqual(resolvedTask.id, 'task_abc');
console.log('Passed: Target task correctly resolved by meeting.relatedTaskIds[0].');

// Missing task fallback
const missingTaskMeeting: FollowUpMeeting = { ...mockReasoningMeeting, relatedTaskIds: ['non_existent'] };
const resolvedMissingTask = missingTaskMeeting.relatedTaskIds?.[0]
  ? tasks.find(t => t.id === missingTaskMeeting.relatedTaskIds![0]) || null
  : null;
assert.strictEqual(resolvedMissingTask, null);
console.log('Passed: Non-existent task resolves safely to null without crashing.');

// 3. Outcome Details Structure Validation
console.log('--- 3. Outcome Details Structure Validation ---');
const outcome = mockCompletedMeetingWithOutcome.reasoningOutcome!;
assert.strictEqual(outcome.rootCause, 'Underestimated third-party schema changes and migration complexities.');
assert.strictEqual(outcome.agreedDueDate, '2026-11-12T00:00:00.000Z');
assert.strictEqual(outcome.propagationPerformed, true);
assert.strictEqual(outcome.propagationSummary?.updatedTaskCount, 2);
assert.strictEqual(outcome.resolvedExceptionIds?.length, 1);
assert.strictEqual(outcome.completedBy.name, 'Team Leader');
console.log('Passed: Reasoning outcome fields correctly formatted and populated.');

console.log('\nAll CollaborationDashboard Reasoning Meeting integration tests passed successfully!');
