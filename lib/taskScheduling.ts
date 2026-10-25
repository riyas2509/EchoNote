/**
 * Task Scheduling and Dependency Propagation Engine
 *
 * Core capabilities:
 * 1. Deterministic transitive dependency-cycle detection with readable cycle path reporting.
 * 2. Deterministic downstream deadline propagation calculation using calendar-day arithmetic.
 * 3. Topological sorting of affected tasks respecting prerequisite completion order.
 * 4. Task duration preservation for validly scheduled tasks.
 * 5. Completed task protection: never automatically shifted, reported as warnings/conflicts.
 * 6. Timezone-safe calendar-day arithmetic (pure date strings YYYY-MM-DD or ISO dates parsed in UTC).
 */

export interface SchedulableTask {
  id: string;
  projectId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | string;
  startDate?: string | null;
  dueDate?: string | null;
  prerequisiteTaskIds?: string[];
  [key: string]: any;
}

export interface CycleDetectionResult {
  hasCycle: boolean;
  cyclePath?: string;
  cycleNodeIds?: string[];
}

export interface ProposedDateChange {
  newStartDate?: string | null;
  newDueDate?: string | null;
}

export interface AffectedTaskPreview {
  taskId: string;
  title: string;
  status: string;
  currentStartDate: string | null;
  currentDueDate: string | null;
  proposedStartDate: string | null;
  proposedDueDate: string | null;
  shiftDays: number | null;
  durationDays: number | null;
  isDirectTarget: boolean;
  isCompleted: boolean;
  warnings?: string[];
}

export interface PropagationPreviewResult {
  targetTaskId: string;
  hasConflicts: boolean;
  hasWarnings: boolean;
  conflicts: string[];
  warnings: string[];
  affectedTasks: AffectedTaskPreview[];
  unaffectedCount: number;
  totalProjectTasks: number;
  affectedCompletedTasks: Array<{ taskId: string; title: string }>;
  unresolvedTasks: Array<{ taskId: string; title: string; reason: string }>;
  scheduleVersionToken?: string;
}

/**
 * Calendar Date Utilities (Timezone-safe YYYY-MM-DD arithmetic)
 */
export function parseCalendarDate(dateStr: string | null | undefined): { year: number; month: number; day: number } | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Validate real calendar date (leap years, 30-day months)
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function formatCalendarDate(parts: { year: number; month: number; day: number }): string {
  const y = parts.year.toString().padStart(4, '0');
  const m = parts.month.toString().padStart(2, '0');
  const d = parts.day.toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateToUtcDays(parts: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / (24 * 60 * 60 * 1000));
}

export function utcDaysToDate(days: number): { year: number; month: number; day: number } {
  const d = new Date(days * 24 * 60 * 60 * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate()
  };
}

export function diffCalendarDays(dateA: string, dateB: string): number | null {
  const pA = parseCalendarDate(dateA);
  const pB = parseCalendarDate(dateB);
  if (!pA || !pB) return null;
  return dateToUtcDays(pA) - dateToUtcDays(pB);
}

export function addCalendarDays(dateStr: string, days: number): string | null {
  const p = parseCalendarDate(dateStr);
  if (!p) return null;
  const currentDays = dateToUtcDays(p);
  const newDays = currentDays + days;
  return formatCalendarDate(utcDaysToDate(newDays));
}

export function maxCalendarDate(dateA: string, dateB: string): string {
  const pA = parseCalendarDate(dateA);
  const pB = parseCalendarDate(dateB);
  if (!pA) return dateB;
  if (!pB) return dateA;
  return dateToUtcDays(pA) >= dateToUtcDays(pB) ? dateA : dateB;
}

/**
 * Deterministic Dependency Cycle Detection
 *
 * Validates that adding/updating candidatePrereqIds to targetTaskId does not introduce a cycle.
 * Graph edges represent prerequisite relationships: if B has prerequisite A (A -> B), A must finish before B.
 * A cycle exists if targetTaskId can reach targetTaskId through candidatePrereqIds and upstream tasks.
 */
export function detectDependencyCycle(
  targetTaskId: string,
  candidatePrereqIds: string[],
  allProjectTasks: Array<{ id: string; prerequisiteTaskIds?: string[]; title?: string }>
): CycleDetectionResult {
  const taskMap = new Map<string, { id: string; prerequisiteTaskIds?: string[]; title?: string }>();
  allProjectTasks.forEach(t => taskMap.set(t.id, t));

  for (const prereqId of candidatePrereqIds) {
    if (prereqId === targetTaskId) {
      const title = taskMap.get(targetTaskId)?.title || targetTaskId;
      return {
        hasCycle: true,
        cyclePath: `${title} (${targetTaskId}) -> ${title} (${targetTaskId})`,
        cycleNodeIds: [targetTaskId, targetTaskId]
      };
    }

    const visited = new Set<string>();
    const path: string[] = [targetTaskId, prereqId];

    function dfs(currentId: string): boolean {
      if (currentId === targetTaskId) return true;
      if (visited.has(currentId)) return false;
      visited.add(currentId);

      const currentTask = taskMap.get(currentId);
      if (!currentTask || !Array.isArray(currentTask.prerequisiteTaskIds)) return false;

      for (const nextPrereqId of currentTask.prerequisiteTaskIds) {
        path.push(nextPrereqId);
        if (dfs(nextPrereqId)) return true;
        path.pop();
      }
      return false;
    }

    if (dfs(prereqId)) {
      const cyclePath = path
        .map(id => {
          const t = taskMap.get(id);
          return t ? `${t.title || id} (${id})` : id;
        })
        .join(' -> ');
      return {
        hasCycle: true,
        cyclePath,
        cycleNodeIds: [...path]
      };
    }
  }

  return { hasCycle: false };
}

/**
 * Deterministic Deadline Propagation Calculator
 *
 * Given a project task snapshot and a proposed date change for a target task:
 * 1. Checks for cycles in the active graph to prevent infinite loops.
 * 2. Finds all downstream tasks transitively (tasks that depend on target directly or indirectly).
 * 3. Processes tasks in topological order (prerequisites before dependents).
 * 4. Preserves task duration (dueDate - startDate) for scheduled tasks.
 * 5. Completed tasks are NEVER automatically shifted; instead, reported as conflict/warning.
 * 6. Pure function: performs 0 database writes and returns full preview details.
 */

/**
 * Computes a deterministic version token for a project's tasks snapshot.
 * Used for optimistic concurrency control and detecting stale previews before execution.
 */
export function computeScheduleVersionToken(tasks: Array<{
  id: string;
  updatedAt?: string;
  startDate?: string | null;
  dueDate?: string | null;
  status?: string;
  prerequisiteTaskIds?: string[];
}>): string {
  const parts = tasks.map(t => {
    const prereqs = Array.isArray(t.prerequisiteTaskIds) ? [...t.prerequisiteTaskIds].sort().join(',') : '';
    return `${t.id}:${t.updatedAt || ''}:${t.startDate || ''}:${t.dueDate || ''}:${t.status || ''}:${prereqs}`;
  }).sort();
  let hash = 5381;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return 'v1_' + Math.abs(hash).toString(16);
}

export function calculateDeadlinePropagation(
  tasks: SchedulableTask[],
  targetTaskId: string,
  proposed: ProposedDateChange
): PropagationPreviewResult {
  const taskMap = new Map<string, SchedulableTask>();
  tasks.forEach(t => taskMap.set(t.id, t));

  const targetTask = taskMap.get(targetTaskId);
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const affectedCompletedTasks: Array<{ taskId: string; title: string }> = [];
  const unresolvedTasks: Array<{ taskId: string; title: string; reason: string }> = [];

  if (!targetTask) {
    return {
      targetTaskId,
      hasConflicts: true,
      hasWarnings: false,
      conflicts: [`Target task ${targetTaskId} not found in project snapshot.`],
      warnings: [],
      affectedTasks: [],
      unaffectedCount: tasks.length,
      totalProjectTasks: tasks.length,
      affectedCompletedTasks: [],
      unresolvedTasks: []
    };
  }

  // Build adjacency list: prerequisiteId -> dependentTaskIds (downstream)
  const downstreamMap = new Map<string, string[]>();
  tasks.forEach(t => {
    if (Array.isArray(t.prerequisiteTaskIds)) {
      t.prerequisiteTaskIds.forEach(pId => {
        if (!downstreamMap.has(pId)) {
          downstreamMap.set(pId, []);
        }
        downstreamMap.get(pId)!.push(t.id);
      });
    }
  });

  // Cycle guard on project graph
  const visitedCycle = new Set<string>();
  const recStack = new Set<string>();
  let hasCycle = false;

  function checkGraphCycle(id: string): boolean {
    visitedCycle.add(id);
    recStack.add(id);
    const downstream = downstreamMap.get(id) || [];
    for (const dId of downstream) {
      if (!visitedCycle.has(dId)) {
        if (checkGraphCycle(dId)) return true;
      } else if (recStack.has(dId)) {
        return true;
      }
    }
    recStack.delete(id);
    return false;
  }

  for (const t of tasks) {
    if (!visitedCycle.has(t.id)) {
      if (checkGraphCycle(t.id)) {
        hasCycle = true;
        break;
      }
    }
  }

  if (hasCycle) {
    return {
      targetTaskId,
      hasConflicts: true,
      hasWarnings: false,
      conflicts: ['Project contains a dependency cycle; deadline propagation cannot be computed safely.'],
      warnings: [],
      affectedTasks: [],
      unaffectedCount: tasks.length,
      totalProjectTasks: tasks.length,
      affectedCompletedTasks: [],
      unresolvedTasks: []
    };
  }

  // Transitive downstream collection
  const downstreamTaskIds = new Set<string>();
  function collectDownstream(currId: string) {
    const list = downstreamMap.get(currId) || [];
    for (const nextId of list) {
      if (!downstreamTaskIds.has(nextId)) {
        downstreamTaskIds.add(nextId);
        collectDownstream(nextId);
      }
    }
  }
  collectDownstream(targetTaskId);

  // Compute proposed dates for target task
  let targetProposedStart: string | null = null;
  let targetProposedDue: string | null = null;
  let targetShiftDays: number | null = null;
  let targetDuration: number | null = null;

  const targetCurrentStart = targetTask.startDate ? targetTask.startDate.split('T')[0] : null;
  const targetCurrentDue = targetTask.dueDate ? targetTask.dueDate.split('T')[0] : null;

  if (targetCurrentStart && targetCurrentDue) {
    targetDuration = diffCalendarDays(targetCurrentDue, targetCurrentStart);
  }

  // Validate proposed inputs
  if (proposed.newStartDate !== undefined) {
    const parsed = parseCalendarDate(proposed.newStartDate);
    if (proposed.newStartDate !== null && !parsed) {
      unresolvedTasks.push({
        taskId: targetTaskId,
        title: targetTask.title,
        reason: `Invalid proposed startDate: ${proposed.newStartDate}`
      });
      conflicts.push(`Target task ${targetTask.title} has invalid proposed startDate.`);
    } else {
      targetProposedStart = parsed ? formatCalendarDate(parsed) : null;
    }
  } else {
    targetProposedStart = targetCurrentStart;
  }

  if (proposed.newDueDate !== undefined) {
    const parsed = parseCalendarDate(proposed.newDueDate);
    if (proposed.newDueDate !== null && !parsed) {
      unresolvedTasks.push({
        taskId: targetTaskId,
        title: targetTask.title,
        reason: `Invalid proposed dueDate: ${proposed.newDueDate}`
      });
      conflicts.push(`Target task ${targetTask.title} has invalid proposed dueDate.`);
    } else {
      targetProposedDue = parsed ? formatCalendarDate(parsed) : null;
    }
  } else {
    targetProposedDue = targetCurrentDue;
  }

  // Target task schedule update conventions:
  // If proposed newStartDate was provided without newDueDate and task had duration, shift due date to preserve duration.
  // If proposed newDueDate was provided without newStartDate, target startDate is preserved (modifying duration).
  if (proposed.newStartDate && !proposed.newDueDate && targetDuration !== null && targetDuration >= 0 && targetProposedStart) {
    targetProposedDue = addCalendarDays(targetProposedStart, targetDuration);
  }

  if (targetCurrentDue && targetProposedDue) {
    targetShiftDays = diffCalendarDays(targetProposedDue, targetCurrentDue);
  } else if (targetCurrentStart && targetProposedStart) {
    targetShiftDays = diffCalendarDays(targetProposedStart, targetCurrentStart);
  }

  // In-memory effective schedule map: taskId -> { startDate, dueDate }
  const effectiveSchedule = new Map<string, { startDate: string | null; dueDate: string | null }>();
  effectiveSchedule.set(targetTaskId, {
    startDate: targetProposedStart,
    dueDate: targetProposedDue
  });

  // Topological sorting of downstream tasks
  // In-degree considering only edges from target or other downstream tasks
  const inDegree = new Map<string, number>();
  for (const id of downstreamTaskIds) {
    const task = taskMap.get(id);
    let count = 0;
    if (task && Array.isArray(task.prerequisiteTaskIds)) {
      for (const pId of task.prerequisiteTaskIds) {
        if (downstreamTaskIds.has(pId)) {
          count++;
        }
      }
    }
    inDegree.set(id, count);
  }

  const queue: string[] = [];
  for (const [id, count] of inDegree.entries()) {
    if (count === 0) queue.push(id);
  }

  const sortedDownstream: string[] = [];
  while (queue.length > 0) {
    // Deterministic ordering: sort queue alphabetically by title/id for stability
    queue.sort((a, b) => {
      const tA = taskMap.get(a)?.title || a;
      const tB = taskMap.get(b)?.title || b;
      return tA.localeCompare(tB);
    });
    const curr = queue.shift()!;
    sortedDownstream.push(curr);

    const dependents = downstreamMap.get(curr) || [];
    for (const dId of dependents) {
      if (downstreamTaskIds.has(dId)) {
        const currentCount = inDegree.get(dId)!;
        inDegree.set(dId, currentCount - 1);
        if (currentCount - 1 === 0) {
          queue.push(dId);
        }
      }
    }
  }

  // Handle downstream tasks
  const affectedList: AffectedTaskPreview[] = [];

  // Add target task to affectedList
  affectedList.push({
    taskId: targetTaskId,
    title: targetTask.title,
    status: targetTask.status,
    currentStartDate: targetCurrentStart,
    currentDueDate: targetCurrentDue,
    proposedStartDate: targetProposedStart,
    proposedDueDate: targetProposedDue,
    shiftDays: targetShiftDays,
    durationDays: targetDuration,
    isDirectTarget: true,
    isCompleted: targetTask.status === 'completed',
    warnings: targetTask.status === 'completed' ? ['Target task is already completed.'] : []
  });

  if (targetTask.status === 'completed') {
    affectedCompletedTasks.push({ taskId: targetTaskId, title: targetTask.title });
    warnings.push(`Target task ${targetTask.title} is completed. Date changes for completed tasks should be reviewed carefully.`);
  }

  for (const dId of sortedDownstream) {
    const dTask = taskMap.get(dId)!;
    const isCompleted = dTask.status === 'completed';
    const dCurrentStart = dTask.startDate ? dTask.startDate.split('T')[0] : null;
    const dCurrentDue = dTask.dueDate ? dTask.dueDate.split('T')[0] : null;

    let dDuration: number | null = null;
    if (dCurrentStart && dCurrentDue) {
      dDuration = diffCalendarDays(dCurrentDue, dCurrentStart);
    }

    // Determine the latest due date among all prerequisites (using effective schedules where updated)
    let maxPrereqDueDate: string | null = null;
    let hasUnresolvedPrereq = false;

    if (Array.isArray(dTask.prerequisiteTaskIds)) {
      for (const pId of dTask.prerequisiteTaskIds) {
        const updated = effectiveSchedule.get(pId);
        const prereqDue = updated ? updated.dueDate : (taskMap.get(pId)?.dueDate ? taskMap.get(pId)!.dueDate!.split('T')[0] : null);
        if (prereqDue) {
          maxPrereqDueDate = maxPrereqDueDate ? maxCalendarDate(maxPrereqDueDate, prereqDue) : prereqDue;
        } else {
          hasUnresolvedPrereq = true;
        }
      }
    }

    if (isCompleted) {
      // Completed task protection: do not shift dates!
      affectedCompletedTasks.push({ taskId: dTask.id, title: dTask.title });
      warnings.push(`Completed downstream task ${dTask.title} would be affected by prerequisite deadline, but completed tasks are not shifted automatically.`);
      effectiveSchedule.set(dTask.id, {
        startDate: dCurrentStart,
        dueDate: dCurrentDue
      });
      affectedList.push({
        taskId: dTask.id,
        title: dTask.title,
        status: dTask.status,
        currentStartDate: dCurrentStart,
        currentDueDate: dCurrentDue,
        proposedStartDate: dCurrentStart,
        proposedDueDate: dCurrentDue,
        shiftDays: 0,
        durationDays: dDuration,
        isDirectTarget: false,
        isCompleted: true,
        warnings: ['Task is completed and was not shifted.']
      });
      continue;
    }

    if (!maxPrereqDueDate) {
      // No prerequisite has a valid due date; cannot determine schedule shift
      unresolvedTasks.push({
        taskId: dTask.id,
        title: dTask.title,
        reason: 'Prerequisites lack defined due dates; unable to calculate dependent start date.'
      });
      effectiveSchedule.set(dTask.id, {
        startDate: dCurrentStart,
        dueDate: dCurrentDue
      });
      continue;
    }

    // Dependent task must start no earlier than the latest prerequisite completion date (maxPrereqDueDate)
    // Convention: dependent task starts on the day prerequisite finishes (or maxPrereqDueDate)
    let proposedStart: string | null = dCurrentStart;
    let proposedDue: string | null = dCurrentDue;
    let taskWarnings: string[] = [];

    if (hasUnresolvedPrereq) {
      taskWarnings.push('Some prerequisites do not have scheduled due dates.');
    }

    // Check if prerequisite completion pushes the start date
    const mustShift = !dCurrentStart || (diffCalendarDays(maxPrereqDueDate, dCurrentStart) ?? 0) > 0;

    if (mustShift) {
      proposedStart = maxPrereqDueDate;
      if (dDuration !== null && dDuration >= 0) {
        proposedDue = addCalendarDays(proposedStart, dDuration);
      } else if (dCurrentDue && (diffCalendarDays(proposedStart, dCurrentDue) ?? 0) > 0) {
        // No start date originally, but current due date is before prerequisite completion
        proposedDue = proposedStart;
        taskWarnings.push('Task lacked startDate; proposed dueDate aligned with prerequisite completion date.');
      } else if (!dCurrentDue) {
        // Unscheduled task
        unresolvedTasks.push({
          taskId: dTask.id,
          title: dTask.title,
          reason: 'Task lacks dueDate; cannot preserve duration.'
        });
      }
    }

    let shiftDays: number | null = null;
    if (dCurrentDue && proposedDue) {
      shiftDays = diffCalendarDays(proposedDue, dCurrentDue);
    } else if (dCurrentStart && proposedStart) {
      shiftDays = diffCalendarDays(proposedStart, dCurrentStart);
    }

    effectiveSchedule.set(dTask.id, {
      startDate: proposedStart,
      dueDate: proposedDue
    });

    const datesChanged = proposedStart !== dCurrentStart || proposedDue !== dCurrentDue;

    if (datesChanged || taskWarnings.length > 0) {
      affectedList.push({
        taskId: dTask.id,
        title: dTask.title,
        status: dTask.status,
        currentStartDate: dCurrentStart,
        currentDueDate: dCurrentDue,
        proposedStartDate: proposedStart,
        proposedDueDate: proposedDue,
        shiftDays: shiftDays ?? 0,
        durationDays: dDuration,
        isDirectTarget: false,
        isCompleted: false,
        warnings: taskWarnings
      });
    }
  }

  const affectedIds = new Set(affectedList.map(a => a.taskId));
  const unaffectedCount = tasks.filter(t => !affectedIds.has(t.id)).length;

  return {
    targetTaskId,
    scheduleVersionToken: computeScheduleVersionToken(tasks),
    hasConflicts: conflicts.length > 0,
    hasWarnings: warnings.length > 0,
    conflicts,
    warnings,
    affectedTasks: affectedList,
    unaffectedCount,
    totalProjectTasks: tasks.length,
    affectedCompletedTasks,
    unresolvedTasks
  };
}
