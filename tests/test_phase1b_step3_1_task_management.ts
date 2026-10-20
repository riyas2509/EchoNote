/**
 * Focused Test Suite for Phase 1B, Step 3.1: Task and Execution Management
 *
 * Verifies:
 * 1. Task creation with source linkages (meeting, decision, action item, transcript mention).
 * 2. Assignee validation against eligible project membership (allowing project members/owners, rejecting external non-members).
 * 3. Status transitions (pending -> in_progress -> completed -> reopened) and inline updates.
 * 4. Deduplication: reusing existing task when converting an action item or decision that already has a task.
 * 5. Distinction between AI-suggested tasks and user-accepted tasks.
 * 6. Overdue detection and real-time execution statistics aggregation.
 * 7. Cross-project isolation and unauthorized access rejection.
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

// In-memory test store simulating Firestore tasks and projects
class TaskExecutionTestService {
  private projects: Map<string, MockProject> = new Map();
  private tasks: Map<string, MockProjectTask> = new Map();
  private idCounter = 1;

  constructor() {
    // Seed initial project
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

  isAssigneeEligible(projectId: string, assignee: string): boolean {
    const proj = this.projects.get(projectId);
    if (!proj) return false;
    const lower = assignee.toLowerCase();
    return (
      proj.ownerId.toLowerCase() === lower ||
      proj.members.some(m => m.userId.toLowerCase() === lower || m.email.toLowerCase() === lower)
    );
  }

  createTask(projectId: string, user: { userId: string; email: string }, data: Partial<MockProjectTask>): { task: MockProjectTask; reused: boolean } {
    const proj = this.projects.get(projectId);
    if (!proj) throw new Error('Project not found');

    const isMember = proj.members.some(m => m.userId === user.userId || m.email === user.email);
    if (!isMember) throw new Error('Unauthorized: User is not a member of this project');

    if (data.assignee && !this.isAssigneeEligible(projectId, data.assignee)) {
      throw new Error(`Invalid assignee "${data.assignee}": Not an eligible project member.`);
    }

    // Deduplication check for source conversions
    if (data.sourceDecisionId || data.sourceActionItem) {
      for (const t of this.tasks.values()) {
        if (t.projectId === projectId) {
          if (data.sourceDecisionId && t.sourceDecisionId === data.sourceDecisionId) {
            return { task: t, reused: true };
          }
          if (data.sourceActionItem && t.sourceActionItem === data.sourceActionItem) {
            return { task: t, reused: true };
          }
        }
      }
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
      dueDate: data.dueDate,
      sourceType: data.sourceType || 'manual',
      sourceDecisionId: data.sourceDecisionId,
      sourceActionItem: data.sourceActionItem,
      sourceMeetingSessionId: data.sourceMeetingSessionId,
      sourceRecordingId: data.sourceRecordingId,
      isAiSuggested: data.isAiSuggested ?? false,
      acceptedBy: data.isAiSuggested ? undefined : user.email,
      acceptedAt: data.isAiSuggested ? undefined : new Date().toISOString(),
      createdBy: user.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.tasks.set(taskId, newTask);
    return { task: newTask, reused: false };
  }

  updateTask(taskId: string, user: { userId: string; email: string }, updates: Partial<MockProjectTask> & { acceptAiSuggested?: boolean }): MockProjectTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('Task not found');

    const proj = this.projects.get(task.projectId);
    if (!proj) throw new Error('Project not found');

    const isMember = proj.members.some(m => m.userId === user.userId || m.email === user.email);
    if (!isMember) throw new Error('Unauthorized: User cannot edit tasks in this project');

    if (updates.assignee && !this.isAssigneeEligible(task.projectId, updates.assignee)) {
      throw new Error(`Invalid assignee "${updates.assignee}": Not an eligible project member.`);
    }

    if (updates.status && !['pending', 'in_progress', 'completed'].includes(updates.status)) {
      throw new Error(`Invalid task status: ${updates.status}`);
    }

    if (updates.priority && !['low', 'medium', 'high', 'urgent'].includes(updates.priority)) {
      throw new Error(`Invalid task priority: ${updates.priority}`);
    }

    const updated = { ...task };
    if (updates.title !== undefined) updated.title = updates.title;
    if (updates.status !== undefined) updated.status = updates.status;
    if (updates.priority !== undefined) updated.priority = updates.priority;
    if (updates.assignee !== undefined) updated.assignee = updates.assignee;
    if (updates.dueDate !== undefined) updated.dueDate = updates.dueDate;

    if (updates.acceptAiSuggested) {
      updated.isAiSuggested = false;
      updated.acceptedBy = user.email;
      updated.acceptedAt = new Date().toISOString();
    }

    updated.updatedAt = new Date().toISOString();
    this.tasks.set(taskId, updated);
    return updated;
  }

  getExecutionStats(projectId: string, user: { userId: string; email: string }) {
    const proj = this.projects.get(projectId);
    if (!proj) throw new Error('Project not found');

    const isMember = proj.members.some(m => m.userId === user.userId || m.email === user.email);
    if (!isMember) throw new Error('Unauthorized');

    const projectTasks = Array.from(this.tasks.values()).filter(t => t.projectId === projectId);
    const now = new Date().toISOString();

    const stats = {
      total: projectTasks.length,
      completed: 0,
      in_progress: 0,
      pending: 0,
      overdue: 0,
      assigned: 0,
      unassigned: 0,
      completionRate: 0
    };

    for (const t of projectTasks) {
      if (t.status === 'completed') stats.completed++;
      else if (t.status === 'in_progress') stats.in_progress++;
      else stats.pending++;

      if (t.assignee) stats.assigned++;
      else stats.unassigned++;

      if (t.dueDate && t.status !== 'completed' && t.dueDate < now) {
        stats.overdue++;
      }
    }

    stats.completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    return stats;
  }
}

async function runTestSuite() {
  console.log('--- Running Phase 1B Step 3.1 Task & Execution Tests ---');
  const service = new TaskExecutionTestService();

  const alice = { userId: 'user_alice', email: 'alice@example.com' };
  const bob = { userId: 'user_bob', email: 'bob@example.com' };
  const eve = { userId: 'user_eve', email: 'eve@external.com' };

  // 1. Task Creation with Valid Assignee & Source Linkage
  console.log('1. Testing Task Creation with Source References...');
  const { task: t1, reused: r1 } = service.createTask('proj_alpha', alice, {
    title: 'Finalize Architecture Spec',
    assignee: 'bob@example.com',
    priority: 'high',
    dueDate: '2026-12-31T23:59:59.000Z',
    sourceType: 'meeting_action_item',
    sourceActionItem: 'ai_0',
    sourceMeetingSessionId: 'meeting_123',
    sourceRecordingId: 'rec_456',
    isAiSuggested: true
  });

  assert.strictEqual(r1, false, 'New task should not be flagged as reused');
  assert.strictEqual(t1.status, 'pending', 'Default status should be pending');
  assert.strictEqual(t1.assignee, 'bob@example.com', 'Assignee should match');
  assert.strictEqual(t1.sourceMeetingSessionId, 'meeting_123', 'Meeting session linkage must be preserved');
  assert.strictEqual(t1.sourceRecordingId, 'rec_456', 'Recording linkage must be preserved');
  assert.strictEqual(t1.isAiSuggested, true, 'AI suggested flag should be preserved');
  assert.strictEqual(t1.acceptedBy, undefined, 'AI suggested task is not yet accepted');
  console.log('  ✓ Task created successfully with meeting & recording provenance');

  // 2. Reject Invalid Assignee
  console.log('2. Testing Invalid Assignee Rejection...');
  assert.throws(
    () => {
      service.createTask('proj_alpha', alice, {
        title: 'Task with outsider',
        assignee: 'eve@external.com'
      });
    },
    /Invalid assignee/,
    'Must reject outsider assignee who is not a member of the project'
  );
  console.log('  ✓ Correctly rejected non-member assignee');

  // 3. Reject Cross-Project Unauthorized Mutation
  console.log('3. Testing Unauthorized Cross-Project Task Creation...');
  assert.throws(
    () => {
      service.createTask('proj_beta', alice, {
        title: 'Alice tampering with Beta project'
      });
    },
    /Unauthorized/,
    'Alice should not be able to create tasks in Beta project'
  );
  console.log('  ✓ Cross-project boundary safely enforced');

  // 4. Deduplication of Converted Action Items
  console.log('4. Testing Deduplication on Repeated Conversion...');
  const { task: t2, reused: r2 } = service.createTask('proj_alpha', alice, {
    title: 'Duplicate Attempt for AI 0',
    sourceType: 'meeting_action_item',
    sourceActionItem: 'ai_0',
    sourceMeetingSessionId: 'meeting_123'
  });

  assert.strictEqual(r2, true, 'Should detect existing task and return reused: true');
  assert.strictEqual(t2.id, t1.id, 'Should return the exact same task ID rather than duplicate');
  console.log('  ✓ Deduplication successfully prevented creating parallel tasks for the same action item');

  // 5. Explicit User Acceptance of AI-Suggested Task
  console.log('5. Testing Explicit User Acceptance of AI-Suggested Task...');
  const acceptedTask = service.updateTask(t1.id, alice, {
    acceptAiSuggested: true
  });
  assert.strictEqual(acceptedTask.isAiSuggested, false, 'isAiSuggested should be cleared upon acceptance');
  assert.strictEqual(acceptedTask.acceptedBy, 'alice@example.com', 'acceptedBy should record the user who accepted');
  assert.ok(acceptedTask.acceptedAt, 'acceptedAt should be recorded');
  console.log('  ✓ AI suggestion accepted with explicit user ownership and timestamp');

  // 6. Status Transitions: Pending -> In Progress -> Completed
  console.log('6. Testing Status Transitions...');
  const inProg = service.updateTask(t1.id, bob, { status: 'in_progress' });
  assert.strictEqual(inProg.status, 'in_progress');

  const completed = service.updateTask(t1.id, bob, { status: 'completed' });
  assert.strictEqual(completed.status, 'completed');

  // Reopening task
  const reopened = service.updateTask(t1.id, bob, { status: 'pending' });
  assert.strictEqual(reopened.status, 'pending');
  console.log('  ✓ Status transitions (pending -> in_progress -> completed -> reopened) succeed');

  // 7. Execution Statistics Aggregation (Overdue, Rates, Counts)
  console.log('7. Testing Execution Dashboard Statistics...');
  // Add an overdue task
  service.createTask('proj_alpha', alice, {
    title: 'Past Due Deliverable',
    status: 'in_progress',
    assignee: 'user_alice',
    dueDate: '2020-01-01T00:00:00.000Z'
  });

  // Add an unassigned completed task
  service.createTask('proj_alpha', alice, {
    title: 'Unassigned done task',
    status: 'completed'
  });

  const stats = service.getExecutionStats('proj_alpha', alice);
  assert.strictEqual(stats.total, 3, 'Total tasks count mismatch');
  assert.strictEqual(stats.completed, 1, 'Completed tasks count mismatch');
  assert.strictEqual(stats.in_progress, 1, 'In-progress tasks count mismatch');
  assert.strictEqual(stats.pending, 1, 'Pending tasks count mismatch');
  assert.strictEqual(stats.assigned, 2, 'Assigned tasks count mismatch');
  assert.strictEqual(stats.unassigned, 1, 'Unassigned tasks count mismatch');
  assert.strictEqual(stats.overdue, 1, 'Overdue tasks count mismatch (1 past due in-progress task)');
  assert.strictEqual(stats.completionRate, 33, 'Completion rate should be 33% (1/3)');
  console.log('  ✓ Execution dashboard counts, groupings, and overdue calculations verified');

  console.log('\n--- All Task & Execution Management Tests Passed Successfully! ---');
}

runTestSuite().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
