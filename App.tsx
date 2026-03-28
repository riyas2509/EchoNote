
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate, Link } from 'react-router-dom';
import Navigation from './components/Navigation';
import Topbar from './components/Topbar';
import HomeView from './components/HomeView';
import AuthView from './components/AuthView';
import AudioToTextView from './components/AudioToTextView';
import TextToAudioView from './components/TextToAudioView';
import DecisionIntelligence from './components/DecisionIntelligence';
import DecisionHistory from './components/DecisionHistory';
import HistoryDashboard from './components/HistoryDashboard';
import SubscriptionView from './components/SubscriptionView';
import GlobalPlayer from './components/GlobalPlayer';
import LandingNavbar from './components/LandingNavbar';
import LandingFooter from './components/LandingFooter';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';
import SecurityPage from './components/SecurityPage';
import ContactPage from './components/ContactPage';
import BookDemoPage from './components/BookDemoPage';
import TestDashboard from './components/TestDashboard';
import EchoNoteAssistant from './components/EchoNoteAssistant';
import Home from './pages/Home';
import Features from './pages/Features';
import Solutions from './pages/Solutions';
import Pricing from './pages/Pricing';
import { AppWorkflow, AudioToTextRecord, TextToAudioRecord, AuthStatus, UserProfile, PlaybackMetadata, PlaybackStatus, AppNotification, UsageStats, SubscriptionTier, Project, ProjectMember, CollaborationRole, MainView } from './types';
import { PLAN_FEATURES } from './config/planConfig';
import { useFirebase } from './components/FirebaseProvider';
import { auth, db, collection, query, where, onSnapshot, doc, setDoc, updateDoc, deleteDoc, orderBy, handleFirestoreError, OperationType } from './firebase';

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, isAuthReady } = useFirebase();

  const handleLogin = () => {
    navigate('/auth');
  };

  const handleBackToHome = () => {
    navigate('/');
  };

  const handleGoToDashboard = () => {
    navigate('/app');
  };

  const handleStartFree = () => {
    handleAuth(AuthStatus.GUEST);
    setCurrentTab(AppWorkflow.AUDIO_TO_TEXT);
    navigate('/app');
  };

  const handleNavigateToDemo = () => {
    navigate('/demo');
  };

  const [authStatus, setAuthStatus] = useState<AuthStatus>(() => {
    const remembered = localStorage.getItem('remembered_user');
    return remembered ? AuthStatus.LOGGED_IN : AuthStatus.GUEST;
  });
  const [userProfile, setUserProfile] = useState<UserProfile | undefined>(() => {
    const remembered = localStorage.getItem('remembered_user');
    try {
      return remembered ? JSON.parse(remembered) : undefined;
    } catch {
      return undefined;
    }
  });

  useEffect(() => {
    if (isAuthReady) {
      if (user && profile) {
        setAuthStatus(AuthStatus.LOGGED_IN);
        setUserProfile(profile);
        
        const rememberMe = localStorage.getItem('echonote_remember_me') === 'true';
        if (rememberMe) {
          localStorage.setItem('remembered_user', JSON.stringify(profile));
        } else {
          localStorage.removeItem('remembered_user');
        }
        
        // Immediately redirect to app if we're on the auth page and login is successful
        if (location.pathname === '/auth') {
          navigate('/app');
        }
      } else {
        // If we have a remembered user but Firebase says we're not logged in, 
        // we should probably wait for Firebase to be sure, or clear it if it's definitely null.
        // However, if user is null and isAuthReady is true, we are definitely not logged in.
        if (!user) {
          setAuthStatus(AuthStatus.GUEST);
          setUserProfile(undefined);
          localStorage.removeItem('remembered_user');
        }
      }
    }
  }, [user, profile, isAuthReady, location.pathname, navigate]);
  const [currentTab, setCurrentTab] = useState<AppWorkflow>(AppWorkflow.HOME);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<{id: string, title: string, message: string, type: 'info' | 'error' | 'success'}[]>([]);

  const addToast = (title: string, message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  const addNotification = useCallback((notif: Omit<AppNotification, 'id' | 'timestamp' | 'isRead'>) => {
    const newNotif: AppNotification = {
      ...notif,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      isRead: false
    };
    setNotifications(prev => [newNotif, ...prev]);
    
    // Map notification types to toast types
    let toastType: 'info' | 'success' | 'error' = 'info';
    if (notif.type === 'error') toastType = 'error';
    if (notif.type === 'success') toastType = 'success';
    
    addToast(notif.title, notif.message, toastType);
  }, []);

  // Usage Stats State
  const [usageStats, setUsageStats] = useState<UsageStats>({
    usedMinutes: 0,
    totalMinutes: PLAN_FEATURES.guest.totalMinutesLimit,
    plan: 'guest',
    renewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    minutesPerFileLimit: PLAN_FEATURES.guest.minutesPerFileLimit
  });

  useEffect(() => {
    if (authStatus === AuthStatus.LOGGED_IN && userProfile) {
      const tier = userProfile.plan || 'free';
      const features = PLAN_FEATURES[tier as SubscriptionTier];
      
      setUsageStats({
        usedMinutes: userProfile.minutesUsed || 0,
        totalMinutes: features.totalMinutesLimit,
        plan: tier as SubscriptionTier,
        renewalDate: 'Next Month', // Simplified
        minutesPerFileLimit: features.minutesPerFileLimit
      });
    }
  }, [authStatus, userProfile]);

  const upgradePlan = useCallback(async (tier: SubscriptionTier, silent: boolean = false) => {
    const features = PLAN_FEATURES[tier];

    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        await updateDoc(doc(db, 'users', user.uid), { plan: tier });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      }
    } else {
      // Set renewal date to 1 month from now
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const renewalDate = nextMonth.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      setUsageStats(prev => ({
        ...prev,
        plan: tier,
        totalMinutes: features.totalMinutesLimit,
        minutesPerFileLimit: features.minutesPerFileLimit,
        renewalDate: renewalDate
      }));
    }

    if (tier !== 'guest' && !silent) {
      addNotification({
        title: 'Plan Upgraded',
        message: `Your account has been successfully upgraded to the ${tier.toUpperCase()} plan.`,
        type: 'success'
      });
    }
  }, [authStatus, user, addNotification]);

  const buyAddOn = useCallback((minutes: number) => {
    setUsageStats(prev => ({
      ...prev,
      totalMinutes: prev.totalMinutes + minutes
    }));

    addNotification({
      title: 'Minutes Added',
      message: `Successfully added ${minutes} minutes to your account.`,
      type: 'success'
    });
  }, []);

  const deductMinutes = useCallback(async (minutes: number) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      const newTotal = (userProfile?.minutesUsed || 0) + minutes;
      try {
        await updateDoc(doc(db, 'users', user.uid), { minutesUsed: newTotal });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      }
    } else {
      setUsageStats(prev => ({
        ...prev,
        usedMinutes: Math.min(prev.totalMinutes, prev.usedMinutes + minutes)
      }));
    }
  }, [authStatus, user, userProfile]);
  
  const [audioHistory, setAudioHistory] = useState<AudioToTextRecord[]>([]);
  const [textHistory, setTextHistory] = useState<TextToAudioRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  // Real-time Firestore listeners
  useEffect(() => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      const audioQuery = query(
        collection(db, 'audioRecords'),
        where('ownerUid', '==', user.uid),
        orderBy('date', 'desc')
      );
      const unsubscribeAudio = onSnapshot(audioQuery, (snapshot) => {
        const records = snapshot.docs.map(doc => doc.data() as AudioToTextRecord);
        setAudioHistory(records);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'audioRecords'));

      const textQuery = query(
        collection(db, 'textRecords'),
        where('ownerUid', '==', user.uid),
        orderBy('date', 'desc')
      );
      const unsubscribeText = onSnapshot(textQuery, (snapshot) => {
        const records = snapshot.docs.map(doc => doc.data() as TextToAudioRecord);
        setTextHistory(records);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'textRecords'));

      const projectsQuery = query(
        collection(db, 'projects'),
        where('ownerId', '==', user.uid)
      );
      const unsubscribeProjects = onSnapshot(projectsQuery, async (snapshot) => {
        const projs = snapshot.docs.map(doc => doc.data() as Project);
        setProjects(projs);
        
        // Safety check: if user doesn't have a "General" project, auto-create it
        const hasGeneral = projs.some(p => p.name.toLowerCase() === 'general');
        if (!hasGeneral && authStatus === AuthStatus.LOGGED_IN) {
          await addGroup('General');
        }
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'projects'));

      return () => {
        unsubscribeAudio();
        unsubscribeText();
        unsubscribeProjects();
      };
    } else {
      setAudioHistory([]);
      setTextHistory([]);
      setProjects([{
        id: 'general',
        name: 'General',
        ownerId: 'system',
        createdAt: new Date().toISOString()
      }]);
    }
  }, [authStatus, user]);

  const groups = Array.from(new Set([
    'General',
    ...(projects || []).map(p => p.name)
  ]));

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);

  // Global Audio State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentListenerRef = useRef<(() => void) | null>(null);
  const [playbackMetadata, setPlaybackMetadata] = useState<PlaybackMetadata | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('stopped');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  useEffect(() => {
    audioRef.current = new Audio();
    
    const audio = audioRef.current;
    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => setPlaybackStatus('stopped');

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
    };
  }, []);

  const clearSegmentListener = () => {
    if (segmentListenerRef.current && audioRef.current) {
      audioRef.current.removeEventListener('timeupdate', segmentListenerRef.current);
      segmentListenerRef.current = null;
    }
  };

  const setupSegmentListener = (endTime: number) => {
    clearSegmentListener();
    const checkEnd = () => {
      if (audioRef.current && audioRef.current.currentTime >= endTime) {
        audioRef.current.pause();
        setPlaybackStatus('stopped');
        clearSegmentListener();
      }
    };
    segmentListenerRef.current = checkEnd;
    audioRef.current?.addEventListener('timeupdate', checkEnd);
  };

  const handleGlobalPlay = (metadata: PlaybackMetadata, startTime: number = 0, endTime?: number) => {
    if (!audioRef.current) return;
    
    const isSameSource = playbackMetadata?.url === metadata.url;
    const isSameSegment = metadata.segmentIndex === playbackMetadata?.segmentIndex;
    
    if (isSameSource && playbackStatus === 'paused' && isSameSegment) {
      audioRef.current.play();
      setPlaybackStatus('playing');
      if (endTime !== undefined) {
        setupSegmentListener(endTime);
      }
      return;
    }

    // New playback or different segment
    audioRef.current.pause();
    clearSegmentListener();
    
    audioRef.current.src = metadata.url;
    audioRef.current.currentTime = startTime;
    
    setPlaybackMetadata(metadata);
    setPlaybackStatus('playing');

    // Trigger play after src update
    audioRef.current.play().catch(console.error);

    if (endTime !== undefined) {
      setupSegmentListener(endTime);
    }
  };

  const handleGlobalPause = () => {
    audioRef.current?.pause();
    setPlaybackStatus('paused');
  };

  const handleGlobalStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    clearSegmentListener();
    setPlaybackStatus('stopped');
    setPlaybackMetadata(null);
  };

  const handleGlobalSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const handleGlobalSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const handleAuth = (status: AuthStatus, profile?: UserProfile, rememberMe?: boolean) => {
    setAuthStatus(status);
    setUserProfile(profile);
    setCurrentTab(AppWorkflow.HOME);
    
    if (status === AuthStatus.GUEST) {
      setUsageStats({
        usedMinutes: 0,
        totalMinutes: 30,
        plan: 'guest',
        renewalDate: 'April 3, 2026',
        minutesPerFileLimit: 5
      });
      // Clear history for guest session
      setAudioHistory([]);
      setTextHistory([]);
    } else if (status === AuthStatus.LOGGED_IN && profile?.plan) {
      upgradePlan(profile.plan);
    }

    if (status === AuthStatus.LOGGED_IN && profile && rememberMe) {
      localStorage.setItem('remembered_user', JSON.stringify(profile));
    } else if (status === AuthStatus.LOGGED_IN && profile && !rememberMe) {
      localStorage.removeItem('remembered_user');
    }

    // Immediately redirect to app if we're on the auth page and auth is successful
    if (location.pathname === '/auth' && (status === AuthStatus.LOGGED_IN || status === AuthStatus.GUEST)) {
      navigate('/app');
    }
  };

  const handleLogout = async () => {
    if (auth) {
      await auth.signOut();
    }
    setAuthStatus(AuthStatus.UNAUTHENTICATED);
    setUserProfile(undefined);
    setCurrentTab(AppWorkflow.HOME);
    setSelectedGroupFilter(null);
    setShowSettings(false);
    handleGlobalStop();
    localStorage.removeItem('remembered_user');
    localStorage.removeItem('echonote_remember_me');
  };

  const sanitize = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);
    
    const newObj: any = {};
    Object.keys(obj).forEach(key => {
      if (obj[key] !== undefined) {
        newObj[key] = sanitize(obj[key]);
      }
    });
    return newObj;
  };

  const saveAudioRecord = useCallback(async (record: AudioToTextRecord) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      const groupName = record.group || 'General';
      const project = projects.find(p => p.name.toLowerCase() === groupName.toLowerCase());
      const recordWithUid = sanitize({ 
        ...record, 
        ownerUid: user.uid,
        group: groupName,
        projectId: project?.id || null
      });
      try {
        await setDoc(doc(db, 'audioRecords', record.id), recordWithUid);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `audioRecords/${record.id}`);
      }
    }
  }, [authStatus, user, projects]);

  const saveTextRecord = useCallback(async (record: TextToAudioRecord) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      const groupName = record.group || 'General';
      const project = projects.find(p => p.name.toLowerCase() === groupName.toLowerCase());
      const recordWithUid = sanitize({ 
        ...record, 
        ownerUid: user.uid,
        group: groupName,
        projectId: project?.id || null
      });
      try {
        await setDoc(doc(db, 'textRecords', record.id), recordWithUid);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `textRecords/${record.id}`);
      }
    }
  }, [authStatus, user, projects]);

  const updateAudioRecord = async (updated: AudioToTextRecord) => {
    try {
      const project = projects.find(p => p.name.toLowerCase() === (updated.group || 'General').toLowerCase());
      const dataToUpdate = {
        ...updated,
        projectId: project?.id || null
      };
      await updateDoc(doc(db, 'audioRecords', updated.id), sanitize(dataToUpdate) as any);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `audioRecords/${updated.id}`);
    }
  };

  const updateTextRecord = async (updated: TextToAudioRecord) => {
    try {
      const project = projects.find(p => p.name.toLowerCase() === (updated.group || 'General').toLowerCase());
      const dataToUpdate = {
        ...updated,
        projectId: project?.id || null
      };
      await updateDoc(doc(db, 'textRecords', updated.id), sanitize(dataToUpdate) as any);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `textRecords/${updated.id}`);
    }
  };

  const deleteAudioRecord = async (id: string) => {
    try {
      await updateDoc(doc(db, 'audioRecords', id), { deletedAt: new Date().toISOString() });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `audioRecords/${id}`);
    }
  };

  const deleteTextRecord = async (id: string) => {
    try {
      await updateDoc(doc(db, 'textRecords', id), { deletedAt: new Date().toISOString() });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `textRecords/${id}`);
    }
  };

  const permanentlyDeleteAudioRecord = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'audioRecords', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `audioRecords/${id}`);
    }
  };

  const permanentlyDeleteTextRecord = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'textRecords', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `textRecords/${id}`);
    }
  };

  const restoreAudioRecord = async (id: string) => {
    try {
      await updateDoc(doc(db, 'audioRecords', id), { deletedAt: null });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `audioRecords/${id}`);
    }
  };

  const restoreTextRecord = async (id: string) => {
    try {
      await updateDoc(doc(db, 'textRecords', id), { deletedAt: null });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `textRecords/${id}`);
    }
  };

  const bulkDeleteAudioRecords = async (ids: string[]) => {
    for (const id of ids) {
      await deleteAudioRecord(id);
    }
  };

  const bulkDeleteTextRecords = async (ids: string[]) => {
    for (const id of ids) {
      await deleteTextRecord(id);
    }
  };

  const markNotificationRead = (id: string) => {
    const notif = notifications.find(n => n.id === id);
    if (!notif) return;

    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    
    if (notif.link) {
      navigate(notif.link);
    } else if (notif.recordId) {
      setSelectedRecordId(notif.recordId);
      setCurrentTab(AppWorkflow.HISTORY);
    }
  };

  const clearNotifications = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [lastCreatedProjectId, setLastCreatedProjectId] = useState<string | null>(null);

  const addGroup = async (name: string) => {
    if (!name.trim()) return null;
    const existing = projects.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      const id = Math.random().toString(36).substr(2, 9);
      const isDefault = name === 'General';
      const newProject: Project = {
        id,
        name,
        ownerId: user?.uid || 'guest',
        ownerEmail: user?.email || 'guest',
        isDefault,
        members: [],
        createdAt: new Date().toISOString()
      };
      
      if (authStatus === AuthStatus.LOGGED_IN && user) {
        try {
          await setDoc(doc(db, 'projects', id), newProject);
          setLastCreatedProjectId(id);
          return id;
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `projects/${id}`);
        }
      } else {
        setProjects(prev => [...prev, newProject]);
        setLastCreatedProjectId(id);
        return id;
      }
    }
    return existing?.id || null;
  };

  const renameGroup = async (oldName: string, newName: string) => {
    const project = projects.find(p => p.name === oldName);
    if (project?.isDefault) return; 
    if (project && authStatus === AuthStatus.LOGGED_IN) {
      try {
        await updateDoc(doc(db, 'projects', project.id), { name: newName });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `projects/${project.id}`);
      }
    }
    
    if (selectedGroupFilter === oldName) setSelectedGroupFilter(newName);
  };

  const deleteGroup = async (name: string, deleteAssets: boolean = false) => {
    const project = projects.find(p => p.name === name);
    if (project?.isDefault) return;
    
    if (project && authStatus === AuthStatus.LOGGED_IN) {
      try {
        await deleteDoc(doc(db, 'projects', project.id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `projects/${project.id}`);
      }
    }
    
    if (selectedGroupFilter === name) setSelectedGroupFilter(null);
  };

  const inviteToProject = (projectName: string, email: string, role: CollaborationRole) => {
    if (usageStats.plan === 'guest' || usageStats.plan === 'free') {
      alert("Collaboration features are only available in Pro and Enterprise plans.");
      return;
    }

    const project = projects.find(p => p.name === projectName);
    if (usageStats.plan === 'pro' && project && (project.members || []).length >= 3) {
      alert("Pro plan is limited to 3 collaborators per project. Upgrade to Enterprise for unlimited team members.");
      return;
    }
    
    setProjects(prev => (prev || []).map(p => {
      if (p.name === projectName) {
        const members = p.members || [];
        const existingMember = members.find(m => m.email === email);
        if (existingMember) {
          return {
            ...p,
            members: members.map(m => m.email === email ? { ...m, role } : m)
          };
        }
        return {
          ...p,
          members: [...members, { email, role, status: 'not-read', isOnline: Math.random() > 0.5 }]
        };
      }
      return p;
    }));
  };

  const selectGroup = (name: string | null) => {
    setSelectedGroupFilter(name);
    // Only switch to HISTORY tab if we are selecting a specific project
    if (name !== null) {
      setCurrentTab(AppWorkflow.HISTORY);
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [decisionIntelligenceInitialInput, setDecisionIntelligenceInitialInput] = useState<{ text: string; type: 'transcript' | 'summary' } | undefined>(undefined);

  const handleReuseDecision = (text: string, type: 'transcript' | 'summary') => {
    setDecisionIntelligenceInitialInput({ text, type });
    setCurrentTab(AppWorkflow.DECISION_INTELLIGENCE);
  };

  const renderContent = () => {
    if (currentTab === AppWorkflow.HISTORY && authStatus === AuthStatus.GUEST) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-8 animate-in fade-in duration-700">
          <div className="w-24 h-24 bg-brand-background rounded-lg flex items-center justify-center text-brand-primary text-4xl shadow-inner border border-brand-divider/20">
            <i className="fa-solid fa-lock"></i>
          </div>
          <div className="space-y-4 max-w-md">
            <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Archive Restricted</h2>
            <p className="text-slate-600 text-[16px] font-medium">Enterprise authentication is required to access the Intelligence Archive and collaboration tools.</p>
          </div>
          <button onClick={handleLogout} className="px-10 py-4 bg-brand-primary text-white rounded-lg font-semibold uppercase tracking-widest text-[13px] shadow-xl hover:opacity-90 active:scale-95 transition-all">
            Sign In for History
          </button>
        </div>
      );
    }

    switch (currentTab) {
      case AppWorkflow.HOME:
        return <HomeView setTab={setCurrentTab} authStatus={authStatus} userProfile={userProfile} onSignInClick={handleLogout} onAddGroup={addGroup} />;
      case AppWorkflow.AUDIO_TO_TEXT:
        return (
          <AudioToTextView 
            onSave={saveAudioRecord} 
            groups={groups} 
            projects={projects}
            onAddGroup={addGroup} 
            onInviteToProject={inviteToProject}
            authStatus={authStatus} 
            userProfile={userProfile} 
            onNewProject={() => setIsCreateProjectModalOpen(true)}
            lastCreatedProjectId={lastCreatedProjectId}
            activePlaybackId={playbackMetadata?.id}
            activePlaybackSegIdx={playbackMetadata?.segmentIndex}
            playbackStatus={playbackStatus}
            onPlay={handleGlobalPlay}
            onPause={handleGlobalPause}
            onStop={handleGlobalStop}
            addNotification={addNotification}
            usageStats={usageStats}
            onDeductMinutes={deductMinutes}
            onUpgradeClick={() => setCurrentTab(AppWorkflow.SUBSCRIPTION)}
            onBuyAddOnClick={() => setCurrentTab(AppWorkflow.SUBSCRIPTION)}
            onSignInClick={handleLogout}
            searchTerm={searchQuery}
          />
        );
      case AppWorkflow.TEXT_TO_AUDIO:
        return (
          <TextToAudioView 
            onSave={saveTextRecord} 
            groups={groups} 
            projects={projects}
            onAddGroup={addGroup} 
            authStatus={authStatus}
            userProfile={userProfile}
            onNewProject={() => setIsCreateProjectModalOpen(true)}
            lastCreatedProjectId={lastCreatedProjectId}
            activePlaybackId={playbackMetadata?.id}
            playbackStatus={playbackStatus}
            onPlay={handleGlobalPlay}
            onPause={handleGlobalPause}
            addNotification={addNotification}
          />
        );
      case AppWorkflow.DECISION_INTELLIGENCE:
        return (
          <DecisionIntelligence 
            audioHistory={audioHistory}
            authStatus={authStatus}
            userProfile={userProfile}
            addNotification={addNotification}
            initialInput={decisionIntelligenceInitialInput}
          />
        );
      case AppWorkflow.DECISION_HISTORY:
        if (authStatus === AuthStatus.GUEST) {
          return (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-8 animate-in fade-in duration-700">
              <div className="w-24 h-24 bg-brand-background rounded-lg flex items-center justify-center text-brand-primary text-4xl shadow-inner border border-brand-divider/20">
                <i className="fa-solid fa-lock"></i>
              </div>
              <div className="space-y-4 max-w-md">
                <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">History Restricted</h2>
                <p className="text-slate-600 text-[16px] font-medium">Enterprise authentication is required to access the Decision History.</p>
              </div>
              <button onClick={handleLogout} className="px-10 py-4 bg-brand-primary text-white rounded-lg font-semibold uppercase tracking-widest text-[13px] shadow-xl hover:opacity-90 active:scale-95 transition-all">
                Sign In for History
              </button>
            </div>
          );
        }
        return (
          <DecisionHistory 
            userProfile={userProfile!}
            addNotification={addNotification}
            onReuse={handleReuseDecision}
          />
        );
      case AppWorkflow.SUBSCRIPTION:
        return (
          <SubscriptionView 
            usageStats={usageStats}
            onUpgrade={upgradePlan}
            onBuyAddOn={buyAddOn}
            authStatus={authStatus}
            onSignInClick={handleLogout}
            addNotification={addNotification}
          />
        );
      case AppWorkflow.HISTORY:
        return (
          <HistoryDashboard 
            audioHistory={audioHistory} 
            textHistory={textHistory} 
            groups={groups}
            filterGroup={selectedGroupFilter}
            authStatus={authStatus}
            userProfile={userProfile}
            onClearFilter={() => setSelectedGroupFilter(null)}
            onUpdateAudio={updateAudioRecord} 
            onUpdateText={updateTextRecord}
            onDeleteAudio={deleteAudioRecord} 
            onDeleteText={deleteTextRecord}
            onPermanentlyDeleteAudio={permanentlyDeleteAudioRecord}
            onPermanentlyDeleteText={permanentlyDeleteTextRecord}
            onRestoreAudio={restoreAudioRecord}
            onRestoreText={restoreTextRecord}
            onBulkDeleteAudio={bulkDeleteAudioRecords}
            onBulkDeleteText={bulkDeleteTextRecords}
            onRenameGroup={renameGroup}
            onDeleteGroup={deleteGroup}
            onAddGroup={() => setIsCreateProjectModalOpen(true)}
            onInviteToProject={inviteToProject}
            projects={projects}
            activePlaybackId={playbackMetadata?.id}
            activePlaybackSegIdx={playbackMetadata?.segmentIndex}
            playbackStatus={playbackStatus}
            onPlay={handleGlobalPlay}
            onPause={handleGlobalPause}
            onStop={handleGlobalStop}
            onSetFilterGroup={setSelectedGroupFilter}
            selectedRecordId={selectedRecordId}
            onClearSelectedRecord={() => setSelectedRecordId(null)}
            onRecordExpand={setActiveRecordId}
            usageStats={usageStats}
            searchQuery={searchQuery}
            addNotification={addNotification}
          />
        );
      default:
        return null;
    }
  };

  const renderDashboard = () => {
    return (
      <div className="flex flex-col md:flex-row md:h-screen bg-brand-background text-brand-primary">
        {showSettings && (
          <AuthView onAuth={handleAuth} isSettingsMode onCloseSettings={() => setShowSettings(false)} onLogout={handleLogout} userProfile={userProfile} onBackToHome={handleBackToHome} />
        )}
        
        {/* Project Creation Modal */}
        {isCreateProjectModalOpen && (
          <div className="fixed inset-0 bg-brand-primary/60 backdrop-blur-sm z-[300] flex items-center justify-center p-6">
            <div className="bg-white rounded-xl p-8 max-w-md w-full space-y-6 shadow-2xl animate-in zoom-in-95">
              <div className="space-y-2">
                <h2 className="text-brand-primary text-2xl font-semibold">Create New Project</h2>
                <p className="text-slate-500 text-sm">Organize your assets into a new workspace.</p>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-widest mb-2">Project Name</label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g. Marketing Q2, Personal Notes..."
                    className="w-full px-4 py-3 rounded-lg bg-slate-50 border border-slate-200 focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary focus:outline-none transition-all"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newProjectName.trim()) {
                        addGroup(newProjectName.trim());
                        setNewProjectName('');
                        setIsCreateProjectModalOpen(false);
                      }
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => {
                    setIsCreateProjectModalOpen(false);
                    setNewProjectName('');
                  }}
                  className="flex-1 py-3 text-sm font-medium text-slate-500 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (newProjectName.trim()) {
                      await addGroup(newProjectName.trim());
                      setNewProjectName('');
                      setIsCreateProjectModalOpen(false);
                    }
                  }}
                  disabled={!newProjectName.trim()}
                  className="flex-1 py-3 bg-brand-primary text-white rounded-lg font-medium text-sm disabled:opacity-50 transition-all shadow-lg active:scale-[0.98]"
                >
                  Create Project
                </button>
              </div>
            </div>
          </div>
        )}

        <Navigation 
          currentTab={currentTab} 
          setTab={(tab) => { 
            setCurrentTab(tab); 
            setSelectedGroupFilter(null); 
          }}
          groups={groups}
          projects={projects}
          onSelectGroup={selectGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={deleteGroup}
          onInviteToProject={inviteToProject}
          selectedGroupFilter={selectedGroupFilter}
          authStatus={authStatus} 
          userProfile={userProfile}
          onSignInClick={handleLogin}
          onAddGroup={() => setIsCreateProjectModalOpen(true)}
          onOpenSettings={() => setShowSettings(true)}
          notifications={notifications}
          onMarkNotificationRead={markNotificationRead}
          onClearNotifications={clearNotifications}
          usageStats={usageStats}
        />
        
        <main className="flex-1 overflow-y-auto custom-scrollbar bg-brand-background relative">
          <Topbar 
            usageStats={usageStats} 
            userProfile={userProfile} 
            authStatus={authStatus} 
            onNavigateToSubscription={() => setCurrentTab(AppWorkflow.SUBSCRIPTION)}
            onLogout={handleLogout}
            onOpenSettings={() => setShowSettings(true)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            showSearch={currentTab === AppWorkflow.HISTORY}
            selectedProjectName={selectedGroupFilter}
          />
          
          {usageStats.usedMinutes / usageStats.totalMinutes >= 0.75 && usageStats.usedMinutes / usageStats.totalMinutes < 1 && (
            <div className="bg-amber-50 border-b border-amber-100 px-8 py-3 flex items-center justify-between animate-in slide-in-from-top duration-500">
              <div className="flex items-center space-x-3">
                <i className="fa-solid fa-circle-exclamation text-amber-500"></i>
                <p className="text-[13px] font-semibold text-amber-800">
                  Approaching your monthly transcription limit.
                </p>
              </div>
              <button 
                onClick={() => setCurrentTab(AppWorkflow.SUBSCRIPTION)}
                className="text-[11px] font-semibold tracking-widest text-amber-600 hover:underline"
              >
                Upgrade plan
              </button>
            </div>
          )}
          
          <div className="max-w-7xl mx-auto p-6 sm:p-12 md:p-16 lg:p-24 pb-48">
            {renderContent()}
          </div>
          
          <GlobalPlayer 
            metadata={playbackMetadata}
            status={playbackStatus}
            currentTime={currentTime}
            duration={duration}
            playbackSpeed={playbackSpeed}
            onPlayPause={() => playbackStatus === 'playing' ? handleGlobalPause() : playbackMetadata && handleGlobalPlay(playbackMetadata)}
            onStop={handleGlobalStop}
            onSeek={handleGlobalSeek}
            onSpeedChange={handleGlobalSpeedChange}
            authStatus={authStatus}
          />
        </main>

        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white text-brand-primary flex justify-around p-4 shadow-2xl border-t border-brand-divider/20 z-30">
          <button onClick={() => { setCurrentTab(AppWorkflow.HOME); setSelectedGroupFilter(null); }} className={`flex flex-col items-center space-y-1 ${currentTab === AppWorkflow.HOME ? 'text-brand-accent' : 'text-slate-400'}`}>
            <i className="fa-solid fa-house"></i>
            <span className="text-[11px] font-medium">Home</span>
          </button>
          <button onClick={() => { setCurrentTab(AppWorkflow.AUDIO_TO_TEXT); setSelectedGroupFilter(null); }} className={`flex flex-col items-center space-y-1 ${currentTab === AppWorkflow.AUDIO_TO_TEXT ? 'text-brand-accent' : 'text-slate-400'}`}>
            <i className="fa-solid fa-microphone"></i>
            <span className="text-[11px] font-medium">Transcribe</span>
          </button>
          <button onClick={() => { setCurrentTab(AppWorkflow.HISTORY); setSelectedGroupFilter(null); }} className={`flex flex-col items-center space-y-1 ${currentTab === AppWorkflow.HISTORY ? 'text-brand-accent' : 'text-slate-400'}`}>
            <i className="fa-solid fa-box-archive"></i>
            <span className="text-[11px] font-medium">Archive</span>
          </button>
        </div>
      </div>
    );
  };

  const renderPublicPage = (content: React.ReactNode) => {
    return (
      <div className="min-h-screen flex flex-col bg-brand-background">
        <LandingNavbar 
          onLogin={handleLogin} 
          onGoToDashboard={handleGoToDashboard}
          authStatus={authStatus}
        />
        <main className="flex-1">
          {content}
        </main>
        <LandingFooter />
      </div>
    );
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-brand-background flex items-center justify-center">
        <div className="flex flex-col items-center space-y-6">
          <div className="w-16 h-16 bg-brand-primary rounded-2xl flex items-center justify-center text-white shadow-2xl animate-pulse overflow-hidden backdrop-blur-sm border border-white/10">
            <img 
              src="/Logo-2.png" 
              alt="EchoNote" 
              className="h-10 w-10 object-contain" 
            />
          </div>
          <div className="flex flex-col items-center space-y-2">
            <span className="text-xl font-bold text-brand-primary tracking-tight">EchoNote</span>
            <p className="text-brand-text-secondary text-[11px] font-bold tracking-[0.2em] uppercase">Initializing Security</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={renderPublicPage(<Home onLogin={handleLogin} onStartFree={handleStartFree} onNavigateToDemo={handleNavigateToDemo} authStatus={authStatus} onGoToDashboard={handleGoToDashboard} />)} />
        <Route path="/features" element={renderPublicPage(<Features onLogin={handleLogin} onStartFree={handleStartFree} onNavigateToDemo={handleNavigateToDemo} authStatus={authStatus} />)} />
        <Route path="/solutions" element={renderPublicPage(<Solutions onLogin={handleLogin} onStartFree={handleStartFree} onNavigateToDemo={handleNavigateToDemo} authStatus={authStatus} />)} />
        <Route path="/pricing" element={renderPublicPage(<Pricing onLogin={handleLogin} onStartFree={handleStartFree} onNavigateToDemo={handleNavigateToDemo} authStatus={authStatus} />)} />
        <Route path="/contact" element={renderPublicPage(<ContactPage />)} />
        <Route path="/demo" element={renderPublicPage(<BookDemoPage />)} />
        <Route path="/test" element={renderPublicPage(<TestDashboard />)} />
        <Route path="/privacy" element={renderPublicPage(<PrivacyPolicy />)} />
        <Route path="/terms" element={renderPublicPage(<TermsOfService />)} />
        <Route path="/security" element={renderPublicPage(<SecurityPage />)} />
        
        {/* Auth Route */}
        <Route path="/auth" element={
          <div className="min-h-screen bg-brand-background">
            <nav className="px-6 py-4">
              <div 
                className="flex items-center gap-3 cursor-pointer group w-fit"
                onClick={handleBackToHome}
              >
                <img 
                  src="/Logo-1.jpg" 
                  alt="EchoNote" 
                  className="h-12 w-auto object-contain"
                />
                <span className="text-xl font-bold text-[#1B2A4E] tracking-tight">
                  EchoNote
                </span>
              </div>
            </nav>
            <AuthView onAuth={handleAuth} userProfile={userProfile} onBackToHome={handleBackToHome} />
          </div>
        } />

        {/* App Route */}
        <Route path="/app" element={
          authStatus === AuthStatus.LOGGED_IN || authStatus === AuthStatus.GUEST 
            ? (
              <>
                {renderDashboard()}
                {/* Toast Container */}
                <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-3 pointer-events-none">
                  {toasts.map(toast => (
                    <div 
                      key={toast.id}
                      className={`pointer-events-auto min-w-[300px] max-w-md p-4 rounded-xl shadow-2xl border flex items-start gap-4 animate-in slide-in-from-right duration-300 ${
                        toast.type === 'error' ? 'bg-red-50 border-red-100' : 
                        toast.type === 'success' ? 'bg-emerald-50 border-emerald-100' : 
                        'bg-white border-brand-divider/20'
                      }`}
                    >
                      <div className={`mt-1 ${
                        toast.type === 'error' ? 'text-red-500' : 
                        toast.type === 'success' ? 'text-emerald-500' : 
                        'text-brand-primary'
                      }`}>
                        <i className={`fa-solid ${
                          toast.type === 'error' ? 'fa-circle-exclamation' : 
                          toast.type === 'success' ? 'fa-circle-check' : 
                          'fa-circle-info'
                        }`}></i>
                      </div>
                      <div className="flex-1">
                        <p className={`text-[13px] font-bold ${
                          toast.type === 'error' ? 'text-red-900' : 
                          toast.type === 'success' ? 'text-emerald-900' : 
                          'text-brand-primary'
                        }`}>{toast.title}</p>
                        <p className={`text-[11px] mt-0.5 ${
                          toast.type === 'error' ? 'text-red-700' : 
                          toast.type === 'success' ? 'text-emerald-700' : 
                          'text-slate-500'
                        }`}>{toast.message}</p>
                      </div>
                      <button 
                        onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <i className="fa-solid fa-xmark text-xs"></i>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )
            : <Navigate to="/auth" replace />
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <EchoNoteAssistant 
        context={{
          current_page: currentTab,
          current_project: selectedGroupFilter || 'All Projects',
          selected_file_name: audioHistory.find(r => r.id === activeRecordId)?.name || textHistory.find(r => r.id === activeRecordId)?.name || 'None',
          transcript_text: audioHistory.find(r => r.id === activeRecordId)?.transcript || 'None',
          summary: audioHistory.find(r => r.id === activeRecordId)?.summary || 'None',
          user_plan: usageStats.plan,
          minutes_used: usageStats.usedMinutes,
          minutes_remaining: usageStats.totalMinutes - usageStats.usedMinutes
        }}
        actions={{
          summarizeTranscript: () => {
            if (activeRecordId) {
              setCurrentTab(AppWorkflow.AUDIO_TO_TEXT);
              // In a real app, we'd trigger the summary logic here
              addToast('AI Action', 'Summarizing transcript...', 'info');
            } else {
              addToast('AI Action', 'Please select a file first.', 'error');
            }
          },
          runThinkingEngine: () => {
            if (activeRecordId) {
              const record = audioHistory.find(r => r.id === activeRecordId);
              if (record) {
                handleReuseDecision(record.transcript, 'transcript');
                addToast('AI Action', 'Running thinking engine...', 'info');
              }
            } else {
              addToast('AI Action', 'Please select a file first.', 'error');
            }
          },
          extractDecisions: () => {
            if (activeRecordId) {
              const record = audioHistory.find(r => r.id === activeRecordId);
              if (record) {
                handleReuseDecision(record.transcript, 'transcript');
                addToast('AI Action', 'Extracting decisions...', 'info');
              }
            } else {
              addToast('AI Action', 'Please select a file first.', 'error');
            }
          },
          assignToProject: () => {
            if (activeRecordId) {
              addToast('AI Action', 'Opening project selector...', 'info');
              // Logic to open project selector
            } else {
              addToast('AI Action', 'Please select a file first.', 'error');
            }
          }
        }}
      />
    </>
  );
};

export default App;
