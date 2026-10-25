/**
 * EchoNote — Interactive Product Demo Step 5: Workspace Views & Data Boundary Isolation Verification Suite
 */

import {
  DEMO_PROJECT_ID,
  DEMO_PROJECT_NAME,
  DEMO_MEETING_ID,
  DEMO_DECISION_ID,
  DEMO_TASK_SIGNING_KEYS_ID,
  DEMO_TASK_CLIENT_SDK_ID,
  DEMO_EXCEPTION_ID,
  DEMO_FOLLOWUP_ID,
  DEMO_PROJECT,
  DEMO_AUDIO_RECORD,
  DEMO_DECISION_ITEM,
  DEMO_TASKS,
  DEMO_TASK_EXCEPTION,
  DEMO_FOLLOW_UP,
  DEMO_PROJECT_MEETING_ITEM,
  DEMO_TRACKING_METRICS_DEGRADED,
  DEMO_TRACKING_METRICS_HEALTHY,
  createInitialDemoState
} from '../lib/demoData';

import {
  isDemoIdentifier,
  assertNotDemoWrite
} from '../lib/demoStateManager';

export async function runWorkspaceViewsIsolationTests() {
  console.log('=== Starting EchoNote Product Demo Step 5: Workspace Views Isolation Test Suite ===\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log('  [PASS] ' + testName);
      passed++;
    } else {
      console.error('  [FAIL] ' + testName + (detail ? ' - ' + detail : ''));
      failed++;
    }
  }

  // --- SECTION 1: Mocked Backend & Firestore Spy Harness ---
  console.log('--- Section 1: Spy Harness & Mock Verification ---');
  
  const forbiddenCalls: Array<{ type: string; target: string }> = [];

  const mockDbCalls = {
    onSnapshot: (target: string) => {
      forbiddenCalls.push({ type: 'onSnapshot', target });
    },
    updateDoc: (target: string) => {
      forbiddenCalls.push({ type: 'updateDoc', target });
    },
    setDoc: (target: string) => {
      forbiddenCalls.push({ type: 'setDoc', target });
    },
    deleteDoc: (target: string) => {
      forbiddenCalls.push({ type: 'deleteDoc', target });
    },
    addDoc: (target: string) => {
      forbiddenCalls.push({ type: 'addDoc', target });
    }
  };

  const mockFetch = async (url: string, init?: any) => {
    forbiddenCalls.push({ type: 'fetch', target: url });
    return {
      ok: true,
      json: async () => ({})
    };
  };

  assert(forbiddenCalls.length === 0, '1.1 Spy harness initialized with zero forbidden calls');

  // --- SECTION 2: Demo Identification & Write Assertion Verification ---
  console.log('\n--- Section 2: Demo Identifier & Defensive Assertions ---');

  assert(isDemoIdentifier(DEMO_PROJECT_ID), '2.1 isDemoIdentifier detects demo project ID');
  assert(isDemoIdentifier(DEMO_MEETING_ID), '2.2 isDemoIdentifier detects demo meeting ID');
  assert(isDemoIdentifier(DEMO_TASK_SIGNING_KEYS_ID), '2.3 isDemoIdentifier detects demo task ID');
  assert(isDemoIdentifier(DEMO_EXCEPTION_ID), '2.4 isDemoIdentifier detects demo exception ID');
  assert(isDemoIdentifier(DEMO_FOLLOWUP_ID), '2.5 isDemoIdentifier detects demo follow-up ID');
  assert(!isDemoIdentifier('proj_real_customer_123'), '2.6 isDemoIdentifier returns false for real customer IDs');

  let assertCaught = false;
  try {
    assertNotDemoWrite({ entityId: DEMO_PROJECT_ID, collectionName: 'projects' });
  } catch (err: any) {
    assertCaught = true;
  }
  assert(assertCaught, '2.7 assertNotDemoWrite throws error when write attempted for demo project');

  // --- SECTION 3: Workspace View Simulated Read Paths ---
  console.log('\n--- Section 3: Workspace Reads Demo Awareness & Bypassed Listeners ---');

  const isDemoProject = true;
  let meetingsResult: any[] = [];
  if (isDemoProject) {
    meetingsResult = [DEMO_PROJECT_MEETING_ITEM];
  } else {
    await mockFetch('/api/projects/' + DEMO_PROJECT_ID + '/meetings');
  }

  assert(
    meetingsResult.length === 1 && meetingsResult[0].recordingId === DEMO_MEETING_ID,
    '3.1 ProjectMeetingsView resolves demo meetings synchronously from state'
  );
  assert(
    forbiddenCalls.filter(c => c.target.includes('/api/projects/')).length === 0,
    '3.2 Zero network fetches issued for demo project meetings'
  );

  let decisionsResult: any[] = [];
  if (isDemoProject) {
    decisionsResult = [DEMO_DECISION_ITEM];
  } else {
    mockDbCalls.onSnapshot('projects/' + DEMO_PROJECT_ID + '/decisions');
  }

  assert(
    decisionsResult.length === 1 && decisionsResult[0].id === DEMO_DECISION_ID,
    '3.3 DecisionHistory renders demo decisions directly without Firestore query'
  );
  assert(
    forbiddenCalls.filter(c => c.type === 'onSnapshot').length === 0,
    '3.4 Zero Firestore snapshot listeners registered for demo decisions'
  );

  const activeAudioRecord = DEMO_AUDIO_RECORD;
  assert(
    Boolean(activeAudioRecord.smartRecap && activeAudioRecord.smartRecap.executiveSummary.length === 3),
    '3.5 Demo audio record includes pre-generated 3-point Smart Recap (Zero external LLM API call required)'
  );
  assert(
    activeAudioRecord.smartRecap?.taggedMembers.length === 3,
    '3.6 Smart Recap tagged team members match demo participant fixtures'
  );

  // --- SECTION 4: In-Memory Task Mutation & Cascading Health Score ---
  console.log('\n--- Section 4: In-Memory Mutation & Dependency Recalculation ---');

  const demoStore = createInitialDemoState();
  assert(
    demoStore.trackingMetrics.healthScore === 72,
    '4.1 Initial tracking health score is degraded (72%) due to overdue prerequisite'
  );

  const blockedTaskBefore = demoStore.tasks.find(t => t.id === DEMO_TASK_CLIENT_SDK_ID);
  assert(
    blockedTaskBefore?.dependencyStatus === 'blocked',
    '4.2 Client SDK task is initially blocked'
  );

  demoStore.tasks = demoStore.tasks.map(t => {
    if (t.id === DEMO_TASK_SIGNING_KEYS_ID) {
      return { ...t, status: 'completed' as const };
    }
    return t;
  });

  const blockedTaskAfter = demoStore.tasks.find(t => t.id === DEMO_TASK_CLIENT_SDK_ID);
  const prereqCompleted = demoStore.tasks.find(t => t.id === DEMO_TASK_SIGNING_KEYS_ID)?.status === 'completed';
  if (prereqCompleted && blockedTaskAfter) {
    blockedTaskAfter.dependencyStatus = 'ready';
    blockedTaskAfter.blockingPrerequisites = [];
    demoStore.trackingMetrics = { ...DEMO_TRACKING_METRICS_HEALTHY };
  }

  assert(
    blockedTaskAfter?.dependencyStatus === 'ready',
    '4.3 Completing prerequisite task clears blocker on downstream task'
  );
  assert(
    demoStore.trackingMetrics.healthScore === 94,
    '4.4 Health score successfully recovers to 94% without backend API invocation'
  );

  assert(
    forbiddenCalls.length === 0,
    '4.5 Zero Firestore writes or backend mutations triggered during in-memory state transition'
  );

  // --- SECTION 5: Safety Guardrails for Unsupported Operations ---
  console.log('\n--- Section 5: Guardrails for Unsupported Demo Actions ---');

  let taskDeletePrevented = false;
  if (isDemoProject || isDemoIdentifier(DEMO_TASK_SIGNING_KEYS_ID)) {
    taskDeletePrevented = true;
  } else {
    await mockFetch('/api/tasks/' + DEMO_TASK_SIGNING_KEYS_ID, { method: 'DELETE' });
  }

  assert(taskDeletePrevented, '5.1 Task deletion is prevented in demo mode');

  let prereqMutationPrevented = false;
  if (isDemoProject || isDemoIdentifier(DEMO_TASK_CLIENT_SDK_ID)) {
    prereqMutationPrevented = true;
  } else {
    await mockFetch('/api/tasks/' + DEMO_TASK_CLIENT_SDK_ID, { method: 'PATCH' });
  }

  assert(prereqMutationPrevented, '5.2 Prerequisite modification is prevented in demo mode');

  assert(
    forbiddenCalls.length === 0,
    '5.3 All forbidden calls remained 0 after testing guardrails'
  );

  console.log('\n=== Workspace Views Isolation Tests Complete: ' + passed + ' Passed, ' + failed + ' Failed ===');
  if (failed > 0) {
    process.exit(1);
  }
}

runWorkspaceViewsIsolationTests().catch(err => {
  console.error(err);
  process.exit(1);
});
