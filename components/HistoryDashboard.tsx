
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AudioToTextRecord, TextToAudioRecord, TranscriptSegment, ReadStatus, CollaborationRole, PlaybackMetadata, PlaybackStatus, Bookmark, AuthStatus, UserProfile, Project, UsageStats, StrategicAnalysis } from '../types';
import { executeDownload, generateTranscriptBlob } from '../services/downloadService';
import { analyzeStrategically } from '../services/geminiService';
import { PLAN_FEATURES } from '../config/planConfig';
import UpgradeModal from './UpgradeModal';

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
  usageStats, searchQuery, addNotification
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
  const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
  const [expandedTextIds, setExpandedTextIds] = useState<Set<string>>(new Set());

  // Sync projectFilter with filterGroup prop
  useEffect(() => {
    setProjectFilter(filterGroup || 'all');
  }, [filterGroup]);

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

  // Filtering Logic
  const [editingFileName, setEditingFileName] = useState<{ id: string, name: string } | null>(null);
  const [isConversationMode, setIsConversationMode] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeReason, setUpgradeReason] = useState('');
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

    const isMemberOfProject = (groupName: string) => {
      if (groupName === 'General') return true;
      const project = (projects as Project[]).find(p => p.name === groupName);
      if (!project) return true; // Default for legacy
      if (project.ownerEmail === userProfile?.email) return true;
      return project.members?.some(m => m.email === userProfile?.email);
    };

    const matchesProject = (group: string | undefined) => {
      const g = group || 'General';
      const projectExists = (projects as Project[]).some(p => p.name === g);
      const effectiveGroup = projectExists ? g : 'General';
      
      if (!isMemberOfProject(effectiveGroup)) return false;
      if (projectFilter === 'all') return true;
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
      const deletedAudio = audioHistory.filter(h => h.deletedAt && matchesProject(h.group) && isWithinDateRange(h.date) && matchesSearch(h));
      const deletedText = textHistory.filter(h => h.deletedAt && matchesProject(h.group) && isWithinDateRange(h.date) && matchesSearch(h));
      return [...deletedAudio, ...deletedText];
    }

    if (activeTab === 'bookmarks') {
      // Return all bookmarks from all audio records
      const allBookmarks: ExtendedBookmark[] = [];
      audioHistory.forEach(record => {
        if (!record.deletedAt && matchesProject(record.group) && isWithinDateRange(record.date) && matchesSearch(record)) {
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
      return textHistory.filter(h => !h.deletedAt && matchesProject(h.group) && isWithinDateRange(h.date) && matchesSearch(h));
    } else {
      const type = activeTab === 'live' ? 'live' : 'recorded';
      return audioHistory.filter(h => 
        !h.deletedAt &&
        h.sourceType === type && 
        matchesProject(h.group) && 
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
    if (record.group === 'General') return true;
    if (authStatus === AuthStatus.GUEST) return false;
    if (!userProfile) return false;

    // Find the project for this record
    const project = (projects as Project[]).find(p => p.name === record.group);
    if (!project) return true; // Default to true for legacy or General if not found

    if (project.ownerEmail === userProfile.email) return true;

    const members = project.members || [];
    const member = members.find(m => m.email === userProfile.email);
    if (!member) return false;

    if (action === 'delete') {
      return member.role === 'owner';
    }
    if (action === 'edit') {
      return member.role === 'owner' || member.role === 'editor';
    }
    return false;
  };

  const handleInviteClick = () => {
    if (!PLAN_FEATURES[usageStats.plan].team) {
      setUpgradeReason('Collaboration and team projects are available on Pro, Team, and Enterprise plans.');
      setShowUpgradeModal(true);
      return;
    }
    const project = (projects as Project[]).find(p => p.name === projectFilter);
    if (project) {
      setProjectToManage(project);
    }
  };

  const [projectToManage, setProjectToManage] = useState<Project | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CollaborationRole>('viewer');

  const handleDownloadClick = (asset: { id: string; name: string; url: string; type: 'audio' | 'transcript' }) => {
    if (authStatus === AuthStatus.GUEST) {
      setShowGuestDownloadPrompt(true);
    } else if (!PLAN_FEATURES[usageStats.plan].export) {
      setUpgradeReason('Exporting transcripts and audio files is a Pro feature.');
      setShowUpgradeModal(true);
    } else {
      setDownloadingAsset(asset);
    }
  };

  const handlePlayFull = (id: string, title: string, url: string) => {
    if (activePlaybackId === id && activePlaybackSegIdx === undefined && playbackStatus === 'playing') {
      onPause();
    } else {
      onPlay({ id, title, url });
    }
  };

  const handlePlaySegment = (item: AudioToTextRecord, seg: TranscriptSegment, idx: number) => {
    if (activePlaybackId === item.id && activePlaybackSegIdx === idx && playbackStatus === 'playing') {
      onPause();
    } else {
      onPlay({ id: item.id, title: item.fileName, url: item.originalAudioUrl!, segmentIndex: idx }, seg.startTime, seg.endTime);
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
        userName: userProfile?.name || 'Guest'
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
      case 'read': return 'bg-green-100 text-green-700 border-green-200';
      case 'in-progress': return 'bg-amber-100 text-amber-700 border-amber-200';
      default: return 'bg-gray-100 text-gray-500 border-gray-200';
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runStrategicAnalysis = async (record: AudioToTextRecord) => {
    if (isAnalyzing) return;

    // Check thinking limit
    const plan = userProfile?.plan || 'guest';
    const limit = PLAN_FEATURES[plan].thinkingLimit;
    
    if (limit !== 'unlimited' && (userProfile?.thinkingUsageCount || 0) >= (limit as number)) {
      setUpgradeReason('You have reached your Thinking Engine limit for this month.');
      setShowUpgradeModal(true);
      return;
    }
    
    setIsAnalyzing(record.id);
    try {
      const content = record.summary 
        ? `Summary: ${record.summary.mainTopic}\nKey Points: ${record.summary.keyPoints.join(', ')}`
        : record.transcript.map(t => `${record.speakerMap[t.speaker] || t.speaker}: ${t.text}`).join('\n');
      
      const analysis = await analyzeStrategically(content, record.summary ? 'summary' : 'transcript');
      
      if (analysis) {
        onUpdateAudio({
          ...record,
          strategicAnalysis: analysis
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

  const displayTitle = projectFilter === 'all' ? "Intelligence Archive" : `Project: ${projectFilter}`;

  return (
    <div className="space-y-4 pb-40 animate-in fade-in h-full relative">
      <UpgradeModal 
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        reason={upgradeReason}
      />
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
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[250] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-lg w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Project Collaboration</h2>
                <p className="text-slate-500 text-[14px] font-medium text-left">Manage access for <span className="text-brand-primary font-bold">{projectToManage.name}</span></p>
              </div>
              <button onClick={() => setProjectToManage(null)} className="text-slate-400 hover:text-slate-600">
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <div className="space-y-6">
              {/* Members List */}
              <div className="space-y-3 text-left">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Team members</label>
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-brand-primary text-white rounded-full flex items-center justify-center text-[10px] font-bold">
                        {(projectToManage.ownerEmail?.charAt(0) || 'U').toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{projectToManage.ownerEmail || 'Unknown Owner'}</p>
                        <p className="text-[10px] text-slate-500">Project Owner • <span className="text-emerald-500 font-bold">Online</span></p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-brand-primary/10 text-brand-primary text-[10px] font-bold rounded uppercase tracking-widest">Owner</span>
                  </div>

                  {projectToManage.members && (projectToManage.members || []).map((member, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100">
                      <div className="flex items-center space-x-3">
                        <div className="relative">
                          <div className="w-8 h-8 bg-slate-200 text-slate-500 rounded-full flex items-center justify-center text-[10px] font-bold">
                            {(member.email?.charAt(0) || 'U').toUpperCase()}
                          </div>
                          {member.isOnline && <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full"></div>}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{member.email || 'Unknown Member'}</p>
                          <p className="text-[10px] text-slate-500">
                            {(member.role?.charAt(0).toUpperCase() || 'U') + (member.role?.slice(1) || 'ser')} • 
                            {member.isOnline ? <span className="text-emerald-500 font-bold"> Online</span> : <span className="text-slate-300"> Offline</span>}
                          </p>
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
                const isEditor = member?.role === 'editor';
                const isDefaultAdmin = userProfile?.email === 'riyamshah2509@gmail.com';
                const canInvite = isOwner || (usageStats.plan === 'enterprise' && isEditor) || isDefaultAdmin;

                if (!canInvite) return null;

                return (
                  <div className="space-y-3 text-left">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Invite new member</label>
                    <div className="flex space-x-2">
                      <input 
                        type="email"
                        placeholder="colleague@company.com"
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-primary/20"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                      <select 
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-primary/20"
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as CollaborationRole)}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button 
                        onClick={() => {
                          if (inviteEmail.trim()) {
                            onInviteToProject(projectToManage.name, inviteEmail, inviteRole);
                            setInviteEmail('');
                          }
                        }}
                        className="bg-brand-primary text-white px-6 py-2.5 rounded-lg text-xs font-bold tracking-widest hover:opacity-90 transition-opacity"
                      >
                        INVITE
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="pt-4 border-t border-slate-100">
              <button 
                onClick={() => setProjectToManage(null)}
                className="w-full py-4 bg-brand-primary text-white rounded-lg font-semibold tracking-widest text-[13px] shadow-xl active:scale-95 transition-all"
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

      {/* Page Header */}
      <header className="space-y-6 text-left border-b border-brand-divider/20 pb-8">
        <div className="space-y-2">
          <h1 className="text-brand-primary text-[32px] md:text-[42px] font-semibold tracking-tight">
            {displayTitle}
          </h1>
          <p className="text-slate-500 text-sm md:text-base font-normal">Categorical record keeping for high-fidelity enterprise assets.</p>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex flex-wrap items-center gap-6">
             {projectFilter !== 'all' && projectFilter !== 'General' && (
               <div className="flex items-center gap-4">
                 {/* Collaborators Indicator */}
                 <div className="flex -space-x-2">
                   {(() => {
                     const project = (projects as Project[]).find(p => p.name === projectFilter);
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

                 <div className="flex bg-white border border-brand-divider/20 rounded-xl p-1 shadow-sm h-fit">
                   <button 
                     onClick={handleInviteClick}
                     className="px-4 py-2.5 text-[12px] font-bold text-brand-primary hover:bg-brand-primary/5 rounded-lg transition-colors flex items-center gap-2"
                     title="Invite Members"
                   >
                     <i className="fa-solid fa-user-plus"></i>
                     <span>Invite</span>
                   </button>
                   <div className="w-[1px] h-5 bg-brand-divider/20 self-center"></div>
                   <button 
                     onClick={() => setBulkDownloadGroup(projectFilter)}
                     className="px-4 py-2.5 text-[12px] font-bold text-slate-500 hover:text-brand-primary rounded-lg transition-colors flex items-center gap-2"
                     title="Bulk Export Project"
                   >
                     <i className="fa-solid fa-cloud-arrow-down"></i>
                     <span>Bulk export</span>
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
                     className="px-4 py-2.5 text-[12px] font-bold text-slate-400 hover:text-red-500 rounded-lg transition-colors flex items-center gap-2"
                     title="Delete Entire Project"
                   >
                     <i className="fa-solid fa-trash-can"></i>
                     <span>Delete project</span>
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

      {/* Data List */}
      <div className="space-y-4">
        {filteredData.length === 0 ? (
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
                    className="w-8 h-8 rounded-full bg-brand-primary text-brand-accent flex items-center justify-center shadow-md hover:scale-110 transition-all"
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

            return (
              <div 
                key={item.id} 
                className={`bg-white rounded-xl p-6 border transition-all flex flex-col gap-6 relative group ${isSelected ? 'border-brand-primary ring-1 ring-brand-primary shadow-sm' : 'border-brand-divider/20 shadow-sm hover:shadow-md'}`}
              >
                {/* Selection Checkbox */}
                <div 
                  onClick={() => toggleSelect(item.id)}
                  className={`absolute top-6 left-6 w-6 h-6 rounded-lg border-2 flex items-center justify-center cursor-pointer transition-all z-10 ${isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-white border-brand-divider/30 hover:border-brand-primary'}`}
                >
                  {isSelected && <i className="fa-solid fa-check text-brand-accent text-[10px]"></i>}
                </div>

                <div className="flex-1 lg:pl-10 space-y-6 text-left">
                  {isAudio ? (
                    // Audio Item Layout
                    <div className="flex flex-col gap-8">
                      <div className="flex flex-col lg:flex-row gap-8">
                        <div className="lg:w-1/3 space-y-5">
                          <div className="flex justify-between items-center">
                            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-widest font-mono">{item.date}</span>
                            <div className="flex items-center space-x-2">
                               <div className={`px-2 py-1 rounded text-[11px] font-medium uppercase tracking-tighter ${item.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : item.status === 'error' ? 'bg-red-50 text-red-600' : 'bg-brand-background text-brand-primary'}`}>
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
                                 className="p-2 text-slate-200 group-hover:text-red-500 transition-colors"
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
                                   className="p-2 text-slate-200 group-hover:text-brand-primary transition-colors"
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
                                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-md uppercase tracking-widest border border-slate-200/50">
                                  {projects.some(p => p.name === item.group) ? (item.group || 'General') : 'General'}
                                </span>
                              </div>
                            )}
                            <div className="flex items-center space-x-2">
                              <div className="flex flex-col">
                                <label className="text-[8px] font-black text-slate-400 mb-1 ml-1">Project</label>
                                <select 
                                  value={item.group} 
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === 'new') {
                                      onAddGroup(''); // This should open the modal in App.tsx
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
                                  className={`bg-brand-background border border-brand-divider/20 px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest rounded-lg focus:ring-1 focus:ring-brand-primary font-mono ${!checkPermission(item, 'edit') ? 'text-slate-400 cursor-not-allowed' : 'text-brand-secondary'}`}
                                >
                                  {groups.map(g => (
                                    <option key={g} value={g}>
                                      {g === 'General' ? 'General (Default)' : g}
                                    </option>
                                  ))}
                                  <option value="new">+ Create new project</option>
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
                                className={`px-2 py-1 rounded-lg border text-[11px] font-medium uppercase cursor-pointer transition-colors font-mono ${getReadStatusStyle(item.readStatus)}`}
                              >
                                {item.readStatus.replace('-', ' ')}
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
                                 className={`flex-1 py-3.5 rounded-lg font-black uppercase tracking-widest text-[9px] transition-all shadow-lg ${activePlaybackId === item.id && activePlaybackSegIdx === undefined && playbackStatus === 'playing' ? 'bg-brand-secondary text-white shadow-brand-secondary/20' : 'bg-brand-primary text-brand-accent shadow-brand-primary/20'}`}
                               >
                                  <i className={`fa-solid ${activePlaybackId === item.id && activePlaybackSegIdx === undefined && playbackStatus === 'playing' ? 'fa-pause' : 'fa-play'} mr-2`}></i>
                                  {activePlaybackId === item.id && activePlaybackSegIdx === undefined && playbackStatus === 'playing' ? 'Pause' : 'Replay Asset'}
                               </button>
                             )}
                             <div className="flex gap-1.5">
                                {activeTab !== 'trash' && (
                                  <>
                                    <button 
                                      onClick={() => {
                                        if (usageStats.plan === 'guest' || usageStats.plan === 'free') {
                                          addNotification({
                                            title: 'Plan Limitation',
                                            message: 'Collaboration features are only available in Pro and Enterprise plans.',
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
                                  className={`p-3.5 rounded-lg transition-all shadow-sm ${expandedRecordId === item.id ? 'bg-brand-primary text-brand-accent' : 'bg-brand-background text-brand-primary hover:bg-brand-divider/10'}`}
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
                          {/* Summary */}
                          {item.summary && (
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
                                  <span className="text-[11px] font-medium text-slate-400 tracking-widest font-mono">Action items</span>
                                  <ul className="space-y-1">
                                    {(item.summary.actionItems || []).map((a, i) => <li key={i} className="text-xs font-normal text-slate-600 flex items-start gap-2"><span className="text-brand-secondary mt-1">•</span>{a}</li>)}
                                  </ul>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Strategic Thinking Partner */}
                          <div className="bg-brand-primary/5 rounded-xl border border-brand-primary/10 overflow-hidden">
                            <div 
                              className="p-6 flex items-center justify-between cursor-pointer hover:bg-brand-primary/10 transition-colors"
                              onClick={() => toggleStrategicAnalysis(item.id)}
                            >
                              <div className="flex items-center space-x-4">
                                <div className="w-10 h-10 bg-brand-primary text-brand-accent rounded-lg flex items-center justify-center shadow-md">
                                  <i className="fa-solid fa-brain text-lg"></i>
                                </div>
                                <div>
                                  <h4 className="text-sm font-black text-brand-primary tracking-tight">Strategic Thinking Partner</h4>
                                  <p className="text-[10px] text-brand-secondary font-bold tracking-widest uppercase font-mono">Deep AI Analysis & Blindspot Detection</p>
                                </div>
                              </div>
                              <div className="flex items-center space-x-3">
                                {!item.strategicAnalysis && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      runStrategicAnalysis(item);
                                    }}
                                    disabled={isAnalyzing === item.id}
                                    className="px-4 py-2 bg-brand-primary text-brand-accent rounded-lg text-[10px] font-black uppercase tracking-widest hover:shadow-lg transition-all disabled:opacity-50"
                                  >
                                    {isAnalyzing === item.id ? (
                                      <><i className="fa-solid fa-spinner fa-spin mr-2"></i> Analyzing...</>
                                    ) : (
                                      <><i className="fa-solid fa-wand-magic-sparkles mr-2"></i> Run Analysis</>
                                    )}
                                  </button>
                                )}
                                <i className={`fa-solid fa-chevron-${expandedStrategicAnalysisIds.has(item.id) ? 'up' : 'down'} text-brand-primary/40`}></i>
                              </div>
                            </div>

                            {expandedStrategicAnalysisIds.has(item.id) && (
                              <div className="p-8 border-t border-brand-primary/10 bg-white/50 space-y-10 animate-in slide-in-from-top-2 duration-300">
                                {item.strategicAnalysis ? (
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                    <div className="space-y-8">
                                      <div className="space-y-3">
                                        <div className="flex items-center space-x-2 text-brand-primary">
                                          <i className="fa-solid fa-bullseye text-xs"></i>
                                          <span className="text-[11px] font-black uppercase tracking-widest font-mono">Core Intent</span>
                                        </div>
                                        <p className="text-sm text-slate-700 leading-relaxed font-medium pl-5 border-l-2 border-brand-primary/20">{item.strategicAnalysis.coreIntent}</p>
                                      </div>

                                      <div className="space-y-3">
                                        <div className="flex items-center space-x-2 text-brand-primary">
                                          <i className="fa-solid fa-compass text-xs"></i>
                                          <span className="text-[11px] font-black uppercase tracking-widest font-mono">Context & Stakes</span>
                                        </div>
                                        <p className="text-sm text-slate-600 leading-relaxed pl-5 border-l-2 border-brand-primary/10">{item.strategicAnalysis.context}</p>
                                      </div>

                                      <div className="space-y-4">
                                        <div className="flex items-center space-x-2 text-amber-600">
                                          <i className="fa-solid fa-triangle-exclamation text-xs"></i>
                                          <span className="text-[11px] font-black uppercase tracking-widest font-mono">Assumptions & Risks</span>
                                        </div>
                                        <ul className="space-y-3 pl-5">
                                          {item.strategicAnalysis.assumptions.map((a, i) => (
                                            <li key={i} className="text-xs text-slate-600 flex items-start gap-3">
                                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0"></span>
                                              {a}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    </div>

                                    <div className="space-y-8">
                                      <div className="space-y-4">
                                        <div className="flex items-center space-x-2 text-rose-600">
                                          <i className="fa-solid fa-eye-slash text-xs"></i>
                                          <span className="text-[11px] font-black uppercase tracking-widest font-mono">Blind Spots & Gaps</span>
                                        </div>
                                        <div className="grid gap-4">
                                          {item.strategicAnalysis.logicalGaps.map((gap, i) => (
                                            <div key={i} className="p-4 bg-rose-50/50 border border-rose-100 rounded-lg text-xs text-rose-800 leading-relaxed">
                                              <span className="font-black mr-2">GAP:</span> {gap}
                                            </div>
                                          ))}
                                          {item.strategicAnalysis.alternativePerspectives.map((p, i) => (
                                            <div key={i} className="p-4 bg-blue-50/50 border border-blue-100 rounded-lg text-xs text-blue-800 leading-relaxed">
                                              <span className="font-black mr-2">PERSPECTIVE:</span> {p}
                                            </div>
                                          ))}
                                        </div>
                                      </div>

                                      <div className="space-y-4">
                                        <div className="flex items-center space-x-2 text-brand-secondary">
                                          <i className="fa-solid fa-circle-question text-xs"></i>
                                          <span className="text-[11px] font-black uppercase tracking-widest font-mono">Strategic Questions</span>
                                        </div>
                                        <ul className="space-y-3 pl-5">
                                          {item.strategicAnalysis.ignoredQuestions.map((q, i) => (
                                            <li key={i} className="text-xs text-brand-secondary font-bold italic flex items-start gap-3">
                                              <span className="text-lg leading-none">?</span>
                                              {q}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>

                                      <div className="p-6 bg-brand-primary text-brand-accent rounded-xl space-y-4 shadow-xl">
                                        <div className="flex items-center space-x-2">
                                          <i className="fa-solid fa-chess text-xs"></i>
                                          <span className="text-[11px] font-black uppercase tracking-widest font-mono">Recommended Framework</span>
                                        </div>
                                        <p className="text-xs leading-relaxed opacity-90">{item.strategicAnalysis.decisionFramework}</p>
                                        <div className="pt-4 border-t border-brand-accent/20">
                                          <span className="text-[10px] font-black uppercase tracking-widest block mb-3">Next Strategic Steps</span>
                                          <div className="space-y-2">
                                            {item.strategicAnalysis.nextSteps.map((step, i) => (
                                              <div key={i} className="flex items-center gap-3 text-[11px] font-bold">
                                                <span className="w-5 h-5 rounded-full bg-brand-accent/20 flex items-center justify-center text-[10px]">{i + 1}</span>
                                                {step}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="py-20 flex flex-col items-center justify-center text-center space-y-6">
                                    <div className="w-20 h-20 bg-brand-primary/10 rounded-full flex items-center justify-center text-brand-primary animate-pulse">
                                      <i className="fa-solid fa-wand-magic-sparkles text-3xl"></i>
                                    </div>
                                    <div className="max-w-md space-y-2">
                                      <h5 className="text-lg font-black text-brand-primary">No Strategic Analysis Yet</h5>
                                      <p className="text-sm text-slate-500 leading-relaxed">Run the strategic thinking partner to uncover hidden meaning, challenge assumptions, and reveal blind spots in this conversation.</p>
                                    </div>
                                    <button
                                      onClick={() => runStrategicAnalysis(item)}
                                      disabled={isAnalyzing === item.id}
                                      className="px-8 py-4 bg-brand-primary text-brand-accent rounded-xl text-xs font-black uppercase tracking-widest hover:shadow-2xl hover:-translate-y-1 transition-all disabled:opacity-50"
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

                          {/* Full Transcript with Bookmarking */}
                          <div className="space-y-6">
                            <div className="flex items-center justify-between ml-1">
                              <h4 className="text-[11px] font-medium text-slate-400 tracking-widest uppercase">Full intelligence transcript</h4>
                              <button 
                                onClick={() => setIsConversationMode(!isConversationMode)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all border ${isConversationMode ? 'bg-brand-primary text-brand-accent border-brand-primary shadow-md' : 'bg-white text-brand-primary border-brand-divider/20 hover:border-brand-primary/40'}`}
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
                                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${isActive ? 'bg-brand-secondary text-white' : 'bg-brand-primary/10 text-brand-primary hover:bg-brand-primary hover:text-brand-accent'}`}
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
                           <span className={`text-[11px] font-medium uppercase px-2 py-1 rounded border tracking-widest ${item.gender === 'male' ? 'bg-blue-50 text-blue-500 border-blue-100' : 'bg-pink-50 text-pink-500 border-pink-100'}`}>{item.gender} Voice</span>
                           <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-md uppercase tracking-widest border border-slate-200/50">
                             {projects.some(p => p.name === item.group) ? (item.group || 'General') : 'General'}
                           </span>
                           <div className="flex flex-col">
                             <label className="text-[8px] font-black text-slate-400 mb-1 ml-1">Project</label>
                             <select 
                               value={item.group} 
                               onChange={(e) => {
                                 const value = e.target.value;
                                 if (value === 'new') {
                                   onAddGroup(''); // This should open the modal in App.tsx
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
                               className="bg-brand-background border border-brand-divider/20 px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest rounded-lg focus:ring-1 focus:ring-brand-primary text-slate-400"
                             >
                                {groups.map(g => (
                                  <option key={g} value={g}>
                                    {g === 'General' ? 'General (Default)' : g}
                                  </option>
                                ))}
                                <option value="new">+ Create new project</option>
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
                                 if (usageStats.plan === 'guest' || usageStats.plan === 'free') {
                                   addNotification({
                                     title: 'Plan Limitation',
                                     message: 'Collaboration features are only available in Pro and Enterprise plans.',
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
                               className={`px-8 py-3.5 rounded-lg font-medium uppercase tracking-widest text-[11px] transition-all shadow-lg ${activePlaybackId === item.id && playbackStatus === 'playing' ? 'bg-brand-secondary text-white shadow-brand-secondary/20' : 'bg-brand-primary text-brand-accent shadow-brand-primary/20'}`}
                             >
                               <i className={`fa-solid ${activePlaybackId === item.id && playbackStatus === 'playing' ? 'fa-pause' : 'fa-play'} mr-2`}></i>
                               <span>Replay</span>
                             </button>
                             <button onClick={() => setDownloadingAsset({ id: item.id, name: `Synthesis_${item.id}`, url: item.audioUrl, type: 'audio' })} className="p-4 bg-brand-background text-brand-primary rounded-lg hover:bg-brand-primary hover:text-brand-accent transition-all shadow-sm"><i className="fa-solid fa-download text-xs"></i></button>
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
    </div>
  );
};

export default HistoryDashboard;
