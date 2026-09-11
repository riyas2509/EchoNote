import React, { useState, useRef, useEffect } from 'react';
import { MessageSquareOff, ArrowRight, AlertTriangle } from 'lucide-react';
import FirstValueActivation from './FirstValueActivation';
import UnresolvedTopicsDetector from './UnresolvedTopicsDetector';
import MeetingIntelligenceView from './MeetingIntelligenceView';
import ExecutionTrackerView from './ExecutionTrackerView';
import SmartReminderView from './SmartReminderView';
import { transcribeAudio, summarizeTranscript, analyzeStrategically, processUnifiedMeetingIntelligence } from '../services/geminiService';
import { uploadAudioToStorage } from '../services/recordingService';
import { getApiUrl } from '../lib/apiClient';
import { PLAN_FEATURES } from '../config/planConfig';
import { getMinutesUsage, getThinkingUsage, formatRefreshDate } from '../lib/usageUtils';
import { executeDownload, generateTranscriptBlob } from '../services/downloadService';
import { AudioToTextRecord, TranscriptSegment, AuthStatus, UserProfile, Bookmark, SpeakerMapping, CollaborationRole, PlaybackMetadata, PlaybackStatus, CallSummary, UsageStats, Project, ExecutionTracker, OrgRole } from '../types';

interface AudioToTextViewProps {
  onSave: (record: AudioToTextRecord) => void; 
  groups: string[];
  projects: Project[];
  onAddGroup: (name: string) => void;
  onInviteToProject: (projectName: string, email: string, role: CollaborationRole) => void;
  authStatus: AuthStatus;
  userProfile?: UserProfile;
  onNewProject: () => void;
  lastCreatedProjectId?: string | null;
  activePlaybackId?: string;
  activePlaybackSegIdx?: number;
  playbackStatus: PlaybackStatus;
  onPlay: (metadata: PlaybackMetadata, startTime?: number, endTime?: number) => void;
  onPause: () => void;
  onStop: () => void;
  addNotification: (notif: any) => void;
  usageStats: UsageStats;
  onDeductMinutes: (minutes: number) => void;
  onSignInClick: () => void;
  searchTerm?: string;
  checkThinkingLimit: () => boolean;
  checkTranscriptionLimit: (minutes: number) => boolean;
  incrementThinkingUsage: () => Promise<void>;
  incrementTranscriptionUsage: (minutes: number) => Promise<void>;
  userOrgRole?: OrgRole;
  onNavigateToHistory?: () => void;
}

const AudioToTextView: React.FC<AudioToTextViewProps> = ({ 
  onSave, groups, projects, onAddGroup, onInviteToProject, authStatus, userProfile, onNewProject, lastCreatedProjectId,
  activePlaybackId, activePlaybackSegIdx, playbackStatus, onPlay, onPause, onStop,
  addNotification, usageStats, onDeductMinutes, onSignInClick, searchTerm = '',
  checkThinkingLimit, checkTranscriptionLimit, incrementThinkingUsage, incrementTranscriptionUsage, userOrgRole,
  onNavigateToHistory
}) => {
  const isGuest = usageStats.plan === 'guest';
  const isFree = usageStats.plan === 'free';
  const isPro = usageStats.plan === 'pro';

  const checkPermission = (record: AudioToTextRecord, action: 'edit' | 'delete') => {
    if (userOrgRole === 'super_admin' || userOrgRole === 'org_admin') return true;
    if (userOrgRole === 'viewer') return false;

    if (record.group === 'General') return true;
    if (authStatus === AuthStatus.GUEST) return false;
    
    // If the user is the owner of the record, they have full access
    if (record.ownerEmail === userProfile?.email) return true;
    
    const project = projects.find(p => p.name === record.group);
    if (!project) return true; // General group or unknown

    if (project.ownerEmail === userProfile?.email) return true;

    const member = project.members?.find(m => m.email === userProfile?.email);
    
    if (userOrgRole === 'team_manager') {
      return true;
    }

    if (!member) return false;

    if (action === 'delete') {
      return member.role === 'owner';
    }

    if (action === 'edit') {
      return member.role === 'owner' || member.role === 'editor';
    }

    return false;
  };

  const [subWorkflow, setSubWorkflow] = useState<'selection' | 'recorded' | 'live'>('selection');
  const [recordedQueue, setRecordedQueue] = useState<AudioToTextRecord[]>([]);
  const [liveQueue, setLiveQueue] = useState<AudioToTextRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'recorded' | 'live'>('recorded');
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<Set<string>>(new Set());
  const [expandedStrategicAnalysisIds, setExpandedStrategicAnalysisIds] = useState<Set<string>>(new Set());
  const [expandedIntelligenceIds, setExpandedIntelligenceIds] = useState<Set<string>>(new Set());
  const [expandedExecutionTrackerIds, setExpandedExecutionTrackerIds] = useState<Set<string>>(new Set());
  const [expandedSmartReminderIds, setExpandedSmartReminderIds] = useState<Set<string>>(new Set());
  const [editingFileName, setEditingFileName] = useState<{ id: string, name: string } | null>(null);
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  
  const [fileStrategies, setFileStrategies] = useState<Record<string, 'original' | 'english'>>({});
  const [liveLanguage, setLiveLanguage] = useState<'original' | 'english'>('original');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Real-time collaboration sync via Firestore is handled in App.tsx
  // Local queues are kept in component state for the current session
  
  // Live Recording States
  const [isRecording, setIsRecording] = useState(false);
  const [isFinalizingLive, setIsFinalizingLive] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Local state for immediate download after completion
  const [downloadModal, setDownloadModal] = useState<{ id: string; name: string; url: string; type: 'audio' | 'transcript' } | null>(null);
  const [selectedFormat, setSelectedFormat] = useState('');

  // New group flow state
  // Collaboration state
  const [projectToManage, setProjectToManage] = useState<Project | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CollaborationRole>('viewer');

  const toggleSummary = (id: string) => {
    setExpandedSummaryIds(prev => {
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

  const toggleMeetingIntelligence = (id: string) => {
    setExpandedIntelligenceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExecutionTracker = (id: string) => {
    setExpandedExecutionTrackerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSmartReminders = (id: string) => {
    setExpandedSmartReminderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runStrategicAnalysis = async (id: string) => {
    const queue = activeTab === 'recorded' ? recordedQueue : liveQueue;
    const record = queue.find(r => r.id === id);
    if (!record || record.status !== 'completed') return;

    const setter = activeTab === 'recorded' ? setRecordedQueue : setLiveQueue;
    
    setter(prev => prev.map(r => r.id === id ? { ...r, status: 'processing', processingStep: "Performing Strategic Analysis..." } : r));

    if (!checkThinkingLimit()) {
      setter(prev => prev.map(r => r.id === id ? { ...r, status: 'completed' } : r));
      addNotification({
        title: 'Thinking Limit Reached',
        message: 'You have reached your thinking engine limit for the free plan.',
        type: 'error'
      });
      return;
    }

    try {
      // Prefer summary for analysis if available, otherwise use transcript
      const analysisType = record.summary ? 'summary' : 'transcript';
      const content = record.summary 
        ? `Main Topic: ${record.summary.mainTopic}\nKey Points: ${record.summary.keyPoints.join(', ')}\nDecisions: ${record.summary.decisions.join(', ')}\nAction Items: ${record.summary.actionItems.join(', ')}`
        : record.transcript.map(s => `${s.speaker}: ${s.text}`).join('\n');

      const strategicAnalysis = await analyzeStrategically(content, analysisType, userProfile?.plan || 'free');
      await incrementThinkingUsage();
      
      const updatedRecord = { ...record, strategicAnalysis, status: 'completed' as const };
      setter(prev => prev.map(r => r.id === id ? updatedRecord : r));
      onSave(updatedRecord);
      
      addNotification({
        title: "Strategic Insight Ready",
        message: `Strategic analysis for "${record.fileName}" is complete.`,
        recordId: id,
        type: 'audio'
      });
    } catch (e) {
      setter(prev => prev.map(r => r.id === id ? { ...r, status: 'completed' } : r));
      addNotification({
        title: "Analysis Error",
        message: "Failed to perform strategic analysis. Please try again.",
        type: 'error'
      });
    }
  };

  const runMeetingIntelligence = async (id: string) => {
    const queue = activeTab === 'recorded' ? recordedQueue : liveQueue;
    const record = queue.find(r => r.id === id);
    if (!record || record.status !== 'completed') return;

    const setter = activeTab === 'recorded' ? setRecordedQueue : setLiveQueue;
    
    setter(prev => prev.map(r => r.id === id ? { ...r, status: 'processing', processingStep: "Generating Meeting Intelligence..." } : r));

    if (!checkThinkingLimit()) {
      setter(prev => prev.map(r => r.id === id ? { ...r, status: 'completed' } : r));
      addNotification({
        title: 'Thinking Limit Reached',
        message: 'You have reached your thinking engine limit for the free plan.',
        type: 'error'
      });
      return;
    }

    try {
      const fullTranscript = record.transcript.map(s => `${s.speaker}: ${s.text}`).join('\n');
      const unifiedIntelligence = await processUnifiedMeetingIntelligence(fullTranscript, userProfile?.plan || 'free');
      await incrementThinkingUsage();
      
      const updatedRecord: AudioToTextRecord = { 
        ...record, 
        strategicAnalysis: unifiedIntelligence.strategicAnalysis,
        meetingIntelligence: unifiedIntelligence.meetingIntelligence,
        executionTracker: unifiedIntelligence.executionTracker,
        calendarReminders: unifiedIntelligence.calendarReminders,
        unifiedIntelligence,
        status: 'completed' as const 
      };
      setter(prev => prev.map(r => r.id === id ? updatedRecord : r));
      onSave(updatedRecord);
      
      addNotification({
        title: "Meeting Intelligence Ready",
        message: `Intelligence score for "${record.fileName}" is ready.`,
        recordId: id,
        type: 'audio'
      });
    } catch (e) {
      setter(prev => prev.map(r => r.id === id ? { ...r, status: 'completed' } : r));
      addNotification({
        title: "Analysis Error",
        message: "Failed to generate meeting intelligence. Please try again.",
        type: 'error'
      });
    }
  };

  const handlePlayContent = (item: AudioToTextRecord) => {
    if (activePlaybackId === item.id && activePlaybackSegIdx === undefined && playbackStatus === 'playing') {
      onPause();
    } else {
      onPlay({ id: item.id, title: item.fileName, url: item.originalAudioUrl! });
    }
  };

  const handlePlaySegment = (item: AudioToTextRecord, seg: TranscriptSegment, idx: number) => {
    if (activePlaybackId === item.id && activePlaybackSegIdx === idx && playbackStatus === 'playing') {
      onPause();
    } else {
      onPlay({ id: item.id, title: item.fileName, url: item.originalAudioUrl!, segmentIndex: idx }, seg.startTime, seg.endTime);
    }
  };

  const triggerDownload = (id: string, name: string, url: string, type: 'audio' | 'transcript') => {
    if (authStatus === AuthStatus.GUEST) {
      setUsageError("Downloading assets is an Enterprise feature. Please create an account to unlock full access.");
      return;
    }
    setDownloadModal({ id, name, url, type });
    setSelectedFormat('');
  };

  const handleDownloadConfirm = async () => {
    if (!downloadModal || !selectedFormat) return;
    
    let url = downloadModal.url;
    if (downloadModal.type === 'transcript') {
      const q = [...recordedQueue, ...liveQueue].find(x => x.id === downloadModal.id);
      if (q && q.transcript) {
        const segments = q.transcript.map((s, idx) => ({
          speaker: q.speakerMap[s.speaker] || s.speaker,
          text: s.text,
          isBookmarked: (q.bookmarks || []).some(b => b.segmentIndex === idx)
        }));
        url = generateTranscriptBlob(segments, selectedFormat);
      }
    }

    try {
      await executeDownload(downloadModal.name, url, selectedFormat);
    } catch (err) {
      alert("System Error: Critical failure during file generation. Please retry.");
    }
    
    setDownloadModal(null);
    setSelectedFormat('');
  };

  const minutesUsage = getMinutesUsage(usageStats);
  
  const startRecording = async () => {
    if (minutesUsage.isExceeded) {
      setShowUsageModal(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = handleRecordingStop;
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone access denied. Please enable microphone permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsFinalizingLive(true);
    }
  };

  const handleRecordingStop = async () => {
    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const audioUrl = URL.createObjectURL(audioBlob);
    
    // Deduct minutes for live recording
    const estimatedMinutes = Math.max(1, Math.ceil(audioBlob.size / (1024 * 1024)));
    
    const newLiveRecord: AudioToTextRecord = {
      id: Math.random().toString(36).substr(2, 9),
      userId: userProfile?.uid || 'guest',
      date: new Date().toLocaleString(),
      fileName: `Live Recording - ${new Date().toLocaleTimeString()}`,
      sourceType: 'live',
      originalAudioUrl: audioUrl,
      _file: audioBlob,
      transcript: [],
      status: 'processing',
      processingStep: 'Validating stream...',
      readStatus: 'not-read',
      bookmarks: [],
      speakerMap: {},
      ownerEmail: userProfile?.email || 'guest',
      collaborators: [],
      group: 'General'
    };

    setLiveQueue(prev => [newLiveRecord, ...prev]);
    setActiveTab('live');
    setSubWorkflow('recorded');

    if (!checkTranscriptionLimit(estimatedMinutes)) {
      setLiveQueue(prev => prev.map(item => item.id === newLiveRecord.id ? { ...item, status: 'error', errorMessage: 'Transcription limit reached.' } : item));
      return;
    }

    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>(res => {
        reader.onload = () => res((reader.result as string).split(',')[1]);
        reader.readAsDataURL(audioBlob);
      });
      
      const audioMime = audioBlob.type || 'audio/webm';
      const { transcript, qualityScore, summary } = await transcribeAudio(b64, audioMime, liveLanguage, 'live_recording.webm');
      await incrementTranscriptionUsage(estimatedMinutes);
      
      // Show module selection modal instead of auto-processing
      setModuleSelectionModal({
        id: newLiveRecord.id,
        transcript,
        summary,
        qualityScore,
        estimatedMinutes,
        isLive: true
      });
    } catch (e: any) {
      const errorMsg = e?.message || 'Transcription service temporarily unavailable. Please try again or check connection.';
      setLiveQueue(prev => prev.map(item => item.id === newLiveRecord.id ? { 
        ...item, 
        status: 'error', 
        errorMessage: errorMsg 
      } : item));
    } finally {
      setIsFinalizingLive(false);
    }
  };

  const [selectedProject, setSelectedProject] = useState<string>('General');
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const [isGlobalDropdownOpen, setIsGlobalDropdownOpen] = useState(false);

  // AI Module Selection Modal State
  const [moduleSelectionModal, setModuleSelectionModal] = useState<{
    id: string;
    transcript: TranscriptSegment[];
    summary: CallSummary | undefined;
    qualityScore: number | undefined;
    estimatedMinutes: number;
    isLive: boolean;
  } | null>(null);
  const [selectedModules, setSelectedModules] = useState<string[]>(['summary', 'insights']);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isRecording) {
        console.warn("⚠️ Recording may pause when screen is off");
        addNotification({
          title: 'Recording Warning',
          message: 'Recording may stop if screen is locked or app is in background.',
          type: 'info'
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isRecording, addNotification]);

  useEffect(() => {
    if (lastCreatedProjectId) {
      const project = projects.find(p => p.id === lastCreatedProjectId);
      if (project) {
        setSelectedProject(project.name);
      }
    }
  }, [lastCreatedProjectId, projects]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.project-dropdown-container')) {
        setActiveDropdownId(null);
        setIsGlobalDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const ProjectDropdown = ({ 
    selected, 
    onSelect, 
    isOpen, 
    setIsOpen, 
    disabled = false,
    showLabel = true
  }: { 
    selected: string; 
    onSelect: (name: string) => void; 
    isOpen: boolean; 
    setIsOpen: (open: boolean) => void;
    disabled?: boolean;
    showLabel?: boolean;
  }) => (
    <div className="flex flex-col relative project-dropdown-container w-full md:w-64">
      {showLabel && <label className="text-[8px] font-black text-slate-400 mb-1 ml-1 uppercase tracking-widest">Project</label>}
      <button 
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`flex items-center justify-between w-full bg-white border border-brand-divider/20 px-4 py-2 text-[13px] font-medium rounded-lg transition-all ${disabled ? 'text-slate-400 cursor-not-allowed' : 'text-brand-primary hover:border-brand-primary/30'}`}
      >
        <span className="truncate">{selected}</span>
        <i className={`fa-solid fa-chevron-down text-[10px] transition-transform ${isOpen ? 'rotate-180' : ''}`}></i>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-brand-divider/20 rounded-xl shadow-2xl z-[100] py-2 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Projects</div>
          <div className="max-h-48 overflow-y-auto custom-scrollbar">
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => {
                  onSelect(p.name);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-4 py-2 text-[13px] hover:bg-slate-50 transition-colors ${selected === p.name ? 'font-bold text-brand-primary' : 'text-slate-600'}`}
              >
                <span className="truncate">{p.name}</span>
                {selected === p.name && <i className="fa-solid fa-check text-brand-primary text-[10px]"></i>}
              </button>
            ))}
          </div>
          <div className="h-px bg-brand-divider/10 my-1" />
          <button
            onClick={() => {
              onNewProject();
              setIsOpen(false);
            }}
            className="w-full flex items-center px-4 py-2 text-[13px] font-bold text-brand-primary hover:bg-slate-50 transition-colors"
          >
            <i className="fa-solid fa-plus mr-2 text-[10px]"></i>
            <span>Create New Project</span>
          </button>
        </div>
      )}
    </div>
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let files: File[] = [];
    if ('files' in e.target && e.target.files) {
      files = Array.from(e.target.files) as File[];
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
      files = Array.from(e.dataTransfer.files) as File[];
    }

    if (files.length > 0) {
      
    if (isGuest && files.length > 1) {
        setUsageError("Batch processing is available in Pro plans.");
        return;
      }

      if (isGuest && recordedQueue.length > 0) {
        setUsageError("Guest Preview allows only one audio file upload at a time.");
        return;
      }

      const newEntries = files.map(file => {
        const isMp4 = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
        
        return {
          id: Math.random().toString(36).substr(2, 9),
          date: new Date().toLocaleString(),
          fileName: file.name,
          sourceType: 'recorded',
          originalAudioUrl: isMp4 ? undefined : URL.createObjectURL(file),
          transcript: [],
          status: isMp4 ? 'error' : 'pending',
          errorMessage: isMp4 
            ? "MP4 video files are not supported in this version. Please upload an audio file such as MP3 or WAV."
            : null,
          readStatus: 'not-read',
          bookmarks: [],
          speakerMap: {},
          ownerEmail: userProfile?.email || 'guest',
          collaborators: [],
          group: selectedProject,
          _file: file
        } as any;
      });
      setRecordedQueue(prev => [...prev, ...newEntries]);
      setActiveTab('recorded');
    }
  };

  const processSingleRecord = async (id: string) => {
    if (minutesUsage.isExceeded) {
      setShowUsageModal(true);
      return;
    }

    const record = recordedQueue.find(r => r.id === id);
    if (!record || record.status !== 'pending') return;

    const file = (record as any)._file as File;
    
    // Simulate duration check (assuming 1MB ~ 1 minute for this prototype)
    const estimatedMinutes = Math.ceil(file.size / (1024 * 1024));
    
      if (estimatedMinutes > PLAN_FEATURES[usageStats.plan].minutesPerFileLimit) {
        setUsageError(`Plan limit: ${PLAN_FEATURES[usageStats.plan].minutesPerFileLimit} minutes per file.`);
        return;
      }
      if (minutesUsage.used + estimatedMinutes > minutesUsage.limit) {
        setShowUsageModal(true);
        return;
      }

    const strategy = fileStrategies[id] || (authStatus === AuthStatus.GUEST ? 'original' : null);
    if (!strategy) {
      addNotification({
        title: 'Validation Error',
        message: 'Please select a target language for this asset.',
        type: 'error'
      });
      return;
    }
    
    // Update status to processing
    setRecordedQueue(prev => prev.map(r => r.id === id ? { ...r, status: 'processing', processingStep: "Initializing intelligence module..." } : r));
    
    if (!checkTranscriptionLimit(estimatedMinutes)) {
      setRecordedQueue(prev => prev.map(r => r.id === id ? { ...r, status: 'pending' } : r));
      return;
    }

    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>(res => {
        reader.onload = () => res((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });

      // Update processing step
      setRecordedQueue(prev => prev.map(r => r.id === id ? { ...r, status: 'processing', processingStep: "Analyzing audio stream..." } : r));
      
      // Artificial delay for better UX
      await new Promise(res => setTimeout(res, 1500));

      setRecordedQueue(prev => prev.map(r => r.id === id ? { ...r, status: 'processing', processingStep: "Generating intelligence summary..." } : r));
      
      const { transcript, qualityScore, summary } = await transcribeAudio(b64, file.type, strategy, file.name);
      await incrementTranscriptionUsage(estimatedMinutes);
      
      // Show module selection modal instead of auto-processing
      setModuleSelectionModal({
        id,
        transcript,
        summary,
        qualityScore,
        estimatedMinutes,
        isLive: false
      });
    } catch (e: any) {
      const errorMsg = e?.message || "Transcription service temporarily unavailable. Please try again or upload a smaller audio file.";
      setRecordedQueue(prev => prev.map(r => r.id === id ? { 
        ...r, 
        status: 'error', 
        errorMessage: errorMsg 
      } : r));
      
      addNotification({
        title: "Intelligence Failure",
        message: errorMsg,
        recordId: id,
        type: 'audio'
      });
    }
  };

  const handleModuleSelectionConfirm = async () => {
    if (!moduleSelectionModal) return;
    const { id, transcript, summary, qualityScore, estimatedMinutes, isLive } = moduleSelectionModal;
    const setter = isLive ? setLiveQueue : setRecordedQueue;
    const queue = isLive ? liveQueue : recordedQueue;
    const record = queue.find(r => r.id === id);

    if (!record) return;

    console.log("Selected modules:", selectedModules);
    
    let finalSelectedModules = selectedModules;
    if (isGuest) {
      finalSelectedModules = ['summary']; // Force only Executive Summary for guests
      console.log("Guest mode detected: Forcing Executive Summary only");
    }
    
    setter(prev => prev.map(r => r.id === id ? { ...r, status: 'processing', processingStep: "Running selected AI modules..." } : r));
    setModuleSelectionModal(null);

    try {
      let finalAudioUrl = record.originalAudioUrl;
      if (authStatus === AuthStatus.LOGGED_IN && (record as any)._file) {
        try {
          setter(prev => prev.map(r => r.id === id ? { ...r, status: 'processing', processingStep: "Uploading audio track to secure cloud storage..." } : r));
          finalAudioUrl = await uploadAudioToStorage((record as any)._file, userProfile?.uid || 'unknown', id, record.fileName);
        } catch (uploadError) {
          console.error("Firebase Storage upload failed, falling back to local Blob:", uploadError);
        }
      }

      let unifiedIntelligence;
      if (finalSelectedModules.length > 0 && checkThinkingLimit()) {
        try {
          const fullTranscript = transcript.map(s => `${s.speaker}: ${s.text}`).join('\n');
          
          // Only run the full intelligence if we need more than just summary
          // OR if we are not a guest
          if (!isGuest && (finalSelectedModules.includes('strategy') || finalSelectedModules.includes('meeting') || finalSelectedModules.includes('execution') || finalSelectedModules.includes('reminders'))) {
            unifiedIntelligence = await processUnifiedMeetingIntelligence(fullTranscript, userProfile?.plan || 'free');
            await incrementThinkingUsage();
          } else if (finalSelectedModules.includes('summary')) {
            // Already handled or light version
          }
        } catch (err) {
          console.error("Unified intelligence analysis failed:", err);
        }
      }

      const finalRecord: AudioToTextRecord = {
        ...record,
        originalAudioUrl: finalAudioUrl,
        status: 'completed',
        transcript,
        summary: finalSelectedModules.includes('summary') ? summary : undefined,
        qualityScore,
        selectedModules: finalSelectedModules,
        strategicAnalysis: !isGuest && finalSelectedModules.includes('strategy') ? unifiedIntelligence?.strategicAnalysis : undefined,
        meetingIntelligence: !isGuest && finalSelectedModules.includes('meeting') ? unifiedIntelligence?.meetingIntelligence : undefined,
        executionTracker: !isGuest && finalSelectedModules.includes('execution') ? unifiedIntelligence?.executionTracker : undefined,
        calendarReminders: !isGuest && finalSelectedModules.includes('reminders') ? unifiedIntelligence?.calendarReminders : undefined,
        unifiedIntelligence: !isGuest && finalSelectedModules.length > 0 ? unifiedIntelligence : undefined
      };

      setter(prev => prev.map(r => r.id === id ? finalRecord : r));
      onSave(finalRecord);
      
      addNotification({
        title: "Intelligence Released",
        message: `Analysis for "${record.fileName}" is complete.`,
        recordId: finalRecord.id,
        type: 'audio'
      });
    } catch (e) {
      setter(prev => prev.map(r => r.id === id ? { 
        ...r, 
        status: 'error', 
        errorMessage: "Failed to process AI modules." 
      } : r));
    }
  };

  const removePendingRecord = (id: string) => {
    setRecordedQueue(prev => prev.filter(r => r.id !== id));
    setFileStrategies(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleGroupChange = (id: string, value: string) => {
    updateGroup(id, value);
  };

  const updateGroup = (id: string, group: string) => {
    if (authStatus === AuthStatus.GUEST) return;

    const record = [...recordedQueue, ...liveQueue].find(r => r.id === id);
    if (record) {
      // Check permission for the source group
      const sourceProject = projects.find(p => p.name === record.group);
      if (sourceProject && sourceProject.ownerEmail !== userProfile?.email) {
        const member = sourceProject.members?.find(m => m.email === userProfile?.email);
        if (member && member.role === 'viewer') {
          alert("You do not have permission to move assets from this project.");
          return;
        }
      }
    }

    // Check permission for the target group
    const project = projects.find(p => p.name === group);
    if (project && project.ownerEmail !== userProfile?.email) {
      const member = project.members?.find(m => m.email === userProfile?.email);
      if (member && member.role === 'viewer') {
        alert("You do not have permission to add content to this project.");
        return;
      }
    }

    const setter = activeTab === 'recorded' ? setRecordedQueue : setLiveQueue;
    if (record) {
      const updated = { ...record, group };
      setter(prev => prev.map(q => q.id === id ? updated : q));
      if (record.status === 'completed') {
        onSave(updated);
      }
    }
  };

  const updateFileName = (id: string, fileName: string) => {
    const setter = activeTab === 'recorded' ? setRecordedQueue : setLiveQueue;
    const queue = activeTab === 'recorded' ? recordedQueue : liveQueue;
    const record = queue.find(q => q.id === id);

    if (record) {
      const updated = { ...record, fileName };
      setter(prev => prev.map(q => q.id === id ? updated : q));
      if (record.status === 'completed') {
        onSave(updated);
      }
    }
    setEditingFileName(null);
  };

  const updateSpeaker = (id: string, label: string, name: string) => {
    const setter = activeTab === 'recorded' ? setRecordedQueue : setLiveQueue;
    const queue = activeTab === 'recorded' ? recordedQueue : liveQueue;
    const target = queue.find(q => q.id === id);

    if (target) {
      const updated = { ...target, speakerMap: { ...target.speakerMap, [label]: name } };
      setter(prev => prev.map(q => q.id === id ? updated : q));
      if (target.status === 'completed') {
        onSave(updated);
      }
    }
  };

  const updateTranscriptText = (id: string, segIdx: number, text: string) => {
    const record = [...recordedQueue, ...liveQueue].find(r => r.id === id);
    if (record && !checkPermission(record, 'edit')) {
      alert("You do not have permission to edit transcripts in this project.");
      return;
    }
    const setter = activeTab === 'recorded' ? setRecordedQueue : setLiveQueue;
    if (record) {
      const newTranscript = [...record.transcript];
      newTranscript[segIdx] = { ...newTranscript[segIdx], text };
      const updated = { ...record, transcript: newTranscript };
      setter(prev => prev.map(q => q.id === id ? updated : q));
      if (record.status === 'completed') {
        onSave(updated);
      }
    }
  };

  const updateExecutionTracker = (id: string, executionTracker: ExecutionTracker) => {
    const setter = activeTab === 'recorded' ? setRecordedQueue : setLiveQueue;
    const queue = activeTab === 'recorded' ? recordedQueue : liveQueue;
    const record = queue.find(q => q.id === id);

    if (record) {
      const updated = { ...record, executionTracker };
      setter(prev => prev.map(q => q.id === id ? updated : q));
      if (record.status === 'completed') {
        onSave(updated);
      }
    }
  };

  const toggleBookmark = (id: string, segIdx: number) => {
    const record = [...recordedQueue, ...liveQueue].find(r => r.id === id);
    if (record && !checkPermission(record, 'edit')) {
      alert("You do not have permission to bookmark segments in this project.");
      return;
    }

    const setter = activeTab === 'recorded' ? setRecordedQueue : setLiveQueue;
    const queue = activeTab === 'recorded' ? recordedQueue : liveQueue;
    const target = queue.find(q => q.id === id);

    if (target) {
      const seg = target.transcript[segIdx];
      const existingIdx = target.bookmarks.findIndex(b => b.segmentIndex === segIdx);
      let newBookmarks = [...target.bookmarks];
      
      if (existingIdx >= 0) {
        newBookmarks.splice(existingIdx, 1);
      } else {
        const newBookmark: Bookmark = {
          id: Math.random().toString(36).substr(2, 9),
          segmentIndex: segIdx,
          speaker: target.speakerMap[seg.speaker] || seg.speaker,
          text: seg.text,
          timestamp: Date.now(),
          userName: userProfile?.name || 'Guest'
        };
        newBookmarks.push(newBookmark);
      }
      
      const updatedRecord = { ...target, bookmarks: newBookmarks };
      setter(prev => prev.map(q => q.id === id ? updatedRecord : q));
      onSave(updatedRecord); // Persist to history
    }
  };

  const currentQueue = (activeTab === 'recorded' ? recordedQueue : liveQueue).filter(item => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      item.fileName.toLowerCase().includes(term) ||
      item.group.toLowerCase().includes(term) ||
      (item.transcript || []).some(s => s.text.toLowerCase().includes(term)) ||
      (item.summary?.mainTopic?.toLowerCase().includes(term))
    );
  });

  if (subWorkflow === 'selection') {
    return (
      <div className="space-y-6">
        <FirstValueActivation
          authStatus={authStatus}
          userProfile={userProfile}
          usageStats={usageStats}
          onSaveRecord={(rec) => {
            onSave(rec);
            // Also append to recorded queue if needed
            setRecordedQueue(prev => [rec, ...prev.filter(r => r.id !== rec.id)]);
          }}
          onNavigateToHistory={() => {
            if (onNavigateToHistory) {
              onNavigateToHistory();
            } else {
              setSubWorkflow('recorded');
            }
          }}
          onSignInClick={onSignInClick}
          checkThinkingLimit={checkThinkingLimit}
          checkTranscriptionLimit={checkTranscriptionLimit}
          incrementThinkingUsage={incrementThinkingUsage}
          incrementTranscriptionUsage={incrementTranscriptionUsage}
          addNotification={addNotification}
          onRecordSavedCallback={(rec) => {
            setActiveTab('recorded');
          }}
        />

        {/* Secondary options for power users */}
        <div className="pt-6 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p className="font-medium">Need advanced multi-file batch queues or project routing?</p>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setSubWorkflow('recorded')}
              className="px-3.5 py-1.5 bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 font-semibold rounded-lg transition-all cursor-pointer"
            >
              Batch Queue Manager
            </button>
            <button
              onClick={() => authStatus === AuthStatus.GUEST ? setUsageError("Live transcription is not available in Guest Mode. Please create an account to unlock.") : setSubWorkflow('live')}
              className="px-3.5 py-1.5 bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-50 font-semibold rounded-lg transition-all cursor-pointer"
            >
              Live Recording Studio
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in h-full relative">
      <input type="file" multiple={authStatus !== AuthStatus.GUEST} ref={fileInputRef} onChange={handleFileUpload} accept="audio/*" className="hidden" />
      
      {showUsageModal && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-md w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
                <AlertTriangle className="text-amber-500 w-12 h-12" />
              </div>
              <div className="space-y-2">
                <h2 className="text-brand-primary text-[26px] font-medium">
                  {authStatus === AuthStatus.GUEST ? "Guest Preview Limit" : "Usage Limit Reached"}
                </h2>
                <p className="text-slate-500 font-normal">
                  {authStatus === AuthStatus.GUEST 
                    ? "You have reached your Guest Preview limit. Create an account to continue using EchoNote."
                    : "You have reached your monthly transcription limit for the free plan. Usage resets next month."}
                </p>
              </div>
            </div>
            <div className="flex flex-col space-y-3">
              {authStatus === AuthStatus.GUEST && (
                <button 
                  onClick={() => { setShowUsageModal(false); onSignInClick(); }} 
                  className="w-full py-4 bg-brand-primary text-white rounded-lg font-medium tracking-widest text-[11px] shadow-xl shadow-brand-primary/20 active:scale-95 transition-all"
                >
                  Sign up
                </button>
              )}
              <button onClick={() => setShowUsageModal(false)} className="w-full py-4 bg-slate-100 text-slate-600 rounded-lg font-medium tracking-widest text-[11px] active:scale-95 transition-all">Close</button>
            </div>
          </div>
        </div>
      )}

      {usageError && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-md w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-6">
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <AlertTriangle className="text-red-500 w-12 h-12" />
              </div>
              <div className="space-y-2">
                <h2 className="text-brand-primary text-[26px] font-medium">Feature Restricted</h2>
                <p className="text-slate-500 font-normal">
                  {authStatus === AuthStatus.GUEST 
                    ? "This feature is not available in Guest Mode. Please create an account to unlock full access."
                    : usageError}
                </p>
              </div>
            </div>
            <div className="flex flex-col space-y-3">
              <button 
                onClick={() => { setUsageError(null); }} 
                className="w-full py-4 bg-brand-primary text-white rounded-lg font-medium tracking-widest text-[11px] shadow-xl shadow-brand-primary/20 active:scale-95 transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {downloadModal && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-sm w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-2">
              <h2 className="text-brand-primary text-[26px] font-medium">Download Strategy</h2>
              <p className="text-slate-500 text-sm font-normal">Target: {downloadModal.name}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(downloadModal.type === 'transcript' ? ['TXT', 'DOCX', 'PDF'] : ['WAV', 'MP3']).map(fmt => (
                <button key={fmt} onClick={() => setSelectedFormat(fmt)} className={`py-3 rounded-lg text-[11px] font-medium border-2 transition-all ${selectedFormat === fmt ? 'bg-brand-accent text-brand-primary border-brand-accent shadow-sm scale-[1.02]' : 'bg-brand-background text-slate-400 border-brand-divider/30 hover:border-brand-accent'}`}>{fmt}</button>
              ))}
            </div>
            <div className="flex flex-col space-y-3">
              <button onClick={handleDownloadConfirm} disabled={!selectedFormat} className="w-full py-4 bg-brand-primary text-white rounded-lg font-medium tracking-widest text-[11px] disabled:opacity-50 transition-all shadow-xl active:scale-[0.98]">Confirm & start download</button>
              <button onClick={() => setDownloadModal(null)} className="text-[13px] font-medium text-slate-400 text-center hover:text-slate-600 transition-colors">Cancel Request</button>
            </div>
          </div>
        </div>
      )}

      {isFinalizingLive && (
        <div className="fixed inset-0 bg-brand-primary/90 backdrop-blur-xl z-[300] flex flex-col items-center justify-center space-y-8 animate-in fade-in duration-700">
          <div className="relative">
            <div className="w-24 h-24 border-2 border-brand-accent/20 rounded-full"></div>
            <div className="absolute inset-0 w-24 h-24 border-t-2 border-brand-accent rounded-full animate-spin"></div>
            <div className="absolute inset-4 bg-brand-accent/10 rounded-full flex items-center justify-center">
              <i className="fa-solid fa-microchip text-brand-accent text-xl animate-pulse"></i>
            </div>
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-white text-2xl font-medium tracking-tight">Finalizing Intelligence</h2>
            <p className="text-brand-accent/60 text-[11px] font-medium uppercase tracking-[0.2em] animate-pulse">Synthesizing multi-speaker discourse...</p>
          </div>
        </div>
      )}

      {minutesUsage.isExceeded && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-2xl flex items-start gap-3 shadow-sm mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="text-left space-y-1">
            <h4 className="text-sm font-bold tracking-tight">Transcription Limits Exceeded</h4>
            <p className="text-xs text-red-700 font-medium">
              You've exceeded your {usageStats.plan.charAt(0).toUpperCase() + usageStats.plan.slice(1)} Plan limit. Your usage will reset on <span className="font-bold">{formatRefreshDate(userProfile?.nextRefreshDate)}</span>, or you can upgrade at any time.
            </p>
          </div>
        </div>
      )}

      <div 
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-brand-divider/20 pb-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFileUpload(e);
        }}
      >
        <div className="flex items-center space-x-6">
           <button onClick={() => setSubWorkflow('selection')} className="text-[13px] font-medium text-slate-400 flex items-center space-x-2 hover:text-brand-primary transition-colors"><i className="fa-solid fa-chevron-left"></i><span>Back</span></button>
           <div className="flex bg-brand-divider/10 p-1 rounded-lg shadow-inner">
             <button onClick={() => setActiveTab('recorded')} className={`px-4 py-2 rounded-md text-[11px] font-medium uppercase tracking-widest transition-all ${activeTab === 'recorded' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400'}`}>Recorded</button>
             <button onClick={() => setActiveTab('live')} className={`px-4 py-2 rounded-md text-[11px] font-medium uppercase tracking-widest transition-all ${activeTab === 'live' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400'}`}>Live</button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {activeTab === 'recorded' && (
            <ProjectDropdown 
              selected={selectedProject}
              onSelect={setSelectedProject}
              isOpen={isGlobalDropdownOpen}
              setIsOpen={setIsGlobalDropdownOpen}
              disabled={authStatus === AuthStatus.GUEST}
              showLabel={false}
            />
          )}

          {activeTab === 'live' && (
            <div className="flex items-center bg-brand-divider/10 p-1 rounded-lg mr-2">
              <button 
                onClick={() => authStatus !== AuthStatus.GUEST && setLiveLanguage('original')}
                disabled={isRecording || authStatus === AuthStatus.GUEST}
                className={`px-3 py-1.5 rounded-md text-[9px] font-black tracking-widest transition-all ${liveLanguage === 'original' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'} ${isRecording || authStatus === AuthStatus.GUEST ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Original
              </button>
              <button 
                onClick={() => authStatus !== AuthStatus.GUEST && setLiveLanguage('english')}
                disabled={isRecording || authStatus === AuthStatus.GUEST}
                className={`px-3 py-1.5 rounded-md text-[9px] font-black tracking-widest transition-all ${liveLanguage === 'english' ? 'bg-white text-brand-primary shadow-sm' : 'text-slate-400 hover:text-slate-600'} ${isRecording || authStatus === AuthStatus.GUEST ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                English
              </button>
            </div>
          )}
          
          {activeTab === 'live' && (currentQueue.length > 0 || isRecording) && (
            <button 
              onClick={isRecording ? stopRecording : startRecording}
              className={`text-[11px] font-medium uppercase tracking-widest px-6 py-3 rounded-lg transition-all active:scale-95 flex items-center gap-2 shadow-lg ${isRecording ? 'bg-brand-primary text-white animate-pulse' : 'bg-brand-accent text-brand-primary shadow-brand-accent/10'}`}
            >
              <i className={`fa-solid ${isRecording ? 'fa-stop' : 'fa-microphone'}`}></i>
              <span>{isRecording ? "Stop Recording" : "Start Live"}</span>
            </button>
          )}

          {activeTab === 'recorded' && currentQueue.length > 0 && (
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="text-[11px] font-medium uppercase tracking-widest text-brand-primary bg-white border border-brand-divider/30 px-4 py-3 rounded-lg hover:bg-brand-background transition-all active:scale-95 flex items-center gap-2"
            >
              <i className="fa-solid fa-plus"></i>
              <span>Add More Files</span>
            </button>
          )}
          <button 
            onClick={() => fileInputRef.current?.click()} 
            className="text-[11px] font-medium uppercase tracking-widest text-brand-primary bg-brand-accent px-6 py-3 rounded-lg hover:brightness-110 transition-all active:scale-95 shadow-lg shadow-brand-accent/10"
          >
            Upload Audio
          </button>
        </div>
      </div>

      {subWorkflow === 'live' && !isFinalizingLive && currentQueue.length === 0 && (
        <div className="bg-white p-16 rounded-2xl border border-brand-divider/20 text-center space-y-12 animate-in zoom-in-95 duration-500 shadow-xl relative overflow-hidden">
          {/* Hardware Surround Effect */}
          <div className="absolute inset-0 border-[16px] border-brand-background pointer-events-none opacity-50"></div>
          <div className="absolute top-4 left-4 w-2 h-2 rounded-full bg-slate-200"></div>
          <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-slate-200"></div>
          <div className="absolute bottom-4 left-4 w-2 h-2 rounded-full bg-slate-200"></div>
          <div className="absolute bottom-4 right-4 w-2 h-2 rounded-full bg-slate-200"></div>

          <div className="relative z-10 space-y-10">
            <div className="w-32 h-32 bg-brand-primary/5 rounded-full flex items-center justify-center mx-auto relative group">
              <div className={`absolute inset-0 rounded-full border-2 border-dashed transition-all duration-1000 ${isRecording ? 'border-brand-accent animate-[spin_10s_linear_infinite] opacity-40' : 'border-slate-200'}`}></div>
              <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 ${isRecording ? 'bg-brand-accent/10 scale-110 shadow-inner' : 'bg-white shadow-sm'}`}>
                <i className={`fa-solid fa-microphone text-5xl transition-all duration-500 ${isRecording ? 'text-brand-accent' : 'text-slate-300'}`}></i>
              </div>
              {isRecording && (
                <>
                  <div className="absolute -inset-4 border border-brand-accent rounded-full animate-ping opacity-10"></div>
                  <div className="absolute -inset-8 border border-brand-accent rounded-full animate-ping opacity-5 duration-1000"></div>
                </>
              )}
            </div>

            <div className="space-y-4">
              <div className="inline-flex items-center space-x-2 px-3 py-1 bg-brand-background rounded-full border border-brand-divider/10">
                <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`}></div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">{isRecording ? "System Active" : "System Standby"}</span>
              </div>
              <h2 className="text-brand-primary text-3xl font-medium tracking-tight">
                {isRecording ? "Listening to Discourse..." : "Live Voice Capture"}
              </h2>
              <p className="text-slate-400 text-sm max-w-sm mx-auto font-normal">
                {isRecording 
                  ? "Real-time intelligence synthesis is active. Speak clearly for optimal speaker segmentation."
                  : "Initialize the secure capture module to begin real-time transcription and analysis."}
              </p>
            </div>
            
            {!isRecording && (
              <div className="flex flex-col items-center space-y-6">
                <div className="space-y-3">
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">Capture Strategy</label>
                  <div className="flex bg-brand-background p-1 rounded-xl border border-brand-divider/10 shadow-inner">
                    <button 
                      onClick={() => authStatus !== AuthStatus.GUEST && setLiveLanguage('original')}
                      disabled={authStatus === AuthStatus.GUEST}
                      className={`px-6 py-3 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-all ${liveLanguage === 'original' ? 'bg-brand-primary text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'} ${authStatus === AuthStatus.GUEST ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      Original
                    </button>
                    <button 
                      onClick={() => authStatus !== AuthStatus.GUEST && setLiveLanguage('english')}
                      disabled={authStatus === AuthStatus.GUEST}
                      className={`px-6 py-3 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-all ${liveLanguage === 'english' ? 'bg-brand-primary text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'} ${authStatus === AuthStatus.GUEST ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      English
                    </button>
                  </div>
                </div>

                <button 
                  onClick={startRecording}
                  className="px-12 py-5 bg-brand-accent text-brand-primary rounded-xl font-bold uppercase tracking-[0.2em] text-[11px] shadow-xl shadow-brand-accent/20 hover:scale-[1.02] active:scale-95 transition-all"
                >
                  Initialize Module
                </button>
              </div>
            )}
            
            {isRecording && (
              <div className="space-y-6 flex flex-col items-center">
                <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 animate-pulse">
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  <span className="text-[10px] font-bold uppercase tracking-wider">⚠️ Recording may stop if screen is locked or app is in background</span>
                </div>
                <button 
                  onClick={stopRecording}
                  className="px-12 py-5 bg-brand-primary text-white rounded-xl font-bold uppercase tracking-[0.2em] text-[11px] shadow-xl shadow-brand-primary/20 hover:scale-[1.02] active:scale-95 transition-all"
                >
                  Stop Recording
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {subWorkflow === 'recorded' && activeTab === 'recorded' && currentQueue.length === 0 && (
         <div onClick={() => fileInputRef.current?.click()} className="bg-white border-2 border-dashed border-brand-divider/30 rounded-xl p-16 text-center cursor-pointer hover:border-brand-primary transition-all group shadow-sm">
            <div className="w-16 h-16 bg-brand-background rounded-lg flex items-center justify-center mx-auto mb-6 group-hover:bg-brand-primary transition-colors"><i className="fa-solid fa-plus text-slate-400 group-hover:text-white"></i></div>
            <p className="text-lg font-bold text-brand-primary">Import Media Asset</p>
            <p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-2">All audio formats are supported except MP4 format</p>
          </div>
      )}

      {activeTab === 'recorded' && currentQueue.some(q => q.status === 'pending') && (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between border-b border-brand-divider/10 pb-4">
            <div className="space-y-1 text-left">
              <h2 className="text-brand-primary text-xl font-medium">Pending Assets</h2>
              <p className="text-[11px] text-slate-400 font-medium uppercase tracking-widest">Configure individual strategies for each asset below.</p>
            </div>
            <div className="px-4 py-1.5 bg-brand-accent text-white rounded-full text-[11px] font-black uppercase tracking-[0.2em] shadow-lg shadow-brand-accent/20 animate-pulse">
              {currentQueue.filter(q => q.status === 'pending').length} Awaiting
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-4">
            {currentQueue.filter(q => q.status === 'pending').map(item => (
            <div key={item.id} className="bg-white p-8 rounded-xl border border-brand-divider/20 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-8 transition-all hover:shadow-md group">
              <div className="flex items-center space-x-6">
                <div className="w-14 h-14 bg-brand-background rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-brand-primary group-hover:text-white transition-all">
                  <i className="fa-solid fa-file-audio text-xl"></i>
                </div>
                <div className="space-y-1 text-left">
                  <h4 className="text-base font-medium text-brand-primary truncate max-w-[240px]">{item.fileName}</h4>
                  <div className="flex items-center space-x-3">
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">{item.date}</p>
                    <span className="w-1 h-1 bg-slate-200 rounded-full"></span>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">{(item._file?.size / (1024 * 1024)).toFixed(2)} MB</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <div className="space-y-2 text-left">
                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em]">Processing Strategy</label>
                  <div className="flex bg-brand-background p-1 rounded-lg border border-brand-divider/10">
                    <button 
                      onClick={() => authStatus !== AuthStatus.GUEST && setFileStrategies(prev => ({ ...prev, [item.id]: 'original' }))}
                      disabled={authStatus === AuthStatus.GUEST}
                      className={`px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${fileStrategies[item.id] === 'original' ? 'bg-brand-primary text-white shadow-md' : 'text-slate-400 hover:text-slate-600'} ${authStatus === AuthStatus.GUEST ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      Original
                    </button>
                    <button 
                      onClick={() => authStatus !== AuthStatus.GUEST && setFileStrategies(prev => ({ ...prev, [item.id]: 'english' }))}
                      disabled={authStatus === AuthStatus.GUEST}
                      className={`px-4 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${fileStrategies[item.id] === 'english' ? 'bg-brand-primary text-white shadow-md' : 'text-slate-400 hover:text-slate-600'} ${authStatus === AuthStatus.GUEST ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      English
                    </button>
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <button 
                    onClick={() => processSingleRecord(item.id)}
                    disabled={authStatus !== AuthStatus.GUEST && !fileStrategies[item.id]}
                    className={`px-8 py-4 rounded-lg font-bold uppercase tracking-[0.2em] text-[10px] transition-all shadow-lg active:scale-95 ${authStatus !== AuthStatus.GUEST && !fileStrategies[item.id] ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-brand-primary text-white shadow-brand-primary/20 hover:brightness-110'}`}
                  >
                    Initialize Analysis
                  </button>
                  <button 
                    onClick={() => removePendingRecord(item.id)}
                    className="p-4 text-slate-400 hover:text-red-400 transition-colors"
                    title="Remove from queue"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </div>
            </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6 pb-20">
        {currentQueue.map((item) => {
          const isSummaryExpanded = expandedSummaryIds.has(item.id);
          
          return (
            <div key={item.id} className="bg-white rounded-xl p-10 shadow-sm border border-brand-divider/20 animate-in fade-in">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10 pb-8 border-b border-brand-divider/20">
                <div className="space-y-1 text-left">
                      {editingFileName?.id === item.id ? (
                        <div className="flex items-center gap-2">
                          <input 
                            className="text-2xl font-black text-brand-primary tracking-tight bg-brand-background border border-brand-divider/30 rounded-lg px-3 py-1 outline-none focus:ring-2 focus:ring-brand-primary"
                            value={editingFileName.name}
                            onChange={(e) => setEditingFileName({ ...editingFileName, name: e.target.value })}
                            autoFocus
                          />
                          <button onClick={() => {
                            if (!checkPermission(item, 'edit')) {
                              alert("You do not have permission to rename assets.");
                              return;
                            }
                            updateFileName(item.id, editingFileName.name);
                          }} className="text-brand-primary"><i className="fa-solid fa-check"></i></button>
                          <button onClick={() => setEditingFileName(null)} className="text-slate-400"><i className="fa-solid fa-xmark"></i></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <h2 
                            className={`text-brand-primary tracking-tight ${checkPermission(item, 'edit') ? 'cursor-pointer hover:text-brand-accent' : ''}`}
                            onClick={() => {
                              if (checkPermission(item, 'edit')) {
                                setEditingFileName({ id: item.id, name: item.fileName });
                              } else {
                                alert("You do not have permission to rename assets in this project.");
                              }
                            }}
                          >
                            {item.fileName}
                          </h2>
                        </div>
                      )}
                    <div className="flex flex-col">
                      <ProjectDropdown 
                        selected={item.group}
                        onSelect={(name) => handleGroupChange(item.id, name)}
                        isOpen={activeDropdownId === item.id}
                        setIsOpen={(open) => setActiveDropdownId(open ? item.id : null)}
                        disabled={authStatus === AuthStatus.GUEST || !checkPermission(item, 'edit')}
                      />
                    </div>

                    <div className="flex flex-col">
                      <label className="text-xs text-gray-500 mb-1 block">
                        Status
                      </label>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${item.status === 'completed' ? 'text-emerald-600' : item.status === 'error' ? 'text-red-500' : 'text-brand-primary'}`}>
                          {item.status}
                        </span>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            const setter = activeTab === 'recorded' ? setRecordedQueue : setLiveQueue;
                            setter(prev => prev.map(q => q.id === item.id ? { ...q, readStatus: q.readStatus === 'read' ? 'not-read' : 'read' } : q));
                          }}
                          className={`px-3 py-1 text-xs rounded-full transition-all ${item.readStatus === 'read' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-600 font-semibold'}`}
                        >
                          {item.readStatus === 'read' ? 'Read' : 'Not read'}
                        </button>
                      </div>
                    </div>
                  </div>
                  {item.collaborators && item.collaborators.length > 0 && (
                    <div className="flex flex-col">
                      <label className="text-[8px] font-black text-slate-400 mb-1 ml-1 uppercase tracking-widest">Team</label>
                      <div className="flex -space-x-1.5">
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
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-3">
                  {item.status === 'completed' && item.originalAudioUrl && (
                    <>
                      <button 
                        onClick={() => handlePlayContent(item)} 
                        className={`px-6 py-3 rounded-lg font-black text-[10px] transition-all shadow-md ${activePlaybackId === item.id && activePlaybackSegIdx === undefined && playbackStatus === 'playing' ? 'bg-brand-secondary text-[#0F172A]' : 'bg-brand-primary text-white shadow-brand-primary/10'}`}
                      >
                        <i className={`fa-solid ${activePlaybackId === item.id && activePlaybackSegIdx === undefined && playbackStatus === 'playing' ? 'fa-pause' : 'fa-play'} mr-2`}></i>
                        Play content
                      </button>
                      <div className="flex gap-2">
                        <button onClick={() => triggerDownload(item.id, item.fileName, item.originalAudioUrl!, 'audio')} className="p-3 rounded-lg bg-brand-background text-brand-primary hover:bg-brand-primary hover:text-[#0F172A] transition-all shadow-sm" title="Download Audio Asset"><i className="fa-solid fa-file-audio"></i></button>
                        <button onClick={() => triggerDownload(item.id, item.fileName, '', 'transcript')} className="p-3 rounded-lg bg-brand-background text-brand-primary hover:bg-brand-primary hover:text-[#0F172A] transition-all shadow-sm" title="Download Transcript Intelligence"><i className="fa-solid fa-file-lines"></i></button>
                        {authStatus === AuthStatus.LOGGED_IN && (() => {
                          const project = projects.find(p => p.name === item.group);
                          const isOwner = project?.ownerEmail === userProfile?.email;
                          const canManage = usageStats.mode !== 'guest' && isOwner;
                          if (!canManage) return null;
                          return (
                            <button 
                              onClick={() => setProjectToManage(project || null)}
                              className="p-3 rounded-lg bg-brand-background text-brand-primary hover:bg-brand-primary hover:text-[#0F172A] transition-all shadow-sm" 
                              title="Manage Collaboration"
                            >
                              <i className="fa-solid fa-user-plus"></i>
                            </button>
                          );
                        })()}
                      </div>
                    </>
                  )}
                </div>

              {item.status === 'completed' && (
                <div className="space-y-12">
                  {/* Call Summary Section */}
                  {item.summary && (
                    <div className={`bg-brand-background rounded-xl border border-brand-divider/20 overflow-hidden transition-all shadow-sm ${authStatus === AuthStatus.GUEST ? 'opacity-75 grayscale-[0.5]' : ''}`}>
                      <div 
                        onClick={() => authStatus !== AuthStatus.GUEST && toggleSummary(item.id)}
                        className={`w-full flex items-center justify-between p-6 transition-colors ${authStatus === AuthStatus.GUEST ? 'cursor-not-allowed' : 'hover:bg-brand-divider/5 cursor-pointer'}`}
                        title={authStatus === AuthStatus.GUEST ? "Summary locked in guest mode" : ""}
                      >
                        <div className="flex items-center space-x-4">
                          <div className="w-12 h-12 bg-brand-accent/10 border border-brand-accent/20 rounded-lg flex items-center justify-center text-brand-primary shadow-sm">
                            <i className="fa-solid fa-list-check text-lg"></i>
                          </div>
                          <div className="text-left">
                            <h4 className="text-sm font-black text-brand-primary tracking-tight">Call summary</h4>
                            <p className="text-[10px] text-brand-primary/60 font-black tracking-widest font-mono">AI generated intelligence</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-4">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (authStatus === AuthStatus.GUEST) {
                                addNotification({ title: 'Plan Limitation', message: 'Collaboration features are available in Pro and Enterprise plans.', type: 'error' });
                                return;
                              }
                              const project = projects.find(p => p.name === item.group);
                              if (project) {
                                setProjectToManage(project);
                              } else {
                                addNotification('Project not found', 'error');
                              }
                            }}
                            className={`transition-colors text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg ${authStatus === AuthStatus.GUEST ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-brand-primary hover:bg-brand-divider/10'}`}
                            title={authStatus === AuthStatus.GUEST ? "Invite locked in guest mode" : "Invite to Project"}
                            disabled={authStatus === AuthStatus.GUEST}
                          >
                            <i className="fa-solid fa-user-plus"></i>
                            <span className="text-[10px] font-bold uppercase tracking-widest">Invite</span>
                          </button>
                          <i className={`fa-solid fa-chevron-down transition-transform duration-300 ${isSummaryExpanded && authStatus !== AuthStatus.GUEST ? 'rotate-180' : ''}`}></i>
                        </div>
                      </div>
                      
                      {isSummaryExpanded && authStatus !== AuthStatus.GUEST && (
                        <div className="px-6 pb-8 animate-in slide-in-from-top-4 duration-500 space-y-8">
                          <div className="pt-4 border-t border-brand-divider/20">
                             <div className="flex items-start space-x-4">
                               <div className="w-5 h-5 mt-1 shrink-0 flex items-center justify-center text-brand-accent"><i className="fa-solid fa-quote-left text-xs"></i></div>
                               <div className="space-y-1 text-left">
                                 <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono">Main topic</span>
                                 <p className="text-slate-800 font-bold leading-relaxed">{item.summary.mainTopic}</p>
                               </div>
                             </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
                            {/* Key Points */}
                            <div className="space-y-3">
                              <div className="flex items-center space-x-2">
                                <i className="fa-solid fa-list-ul text-brand-primary text-[10px]"></i>
                                <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono">Key points</span>
                              </div>
                              <ul className="space-y-2">
                                {(item.summary?.keyPoints || []).map((p, idx) => (
                                  <li key={idx} className="flex items-start space-x-2 text-xs font-medium text-slate-600 leading-relaxed">
                                    <span className="text-brand-accent mt-1.5">•</span>
                                    <span>{p}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            {/* Decisions */}
                            <div className="space-y-3">
                              <div className="flex items-center space-x-2">
                                <i className="fa-solid fa-check-double text-emerald-600 text-[10px]"></i>
                                <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono">Decisions</span>
                              </div>
                              <ul className="space-y-2">
                                {(item.summary?.decisions || []).length > 0 ? (item.summary?.decisions || []).map((d, idx) => (
                                  <li key={idx} className="flex items-start space-x-2 text-xs font-medium text-slate-600 leading-relaxed">
                                    <span className="text-emerald-600 mt-1.5"><i className="fa-solid fa-check"></i></span>
                                    <span>{d}</span>
                                  </li>
                                )) : <p className="text-[10px] font-medium text-slate-400 italic">No formal decisions recorded.</p>}
                              </ul>
                            </div>

                            {/* Action Items */}
                            <div className="space-y-3">
                              <div className="flex items-center space-x-2">
                                <i className="fa-solid fa-clipboard-list text-brand-primary text-[10px]"></i>
                                <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono">Action items</span>
                              </div>
                              <ul className="space-y-2">
                                {(item.summary?.actionItems || []).length > 0 ? (item.summary?.actionItems || []).map((a, idx) => (
                                  <li key={idx} className="flex items-start space-x-2 text-xs font-medium text-slate-600 leading-relaxed">
                                    <span className="text-brand-accent mt-1.5"><i className="fa-solid fa-circle-dot"></i></span>
                                    <span>{a}</span>
                                  </li>
                                )) : <p className="text-[10px] font-medium text-slate-400 italic">No action items identified.</p>}
                              </ul>
                            </div>
                          </div>

                          {/* Collaborator Status */}
                          {item.collaborators && item.collaborators.length > 0 && (
                            <div className="pt-8 border-t border-brand-divider/10">
                              <div className="flex items-center space-x-2 mb-4">
                                <i className="fa-solid fa-users text-brand-primary text-[10px]"></i>
                                <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase">Collaborator Engagement</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {item.collaborators.map((c, idx) => (
                                  <div key={idx} className="flex items-center justify-between p-3 bg-brand-background rounded-lg border border-brand-divider/10">
                                    <div className="flex items-center space-x-3">
                                      <div className="w-8 h-8 rounded-full bg-brand-primary/5 flex items-center justify-center text-[10px] font-bold text-brand-primary">
                                        {(c.email?.charAt(0) || 'U').toUpperCase()}
                                      </div>
                                      <span className="text-xs font-medium text-slate-600 truncate max-w-[120px]" title={c.email}>{c.email}</span>
                                    </div>
                                    <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${
                                      c.status === 'read' ? 'bg-emerald-100 text-emerald-700' :
                                      c.status === 'in-progress' ? 'bg-amber-100 text-amber-700' :
                                      'bg-slate-100 text-slate-500'
                                    }`}>
                                      {c.status.replace('-', ' ')}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Strategic Analysis Section */}
                  <div className={`bg-brand-background rounded-xl border border-brand-divider/20 overflow-hidden transition-all shadow-sm ${authStatus === AuthStatus.GUEST ? 'opacity-75 grayscale-[0.5]' : ''}`}>
                    <div 
                      onClick={() => {
                        if (isGuest) {
                          setUsageError("AI Strategic Analysis is not available in Guest Mode. Please sign up to unlock full intelligence.");
                          return;
                        }
                        if (item.strategicAnalysis) toggleStrategicAnalysis(item.id);
                      }}
                      className={`w-full flex items-center justify-between p-6 transition-colors ${isGuest ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-divider/5 cursor-pointer'}`}
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 shadow-sm">
                          <i className="fa-solid fa-brain text-lg"></i>
                        </div>
                        <div className="text-left">
                          <h4 className="text-sm font-black text-brand-primary tracking-tight">Strategic Thinking Partner</h4>
                          <p className="text-[10px] text-brand-primary/60 font-black tracking-widest font-mono">Deep analysis & blindspot detection</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        {!item.strategicAnalysis && item.status === 'completed' && (
                          <button 
                            disabled={isGuest}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isGuest) {
                                setUsageError("AI Strategic Analysis is not available in Guest Mode. Please sign up to unlock full intelligence.");
                                return;
                              }
                              runStrategicAnalysis(item.id);
                            }}
                            className={`px-4 py-2 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-indigo-700 transition-colors shadow-md ${isGuest ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            Run Analysis
                          </button>
                        )}
                        {item.strategicAnalysis && (
                          <i className={`fa-solid fa-chevron-down transition-transform duration-300 ${expandedStrategicAnalysisIds.has(item.id) && authStatus !== AuthStatus.GUEST ? 'rotate-180' : ''}`}></i>
                        )}
                      </div>
                    </div>

                    {expandedStrategicAnalysisIds.has(item.id) && item.strategicAnalysis && authStatus !== AuthStatus.GUEST && (
                      <div className="px-6 pb-8 animate-in slide-in-from-top-4 duration-500 space-y-8">
                        <div className="pt-4 border-t border-brand-divider/20 grid grid-cols-1 md:grid-cols-2 gap-8">
                          {/* Core Intent */}
                          <div className="space-y-3 text-left">
                            <div className="flex items-center space-x-2">
                              <i className="fa-solid fa-bullseye text-indigo-600 text-[10px]"></i>
                              <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase">Core Intent</span>
                            </div>
                            <p className="text-slate-800 text-sm font-medium leading-relaxed">{item.strategicAnalysis.coreIntent}</p>
                          </div>

                          {/* Context */}
                          <div className="space-y-3 text-left">
                            <div className="flex items-center space-x-2">
                              <i className="fa-solid fa-compass text-indigo-600 text-[10px]"></i>
                              <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase">Context</span>
                            </div>
                            <p className="text-slate-800 text-sm font-medium leading-relaxed">{item.strategicAnalysis.context}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
                          {/* Assumptions */}
                          <div className="space-y-3">
                            <div className="flex items-center space-x-2">
                              <i className="fa-solid fa-layer-group text-amber-600 text-[10px]"></i>
                              <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase">Assumptions</span>
                            </div>
                            <ul className="space-y-2">
                              {item.strategicAnalysis.assumptions.map((a, idx) => (
                                <li key={idx} className="flex items-start space-x-2 text-xs font-medium text-slate-600 leading-relaxed">
                                  <span className="text-amber-600 mt-1.5">•</span>
                                  <span>{a}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Logical Gaps */}
                          <div className="space-y-3">
                            <div className="flex items-center space-x-2">
                              <i className="fa-solid fa-magnifying-glass-chart text-red-600 text-[10px]"></i>
                              <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase">Logical Gaps</span>
                            </div>
                            <ul className="space-y-2">
                              {item.strategicAnalysis.logicalGaps.map((g, idx) => (
                                <li key={idx} className="flex items-start space-x-2 text-xs font-medium text-slate-600 leading-relaxed">
                                  <span className="text-red-600 mt-1.5">•</span>
                                  <span>{g}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Blind Spots */}
                          <div className="space-y-3">
                            <div className="flex items-center space-x-2">
                              <i className="fa-solid fa-eye-slash text-purple-600 text-[10px]"></i>
                              <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase">Blind Spots</span>
                            </div>
                            <ul className="space-y-2">
                              {item.strategicAnalysis.blindSpots.map((b, idx) => (
                                <li key={idx} className="flex items-start space-x-2 text-xs font-medium text-slate-600 leading-relaxed">
                                  <span className="text-purple-600 mt-1.5">•</span>
                                  <span>{b}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                          {/* Strategic Questions */}
                          <div className="space-y-3">
                            <div className="flex items-center space-x-2">
                              <i className="fa-solid fa-question text-indigo-600 text-[10px]"></i>
                              <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase">Strategic Questions</span>
                            </div>
                            <ul className="space-y-2">
                              {item.strategicAnalysis.strategicQuestions.map((q, idx) => (
                                <li key={idx} className="flex items-start space-x-2 text-xs font-bold text-indigo-700 leading-relaxed italic">
                                  <span className="mt-1.5">?</span>
                                  <span>{q}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Recommendations */}
                          <div className="space-y-3">
                            <div className="flex items-center space-x-2">
                              <i className="fa-solid fa-lightbulb text-emerald-600 text-[10px]"></i>
                              <span className="text-[10px] font-black text-slate-400 tracking-widest font-mono uppercase">Recommendations</span>
                            </div>
                            <ul className="space-y-2">
                              {item.strategicAnalysis.recommendations.map((r, idx) => (
                                <li key={idx} className="flex items-start space-x-2 text-xs font-medium text-slate-600 leading-relaxed">
                                  <span className="text-emerald-600 mt-1.5"><i className="fa-solid fa-arrow-right"></i></span>
                                  <span>{r}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Unresolved Topics Detector */}
                          <UnresolvedTopicsDetector unresolvedTopics={item.strategicAnalysis.unresolvedTopics} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Meeting Intelligence Section */}
                  <div className={`bg-brand-background rounded-xl border border-brand-divider/20 overflow-hidden transition-all shadow-sm ${isGuest ? 'opacity-75 grayscale-[0.5] cursor-not-allowed' : ''}`}>
                    <div 
                      onClick={() => {
                        if (isGuest) {
                          setUsageError("Meeting Intelligence is not available in Guest Mode. Please sign up to unlock full intelligence.");
                          return;
                        }
                        if (item.meetingIntelligence) toggleMeetingIntelligence(item.id);
                      }}
                      className={`w-full flex items-center justify-between p-6 transition-colors ${isGuest ? 'cursor-not-allowed' : 'hover:bg-brand-divider/5 cursor-pointer'}`}
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 shadow-sm">
                          <i className="fa-solid fa-chart-line text-lg"></i>
                        </div>
                        <div className="text-left">
                          <h4 className="text-sm font-black text-brand-primary tracking-tight">Meeting Intelligence Score</h4>
                          <p className="text-[10px] text-brand-primary/60 font-black tracking-widest font-mono">Productivity, Clarity & Actionability</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        {!item.meetingIntelligence && item.status === 'completed' && (
                          <button 
                            disabled={isGuest}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isGuest) {
                                setUsageError("Meeting Intelligence is not available in Guest Mode. Please sign up to unlock full intelligence.");
                                return;
                              }
                              runMeetingIntelligence(item.id);
                            }}
                            className={`px-4 py-2 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-emerald-700 transition-colors shadow-md ${isGuest ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            Run Intelligence
                          </button>
                        )}
                        {item.meetingIntelligence && (
                          <i className={`fa-solid fa-chevron-down transition-transform duration-300 ${expandedIntelligenceIds.has(item.id) && authStatus !== AuthStatus.GUEST ? 'rotate-180' : ''}`}></i>
                        )}
                      </div>
                    </div>

                    {expandedIntelligenceIds.has(item.id) && item.meetingIntelligence && authStatus !== AuthStatus.GUEST && (
                      <div className="px-6 pb-8 animate-in slide-in-from-top-4 duration-500">
                        <div className="pt-4 border-t border-brand-divider/20">
                          <MeetingIntelligenceView intelligence={item.meetingIntelligence} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Execution Tracker Section */}
                  <div className={`mb-12 bg-white border border-brand-divider/20 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 ${isGuest ? 'opacity-50 grayscale-[0.5] cursor-not-allowed' : ''}`}>
                    <div 
                      className={`p-6 flex items-center justify-between transition-colors ${isGuest ? 'cursor-not-allowed' : 'hover:bg-slate-50/50 cursor-pointer'}`}
                      onClick={() => {
                        if (isGuest) {
                          setUsageError("Execution Tracking is not available in Guest Mode. Please sign up to unlock full intelligence.");
                          return;
                        }
                        if (item.executionTracker) toggleExecutionTracker(item.id);
                      }}
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-center text-blue-600 shadow-sm">
                          <i className="fa-solid fa-list-check text-lg"></i>
                        </div>
                        <div className="text-left">
                          <h4 className="text-sm font-black text-brand-primary tracking-tight">Execution Tracker</h4>
                          <p className="text-[10px] text-brand-primary/60 font-black tracking-widest font-mono">Task Metrics & Completion Insights</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        {!item.executionTracker && item.status === 'completed' && (
                          <button 
                            disabled={isGuest}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isGuest) {
                                setUsageError("Execution Tracking is not available in Guest Mode. Please sign up to unlock full intelligence.");
                                return;
                              }
                              runMeetingIntelligence(item.id);
                            }}
                            className={`px-4 py-2 bg-blue-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-blue-700 transition-colors shadow-md ${isGuest ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            Track Execution
                          </button>
                        )}
                        {item.executionTracker && (
                          <i className={`fa-solid fa-chevron-down transition-transform duration-300 ${expandedExecutionTrackerIds.has(item.id) && authStatus !== AuthStatus.GUEST ? 'rotate-180' : ''}`}></i>
                        )}
                      </div>
                    </div>

                    {expandedExecutionTrackerIds.has(item.id) && item.executionTracker && authStatus !== AuthStatus.GUEST && (
                      <div className="px-6 pb-8 animate-in slide-in-from-top-4 duration-500">
                        <div className="pt-4 border-t border-brand-divider/20">
                          <ExecutionTrackerView 
                            tracker={item.executionTracker} 
                            onChangeTracker={(updatedTracker) => updateExecutionTracker(item.id, updatedTracker)}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Smart Reminder System Section */}
                  <div className={`mb-12 bg-white border border-brand-divider/20 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 ${isGuest ? 'opacity-50 grayscale-[0.5] cursor-not-allowed' : ''}`}>
                    <div 
                      className={`p-6 flex items-center justify-between transition-colors ${isGuest ? 'cursor-not-allowed' : 'hover:bg-slate-50/50 cursor-pointer'}`}
                      onClick={() => {
                        if (isGuest) {
                          setUsageError("Smart Reminders are not available in Guest Mode. Please sign up to unlock full intelligence.");
                          return;
                        }
                        if (item.calendarReminders) toggleSmartReminders(item.id);
                      }}
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-rose-50 border border-rose-100 rounded-lg flex items-center justify-center text-rose-600 shadow-sm">
                          <i className="fa-solid fa-bell text-lg"></i>
                        </div>
                        <div className="text-left">
                          <h4 className="text-sm font-black text-brand-primary tracking-tight">Smart Reminder System</h4>
                          <p className="text-[10px] text-brand-primary/60 font-black tracking-widest font-mono">Google Calendar Sync & Follow-ups</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        {!item.calendarReminders && item.status === 'completed' && (
                          <button 
                            disabled={isGuest}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isGuest) {
                                setUsageError("Smart Reminders are not available in Guest Mode. Please sign up to unlock full intelligence.");
                                return;
                              }
                              runMeetingIntelligence(item.id);
                            }}
                            className={`px-4 py-2 bg-rose-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg hover:bg-rose-700 transition-colors shadow-md ${isGuest ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            Generate Reminders
                          </button>
                        )}
                        {item.calendarReminders && (
                          <i className={`fa-solid fa-chevron-down transition-transform duration-300 ${expandedSmartReminderIds.has(item.id) && authStatus !== AuthStatus.GUEST ? 'rotate-180' : ''}`}></i>
                        )}
                      </div>
                    </div>

                    {expandedSmartReminderIds.has(item.id) && item.calendarReminders && authStatus !== AuthStatus.GUEST && (
                      <div className="px-6 pb-8 animate-in slide-in-from-top-4 duration-500">
                        <div className="pt-4 border-t border-brand-divider/20">
                          <SmartReminderView reminders={item.calendarReminders} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
                    <div className="lg:col-span-3 space-y-6">
                      <div className="max-h-[600px] overflow-y-auto pr-4 custom-scrollbar space-y-4">
                        {(item.transcript || []).map((seg, sIdx) => (
                          <div key={sIdx} className={`p-6 rounded-xl border transition-all hover:border-brand-accent/30 ${activePlaybackId === item.id && activePlaybackSegIdx === sIdx && playbackStatus === 'playing' ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-400' : 'bg-brand-background border-brand-divider/20 shadow-sm'}`}>
                            <div className="flex justify-between items-start mb-4">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono">{item.speakerMap[seg.speaker] || seg.speaker}</span>
                              <div className="flex space-x-2">
                                {authStatus !== AuthStatus.GUEST && (
                                  <button 
                                    onClick={() => toggleBookmark(item.id, sIdx)}
                                    className={`w-8 h-8 rounded-md bg-white shadow-sm flex items-center justify-center transition-all ${(item.bookmarks || []).some(b => b.segmentIndex === sIdx) ? 'text-brand-accent' : 'text-slate-300 hover:text-brand-accent'}`}
                                    title={(item.bookmarks || []).some(b => b.segmentIndex === sIdx) ? `Bookmarked by ${(item.bookmarks || []).find(b => b.segmentIndex === sIdx)?.userName || 'Guest'}` : 'Bookmark Segment'}
                                  >
                                    <i className={`fa-${(item.bookmarks || []).some(b => b.segmentIndex === sIdx) ? 'solid' : 'regular'} fa-bookmark text-[10px]`}></i>
                                  </button>
                                )}
                                <button 
                                  onClick={() => handlePlaySegment(item, seg, sIdx)} 
                                  className="w-8 h-8 rounded-md bg-white shadow-sm flex items-center justify-center text-brand-primary hover:bg-brand-accent hover:text-brand-primary transition-all"
                                >
                                  <i className={`fa-solid ${activePlaybackId === item.id && activePlaybackSegIdx === sIdx && playbackStatus === 'playing' ? 'fa-pause' : 'fa-play'} text-[10px]`}></i>
                                </button>
                              </div>
                            </div>
                            <textarea 
                              className={`w-full bg-transparent border-none focus:ring-0 p-0 text-base font-medium leading-relaxed resize-none overflow-hidden text-left ${activePlaybackId === item.id && activePlaybackSegIdx === sIdx && playbackStatus === 'playing' ? 'text-amber-900' : 'text-slate-800'} ${!checkPermission(item, 'edit') ? 'cursor-not-allowed opacity-80' : ''}`}
                              value={seg.text}
                              onChange={(e) => updateTranscriptText(item.id, sIdx, e.target.value)}
                              readOnly={!checkPermission(item, 'edit')}
                              rows={Math.max(1, Math.ceil(seg.text.length / 80))}
                              spellCheck={false}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-8">
                      <div className={`bg-gray-50 p-6 rounded-3xl border border-gray-100 shadow-inner relative ${authStatus === AuthStatus.GUEST ? 'opacity-75' : ''}`}>
                        {authStatus === AuthStatus.GUEST && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/40 backdrop-blur-[1px] rounded-3xl cursor-not-allowed">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Locked</span>
                          </div>
                        )}
                        <h4 className="text-[10px] font-black text-slate-500 mb-6 tracking-widest">Identities</h4>
                        <div className="space-y-4">
                          {Array.from(new Set((item.transcript || []).map(s => s.speaker))).map((label: string) => (
                            <div key={label} className="space-y-1">
                              <label className="text-[9px] font-bold text-slate-400">{label}</label>
                              <input 
                                className={`w-full bg-white border border-gray-100 rounded-xl px-3 py-2 text-xs text-slate-900 focus:ring-1 focus:ring-brand-primary outline-none transition-all ${!checkPermission(item, 'edit') ? 'bg-slate-50 cursor-not-allowed text-slate-400' : ''}`}
                                placeholder="Assign name..." 
                                value={item.speakerMap?.[label] || ''} 
                                onChange={(e) => {
                                  if (!checkPermission(item, 'edit')) {
                                    addNotification("You do not have permission to update identities.", 'error');
                                    return;
                                  }
                                  updateSpeaker(item.id, label, e.target.value);
                                }} 
                                readOnly={!checkPermission(item, 'edit')}
                                title={!checkPermission(item, 'edit') ? "You do not have permission to edit this asset" : "Enter speaker name"}
                                autoComplete="off"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {item.status === 'processing' && (
                 <div className="flex flex-col items-center justify-center py-20 space-y-6">
                    <div className="w-12 h-12 border-4 border-echo-brand border-t-transparent rounded-full animate-spin"></div>
                    <div className="text-center space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-echo-brand animate-pulse">{item.processingStep || "De-coding Intelligence Stream..."}</p>
                      <p className="text-[9px] text-slate-400 font-medium">Please do not refresh. System is analyzing media patterns.</p>
                    </div>
                 </div>
              )}

              {item.status === 'error' && (
                <div className="p-10 bg-red-50 rounded-4xl border border-red-100 flex flex-col items-center justify-center space-y-4 text-center">
                   <i className="fa-solid fa-circle-exclamation text-3xl text-red-500"></i>
                   <div className="space-y-1">
                      <p className="text-sm font-black text-red-900 uppercase tracking-widest">Intelligence Error</p>
                      <p className="text-xs text-red-700 font-medium max-w-md">{item.errorMessage || "Critical system failure during analysis. Please retry upload."}</p>
                   </div>
                   <button 
                     onClick={() => {
                       if (activeTab === 'recorded') {
                         setRecordedQueue(prev => prev.filter(q => q.id !== item.id));
                       } else {
                         setLiveQueue(prev => prev.filter(q => q.id !== item.id));
                       }
                     }}
                     className="text-[10px] font-black uppercase tracking-widest text-red-500 hover:underline"
                   >
                     Clear Error Asset
                   </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* AI Module Selection Modal */}
      {moduleSelectionModal && (
        <div className="fixed inset-0 bg-brand-primary/80 backdrop-blur-md z-[500] flex items-center justify-center p-6 text-left">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-xl font-bold text-brand-primary">AI Insights Selection</h2>
                <p className="text-sm text-slate-500">Select which AI modules you want to run for this transcription.</p>
              </div>
              <div className="w-12 h-12 bg-brand-background text-brand-primary rounded-xl flex items-center justify-center text-xl">
                <i className="fa-solid fa-microchip"></i>
              </div>
            </div>

            <div className="space-y-3">
              {[
                { id: 'summary', name: 'Executive Summary', icon: 'fa-align-left', desc: 'Concise overview of the key points.' },
                { id: 'strategy', name: 'Strategic Thinking Partner', icon: 'fa-brain', desc: 'Deep strategic analysis and insights.', restricted: true },
                { id: 'meeting', name: 'Meeting Intelligence', icon: 'fa-handshake', desc: 'Detailed meeting notes and context.', restricted: true },
                { id: 'execution', name: 'Execution Tracker', icon: 'fa-list-check', desc: 'Action items and deliverables.', restricted: true },
                { id: 'reminders', name: 'Calendar Reminders', icon: 'fa-calendar-day', desc: 'Important dates and follow-ups.', restricted: true }
              ].map(module => (
                <label 
                  key={module.id}
                  className={`flex items-start p-4 rounded-xl border-2 transition-all ${
                    isGuest && module.restricted
                      ? 'opacity-50 cursor-not-allowed border-slate-100 bg-slate-50'
                      : selectedModules.includes(module.id) 
                        ? 'border-brand-primary bg-brand-background cursor-pointer' 
                        : 'border-slate-100 hover:border-brand-divider/20 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center h-5 mt-0.5">
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-brand-primary border-slate-300 rounded focus:ring-brand-primary disabled:opacity-50"
                      checked={selectedModules.includes(module.id)}
                      disabled={isGuest && module.restricted}
                      onChange={() => {
                        if (isGuest && module.restricted) return;
                        setSelectedModules(prev => 
                          prev.includes(module.id) 
                            ? prev.filter(id => id !== module.id) 
                            : [...prev, module.id]
                        );
                      }}
                    />
                  </div>
                  <div className="ml-4 flex-1">
                    <div className="flex items-center space-x-2">
                      <i className={`fa-solid ${module.icon} text-brand-primary text-sm`}></i>
                      <span className="text-sm font-bold text-brand-primary">{module.name}</span>
                      {isGuest && module.restricted && (
                        <span className="text-[8px] font-black bg-brand-primary text-white px-1.5 py-0.5 rounded uppercase tracking-widest ml-auto">Pro</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{module.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className="pt-4 flex flex-col space-y-3">
              <button 
                onClick={handleModuleSelectionConfirm}
                className="w-full py-4 bg-brand-primary text-white rounded-xl font-bold tracking-widest text-[13px] shadow-xl active:scale-95 transition-all flex items-center justify-center space-x-2"
              >
                <span>RUN SELECTED MODULES</span>
                <i className="fa-solid fa-play text-[10px]"></i>
              </button>
              <button 
                onClick={() => {
                  setSelectedModules([]);
                  handleModuleSelectionConfirm();
                }}
                className="text-[12px] font-bold text-slate-400 text-center hover:text-brand-primary transition-colors"
              >
                SKIP AI INSIGHTS (TRANSCRIPT ONLY)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collaboration Settings Modal */}
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
                        <p className="text-sm font-bold text-slate-900">{projectToManage.ownerEmail}</p>
                        <p className="text-[10px] text-slate-500">Project Owner</p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-brand-primary/10 text-brand-primary text-[10px] font-bold rounded uppercase tracking-widest">Owner</span>
                  </div>

                  {projectToManage.members && (projectToManage.members || []).map((member, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-slate-200 text-slate-500 rounded-full flex items-center justify-center text-[10px] font-bold">
                          {(member.email?.charAt(0) || 'U').toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{member.email}</p>
                          <p className="text-[10px] text-slate-500">{member.status === 'read' ? 'Active' : 'Pending invite'}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <select 
                          className="bg-transparent text-[10px] font-bold text-slate-500 uppercase tracking-widest outline-none cursor-pointer"
                          value={member.role}
                          onChange={(e) => onInviteToProject(projectToManage.name, member.email, e.target.value as CollaborationRole)}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="owner">Owner</option>
                        </select>
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
                const canInvite = isOwner || (usageStats.mode !== 'guest' && isEditor) || isDefaultAdmin;

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
                            onInviteToProject(projectToManage.name, inviteEmail.trim(), inviteRole);
                            setInviteEmail('');
                            const members = projectToManage.members || [];
                            setProjectToManage({
                              ...projectToManage,
                              members: [...members, { email: inviteEmail.trim(), role: inviteRole, status: 'not-read' }]
                            });
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
    </div>
  );
};

export default AudioToTextView;