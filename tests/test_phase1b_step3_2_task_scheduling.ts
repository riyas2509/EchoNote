/**
 * Focused Test Suite for Phase 1B, Step 3.2: Task Start Dates, Due Dates and Scheduling
 *
 * Verifies:
 * 1. Creating and updating tasks with valid dates (startDate, dueDate).
 * 2. Rejecting invalid dates and start-after-due-date conflicts (startDate > dueDate).
 * 3. Clearing dates and updating single date fields without disturbing the other.
 * 4. Preserving tasks with no dates (unscheduled).
 * 5. Accurate calculation of Overdue (past due active), Due Soon (next 3 days), Starting Soon, and Unscheduled metrics.
 * 6. Completed vs Reopened task scheduling metrics behavior (completed tasks are never counted as active overdue).
 * 7. Date filtering (overdue, due_soon, starting_soon, unscheduled) and date sorting (dueDate asc/desc, startDate asc/desc).
 * 8. Strict authorization, tenant isolation, and consistency across 'tasks' and 'projectTasks'.
 * 9. Meeting-derived tasks scheduling and provenance preservation.
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

interface MockProjectTask {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  assignee?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  startDate?: string;
  dueDate?: string;
  sourceType?: 'manual' | 'meeting_decision' | 'meeting_action_item' | 'transcript_mention';
  sourceDecisionId?: string;
  sourceActionItem?: string;
  sourceMeetingSessionId?: string;
  sourceRecordingId?: string;
  isAiSuggested?: boolean;
  acceptedBy?: string;
  acceptedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// Server date validation helper logic identical to server.ts
function validateTaskDates(startDate?: any, dueDate?: any): { valid: boolean; normalizedStartDate?: string; normalizedDueDate?: string; error?: string } {
  let cleanStart: string | undefined = undefined;
  let cleanDue: string | undefined = undefined;

  if (startDate !== undefined && startDate !== null && startDate !== '') {
    if (typeof startDate !== 'string') {
      return { valid: false, error: 'Start date must be an ISO 8601 string or YYYY-MM-DD date.' };
    }
    const trimmed = startDate.trim();
    const parsed = Date.parse(trimmed);
    if (isNaN(parsed)) {
      return { valid: false, error: `Invalid start date format: "${startDate}". Must be a valid date.` };
    }
    cleanStart = trimmed.length === 10 ? trimmed : new Date(parsed).toISOString();
  }

  if (dueDate !== undefined && dueDate !== null && dueDate !== '') {
    if (typeof dueDate !== 'string') {
      return { valid: false, error: 'Due date must be an ISO 8601 string or YYYY-MM-DD date.' };
    }
    const trimmed = dueDate.trim();
    const parsed = Date.parse(trimmed);
    if (isNaN(parsed)) {
      return { valid: false, error: `Invalid due date format: "${dueDate}". Must be a valid date.` };
    }
    cleanDue = trimmed.length === 10 ? trimmed : new Date(parsed).toISOString();
  }

  if (cleanStart && cleanDue) {
    const startTime = new Date(cleanStart).getTime();
    const dueTime = new Date(cleanDue).getTime();
    if (startTime > dueTime) {
      return {
        valid: false,
        error: `Task scheduling conflict: Start date (${cleanStart.substring(0, 10)}) cannot be after Due date (${cleanDue.substring(0, 10)}).`
      };
    }
  }

  return {
    valid: true,
    normalizedStartDate: cleanStart,
    normalizedDueDate: cleanDue
  };
}

class TaskSchedulingTestService {
  public projects: Map<string, MockProject> = new Map();
  public tasks: Map<string, MockProjectTask> = new Map();
  public projectTasksMirror: Map<string, MockProjectTask> = new Map();
  private idCounter = 1;

  constructor() {
    this.projects.set('proj_alpha', {
      id: 'proj_alpha',
      name: 'Alpha Project',
      ownerId: 'user_alice',
      organizationId: 'org_123',
      members: [
        { userId: 'user_alice', email: 'alice@example.com', role: 'owner' },
        { userId: 'user_bob', email: 'bob@example.com', role: 'member' }
      ]
    });

    this.projects.set('proj_beta', {
      id: 'proj_beta',
      name: 'Beta Project',
      ownerId: 'user_charlie',
      organizationId: 'org_456',
      members: [
        { userId: 'user_charlie', email: 'charlie@example.com', role: 'owner' }
      ]
    });
  }

  createTask(projectId: string, user: { userId: string; email: string }, data: Partial<MockProjectTask>): MockProjectTask {
    const proj = this.projects.get(projectId);
    if (!proj) throw new Error('Project not found');

    const isMember = proj.members.some(m => m.userId === user.userId || m.email === user.email);
    if (!isMember) throw new Error('Unauthorized: User is not a member of this project');

    const dateVal = validateTaskDates(data.startDate, data.dueDate);
    if (!dateVal.valid) {
      throw new Error(`Date validation error: ${dateVal.error}`);
    }

    const taskId = `task_${this.idCounter++}`;
    const newTask: MockProjectTask = {
      id: taskId,
      projectId,
      title: data.title || 'Untitled Task',
      description: data.description,
      assignee: data.assignee,
      status: data.status || 'pending',
      priority: data.priority || 'medium',
      startDate: dateVal.normalizedStartDate,
      dueDate: dateVal.normalizedDueDate,
      sourceType: data.sourceType || 'manual',
      sourceDecisionId: data.sourceDecisionId,
      sourceActionItem: data.sourceActionItem,
      sourceMeetingSessionId: data.sourceMeetingSessionId,
      sourceRecordingId: data.sourceRecordingId,
      isAiSuggested: data.isAiSuggested ?? false,
      createdBy: user.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.tasks.set(taskId, newTask);
    this.projectTasksMirror.set(taskId, { ...newTask });
    return newTask;
  }

  updateTask(taskId: string, user: { userId: string; email: string }, updates: Partial<MockProjectTask>): MockProjectTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found');

    const proj = this.projects.get(task.projectId);
    if (!proj) throw new Error('Project not found');

    const isMember = proj.members.some(m => m.userId === user.userId || m.email === user.email);
    if (!isMember) throw new Error('Unauthorized: Cannot edit task');

    if (updates.startDate !== undefined || updates.dueDate !== undefined) {
      const effStart = updates.startDate !== undefined ? updates.startDate : task.startDate;
      const effDue = updates.dueDate !== undefined ? updates.dueDate : task.dueDate;
      const dateVal = validateTaskDates(effStart, effDue);
      if (!dateVal.valid) {
        throw new Error(`Date validation error: ${dateVal.error}`);
      }
      if (updates.startDate !== undefined) task.startDate = dateVal.normalizedStartDate;
      if (updates.dueDate !== undefined) task.dueDate = dateVal.normalizedDueDate;
    }

    if (updates.status !== undefined) task.status = updates.status;
    if (updates.title !== undefined) task.title = updates.title;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.assignee !== undefined) task.assignee = updates.assignee;

    task.updatedAt = new Date().toISOString();
    this.tasks.set(taskId, task);
    this.projectTasksMirror.set(taskId, { ...task });
    return task;
  }

  queryTasks(projectId: string, user: { userId: string; email: string }, query: { scheduleFilter?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' }) {
    const proj = this.projects.get(projectId);
    if (!proj) throw new Error('Project not found');

    const isMember = proj.members.some(m => m.userId === user.userId || m.email === user.email);
    if (!isMember) throw new Error('Unauthorized');

    let list = Array.from(this.tasks.values()).filter(t => t.projectId === projectId);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const threeDaysAhead = todayStart + (3 * 24 * 60 * 60 * 1000);

    const stats = {
      totalTasks: list.length,
      completedTasks: list.filter(t => t.status === 'completed').length,
      pendingTasks: list.filter(t => t.status === 'pending').length,
      inProgressTasks: list.filter(t => t.status === 'in_progress').length,
      overdueTasks: list.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate).getTime() < todayStart).length,
      dueSoonTasks: list.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate).getTime() >= todayStart && new Date(t.dueDate).getTime() <= threeDaysAhead).length,
      startingSoonTasks: list.filter(t => t.status !== 'completed' && t.startDate && new Date(t.startDate).getTime() >= todayStart && new Date(t.startDate).getTime() <= threeDaysAhead).length,
      unscheduledTasks: list.filter(t => t.status !== 'completed' && !t.startDate && !t.dueDate).length,
      completionRate: 0
    };
    stats.completionRate = stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0;

    // Filter
    if (query.scheduleFilter === 'overdue') {
      list = list.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate).getTime() < todayStart);
    } else if (query.scheduleFilter === 'due_soon') {
      list = list.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate).getTime() >= todayStart && new Date(t.dueDate).getTime() <= threeDaysAhead);
    } else if (query.scheduleFilter === 'starting_soon') {
      list = list.filter(t => t.status !== 'completed' && t.startDate && new Date(t.startDate).getTime() >= todayStart && new Date(t.startDate).getTime() <= threeDaysAhead);
    } else if (query.scheduleFilter === 'unscheduled') {
      list = list.filter(t => t.status !== 'completed' && !t.startDate && !t.dueDate);
    }

    // Sort
    if (query.sortBy === 'dueDate') {
      list.sort((a, b) => {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        const diff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        return query.sortOrder === 'desc' ? -diff : diff;
      });
    } else if (query.sortBy === 'startDate') {
      list.sort((a, b) => {
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        const diff = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
        return query.sortOrder === 'desc' ? -diff : diff;
      });
    }

    return { tasks: list, executionStats: stats };
  }
}

async function runTestSuite() {
  console.log('--- Running Phase 1B Step 3.2 Task Dates & Scheduling Test Suite ---');
  const service = new TaskSchedulingTestService();

  const alice = { userId: 'user_alice', email: 'alice@example.com' };
  const bob = { userId: 'user_bob', email: 'bob@example.com' };
  const eve = { userId: 'user_eve', email: 'eve@external.com' };

  // 1. Create task with valid start and due dates
  console.log('1. Testing Valid Start Date and Due Date Creation...');
  const t1 = service.createTask('proj_alpha', alice, {
    title: 'Sprint Kickoff Prep',
    startDate: '2026-11-01',
    dueDate: '2026-11-15',
    priority: 'high'
  });
  assert.strictEqual(t1.startDate, '2026-11-01');
  assert.strictEqual(t1.dueDate, '2026-11-15');
  console.log('  ✓ Task created with standardized calendar dates');

  // 2. Reject Invalid Date Formats
  console.log('2. Testing Invalid Date Format Rejection...');
  assert.throws(
    () => {
      service.createTask('proj_alpha', alice, {
        title: 'Malformed Date Task',
        startDate: 'not-a-date'
      });
    },
    /Invalid start date format/,
    'Must reject invalid date strings'
  );
  console.log('  ✓ Invalid date strings properly rejected');

  // 3. Reject Start Date after Due Date (Conflict Validation)
  console.log('3. Testing Start-Date-After-Due-Date Conflict Rejection...');
  assert.throws(
    () => {
      service.createTask('proj_alpha', alice, {
        title: 'Conflict Task',
        startDate: '2026-11-20',
        dueDate: '2026-11-10'
      });
    },
    /Task scheduling conflict/,
    'Must reject when startDate is chronologically after dueDate'
  );
  console.log('  ✓ Scheduling conflict (startDate > dueDate) strictly rejected');

  // 4. Update single date field with conflict check against existing date
  console.log('4. Testing Partial Date Updates and Conflict Against Existing Task State...');
  // t1 has startDate: '2026-11-01' and dueDate: '2026-11-15'
  // Trying to set dueDate to 2026-10-31 (before existing start date) should fail
  assert.throws(
    () => {
      service.updateTask(t1.id, alice, {
        dueDate: '2026-10-31'
      });
    },
    /Task scheduling conflict/,
    'Must validate partial dueDate update against existing startDate'
  );

  // Updating to valid extended dueDate should succeed
  const updatedT1 = service.updateTask(t1.id, alice, { dueDate: '2026-11-25' });
  assert.strictEqual(updatedT1.dueDate, '2026-11-25');
  assert.strictEqual(updatedT1.startDate, '2026-11-01', 'Existing start date must remain intact');
  console.log('  ✓ Partial date update validated against existing task state and preserved existing date');

  // 5. Date Clearing
  console.log('5. Testing Date Clearing...');
  const clearedT1 = service.updateTask(t1.id, alice, { dueDate: '' });
  assert.strictEqual(clearedT1.dueDate, undefined, 'dueDate should be cleared');
  assert.strictEqual(clearedT1.startDate, '2026-11-01', 'startDate should be unaffected');
  console.log('  ✓ Date clearing successfully removes field without corrupting partner date');

  // 6. Dual-write Mirroring Verification between tasks and projectTasks
  console.log('6. Testing Dual-write Mirroring between tasks and projectTasks...');
  const mirrorTask = service.projectTasksMirror.get(t1.id);
  assert.ok(mirrorTask, 'Task must exist in mirror collection');
  assert.strictEqual(mirrorTask.dueDate, clearedT1.dueDate);
  assert.strictEqual(mirrorTask.startDate, clearedT1.startDate);
  console.log('  ✓ tasks and projectTasks collections remain identical across mutations');

  // 7. Scheduling Metrics (Overdue, Due Soon, Starting Soon, Unscheduled)
  console.log('7. Testing Scheduling Metrics Aggregation...');
  // Setup varied tasks:
  // t_past: overdue active task
  service.createTask('proj_alpha', alice, {
    title: 'Past Due Active Task',
    status: 'in_progress',
    dueDate: '2020-01-01'
  });

  // t_completed_past: overdue historically, but completed -> MUST NOT count as active overdue
  service.createTask('proj_alpha', alice, {
    title: 'Past Due Completed Task',
    status: 'completed',
    dueDate: '2020-01-01'
  });

  // t_due_tomorrow: due within next 3 days
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  service.createTask('proj_alpha', alice, {
    title: 'Due Tomorrow Task',
    status: 'pending',
    dueDate: tomorrowStr
  });

  // t_starting_tomorrow: starting within next 3 days
  service.createTask('proj_alpha', alice, {
    title: 'Starting Soon Task',
    status: 'pending',
    startDate: tomorrowStr,
    dueDate: '2026-12-31'
  });

  // t_unscheduled: no start date and no due date
  service.createTask('proj_alpha', alice, {
    title: 'Unscheduled Task',
    status: 'pending'
  });

  const res = service.queryTasks('proj_alpha', alice, {});
  const stats = res.executionStats;

  assert.strictEqual(stats.overdueTasks, 1, 'Only active past-due task should be counted as overdue (completed task excluded)');
  assert.strictEqual(stats.dueSoonTasks, 1, 'Due soon task count mismatch');
  assert.strictEqual(stats.startingSoonTasks, 1, 'Starting soon task count mismatch');
  assert.strictEqual(stats.unscheduledTasks, 1, 'Unscheduled task count mismatch (only t_unscheduled has neither start nor due date)');
  console.log('  ✓ Execution metrics accurately distinguish active overdue, due soon, starting soon, and completed tasks');

  // 8. Schedule Filtering & Sorting
  console.log('8. Testing Schedule Filtering and Date Sorting...');
  const overdueOnly = service.queryTasks('proj_alpha', alice, { scheduleFilter: 'overdue' });
  assert.strictEqual(overdueOnly.tasks.length, 1);
  assert.strictEqual(overdueOnly.tasks[0].title, 'Past Due Active Task');

  const dueSoonOnly = service.queryTasks('proj_alpha', alice, { scheduleFilter: 'due_soon' });
  assert.strictEqual(dueSoonOnly.tasks.length, 1);
  assert.strictEqual(dueSoonOnly.tasks[0].title, 'Due Tomorrow Task');

  const unscheduledOnly = service.queryTasks('proj_alpha', alice, { scheduleFilter: 'unscheduled' });
  assert.strictEqual(unscheduledOnly.tasks.length, 1);

  // Date sorting (dueDate asc)
  const sortedByDueAsc = service.queryTasks('proj_alpha', alice, { sortBy: 'dueDate', sortOrder: 'asc' });
  // Earliest date first
  const validDueTasks = sortedByDueAsc.tasks.filter(t => !!t.dueDate);
  assert.strictEqual(validDueTasks[0].dueDate, '2020-01-01');
  console.log('  ✓ Schedule filters and date sorting return expected partitions and order');

  // 9. Meeting Provenance Linkage Preservation with Scheduling
  console.log('9. Testing Meeting-Derived Task Scheduling & Provenance Preservation...');
  const meetingTask = service.createTask('proj_alpha', alice, {
    title: 'Follow up on architecture meeting decision',
    startDate: '2026-11-05',
    dueDate: '2026-11-12',
    sourceType: 'meeting_decision',
    sourceDecisionId: 'dec_arch_99',
    sourceMeetingSessionId: 'sess_123',
    sourceRecordingId: 'rec_456'
  });

  assert.strictEqual(meetingTask.sourceType, 'meeting_decision');
  assert.strictEqual(meetingTask.sourceDecisionId, 'dec_arch_99');
  assert.strictEqual(meetingTask.sourceMeetingSessionId, 'sess_123');
  assert.strictEqual(meetingTask.startDate, '2026-11-05');
  assert.strictEqual(meetingTask.dueDate, '2026-11-12');
  console.log('  ✓ Meeting decision provenance preserved alongside task scheduling dates');

  // 10. Cross-Project Authorization Enforcement
  console.log('10. Testing Cross-Project Authorization & Boundary Enforcement...');
  assert.throws(
    () => {
      service.createTask('proj_beta', alice, {
        title: 'Unauthorized Task in Beta'
      });
    },
    /Unauthorized/,
    'Alice cannot create tasks in Beta project'
  );
  assert.throws(
    () => {
      service.queryTasks('proj_alpha', eve, {});
    },
    /Unauthorized/,
    'External user cannot view project tasks'
  );
  console.log('  ✓ Project boundaries and permissions strictly enforced');

  console.log('\n--- All Phase 1B Step 3.2 Tests Passed Successfully! ---');
}

runTestSuite().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
