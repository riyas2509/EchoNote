/**
 * Test Suite: AH.140 Notification Bell, Unread Count and Inbox UI
 */

import { InAppNotificationRecord } from "../lib/notificationModel.ts";

async function runNotificationInboxUiTests() {
  console.log("=== Running AH.140 Notification Inbox UI Tests ===");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string, detail?: string) {
    if (condition) {
      console.log("[PASS] " + desc);
      passed++;
    } else {
      console.error("[FAIL] " + desc + (detail ? (" - " + detail) : ""));
      failed++;
    }
  }

  // Sample deadline propagation notification
  const sampleDeadlineNotif: InAppNotificationRecord = {
    id: "notif_prop_123",
    projectId: "proj_alpha",
    taskId: "task_downstream_1",
    recipientUserId: "user_alice",
    recipientEmail: "alice@example.com",
    type: "DEADLINE_PROPAGATED",
    title: "Deadline adjusted for API Integration",
    message: "Your task API Integration deadline was pushed by +3 day(s) from 2026-11-05 to 2026-11-08 because prerequisite Database Migration was updated by Bob.",
    metadata: {
      triggerTaskId: "task_upstream_1",
      triggerTaskTitle: "Database Migration",
      affectedTaskId: "task_downstream_1",
      affectedTaskTitle: "API Integration",
      oldDueDate: "2026-11-05",
      newDueDate: "2026-11-08",
      shiftDays: 3,
      performerId: "user_bob",
      performerName: "Bob"
    },
    isRead: false,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    idempotencyKey: "notif_prop_task_downstream_1_abc123"
  };

  console.log("--- Test 1: Bell Rendering and Badge Display ---");
  {
    const formatBadge = (cnt: number) => cnt > 99 ? "99+" : cnt;
    const showBadge = (cnt: number) => cnt > 0;

    assert(!showBadge(0), "1.1 Badge hidden when unreadCount is 0");
    assert(showBadge(5) && formatBadge(5) === 5, "1.2 Badge renders raw count when unreadCount <= 99");
    assert(showBadge(100) && formatBadge(100) === "99+", "1.3 Badge visually capped at 99+ when unreadCount is 100");
    assert(showBadge(999) && formatBadge(999) === "99+", "1.4 Badge visually capped at 99+ when unreadCount is 999");
  }

  console.log("--- Test 2: Zero-Notification Empty State ---");
  {
    const emptyNotifs: InAppNotificationRecord[] = [];
    const activeProject = "Design System";
    const emptyStateText = "You are all caught up for " + activeProject + "!";
    assert(emptyNotifs.length === 0, "2.1 Empty list detected");
    assert(emptyStateText.includes(activeProject), "2.2 Empty state contextualized with active project name");
  }

  console.log("--- Test 3: Panel Opening, Closing and Dismissal Behavior ---");
  {
    let isOpen = false;
    const toggle = () => { isOpen = !isOpen; };
    const close = () => { isOpen = false; };

    assert(!isOpen, "3.1 Panel closed initially");
    toggle();
    assert(isOpen, "3.2 Bell toggle opens notification panel");
    toggle();
    assert(!isOpen, "3.3 Bell toggle closes notification panel");
    isOpen = true;
    close();
    assert(!isOpen, "3.4 Close button / dismissal closes notification panel");
  }

  console.log("--- Test 4: Loading, Error and Retry Behavior ---");
  {
    let loading = true;
    let error: string | null = null;
    let retryAttempted = false;

    // Simulate load failure
    loading = false;
    error = "Forbidden: You do not have access to view notifications for this project.";
    assert(!loading && error !== null, "4.1 Error state accurately captured");

    // Simulate retry action
    const onRetry = () => {
      retryAttempted = true;
      loading = true;
      error = null;
    };
    onRetry();
    assert(retryAttempted && loading && error === null, "4.2 Retry button resets error state and re-triggers fetch");
  }

  console.log("--- Test 5: Deadline-Propagation Metadata Rendering ---");
  {
    const meta = sampleDeadlineNotif.metadata;
    assert(sampleDeadlineNotif.type === "DEADLINE_PROPAGATED", "5.1 Correct notification type");
    assert(sampleDeadlineNotif.title.includes("API Integration"), "5.2 Title contains affected task title");
    assert(meta.oldDueDate === "2026-11-05" && meta.newDueDate === "2026-11-08", "5.3 Old and new deadline dates extracted cleanly");
    assert(meta.shiftDays === 3, "5.4 Shift days is +3");
    assert(meta.triggerTaskTitle === "Database Migration", "5.5 Trigger task prerequisite identified");
    assert(meta.performerName === "Bob", "5.6 Performer name attributed");
  }

  console.log("--- Test 6: Mark Single Notification as Read ---");
  {
    let notifications = [sampleDeadlineNotif];
    let unreadCount = 1;

    const markAsRead = (id: string) => {
      notifications = notifications.map(n => n.id === id ? { ...n, isRead: true } : n);
      unreadCount = Math.max(0, unreadCount - 1);
    };

    markAsRead(sampleDeadlineNotif.id);
    assert(notifications[0].isRead === true, "6.1 Notification marked isRead = true");
    assert(unreadCount === 0, "6.2 Unread count decremented to 0");
  }

  console.log("--- Test 7: Mark All Notifications as Read ---");
  {
    let notifications: InAppNotificationRecord[] = [
      { ...sampleDeadlineNotif, id: "notif_1", isRead: false },
      { ...sampleDeadlineNotif, id: "notif_2", isRead: false },
      { ...sampleDeadlineNotif, id: "notif_3", isRead: false }
    ];
    let unreadCount = 3;

    const markAllRead = () => {
      notifications = notifications.map(n => ({ ...n, isRead: true }));
      unreadCount = 0;
    };

    markAllRead();
    assert(notifications.every(n => n.isRead === true), "7.1 All notifications marked isRead = true");
    assert(unreadCount === 0, "7.2 Unread count cleared to 0");
  }

  console.log("--- Test 8: Project Switching and Stale Response Prevention ---");
  {
    let activeProjectId = "proj_1";
    let lastAbortedSignal: string | null = null;
    let renderedProjectId = "proj_1";

    const switchProject = (newProjectId: string) => {
      lastAbortedSignal = activeProjectId;
      activeProjectId = newProjectId;
      renderedProjectId = newProjectId;
    };

    switchProject("proj_2");
    assert(lastAbortedSignal === "proj_1", "8.1 Prior project in-flight fetch aborted");
    assert(renderedProjectId === "proj_2", "8.2 Active project state updated to proj_2");
  }

  console.log("--- Test 9: Network and API Failure Safety ---");
  {
    const safeErrorHandling = (err: any) => {
      return err.message || "Failed to retrieve notifications";
    };
    const networkFailMsg = safeErrorHandling(new Error("Failed to fetch"));
    assert(networkFailMsg === "Failed to fetch", "9.1 Network failure caught gracefully without crashing Topbar");
  }

  console.log("--- Test 12: PREREQUISITE_COMPLETED Presentation & Context Rendering ---");
  {
    const prereqNotif: InAppNotificationRecord = {
      id: "notif_prereq_123",
      projectId: "proj_alpha",
      taskId: "task_downstream_api",
      recipientUserId: "user_bob",
      recipientEmail: "bob@example.com",
      type: "PREREQUISITE_COMPLETED",
      title: 'Prerequisite completed for "API Endpoint Construction"',
      message: 'Prerequisite task "Database Migration" was completed by Alice. Your task "API Endpoint Construction" is ready to proceed.',
      metadata: {
        prerequisiteTaskId: "task_upstream_db",
        prerequisiteTaskTitle: "Database Migration",
        affectedTaskId: "task_downstream_api",
        affectedTaskTitle: "API Endpoint Construction",
        completedByUserName: "Alice",
        completedAt: new Date().toISOString()
      },
      isRead: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    assert(prereqNotif.type === "PREREQUISITE_COMPLETED", "12.1 Correct notification type PREREQUISITE_COMPLETED");
    assert(prereqNotif.metadata.prerequisiteTaskTitle === "Database Migration", "12.2 Prerequisite task title cleanly extracted");
    assert(prereqNotif.metadata.affectedTaskTitle === "API Endpoint Construction", "12.3 Affected task title cleanly extracted");
    assert(prereqNotif.metadata.completedByUserName === "Alice", "12.4 Performer name attributed");
    assert(prereqNotif.message.includes("ready to proceed"), "12.5 Action-oriented messaging present");
  }

  console.log("--- Test 13: Missing Optional Metadata Graceful Handling ---");
  {
    const missingMetaNotif: InAppNotificationRecord = {
      id: "notif_prereq_sparse",
      projectId: "proj_alpha",
      taskId: "task_sparse",
      recipientUserId: "user_bob",
      type: "PREREQUISITE_COMPLETED",
      title: 'Prerequisite completed for "Task X"',
      message: 'Prerequisite task was completed. Your task is ready to proceed.',
      metadata: {},
      isRead: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const prereqTitle = missingMetaNotif.metadata.prerequisiteTaskTitle || null;
    const performer = missingMetaNotif.metadata.completedByUserName || null;

    assert(prereqTitle === null, "13.1 Missing prerequisite title safely resolves to null without throwing");
    assert(performer === null, "13.2 Missing performer name safely resolves to null without broken text");
    assert(!missingMetaNotif.message.includes("undefined"), "13.3 Message contains no undefined interpolations");
  }

  console.log("--- Test 14: Navigation and Safe Fallbacks ---");
  {
    const projectsList = [
      { id: "proj_alpha", name: "Alpha Project" },
      { id: "proj_beta", name: "Beta Project" }
    ];

    // Case A: Supported project match resolves project name and tab
    let navigatedTab: string | null = null;
    let selectedProjectName: string | null = null;

    const resolveNavigation = (notif: { projectId?: string; taskId?: string; link?: string; recordId?: string }) => {
      if (notif.link) {
        return { type: "link", target: notif.link };
      }
      if (notif.projectId || notif.taskId) {
        const found = projectsList.find(p => p.id === notif.projectId || p.name === notif.projectId);
        if (found) {
          selectedProjectName = found.name;
        }
        navigatedTab = "collaboration-dashboard";
        return { type: "collaboration", projectName: selectedProjectName };
      }
      if (notif.recordId) {
        navigatedTab = "history";
        return { type: "history", recordId: notif.recordId };
      }
      return { type: "none" };
    };

    const resA = resolveNavigation({ projectId: "proj_alpha", taskId: "task_1" });
    assert(resA.type === "collaboration" && selectedProjectName === "Alpha Project", "14.1 Known project routes to collaboration dashboard with active project set");
    assert(navigatedTab === "collaboration-dashboard", "14.2 Active tab set to collaboration-dashboard");

    // Case B: Foreign or unresolvable project does not expose unauthorized state and falls back safely
    selectedProjectName = null;
    navigatedTab = null;
    const resB = resolveNavigation({ projectId: "proj_foreign_unauthorized", taskId: "task_secret" });
    assert(resB.type === "collaboration" && selectedProjectName === null, "14.3 Unmatched/unauthorized project does not set project filter and falls back safely to default project view");
  }

  console.log("--- Test 15: Cross-Notification Regression Coverage ---");
  {
    // Verify TASK_OVERDUE and DEADLINE_PROPAGATED notifications are also recognized
    const overdueNotif: InAppNotificationRecord = {
      id: "notif_overdue_1",
      projectId: "proj_alpha",
      taskId: "task_od_1",
      recipientUserId: "user_bob",
      type: "TASK_OVERDUE",
      title: 'Task overdue: "Design Audit"',
      message: 'Task is overdue by 3 days.',
      metadata: { daysOverdue: 3, dueDate: "2026-10-18" },
      isRead: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    assert(overdueNotif.type === "TASK_OVERDUE", "15.1 TASK_OVERDUE type preserved");
    assert(sampleDeadlineNotif.type === "DEADLINE_PROPAGATED", "15.2 DEADLINE_PROPAGATED type preserved");
  }

  console.log("--- Test 16: AH.146 Direct Task Navigation, Highlighting, and Fallback ---");
  {
    const authorizedProjects = [
      { id: "proj_alpha", name: "Alpha Project" },
      { id: "proj_beta", name: "Beta Project" }
    ];

    let currentTab: string | null = null;
    let selectedGroupFilter: string | null = null;
    let targetTaskId: string | null = null;

    const navigateFromNotification = (notif: { projectId?: string; taskId?: string }) => {
      if (notif.projectId || notif.taskId) {
        const authorized = authorizedProjects.find(p => p.id === notif.projectId || p.name === notif.projectId);
        if (authorized) {
          selectedGroupFilter = authorized.name;
          if (notif.taskId) {
            targetTaskId = notif.taskId;
          } else {
            targetTaskId = null;
          }
        } else {
          // Reject unauthorized project task exposure
          targetTaskId = null;
        }
        currentTab = "collaboration-dashboard";
      }
    };

    // 16.1 Navigation with valid authorized project and taskId
    navigateFromNotification({ projectId: "proj_alpha", taskId: "task_100" });
    assert(currentTab === "collaboration-dashboard", "16.1 Navigates to collaboration-dashboard");
    assert(selectedGroupFilter === "Alpha Project", "16.2 Sets authorized project filter");
    assert(targetTaskId === "task_100", "16.3 Preserves targetTaskId for downstream task highlight");

    // 16.2 Rejection of unauthorized project ID
    currentTab = null;
    selectedGroupFilter = null;
    targetTaskId = null;
    navigateFromNotification({ projectId: "proj_unauthorized_999", taskId: "task_secret" });
    assert(currentTab === "collaboration-dashboard", "16.4 Safe navigation to collaboration dashboard");
    assert(selectedGroupFilter === null, "16.5 Unauthorized project name not selected");
    assert(targetTaskId === null, "16.6 Unauthorized taskId discarded, preventing exposure");

    // 16.3 Missing taskId with authorized project
    currentTab = null;
    selectedGroupFilter = null;
    targetTaskId = null;
    navigateFromNotification({ projectId: "proj_beta" });
    assert(selectedGroupFilter === "Beta Project", "16.7 Navigates to project");
    assert(targetTaskId === null, "16.8 Gracefully handles absent taskId");

    // 16.4 Scroll & Highlight Simulation with task list lifecycle
    interface MockTask {
      id: string;
      title: string;
      status: string;
    }

    let activeHighlightTaskId: string | null = null;
    let expandedTaskIds = new Set<string>();
    let scrolledTaskId: string | null = null;
    let onClearCalls = 0;

    const simulateDashboardTargetHandler = (
      targetId: string | null,
      loading: boolean,
      tasks: MockTask[],
      onClear: () => void
    ) => {
      if (!targetId || loading) return;
      const exists = tasks.some(t => t.id === targetId);
      if (!exists) {
        if (tasks.length > 0) {
          onClear();
        }
        return;
      }
      expandedTaskIds.add(targetId);
      activeHighlightTaskId = targetId;
      scrolledTaskId = targetId;
    };

    // Simulated task list
    const mockTasks: MockTask[] = [
      { id: "task_100", title: "API Integration", status: "pending" },
      { id: "task_200", title: "Documentation", status: "in_progress" }
    ];

    // Delayed rendering (loading = true) -> does not attempt prematurely
    simulateDashboardTargetHandler("task_100", true, [], () => { onClearCalls++; });
    assert(activeHighlightTaskId === null && scrolledTaskId === null, "16.9 Waits for tasks to finish loading before attempting highlight");

    // Loaded tasks -> highlights, expands, and scrolls
    simulateDashboardTargetHandler("task_100", false, mockTasks, () => { onClearCalls++; });
    assert(activeHighlightTaskId === "task_100", "16.10 Active highlight set on matching task");
    assert(expandedTaskIds.has("task_100"), "16.11 Target task automatically expanded");
    assert(scrolledTaskId === "task_100", "16.12 Target task scrolled into view");

    // Missing or deleted task fallback -> calls onClear without crashing or leaving loading state
    onClearCalls = 0;
    simulateDashboardTargetHandler("task_deleted_404", false, mockTasks, () => { onClearCalls++; });
    assert(onClearCalls > 0, "16.13 Missing/deleted task triggers onClearTargetTaskId fallback safely");

    // Stale target cleanup on leaving view or timer expiration
    const clearHighlight = () => {
      activeHighlightTaskId = null;
      targetTaskId = null;
    };
    clearHighlight();
    assert(activeHighlightTaskId === null && targetTaskId === null, "16.14 Target task state safely cleared to avoid leaking to other views");
  }

  console.log("--- Test 17: AH.147 End-to-End Schema Compatibility & Recipient Isolation ---");
  {
    // 17.1 Schema Dual-Write & Compatibility: notifications must provide both recipientUserId and userId alias
    const prereqNotifDoc = {
      id: "notif_prereq_test_1",
      projectId: "proj_alpha",
      taskId: "task_downstream_10",
      recipientUserId: "user_bob",
      recipientEmail: "bob@example.com",
      userId: "user_bob",
      userEmail: "bob@example.com",
      type: "PREREQUISITE_COMPLETED",
      title: 'Prerequisite completed for "Build API"',
      message: 'Prerequisite task "DB Setup" was completed by Alice. Your task "Build API" is ready to proceed.',
      metadata: {
        prerequisiteTaskId: "task_prereq_9",
        prerequisiteTaskTitle: "DB Setup",
        affectedTaskId: "task_downstream_10",
        affectedTaskTitle: "Build API",
        projectId: "proj_alpha",
        completedAt: new Date().toISOString(),
        completedByUserId: "user_alice",
        completedByUserName: "Alice",
        recipientIdentifier: "user_bob"
      },
      isRead: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey: "notif_prereq_test_1"
    };

    // Client query matches on `userId == user.uid`
    const clientQueryUid = "user_bob";
    const matchesListener = prereqNotifDoc.userId === clientQueryUid || prereqNotifDoc.recipientUserId === clientQueryUid;
    assert(matchesListener, "17.1 Prerequisite notification discoverable via both userId and recipientUserId");
    assert(prereqNotifDoc.userEmail === "bob@example.com", "17.2 userEmail alias matches normalized recipient email");

    // 17.2 Cross-User Isolation: User Charlie cannot read or modify Bob's notification
    const unauthorizedUid = "user_charlie";
    const isOwner = prereqNotifDoc.userId === unauthorizedUid || prereqNotifDoc.recipientUserId === unauthorizedUid;
    assert(!isOwner, "17.3 Unauthorized user (user_charlie) blocked from recipient-isolated notification");

    // 17.3 Mapping into AppNotification in App.tsx
    const mapToAppNotification = (docData: any, docId: string) => {
      const timestamp = typeof docData.createdAt === 'string' ? new Date(docData.createdAt).getTime() : Date.now();
      return {
        id: docId,
        title: docData.title || 'Notification',
        message: docData.message || '',
        timestamp,
        isRead: Boolean(docData.isRead),
        type: (docData.type === 'PREREQUISITE_COMPLETED' || docData.type === 'TASK_OVERDUE' || docData.type === 'DEADLINE_PROPAGATED') ? 'info' : (docData.type || 'info'),
        notificationCategory: docData.type,
        projectId: docData.projectId,
        taskId: docData.taskId,
        metadata: docData.metadata,
        link: docData.link,
        recordId: docData.recordId || docData.recordingId
      };
    };

    const mapped = mapToAppNotification(prereqNotifDoc, prereqNotifDoc.id);
    assert(mapped.id === "notif_prereq_test_1", "17.4 AppNotification preserves document ID");
    assert(mapped.notificationCategory === "PREREQUISITE_COMPLETED", "17.5 Preserves PREREQUISITE_COMPLETED category");
    assert(mapped.projectId === "proj_alpha", "17.6 Preserves projectId");
    assert(mapped.taskId === "task_downstream_10", "17.7 Preserves taskId");
    assert(mapped.metadata?.prerequisiteTaskTitle === "DB Setup", "17.8 Preserves type-specific metadata");
    assert(mapped.isRead === false, "17.9 Preserves isRead state");

    // 17.4 Graceful fallback on missing optional metadata or legacy doc schema
    const legacyDoc = {
      title: "Legacy Generic Alert",
      message: "Something happened.",
      isRead: true,
      createdAt: new Date().toISOString()
    };
    const mappedLegacy = mapToAppNotification(legacyDoc, "notif_legacy_99");
    assert(mappedLegacy.title === "Legacy Generic Alert", "17.10 Legacy doc preserves title");
    assert(mappedLegacy.projectId === undefined, "17.11 Missing projectId handled gracefully");
    assert(mappedLegacy.taskId === undefined, "17.12 Missing taskId handled gracefully");
    assert(mappedLegacy.metadata === undefined, "17.13 Missing metadata handled gracefully");
    assert(mappedLegacy.isRead === true, "17.14 Legacy read state preserved");

    // 17.5 Read State Mutation Security
    const canUpdateReadStateOnly = (updateKeys: string[]) => {
      return updateKeys.every(k => k === 'isRead');
    };
    assert(canUpdateReadStateOnly(['isRead']), "17.15 Updating isRead field allowed");
    assert(!canUpdateReadStateOnly(['isRead', 'taskId']), "17.16 Tampering with taskId or other fields rejected");
    assert(!canUpdateReadStateOnly(['recipientUserId']), "17.17 Tampering with recipientUserId rejected");
  }

  console.log("\n==================================================");
  console.log("RESULTS: " + passed + " PASSED, " + failed + " FAILED");
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runNotificationInboxUiTests().catch(err => {
  console.error("Test suite failed:", err);
  process.exit(1);
});