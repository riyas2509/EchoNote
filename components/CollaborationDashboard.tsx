import { RecurringScheduleManager } from './RecurringScheduleManager';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip as RechartsTooltip, 
  Legend, 
  CartesianGrid 
} from 'recharts';
import { 
  Users, 
  UserPlus, 
  Clock, 
  FileAudio, 
  Bookmark, 
  Brain, 
  Trash2, 
  Shield, 
  Plus, 
  AlertTriangle, 
  CheckCircle2, 
  X, 
  ChevronDown, 
  ChevronUp,
  ChevronRight,
  Folder, 
  Mail, 
  Calendar, 
  Activity, 
  ArrowRight,
  ShieldAlert,
  Sparkles,
  BarChart3,
  ListTodo,
  CheckSquare,
  Check,
  CalendarClock,
  Edit2,
  History,
  PlusCircle,
  CheckCircle,
  Bell,
  CornerDownRight,
  Video,
  Search,
  GitMerge,
  Lock,
  LayoutTemplate,
  Copy,
  FileText,
  FolderPlus
} from 'lucide-react';
import { 
  db, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  addDoc, 
  serverTimestamp,
  getDocs,
  handleFirestoreError,
  OperationType
} from '../firebase';
import { 
  Project, 
  ProjectMember, 
  UserProfile, 
  AudioToTextRecord, 
  TextToAudioRecord, 
  CollaborationRole,
  ProjectActivity,
  OrgRole,
  ProjectTask,
  SubTask,
  TaskActivity,
  SmartRecap,
  normalizeProjectRole,
  TaskTemplate,
  TaskTemplateItem,
  TaskException,
  TaskExceptionHistoryEntry,
  TaskExceptionSeverity,
  TaskExceptionStatus,
  TaskExceptionType,
  FollowUpMeeting,
  FollowUpMeetingStatus,
  FollowUpParticipant,
  TaskRiskIndicator,
  ProjectTrackingMetrics,
  TrackingMonitoringJob
} from '../types';
import { Toaster, toast } from 'sonner';
import { SummaryStatsWidget } from './SummaryStatsWidget';
import { ProjectAnalyticsView } from './ProjectAnalyticsView';
import { AutomatedTaggingModal } from './AutomatedTaggingModal';
import { SmartRecapModal } from './SmartRecapModal';
import { ReportExportModal } from './ReportExportModal';
import { ProjectMeetingsView } from './ProjectMeetingsView';
import { ProjectSearchView } from './ProjectSearchView';
import { generateSmartRecap } from '../services/geminiService';
import { ProjectCard, ProjectActivityItem } from './ProjectCard';
import { ProjectTemplateModal } from './ProjectTemplateModal';
import { useDemoWorkspace, isDemoIdentifier, assertNotDemoWrite } from '../lib/demoStateManager';
import { WorkspaceTourGuide } from './WorkspaceTourGuide';
import { DEMO_TOUR_STEPS } from '../lib/demoTourConfig';
import { DeadlinePropagationModal } from './DeadlinePropagationModal';
import { ReasoningMeetingCompletionModal } from './ReasoningMeetingCompletionModal';
import { previewDeadlinePropagation, executeDeadlinePropagation } from '../lib/apiClient';
import { PropagationPreviewResult } from '../lib/taskScheduling';

interface CollaborationDashboardProps {
  projects: Project[];
  selectedProjectName: string | null;
  onSelectProjectName: (name: string | null) => void;
  userProfile: UserProfile | undefined;
  audioHistory: AudioToTextRecord[];
  textHistory: TextToAudioRecord[];
  transcriptions?: TextToAudioRecord[];
  addNotification: (notif: any) => void;
  onInviteToProject: (projectName: string, email: string, role: CollaborationRole) => Promise<any>;
  userOrgRole?: OrgRole;
  onUpdateAudio?: (record: AudioToTextRecord) => Promise<void> | void;
  targetTaskId?: string | null;
  onClearTargetTaskId?: () => void;
}

const CustomMemberTaskTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-xl p-3 text-xs space-y-2.5 min-w-[210px] z-50">
      <div className="border-b border-slate-100 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-extrabold text-slate-900 text-sm">{data.shortName}</p>
          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[9px] font-black uppercase rounded">
            {data.role}
          </span>
        </div>
        <p className="text-[10px] text-slate-500 truncate mt-0.5">{data.email}</p>
      </div>

      <div className="space-y-1.5 font-medium">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-amber-800">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
            Pending Tasks:
          </span>
          <span className="font-extrabold text-slate-900">{data.pending}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-emerald-800">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            Completed Tasks:
          </span>
          <span className="font-extrabold text-slate-900">{data.completed}</span>
        </div>

        <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 font-bold">
          <span className="text-slate-500">Completion Rate:</span>
          <span className="text-emerald-600 font-extrabold">{data.completionRate}% ({data.completed}/{data.total})</span>
        </div>
      </div>

      <div className="pt-1 text-[10px] text-indigo-600 font-bold text-center border-t border-slate-50">
        Click bar to filter member tasks
      </div>
    </div>
  );
};

export const CollaborationDashboard: React.FC<CollaborationDashboardProps> = ({
  projects,
  selectedProjectName,
  onSelectProjectName,
  userProfile,
  audioHistory,
  textHistory,
  transcriptions,
  addNotification,
  onInviteToProject,
  userOrgRole,
  onUpdateAudio,
  targetTaskId,
  onClearTargetTaskId
}) => {
  const effectiveTranscriptions = transcriptions || textHistory || [];
  const [chartMode, setChartMode] = useState<'grouped' | 'stacked'>('grouped');
  const [activeProjectTab, setActiveProjectTab] = useState<'projects' | 'workspace' | 'meetings' | 'search' | 'analytics' | 'timelines' | 'exceptions' | 'followups' | 'tracking' | 'recurring'>('workspace');
  const [projectSearch, setProjectSearch] = useState('');
  const [isAutomatedTaggingOpen, setIsAutomatedTaggingOpen] = useState(false);

  // AI Smart Recap State
  const [isSmartRecapOpen, setIsSmartRecapOpen] = useState(false);
  const [isGeneratingRecap, setIsGeneratingRecap] = useState(false);
  const [smartRecapRecord, setSmartRecapRecord] = useState<AudioToTextRecord | null>(null);
  const [smartRecapData, setSmartRecapData] = useState<SmartRecap | null>(null);
  const [smartRecapTitle, setSmartRecapTitle] = useState<string>('');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  
  // Demo Workspace State Integration (Step 5 & 7)
  const demoContext = useDemoWorkspace();
  const isDemoProject = Boolean(
    demoContext?.isDemoMode &&
    (!selectedProjectName || selectedProjectName === demoContext?.demoProject?.name || selectedProjectName === 'Enterprise API Migration') ||
    (selectedProjectName && projects.some(p => p.name === selectedProjectName && isDemoIdentifier(p.id)))
  );

  // Active Project Selection
  const activeProject: Project = isDemoProject && demoContext
    ? demoContext.demoProject
    : (projects.find(p => p.name === selectedProjectName) || projects[0] || {
        id: 'general',
        name: 'General',
        userId: userProfile?.uid || 'system',
        ownerEmail: userProfile?.email || 'System',
        createdAt: new Date().toISOString(),
        members: []
      });

  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [loggedActivities, setLoggedActivities] = useState<ProjectActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);

  // Real-time Tasks State
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskFilter, setTaskFilter] = useState<'all' | 'my' | 'pending' | 'in_progress' | 'completed' | 'overdue' | 'due_soon' | 'starting_soon' | 'unscheduled'>('all');
  const [taskPriorityFilter, setTaskPriorityFilter] = useState<string>('all');
  const [taskDateSort, setTaskDateSort] = useState<'none' | 'dueDate_asc' | 'dueDate_desc' | 'startDate_asc' | 'startDate_desc'>('none');
  const [taskSearchQuery, setTaskSearchQuery] = useState<string>('');
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);

  // Expandable Tasks State
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const [activeHighlightTaskId, setActiveHighlightTaskId] = useState<string | null>(null);
  const [editingDueDateTaskId, setEditingDueDateTaskId] = useState<string | null>(null);
  const [editingStartDateTaskId, setEditingStartDateTaskId] = useState<string | null>(null);
  const [editingDescriptionTaskId, setEditingDescriptionTaskId] = useState<string | null>(null);
  const [tempDescriptions, setTempDescriptions] = useState<Record<string, string>>({});
  const [newSubTaskTitles, setNewSubTaskTitles] = useState<Record<string, string>>({});

  // Notification & assignment tracking refs
  const previousTasksMapRef = useRef<Map<string, string>>(new Map());
  const initialTasksLoadedRef = useRef<boolean>(false);

  // New Task form state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskAssigneeEmail, setTaskAssigneeEmail] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [taskStartDate, setTaskStartDate] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskDateConflictError, setTaskDateConflictError] = useState<string | null>(null);
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);

  // Deadline Propagation Modal State (AH.181)
  const [propagationModalOpen, setPropagationModalOpen] = useState(false);
  const [propagationTargetTask, setPropagationTargetTask] = useState<ProjectTask | null>(null);
  const [propagationProposedDates, setPropagationProposedDates] = useState<{ startDate?: string; dueDate?: string }>({});
  const [propagationPreview, setPropagationPreview] = useState<PropagationPreviewResult | null>(null);
  const [isLoadingPropagationPreview, setIsLoadingPropagationPreview] = useState(false);
  const [isExecutingPropagation, setIsExecutingPropagation] = useState(false);
  const [propagationError, setPropagationError] = useState<string | null>(null);

  // Task Templates state (Step 3.4)
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [showCreateTemplateModal, setShowCreateTemplateModal] = useState(false);
  const [selectedTemplateForPreview, setSelectedTemplateForPreview] = useState<TaskTemplate | null>(null);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);
  const [applyAnchorDate, setApplyAnchorDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [applyAssigneeEmail, setApplyAssigneeEmail] = useState<string>('');

  // Create Template Modal state
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDescription, setNewTemplateDescription] = useState('');
  const [newTemplateScope, setNewTemplateScope] = useState<'project' | 'organization'>('project');
  const [newTemplateTasks, setNewTemplateTasks] = useState<TaskTemplateItem[]>([
    { id: 'task_1', title: '', priority: 'medium', startOffsetDays: 0, dueOffsetDays: 3, prerequisiteTemplateItemIds: [] }
  ]);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);

  // Task Exceptions state (Step 3.5)
  const [exceptions, setExceptions] = useState<TaskException[]>([]);
  const [loadingExceptions, setLoadingExceptions] = useState(false);
  const [exceptionMetrics, setExceptionMetrics] = useState<any>({ total: 0, activeTotal: 0, critical: 0, high: 0 });
  const [exceptionFilterStatus, setExceptionFilterStatus] = useState<string>('active');
  const [exceptionFilterSeverity, setExceptionFilterSeverity] = useState<string>('all');
  const [exceptionFilterType, setExceptionFilterType] = useState<string>('all');
  const [exceptionFilterAssignee, setExceptionFilterAssignee] = useState<string>('all');
  const [selectedExceptionDetail, setSelectedExceptionDetail] = useState<TaskException | null>(null);
  const [isRaisingException, setIsRaisingException] = useState(false);
  const [raisingForTask, setRaisingForTask] = useState<ProjectTask | null>(null);
  const [newExceptionType, setNewExceptionType] = useState<TaskExceptionType>('blocked');
  const [newExceptionSeverity, setNewExceptionSeverity] = useState<TaskExceptionSeverity>('high');
  const [newExceptionTitle, setNewExceptionTitle] = useState('');
  const [newExceptionDesc, setNewExceptionDesc] = useState('');
  const [newExceptionAssignee, setNewExceptionAssignee] = useState('');
  const [isSubmittingException, setIsSubmittingException] = useState(false);
  const [resolvingExceptionId, setResolvingExceptionId] = useState<string | null>(null);
  const [resolutionSummaryText, setResolutionSummaryText] = useState('');
  const [dismissingExceptionId, setDismissingExceptionId] = useState<string | null>(null);
  const [dismissalReasonText, setDismissalReasonText] = useState('');

  // Follow-Up Meetings state (Step 3.6)
  const [followUps, setFollowUps] = useState<FollowUpMeeting[]>([]);
  const [loadingFollowUps, setLoadingFollowUps] = useState(false);
  const [followUpRecommendations, setFollowUpRecommendations] = useState<any[]>([]);
  const [loadingFollowUpRecs, setLoadingFollowUpRecs] = useState(false);
  const [followUpFilterStatus, setFollowUpFilterStatus] = useState<string>('all');
  const [selectedFollowUpDetail, setSelectedFollowUpDetail] = useState<FollowUpMeeting | null>(null);
  const [isSchedulingFollowUpModal, setIsSchedulingFollowUpModal] = useState(false);
  const [scheduleFollowUpTaskId, setScheduleFollowUpTaskId] = useState<string | null>(null);
  const [scheduleFollowUpExceptionId, setScheduleFollowUpExceptionId] = useState<string | null>(null);
  const [followUpFormTitle, setFollowUpFormTitle] = useState('');
  const [followUpFormPurpose, setFollowUpFormPurpose] = useState('');
  const [followUpFormAgenda, setFollowUpFormAgenda] = useState('');
  const [followUpFormStartTime, setFollowUpFormStartTime] = useState('');
  const [followUpFormEndTime, setFollowUpFormEndTime] = useState('');
  const [followUpFormParticipants, setFollowUpFormParticipants] = useState<string[]>([]);
  const [followUpFormAllowDuplicate, setFollowUpFormAllowDuplicate] = useState(false);
  const [isSubmittingFollowUp, setIsSubmittingFollowUp] = useState(false);
  const [reschedulingMeetingId, setReschedulingMeetingId] = useState<string | null>(null);
  const [rescheduleStartTime, setRescheduleStartTime] = useState('');
  const [rescheduleEndTime, setRescheduleEndTime] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [cancellingMeetingId, setCancellingMeetingId] = useState<string | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState('');
  const [completingMeetingId, setCompletingMeetingId] = useState<string | null>(null);
  const [completionNotesText, setCompletionNotesText] = useState('');
  const [reasoningMeetingToComplete, setReasoningMeetingToComplete] = useState<FollowUpMeeting | null>(null);

  // Dependency & Deadline Tracking State (Step 3.7)
  const [trackingMetrics, setTrackingMetrics] = useState<ProjectTrackingMetrics | null>(null);
  const [trackingRisks, setTrackingRisks] = useState<TaskRiskIndicator[]>([]);
  const [loadingTracking, setLoadingTracking] = useState(false);
  const [isQueueingJob, setIsQueueingJob] = useState(false);
  const [trackingRiskFilter, setTrackingRiskFilter] = useState<string>('all');
  const [trackingCategoryFilter, setTrackingCategoryFilter] = useState<string>('all');

  // Invite Form State
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CollaborationRole>('viewer');
  const [isInviting, setIsInviting] = useState(false);

  // Determine User Role inside Active Project
  const isOrgOwner = userOrgRole === 'owner';
  const isOrgAdmin = userOrgRole === 'org_admin';
  const isViewer = userOrgRole === 'viewer';

  const isOwner = isOrgOwner || isOrgAdmin || activeProject.userId === userProfile?.uid || activeProject.ownerEmail === userProfile?.email;
  const currentMemberRecord = members.find(m => m.email === userProfile?.email);
  const userRole: CollaborationRole = isOwner ? 'owner' : (currentMemberRecord?.role ? normalizeProjectRole(currentMemberRecord.role) : (isViewer ? 'viewer' : 'viewer'));

  // Update Last Active status periodically
  useEffect(() => {
    if (isDemoProject || !userProfile || !activeProject?.id || activeProject.id === 'general') return;

    const updateLastActive = async () => {
      try {
        const memberId = `${activeProject.id}_${userProfile.uid}`;
        const memberRef = doc(db, 'projectMembers', memberId);
        
        await updateDoc(memberRef, {
          lastActive: new Date().toISOString()
        });
      } catch (err) {
        // If fail, user might be owner and not have a projectMember doc yet, which is fine
      }
    };

    updateLastActive();
    const interval = setInterval(updateLastActive, 60000); // update every minute
    return () => clearInterval(interval);
  }, [userProfile, activeProject?.id, isDemoProject]);

  // Real-time listener for Project Members
  useEffect(() => {
    if (!activeProject?.id) return;

    if (isDemoProject) {
      setMembers(demoContext?.demoMembers || []);
      setLoadingMembers(false);
      return;
    }

    setLoadingMembers(true);

    const qMembers = query(
      collection(db, 'projectMembers'),
      where('projectId', '==', activeProject.id)
    );

    const unsubscribe = onSnapshot(qMembers, (snapshot) => {
      const memberList: ProjectMember[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          projectId: data.projectId,
          uid: data.userId || data.uid,
          email: data.email,
          role: data.role,
          displayName: data.displayName || data.email.split('@')[0],
          joinedAt: data.joinedAt?.toDate ? data.joinedAt.toDate().toISOString() : data.joinedAt || new Date().toISOString(),
          lastActive: data.lastActive || null,
          photoURL: data.photoURL || data.avatarUrl || null
        } as unknown as ProjectMember;
      });
      setMembers(memberList);
      setLoadingMembers(false);
    }, (error) => {
      console.error("Error loading project members:", error);
      handleFirestoreError(error, OperationType.LIST, 'projectMembers', false);
      setLoadingMembers(false);
    });

    return () => unsubscribe();
  }, [activeProject?.id, isDemoProject, demoContext?.demoMembers]);

  // Real-time listener for Assigned Tasks
  useEffect(() => {
    if (!activeProject?.id) return;

    if (isDemoProject) {
      setTasks(demoContext?.demoTasks || []);
      setLoadingTasks(false);
      return;
    }

    setLoadingTasks(true);

    const qTasks = query(
      collection(db, 'tasks'),
      where('projectId', '==', activeProject.id)
    );

    const unsubscribe = onSnapshot(qTasks, (snapshot) => {
      const taskList: ProjectTask[] = snapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          projectId: data.projectId,
          title: data.title || 'Untitled Task',
          description: data.description || '',
          assigneeEmail: data.assigneeEmail || '',
          assigneeName: data.assigneeName || data.assigneeEmail?.split('@')[0] || 'Unassigned',
          assigneeId: data.assigneeId || '',
          status: data.status || 'pending',
          priority: data.priority || 'medium',
          dueDate: data.dueDate || '',
          startDate: data.startDate || '',
          prerequisiteTaskIds: Array.isArray(data.prerequisiteTaskIds) ? data.prerequisiteTaskIds : [],
          subTasks: Array.isArray(data.subTasks) ? data.subTasks : [],
          activityHistory: Array.isArray(data.activityHistory) ? data.activityHistory : [],
          createdBy: data.createdBy || '',
          creatorEmail: data.creatorEmail || '',
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : (data.updatedAt || undefined)
        };
      });

      // Compute dependency states & downstream dependents dynamically
      const tasksMap = new Map<string, ProjectTask>();
      taskList.forEach(t => tasksMap.set(t.id, t));

      const downstreamMap = new Map<string, string[]>();
      taskList.forEach(t => {
        (t.prerequisiteTaskIds || []).forEach(pid => {
          const list = downstreamMap.get(pid) || [];
          list.push(t.id);
          downstreamMap.set(pid, list);
        });
      });

      taskList.forEach(t => {
        const blockingPrereqs: Array<{ id: string; title: string; status: string }> = [];
        (t.prerequisiteTaskIds || []).forEach(pid => {
          const prereqTask = tasksMap.get(pid);
          if (prereqTask && prereqTask.status !== 'completed') {
            blockingPrereqs.push({
              id: pid,
              title: prereqTask.title,
              status: prereqTask.status
            });
          }
        });

        if (t.status === 'completed') {
          t.dependencyStatus = 'completed';
        } else if (blockingPrereqs.length > 0) {
          t.dependencyStatus = 'blocked';
        } else {
          t.dependencyStatus = 'ready';
        }

        t.blockingPrerequisites = blockingPrereqs;
        t.dependentTaskIds = downstreamMap.get(t.id) || [];
      });

      // Automatic In-App Notification Trigger for members assigned to tasks in real-time
      if (initialTasksLoadedRef.current && userProfile?.email) {
        taskList.forEach(task => {
          const prevAssignee = previousTasksMapRef.current.get(task.id);
          const isAssignedToMe = task.assigneeEmail?.toLowerCase() === userProfile.email.toLowerCase();
          const wasAssignedToMe = prevAssignee?.toLowerCase() === userProfile.email.toLowerCase();

          // If assigned to current user, was not previously assigned to them, and was created or reassigned by someone else
          if (isAssignedToMe && !wasAssignedToMe && (task.createdBy !== userProfile.uid || prevAssignee)) {
            addNotification({
              title: 'Task Assigned to You',
              message: `You were assigned "${task.title}" by ${task.creatorEmail?.split('@')[0] || 'a team member'} in ${activeProject.name}.`,
              type: 'info'
            });
            toast.info(`New Task Assigned: "${task.title}"`);
          }
        });
      }

      // Record snapshot map for future diffing
      const currentMap = new Map<string, string>();
      taskList.forEach(t => currentMap.set(t.id, t.assigneeEmail));
      previousTasksMapRef.current = currentMap;
      initialTasksLoadedRef.current = true;

      const priorityWeights: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
      taskList.sort((a, b) => {
        if (a.status === 'completed' && b.status !== 'completed') return 1;
        if (a.status !== 'completed' && b.status === 'completed') return -1;
        const pDiff = (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0);
        if (pDiff !== 0) return pDiff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      setTasks(taskList);
      setLoadingTasks(false);
    }, (error) => {
      console.error("Error loading project tasks:", error);
      handleFirestoreError(error, OperationType.LIST, 'tasks', false);
      setLoadingTasks(false);
    });

    return () => unsubscribe();
  }, [activeProject?.id, isDemoProject, demoContext?.demoTasks]);

  // Target task navigation & highlight handler (AH.146)
  useEffect(() => {
    if (!targetTaskId || loadingTasks) return;

    // Switch to workspace tab where project task list is rendered
    if (activeProjectTab !== 'workspace') {
      setActiveProjectTab('workspace');
    }

    const taskExists = tasks.some(t => t.id === targetTaskId);
    if (!taskExists) {
      // Safe fallback if task is not found or was deleted
      if (tasks.length > 0) {
        onClearTargetTaskId?.();
      }
      return;
    }

    // Ensure filter doesn't hide the target task
    setTaskFilter('all');
    setTaskSearchQuery('');
    setMemberFilter(null);
    setTaskPriorityFilter('all');

    // Automatically expand the targeted task
    setExpandedTaskIds(prev => new Set(prev).add(targetTaskId));
    setActiveHighlightTaskId(targetTaskId);

    // Scroll into view once DOM updates
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-task-id="${targetTaskId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);

    // Subtle temporary highlight: auto-clear after 3.5 seconds
    const clearTimer = setTimeout(() => {
      setActiveHighlightTaskId(null);
      onClearTargetTaskId?.();
    }, 3500);

    return () => {
      clearTimeout(timer);
      clearTimeout(clearTimer);
    };
  }, [targetTaskId, loadingTasks, tasks, activeProjectTab, onClearTargetTaskId]);

  // Real-time listener for Invites
  useEffect(() => {
    if (!activeProject?.id || isDemoProject) {
      if (isDemoProject) {
        setInvites([]);
        setLoadingInvites(false);
      }
      return;
    }

    // Only project admins/owners query and manage pending invites (SEC-04: read scoped to project admins)
    if (userRole !== 'owner' && userRole !== 'admin') {
      setInvites([]);
      setLoadingInvites(false);
      return;
    }

    setLoadingInvites(true);

    const qInvites = query(
      collection(db, 'invites'),
      where('projectId', '==', activeProject.id)
    );

    const unsubscribe = onSnapshot(qInvites, (snapshot) => {
      const inviteList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setInvites(inviteList);
      setLoadingInvites(false);
    }, (error) => {
      console.error("Error loading invites:", error);
      setLoadingInvites(false);
    });

    return () => unsubscribe();
  }, [activeProject?.id, userRole, isDemoProject]);

  // Real-time listener for Logged Activities
  useEffect(() => {
    if (!activeProject?.id) return;

    if (isDemoProject) {
      setLoggedActivities([]);
      setLoadingActivities(false);
      return;
    }

    setLoadingActivities(true);

    const qActivities = query(
      collection(db, 'projectActivities'),
      where('projectId', '==', activeProject.id)
    );

    const unsubscribe = onSnapshot(qActivities, (snapshot) => {
      const actList: ProjectActivity[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          projectId: data.projectId,
          userId: data.userId,
          userEmail: data.userEmail,
          userName: data.userName,
          actionType: data.actionType,
          description: data.description,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || new Date().toISOString(),
          metadata: data.metadata
        };
      });
      setLoggedActivities(actList);
      setLoadingActivities(false);
    }, (error) => {
      console.error("Error loading activities:", error);
      setLoadingActivities(false);
    });

    return () => unsubscribe();
  }, [activeProject?.id, isDemoProject]);

  // Helper to log dynamic activities locally and to Firebase
  const logActivity = async (actionType: any, description: string) => {
    if (isDemoProject) return; // In-memory only in demo mode
    if (!userProfile || !activeProject?.id) return;
    try {
      await addDoc(collection(db, 'projectActivities'), {
        projectId: activeProject.id,
        userId: userProfile.uid,
        userEmail: userProfile.email,
        userName: userProfile.displayName || userProfile.email.split('@')[0],
        actionType,
        description,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to log activity:", err);
    }
  };

  // Metrics computation based on permissions (AH.183: supports multi-project association via projectIds)
  const projectAudioRecords = isDemoProject && demoContext
    ? demoContext.demoAudioRecords
    : (audioHistory || []).filter(
        r => r.projectId === activeProject.id ||
             (Array.isArray(r.projectIds) && r.projectIds.includes(activeProject.id)) ||
             r.group === activeProject.name
      );
  const projectTextRecords = isDemoProject
    ? []
    : (effectiveTranscriptions || []).filter(
        r => r.projectId === activeProject.id ||
             (Array.isArray((r as any).projectIds) && (r as any).projectIds.includes(activeProject.id)) ||
             r.group === activeProject.name
      );

  // Apply permission restrictions: Member owns activity only, Viewer read-only, Owner full visibility
  const filteredAudioRecords = userRole === 'owner' || userRole === 'viewer'
    ? projectAudioRecords
    : projectAudioRecords.filter(r => r.userId === userProfile?.uid);

  const filteredTextRecords = userRole === 'owner' || userRole === 'viewer'
    ? projectTextRecords
    : projectTextRecords.filter(r => r.userId === userProfile?.uid);

  const transcriptCount = filteredAudioRecords.length;
  const filesUploaded = filteredAudioRecords.length + filteredTextRecords.length;
  const bookmarkCount = filteredAudioRecords.reduce((sum, r) => sum + (r.bookmarks?.length || 0), 0);

  // Active recordings for the selected project (excluding soft-deleted items)
  const activeRecordings = filteredAudioRecords.filter(r => !r.deletedAt);
  const trashedAudioRecordings = filteredAudioRecords.filter(r => !!r.deletedAt);
  const activeRecordingsCount = activeRecordings.length;
  const readyRecordingsCount = activeRecordings.filter(
    r => r.status === 'completed' || (!r.status && (r.transcript?.length || 0) > 0)
  ).length;
  const inProgressRecordingsCount = activeRecordings.filter(
    r => r.status === 'processing' || r.status === 'pending' || r.status === 'draft' || r.status === 'uploading'
  ).length;

  // Real-time task derivations and filtering
  const myAssignedTasks = tasks.filter(t => t.assigneeEmail?.toLowerCase() === userProfile?.email?.toLowerCase());
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  const todayStartMs = new Date().setHours(0,0,0,0);
  const threeDaysAheadMs = todayStartMs + (3 * 24 * 60 * 60 * 1000);

  const overdueTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate).getTime() < todayStartMs && t.status !== 'completed');
  const dueSoonTasks = tasks.filter(t => {
    if (t.status === 'completed' || !t.dueDate) return false;
    const dueTime = new Date(t.dueDate).getTime();
    return dueTime >= todayStartMs && dueTime <= threeDaysAheadMs;
  });
  const startingSoonTasks = tasks.filter(t => {
    if (t.status === 'completed' || !t.startDate) return false;
    const startTime = new Date(t.startDate).getTime();
    return startTime >= todayStartMs && startTime <= threeDaysAheadMs;
  });
  const unscheduledTasks = tasks.filter(t => t.status !== 'completed' && !t.startDate && !t.dueDate);

  const filteredTasks = tasks.filter(t => {
    if (memberFilter && t.assigneeEmail?.toLowerCase() !== memberFilter.toLowerCase()) {
      return false;
    }
    if (taskPriorityFilter !== 'all' && t.priority !== taskPriorityFilter) {
      return false;
    }
    if (taskSearchQuery.trim()) {
      const q = taskSearchQuery.toLowerCase();
      const match = (t.title && t.title.toLowerCase().includes(q)) ||
                    (t.description && t.description.toLowerCase().includes(q)) ||
                    (t.assigneeName && t.assigneeName.toLowerCase().includes(q)) ||
                    (t.assigneeEmail && t.assigneeEmail.toLowerCase().includes(q));
      if (!match) return false;
    }
    if (taskFilter === 'my') {
      return t.assigneeEmail?.toLowerCase() === userProfile?.email?.toLowerCase();
    }
    if (taskFilter === 'pending') {
      return t.status === 'pending';
    }
    if (taskFilter === 'in_progress') {
      return t.status === 'in_progress';
    }
    if (taskFilter === 'completed') {
      return t.status === 'completed';
    }
    if (taskFilter === 'overdue') {
      return t.dueDate && new Date(t.dueDate).getTime() < todayStartMs && t.status !== 'completed';
    }
    if (taskFilter === 'due_soon') {
      return t.dueDate && new Date(t.dueDate).getTime() >= todayStartMs && new Date(t.dueDate).getTime() <= threeDaysAheadMs && t.status !== 'completed';
    }
    if (taskFilter === 'starting_soon') {
      return t.startDate && new Date(t.startDate).getTime() >= todayStartMs && new Date(t.startDate).getTime() <= threeDaysAheadMs && t.status !== 'completed';
    }
    if (taskFilter === 'unscheduled') {
      return t.status !== 'completed' && !t.startDate && !t.dueDate;
    }
    return true;
  }).sort((a, b) => {
    if (taskDateSort === 'dueDate_asc') {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    if (taskDateSort === 'dueDate_desc') {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
    }
    if (taskDateSort === 'startDate_asc') {
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    }
    if (taskDateSort === 'startDate_desc') {
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
    }
    return 0;
  });

  // Summary chart data for 'Pending' vs 'Completed' tasks per project member using recharts
  const memberTaskStats = useMemo(() => {
    if (!activeProject) return [];

    const statsMap = new Map<string, {
      email: string;
      name: string;
      shortName: string;
      role: string;
      pending: number;
      completed: number;
      total: number;
      completionRate: number;
    }>();

    // 1. Always include Project Owner
    const ownerEmail = activeProject.ownerEmail?.toLowerCase();
    if (ownerEmail) {
      const isCurrentUser = userProfile?.email?.toLowerCase() === ownerEmail;
      const short = isCurrentUser ? 'You (Owner)' : `${activeProject.ownerEmail.split('@')[0]} (Owner)`;
      statsMap.set(ownerEmail, {
        email: ownerEmail,
        name: isCurrentUser ? 'You (Project Creator)' : `${activeProject.ownerEmail} (Owner)`,
        shortName: short,
        role: 'Owner',
        pending: 0,
        completed: 0,
        total: 0,
        completionRate: 0
      });
    }

    // 2. Include all Project Members
    members.forEach(m => {
      const email = m.email.toLowerCase();
      const isCurrentUser = userProfile?.email?.toLowerCase() === email;
      const displayName = isCurrentUser ? 'You' : (m.displayName || m.email.split('@')[0]);
      if (!statsMap.has(email)) {
        statsMap.set(email, {
          email,
          name: `${displayName} (${email})`,
          shortName: displayName,
          role: m.role === 'editor' ? 'Member' : m.role,
          pending: 0,
          completed: 0,
          total: 0,
          completionRate: 0
        });
      }
    });

    // 3. Count Pending vs Completed tasks per member
    tasks.forEach(t => {
      const assigneeEmail = t.assigneeEmail?.toLowerCase();
      if (!assigneeEmail) return;

      if (!statsMap.has(assigneeEmail)) {
        const isCurrentUser = userProfile?.email?.toLowerCase() === assigneeEmail;
        const displayName = isCurrentUser ? 'You' : (t.assigneeName || assigneeEmail.split('@')[0]);
        statsMap.set(assigneeEmail, {
          email: assigneeEmail,
          name: `${displayName} (${assigneeEmail})`,
          shortName: displayName,
          role: 'Member',
          pending: 0,
          completed: 0,
          total: 0,
          completionRate: 0
        });
      }

      const stat = statsMap.get(assigneeEmail)!;
      if (t.status === 'completed') {
        stat.completed += 1;
      } else {
        stat.pending += 1;
      }
      stat.total = stat.pending + stat.completed;
      stat.completionRate = stat.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 0;
    });

    return Array.from(statsMap.values());
  }, [activeProject, members, tasks, userProfile]);

  // Normalized project members for analytics & assignment
  const allProjectMembers: ProjectMember[] = useMemo(() => {
    const map = new Map<string, ProjectMember>();
    if (activeProject.ownerEmail) {
      map.set(activeProject.ownerEmail.toLowerCase(), {
        projectId: activeProject.id,
        uid: activeProject.userId || 'owner',
        email: activeProject.ownerEmail,
        displayName: activeProject.ownerEmail.split('@')[0],
        role: 'owner',
        joinedAt: activeProject.createdAt || new Date().toISOString()
      });
    }
    (activeProject.members || []).forEach(m => {
      map.set(m.email.toLowerCase(), m);
    });
    members.forEach(m => {
      map.set(m.email.toLowerCase(), m);
    });
    return Array.from(map.values());
  }, [activeProject, members]);

  // Real-time decision intelligence count & key decisions list
  const [decisionHistoryList, setDecisionHistoryList] = useState<any[]>([]);
  const [decisionCount, setDecisionCount] = useState(0);

  useEffect(() => {
    if (!activeProject?.id) return;

    if (isDemoProject) {
      const demoDecs = demoContext?.demoDecisions || [];
      setDecisionHistoryList(demoDecs);
      setDecisionCount(demoDecs.length);
      return;
    }
    
    // Listen for decision history in this project in real-time
    const qDecisions = query(
      collection(db, 'decisionHistory'),
      where('projectId', '==', activeProject.id)
    );

    const unsubscribe = onSnapshot(qDecisions, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setDecisionHistoryList(docs);
      setDecisionCount(snapshot.size);
    }, (err) => {
      console.warn("Could not listen to decisionHistory, fallback count:", err);
      // Fallback for demo or offline state
      setDecisionCount(activeProject.name.toLowerCase() === 'general' ? 2 : 0);
    });

    return () => unsubscribe();
  }, [activeProject?.id, activeProject.name, isDemoProject, demoContext?.demoDecisions]);

  // Completed decisions calculation for selected project:
  // 1. Decisions extracted from active meeting/audio recordings (CallSummary + UnifiedIntelligence)
  const decisionsFromRecordings = activeRecordings.reduce((sum, r) => {
    const unifiedCount = r.unifiedIntelligence?.decisions?.length || 0;
    const summaryCount = r.summary?.decisions?.length || 0;
    return sum + (unifiedCount > 0 ? unifiedCount : summaryCount);
  }, 0);

  // 2. Concluded strategic decisions saved in Decision Intelligence engine
  const decisionsFromIntelligence = decisionHistoryList.reduce((acc, doc) => {
    const keyDecisions = doc.output?.keyDecisions || doc.keyDecisions;
    if (Array.isArray(keyDecisions) && keyDecisions.length > 0) {
      return acc + keyDecisions.length;
    }
    return acc + 1;
  }, 0);

  const completedDecisionsCount = decisionsFromRecordings + (decisionsFromIntelligence > 0 ? decisionsFromIntelligence : decisionCount);

  // Multi-Project Real-time State for Project Cards
  const [allProjectsTasks, setAllProjectsTasks] = useState<Record<string, ProjectTask[]>>({});
  const [allProjectsActivities, setAllProjectsActivities] = useState<Record<string, ProjectActivity[]>>({});
  const [allProjectsDecisions, setAllProjectsDecisions] = useState<Record<string, any[]>>({});

  // Sync tasks across all projects in real-time
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    const unsubs: (() => void)[] = [];

    projects.forEach(proj => {
      if (!proj?.id || isDemoIdentifier(proj.id)) return;
      const q = query(
        collection(db, 'tasks'),
        where('projectId', '==', proj.id)
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const taskList: ProjectTask[] = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            projectId: data.projectId,
            title: data.title || 'Untitled Task',
            description: data.description || '',
            assigneeEmail: data.assigneeEmail || '',
            assigneeName: data.assigneeName || data.assigneeEmail?.split('@')[0] || 'Unassigned',
            assigneeId: data.assigneeId || '',
            status: data.status || 'pending',
            priority: data.priority || 'medium',
            dueDate: data.dueDate || '',
            subTasks: Array.isArray(data.subTasks) ? data.subTasks : [],
            activityHistory: Array.isArray(data.activityHistory) ? data.activityHistory : [],
            createdBy: data.createdBy || '',
            creatorEmail: data.creatorEmail || '',
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : (data.updatedAt || undefined)
          };
        });

        setAllProjectsTasks(prev => ({
          ...prev,
          [proj.id]: taskList
        }));
      }, () => {});

      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach(u => u());
    };
  }, [projects]);

  // Sync project activities across all projects in real-time
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    const unsubs: (() => void)[] = [];

    projects.forEach(proj => {
      if (!proj?.id || isDemoIdentifier(proj.id)) return;
      const q = query(
        collection(db, 'projectActivities'),
        where('projectId', '==', proj.id)
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const actList: ProjectActivity[] = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            projectId: data.projectId,
            userId: data.userId,
            userEmail: data.userEmail,
            userName: data.userName,
            actionType: data.actionType,
            description: data.description,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt || new Date().toISOString(),
            metadata: data.metadata
          };
        });

        setAllProjectsActivities(prev => ({
          ...prev,
          [proj.id]: actList
        }));
      }, () => {});

      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach(u => u());
    };
  }, [projects]);

  // Sync decisionHistory across all projects in real-time
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    const unsubs: (() => void)[] = [];

    projects.forEach(proj => {
      if (!proj?.id || isDemoIdentifier(proj.id)) return;
      const q = query(
        collection(db, 'decisionHistory'),
        where('projectId', '==', proj.id)
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const dList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        setAllProjectsDecisions(prev => ({
          ...prev,
          [proj.id]: dList
        }));
      }, () => {});

      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach(u => u());
    };
  }, [projects]);

  // Visual indicator calculation: completed tasks versus total tasks for any project card
  const getProjectTaskCounts = (proj: Project) => {
    const pTasks = allProjectsTasks[proj.id] || (proj.id === activeProject.id ? tasks : []);
    const total = pTasks.length;
    const completed = pTasks.filter(t => t.status === 'completed').length;
    return { completed, total };
  };

  // Recent Activity feed: last 3 actions performed within a specific project (such as Uploads or Decisions)
  const getProjectRecentActivities = (proj: Project): ProjectActivityItem[] => {
    const actions: ProjectActivityItem[] = [];

    // 1. Uploads: Audio recordings attached to this specific project
    const projAudio = (audioHistory || []).filter(
      r => (r.projectId === proj.id || r.group === proj.name) && !r.deletedAt
    );
    projAudio.forEach(rec => {
      actions.push({
        id: `upload_${rec.id}`,
        type: 'Upload',
        title: rec.fileName || 'Audio Recording',
        description: `${rec.ownerEmail === userProfile?.email ? 'You' : (rec.ownerEmail?.split('@')[0] || 'Team member')} uploaded "${rec.fileName || 'Audio'}"`,
        timestamp: rec.date || rec.createdAt || new Date().toISOString(),
        userName: rec.ownerEmail?.split('@')[0] || 'Member'
      });
    });

    // 2. Decisions: Strategic outcomes from decisionHistory & recordings
    const projDecisions = allProjectsDecisions[proj.id] || [];
    projDecisions.forEach((d: any) => {
      actions.push({
        id: `dec_${d.id}`,
        type: 'Decision',
        title: d.title || 'Decision Logged',
        description: d.description || `Decision documented: ${d.title || 'Consensus reached'}`,
        timestamp: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : (d.createdAt || new Date().toISOString()),
        userName: d.userId === userProfile?.uid ? 'You' : 'Analyst'
      });
    });

    projAudio.forEach(rec => {
      if (rec.unifiedIntelligence?.decisions && Array.isArray(rec.unifiedIntelligence.decisions)) {
        rec.unifiedIntelligence.decisions.slice(0, 2).forEach((dec: any, i: number) => {
          const decTitle = typeof dec === 'string' ? dec : (dec.title || dec.decision || 'Meeting Decision');
          actions.push({
            id: `dec_rec_${rec.id}_${i}`,
            type: 'Decision',
            title: decTitle,
            description: `Decision extracted: "${decTitle}"`,
            timestamp: rec.date || rec.createdAt || new Date().toISOString(),
            userName: rec.ownerEmail?.split('@')[0]
          });
        });
      }
    });

    // 3. Project Activities: Logged audit trail
    const projActs = allProjectsActivities[proj.id] || (proj.id === activeProject.id ? loggedActivities : []);
    projActs.forEach(act => {
      const isUpload = act.actionType === 'upload_file';
      const isDecision = act.actionType === 'generate_decision';
      actions.push({
        id: `act_${act.id}`,
        type: isUpload ? 'Upload' : (isDecision ? 'Decision' : 'Activity'),
        title: act.actionType,
        description: act.description,
        timestamp: act.createdAt || new Date().toISOString(),
        userName: act.userName || act.userEmail?.split('@')[0]
      });
    });

    // 4. Tasks: Completed or created tasks
    const pTasks = allProjectsTasks[proj.id] || (proj.id === activeProject.id ? tasks : []);
    pTasks.forEach(t => {
      if (t.status === 'completed') {
        actions.push({
          id: `task_comp_${t.id}`,
          type: 'Task',
          title: t.title,
          description: `Completed task: "${t.title}"`,
          timestamp: t.updatedAt || t.createdAt || new Date().toISOString(),
          userName: t.assigneeName || t.assigneeEmail.split('@')[0]
        });
      } else {
        actions.push({
          id: `task_create_${t.id}`,
          type: 'Task',
          title: t.title,
          description: `Assigned task: "${t.title}"`,
          timestamp: t.createdAt || new Date().toISOString(),
          userName: t.creatorEmail?.split('@')[0]
        });
      }
    });

    // Sort descending by timestamp
    actions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Deduplicate by type and normalized description
    const seen = new Set<string>();
    const deduplicated = actions.filter(a => {
      const key = `${a.type}:${a.description.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Return the last 3 actions
    return deduplicated.slice(0, 3);
  };

  // AI Smart Recap Trigger
  const handleTriggerProjectSmartRecap = async (specificRecord?: AudioToTextRecord) => {
    // Find recordings in this project that have transcript content
    const recordingsWithTranscript = activeRecordings.filter(r => 
      (Array.isArray(r.transcript) && r.transcript.length > 0) || 
      (typeof r.transcriptText === 'string' && r.transcriptText.trim().length > 0)
    );

    if (recordingsWithTranscript.length === 0 && !specificRecord) {
      toast.error("No meeting audio transcripts found in this project to synthesize.");
      return;
    }

    const targetRecord = specificRecord || recordingsWithTranscript[0];
    setSmartRecapRecord(targetRecord || null);
    setSmartRecapTitle(
      targetRecord 
        ? (targetRecord.fileName || targetRecord.id) 
        : `${activeProject.name} Meeting Intelligence`
    );

    // If already generated on this record, display immediately
    if (targetRecord?.smartRecap) {
      setSmartRecapData(targetRecord.smartRecap);
      setIsSmartRecapOpen(true);
      return;
    }

    setIsSmartRecapOpen(true);
    setIsGeneratingRecap(true);
    setSmartRecapData(null);

    try {
      let transcriptToSynthesize: any;
      if (targetRecord) {
        transcriptToSynthesize = (Array.isArray(targetRecord.transcript) && targetRecord.transcript.length > 0)
          ? targetRecord.transcript
          : (targetRecord.transcriptText || '');
      } else {
        transcriptToSynthesize = recordingsWithTranscript.map((r, i) => 
          `--- MEETING RECORDING ${i + 1}: ${r.fileName || 'Session'} (${r.date}) ---\n` +
          ((Array.isArray(r.transcript) && r.transcript.length > 0)
            ? r.transcript.map(s => `${s.speaker || 'Speaker'}: ${s.text}`).join('\n')
            : (r.transcriptText || ''))
        ).join('\n\n');
      }

      const knownMembers = allProjectMembers.map(m => ({
        name: m.displayName || m.email.split('@')[0],
        email: m.email,
        role: m.role
      }));

      const recap = await generateSmartRecap(
        targetRecord ? targetRecord.id : `project-${activeProject.id}`,
        transcriptToSynthesize,
        activeProject.id,
        knownMembers
      );

      setSmartRecapData(recap);

      if (targetRecord) {
        const updated = { ...targetRecord, smartRecap: recap };
        setSmartRecapRecord(updated);
        if (onUpdateAudio) {
          await onUpdateAudio(updated);
        }
      }

      toast.success("AI Smart Recap generated! Synthesized 3-bullet executive summary and tagged team members.");
      addNotification({
        title: 'AI Smart Recap Ready',
        message: `Generated 3-bullet executive summary and tagged team members for ${activeProject.name}.`,
        type: 'success'
      });
    } catch (err: any) {
      console.error("AI Smart Recap error:", err);
      toast.error(err.message || "Failed to generate AI Smart Recap.");
      addNotification({
        title: 'Smart Recap Failed',
        message: err.message || "Could not synthesize transcript.",
        type: 'error'
      });
    } finally {
      setIsGeneratingRecap(false);
    }
  };

  const handleRegenerateRecap = async () => {
    const targetRecord = smartRecapRecord || activeRecordings.find(r => 
      (Array.isArray(r.transcript) && r.transcript.length > 0) || 
      (typeof r.transcriptText === 'string' && r.transcriptText.trim().length > 0)
    );

    if (!targetRecord && activeRecordings.length === 0) return;
    setIsGeneratingRecap(true);

    try {
      const transcriptToSynthesize = targetRecord 
        ? ((Array.isArray(targetRecord.transcript) && targetRecord.transcript.length > 0)
            ? targetRecord.transcript
            : (targetRecord.transcriptText || ''))
        : activeRecordings.map(r => r.transcriptText || '').join('\n');

      const knownMembers = allProjectMembers.map(m => ({
        name: m.displayName || m.email.split('@')[0],
        email: m.email,
        role: m.role
      }));

      const recap = await generateSmartRecap(
        targetRecord ? targetRecord.id : `project-${activeProject.id}`,
        transcriptToSynthesize,
        activeProject.id,
        knownMembers
      );

      setSmartRecapData(recap);
      if (targetRecord) {
        const updated = { ...targetRecord, smartRecap: recap };
        setSmartRecapRecord(updated);
        if (onUpdateAudio) {
          await onUpdateAudio(updated);
        }
      }
      toast.success("AI Smart Recap refreshed!");
    } catch (err: any) {
      console.error("Regenerate Smart Recap error:", err);
      toast.error(err.message || "Failed to regenerate AI Smart Recap.");
    } finally {
      setIsGeneratingRecap(false);
    }
  };

  // Synthesize Activity Timeline events (Combine real Firestore logged actions + dynamic client ones)
  const getMergedTimeline = (): any[] => {
    const timeline: any[] = [...loggedActivities];

    // Add files uploads as events
    projectAudioRecords.forEach(rec => {
      timeline.push({
        id: `synth_upload_${rec.id}`,
        projectId: activeProject.id,
        actionType: 'upload_file',
        description: `${rec.ownerEmail === userProfile?.email ? 'You' : rec.ownerEmail?.split('@')[0] || 'Team member'} uploaded and transcribed "${rec.fileName || 'Audio'}"`,
        createdAt: rec.date || rec.createdAt || new Date().toISOString(),
        userName: rec.ownerEmail?.split('@')[0] || 'Member',
        userEmail: rec.ownerEmail
      });

      // Add bookmarks inside this recording
      if (rec.bookmarks && rec.bookmarks.length > 0) {
        rec.bookmarks.forEach((b, idx) => {
          timeline.push({
            id: `synth_bookmark_${rec.id}_${idx}`,
            projectId: activeProject.id,
            actionType: 'create_bookmark',
            description: `Bookmarked section in "${rec.fileName}": "${b.note || 'Highlighted note'}"`,
            createdAt: b.timestamp ? new Date(b.timestamp).toISOString() : rec.date || new Date().toISOString(),
            userName: rec.ownerEmail?.split('@')[0] || 'Member',
            userEmail: rec.ownerEmail
          });
        });
      }
    });

    // Add invitations accepted / pending as timeline events
    invites.forEach(inv => {
      timeline.push({
        id: `synth_invite_${inv.id}`,
        projectId: activeProject.id,
        actionType: 'invite_member',
        description: `Invitation sent to ${inv.email} as ${inv.role} (${inv.status})`,
        createdAt: inv.createdAt?.toDate ? inv.createdAt.toDate().toISOString() : inv.createdAt || new Date().toISOString(),
        userName: inv.invitedBy?.split('@')[0] || 'Owner',
        userEmail: inv.invitedBy
      });
    });

    // Add tasks as timeline events
    tasks.forEach(t => {
      timeline.push({
        id: `synth_task_${t.id}`,
        projectId: activeProject.id,
        actionType: t.status === 'completed' ? 'complete_task' : 'create_task',
        description: t.status === 'completed' 
          ? `Completed task "${t.title}" (Assigned to ${t.assigneeName || t.assigneeEmail.split('@')[0]})`
          : `Assigned task "${t.title}" to ${t.assigneeName || t.assigneeEmail.split('@')[0]}`,
        createdAt: t.updatedAt || t.createdAt,
        userName: t.creatorEmail?.split('@')[0] || 'Member',
        userEmail: t.creatorEmail
      });
    });

    // Remove duplicates based on description + date hour
    const seen = new Set<string>();
    const uniqueTimeline = timeline.filter(item => {
      const key = `${item.description}_${String(item.createdAt).substring(0, 13)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort descending by date
    return uniqueTimeline.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  };

  const finalTimeline = getMergedTimeline();

  // Task Handlers
  const handleToggleExpandTask = (taskId: string) => {
    setExpandedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !userProfile || !activeProject?.id) {
      toast.error("Please enter a task title.");
      return;
    }

    const assigneeEmail = taskAssigneeEmail.trim() || userProfile.email;
    const matchedMember = members.find(m => m.email.toLowerCase() === assigneeEmail.toLowerCase());
    const isOwnerSelected = activeProject.ownerEmail.toLowerCase() === assigneeEmail.toLowerCase();
    const assigneeName = matchedMember?.displayName || (isOwnerSelected ? (activeProject.ownerEmail === userProfile.email ? (userProfile.displayName || 'You') : activeProject.ownerEmail.split('@')[0]) : assigneeEmail.split('@')[0]);

    // Validate start date vs due date conflict
    if (taskStartDate && taskDueDate && new Date(taskStartDate).getTime() > new Date(taskDueDate).getTime()) {
      setTaskDateConflictError(`Start date (${taskStartDate}) cannot be after Due date (${taskDueDate}).`);
      toast.error(`Start date (${taskStartDate}) cannot be after Due date (${taskDueDate}).`);
      return;
    }
    setTaskDateConflictError(null);

    setIsSubmittingTask(true);
    try {
      const initialActivity: TaskActivity = {
        id: Math.random().toString(36).substring(2, 9),
        action: 'task_created',
        performedBy: userProfile.displayName || userProfile.email.split('@')[0],
        timestamp: new Date().toISOString(),
        details: `Task created and assigned to ${assigneeName}`
      };

      const newTaskData = {
        projectId: activeProject.id,
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        assigneeEmail,
        assigneeName,
        assigneeId: matchedMember?.uid || (assigneeEmail === userProfile.email ? userProfile.uid : ''),
        status: 'pending',
        priority: taskPriority,
        startDate: taskStartDate || '',
        dueDate: taskDueDate || '',
        subTasks: [],
        activityHistory: [initialActivity],
        createdBy: userProfile.uid,
        creatorEmail: userProfile.email,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (isDemoProject && demoContext) {
        demoContext.createTask({
          title: taskTitle.trim(),
          description: taskDescription.trim(),
          assigneeEmail,
          assigneeName,
          assigneeId: matchedMember?.uid || (assigneeEmail === userProfile.email ? userProfile.uid : ''),
          status: 'pending',
          priority: taskPriority,
          startDate: taskStartDate || '',
          dueDate: taskDueDate || ''
        });

        toast.success(`Task assigned to ${assigneeName}! (Demo Mode)`);
        setTaskTitle('');
        setTaskDescription('');
        setTaskAssigneeEmail('');
        setTaskStartDate('');
        setTaskDueDate('');
        setTaskDateConflictError(null);
        setTaskPriority('medium');
        setShowAddTask(false);
        setIsSubmittingTask(false);
        return;
      }

      const docRef = await addDoc(collection(db, 'tasks'), newTaskData);
      await logActivity('create_task', `Created task "${taskTitle.trim()}" assigned to ${assigneeName}`);
      
      // Automatic In-App Notification Trigger via existing notification system
      addNotification({
        title: 'Task Assigned',
        message: assigneeEmail.toLowerCase() === userProfile.email.toLowerCase()
          ? `You assigned yourself task "${taskTitle.trim()}" in project "${activeProject.name}".`
          : `Task "${taskTitle.trim()}" has been assigned to ${assigneeName} in project "${activeProject.name}".`,
        type: 'info'
      });

      // Record in-app notification document in Firestore for the assignee
      try {
        await addDoc(collection(db, 'notifications'), {
          userId: newTaskData.assigneeId || '',
          userEmail: assigneeEmail.toLowerCase(),
          title: 'Task Assigned',
          message: `${userProfile?.displayName || userProfile?.email?.split('@')[0] || 'Team member'} assigned you task "${taskTitle.trim()}" in ${activeProject.name}.`,
          projectId: activeProject.id,
          taskId: docRef.id,
          type: 'info',
          isRead: false,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.warn("Could not save persistent notification to Firestore:", err);
      }

      toast.success(`Task assigned to ${assigneeName}!`);
      setTaskTitle('');
      setTaskDescription('');
      setTaskAssigneeEmail('');
      setTaskStartDate('');
      setTaskDueDate('');
      setTaskDateConflictError(null);
      setTaskPriority('medium');
      setShowAddTask(false);
    } catch (error) {
      console.error("Failed to create task:", error);
      handleFirestoreError(error, OperationType.CREATE, 'tasks', false);
      toast.error("Failed to create task. Please check permissions.");
    } finally {
      setIsSubmittingTask(false);
    }
  };

  const handleReassignTask = async (taskId: string, newAssigneeEmail: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    if (task.assigneeEmail.toLowerCase() === newAssigneeEmail.toLowerCase()) return;

    const matchedMember = members.find(m => m.email.toLowerCase() === newAssigneeEmail.toLowerCase());
    const isOwnerSelected = activeProject.ownerEmail.toLowerCase() === newAssigneeEmail.toLowerCase();
    const isSelf = userProfile?.email?.toLowerCase() === newAssigneeEmail.toLowerCase();
    const newAssigneeName = isSelf 
      ? (userProfile?.displayName || 'You') 
      : (matchedMember?.displayName || (isOwnerSelected ? `${activeProject.ownerEmail.split('@')[0]} (Owner)` : newAssigneeEmail.split('@')[0]));

    const userName = userProfile?.displayName || userProfile?.email?.split('@')[0] || 'User';
    const newActivity: TaskActivity = {
      id: Math.random().toString(36).substring(2, 9),
      action: 'reassign_task',
      performedBy: userName,
      timestamp: new Date().toISOString(),
      details: `Reassigned from ${task.assigneeName || task.assigneeEmail.split('@')[0]} to ${newAssigneeName}`
    };

    const updatedHistory = [...(task.activityHistory || []), newActivity];

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        assigneeEmail: newAssigneeEmail,
        assigneeName: newAssigneeName,
        assigneeId: matchedMember?.uid || (isSelf ? userProfile.uid : ''),
        activityHistory: updatedHistory,
        updatedAt: new Date().toISOString()
      });

      // Automatic In-App Notification Trigger via existing notification system
      addNotification({
        title: 'Task Reassigned',
        message: isSelf
          ? `You reassigned task "${task.title}" to yourself in project "${activeProject.name}".`
          : `Task "${task.title}" was reassigned to ${newAssigneeName} in project "${activeProject.name}".`,
        type: 'info'
      });

      // Record persistent notification in Firestore for the new assignee
      try {
        await addDoc(collection(db, 'notifications'), {
          userId: matchedMember?.uid || (isSelf ? userProfile.uid : ''),
          userEmail: newAssigneeEmail.toLowerCase(),
          title: 'Task Assigned to You',
          message: `${userName} assigned you task "${task.title}" in project "${activeProject.name}".`,
          projectId: activeProject.id,
          taskId: task.id,
          type: 'info',
          isRead: false,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.warn("Could not save persistent notification to Firestore:", err);
      }

      await logActivity('update_task', `Reassigned task "${task.title}" to ${newAssigneeName}`);
      toast.success(`Task reassigned to ${newAssigneeName}!`);
    } catch (error) {
      console.error("Failed to reassign task:", error);
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, false);
      toast.error("Failed to reassign task.");
    }
  };

  const handleToggleTaskStatus = async (task: ProjectTask) => {
    const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
    const userName = userProfile?.displayName || userProfile?.email?.split('@')[0] || 'User';

    if (isDemoProject && demoContext) {
      demoContext.updateTaskStatus(task.id, nextStatus);
      toast.success(nextStatus === 'completed' ? 'Task marked as completed! (Demo)' : 'Task reopened! (Demo)');
      return;
    }

    const newActivity: TaskActivity = {
      id: Math.random().toString(36).substring(2, 9),
      action: nextStatus === 'completed' ? 'status_completed' : 'status_reopened',
      performedBy: userName,
      timestamp: new Date().toISOString(),
      details: nextStatus === 'completed' ? 'Marked task as completed' : 'Reopened task'
    };
    const updatedHistory = [...(task.activityHistory || []), newActivity];

    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        status: nextStatus,
        activityHistory: updatedHistory,
        updatedAt: new Date().toISOString()
      });
      await logActivity(nextStatus === 'completed' ? 'complete_task' : 'update_task', `${nextStatus === 'completed' ? 'Completed' : 'Reopened'} task "${task.title}"`);
      toast.success(nextStatus === 'completed' ? 'Task marked as completed!' : 'Task reopened!');
    } catch (error) {
      console.error("Failed to update task status:", error);
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}`, false);
      toast.error("Failed to update task status.");
    }
  };

  const handleUpdateTaskStatusSelect = async (taskId: string, newStatus: 'pending' | 'in_progress' | 'completed') => {
    const task = tasks.find(item => item.id === taskId);
    const userName = userProfile?.displayName || userProfile?.email?.split('@')[0] || 'User';

    if (isDemoProject && demoContext) {
      demoContext.updateTaskStatus(taskId, newStatus);
      toast.success(`Status updated to ${newStatus.replace('_', ' ')} (Demo)`);
      return;
    }

    const newActivity: TaskActivity = {
      id: Math.random().toString(36).substring(2, 9),
      action: `status_${newStatus}`,
      performedBy: userName,
      timestamp: new Date().toISOString(),
      details: `Updated status to ${newStatus.replace('_', ' ')}`
    };
    const updatedHistory = [...(task?.activityHistory || []), newActivity];

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        status: newStatus,
        activityHistory: updatedHistory,
        updatedAt: new Date().toISOString()
      });
      await logActivity(newStatus === 'completed' ? 'complete_task' : 'update_task', `Set task "${task?.title || 'task'}" status to ${newStatus.replace('_', ' ')}`);
      toast.success(`Status updated to ${newStatus.replace('_', ' ')}`);
    } catch (error) {
      console.error("Failed to update status:", error);
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, false);
      toast.error("Failed to update status.");
    }
  };

  // Deadline Propagation Handlers (AH.181)
  const handleOpenDeadlinePropagationPreview = async (
    task: ProjectTask,
    proposedDates: { startDate?: string; dueDate?: string }
  ) => {
    if (!activeProject?.id) {
      toast.error("Active project not found.");
      return;
    }

    setPropagationTargetTask(task);
    setPropagationProposedDates(proposedDates);
    setPropagationPreview(null);
    setPropagationError(null);
    setIsLoadingPropagationPreview(true);
    setPropagationModalOpen(true);

    try {
      const resp = await previewDeadlinePropagation(activeProject.id, task.id, {
        newStartDate: proposedDates.startDate !== undefined ? proposedDates.startDate : undefined,
        newDueDate: proposedDates.dueDate !== undefined ? proposedDates.dueDate : undefined
      });

      if (resp.success && resp.preview) {
        setPropagationPreview(resp.preview as any);
      } else {
        const errMsg = resp.error || resp.message || "Failed to load deadline propagation preview.";
        setPropagationError(errMsg);
      }
    } catch (err: any) {
      console.error("[Propagation Preview Error]:", err);
      setPropagationError(err?.message || "Failed to connect to deadline propagation service.");
    } finally {
      setIsLoadingPropagationPreview(false);
    }
  };

  const handleRefreshPropagationPreview = async () => {
    if (!propagationTargetTask || !activeProject?.id) return;
    setIsLoadingPropagationPreview(true);
    setPropagationError(null);
    try {
      const resp = await previewDeadlinePropagation(activeProject.id, propagationTargetTask.id, {
        newStartDate: propagationProposedDates.startDate !== undefined ? propagationProposedDates.startDate : undefined,
        newDueDate: propagationProposedDates.dueDate !== undefined ? propagationProposedDates.dueDate : undefined
      });
      if (resp.success && resp.preview) {
        setPropagationPreview(resp.preview as any);
      } else {
        setPropagationError(resp.error || resp.message || "Failed to refresh preview.");
      }
    } catch (err: any) {
      setPropagationError(err?.message || "Failed to refresh preview.");
    } finally {
      setIsLoadingPropagationPreview(false);
    }
  };

  const handleConfirmDeadlinePropagation = async () => {
    if (!propagationTargetTask || !activeProject?.id || !propagationPreview) {
      return;
    }

    if (!propagationPreview.scheduleVersionToken) {
      toast.error("Missing schedule version token. Please refresh preview.");
      return;
    }

    setIsExecutingPropagation(true);
    setPropagationError(null);

    try {
      const resp = await executeDeadlinePropagation(activeProject.id, propagationTargetTask.id, {
        newStartDate: propagationProposedDates.startDate !== undefined ? propagationProposedDates.startDate : undefined,
        newDueDate: propagationProposedDates.dueDate !== undefined ? propagationProposedDates.dueDate : undefined,
        scheduleVersionToken: propagationPreview.scheduleVersionToken
      });

      if (resp.success) {
        toast.success(resp.message || `Successfully propagated deadlines to ${resp.updatedTaskCount} task(s)!`);
        setPropagationModalOpen(false);
        setEditingDueDateTaskId(null);
        setEditingStartDateTaskId(null);
        await logActivity(
          'propagation_executed',
          `Propagated deadlines from "${propagationTargetTask.title}": updated ${resp.updatedTaskCount} dependent tasks.`
        );
      } else {
        setPropagationError(resp.error || resp.message || "Failed to execute propagation.");
        toast.error(resp.error || "Failed to execute propagation.");
      }
    } catch (err: any) {
      console.error("[Propagation Execution Error]:", err);
      const isStale = err?.status === 409 || err?.code === 'STALE_VERSION';
      const msg = isStale
        ? "The task schedule was modified by another operation. Please refresh the preview and review the latest changes."
        : (err?.message || "Failed to execute deadline propagation.");
      setPropagationError(msg);
      toast.error(msg);
    } finally {
      setIsExecutingPropagation(false);
    }
  };

  const handleUpdateStartDate = async (taskId: string, newStartDate: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Validate conflict against existing due date
    if (newStartDate && task.dueDate && new Date(newStartDate).getTime() > new Date(task.dueDate).getTime()) {
      toast.error(`Start date (${newStartDate}) cannot be after Due date (${task.dueDate.substring(0, 10)}).`);
      return;
    }

    // If task has downstream dependents and date changed, offer propagation preview flow
    const hasDownstream = Array.isArray(task.dependentTaskIds) && task.dependentTaskIds.length > 0;
    const dateChanged = (task.startDate || '') !== (newStartDate || '');
    if (hasDownstream && dateChanged && !isDemoProject) {
      handleOpenDeadlinePropagationPreview(task, { startDate: newStartDate || undefined });
      return;
    }

    const userName = userProfile?.displayName || userProfile?.email?.split('@')[0] || 'User';
    const newActivity: TaskActivity = {
      id: Math.random().toString(36).substring(2, 9),
      action: newStartDate ? 'start_date_set' : 'start_date_cleared',
      performedBy: userName,
      timestamp: new Date().toISOString(),
      details: newStartDate ? `Changed start date to ${newStartDate}` : 'Removed start date'
    };
    const updatedHistory = [...(task.activityHistory || []), newActivity];

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        startDate: newStartDate || '',
        activityHistory: updatedHistory,
        updatedAt: new Date().toISOString()
      });
      await logActivity('update_task', `${newStartDate ? `Set start date to ${newStartDate}` : 'Cleared start date'} for task "${task.title}"`);
      toast.success(newStartDate ? `Start date set to ${newStartDate}` : 'Start date cleared');
      setEditingStartDateTaskId(null);
    } catch (error) {
      console.error("Failed to update start date:", error);
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, false);
      toast.error("Failed to update start date.");
    }
  };

  const handleUpdateDueDate = async (taskId: string, newDueDate: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Validate conflict against existing start date
    if (newDueDate && task.startDate && new Date(newDueDate).getTime() < new Date(task.startDate).getTime()) {
      toast.error(`Due date (${newDueDate}) cannot be before Start date (${task.startDate.substring(0, 10)}).`);
      return;
    }

    // If task has downstream dependents and date changed, offer propagation preview flow
    const hasDownstream = Array.isArray(task.dependentTaskIds) && task.dependentTaskIds.length > 0;
    const dateChanged = (task.dueDate || '') !== (newDueDate || '');
    if (hasDownstream && dateChanged && !isDemoProject) {
      handleOpenDeadlinePropagationPreview(task, { dueDate: newDueDate || undefined });
      return;
    }

    const userName = userProfile?.displayName || userProfile?.email?.split('@')[0] || 'User';
    const newActivity: TaskActivity = {
      id: Math.random().toString(36).substring(2, 9),
      action: newDueDate ? 'due_date_set' : 'due_date_cleared',
      performedBy: userName,
      timestamp: new Date().toISOString(),
      details: newDueDate ? `Changed due date to ${newDueDate}` : 'Removed due date'
    };
    const updatedHistory = [...(task.activityHistory || []), newActivity];

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        dueDate: newDueDate || '',
        activityHistory: updatedHistory,
        updatedAt: new Date().toISOString()
      });
      await logActivity('update_task', `${newDueDate ? `Set due date to ${newDueDate}` : 'Cleared due date'} for task "${task.title}"`);
      toast.success(newDueDate ? `Due date set to ${newDueDate}` : 'Due date cleared');
      setEditingDueDateTaskId(null);
    } catch (error) {
      console.error("Failed to update due date:", error);
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, false);
      toast.error("Failed to update due date.");
    }
  };

  const handleUpdateDescription = async (taskId: string, newDescription: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const userName = userProfile?.displayName || userProfile?.email?.split('@')[0] || 'User';
    const newActivity: TaskActivity = {
      id: Math.random().toString(36).substring(2, 9),
      action: 'description_updated',
      performedBy: userName,
      timestamp: new Date().toISOString(),
      details: 'Updated task description'
    };
    const updatedHistory = [...(task.activityHistory || []), newActivity];

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        description: newDescription.trim(),
        activityHistory: updatedHistory,
        updatedAt: new Date().toISOString()
      });
      toast.success("Task description updated");
      setEditingDescriptionTaskId(null);
    } catch (error) {
      console.error("Failed to update description:", error);
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, false);
      toast.error("Failed to update description.");
    }
  };

  const handleAddSubTask = async (taskId: string) => {
    const title = (newSubTaskTitles[taskId] || '').trim();
    if (!title) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newSubTask: SubTask = {
      id: Math.random().toString(36).substring(2, 9),
      title,
      completed: false
    };
    const updatedSubTasks = [...(task.subTasks || []), newSubTask];
    const userName = userProfile?.displayName || userProfile?.email?.split('@')[0] || 'User';
    const newActivity: TaskActivity = {
      id: Math.random().toString(36).substring(2, 9),
      action: 'subtask_created',
      performedBy: userName,
      timestamp: new Date().toISOString(),
      details: `Added sub-task "${title}"`
    };
    const updatedHistory = [...(task.activityHistory || []), newActivity];

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        subTasks: updatedSubTasks,
        activityHistory: updatedHistory,
        updatedAt: new Date().toISOString()
      });
      setNewSubTaskTitles(prev => ({ ...prev, [taskId]: '' }));
      toast.success("Sub-task added");
    } catch (error) {
      console.error("Failed to add sub-task:", error);
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, false);
      toast.error("Failed to add sub-task.");
    }
  };

  const handleToggleSubTask = async (taskId: string, subTaskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subTasks) return;

    let toggledTitle = '';
    let willComplete = false;
    const updatedSubTasks = task.subTasks.map(st => {
      if (st.id === subTaskId) {
        toggledTitle = st.title;
        willComplete = !st.completed;
        return { ...st, completed: !st.completed };
      }
      return st;
    });

    const userName = userProfile?.displayName || userProfile?.email?.split('@')[0] || 'User';
    const newActivity: TaskActivity = {
      id: Math.random().toString(36).substring(2, 9),
      action: willComplete ? 'subtask_completed' : 'subtask_reopened',
      performedBy: userName,
      timestamp: new Date().toISOString(),
      details: `${willComplete ? 'Completed' : 'Reopened'} sub-task "${toggledTitle}"`
    };
    const updatedHistory = [...(task.activityHistory || []), newActivity];

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        subTasks: updatedSubTasks,
        activityHistory: updatedHistory,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Failed to toggle sub-task:", error);
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, false);
    }
  };

  const handleDeleteSubTask = async (taskId: string, subTaskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || !task.subTasks) return;

    const targetSubTask = task.subTasks.find(st => st.id === subTaskId);
    const updatedSubTasks = task.subTasks.filter(st => st.id !== subTaskId);
    const userName = userProfile?.displayName || userProfile?.email?.split('@')[0] || 'User';
    const newActivity: TaskActivity = {
      id: Math.random().toString(36).substring(2, 9),
      action: 'subtask_deleted',
      performedBy: userName,
      timestamp: new Date().toISOString(),
      details: `Deleted sub-task "${targetSubTask?.title || 'subtask'}"`
    };
    const updatedHistory = [...(task.activityHistory || []), newActivity];

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        subTasks: updatedSubTasks,
        activityHistory: updatedHistory,
        updatedAt: new Date().toISOString()
      });
      toast.success("Sub-task removed");
    } catch (error) {
      console.error("Failed to delete sub-task:", error);
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`, false);
    }
  };

  const handleDeleteTask = async (taskId: string, title: string) => {
    // Demo Mode safety check
    if (isDemoProject || isDemoIdentifier(taskId)) {
      toast.info("Task deletion is disabled in Demo Mode to preserve sample workflows.");
      return;
    }

    // Client-side quick check: warn if tasks depend on this
    const task = tasks.find(t => t.id === taskId);
    if (task && task.dependentTaskIds && task.dependentTaskIds.length > 0) {
      const dependentTitles = task.dependentTaskIds
        .map(depId => tasks.find(t => t.id === depId)?.title || depId)
        .map(t => `"${t}"`)
        .join(', ');
      toast.error(`Cannot delete "${title}": It is required as a prerequisite by ${task.dependentTaskIds.length} task(s) (${dependentTitles}). Remove the prerequisite first.`);
      return;
    }

    if (!window.confirm(`Delete task "${title}"?`)) return;

    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Failed to delete task.");
      }

      await logActivity('delete_task', `Deleted task "${title}"`);
      toast.success("Task deleted.");
    } catch (error: any) {
      console.error("Failed to delete task:", error);
      toast.error(error.message || "Failed to delete task.");
    }
  };

  const handleAddPrerequisite = async (taskId: string, prereqTaskId: string) => {
    if (isDemoProject || isDemoIdentifier(taskId)) {
      toast.info("Prerequisites modifications are disabled in Demo Mode.");
      return;
    }

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const existingPrereqs = task.prerequisiteTaskIds || [];
    if (existingPrereqs.includes(prereqTaskId)) {
      toast.info("This prerequisite is already added.");
      return;
    }
    if (prereqTaskId === taskId) {
      toast.error("A task cannot depend on itself.");
      return;
    }

    const updatedPrereqs = [...existingPrereqs, prereqTaskId];
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ prerequisiteTaskIds: updatedPrereqs })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to add prerequisite.");
      }

      const prereqTask = tasks.find(t => t.id === prereqTaskId);
      await logActivity('update_task', `Added prerequisite "${prereqTask?.title || prereqTaskId}" to task "${task.title}"`);
      toast.success(`Prerequisite "${prereqTask?.title || 'task'}" added!`);
    } catch (err: any) {
      console.error("Failed to add prerequisite:", err);
      toast.error(err.message || "Failed to add prerequisite.");
    }
  };

  const handleRemovePrerequisite = async (taskId: string, prereqTaskId: string) => {
    if (isDemoProject || isDemoIdentifier(taskId)) {
      toast.info("Prerequisites modifications are disabled in Demo Mode.");
      return;
    }

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const prereqTask = tasks.find(t => t.id === prereqTaskId);
    const prereqName = prereqTask?.title || 'this prerequisite';
    if (!window.confirm(`Remove "${prereqName}" as a prerequisite of "${task.title}"?`)) return;

    const updatedPrereqs = (task.prerequisiteTaskIds || []).filter(pid => pid !== prereqTaskId);
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ prerequisiteTaskIds: updatedPrereqs })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to remove prerequisite.");
      }

      await logActivity('update_task', `Removed prerequisite "${prereqName}" from task "${task.title}"`);
      toast.success("Prerequisite removed.");
    } catch (err: any) {
      console.error("Failed to remove prerequisite:", err);
      toast.error(err.message || "Failed to remove prerequisite.");
    }
  };

  // Task Template API operations (Step 3.4)
  const fetchTaskTemplates = async () => {
    if (!activeProject?.id || activeProject.id === 'general') return;
    setLoadingTemplates(true);
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${activeProject.id}/task-templates`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.templates)) {
        setTaskTemplates(data.templates);
      } else {
        toast.error(data.message || "Failed to load task templates.");
      }
    } catch (err: any) {
      console.error("Failed to fetch templates:", err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleApplyTemplate = async (templateId: string) => {
    if (!activeProject?.id) return;
    setIsApplyingTemplate(true);
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${activeProject.id}/task-templates/${templateId}/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          anchorDate: applyAnchorDate,
          assigneeEmail: applyAssigneeEmail || undefined
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to apply template.");
      }

      toast.success(`Success! Created ${data.createdTasksCount} tasks from template "${data.templateName}".`);
      setShowTemplatesModal(false);
      setSelectedTemplateForPreview(null);
    } catch (err: any) {
      console.error("Failed to apply template:", err);
      toast.error(err.message || "Failed to apply task template.");
    } finally {
      setIsApplyingTemplate(false);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) {
      toast.error("Template name is required.");
      return;
    }

    if (newTemplateTasks.length === 0 || !newTemplateTasks.some(t => t.title.trim())) {
      toast.error("Template must contain at least one task definition with a title.");
      return;
    }

    setIsCreatingTemplate(true);
    try {
      const token = await userProfile?.getIdToken?.();
      const validTasks = newTemplateTasks
        .filter(t => t.title.trim())
        .map((t, idx) => ({
          ...t,
          id: t.id || `task_${idx + 1}`,
          title: t.title.trim(),
          description: t.description?.trim() || ''
        }));

      const res = await fetch(`/api/projects/${activeProject.id}/task-templates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          name: newTemplateName.trim(),
          description: newTemplateDescription.trim(),
          scope: newTemplateScope,
          tasks: validTasks
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to create template.");
      }

      toast.success(`Template "${newTemplateName.trim()}" created!`);
      setShowCreateTemplateModal(false);
      setNewTemplateName('');
      setNewTemplateDescription('');
      setNewTemplateTasks([{ id: 'task_1', title: '', priority: 'medium', startOffsetDays: 0, dueOffsetDays: 3, prerequisiteTemplateItemIds: [] }]);
      fetchTaskTemplates();
    } catch (err: any) {
      console.error("Failed to create template:", err);
      toast.error(err.message || "Failed to create template.");
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  // Task Exception API Operations (Step 3.5)
  const fetchExceptions = async () => {
    if (!activeProject?.id) return;
    setLoadingExceptions(true);
    if (isDemoProject) {
      if (demoContext) {
        setExceptions(demoContext.demoExceptions);
      }
      setLoadingExceptions(false);
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${activeProject.id}/exceptions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.exceptions)) {
        setExceptions(data.exceptions);
        if (data.metrics) {
          setExceptionMetrics(data.metrics);
        }
      }
    } catch (err) {
      console.error("Failed to fetch task exceptions:", err);
    } finally {
      setLoadingExceptions(false);
    }
  };

  useEffect(() => {
    if (activeProject?.id) {
      fetchExceptions();
    }
  }, [activeProject?.id]);

  const handleOpenRaiseModal = (task: ProjectTask, prefillType?: TaskExceptionType) => {
    setRaisingForTask(task);
    setNewExceptionType(prefillType || (task.dependencyStatus === 'blocked' ? 'dependency_issue' : task.dueDate && new Date(task.dueDate).getTime() < Date.now() ? 'overdue' : 'blocked'));
    setNewExceptionSeverity('high');
    setNewExceptionTitle(`${prefillType === 'overdue' ? 'Overdue Deadline' : prefillType === 'dependency_issue' ? 'Prerequisite Blocker' : 'Task Progress Obstacle'}: ${task.title}`);
    setNewExceptionDesc(
      task.dependencyStatus === 'blocked' && task.blockingPrerequisites?.length
        ? `Task is blocked by incomplete prerequisite(s): ${task.blockingPrerequisites.map(p => p.title).join(', ')}`
        : task.dueDate && new Date(task.dueDate).getTime() < Date.now()
        ? `Task due date was ${task.dueDate} and remains uncompleted.`
        : ''
    );
    setNewExceptionAssignee(task.assigneeEmail || '');
    setIsRaisingException(true);
  };

  const handleCreateException = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!raisingForTask || !activeProject?.id) return;
    if (!newExceptionTitle.trim()) {
      toast.error("Exception title is required.");
      return;
    }

    if (isDemoProject) {
      toast.info("Raising new exceptions is disabled in Demo Mode.");
      setIsRaisingException(false);
      setRaisingForTask(null);
      return;
    }

    setIsSubmittingException(true);
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${activeProject.id}/tasks/${raisingForTask.id}/exceptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          type: newExceptionType,
          title: newExceptionTitle.trim(),
          description: newExceptionDesc.trim(),
          severity: newExceptionSeverity,
          assignedToEmail: newExceptionAssignee ? newExceptionAssignee.trim() : undefined
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to create task exception.");
      }

      toast.success(`Exception "${newExceptionTitle.trim()}" reported!`);
      setIsRaisingException(false);
      setRaisingForTask(null);
      fetchExceptions();
    } catch (err: any) {
      console.error("Failed to create exception:", err);
      toast.error(err.message || "Failed to report task exception.");
    } finally {
      setIsSubmittingException(false);
    }
  };

  const handleUpdateExceptionStatus = async (exceptionId: string, newStatus: TaskExceptionStatus, notes?: string) => {
    if (isDemoProject || isDemoIdentifier(exceptionId)) {
      toast.info("Updating exception status is disabled in Demo Mode.");
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/exceptions/${exceptionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ status: newStatus, notes })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to update exception.");
      }

      toast.success(`Exception status updated to ${newStatus}.`);
      fetchExceptions();
      if (selectedExceptionDetail?.id === exceptionId) {
        setSelectedExceptionDetail(data.exception || null);
      }
    } catch (err: any) {
      console.error("Failed to update exception:", err);
      toast.error(err.message || "Failed to update status.");
    }
  };

  const handleResolveException = async (exceptionId: string) => {
    if (!resolutionSummaryText.trim()) {
      toast.error("Please provide a summary of how this exception was resolved.");
      return;
    }

    if (isDemoProject && demoContext) {
      demoContext.resolveException(exceptionId, resolutionSummaryText.trim());
      toast.success("Exception successfully resolved! (Demo)");
      setResolvingExceptionId(null);
      setResolutionSummaryText('');
      if (selectedExceptionDetail?.id === exceptionId) {
        setSelectedExceptionDetail(prev => prev ? { ...prev, status: 'resolved', resolutionSummary: resolutionSummaryText.trim() } : null);
      }
      return;
    }

    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/exceptions/${exceptionId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ resolutionSummary: resolutionSummaryText.trim() })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to resolve exception.");
      }

      toast.success("Exception successfully resolved!");
      setResolvingExceptionId(null);
      setResolutionSummaryText('');
      fetchExceptions();
      if (selectedExceptionDetail?.id === exceptionId) {
        setSelectedExceptionDetail(data.exception || null);
      }
    } catch (err: any) {
      console.error("Failed to resolve exception:", err);
      toast.error(err.message || "Failed to resolve exception.");
    }
  };

  const handleDismissException = async (exceptionId: string) => {
    if (!dismissalReasonText.trim()) {
      toast.error("Please provide a reason for dismissing this exception.");
      return;
    }

    if (isDemoProject || isDemoIdentifier(exceptionId)) {
      toast.info("Dismissing exceptions is disabled in Demo Mode.");
      setDismissingExceptionId(null);
      setDismissalReasonText('');
      return;
    }

    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/exceptions/${exceptionId}/dismiss`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ dismissalReason: dismissalReasonText.trim() })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to dismiss exception.");
      }

      toast.success("Exception dismissed.");
      setDismissingExceptionId(null);
      setDismissalReasonText('');
      fetchExceptions();
      if (selectedExceptionDetail?.id === exceptionId) {
        setSelectedExceptionDetail(data.exception || null);
      }
    } catch (err: any) {
      console.error("Failed to dismiss exception:", err);
      toast.error(err.message || "Failed to dismiss exception.");
    }
  };

  const handleReopenException = async (exceptionId: string, reason?: string) => {
    if (isDemoProject || isDemoIdentifier(exceptionId)) {
      toast.info("Reopening exceptions is disabled in Demo Mode.");
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/exceptions/${exceptionId}/reopen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ reason: reason || 'Reopened by user' })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to reopen exception.");
      }

      toast.success("Exception reopened!");
      fetchExceptions();
      if (selectedExceptionDetail?.id === exceptionId) {
        setSelectedExceptionDetail(data.exception || null);
      }
    } catch (err: any) {
      console.error("Failed to reopen exception:", err);
      toast.error(err.message || "Failed to reopen exception.");
    }
  };

  // Follow-Up Meetings Handlers (Step 3.6)
  const fetchFollowUps = async () => {
    if (!activeProject?.id || activeProject.id === 'general') return;
    setLoadingFollowUps(true);
    if (isDemoProject) {
      if (demoContext) {
        setFollowUps(demoContext.demoFollowUps);
      }
      setLoadingFollowUps(false);
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${activeProject.id}/follow-ups`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.followUps)) {
        setFollowUps(data.followUps);
      }
    } catch (err) {
      console.error("Failed to fetch follow-ups:", err);
    } finally {
      setLoadingFollowUps(false);
    }
  };

  const fetchFollowUpRecommendations = async () => {
    if (!activeProject?.id || activeProject.id === 'general') return;
    setLoadingFollowUpRecs(true);
    if (isDemoProject) {
      setFollowUpRecommendations([]);
      setLoadingFollowUpRecs(false);
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${activeProject.id}/follow-ups/recommendations`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.recommendations)) {
        setFollowUpRecommendations(data.recommendations);
      }
    } catch (err) {
      console.error("Failed to fetch follow-up recommendations:", err);
    } finally {
      setLoadingFollowUpRecs(false);
    }
  };

  useEffect(() => {
    if (activeProjectTab === 'followups') {
      fetchFollowUps();
      fetchFollowUpRecommendations();
    }
  }, [activeProjectTab, activeProject?.id]);

  const handleOpenScheduleFollowUpModal = (taskId?: string, exceptionId?: string, defaultTitle?: string) => {
    setScheduleFollowUpTaskId(taskId || null);
    setScheduleFollowUpExceptionId(exceptionId || null);
    
    // Auto-generate starting defaults
    let taskObj = taskId ? tasks.find(t => t.id === taskId) : null;
    let exObj = exceptionId ? exceptions.find(e => e.id === exceptionId) : null;
    
    const title = defaultTitle || (exObj ? `Follow-up: Exception in ${exObj.taskTitle || 'Task'}` : (taskObj ? `Follow-up: ${taskObj.title}` : `Project Follow-up: ${activeProject.name}`));
    setFollowUpFormTitle(title);
    setFollowUpFormPurpose(exObj ? `Resolve obstacle: ${exObj.title}` : (taskObj ? `Discuss execution for ${taskObj.title}` : 'Review project objectives'));
    
    // Build initial proposed times: tomorrow 10:00 - 10:30
    const now = new Date();
    now.setDate(now.getDate() + 1);
    now.setHours(10, 0, 0, 0);
    const startIso = now.toISOString().slice(0, 16);
    now.setMinutes(now.getMinutes() + 30);
    const endIso = now.toISOString().slice(0, 16);
    setFollowUpFormStartTime(startIso);
    setFollowUpFormEndTime(endIso);
    
    // Select participants: current user + task assignee or exception assignee if available
    const initialParticipants = new Set<string>();
    if (userProfile?.email) initialParticipants.add(userProfile.email.toLowerCase());
    if (taskObj?.assigneeEmail) initialParticipants.add(taskObj.assigneeEmail.toLowerCase());
    if (exObj?.assignedToEmail) initialParticipants.add(exObj.assignedToEmail.toLowerCase());
    setFollowUpFormParticipants(Array.from(initialParticipants));
    setFollowUpFormAllowDuplicate(false);
    setFollowUpFormAgenda('');
    
    setIsSchedulingFollowUpModal(true);
  };

  const handleCreateFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProject?.id) return;
    if (isDemoProject) {
      toast.info("Scheduling follow-ups is disabled in Demo Mode.");
      setIsSchedulingFollowUpModal(false);
      return;
    }
    setIsSubmittingFollowUp(true);
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${activeProject.id}/follow-ups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          title: followUpFormTitle.trim() || undefined,
          purpose: followUpFormPurpose.trim() || undefined,
          agenda: followUpFormAgenda.trim() || undefined,
          proposedStartTime: followUpFormStartTime ? new Date(followUpFormStartTime).toISOString() : undefined,
          proposedEndTime: followUpFormEndTime ? new Date(followUpFormEndTime).toISOString() : undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          participantEmails: followUpFormParticipants,
          taskIds: scheduleFollowUpTaskId ? [scheduleFollowUpTaskId] : [],
          exceptionIds: scheduleFollowUpExceptionId ? [scheduleFollowUpExceptionId] : [],
          allowDuplicate: followUpFormAllowDuplicate
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          toast.error("An active follow-up already exists for this task/exception. Check 'Allow duplicate follow-up' to schedule another.");
          setFollowUpFormAllowDuplicate(true);
          return;
        }
        throw new Error(data.message || data.error || "Failed to create follow-up");
      }

      toast.success("Follow-up meeting draft created!");
      setIsSchedulingFollowUpModal(false);
      fetchFollowUps();
      fetchFollowUpRecommendations();
    } catch (err: any) {
      console.error("Failed to create follow-up:", err);
      toast.error(err.message || "Failed to create follow-up");
    } finally {
      setIsSubmittingFollowUp(false);
    }
  };

  const handleConfirmFollowUp = async (meetingId: string) => {
    if (isDemoProject && demoContext) {
      demoContext.confirmFollowUp(meetingId);
      toast.success("Follow-up confirmed! (Demo)");
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/follow-ups/${meetingId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ userConfirmed: true })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to confirm follow-up");
      }

      toast.success(data.message || "Follow-up confirmed!");
      if (data.providerStatus === 'disconnected') {
        toast.info("External calendar integration is not connected. Meeting is confirmed internally in EchoNote.");
      }
      fetchFollowUps();
    } catch (err: any) {
      console.error("Failed to confirm follow-up:", err);
      toast.error(err.message || "Failed to confirm follow-up");
    }
  };

  const handleRescheduleFollowUp = async (meetingId: string) => {
    if (isDemoProject || isDemoIdentifier(meetingId)) {
      toast.info("Rescheduling is disabled in Demo Mode.");
      setReschedulingMeetingId(null);
      return;
    }
    if (!rescheduleStartTime) {
      toast.error("Please provide a new proposed start time");
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/follow-ups/${meetingId}/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          newProposedStartTime: new Date(rescheduleStartTime).toISOString(),
          newProposedEndTime: rescheduleEndTime ? new Date(rescheduleEndTime).toISOString() : undefined,
          reason: rescheduleReason.trim() || undefined
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to reschedule follow-up");
      }

      toast.success("Follow-up rescheduled!");
      setReschedulingMeetingId(null);
      setRescheduleStartTime('');
      setRescheduleEndTime('');
      setRescheduleReason('');
      fetchFollowUps();
    } catch (err: any) {
      console.error("Failed to reschedule follow-up:", err);
      toast.error(err.message || "Failed to reschedule follow-up");
    }
  };

  const handleCancelFollowUp = async (meetingId: string) => {
    if (isDemoProject || isDemoIdentifier(meetingId)) {
      toast.info("Cancelling follow-ups is disabled in Demo Mode.");
      setCancellingMeetingId(null);
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/follow-ups/${meetingId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          reason: cancelReasonText.trim() || undefined
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to cancel follow-up");
      }

      toast.success("Follow-up cancelled.");
      setCancellingMeetingId(null);
      setCancelReasonText('');
      fetchFollowUps();
    } catch (err: any) {
      console.error("Failed to cancel follow-up:", err);
      toast.error(err.message || "Failed to cancel follow-up");
    }
  };

  const handleCompleteFollowUp = async (meetingId: string) => {
    if (isDemoProject || isDemoIdentifier(meetingId)) {
      toast.info("Completing follow-ups is disabled in Demo Mode.");
      setCompletingMeetingId(null);
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/follow-ups/${meetingId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          outcomeNotes: completionNotesText.trim() || undefined
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to mark follow-up complete");
      }

      toast.success("Follow-up marked completed!");
      setCompletingMeetingId(null);
      setCompletionNotesText('');
      fetchFollowUps();
    } catch (err: any) {
      console.error("Failed to mark follow-up complete:", err);
      toast.error(err.message || "Failed to mark follow-up complete");
    }
  };

  // Dependency & Deadline Tracking Handlers (Step 3.7)
  const fetchTrackingInsights = async () => {
    if (!activeProject?.id || activeProject.id === 'general') return;
    setLoadingTracking(true);
    if (isDemoProject) {
      if (demoContext) {
        setTrackingMetrics(demoContext.demoTrackingMetrics);
        setTrackingRisks(demoContext.demoTrackingRisks);
      }
      setLoadingTracking(false);
      return;
    }
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${activeProject.id}/tracking/insights`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.metrics) {
        setTrackingMetrics(data.metrics);
        setTrackingRisks(data.risks || []);
      }
    } catch (err) {
      console.error("Failed to fetch tracking insights:", err);
    } finally {
      setLoadingTracking(false);
    }
  };

  const handleQueueTrackingJob = async () => {
    if (!activeProject?.id || activeProject.id === 'general') return;
    if (isDemoProject) {
      toast.info("Tracking analysis is precomputed in Demo Mode.");
      return;
    }
    setIsQueueingJob(true);
    try {
      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${activeProject.id}/tracking/queue-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to enqueue monitoring job");
      }

      if (data.isExisting) {
        toast.info("A background monitoring job is already active for this project.");
      } else {
        toast.success("Background monitoring job queued successfully!");
      }
      fetchTrackingInsights();
    } catch (err: any) {
      console.error("Failed to queue tracking job:", err);
      toast.error(err.message || "Failed to queue tracking job");
    } finally {
      setIsQueueingJob(false);
    }
  };

  useEffect(() => {
    if (activeProjectTab === 'tracking') {
      fetchTrackingInsights();
    }
  }, [activeProjectTab, activeProject?.id]);

  // Invite action
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    if (userRole !== 'owner') {
      toast.error("Only Project Owners can invite new team members.");
      return;
    }

    setIsInviting(true);
    try {
      const inviteRes = await onInviteToProject(activeProject.name, inviteEmail.trim(), inviteRole);
      
      // Log invitation activity
      await logActivity('invite_member', `Sent team invitation to ${inviteEmail.trim()} as ${inviteRole}`);
      
      if (inviteRes && inviteRes.emailSent === false) {
        const failureReason = inviteRes.emailError || inviteRes.warning || "email delivery failed";
        toast.warning(`Invitation created for ${inviteEmail.trim()}, but email delivery failed: ${failureReason}. You can copy and share the invitation link.`);
      } else {
        toast.success(`Invitation successfully sent to ${inviteEmail}!`);
      }
      setInviteEmail('');
    } catch (err: any) {
      toast.error(err.message || "Failed to send invitation.");
    } finally {
      setIsInviting(false);
    }
  };

  // Revoke invite action
  const handleRevokeInvite = async (inviteId: string, email: string) => {
    if (userRole !== 'owner') {
      toast.error("Only Project Owners can revoke invitations.");
      return;
    }

    if (!window.confirm(`Are you sure you want to cancel the invitation to ${email}?`)) return;

    try {
      await deleteDoc(doc(db, 'invites', inviteId));
      await logActivity('decline_invite', `Cancelled invitation sent to ${email}`);
      toast.success("Invitation successfully revoked.");
    } catch (err: any) {
      toast.error("Failed to revoke invitation.");
    }
  };

  // Remove member action
  const handleRemoveMember = async (memberUid: string, memberEmail: string, memberName: string) => {
    if (userRole !== 'owner') {
      toast.error("Only Project Owners can remove team members.");
      return;
    }

    if (memberEmail === userProfile?.email) {
      toast.error("You cannot remove yourself. To leave, please manage subscriptions.");
      return;
    }

    if (!window.confirm(`Are you sure you want to remove ${memberName || memberEmail} from the project?`)) return;

    try {
      const memberDocId = `${memberUid}_${activeProject.id}`;
      await deleteDoc(doc(db, 'projectMembers', memberDocId));
      await logActivity('decline_invite', `Removed member ${memberName || memberEmail} from project`);
      toast.success(`${memberName || memberEmail} has been removed.`);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to remove member.");
    }
  };

  // Get Relative Time for Last Active
  const getRelativeTime = (isoString: string | null): string => {
    if (!isoString) return 'Offline';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Online';
    if (diffMins < 5) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Check if member is online (active in past 5 minutes)
  const isUserOnline = (isoString: string | null): boolean => {
    if (!isoString) return false;
    const diffMs = new Date().getTime() - new Date(isoString).getTime();
    return diffMs < 300000; // 5 minutes
  };

  return (
    <div className="w-full space-y-8 animate-in fade-in duration-500 pb-16">
      {/* Persistent Sample Data Indicator (Step 6) */}
      {isDemoProject && (
        <div 
          id="demo-sample-data-indicator"
          role="region"
          aria-label="Interactive Demo Indicator"
          className="sticky top-0 z-30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 bg-gradient-to-r from-amber-500 via-yellow-500 to-amber-600 text-slate-950 rounded-2xl shadow-md border border-amber-400 font-medium text-xs backdrop-blur-md"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-2.5 w-2.5 relative shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-slate-900 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-950"></span>
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black uppercase tracking-wider text-[11px] bg-slate-950 text-amber-300 px-2 py-0.5 rounded-md">
                  Interactive Demo · Sample Data
                </span>
                <span className="hidden sm:inline font-bold text-slate-900">
                  Fictional example records only
                </span>
              </div>
              <p className="text-[11px] text-slate-900/90 mt-0.5">
                All changes made here are strictly temporary and isolated in-memory. No real data or external services are affected.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            {demoContext && !demoContext.tourActive && (
              <button
                type="button"
                onClick={() => demoContext.startTour()}
                className="px-3 py-1.5 bg-slate-950 hover:bg-slate-900 text-amber-300 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Restart Tour</span>
              </button>
            )}
            {demoContext && (
              <button
                type="button"
                onClick={() => {
                  demoContext.resetDemoState();
                  toast.success("Sample data reset to default.");
                }}
                className="px-2.5 py-1.5 bg-white/40 hover:bg-white/60 text-slate-950 rounded-xl text-xs font-bold transition-all"
                title="Reset sample data back to pristine initial fixtures"
              >
                Reset Data
              </button>
            )}
            {demoContext && (
              <button
                type="button"
                onClick={() => {
                  demoContext.exitDemo();
                  onSelectProjectName(null);
                  toast.info("Exited demo mode.");
                }}
                className="px-2.5 py-1.5 bg-slate-950/15 hover:bg-slate-950/25 text-slate-950 rounded-xl text-xs font-bold transition-all"
              >
                Exit Demo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Workspace Interactive Tour Controller */}
      {isDemoProject && demoContext && (
        <WorkspaceTourGuide
          isActive={demoContext.tourActive}
          currentStepIndex={demoContext.tourStepIndex}
          steps={DEMO_TOUR_STEPS}
          onStepChange={(newIndex) => demoContext.setTourStepIndex(newIndex)}
          onExit={() => demoContext.endTour()}
          onRestart={() => {
            demoContext.startTour();
            demoContext.setTourStepIndex(0);
          }}
          onTargetNotFound={(step) => {
            console.warn(`[TOUR NOTICE] Step target not yet rendered: ${step.id}`);
          }}
          onActionCompleted={(step) => {
            // Contextual navigation assistance if an action takes place
            if (step.id === 'step-1-select-project') {
              setActiveProjectTab('workspace');
            } else if (step.id === 'step-2-open-meetings') {
              setActiveProjectTab('meetings');
            } else if (step.id === 'step-6-open-tasks') {
              setActiveProjectTab('workspace');
            }
          }}
        />
      )}

      {/* Top Banner / Header Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          <div className="space-y-2">
            {/* Contextual Breadcrumb */}
            <nav aria-label="Project context breadcrumb" className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <button
                type="button"
                onClick={() => {
                  onSelectProjectName(null);
                  setActiveProjectTab('projects');
                }}
                className="hover:text-indigo-600 transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded"
              >
                <Folder className="w-3.5 h-3.5 text-slate-400" />
                <span>All Projects</span>
              </button>
              <span className="text-slate-300">/</span>
              <span className="text-indigo-900 font-bold uppercase tracking-wider bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100/60">
                {activeProject.name}
              </span>
            </nav>

            <div className="flex items-center gap-2">
              <Users className="text-echo-accent w-6 h-6 shrink-0" />
              <h1 className="text-[24px] font-black tracking-tight text-slate-900 uppercase">
                {activeProject.name} — Workspace
              </h1>
            </div>
            <p className="text-sm text-slate-500 font-medium">
              Real-time collaboration, tasks, meetings, exceptions, and execution tracking for {activeProject.name}.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* AI Smart Recap Button */}
            <button
              id="btn-ai-smart-recap-header"
              onClick={() => handleTriggerProjectSmartRecap()}
              disabled={isGeneratingRecap}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-500/20 active:scale-95 border border-indigo-400/30 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Synthesize meeting audio transcripts into a 3-bullet executive summary and tag mentioned team members"
            >
              <Sparkles className="w-4 h-4 text-indigo-200 animate-pulse" />
              <span>{isGeneratingRecap ? 'Synthesizing...' : 'AI Smart Recap'}</span>
            </button>

            {/* AH.184 Executive Report Export Button */}
            <button
              id="btn-export-report-header"
              onClick={() => setIsReportModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shadow-slate-900/20 active:scale-95 border border-slate-700"
              title="Export Executive PowerPoint Presentations and Excel Workbooks"
            >
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>Export Report</span>
            </button>

            {/* Project Selector Dropdown */}
            <div className="relative">
              <select 
                data-tour="project-selector"
                value={selectedProjectName || ''} 
                onChange={(e) => onSelectProjectName(e.target.value || null)}
                className="appearance-none bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-bold text-slate-700 outline-none hover:border-slate-300 transition-all cursor-pointer uppercase tracking-wider"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
            </div>

            {/* Role Badge */}
            <div className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border font-bold text-xs uppercase tracking-wider ${
              userRole === 'owner' ? 'bg-echo-accent/10 border-echo-accent/30 text-[#1B2A4E]' :
              userRole === 'admin' ? 'bg-blue-50 border-blue-100 text-blue-700' :
              userRole === 'commenter' ? 'bg-amber-50 border-amber-200 text-amber-700' :
              'bg-slate-100 border-slate-200 text-slate-600'
            }`}>
              <Shield className="w-3.5 h-3.5" />
              <span>
                {userRole === 'owner' ? 'Project Owner' :
                 userRole === 'admin' ? 'Project Admin' :
                 userRole === 'commenter' ? 'Commenter' :
                 'Viewer (Read-only)'}
              </span>
            </div>
          </div>

        </div>
      </div>

      <div className="w-full space-y-8">
        
        {/* Selected Project Summary Stats Widget Component */}
        <SummaryStatsWidget 
          projectName={activeProject.name}
          projectId={activeProject.id}
          activeRecordingsCount={activeRecordingsCount}
          completedDecisionsCount={completedDecisionsCount}
          readyRecordingsCount={readyRecordingsCount}
          inProgressRecordingsCount={inProgressRecordingsCount}
          totalRecordingsCount={filteredAudioRecords.length + filteredTextRecords.length}
          trashedRecordingsCount={trashedAudioRecordings.length}
          decisionsFromRecordings={decisionsFromRecordings}
          decisionsFromIntelligence={decisionsFromIntelligence > 0 ? decisionsFromIntelligence : decisionCount}
          isLiveSyncing={true}
          tasksCount={getProjectTaskCounts(activeProject)}
          recentActivities={getProjectRecentActivities(activeProject)}
        />

        {/* Project Views Tab Navigation (Phase 2 Step 1 Simplified Hierarchy) */}
        <div className="border-b border-slate-200 pb-2">
          <nav 
            aria-label="Project Sections"
            className="flex items-center gap-2 overflow-x-auto custom-scrollbar py-1 scroll-smooth"
          >
            {/* 1. Project Overview */}
            <button
              id="tab-project-cards"
              onClick={() => setActiveProjectTab('projects')}
              aria-current={activeProjectTab === 'projects' ? 'page' : undefined}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 ${
                activeProjectTab === 'projects'
                  ? 'bg-slate-900 text-white shadow-sm ring-2 ring-slate-900/20'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Folder className={`w-4 h-4 ${activeProjectTab === 'projects' ? 'text-indigo-300' : 'text-indigo-600'}`} />
              <span>Overview</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeProjectTab === 'projects' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700 border border-slate-200'
              }`}>
                {projects.length}
              </span>
            </button>

            {/* 2. Tasks */}
            <button
              id="tab-project-workspace"
              data-tour="tab-tasks"
              onClick={() => setActiveProjectTab('workspace')}
              aria-current={activeProjectTab === 'workspace' ? 'page' : undefined}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 ${
                activeProjectTab === 'workspace'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-600/20'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <ListTodo className="w-4 h-4" />
              <span>Tasks</span>
            </button>

            {/* 3. Meetings */}
            <button
              id="tab-project-meetings"
              data-tour="tab-meetings"
              onClick={() => setActiveProjectTab('meetings')}
              aria-current={activeProjectTab === 'meetings' ? 'page' : undefined}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 ${
                activeProjectTab === 'meetings'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-600/20'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Video className="w-4 h-4" />
              <span>Meetings</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeProjectTab === 'meetings' ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
              }`}>
                Zoom
              </span>
            </button>

            {/* 4. Project Search */}
            <button
              id="tab-project-search"
              onClick={() => setActiveProjectTab('search')}
              aria-current={activeProjectTab === 'search' ? 'page' : undefined}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 ${
                activeProjectTab === 'search'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-600/20'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Search className="w-4 h-4" />
              <span>Search</span>
            </button>

            {/* 5. Exceptions */}
            <button
              id="tab-project-exceptions"
              onClick={() => setActiveProjectTab('exceptions')}
              aria-current={activeProjectTab === 'exceptions' ? 'page' : undefined}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 ${
                activeProjectTab === 'exceptions'
                  ? 'bg-rose-600 text-white shadow-sm ring-2 ring-rose-600/20'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <AlertTriangle className={`w-4 h-4 ${activeProjectTab === 'exceptions' ? 'text-white' : 'text-rose-500'}`} />
              <span>Exceptions</span>
              {exceptionMetrics.activeTotal > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  activeProjectTab === 'exceptions' ? 'bg-white text-rose-700' : 'bg-rose-100 text-rose-800'
                }`}>
                  {exceptionMetrics.activeTotal}
                </span>
              )}
            </button>

            {/* 6. Execution Tracking */}
            <button
              id="tab-project-tracking"
              onClick={() => setActiveProjectTab('tracking')}
              aria-current={activeProjectTab === 'tracking' ? 'page' : undefined}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 ${
                activeProjectTab === 'tracking'
                  ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-600/20'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Activity className={`w-4 h-4 ${activeProjectTab === 'tracking' ? 'text-white' : 'text-amber-500'}`} />
              <span>Execution Tracking</span>
              {trackingMetrics && trackingMetrics.healthScore < 80 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  activeProjectTab === 'tracking' ? 'bg-white text-amber-800' : 'bg-amber-100 text-amber-900'
                }`}>
                  {trackingMetrics.healthScore}%
                </span>
              )}
            </button>

            {/* 7. Follow-ups */}
            <button
              id="tab-project-followups"
              onClick={() => setActiveProjectTab('followups')}
              aria-current={activeProjectTab === 'followups' ? 'page' : undefined}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 ${
                activeProjectTab === 'followups'
                  ? 'bg-purple-600 text-white shadow-sm ring-2 ring-purple-600/20'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <CalendarClock className={`w-4 h-4 ${activeProjectTab === 'followups' ? 'text-white' : 'text-purple-500'}`} />
              <span>Follow-ups</span>
              {followUps.filter(f => ['draft', 'proposed', 'awaiting_confirmation', 'scheduled', 'reschedule_requested'].includes(f.status)).length > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  activeProjectTab === 'followups' ? 'bg-white text-purple-700' : 'bg-purple-100 text-purple-800'
                }`}>
                  {followUps.filter(f => ['draft', 'proposed', 'awaiting_confirmation', 'scheduled', 'reschedule_requested'].includes(f.status)).length}
                </span>
              )}
            </button>
            {/* 8. Recurring Reports (Requirement 24) */}
            <button
              id="tab-project-recurring"
              onClick={() => setActiveProjectTab('recurring')}
              aria-current={activeProjectTab === 'recurring' ? 'page' : undefined}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 ${
                activeProjectTab === 'recurring'
                  ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-600/20'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <CalendarClock className={`w-4 h-4 ${activeProjectTab === 'recurring' ? 'text-white' : 'text-indigo-600'}`} />
              <span>Recurring Reports</span>
            </button>
          </nav>
        </div>

        {activeProjectTab === 'projects' ? (
          <div className="space-y-6">
            {/* Project Cards Header & Search */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Folder className="w-5 h-5 text-indigo-600" />
                  <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                    Project Cards Directory
                  </h2>
                </div>
                <p className="text-xs text-slate-500">
                  Visual indicators of completed vs total tasks and real-time recent activity feeds (Uploads, Decisions, and Milestones) across all workspace projects.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative w-full md:w-64">
                  <input
                    type="text"
                    placeholder="Filter project cards..."
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    className="w-full px-4 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:border-indigo-600 font-medium"
                  />
                </div>
                <button
                  type="button"
                  id="btn-new-project-from-template"
                  onClick={() => setIsTemplateModalOpen(true)}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 shrink-0"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>New from Template</span>
                </button>
              </div>
            </div>

            {/* Grid of Project Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects
                .filter(p => 
                  p.name.toLowerCase().includes(projectSearch.toLowerCase()) || 
                  (p.ownerEmail && p.ownerEmail.toLowerCase().includes(projectSearch.toLowerCase()))
                )
                .map((proj) => {
                  const tasksCount = getProjectTaskCounts(proj);
                  const recentActivities = getProjectRecentActivities(proj);
                  const projAudioCount = (audioHistory || []).filter(
                    r => (r.projectId === proj.id || r.group === proj.name) && !r.deletedAt
                  ).length;

                  return (
                    <ProjectCard
                      key={proj.id}
                      project={proj}
                      isActive={proj.id === activeProject.id || proj.name === activeProject.name}
                      onSelect={(projectName) => {
                        onSelectProjectName(projectName);
                        setActiveProjectTab('workspace');
                      }}
                      tasksCount={tasksCount}
                      recentActivities={recentActivities}
                      recordingsCount={projAudioCount}
                      membersCount={proj.members?.length || 1}
                    />
                  );
                })}
            </div>
          </div>
        ) : activeProjectTab === 'meetings' ? (
          <ProjectMeetingsView
            project={activeProject}
            userProfile={userProfile}
            userRole={userRole}
            onSelectMeetingForReview={(meeting) => {
              const matchedRecord = activeRecordings.find(r => r.id === meeting.recordingId || r.meetingSessionId === meeting.meetingSessionId);
              handleTriggerProjectSmartRecap(matchedRecord);
            }}
          />
        ) : activeProjectTab === 'search' ? (
          <ProjectSearchView
            project={activeProject}
            userProfile={userProfile}
            userRole={userRole}
          />
        ) : activeProjectTab === 'analytics' || activeProjectTab === 'timelines' ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-white border border-slate-200 px-4 py-2.5 rounded-xl shadow-2xs">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span>View:</span>
                <span className="font-bold text-indigo-900 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded uppercase text-[11px]">
                  {activeProjectTab === 'timelines' ? 'Gantt Timelines' : 'Velocity & Trends'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveProjectTab('tracking')}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <Activity className="w-3.5 h-3.5 text-amber-500" />
                  <span>Back to Execution Tracking</span>
                </button>
              </div>
            </div>
            <ProjectAnalyticsView
              project={activeProject}
              tasks={tasks}
              members={allProjectMembers}
              recordings={filteredAudioRecords}
              decisionHistory={decisionHistoryList}
              initialTab={activeProjectTab === 'timelines' ? 'timelines' : 'trends'}
            />
          </div>
        ) : activeProjectTab === 'exceptions' ? (
          <div className="space-y-6">
            {/* Exceptions Summary & Header */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-rose-50 rounded-xl text-rose-600">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900 tracking-tight">Task Exception Center</h2>
                    <p className="text-xs text-slate-500 font-medium">
                      Operational tracking of task obstacles, blocked prerequisites, overdue milestones, and at-risk deliverables.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fetchExceptions()}
                  disabled={loadingExceptions}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5"
                >
                  <Clock className={`w-3.5 h-3.5 ${loadingExceptions ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Active Exceptions</span>
                <p className="text-2xl font-black text-slate-900">{exceptionMetrics.activeTotal || 0}</p>
                <span className="text-[10px] text-slate-500">Unresolved obstacles</span>
              </div>
              <div className="bg-white border border-rose-200 rounded-xl p-4 space-y-1 bg-rose-50/20">
                <span className="text-[10px] font-black uppercase text-rose-700 tracking-wider">Critical Severity</span>
                <p className="text-2xl font-black text-rose-700">{exceptionMetrics.critical || 0}</p>
                <span className="text-[10px] text-rose-600">Immediate action needed</span>
              </div>
              <div className="bg-white border border-amber-200 rounded-xl p-4 space-y-1 bg-amber-50/20">
                <span className="text-[10px] font-black uppercase text-amber-700 tracking-wider">High Severity</span>
                <p className="text-2xl font-black text-amber-700">{exceptionMetrics.high || 0}</p>
                <span className="text-[10px] text-amber-600">Elevated risk items</span>
              </div>
              <div className="bg-white border border-emerald-200 rounded-xl p-4 space-y-1 bg-emerald-50/20">
                <span className="text-[10px] font-black uppercase text-emerald-700 tracking-wider">Resolved / Closed</span>
                <p className="text-2xl font-black text-emerald-700">{(exceptionMetrics.resolved || 0) + (exceptionMetrics.dismissed || 0)}</p>
                <span className="text-[10px] text-emerald-600">Total addressed</span>
              </div>
            </div>

            {/* Exception Filters */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 border border-slate-200 rounded-xl">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setExceptionFilterStatus('active')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    exceptionFilterStatus === 'active'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Active ({exceptionMetrics.activeTotal || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setExceptionFilterStatus('all')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    exceptionFilterStatus === 'all'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({exceptionMetrics.total || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setExceptionFilterStatus('resolved')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    exceptionFilterStatus === 'resolved'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Resolved ({exceptionMetrics.resolved || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setExceptionFilterStatus('dismissed')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    exceptionFilterStatus === 'dismissed'
                      ? 'bg-slate-700 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Dismissed ({exceptionMetrics.dismissed || 0})
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Severity Filter */}
                <select
                  value={exceptionFilterSeverity}
                  onChange={(e) => setExceptionFilterSeverity(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none"
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                {/* Type Filter */}
                <select
                  value={exceptionFilterType}
                  onChange={(e) => setExceptionFilterType(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none"
                >
                  <option value="all">All Types</option>
                  <option value="blocked">Blocked</option>
                  <option value="overdue">Overdue</option>
                  <option value="at_risk">At Risk</option>
                  <option value="dependency_issue">Dependency Issue</option>
                  <option value="other">Other</option>
                </select>

                {/* Assignee Filter */}
                <select
                  value={exceptionFilterAssignee}
                  onChange={(e) => setExceptionFilterAssignee(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none"
                >
                  <option value="all">All Assignees</option>
                  {userProfile?.email && <option value={userProfile.email}>Assigned to Me</option>}
                  {members.map(m => (
                    <option key={m.uid || m.email} value={m.email}>{m.displayName || m.email}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Exceptions List */}
            {loadingExceptions ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (() => {
              const filteredList = exceptions.filter(ex => {
                if (exceptionFilterStatus === 'active' && !['open', 'acknowledged', 'in_progress'].includes(ex.status)) return false;
                if (exceptionFilterStatus !== 'all' && exceptionFilterStatus !== 'active' && ex.status !== exceptionFilterStatus) return false;
                if (exceptionFilterSeverity !== 'all' && ex.severity !== exceptionFilterSeverity) return false;
                if (exceptionFilterType !== 'all' && ex.type !== exceptionFilterType) return false;
                if (exceptionFilterAssignee !== 'all') {
                  if (exceptionFilterAssignee === userProfile?.email) {
                    if (ex.assignedToEmail?.toLowerCase() !== userProfile?.email?.toLowerCase()) return false;
                  } else if (ex.assignedToEmail?.toLowerCase() !== exceptionFilterAssignee.toLowerCase()) {
                    return false;
                  }
                }
                return true;
              });

              if (filteredList.length === 0) {
                return (
                  <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl p-6 bg-white space-y-2">
                    <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto" />
                    <p className="text-sm font-bold text-slate-700">No task exceptions match your filter</p>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      All tasks are executing normally without reported exceptions or obstacles.
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {filteredList.map(ex => {
                    const isCritical = ex.severity === 'critical';
                    const isHigh = ex.severity === 'high';
                    const relatedTask = tasks.find(t => t.id === ex.taskId);

                    return (
                      <div
                        key={ex.id}
                        className={`bg-white border rounded-xl p-4 sm:p-5 transition-all shadow-xs space-y-3 ${
                          isCritical
                            ? 'border-rose-300 bg-rose-50/10'
                            : isHigh
                            ? 'border-amber-200'
                            : 'border-slate-200'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              {/* Severity Badge */}
                              <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded tracking-wider ${
                                ex.severity === 'critical' ? 'bg-rose-100 text-rose-800 border border-rose-200 animate-pulse' :
                                ex.severity === 'high' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                ex.severity === 'medium' ? 'bg-blue-100 text-blue-800' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {ex.severity}
                              </span>

                              {/* Type Badge */}
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[9px] font-black uppercase rounded tracking-wider">
                                {ex.type.replace('_', ' ')}
                              </span>

                              {/* Status Badge */}
                              <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded tracking-wider ${
                                ex.status === 'open' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                                ex.status === 'acknowledged' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                ex.status === 'in_progress' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                                ex.status === 'resolved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                'bg-slate-100 text-slate-500'
                              }`}>
                                {ex.status.replace('_', ' ')}
                              </span>

                              <span className="text-[11px] text-slate-400">
                                {new Date(ex.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                              </span>
                            </div>

                            <h3 className="text-sm font-bold text-slate-900">{ex.title}</h3>

                            {ex.description && (
                              <p className="text-xs text-slate-600 line-clamp-2">{ex.description}</p>
                            )}

                            {/* Task link & provenance context */}
                            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-500">
                              <span className="font-semibold text-slate-700">Related Task:</span>
                              <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                {ex.taskTitle || relatedTask?.title || ex.taskId}
                              </span>
                              {relatedTask && (
                                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded ${
                                  relatedTask.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  Task Status: {relatedTask.status}
                                </span>
                              )}
                              <span>• Reported by: {ex.reporterName}</span>
                              {ex.assignedToName && (
                                <span>• Owner: <strong>{ex.assignedToName}</strong></span>
                              )}
                            </div>

                            {/* Resolution Summary or Dismissal Reason if present */}
                            {ex.resolutionSummary && (
                              <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-900 space-y-0.5 mt-2">
                                <span className="font-bold uppercase text-[10px] text-emerald-800">Resolution Summary:</span>
                                <p>{ex.resolutionSummary}</p>
                              </div>
                            )}

                            {ex.dismissalReason && (
                              <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-0.5 mt-2">
                                <span className="font-bold uppercase text-[10px] text-slate-600">Dismissal Reason:</span>
                                <p>{ex.dismissalReason}</p>
                              </div>
                            )}
                          </div>

                          {/* Action Controls */}
                          <div className="flex flex-wrap sm:flex-col items-end gap-1.5 shrink-0 pt-2 sm:pt-0">
                            {/* Status Progression Controls */}
                            {ex.status === 'open' && (
                              <button
                                type="button"
                                onClick={() => handleUpdateExceptionStatus(ex.id, 'acknowledged')}
                                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded text-xs font-bold transition-colors"
                              >
                                Acknowledge
                              </button>
                            )}
                            {['open', 'acknowledged'].includes(ex.status) && (
                              <button
                                type="button"
                                onClick={() => handleUpdateExceptionStatus(ex.id, 'in_progress')}
                                className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded text-xs font-bold transition-colors"
                              >
                                Start Working
                              </button>
                            )}
                            {['open', 'acknowledged', 'in_progress'].includes(ex.status) && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResolvingExceptionId(ex.id);
                                    setResolutionSummaryText('');
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition-colors shadow-2xs"
                                >
                                  Resolve...
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDismissingExceptionId(ex.id);
                                    setDismissalReasonText('');
                                  }}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs font-bold transition-colors"
                                >
                                  Dismiss...
                                </button>
                              </>
                            )}
                            {['resolved', 'dismissed'].includes(ex.status) && (
                              <button
                                type="button"
                                onClick={() => handleReopenException(ex.id)}
                                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold transition-colors"
                              >
                                Reopen
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenScheduleFollowUpModal(ex.taskId, ex.id, `Follow-up: Exception in ${ex.taskTitle || 'Task'}`)}
                              className="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded text-xs font-bold transition-colors flex items-center gap-1"
                              title="Schedule follow-up meeting for this obstacle (Step 3.6)"
                            >
                              <CalendarClock className="w-3 h-3 text-purple-600" />
                              <span>Follow-up</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setSelectedExceptionDetail(ex)}
                              className="px-2.5 py-1 text-indigo-600 hover:underline text-xs font-bold"
                            >
                              History ({ex.history?.length || 1})
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        ) : activeProjectTab === 'followups' ? (
          <div className="space-y-6">
            {/* Header & Quick Action */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-purple-50 text-purple-700 rounded-xl">
                    <CalendarClock className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                      <span>Follow-up Meetings & Rescheduling</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold uppercase tracking-wider">
                        Phase 1B
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Automated recommendations, agenda drafting, and provider-independent scheduling for project blockers and milestones.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    fetchFollowUps();
                    fetchFollowUpRecommendations();
                  }}
                  disabled={loadingFollowUps}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                  title="Refresh follow-ups and recommendations"
                >
                  <Clock className={`w-3.5 h-3.5 ${loadingFollowUps ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenScheduleFollowUpModal()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Follow-up Draft</span>
                </button>
              </div>
            </div>

            {/* Calendar Provider Connection Status Banner */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-900">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-black uppercase tracking-wider text-[11px] text-amber-800">External Calendar Status:</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 font-bold text-[10px]">Disconnected</span>
                </div>
                <p className="text-amber-800 leading-relaxed">
                  No external calendar provider (Google Calendar or Microsoft Outlook) is currently connected to this workspace. 
                  Follow-up meetings, agendas, and rescheduling are tracked internally within EchoNote without modifying external calendar systems.
                </p>
              </div>
            </div>

            {/* Automated Recommendations Section */}
            {followUpRecommendations.length > 0 && (
              <div className="bg-gradient-to-r from-purple-50/70 to-indigo-50/70 border border-purple-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    <h4 className="text-xs font-black uppercase tracking-wider text-purple-950">
                      Recommended Follow-ups ({followUpRecommendations.length})
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wider bg-purple-100 px-2 py-0.5 rounded">
                    Request-Driven Suggestions
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {followUpRecommendations.map((rec, idx) => (
                    <div key={idx} className="bg-white border border-purple-100 rounded-xl p-3.5 shadow-2xs space-y-2 flex flex-col justify-between">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-purple-100 text-purple-800">
                            {rec.reason}
                          </span>
                        </div>
                        <h5 className="text-xs font-bold text-slate-900 leading-snug">{rec.title}</h5>
                        <p className="text-[11px] text-slate-500 line-clamp-2">{rec.purpose}</p>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">
                          {rec.suggestedParticipants?.length || 0} participant(s)
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenScheduleFollowUpModal(
                            rec.suggestedTaskIds?.[0], 
                            rec.suggestedExceptionIds?.[0], 
                            rec.title
                          )}
                          className="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs"
                        >
                          Draft Meeting
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {['all', 'draft', 'proposed', 'scheduled', 'reschedule_requested', 'completed', 'cancelled'].map((st) => {
                  const count = st === 'all' 
                    ? followUps.length 
                    : followUps.filter(f => f.status === st).length;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setFollowUpFilterStatus(st)}
                      className={`px-3 py-1.5 rounded-lg font-bold capitalize transition-all ${
                        followUpFilterStatus === st
                          ? 'bg-purple-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span>{st.replace('_', ' ')}</span>
                      <span className={`ml-1.5 text-[10px] px-1.5 py-0.2 rounded-full ${
                        followUpFilterStatus === st ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-700'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Follow-ups List */}
            {loadingFollowUps ? (
              <div className="p-12 text-center text-slate-400 bg-white border border-slate-200 rounded-2xl">
                <Clock className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-600" />
                <p className="text-xs font-medium">Loading follow-up meetings...</p>
              </div>
            ) : (() => {
              const filtered = followUps.filter(f => followUpFilterStatus === 'all' || f.status === followUpFilterStatus);
              if (filtered.length === 0) {
                return (
                  <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-12 text-center space-y-2">
                    <CalendarClock className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-sm font-bold text-slate-700">No follow-up meetings found</p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Schedule a follow-up to address blocked tasks, overdue milestones, or active exceptions.
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {filtered.map((item) => {
                    const statusColors: Record<string, string> = {
                      draft: 'bg-slate-100 text-slate-700 border-slate-200',
                      proposed: 'bg-blue-50 text-blue-700 border-blue-200',
                      awaiting_confirmation: 'bg-amber-50 text-amber-700 border-amber-200',
                      scheduled: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                      reschedule_requested: 'bg-orange-50 text-orange-700 border-orange-200',
                      completed: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                      cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
                      failed: 'bg-red-50 text-red-700 border-red-200'
                    };

                    return (
                      <div key={item.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-3 transition-all hover:border-slate-300">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                statusColors[item.status] || 'bg-slate-100 text-slate-700'
                              }`}>
                                {item.status.replace('_', ' ')}
                              </span>
                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                Provider: {item.provider === 'none' ? 'Internal (No Provider)' : item.provider}
                              </span>
                              {item.reason && (
                                <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                                  {item.reason}
                                </span>
                              )}
                            </div>
                            <h4 className="text-sm font-black text-slate-900">{item.title}</h4>
                            <p className="text-xs text-slate-600 leading-relaxed">{item.purpose}</p>
                          </div>

                          <div className="text-right shrink-0 text-xs space-y-1">
                            <div className="font-bold text-slate-800 flex items-center justify-end gap-1">
                              <Calendar className="w-3.5 h-3.5 text-slate-400" />
                              <span>{item.proposedStartTime ? new Date(item.proposedStartTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Time not proposed'}</span>
                            </div>
                            <p className="text-[10px] text-slate-400">Timezone: {item.timezone || 'UTC'}</p>
                          </div>
                        </div>

                        {/* Linked Records Preview */}
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                          <span className="font-bold text-slate-400">Linked:</span>
                          {item.taskIds && item.taskIds.length > 0 && (
                            <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-medium">
                              {item.taskIds.length} Task(s)
                            </span>
                          )}
                          {item.exceptionIds && item.exceptionIds.length > 0 && (
                            <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded font-medium">
                              {item.exceptionIds.length} Exception(s)
                            </span>
                          )}
                          <span className="text-slate-400">|</span>
                          <span className="font-bold text-slate-400">Participants:</span>
                          <span className="text-slate-700">
                            {item.participants?.map(p => p.name || p.email).join(', ') || 'None assigned'}
                          </span>
                        </div>

                        {/* Agenda Preview */}
                        {item.agenda && (
                          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700">
                            <p className="font-bold text-slate-900 text-[10px] uppercase tracking-wider mb-1">Generated Agenda:</p>
                            <div className="whitespace-pre-line text-slate-600 leading-relaxed font-mono text-[11px]">
                              {item.agenda}
                            </div>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedFollowUpDetail(item)}
                            className="text-xs text-purple-600 font-bold hover:underline"
                          >
                            View Audit History ({item.history?.length || 1})
                          </button>

                          <div className="flex flex-wrap items-center gap-2">
                            {['draft', 'proposed', 'reschedule_requested'].includes(item.status) && (
                              <button
                                type="button"
                                onClick={() => handleConfirmFollowUp(item.id)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs"
                              >
                                Confirm Meeting
                              </button>
                            )}
                            {['draft', 'proposed', 'awaiting_confirmation', 'scheduled'].includes(item.status) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReschedulingMeetingId(item.id);
                                  setRescheduleStartTime(item.proposedStartTime ? new Date(item.proposedStartTime).toISOString().slice(0, 16) : '');
                                  setRescheduleEndTime(item.proposedEndTime ? new Date(item.proposedEndTime).toISOString().slice(0, 16) : '');
                                  setRescheduleReason('');
                                }}
                                className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold transition-all"
                              >
                                Reschedule...
                              </button>
                            )}
                             {item.status === 'scheduled' && (!item.relatedTaskIds && item.relatedTaskIds.length > 0) && (userRole === 'owner' || userRole === 'admin') && (
                              <button
                                type="button"
                                onClick={() => setReasoningMeetingToComplete(item)}
                                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5"
                                title="Complete reasoning meeting and resolve task delay"
                              >
                                <CalendarClock className="w-3.5 h-3.5" />
                                 Complete Reasoning...
                              </button>
                            )}
                            {item.status === 'scheduled' && (!item.relatedTaskIds || item.relatedTaskIds.length === 0 || !(userRole === 'owner' || userRole === 'admin')) && (
                              <button
                                type="button"
                                onClick={() => {
                                   setCompletingMeetingId(item.id);
                                   setCompletionNotesText('');
                                 }}
                                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs"
                              >
                                Mark Completed
                              </button>
                             )}\n                            {!['completed', 'cancelled'].includes(item.status) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCancellingMeetingId(item.id);
                                  setCancelReasonText('');
                                }}
                                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-all"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        ) : activeProjectTab === 'recurring' ? (
          <RecurringScheduleManager
            projectId={activeProject?.id || ''}
            projectName={activeProject?.name}
            userRole={userRole}
          />
        ) : activeProjectTab === 'tracking' ? (
          <div className="space-y-6">
            {/* Header & Worker Health Bar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-amber-50 text-amber-700 rounded-xl">
                    <Activity className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                      <span>Execution Tracking & Deadline Engine</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold uppercase tracking-wider">
                        Phase 1B
                      </span>
                    </h3>
                    <p className="text-xs text-slate-500 font-medium">
                      Multi-tier dependency graph risk detection, overdue recovery, and background monitoring health.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  id="btn-tracking-view-analytics"
                  onClick={() => setActiveProjectTab('analytics')}
                  className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-indigo-200"
                  title="View detailed velocity & trend analytics"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>Trends & Analytics</span>
                </button>
                <button
                  type="button"
                  id="btn-tracking-view-timelines"
                  onClick={() => setActiveProjectTab('timelines')}
                  className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border border-indigo-200"
                  title="View Gantt timelines"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Gantt Timelines</span>
                </button>
                <button
                  type="button"
                  onClick={() => fetchTrackingInsights()}
                  disabled={loadingTracking}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                  title="Run live risk evaluation"
                >
                  <Clock className={`w-3.5 h-3.5 ${loadingTracking ? 'animate-spin' : ''}`} />
                  <span>Evaluate Now</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleQueueTrackingJob()}
                  disabled={isQueueingJob}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  title="Queue durable worker job to evaluate and synchronize exceptions"
                >
                  <ShieldAlert className="w-4 h-4" />
                  <span>{isQueueingJob ? 'Queueing...' : 'Queue Monitoring Job'}</span>
                </button>
              </div>
            </div>

            {/* Monitoring Status & Health Bar */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Project Health Score</span>
                <div className="flex items-center justify-between">
                  <span className={`text-2xl font-black ${
                    (trackingMetrics?.healthScore ?? 100) >= 80 ? 'text-emerald-600' : (trackingMetrics?.healthScore ?? 100) >= 50 ? 'text-amber-600' : 'text-rose-600'
                  }`}>
                    {trackingMetrics?.healthScore ?? 100}%
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                    (trackingMetrics?.healthScore ?? 100) >= 80 ? 'bg-emerald-100 text-emerald-800' : (trackingMetrics?.healthScore ?? 100) >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                  }`}>
                    {(trackingMetrics?.healthScore ?? 100) >= 80 ? 'Healthy' : (trackingMetrics?.healthScore ?? 100) >= 50 ? 'Attention' : 'Critical'}
                  </span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Overdue & Delayed</span>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-black text-rose-600">{trackingMetrics?.overdueTasksCount || 0}</span>
                  <span className="text-xs text-slate-500 font-bold">{trackingMetrics?.dueSoonTasksCount || 0} Due Soon</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Dependency Blockers</span>
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-black text-amber-600">{trackingMetrics?.blockedTasksCount || 0}</span>
                  <span className="text-xs text-rose-600 font-bold">{trackingMetrics?.blockedByOverduePrereqCount || 0} Overdue Prereq</span>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-1">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Durable Worker Status</span>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${
                    trackingMetrics?.monitoringStatus === 'healthy' ? 'bg-emerald-100 text-emerald-800' : trackingMetrics?.monitoringStatus === 'degraded' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {trackingMetrics?.monitoringStatus || 'never_run'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {trackingMetrics?.lastSuccessfulJobRunAt ? new Date(trackingMetrics.lastSuccessfulJobRunAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Never evaluated'}
                  </span>
                </div>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-3">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {['all', 'critical', 'high', 'medium', 'low'].map((sev) => {
                  const count = sev === 'all'
                    ? trackingRisks.length
                    : trackingRisks.filter(r => r.severity === sev).length;
                  return (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setTrackingRiskFilter(sev)}
                      className={`px-3 py-1.5 rounded-lg font-bold capitalize transition-all ${
                        trackingRiskFilter === sev
                          ? 'bg-amber-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span>{sev}</span>
                      <span className={`ml-1.5 text-[10px] px-1.5 py-0.2 rounded-full ${
                        trackingRiskFilter === sev ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-700'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <select
                value={trackingCategoryFilter}
                onChange={(e) => setTrackingCategoryFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none"
              >
                <option value="all">All Risk Categories</option>
                <option value="overdue">Overdue Tasks</option>
                <option value="due_soon">Due Soon</option>
                <option value="blocked_by_prerequisite">Blocked by Prerequisite</option>
                <option value="blocked_by_overdue_prerequisite">Blocked by Overdue Prerequisite</option>
                <option value="downstream_deadline_at_risk">Downstream Deadline at Risk</option>
                <option value="unresolved_exception">Unresolved Exceptions</option>
                <option value="unscheduled_active_task">Unscheduled Tasks</option>
              </select>
            </div>

            {/* Risk Indicators List */}
            {loadingTracking ? (
              <div className="p-12 text-center text-slate-400 bg-white border border-slate-200 rounded-2xl">
                <Clock className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-600" />
                <p className="text-xs font-medium">Evaluating project dependencies and deadlines...</p>
              </div>
            ) : (() => {
              const filtered = trackingRisks.filter(r => {
                const matchesSev = trackingRiskFilter === 'all' || r.severity === trackingRiskFilter;
                const matchesCat = trackingCategoryFilter === 'all' || r.category === trackingCategoryFilter;
                return matchesSev && matchesCat;
              });

              if (filtered.length === 0) {
                return (
                  <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-12 text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                    <p className="text-sm font-bold text-slate-700">No execution risks match your criteria</p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      All active tasks are proceeding without detected milestone delays or blocking prerequisite conflicts.
                    </p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {filtered.map((item, idx) => {
                    const sevColors: Record<string, string> = {
                      critical: 'bg-rose-100 text-rose-800 border-rose-200',
                      high: 'bg-orange-100 text-orange-800 border-orange-200',
                      medium: 'bg-amber-100 text-amber-800 border-amber-200',
                      low: 'bg-slate-100 text-slate-700 border-slate-200'
                    };

                    return (
                      <div key={`${item.taskId}_${item.category}_${idx}`} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs space-y-3 transition-all hover:border-slate-300">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                sevColors[item.severity] || 'bg-slate-100 text-slate-700'
                              }`}>
                                {item.severity}
                              </span>
                              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider bg-slate-100 px-2 py-0.5 rounded">
                                {item.category.replace(/_/g, ' ')}
                              </span>
                              {item.assigneeEmail && (
                                <span className="text-[10px] text-slate-500">
                                  Assignee: {item.assigneeEmail}
                                </span>
                              )}
                            </div>

                            <h4 className="text-sm font-black text-slate-900">{item.taskTitle}</h4>
                            <p className="text-xs text-slate-600 leading-relaxed">{item.details}</p>
                          </div>

                          <div className="text-right shrink-0 text-xs space-y-1">
                            {item.dueDate && (
                              <div className="font-bold text-slate-800 flex items-center justify-end gap-1">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                <span>Due: {new Date(item.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                              </div>
                            )}
                            <p className="text-[10px] text-slate-400">
                              Detected: {new Date(item.detectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>

                        {/* Prerequisites Details */}
                        {item.prerequisiteTitles && item.prerequisiteTitles.length > 0 && (
                          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-[11px] text-slate-600">
                            <span className="font-bold text-slate-800">Prerequisites: </span>
                            <span>{item.prerequisiteTitles.join(', ')}</span>
                          </div>
                        )}

                        {/* Action Buttons */}
                        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400 font-medium">
                            {item.associatedExceptionIds?.length ? `${item.associatedExceptionIds.length} Linked Exception(s)` : 'No active exceptions'}
                          </span>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                handleOpenScheduleFollowUpModal(item.taskId, item.associatedExceptionIds?.[0], `Follow-up: Unblock ${item.taskTitle}`);
                              }}
                              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5"
                            >
                              <CalendarClock className="w-3.5 h-3.5" />
                              <span>Draft Follow-up</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        ) : (
          <>
            {/* Active Project Card Banner */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-500">
                    Active Project Card
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                    Active Workspace
                  </span>
                </div>
                <button
                  onClick={() => setActiveProjectTab('projects')}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 transition-colors"
                >
                  <span>View all {projects.length} project cards</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="max-w-2xl">
                <ProjectCard
                  project={activeProject}
                  isActive={true}
                  onSelect={() => {}}
                  tasksCount={getProjectTaskCounts(activeProject)}
                  recentActivities={getProjectRecentActivities(activeProject)}
                  userRole={userRole === 'owner' ? 'Owner' : userRole === 'admin' ? 'Admin' : userRole === 'commenter' ? 'Commenter' : 'Viewer'}
                  recordingsCount={activeRecordingsCount}
                  membersCount={allProjectMembers.length}
                />
              </div>
            </div>

            {/* Bento Grid Metrics Dashboard */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6">
          
          {/* Files Uploaded */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Files Uploaded</p>
                <h3 className="text-3xl font-black text-slate-900">{filesUploaded}</h3>
              </div>
              <div className="p-3 bg-indigo-50 rounded-xl text-indigo-600">
                <FileAudio className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>{userRole === 'owner' ? 'Total Files' : 'Your Files'}</span>
              <span className="text-emerald-500 flex items-center gap-0.5">Live</span>
            </div>
          </div>

          {/* Transcripts Generated */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Transcripts</p>
                <h3 className="text-3xl font-black text-slate-900">{transcriptCount}</h3>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
                <Activity className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>Transcribed Audio</span>
              <span className="text-emerald-500 flex items-center gap-0.5">Real-time</span>
            </div>
          </div>

          {/* Bookmarks Created */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bookmarks Marked</p>
                <h3 className="text-3xl font-black text-slate-900">{bookmarkCount}</h3>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl text-amber-600">
                <Bookmark className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>Key Audio Clips</span>
              <span className="text-[#1B2A4E] font-extrabold">Active</span>
            </div>
          </div>

          {/* AI Decision Intelligence */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">AI Decisions Analyzed</p>
                <h3 className="text-3xl font-black text-slate-900">{decisionCount}</h3>
              </div>
              <div className="p-3 bg-purple-50 rounded-xl text-purple-600">
                <Brain className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>Decision Reports</span>
              <span className="text-purple-500 flex items-center gap-0.5"><Sparkles className="w-3 h-3" /> Gemini</span>
            </div>
          </div>

          {/* Real-time Assigned Tasks Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all col-span-2 md:col-span-1">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Assigned Tasks</p>
                <h3 className="text-3xl font-black text-slate-900">{tasks.length}</h3>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
                <ListTodo className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>{myAssignedTasks.length} Assigned to You</span>
              <span className="text-emerald-600 flex items-center gap-1 font-extrabold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Sync
              </span>
            </div>
          </div>

        </div>

        {/* Dashboard Panels Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Assigned Tasks & Team Members */}
          <div className="lg:col-span-2 space-y-8">

            {/* Real-Time Assigned Tasks Panel */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ListTodo className="w-5 h-5 text-emerald-600" />
                    <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Assigned Tasks</h2>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Firestore Live
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Collaborative task tracking and accountability for <span className="font-bold text-slate-700 uppercase">{activeProject.name}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    id="btn-ai-smart-recap-workspace"
                    onClick={() => handleTriggerProjectSmartRecap()}
                    disabled={isGeneratingRecap}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-purple-50 to-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-xl text-xs font-bold uppercase tracking-wider transition-all active:scale-95 shadow-sm disabled:opacity-50"
                    title="Synthesize meeting audio transcripts into a 3-bullet point executive summary and tag mentioned team members"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>AI Smart Recap</span>
                  </button>

                  <button
                    onClick={() => setIsAutomatedTaggingOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-xl text-xs font-bold uppercase tracking-wider transition-all active:scale-95 shadow-sm"
                    title="Scan transcripts for team mentions and automatically update task assignments"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Auto-Tag Mentions</span>
                  </button>

                  <button
                    onClick={() => {
                      fetchTaskTemplates();
                      setShowTemplatesModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold uppercase tracking-wider transition-all active:scale-95 shadow-sm"
                    title="Browse and apply reusable task templates"
                  >
                    <LayoutTemplate className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Templates</span>
                  </button>

                  <button 
                    onClick={() => setShowAddTask(!showAddTask)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-slate-800 transition-all active:scale-95 shadow-sm"
                  >
                    {showAddTask ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>{showAddTask ? 'Close' : 'Add Task'}</span>
                  </button>
                </div>
              </div>

              {/* Task Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                <button
                  onClick={() => { setTaskFilter('all'); setMemberFilter(null); }}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    taskFilter === 'all' && !memberFilter
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({tasks.length})
                </button>
                <button
                  onClick={() => { setTaskFilter('my'); setMemberFilter(null); }}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                    taskFilter === 'my' && !memberFilter
                      ? 'bg-brand-primary text-slate-900 shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>Assigned to Me ({myAssignedTasks.length})</span>
                </button>
                <button
                  onClick={() => { setTaskFilter('pending'); setMemberFilter(null); }}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    taskFilter === 'pending' && !memberFilter
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Pending ({pendingTasks.length})
                </button>
                <button
                  onClick={() => { setTaskFilter('in_progress'); setMemberFilter(null); }}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    taskFilter === 'in_progress' && !memberFilter
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  In Progress ({inProgressTasks.length})
                </button>
                <button
                  onClick={() => { setTaskFilter('completed'); setMemberFilter(null); }}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    taskFilter === 'completed' && !memberFilter
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Completed ({completedTasks.length})
                </button>
                <button
                  onClick={() => { setTaskFilter('overdue'); setMemberFilter(null); }}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                    taskFilter === 'overdue' && !memberFilter
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  <i className="fa-solid fa-triangle-exclamation text-xs"></i>
                  <span>Overdue ({overdueTasks.length})</span>
                </button>
                <button
                  onClick={() => { setTaskFilter('due_soon'); setMemberFilter(null); }}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                    taskFilter === 'due_soon' && !memberFilter
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                  }`}
                  title="Due within 3 days"
                >
                  <CalendarClock className="w-3.5 h-3.5" />
                  <span>Due Soon ({dueSoonTasks.length})</span>
                </button>
                <button
                  onClick={() => { setTaskFilter('starting_soon'); setMemberFilter(null); }}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                    taskFilter === 'starting_soon' && !memberFilter
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                  }`}
                  title="Starting within 3 days"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Starting Soon ({startingSoonTasks.length})</span>
                </button>
                <button
                  onClick={() => { setTaskFilter('unscheduled'); setMemberFilter(null); }}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                    taskFilter === 'unscheduled' && !memberFilter
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  title="Tasks with no start or due date"
                >
                  <span>Unscheduled ({unscheduledTasks.length})</span>
                </button>

                {/* Priority filter dropdown */}
                <select
                  value={taskPriorityFilter}
                  onChange={(e) => setTaskPriorityFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 outline-none hover:bg-slate-200 transition-colors ml-auto"
                >
                  <option value="all">All Priorities</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                {/* Date Sort dropdown */}
                <select
                  value={taskDateSort}
                  onChange={(e) => setTaskDateSort(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 outline-none hover:bg-slate-200 transition-colors"
                  title="Sort by dates"
                >
                  <option value="none">Sort: Default</option>
                  <option value="dueDate_asc">Due Date (Earliest)</option>
                  <option value="dueDate_desc">Due Date (Latest)</option>
                  <option value="startDate_asc">Start Date (Earliest)</option>
                  <option value="startDate_desc">Start Date (Latest)</option>
                </select>

                {/* Search input */}
                <div className="relative w-full sm:w-48 mt-2 sm:mt-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search tasks..."
                    value={taskSearchQuery}
                    onChange={(e) => setTaskSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-emerald-500 font-medium"
                  />
                  {taskSearchQuery && (
                    <button
                      onClick={() => setTaskSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[10px]"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Member Filter Alert */}
              {memberFilter && (
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-xl border border-purple-100 text-xs text-purple-900 font-medium">
                  <span>Filtered to tasks assigned to: <strong>{memberFilter}</strong></span>
                  <button 
                    onClick={() => setMemberFilter(null)}
                    className="text-purple-600 hover:text-purple-800 underline font-bold"
                  >
                    Clear member filter
                  </button>
                </div>
              )}

              {/* Collapsible New Task Form */}
              {showAddTask && (
                <form onSubmit={handleCreateTask} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">New Task Assignment</h3>
                    <span className="text-[10px] text-slate-400 font-bold uppercase">Stored in Firestore</span>
                  </div>

                  {taskDateConflictError && (
                    <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs font-bold text-rose-700 flex items-center gap-2">
                      <i className="fa-solid fa-triangle-exclamation text-rose-500"></i>
                      <span>{taskDateConflictError}</span>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Task Title *</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g., Follow up on API migration action item from audio sync"
                        value={taskTitle}
                        onChange={(e) => setTaskTitle(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-echo-accent/30 focus:border-slate-300"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Description (Optional)</label>
                      <textarea
                        rows={2}
                        placeholder="Additional context or meeting reference..."
                        value={taskDescription}
                        onChange={(e) => setTaskDescription(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-echo-accent/30 focus:border-slate-300 resize-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      {/* Assignee selection */}
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Assignee</label>
                        <select
                          value={taskAssigneeEmail}
                          onChange={(e) => setTaskAssigneeEmail(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 outline-none"
                        >
                          <option value={userProfile?.email || ''}>You ({userProfile?.email || 'Self'})</option>
                          {activeProject.ownerEmail && activeProject.ownerEmail !== userProfile?.email && (
                            <option value={activeProject.ownerEmail}>Project Owner ({activeProject.ownerEmail})</option>
                          )}
                          {members.filter(m => m.email !== userProfile?.email && m.email !== activeProject.ownerEmail).map(m => (
                            <option key={m.uid || m.email} value={m.email}>{m.displayName || m.email} ({m.email})</option>
                          ))}
                        </select>
                      </div>

                      {/* Priority */}
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Priority</label>
                        <select
                          value={taskPriority}
                          onChange={(e) => setTaskPriority(e.target.value as any)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-700 outline-none"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </div>

                      {/* Start Date */}
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Start Date</label>
                        <input
                          type="date"
                          value={taskStartDate}
                          onChange={(e) => {
                            setTaskStartDate(e.target.value);
                            if (e.target.value && taskDueDate && new Date(e.target.value).getTime() > new Date(taskDueDate).getTime()) {
                              setTaskDateConflictError(`Start date (${e.target.value}) cannot be after Due date (${taskDueDate}).`);
                            } else {
                              setTaskDateConflictError(null);
                            }
                          }}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none"
                        />
                      </div>

                      {/* Due date */}
                      <div>
                        <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Due Date</label>
                        <input
                          type="date"
                          value={taskDueDate}
                          onChange={(e) => {
                            setTaskDueDate(e.target.value);
                            if (taskStartDate && e.target.value && new Date(taskStartDate).getTime() > new Date(e.target.value).getTime()) {
                              setTaskDateConflictError(`Due date (${e.target.value}) cannot be before Start date (${taskStartDate}).`);
                            } else {
                              setTaskDateConflictError(null);
                            }
                          }}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAddTask(false)}
                      className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingTask || !taskTitle.trim()}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-emerald-700 transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {isSubmittingTask ? 'Saving...' : 'Assign Task'}
                    </button>
                  </div>
                </form>
              )}

              {/* Tasks List */}
              {loadingTasks ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl p-6 space-y-2">
                  <ListTodo className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-sm font-bold text-slate-600">No tasks in this view</p>
                  <p className="text-xs text-slate-400">
                    {taskFilter === 'my'
                      ? "You currently have no assigned tasks in this project."
                      : "Create task assignments to keep project members synchronized."}
                  </p>
                  {!showAddTask && (
                    <button
                      onClick={() => setShowAddTask(true)}
                      className="mt-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 underline"
                    >
                      + Create First Task
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                  {filteredTasks.map((task) => {
                    const isMyTask = task.assigneeEmail?.toLowerCase() === userProfile?.email?.toLowerCase();
                    const isOverdue = task.dueDate && new Date(task.dueDate).getTime() < new Date().setHours(0,0,0,0) && task.status !== 'completed';
                    const isExpanded = expandedTaskIds.has(task.id);
                    const subTasks = task.subTasks || [];
                    const completedSubTasks = subTasks.filter(st => st.completed).length;
                    const isEditingDueDate = editingDueDateTaskId === task.id;
                    const isEditingDescription = editingDescriptionTaskId === task.id;

                    const isBlockedSdkTask = task.id === 'demo-task-client-sdk' || task.title.includes('Client SDK v2.4') || (task.dependencyStatus === 'blocked' && task.prerequisiteTaskIds && task.prerequisiteTaskIds.length > 0);
                    const isTargetHighlighted = activeHighlightTaskId === task.id;

                    return (
                      <div 
                        key={task.id}
                        data-task-id={task.id}
                        data-tour={isBlockedSdkTask ? "task-card-sdk-v2" : undefined}
                        data-tour-blocked={isBlockedSdkTask ? "task-client-sdk-blocked" : undefined}
                        className={`rounded-xl border transition-all duration-300 overflow-hidden ${
                          isTargetHighlighted
                            ? 'ring-2 ring-emerald-500 shadow-md bg-emerald-50/40 border-emerald-400'
                            : task.status === 'completed'
                            ? 'bg-slate-50/80 border-slate-200 opacity-90'
                            : isMyTask
                            ? 'bg-white border-brand-primary/50 shadow-sm ring-1 ring-brand-primary/20'
                            : 'bg-white border-slate-200 shadow-sm hover:border-slate-300'
                        }`}
                      >
                        {/* Task Card Header / Primary Row */}
                        <div 
                          data-tour={isBlockedSdkTask ? "task-row-blocked" : undefined}
                          onClick={() => handleToggleExpandTask(task.id)}
                          className="p-4 cursor-pointer hover:bg-slate-50/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          {/* Left: Expand Chevron + Checkbox + Task details */}
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleExpandTask(task.id);
                              }}
                              className="mt-0.5 p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                              title={isExpanded ? "Collapse task details" : "Expand task details"}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4 text-slate-600" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-slate-500" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleTaskStatus(task);
                              }}
                              className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0 ${
                                task.status === 'completed'
                                  ? 'bg-emerald-500 border-emerald-600 text-white'
                                  : 'border-slate-300 bg-white hover:border-emerald-500 text-transparent'
                              }`}
                              title={task.status === 'completed' ? "Mark as Incomplete" : "Mark as Completed"}
                            >
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                            </button>

                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className={`text-sm font-bold truncate ${
                                  task.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-900'
                                }`}>
                                  {task.title}
                                </p>

                                {/* Priority Pill */}
                                <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded tracking-wider ${
                                  task.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                  task.priority === 'high' ? 'bg-amber-100 text-amber-800' :
                                  task.priority === 'medium' ? 'bg-blue-100 text-blue-800' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {task.priority}
                                </span>

                                {/* Dependency Status Badge */}
                                {task.dependencyStatus === 'blocked' ? (
                                  <span 
                                    className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-black uppercase rounded tracking-wider inline-flex items-center gap-1"
                                    title={`Blocked by ${task.blockingPrerequisites?.length || 1} incomplete prerequisite(s)`}
                                  >
                                    <Lock className="w-2.5 h-2.5 text-rose-600" />
                                    <span>Blocked ({task.blockingPrerequisites?.length || 1})</span>
                                  </span>
                                ) : task.dependencyStatus === 'ready' ? (
                                  <span 
                                    className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-black uppercase rounded tracking-wider inline-flex items-center gap-1"
                                    title={task.prerequisiteTaskIds && task.prerequisiteTaskIds.length > 0 ? "All prerequisites complete - unblocked" : "Ready"}
                                  >
                                    <GitMerge className="w-2.5 h-2.5 text-emerald-600" />
                                    <span>Ready</span>
                                  </span>
                                ) : (
                                  <span 
                                    className="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 text-[9px] font-black uppercase rounded tracking-wider inline-flex items-center gap-1"
                                    title="Completed"
                                  >
                                    <CheckCircle2 className="w-2.5 h-2.5 text-slate-500" />
                                    <span>Completed</span>
                                  </span>
                                )}

                                {/* Active Exception Badge */}
                                {task.activeExceptions && task.activeExceptions.length > 0 && (
                                  <span
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveProjectTab('exceptions');
                                    }}
                                    className={`px-2 py-0.5 text-[9px] font-black uppercase rounded tracking-wider inline-flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity ${
                                      task.activeExceptions.some(ex => ex.severity === 'critical')
                                        ? 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse'
                                        : task.activeExceptions.some(ex => ex.severity === 'high')
                                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                        : 'bg-orange-50 text-orange-700 border border-orange-200'
                                    }`}
                                    title={`Click to view ${task.activeExceptions.length} active exception(s)`}
                                  >
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                    <span>{task.activeExceptions[0].type.replace('_', ' ')} ({task.activeExceptions.length})</span>
                                  </span>
                                )}

                                {/* Assigned to You chip */}
                                {isMyTask && (
                                  <span className="px-2 py-0.5 bg-brand-primary/20 text-slate-900 text-[9px] font-extrabold uppercase rounded tracking-wider">
                                    Assigned to You
                                  </span>
                                )}

                                {/* Sub-tasks count badge */}
                                {subTasks.length > 0 && (
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                    completedSubTasks === subTasks.length
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}>
                                    <CheckSquare className="w-3 h-3" />
                                    <span>{completedSubTasks}/{subTasks.length} sub-tasks</span>
                                  </span>
                                )}

                                {/* Meeting Source Linkage Badge */}
                                {task.sourceType === 'meeting_decision' && (
                                  <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 text-[9px] font-black uppercase rounded tracking-wider inline-flex items-center gap-1" title={task.sourceDecisionId ? `Decision: ${task.sourceDecisionId}` : 'Meeting Decision'}>
                                    <Sparkles className="w-2.5 h-2.5 text-purple-600" />
                                    <span>From Decision</span>
                                  </span>
                                )}
                                {task.sourceType === 'meeting_action_item' && (
                                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-[9px] font-black uppercase rounded tracking-wider inline-flex items-center gap-1" title={task.sourceActionItem || 'Meeting Action Item'}>
                                    <CheckCircle2 className="w-2.5 h-2.5 text-indigo-600" />
                                    <span>Action Item</span>
                                  </span>
                                )}
                                {task.isAiSuggested && (
                                  <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-black uppercase rounded tracking-wider inline-flex items-center gap-1">
                                    <span>AI Suggested</span>
                                    <button
                                      type="button"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        try {
                                          const token = await userProfile?.getIdToken?.();
                                          const res = await fetch(`/api/tasks/${task.id}`, {
                                            method: 'PATCH',
                                            headers: {
                                              'Content-Type': 'application/json',
                                              ...(token ? { Authorization: `Bearer ${token}` } : {})
                                            },
                                            body: JSON.stringify({ acceptAiSuggested: true })
                                          });
                                          const data = await res.json().catch(() => ({}));
                                          if (!res.ok) {
                                            throw new Error(data.message || data.error || "Failed to accept suggestion");
                                          }
                                          toast.success("Accepted AI suggestion as project task!");
                                        } catch (err: any) {
                                          toast.error(err.message || "Failed to accept suggestion");
                                        }
                                      }}
                                      className="ml-1 px-1.5 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[8px] font-black uppercase transition-all"
                                    >
                                      Accept
                                    </button>
                                  </span>
                                )}
                              </div>

                              {/* Collapsed view short description (if collapsed) */}
                              {!isExpanded && task.description && (
                                <p className="text-xs text-slate-500 line-clamp-1">{task.description}</p>
                              )}

                              {/* Sub-meta: Assignee & Due Date Quick Control */}
                              <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px] text-slate-500">
                                <div 
                                  onClick={(e) => e.stopPropagation()} 
                                  className="flex items-center gap-1.5 font-medium"
                                >
                                  <span className="text-slate-400">Assignee:</span>
                                  <select
                                    value={task.assigneeEmail || ''}
                                    onChange={(e) => handleReassignTask(task.id, e.target.value)}
                                    className="bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded px-1.5 py-0.5 text-[11px] font-bold text-slate-800 outline-none cursor-pointer transition-colors"
                                    title="Reassign member to send automatic in-app notification"
                                  >
                                    {userProfile?.email && (
                                      <option value={userProfile.email}>You ({userProfile.displayName || userProfile.email.split('@')[0]})</option>
                                    )}
                                    {activeProject.ownerEmail && activeProject.ownerEmail.toLowerCase() !== userProfile?.email?.toLowerCase() && (
                                      <option value={activeProject.ownerEmail}>{activeProject.ownerEmail.split('@')[0]} (Owner)</option>
                                    )}
                                    {members.filter(m => m.email?.toLowerCase() !== userProfile?.email?.toLowerCase() && m.email?.toLowerCase() !== activeProject.ownerEmail?.toLowerCase()).map(m => (
                                      <option key={m.uid || m.email} value={m.email}>{m.displayName || m.email.split('@')[0]} ({m.email})</option>
                                    ))}
                                    {task.assigneeEmail && 
                                      task.assigneeEmail.toLowerCase() !== userProfile?.email?.toLowerCase() && 
                                      task.assigneeEmail.toLowerCase() !== activeProject.ownerEmail?.toLowerCase() && 
                                      !members.some(m => m.email.toLowerCase() === task.assigneeEmail.toLowerCase()) && (
                                      <option value={task.assigneeEmail}>{task.assigneeName || task.assigneeEmail}</option>
                                    )}
                                  </select>
                                </div>

                                {/* Start Date Display / Inline Edit */}
                                <div 
                                  onClick={(e) => e.stopPropagation()} 
                                  className="flex items-center gap-1.5"
                                >
                                  {editingStartDateTaskId === task.id ? (
                                    <div className="flex items-center gap-1 bg-white border border-slate-300 rounded px-1.5 py-0.5 shadow-sm">
                                      <Calendar className="w-3 h-3 text-slate-400" />
                                      <input
                                        type="date"
                                        defaultValue={task.startDate || ''}
                                        onChange={(e) => handleUpdateStartDate(task.id, e.target.value)}
                                        className="text-[11px] font-medium text-slate-800 outline-none bg-transparent"
                                      />
                                      {task.startDate && (
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateStartDate(task.id, '')}
                                          className="text-[10px] text-red-500 hover:text-red-700 font-bold px-1"
                                          title="Remove start date"
                                        >
                                          Clear
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setEditingStartDateTaskId(null)}
                                        className="text-[10px] text-slate-500 hover:text-slate-800 font-bold px-1"
                                      >
                                        Done
                                      </button>
                                    </div>
                                  ) : task.startDate ? (
                                    <button
                                      type="button"
                                      onClick={() => setEditingStartDateTaskId(task.id)}
                                      className="flex items-center gap-1 font-medium hover:bg-slate-100 px-1.5 py-0.5 rounded transition-colors text-slate-700"
                                      title="Click to edit start date"
                                    >
                                      <Calendar className="w-3 h-3 text-indigo-500" />
                                      <span>Starts: {new Date(task.startDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                      <Edit2 className="w-2.5 h-2.5 opacity-50 hover:opacity-100 ml-0.5 text-slate-500" />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setEditingStartDateTaskId(task.id)}
                                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 hover:bg-slate-100 px-1.5 py-0.5 rounded transition-colors"
                                      title="Add start date"
                                    >
                                      <Calendar className="w-3 h-3 text-slate-400" />
                                      <span>+ Start Date</span>
                                    </button>
                                  )}
                                </div>

                                {/* Due Date Display / Inline Edit */}
                                <div 
                                  onClick={(e) => e.stopPropagation()} 
                                  className="flex items-center gap-1.5"
                                >
                                  {isEditingDueDate ? (
                                    <div className="flex items-center gap-1 bg-white border border-slate-300 rounded px-1.5 py-0.5 shadow-sm">
                                      <CalendarClock className="w-3 h-3 text-slate-400" />
                                      <input
                                        type="date"
                                        defaultValue={task.dueDate || ''}
                                        onChange={(e) => handleUpdateDueDate(task.id, e.target.value)}
                                        className="text-[11px] font-medium text-slate-800 outline-none bg-transparent"
                                      />
                                      {task.dueDate && (
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateDueDate(task.id, '')}
                                          className="text-[10px] text-red-500 hover:text-red-700 font-bold px-1"
                                          title="Remove due date"
                                        >
                                          Clear
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setEditingDueDateTaskId(null)}
                                        className="text-[10px] text-slate-500 hover:text-slate-800 font-bold px-1"
                                      >
                                        Done
                                      </button>
                                    </div>
                                  ) : task.dueDate ? (
                                    <button
                                      type="button"
                                      onClick={() => setEditingDueDateTaskId(task.id)}
                                      className={`flex items-center gap-1 font-medium hover:bg-slate-100 px-1.5 py-0.5 rounded transition-colors ${
                                        isOverdue ? 'text-red-600 font-bold' : 'text-slate-700'
                                      }`}
                                      title="Click to edit due date"
                                    >
                                      <CalendarClock className="w-3 h-3 text-slate-400" />
                                      <span>Due: {new Date(task.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                      {isOverdue && <span className="text-[10px] uppercase font-black tracking-tight text-red-600 bg-red-50 px-1.5 py-0.5 rounded">(Overdue)</span>}
                                      {!isOverdue && task.dueDate && new Date(task.dueDate).getTime() >= todayStartMs && new Date(task.dueDate).getTime() <= threeDaysAheadMs && (
                                        <span className="text-[10px] uppercase font-black tracking-tight text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">(Due Soon)</span>
                                      )}
                                      <Edit2 className="w-2.5 h-2.5 opacity-50 hover:opacity-100 ml-0.5 text-slate-500" />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setEditingDueDateTaskId(task.id)}
                                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 hover:bg-slate-100 px-1.5 py-0.5 rounded transition-colors"
                                      title="Add due date"
                                    >
                                      <CalendarClock className="w-3 h-3 text-slate-400" />
                                      <span>+ Due Date</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Right: Status Dropdown & Actions */}
                          <div 
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-2 self-end sm:self-center shrink-0"
                          >
                            <select
                              value={task.status}
                              onChange={(e) => handleUpdateTaskStatusSelect(task.id, e.target.value as any)}
                              className={`text-xs font-bold rounded-lg px-2.5 py-1.5 border outline-none cursor-pointer transition-all uppercase tracking-wider ${
                                task.status === 'completed'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : task.status === 'in_progress'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}
                            >
                              <option value="pending">Pending</option>
                              <option value="in_progress">In Progress</option>
                              <option value="completed">Completed</option>
                            </select>

                            <button
                              type="button"
                              onClick={() => handleOpenRaiseModal(task)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Flag task obstacle or exception (Step 3.5)"
                            >
                              <AlertTriangle className="w-4 h-4 text-rose-500" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenScheduleFollowUpModal(task.id, undefined, `Follow-up: ${task.title}`)}
                              className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Schedule follow-up meeting for this task (Step 3.6)"
                            >
                              <CalendarClock className="w-4 h-4 text-purple-500" />
                            </button>

                            {(userRole === 'owner' || task.createdBy === userProfile?.uid) && (
                              <button
                                type="button"
                                onClick={() => handleDeleteTask(task.id, task.title)}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete Task"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Expanded Drawer: Description, Sub-tasks, Due Date Editor & Activity History */}
                        {isExpanded && (
                          <div className="border-t border-slate-200 bg-slate-50/50 p-4 sm:p-5 space-y-5 animate-in fade-in duration-200">
                            {/* Section 1: Full Description */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                                  <span>Task Description</span>
                                </h4>
                                {!isEditingDescription && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTempDescriptions(prev => ({ ...prev, [task.id]: task.description || '' }));
                                      setEditingDescriptionTaskId(task.id);
                                    }}
                                    className="text-xs font-bold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 hover:underline"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                    <span>{task.description ? 'Edit Description' : 'Add Description'}</span>
                                  </button>
                                )}
                              </div>

                              {isEditingDescription ? (
                                <div className="space-y-2 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                                  <textarea
                                    rows={3}
                                    value={tempDescriptions[task.id] ?? (task.description || '')}
                                    onChange={(e) => setTempDescriptions(prev => ({ ...prev, [task.id]: e.target.value }))}
                                    placeholder="Provide detailed instructions, meeting notes reference, or requirements..."
                                    className="w-full text-xs text-slate-800 outline-none border border-slate-200 rounded p-2 focus:ring-1 focus:ring-brand-primary"
                                  />
                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setEditingDescriptionTaskId(null)}
                                      className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 font-bold"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateDescription(task.id, tempDescriptions[task.id] || '')}
                                      className="px-3 py-1 bg-slate-900 text-white rounded text-xs font-bold hover:bg-slate-800"
                                    >
                                      Save Description
                                    </button>
                                  </div>
                                </div>
                              ) : task.description ? (
                                <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                                  {task.description}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400 italic">No description provided yet.</p>
                              )}
                            </div>

                              {/* Section 1.5: Task Dependencies */}
                            <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-3.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                                  <GitMerge className="w-4 h-4 text-indigo-600" />
                                  <span>Task Dependencies</span>
                                </span>
                                <div>
                                  {task.dependencyStatus === 'blocked' && (
                                    <span className="px-2 py-0.5 bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-black uppercase rounded flex items-center gap-1">
                                      <Lock className="w-3 h-3 text-rose-500" />
                                      <span>Blocked ({task.blockingPrerequisites?.length || 1} incomplete prerequisite{(task.blockingPrerequisites?.length || 1) === 1 ? '' : 's'})</span>
                                    </span>
                                  )}
                                  {task.dependencyStatus === 'ready' && (
                                    <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase rounded flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>Ready to execute</span>
                                    </span>
                                  )}
                                  {task.dependencyStatus === 'completed' && (
                                    <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-black uppercase rounded flex items-center gap-1">
                                      <CheckCircle className="w-3 h-3 text-slate-500" />
                                      <span>Completed</span>
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Incomplete blocking prerequisite alert explanation */}
                              {task.dependencyStatus === 'blocked' && task.blockingPrerequisites && task.blockingPrerequisites.length > 0 && (
                                <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-lg space-y-1.5 text-xs">
                                  <p className="font-bold text-rose-800 flex items-center gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                                    <span>This task is blocked until the following prerequisite tasks are completed:</span>
                                  </p>
                                  <ul className="list-disc pl-5 text-rose-700 space-y-0.5 text-[11px]">
                                    {task.blockingPrerequisites.map(bp => (
                                      <li key={bp.id}>
                                        <span className="font-bold">{bp.title}</span>
                                        <span className="ml-1.5 px-1.5 py-0.2 bg-rose-100 rounded text-[9px] uppercase font-bold text-rose-800">
                                          {bp.status.replace('_', ' ')}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                  <div className="pt-1">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenRaiseModal(task, 'dependency_issue')}
                                      className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-bold inline-flex items-center gap-1 transition-colors shadow-xs"
                                    >
                                      <AlertTriangle className="w-3 h-3" />
                                      <span>Flag Dependency Exception</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Prerequisites List & Management */}
                              <div className="space-y-2">
                                <label className="block text-[11px] font-bold text-slate-600 uppercase">
                                  Prerequisites (Tasks that must finish before this task can start)
                                </label>

                                {(!task.prerequisiteTaskIds || task.prerequisiteTaskIds.length === 0) ? (
                                  <p className="text-xs text-slate-400 italic">No prerequisites defined. This task can be worked on immediately.</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {task.prerequisiteTaskIds.map(prereqId => {
                                      const prereqTask = tasks.find(t => t.id === prereqId);
                                      const isPrereqDone = prereqTask?.status === 'completed';
                                      return (
                                        <div 
                                          key={prereqId} 
                                          className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition-colors ${
                                            isPrereqDone 
                                              ? 'bg-slate-50 border-slate-200 text-slate-500' 
                                              : 'bg-amber-50/50 border-amber-200 text-slate-800'
                                          }`}
                                        >
                                          <div className="flex items-center gap-2 min-w-0 flex-1">
                                            {isPrereqDone ? (
                                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                            ) : (
                                              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                                            )}
                                            <span className={`font-bold truncate ${isPrereqDone ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                              {prereqTask?.title || prereqId}
                                            </span>
                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase shrink-0 ${
                                              isPrereqDone 
                                                ? 'bg-emerald-100 text-emerald-800' 
                                                : prereqTask?.status === 'in_progress' 
                                                ? 'bg-blue-100 text-blue-800' 
                                                : 'bg-amber-100 text-amber-800'
                                            }`}>
                                              {prereqTask ? prereqTask.status.replace('_', ' ') : 'Unknown'}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                            {!isPrereqDone && prereqTask && (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  if (isDemoProject && demoContext) {
                                                    demoContext.updateTaskStatus(prereqId, 'completed');
                                                  } else {
                                                    handleUpdateTaskStatusSelect(prereqId, 'completed');
                                                  }
                                                  toast.success(`Completed prerequisite: "${prereqTask.title}"!`);
                                                }}
                                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold transition-all flex items-center gap-1 shadow-xs"
                                                title="Mark this prerequisite as completed to unblock the dependent task"
                                              >
                                                <Check className="w-3 h-3" />
                                                <span>Complete Prereq</span>
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => handleRemovePrerequisite(task.id, prereqId)}
                                              className="px-2 py-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded text-[11px] font-bold transition-colors"
                                              title="Remove prerequisite"
                                            >
                                              Remove
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {/* Add prerequisite selector */}
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  <select
                                    defaultValue=""
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        handleAddPrerequisite(task.id, e.target.value);
                                        e.target.value = "";
                                      }
                                    }}
                                    className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500 max-w-sm"
                                  >
                                    <option value="" disabled>+ Add Prerequisite Task...</option>
                                    {tasks
                                      .filter(t => t.id !== task.id && !(task.prerequisiteTaskIds || []).includes(t.id))
                                      .map(candidate => (
                                        <option key={candidate.id} value={candidate.id}>
                                          {candidate.title} ({candidate.status.replace('_', ' ')})
                                        </option>
                                      ))}
                                  </select>
                                </div>
                              </div>

                              {/* Downstream Dependents Section */}
                              {task.dependentTaskIds && task.dependentTaskIds.length > 0 && (
                                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                                  <label className="block text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                                    <CornerDownRight className="w-3 h-3 text-slate-400" />
                                    <span>Downstream Dependents (Tasks waiting on this task)</span>
                                  </label>
                                  <div className="flex flex-wrap gap-1.5">
                                    {task.dependentTaskIds.map(depId => {
                                      const depTask = tasks.find(t => t.id === depId);
                                      return (
                                        <span 
                                          key={depId} 
                                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-700 text-[11px] font-medium border border-slate-200"
                                        >
                                          <span className="font-bold">{depTask?.title || depId}</span>
                                          <span className="text-[9px] uppercase opacity-75">({depTask?.status.replace('_', ' ') || 'pending'})</span>
                                        </span>
                                      );
                                    })}
                                  </div>
                                  <div className="pt-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenDeadlinePropagationPreview(task, {
                                        startDate: task.startDate || undefined,
                                        dueDate: task.dueDate || undefined
                                      })}
                                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition-colors"
                                      title="Calculate and preview how this task's dates propagate to downstream dependent tasks"
                                    >
                                      <CalendarClock className="w-3.5 h-3.5 text-indigo-600" />
                                      <span>Propagate Schedule to Dependents</span>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Section 2: Task Timeline & Scheduling Details */}
                            <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                                  <Calendar className="w-4 h-4 text-emerald-600" />
                                  <span>Task Scheduling & Timeline</span>
                                </span>
                                {task.dueDate && isOverdue && (
                                  <span className="text-[10px] font-black uppercase tracking-wide text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                                    Overdue by {Math.ceil((Date.now() - new Date(task.dueDate).getTime()) / (1000 * 60 * 60 * 24))} days
                                  </span>
                                )}
                                {!isOverdue && task.dueDate && new Date(task.dueDate).getTime() >= todayStartMs && new Date(task.dueDate).getTime() <= threeDaysAheadMs && (
                                  <span className="text-[10px] font-black uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                    Approaching Due Date (Next 3 Days)
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                                {/* Start Date Drawer Field */}
                                <div className="space-y-1">
                                  <label className="block text-[11px] font-bold text-slate-600 uppercase">Start Date</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="date"
                                      value={task.startDate || ''}
                                      onChange={(e) => handleUpdateStartDate(task.id, e.target.value)}
                                      className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-800 outline-none focus:ring-1 focus:ring-brand-primary w-full"
                                    />
                                    {task.startDate && (
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateStartDate(task.id, '')}
                                        className="px-2 py-1.5 text-red-600 hover:bg-red-50 text-[11px] font-bold rounded shrink-0 border border-red-100"
                                      >
                                        Clear
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Due Date Drawer Field */}
                                <div className="space-y-1">
                                  <label className="block text-[11px] font-bold text-slate-600 uppercase">Due Date</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="date"
                                      value={task.dueDate || ''}
                                      onChange={(e) => handleUpdateDueDate(task.id, e.target.value)}
                                      className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-800 outline-none focus:ring-1 focus:ring-brand-primary w-full"
                                    />
                                    {task.dueDate && (
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateDueDate(task.id, '')}
                                        className="px-2 py-1.5 text-red-600 hover:bg-red-50 text-[11px] font-bold rounded shrink-0 border border-red-100"
                                      >
                                        Clear
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Quick Presets for Due Date */}
                              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Quick Due:</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const todayStr = new Date().toISOString().split('T')[0];
                                    handleUpdateDueDate(task.id, todayStr);
                                  }}
                                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded"
                                >
                                  Today
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const tomorrow = new Date();
                                    tomorrow.setDate(tomorrow.getDate() + 1);
                                    handleUpdateDueDate(task.id, tomorrow.toISOString().split('T')[0]);
                                  }}
                                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded"
                                >
                                  Tomorrow
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextWeek = new Date();
                                    nextWeek.setDate(nextWeek.getDate() + 7);
                                    handleUpdateDueDate(task.id, nextWeek.toISOString().split('T')[0]);
                                  }}
                                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold rounded"
                                >
                                  In 1 Week
                                </button>
                              </div>
                            </div>

                            {/* Section 3: Sub-tasks Checklist */}
                            <div className="space-y-2.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <CheckSquare className="w-4 h-4 text-slate-600" />
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Sub-tasks</h4>
                                  <span className="text-[11px] font-bold text-slate-500">
                                    ({completedSubTasks} of {subTasks.length} completed)
                                  </span>
                                </div>
                              </div>

                              {/* Progress bar */}
                              {subTasks.length > 0 && (
                                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                  <div 
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.round((completedSubTasks / subTasks.length) * 100)}%` }}
                                  />
                                </div>
                              )}

                              {/* Sub-tasks list */}
                              {subTasks.length > 0 && (
                                <div className="space-y-1.5">
                                  {subTasks.map((st) => (
                                    <div 
                                      key={st.id}
                                      className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
                                    >
                                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                        <button
                                          type="button"
                                          onClick={() => handleToggleSubTask(task.id, st.id)}
                                          className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${
                                            st.completed
                                              ? 'bg-emerald-500 border-emerald-600 text-white'
                                              : 'border-slate-300 bg-white hover:border-emerald-500 text-transparent'
                                          }`}
                                          title={st.completed ? "Mark sub-task as incomplete" : "Mark sub-task as complete"}
                                        >
                                          <Check className="w-3 h-3 stroke-[3]" />
                                        </button>
                                        <span className={`text-xs truncate ${st.completed ? 'line-through text-slate-400' : 'text-slate-800 font-medium'}`}>
                                          {st.title}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteSubTask(task.id, st.id)}
                                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                        title="Delete sub-task"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Add Sub-task inline input */}
                              <div className="flex items-center gap-2 pt-1">
                                <input
                                  type="text"
                                  placeholder="Add a sub-task item..."
                                  value={newSubTaskTitles[task.id] || ''}
                                  onChange={(e) => setNewSubTaskTitles(prev => ({ ...prev, [task.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleAddSubTask(task.id);
                                    }
                                  }}
                                  className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-brand-primary"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleAddSubTask(task.id)}
                                  disabled={!(newSubTaskTitles[task.id] || '').trim()}
                                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-40 shrink-0 inline-flex items-center gap-1"
                                >
                                  <Plus className="w-3 h-3" />
                                  <span>Add</span>
                                </button>
                              </div>
                            </div>

                            {/* Section 4: Activity History */}
                            <div className="space-y-2 pt-2 border-t border-slate-200">
                              <div className="flex items-center gap-2">
                                <History className="w-3.5 h-3.5 text-slate-500" />
                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Activity History</h4>
                                <span className="text-[10px] text-slate-400">({task.activityHistory?.length || 0} events)</span>
                              </div>

                              {(!task.activityHistory || task.activityHistory.length === 0) ? (
                                <p className="text-xs text-slate-400 italic">No activity records logged yet.</p>
                              ) : (
                                <div className="space-y-2 pl-2 border-l-2 border-slate-200">
                                  {task.activityHistory.slice(-5).reverse().map((act) => (
                                    <div key={act.id} className="relative pl-3 text-xs space-y-0.5">
                                      <div className="absolute -left-[17px] top-1 w-2 h-2 rounded-full bg-slate-400 border-2 border-slate-50" />
                                      <div className="flex items-center gap-2">
                                        <span className="font-bold text-slate-800">{act.performedBy}</span>
                                        <span className="text-[10px] text-slate-400">
                                          {getRelativeTime(act.timestamp)}
                                        </span>
                                      </div>
                                      <p className="text-slate-600 text-[11px]">{act.details || act.action.replace('_', ' ')}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Member Task Workload Summary Chart (Pending vs Completed) using Recharts */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Member Task Breakdown</h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Pending vs. Completed
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Summary chart of pending and completed tasks per project member in <span className="font-bold text-slate-700 uppercase">{activeProject.name}</span>
                  </p>
                </div>

                {/* View toggle (Grouped vs Stacked) */}
                <div className="flex items-center gap-2 self-start sm:self-center">
                  <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setChartMode('grouped')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        chartMode === 'grouped'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Side-by-Side
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartMode('stacked')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        chartMode === 'stacked'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Stacked
                    </button>
                  </div>
                </div>
              </div>

              {/* Metric Highlights Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Tasks</p>
                  <p className="text-xl font-black text-slate-900 mt-0.5">{tasks.length}</p>
                </div>
                <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200/60">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Pending</p>
                  <p className="text-xl font-black text-amber-900 mt-0.5">
                    {tasks.filter(t => t.status !== 'completed').length}
                  </p>
                </div>
                <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/60">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Completed</p>
                  <p className="text-xl font-black text-emerald-900 mt-0.5">
                    {tasks.filter(t => t.status === 'completed').length}
                  </p>
                </div>
                <div className="p-3 bg-indigo-50/70 rounded-xl border border-indigo-200/60">
                  <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Completion Rate</p>
                  <p className="text-xl font-black text-indigo-900 mt-0.5">
                    {tasks.length > 0 ? Math.round((tasks.filter(t => t.status === 'completed').length / tasks.length) * 100) : 0}%
                  </p>
                </div>
              </div>

              {/* Recharts BarChart */}
              {tasks.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
                    <BarChart3 className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-700">No Task Data Available Yet</p>
                    <p className="text-xs text-slate-400 max-w-sm">
                      Create and assign tasks to team members above to see workload distribution and completion analytics here.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddTask(true)}
                    className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-colors"
                  >
                    + Assign First Task
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="w-full h-64 sm:h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={memberTaskStats}
                        margin={{ top: 12, right: 12, left: -20, bottom: 28 }}
                        barGap={6}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                        <XAxis
                          dataKey="shortName"
                          tick={{ fontSize: 11, fill: '#475569', fontWeight: 700 }}
                          tickLine={false}
                          axisLine={{ stroke: '#E2E8F0' }}
                          interval={0}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: '#94A3B8', fontWeight: 600 }}
                          tickLine={false}
                          axisLine={{ stroke: '#E2E8F0' }}
                        />
                        <RechartsTooltip
                          content={<CustomMemberTaskTooltip />}
                          cursor={{ fill: 'rgba(241, 245, 249, 0.6)' }}
                        />
                        <Legend
                          verticalAlign="top"
                          align="right"
                          wrapperStyle={{ paddingBottom: 12, fontSize: 12, fontWeight: 700 }}
                          iconType="circle"
                          formatter={(value) => (
                            <span className="text-xs font-bold text-slate-700 capitalize">
                              {value === 'pending' ? 'Pending Tasks' : 'Completed Tasks'}
                            </span>
                          )}
                        />
                        <Bar
                          dataKey="pending"
                          name="pending"
                          fill="#F59E0B"
                          radius={chartMode === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                          stackId={chartMode === 'stacked' ? 'tasks' : undefined}
                          maxBarSize={40}
                          onClick={(entry: any) => {
                            const email = entry?.email || entry?.payload?.email;
                            if (email) {
                              setMemberFilter(memberFilter?.toLowerCase() === email.toLowerCase() ? null : email);
                            }
                          }}
                          className="cursor-pointer transition-opacity hover:opacity-85"
                        />
                        <Bar
                          dataKey="completed"
                          name="completed"
                          fill="#10B981"
                          radius={[4, 4, 0, 0]}
                          stackId={chartMode === 'stacked' ? 'tasks' : undefined}
                          maxBarSize={40}
                          onClick={(entry: any) => {
                            const email = entry?.email || entry?.payload?.email;
                            if (email) {
                              setMemberFilter(memberFilter?.toLowerCase() === email.toLowerCase() ? null : email);
                            }
                          }}
                          className="cursor-pointer transition-opacity hover:opacity-85"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Interactive Member Quick-Filter Chips */}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">Filter by:</span>
                    <button
                      type="button"
                      onClick={() => setMemberFilter(null)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        !memberFilter
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      All ({tasks.length})
                    </button>
                    {memberTaskStats.map(stat => (
                      <button
                        key={stat.email}
                        type="button"
                        onClick={() => setMemberFilter(memberFilter?.toLowerCase() === stat.email.toLowerCase() ? null : stat.email)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                          memberFilter?.toLowerCase() === stat.email.toLowerCase()
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                        title={`Click to filter tasks for ${stat.shortName}`}
                      >
                        <span>{stat.shortName}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                          memberFilter?.toLowerCase() === stat.email.toLowerCase()
                            ? 'bg-indigo-700 text-white'
                            : 'bg-slate-200 text-slate-700'
                        }`}>
                          {stat.pending}P / {stat.completed}C
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Team Members List */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-slate-700" />
                    <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Project Members</h2>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">Collaborating in <span className="font-bold text-slate-700 uppercase">{activeProject.name}</span></p>
                </div>
                <div className="px-3 py-1 bg-slate-100 rounded-lg text-xs font-bold text-slate-600">
                  {members.length + 1} Active
                </div>
              </div>

              {/* Members Row-based List */}
              <div className="space-y-4">
                {/* Always Show Project Owner first */}
                {(() => {
                  const ownerPendingCount = tasks.filter(t => t.assigneeEmail?.toLowerCase() === activeProject.ownerEmail?.toLowerCase() && t.status !== 'completed').length;
                  const ownerCompletedCount = tasks.filter(t => t.assigneeEmail?.toLowerCase() === activeProject.ownerEmail?.toLowerCase() && t.status === 'completed').length;
                  const ownerTotalCount = ownerPendingCount + ownerCompletedCount;

                  return (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200/60 gap-3">
                      <div className="flex items-start gap-4">
                        <div className="relative mt-0.5">
                          <div className="w-11 h-11 bg-brand-secondary text-white rounded-xl flex items-center justify-center font-black text-base shadow-inner uppercase">
                            {activeProject.ownerEmail?.charAt(0) || 'O'}
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-slate-50 flex items-center justify-center" title="Online" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-extrabold text-sm text-slate-900">
                              {activeProject.ownerEmail === userProfile?.email ? 'You' : activeProject.ownerEmail?.split('@')[0]}
                            </p>
                            <span className="px-2 py-0.5 bg-brand-secondary text-slate-800 border border-brand-primary/20 text-[9px] font-black uppercase rounded tracking-wider">Owner</span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium">{activeProject.ownerEmail}</p>

                          {/* Mini-summary of Pending vs Completed tasks */}
                          {ownerTotalCount > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                              <button
                                type="button"
                                onClick={() => { setMemberFilter(activeProject.ownerEmail); setTaskFilter('pending'); }}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                  memberFilter?.toLowerCase() === activeProject.ownerEmail?.toLowerCase() && taskFilter === 'pending'
                                    ? 'bg-amber-500 text-white'
                                    : ownerPendingCount > 0
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200/80 hover:bg-amber-100'
                                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                }`}
                                title="Filter pending tasks for owner"
                              >
                                <Clock className="w-2.5 h-2.5" />
                                <span>{ownerPendingCount} Pending</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => { setMemberFilter(activeProject.ownerEmail); setTaskFilter('completed'); }}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                  memberFilter?.toLowerCase() === activeProject.ownerEmail?.toLowerCase() && taskFilter === 'completed'
                                    ? 'bg-emerald-600 text-white'
                                    : ownerCompletedCount > 0
                                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80 hover:bg-emerald-100'
                                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                }`}
                                title="Filter completed tasks for owner"
                              >
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                <span>{ownerCompletedCount} Completed</span>
                              </button>

                              <div className="flex items-center gap-1.5 ml-1 text-[10px] text-slate-500 font-medium">
                                <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                  <div 
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.round((ownerCompletedCount / ownerTotalCount) * 100)}%` }}
                                  />
                                </div>
                                <span>{Math.round((ownerCompletedCount / ownerTotalCount) * 100)}%</span>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[10px] text-slate-400 mt-1">No assigned tasks</p>
                          )}
                        </div>
                      </div>
                      <div className="text-right self-end sm:self-center">
                        <p className="text-xs font-bold text-emerald-600">Active Now</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Project Creator</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Additional members fetched from projectMembers collection */}
                {loadingMembers ? (
                  <div className="flex justify-center py-6">
                    <div className="w-6 h-6 border-2 border-echo-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : members.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    No invited team members yet.
                  </div>
                ) : (
                  members.map((member, i) => {
                    const isOnline = isUserOnline(member.lastActive);
                    const memberPendingCount = tasks.filter(t => t.assigneeEmail?.toLowerCase() === member.email?.toLowerCase() && t.status !== 'completed').length;
                    const memberCompletedCount = tasks.filter(t => t.assigneeEmail?.toLowerCase() === member.email?.toLowerCase() && t.status === 'completed').length;
                    const memberTotalCount = memberPendingCount + memberCompletedCount;

                    return (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white hover:bg-slate-50 rounded-xl border border-slate-100 transition-colors gap-3">
                        <div className="flex items-start gap-4">
                          <div className="relative mt-0.5">
                            <div className="w-11 h-11 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center font-black text-base border border-slate-200 uppercase">
                              {member.email?.charAt(0) || 'M'}
                            </div>
                            <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                              isOnline ? 'bg-emerald-500' : 'bg-slate-300'
                            }`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-extrabold text-sm text-slate-900">
                                {member.email === userProfile?.email ? 'You' : member.displayName || member.email?.split('@')[0]}
                              </p>
                              <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded tracking-wider ${
                                member.role === 'owner' ? 'bg-brand-secondary text-slate-800 border border-brand-primary/20' :
                                member.role === 'admin' || member.role === 'editor' ? 'bg-blue-100 text-blue-800' :
                                member.role === 'commenter' ? 'bg-amber-100 text-amber-800' :
                                'bg-slate-100 text-slate-700'
                              }`}>
                                {member.role === 'editor' ? 'Admin' : member.role === 'admin' ? 'Project Admin' : member.role}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 font-medium">{member.email}</p>

                            {/* Mini-summary of Pending vs Completed tasks */}
                            {memberTotalCount > 0 ? (
                              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                <button
                                  type="button"
                                  onClick={() => { setMemberFilter(member.email); setTaskFilter('pending'); }}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                    memberFilter?.toLowerCase() === member.email?.toLowerCase() && taskFilter === 'pending'
                                      ? 'bg-amber-500 text-white'
                                      : memberPendingCount > 0
                                      ? 'bg-amber-50 text-amber-800 border border-amber-200/80 hover:bg-amber-100'
                                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                  }`}
                                  title="Filter pending tasks for member"
                                >
                                  <Clock className="w-2.5 h-2.5" />
                                  <span>{memberPendingCount} Pending</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => { setMemberFilter(member.email); setTaskFilter('completed'); }}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                    memberFilter?.toLowerCase() === member.email?.toLowerCase() && taskFilter === 'completed'
                                      ? 'bg-emerald-600 text-white'
                                      : memberCompletedCount > 0
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80 hover:bg-emerald-100'
                                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                  }`}
                                  title="Filter completed tasks for member"
                                >
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  <span>{memberCompletedCount} Completed</span>
                                </button>

                                <div className="flex items-center gap-1.5 ml-1 text-[10px] text-slate-500 font-medium">
                                  <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                                      style={{ width: `${Math.round((memberCompletedCount / memberTotalCount) * 100)}%` }}
                                    />
                                  </div>
                                  <span>{Math.round((memberCompletedCount / memberTotalCount) * 100)}%</span>
                                </div>
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-400 mt-1">No assigned tasks</p>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-4 text-right">
                          <div>
                            <p className={`text-xs font-bold ${isOnline ? 'text-emerald-600 animate-pulse' : 'text-slate-600'}`}>
                              {getRelativeTime(member.lastActive)}
                            </p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Last Active</p>
                          </div>
                          
                          {/* Owner can delete/remove member */}
                          {userRole === 'owner' && (
                            <button 
                              onClick={() => handleRemoveMember(member.uid, member.email, member.displayName || member.email)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Remove Team Member"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Invite New Team Members Form (Owner only) */}
            {userRole === 'owner' && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                <div className="space-y-0.5 border-b border-slate-100 pb-3">
                  <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Invite Team Member</h2>
                  <p className="text-xs text-slate-500">Add collaborators to this project in real-time.</p>
                </div>

                <form onSubmit={handleSendInvite} className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                      <label className="sr-only">Email address</label>
                      <input 
                        type="email"
                        required
                        placeholder="colleague@company.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-echo-accent/30 focus:border-slate-300 transition-all placeholder:text-slate-400"
                      />
                    </div>
                    
                    <div className="w-full sm:w-44">
                      <label className="sr-only">Access Level</label>
                      <div className="relative">
                        <select 
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as CollaborationRole)}
                          className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 outline-none hover:border-slate-300 transition-all cursor-pointer uppercase tracking-widest"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="commenter">Commenter</option>
                          <option value="admin">Project Admin</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 pointer-events-none" />
                      </div>
                    </div>

                    <button 
                      type="submit"
                      disabled={isInviting || !inviteEmail.trim()}
                      className="bg-brand-primary text-slate-900 hover:bg-[#4396F5] font-black uppercase text-xs tracking-widest px-6 py-3.5 rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>{isInviting ? 'Inviting...' : 'Send Invite'}</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Pending Team Invitations */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div className="space-y-0.5 border-b border-slate-100 pb-3">
                <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Pending Invitations</h2>
                <p className="text-xs text-slate-500">Outstanding invites that have not been accepted yet.</p>
              </div>

              {loadingInvites ? (
                <div className="flex justify-center py-6">
                  <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : invites.filter(inv => inv.status === 'pending').length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">
                  No pending invitations for this project.
                </div>
              ) : (
                <div className="space-y-3">
                  {invites.filter(inv => inv.status === 'pending').map((invite, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-amber-50/50 rounded-xl border border-amber-100 transition-all">
                      <div className="flex items-center gap-3">
                        <Mail className="text-amber-500 w-5 h-5 shrink-0" />
                        <div>
                          <p className="text-sm font-extrabold text-slate-900">{invite.email}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-black uppercase tracking-wider rounded">
                              {invite.role === 'editor' ? 'Member' : invite.role}
                            </span>
                            <span className="text-[10px] text-slate-500 font-bold">
                              Sent by {invite.invitedBy === userProfile?.email ? 'you' : invite.invitedBy?.split('@')[0]}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-amber-600 animate-pulse uppercase tracking-wider text-[10px]">Pending</span>
                        {userRole === 'owner' && (
                          <button 
                            onClick={() => handleRevokeInvite(invite.id, invite.email)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Cancel/Revoke Invitation"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Right Column: Activity Timeline */}
          <div className="space-y-8">
            
            {/* Real-time Project Activity Timeline */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="space-y-0.5">
                  <h2 className="text-lg font-black text-slate-950 uppercase tracking-tight">Activity Timeline</h2>
                  <p className="text-xs text-slate-500">Live workflow telemetry for <span className="font-bold text-slate-700 uppercase">{activeProject.name}</span></p>
                </div>
                <Activity className="text-slate-400 w-5 h-5" />
              </div>

              {loadingActivities ? (
                <div className="flex justify-center py-12">
                  <div className="w-6 h-6 border-2 border-echo-accent border-t-transparent rounded-full animate-spin" />
                </div>
              ) : finalTimeline.length === 0 ? (
                <div className="text-center py-16 text-slate-400 space-y-3">
                  <Clock className="w-10 h-10 mx-auto text-slate-300" />
                  <p className="text-sm font-semibold">No recent activities logged.</p>
                  <p className="text-xs text-slate-400 px-4">Timeline will record audio transcriptions, bookmarking, and team actions.</p>
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 max-h-[600px] overflow-y-auto custom-scrollbar pr-1">
                  {finalTimeline.slice(0, 20).map((activity, i) => {
                    // Determine beautiful icon based on actionType
                    let IconComponent = Clock;
                    let iconBg = 'bg-slate-100 text-slate-600';

                    if (activity.actionType === 'upload_file') {
                      IconComponent = FileAudio;
                      iconBg = 'bg-indigo-50 text-indigo-600';
                    } else if (activity.actionType === 'create_bookmark') {
                      IconComponent = Bookmark;
                      iconBg = 'bg-amber-50 text-amber-600';
                    } else if (activity.actionType === 'generate_decision') {
                      IconComponent = Brain;
                      iconBg = 'bg-purple-50 text-purple-600';
                    } else if (activity.actionType === 'invite_member') {
                      IconComponent = UserPlus;
                      iconBg = 'bg-blue-50 text-blue-600';
                    } else if (activity.actionType === 'create_task' || activity.actionType === 'update_task') {
                      IconComponent = ListTodo;
                      iconBg = 'bg-emerald-50 text-emerald-600';
                    } else if (activity.actionType === 'complete_task') {
                      IconComponent = CheckCircle2;
                      iconBg = 'bg-emerald-100 text-emerald-700';
                    } else if (activity.actionType === 'delete_task') {
                      IconComponent = Trash2;
                      iconBg = 'bg-rose-50 text-rose-600';
                    }

                    return (
                      <div key={activity.id || i} className="relative group">
                        {/* Timeline node icon */}
                        <div className={`absolute -left-[29px] top-0.5 w-6 h-6 rounded-lg ${iconBg} border border-white flex items-center justify-center shadow-sm z-10 scale-95 group-hover:scale-100 transition-transform`}>
                          <IconComponent className="w-3.5 h-3.5" />
                        </div>
                        
                        <div className="space-y-1">
                          <p className="text-xs text-slate-800 font-medium leading-relaxed">
                            {activity.description}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                              {activity.userName}
                            </span>
                            <span className="text-[10px] text-slate-300">•</span>
                            <span className="text-[10px] text-slate-400 font-medium">
                              {new Date(activity.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Permission Guidelines Info Card */}
            <div className="bg-brand-secondary text-slate-800 rounded-2xl p-6 space-y-4 border border-[#bce4ff] shadow-sm">
              <div className="flex items-center gap-2">
                <ShieldAlert className="text-brand-primary w-5 h-5 shrink-0" />
                <h3 className="font-extrabold text-sm uppercase tracking-wider text-slate-900">Security & Guidelines</h3>
              </div>
              <div className="space-y-3 text-xs text-slate-600 leading-relaxed font-medium">
                <p>
                  EchoNote enforces strict permission policies for workspace projects:
                </p>
                <ul className="space-y-2 list-disc list-inside text-slate-600">
                  <li><strong className="text-slate-900">Project Owners</strong> have complete administrative control, full telemetry visibility, and can invite/remove members.</li>
                  <li><strong className="text-slate-900">Members (Editors)</strong> can upload/transcribe files, bookmark notes, and view their own telemetry only.</li>
                  <li><strong className="text-slate-900">Viewers</strong> have secure read-only access to transcripts and general project analytics.</li>
                </ul>
              </div>
            </div>

          </div>

        </div>
          </>
        )}

      </div>

      {/* Automated Tagging Modal */}
      <AutomatedTaggingModal
        isOpen={isAutomatedTaggingOpen}
        onClose={() => setIsAutomatedTaggingOpen(false)}
        project={activeProject}
        tasks={tasks}
        members={allProjectMembers}
        recordings={filteredAudioRecords}
        currentUser={{
          uid: userProfile?.uid,
          email: userProfile?.email,
          displayName: userProfile?.displayName
        }}
        onSuccess={() => {
          toast.success("Task assignments successfully synchronized with transcript mentions!");
        }}
      />

      {/* AI Smart Recap Modal */}
      <SmartRecapModal
        isOpen={isSmartRecapOpen}
        onClose={() => setIsSmartRecapOpen(false)}
        recap={smartRecapData}
        recordingTitle={smartRecapTitle}
        isGenerating={isGeneratingRecap}
        onRegenerate={handleRegenerateRecap}
      />

      {/* AH.184 Executive Report Export Modal */}
      <ReportExportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        projectId={activeProject?.id}
        projectName={activeProject?.name}
        availableProjects={projects}
        availableMeetings={activeRecordings}
      />

      {/* Task Templates Browser / Preview / Apply Modal (Step 3.4) */}
      {showTemplatesModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center">
                  <LayoutTemplate className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Reusable Task Templates</h3>
                  <p className="text-xs text-slate-500">Apply standard task workflows or save new templates</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateTemplateModal(true)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Template</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTemplatesModal(false);
                    setSelectedTemplateForPreview(null);
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {loadingTemplates ? (
                <div className="flex justify-center py-12">
                  <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : taskTemplates.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl p-6 space-y-3">
                  <LayoutTemplate className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-sm font-bold text-slate-700">No task templates available yet</p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    Create reusable task templates with defined priorities, relative date offsets, and prerequisite workflows for this project or organization.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowCreateTemplateModal(true)}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-colors inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create First Template</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Template Picker Cards */}
                  <div className="grid grid-cols-1 gap-3">
                    {taskTemplates.map(tpl => {
                      const isSelected = selectedTemplateForPreview?.id === tpl.id;
                      return (
                        <div
                          key={tpl.id}
                          onClick={() => setSelectedTemplateForPreview(tpl)}
                          className={`p-4 rounded-xl border text-left cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-indigo-50/50 border-indigo-300 ring-2 ring-indigo-500/20'
                              : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-sm text-slate-900">{tpl.name}</span>
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                                  tpl.scope === 'organization'
                                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                                }`}>
                                  {tpl.scope}
                                </span>
                              </div>
                              {tpl.description && (
                                <p className="text-xs text-slate-500 line-clamp-1">{tpl.description}</p>
                              )}
                            </div>
                            <span className="text-xs font-bold text-slate-500 shrink-0 bg-slate-100 px-2 py-1 rounded">
                              {tpl.tasks?.length || 0} task{(tpl.tasks?.length || 0) === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Preview of Selected Template */}
                  {selectedTemplateForPreview && (
                    <div className="border border-indigo-100 bg-indigo-50/30 rounded-xl p-4 space-y-4 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
                        <div>
                          <h4 className="text-xs font-black uppercase tracking-wider text-indigo-900">
                            Template Preview: {selectedTemplateForPreview.name}
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            The following tasks and internal dependencies will be generated when applied:
                          </p>
                        </div>
                        <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                          {selectedTemplateForPreview.tasks.length} task definitions
                        </span>
                      </div>

                      {/* Tasks breakdown table */}
                      <div className="space-y-2">
                        {selectedTemplateForPreview.tasks.map((taskItem, idx) => {
                          const prereqs = (taskItem.prerequisiteTemplateItemIds || [])
                            .map(pid => selectedTemplateForPreview.tasks.find(t => t.id === pid)?.title || pid);

                          return (
                            <div key={taskItem.id} className="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-1.5 shadow-2xs">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-[10px]">
                                    {idx + 1}
                                  </span>
                                  <span className="font-extrabold text-slate-900">{taskItem.title}</span>
                                </div>
                                <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded ${
                                  taskItem.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                  taskItem.priority === 'high' ? 'bg-amber-100 text-amber-800' :
                                  taskItem.priority === 'medium' ? 'bg-blue-100 text-blue-800' :
                                  'bg-slate-100 text-slate-600'
                                }`}>
                                  {taskItem.priority}
                                </span>
                              </div>
                              {taskItem.description && (
                                <p className="text-slate-500 text-[11px] pl-7">{taskItem.description}</p>
                              )}
                              <div className="flex flex-wrap items-center gap-3 pl-7 text-[10px] text-slate-500">
                                <span>
                                  Start: {taskItem.startOffsetDays !== undefined ? `+${taskItem.startOffsetDays}d` : 'Immediate'}
                                </span>
                                <span>
                                  Due: {taskItem.dueOffsetDays !== undefined ? `+${taskItem.dueOffsetDays}d` : 'None'}
                                </span>
                                {prereqs.length > 0 && (
                                  <span className="text-amber-800 font-medium inline-flex items-center gap-1">
                                    <GitMerge className="w-2.5 h-2.5" />
                                    <span>Depends on: {prereqs.join(', ')}</span>
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Instantiation Options */}
                      <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-3">
                        <h5 className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Application Parameters</h5>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Anchor Date (Base for Relative Offsets)</label>
                            <input
                              type="date"
                              value={applyAnchorDate}
                              onChange={(e) => setApplyAnchorDate(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Default Assignee (Optional)</label>
                            <select
                              value={applyAssigneeEmail}
                              onChange={(e) => setApplyAssigneeEmail(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 outline-none font-bold"
                            >
                              <option value="">Leave Unassigned</option>
                              {userProfile?.email && <option value={userProfile.email}>You ({userProfile.email})</option>}
                              {members.map(m => (
                                <option key={m.uid || m.email} value={m.email}>{m.displayName || m.email}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => setSelectedTemplateForPreview(null)}
                            className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 font-bold"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isApplyingTemplate}
                            onClick={() => handleApplyTemplate(selectedTemplateForPreview.id)}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>{isApplyingTemplate ? 'Instantiating Tasks...' : `Apply Template (${selectedTemplateForPreview.tasks.length} Tasks)`}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create New Task Template Modal (Step 3.4) */}
      {showCreateTemplateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <LayoutTemplate className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-extrabold text-slate-900">Create Task Template</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateTemplateModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTemplate} className="p-6 overflow-y-auto space-y-4 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="block text-[11px] font-bold uppercase text-slate-600">Template Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Client Onboarding Workflow"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold uppercase text-slate-600">Scope</label>
                  <select
                    value={newTemplateScope}
                    onChange={(e) => setNewTemplateScope(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none"
                  >
                    <option value="project">Project Only</option>
                    <option value="organization">Organization-wide</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold uppercase text-slate-600">Description</label>
                <input
                  type="text"
                  placeholder="Summary of this reusable template..."
                  value={newTemplateDescription}
                  onChange={(e) => setNewTemplateDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Task Definitions List */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black uppercase text-slate-800 tracking-wider">
                    Task Definitions ({newTemplateTasks.length})
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const nextId = `task_${newTemplateTasks.length + 1}`;
                      setNewTemplateTasks(prev => [
                        ...prev,
                        { id: nextId, title: '', priority: 'medium', startOffsetDays: 0, dueOffsetDays: 5, prerequisiteTemplateItemIds: [] }
                      ]);
                    }}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Task Entry</span>
                  </button>
                </div>

                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {newTemplateTasks.map((t, idx) => (
                    <div key={t.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-extrabold text-slate-700">Task #{idx + 1} ({t.id})</span>
                        {newTemplateTasks.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setNewTemplateTasks(prev => prev.filter(item => item.id !== t.id))}
                            className="text-slate-400 hover:text-rose-600"
                            title="Remove task entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          required
                          placeholder="Task title..."
                          value={t.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            setNewTemplateTasks(prev => prev.map(item => item.id === t.id ? { ...item, title: val } : item));
                          }}
                          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none"
                        />
                        <select
                          value={t.priority}
                          onChange={(e) => {
                            const val = e.target.value as any;
                            setNewTemplateTasks(prev => prev.map(item => item.id === t.id ? { ...item, priority: val } : item));
                          }}
                          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none"
                        >
                          <option value="low">Low Priority</option>
                          <option value="medium">Medium Priority</option>
                          <option value="high">High Priority</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <label className="text-slate-500 font-bold block mb-0.5">Start (+days)</label>
                          <input
                            type="number"
                            min="0"
                            value={t.startOffsetDays ?? 0}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              setNewTemplateTasks(prev => prev.map(item => item.id === t.id ? { ...item, startOffsetDays: isNaN(val) ? 0 : val } : item));
                            }}
                            className="w-full bg-white border border-slate-200 rounded px-2 py-1 outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-slate-500 font-bold block mb-0.5">Due (+days)</label>
                          <input
                            type="number"
                            min="0"
                            value={t.dueOffsetDays ?? 3}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              setNewTemplateTasks(prev => prev.map(item => item.id === t.id ? { ...item, dueOffsetDays: isNaN(val) ? 0 : val } : item));
                            }}
                            className="w-full bg-white border border-slate-200 rounded px-2 py-1 outline-none"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <label className="text-slate-500 font-bold block mb-0.5">Prerequisite</label>
                          <select
                            value={(t.prerequisiteTemplateItemIds && t.prerequisiteTemplateItemIds[0]) || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setNewTemplateTasks(prev => prev.map(item => item.id === t.id ? { ...item, prerequisiteTemplateItemIds: val ? [val] : [] } : item));
                            }}
                            className="w-full bg-white border border-slate-200 rounded px-2 py-1 outline-none text-xs"
                          >
                            <option value="">None</option>
                            {newTemplateTasks
                              .filter(candidate => candidate.id !== t.id)
                              .map(candidate => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.title || candidate.id}
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateTemplateModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingTemplate || !newTemplateName.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs"
                >
                  <span>{isCreatingTemplate ? 'Saving...' : 'Save Template'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Raise Exception Modal (Step 3.5) */}
      {isRaisingException && raisingForTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-rose-100 rounded-xl text-rose-700">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Raise Task Exception</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Task: <strong className="text-slate-700">{raisingForTask.title}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsRaisingException(false);
                  setRaisingForTask(null);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateException} className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Exception Type */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Exception Type *</label>
                  <select
                    value={newExceptionType}
                    onChange={(e) => setNewExceptionType(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20"
                  >
                    <option value="blocked">Blocked (Obstacle)</option>
                    <option value="overdue">Overdue (Missed Deadline)</option>
                    <option value="at_risk">At Risk (Deadline Jeopardy)</option>
                    <option value="dependency_issue">Dependency Issue (Prerequisite Blocked)</option>
                    <option value="other">Other (Operational Issue)</option>
                  </select>
                </div>

                {/* Severity */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Severity *</label>
                  <select
                    value={newExceptionSeverity}
                    onChange={(e) => setNewExceptionSeverity(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical (Stop-Work)</option>
                  </select>
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Exception Title *</label>
                <input
                  type="text"
                  required
                  value={newExceptionTitle}
                  onChange={(e) => setNewExceptionTitle(e.target.value)}
                  placeholder="e.g., Blocked on third-party security review approval"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20 font-medium"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Description & Details</label>
                <textarea
                  rows={3}
                  value={newExceptionDesc}
                  onChange={(e) => setNewExceptionDesc(e.target.value)}
                  placeholder="Describe the nature of the roadblock, impact, or required remediation..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-rose-500/20 resize-none font-medium"
                />
              </div>

              {/* Owner Assignment */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Assign Responsible Owner</label>
                <select
                  value={newExceptionAssignee}
                  onChange={(e) => setNewExceptionAssignee(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-800 outline-none"
                >
                  <option value="">Unassigned</option>
                  {userProfile?.email && <option value={userProfile.email}>You ({userProfile.displayName || userProfile.email.split('@')[0]})</option>}
                  {members.map(m => (
                    <option key={m.uid || m.email} value={m.email}>{m.displayName || m.email} ({m.email})</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsRaisingException(false);
                    setRaisingForTask(null);
                  }}
                  className="px-3.5 py-2 text-xs text-slate-600 hover:text-slate-800 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingException || !newExceptionTitle.trim()}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs"
                >
                  <span>{isSubmittingException ? 'Reporting...' : 'Report Exception'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resolve Exception Modal */}
      {resolvingExceptionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span>Resolve Task Exception</span>
              </h3>
              <button
                type="button"
                onClick={() => setResolvingExceptionId(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Summarize how this obstacle was resolved before marking it closed. (Task execution state remains separate).
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Resolution Summary *</label>
              <textarea
                rows={3}
                required
                value={resolutionSummaryText}
                onChange={(e) => setResolutionSummaryText(e.target.value)}
                placeholder="e.g., Vendor delivered updated certificate; unblocked prerequisite."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20 font-medium resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setResolvingExceptionId(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleResolveException(resolvingExceptionId)}
                disabled={!resolutionSummaryText.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              >
                Confirm Resolution
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dismiss Exception Modal */}
      {dismissingExceptionId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <X className="w-4 h-4 text-slate-600" />
                <span>Dismiss Task Exception</span>
              </h3>
              <button
                type="button"
                onClick={() => setDismissingExceptionId(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Provide a rationale for why this exception is dismissed (e.g., false alarm, duplicate, or no longer applicable).
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Dismissal Reason *</label>
              <textarea
                rows={3}
                required
                value={dismissalReasonText}
                onChange={(e) => setDismissalReasonText(e.target.value)}
                placeholder="e.g., Duplicate report or obstacle no longer relevant."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-slate-500/20 font-medium resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDismissingExceptionId(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDismissException(dismissingExceptionId)}
                disabled={!dismissalReasonText.trim()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              >
                Dismiss Exception
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exception History & Details Modal */}
      {selectedExceptionDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Exception Audit History</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedExceptionDetail(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs space-y-1">
              <p className="font-bold text-slate-800">{selectedExceptionDetail.title}</p>
              <p className="text-slate-500">Task: {selectedExceptionDetail.taskTitle || selectedExceptionDetail.taskId}</p>
            </div>

            <div className="overflow-y-auto space-y-3 flex-1 pr-1 border-t border-slate-100 pt-3">
              {(selectedExceptionDetail.history || []).map((h, idx) => (
                <div key={h.id || idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 uppercase tracking-wider text-[10px] bg-slate-200 px-1.5 py-0.5 rounded">
                      {h.action}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(h.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                  <p className="text-slate-700">{h.details || `Status: ${h.newStatus || h.action}`}</p>
                  <p className="text-[10px] text-slate-400">Actor: {h.performedByName} ({h.performedByEmail})</p>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedExceptionDetail(null)}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up Creation Modal */}
      {isSchedulingFollowUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-purple-600" />
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Draft Follow-up Meeting</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSchedulingFollowUpModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateFollowUp} className="space-y-4 overflow-y-auto flex-1 pr-1 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Meeting Title</label>
                <input
                  type="text"
                  value={followUpFormTitle}
                  onChange={(e) => setFollowUpFormTitle(e.target.value)}
                  placeholder="e.g. Follow-up: Resolve DB connection blocker"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-purple-600 text-xs"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Purpose / Discussion Goals</label>
                <textarea
                  value={followUpFormPurpose}
                  onChange={(e) => setFollowUpFormPurpose(e.target.value)}
                  placeholder="Why is this meeting needed? What outcomes are expected?"
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-purple-600 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Proposed Start Time</label>
                  <input
                    type="datetime-local"
                    value={followUpFormStartTime}
                    onChange={(e) => setFollowUpFormStartTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-purple-600 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Proposed End Time</label>
                  <input
                    type="datetime-local"
                    value={followUpFormEndTime}
                    onChange={(e) => setFollowUpFormEndTime(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-purple-600 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Participants</label>
                <div className="border border-slate-200 rounded-lg p-2 max-h-32 overflow-y-auto space-y-1 bg-slate-50">
                  {members.map((m) => {
                    const isChecked = followUpFormParticipants.includes(m.email.toLowerCase());
                    return (
                      <label key={m.uid || m.email} className="flex items-center gap-2 text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const emailLower = m.email.toLowerCase();
                            if (e.target.checked) {
                              setFollowUpFormParticipants(prev => [...prev, emailLower]);
                            } else {
                              setFollowUpFormParticipants(prev => prev.filter(x => x !== emailLower));
                            }
                          }}
                          className="rounded text-purple-600 focus:ring-purple-500"
                        />
                        <span>{m.displayName || m.email.split('@')[0]} ({m.email})</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Custom Agenda (Optional)</label>
                <textarea
                  value={followUpFormAgenda}
                  onChange={(e) => setFollowUpFormAgenda(e.target.value)}
                  placeholder="Leave empty to let EchoNote automatically generate agenda items from linked tasks and exceptions."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-purple-600 text-xs"
                />
              </div>

              {followUpFormAllowDuplicate && (
                <label className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={followUpFormAllowDuplicate}
                    onChange={(e) => setFollowUpFormAllowDuplicate(e.target.checked)}
                    className="rounded text-amber-600 focus:ring-amber-500"
                  />
                  <span className="font-bold text-[11px]">Allow duplicate follow-up for this task/exception</span>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsSchedulingFollowUpModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingFollowUp || !followUpFormTitle.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold transition-all disabled:opacity-50"
                >
                  {isSubmittingFollowUp ? 'Creating Draft...' : 'Create Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {reschedulingMeetingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Reschedule Follow-up Meeting</h3>
              <button
                type="button"
                onClick={() => setReschedulingMeetingId(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">New Start Time</label>
                <input
                  type="datetime-local"
                  value={rescheduleStartTime}
                  onChange={(e) => setRescheduleStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-amber-600 text-xs"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">New End Time (Optional)</label>
                <input
                  type="datetime-local"
                  value={rescheduleEndTime}
                  onChange={(e) => setRescheduleEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-amber-600 text-xs"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Reason for Rescheduling</label>
                <textarea
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  placeholder="e.g. Key stakeholder unavailable, dependency timeline shifted"
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-amber-600 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setReschedulingMeetingId(null)}
                className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRescheduleFollowUp(reschedulingMeetingId)}
                disabled={!rescheduleStartTime}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              >
                Confirm Reschedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancellingMeetingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Cancel Follow-up Meeting</h3>
              <button
                type="button"
                onClick={() => setCancellingMeetingId(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600">
                Are you sure you want to cancel this follow-up meeting? The status will be marked as cancelled in EchoNote.
              </p>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Cancellation Reason (Optional)</label>
                <input
                  type="text"
                  value={cancelReasonText}
                  onChange={(e) => setCancelReasonText(e.target.value)}
                  placeholder="e.g. Blocker was resolved asynchronously"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-rose-600 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCancellingMeetingId(null)}
                className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-bold"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => handleCancelFollowUp(cancellingMeetingId)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Modal */}
      {completingMeetingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Complete Follow-up Meeting</h3>
              <button
                type="button"
                onClick={() => setCompletingMeetingId(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600">
                Mark this follow-up as completed. Record any outcomes, decisions, or follow-through agreements reached during the discussion.
              </p>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Outcome Notes (Optional)</label>
                <textarea
                  value={completionNotesText}
                  onChange={(e) => setCompletionNotesText(e.target.value)}
                  placeholder="e.g. Blockers resolved, assigned team agreed on new database schema and pushed deadline by 2 days."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:border-indigo-600 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCompletingMeetingId(null)}
                className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-lg text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCompleteFollowUp(completingMeetingId)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all"
              >
                Mark Completed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up History & Details Modal */}
      {selectedFollowUpDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200 p-6 space-y-4 animate-in fade-in duration-200 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-purple-600" />
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Follow-up Audit History</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFollowUpDetail(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs space-y-1">
              <p className="font-bold text-slate-800">{selectedFollowUpDetail.title}</p>
              <p className="text-slate-500">Status: <span className="font-bold uppercase text-purple-700">{selectedFollowUpDetail.status}</span></p>
            </div>

            {selectedFollowUpDetail.reasoningOutcome && (
              <div className="p-3.5 bg-amber-50/70 rounded-xl border border-amber-200 text-xs space-y-2.5">
                <div className="flex items-center justify-between border-b border-amber-200/60 pb-2">
                  <span className="font-black uppercase tracking-wider text-[11px] text-amber-900 flex items-center gap-1.5">
                    <CalendarClock className="w-3.5 h-3.5 text-amber-700" />
                    Reasoning Meeting Outcome
                  </span>
                  <span className="text-[10px] text-amber-700 font-semibold">
                    {new Date(selectedFollowUpDetail.reasoningOutcome.completedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Root Cause</span>
                  <p className="text-slate-800 bg-white/80 p-2 rounded-lg border border-amber-100 text-xs whitespace-pre-wrap">
                    {selectedFollowUpDetail.reasoningOutcome.rootCause}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  {selectedFollowUpDetail.reasoningOutcome.agreedStartDate && (
                    <div className="bg-white/80 p-2 rounded-lg border border-amber-100">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Agreed Start Date</span>
                      <span className="font-semibold text-slate-800">
                        {new Date(selectedFollowUpDetail.reasoningOutcome.agreedStartDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                  <div className="bg-white/80 p-2 rounded-lg border border-amber-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Agreed Deadline</span>
                    <span className="font-bold text-amber-900">
                      {new Date(selectedFollowUpDetail.reasoningOutcome.agreedDueDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className={selectedFollowUpDetail.reasoningOutcome.propagationPerformed ? 'bg-purple-100 text-purple-800 border border-purple-200 text-[10px] font-bold px-2 py-0.5 rounded-full' : 'bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold px-2 py-0.5 rounded-full'}>
                    {selectedFollowUpDetail.reasoningOutcome.propagationPerformed ? 'Rescheduled Downstream Tasks' : 'Target Task Only'}
                  </span>
                  {selectedFollowUpDetail.reasoningOutcome.propagationSummary && (
                    <span className="text-[11px] text-slate-600 font-medium">
                      {selectedFollowUpDetail.reasoningOutcome.propagationSummary.updatedTaskCount} task(s) updated
                    </span>
                  )}
                </div>

                {selectedFollowUpDetail.reasoningOutcome.propagationSummary?.updatedTasks && selectedFollowUpDetail.reasoningOutcome.propagationSummary.updatedTasks.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Updated Tasks</span>
                    <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                      {selectedFollowUpDetail.reasoningOutcome.propagationSummary.updatedTasks.map((t) => (
                        <div key={t.taskId} className="text-[11px] bg-white/70 px-2 py-1 rounded border border-amber-100/70 flex items-center justify-between">
                          <span className="font-medium text-slate-800 truncate mr-2">{t.title || t.taskId}</span>
                          <span className="text-slate-500 font-mono text-[10px] shrink-0">
                            {t.dueDate ? new Date(t.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                            {t.shiftDays ? (' (+' + t.shiftDays + 'd)') : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  )}

                {selectedFollowUpDetail.reasoningOutcome.resolvedExceptionIds && selectedFollowUpDetail.reasoningOutcome.resolvedExceptionIds.length > 0 && (
                  <div className="text-[11px] text-emerald-800 bg-emerald-50/80 px-2.5 py-1.5 rounded-lg border border-emerald-200 flex items-center justify-between">
                    <span className="font-semibold">Resolved Exceptions</span>
                    <span className="font-bold font-mono text-xs">{selectedFollowUpDetail.reasoningOutcome.resolvedExceptionIds.length} resolved</span>
                  </div>
                )}

                {selectedFollowUpDetail.reasoningOutcome.completedBy && (
                  <div className="text-[10px] text-slate-500 pt-1 border-t border-amber-100 flex items-center justify-between">
                    <span>Completed by: {selectedFollowUpDetail.reasoningOutcome.completedBy.name || selectedFollowUpDetail.reasoningOutcome.completedBy.email}</span>
                  </div>
                )}
              </div>
            )}

            <div className="overflow-y-auto space-y-3 flex-1 pr-1 border-t border-slate-100 pt-3">
              {(selectedFollowUpDetail.history || []).map((h, idx) => (
                <div key={h.id || idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 uppercase tracking-wider text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">
                      {h.action}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(h.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                  <p className="text-slate-700">{h.details || `Status: ${h.newStatus || h.action}`}</p>
                  <p className="text-[10px] text-slate-400">Actor: {h.performedByName} ({h.performedByEmail})</p>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedFollowUpDetail(null)}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reasoning Meeting Completion Modal (AH.193 / Req 23) */}
      <ReasoningMeetingCompletionModal
        isOpen={Boolean(reasoningMeetingToComplete)}
        onClose={() => setReasoningMeetingToComplete(null)}
        meeting={reasoningMeetingToComplete}
        targetTask={
          reasoningMeetingToComplete?.relatedTaskIds?.[0]
            ? tasks.find(t => t.id === reasoningMeetingToComplete.relatedTaskIds[0]) || null
            : null
        }
        exceptions={exceptions}
        onSuccess={() => {
          toast.success("Reasoning meeting completed and schedule updated!");
          fetchFollowUps();
          fetchExceptions();
          fetchTrackingInsights();
          setReasoningMeetingToComplete(null);
        }}
      />

      {/* Deadline Propagation Modal (AH.181) */}
      <DeadlinePropagationModal
        isOpen={propagationModalOpen}
        onClose={() => {
          if (!isExecutingPropagation) {
            setPropagationModalOpen(false);
          }
        }}
        onConfirm={handleConfirmDeadlinePropagation}
        isLoadingPreview={isLoadingPropagationPreview}
        isExecuting={isExecutingPropagation}
        targetTaskTitle={propagationTargetTask?.title || 'Selected Task'}
        proposedDate={{
          startDate: propagationProposedDates.startDate,
          dueDate: propagationProposedDates.dueDate
        }}
        preview={propagationPreview}
        error={propagationError}
        onRefreshPreview={handleRefreshPropagationPreview}
      />

      {/* Project Template & Workflow Modal (AH.186) */}
      <ProjectTemplateModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        userProfile={userProfile}
        organizationId={(activeProject as any)?.organizationId || null}
        onProjectCreated={(createdProject) => {
          onSelectProjectName(createdProject.name);
          setActiveProjectTab('workspace');
          toast.success(`Project "${createdProject.name}" ready!`);
        }}
      />
    </div>
  );
};
