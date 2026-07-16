
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
import { AdminTrackerView } from './components/AdminTrackerView';
import GlobalPlayer from './components/GlobalPlayer';
import LandingNavbar from './components/LandingNavbar';
import LandingFooter from './components/LandingFooter';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfService from './components/TermsOfService';
import SecurityPage from './components/SecurityPage';
import ContactPage from './components/ContactPage';
import BookDemoPage from './components/BookDemoPage';
import JoinPage from './pages/JoinPage';
import PricingPage from './pages/PricingPage';
import EchoNoteAssistant from './components/EchoNoteAssistant';
import Home from './pages/Home';
import Features from './pages/Features';
import Solutions from './pages/Solutions';
import SubscriptionModal from './components/SubscriptionModal';
import { CollaborationDashboard } from './components/CollaborationDashboard';
import { OrganizationDashboard } from './components/OrganizationDashboard';
import { AppWorkflow, AudioToTextRecord, TextToAudioRecord, AuthStatus, UserProfile, PlaybackMetadata, PlaybackStatus, AppNotification, UsageStats, SubscriptionTier, Project, ProjectMember, CollaborationRole, MainView, ProjectActivity, OrgRole, OrgMember, Team } from './types';
import { PLAN_FEATURES } from './config/planConfig';
import { useFirebase } from './components/FirebaseProvider';
import { Toaster } from 'sonner';
import { auth, db, collection, query, where, getDocs, onSnapshot, doc, setDoc, updateDoc, deleteDoc, orderBy, handleFirestoreError, OperationType, serverTimestamp, getDoc, increment, addDoc } from './firebase';
import { summarizeTranscript, analyzeDecisionIntelligence, analyzeStrategically } from './services/geminiService';
import { getMinutesUsage, getThinkingUsage, formatRefreshDate } from './lib/usageUtils';

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

  const isGuest = authStatus === AuthStatus.GUEST || profile?.plan === 'guest';
  const isFree = authStatus === AuthStatus.LOGGED_IN && profile?.plan === 'free';

  useEffect(() => {
    console.log("User plan:", profile?.plan || (authStatus === AuthStatus.GUEST ? 'guest' : 'unknown'));
  }, [authStatus, profile]);

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
        
        // Handle redirect after login (e.g. from invitation)
        const redirectPath = localStorage.getItem('redirectAfterLogin');
        if (redirectPath) {
          localStorage.removeItem('redirectAfterLogin');
          navigate(redirectPath);
          return;
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
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
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
    totalMinutes: PLAN_FEATURES.free.totalMinutesLimit,
    aiRequestCount: 0,
    aiRequestLimit: PLAN_FEATURES.free.aiRequestLimit,
    thinkingLimit: PLAN_FEATURES.free.thinkingLimit,
    plan: 'free',
    mode: 'free', // Legacy support
    renewalDate: 'May 1, 2026',
    minutesPerFileLimit: PLAN_FEATURES.free.minutesPerFileLimit
  });

  useEffect(() => {
    if (userProfile) {
      const tier = userProfile.plan || 'free';
      const features = PLAN_FEATURES[tier];
      
      const mUsage = getMinutesUsage(userProfile);
      const tUsage = getThinkingUsage(userProfile);
      
      setUsageStats({
        usedMinutes: mUsage.used,
        totalMinutes: mUsage.limit,
        extraMinutes: userProfile.extraMinutes || 0,
        aiRequestCount: tUsage.used,
        aiRequestLimit: tUsage.limit,
        thinkingLimit: tUsage.limit,
        plan: tier,
        mode: tier === 'guest' ? 'guest' : 'free',
        renewalDate: formatRefreshDate(userProfile.nextRefreshDate),
        minutesPerFileLimit: features.minutesPerFileLimit
      });

      // Auto-trigger upgrade modal if limits are reached for free plan
      if (tier === 'free') {
        if (mUsage.isExceeded || tUsage.isExceeded) {
          const hasShown = sessionStorage.getItem('upgrade_modal_shown');
          if (!hasShown) {
            setShowUpgradeModal(true);
            sessionStorage.setItem('upgrade_modal_shown', 'true');
          }
        }
      }
    }
  }, [userProfile]);

  const checkThinkingLimit = useCallback(() => {
    if (!userProfile) return true;
    const tUsage = getThinkingUsage(userProfile);

    if (tUsage.isExceeded) {
      console.log("Thinking usage limit reached:", tUsage.used, "/", tUsage.limit);
      return false;
    }
    return true;
  }, [userProfile]);

  const checkTranscriptionLimit = useCallback((estimatedMinutes: number) => {
    if (!userProfile) return true;
    const mUsage = getMinutesUsage(userProfile);

    if (mUsage.used + estimatedMinutes > mUsage.limit) {
      addNotification({
        title: 'Transcription Limit Reached',
        message: `You don't have enough minutes left for this transcription.`,
        type: 'error'
      });
      return false;
    }
    return true;
  }, [userProfile, addNotification]);

  const incrementThinkingUsage = useCallback(async () => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      const userRef = doc(db, 'users', user.uid);
      
      try {
        const tier = userProfile?.plan || 'free';
        const limit = PLAN_FEATURES[tier].thinkingLimit;
        const currentUsage = userProfile?.thinkingUsed || 0;

        console.log("Thinking usage check:", currentUsage, "/", limit);

        if (limit !== 'unlimited' && currentUsage >= (limit as number)) {
          throw new Error("❌ Thinking limit exceeded");
        }

        await updateDoc(userRef, { 
          thinkingUsed: increment(1)
        });
        
        console.log("✅ Thinking usage incremented");
      } catch (error) {
        console.error("❌ Failed to increment thinking usage:", error);
      }
    } else {
      setUsageStats(prev => ({
        ...prev,
        aiRequestCount: prev.aiRequestCount + 1
      }));
    }
  }, [authStatus, user, userProfile]);

  const incrementTranscriptionUsage = useCallback(async (minutes: number) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      const userRef = doc(db, 'users', user.uid);
      
      try {
        await updateDoc(userRef, { 
          minutesUsed: increment(minutes)
        });
        
        console.log("✅ Transcription usage incremented by:", minutes);
      } catch (error) {
        console.error("❌ Failed to increment transcription usage:", error);
      }
    } else {
      setUsageStats(prev => ({
        ...prev,
        usedMinutes: prev.usedMinutes + minutes
      }));
    }
  }, [authStatus, user]);

  const deductMinutes = useCallback(async (minutes: number) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        await updateDoc(doc(db, 'users', user.uid), { 
          minutesUsed: increment(minutes) 
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      }
    } else {
      setUsageStats(prev => ({
        ...prev,
        usedMinutes: prev.usedMinutes + minutes
      }));
    }
  }, [authStatus, user]);
  
  const [audioHistory, setAudioHistory] = useState<AudioToTextRecord[]>([]);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [textHistory, setTextHistory] = useState<TextToAudioRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  // Organization, Teams, and Roles States
  const [currentOrg, setCurrentOrg] = useState<any>(null);
  const [currentOrgMember, setCurrentOrgMember] = useState<OrgMember | null>(null);
  const [orgTeams, setOrgTeams] = useState<Team[]>([]);
  const [userOrgRole, setUserOrgRole] = useState<OrgRole>('viewer');

  const [manualAnalyticsTrigger, setManualAnalyticsTrigger] = useState(0);

  const handleAnalyticsUpdate = useCallback(() => {
    setManualAnalyticsTrigger(prev => prev + 1);
  }, []);
  // Real-time Firestore listeners
  useEffect(() => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      setLoadingArchive(true);
      
      const audioQuery = query(
        collection(db, 'recordings'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
      
      const unsubscribeAudio = onSnapshot(audioQuery, (snapshot) => {
        const audioRecords = snapshot.docs.map(doc => doc.data() as AudioToTextRecord);
        setAudioHistory(audioRecords);
        setLoadingArchive(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'recordings', false);
        setLoadingArchive(false);
      });

      const textQuery = query(
        collection(db, 'transcriptions'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
      
      const unsubscribeText = onSnapshot(textQuery, (snapshot) => {
        const textRecords = snapshot.docs.map(doc => doc.data() as TextToAudioRecord);
        setTextHistory(textRecords);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'transcriptions', false);
      });

      // Fetch projects based on permissions (super_admins see all, standard/org users see their own)
      const allProjectsQuery = (userOrgRole === 'super_admin')
        ? query(collection(db, 'projects'))
        : query(collection(db, 'projects'), where('userId', '==', user.uid));
      
      // Fetch projects the user IS A MEMBER OF
      const sharedProjectsQuery = query(
        collection(db, 'projectMembers'),
        where('userId', '==', user.uid)
      );

      let allProjectsList: Project[] = [];
      let sharedProjectMemberships: ProjectMember[] = [];

      const updateMergedProjects = () => {
        let visibleProjects: Project[] = [];

        if (userOrgRole === 'super_admin') {
          visibleProjects = [...allProjectsList];
        } else if (currentOrg) {
          const orgOwnerEmail = currentOrg.ownerEmail;
          const orgTeamProjIds = new Set(orgTeams.flatMap(t => t.projectIds || []));

          if (userOrgRole === 'org_admin') {
            // Org Admins see all projects belonging to the org
            visibleProjects = allProjectsList.filter(p => 
              p.userId === user.uid || 
              p.ownerEmail === orgOwnerEmail || 
              orgTeamProjIds.has(p.id)
            );
          } else if (userOrgRole === 'team_manager') {
            // Team Managers see assigned projects, plus owned or shared projects
            visibleProjects = allProjectsList.filter(p => 
              p.userId === user.uid || 
              orgTeamProjIds.has(p.id) ||
              sharedProjectMemberships.some(m => m.projectId === p.id)
            );
          } else {
            // Members and Viewers see projects assigned to their specific team, or owned, or explicitly shared
            const userTeamId = currentOrgMember?.teamId;
            const userTeams = userTeamId ? orgTeams.filter(t => t.id === userTeamId) : orgTeams;
            const teamProjIds = new Set(userTeams.flatMap(t => t.projectIds || []));
            
            visibleProjects = allProjectsList.filter(p => 
              p.userId === user.uid || 
              teamProjIds.has(p.id) ||
              sharedProjectMemberships.some(m => m.projectId === p.id)
            );
          }
        } else {
          // Personal scope: owned + shared
          visibleProjects = allProjectsList.filter(p => 
            p.userId === user.uid || 
            sharedProjectMemberships.some(m => m.projectId === p.id)
          );
        }

        // Add shared projects if not already present
        sharedProjectMemberships.forEach(membership => {
          if (!visibleProjects.find(p => p.id === membership.projectId)) {
            const originalProj = allProjectsList.find(p => p.id === membership.projectId);
            visibleProjects.push(originalProj || {
              id: membership.projectId,
              name: (membership as any).projectName || 'Shared Project',
              userId: 'shared',
              ownerEmail: 'Team',
              members: [],
              createdAt: membership.joinedAt
            });
          }
        });

        // Ensure General project is always present or created
        const hasGeneral = visibleProjects.some(p => p.name.toLowerCase() === 'general');
        if (!hasGeneral && visibleProjects.length > 0) {
          // Keep General at the top if possible
        }

        setProjects(visibleProjects);
      };

      const unsubscribeAllProjects = onSnapshot(allProjectsQuery, (snapshot) => {
        allProjectsList = snapshot.docs.map(doc => doc.data() as Project);
        updateMergedProjects();

        const hasGeneral = allProjectsList.some(p => p.name.toLowerCase() === 'general');
        if (!hasGeneral) {
          addGroup('General').catch(err => console.error("Auto-create General failed", err));
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'projects', false);
      });

      const unsubscribeShared = onSnapshot(sharedProjectsQuery, (snapshot) => {
        sharedProjectMemberships = snapshot.docs.map(doc => doc.data() as ProjectMember);
        updateMergedProjects();
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'projectMembers', false);
      });

      return () => {
        unsubscribeAudio();
        unsubscribeText();
        unsubscribeAllProjects();
        unsubscribeShared();
      };
    } else {
      setAudioHistory([]);
      setTextHistory([]);
      setProjects([{
        id: 'general',
        name: 'General',
        userId: 'system',
        createdAt: new Date().toISOString()
      }]);
      setLoadingArchive(false);
    }
  }, [authStatus, user, userOrgRole, currentOrg, orgTeams, currentOrgMember]);

  // Real-time Organization, Teams, and Role tracking
  useEffect(() => {
    if (authStatus !== AuthStatus.LOGGED_IN || !user) {
      setCurrentOrg(null);
      setCurrentOrgMember(null);
      setOrgTeams([]);
      setUserOrgRole('viewer');
      return;
    }

    // 1. First listen to organizations owned by the user
    const ownedOrgQuery = query(
      collection(db, 'organizations'),
      where('ownerEmail', '==', user.email)
    );

    // 2. Also listen to orgMembers where the user is a member
    const memberQuery = query(
      collection(db, 'orgMembers'),
      where('email', '==', user.email)
    );

    let activeOrgId: string | null = null;
    let isUnsubscribed = false;

    const unsubscribeOwnedOrg = onSnapshot(ownedOrgQuery, (snapshot) => {
      if (isUnsubscribed) return;
      if (!snapshot.empty) {
        const orgDoc = snapshot.docs[0].data();
        setCurrentOrg(orgDoc);
        activeOrgId = orgDoc.id;
        
        if (profile?.role === 'admin') {
          setUserOrgRole('super_admin');
        } else {
          setUserOrgRole('org_admin');
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'organizations', false);
    });

    const unsubscribeMember = onSnapshot(memberQuery, (snapshot) => {
      if (isUnsubscribed) return;
      if (!snapshot.empty) {
        const memberDoc = snapshot.docs[0].data() as OrgMember;
        setCurrentOrgMember(memberDoc);
        
        if (!activeOrgId) {
          activeOrgId = memberDoc.orgId;
          const orgRef = doc(db, 'organizations', memberDoc.orgId);
          onSnapshot(orgRef, (orgSnap) => {
            if (isUnsubscribed) return;
            if (orgSnap.exists()) {
              setCurrentOrg(orgSnap.data());
            }
          }, (error) => {
            handleFirestoreError(error, OperationType.GET, 'organizations', false);
          });
        }

        if (profile?.role === 'admin') {
          setUserOrgRole('super_admin');
        } else if (memberDoc.role === 'owner' || memberDoc.role === 'admin') {
          setUserOrgRole('org_admin');
        } else if (memberDoc.role === 'team_lead') {
          setUserOrgRole('team_manager');
        } else if (memberDoc.role === 'member') {
          setUserOrgRole('member');
        } else if (memberDoc.role === 'guest') {
          setUserOrgRole('viewer');
        }
      } else {
        if (profile?.role === 'admin') {
          setUserOrgRole('super_admin');
        } else {
          // Default to personal workspace: treat as org_admin for personal scope
          setUserOrgRole('org_admin');
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orgMembers', false);
    });

    // 3. Listen to teams when organization ID is known
    let unsubscribeTeams: (() => void) | null = null;
    const watchTeams = (orgId: string) => {
      if (isUnsubscribed) return;
      const teamsQuery = query(collection(db, 'teams'), where('orgId', '==', orgId));
      unsubscribeTeams = onSnapshot(teamsQuery, (snapshot) => {
        if (isUnsubscribed) return;
        const teamList = snapshot.docs.map(doc => doc.data() as Team);
        setOrgTeams(teamList);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'teams', false);
      });
    };

    const interval = setInterval(() => {
      if (activeOrgId) {
        clearInterval(interval);
        watchTeams(activeOrgId);
      }
    }, 1000);

    return () => {
      isUnsubscribed = true;
      unsubscribeOwnedOrg();
      unsubscribeMember();
      if (unsubscribeTeams) unsubscribeTeams();
      clearInterval(interval);
    };
  }, [authStatus, user, userProfile]);

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

  const initAudio = () => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    
    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => setPlaybackStatus('stopped');
    const handleError = (e: any) => {
      console.warn("Audio playback error (handled gracefully):", e);
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    audioRef.current = audio;
    return audio;
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
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
    const audio = initAudio();
    audio.addEventListener('timeupdate', checkEnd);
  };

  const handleGlobalPlay = (metadata: PlaybackMetadata, startTime: number = 0, endTime?: number) => {
    const audio = initAudio();
    if (!audio || !metadata || !metadata.url) {
      console.warn("Skipping play: No audio element or invalid metadata URL", metadata);
      return;
    }
    
    const isSameSource = playbackMetadata?.url === metadata.url;
    const isSameSegment = metadata.segmentIndex === playbackMetadata?.segmentIndex;
    
    if (isSameSource && playbackStatus === 'paused' && isSameSegment) {
      audio.play().catch(console.error);
      setPlaybackStatus('playing');
      if (endTime !== undefined) {
        setupSegmentListener(endTime);
      }
      return;
    }

    // New playback or different segment
    audio.pause();
    clearSegmentListener();
    
    audio.src = metadata.url;
    audio.currentTime = startTime;
    
    setPlaybackMetadata(metadata);
    setPlaybackStatus('playing');

    // Trigger play after src update
    audio.play().catch(console.error);

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
      localStorage.setItem('guest', 'true');
      setUsageStats({
        usedMinutes: 0,
        totalMinutes: 15,
        aiRequestCount: 0,
        aiRequestLimit: 5,
        thinkingLimit: 3,
        plan: 'guest',
        mode: 'guest',
        renewalDate: 'May 1, 2026',
        minutesPerFileLimit: 5
      });
      // Clear history for guest session
      setAudioHistory([]);
      setTextHistory([]);
    } else if (status === AuthStatus.LOGGED_IN && profile?.plan) {
      localStorage.removeItem('guest');
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
    localStorage.removeItem('guest');
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

  const logProjectActivity = useCallback(async (
    projectId: string, 
    actionType: ProjectActivity['actionType'], 
    description: string,
    metadata?: any
  ) => {
    if (authStatus !== AuthStatus.LOGGED_IN || !user) return;
    try {
      await addDoc(collection(db, 'projectActivities'), {
        projectId: projectId || 'general',
        userId: user.uid,
        userEmail: user.email || '',
        userName: userProfile?.displayName || user.displayName || user.email?.split('@')[0] || 'Member',
        actionType,
        description,
        createdAt: serverTimestamp(),
        metadata: metadata || null
      });
      console.log(`📡 Logged project activity: [${actionType}] ${description}`);
    } catch (err) {
      console.error("❌ Failed to log project activity:", err);
    }
  }, [authStatus, user, userProfile]);

  const saveAudioRecord = useCallback(async (record: AudioToTextRecord) => {
    console.log("💾 Saving audio record to archive...", record.id);
    
    // GUEST MODE: Do not save to Firestore
    if (authStatus === AuthStatus.GUEST || localStorage.getItem('guest') === 'true') {
      setAudioHistory(prev => [record, ...prev]);
      console.log("✅ Record saved to local state (Guest Mode)");
      return;
    }

    if (authStatus === AuthStatus.LOGGED_IN && user) {
      const groupName = record.group || 'General';
      const project = projects.find(p => p.name.toLowerCase() === groupName.toLowerCase());
      
      // Extract transcript text and speakers for easier access in archive
      const transcriptText = record.transcript.map(s => s.text).join(' ');
      const speakers = Array.from(new Set(record.transcript.map(s => s.speaker)));

      // Filter out AI fields if they weren't selected
      const recordWithUid = sanitize({ 
        ...record, 
        userId: user.uid,
        group: groupName,
        projectId: project?.id || null,
        createdAt: serverTimestamp(),
        transcriptText,
        speakers,
        status: 'completed',
        // Ensure only selected modules are saved
        summary: record.selectedModules?.includes('summary') ? record.summary : null,
        strategicAnalysis: record.selectedModules?.includes('strategy') ? record.strategicAnalysis : null,
        meetingIntelligence: record.selectedModules?.includes('meeting') ? record.meetingIntelligence : null,
        executionTracker: record.selectedModules?.includes('execution') ? record.executionTracker : null,
        calendarReminders: record.selectedModules?.includes('reminders') ? record.calendarReminders : null,
        unifiedIntelligence: record.selectedModules && record.selectedModules.length > 0 ? record.unifiedIntelligence : null
      });

      try {
        await setDoc(doc(db, 'recordings', record.id), recordWithUid);
        console.log("✅ Record saved successfully to Firestore");

        const uName = userProfile?.displayName || user.displayName || user.email?.split('@')[0] || 'Someone';
        await logProjectActivity(
          project?.id || 'general',
          'upload_file',
          `${uName} uploaded recording "${record.fileName || 'Audio'}"`
        );
      } catch (error) {
        console.error("❌ Failed to save record:", error);
        handleFirestoreError(error, OperationType.WRITE, `recordings/${record.id}`);
      }
    }
  }, [authStatus, user, projects, userProfile, logProjectActivity]);

  const saveTextRecord = useCallback(async (record: TextToAudioRecord) => {
    console.log("💾 Saving synthesis record to archive...", record.id);
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      const groupName = record.group || 'General';
      const project = projects.find(p => p.name.toLowerCase() === groupName.toLowerCase());
      const recordWithUid = sanitize({ 
        ...record, 
        userId: user.uid,
        group: groupName,
        projectId: project?.id || null,
        createdAt: serverTimestamp()
      });
      try {
        await setDoc(doc(db, 'transcriptions', record.id), recordWithUid);
        console.log("✅ Synthesis record saved successfully to Firestore");

        const uName = userProfile?.displayName || user.displayName || user.email?.split('@')[0] || 'Someone';
        await logProjectActivity(
          project?.id || 'general',
          'upload_file',
          `${uName} synthesized audio file "${record.fullText.slice(0, 30)}..."`
        );
      } catch (error) {
        console.error("❌ Failed to save synthesis record:", error);
        handleFirestoreError(error, OperationType.WRITE, `transcriptions/${record.id}`);
      }
    } else if (authStatus === AuthStatus.GUEST) {
      setTextHistory(prev => [record, ...prev]);
      console.log("✅ Synthesis record saved to local state (Guest Mode)");
    }
  }, [authStatus, user, projects, userProfile, logProjectActivity]);

  const updateAudioRecord = async (updated: AudioToTextRecord) => {
    // Determine if bookmark count changed
    const current = audioHistory.find(r => r.id === updated.id);
    const oldBookmarksCount = (current?.bookmarks || []).length;
    const newBookmarksCount = (updated.bookmarks || []).length;

    // Optimistically update local state for immediate UI feedback
    setAudioHistory(prev => prev.map(r => r.id === updated.id ? updated : r));

    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        const project = projects.find(p => p.name.toLowerCase() === (updated.group || 'General').toLowerCase());
        const dataToUpdate = {
          ...updated,
          projectId: project?.id || null
        };
        await updateDoc(doc(db, 'recordings', updated.id), sanitize(dataToUpdate) as any);

        if (newBookmarksCount > oldBookmarksCount) {
          const uName = userProfile?.displayName || user.displayName || user.email?.split('@')[0] || 'Someone';
          await logProjectActivity(
            project?.id || 'general',
            'create_bookmark',
            `${uName} bookmarked recording "${updated.fileName || 'Audio'}"`
          );
        }
      } catch (error) {
        console.error("❌ Failed to update record in Firestore:", error);
        // Rollback on error if needed, but for simplicity we keep local state in sync with failed attempt for now
        handleFirestoreError(error, OperationType.UPDATE, `recordings/${updated.id}`);
      }
    }
  };

  const updateTextRecord = async (updated: TextToAudioRecord) => {
    // Optimistically update local state
    setTextHistory(prev => prev.map(r => r.id === updated.id ? updated : r));

    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        const project = projects.find(p => p.name.toLowerCase() === (updated.group || 'General').toLowerCase());
        const dataToUpdate = {
          ...updated,
          projectId: project?.id || null
        };
        await updateDoc(doc(db, 'transcriptions', updated.id), sanitize(dataToUpdate) as any);
      } catch (error) {
        console.error("❌ Failed to update synthesis record in Firestore:", error);
        handleFirestoreError(error, OperationType.UPDATE, `transcriptions/${updated.id}`);
      }
    }
  };

  const deleteAudioRecord = async (id: string) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        await updateDoc(doc(db, 'recordings', id), { deletedAt: new Date().toISOString() });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `recordings/${id}`);
      }
    } else if (authStatus === AuthStatus.GUEST) {
      setAudioHistory(prev => prev.map(r => r.id === id ? { ...r, deletedAt: new Date().toISOString() } : r));
    }
  };

  const deleteTextRecord = async (id: string) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        await updateDoc(doc(db, 'transcriptions', id), { deletedAt: new Date().toISOString() });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `transcriptions/${id}`);
      }
    } else if (authStatus === AuthStatus.GUEST) {
      setTextHistory(prev => prev.map(r => r.id === id ? { ...r, deletedAt: new Date().toISOString() } : r));
    }
  };

  const permanentlyDeleteAudioRecord = async (id: string) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        await deleteDoc(doc(db, 'recordings', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `recordings/${id}`);
      }
    } else if (authStatus === AuthStatus.GUEST) {
      setAudioHistory(prev => prev.filter(r => r.id !== id));
    }
  };

  const permanentlyDeleteTextRecord = async (id: string) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        await deleteDoc(doc(db, 'transcriptions', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `transcriptions/${id}`);
      }
    } else if (authStatus === AuthStatus.GUEST) {
      setTextHistory(prev => prev.filter(r => r.id !== id));
    }
  };

  const restoreAudioRecord = async (id: string) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        await updateDoc(doc(db, 'recordings', id), { deletedAt: null });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `recordings/${id}`);
      }
    } else if (authStatus === AuthStatus.GUEST) {
      setAudioHistory(prev => prev.map(r => r.id === id ? { ...r, deletedAt: undefined } : r));
    }
  };

  const restoreTextRecord = async (id: string) => {
    if (authStatus === AuthStatus.LOGGED_IN && user) {
      try {
        await updateDoc(doc(db, 'transcriptions', id), { deletedAt: null });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `transcriptions/${id}`);
      }
    } else if (authStatus === AuthStatus.GUEST) {
      setTextHistory(prev => prev.map(r => r.id === id ? { ...r, deletedAt: undefined } : r));
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
    if (isGuest) {
      addNotification({
        title: 'Feature Restricted',
        message: 'Creating projects is not available in Guest Mode. Please create an account to save your work.',
        type: 'error'
      });
      return null;
    }
    if (!name.trim()) return null;
    const existing = projects.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!existing) {
      const id = Math.random().toString(36).substr(2, 9);
      const isDefault = name === 'General';
      const newProject: Project = {
        id,
        name,
        userId: user?.uid || 'guest',
        ownerEmail: user?.email || 'guest',
        ownerName: userProfile?.displayName || userProfile?.name || user?.displayName || user?.email?.split('@')[0] || 'User',
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

  const inviteToProject = async (projectName: string, email: string, role: CollaborationRole) => {
    if (isGuest) {
      addToast('Feature Restricted', 'Team collaboration is not available in Guest Mode. Please create an account to invite others.', 'error');
      return;
    }

    const project = projects.find(p => p.name === projectName);
    if (!project || !user) {
      addToast('Invite Error', 'Could not find the selected project.', 'error');
      return;
    }

    try {
      // Generate unique token on client and write to Firestore directly (authenticated user)
      const inviteToken = crypto.randomUUID();
      const inviteData = {
        id: inviteToken,
        email,
        role,
        projectId: project.id,
        projectName: project.name,
        invitedBy: user.email || "Someone",
        ownerId: project.userId || null,
        status: "pending",
        createdAt: serverTimestamp()
      };

      await setDoc(doc(db, "invites", inviteToken), inviteData);

      const baseUrl = import.meta.env.VITE_API_URL || "";
      const response = await fetch(`${baseUrl}/api/invite-member`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          role,
          projectId: project.id,
          projectName: project.name,
          invitedBy: user.email,
          ownerId: project.userId,
          inviteToken // pass the client-generated token
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send invitation');
      }

      const inviteResult = await response.json();
      
      addToast('Success', `Invitation sent to ${email}`, 'success');
      
      addNotification({
        title: 'Invite Sent',
        message: `You invited ${email} to join ${projectName} as ${role}.`,
        type: 'success'
      });

      const uName = userProfile?.displayName || user.displayName || user.email?.split('@')[0] || 'Someone';
      await logProjectActivity(
        project.id,
        'invite_member',
        `${uName} invited ${email} to join project "${projectName}" as ${role}`
      );
      
    } catch (error: any) {
      console.error('Invite Error:', error);
      addToast('Invite Failed', error.message, 'error');
    }
  };

  const selectGroup = (name: string | null) => {
    setSelectedGroupFilter(name);
    // Only switch to HISTORY tab if we are selecting a specific project
    if (name !== null) {
      setCurrentTab(AppWorkflow.HISTORY);
    }
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [decisionIntelligenceInitialInput, setDecisionIntelligenceInitialInput] = useState<{ text: string; type: 'transcript' | 'summary' } | undefined>(undefined);

  const handleSummarizeTranscript = async (recordId: string) => {
    const record = audioHistory.find(r => r.id === recordId);
    if (!record || !record.transcript) {
      addToast('AI Action', 'No transcript found to summarize.', 'error');
      return;
    }

    if (!checkThinkingLimit()) return;

    addToast('AI Action', 'Summarizing transcript...', 'info');
    try {
      // Convert string transcript to TranscriptSegment[] if it's stored as string
      // In this app, it seems record.transcript is a string (the full text)
      // But geminiService.summarizeTranscript expects TranscriptSegment[]
      // Let's check the type of transcript in AudioToTextRecord
      
      // If it's a string, we might need a different summarizer or convert it.
      // Looking at geminiService.ts, transcribeAudio returns { transcript: TranscriptSegment[], ... }
      // And AudioToTextRecord has transcript: string; (from types.ts)
      
      // Wait, let's check types.ts
      const summary = await summarizeTranscript([{ speaker: 'Speaker', text: record.transcript, startTime: 0, endTime: 0 }], userProfile.plan);
      await incrementThinkingUsage();
      
      await updateAudioRecord({ ...record, summary });
      addToast('AI Action', 'Summary updated successfully!', 'success');
    } catch (error) {
      console.error('Summarization failed:', error);
      addToast('AI Action', 'Failed to summarize transcript.', 'error');
    }
  };

  const handleReuseDecision = (text: string, type: 'transcript' | 'summary') => {
    setDecisionIntelligenceInitialInput({ text, type });
    setCurrentTab(AppWorkflow.DECISION_INTELLIGENCE);
  };

  const renderContent = () => {
    if ((currentTab === AppWorkflow.HISTORY || currentTab === AppWorkflow.DECISION_HISTORY || currentTab === AppWorkflow.DECISION_INTELLIGENCE || currentTab === AppWorkflow.COLLABORATION_DASHBOARD || currentTab === AppWorkflow.ORGANIZATION_DASHBOARD) && authStatus === AuthStatus.GUEST) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-8 animate-in fade-in duration-700">
          <div className="w-24 h-24 bg-brand-background rounded-lg flex items-center justify-center text-brand-primary text-4xl shadow-inner border border-brand-divider/20">
            <i className="fa-solid fa-lock"></i>
          </div>
          <div className="space-y-4 max-w-md">
            <h2 className="text-[26px] font-medium text-brand-primary tracking-[-0.01em] leading-tight">Advanced Intelligence Restricted</h2>
            <p className="text-slate-600 text-[16px] font-medium">Guest users only have access to session-based transcription and synthesis. Sign up for a free account to unlock meeting history, decision intelligence, and persistent storage.</p>
          </div>
          <button onClick={handleLogout} className="px-10 py-4 bg-brand-primary text-white rounded-lg font-semibold uppercase tracking-widest text-[13px] shadow-xl hover:opacity-90 active:scale-95 transition-all">
            Sign In for Full Access
          </button>
        </div>
      );
    }

    switch (currentTab) {
      case AppWorkflow.HOME:
        return <HomeView setTab={setCurrentTab} authStatus={authStatus} userProfile={userProfile} onSignInClick={handleLogout} onAddGroup={addGroup} usageStats={usageStats} />;
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
            onSignInClick={handleLogout}
            searchTerm={searchQuery}
            checkThinkingLimit={checkThinkingLimit}
            checkTranscriptionLimit={checkTranscriptionLimit}
            incrementThinkingUsage={incrementThinkingUsage}
            incrementTranscriptionUsage={incrementTranscriptionUsage}
            userOrgRole={userOrgRole}
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
            userOrgRole={userOrgRole}
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
            checkThinkingLimit={checkThinkingLimit}
            incrementThinkingUsage={incrementThinkingUsage}
            onLogActivity={logProjectActivity}
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
            isLoading={loadingArchive}
            checkThinkingLimit={checkThinkingLimit}
            incrementThinkingUsage={incrementThinkingUsage}
            userOrgRole={userOrgRole}
          />
        );
      case AppWorkflow.ADMIN_TRACKER:
        if (userProfile?.role !== 'admin') {
          return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <i className="fa-solid fa-triangle-exclamation text-red-500 text-4xl mb-4"></i>
              <h1 className="text-xl font-bold">Access Denied</h1>
              <p className="text-slate-500">You must be an administrator to view this page.</p>
            </div>
          );
        }
        return <AdminTrackerView userProfile={userProfile} onAnalyticsUpdate={handleAnalyticsUpdate} />;
      case AppWorkflow.COLLABORATION_DASHBOARD:
        return (
          <CollaborationDashboard 
            projects={projects}
            selectedProjectName={selectedGroupFilter}
            onSelectProjectName={setSelectedGroupFilter}
            userProfile={userProfile}
            audioHistory={audioHistory}
            textHistory={textHistory}
            addNotification={addNotification}
            onInviteToProject={inviteToProject}
            userOrgRole={userOrgRole}
          />
        );
      case AppWorkflow.ORGANIZATION_DASHBOARD:
        return (
          <OrganizationDashboard 
            projects={projects}
            userProfile={userProfile}
            addNotification={addNotification}
            userOrgRole={userOrgRole}
          />
        );
      default:
        return null;
    }
  };

  const renderDashboard = () => {
    return (
      <div className="flex flex-col md:flex-row md:h-screen bg-brand-background text-brand-primary overflow-hidden">
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
          onOpenUpgrade={() => setShowUpgradeModal(true)}
          notifications={notifications}
          onMarkNotificationRead={markNotificationRead}
          onClearNotifications={clearNotifications}
          usageStats={usageStats}
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
          userOrgRole={userOrgRole}
        />
        
        <main className={`flex-1 overflow-y-auto custom-scrollbar bg-brand-background relative transition-all duration-300 ${isCollapsed ? 'lg:ml-20' : 'lg:ml-64 xl:ml-72'}`}>
          <Topbar 
            usageStats={usageStats} 
            userProfile={userProfile} 
            authStatus={authStatus} 
            onLogout={handleLogout}
            onOpenSettings={() => setShowSettings(true)}
            onOpenUpgrade={() => setShowUpgradeModal(true)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            showSearch={currentTab === AppWorkflow.HISTORY}
            selectedProjectName={selectedGroupFilter}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          />
          
          <div className="w-full max-w-screen-xl mx-auto px-4 py-6 md:px-8 md:py-12 lg:px-16 lg:py-20 pb-48">
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
          onStartFree={handleStartFree}
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
      <Toaster position="top-center" richColors />
      
      <SubscriptionModal 
        isOpen={showUpgradeModal} 
        onClose={() => setShowUpgradeModal(false)} 
        userProfile={userProfile}
      />

      <Routes>
        {/* Public Routes */}
        <Route path="/" element={renderPublicPage(<Home onLogin={handleLogin} onStartFree={handleStartFree} onNavigateToDemo={handleNavigateToDemo} authStatus={authStatus} onGoToDashboard={handleGoToDashboard} />)} />
        <Route path="/features" element={renderPublicPage(<Features onLogin={handleLogin} onStartFree={handleStartFree} onNavigateToDemo={handleNavigateToDemo} authStatus={authStatus} />)} />
        <Route path="/solutions" element={renderPublicPage(<Solutions onLogin={handleLogin} onStartFree={handleStartFree} onNavigateToDemo={handleNavigateToDemo} authStatus={authStatus} />)} />
        <Route path="/pricing" element={renderPublicPage(<PricingPage />)} />
        <Route path="/contact" element={renderPublicPage(<ContactPage />)} />
        <Route path="/demo" element={renderPublicPage(<BookDemoPage />)} />
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
                  src="/Logo-2.png" 
                  alt="EchoNote" 
                  className="h-10 w-auto object-contain"
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
          minutes_remaining: Math.max(0, usageStats.totalMinutes - usageStats.usedMinutes)
        }}
        actions={{
          summarizeTranscript: () => {
            if (activeRecordId) {
              handleSummarizeTranscript(activeRecordId);
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
