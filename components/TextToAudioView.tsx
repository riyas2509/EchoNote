
import React, { useState, useEffect } from 'react';
import { synthesizeSpeech, pcmToWavUrl, audioToBlobUrl, audioToBlob } from '../services/geminiService';
import { uploadAudioToStorage } from '../services/recordingService';
import { executeDownload } from '../services/downloadService';
import { TextToAudioRecord, AuthStatus, VoiceGender, PlaybackMetadata, PlaybackStatus, AppNotification, Project, UserProfile, OrgRole } from '../types';

interface TextToAudioViewProps {
  onSave: (record: TextToAudioRecord) => void;
  projects: Project[];
  onAddGroup: (name: string) => void;
  authStatus: AuthStatus;
  userProfile?: UserProfile;
  onNewProject: () => void;
  lastCreatedProjectId?: string | null;
  activePlaybackId?: string;
  playbackStatus: PlaybackStatus;
  onPlay: (metadata: PlaybackMetadata) => void;
  onPause: () => void;
  onStop: () => void;
  addNotification: (notif: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => void;
  userOrgRole?: OrgRole;
}

const TextToAudioView: React.FC<TextToAudioViewProps> = ({ 
  onSave, projects, onAddGroup, authStatus, userProfile, onNewProject, lastCreatedProjectId,
  activePlaybackId, playbackStatus, onPlay, onPause, addNotification, userOrgRole
}) => {
  const checkPermission = (groupName: string, action: 'edit' | 'delete') => {
    if (userOrgRole === 'owner' || userOrgRole === 'org_admin') return true;
    if (userOrgRole === 'viewer') return false;

    if (groupName === 'General') return true;
    if (authStatus === AuthStatus.GUEST) return false;
    
    const project = projects.find(p => p.name === groupName);
    if (!project) return true; // General group or unknown

    if (project.ownerEmail === userProfile?.email) return true;

    const member = project.members?.find(m => m.email === userProfile?.email);

    if (!member) return false;

    if (action === 'delete') {
      return member.role === 'owner';
    }

    if (action === 'edit') {
      return member.role === 'owner' || member.role === 'admin' || member.role === 'editor';
    }

    return false;
  };

  const [scripts, setScripts] = useState<{ id: string; text: string; gender: VoiceGender | null; group: string; isMinimized: boolean }[]>([
    { id: Math.random().toString(36).substr(2, 9), text: '', gender: null, group: 'General', isMinimized: false }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [expandedTextIds, setExpandedTextIds] = useState<Set<string>>(new Set());
  const [generatedAudios, setGeneratedAudios] = useState<TextToAudioRecord[]>([]);
  const [showGenderError, setShowGenderError] = useState<string | null>(null);

  // Real-time collaboration sync via Firestore is handled in App.tsx
  // Local scripts and generated audios are kept in component state for the current session
  
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const [isGlobalDropdownOpen, setIsGlobalDropdownOpen] = useState(false);

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
                {selected === p.name && <i className="fa-solid fa-check text-[10px] text-brand-primary"></i>}
              </button>
            ))}
          </div>
          <div className="border-t border-brand-divider/10 mt-1 pt-1">
            <button
              onClick={() => {
                onNewProject();
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-4 py-2 text-[13px] font-bold text-brand-primary hover:bg-slate-50 transition-colors"
            >
              <i className="fa-solid fa-plus text-[10px]"></i>
              <span>Create New Project</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Download state
  const [downloadModal, setDownloadModal] = useState<{ id: string; name: string; url: string } | null>(null);
  const [selectedFormat, setSelectedFormat] = useState('');

  const triggerDownload = (id: string, name: string, url: string) => {
    setDownloadModal({ id, name, url });
    setSelectedFormat('');
  };

  const handleDownloadConfirm = async () => {
    if (!downloadModal || !selectedFormat) return;
    try {
      await executeDownload(downloadModal.name, downloadModal.url, selectedFormat);
    } catch (err) {
      addNotification({
        title: 'System Error',
        message: 'File delivery interrupted. Please check network connection.',
        type: 'error'
      });
    }
    setDownloadModal(null);
    setSelectedFormat('');
  };

  const handleGroupChange = (id: string, value: string) => {
    if (!checkPermission(value, 'edit')) {
      addNotification({
        title: 'Permission Denied',
        message: 'You do not have permission to add assets to this project.',
        type: 'error'
      });
      return;
    }
    updateScript(id, { group: value });
  };

  const toggleTextExpansion = (id: string) => {
    setExpandedTextIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRecordGroupChange = (id: string, newGroup: string) => {
    const record = generatedAudios.find(r => r.id === id);
    if (!record) return;

    if (!checkPermission(record.group, 'edit')) {
      addNotification({
        title: 'Permission Denied',
        message: 'You do not have permission to move this asset.',
        type: 'error'
      });
      return;
    }

    // Check permission for the target group
    if (!checkPermission(newGroup, 'edit')) {
      addNotification({
        title: 'Permission Denied',
        message: 'You do not have permission to add assets to the target project.',
        type: 'error'
      });
      return;
    }

    const updatedRecord = { ...record, group: newGroup };
    setGeneratedAudios(prev => prev.map(r => r.id === id ? updatedRecord : r));
    
    if (authStatus === AuthStatus.LOGGED_IN) {
      onSave(updatedRecord);
    }
  };

  const handlePlayAudio = (item: TextToAudioRecord) => {
    if (!item.audioUrl) {
      addNotification({
        title: 'Playback Error',
        message: 'No audio source is available for this synthesis.',
        type: 'error'
      });
      return;
    }
    if (activePlaybackId === item.id && playbackStatus === 'playing') {
      onPause();
    } else {
      onPlay({ id: item.id, title: `Synthesis Result`, url: item.audioUrl });
    }
  };

  const addScript = () => {
    if (authStatus === AuthStatus.GUEST) {
      addNotification({
        title: 'Plan Limitation',
        message: 'Batch processing is available in Pro and Enterprise plans.',
        type: 'error'
      });
      return;
    }
    setScripts(prev => {
      const minimizedPrev = prev.map(s => ({ ...s, isMinimized: true }));
      return [...minimizedPrev, { id: Math.random().toString(36).substr(2, 9), text: '', gender: null, group: 'General', isMinimized: false }];
    });
  };

  const removeScript = (id: string) => {
    if (scripts.length > 1) {
      setScripts(prev => prev.filter(s => s.id !== id));
    }
  };

  const updateScript = (id: string, updates: Partial<{ text: string; gender: VoiceGender | null; group: string; isMinimized: boolean }>) => {
    setScripts(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleGenerateAll = async () => {
    const validScripts = scripts.filter(s => s.text.trim() && (authStatus === AuthStatus.GUEST || s.gender));
    if (validScripts.length === 0 || (authStatus !== AuthStatus.GUEST && validScripts.length < scripts.length)) {
      addNotification({
        title: 'Validation Error',
        message: 'Please ensure all scripts have text and a voice archetype selected.',
        type: 'error'
      });
      return;
    }

    if (authStatus === AuthStatus.GUEST && validScripts.length > 1) {
      addNotification({
        title: 'Feature Restricted',
        message: 'Batch processing is not available in Guest Mode. Please create an account to unlock.',
        type: 'error'
      });
      return;
    }

    const unauthorizedScripts = validScripts.filter(s => !checkPermission(s.group, 'edit'));
    if (unauthorizedScripts.length > 0) {
      addNotification({
        title: 'Permission Denied',
        message: 'You do not have permission to generate assets for some of the selected projects.',
        type: 'error'
      });
      return;
    }

    setIsProcessing(true);
    const validIds = validScripts.map(s => s.id);
    setProcessingIds(new Set(validIds));

    try {
      const generationPromises = validScripts.map(async (script) => {
        try {
          const targetGender = script.gender || 'male';
          const synthResult = await synthesizeSpeech(script.text, targetGender);
          
          const blob = audioToBlob(synthResult.data, synthResult.mimeType);
          let url = URL.createObjectURL(blob);
          const recordId = Math.random().toString(36).substr(2, 9);

          if (authStatus === AuthStatus.LOGGED_IN) {
            try {
              const fileName = `synthesis_${recordId}.mp3`;
              url = await uploadAudioToStorage(blob, userProfile?.uid || 'unknown', recordId, fileName);
            } catch (storageError) {
              console.error("Firebase Storage TTS upload failed, falling back to local Blob:", storageError);
            }
          }

          const record = {
            id: recordId,
            date: new Date().toLocaleString(),
            textPreview: script.text.length > 80 ? script.text.substring(0, 77) + '...' : script.text,
            fullText: script.text,
            audioUrl: url,
            gender: targetGender,
            group: script.group,
            collaborators: []
          };
          
          if (authStatus === AuthStatus.LOGGED_IN) {
            onSave(record);
          }
          return record;
        } finally {
          setProcessingIds(prev => {
            const next = new Set(prev);
            next.delete(script.id);
            return next;
          });
        }
      });

      const results = await Promise.all(generationPromises);

      setGeneratedAudios(prev => [...results, ...prev]);
      setScripts([{ id: Math.random().toString(36).substr(2, 9), text: '', gender: null, group: 'General', isMinimized: false }]);
      
      addNotification({
        title: 'Synthesis Complete',
        message: `Successfully generated ${results.length} narrative asset(s).`,
        type: 'success',
        recordId: results[0].id
      });

      if (results.length > 0) {
        onPlay({ id: results[0].id, title: `Synthesis Result`, url: results[0].audioUrl });
      }
    } catch (error) {
      addNotification({
        title: 'Synthesis Failed',
        message: 'Failed to synthesize one or more scripts. Please try again.',
        type: 'error'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full space-y-10 animate-in fade-in duration-500 pb-24 h-full relative">
      <header className="space-y-2 text-left">
        <h1 className="text-brand-primary tracking-tight text-[28px] md:text-[38px] font-semibold">Speech Synthesis</h1>
        <p className="text-slate-600 text-sm md:text-lg font-normal">High-fidelity corporate documentation narration with differentiated voice profiles.</p>
      </header>

      {downloadModal && (
        <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-10 max-w-sm w-full space-y-8 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-2">
              <h2 className="text-brand-primary text-[26px] font-medium">Audio export</h2>
              <p className="text-slate-500 text-sm font-normal">Asset: {downloadModal.name}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {['WAV', 'MP3'].map(fmt => (
                <button key={fmt} onClick={() => setSelectedFormat(fmt)} className={`py-3 rounded-lg text-[11px] font-medium border-2 transition-all ${selectedFormat === fmt ? 'bg-brand-accent text-brand-primary border-brand-accent scale-[1.02]' : 'bg-brand-background text-slate-400 border-brand-divider/30 hover:border-brand-accent'}`}>{fmt}</button>
              ))}
            </div>
            <div className="flex flex-col space-y-3">
              <button onClick={handleDownloadConfirm} disabled={!selectedFormat} className="w-full py-4 bg-brand-primary text-white rounded-lg font-medium tracking-widest text-[11px] disabled:opacity-50 transition-all shadow-xl active:scale-[0.98]">Confirm & start download</button>
              <button onClick={() => setDownloadModal(null)} className="text-[13px] font-medium text-slate-400 text-center hover:text-slate-600 transition-colors">Cancel Request</button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-8">
        {scripts.map((script, index) => (
          <div key={script.id} className={`bg-white rounded-lg p-10 shadow-sm border transition-all space-y-10 relative overflow-hidden animate-in slide-in-from-bottom-4 ${processingIds.has(script.id) ? 'border-brand-accent ring-1 ring-brand-accent/20' : 'border-brand-divider/20'}`}>
            {processingIds.has(script.id) && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center space-y-4">
                <div className="w-10 h-10 border-4 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-[11px] font-medium text-brand-primary tracking-widest animate-pulse">Synthesizing narrative...</p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <h3 className="text-[11px] font-medium text-slate-400 tracking-widest">Asset workflow #{index + 1}</h3>
                <button 
                  onClick={() => updateScript(script.id, { isMinimized: !script.isMinimized })}
                  className="text-[11px] font-medium text-brand-primary hover:underline"
                >
                  {script.isMinimized ? 'Expand' : 'Minimize'}
                </button>
              </div>
              <div className="flex items-center space-x-3">
                {scripts.length > 1 && (
                  <button onClick={() => removeScript(script.id)} className="text-red-400 hover:text-red-500 transition-colors">
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                )}
              </div>
            </div>

            {!script.isMinimized && (
              <>
                {/* Step 1: Voice Selection */}
                <div className={`space-y-4 transition-all ${showGenderError === script.id ? 'animate-bounce' : ''}`}>
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-medium text-slate-500 tracking-widest">
                      Step 1: Choose voice archetype
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <button 
                       onClick={() => authStatus !== AuthStatus.GUEST && updateScript(script.id, { gender: 'male' })}
                       disabled={authStatus === AuthStatus.GUEST}
                       className={`group relative py-10 rounded-xl font-bold uppercase tracking-[0.2em] text-[10px] transition-all flex flex-col items-center justify-center space-y-4 border-2 ${script.gender === 'male' ? 'bg-brand-primary text-brand-accent border-brand-primary shadow-2xl scale-[1.02]' : 'bg-brand-background text-slate-400 border-brand-divider/10 hover:border-brand-primary/30'} ${authStatus === AuthStatus.GUEST ? 'cursor-not-allowed opacity-50' : ''}`}
                     >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${script.gender === 'male' ? 'bg-brand-accent/20' : 'bg-slate-100 group-hover:bg-brand-primary/10'}`}>
                          <i className="fa-solid fa-person text-xl"></i>
                        </div>
                        <span>Masculine Archetype</span>
                        {script.gender === 'male' && <div className="absolute top-3 right-3 w-2 h-2 bg-brand-accent rounded-full animate-pulse"></div>}
                     </button>
                     <button 
                       onClick={() => authStatus !== AuthStatus.GUEST && updateScript(script.id, { gender: 'female' })}
                       disabled={authStatus === AuthStatus.GUEST}
                       className={`group relative py-10 rounded-xl font-bold uppercase tracking-[0.2em] text-[10px] transition-all flex flex-col items-center justify-center space-y-4 border-2 ${script.gender === 'female' ? 'bg-brand-primary text-brand-accent border-brand-primary shadow-2xl scale-[1.02]' : 'bg-brand-background text-slate-400 border-brand-divider/10 hover:border-brand-primary/30'} ${authStatus === AuthStatus.GUEST ? 'cursor-not-allowed opacity-50' : ''}`}
                     >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${script.gender === 'female' ? 'bg-brand-accent/20' : 'bg-slate-100 group-hover:bg-brand-primary/10'}`}>
                          <i className="fa-solid fa-person-dress text-xl"></i>
                        </div>
                        <span>Feminine Archetype</span>
                        {script.gender === 'female' && <div className="absolute top-3 right-3 w-2 h-2 bg-brand-accent rounded-full animate-pulse"></div>}
                     </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 pt-4 border-t border-brand-divider/20">
                    <div className="flex-1">
                      <ProjectDropdown 
                        selected={script.group}
                        onSelect={(name) => handleGroupChange(script.id, name)}
                        isOpen={activeDropdownId === script.id}
                        setIsOpen={(open) => setActiveDropdownId(open ? script.id : null)}
                        disabled={authStatus === AuthStatus.GUEST}
                      />
                    </div>

                  <div className="space-y-4 text-left">
                     <label className="block text-[11px] font-medium text-slate-500 tracking-widest">Step 3: Intelligence details</label>
                     <div className="bg-brand-background border border-brand-divider/30 rounded-lg px-4 py-4 flex items-center justify-between">
                        <div className="flex flex-col">
                           <span className="text-[11px] font-medium text-slate-400">Target voice</span>
                           <span className={`text-sm font-medium ${script.gender ? 'text-brand-primary' : 'text-slate-300'}`}>
                             {script.gender ? (script.gender === 'male' ? 'Masculine' : 'Feminine') : 'None selected'}
                           </span>
                        </div>
                        <div className="h-8 w-[1px] bg-brand-divider/20"></div>
                        <div className="flex flex-col text-right">
                           <span className="text-[11px] font-medium text-slate-400">Status</span>
                           <span className={`text-sm font-medium ${!script.gender ? 'text-slate-300' : script.text.trim() ? 'text-emerald-600' : 'text-brand-primary'}`}>
                             {!script.gender ? 'Awaiting selection' : script.text.trim() ? 'Ready' : 'Pending input'}
                           </span>
                        </div>
                     </div>
                  </div>
                </div>

                <div className="space-y-4 text-left">
                  <label className="block text-[11px] font-medium text-slate-500 tracking-widest">Script content</label>
                  <textarea
                    value={script.text}
                    onChange={(e) => updateScript(script.id, { text: e.target.value })}
                    placeholder="Enter professional script for narrative synthesis..."
                    className="w-full h-40 p-8 rounded-lg bg-brand-background border border-brand-divider/30 focus:ring-4 focus:ring-brand-primary/5 focus:outline-none resize-none text-brand-primary placeholder:text-slate-300 transition-all font-normal"
                  />
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-brand-divider/10">
                  <span className="text-[11px] font-medium text-slate-400 tracking-widest">
                    {script.text.length} chars / target: {script.group}
                  </span>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end items-center gap-4">
        <button 
          onClick={addScript}
          className="text-[11px] font-medium tracking-widest text-brand-primary bg-white border border-brand-divider/30 px-6 py-3 rounded-lg hover:bg-brand-background transition-all shadow-sm"
        >
          <i className="fa-solid fa-plus mr-2"></i>
          Add another script
        </button>
        <div className="flex flex-col items-end gap-2">
          {scripts.some(s => !s.text.trim() || (authStatus !== AuthStatus.GUEST && !s.gender)) && (
            <p className="text-[10px] text-amber-600 font-medium animate-pulse">
              <i className="fa-solid fa-circle-info mr-1"></i>
              Complete all scripts to enable generation
            </p>
          )}
          <button
            onClick={handleGenerateAll}
            disabled={isProcessing || scripts.some(s => !s.text.trim() || (authStatus !== AuthStatus.GUEST && !s.gender))}
            className={`flex items-center justify-center gap-4 px-16 py-6 rounded-xl font-bold uppercase tracking-[0.2em] text-[11px] transition-all shadow-2xl active:scale-95 ${isProcessing || scripts.some(s => !s.text.trim() || (authStatus !== AuthStatus.GUEST && !s.gender)) ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-brand-primary text-[#0F172A] shadow-brand-primary/20 hover:brightness-110 hover:scale-[1.02]'}`}>
            {isProcessing ? <i className="fa-solid fa-circle-notch animate-spin text-lg" /> : <i className="fa-solid fa-waveform text-lg" />}
            {isProcessing ? 'Synthesizing Intelligence...' : `Initialize ${scripts.length > 1 ? `Batch (${scripts.length})` : 'Synthesis Module'}`}
          </button>
        </div>
      </div>

      {generatedAudios.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-brand-primary tracking-widest text-left text-[26px] font-medium">Session intelligence</h2>
          <div className="space-y-4">
            {generatedAudios.map((item) => (
              <div key={item.id} className="bg-white border border-brand-divider/20 rounded-lg p-8 shadow-sm space-y-6 animate-in slide-in-from-top-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex flex-col space-y-2 text-left">
                        <div className="flex items-center gap-4">
                          <div className="flex flex-col">
                            <ProjectDropdown 
                              selected={item.group}
                              onSelect={(name) => handleRecordGroupChange(item.id, name)}
                              isOpen={activeDropdownId === item.id}
                              setIsOpen={(open) => setActiveDropdownId(open ? item.id : null)}
                              disabled={authStatus === AuthStatus.GUEST || !checkPermission(item.group, 'edit')}
                            />
                          </div>
                          <div className="flex flex-col">
                            <label className="text-xs text-gray-500 mb-1 block">
                              Type
                            </label>
                            <span className={`px-3 py-1 text-xs rounded-full font-semibold ${item.gender === 'male' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'}`}>
                              {item.gender} narrative
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <label className="text-xs text-gray-500 mb-1 block">
                              Date
                            </label>
                            <div className="flex items-center gap-2">
                              <p className="text-[11px] text-slate-400 font-medium tracking-widest">{item.date}</p>
                            </div>
                          </div>
                        </div>
                       <div className="space-y-2">
                         <p className={`text-brand-primary text-base font-normal italic leading-relaxed ${expandedTextIds.has(item.id) ? '' : 'line-clamp-2 max-w-xl'}`}>
                           "{item.fullText}"
                         </p>
                         {item.fullText.length > 100 && (
                           <button 
                             onClick={() => toggleTextExpansion(item.id)}
                             className="text-[11px] font-medium text-brand-primary hover:underline flex items-center gap-1"
                           >
                             {expandedTextIds.has(item.id) ? (
                               <><i className="fa-solid fa-compress"></i> show less</>
                             ) : (
                               <><i className="fa-solid fa-expand"></i> show full narrative</>
                             )}
                           </button>
                         )}
                       </div>
                    </div>
                  
                  <div className="flex items-center space-x-3 shrink-0">
                    <button 
                      onClick={() => handlePlayAudio(item)}
                      className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium text-[11px] tracking-widest transition-all shadow-md ${activePlaybackId === item.id && playbackStatus === 'playing' ? 'bg-brand-secondary text-[#0F172A]' : 'bg-brand-primary text-[#0F172A] shadow-brand-primary/10'}`}
                    >
                      <i className={`fa-solid ${activePlaybackId === item.id && playbackStatus === 'playing' ? 'fa-pause' : 'fa-play'}`}></i>
                      <span>{activePlaybackId === item.id && playbackStatus === 'playing' ? 'Pause' : 'Play'}</span>
                    </button>
                    <button 
                      onClick={() => triggerDownload(item.id, `Speech_${item.id}`, item.audioUrl)}
                      className="p-3 bg-slate-50 text-slate-500 rounded-lg hover:bg-brand-primary hover:text-white transition-all shadow-sm"
                      title="Download synthesized audio"
                    >
                      <i className="fa-solid fa-download text-xs"></i>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TextToAudioView;
