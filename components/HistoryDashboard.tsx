
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Sparkles, GripVertical, Folder, FolderInput, FolderPlus, ArrowRight, Scissors, Layers, FileText } from 'lucide-react';
import { AudioToTextRecord, TextToAudioRecord, TranscriptSegment, ReadStatus, CollaborationRole, PlaybackMetadata, PlaybackStatus, Bookmark, AuthStatus, UserProfile, Project, UsageStats, StrategicAnalysis, UnifiedMeetingIntelligence, ExecutionTracker, OrgRole, ProductEventName } from '../types';
import { executeDownload, generateTranscriptBlob } from '../services/downloadService';
import { analyzeStrategically, processUnifiedMeetingIntelligence, generateSmartRecap } from '../services/geminiService';
import { PLAN_FEATURES } from '../config/planConfig';
import { db, collection, query, where, getDocs, onSnapshot } from '../firebase';
import { trackProductEvent, trackDecisionRetrieved } from '../services/productAnalyticsService';
import MeetingIntelligenceView from './MeetingIntelligenceView';
import ExecutionTrackerView from './ExecutionTrackerView';
import SmartReminderView from './SmartReminderView';
import UnresolvedTopicsDetector from './UnresolvedTopicsDetector';
import { SmartRecapModal } from './SmartRecapModal';
import { AudioTrimmerModal } from './AudioTrimmerModal';
import { ReportExportModal } from './ReportExportModal';
import { getRecordingProjects, addRecordingToProject, removeRecordingFromProject } from '../lib/apiClient';

interface HistoryDashboardProps {
  audioHistory: AudioToTextRecord[];
  textHistory: TextToAudioRecord[];
  groups: string[];
  projects: Project[];
  filterGroup: string | null;
  authStatus: AuthStatus;
  userProfile?: UserProfile;
  onClearFilter: () => void;
  onUpdateAudio: (record: AudioToTextRecord) => void;
  onUpdateText: (record: TextToAudioRecord) => void;
  onDeleteAudio: (id: string) => void;
  onDeleteText: (id: string) => void;
  onPermanentlyDeleteAudio: (id: string) => void;
  onPermanentlyDeleteText: (id: string) => void;
  onRestoreAudio: (id: string) => void;
  onRestoreText: (id: string) => void;
  onBulkDeleteAudio: (ids: string[]) => void;
  onBulkDeleteText: (ids: string[]) => void;
  onRenameGroup: (old: string, next: string) => void;
  onDeleteGroup: (name: string, deleteAssets: boolean) => void;
  onAddGroup: (name: string) => void;
  onInviteToProject: (projectName: string, email: string, role: CollaborationRole) => void;
  activePlaybackId?: string;
  activePlaybackSegIdx?: number;
  playbackStatus: PlaybackStatus;
  onPlay: (metadata: PlaybackMetadata, startTime?: number, endTime?: number) => void;
  onPause: () => void;
  onStop: () => void;
  onSetFilterGroup?: (group: string | null) => void;
  selectedRecordId?: string | null;
  onClearSelectedRecord?: () => void;
  onRecordExpand?: (id: string | null) => void;
  usageStats: UsageStats;
  searchQuery?: string;
  addNotification: (notif: any) => void;
  isLoading?: boolean;
  checkThinkingLimit: () => boolean;
  incrementThinkingUsage: () => Promise<void>;
  userOrgRole?: OrgRole;
}

type ArchiveTab = 'live' | 'recorded' | 'synthesis' | 'bookmarks' | 'trash';
type ReadStatusFilter = 'all' | 'read' | 'in-progress' | 'not-read';

interface ExtendedBookmark extends Bookmark {
  recordId: string;
  recordName: string;
  recordUrl?: string;
  recordGroup: string;
  date: string;
  fullRecord: AudioToTextRecord;
}

const HistoryDashboard: React.FC<HistoryDashboardProps> = ({ 
  audioHistory, textHistory, groups, projects, filterGroup, authStatus, userProfile, onClearFilter,
  onUpdateAudio, onUpdateText, onDeleteAudio, onDeleteText,
  onPermanentlyDeleteAudio, onPermanentlyDeleteText, onRestoreAudio, onRestoreText,
  onBulkDeleteAudio, onBulkDeleteText,
  onRenameGroup, onDeleteGroup, onAddGroup, onInviteToProject,
  activePlaybackId, activePlaybackSegIdx, playbackStatus, onPlay, onPause, onStop,
  onSetFilterGroup, selectedRecordId, onClearSelectedRecord, onRecordExpand,
  usageStats, searchQuery, addNotification, isLoading = false,
  checkThinkingLimit, incrementThinkingUsage, userOrgRole
}) => {
  const [activeTab, setActiveTab] = useState<ArchiveTab>('recorded');
  
  // Advanced Filter States
  const [statusFilter, setStatusFilter] = useState<ReadStatusFilter>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [projectFilter, setProjectFilter] = useState<string>(filterGroup || 'all');
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  useEffect(() => {
    if (onRecordExpand) onRecordExpand(expandedRecordId);
  }, [expandedRecordId, onRecordExpand]);
  const [expandedStrategicAnalysisIds, setExpandedStrategicAnalysisIds] = useState<Set<string>>(new Set());
  const [expandedIntelligenceIds, setExpandedIntelligenceIds] = useState<Set<string>>(new Set());
  const [expandedExecutionIds, setExpandedExecutionIds] = useState<Set<string>>(new Set());
  const [expandedReminderIds, setExpandedReminderIds] = useState<Set<string>>(new Set());
  const [expandedUnresolvedIds, setExpandedUnresolvedIds] = useState<Set<string>>(new Set());
  const [expandedFollowUpIds, setExpandedFollowUpIds] = useState<Set<string>>(new Set());
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [expandedTextIds, setExpandedTextIds] = useState<Set<string>>(new Set());
  const isGuest = usageStats.mode === 'guest';
  const searchDebounceRef = useRef<any>(null);

  // AI Smart Recap State
  const [smartRecapRecord, setSmartRecapRecord] = useState<AudioToTextRecord | null>(null);
  const [isSmartRecapOpen, setIsSmartRecapOpen] = useState(false);
  const [isGeneratingRecap, setIsGeneratingRecap] = useState(false);

  // Audio Trimming Modal State
  const [trimmerRecord, setTrimmerRecord] = useState<AudioToTextRecord | null>(null);

  // AH.184: Report Export Modal State
  const [reportRecord, setReportRecord] = useState<AudioToTextRecord | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);

  // AH.183: Multi-Project Recording Association State
  const [assocRecord, setAssocRecord] = useState<AudioToTextRecord | null>(null);
  const [assocProjects, setAssocProjects] = useState<any[]>([]);
  const [isAssocLoading, setIsAssocLoading] = useState<boolean>(false);
  const [assocActionPending, setAssocActionPending] = useState<boolean>(false);
  const [assocSelectedNewProjId, setAssocSelectedNewProjId] = useState<string>('');
  const [assocErrorMessage, setAssocErrorMessage] = useState<string | null>(null);

  const openMultiProjectModal = async (record: AudioToTextRecord) => {
    setAssocRecord(record);
    setAssocProjects([]);
    setAssocSelectedNewProjId('');
    setAssocErrorMessage(null);
    setIsAssocLoading(true);

    try {
      const res = await getRecordingProjects(record.id);
      if (res.ok && res.data) {
        setAssocProjects(res.data.projects || []);
      } else {
        setAssocErrorMessage(res.error || 'Failed to fetch associated projects');
      }
    } catch (err: any) {
      setAssocErrorMessage(err?.message || 'Failed to fetch associated projects');
    } finally {
      setIsAssocLoading(false);
    }
  };

  const handleAddProjectAssociation = async () => {
    if (!assocRecord || !assocSelectedNewProjId) return;
    setAssocActionPending(true);
    setAssocErrorMessage(null);

    try {
      const res = await addRecordingToProject(assocRecord.id, assocSelectedNewProjId);
      if (res.ok && res.data) {
        setAssocProjects(res.data.projects || []);
        setAssocSelectedNewProjId('');
        // Update local record
        const updatedRec: AudioToTextRecord = {
          ...assocRecord,
          projectIds: res.data.projectIds,
          projectId: res.data.primaryProjectId || assocRecord.projectId
        };
        setAssocRecord(updatedRec);
        onUpdateAudio(updatedRec);
        addNotification({
          title: 'Project Associated',
          message: res.data.message || 'Recording associated with project.',
          type: 'success'
        });
      } else {
        setAssocErrorMessage(res.error || 'Failed to associate project');
      }
    } catch (err: any) {
      setAssocErrorMessage(err?.message || 'Failed to associate project');
    } finally {
      setAssocActionPending(false);
    }
  };

  const handleRemoveProjectAssociation = async (targetProjectId: string) => {
    if (!assocRecord || !targetProjectId) return;
    setAssocActionPending(true);
    setAssocErrorMessage(null);

    try {
      const res = await removeRecordingFromProject(assocRecord.id, targetProjectId);
      if (res.ok && res.data) {
        setAssocProjects(res.data.projects || []);
        const updatedRec: AudioToTextRecord = {
          ...assocRecord,
          projectIds: res.data.projectIds,
          projectId: res.data.primaryProjectId || undefined
        };
        setAssocRecord(updatedRec);
        onUpdateAudio(updatedRec);
        addNotification({
          title: 'Association Removed',
          message: res.data.message || 'Project association removed.',
          type: 'info'
        });
      } else {
        setAssocErrorMessage(res.error || 'Failed to remove project association');
      }
    } catch (err: any) {
      setAssocErrorMessage(err?.message || 'Failed to remove project association');
    } finally {
      setAssocActionPending(false);
    }
  };

  // Task Conversion State
  const [convertingTaskId, setConvertingTaskId] = useState<string | null>(null);

  const handleConvertToTask = async (
    record: AudioToTextRecord,
    title: string,
    sourceType: 'meeting_action_item' | 'meeting_decision',
    sourceRef: string
  ) => {
    const project = (projects as Project[]).find(p => p.name === record.group || p.id === record.projectId);
    if (!project) {
      addNotification({
        title: 'Project Required',
        message: 'This meeting must be associated with a project before converting to a project task.',
        type: 'warning'
      });
      return;
    }

    const itemKey = `${record.id}_${sourceRef}`;
    setConvertingTaskId(itemKey);
    try {
      const payload: any = {
        title,
        description: `Generated from meeting "${record.fileName || 'Meeting'}" (${sourceType === 'meeting_action_item' ? 'Action Item' : 'Decision'})`,
        priority: 'medium',
        status: 'pending',
        sourceType,
        sourceMeetingSessionId: record.id,
        sourceRecordingId: record.id,
        isAiSuggested: true,
        createdBy: userProfile?.email || 'user'
      };

      if (sourceType === 'meeting_decision') {
        payload.sourceDecisionId = sourceRef;
      } else {
        payload.sourceActionItem = sourceRef;
      }

      const token = await userProfile?.getIdToken?.();
      const res = await fetch(`/api/projects/${project.id}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to convert item to task');
      }

      if (data.reused) {
        addNotification({
          title: 'Existing Task Linked',
          message: `Reused existing task "${data.task.title}" (Status: ${data.task.status})`,
          type: 'info'
        });
      } else {
        addNotification({
          title: 'Task Created',
          message: `Converted "${title.slice(0, 35)}..." to a project task in ${project.name}.`,
          type: 'success'
        });
      }
    } catch (err: any) {
      console.error('Task conversion error:', err);
      addNotification({
        title: 'Conversion Failed',
        message: err.message || 'Unable to create project task from item.',
        type: 'error'
      });
    } finally {
      setConvertingTaskId(null);
    }
  };

  const handleTriggerSmartRecap = async (record: AudioToTextRecord) => {
    setSmartRecapRecord(record);
    setIsSmartRecapOpen(true);

    if (record.smartRecap) {
      return;
    }

    setIsGeneratingRecap(true);
    try {
      const project = (projects as Project[]).find(p => p.name === record.group || p.id === record.projectId);
      const recap = await generateSmartRecap(
        record.id,
        record.transcript,
        project?.id
      );

      const updated = { ...record, smartRecap: recap };
      setSmartRecapRecord(updated);
      onUpdateAudio(updated);

      addNotification({
        title: 'AI Smart Recap Ready',
        message: 'Synthesized 3-bullet executive summary and tagged team members.',
        type: 'success'
      });
    } catch (err: any) {
      console.error('Smart recap failed:', err);
      addNotification({
        title: 'Smart Recap Failed',
        message: err.message || 'Could not synthesize AI smart recap.',
        type: 'error'
      });
    } finally {
      setIsGeneratingRecap(false);
    }
  };

  const handleRegenerateRecap = async () => {
    if (!smartRecapRecord) return;
    setIsGeneratingRecap(true);
    try {
      const project = (projects as Project[]).find(p => p.name === smartRecapRecord.group || p.id === smartRecapRecord.projectId);
      const recap = await generateSmartRecap(
        smartRecapRecord.id,
        smartRecapRecord.transcript,
        project?.id
      );
      const updated = { ...smartRecapRecord, smartRecap: recap };
      setSmartRecapRecord(updated);
      onUpdateAudio(updated);
      addNotification({
        title: 'AI Smart Recap Refreshed',
        message: 'Regenerated 3-bullet executive summary and tagged team members.',
        type: 'success'
      });
    } catch (err: any) {
      addNotification({
        title: 'Smart Recap Failed',
        message: err.message || 'Failed to refresh smart recap.',
        type: 'error'
      });
    } finally {
      setIsGeneratingRecap(false);
    }
  };

  // Track History Archive Viewed
  useEffect(() => {
    trackProductEvent({
      eventName: ProductEventName.HISTORY_VIEWED,
      userId: userProfile?.uid,
      plan: usageStats.plan,
      entityType: 'history',
      source: 'history_dashboard'
    });
  }, [userProfile?.uid]);

  // Track Archive Search
  useEffect(() => {
    if (!searchQuery?.trim()) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    searchDebounceRef.current = setTimeout(() => {
      trackProductEvent({
        eventName: ProductEventName.DECISION_SEARCHED,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        entityType: 'search',
        source: 'history_dashboard',
        metadata: {
          searchQueryLength: searchQuery.trim().length
        }
      });
    }, 600);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, userProfile?.uid]);

  // Sync projectFilter with filterGroup prop
  useEffect(() => {
    setProjectFilter(filterGroup || 'all');
  }, [filterGroup]);

  const isThinkingLimitReached = useMemo(() => {
    if (isGuest) return true;
    const limit = PLAN_FEATURES[usageStats.plan].thinkingLimit;
    const currentUsage = userProfile?.thinkingUsageCount || 0;
    return limit !== 'unlimited' && currentUsage >= (limit as number);
  }, [usageStats, userProfile, isGuest]);

  const renderThinkingLimitMessage = () => (
    <div className="p-6 bg-purple-50 border border-purple-100 rounded-xl flex flex-col items-center text-center space-y-3">
      <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center">
        <i className="fa-solid fa-lock"></i>
      </div>
      <div className="space-y-1">
        <h4 className="text-sm font-bold text-purple-900">
          {isGuest ? "Not Available in Guest Mode" : "AI Requests Limit Reached"}
        </h4>
        <p className="text-xs text-purple-700">
          {isGuest ? "Please log in to access AI Requests." : "You have reached your AI Requests limit for this month."}
        </p>
      </div>
    </div>
  );

  // Multi-select and Delete states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string; type: 'audio' | 'synthesis'; isPermanent: boolean } | null>(null);
  const [itemToRestore, setItemToRestore] = useState<{ id: string; name: string; type: 'audio' | 'synthesis' } | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<{ name: string; deleteAssets: boolean } | null>(null);
  const [showProjectDeleteConfirm, setShowProjectDeleteConfirm] = useState(false);

  // Download States
  const [showGuestDownloadPrompt, setShowGuestDownloadPrompt] = useState(false);
  const [downloadingAsset, setDownloadingAsset] = useState<{ id: string; name: string; url: string; type: 'audio' | 'transcript' } | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>('');
  const [bulkDownloadGroup, setBulkDownloadGroup] = useState<string | null>(null);
  const [bulkFormats, setBulkFormats] = useState<string[]>([]);

  // Drag-and-drop reassignment states
  const [draggedRecord, setDraggedRecord] = useState<AudioToTextRecord | TextToAudioRecord | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [isOverNewProjectTarget, setIsOverNewProjectTarget] = useState<boolean>(false);
  const [itemForNewProjectDrop, setItemForNewProjectDrop] = useState<AudioToTextRecord | TextToAudioRecord | null>(null);
  const [newProjectDropName, setNewProjectDropName] = useState<string>('');

  // Filtering Logic
  const [editingFileName, setEditingFileName] = useState<{ id: string, name: string } | null>(null);
  const [isConversationMode, setIsConversationMode] = useState(false);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active segment
  useEffect(() => {
    if (activePlaybackId && activePlaybackSegIdx !== undefined && transcriptContainerRef.current) {
      const activeElement = transcriptContainerRef.current.querySelector(`[data-segment-index="${activePlaybackSegIdx}"]`);
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
    }
  }, [activePlaybackId, activePlaybackSegIdx]);

  useEffect(() => {
    if (selectedRecordId) {
      setExpandedRecordId(selectedRecordId);
      // Determine correct tab
      const audioRecord = audioHistory.find(h => h.id === selectedRecordId);
      if (audioRecord) {
        setActiveTab(audioRecord.sourceType === 'live' ? 'live' : 'recorded');
      } else {
        const textRecord = textHistory.find(h => h.id === selectedRecordId);
        if (textRecord) setActiveTab('synthesis');
      }
      // Clear after handling
      if (onClearSelectedRecord) onClearSelectedRecord();
    }
  }, [selectedRecordId, audioHistory, textHistory, onClearSelectedRecord]);

  const filteredData = useMemo(() => {
    const isWithinDateRange = (itemDateStr: string) => {
      if (!startDate && !endDate) return true;
      const d = new Date(itemDateStr).getTime();
      if (startDate && d < new Date(startDate).getTime()) return false;
      if (endDate && d > new Date(endDate).getTime() + 86400000) return false;
      return true;
    };

    const isMemberOfProject = (groupName: string, projId?: string, projIds?: string[]) => {
      if (groupName === 'General') return true;
      const project = (projects as Project[]).find(p => 
        (projId && p.id === projId) || 
        (projIds && projIds.includes(p.id)) || 
        p.name === groupName
      );
      if (!project) return true; // Default for legacy
      if (project.ownerEmail === userProfile?.email) return true;
      return project.members?.some(m => m.email === userProfile?.email);
    };

    const matchesProject = (item: any) => {
      const g = item?.group || 'General';
      const projId = item?.projectId;
      const projIds: string[] = Array.isArray(item?.projectIds) ? item.projectIds : [];
      
      const projectExists = (projects as Project[]).some(p => 
        (projId && p.id === projId) || 
        projIds.includes(p.id) || 
        p.name === g
      );
      const effectiveGroup = projectExists ? g : 'General';
      
      if (!isMemberOfProject(effectiveGroup, projId, projIds)) return false;
      if (projectFilter === 'all') return true;
      
      // Matches if filter equals effectiveGroup, primary projectId, or any associated projectId
      const filterProj = (projects as Project[]).find(p => p.name === projectFilter || p.id === projectFilter);
      if (filterProj) {
        if (projId && projId === filterProj.id) return true;
        if (projIds.includes(filterProj.id)) return true;
        if (effectiveGroup === filterProj.name) return true;
        return false;
      }
      return effectiveGroup === projectFilter;
    };

    const matchesStatus = (status: ReadStatus) => {
      if (statusFilter === 'all') return true;
      return status === statusFilter;
    };

    const matchesSearch = (item: any) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      
      // Search in common fields
      if (item.fileName?.toLowerCase().includes(query)) return true;
      if (item.group?.toLowerCase().includes(query)) return true;
      
      // Search in transcript
      if (item.transcript) {
        return item.transcript.some((seg: any) => seg.text.toLowerCase().includes(query));
      }
      
      // Search in synthesis text
      if (item.text && item.text.toLowerCase().includes(query)) return true;
      
      return false;
    };

    if (activeTab === 'trash') {
      const deletedAudio = audioHistory.filter(h => h.deletedAt && matchesProject(h) && isWithinDateRange(h.date) && matchesSearch(h));
      const deletedText = textHistory.filter(h => h.deletedAt && matchesProject(h) && isWithinDateRange(h.date) && matchesSearch(h));
      return [...deletedAudio, ...deletedText];
    }

    if (activeTab === 'bookmarks') {
      // Return all bookmarks from all audio records
      const allBookmarks: ExtendedBookmark[] = [];
      audioHistory.forEach(record => {
        if (!record.deletedAt && matchesProject(record) && isWithinDateRange(record.date) && matchesSearch(record)) {
          record.bookmarks.forEach(b => {
            allBookmarks.push({
              ...b,
              recordId: record.id,
              recordName: record.fileName,
              recordUrl: record.originalAudioUrl,
              recordGroup: record.group,
              date: record.date,
              fullRecord: record
            });
          });
        }
      });
      return allBookmarks;
    }

    if (activeTab === 'synthesis') {
      return textHistory.filter(h => !h.deletedAt && matchesProject(h) && isWithinDateRange(h.date) && matchesSearch(h));
    } else {
      const type = activeTab === 'live' ? 'live' : 'recorded';
      return audioHistory.filter(h => 
        !h.deletedAt &&
        h.sourceType === type && 
        matchesProject(h) && 
        isWithinDateRange(h.date) && 
        matchesStatus(h.readStatus) &&
        matchesSearch(h)
      );
    }
  }, [activeTab, audioHistory, textHistory, startDate, endDate, statusFilter, projectFilter, searchQuery]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredData.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredData.map(item => item.id)));
    }
  };

  const handleBulkDelete = () => {
    const idsArray = Array.from(selectedIds);
    if (activeTab === 'synthesis') {
      onBulkDeleteText(idsArray);
    } else {
      onBulkDeleteAudio(idsArray);
    }
    setSelectedIds(new Set());
    setShowBulkDeleteConfirm(false);
  };

  const confirmRestore = () => {
    if (!itemToRestore) return;
    if (itemToRestore.type === 'audio') {
      onRestoreAudio(itemToRestore.id);
    } else {
      onRestoreText(itemToRestore.id);
    }
    setItemToRestore(null);
    addNotification({
      title: 'Asset Restored',
      message: `"${itemToRestore.name}" has been moved back to its original location.`,
      type: 'success'
    });
  };

  const confirmSingleDelete = () => {
    if (!itemToDelete) return;
    if (itemToDelete.isPermanent) {
      if (itemToDelete.type === 'audio') {
        onPermanentlyDeleteAudio(itemToDelete.id);
      } else {
        onPermanentlyDeleteText(itemToDelete.id);
      }
    } else {
      if (itemToDelete.type === 'audio') {
        onDeleteAudio(itemToDelete.id);
      } else {
        onDeleteText(itemToDelete.id);
      }
    }
    setItemToDelete(null);
  };

  const confirmProjectDelete = (deleteAssets: boolean) => {
    if (projectToDelete) {
      onDeleteGroup(projectToDelete.name, deleteAssets);
      setProjectToDelete(null);
      setShowProjectDeleteConfirm(false);
    }
  };

  const checkPermission = (record: AudioToTextRecord | TextToAudioRecord, action: 'edit' | 'delete'): boolean => {
    if (userOrgRole === 'owner' || userOrgRole === 'org_admin') return true;
    if (userOrgRole === 'viewer') return false;

    // Check if record is in General (handle undefined, null, empty string, or case-insensitive 'general')
    const isGeneral = !record.group || record.group.trim() === '' || record.group.toLowerCase() === 'general';
    if (isGeneral) return true;
    if (authStatus === AuthStatus.GUEST) return false;
    if (!userProfile) return false;

    // Find the project for this record
    const project = (projects as Project[]).find(p => p.name.toLowerCase() === (record.group || '').toLowerCase());
    if (!project) return true; // Default to true for legacy or General if not found

    if (project.ownerEmail === userProfile.email) return true;

    const members = project.members || [];
    const member = members.find(m => m.email === userProfile.email);
    if (!member) return false;

    if (action === 'delete') {
      return member.role === 'owner';
    }
    if (action === 'edit') {
      return member.role === 'owner' || member.role === 'admin' || member.role === 'editor';
    }
    return false;
  };

  const handleInviteClick = () => {
    if (!PLAN_FEATURES[usageStats.plan].team) {
      addNotification({
        title: 'Feature Restricted',
        message: 'Collaboration and team projects are not available on your current plan.',
        type: 'error'
      });
      return;
    }
    const project = (projects as Project[]).find(p => p.name === projectFilter);
    if (project) {
      setProjectToManage(project);
    }
  };

  const [projectToManage, setProjectToManage] = useState<Project | null>(null);
  const [projectMembers, setProjectMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CollaborationRole>('viewer');

  useEffect(() => {
    if (!projectToManage) {
      setProjectMembers([]);
      return;
    }

    setLoadingMembers(true);
    const q = query(
      collection(db, 'projectMembers'),
      where('projectId', '==', projectToManage.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const members = snapshot.docs.map(doc => doc.data());
      setProjectMembers(members);
      setLoadingMembers(false);
    }, (err) => {
      console.error("Error fetching members:", err);
      setLoadingMembers(false);
    });

    return () => unsubscribe();
  }, [projectToManage]);

  const handleDownloadClick = (asset: { id: string; name: string; url: string; type: 'audio' | 'transcript' }) => {
    if (authStatus === AuthStatus.GUEST) {
      setShowGuestDownloadPrompt(true);
    } else if (!PLAN_FEATURES[usageStats.plan].export) {
      addNotification({
        title: 'Feature Restricted',
        message: 'Exporting transcripts and audio files is not available on your current plan.',
        type: 'error'
      });
    } else {
      setDownloadingAsset(asset);
    }
  };

  const handlePlayFull = (id: string, title: string, url: string) => {
    if (!url) {
      addNotification({
        title: 'Playback Error',
        message: 'No audio source is available for this recording.',
        type: 'error'
      });
      return;
    }
    if (activePlaybackId === id && activePlaybackSegIdx === undefined && playbackStatus === 'playing') {
      onPause();
    } else {
      onPlay({ id, title, url });
    }
  };

  const handlePlaySegment = (item: AudioToTextRecord, seg: TranscriptSegment, idx: number) => {
    if (!item.originalAudioUrl) {
      addNotification({
        title: 'Playback Error',
        message: 'No audio source is available for this recording segment.',
        type: 'error'
      });
      return;
    }
    if (activePlaybackId === item.id && activePlaybackSegIdx === idx && playbackStatus === 'playing') {
      onPause();
    } else {
      onPlay({ id: item.id, title: item.fileName, url: item.originalAudioUrl, segmentIndex: idx }, seg.startTime, seg.endTime);
    }
  };

  const handleDownloadConfirm = async () => {
    if (!downloadingAsset || !selectedFormat) return;

    let contentUrl = downloadingAsset.url;
    const format = selectedFormat.toLowerCase();

    if (downloadingAsset.type === 'transcript') {
      const record = audioHistory.find(h => h.id === downloadingAsset.id);
      if (record) {
        const segments = record.transcript.map((s, idx) => ({
          speaker: record.speakerMap[s.speaker] || s.speaker,
          text: s.text,
          isBookmarked: record.bookmarks.some(b => b.segmentIndex === idx)
        }));
        contentUrl = generateTranscriptBlob(segments, format);
      }
    }

    try {
      await executeDownload(downloadingAsset.name, contentUrl, selectedFormat);
    } catch (err) {
      addNotification({
        title: 'Download Error',
        message: 'Download failed. Please check browser permissions.',
        type: 'error'
      });
    }
    
    setDownloadingAsset(null);
    setSelectedFormat('');
  };

  const startBulkDownload = async () => {
    if (!bulkDownloadGroup || bulkFormats.length === 0) return;
    
    const projectAudio = audioHistory.filter(h => h.group === bulkDownloadGroup);
    const projectSynth = textHistory.filter(h => h.group === bulkDownloadGroup);
    
    if (projectAudio.length === 0 && projectSynth.length === 0) {
      alert("No assets found in this project.");
      return;
    }

    let delay = 0;
    const delayStep = 200;

    for (const format of bulkFormats) {
      const fmt = format.toLowerCase();
      
      if (['txt', 'docx', 'pdf'].includes(fmt)) {
        // Download transcripts for all audio records in project
        for (const record of projectAudio) {
          const currentDelay = delay;
          setTimeout(async () => {
            const segments = record.transcript.map((s, idx) => ({
              speaker: record.speakerMap[s.speaker] || s.speaker,
              text: s.text,
              isBookmarked: record.bookmarks.some(b => b.segmentIndex === idx)
            }));
            const contentUrl = generateTranscriptBlob(segments, format);
            await executeDownload(`${record.fileName}_transcript`, contentUrl, format);
          }, currentDelay);
          delay += delayStep;
        }
      } else if (['wav', 'mp3'].includes(fmt)) {
        // Download audio for all records in project
        for (const record of projectAudio) {
          if (record.originalAudioUrl) {
            const currentDelay = delay;
            setTimeout(() => executeDownload(record.fileName, record.originalAudioUrl!, format), currentDelay);
            delay += delayStep;
          }
        }
        for (const record of projectSynth) {
          const currentDelay = delay;
          setTimeout(() => executeDownload(`synthesis_${record.id}`, record.audioUrl, format), currentDelay);
          delay += delayStep;
        }
      }
    }
    
    setBulkDownloadGroup(null);
    setBulkFormats([]);
  };

  const toggleBookmark = (record: AudioToTextRecord, segIdx: number) => {
    if (!checkPermission(record, 'edit')) {
      addNotification({
        title: 'Permission Denied',
        message: 'You do not have permission to bookmark segments in this project.',
        type: 'error'
      });
      return;
    }

    const seg = record.transcript[segIdx];
    const existingIdx = record.bookmarks.findIndex(b => b.segmentIndex === segIdx);
    let newBookmarks = [...record.bookmarks];
    
    if (existingIdx >= 0) {
      newBookmarks.splice(existingIdx, 1);
    } else {
      const newBookmark: Bookmark = {
        id: Math.random().toString(36).substr(2, 9),
        segmentIndex: segIdx,
        speaker: record.speakerMap[seg.speaker] || seg.speaker,
        text: seg.text,
        timestamp: Date.now(),
        userName: userProfile?.displayName || userProfile?.name || 'Guest'
      };
      newBookmarks.push(newBookmark);
    }
    
    onUpdateAudio({ ...record, bookmarks: newBookmarks });
  };

  const cycleReadStatus = (item: AudioToTextRecord) => {
    const statuses: ReadStatus[] = ['not-read', 'in-progress', 'read'];
    const nextIdx = (statuses.indexOf(item.readStatus) + 1) % statuses.length;
    onUpdateAudio({ ...item, readStatus: statuses[nextIdx] });
  };

  const getReadStatusStyle = (status: ReadStatus) => {
    switch (status) {
      case 'read': return 'bg-[#E7F7EF] text-[#229A62] border-transparent';
      case 'in-progress': return 'bg-[#FFF8E7] text-[#B48400] border-transparent';
      default: return 'bg-[#F1F3F9] text-[#7E89A3] border-transparent';
    }
  };

  const clearAllFilters = () => {
    setStatusFilter('all');
    setStartDate('');
    setEndDate('');
    setProjectFilter('all');
    onClearFilter();
  };

  const handleProjectDropdownChange = (value: string) => {
    setProjectFilter(value);
    if (onSetFilterGroup) {
      onSetFilterGroup(value === 'all' ? null : value);
    }
  };

  // Project list with General and recording counts for drag-and-drop & filtering
  const projectListWithGeneral = useMemo(() => {
    const list: Array<{ id: string; name: string; isDefault?: boolean; count: number }> = [];

    // Always ensure General is present as first canonical group
    const generalProject = (projects as Project[]).find(p => p.name.toLowerCase() === 'general');
    const generalCount = audioHistory.filter(h => !h.deletedAt && (!h.group || h.group.toLowerCase() === 'general')).length;
    list.push({
      id: generalProject?.id || 'general-default',
      name: 'General',
      isDefault: true,
      count: generalCount
    });

    // Add other projects
    projects.forEach(p => {
      if (p.name.toLowerCase() !== 'general') {
        const count = audioHistory.filter(h => 
          !h.deletedAt && (
            h.projectId === p.id ||
            (Array.isArray(h.projectIds) && h.projectIds.includes(p.id)) ||
            h.group?.toLowerCase() === p.name.toLowerCase()
          )
        ).length;
        list.push({
          id: p.id,
          name: p.name,
          isDefault: Boolean(p.isDefault),
          count
        });
      }
    });

    // Also include any groups from groups prop that might not be in projects
    groups.forEach(g => {
      if (g.toLowerCase() !== 'general' && !list.some(p => p.name.toLowerCase() === g.toLowerCase())) {
        const count = audioHistory.filter(h => !h.deletedAt && h.group?.toLowerCase() === g.toLowerCase()).length;
        list.push({
          id: `group-${g}`,
          name: g,
          isDefault: false,
          count
        });
      }
    });

    return list;
  }, [projects, groups, audioHistory]);

  const handleDragStart = (e: React.DragEvent, item: AudioToTextRecord | TextToAudioRecord) => {
    // If the drag originated from an interactive element (button, input, select, audio player, link), cancel drag
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, button, [role="button"], audio, [data-no-drag="true"]')) {
      e.preventDefault();
      return;
    }

    if (!checkPermission(item, 'edit')) {
      e.preventDefault();
      return;
    }
    setDraggedRecord(item);
    setIsDragging(true);
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.setData('application/json', JSON.stringify({
      id: item.id,
      group: item.group || 'General',
      isAudio: 'fileName' in item
    }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleGripDragStart = (e: React.DragEvent, item: AudioToTextRecord | TextToAudioRecord) => {
    e.stopPropagation();
    if (!checkPermission(item, 'edit')) {
      e.preventDefault();
      return;
    }
    setDraggedRecord(item);
    setIsDragging(true);
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.setData('application/json', JSON.stringify({
      id: item.id,
      group: item.group || 'General',
      isAudio: 'fileName' in item
    }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedRecord(null);
    setIsDragging(false);
    setDragOverGroup(null);
    setHoveredCardId(null);
    setIsOverNewProjectTarget(false);
  };

  const handleConfirmNewProjectMove = () => {
    if (!itemForNewProjectDrop || !newProjectDropName.trim()) return;
    const projName = newProjectDropName.trim();
    
    // Create the project via onAddGroup
    onAddGroup(projName);

    // Reassign the recording
    if ('fileName' in itemForNewProjectDrop) {
      onUpdateAudio({
        ...itemForNewProjectDrop,
        group: projName
      });
      addNotification({
        title: 'Project Created & Recording Reassigned',
        message: `Created project "${projName}" and moved "${itemForNewProjectDrop.fileName}".`,
        type: 'success'
      });
    } else {
      onUpdateText({
        ...itemForNewProjectDrop,
        group: projName
      });
      addNotification({
        title: 'Project Created & Synthesis Reassigned',
        message: `Created project "${projName}" and moved synthesis.`,
        type: 'success'
      });
    }

    setItemForNewProjectDrop(null);
    setNewProjectDropName('');
    handleDragEnd();
  };

  const handleDropOnProject = (targetGroupName: string) => {
    if (!draggedRecord) return;
    const currentGroup = draggedRecord.group || 'General';

    if (currentGroup.toLowerCase() === targetGroupName.toLowerCase()) {
      addNotification({
        title: 'Already in Project',
        message: `Recording "${'fileName' in draggedRecord ? draggedRecord.fileName : draggedRecord.textPreview}" is already in "${targetGroupName}".`,
        type: 'info'
      });
      handleDragEnd();
      return;
    }

    // Permission check for target project
    const targetProject = (projects as Project[]).find(p => p.name.toLowerCase() === targetGroupName.toLowerCase());
    if (targetProject && targetProject.ownerEmail !== userProfile?.email) {
      const member = targetProject.members?.find(m => m.email === userProfile?.email);
      if (member && member.role === 'viewer') {
        addNotification({
          title: 'Permission Denied',
          message: `You do not have permission to move assets into "${targetGroupName}".`,
          type: 'error'
        });
        handleDragEnd();
        return;
      }
    }

    // Check if dragging an item that is part of a multi-select
    if (selectedIds.has(draggedRecord.id) && selectedIds.size > 1) {
      const audiosToMove = audioHistory.filter(h => selectedIds.has(h.id) && checkPermission(h, 'edit'));
      audiosToMove.forEach(item => {
        onUpdateAudio({
          ...item,
          group: targetGroupName,
          projectId: targetProject?.id || null
        });
      });

      const textsToMove = textHistory.filter(h => selectedIds.has(h.id) && checkPermission(h, 'edit'));
      textsToMove.forEach(item => {
        onUpdateText({
          ...item,
          group: targetGroupName
        });
      });

      const totalCount = audiosToMove.length + textsToMove.length;
      setSelectedIds(new Set());
      addNotification({
        title: 'Recordings Reassigned',
        message: `Successfully moved ${totalCount} recordings from "${currentGroup}" to "${targetGroupName}".`,
        type: 'success'
      });
    } else {
      // Single record move
      if ('fileName' in draggedRecord) {
        onUpdateAudio({
          ...draggedRecord,
          group: targetGroupName,
          projectId: targetProject?.id || null
        });
        addNotification({
          title: 'Recording Reassigned',
          message: `Moved "${draggedRecord.fileName}" from "${currentGroup}" to "${targetGroupName}".`,
          type: 'success'
        });
      } else {
        onUpdateText({
          ...draggedRecord,
          group: targetGroupName
        });
        addNotification({
          title: 'Synthesis Reassigned',
          message: `Moved "${draggedRecord.textPreview || 'Synthesis'}" from "${currentGroup}" to "${targetGroupName}".`,
          type: 'success'
        });
      }
    }

    handleDragEnd();
  };

  const toggleTextExpansion = (id: string) => {
    setExpandedTextIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleStrategicAnalysis = (id: string) => {
    setExpandedStrategicAnalysisIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // NORTH STAR: Verified Decision Retrieval from organizational memory
        trackDecisionRetrieved({
          userId: userProfile?.uid,
          entityId: id,
          source: 'history_dashboard'
        });
      }
      return next;
    });
  };

  const toggleIntelligence = (id: string) => {
    setExpandedIntelligenceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // NORTH STAR: Verified Decision Retrieval from organizational memory
        trackDecisionRetrieved({
          userId: userProfile?.uid,
          entityId: id,
          source: 'history_dashboard'
        });
      }
      return next;
    });
  };

  const toggleExecution = (id: string) => {
    setExpandedExecutionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleReminders = (id: string) => {
    setExpandedReminderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleUnresolved = (id: string) => {
    setExpandedUnresolvedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFollowUp = (id: string) => {
    setExpandedFollowUpIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runStrategicAnalysis = async (record: AudioToTextRecord) => {
    if (isAnalyzing) return;

    if (!checkThinkingLimit()) {
      addNotification({
        title: 'AI Requests Limit Reached',
        message: 'You have reached your AI Requests limit for this month.',
        type: 'error'
      });
      return;
    }
    
    setIsAnalyzing(record.id);
    try {
      const plan = userProfile?.plan || 'guest';
      const fullTranscript = record.transcript.map(t => `${record.speakerMap[t.speaker] || t.speaker}: ${t.text}`).join('\n');
      const intelligence = await processUnifiedMeetingIntelligence(fullTranscript, plan);
      
      if (intelligence) {
        await incrementThinkingUsage();
        onUpdateAudio({
          ...record,
          strategicAnalysis: intelligence.strategicAnalysis,
          meetingIntelligence: intelligence.meetingIntelligence,
          executionTracker: intelligence.executionTracker,
          calendarReminders: intelligence.calendarReminders,
          unifiedIntelligence: intelligence
        });
        
        // Auto expand after generation
        setExpandedStrategicAnalysisIds(prev => {
          const next = new Set(prev);
          next.add(record.id);
          return next;
        });
        
        addNotification({
          title: 'Strategic Analysis Complete',
          message: 'Your deep insights are ready to view.',
          type: 'success'
        });
      }
    } catch (error) {
      console.error("Strategic analysis failed:", error);
      addNotification({
        title: 'Analysis Failed',
        message: 'Could not generate strategic insights at this time.',
        type: 'error'
      });
    } finally {
      setIsAnalyzing(null);
    }
  };

  const runMeetingIntelligence = async (record: AudioToTextRecord) => {
    if (isAnalyzing === record.id) return;

    if (!checkThinkingLimit()) {
      addNotification({
        title: 'AI Requests Limit Reached',
        message: 'You have reached your AI Requests limit for this month.',
        type: 'error'
      });
      return;
    }

    setIsAnalyzing(record.id);
    try {
      const fullTranscript = record.transcript.map(s => `${record.speakerMap[s.speaker] || s.speaker}: ${s.text}`).join('\n');
      const intelligence = await processUnifiedMeetingIntelligence(fullTranscript, userProfile?.plan || 'guest');
      
      await incrementThinkingUsage();
      const updatedRecord = {
        ...record,
        strategicAnalysis: intelligence.strategicAnalysis,
        meetingIntelligence: intelligence.meetingIntelligence,
        executionTracker: intelligence.executionTracker,
        calendarReminders: intelligence.calendarReminders,
        unifiedIntelligence: intelligence
      };
      
      onUpdateAudio(updatedRecord);
      addNotification({
        title: 'Intelligence Generated',
        message: 'Meeting intelligence, execution tracker, and reminders have been generated.',
        type: 'success'
      });
    } catch (error) {
      console.error('Error generating intelligence:', error);
      addNotification({
        title: 'Analysis Failed',
        message: 'Failed to generate meeting intelligence. Please try again.',
        type: 'error'
      });
    } finally {
      setIsAnalyzing(null);
    }
  };

  const displayTitle = projectFilter === 'all' ? "Intelligence Archive" : `Project: ${projectFilter}`;

  return (
    <div className="space-y-4 pb-40 animate-in fade-in h-full relative">
      {/* Modals */}
      {/* Guest Download Prompt */}
      {showGuestDownloadPrompt && (
        <div className="fixed inset-0 bg-brand-primary/80 backdrop-blur-md z-[400] flex items-center justify-center p-6 text-left">
          <div className="bg-white rounded-lg p-10 max-sm w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-brand-background text-brand-primary rounded-lg flex items-center justify-center mx-auto text-3xl">
              <i className="fa-solid fa-user-plus"></i>
            </div>
            <div className="text-center space-y-3">
              <h2 className="text-brand-primary">Account Required</h2>
              <p className="text-slate-500 text-sm font-normal">
                Downloading intelligence assets is an Enterprise feature. Please <span className="font-bold text-brand-primary">create an account</span> to export your transcripts and audio files.
              </p>
            </div>
            <div className="flex flex-col space-y-3">
              <button 
                onClick={() => { setShowGuestDownloadPrompt(false); onClearFilter(); }}
                className="w-full py-4 bg-brand-primary text-white rounded-lg font-medium tracking-widest text-[13px] shadow-xl active:scale-95 transition-all"
              >
                Sign up now
              </button>
              <button 
                onClick={() => setShowGuestDownloadPrompt(false)}
                className="text-[13px] font-medium text-slate-400 text-center hover:text-brand-primary"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Project Deletion Modal */}
      {showProjectDeleteConfirm && projectToDelete && (
        <div className="fixed inset-0 bg-brand-primary/80 backdrop-blur-md z-[300] flex items-center justify-center p-6 text-left">
          <div className="bg-white rounded-lg p-10 max-sm w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-red-50 text-red-600 rounded-lg flex items-center justify-center mx-auto text-3xl">
              <i className="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div className="text-center space-y-3">
              <h2 className="text-brand-primary">Delete Project</h2>
              <p className="text-slate-500 text-sm font-normal">
                How would you like to handle the assets within <span className="font-bold text-red-600">{projectToDelete.name}</span>?
              </p>
            </div>
            <div className="flex flex-col space-y-3">
              <button 
                onClick={() => confirmProjectDelete(false)}
                className="w-full py-4 bg-brand-background text-brand-primary border border-brand-divider/20 rounded-lg font-medium tracking-widest text-[11px] hover:bg-brand-divider/10 transition-all flex items-center justify-between px-6"
              >
                <span>Delete project, move assets to 'General'</span>
                <i className="fa-solid fa-arrow-right-to-bracket"></i>
              </button>
              <button 
                onClick={() => confirmProjectDelete(true)}
                className="w-full py-4 bg-red-600 text-white rounded-lg font-medium tracking-widest text-[11px] shadow-xl active:scale-95 transition-all flex items-center justify-between px-6"
              >
                <span>Delete project and all assets permanently</span>
                <i className="fa-solid fa-trash-can"></i>
              </button>
              <button 
                onClick={() => { setShowProjectDeleteConfirm(false); setProjectToDelete(null); }}
                className="text-[11px] font-medium text-slate-400 text-center hover:text-brand-primary pt-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Members Modal */}
      {projectToManage && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6 sm:p-0">
          <div className="bg-white rounded-2xl p-7 max-w-[320px] w-full space-y-7 shadow-2xl animate-in zoom-in-95 border border-brand-divider/20">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <h2 className="text-[22px] font-black text-brand-primary tracking-tight leading-tight uppercase">Project <br/>Collaboration</h2>
                <p className="text-slate-500 text-[12px] font-bold leading-tight">
                  Manage access for <span className="text-brand-primary font-black uppercase">{projectToManage.name}</span>
                </p>
              </div>
              <button 
                onClick={() => setProjectToManage(null)} 
                className="text-slate-400 hover:text-brand-primary transition-colors p-1"
              >
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <div className="space-y-6">
               {/* Team Members List */}
               <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Team members</label>
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 text-left">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 bg-brand-primary text-white rounded-xl flex items-center justify-center text-[12px] font-black shadow-lg shadow-brand-primary/20 overflow-hidden">
                        {projectToManage.ownerEmail === userProfile?.email && (userProfile?.photoURL || userProfile?.avatarUrl) ? (
                          <img 
                            src={userProfile.photoURL || userProfile.avatarUrl} 
                            alt="Owner" 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span>{(projectToManage.ownerEmail?.charAt(0) || 'U').toUpperCase()}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-black text-brand-primary leading-tight truncate">{projectToManage.ownerEmail === userProfile?.email ? 'You' : (projectToManage as any).ownerName || projectToManage.ownerEmail?.split('@')[0]}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Project Owner</p>
                      </div>
                    </div>
                  </div>

                  {loadingMembers ? (
                    <div className="flex justify-center py-4">
                      <div className="w-5 h-5 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : projectMembers.map((member, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100 text-left">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 bg-slate-100 text-slate-400 rounded-xl flex items-center justify-center text-[11px] font-black border border-slate-200 uppercase overflow-hidden">
                          {member.photoURL || member.avatarUrl ? (
                            <img 
                              src={member.photoURL || member.avatarUrl} 
                              alt="Member" 
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span>{(member.displayName?.charAt(0) || member.email?.charAt(0) || 'U').toUpperCase()}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-black text-brand-primary leading-tight truncate">{member.email === userProfile?.email ? 'You' : (member as any).displayName || member.email?.split('@')[0]}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{member.role}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Invite Section */}
              {(() => {
                const isOwner = projectToManage.ownerEmail === userProfile?.email;
                const member = projectToManage.members?.find(m => m.email === userProfile?.email);
                const isEditor = member?.role === 'admin' || member?.role === 'editor';
                const isDefaultAdmin = userProfile?.email === 'riyamshah2509@gmail.com';
                const canInvite = isOwner || (usageStats.plan === 'enterprise' && isEditor) || isDefaultAdmin;

                if (!canInvite) return null;

                return (
                  <div className="space-y-3 text-left">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Invite new member</label>
                    <div className="space-y-2">
                      <input 
                        type="email"
                        placeholder="colleague@company.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[13px] font-medium outline-none focus:ring-2 focus:ring-brand-primary/30 transition-all placeholder:text-slate-400"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <select 
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[12px] font-black text-brand-primary outline-none focus:ring-2 focus:ring-brand-primary/30 transition-all appearance-none cursor-pointer uppercase tracking-widest"
                            value={inviteRole}
                            onChange={(e) => setInviteRole(e.target.value as CollaborationRole)}
                          >
                            <option value="viewer">Viewer</option>
                            <option value="commenter">Commenter</option>
                            <option value="admin">Project Admin</option>
                          </select>
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-primary opacity-50">
                            <i className="fa-solid fa-chevron-down text-[10px]"></i>
                          </div>
                        </div>
                        <button 
                          disabled={isInviting || !inviteEmail.trim()}
                          onClick={async () => {
                            if (inviteEmail.trim()) {
                              setIsInviting(true);
                              try {
                                await onInviteToProject(projectToManage.name, inviteEmail.trim(), inviteRole);
                                setInviteEmail('');
                              } finally {
                                setIsInviting(false);
                              }
                            }
                          }}
                          className="bg-brand-primary text-white px-5 py-3 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] hover:shadow-lg active:scale-95 transition-all shadow-md shadow-brand-primary/20 disabled:opacity-50"
                        >
                          {isInviting ? '...' : 'INVITE'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="pt-2">
              <button 
                onClick={() => setProjectToManage(null)}
                className="w-full py-4.5 bg-brand-primary text-white rounded-xl font-black tracking-[0.2em] text-[12px] shadow-2xl shadow-brand-primary/30 active:scale-[0.98] transition-all uppercase"
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      )}

      {downloadingAsset && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6 text-left">
          <div className="bg-white rounded-lg p-10 max-w-sm w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-2">
              <h2 className="text-brand-primary">Download intelligence</h2>
              <p className="text-slate-500 text-sm">Target: {downloadingAsset?.name}</p>
            </div>
            <div className="space-y-4">
              <label className="text-[13px] font-medium text-slate-400 tracking-widest">Select output format</label>
              <div className="grid grid-cols-2 gap-3">
                {downloadingAsset?.type === 'transcript' ? (
                  ['TXT', 'DOCX', 'PDF'].map(fmt => (
                    <button key={fmt} onClick={() => setSelectedFormat(fmt)} className={`py-3 rounded-lg text-[13px] font-medium border-2 transition-all ${selectedFormat === fmt ? 'bg-brand-primary text-white border-brand-primary' : 'bg-brand-background text-slate-400 border-brand-divider/20 hover:border-brand-primary'}`}>{fmt}</button>
                  ))
                ) : (
                  ['WAV', 'MP3'].map(fmt => (
                    <button key={fmt} onClick={() => setSelectedFormat(fmt)} className={`py-3 rounded-lg text-[13px] font-medium border-2 transition-all ${selectedFormat === fmt ? 'bg-brand-primary text-white border-brand-primary' : 'bg-brand-background text-slate-400 border-brand-divider/20 hover:border-brand-primary'}`}>{fmt}</button>
                  ))
                )}
              </div>
            </div>
            <div className="flex flex-col space-y-3">
              <button onClick={handleDownloadConfirm} disabled={!selectedFormat} className="w-full py-4 bg-brand-primary text-white rounded-lg font-medium tracking-widest text-[13px] disabled:opacity-50 transition-all shadow-lg">Confirm & initialize download</button>
              <button onClick={() => setDownloadingAsset(null)} className="text-[13px] font-medium text-slate-400 text-center hover:text-brand-primary transition-colors">Cancel request</button>
            </div>
          </div>
        </div>
      )}

      {bulkDownloadGroup && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[210] flex items-center justify-center p-6 text-left">
          <div className="bg-white rounded-lg p-10 max-md w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-2">
              <h2 className="text-brand-primary">Bulk project export</h2>
              <p className="text-slate-500 text-sm">Project: {bulkDownloadGroup}</p>
            </div>
            <div className="space-y-4">
              <label className="text-[13px] font-medium text-slate-400 tracking-widest">Select formats to include</label>
              <div className="grid grid-cols-3 gap-2">
                {['TXT', 'DOCX', 'PDF', 'WAV', 'MP3'].map(fmt => (
                  <button key={fmt} onClick={() => setBulkFormats(prev => prev.includes(fmt) ? prev.filter(f => f !== fmt) : [...prev, fmt])} className={`py-2 rounded-lg text-[13px] font-medium border-2 transition-all ${bulkFormats.includes(fmt) ? 'bg-brand-primary text-white border-brand-primary' : 'bg-brand-background border-brand-divider/20 text-slate-400 hover:border-brand-primary'}`}>{fmt}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col space-y-3">
              <button onClick={startBulkDownload} disabled={bulkFormats.length === 0} className="w-full py-4 bg-brand-primary text-white rounded-lg font-medium tracking-widest text-[13px] disabled:opacity-50 transition-all shadow-lg">Package & download project</button>
              <button onClick={() => setBulkDownloadGroup(null)} className="text-[13px] font-medium text-slate-400 text-center hover:text-brand-primary transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Item Deletion */}
      {(showBulkDeleteConfirm || itemToDelete) && (
        <div className="fixed inset-0 bg-brand-primary/80 backdrop-blur-md z-[300] flex items-center justify-center p-6 text-left">
          <div className="bg-white rounded-lg p-10 max-sm w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-red-50 text-red-600 rounded-lg flex items-center justify-center mx-auto text-3xl">
              <i className="fa-solid fa-trash-can"></i>
            </div>
            <div className="text-center space-y-3">
              <h2 className="text-brand-primary">Confirm deletion</h2>
              <p className="text-slate-500 text-sm font-normal">
                {itemToDelete ? (
                  <>Are you sure you want to delete <span className="font-bold text-red-600">{itemToDelete.name}</span>? {itemToDelete.isPermanent ? "This action is permanent and cannot be undone." : "This action can be undone from the trash within 30 days."}</>
                ) : (
                  <>Are you sure you want to delete <span className="font-bold text-red-600">{selectedIds.size}</span> items? This action will move them to the trash.</>
                )}
              </p>
            </div>
            <div className="flex flex-col space-y-3">
              <button 
                onClick={itemToDelete ? confirmSingleDelete : handleBulkDelete}
                className="w-full py-4 bg-red-600 text-white rounded-lg font-medium tracking-widest text-[11px] shadow-xl active:scale-95 transition-all"
              >
                {itemToDelete?.isPermanent ? "Delete" : "Move to Trash"}
              </button>
              <button 
                onClick={() => { setShowBulkDeleteConfirm(false); setItemToDelete(null); }}
                className="text-[11px] font-medium text-slate-400 text-center hover:text-brand-primary pt-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Item Restoration */}
      {itemToRestore && (
        <div className="fixed inset-0 bg-brand-primary/80 backdrop-blur-md z-[300] flex items-center justify-center p-6 text-left">
          <div className="bg-white rounded-lg p-10 max-sm w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-brand-primary/5 text-brand-primary rounded-lg flex items-center justify-center mx-auto text-3xl">
              <i className="fa-solid fa-rotate-left"></i>
            </div>
            <div className="text-center space-y-3">
              <h2 className="text-brand-primary">Confirm restoration</h2>
              <p className="text-slate-500 text-sm font-normal">
                Are you sure you want to restore <span className="font-bold text-brand-primary">{itemToRestore.name}</span>? This will move it back to its original location.
              </p>
            </div>
            <div className="flex flex-col space-y-3">
              <button 
                onClick={confirmRestore}
                className="w-full py-4 bg-brand-primary text-white rounded-lg font-medium tracking-widest text-[11px] shadow-xl active:scale-95 transition-all"
              >
                Restore
              </button>
              <button 
                onClick={() => setItemToRestore(null)}
                className="text-[11px] font-medium text-slate-400 text-center hover:text-brand-primary pt-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal for Creating New Project and Moving Dropped Recording */}
      {itemForNewProjectDrop && (
        <div className="fixed inset-0 bg-brand-primary/80 backdrop-blur-md z-[300] flex items-center justify-center p-6 text-left">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full space-y-6 shadow-2xl animate-in zoom-in-95 border border-slate-100">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-xl flex items-center justify-center text-xl shrink-0 shadow-xs">
                <FolderPlus className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-black text-brand-primary tracking-tight">Create Project & Reassign</h2>
                <p className="text-xs text-slate-500 font-medium">
                  Move <span className="font-bold text-slate-700">{('fileName' in itemForNewProjectDrop ? itemForNewProjectDrop.fileName : itemForNewProjectDrop.textPreview)}</span> from 'General' into a new project group.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">New Project Name</label>
              <input
                type="text"
                autoFocus
                placeholder="e.g. Product Strategy, Marketing 2026, Q3 Reviews"
                value={newProjectDropName}
                onChange={(e) => setNewProjectDropName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newProjectDropName.trim()) {
                    handleConfirmNewProjectMove();
                  }
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-brand-primary outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary transition-all"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setItemForNewProjectDrop(null);
                  setNewProjectDropName('');
                }}
                className="px-5 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newProjectDropName.trim()}
                onClick={handleConfirmNewProjectMove}
                className="px-6 py-2.5 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-xl text-xs font-bold shadow-lg disabled:opacity-40 transition-all flex items-center gap-2"
              >
                <FolderPlus className="w-4 h-4" />
                <span>Create & Move Recording</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AH.183: Multi-Project Recording Association Modal */}
      {assocRecord && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[280] flex items-center justify-center p-4 sm:p-6 text-left">
          <div className="bg-white rounded-2xl p-6 sm:p-7 max-w-lg w-full space-y-6 shadow-2xl animate-in zoom-in-95 border border-brand-divider/20">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-primary/10 text-brand-primary">
                  <Layers className="w-3 h-3" />
                  <span>Canonical Recording</span>
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                  Project Associations
                </h2>
                <p className="text-xs text-slate-500 font-medium truncate max-w-sm">
                  {assocRecord.fileName}
                </p>
              </div>
              <button 
                onClick={() => setAssocRecord(null)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                title="Close"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            </div>

            {/* Error Message */}
            {assocErrorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                <i className="fa-solid fa-circle-exclamation mt-0.5 text-red-500"></i>
                <div className="flex-1">{assocErrorMessage}</div>
              </div>
            )}

            {/* Current Associated Projects List */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Associated Projects ({assocProjects.length})
              </label>
              
              {isAssocLoading ? (
                <div className="py-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <i className="fa-solid fa-circle-notch fa-spin text-brand-primary"></i>
                  <span>Loading associations...</span>
                </div>
              ) : assocProjects.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-center text-xs text-slate-500">
                  This recording is in General and not currently associated with any specific project.
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {assocProjects.map((proj) => (
                    <div 
                      key={proj.id} 
                      className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200/70 transition-all text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Folder className="w-4 h-4 text-brand-primary shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-800 truncate">{proj.name}</span>
                            {proj.isPrimary && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-brand-primary text-white uppercase tracking-wider">
                                Primary
                              </span>
                            )}
                          </div>
                          {proj.role && (
                            <span className="text-[10px] text-slate-400 font-mono">Role: {proj.role}</span>
                          )}
                        </div>
                      </div>

                      {proj.canManage && (
                        <button
                          type="button"
                          disabled={assocActionPending}
                          onClick={() => handleRemoveProjectAssociation(proj.id)}
                          className="px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200 disabled:opacity-40"
                          title="Remove association (recording audio & transcripts will not be deleted)"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Associate with another project */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Link to Another Project
              </label>

              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={assocSelectedNewProjId}
                  onChange={(e) => setAssocSelectedNewProjId(e.target.value)}
                  disabled={assocActionPending || isAssocLoading}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-brand-primary focus:border-brand-primary"
                >
                  <option value="">Select a project to link...</option>
                  {(projects as Project[])
                    .filter(p => p.name.toLowerCase() !== 'general' && !assocProjects.some(ap => ap.id === p.id))
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>

                <button
                  type="button"
                  disabled={!assocSelectedNewProjId || assocActionPending}
                  onClick={handleAddProjectAssociation}
                  className="px-4 py-2 bg-brand-primary hover:bg-brand-primary/90 text-white rounded-xl text-xs font-bold shadow disabled:opacity-40 transition-all flex items-center justify-center gap-1.5 shrink-0"
                >
                  {assocActionPending ? (
                    <i className="fa-solid fa-circle-notch fa-spin"></i>
                  ) : (
                    <FolderPlus className="w-3.5 h-3.5" />
                  )}
                  <span>Add Association</span>
                </button>
              </div>

              <p className="text-[11px] text-slate-400">
                Associating links the canonical recording across project spaces without duplicating audio storage or transcripts.
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAssocRecord(null)}
                className="px-5 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <header className="space-y-6 text-left border-b border-brand-divider/20 pb-8">
        <div className="space-y-2">
          <h1 className="text-brand-primary text-3xl sm:text-[36px] md:text-[48px] font-bold tracking-tight">
            {displayTitle}
          </h1>
          <p className="text-slate-500 text-sm sm:text-base md:text-lg font-medium">Categorical record keeping for high-fidelity enterprise assets.</p>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex flex-wrap items-center gap-4 md:gap-6">
             {projectFilter !== 'all' && (
               <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                 {/* Collaborators Indicator */}
                 <div className="flex -space-x-2">
                   {(() => {
                     const project = (projects as Project[]).find(p => p.name === projectFilter) || (projects as Project[]).find(p => p.name === 'General');
                     const members = project?.members || [];
                     return (
                       <>
                         <div className="w-10 h-10 rounded-full border-2 border-white bg-brand-primary text-white flex items-center justify-center text-[11px] font-bold shadow-sm relative" title={`Owner: ${project?.ownerEmail}`}>
                           {(project?.ownerEmail?.charAt(0) || 'U').toUpperCase()}
                           <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></div>
                         </div>
                         {members.slice(0, 3).map((m, i) => (
                           <div key={i} className="w-10 h-10 rounded-full border-2 border-white bg-slate-200 text-slate-600 flex items-center justify-center text-[11px] font-bold shadow-sm relative" title={`${m.role}: ${m.email}`}>
                             {(m.email?.charAt(0) || 'U').toUpperCase()}
                             {m.isOnline && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></div>}
                           </div>
                         ))}
                         {members.length > 3 && (
                           <div className="w-10 h-10 rounded-full border-2 border-white bg-slate-100 text-slate-400 flex items-center justify-center text-[11px] font-bold shadow-sm">
                             +{members.length - 3}
                           </div>
                         )}
                       </>
                     );
                   })()}
                 </div>

                 <div className="flex bg-white border border-brand-divider/20 rounded-xl p-1 shadow-sm h-fit w-full sm:w-auto overflow-x-auto">
                   <button 
                     onClick={handleInviteClick}
                     className="flex-1 sm:flex-none px-3 sm:px-4 py-2.5 text-[11px] sm:text-[12px] font-bold text-brand-primary hover:bg-brand-primary/5 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                     title="Invite Members"
                   >
                     <i className="fa-solid fa-user-plus"></i>
                     <span>Invite</span>
                   </button>
                   <div className="w-[1px] h-5 bg-brand-divider/20 self-center"></div>
                   <button 
                     onClick={() => setBulkDownloadGroup(projectFilter)}
                     className="flex-1 sm:flex-none px-3 sm:px-4 py-2.5 text-[11px] sm:text-[12px] font-bold text-slate-500 hover:text-brand-primary rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                     title="Bulk Export Project"
                   >
                     <i className="fa-solid fa-cloud-arrow-down"></i>
                     <span className="hidden sm:inline">Bulk export</span>
                     <span className="sm:hidden">Export</span>
                   </button>
                   <div className="w-[1px] h-5 bg-brand-divider/20 self-center"></div>
                   <button 
                     onClick={() => {
                       const project = (projects as Project[]).find(p => p.name === projectFilter);
                       const isOwner = project?.ownerEmail === userProfile?.email;
                       if (!isOwner) {
                         alert("Only the project owner can delete the project.");
                         return;
                       }
                       setProjectToDelete({ name: projectFilter, deleteAssets: false });
                       setShowProjectDeleteConfirm(true);
                     }}
                     className="flex-1 sm:flex-none px-3 sm:px-4 py-2.5 text-[11px] sm:text-[12px] font-bold text-slate-400 hover:text-red-500 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                     title="Delete Entire Project"
                   >
                     <i className="fa-solid fa-trash-can"></i>
                     <span className="hidden sm:inline">Delete project</span>
                     <span className="sm:hidden">Delete</span>
                   </button>
                 </div>
               </div>
             )}
          </div>

          <div className="flex bg-brand-background p-1.5 rounded-xl w-full lg:w-fit border border-brand-divider/20 shadow-inner h-fit overflow-x-auto scrollbar-hide">
            <button onClick={() => { setActiveTab('recorded'); setSelectedIds(new Set()); }} className={`flex-1 lg:flex-none px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === 'recorded' ? 'bg-white text-brand-primary shadow-md' : 'text-slate-400 hover:text-brand-primary'}`}>Recorded</button>
            <button onClick={() => { setActiveTab('live'); setSelectedIds(new Set()); }} className={`flex-1 lg:flex-none px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === 'live' ? 'bg-white text-brand-primary shadow-md' : 'text-slate-400 hover:text-brand-primary'}`}>Live</button>
            <button onClick={() => { setActiveTab('synthesis'); setSelectedIds(new Set()); }} className={`flex-1 lg:flex-none px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === 'synthesis' ? 'bg-white text-brand-primary shadow-md' : 'text-slate-400 hover:text-brand-primary'}`}>Synthesis</button>
            <button onClick={() => { setActiveTab('bookmarks'); setSelectedIds(new Set()); }} className={`flex-1 lg:flex-none px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === 'bookmarks' ? 'bg-white text-brand-primary shadow-md' : 'text-slate-400 hover:text-brand-primary'}`}>Bookmarks</button>
            <button onClick={() => { setActiveTab('trash'); setSelectedIds(new Set()); }} className={`flex-1 lg:flex-none px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-widest transition-all whitespace-nowrap ${activeTab === 'trash' ? 'bg-white text-red-600 shadow-md' : 'text-slate-400 hover:text-red-400'}`}>Trash</button>
          </div>
        </div>
      </header>

        {/* Advanced Filters */}
        <div className="bg-white p-4 md:p-5 rounded-xl border border-brand-divider/20 shadow-sm flex flex-wrap items-center gap-4 md:gap-5 text-left">
          <div className="flex items-center space-x-2 shrink-0">
            <i className="fa-solid fa-filter text-brand-primary text-xs"></i>
            <span className="text-[10px] font-black text-slate-400 tracking-widest">Filters</span>
          </div>
 
          <div className="flex flex-wrap items-center gap-4 flex-1">
            <div className="flex flex-col min-w-[120px]">
              <label className="text-[8px] font-black text-slate-400 mb-1 ml-1">Status</label>
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ReadStatusFilter)}
                className="bg-brand-background border border-brand-divider/20 rounded-lg px-3 py-1.5 text-xs font-bold text-brand-primary outline-none focus:ring-1 focus:ring-brand-primary"
              >
                <option value="all">All statuses</option>
                <option value="read">Read</option>
                <option value="in-progress">In progress</option>
                <option value="not-read">Not read</option>
              </select>
            </div>
 
            <div className="flex flex-col">
              <label className="text-[8px] font-black text-slate-400 mb-1 ml-1">Date range</label>
              <div className="flex items-center space-x-2">
                <input 
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-brand-background border border-brand-divider/20 rounded-lg px-2 py-1.5 text-[10px] font-bold text-brand-primary outline-none focus:ring-1 focus:ring-brand-primary w-[110px]"
                />
                <span className="text-slate-300 text-[10px]">to</span>
                <input 
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-brand-background border border-brand-divider/20 rounded-lg px-2 py-1.5 text-[10px] font-bold text-brand-primary outline-none focus:ring-1 focus:ring-brand-primary w-[110px]"
                />
              </div>
            </div>

            <div className="flex flex-col">
              <label className="text-[8px] font-black text-slate-400 mb-1 ml-1">Project</label>
              <select 
                value={projectFilter}
                onChange={(e) => handleProjectDropdownChange(e.target.value)}
                className="bg-brand-background border border-brand-divider/20 rounded-lg px-3 py-1.5 text-xs font-bold text-brand-primary outline-none focus:ring-1 focus:ring-brand-primary"
              >
                <option value="all">All projects</option>
                {projects.map(p => (
                  <option key={p.id} value={p.name}>
                    {p.isDefault ? `${p.name} (Default)` : p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button 
            onClick={clearAllFilters}
            className="px-4 py-2 text-[10px] font-black text-slate-400 hover:text-brand-primary transition-colors"
          >
            Clear all
          </button>
        </div>

        {activeTab === 'trash' && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center gap-3 mt-6 animate-in fade-in slide-in-from-top-2">
            <i className="fa-solid fa-circle-info text-red-500"></i>
            <span className="text-[11px] font-bold text-red-600 uppercase tracking-widest">
              Items in trash are automatically deleted after 30 days.
            </span>
          </div>
        )}

      {/* Multi-select Actions Bar */}
      {selectedIds.size > 0 && (
        <div className={`sticky top-6 z-40 transition-all duration-300 transform opacity-100`}>
          <div className="bg-brand-primary text-white p-4 rounded-lg shadow-2xl flex items-center justify-between border border-white/10 ring-4 ring-black/5">
            <div className="flex items-center space-x-6 ml-4">
               <div className="flex items-center space-x-2">
                 <div className="w-8 h-8 bg-brand-accent rounded-lg flex items-center justify-center font-medium text-[13px] text-brand-primary">
                   {selectedIds.size}
                 </div>
                 <span className="text-[13px] font-medium tracking-widest">Items selected</span>
               </div>
               <button onClick={selectAll} className="text-[11px] font-medium text-slate-400 hover:text-white transition-colors">
                 {selectedIds.size === filteredData.length ? 'Deselect all' : 'Select visible page'}
               </button>
            </div>
            <div className="flex items-center space-x-3">
              <button 
                onClick={() => setShowBulkDeleteConfirm(true)}
                className="px-6 py-3 bg-red-600 text-white rounded-lg text-[13px] font-medium tracking-widest shadow-lg hover:bg-red-700 transition-all active:scale-95"
              >
                Delete selected assets
              </button>
              <button 
                onClick={() => setSelectedIds(new Set())}
                className="p-3 text-slate-400 hover:text-white transition-colors"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project Groups & Drag-and-Drop Reassignment Tray */}
      {activeTab !== 'trash' && (
        <div className={`p-4 md:p-5 rounded-xl border transition-all duration-300 ${
          isDragging 
            ? 'bg-amber-50/90 border-amber-300 shadow-lg ring-2 ring-amber-400/30 sticky top-3 z-30 backdrop-blur-md' 
            : 'bg-white border-brand-divider/20 shadow-sm'
        }`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3.5">
            <div className="flex items-center gap-2.5">
              {isDragging ? (
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs sm:text-sm animate-pulse">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
                  <FolderInput className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Reassigning <strong className="underline font-black">{draggedRecord && ('fileName' in draggedRecord ? draggedRecord.fileName : draggedRecord.textPreview)}</strong> (from {draggedRecord?.group || 'General'})
                  </span>
                  <span className="text-[11px] text-amber-700 font-normal hidden lg:inline">
                    — Drop onto any target project group below to reassign:
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-700">
                  <Folder className="w-4 h-4 text-brand-primary shrink-0" />
                  <span>Project Groups & Reassignment Tray</span>
                  <span className="text-[11px] font-normal text-slate-400 hidden md:inline">
                    (Drag recordings from 'General' to reassign to specific projects)
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onAddGroup('')}
                onDragOver={(e) => {
                  if (isDragging) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (!isOverNewProjectTarget) setIsOverNewProjectTarget(true);
                  }
                }}
                onDragEnter={(e) => {
                  if (isDragging) {
                    e.preventDefault();
                    setIsOverNewProjectTarget(true);
                  }
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setIsOverNewProjectTarget(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsOverNewProjectTarget(false);
                  if (draggedRecord) {
                    setItemForNewProjectDrop(draggedRecord);
                    setNewProjectDropName('');
                  }
                }}
                className={`text-[11px] font-bold transition-all flex items-center gap-1.5 px-3 py-1.5 rounded-lg border shadow-2xs ${
                  isOverNewProjectTarget
                    ? 'bg-emerald-600 text-white border-emerald-600 ring-4 ring-emerald-200 scale-105 animate-pulse'
                    : isDragging
                    ? 'border-dashed border-2 border-brand-primary/70 bg-brand-primary/5 text-brand-primary hover:bg-brand-primary/10'
                    : 'text-brand-primary hover:text-brand-secondary border-brand-primary/20 hover:bg-brand-primary/5'
                }`}
                title="Create a new project group or drop a recording here to create and move"
              >
                <FolderPlus className="w-3.5 h-3.5 shrink-0" />
                <span>{isOverNewProjectTarget ? 'Drop to Create & Move' : isDragging ? '+ Drop for New Project' : 'New Project'}</span>
              </button>
            </div>
          </div>

          {/* Project Group Pills / Drop Targets */}
          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 scrollbar-thin">
            {/* "All" Filter Pill */}
            <button
              type="button"
              onClick={() => handleProjectDropdownChange('all')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 border ${
                projectFilter === 'all'
                  ? 'bg-brand-primary text-white border-brand-primary shadow-sm'
                  : 'bg-slate-50 text-slate-600 border-slate-200/80 hover:bg-white hover:border-slate-300'
              }`}
            >
              <span>All Projects</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                projectFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
              }`}>
                {audioHistory.filter(h => !h.deletedAt).length}
              </span>
            </button>

            {/* Project Group Drop Target Pills */}
            {projectListWithGeneral.map((proj) => {
              const isCurrentGroup = (draggedRecord?.group || 'General').toLowerCase() === proj.name.toLowerCase();
              const isDropTargetHovered = dragOverGroup?.toLowerCase() === proj.name.toLowerCase();
              const isFilterActive = projectFilter.toLowerCase() === proj.name.toLowerCase();
              const isGeneral = proj.name.toLowerCase() === 'general';

              return (
                <div
                  key={proj.id}
                  onDragOver={(e) => {
                    if (isDragging && !isCurrentGroup) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverGroup !== proj.name) setDragOverGroup(proj.name);
                    }
                  }}
                  onDragEnter={(e) => {
                    if (isDragging && !isCurrentGroup) {
                      e.preventDefault();
                      setDragOverGroup(proj.name);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                    if (dragOverGroup === proj.name) {
                      setDragOverGroup(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOnProject(proj.name);
                  }}
                  onClick={() => handleProjectDropdownChange(proj.name)}
                  className={`group/pill px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer select-none border ${
                    isDropTargetHovered
                      ? 'bg-emerald-600 text-white border-emerald-600 ring-4 ring-emerald-200 scale-105 shadow-md z-10'
                      : isDragging
                      ? isCurrentGroup
                        ? 'bg-slate-100 text-slate-400 border-slate-200 opacity-60 cursor-not-allowed'
                        : 'bg-white text-slate-800 border-dashed border-2 border-brand-primary/60 hover:border-brand-primary hover:bg-brand-primary/10 hover:scale-[1.02] shadow-sm'
                      : isFilterActive
                      ? 'bg-brand-primary text-white border-brand-primary shadow-sm'
                      : isGeneral
                      ? 'bg-amber-50/70 text-amber-900 border-amber-200/80 hover:bg-amber-50 hover:border-amber-300'
                      : 'bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-white hover:border-brand-primary/40'
                  }`}
                  title={
                    isDragging
                      ? isCurrentGroup
                        ? `Currently in ${proj.name}`
                        : `Drop to move recording to ${proj.name}`
                      : `Filter by ${proj.name}`
                  }
                >
                  <div className="flex items-center gap-2 pointer-events-none">
                    {isDropTargetHovered ? (
                      <FolderInput className="w-4 h-4 animate-bounce text-white shrink-0" />
                    ) : (
                      <Folder className={`w-3.5 h-3.5 shrink-0 ${
                        isFilterActive || isDropTargetHovered
                          ? 'text-white'
                          : isGeneral
                          ? 'text-amber-600'
                          : 'text-slate-400 group-hover/pill:text-brand-primary'
                      }`} />
                    )}

                    <span>{proj.name}</span>

                    {isDragging ? (
                      isCurrentGroup ? (
                        <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                          Current
                        </span>
                      ) : isDropTargetHovered ? (
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-white text-emerald-800 animate-pulse">
                          Drop Here
                        </span>
                      ) : (
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-brand-primary/10 text-brand-primary group-hover/pill:bg-brand-primary group-hover/pill:text-white transition-colors">
                          Move
                        </span>
                      )
                    ) : (
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                        isFilterActive
                          ? 'bg-white/20 text-white'
                          : isGeneral
                          ? 'bg-amber-200/80 text-amber-900'
                          : 'bg-slate-200/70 text-slate-600 group-hover/pill:bg-slate-200'
                      }`}>
                        {proj.count}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Data List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="py-20 text-center space-y-4 bg-white rounded-xl border border-brand-divider/20 shadow-sm">
            <div className="w-12 h-12 border-4 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin mx-auto"></div>
            <p className="text-sm font-bold text-brand-primary animate-pulse uppercase tracking-widest">Accessing Intelligence Archive...</p>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="py-20 text-center space-y-4 bg-white rounded-xl border border-dashed border-brand-divider/30">
             <div className="w-20 h-20 bg-brand-background rounded-full flex items-center justify-center mx-auto text-slate-200 text-3xl">
               <i className="fa-solid fa-folder-open"></i>
             </div>
             <div className="space-y-1">
               <p className="text-lg font-bold text-brand-primary">No Intelligence Found</p>
               <p className="text-xs text-slate-400 font-medium">Try adjusting your active filters or date range.</p>
             </div>
             <button onClick={clearAllFilters} className="text-[10px] font-black uppercase text-brand-primary hover:underline">Reset Filters</button>
          </div>
        ) : activeTab === 'bookmarks' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(filteredData as ExtendedBookmark[]).map((b) => (
              <div key={b.id} className="bg-white rounded-lg p-8 border border-brand-divider/20 shadow-sm hover:shadow-lg transition-all space-y-4 text-left">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-brand-primary uppercase tracking-widest">{b.recordName}</span>
                    <h4 className="text-[13px] font-medium text-slate-400 uppercase tracking-widest">{b.speaker}</h4>
                  </div>
                  <button 
                    onClick={() => {
                      if (!checkPermission(b.fullRecord, 'edit')) {
                        alert("You do not have permission to edit bookmarks in this project.");
                        return;
                      }
                      const updatedRecord = { ...b.fullRecord, bookmarks: b.fullRecord.bookmarks.filter((bm) => bm.id !== b.id) };
                      onUpdateAudio(updatedRecord);
                    }}
                    className="text-slate-300 hover:text-red-500 transition-colors"
                  >
                    <i className="fa-solid fa-bookmark"></i>
                  </button>
                </div>
                <p className="text-slate-800 text-sm font-medium leading-relaxed line-clamp-3">"{b.text}"</p>
                <div className="flex items-center justify-between pt-4 border-t border-brand-divider/10">
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest font-mono">{b.recordGroup} • {new Date(b.timestamp).toLocaleDateString()}</span>
                    <span className="text-[7px] font-bold text-brand-secondary uppercase tracking-widest">Bookmarked by: {b.userName || 'Guest'}</span>
                  </div>
                  <button 
                    onClick={() => handlePlaySegment(b.fullRecord, b.fullRecord.transcript[b.segmentIndex], b.segmentIndex)}
                    className="w-8 h-8 rounded-full bg-brand-primary text-[#0F172A] flex items-center justify-center shadow-md hover:scale-110 transition-all"
                  >
                    <i className={`fa-solid ${activePlaybackId === b.recordId && activePlaybackSegIdx === b.segmentIndex && playbackStatus === 'playing' ? 'fa-pause' : 'fa-play'} text-[10px]`}></i>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          filteredData.map(item => {
            const isAudio = 'fileName' in item;
            const isSelected = selectedIds.has(item.id);
            const canEdit = checkPermission(item, 'edit');
            const isCurrentlyDragged = draggedRecord?.id === item.id;
            const isCardHovered = hoveredCardId === item.id;
            const itemGroup = item.group || 'General';
            const isGeneral = !item.group || itemGroup.toLowerCase() === 'general';
            const canDropOnThisCard = isDragging && draggedRecord && (draggedRecord.group || 'General').toLowerCase() !== itemGroup.toLowerCase();

            return (
              <div 
                key={item.id} 
                draggable={canEdit}
                onDragStart={(e) => handleDragStart(e, item)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => {
                  if (canDropOnThisCard) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (hoveredCardId !== item.id) setHoveredCardId(item.id);
                  }
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (hoveredCardId === item.id) setHoveredCardId(null);
                }}
                onDrop={(e) => {
                  if (canDropOnThisCard) {
                    e.preventDefault();
                    handleDropOnProject(itemGroup);
                    setHoveredCardId(null);
                  }
                }}
                className={`bg-white rounded-xl p-6 border transition-all flex flex-col gap-6 relative group ${
                  isCurrentlyDragged
                    ? 'opacity-40 border-dashed border-2 border-brand-primary bg-slate-50 scale-[0.99] shadow-inner'
                    : isCardHovered
                    ? 'border-2 border-emerald-500 ring-4 ring-emerald-100 bg-emerald-50/40 shadow-lg'
                    : isSelected
                    ? 'border-brand-primary ring-1 ring-brand-primary shadow-sm'
                    : 'border-brand-divider/20 shadow-sm hover:shadow-md'
                }`}
              >
                {/* Selection Checkbox & Drag Handle */}
                <div className="absolute top-6 left-6 flex items-center space-x-1.5 z-10">
                  <div 
                    onClick={() => toggleSelect(item.id)}
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center cursor-pointer transition-all ${isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-white border-brand-divider/30 hover:border-brand-primary'}`}
                    title={isSelected ? "Deselect recording" : "Select recording"}
                  >
                    {isSelected && <i className="fa-solid fa-check text-brand-accent text-[10px]"></i>}
                  </div>

                  {canEdit && (
                    <div 
                      draggable={true}
                      onDragStart={(e) => handleGripDragStart(e, item)}
                      onDragEnd={handleDragEnd}
                      className="w-6 h-6 flex items-center justify-center text-slate-400 hover:text-brand-primary cursor-grab active:cursor-grabbing hover:bg-slate-100 rounded transition-colors"
                      title={isGeneral ? "Drag to reassign from 'General' to another project" : `Drag to reassign project from '${itemGroup}'`}
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>

                {/* Drop indication banner on hovered card */}
                {isCardHovered && canDropOnThisCard && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-lg flex items-center gap-1.5 z-20 animate-bounce pointer-events-none">
                    <FolderInput className="w-3.5 h-3.5" />
                    <span>Drop to move into project "{itemGroup}"</span>
                  </div>
                )}

                <div className="flex-1 pl-12 lg:pl-16 space-y-4 md:space-y-6 text-left">
                  {isAudio ? (
                    // Audio Item Layout
                    <div className="flex flex-col gap-4 md:gap-8">
                      <div className="flex flex-col lg:flex-row gap-4 md:gap-8">
                        <div className="lg:w-1/3 space-y-3 md:space-y-5">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] md:text-[11px] font-medium text-slate-400 uppercase tracking-widest font-mono">{item.date}</span>
                              {isGeneral ? (
                                <span 
                                  draggable={canEdit}
                                  onDragStart={(e) => handleGripDragStart(e, item)}
                                  onDragEnd={handleDragEnd}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300 shadow-2xs hover:bg-amber-100/80 hover:border-amber-400 cursor-grab active:cursor-grabbing transition-all select-none"
                                  title="In 'General' project. Drag this badge or the grip handle to drop onto any project group above."
                                >
                                  <FolderInput className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                  <span className="font-semibold">General</span>
                                  <span className="hidden sm:inline text-amber-700 font-medium">• Drag to reassign</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs">
                                  <Folder className="w-3 h-3 text-slate-500" />
                                  <span>{itemGroup}</span>
                                </span>
                              )}

                              {/* Multi-project badge trigger */}
                              {isAudio && (
                                <button
                                  type="button"
                                  onClick={() => openMultiProjectModal(item as AudioToTextRecord)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-brand-primary/10 text-brand-primary hover:bg-brand-primary/20 border border-brand-primary/20 transition-colors select-none"
                                  title="Manage Multi-Project Associations"
                                >
                                  <Layers className="w-3 h-3" />
                                  <span>
                                    {Array.isArray((item as AudioToTextRecord).projectIds) && ((item as AudioToTextRecord).projectIds?.length || 0) > 1
                                      ? `${(item as AudioToTextRecord).projectIds?.length} Projects`
                                      : 'Projects'}
                                  </span>
                                </button>
                              )}
                            </div>
                            <div className="flex items-center space-x-2">
                               <div className={`px-2 py-1 rounded text-[9px] md:text-[11px] font-medium uppercase tracking-tighter ${item.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : item.status === 'error' ? 'bg-red-50 text-red-600' : 'bg-brand-background text-brand-primary'}`}>
                                 {item.status}
                               </div>
                               <button 
                                 onClick={() => {
                                   if (!checkPermission(item, 'delete')) {
                                     alert("Only the project owner can delete assets.");
                                     return;
                                   }
                                   setItemToDelete({ 
                                     id: item.id, 
                                     name: isAudio ? item.fileName : item.title, 
                                     type: isAudio ? 'audio' : 'synthesis',
                                     isPermanent: activeTab === 'trash'
                                   });
                                 }}
                                 className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                                 title={activeTab === 'trash' ? "Permanently Delete" : "Move to Trash"}
                               >
                                 <i className={`fa-solid ${activeTab === 'trash' ? 'fa-trash-can' : 'fa-trash-can'} text-sm`}></i>
                               </button>
                               {activeTab === 'trash' && (
                                 <button 
                                   onClick={() => setItemToRestore({
                                     id: item.id,
                                     name: isAudio ? item.fileName : item.title,
                                     type: isAudio ? 'audio' : 'synthesis'
                                   })}
                                   className="p-2 text-slate-300 hover:text-brand-primary transition-colors"
                                   title="Restore Asset"
                                 >
                                   <i className="fa-solid fa-rotate-left text-sm"></i>
                                 </button>
                               )}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {editingFileName?.id === item.id ? (
                              <div className="flex items-center gap-2">
                                <input 
                                  className="text-2xl font-black text-brand-primary tracking-tight leading-tight bg-brand-background border border-brand-divider/20 rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-brand-primary w-full"
                                  value={editingFileName.name}
                                  onChange={(e) => setEditingFileName({ ...editingFileName, name: e.target.value })}
                                  autoFocus
                                />
                                <button onClick={() => { 
                                  if (!checkPermission(item, 'edit')) {
                                    alert("You do not have permission to rename assets in this project.");
                                    return;
                                  }
                                  onUpdateAudio({ ...item, fileName: editingFileName.name }); 
                                  setEditingFileName(null); 
                                }} className="text-brand-primary"><i className="fa-solid fa-check"></i></button>
                                <button onClick={() => setEditingFileName(null)} className="text-slate-400"><i className="fa-solid fa-xmark"></i></button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3">
                                <h4 
                                  className={`text-2xl font-black text-brand-primary tracking-tight leading-tight ${checkPermission(item, 'edit') ? 'cursor-pointer hover:text-brand-secondary' : ''}`}
                                  onClick={() => {
                                    if (checkPermission(item, 'edit')) {
                                      setEditingFileName({ id: item.id, name: item.fileName });
                                    } else {
                                      alert("You do not have permission to rename assets in this project.");
                                    }
                                  }}
                                >
                                  {item.fileName}
                                </h4>
                                {item.isTrimmedVersion && (
                                  <span 
                                    className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 border border-indigo-200 inline-flex items-center gap-1 shrink-0"
                                    title={item.trimRange ? `Trimmed clip: ${item.trimRange.startTime}s - ${item.trimRange.endTime}s (Parent: ${item.parentRecordingId || 'Original'})` : 'Trimmed Clip'}
                                  >
                                    <Scissors className="w-2.5 h-2.5" />
                                    <span>Trimmed Clip</span>
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="flex items-center space-x-2">
                              <div className="flex flex-col min-w-[100px]">
                                <label className="text-[8px] font-black text-slate-400 mb-1 ml-1 uppercase tracking-tighter">Project Group</label>
                                <select 
                                  value={item.group || 'General'} 
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === 'new') {
                                      setItemForNewProjectDrop(item);
                                      setNewProjectDropName('');
                                      return;
                                    }
                                    
                                    if (!checkPermission(item, 'edit')) {
                                      alert("You do not have permission to move assets.");
                                      return;
                                    }
                                    
                                    // Check permission for the target group
                                    const targetProject = (projects as Project[]).find(p => p.name === value);
                                    if (targetProject && targetProject.ownerEmail !== userProfile?.email) {
                                      const member = targetProject.members?.find(m => m.email === userProfile?.email);
                                      if (member && member.role === 'viewer') {
                                        alert("You do not have permission to add content to the target project.");
                                        return;
                                      }
                                    }

                                    onUpdateAudio({ ...item, group: value });
                                  }} 
                                  disabled={!checkPermission(item, 'edit')}
                                  className={`bg-slate-50 border border-slate-200 px-2 py-1 text-[10px] font-bold uppercase tracking-tight rounded-md focus:ring-1 focus:ring-brand-primary/30 outline-none transition-all ${!checkPermission(item, 'edit') ? 'text-slate-400 cursor-not-allowed opacity-60' : 'text-brand-primary'}`}
                                >
                                  {groups.map(g => (
                                    <option key={g} value={g}>
                                      {g}
                                    </option>
                                  ))}
                                  <option value="new">+ New Project</option>
                                </select>
                              </div>
                              <div 
                                onClick={() => {
                                  if (checkPermission(item, 'edit')) {
                                    cycleReadStatus(item);
                                  } else {
                                    alert("You do not have permission to update status.");
                                  }
                                }} 
                                className={`px-2 py-1.5 rounded-md border text-[9px] font-black uppercase cursor-pointer transition-all active:scale-95 shadow-sm ${getReadStatusStyle(item.readStatus)}`}
                              >
                                {item.readStatus.replace('-', ' ').toUpperCase()}
                              </div>
                              {item.collaborators && item.collaborators.length > 0 && (
                                <div className="flex -space-x-2 ml-2">
                                  {(item.collaborators || []).slice(0, 3).map((c, i) => (
                                    <div key={i} className="w-6 h-6 rounded-full border-2 border-white bg-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-500" title={c.email}>
                                      {(c.email?.charAt(0) || 'U').toUpperCase()}
                                    </div>
                                  ))}
                                  {item.collaborators.length > 3 && (
                                    <div className="w-6 h-6 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[8px] font-bold text-slate-400">
                                      +{item.collaborators.length - 3}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center space-x-3">
                             {activeTab !== 'trash' && (
                               <button 
                                 onClick={() => handlePlayFull(item.id, item.fileName, item.originalAudioUrl!)} 
                                 className={`flex-1 py-3.5 rounded-lg font-black uppercase tracking-widest text-[9px] transition-all shadow-lg ${activePlaybackId === item.id && activePlaybackSegIdx === undefined && playbackStatus === 'playing' ? 'bg-brand-secondary text-[#0F172A] shadow-brand-secondary/20' : 'bg-brand-primary text-[#0F172A] shadow-brand-primary/20'}`}
                               >
                                  <i className={`fa-solid ${activePlaybackId === item.id && activePlaybackSegIdx === undefined && playbackStatus === 'playing' ? 'fa-pause' : 'fa-play'} mr-2`}></i>
                                  {activePlaybackId === item.id && activePlaybackSegIdx === undefined && playbackStatus === 'playing' ? 'Pause' : 'Replay Asset'}
                               </button>
                             )}
                             <div className="flex gap-1.5">
                                {activeTab !== 'trash' && (
                                  <>
                                    {/* AI Smart Recap Button */}
                                    <button 
                                      onClick={() => handleTriggerSmartRecap(item)} 
                                      className="px-3.5 py-3.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-black text-[9px] uppercase tracking-wider flex items-center gap-1.5 shadow-md transition-all active:scale-95" 
                                      title="AI Smart Recap: 3-Bullet Executive Summary & Tagged Members"
                                    >
                                      <Sparkles className="w-3 h-3 text-amber-300" />
                                      <span>AI Recap</span>
                                    </button>

                                    {/* AH.184 Executive Report Export Button */}
                                    <button 
                                      onClick={() => {
                                        setReportRecord(item);
                                        setIsReportModalOpen(true);
                                      }}
                                      className="px-3 py-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-black text-[9px] uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all active:scale-95 border border-slate-700" 
                                      title="Export PowerPoint (.pptx) or Excel (.xlsx) Report"
                                    >
                                      <FileText className="w-3 h-3 text-emerald-400" />
                                      <span>Report</span>
                                    </button>

                                    {/* Audio Trim Button */}
                                    <button 
                                      onClick={() => {
                                        if (usageStats.mode === 'guest') {
                                          addNotification({
                                            title: 'Feature Restricted',
                                            message: 'Audio trimming requires an authenticated account. Please sign in.',
                                            type: 'error'
                                          });
                                          return;
                                        }
                                        setTrimmerRecord(item);
                                      }}
                                      className="px-3.5 py-3.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-indigo-700 font-black text-[9px] uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all active:scale-95 border border-slate-200"
                                      title="Trim Audio: Create derived clip with aligned transcripts"
                                    >
                                      <Scissors className="w-3 h-3 text-indigo-600" />
                                      <span>Trim</span>
                                    </button>

                                    <button 
                                      onClick={() => {
                                        if (usageStats.mode === 'guest') {
                                          addNotification({
                                            title: 'Feature Restricted',
                                            message: 'Collaboration features are not available in Guest Mode. Please create an account to unlock.',
                                            type: 'error'
                                          });
                                          return;
                                        }
                                        const project = (projects as Project[]).find(p => p.name === item.group);
                                        if (project) {
                                          setProjectToManage(project);
                                        } else {
                                          addNotification({
                                            title: 'General Asset',
                                            message: 'This asset is in the General project. Move it to a custom project to invite members.',
                                            type: 'info'
                                          });
                                        }
                                      }}
                                      className="p-3.5 bg-brand-background text-brand-primary rounded-lg hover:bg-brand-divider/10 transition-colors shadow-sm" 
                                      title="Invite Members"
                                    >
                                      <i className="fa-solid fa-user-plus text-xs"></i>
                                    </button>
                                    <button onClick={() => handleDownloadClick({ id: item.id, name: item.fileName, url: item.originalAudioUrl!, type: 'audio' })} className="p-3.5 bg-brand-background text-brand-primary rounded-lg hover:bg-brand-divider/10 transition-colors shadow-sm" title="Download Audio"><i className="fa-solid fa-file-audio text-xs"></i></button>
                                    <button onClick={() => handleDownloadClick({ id: item.id, name: `${item.fileName}_transcript`, url: '', type: 'transcript' })} className="p-3.5 bg-brand-background text-brand-primary rounded-lg hover:bg-brand-divider/10 transition-colors shadow-sm" title="Download Transcript"><i className="fa-solid fa-file-lines text-xs"></i></button>
                                  </>
                                )}
                                <button 
                                  onClick={() => setExpandedRecordId(expandedRecordId === item.id ? null : item.id)}
                                  className={`p-3.5 rounded-lg transition-all shadow-sm ${expandedRecordId === item.id ? 'bg-brand-primary text-[#0F172A]' : 'bg-brand-background text-brand-primary hover:bg-brand-divider/10'}`}
                                  title="Expand Intelligence"
                                >
                                  <i className={`fa-solid ${expandedRecordId === item.id ? 'fa-compress' : 'fa-expand'} text-xs`}></i>
                                </button>
                             </div>
                          </div>
                        </div>
                        <div 
                          ref={activePlaybackId === item.id ? transcriptContainerRef : null}
                          className="lg:w-2/3 max-h-52 overflow-y-auto pr-3 custom-scrollbar space-y-2 bg-brand-background p-5 rounded-lg border border-brand-divider/10 shadow-inner"
                        >
                          {(item.transcript || []).slice(0, 3).map((seg, sIdx) => (
                             <div 
                               key={sIdx} 
                               data-segment-index={sIdx}
                               className={`p-4 bg-white rounded-lg border shadow-sm transition-all hover:border-brand-primary/30 ${activePlaybackId === item.id && activePlaybackSegIdx === sIdx && playbackStatus === 'playing' ? 'border-brand-secondary ring-1 ring-brand-secondary scale-[1.01]' : 'border-brand-divider/10'}`}
                             >
                                <div className="flex justify-between items-start mb-1.5">
                                   <span className="text-[11px] font-medium text-slate-400 uppercase tracking-widest block font-mono">{item.speakerMap[seg.speaker] || seg.speaker}</span>
                                   <div className="flex space-x-2">
                                      <button onClick={() => handlePlaySegment(item, seg, sIdx)} className="text-brand-primary hover:text-brand-secondary transition-colors">
                                         <i className={`fa-solid ${activePlaybackId === item.id && activePlaybackSegIdx === sIdx && playbackStatus === 'playing' ? 'fa-pause' : 'fa-play'} text-[11px]`}></i>
                                      </button>
                                   </div>
                                </div>
                                <p className={`text-sm font-normal leading-relaxed ${activePlaybackId === item.id && activePlaybackSegIdx === sIdx && playbackStatus === 'playing' ? 'text-brand-secondary font-medium' : 'text-slate-800'}`}>{seg.text}</p>
                             </div>
                          ))}
                          {(item.transcript || []).length > 3 && (
                            <p className="text-[11px] font-medium text-slate-400 uppercase text-center pt-2 font-mono">+{(item.transcript || []).length - 3} more segments. Expand to view all.</p>
                          )}
                        </div>
                      </div>

                      {/* Expanded View */}
                      {expandedRecordId === item.id && (
                        <div className="pt-8 border-t border-brand-divider/10 space-y-10 animate-in slide-in-from-top-4 duration-500">
                          {/* AI Smart Recap Banner */}
                          {item.smartRecap && (
                            <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-950 text-white rounded-2xl p-6 border border-indigo-500/30 shadow-lg space-y-4">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-800/50 pb-3">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="w-4 h-4 text-indigo-400" />
                                  <h4 className="text-xs font-black uppercase tracking-wider text-white">AI Executive Smart Recap</h4>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                                    3-Point Synthesis
                                  </span>
                                </div>
                                <button
                                  onClick={() => handleTriggerSmartRecap(item)}
                                  className="text-[11px] font-bold text-indigo-300 hover:text-white flex items-center gap-1 transition-colors"
                                >
                                  <span>View & Refresh</span>
                                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                                </button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-left">
                                {item.smartRecap.executiveSummary.map((bullet, bIdx) => (
                                  <div key={bIdx} className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-1.5">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-indigo-300">
                                      {bIdx === 0 ? '1. Strategic Context' : bIdx === 1 ? '2. Key Decisions' : '3. Trajectory'}
                                    </span>
                                    <p className="text-xs text-slate-200 leading-relaxed font-medium">
                                      {bullet}
                                    </p>
                                  </div>
                                ))}
                              </div>

                              {item.smartRecap.taggedMembers?.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-indigo-900/40 text-left">
                                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Tagged Members:</span>
                                  {item.smartRecap.taggedMembers.map((m, mIdx) => (
                                    <span key={mIdx} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
                                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                                      @{m.name} {m.role ? `(${m.role})` : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Summary */}
                          {item.summary && !isThinkingLimitReached ? (
                            <div className="bg-brand-background rounded-xl p-8 border border-brand-divider/10 space-y-6">
                              <div className="flex items-center space-x-4">
                                <div className="w-12 h-12 bg-brand-primary/10 border border-brand-primary/20 rounded-lg flex items-center justify-center text-brand-primary shadow-sm">
                                  <i className="fa-solid fa-list-check text-lg"></i>
                                </div>
                                <div>
                                  <h4 className="text-sm font-black text-brand-primary tracking-tight">Call summary</h4>
                                  <p className="text-[11px] text-brand-secondary font-medium tracking-widest font-mono">AI generated intelligence</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                                <div className="space-y-2">
                                  <span className="text-[11px] font-medium text-slate-400 tracking-widest font-mono">Main topic</span>
                                  <p className="text-slate-800 font-medium text-sm leading-relaxed">{item.summary.mainTopic}</p>
                                </div>
                                <div className="space-y-2">
                                  <span className="text-[11px] font-medium text-slate-400 tracking-widest font-mono">Key points</span>
                                  <ul className="space-y-1">
                                    {(item.summary.keyPoints || []).map((p, i) => <li key={i} className="text-xs font-normal text-slate-600 flex items-start gap-2"><span className="text-brand-primary mt-1">•</span>{p}</li>)}
                                  </ul>
                                </div>
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-medium text-slate-400 tracking-widest font-mono">Action items</span>
                                    <span className="text-[10px] text-slate-400 font-mono">Click to convert</span>
                                  </div>
                                  <ul className="space-y-2">
                                    {(item.summary.actionItems || []).map((a, i) => {
                                      const itemKey = `${item.id}_ai_${i}`;
                                      const isConverting = convertingTaskId === itemKey;
                                      return (
                                        <li key={i} className="text-xs font-normal text-slate-600 flex items-start justify-between gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition-colors group">
                                          <div className="flex items-start gap-2 flex-1">
                                            <span className="text-brand-secondary mt-1">•</span>
                                            <span>{a}</span>
                                          </div>
                                          <button
                                            type="button"
                                            disabled={isConverting}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleConvertToTask(item, a, 'meeting_action_item', `ai_${i}`);
                                            }}
                                            title="Convert to project task"
                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold text-brand-primary bg-brand-primary/10 hover:bg-brand-primary hover:text-white px-2 py-0.5 rounded flex items-center gap-1 shrink-0"
                                          >
                                            {isConverting ? (
                                              <i className="fa-solid fa-spinner fa-spin"></i>
                                            ) : (
                                              <i className="fa-solid fa-list-check"></i>
                                            )}
                                            <span>To Task</span>
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              </div>
                            </div>
                          ) : isThinkingLimitReached && (
                            <div className="p-8 bg-brand-background rounded-xl border border-brand-divider/10">
                              {renderThinkingLimitMessage()}
                            </div>
                          )}

                          {/* Strategic Thinking Partner */}
                          {(!item.selectedModules || item.selectedModules.includes('strategy')) && (
                            <div className="bg-brand-primary/5 rounded-3xl border border-brand-primary/10 overflow-hidden shadow-sm">
                              <div 
                                className={`p-8 flex items-center justify-between transition-all duration-300 ${isGuest ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-primary/10 cursor-pointer'}`}
                                onClick={() => {
                                  if (isGuest) {
                                    addNotification({
                                      title: 'Feature Restricted',
                                      message: 'AI Strategic Analysis is not available in Guest Mode. Please sign up to unlock full intelligence.',
                                      type: 'error'
                                    });
                                    return;
                                  }
                                  toggleStrategicAnalysis(item.id);
                                }}
                              >
                                <div className="flex items-center space-x-6">
                                  <div className="w-14 h-14 bg-brand-primary text-brand-accent rounded-2xl flex items-center justify-center shadow-xl shadow-brand-primary/20">
                                    <i className="fa-solid fa-brain text-2xl"></i>
                                  </div>
                                  <div>
                                    <h4 className="text-xl font-black text-brand-primary tracking-tight">Strategic Thinking Partner</h4>
                                    <p className="text-[11px] text-brand-secondary font-bold tracking-[0.2em] uppercase font-mono">Deep AI Analysis & Blindspot Detection</p>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-4">
                                  {!item.strategicAnalysis && (
                                    <button
                                      disabled={isGuest || isAnalyzing === item.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isGuest) {
                                          addNotification({
                                            title: 'Feature Restricted',
                                            message: 'AI Strategic Analysis is not available in Guest Mode. Please sign up to unlock full intelligence.',
                                            type: 'error'
                                          });
                                          return;
                                        }
                                        runStrategicAnalysis(item);
                                      }}
                                      className={`px-6 py-3 bg-brand-primary text-brand-accent rounded-xl text-[11px] font-black uppercase tracking-widest hover:shadow-2xl hover:-translate-y-0.5 transition-all disabled:opacity-50 ${isGuest ? 'cursor-not-allowed' : ''}`}
                                    >
                                      {isAnalyzing === item.id ? (
                                        <><i className="fa-solid fa-spinner fa-spin mr-2"></i> Analyzing...</>
                                      ) : (
                                        <><i className="fa-solid fa-wand-magic-sparkles mr-2"></i> Run Analysis</>
                                      )}
                                    </button>
                                  )}
                                  <div className="w-10 h-10 rounded-full bg-brand-primary/5 flex items-center justify-center text-brand-primary/40">
                                    <i className={`fa-solid fa-chevron-${expandedStrategicAnalysisIds.has(item.id) ? 'up' : 'down'} transition-transform duration-300`}></i>
                                  </div>
                                </div>
                              </div>

                              {expandedStrategicAnalysisIds.has(item.id) && (
                                <div className="px-5 py-10 md:px-10 md:py-16 border-t border-brand-divider/10 bg-white/80 space-y-16 animate-in slide-in-from-top-4 duration-500">
                                  {item.strategicAnalysis && !isThinkingLimitReached ? (
                                    <div className="space-y-16">
                                      {/* Top Section: Intent & Context */}
                                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                                        <div className="space-y-4">
                                          <div className="flex items-center space-x-3 text-brand-primary">
                                            <div className="w-8 h-8 bg-brand-primary/10 rounded-lg flex items-center justify-center">
                                              <i className="fa-solid fa-bullseye text-xs"></i>
                                            </div>
                                            <span className="text-[12px] font-black uppercase tracking-[0.2em] font-mono">Core Intent</span>
                                          </div>
                                          <div className="bg-white p-6 rounded-2xl border border-brand-divider/5 shadow-sm">
                                            <p className="text-[15px] text-slate-800 leading-relaxed font-bold">{item.strategicAnalysis.coreIntent}</p>
                                          </div>
                                        </div>

                                        <div className="space-y-4">
                                          <div className="flex items-center space-x-3 text-brand-primary">
                                            <div className="w-8 h-8 bg-brand-primary/10 rounded-lg flex items-center justify-center">
                                              <i className="fa-solid fa-compass text-xs"></i>
                                            </div>
                                            <span className="text-[12px] font-black uppercase tracking-[0.2em] font-mono">Context & Stakes</span>
                                          </div>
                                          <div className="bg-white p-6 rounded-2xl border border-brand-divider/5 shadow-sm">
                                            <p className="text-[15px] text-slate-600 leading-relaxed font-medium">{item.strategicAnalysis.context}</p>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Middle Section: Questions & Recommendations */}
                                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 pt-12 border-t border-brand-divider/10">
                                        <div className="space-y-8">
                                          <div className="flex items-center space-x-3 text-blue-600">
                                            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                                              <i className="fa-solid fa-circle-question text-lg"></i>
                                            </div>
                                            <span className="text-[12px] font-black uppercase tracking-[0.2em] font-mono">Strategic Questions</span>
                                          </div>
                                          <ul className="space-y-6">
                                            {(item.strategicAnalysis.strategicQuestions || item.strategicAnalysis.ignoredQuestions || []).map((q, i) => (
                                              <li key={i} className="text-[15px] text-blue-700 font-bold italic flex items-start gap-4 group">
                                                <span className="text-2xl leading-none text-blue-400 group-hover:scale-110 transition-transform">?</span>
                                                <span className="pt-1">{q}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>

                                        <div className="space-y-8">
                                          <div className="flex items-center space-x-3 text-emerald-600">
                                            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                                              <i className="fa-solid fa-lightbulb text-lg"></i>
                                            </div>
                                            <span className="text-[12px] font-black uppercase tracking-[0.2em] font-mono">Recommendations</span>
                                          </div>
                                          <ul className="space-y-6">
                                            {(item.strategicAnalysis.recommendations || []).map((rec, i) => (
                                              <li key={i} className="text-[15px] text-emerald-700 font-bold flex items-start gap-4 group">
                                                <div className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center shrink-0 mt-0.5 group-hover:translate-x-1 transition-transform">
                                                  <i className="fa-solid fa-arrow-right text-[10px]"></i>
                                                </div>
                                                <span className="pt-0.5">{rec}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      </div>

                                      {/* Unresolved Topics Section */}
                                      <div className="pt-12 border-t border-brand-divider/10">
                                        <UnresolvedTopicsDetector unresolvedTopics={item.strategicAnalysis.unresolvedTopics || []} />
                                      </div>

                                      {/* Bottom Section: Framework & Steps */}
                                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 pt-12 border-t border-brand-divider/10">
                                        <div className="space-y-6">
                                          <div className="flex items-center space-x-3 text-amber-600">
                                            <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
                                              <i className="fa-solid fa-triangle-exclamation text-xs"></i>
                                            </div>
                                            <span className="text-[12px] font-black uppercase tracking-[0.2em] font-mono">Assumptions & Risks</span>
                                          </div>
                                          <div className="grid gap-4">
                                            {item.strategicAnalysis.assumptions.map((a, i) => (
                                              <div key={i} className="p-5 bg-amber-50/50 border border-amber-100 rounded-2xl text-[13px] text-slate-700 font-medium flex items-start gap-4">
                                                <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0"></span>
                                                {a}
                                              </div>
                                            ))}
                                          </div>
                                        </div>

                                        <div className="bg-brand-primary text-brand-accent rounded-[2.5rem] p-10 space-y-8 shadow-2xl shadow-brand-primary/30 relative overflow-hidden group">
                                          <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -mr-20 -mt-20 blur-3xl group-hover:bg-white/10 transition-colors" />
                                          
                                          <div className="relative z-10 space-y-4">
                                            <div className="flex items-center space-x-3">
                                              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                                                <i className="fa-solid fa-chess text-lg"></i>
                                              </div>
                                              <span className="text-[12px] font-black uppercase tracking-[0.2em] font-mono">Decision Framework</span>
                                            </div>
                                            <p className="text-[15px] leading-relaxed font-bold opacity-90">{item.strategicAnalysis.decisionFramework}</p>
                                          </div>

                                          <div className="relative z-10 pt-8 border-t border-white/10">
                                            <span className="text-[11px] font-black uppercase tracking-[0.2em] block mb-6 opacity-60">Next Strategic Steps</span>
                                            <div className="space-y-4">
                                              {item.strategicAnalysis.nextSteps.map((step, i) => (
                                                <div key={i} className="flex items-center gap-5 group/step">
                                                  <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-[13px] font-black group-hover/step:bg-brand-accent group-hover/step:text-brand-primary transition-all duration-300">
                                                    {i + 1}
                                                  </div>
                                                  <span className="text-[14px] font-bold tracking-tight">{step}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ) : isThinkingLimitReached ? (
                                    renderThinkingLimitMessage()
                                  ) : (
                                    <div className="py-24 flex flex-col items-center justify-center text-center space-y-8">
                                      <div className="w-24 h-24 bg-brand-primary/5 rounded-full flex items-center justify-center text-brand-primary animate-pulse border border-brand-primary/10">
                                        <i className="fa-solid fa-wand-magic-sparkles text-4xl"></i>
                                      </div>
                                      <div className="max-w-md space-y-3">
                                        <h5 className="text-2xl font-black text-brand-primary tracking-tight">No Strategic Analysis Yet</h5>
                                        <p className="text-sm text-slate-500 leading-relaxed font-medium">Run the strategic thinking partner to uncover hidden meaning, challenge assumptions, and reveal blind spots in this conversation.</p>
                                      </div>
                                      <button
                                        disabled={isGuest || isAnalyzing === item.id}
                                        onClick={() => {
                                          if (isGuest) {
                                            addNotification({
                                              title: 'Feature Restricted',
                                              message: 'AI Strategic Analysis is not available in Guest Mode. Please sign up to unlock full intelligence.',
                                              type: 'error'
                                            });
                                            return;
                                          }
                                          runStrategicAnalysis(item);
                                        }}
                                        className={`px-10 py-5 bg-brand-primary text-brand-accent rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:shadow-2xl hover:-translate-y-1 active:scale-95 transition-all disabled:opacity-50 shadow-xl shadow-brand-primary/20 ${isGuest ? 'cursor-not-allowed' : ''}`}
                                      >
                                        {isAnalyzing === item.id ? (
                                          <><i className="fa-solid fa-spinner fa-spin mr-3"></i> Initializing Strategic Engine...</>
                                        ) : (
                                          <><i className="fa-solid fa-bolt mr-3"></i> Generate Strategic Insights</>
                                        )}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Meeting Intelligence Section */}
                          {(!item.selectedModules || item.selectedModules.includes('meeting')) && (
                            <div className="bg-brand-primary/5 rounded-xl border border-brand-primary/10 overflow-hidden">
                              <div 
                                className={`p-6 flex items-center justify-between transition-colors ${isGuest ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-primary/10 cursor-pointer'}`}
                                onClick={() => {
                                  if (isGuest) {
                                    addNotification({
                                      title: 'Feature Restricted',
                                      message: 'Meeting Intelligence is not available in Guest Mode. Please sign up to unlock full intelligence.',
                                      type: 'error'
                                    });
                                    return;
                                  }
                                  toggleIntelligence(item.id);
                                }}
                              >
                                <div className="flex items-center space-x-4">
                                  <div className="w-10 h-10 bg-brand-primary text-brand-accent rounded-lg flex items-center justify-center shadow-md">
                                    <i className="fa-solid fa-microchip text-lg"></i>
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-black text-brand-primary tracking-tight">Meeting Intelligence</h4>
                                    <p className="text-[10px] text-brand-secondary font-bold tracking-widest uppercase font-mono">Decisions, Tasks & Unresolved Topics</p>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-3">
                                  {!item.meetingIntelligence && (
                                    <button
                                      disabled={isGuest || isAnalyzing === item.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (isGuest) {
                                          addNotification({
                                            title: 'Feature Restricted',
                                            message: 'Meeting Intelligence is not available in Guest Mode. Please sign up to unlock full intelligence.',
                                            type: 'error'
                                          });
                                          return;
                                        }
                                        runMeetingIntelligence(item);
                                      }}
                                      className={`px-4 py-2 bg-brand-primary text-brand-accent rounded-lg text-[10px] font-black uppercase tracking-widest hover:shadow-lg transition-all disabled:opacity-50 ${isGuest ? 'cursor-not-allowed' : ''}`}
                                    >
                                      {isAnalyzing === item.id ? (
                                        <><i className="fa-solid fa-spinner fa-spin mr-2"></i> Analyzing...</>
                                      ) : (
                                        <><i className="fa-solid fa-wand-magic-sparkles mr-2"></i> Run Intelligence</>
                                      )}
                                    </button>
                                  )}
                                  <i className={`fa-solid fa-chevron-${expandedIntelligenceIds.has(item.id) ? 'up' : 'down'} text-brand-primary/40`}></i>
                                </div>
                              </div>

                              {expandedIntelligenceIds.has(item.id) && (
                                <div className="p-8 border-t border-brand-primary/10 bg-white/50 space-y-10 animate-in slide-in-from-top-2 duration-300">
                                  {item.meetingIntelligence && !isThinkingLimitReached ? (
                                    <MeetingIntelligenceView intelligence={item.meetingIntelligence} />
                                  ) : isThinkingLimitReached ? (
                                    renderThinkingLimitMessage()
                                  ) : (
                                    <div className="py-10 text-center text-slate-500 text-xs">
                                      No intelligence data available. Run analysis to generate.
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Execution Tracker Section */}
                          {(!item.selectedModules || item.selectedModules.includes('execution')) && (
                            <div className="bg-brand-primary/5 rounded-xl border border-brand-primary/10 overflow-hidden">
                              <div 
                                className="p-6 flex items-center justify-between cursor-pointer hover:bg-brand-primary/10 transition-colors"
                                onClick={() => toggleExecution(item.id)}
                              >
                                <div className="flex items-center space-x-4">
                                  <div className="w-10 h-10 bg-brand-primary text-brand-accent rounded-lg flex items-center justify-center shadow-md">
                                    <i className="fa-solid fa-gauge-high text-lg"></i>
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-black text-brand-primary tracking-tight">Execution Tracker</h4>
                                    <p className="text-[10px] text-brand-secondary font-bold tracking-widest uppercase font-mono">Project Momentum & Accountability</p>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-3">
                                  <i className={`fa-solid fa-chevron-${expandedExecutionIds.has(item.id) ? 'up' : 'down'} text-brand-primary/40`}></i>
                                </div>
                              </div>

                              {expandedExecutionIds.has(item.id) && (
                                <div className="p-8 border-t border-brand-primary/10 bg-white/50 space-y-10 animate-in slide-in-from-top-2 duration-300">
                                  {item.executionTracker && !isThinkingLimitReached ? (
                                    <ExecutionTrackerView 
                                      tracker={item.executionTracker} 
                                      onChangeTracker={(updatedTracker) => {
                                        onUpdateAudio({
                                          ...item,
                                          executionTracker: updatedTracker
                                        });
                                      }}
                                    />
                                  ) : isThinkingLimitReached ? (
                                    renderThinkingLimitMessage()
                                  ) : (
                                    <div className="py-10 text-center text-slate-500 text-xs">
                                      No execution tracking data available.
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Smart Reminders Section */}
                          {(!item.selectedModules || item.selectedModules.includes('reminders')) && (
                            <div className="bg-brand-primary/5 rounded-xl border border-brand-primary/10 overflow-hidden">
                              <div 
                                className="p-6 flex items-center justify-between cursor-pointer hover:bg-brand-primary/10 transition-colors"
                                onClick={() => toggleReminders(item.id)}
                              >
                                <div className="flex items-center space-x-4">
                                  <div className="w-10 h-10 bg-brand-primary text-brand-accent rounded-lg flex items-center justify-center shadow-md">
                                    <i className="fa-solid fa-calendar-check text-lg"></i>
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-black text-brand-primary tracking-tight">Smart Reminders</h4>
                                    <p className="text-[10px] text-brand-secondary font-bold tracking-widest uppercase font-mono">Calendar Integration & Follow-ups</p>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-3">
                                  <i className={`fa-solid fa-chevron-${expandedReminderIds.has(item.id) ? 'up' : 'down'} text-brand-primary/40`}></i>
                                </div>
                              </div>

                              {expandedReminderIds.has(item.id) && (
                                <div className="p-8 border-t border-brand-primary/10 bg-white/50 space-y-10 animate-in slide-in-from-top-2 duration-300">
                                  {item.calendarReminders && !isThinkingLimitReached ? (
                                    <SmartReminderView reminders={item.calendarReminders} />
                                  ) : isThinkingLimitReached ? (
                                    renderThinkingLimitMessage()
                                  ) : (
                                    <div className="py-10 text-center text-slate-500 text-xs">
                                      No reminders available.
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}


                          {/* Key Insights & Follow-up Section */}
                          {(!item.selectedModules || item.selectedModules.includes('meeting')) && (
                            <div className="bg-brand-primary/5 rounded-xl border border-brand-primary/10 overflow-hidden">
                              <div 
                                className="p-6 flex items-center justify-between cursor-pointer hover:bg-brand-primary/10 transition-colors"
                                onClick={() => toggleFollowUp(item.id)}
                              >
                                <div className="flex items-center space-x-4">
                                  <div className="w-10 h-10 bg-brand-primary text-brand-accent rounded-lg flex items-center justify-center shadow-md">
                                    <i className="fa-solid fa-lightbulb text-lg"></i>
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-black text-brand-primary tracking-tight">Key Insights & Follow-up</h4>
                                    <p className="text-[10px] text-brand-secondary font-bold tracking-widest uppercase font-mono">Strategic Takeaways & Next Steps</p>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-3">
                                  <i className={`fa-solid fa-chevron-${expandedFollowUpIds.has(item.id) ? 'up' : 'down'} text-brand-primary/40`}></i>
                                </div>
                              </div>

                              {expandedFollowUpIds.has(item.id) && (
                                <div className="p-8 border-t border-brand-primary/10 bg-white/50 space-y-8 animate-in slide-in-from-top-2 duration-300">
                                  {!isThinkingLimitReached ? (
                                    <>
                                      {item.unifiedIntelligence?.keyInsights && item.unifiedIntelligence.keyInsights.length > 0 && (
                                        <div className="space-y-4">
                                          <div className="flex items-center space-x-2 text-brand-primary">
                                            <i className="fa-solid fa-star text-xs"></i>
                                            <span className="text-[11px] font-black uppercase tracking-widest font-mono">Key Insights</span>
                                          </div>
                                          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {item.unifiedIntelligence.keyInsights.map((insight, i) => (
                                              <li key={i} className="p-4 bg-white border border-brand-divider/10 rounded-lg text-xs text-slate-600 flex items-start gap-3">
                                                <span className="w-1.5 h-1.5 rounded-full bg-brand-primary mt-1.5 shrink-0"></span>
                                                {insight}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}

                                      {item.unifiedIntelligence?.followUp && (
                                        <div className="space-y-6 pt-6 border-t border-brand-divider/10">
                                          <div className="flex items-center space-x-2 text-brand-primary">
                                            <i className="fa-solid fa-paper-plane text-xs"></i>
                                            <span className="text-[11px] font-black uppercase tracking-widest font-mono">Follow-up Plan</span>
                                          </div>
                                          
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            <div className="space-y-4">
                                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Next Meeting Agenda</span>
                                              <ul className="space-y-2">
                                                {(item.unifiedIntelligence.followUp.nextMeetingAgenda || []).map((agenda, i) => (
                                                  <li key={i} className="text-xs text-slate-600 flex items-start gap-3">
                                                    <span className="font-mono text-brand-primary/40">{i+1}.</span>
                                                    {agenda}
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                            <div className="space-y-4">
                                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Pending Items</span>
                                              <ul className="space-y-2">
                                                {(item.unifiedIntelligence.followUp.keyPendingItems || []).map((item, i) => (
                                                  <li key={i} className="text-xs text-slate-600 flex items-start gap-3">
                                                    <span className="w-1 h-1 rounded-full bg-brand-secondary mt-2 shrink-0"></span>
                                                    {item}
                                                  </li>
                                                ))}
                                              </ul>
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {!item.unifiedIntelligence?.keyInsights && !item.unifiedIntelligence?.followUp && (
                                        <div className="py-10 text-center text-slate-500 text-xs">
                                          No additional insights or follow-up data available.
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    renderThinkingLimitMessage()
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Full Transcript with Bookmarking */}
                          <div className="space-y-6">
                            <div className="flex items-center justify-between ml-1">
                              <h4 className="text-[11px] font-medium text-slate-400 tracking-widest uppercase">Full intelligence transcript</h4>
                              <button 
                                onClick={() => setIsConversationMode(!isConversationMode)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all border ${isConversationMode ? 'bg-brand-primary text-[#0F172A] border-brand-primary shadow-md' : 'bg-white text-brand-primary border-brand-divider/20 hover:border-brand-primary/40'}`}
                              >
                                <i className={`fa-solid ${isConversationMode ? 'fa-table-columns' : 'fa-comments'} mr-2`}></i>
                                {isConversationMode ? 'Grid View' : 'Conversation View'}
                              </button>
                            </div>
                            
                            <div 
                              ref={activePlaybackId === item.id ? transcriptContainerRef : null}
                              className={`grid gap-4 transition-all duration-500 ${isConversationMode ? 'grid-cols-1 max-w-3xl mx-auto' : 'grid-cols-1 md:grid-cols-2'}`}
                            >
                              {(item.transcript || []).map((seg, sIdx) => {
                                const isBookmarked = (item.bookmarks || []).some(b => b.segmentIndex === sIdx);
                                const isActive = activePlaybackId === item.id && activePlaybackSegIdx === sIdx && playbackStatus === 'playing';
                                
                                return (
                                  <div 
                                    key={sIdx} 
                                    data-segment-index={sIdx}
                                    className={`p-6 rounded-lg border transition-all duration-300 ${isActive ? 'bg-brand-secondary/5 border-brand-secondary shadow-lg scale-[1.02] z-10' : 'bg-white border-brand-divider/10 shadow-sm'} ${isConversationMode ? 'relative' : ''}`}
                                  >
                                    <div className="flex justify-between items-start mb-3">
                                      <div className="flex items-center space-x-2">
                                        <span className={`text-[11px] font-bold uppercase tracking-widest font-mono ${isActive ? 'text-brand-secondary' : 'text-slate-400'}`}>
                                          {item.speakerMap[seg.speaker] || seg.speaker}
                                        </span>
                                        {isActive && (
                                          <span className="flex space-x-0.5">
                                            <span className="w-1 h-3 bg-brand-secondary rounded-full animate-pulse"></span>
                                            <span className="w-1 h-3 bg-brand-secondary rounded-full animate-pulse delay-75"></span>
                                            <span className="w-1 h-3 bg-brand-secondary rounded-full animate-pulse delay-150"></span>
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex space-x-2">
                                        <button 
                                          onClick={() => toggleBookmark(item, sIdx)}
                                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${isBookmarked ? 'bg-brand-secondary text-white shadow-md' : 'bg-brand-background text-slate-300 hover:text-brand-secondary'}`}
                                          title={isBookmarked ? `Bookmarked by ${(item.bookmarks || []).find(b => b.segmentIndex === sIdx)?.userName || 'Guest'}` : 'Bookmark Segment'}
                                        >
                                          <i className={`fa-${isBookmarked ? 'solid' : 'regular'} fa-bookmark text-[11px]`}></i>
                                        </button>
                                        <button 
                                          onClick={() => handlePlaySegment(item, seg, sIdx)}
                                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${isActive ? 'bg-brand-secondary text-[#0F172A]' : 'bg-brand-primary/10 text-brand-primary hover:bg-brand-primary hover:text-[#0F172A]'}`}
                                        >
                                          <i className={`fa-solid ${isActive ? 'fa-pause' : 'fa-play'} text-[11px]`}></i>
                                        </button>
                                      </div>
                                    </div>
                                    <p className={`text-sm leading-relaxed transition-all duration-300 ${isActive ? 'text-brand-secondary font-semibold text-base' : 'text-slate-800 font-normal'}`}>
                                      {seg.text}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    // Synthesis Item Layout
                    <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                      <div className="flex-1 space-y-3">
                        <div className="flex items-center space-x-3">
                           <span className={`text-[11px] font-black uppercase px-2 py-1 rounded border tracking-widest ${item.gender === 'male' ? 'bg-blue-50 text-blue-500 border-blue-100' : 'bg-pink-50 text-pink-500 border-pink-100'}`}>{item.gender} Voice</span>
                           <div className="flex flex-col min-w-[100px]">
                              <label className="text-[8px] font-black text-slate-400 mb-1 ml-1 uppercase tracking-tighter">Project Group</label>
                              <select 
                                value={item.group || 'General'} 
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === 'new') {
                                    setItemForNewProjectDrop(item);
                                    setNewProjectDropName('');
                                    return;
                                  }
                                  
                                  if (!checkPermission(item, 'edit')) {
                                    alert("You do not have permission to change the project for this asset.");
                                    return;
                                  }
                                  
                                  // Check permission for the target group
                                  const targetProject = (projects as Project[]).find(p => p.name === value);
                                  if (targetProject && targetProject.ownerEmail !== userProfile?.email) {
                                    const member = targetProject.members?.find(m => m.email === userProfile?.email);
                                    if (member && member.role === 'viewer') {
                                      alert("You do not have permission to add content to the target project.");
                                      return;
                                    }
                                  }

                                  onUpdateText({ ...item, group: value });
                                }} 
                                className="bg-slate-50 border border-slate-200 px-2 py-1 text-[10px] font-bold uppercase tracking-tight rounded-md focus:ring-1 focus:ring-brand-primary/30 outline-none transition-all text-brand-primary"
                              >
                                {groups.map(g => (
                                  <option key={g} value={g}>{g}</option>
                                ))}
                                <option value="new">+ New Project</option>
                              </select>
                            </div>
                           <span className="text-[11px] font-medium text-slate-300 uppercase tracking-widest">{item.date}</span>
                        </div>
                        <div className="space-y-2">
                          <p className={`text-lg text-brand-primary font-medium leading-relaxed italic ${expandedTextIds.has(item.id) ? '' : 'line-clamp-2'}`}>
                            "{item.fullText}"
                          </p>
                          {item.fullText.length > 100 && (
                            <button 
                              onClick={() => toggleTextExpansion(item.id)}
                              className="text-[11px] font-medium uppercase text-brand-primary hover:underline flex items-center gap-1"
                            >
                              {expandedTextIds.has(item.id) ? (
                                <><i className="fa-solid fa-compress"></i> Show Less</>
                              ) : (
                                <><i className="fa-solid fa-expand"></i> Show Full Narrative</>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-3 shrink-0">
                         {activeTab !== 'trash' && (
                           <>
                             <button 
                               onClick={() => {
                                 if (usageStats.mode === 'guest') {
                                   addNotification({
                                     title: 'Feature Restricted',
                                     message: 'Collaboration features are not available in Guest Mode. Please create an account to unlock.',
                                     type: 'error'
                                   });
                                   return;
                                 }
                                 const project = (projects as Project[]).find(p => p.name === item.group);
                                 if (project) {
                                   setProjectToManage(project);
                                 } else {
                                   addNotification({
                                     title: 'General Asset',
                                     message: 'This asset is in the General project. Move it to a custom project to invite members.',
                                     type: 'info'
                                   });
                                 }
                               }}
                               className="p-4 bg-brand-background text-brand-primary rounded-lg hover:bg-brand-divider/10 transition-all shadow-sm" 
                               title="Invite Members"
                             >
                               <i className="fa-solid fa-user-plus text-xs"></i>
                             </button>
                             <button 
                               onClick={() => handlePlayFull(item.id, `Synthesis Result`, item.audioUrl)} 
                               className={`px-8 py-3.5 rounded-lg font-medium uppercase tracking-widest text-[11px] transition-all shadow-lg ${activePlaybackId === item.id && playbackStatus === 'playing' ? 'bg-brand-secondary text-[#0F172A] shadow-brand-secondary/20' : 'bg-brand-primary text-[#0F172A] shadow-brand-primary/20'}`}
                             >
                               <i className={`fa-solid ${activePlaybackId === item.id && playbackStatus === 'playing' ? 'fa-pause' : 'fa-play'} mr-2`}></i>
                               <span>Replay</span>
                             </button>
                             <button onClick={() => setDownloadingAsset({ id: item.id, name: `Synthesis_${item.id}`, url: item.audioUrl, type: 'audio' })} className="p-4 bg-brand-background text-brand-primary rounded-lg hover:bg-brand-primary hover:text-[#0F172A] transition-all shadow-sm"><i className="fa-solid fa-download text-xs"></i></button>
                           </>
                         )}
                         <button 
                           onClick={() => {
                             if (!checkPermission(item, 'delete')) {
                               alert("Only the project owner can delete assets.");
                               return;
                             }
                             setItemToDelete({ 
                               id: item.id, 
                               name: item.textPreview || 'Synthesis Result', 
                               type: 'synthesis',
                               isPermanent: activeTab === 'trash'
                             });
                           }}
                           className="p-4 text-slate-200 group-hover:text-red-500 transition-colors"
                           title={activeTab === 'trash' ? "Permanently Delete" : "Move to Trash"}
                         >
                           <i className="fa-solid fa-trash-can text-sm"></i>
                         </button>
                         {activeTab === 'trash' && (
                           <button 
                             onClick={() => setItemToRestore({
                                id: item.id,
                                name: item.textPreview || 'Synthesis Result',
                                type: 'synthesis'
                              })}
                             className="p-4 text-slate-200 group-hover:text-brand-primary transition-colors"
                             title="Restore Asset"
                           >
                             <i className="fa-solid fa-rotate-left text-sm"></i>
                           </button>
                         )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* AI Smart Recap Modal */}
      <SmartRecapModal
        isOpen={isSmartRecapOpen}
        onClose={() => setIsSmartRecapOpen(false)}
        recap={smartRecapRecord?.smartRecap || null}
        recordingTitle={smartRecapRecord?.fileName}
        isGenerating={isGeneratingRecap}
        onRegenerate={handleRegenerateRecap}
      />

      {/* Audio Trimmer Modal */}
      {trimmerRecord && (
        <AudioTrimmerModal
          isOpen={!!trimmerRecord}
          onClose={() => setTrimmerRecord(null)}
          recordingId={trimmerRecord.id}
          recordingTitle={trimmerRecord.fileName}
          audioUrl={trimmerRecord.originalAudioUrl}
          projectId={trimmerRecord.projectId}
          getIdToken={() => userProfile?.getIdToken?.() || Promise.resolve(undefined)}
          onTrimSuccess={(derived) => {
            if (derived) {
              const newRecord: AudioToTextRecord = {
                id: derived.id,
                userId: userProfile?.uid || 'user',
                date: new Date().toISOString(),
                fileName: derived.fileName,
                sourceType: 'recorded',
                originalAudioUrl: derived.storagePath ? `/api/recordings/${encodeURIComponent(derived.id)}/audio` : undefined,
                transcript: [],
                status: 'completed',
                readStatus: 'not-read',
                bookmarks: [],
                ownerEmail: userProfile?.email || '',
                speakerMap: {},
                collaborators: [],
                group: trimmerRecord.group || 'General',
                projectId: derived.projectId || trimmerRecord.projectId,
                storagePath: derived.storagePath,
                meetingSessionId: derived.meetingSessionId || trimmerRecord.meetingSessionId,
                externalMeetingId: trimmerRecord.externalMeetingId,
                provider: trimmerRecord.provider,
                provenanceManifestId: trimmerRecord.provenanceManifestId,
                isTrimmedVersion: true,
                parentRecordingId: trimmerRecord.id,
                trimRange: derived.trimRange
              };
              onUpdateAudio(newRecord);
            }
          }}
        />
      )}

      {/* AH.184 Executive Report Export Modal */}
      <ReportExportModal
        isOpen={isReportModalOpen}
        onClose={() => {
          setIsReportModalOpen(false);
          setReportRecord(null);
        }}
        defaultType="meeting_summary"
        meetingId={reportRecord?.id}
        meetingTitle={reportRecord?.fileName}
        projectId={reportRecord?.projectId}
        availableProjects={projects}
        availableMeetings={audioHistory}
      />
    </div>
  );
};

export default HistoryDashboard;
