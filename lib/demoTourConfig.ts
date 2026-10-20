/**
 * EchoNote — Interactive Product Demo Tour Step Definitions
 * 
 * Defines the approved eight-step visitor journey through the realistic workspace:
 * 1. Select Enterprise API Migration
 * 2. Open Meetings
 * 3. Open API Migration Kickoff Sync
 * 4. Explore the transcript and action items
 * 5. Open the strategic decision
 * 6. Open Tasks
 * 7. Inspect the blocked task and its prerequisite
 * 8. Finish the tour and offer self-exploration, restart, or exit
 */

export type TourProgressionType = 
  | 'click_target'
  | 'click_target_or_next'
  | 'custom_action'
  | 'completion_only';

export type TooltipPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right';

export interface TourStepDefinition {
  id: string;
  stepNumber: number;
  stageName: string;
  title: string;
  explanation: string;
  instruction: string;
  targetSelector?: string;
  targetFallbackSelector?: string;
  preferredPlacement?: TooltipPlacement;
  progressionType: TourProgressionType;
  expectedActionDescription?: string;
  // If target cannot be found even after retries, allows guided recovery
  canSkipIfMissing?: boolean;
  missingTargetHelp?: string;
}

export const DEMO_TOUR_STEPS: TourStepDefinition[] = [
  {
    id: 'step-1-select-project',
    stepNumber: 1,
    stageName: 'Workspace Projects',
    title: '1. Select "Enterprise API Migration"',
    explanation: 'Begin by exploring the Enterprise API Migration project to inspect active syncs, governance records, and operational risks.',
    instruction: 'Click on the "Enterprise API Migration" project card or project selector.',
    targetSelector: '[data-tour="project-card-api-migration"]',
    targetFallbackSelector: '[data-tour="project-selector"]',
    preferredPlacement: 'bottom',
    progressionType: 'click_target',
    expectedActionDescription: 'Select Enterprise API Migration project',
    canSkipIfMissing: true,
    missingTargetHelp: 'If the project card is not visible, select it from the top project dropdown or skip this step.'
  },
  {
    id: 'step-2-open-meetings',
    stepNumber: 2,
    stageName: 'Project Ingestion',
    title: '2. Open Project Meetings',
    explanation: 'All Zoom and cloud meeting sessions associated with this project are indexed here with verifiable provenance.',
    instruction: 'Click on the "Meetings" tab to view associated sessions.',
    targetSelector: '[data-tour="tab-meetings"]',
    preferredPlacement: 'bottom',
    progressionType: 'click_target',
    expectedActionDescription: 'Click Meetings tab',
    canSkipIfMissing: true,
    missingTargetHelp: 'Click the "Meetings" tab in the project header navigation.'
  },
  {
    id: 'step-3-open-meeting-detail',
    stepNumber: 3,
    stageName: 'Session Provenance',
    title: '3. Open "API Migration Kickoff Sync"',
    explanation: 'Review the recorded meeting session, verified provenance manifest, and AI-synthesized intelligence.',
    instruction: 'Click on "Enterprise API Migration Kickoff Sync" to view the transcript and recap.',
    targetSelector: '[data-tour="meeting-row-kickoff"]',
    targetFallbackSelector: '[data-tour="meeting-item-first"]',
    preferredPlacement: 'bottom',
    progressionType: 'click_target',
    expectedActionDescription: 'Select API Migration Kickoff Sync meeting',
    canSkipIfMissing: true,
    missingTargetHelp: 'Click on the meeting title to inspect its session details.'
  },
  {
    id: 'step-4-explore-transcript-actions',
    stepNumber: 4,
    stageName: 'Transcript & Action Items',
    title: '4. Explore Transcript & Action Items',
    explanation: 'EchoNote diarizes named speakers (Sarah Connor, Alex Chen, Marcus Vance) and links conversational moments to concrete action items.',
    instruction: 'Inspect the speaker quotes and action items generated from this discussion.',
    targetSelector: '[data-tour="meeting-action-items"]',
    targetFallbackSelector: '[data-tour="smart-recap-section"]',
    preferredPlacement: 'right',
    progressionType: 'click_target_or_next',
    expectedActionDescription: 'Review transcript segments and action items',
    canSkipIfMissing: true,
    missingTargetHelp: 'Scroll through the transcript or click Continue to proceed.'
  },
  {
    id: 'step-5-open-decision',
    stepNumber: 5,
    stageName: 'Decision Intelligence',
    title: '5. Inspect Strategic Decisions',
    explanation: 'Unanimous consensus and rationale are captured so architectural and compliance decisions are never lost.',
    instruction: 'Click on the decision: "Deprecate Legacy v1 Ingestion Pipeline by End of Q4".',
    targetSelector: '[data-tour="meeting-decision-panel"]',
    targetFallbackSelector: '[data-tour="decision-intelligence-badge"]',
    preferredPlacement: 'bottom',
    progressionType: 'click_target_or_next',
    expectedActionDescription: 'Inspect strategic decision card',
    canSkipIfMissing: true,
    missingTargetHelp: 'Look for the consensus decision card in the meeting intelligence panel.'
  },
  {
    id: 'step-6-open-tasks',
    stepNumber: 6,
    stageName: 'Execution Management',
    title: '6. Switch to Tasks & Dependencies',
    explanation: 'Conversational commitments automatically convert into project tasks with clear single-owner accountability.',
    instruction: 'Click on the "Tasks" tab in the project header navigation.',
    targetSelector: '[data-tour="tab-tasks"]',
    preferredPlacement: 'bottom',
    progressionType: 'click_target',
    expectedActionDescription: 'Click Tasks tab',
    canSkipIfMissing: true,
    missingTargetHelp: 'Click the "Tasks" or "Workspace" tab in the project navigation bar.'
  },
  {
    id: 'step-7-inspect-blocked-task',
    stepNumber: 7,
    stageName: 'Dependency Engine',
    title: '7. Inspect the Blocked Task & Prerequisite',
    explanation: 'Notice Task "Publish Client SDK v2.4" is BLOCKED because Marcus Vance is overdue on prerequisite "Generate SHA256 Signing Keys". Project health is flagged at 72%.',
    instruction: 'Click on the blocked task "Publish Client SDK v2.4" to inspect its dependency details.',
    targetSelector: '[data-tour="task-card-sdk-v2"]',
    targetFallbackSelector: '[data-tour="task-row-blocked"]',
    preferredPlacement: 'left',
    progressionType: 'click_target_or_next',
    expectedActionDescription: 'Inspect blocked task row',
    canSkipIfMissing: true,
    missingTargetHelp: 'Click on the red-highlighted blocked task or the exception badge.'
  },
  {
    id: 'step-8-tour-complete',
    stepNumber: 8,
    stageName: 'Tour Complete',
    title: '8. Tour Complete: Explore Freely',
    explanation: 'You have seen how EchoNote bridges meeting conversations to hardened execution. All sample data is isolated in-memory — feel free to mark tasks complete, resolve blockers, or explore the rest of the workspace!',
    instruction: 'Click "Start Free Exploration" to interact with the demo workspace, or "Restart Tour" to see the steps again.',
    targetSelector: undefined, // Modal/Center placement
    preferredPlacement: 'auto',
    progressionType: 'completion_only',
    expectedActionDescription: 'Finish tour or explore freely'
  }
];
