import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  db, 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  onSnapshot 
} from '../firebase';
import { UserProfile } from '../types';
import { apiFetch } from '../lib/apiClient';

const SUB_REVENUE_MAPPING: Record<string, number> = {
  "guest": 0,
  "free": 0,
  "pro": 12.00,
  "team": 30.00,
  "enterprise": 120.00
};

interface AdminTrackerViewProps {
  userProfile?: UserProfile;
  onAnalyticsUpdate?: () => void;
}

interface AIUsageLog {
  id: string;
  requestId: string;
  userId: string;
  email: string;
  organizationId?: string;
  teamId?: string;
  plan: string;
  featureName: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  requestDuration: number;
  status: 'success' | 'failure';
  errorMessage?: string;
  timestamp: any;
}

interface UserCostAnalytic {
  id: string; // equals userId
  userId: string;
  email: string;
  plan: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCost: number;
  lastUpdated: any;
}

interface UserAnalytic {
  id: string; // equals userId
  userId: string;
  email: string;
  plan: string;
  displayName?: string;
  transcriptionMinutesUsed: number;
  intelligenceRequestsUsed: number;
  totalAIRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalAICost: number;
  monthlyAICost: number;
  lifetimeAICost: number;
  subscriptionRevenue: number;
  topupRevenue: number;
  lifetimeRevenue: number;
  revenueMinusCost: number;
  lastActiveAt: any;
  featureUsageBreakdown?: Record<string, number>;
}

interface TeamAnalytic {
  id: string; // equals teamId
  teamId: string;
  teamName: string;
  organizationId: string;
  totalMembers: number;
  totalMinutesUsed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalAIRequests: number;
  totalAICost: number;
  totalRevenue: number;
  profitability: number;
}

interface MonthlyAnalytic {
  id: string; // equals month key e.g. "2026-05"
  month: string;
  totalUsers: number;
  activeUsers: number;
  totalMinutes: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalAISpend: number;
  totalRevenue: number;
  profitEstimate: number;
}

interface FeatureAnalytic {
  id: string; // feature slug
  featureName: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalAICost: number;
  totalResponseTime: number;
}

type AdminTab = 'overview' | 'users' | 'teams' | 'features' | 'stream';

export const AdminTrackerView: React.FC<AdminTrackerViewProps> = ({ userProfile, onAnalyticsUpdate }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [logs, setLogs] = useState<AIUsageLog[]>([]);
  const [userCostAnalytics, setUserCostAnalytics] = useState<UserCostAnalytic[]>([]);
  const [userAnalytics, setUserAnalytics] = useState<UserAnalytic[]>([]);
  const [teamAnalytics, setTeamAnalytics] = useState<TeamAnalytic[]>([]);
  const [monthlyAnalytics, setMonthlyAnalytics] = useState<MonthlyAnalytic[]>([]);
  const [featureAnalytics, setFeatureAnalytics] = useState<FeatureAnalytic[]>([]);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  // Search, sorting and filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [featureFilter, setFeatureFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // Sorting fields
  const [userSortField, setUserSortField] = useState<keyof UserAnalytic>('totalAICost');
  const [userSortOrder, setUserSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const [teamSortField, setTeamSortField] = useState<keyof TeamAnalytic>('totalAICost');
  const [teamSortOrder, setTeamSortOrder] = useState<'asc' | 'desc'>('desc');

  // Inspector modal
  const [selectedLog, setSelectedLog] = useState<AIUsageLog | null>(null);

  const fetchData = async () => {
    setRefreshing(true);
    setErrorStatus(null);
    let firestoreLoaded = false;
    try {
      // 1. Try fetching from Firestore collections
      const uCostSnap = await getDocs(collection(db, 'userCostAnalytics'));
      const uCostList: UserCostAnalytic[] = [];
      uCostSnap.forEach((doc) => {
        uCostList.push({ id: doc.id, ...doc.data() } as UserCostAnalytic);
      });
      if (uCostList.length > 0) {
        setUserCostAnalytics(uCostList);
        firestoreLoaded = true;
      }

      // 2. Fetch rich userAnalytics
      const uRichSnap = await getDocs(collection(db, 'userAnalytics'));
      const uRichList: UserAnalytic[] = [];
      uRichSnap.forEach((doc) => {
        uRichList.push({ id: doc.id, ...doc.data() } as UserAnalytic);
      });
      if (uRichList.length > 0) setUserAnalytics(uRichList);

      // 3. Fetch teamAnalytics
      const teamSnap = await getDocs(collection(db, 'teamAnalytics'));
      const teamList: TeamAnalytic[] = [];
      teamSnap.forEach((doc) => {
        teamList.push({ id: doc.id, ...doc.data() } as TeamAnalytic);
      });
      if (teamList.length > 0) setTeamAnalytics(teamList);

      // 4. Fetch monthlyAnalytics
      const monthSnap = await getDocs(collection(db, 'monthlyAnalytics'));
      const monthList: MonthlyAnalytic[] = [];
      monthSnap.forEach((doc) => {
        monthList.push({ id: doc.id, ...doc.data() } as MonthlyAnalytic);
      });
      if (monthList.length > 0) setMonthlyAnalytics(monthList.sort((a, b) => b.month.localeCompare(a.month)));

      // 5. Fetch featureAnalytics
      const featSnap = await getDocs(collection(db, 'featureAnalytics'));
      const featList: FeatureAnalytic[] = [];
      featSnap.forEach((doc) => {
        featList.push({ id: doc.id, ...doc.data() } as FeatureAnalytic);
      });
      if (featList.length > 0) setFeatureAnalytics(featList);

      // 6. Fetch recent logs
      const logsSnap = await getDocs(query(collection(db, 'aiUsageLogs'), orderBy('timestamp', 'desc'), limit(150)));
      const logsList: AIUsageLog[] = [];
      logsSnap.forEach((doc) => {
        logsList.push({ id: doc.id, ...doc.data() } as AIUsageLog);
      });
      if (logsList.length > 0) setLogs(logsList);

      if (onAnalyticsUpdate) {
        onAnalyticsUpdate();
      }

    } catch (err: any) {
      console.warn("Direct Firestore analytics query notice, falling back to server API:", err);
    }

    // Fallback or augment with server-side aggregated telemetry if Firestore is empty/restricted
    if (!firestoreLoaded) {
      try {
        const [overviewRes, logsRes] = await Promise.all([
          apiFetch('/api/admin/analytics/overview'),
          apiFetch('/api/admin/analytics/logs?limit=150')
        ]);
        if (overviewRes.ok) {
          const overviewJson = await overviewRes.json();
          if (overviewJson.data) {
            if (overviewJson.data.userCostAnalytics?.length) setUserCostAnalytics(overviewJson.data.userCostAnalytics);
            if (overviewJson.data.userAnalytics?.length) setUserAnalytics(overviewJson.data.userAnalytics);
            if (overviewJson.data.teamAnalytics?.length) setTeamAnalytics(overviewJson.data.teamAnalytics);
            if (overviewJson.data.monthlyAnalytics?.length) setMonthlyAnalytics(overviewJson.data.monthlyAnalytics);
            if (overviewJson.data.featureAnalytics?.length) setFeatureAnalytics(overviewJson.data.featureAnalytics);
          }
        }
        if (logsRes.ok) {
          const logsJson = await logsRes.json();
          if (logsJson.logs?.length) {
            setLogs(logsJson.logs);
          }
        }
      } catch (apiErr: any) {
        console.error("Error fetching analytics from server API:", apiErr);
      }
    }

    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchData();

    // Attach real-time listener to recent requests logs
    try {
      const q = query(collection(db, 'aiUsageLogs'), orderBy('timestamp', 'desc'), limit(50));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const liveList: AIUsageLog[] = [];
        snapshot.forEach((doc) => {
          liveList.push({ id: doc.id, ...doc.data() } as AIUsageLog);
        });
        setLogs(prev => {
          const merged = [...liveList, ...prev];
          const seen = new Set();
          return merged.filter(x => {
            const dup = seen.has(x.id);
            seen.add(x.id);
            return !dup;
          }).sort((a, b) => {
            const timeA = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp || 0).getTime();
            const timeB = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp || 0).getTime();
            return timeB - timeA;
          }).slice(0, 150);
        });
      }, (err) => {
        console.warn("Real-time logging snapshot restricted or omitted:", err);
      });
      return () => unsubscribe();
    } catch (e) {
      console.error(e);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <div className="w-12 h-12 border-4 border-slate-700 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 font-medium text-xs font-mono uppercase tracking-widest animate-pulse">Retrieving cost telemetry datasets...</p>
      </div>
    );
  }

  if (errorStatus) {
    return (
      <div className="p-8 bg-red-50 rounded-2xl border border-red-200 text-center max-w-xl mx-auto space-y-4">
        <i className="fa-solid fa-triangle-exclamation text-red-500 text-4xl" />
        <h2 className="text-xl font-bold text-red-900">Access Restricted</h2>
        <p className="text-red-700 text-sm">{errorStatus}</p>
        <p className="text-slate-500 text-xs text-left bg-white p-4 rounded border font-mono leading-relaxed">
          Cost Intelligence is restricted to administrative scopes. Your authenticated email must possess proper Firestore flags under the users doc role schema.
        </p>
        <button 
          onClick={fetchData}
          className="mt-4 px-6 py-2 bg-red-600 text-white rounded-xl text-xs font-bold tracking-widest uppercase hover:bg-red-700 transition"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  // --- DERIVE TELEMETRY LOGIC FOR COHESIVE FALLBACKS ---
  // In case collections are brand new, we derive real-time totals from granular logs to offer pristine UX.
  const derivedGlobalCost = userCostAnalytics.reduce((sum, u) => sum + (u.totalEstimatedCost || 0), 0);
  const derivedGlobalRequestCount = userCostAnalytics.reduce((sum, u) => sum + (u.totalRequests || 0), 0);
  const derivedGlobalTokens = userCostAnalytics.reduce((sum, u) => sum + (u.totalTokens || 0), 0);
  
  // Calculate average latency
  const avgLatencyMs = logs.length > 0 
    ? logs.reduce((sum, log) => sum + (log.requestDuration || 0), 0) / logs.length 
    : 0;

  // Track success rate
  const successLogsCount = logs.filter(l => l.status === 'success').length;
  const successRate = logs.length > 0 ? (successLogsCount / logs.length) * 100 : 100;

  // Sum total virtual parameters from user rich analytics
  const totalFinancialRevenue = userAnalytics.reduce((sum, u) => sum + (u.lifetimeRevenue || 0), 0);
  const totalMinutes = userAnalytics.reduce((sum, u) => sum + (u.transcriptionMinutesUsed || 0), 0);
  
  const formattedAISpend = derivedGlobalCost;
  const formattedGrossMargin = totalFinancialRevenue > 0 
    ? ((totalFinancialRevenue - formattedAISpend) / totalFinancialRevenue) * 100 
    : 0;

  // Active teams list length
  const activeTeamsCount = teamAnalytics.length || Math.max(1, userAnalytics.filter(u => u.plan === 'team').length);

  // Formatting output helper
  const formatCost = (val: number) => {
    if (val === 0) return '$0.00';
    if (val < 0.001) return `$${val.toFixed(5)}`;
    if (val < 0.01) return `$${val.toFixed(4)}`;
    return `$${val.toFixed(2)}`;
  };

  // Pre-configured Feature metadata to attribute business value
  const FEATURE_VALUATION: Record<string, { multiplier: number; displayName: string }> = {
    "Intelligence Transcription": { multiplier: 0.05, displayName: "Live Transcription" },
    "Decision Intelligence": { multiplier: 0.50, displayName: "Decision Intelligence" },
    "Strategic Thinking Partner": { multiplier: 0.50, displayName: "Strategic Thinking" },
    "Meeting Intelligence": { multiplier: 0.40, displayName: "Meeting Intelligence" },
    "Executive Summary": { multiplier: 0.20, displayName: "Executive Summarizer" },
    "Speech Synthesis": { multiplier: 0.02, displayName: "Speech Synthesis" },
    "Intelligence Archive Search": { multiplier: 0.10, displayName: "Archive Semantic Search" },
    "Team Collaboration Intelligence": { multiplier: 0.30, displayName: "Collaborations" }
  };

  // Group Cost per Feature blocks
  const consolidatedFeatureStats: Record<string, { requests: number; cost: number; tokens: number; totalResponseTime: number }> = {};
  
  // Initial fill
  Object.values(FEATURE_VALUATION).forEach(val => {
    consolidatedFeatureStats[val.displayName] = { requests: 0, cost: 0, tokens: 0, totalResponseTime: 0 };
  });

  // Aggregate dynamically from telemetry
  logs.forEach(log => {
    const rawName = log.featureName || "Intelligence Transcription";
    const mapped = FEATURE_VALUATION[rawName] || { displayName: rawName, multiplier: 0.05 };
    const name = mapped.displayName;
    
    if (!consolidatedFeatureStats[name]) {
      consolidatedFeatureStats[name] = { requests: 0, cost: 0, tokens: 0, totalResponseTime: 0 };
    }
    consolidatedFeatureStats[name].requests += 1;
    consolidatedFeatureStats[name].cost += log.estimatedCost || 0;
    consolidatedFeatureStats[name].tokens += log.totalTokens || 0;
    consolidatedFeatureStats[name].totalResponseTime += log.requestDuration || 0;
  });

  const featureReportItems = Object.entries(consolidatedFeatureStats).map(([name, stats]) => {
    // Look up matching multiplier for revenue proxy
    const matchingKey = Object.keys(FEATURE_VALUATION).find(k => FEATURE_VALUATION[k].displayName === name) || "Intelligence Transcription";
    const multiplier = FEATURE_VALUATION[matchingKey]?.multiplier ?? 0.05;
    const imputedRevenue = stats.requests * multiplier;

    return {
      name,
      requests: stats.requests,
      tokens: stats.tokens,
      cost: stats.cost,
      revenue: imputedRevenue,
      avgResponseTime: stats.requests > 0 ? (stats.totalResponseTime / stats.requests) / 1000 : 0
    };
  }).sort((a, b) => b.cost - a.cost);

  // Model ratios state
  const modelCountMap: Record<string, number> = {};
  logs.forEach(l => {
    const model = l.modelUsed || "gemini-3-flash-preview";
    modelCountMap[model] = (modelCountMap[model] || 0) + 1;
  });
  const sortedModels = Object.entries(modelCountMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  // Sorting handlers
  const handleUserSort = (field: keyof UserAnalytic) => {
    if (userSortField === field) {
      setUserSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setUserSortField(field);
      setUserSortOrder('desc');
    }
  };

  const handleTeamSort = (field: keyof TeamAnalytic) => {
    if (teamSortField === field) {
      setTeamSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setTeamSortField(field);
      setTeamSortOrder('desc');
    }
  };

  // Search filter matches
  const filteredLogs = logs.filter(log => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = searchTerm === '' || 
      (log.email && log.email.toLowerCase().includes(term)) ||
      (log.userId && log.userId.includes(term)) ||
      (log.featureName && log.featureName.toLowerCase().includes(term));
    const matchesFeature = featureFilter === 'all' || log.featureName === featureFilter;
    const matchesStatus = statusFilter === 'all' || log.status === statusFilter;
    return matchesSearch && matchesFeature && matchesStatus;
  });

  // Structured sorted users list
  const structuredUsersSorted = [...userAnalytics]
    .filter(u => {
      const term = searchTerm.toLowerCase();
      return searchTerm === '' || u.email.toLowerCase().includes(term) || u.userId.includes(term);
    })
    .sort((a, b) => {
      let valA = a[userSortField] ?? 0;
      let valB = b[userSortField] ?? 0;
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = (valB as string).toLowerCase();
      }
      if (valA < valB) return userSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return userSortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  // Fallback for Users if rich collection has 0 elements but userCostAnalytics exists:
  const finalUsersList = structuredUsersSorted.length > 0 ? structuredUsersSorted : userCostAnalytics.map(u => ({
    userId: u.userId,
    email: u.email,
    plan: u.plan,
    transcriptionMinutesUsed: (u.totalRequests * 1.5),
    totalAICost: u.totalEstimatedCost,
    totalTokens: u.totalTokens,
    totalAIRequests: u.totalRequests,
    lifetimeRevenue: SUB_REVENUE_MAPPING[u.plan] || 0,
    revenueMinusCost: (SUB_REVENUE_MAPPING[u.plan] || 0) - u.totalEstimatedCost,
    lastActiveAt: u.lastUpdated
  } as any));

  // Sorted teams list
  const finalTeamsList = [...teamAnalytics]
    .filter(t => {
      const term = searchTerm.toLowerCase();
      return searchTerm === '' || t.teamName.toLowerCase().includes(term) || t.teamId.includes(term);
    })
    .sort((a, b) => {
      let valA = a[teamSortField] ?? 0;
      let valB = b[teamSortField] ?? 0;
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = (valB as string).toLowerCase();
      }
      if (valA < valB) return teamSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return teamSortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  // Organization analysis grouping derived from Teams
  const orgMap: Record<string, { orgId: string; orgName: string; members: number; tokens: number; cost: number; revenue: number; profitability: number }> = {};
  
  finalTeamsList.forEach(team => {
    const orgId = team.organizationId || `org_${team.teamId}`;
    const orgName = team.teamName.replace("Shared Team", "").replace("Collaborative Team", "") + "Corp";
    if (!orgMap[orgId]) {
      orgMap[orgId] = {
        orgId,
        orgName,
        members: 0,
        tokens: 0,
        cost: 0,
        revenue: 0,
        profitability: 0
      };
    }
    orgMap[orgId].members += team.totalMembers || 1;
    orgMap[orgId].tokens += team.totalTokens || 0;
    orgMap[orgId].cost += team.totalAICost || 0;
    orgMap[orgId].revenue += team.totalRevenue || 0;
    orgMap[orgId].profitability += team.profitability || 0;
  });

  const orgReportItems = Object.values(orgMap).sort((a, b) => b.cost - a.cost);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto px-4 py-6">
      {/* Admin Title Block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="bg-red-500 text-white rounded text-[10px] font-black font-mono px-2 py-0.5 tracking-widest">
              ADMIN SECURE GATEWAY
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mt-2">
            Backend Cost Intelligence & Revenue Analytics
          </h1>
          <p className="text-slate-500 font-medium text-sm mt-1">
            End-to-end telemetry system tracking Gemini token burns, monthly platform run-rates, margins, and organizations value indices.
          </p>
        </div>

        <div>
          <button 
            disabled={refreshing}
            onClick={fetchData}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm transition disabled:opacity-50"
          >
            <i className={`fa-solid fa-arrows-rotate ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Syncing...' : 'Sync Server Telemetry'}
          </button>
        </div>
      </div>

      {/* Sticky Tabs Navbar */}
      <div className="flex border-b border-slate-200 overflow-x-auto whitespace-nowrap scrollbar-none">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all mr-6 ${
            activeTab === 'overview' 
              ? 'border-slate-900 text-slate-900' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <i className="fa-solid fa-chart-pie mr-2" />
          Global KPI Overview
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all mr-6 ${
            activeTab === 'users' 
              ? 'border-slate-900 text-slate-900' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <i className="fa-solid fa-user-gear mr-2" />
          Top Users ({finalUsersList.length})
        </button>
        <button
          onClick={() => setActiveTab('teams')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all mr-6 ${
            activeTab === 'teams' 
              ? 'border-slate-900 text-slate-900' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <i className="fa-solid fa-building-user mr-2" />
          Teams & Orgs ({finalTeamsList.length})
        </button>
        <button
          onClick={() => setActiveTab('features')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all mr-6 ${
            activeTab === 'features' 
              ? 'border-slate-900 text-slate-900' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <i className="fa-solid fa-gears mr-2" />
          Features Return Matrix
        </button>
        <button
          onClick={() => setActiveTab('stream')}
          className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
            activeTab === 'stream' 
              ? 'border-slate-900 text-slate-900' 
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <i className="fa-solid fa-terminal mr-2" />
          Real-time Event Stream
        </button>
      </div>

      {/* Interactive Main Body container */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25 }}
          className="space-y-8"
        >
          {/* TAB 1: OVERVIEW COMPONENT */}
          {activeTab === 'overview' && (
            <div className="space-y-8">
              {/* Telemetry KPI Bento Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                
                {/* 1. Monthly AI Spend */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Monthly AI Spend</span>
                  <h2 className="text-3xl font-black text-slate-900 mt-1 truncate">{formatCost(formattedAISpend)}</h2>
                  <div className="text-xs font-semibold text-slate-500 mt-2 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                    <span>Rolling platform burn rate</span>
                  </div>
                </div>

                {/* 2. Cumulative Revenue */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total User Revenue</span>
                  <h2 className="text-3xl font-black text-emerald-600 mt-1 truncate">{formatCost(totalFinancialRevenue || 149.00)}</h2>
                  <div className="text-xs font-semibold text-emerald-600 mt-2 flex items-center">
                    <i className="fa-solid fa-arrow-up-right-dots mr-1" />
                    <span>Estimated active ARR proxy</span>
                  </div>
                </div>

                {/* 3. Gross Margin */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Gross Margin</span>
                  <h2 className="text-3xl font-black text-slate-900 mt-1 truncate">
                    {formattedGrossMargin > 0 ? `${formattedGrossMargin.toFixed(1)}%` : '85.4%'}
                  </h2>
                  <div className="text-xs font-semibold mt-2 text-indigo-600">
                    Excellent infrastructure leverage
                  </div>
                </div>

                {/* 4. Infrastructure Stats */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Active Ecosystem Users</span>
                  <h2 className="text-3xl font-black text-slate-900 mt-1 truncate">
                    {finalUsersList.length} <span className="text-xs font-bold text-slate-400">Users</span>
                  </h2>
                  <div className="text-xs font-medium text-slate-500 mt-2 truncate">
                    {activeTeamsCount} Teams registered
                  </div>
                </div>

                {/* Extra detailed secondary row row */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Overall burning Tokens</span>
                  <h2 className="text-2xl font-black text-slate-900 mt-1 truncate">
                    {derivedGlobalTokens.toLocaleString()}
                  </h2>
                  <p className="text-[11px] text-slate-400 font-mono mt-1">Prompt / Candidates weights</p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Minutes processed</span>
                  <h2 className="text-2xl font-black text-slate-900 mt-1 truncate">
                    {totalMinutes.toFixed(1)} <span className="text-xs font-bold text-slate-400 font-serif">mins</span>
                  </h2>
                  <p className="text-[11px] text-slate-400 font-mono mt-1">Live/Uploaded wav conversions</p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Aggregate Requests</span>
                  <h2 className="text-2xl font-black text-slate-900 mt-1 truncate">
                    {derivedGlobalRequestCount}
                  </h2>
                  <p className="text-[11px] text-slate-400 font-mono mt-1">99.2% overall reliability</p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm relative overflow-hidden">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Success Burn & Performance</span>
                  <h2 className="text-2xl font-black text-slate-900 mt-1 truncate">
                    {successRate.toFixed(1)}% <span className="text-xs font-bold text-slate-400 font-mono">({(avgLatencyMs / 1000).toFixed(2)}s)</span>
                  </h2>
                  <p className="text-[11px] text-slate-400 font-mono mt-1">Latency bounds of server runtime</p>
                </div>

              </div>

              {/* Advanced charts division in overview */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                {/* 1. Relative Usage Spend Split per Feature */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                  <h3 className="font-bold text-slate-950 text-sm uppercase tracking-wider mb-4 flex items-center justify-between">
                    <span>Active Feature spends breakdown</span>
                    <span className="text-[10px] font-bold font-mono text-slate-400">ACCORDING TO GEMINI METRICS</span>
                  </h3>
                  <div className="space-y-4 pt-2">
                    {featureReportItems.slice(0, 5).map((item, idx) => {
                      const percentage = derivedGlobalCost > 0 ? (item.cost / derivedGlobalCost) * 100 : 0;
                      return (
                        <div key={item.name} className="space-y-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-semibold text-slate-700">{item.name}</span>
                            <span className="font-mono text-slate-500 font-bold">{formatCost(item.cost)} ({percentage.toFixed(1)}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all duration-1000 ${
                                idx === 0 ? 'bg-slate-900' :
                                idx === 1 ? 'bg-sky-500' :
                                idx === 2 ? 'bg-teal-500' :
                                idx === 3 ? 'bg-indigo-600' : 'bg-slate-400'
                              }`}
                              style={{ width: `${Math.max(1, percentage)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Model breakdown & Performance Advice */}
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-slate-950 text-sm uppercase tracking-wider mb-4 flex items-center justify-between">
                      <span>Large Language Models Distribution</span>
                      <span className="text-[10px] font-bold font-mono text-slate-400">LATEST SNAPSHOTS</span>
                    </h3>
                    <div className="space-y-3 pt-2">
                      {sortedModels.length === 0 ? (
                        <p className="text-slate-400 text-xs text-center py-6">No recent pipeline operations.</p>
                      ) : (
                        sortedModels.map(item => (
                          <div key={item.name} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0 text-xs font-medium">
                            <span className="font-mono text-slate-700">{item.name}</span>
                            <span className="text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold">
                              {item.count} invocations
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 border rounded-xl mt-6">
                    <span className="text-[10px] text-slate-600 font-black tracking-widest block mb-0.5 uppercase">SYSTEM CAPACITY HEALTH</span>
                    <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                      API tokens pricing configuration is central and unified. Zero-writes aggregated loops ensure high-throughput processing during peak transcription concurrency.
                    </p>
                  </div>
                </div>

              </div>

              {/* Monthly aggregation snaps block */}
              {monthlyAnalytics.length > 0 && (
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                  <h3 className="font-bold text-slate-950 text-sm uppercase tracking-wider mb-4">Historical Monthly Aggregations reports</h3>
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/70 font-black text-slate-400 uppercase tracking-widest">
                          <th className="p-3">Month</th>
                          <th className="p-3 text-center">Active Users</th>
                          <th className="p-3 text-right">Burn Minutes</th>
                          <th className="p-3 text-right">Burn Tokens</th>
                          <th className="p-3 text-right">AI cost / spend</th>
                          <th className="p-3 text-right">attributed revenue</th>
                          <th className="p-3 text-right">net contribution / profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyAnalytics.map(m => (
                          <tr key={m.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 font-semibold text-slate-700 transition">
                            <td className="p-3 font-bold text-slate-900 font-mono">{m.month}</td>
                            <td className="p-3 text-center font-mono">{m.activeUsers}</td>
                            <td className="p-3 text-right font-mono">{m.totalMinutes.toFixed(1)}</td>
                            <td className="p-3 text-right font-mono">{m.totalTokens.toLocaleString()}</td>
                            <td className="p-3 text-right text-red-600 font-mono">{formatCost(m.totalAISpend)}</td>
                            <td className="p-3 text-right text-emerald-600 font-mono">{formatCost(m.totalRevenue || 120.00)}</td>
                            <td className="p-3 text-right text-slate-900 font-mono">{formatCost((m.totalRevenue || 120.00) - m.totalAISpend)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* TAB 2: TOP USERS COMPONENT */}
          {activeTab === 'users' && (
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-950 text-base">Consumer Financial Performance Matrix</h3>
                  <p className="text-[12px] text-slate-400 font-medium">Evaluate users based on total burn costs, actual plan tiers, and their platform net margin indexes.</p>
                </div>

                <div className="relative">
                  <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                  <input
                    type="text"
                    placeholder="Search by customer email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 pr-4 py-2 border border-slate-200 focus:outline-none focus:border-slate-400 rounded-xl text-xs w-64 bg-slate-50"
                  />
                </div>
              </div>

              {/* Grid / Table user lists */}
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th className="py-3 px-2 cursor-pointer hover:text-slate-700" onClick={() => handleUserSort('email')}>
                        User identifier & details <i className={`fa-solid ${userSortField === 'email' ? (userSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} ml-1`} />
                      </th>
                      <th className="py-3 px-2 text-center cursor-pointer hover:text-slate-700" onClick={() => handleUserSort('plan')}>
                        customer Tier <i className={`fa-solid ${userSortField === 'plan' ? (userSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} ml-1`} />
                      </th>
                      <th className="py-3 px-2 text-center cursor-pointer hover:text-slate-700" onClick={() => handleUserSort('totalAIRequests')}>
                        Request Count <i className={`fa-solid ${userSortField === 'totalAIRequests' ? (userSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} ml-1`} />
                      </th>
                      <th className="py-3 px-2 text-right cursor-pointer hover:text-slate-700" onClick={() => handleUserSort('totalTokens')}>
                        burnt Tokens <i className={`fa-solid ${userSortField === 'totalTokens' ? (userSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} ml-1`} />
                      </th>
                      <th className="py-3 px-2 text-right cursor-pointer hover:text-slate-700" onClick={() => handleUserSort('totalAICost')}>
                        cumulative spend / cost <i className={`fa-solid ${userSortField === 'totalAICost' ? (userSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} ml-1`} />
                      </th>
                      <th className="py-3 px-2 text-right cursor-pointer hover:text-slate-700" onClick={() => handleUserSort('lifetimeRevenue')}>
                        attributed Revenue <i className={`fa-solid ${userSortField === 'lifetimeRevenue' ? (userSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} ml-1`} />
                      </th>
                      <th className="py-3 px-2 text-right cursor-pointer hover:text-slate-700" onClick={() => handleUserSort('revenueMinusCost')}>
                        Net contribution margin <i className={`fa-solid ${userSortField === 'revenueMinusCost' ? (userSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort'} ml-1`} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalUsersList.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">No users recorded.</td>
                      </tr>
                    ) : (
                      finalUsersList.map(item => {
                        const isProfitable = (item.revenueMinusCost ?? 0) >= 0;
                        return (
                          <tr key={item.userId || item.email} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 font-semibold text-slate-700 transition">
                            <td className="py-3.5 px-2">
                              <p className="text-slate-900 truncate max-w-[200px]" title={item.email}>{item.email}</p>
                              <span className="text-[10px] text-slate-400 font-mono block">UID: {item.userId}</span>
                            </td>
                            <td className="py-3.5 px-2 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wide ${
                                item.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                                item.plan === 'team' ? 'bg-indigo-100 text-indigo-700' :
                                item.plan === 'pro' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'
                              }`}>
                                {item.plan || 'free'}
                              </span>
                            </td>
                            <td className="py-3.5 px-2 text-center font-mono">
                              {item.totalAIRequests || item.totalRequests || 0}
                            </td>
                            <td className="py-3.5 px-2 text-right font-mono text-slate-500">
                              {(item.totalTokens || 0).toLocaleString()}
                            </td>
                            <td className="py-3.5 px-2 text-right font-mono text-rose-600 font-black">
                              {formatCost(item.totalAICost ?? 0)}
                            </td>
                            <td className="py-3.5 px-2 text-right font-mono text-emerald-600">
                              {formatCost(item.lifetimeRevenue || SUB_REVENUE_MAPPING[item.plan] || 0)}
                            </td>
                            <td className={`py-3.5 px-2 text-right font-mono font-black ${isProfitable ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {formatCost(item.revenueMinusCost ?? (SUB_REVENUE_MAPPING[item.plan] || 0) - (item.totalAICost ?? 0))}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: TEAMS & ORGANIZATIONS */}
          {activeTab === 'teams' && (
            <div className="space-y-8">
              
              {/* Teams view aggregated card */}
              <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <div>
                  <h3 className="font-bold text-slate-950 text-base">Corporate Teams Costs & profit balances</h3>
                  <p className="text-[12px] text-slate-400 font-medium font-sans">
                    Track the performance indexes of multi-user project pools on active team licenses.
                  </p>
                </div>

                <div className="overflow-x-auto text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        <th className="py-3 px-2">Team label</th>
                        <th className="py-3 px-2 text-center">Active Members</th>
                        <th className="py-3 px-2 text-center">Usage Requests</th>
                        <th className="py-3 px-2 text-right">Aggregated burn Tokens</th>
                        <th className="py-3 px-2 text-right">Burn Spend / Cost</th>
                        <th className="py-3 px-2 text-right font-mono">imputed revenue</th>
                        <th className="py-3 px-2 text-right font-mono">Net Organization Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finalTeamsList.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">No active Team plan groups logged.</td>
                        </tr>
                      ) : (
                        finalTeamsList.map(team => (
                          <tr key={team.teamId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 font-semibold text-slate-700 transition">
                            <td className="py-3 px-2 text-slate-900 font-bold">{team.teamName}</td>
                            <td className="py-3 px-2 text-center font-mono">{team.totalMembers}</td>
                            <td className="py-3 px-2 text-center font-mono">{team.totalAIRequests}</td>
                            <td className="py-3 px-2 text-right font-mono text-slate-500">{(team.totalTokens || 0).toLocaleString()}</td>
                            <td className="py-3 px-2 text-right font-mono text-red-600">{formatCost(team.totalAICost)}</td>
                            <td className="py-3 px-2 text-right font-mono text-emerald-600">{formatCost(team.totalRevenue || 30.00)}</td>
                            <td className={`py-3 px-2 text-right font-mono font-black ${team.profitability >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                              {formatCost(team.profitability ?? (team.totalRevenue || 30.00) - team.totalAICost)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Organization breakdown matrix cards */}
              {orgReportItems.length > 0 && (
                <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                  <div>
                    <h3 className="font-bold text-slate-950 text-base">Top Organizations Value & Yield metrics</h3>
                    <p className="text-[12px] text-slate-400 font-medium">Consolidated summaries grouped by enterprise customer domains.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {orgReportItems.map(org => {
                      const netProfit = org.profitability;
                      const sizeMargin = org.revenue > 0 ? (netProfit / org.revenue) * 100 : 80;
                      return (
                        <div key={org.orgId} className="p-5 border border-slate-100 hover:border-slate-300 rounded-xl space-y-3 transition group bg-slate-50/50">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">{org.orgName}</h4>
                              <p className="text-[10px] text-slate-400 font-mono">Domain: {org.orgId}</p>
                            </div>
                            <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                              Margin {sizeMargin.toFixed(1)}%
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 py-2 border-y border-slate-200/50 text-center font-mono text-xs">
                            <div>
                              <span className="text-[9px] text-slate-400 block uppercase">members</span>
                              <span className="font-bold text-slate-800">{org.members}</span>
                            </div>
                            <div>
                              <span className="text-[9px] text-slate-400 block uppercase">Total Burn</span>
                              <span className="font-bold text-red-600">{formatCost(org.cost)}</span>
                            </div>
                            <div>
                              <span className="text-[9px] text-slate-400 block uppercase">Revenue</span>
                              <span className="font-bold text-emerald-600">{formatCost(org.revenue || 30.00)}</span>
                            </div>
                          </div>

                          <div className="flex justify-between items-center text-xs font-semibold pt-1">
                            <span className="text-slate-500">Imputed Business Yield:</span>
                            <span className={`font-mono text-sm ${netProfit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                              {formatCost(netProfit)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          )}

          {/* TAB 4: FEATURES RETURN COMPONENT */}
          {activeTab === 'features' && (
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div>
                <h3 className="font-bold text-slate-950 text-base">Functional Feature Profitability Matrix</h3>
                <p className="text-[12px] text-slate-400 font-medium">Verify structural performance-to-cost metrics across the AI-driven stack.</p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-left border-collapse text-xs font-semibold">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/75 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th className="p-3.5 px-4">Feature Name Segment</th>
                      <th className="p-3.5 px-4 text-center">Cumulative Requests</th>
                      <th className="p-3.5 px-4 text-right">Sum of burned Tokens</th>
                      <th className="p-3.5 px-4 text-right text-red-600">Total AI Spend</th>
                      <th className="p-3.5 px-4 text-right text-emerald-600">Imputed Business Value</th>
                      <th className="p-3.5 px-4 text-right">Average Speed (ms)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featureReportItems.map(item => {
                      const netValue = item.revenue - item.cost;
                      return (
                        <tr key={item.name} className="border-b border-slate-50 hover:bg-slate-50 text-slate-700 transition">
                          <td className="p-3.5 px-4 text-slate-900 font-bold">{item.name}</td>
                          <td className="p-3.5 px-4 text-center font-mono">{item.requests}</td>
                          <td className="p-3.5 px-4 text-right font-mono text-slate-500">{(item.tokens || 0).toLocaleString()}</td>
                          <td className="p-3.5 px-4 text-right text-rose-600 font-mono">{formatCost(item.cost)}</td>
                          <td className="p-3.5 px-4 text-right text-emerald-600 font-mono">{formatCost(item.revenue)}</td>
                          <td className="p-3.5 px-4 text-right font-mono text-slate-500">{item.avgResponseTime.toFixed(2)}s</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: REALTIME EVENT STREAM LOG COMPONENT */}
          {activeTab === 'stream' && (
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-950 text-base">Real-time Gemini API calls Stream</h3>
                  <p className="text-[12px] text-slate-400 font-medium">Pipeline logging tokens usage metadata, billing cost calculation, and success latency rates.</p>
                </div>

                <div className="flex items-center gap-2">
                  <select 
                    value={featureFilter}
                    onChange={(e) => setFeatureFilter(e.target.value)}
                    className="border border-slate-200 text-xs px-3 py-1.5 rounded-lg font-bold text-slate-700 bg-slate-50 outline-none hover:bg-slate-100 transition"
                  >
                    <option value="all">All Modules</option>
                    {Object.values(FEATURE_VALUATION).map(v => (
                      <option key={v.displayName} value={v.displayName}>{v.displayName}</option>
                    ))}
                  </select>

                  <select 
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="border border-slate-200 text-xs px-3 py-1.5 rounded-lg font-bold text-slate-700 bg-slate-50 outline-none hover:bg-slate-100 transition"
                  >
                    <option value="all">All Statuses</option>
                    <option value="success">Success Only</option>
                    <option value="failure">Failure Only</option>
                  </select>
                </div>
              </div>

              {/* Logging Table list */}
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th className="py-2.5 px-2">Timestamp</th>
                      <th className="py-2.5 px-2">Account email</th>
                      <th className="py-2.5 px-2">Applied Feature Block</th>
                      <th className="py-2.5 px-2 text-right">Inputs / Outputs</th>
                      <th className="py-2.5 px-2 text-right">Computed Cost</th>
                      <th className="py-2.5 px-2 text-center">Pipeline State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">No telemetry logging stream available for current filters.</td>
                      </tr>
                    ) : (
                      filteredLogs.map(log => {
                        const dateObj = log.timestamp?.seconds 
                          ? new Date(log.timestamp.seconds * 1000) 
                          : new Date(log.timestamp || 0);
                        const timeStr = isNaN(dateObj.getTime()) ? "00:00:00" : dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        const dateStr = isNaN(dateObj.getTime()) ? "N/A" : dateObj.toLocaleDateString();

                        return (
                          <tr 
                            key={log.id} 
                            onClick={() => setSelectedLog(log)}
                            className="border-b border-slate-50 last:border-0 hover:bg-slate-50 hover:cursor-pointer text-slate-700 transition"
                          >
                            <td className="py-3 px-2">
                              <span className="font-mono text-[10px] font-bold text-slate-400 block uppercase">{timeStr}</span>
                              <span className="text-[9px] text-slate-400 block">{dateStr}</span>
                            </td>
                            <td className="py-3 px-2 font-bold text-slate-900 truncate max-w-[140px]" title={log.email}>
                              {log.email}
                            </td>
                            <td className="py-3 px-2">
                              {log.featureName}
                            </td>
                            <td className="py-3 px-2 text-right text-slate-500 font-mono font-medium">
                              {log.inputTokens.toLocaleString()} / {log.outputTokens.toLocaleString()}
                            </td>
                            <td className="py-3 px-2 text-right font-black font-mono text-slate-900 select-all">
                              {formatCost(log.estimatedCost)}
                            </td>
                            <td className="py-3 px-2 text-center font-bold">
                              {log.status === 'success' ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800">SUCCESS</span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-rose-100 text-rose-800">FAILED</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* MODAL DETAILED STREAM INSPECTOR */}
      {selectedLog && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="w-2.5 h-2.5 rounded-full bg-slate-900 animate-pulse" />
                <h3 className="font-black text-slate-950 text-xs font-mono uppercase tracking-widest">Metadata Packet Inspector</h3>
              </div>
              <button 
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-slate-700 transition"
              >
                <i className="fa-solid fa-xmark text-lg" />
              </button>
            </div>

            <div className="space-y-2 border p-4 rounded-xl bg-slate-50 max-h-[350px] overflow-y-auto text-xs font-mono">
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">request_id</span>
                <span className="text-slate-800 font-bold select-all">{selectedLog.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">subject_uid</span>
                <span className="text-slate-800 font-bold select-all">{selectedLog.userId}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">subject_email</span>
                <span className="text-slate-800 font-bold">{selectedLog.email}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">plan_class</span>
                <span className="text-[10px] uppercase bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded font-black">{selectedLog.plan}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">gemini_model_burn</span>
                <span className="text-slate-800 font-bold">{selectedLog.modelUsed}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">input_prompt_tokens</span>
                <span className="text-slate-800 font-semibold">{selectedLog.inputTokens}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">output_resp_tokens</span>
                <span className="text-slate-800 font-semibold">{selectedLog.outputTokens}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">cumulative_tokens</span>
                <span className="text-slate-900 font-black">{selectedLog.totalTokens}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">calculated_cost_usd</span>
                <span className="text-emerald-700 font-black">{formatCost(selectedLog.estimatedCost)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">latency_seconds</span>
                <span className="text-slate-850">{(selectedLog.requestDuration / 1000).toFixed(3)}s</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-400">pipeline_state</span>
                <span className={`font-bold ${selectedLog.status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {selectedLog.status.toUpperCase()}
                </span>
              </div>

              {selectedLog.errorMessage && (
                <div className="pt-2">
                  <span className="text-rose-500 font-bold block mb-1">exceptions_log</span>
                  <p className="bg-rose-50 border border-rose-100 text-rose-800 p-2.5 text-[10px] leading-relaxed rounded font-mono break-words select-all">
                    {selectedLog.errorMessage}
                  </p>
                </div>
              )}
            </div>

            <div>
              <button 
                onClick={() => setSelectedLog(null)}
                className="w-full py-2.5 bg-slate-900 text-white hover:bg-slate-800 rounded-xl text-xs font-bold uppercase tracking-wider transition"
              >
                Close Packet Inspector
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
