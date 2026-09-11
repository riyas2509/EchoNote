import React, { useState, useRef, useEffect } from 'react';
import { 
  Mic, Upload, Sparkles, CheckCircle2, ArrowRight, Brain, 
  Search, ShieldCheck, Clock, User, AlertTriangle, HelpCircle,
  FileAudio, Play, Pause, RotateCcw, Database, ExternalLink,
  ChevronRight, RefreshCw, Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AudioToTextRecord, 
  TranscriptSegment, 
  AuthStatus, 
  UserProfile, 
  UsageStats,
  CallSummary,
  UnifiedMeetingIntelligence
} from '../types';
import { transcribeAudio, processUnifiedMeetingIntelligence } from '../services/geminiService';
import { 
  trackActivationEvent, 
  markFirstValueCompleted 
} from '../services/activationTracker';
import { getMinutesUsage } from '../lib/usageUtils';

interface FirstValueActivationProps {
  authStatus: AuthStatus;
  userProfile?: UserProfile;
  usageStats: UsageStats;
  onSaveRecord: (record: AudioToTextRecord) => void;
  onNavigateToHistory: () => void;
  onSignInClick: () => void;
  checkThinkingLimit: () => boolean;
  checkTranscriptionLimit: (minutes: number) => boolean;
  incrementThinkingUsage: () => Promise<void>;
  incrementTranscriptionUsage: (minutes: number) => Promise<void>;
  addNotification: (notif: any) => void;
  onRecordSavedCallback?: (record: AudioToTextRecord) => void;
}

type ActivationStage = 'ready' | 'processing' | 'decision_view' | 'retrieval_view';

export const FirstValueActivation: React.FC<FirstValueActivationProps> = ({
  authStatus,
  userProfile,
  usageStats,
  onSaveRecord,
  onNavigateToHistory,
  onSignInClick,
  checkThinkingLimit,
  checkTranscriptionLimit,
  incrementThinkingUsage,
  incrementTranscriptionUsage,
  addNotification,
  onRecordSavedCallback
}) => {
  const [stage, setStage] = useState<ActivationStage>('ready');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Completed record
  const [completedRecord, setCompletedRecord] = useState<AudioToTextRecord | null>(null);
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  
  // Retrieval search state
  const [retrievalQuery, setRetrievalQuery] = useState('');
  const [retrievalResults, setRetrievalResults] = useState<Array<{
    type: 'decision' | 'action' | 'risk' | 'topic';
    title: string;
    detail: string;
    owner?: string;
    matchSnippet?: string;
  }>>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);

  // Track initial arrival
  useEffect(() => {
    trackActivationEvent({
      eventName: 'FIRST_APP_ENTRY',
      authStatus,
      userId: userProfile?.uid,
      userEmail: userProfile?.email,
      plan: usageStats.plan,
      source: 'onboarding'
    });
    trackActivationEvent({
      eventName: 'ONBOARDING_VIEWED',
      authStatus,
      userId: userProfile?.uid,
      userEmail: userProfile?.email,
      plan: usageStats.plan,
      source: 'onboarding'
    });
  }, []);

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Start Live Mic Recording
  const startLiveCapture = async () => {
    setErrorMessage(null);
    trackActivationEvent({
      eventName: 'CAPTURE_STARTED',
      authStatus,
      userId: userProfile?.uid,
      plan: usageStats.plan,
      source: 'live'
    });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        processCapturedAudio(audioBlob, `Live Conversation - ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'live');
      };

      mediaRecorder.start();
      setIsRecording(true);
      trackActivationEvent({
        eventName: 'RECORDING_STARTED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        source: 'live'
      });
    } catch (err) {
      console.error('Microphone error:', err);
      setErrorMessage('Microphone access was denied or unavailable. You can also upload an audio file instead.');
    }
  };

  const stopLiveCapture = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Stop all tracks
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  // Handle File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let files: File[] = [];
    if ('files' in e.target && e.target.files) {
      files = Array.from(e.target.files);
    } else if ('dataTransfer' in e && e.dataTransfer.files) {
      files = Array.from(e.dataTransfer.files);
    }

    if (files.length === 0) return;
    const file = files[0];

    trackActivationEvent({
      eventName: 'CAPTURE_STARTED',
      authStatus,
      userId: userProfile?.uid,
      plan: usageStats.plan,
      source: 'upload'
    });
    trackActivationEvent({
      eventName: 'AUDIO_UPLOADED',
      authStatus,
      userId: userProfile?.uid,
      plan: usageStats.plan,
      source: 'upload',
      metadata: { fileName: file.name, fileSize: file.size, fileType: file.type }
    });

    processCapturedAudio(file, file.name, 'upload');
  };

  // Handle Sample Executive Meeting
  const handleLoadSampleMeeting = async () => {
    setErrorMessage(null);
    trackActivationEvent({
      eventName: 'CAPTURE_STARTED',
      authStatus,
      userId: userProfile?.uid,
      plan: usageStats.plan,
      source: 'sample'
    });

    setStage('processing');
    setActiveStepIndex(0);
    setStatusMessage('Loading sample strategic meeting audio stream...');

    // Synthetic executive conversation sample payload
    const sampleRecordId = `rec_sample_${Date.now()}`;
    const sampleSegments: TranscriptSegment[] = [
      {
        speaker: 'Elena (VP Product)',
        text: "Let's align on the Q3 enterprise pricing tier and multi-tenant isolation roadmap. We need a definitive decision before Thursday's board sync.",
        startTime: 0,
        endTime: 6
      },
      {
        speaker: 'Marcus (VP Engineering)',
        text: "From an engineering perspective, dedicated VPC isolation for Enterprise is ready. But for team plans, shared Firestore with row-level security is 4x more cost-efficient.",
        startTime: 7,
        endTime: 15
      },
      {
        speaker: 'Elena (VP Product)',
        text: "Agreed. Let's decide right now: Enterprise tier gets dedicated VPC isolation at $120/seat, and Team tier will launch at $30/seat with strict multi-tenant isolation. Marcus owns delivery by August 15th.",
        startTime: 16,
        endTime: 25
      },
      {
        speaker: 'Marcus (VP Engineering)',
        text: "Confirmed. I will own the architectural rollout with a target deployment of August 15th. Sarah will handle SOC2 compliance validation.",
        startTime: 26,
        endTime: 32
      }
    ];

    // Pipeline steps animation for instant activation feel
    setTimeout(() => {
      setActiveStepIndex(1);
      setStatusMessage('Transcribing dialogue & separating speakers...');
    }, 800);

    setTimeout(() => {
      setActiveStepIndex(2);
      setStatusMessage('Extracting decisions, rationale, owners & execution items...');
    }, 1800);

    setTimeout(() => {
      setActiveStepIndex(3);
      setStatusMessage('Indexing decision into organizational memory...');
    }, 2800);

    setTimeout(() => {
      const unifiedIntelligence: UnifiedMeetingIntelligence = {
        title: 'Q3 Enterprise Pricing & Multi-Tenant Architecture Alignment',
        summary: [
          'Approved Enterprise tier at $120/seat with dedicated VPC isolation.',
          'Approved Team tier at $30/seat with strict multi-tenant Firestore security.',
          'Marcus assigned engineering lead for August 15th deployment.'
        ],
        topics: [
          { category: 'Pricing & Tiers', items: ['Enterprise $120/seat', 'Team $30/seat'] },
          { category: 'Infrastructure', items: ['VPC isolation for Enterprise', 'Multi-tenant RLS for Team'] }
        ],
        keyInsights: [
          'Enterprise customers require SOC2 compliance alongside dedicated VPC infrastructure.',
          'Team tier maintains healthy 85% gross margin with shared multi-tenant structure.'
        ],
        decisions: [
          {
            id: 'dec_1',
            title: 'Enterprise Tier Dedicated VPC & $120/Seat Pricing Approved',
            description: 'Provide dedicated VPC isolation for Enterprise customers at $120/seat, while keeping Team plans on cost-efficient shared multi-tenant infrastructure.',
            context: 'Balances enterprise security demands with high operating margins across lower tiers.',
            peopleInvolved: ['Elena (VP Product)', 'Marcus (VP Engineering)'],
            confidenceLevel: 'High',
            relatedTaskIds: ['task_1', 'task_2']
          }
        ],
        tasks: [
          {
            id: 'task_1',
            description: 'Deploy dedicated VPC isolation architecture for Enterprise tier',
            assignee: 'Marcus (VP Engineering)',
            deadline: 'August 15',
            priority: 'High',
            relatedDecisionId: 'dec_1'
          },
          {
            id: 'task_2',
            description: 'Validate SOC2 compliance requirements for isolated clusters',
            assignee: 'Sarah (Security Lead)',
            deadline: 'August 22',
            priority: 'High',
            relatedDecisionId: 'dec_1'
          }
        ],
        unresolvedTopics: [
          {
            id: 'unres_1',
            topic: 'Annual contract discounting policy',
            context: 'Whether 20% discount applies automatically to annual enterprise commitments.',
            reasonUnresolved: 'Finance team was not present to authorize discount schedule.',
            suggestedAction: 'Schedule 15-min sync with Finance before Thursday board meeting.'
          }
        ],
        meetingIntelligence: {
          productivityScore: 94,
          productivityExplanation: 'High decision velocity with unambiguous ownership and deadlines.',
          clarityScore: 92,
          clarityExplanation: 'Explicit agreements with zero unresolved technical ambiguity on pricing.',
          actionabilityScore: 96,
          actionabilityExplanation: 'Every decision maps to an owner with target completion date.',
          effectivenessSummary: 'High-impact 30-minute alignment resulting in actionable product launch commitments.',
          keyStrengths: ['Clear ownership', 'Explicit trade-off evaluation'],
          keyWeaknesses: ['Finance attendee was absent for discounting approval']
        },
        strategicAnalysis: {
          coreIntent: 'Finalize enterprise architecture and go-to-market pricing structure for Q3 launch.',
          context: 'Preparing product and engineering readiness ahead of board review.',
          assumptions: ['Enterprise clients will accept $120/seat pricing given dedicated VPC security.'],
          logicalGaps: ['Discount policy for multi-year commitments remains unapproved.'],
          blindSpots: ['Migration path if a Team customer upgrades to Enterprise later.'],
          strategicQuestions: ['Should we offer custom SLAs for Enterprise VPC clients?'],
          recommendations: ['Document data migration blueprint for Team-to-Enterprise tier transitions.'],
          alternativePerspectives: ['Consider a hybrid single-tenant database option for mid-market.'],
          ignoredQuestions: ['Billing cadence (quarterly vs monthly vs annual).'],
          unresolvedTopics: [],
          decisionFramework: 'Strategic Consensus',
          nextSteps: ['Complete VPC test rollout by August 15.']
        },
        executionTracker: {
          totalTasks: 2,
          completedTasks: 0,
          pendingTasks: 2,
          overdueTasks: 0,
          completionRate: 0,
          delayRate: 0,
          tasks: [
            { id: 'task_1', description: 'Deploy dedicated VPC isolation architecture', assignee: 'Marcus (VP Engineering)', status: 'In Progress' },
            { id: 'task_2', description: 'Validate SOC2 compliance requirements', assignee: 'Sarah (Security Lead)', status: 'Pending' }
          ],
          keyInsights: ['Execution is on track for August 15 milestone.']
        },
        calendarReminders: {
          summary: 'Two key deliverables scheduled for mid-August.',
          reminders: [
            {
              id: 'rem_1',
              title: 'VPC Architecture Target Release',
              description: 'Target deployment deadline for enterprise VPC isolation.',
              suggestedDateTime: 'August 15, 2026 17:00',
              priority: 'High',
              group: 'Immediate',
              calendarEventFormat: {
                title: 'Enterprise VPC Architecture Milestone',
                description: 'Final sign-off on enterprise isolation deployment.',
                startTime: '2026-08-15T17:00:00Z',
                endTime: '2026-08-15T18:00:00Z'
              }
            }
          ]
        },
        followUp: {
          email: 'Marcus & Elena',
          nextMeetingAgenda: ['Review VPC test results', 'Confirm finance discount schedule'],
          keyPendingItems: ['Finance confirmation']
        }
      };

      const finalRecord: AudioToTextRecord = {
        id: sampleRecordId,
        userId: userProfile?.uid || 'guest',
        date: new Date().toLocaleString(),
        fileName: 'Sample: Q3 Enterprise Pricing & Architecture Decision Sync',
        sourceType: 'recorded',
        transcript: sampleSegments,
        status: 'completed',
        readStatus: 'read',
        bookmarks: [],
        speakerMap: {},
        ownerEmail: userProfile?.email || 'guest',
        collaborators: [],
        group: 'Strategic Decisions',
        qualityScore: 98,
        unifiedIntelligence,
        summary: {
          mainTopic: 'Q3 Enterprise Pricing & Architecture Decision Sync',
          keyPoints: [
            'Enterprise pricing approved at $120/seat with dedicated VPC',
            'Team tier launched at $30/seat with multi-tenant isolation',
            'Marcus assigned delivery owner for August 15th'
          ],
          decisions: [
            'Enterprise tier priced at $120/seat with dedicated VPC isolation',
            'Team tier priced at $30/seat on multi-tenant structure'
          ],
          actionItems: [
            'Marcus: Deploy VPC architecture by August 15',
            'Sarah: Validate SOC2 compliance by August 22'
          ]
        }
      };

      setCompletedRecord(finalRecord);
      onSaveRecord(finalRecord);
      if (onRecordSavedCallback) onRecordSavedCallback(finalRecord);

      markFirstValueCompleted();
      setStage('decision_view');

      trackActivationEvent({
        eventName: 'DECISION_VIEWED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        recordId: sampleRecordId,
        metadata: { decisionCount: 1, source: 'sample' }
      });
      trackActivationEvent({
        eventName: 'DECISION_SAVED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        recordId: sampleRecordId,
        metadata: { source: 'sample' }
      });
      trackActivationEvent({
        eventName: 'FIRST_VALUE_REACHED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        recordId: sampleRecordId,
        metadata: { timeToFirstValueSec: 3 }
      });
    }, 3200);
  };

  // Process Real Audio (Uploaded or Recorded)
  const processCapturedAudio = async (blobOrFile: Blob | File, fileName: string, source: 'live' | 'upload') => {
    setErrorMessage(null);
    setStage('processing');
    setActiveStepIndex(0);
    setStatusMessage('Validating audio stream & checking format...');

    const estimatedMinutes = Math.max(1, Math.ceil(blobOrFile.size / (1024 * 1024)));

    if (!checkTranscriptionLimit(estimatedMinutes)) {
      setErrorMessage('Transcription usage limit reached. Please upgrade your plan or top up minutes.');
      setStage('ready');
      return;
    }

    try {
      // Step 1: Read Base64
      const reader = new FileReader();
      const base64Audio = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const res = (reader.result as string).split(',')[1];
          resolve(res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blobOrFile);
      });

      // Step 2: Transcribe
      setActiveStepIndex(1);
      setStatusMessage('Transcribing dialogue with multi-speaker detection...');
      trackActivationEvent({
        eventName: 'TRANSCRIPTION_STARTED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        source
      });

      const { transcript, qualityScore, summary } = await transcribeAudio(
        base64Audio, 
        blobOrFile.type || 'audio/webm', 
        'original'
      );
      await incrementTranscriptionUsage(estimatedMinutes);

      trackActivationEvent({
        eventName: 'TRANSCRIPTION_COMPLETED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        source,
        metadata: { segmentCount: transcript.length, qualityScore }
      });

      // Step 3: Extract Decisions & Unified Intelligence
      setActiveStepIndex(2);
      setStatusMessage('Extracting decisions, ownership, rationale & strategic risks...');
      trackActivationEvent({
        eventName: 'INTELLIGENCE_ANALYSIS_STARTED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        source
      });

      let unifiedIntelligence: UnifiedMeetingIntelligence | undefined;
      const fullTranscriptText = transcript.map(s => `${s.speaker}: ${s.text}`).join('\n');

      if (checkThinkingLimit() && fullTranscriptText.trim()) {
        try {
          unifiedIntelligence = await processUnifiedMeetingIntelligence(
            fullTranscriptText, 
            userProfile?.plan || 'free'
          );
          await incrementThinkingUsage();
        } catch (intelErr) {
          console.warn('Unified intelligence extraction warning:', intelErr);
        }
      }

      trackActivationEvent({
        eventName: 'INTELLIGENCE_ANALYSIS_COMPLETED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        source
      });

      // Step 4: Index into organizational memory
      setActiveStepIndex(3);
      setStatusMessage('Saving decision to persistent organizational memory...');

      const recordId = `rec_${Math.random().toString(36).substring(2, 9)}`;
      const newRecord: AudioToTextRecord = {
        id: recordId,
        userId: userProfile?.uid || 'guest',
        date: new Date().toLocaleString(),
        fileName,
        sourceType: source === 'live' ? 'live' : 'recorded',
        originalAudioUrl: URL.createObjectURL(blobOrFile),
        transcript,
        status: 'completed',
        readStatus: 'read',
        bookmarks: [],
        speakerMap: {},
        ownerEmail: userProfile?.email || 'guest',
        collaborators: [],
        group: 'General',
        qualityScore: qualityScore || 95,
        summary,
        unifiedIntelligence
      };

      setCompletedRecord(newRecord);
      onSaveRecord(newRecord);
      if (onRecordSavedCallback) onRecordSavedCallback(newRecord);

      markFirstValueCompleted();
      setStage('decision_view');

      trackActivationEvent({
        eventName: 'DECISION_VIEWED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        recordId,
        source
      });
      trackActivationEvent({
        eventName: 'DECISION_SAVED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        recordId,
        source
      });
      trackActivationEvent({
        eventName: 'FIRST_VALUE_REACHED',
        authStatus,
        userId: userProfile?.uid,
        plan: usageStats.plan,
        recordId,
        source
      });

      addNotification({
        title: 'Decision Indexed',
        message: `Decision intelligence successfully extracted and stored for "${fileName}".`,
        type: 'success'
      });
    } catch (err: any) {
      console.error('Audio processing pipeline error:', err);
      setErrorMessage(err?.message || 'Processing failed. Please retry with another audio clip.');
      setStage('ready');
      addNotification({
        title: 'Processing Error',
        message: 'Could not complete decision extraction. Please retry.',
        type: 'error'
      });
    }
  };

  // Perform Historical Retrieval on the current conversation and stored memory
  const handlePerformRetrieval = (queryText: string) => {
    const q = queryText.trim().toLowerCase();
    setRetrievalQuery(queryText);
    
    trackActivationEvent({
      eventName: 'DECISION_SEARCHED',
      authStatus,
      userId: userProfile?.uid,
      plan: usageStats.plan,
      metadata: { searchQuery: queryText }
    });

    if (!q || !completedRecord) {
      setRetrievalResults([]);
      return;
    }

    const matches: Array<{
      type: 'decision' | 'action' | 'risk' | 'topic';
      title: string;
      detail: string;
      owner?: string;
      matchSnippet?: string;
    }> = [];

    // Search Decisions
    if (completedRecord.unifiedIntelligence?.decisions) {
      completedRecord.unifiedIntelligence.decisions.forEach(d => {
        if (
          d.title.toLowerCase().includes(q) || 
          d.description.toLowerCase().includes(q) || 
          d.context.toLowerCase().includes(q) ||
          d.peopleInvolved.some(p => p.toLowerCase().includes(q))
        ) {
          matches.push({
            type: 'decision',
            title: d.title,
            detail: d.description,
            owner: d.peopleInvolved.join(', ')
          });
        }
      });
    }

    // Search Tasks / Actions
    if (completedRecord.unifiedIntelligence?.tasks) {
      completedRecord.unifiedIntelligence.tasks.forEach(t => {
        if (t.description.toLowerCase().includes(q) || t.assignee.toLowerCase().includes(q)) {
          matches.push({
            type: 'action',
            title: `Action Item: ${t.description}`,
            detail: `Priority: ${t.priority} • Due: ${t.deadline || 'Flexible'}`,
            owner: t.assignee
          });
        }
      });
    }

    // Search Risks / Unresolved
    if (completedRecord.unifiedIntelligence?.unresolvedTopics) {
      completedRecord.unifiedIntelligence.unresolvedTopics.forEach(u => {
        if (u.topic.toLowerCase().includes(q) || u.reasonUnresolved.toLowerCase().includes(q)) {
          matches.push({
            type: 'risk',
            title: `Unresolved Topic: ${u.topic}`,
            detail: `Reason: ${u.reasonUnresolved} • Next: ${u.suggestedAction}`
          });
        }
      });
    }

    // Search Summary & Transcript
    if (matches.length === 0 && completedRecord.summary) {
      completedRecord.summary.decisions.forEach(d => {
        if (d.toLowerCase().includes(q)) {
          matches.push({
            type: 'decision',
            title: d,
            detail: 'Extracted from conversation synthesis'
          });
        }
      });
      completedRecord.summary.actionItems.forEach(a => {
        if (a.toLowerCase().includes(q)) {
          matches.push({
            type: 'action',
            title: a,
            detail: 'Execution deliverable'
          });
        }
      });
    }

    // Fallback if generic match
    if (matches.length === 0 && completedRecord.transcript) {
      const segMatch = completedRecord.transcript.find(s => s.text.toLowerCase().includes(q));
      if (segMatch) {
        matches.push({
          type: 'topic',
          title: `Dialogue Citation (${segMatch.speaker})`,
          detail: `"${segMatch.text}"`,
          owner: segMatch.speaker
        });
      }
    }

    setRetrievalResults(matches);

    trackActivationEvent({
      eventName: 'DECISION_RETRIEVED',
      authStatus,
      userId: userProfile?.uid,
      plan: usageStats.plan,
      metadata: { 
        searchQuery: queryText,
        retrievalMatchCount: matches.length,
        recordId: completedRecord.id
      }
    });
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500 pb-16">
      {/* Top Value Positioning Bar */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-6 md:p-8 text-left space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="inline-flex items-center space-x-2 px-3 py-1 bg-white border border-slate-200 rounded-full text-[12px] font-semibold text-slate-700 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>First-Value Activation Engine</span>
          </div>

          <div className="flex items-center space-x-6 text-[12px] font-medium text-slate-500">
            <span className="flex items-center space-x-1.5">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${stage === 'ready' ? 'bg-brand-primary text-white' : 'bg-emerald-100 text-emerald-700'}`}>1</span>
              <span>Capture</span>
            </span>
            <ChevronRight size={14} className="text-slate-300" />
            <span className="flex items-center space-x-1.5">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${stage === 'processing' ? 'bg-brand-primary text-white' : stage === 'decision_view' || stage === 'retrieval_view' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>2</span>
              <span>Extract Decision</span>
            </span>
            <ChevronRight size={14} className="text-slate-300" />
            <span className="flex items-center space-x-1.5">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${stage === 'retrieval_view' ? 'bg-brand-primary text-white' : completedRecord ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>3</span>
              <span>Retrieve Memory</span>
            </span>
          </div>
        </div>

        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight leading-tight">
            Turn your important conversation into persistent organizational memory.
          </h1>
          <p className="text-slate-600 text-base md:text-lg mt-2 max-w-3xl leading-relaxed">
            EchoNote captures the dialogue, extracts what was decided, who owns execution, and indexes it into searchable organizational memory forever.
          </p>
        </div>
      </div>

      {/* ERROR BANNER */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex items-start space-x-3 text-left animate-in fade-in duration-300">
          <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={18} />
          <div className="space-y-1">
            <p className="font-semibold text-sm">Processing Alert</p>
            <p className="text-sm text-red-700">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* STAGE 1: READY / CAPTURE VIEW */}
      {stage === 'ready' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* OPTION A: Live Recording */}
            <div className={`bg-white border rounded-2xl p-8 text-left transition-all duration-300 flex flex-col justify-between ${isRecording ? 'border-red-400 ring-4 ring-red-50 shadow-lg' : 'border-slate-200 hover:border-slate-300 shadow-sm'}`}>
              <div className="space-y-4">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-800">
                  <Mic size={24} className={isRecording ? 'text-red-600 animate-pulse' : ''} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Record Live Conversation</h3>
                  <p className="text-slate-500 text-sm mt-1 leading-relaxed">
                    Speak or record a live meeting. EchoNote separates speakers, identifies key decisions, and assigns action items.
                  </p>
                </div>
              </div>

              <div className="pt-6 space-y-4">
                {isRecording ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                      <div className="flex items-center space-x-2">
                        <span className="w-3 h-3 rounded-full bg-red-600 animate-ping"></span>
                        <span className="text-sm font-bold text-red-800">Recording live: {formatDuration(recordingDuration)}</span>
                      </div>
                      <div className="flex space-x-1 items-center h-4">
                        <span className="w-1 h-3 bg-red-500 animate-bounce rounded-full"></span>
                        <span className="w-1 h-5 bg-red-600 animate-bounce delay-75 rounded-full"></span>
                        <span className="w-1 h-2 bg-red-400 animate-bounce delay-150 rounded-full"></span>
                      </div>
                    </div>

                    <button
                      onClick={stopLiveCapture}
                      className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <span>Stop & Extract Decision</span>
                      <ArrowRight size={18} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={startLiveCapture}
                    className="w-full py-4 bg-slate-900 hover:bg-black text-white font-bold rounded-xl shadow-sm hover:shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer"
                  >
                    <Mic size={18} />
                    <span>Start Live Recording</span>
                  </button>
                )}
              </div>
            </div>

            {/* OPTION B: Upload Audio File */}
            <div 
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFileUpload(e);
              }}
              className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-8 text-left transition-all duration-300 flex flex-col justify-between shadow-sm"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-800">
                  <Upload size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Upload Audio / Voice Note</h3>
                  <p className="text-slate-500 text-sm mt-1 leading-relaxed">
                    Upload an MP3, WAV, M4A, or WEBM audio file from your computer or phone voice memo.
                  </p>
                </div>
              </div>

              <div className="pt-6">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="audio/*"
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-4 bg-white border-2 border-dashed border-slate-300 hover:border-slate-900 text-slate-800 font-bold rounded-xl transition-all flex items-center justify-center space-x-2 cursor-pointer hover:bg-slate-50"
                >
                  <FileAudio size={18} />
                  <span>Choose File or Drag & Drop</span>
                </button>
              </div>
            </div>
          </div>

          {/* OPTION C: Instant Sample Test (Zero Friction First Value) */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-md text-left">
            <div className="space-y-2 max-w-xl">
              <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[11px] font-semibold">
                <Sparkles size={12} />
                <span>Zero Friction Preview</span>
              </div>
              <h3 className="text-xl font-bold text-white">
                Don't have an audio file ready right now?
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                Test the complete Decision & Execution Memory pipeline in 3 seconds with a sample executive meeting dialogue.
              </p>
            </div>

            <button
              onClick={handleLoadSampleMeeting}
              className="shrink-0 px-6 py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-xl shadow-lg transition-all flex items-center space-x-2 cursor-pointer active:scale-95"
            >
              <Play size={16} />
              <span>Load Sample Meeting</span>
            </button>
          </div>
        </div>
      )}

      {/* STAGE 2: PROCESSING PIPELINE VIEW */}
      {stage === 'processing' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 md:p-12 text-center space-y-8 shadow-sm animate-in zoom-in-95 duration-300">
          <div className="max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 bg-slate-100 text-brand-primary rounded-2xl flex items-center justify-center mx-auto animate-pulse shadow-inner">
              <Brain size={32} className="text-slate-900" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">
              Transforming Conversation into Organizational Memory
            </h2>
            <p className="text-slate-500 text-sm">
              {statusMessage || 'Processing audio stream with multi-speaker intelligence...'}
            </p>
          </div>

          {/* 4-Step Progress Track */}
          <div className="max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-4 gap-3 text-left">
            {[
              { title: 'Capture', desc: 'Audio stream received' },
              { title: 'Transcribe', desc: 'Speaker recognition' },
              { title: 'Extract', desc: 'Decisions & ownership' },
              { title: 'Remember', desc: 'Organizational memory' }
            ].map((s, idx) => {
              const isDone = idx < activeStepIndex;
              const isCurrent = idx === activeStepIndex;
              return (
                <div
                  key={s.title}
                  className={`p-4 rounded-xl border transition-all ${
                    isDone
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : isCurrent
                      ? 'bg-slate-900 text-white border-slate-900 ring-2 ring-slate-900/10'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <div className="flex items-center space-x-2 mb-1">
                    {isDone ? (
                      <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    ) : isCurrent ? (
                      <RefreshCw size={14} className="animate-spin text-emerald-400 shrink-0" />
                    ) : (
                      <span className="w-4 h-4 rounded-full border border-slate-300 text-[10px] flex items-center justify-center">
                        {idx + 1}
                      </span>
                    )}
                    <span className="font-bold text-xs">{s.title}</span>
                  </div>
                  <p className="text-[11px] opacity-80">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STAGE 3 & 4: DECISION RESULT & HISTORICAL RETRIEVAL */}
      {(stage === 'decision_view' || stage === 'retrieval_view') && completedRecord && (
        <div className="space-y-6 text-left animate-in fade-in slide-in-from-bottom-3 duration-500">
          {/* Verdict Banner */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center shrink-0 shadow-sm">
                <ShieldCheck size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-emerald-950">
                  Decision Extracted & Indexed into Organizational Memory
                </h3>
                <p className="text-emerald-800 text-xs md:text-sm">
                  Source: <span className="font-medium">{completedRecord.fileName}</span> • {completedRecord.transcript.length} segments analyzed
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-3 shrink-0">
              <button
                onClick={() => setStage('ready')}
                className="px-4 py-2 bg-white border border-emerald-200 text-emerald-900 hover:bg-emerald-100 text-xs font-bold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <RotateCcw size={14} />
                <span>Capture Another</span>
              </button>
              <button
                onClick={onNavigateToHistory}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <Database size={14} />
                <span>View in Decision History</span>
              </button>
            </div>
          </div>

          {/* PRIMARY DECISION OBJECT (FIRST CLASS CITIZEN) */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 space-y-6 shadow-sm">
            <div className="border-b border-slate-100 pb-4 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="px-2.5 py-1 bg-slate-100 text-slate-800 font-bold text-[11px] rounded-md tracking-wide uppercase">
                  Primary Decision & Verdict
                </span>
                <h2 className="text-2xl font-bold text-slate-900 mt-2">
                  {completedRecord.unifiedIntelligence?.decisions[0]?.title || completedRecord.summary?.decisions[0] || completedRecord.fileName}
                </h2>
              </div>

              {completedRecord.unifiedIntelligence?.decisions[0]?.confidenceLevel && (
                <div className="flex items-center space-x-2 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  <span className="text-xs font-bold text-emerald-800">
                    Confidence: {completedRecord.unifiedIntelligence.decisions[0].confidenceLevel}
                  </span>
                </div>
              )}
            </div>

            {/* Grid of Decision Anatomy */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* RATIONALE & CONTEXT */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 space-y-3">
                <div className="flex items-center space-x-2 text-slate-700 font-bold text-sm">
                  <Brain size={16} className="text-slate-900" />
                  <span>Strategic Rationale & Context</span>
                </div>
                <p className="text-slate-600 text-sm leading-relaxed">
                  {completedRecord.unifiedIntelligence?.decisions[0]?.context || 
                   completedRecord.unifiedIntelligence?.decisions[0]?.description || 
                   completedRecord.summary?.keyPoints.join(' ') || 
                   'High consensus achieved during coordination review.'}
                </p>
                {completedRecord.unifiedIntelligence?.decisions[0]?.peopleInvolved && completedRecord.unifiedIntelligence.decisions[0].peopleInvolved.length > 0 && (
                  <div className="pt-2 border-t border-slate-200/60 flex items-center space-x-2 text-xs text-slate-500">
                    <User size={13} className="text-slate-400" />
                    <span>Stakeholders: <strong className="text-slate-800">{completedRecord.unifiedIntelligence.decisions[0].peopleInvolved.join(', ')}</strong></span>
                  </div>
                )}
              </div>

              {/* OWNERSHIP & EXECUTION DELIVERABLES */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 space-y-3">
                <div className="flex items-center space-x-2 text-slate-700 font-bold text-sm">
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  <span>Execution Deliverables & Assigned Owners</span>
                </div>
                
                <div className="space-y-2">
                  {completedRecord.unifiedIntelligence?.tasks && completedRecord.unifiedIntelligence.tasks.length > 0 ? (
                    completedRecord.unifiedIntelligence.tasks.map(t => (
                      <div key={t.id} className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-800 truncate pr-2">{t.description}</span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-bold rounded shrink-0">
                          {t.assignee}
                        </span>
                      </div>
                    ))
                  ) : completedRecord.summary?.actionItems && completedRecord.summary.actionItems.length > 0 ? (
                    completedRecord.summary.actionItems.map((a, i) => (
                      <div key={i} className="bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 font-medium">
                        {a}
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 text-xs">No explicit action items assigned.</p>
                  )}
                </div>
              </div>
            </div>

            {/* UNRESOLVED TOPICS & RISKS */}
            {completedRecord.unifiedIntelligence?.unresolvedTopics && completedRecord.unifiedIntelligence.unresolvedTopics.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-2">
                <div className="flex items-center space-x-2 text-amber-900 font-bold text-sm">
                  <AlertTriangle size={16} className="text-amber-600" />
                  <span>Unresolved Topics & Strategic Flags</span>
                </div>
                {completedRecord.unifiedIntelligence.unresolvedTopics.map(u => (
                  <div key={u.id} className="text-xs text-amber-900 space-y-1">
                    <p className="font-semibold">{u.topic}</p>
                    <p className="text-amber-800">{u.reasonUnresolved} • <em>Recommended: {u.suggestedAction}</em></p>
                  </div>
                ))}
              </div>
            )}

            {/* TOGGLE FOR FULL TRANSCRIPT */}
            <div className="border-t border-slate-100 pt-4">
              <button
                onClick={() => setShowFullTranscript(!showFullTranscript)}
                className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center space-x-1.5 cursor-pointer"
              >
                <Layers size={14} />
                <span>{showFullTranscript ? 'Hide Multi-Speaker Transcript' : 'View Full Multi-Speaker Transcript'}</span>
              </button>

              {showFullTranscript && (
                <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4 max-h-64 overflow-y-auto space-y-3">
                  {completedRecord.transcript.map((seg, idx) => (
                    <div key={idx} className="text-xs space-y-0.5">
                      <div className="flex items-center space-x-2 font-bold text-slate-700">
                        <span>{seg.speaker}</span>
                        <span className="text-[10px] text-slate-400 font-normal">
                          {formatDuration(Math.floor(seg.startTime))} - {formatDuration(Math.floor(seg.endTime))}
                        </span>
                      </div>
                      <p className="text-slate-600 pl-2 border-l-2 border-slate-200">{seg.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* HISTORICAL RETRIEVAL EXPERIENCE ("ASK ECHONOTE / RETRIEVAL") */}
          <div className="bg-slate-900 text-white border border-slate-800 rounded-2xl p-6 md:p-8 space-y-6 shadow-xl">
            <div className="space-y-2">
              <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[11px] font-semibold">
                <Search size={12} />
                <span>Step 3: Historical Retrieval</span>
              </div>
              <h3 className="text-2xl font-bold text-white">
                Query Your New Organizational Memory
              </h3>
              <p className="text-slate-400 text-sm">
                Try searching this meeting or asking a question to test instant recall:
              </p>
            </div>

            {/* Quick Query Pills */}
            <div className="flex flex-wrap gap-2">
              {[
                'pricing',
                'Marcus',
                'VPC',
                'delivery date',
                'SOC2'
              ].map(pill => (
                <button
                  key={pill}
                  onClick={() => handlePerformRetrieval(pill)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all flex items-center space-x-1 cursor-pointer"
                >
                  <Search size={11} className="text-emerald-400" />
                  <span>"{pill}"</span>
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={retrievalQuery}
                onChange={(e) => handlePerformRetrieval(e.target.value)}
                placeholder="Search decision details, owners, dates, or rationale..."
                className="w-full px-4 py-3.5 pl-11 bg-slate-800/90 border border-slate-700 rounded-xl text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
              />
              <Search className="absolute left-4 top-4 text-slate-400" size={16} />
            </div>

            {/* Retrieval Search Results */}
            {retrievalQuery && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Found {retrievalResults.length} matching memory items for "{retrievalQuery}"</span>
                </div>

                {retrievalResults.length > 0 ? (
                  <div className="space-y-2">
                    {retrievalResults.map((res, i) => (
                      <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm text-emerald-300">{res.title}</span>
                          {res.owner && (
                            <span className="px-2 py-0.5 bg-slate-700 text-slate-300 font-medium text-[11px] rounded">
                              Owner: {res.owner}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{res.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-800/50 border border-slate-800 rounded-xl p-4 text-center text-xs text-slate-400">
                    No direct match found for "{retrievalQuery}". Try searching for pricing, owners, or topics.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Guest Sign-In Promotion (Without breaking Guest Mode) */}
          {authStatus === AuthStatus.GUEST && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="space-y-1 text-left">
                <h4 className="font-bold text-slate-900 text-sm">Want to preserve this across all sessions & invite teammates?</h4>
                <p className="text-slate-500 text-xs">Create a free account to unlock multi-project folders, cloud persistence, and team sharing.</p>
              </div>
              <button
                onClick={onSignInClick}
                className="px-6 py-2.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg shadow-sm transition-all cursor-pointer shrink-0"
              >
                Sign Up for Free Cloud Sync
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FirstValueActivation;
