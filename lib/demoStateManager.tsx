/**
 * EchoNote — Interactive Product Demo State Manager & Provider Boundary
 * 
 * Strict Isolation Guarantees:
 * 1. ZERO network requests or Firestore operations are ever executed in demo mode.
 * 2. All demo operations mutate strictly in-memory state.
 * 3. Reset and exit revert the demo state deterministically to clean fixtures.
 * 4. Write guard explicitly asserts and blocks if any external caller attempts
 *    to send demo IDs or demo payload to production persistence.
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import {
  Project,
  ProjectMember,
  ProjectTask,
  TaskException,
  FollowUpMeeting,
  AudioToTextRecord,
  UnassociatedMeetingItem,
  ProjectTrackingMetrics,
  TaskRiskIndicator,
  DecisionHistoryItem
} from '../types';
import {
  DEMO_PROJECT_ID,
  DEMO_PROJECT_NAME,
  DEMO_MEETING_ID,
  DEMO_DECISION_ID,
  DEMO_TASK_SIGNING_KEYS_ID,
  DEMO_TASK_CLIENT_SDK_ID,
  DEMO_TRACKING_METRICS_HEALTHY,
  DEMO_TRACKING_METRICS_DEGRADED,
  createInitialDemoState,
  DemoStatePayload
} from './demoData';

export { DEMO_PROJECT_ID, DEMO_PROJECT_NAME };

export interface DemoWorkspaceContextValue {
  isDemoMode: boolean;
  enterDemo: () => void;
  exitDemo: () => void;
  resetDemoState: () => void;

  // Demo Entities
  demoProject: Project;
  demoMembers: ProjectMember[];
  demoAudioRecords: AudioToTextRecord[];
  demoMeetings: UnassociatedMeetingItem[];
  demoDecisions: DecisionHistoryItem[];
  demoTasks: ProjectTask[];
  demoExceptions: TaskException[];
  demoFollowUps: FollowUpMeeting[];
  demoTrackingMetrics: ProjectTrackingMetrics;
  demoTrackingRisks: TaskRiskIndicator[];

  // In-Memory Mutation Handlers
  updateTaskStatus: (taskId: string, newStatus: 'pending' | 'in_progress' | 'completed') => void;
  createTask: (task: Partial<ProjectTask>) => ProjectTask;
  resolveException: (exceptionId: string, resolutionSummary: string) => void;
  confirmFollowUp: (meetingId: string) => void;

  // Active Tab within Demo
  activeDemoTab: 'workspace' | 'meetings' | 'search' | 'analytics' | 'timelines' | 'exceptions' | 'followups' | 'tracking';
  setActiveDemoTab: (tab: 'workspace' | 'meetings' | 'search' | 'analytics' | 'timelines' | 'exceptions' | 'followups' | 'tracking') => void;

  // Interactive Guided Tour State (Step 6)
  tourActive: boolean;
  tourStepIndex: number;
  startTour: () => void;
  setTourStepIndex: (stepIndex: number) => void;
  endTour: () => void;
}

const DemoWorkspaceContext = createContext<DemoWorkspaceContextValue | null>(null);

/**
 * Custom hook to consume the isolated demo state.
 */
export function useDemoWorkspace(): DemoWorkspaceContextValue | null {
  return useContext(DemoWorkspaceContext);
}

/**
 * Strict write guard helper: asserts that an ID is not a demo ID.
 * Throws an error or returns false to protect Firestore write paths.
 */
export function isDemoIdentifier(id?: string | null): boolean {
  if (!id) return false;
  return id.startsWith('demo-') || id === DEMO_PROJECT_ID || id === DEMO_MEETING_ID || id === DEMO_DECISION_ID;
}

/**
 * Guard function that prevents persistence if demo mode is active or record is a demo entity.
 */
export function assertNotDemoWrite(context: { isDemoMode?: boolean; entityId?: string; collectionName?: string }): void {
  if (context.isDemoMode || isDemoIdentifier(context.entityId)) {
    const errorMsg = `[DEMO ISOLATION GUARD] Blocked attempt to persist demo entity "${context.entityId || 'unknown'}" to collection "${context.collectionName || 'unknown'}". Demo records must remain in-memory only.`;
    console.warn(errorMsg);
    throw new Error(errorMsg);
  }
}

export interface DemoWorkspaceProviderProps {
  children: React.ReactNode;
  initialActive?: boolean;
}

export const DemoWorkspaceProvider: React.FC<DemoWorkspaceProviderProps> = ({
  children,
  initialActive = false
}) => {
  const [isDemoMode, setIsDemoMode] = useState<boolean>(initialActive);
  const [demoState, setDemoState] = useState<DemoStatePayload>(() => createInitialDemoState());
  const [activeDemoTab, setActiveDemoTab] = useState<'workspace' | 'meetings' | 'search' | 'analytics' | 'timelines' | 'exceptions' | 'followups' | 'tracking'>('workspace');
  const [tourActive, setTourActive] = useState<boolean>(false);
  const [tourStepIndex, setTourStepIndex] = useState<number>(0);

  const startTour = useCallback(() => {
    setTourStepIndex(0);
    setTourActive(true);
  }, []);

  const endTour = useCallback(() => {
    setTourActive(false);
  }, []);

  const enterDemo = useCallback(() => {
    setDemoState(createInitialDemoState());
    setActiveDemoTab('workspace');
    setIsDemoMode(true);
    setTourStepIndex(0);
    setTourActive(true);
  }, []);

  const exitDemo = useCallback(() => {
    setTourActive(false);
    setIsDemoMode(false);
    setDemoState(createInitialDemoState());
    setActiveDemoTab('workspace');
    setTourStepIndex(0);
  }, []);

  const resetDemoState = useCallback(() => {
    setDemoState(createInitialDemoState());
    setActiveDemoTab('workspace');
    setTourStepIndex(0);
    setTourActive(true);
  }, []);

  // Update a task in-memory and dynamically update downstream dependency states
  const updateTaskStatus = useCallback((taskId: string, newStatus: 'pending' | 'in_progress' | 'completed') => {
    setDemoState(prev => {
      const updatedTasks = prev.tasks.map(t => {
        if (t.id === taskId) {
          const newActivity = {
            id: `demo-act-${Date.now()}`,
            action: `status_${newStatus}`,
            performedBy: 'Sarah Connor',
            timestamp: new Date().toISOString(),
            details: `Updated status to ${newStatus.replace('_', ' ')}`
          };
          return {
            ...t,
            status: newStatus,
            activityHistory: [...(t.activityHistory || []), newActivity],
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      // Check if updating the prerequisite unblocks dependent tasks
      const signingKeysTask = updatedTasks.find(t => t.id === DEMO_TASK_SIGNING_KEYS_ID);
      const isSigningKeysCompleted = signingKeysTask?.status === 'completed';

      // Re-evaluate client SDK dependency
      const recalculatedTasks = updatedTasks.map(t => {
        if (t.id === DEMO_TASK_CLIENT_SDK_ID) {
          if (isSigningKeysCompleted) {
            return {
              ...t,
              dependencyStatus: 'ready' as const,
              blockingPrerequisites: [],
              activeExceptions: []
            };
          } else {
            return {
              ...t,
              dependencyStatus: 'blocked' as const,
              blockingPrerequisites: [
                {
                  id: DEMO_TASK_SIGNING_KEYS_ID,
                  title: 'Generate SHA256 Signing Keys',
                  status: signingKeysTask?.status === 'in_progress' ? 'overdue' : (signingKeysTask?.status || 'pending')
                }
              ]
            };
          }
        }
        return t;
      });

      // Re-evaluate exceptions
      const updatedExceptions = prev.exceptions.map(exc => {
        if (exc.taskId === DEMO_TASK_CLIENT_SDK_ID && isSigningKeysCompleted) {
          return {
            ...exc,
            status: 'resolved' as const,
            resolutionSummary: 'Prerequisite task "Generate SHA256 Signing Keys" completed.',
            resolvedAt: new Date().toISOString()
          };
        }
        return exc;
      });

      // Re-evaluate health score
      const newTrackingMetrics: ProjectTrackingMetrics = isSigningKeysCompleted
        ? JSON.parse(JSON.stringify(DEMO_TRACKING_METRICS_HEALTHY))
        : JSON.parse(JSON.stringify(DEMO_TRACKING_METRICS_DEGRADED));

      const newTrackingRisks = isSigningKeysCompleted
        ? []
        : JSON.parse(JSON.stringify(prev.trackingRisks));

      return {
        ...prev,
        tasks: recalculatedTasks,
        exceptions: updatedExceptions,
        trackingMetrics: newTrackingMetrics,
        trackingRisks: newTrackingRisks
      };
    });
  }, []);

  // Create task in-memory
  const createTask = useCallback((taskData: Partial<ProjectTask>): ProjectTask => {
    const newTask: ProjectTask = {
      id: `demo-task-${Date.now()}`,
      projectId: DEMO_PROJECT_ID,
      title: taskData.title || 'Untitled Demo Task',
      description: taskData.description || '',
      assigneeEmail: taskData.assigneeEmail || 'sarah.connor@echonote.internal',
      assigneeName: taskData.assigneeName || 'Sarah Connor',
      assigneeId: taskData.assigneeId || 'demo-sarah-connor',
      status: taskData.status || 'pending',
      priority: taskData.priority || 'medium',
      dueDate: taskData.dueDate || '',
      startDate: taskData.startDate || '',
      sourceType: 'manual',
      prerequisiteTaskIds: taskData.prerequisiteTaskIds || [],
      dependencyStatus: (taskData.prerequisiteTaskIds && taskData.prerequisiteTaskIds.length > 0) ? 'blocked' : 'ready',
      createdBy: 'demo-sarah-connor',
      creatorEmail: 'sarah.connor@echonote.internal',
      createdAt: new Date().toISOString()
    };

    setDemoState(prev => ({
      ...prev,
      tasks: [newTask, ...prev.tasks]
    }));

    return newTask;
  }, []);

  // Resolve exception in-memory
  const resolveException = useCallback((exceptionId: string, resolutionSummary: string) => {
    setDemoState(prev => ({
      ...prev,
      exceptions: prev.exceptions.map(exc => {
        if (exc.id === exceptionId) {
          return {
            ...exc,
            status: 'resolved' as const,
            resolutionSummary,
            resolvedAt: new Date().toISOString(),
            history: [
              ...(exc.history || []),
              {
                id: `demo-exc-hist-${Date.now()}`,
                action: 'resolved' as const,
                performedBy: 'demo-sarah-connor',
                performedByName: 'Sarah Connor',
                performedByEmail: 'sarah.connor@echonote.internal',
                timestamp: new Date().toISOString(),
                details: resolutionSummary
              }
            ]
          };
        }
        return exc;
      }),
      trackingMetrics: JSON.parse(JSON.stringify(DEMO_TRACKING_METRICS_HEALTHY)),
      trackingRisks: []
    }));
  }, []);

  // Confirm follow-up in-memory
  const confirmFollowUp = useCallback((meetingId: string) => {
    setDemoState(prev => ({
      ...prev,
      followUps: prev.followUps.map(fol => {
        if (fol.id === meetingId) {
          return {
            ...fol,
            status: 'confirmed' as const,
            confirmedAt: new Date().toISOString(),
            history: [
              ...(fol.history || []),
              {
                id: `demo-fol-hist-${Date.now()}`,
                action: 'confirmed' as const,
                performedBy: 'demo-sarah-connor',
                performedByName: 'Sarah Connor',
                performedByEmail: 'sarah.connor@echonote.internal',
                timestamp: new Date().toISOString(),
                details: 'Follow-up meeting confirmed by Sarah Connor'
              }
            ]
          };
        }
        return fol;
      })
    }));
  }, []);

  const value = useMemo<DemoWorkspaceContextValue>(() => ({
    isDemoMode,
    enterDemo,
    exitDemo,
    resetDemoState,
    demoProject: demoState.project,
    demoMembers: demoState.members,
    demoAudioRecords: [demoState.audioRecord],
    demoMeetings: demoState.meetings,
    demoDecisions: demoState.decisions,
    demoTasks: demoState.tasks,
    demoExceptions: demoState.exceptions,
    demoFollowUps: demoState.followUps,
    demoTrackingMetrics: demoState.trackingMetrics,
    demoTrackingRisks: demoState.trackingRisks,
    updateTaskStatus,
    createTask,
    resolveException,
    confirmFollowUp,
    activeDemoTab,
    setActiveDemoTab,
    tourActive,
    tourStepIndex,
    startTour,
    setTourStepIndex,
    endTour
  }), [
    isDemoMode,
    enterDemo,
    exitDemo,
    resetDemoState,
    demoState,
    updateTaskStatus,
    createTask,
    resolveException,
    confirmFollowUp,
    activeDemoTab,
    tourActive,
    tourStepIndex,
    startTour,
    endTour
  ]);

  return (
    <DemoWorkspaceContext.Provider value={value}>
      {children}
    </DemoWorkspaceContext.Provider>
  );
};
