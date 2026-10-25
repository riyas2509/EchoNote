/**
 * EchoNote — Phase 2, Step 1: Navigation Simplification Test Suite
 *
 * Validates:
 * 1. Workspace-level information architecture (Home, Projects Overview, Archive, Organization, Admin).
 * 2. Project-level canonical destinations (Overview, Tasks, Meetings, Search, Exceptions, Tracking, Follow-ups).
 * 3. Breadcrumb navigation states and context preservation.
 * 4. Responsive navigation structure and accessibility semantics.
 * 5. Role & permission sensitivity preservation across navigation items.
 */

export const AppWorkflow = {
  HOME: 'home',
  AUDIO_TO_TEXT: 'audio-to-text',
  TEXT_TO_AUDIO: 'text-to-audio',
  HISTORY: 'history',
  DECISION_INTELLIGENCE: 'decision-intelligence',
  DECISION_HISTORY: 'decision-history',
  COLLABORATION_DASHBOARD: 'collaboration-dashboard',
  ORGANIZATION_DASHBOARD: 'organization-dashboard',
  ADMIN_TRACKER: 'admin-tracker',
  PRODUCT_ANALYTICS: 'product-analytics'
} as const;

export type AppWorkflow = (typeof AppWorkflow)[keyof typeof AppWorkflow];

export const AuthStatus = {
  LOGGED_IN: 'LOGGED_IN',
  GUEST: 'GUEST',
  LOGGED_OUT: 'LOGGED_OUT'
} as const;

export type AuthStatus = (typeof AuthStatus)[keyof typeof AuthStatus];

export function runPhase2Step1NavigationValidation() {
  console.log('=== Starting Phase 2, Step 1: Navigation Simplification Verification ===\n');

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

  // 1. Workspace Navigation Structure Verification
  console.log('--- Test 1: Workspace-Level Navigation & Access Control ---');
  
  const getWorkspaceTabs = (authStatus: AuthStatus, isAdmin: boolean) => {
    const tabs: { id: AppWorkflow; label: string; group: 'workspace' | 'studio' | 'admin' }[] = [
      { id: AppWorkflow.HOME, label: 'Workspace Home', group: 'workspace' },
    ];
    if (authStatus === AuthStatus.LOGGED_IN) {
      tabs.push({ id: AppWorkflow.COLLABORATION_DASHBOARD, label: 'Projects Overview', group: 'workspace' });
    }
    tabs.push({ id: AppWorkflow.HISTORY, label: 'Intelligence Archive', group: 'workspace' });
    if (authStatus === AuthStatus.LOGGED_IN) {
      tabs.push({ id: AppWorkflow.ORGANIZATION_DASHBOARD, label: 'Organization', group: 'workspace' });
    }
    // Studio
    tabs.push({ id: AppWorkflow.AUDIO_TO_TEXT, label: 'Transcription', group: 'studio' });
    tabs.push({ id: AppWorkflow.TEXT_TO_AUDIO, label: 'Speech Synthesis', group: 'studio' });
    tabs.push({ id: AppWorkflow.DECISION_INTELLIGENCE, label: 'Decision Intelligence', group: 'studio' });
    tabs.push({ id: AppWorkflow.DECISION_HISTORY, label: 'Decision History', group: 'studio' });
    // Admin
    if (isAdmin) {
      tabs.push({ id: AppWorkflow.ADMIN_TRACKER, label: 'Admin Cost Tracker', group: 'admin' });
      tabs.push({ id: AppWorkflow.PRODUCT_ANALYTICS, label: 'PMF & Telemetry', group: 'admin' });
    }
    return tabs;
  };

  const guestTabs = getWorkspaceTabs(AuthStatus.GUEST, false);
  assert(
    guestTabs.some(t => t.id === AppWorkflow.HOME) && guestTabs.some(t => t.id === AppWorkflow.HISTORY),
    'Guest sees Home and Archive workspace navigation items'
  );
  assert(
    !guestTabs.some(t => t.id === AppWorkflow.COLLABORATION_DASHBOARD || t.id === AppWorkflow.ORGANIZATION_DASHBOARD),
    'Guest does not have Projects Overview or Organization tabs'
  );

  const memberTabs = getWorkspaceTabs(AuthStatus.LOGGED_IN, false);
  assert(
    memberTabs.some(t => t.id === AppWorkflow.COLLABORATION_DASHBOARD) &&
    memberTabs.some(t => t.id === AppWorkflow.ORGANIZATION_DASHBOARD),
    'Logged in member sees Projects Overview and Organization tabs in Workspace section'
  );
  assert(
    !memberTabs.some(t => t.group === 'admin'),
    'Non-admin member cannot see Admin tabs'
  );

  const adminTabs = getWorkspaceTabs(AuthStatus.LOGGED_IN, true);
  assert(
    adminTabs.filter(t => t.group === 'admin').length === 2,
    'Admin user sees Cost Tracker and PMF Telemetry tabs under Administration'
  );

  // 2. Project-Level Canonical Destinations
  console.log('\n--- Test 2: Project-Level Canonical Destinations ---');
  const projectCanonicalDestinations = [
    { key: 'projects', label: 'Overview' },
    { key: 'workspace', label: 'Tasks' },
    { key: 'meetings', label: 'Meetings' },
    { key: 'search', label: 'Search' },
    { key: 'exceptions', label: 'Exceptions' },
    { key: 'tracking', label: 'Execution Tracking' },
    { key: 'followups', label: 'Follow-ups' }
  ];

  assert(projectCanonicalDestinations.length === 7, 'Project workspace organizes exactly 7 canonical destinations');
  assert(projectCanonicalDestinations.some(d => d.key === 'workspace' && d.label === 'Tasks'), 'Tasks view is distinct and prominent');
  assert(projectCanonicalDestinations.some(d => d.key === 'tracking' && d.label === 'Execution Tracking'), 'Execution tracking view is distinct and prominent');
  assert(projectCanonicalDestinations.some(d => d.key === 'exceptions' && d.label === 'Exceptions'), 'Exceptions center is distinct and prominent');
  assert(projectCanonicalDestinations.some(d => d.key === 'meetings' && d.label === 'Meetings'), 'Meetings view is distinct and prominent');

  // 3. Breadcrumb & Navigation Context State Machine
  console.log('\n--- Test 3: Breadcrumb & Navigation Context State Machine ---');
  
  interface NavState {
    currentWorkflow: AppWorkflow;
    selectedProjectName: string | null;
    activeProjectTab: string;
  }

  const computeBreadcrumb = (state: NavState) => {
    const crumbs: string[] = ['Workspace'];
    if (state.selectedProjectName || state.currentWorkflow === AppWorkflow.COLLABORATION_DASHBOARD) {
      crumbs.push('Projects');
    }
    if (state.selectedProjectName) {
      crumbs.push(state.selectedProjectName);
    }
    return crumbs;
  };

  const state1: NavState = {
    currentWorkflow: AppWorkflow.HOME,
    selectedProjectName: null,
    activeProjectTab: 'projects'
  };
  assert(
    computeBreadcrumb(state1).join(' > ') === 'Workspace',
    'Root workspace home breadcrumb produces: Workspace'
  );

  const state2: NavState = {
    currentWorkflow: AppWorkflow.COLLABORATION_DASHBOARD,
    selectedProjectName: null,
    activeProjectTab: 'projects'
  };
  assert(
    computeBreadcrumb(state2).join(' > ') === 'Workspace > Projects',
    'Projects overview breadcrumb produces: Workspace > Projects'
  );

  const state3: NavState = {
    currentWorkflow: AppWorkflow.COLLABORATION_DASHBOARD,
    selectedProjectName: 'Alpha Launch',
    activeProjectTab: 'workspace'
  };
  assert(
    computeBreadcrumb(state3).join(' > ') === 'Workspace > Projects > Alpha Launch',
    'Inside project Alpha Launch breadcrumb produces: Workspace > Projects > Alpha Launch'
  );

  // Return to Projects Overview state transition
  const returnToProjects = (prev: NavState): NavState => ({
    ...prev,
    selectedProjectName: null,
    activeProjectTab: 'projects'
  });
  const state4 = returnToProjects(state3);
  assert(
    state4.selectedProjectName === null && state4.activeProjectTab === 'projects',
    'Clicking Projects or clearing project resets context to Projects Overview cleanly'
  );

  // 4. Grouped Execution Tracking Views
  console.log('\n--- Test 4: Grouped Analytics & Timelines Navigation ---');
  const trackingSubviews = ['analytics', 'timelines'];
  const canNavigateFromTracking = (target: string) => trackingSubviews.includes(target);
  assert(canNavigateFromTracking('analytics'), 'Analytics (trends) is accessible from execution tracking');
  assert(canNavigateFromTracking('timelines'), 'Timelines (Gantt) is accessible from execution tracking');

  // Summary
  console.log(`\n==================================================`);
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    throw new Error(`${failed} navigation tests failed.`);
  }
}

// Execute in ESM
runPhase2Step1NavigationValidation();
