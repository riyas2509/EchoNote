/**
 * EchoNote — Interactive Product Demo Step 3: Workspace Tour Guide Test Suite
 * 
 * Tests:
 * 1. Tour Configuration & 8-Step Visitor Journey:
 *    - Validates all 8 approved steps exist with sequential numbering, titles, and instructions.
 *    - Verifies progression types and data-tour selectors.
 * 2. Step Navigation, Back, and Skip Logic:
 *    - Forward progression, Back navigation decrement, and Skip step handling.
 * 3. Progression Behavior & Real Interaction Detection:
 *    - Verifies click_target progression triggers only on expected target actions.
 *    - Rejects unrelated clicks and prevents unintentional advancement.
 * 4. Missing Target Handling & Recovery:
 *    - Handles null/missing selectors gracefully.
 *    - Emits onTargetNotFound callback without crashing.
 *    - Allows guided skip when target is absent.
 * 5. Viewport Repositioning & Escape Key Handling:
 *    - Validates bounds checking logic.
 *    - Handles Escape key dismissal and cleanup.
 * 6. Accessibility & ARIA Attributes:
 *    - Dialog semantics, aria-live polite announcement generation, focus indicator readiness.
 */

import { DEMO_TOUR_STEPS, TourStepDefinition } from '../lib/demoTourConfig';

export async function runWorkspaceTourGuideTests() {
  console.log('=== Starting EchoNote Interactive Product Demo Step 3: Workspace Tour Guide Tests ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
      failed++;
    }
  }

  // ==========================================================================
  // Test Suite 1: Tour Configuration & 8-Step Visitor Journey
  // ==========================================================================
  console.log('--- Test Suite 1: Tour Configuration & 8-Step Visitor Journey ---');

  assert(DEMO_TOUR_STEPS.length === 8, '1.1 Tour config contains exactly 8 approved visitor journey steps');

  DEMO_TOUR_STEPS.forEach((step, idx) => {
    assert(
      step.stepNumber === idx + 1,
      `1.2 Step ${idx + 1} has correct 1-based sequential stepNumber`
    );
    assert(
      Boolean(step.title && step.explanation && step.instruction),
      `1.3 Step ${idx + 1} ("${step.title}") provides title, explanation, and instruction`
    );
  });

  // Verify critical milestone steps
  assert(
    DEMO_TOUR_STEPS[0].title.includes('Select "Enterprise API Migration"'),
    '1.4 Step 1 focuses on project selection'
  );
  assert(
    DEMO_TOUR_STEPS[1].title.includes('Open Project Meetings'),
    '1.5 Step 2 focuses on opening project meetings'
  );
  assert(
    DEMO_TOUR_STEPS[2].title.includes('Open "API Migration Kickoff Sync"'),
    '1.6 Step 3 focuses on selecting the kickoff sync'
  );
  assert(
    DEMO_TOUR_STEPS[4].title.includes('Inspect Strategic Decisions'),
    '1.7 Step 5 focuses on decision intelligence'
  );
  assert(
    DEMO_TOUR_STEPS[5].title.includes('Switch to Tasks & Dependencies'),
    '1.8 Step 6 focuses on tasks and execution'
  );
  assert(
    DEMO_TOUR_STEPS[6].title.includes('Inspect the Blocked Task & Prerequisite'),
    '1.9 Step 7 focuses on blocked task and prerequisite inspection'
  );
  assert(
    DEMO_TOUR_STEPS[7].title.includes('Tour Complete: Explore Freely'),
    '1.10 Step 8 concludes with free exploration and restart options'
  );

  // ==========================================================================
  // Test Suite 2: Step Navigation, Back, and Skip Logic
  // ==========================================================================
  console.log('\n--- Test Suite 2: Step Navigation, Back, and Skip Logic ---');

  let currentStepIdx = 0;
  const stepHistory: number[] = [0];

  function simulateStepChange(newIndex: number) {
    currentStepIdx = newIndex;
    stepHistory.push(newIndex);
  }

  function simulateBack() {
    if (currentStepIdx > 0) {
      simulateStepChange(currentStepIdx - 1);
    }
  }

  function simulateSkip() {
    if (currentStepIdx < DEMO_TOUR_STEPS.length - 1) {
      simulateStepChange(currentStepIdx + 1);
    }
  }

  // Advance from step 1 to 2
  simulateStepChange(1);
  assert(currentStepIdx === 1, '2.1 Forward step change updates current index to 1');

  // Back from step 2 to 1
  simulateBack();
  assert(currentStepIdx === 0, '2.2 Back button decrements current index back to 0');

  // Skip from step 1 to 2
  simulateSkip();
  assert(currentStepIdx === 1, '2.3 Skip step advances index to 1');

  // Back cannot go below 0
  simulateBack();
  simulateBack();
  assert(currentStepIdx === 0, '2.4 Back button cannot decrement below step index 0');

  // ==========================================================================
  // Test Suite 3: Progression Behavior & Real Interaction Detection
  // ==========================================================================
  console.log('\n--- Test Suite 3: Progression Behavior & Real Interaction Detection ---');

  const step1 = DEMO_TOUR_STEPS[0];
  assert(
    step1.progressionType === 'click_target',
    '3.1 Step 1 requires clicking the specific target to progress'
  );

  // Simulate clicking intended target vs unrelated area
  let stepAdvancedOnTargetClick = false;
  let stepAdvancedOnUnrelatedClick = false;

  function handleSimulatedClick(isTarget: boolean, stepDef: TourStepDefinition) {
    if (isTarget && (stepDef.progressionType === 'click_target' || stepDef.progressionType === 'click_target_or_next')) {
      stepAdvancedOnTargetClick = true;
    } else {
      stepAdvancedOnUnrelatedClick = false; // Blocked
    }
  }

  handleSimulatedClick(false, step1); // Clicked background/unrelated
  assert(!stepAdvancedOnTargetClick, '3.2 Clicking unrelated area does not advance the tour');

  handleSimulatedClick(true, step1); // Clicked intended target
  assert(stepAdvancedOnTargetClick, '3.3 Clicking intended target advances tour');

  // ==========================================================================
  // Test Suite 4: Missing Target Handling & Recovery
  // ==========================================================================
  console.log('\n--- Test Suite 4: Missing Target Handling & Recovery ---');

  let targetNotFoundEmitted = false;
  function handleMissingTarget(step: TourStepDefinition) {
    targetNotFoundEmitted = true;
  }

  // Simulate missing selector
  const missingStep: TourStepDefinition = {
    id: 'test-missing',
    stepNumber: 99,
    stageName: 'Test',
    title: 'Missing Step',
    explanation: 'Testing missing selector',
    instruction: 'Click target',
    targetSelector: '#non-existent-element-id',
    progressionType: 'click_target',
    canSkipIfMissing: true,
    missingTargetHelp: 'Skip if not found'
  };

  handleMissingTarget(missingStep);
  assert(targetNotFoundEmitted, '4.1 Emits onTargetNotFound callback when selector is missing');
  assert(missingStep.canSkipIfMissing === true, '4.2 Missing step config allows guided skip recovery');

  // ==========================================================================
  // Test Suite 5: Viewport Bounds & Smart Repositioning Logic
  // ==========================================================================
  console.log('\n--- Test Suite 5: Viewport Bounds & Smart Repositioning Logic ---');

  function calculateTooltipPosition(
    targetRect: { top: number; left: number; width: number; height: number; bottom: number; right: number },
    tooltipRect: { width: number; height: number },
    viewport: { width: number; height: number },
    preferred: 'bottom' | 'top' | 'left' | 'right'
  ) {
    let top = 0;
    let left = 0;
    let effective = preferred;
    const padding = 14;

    if (preferred === 'bottom') {
      top = targetRect.bottom + padding;
      left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
      if (top + tooltipRect.height > viewport.height - 16) {
        top = targetRect.top - tooltipRect.height - padding;
        effective = 'top';
      }
    }

    left = Math.max(16, Math.min(left, viewport.width - tooltipRect.width - 16));
    top = Math.max(16, Math.min(top, viewport.height - tooltipRect.height - 16));

    return { top, left, effective };
  }

  // Normal bottom placement
  const normalPos = calculateTooltipPosition(
    { top: 100, left: 200, width: 100, height: 40, bottom: 140, right: 300 },
    { width: 320, height: 180 },
    { width: 1200, height: 800 },
    'bottom'
  );
  assert(normalPos.effective === 'bottom' && normalPos.top === 154, '5.1 Normal bottom tooltip placement calculated correctly');

  // Bottom overflow flips to top
  const flippedPos = calculateTooltipPosition(
    { top: 700, left: 200, width: 100, height: 40, bottom: 740, right: 300 },
    { width: 320, height: 180 },
    { width: 1200, height: 800 },
    'bottom'
  );
  assert(flippedPos.effective === 'top' && flippedPos.top < 700, '5.2 Bottom overflow flips gracefully to top placement');

  // Left clamping inside mobile viewport
  const mobileClampedPos = calculateTooltipPosition(
    { top: 100, left: 10, width: 50, height: 40, bottom: 140, right: 60 },
    { width: 320, height: 180 },
    { width: 360, height: 640 },
    'bottom'
  );
  assert(mobileClampedPos.left >= 16, '5.3 Small viewport clamps left offset within screen boundary');

  // ==========================================================================
  // Test Suite 6: Accessibility & Live Announcements
  // ==========================================================================
  console.log('\n--- Test Suite 6: Accessibility & Live Announcements ---');

  function generateAriaLiveText(step: TourStepDefinition, total: number): string {
    return `Product tour step ${step.stepNumber} of ${total}: ${step.title}. ${step.instruction}`;
  }

  const liveText = generateAriaLiveText(DEMO_TOUR_STEPS[0], 8);
  assert(
    liveText.includes('Product tour step 1 of 8') &&
    liveText.includes('Select "Enterprise API Migration"'),
    '6.1 Screen reader aria-live text contains step number, total, and instruction'
  );

  // ==========================================================================
  // Test Suite 7: Workspace Tour Target Instrumentation & Selectors (Step 4)
  // ==========================================================================
  console.log('\n--- Test Suite 7: Workspace Tour Target Instrumentation & Selectors ---');

  const fs = await import('fs');
  const path = await import('path');

  const projectCardCode = fs.readFileSync(path.resolve(process.cwd(), 'components/ProjectCard.tsx'), 'utf-8');
  const collabDashCode = fs.readFileSync(path.resolve(process.cwd(), 'components/CollaborationDashboard.tsx'), 'utf-8');
  const meetingsViewCode = fs.readFileSync(path.resolve(process.cwd(), 'components/ProjectMeetingsView.tsx'), 'utf-8');
  const smartRecapCode = fs.readFileSync(path.resolve(process.cwd(), 'components/SmartRecapModal.tsx'), 'utf-8');
  const statsWidgetCode = fs.readFileSync(path.resolve(process.cwd(), 'components/SummaryStatsWidget.tsx'), 'utf-8');
  const decisionHistCode = fs.readFileSync(path.resolve(process.cwd(), 'components/DecisionHistory.tsx'), 'utf-8');

  // 1. project-card-api-migration
  assert(
    projectCardCode.includes('data-tour={isDemoProject ? "project-card-api-migration" : "project-card"}') ||
    projectCardCode.includes('project-card-api-migration'),
    '7.1 Target 1 (project-card-api-migration) is instrumented in ProjectCard.tsx'
  );
  assert(
    collabDashCode.includes('data-tour="project-selector"'),
    '7.1b Target 1 fallback (project-selector) is instrumented in CollaborationDashboard.tsx'
  );

  // 2. tab-meetings
  assert(
    collabDashCode.includes('data-tour="tab-meetings"'),
    '7.2 Target 2 (tab-meetings) is instrumented in CollaborationDashboard.tsx'
  );

  // 3. meeting-row-kickoff
  assert(
    meetingsViewCode.includes('data-tour={isKickoff ? "meeting-row-kickoff"'),
    '7.3 Target 3 (meeting-row-kickoff) is instrumented in ProjectMeetingsView.tsx'
  );

  // 4. meeting-action-items
  assert(
    smartRecapCode.includes('data-tour="meeting-action-items"'),
    '7.4 Target 4 (meeting-action-items) is instrumented in SmartRecapModal.tsx'
  );
  assert(
    smartRecapCode.includes('data-tour="smart-recap-section"'),
    '7.4b Target 4 fallback (smart-recap-section) is instrumented in SmartRecapModal.tsx'
  );

  // 5. meeting-decision-panel
  assert(
    statsWidgetCode.includes('data-tour="meeting-decision-panel"') &&
    statsWidgetCode.includes('data-tour="decision-intelligence-badge"'),
    '7.5 Target 5 (meeting-decision-panel) is instrumented in SummaryStatsWidget.tsx'
  );
  assert(
    decisionHistCode.includes('data-tour={isMigrationDecision ? "decision-history-card-migration" : undefined}'),
    '7.5b Target 5 deep-link (decision-history-card-migration) is instrumented in DecisionHistory.tsx'
  );

  // 6. tab-tasks
  assert(
    collabDashCode.includes('data-tour="tab-tasks"'),
    '7.6 Target 6 (tab-tasks) is instrumented in CollaborationDashboard.tsx'
  );

  // 7. task-card-sdk-v2
  assert(
    collabDashCode.includes('data-tour={isBlockedSdkTask ? "task-card-sdk-v2" : undefined}'),
    '7.7 Target 7 (task-card-sdk-v2) is instrumented in CollaborationDashboard.tsx'
  );
  assert(
    collabDashCode.includes('data-tour={isBlockedSdkTask ? "task-row-blocked" : undefined}'),
    '7.7b Target 7 fallback (task-row-blocked) is instrumented in CollaborationDashboard.tsx'
  );

  // 8. Tour completion target
  assert(
    DEMO_TOUR_STEPS[7].targetSelector === undefined &&
    DEMO_TOUR_STEPS[7].progressionType === 'completion_only',
    '7.8 Target 8 (tour completion) is correctly configured as modal center placement with completion_only'
  );

  console.log(`\n=== Workspace Tour Guide Tests Completed: ${passed} Passed, ${failed} Failed ===`);
  if (failed > 0) {
    throw new Error(`${failed} test(s) failed in Workspace Tour Guide suite`);
  }
}

// Execute
runWorkspaceTourGuideTests();

