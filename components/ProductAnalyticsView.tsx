import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, Brain, Users, Building2, DollarSign, 
  ArrowRight, ShieldCheck, RefreshCw, Layers, 
  Search, CheckCircle2, AlertCircle, Info, Calendar,
  Sparkles, Lock, ArrowUpRight, Cpu, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile } from '../types';
import { 
  calculatePMFMetrics, 
  PMFDashboardData, 
  METRIC_DEFINITIONS 
} from '../services/productAnalyticsService';

interface ProductAnalyticsViewProps {
  userProfile?: UserProfile;
}

export const ProductAnalyticsView: React.FC<ProductAnalyticsViewProps> = ({ userProfile }) => {
  const [timeframe, setTimeframe] = useState<number>(30);
  const [data, setData] = useState<PMFDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'funnel' | 'retention' | 'economics' | 'definitions'>('overview');

  const loadData = async (days: number) => {
    setIsLoading(true);
    try {
      const res = await calculatePMFMetrics(days);
      setData(res);
    } catch (err) {
      console.error('Failed to load PMF metrics:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(timeframe);
  }, [timeframe]);

  if (userProfile?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center text-red-600 mb-4 border border-red-100">
          <Lock className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-brand-primary">Internal Access Only</h1>
        <p className="text-slate-500 max-w-md mt-2 text-sm">
          Product instrumentation and PMF measurement dashboards are strictly restricted to internal administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Banner & Title */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-brand-divider/20">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Internal PMF Measurement
            </span>
            <span className="text-xs text-slate-500 font-mono">Telemetry v3.1</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-brand-primary">
            Product-Market Fit & Memory Value
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Empirical measurement of organizational decision memory, north-star retrieval behavior, cohort retention, and B2B unit economics.
          </p>
        </div>

        {/* Timeframe & Action Bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center bg-white rounded-xl border border-slate-200 p-1 shadow-sm">
            {[
              { label: '7 Days', val: 7 },
              { label: '30 Days', val: 30 },
              { label: '90 Days', val: 90 },
              { label: 'All Time', val: 365 }
            ].map(tf => (
              <button
                key={tf.val}
                onClick={() => setTimeframe(tf.val)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  timeframe === tf.val
                    ? 'bg-brand-primary text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => loadData(timeframe)}
            disabled={isLoading}
            className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-sm transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand-primary' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200/60">
        {[
          { id: 'overview', label: 'Executive Overview', icon: TrendingUp },
          { id: 'funnel', label: 'Activation & Retrieval Funnel', icon: Layers },
          { id: 'retention', label: 'Retention & Memory Cohorts', icon: Clock },
          { id: 'economics', label: 'Unit Economics & Margins', icon: DollarSign },
          { id: 'definitions', label: 'Metric Definitions & Criteria', icon: Info }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-all ${
                isActive 
                  ? 'bg-brand-primary text-white shadow-sm' 
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="py-24 text-center space-y-4">
          <RefreshCw className="w-8 h-8 text-brand-primary animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-600">Aggregating telemetry events and calculating retention cohorts...</p>
        </div>
      ) : !data ? (
        <div className="py-16 text-center text-slate-500">
          No telemetry events recorded yet.
        </div>
      ) : (
        <div className="space-y-8">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-8 animate-in fade-in">
              {/* North Star Hero Card */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-primary via-[#111e38] to-[#0a1224] text-white p-8 shadow-xl">
                <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                  <Brain className="w-64 h-64 text-white" />
                </div>
                <div className="relative z-10 max-w-3xl space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 backdrop-blur-sm text-xs font-semibold text-emerald-300">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
                    North Star Metric (Decision & Execution Memory)
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-widest text-slate-300 font-semibold">
                      Verified Decision Retrievals
                    </div>
                    <div className="flex items-baseline gap-4">
                      <span className="text-5xl lg:text-6xl font-black tracking-tight text-white">
                        {data.memory.verifiedDecisionRetrievals}
                      </span>
                      <span className="text-sm text-slate-300 font-medium">
                        past decisions retrieved from memory
                      </span>
                    </div>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed pt-2">
                    "A user returns to EchoNote to retrieve a previously stored organizational decision." 
                    This metric represents true product-market fit value — distinguishing real memory reuse from single-session transcript generation.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-white/10">
                    <div>
                      <p className="text-xs text-slate-400">Retrieval Conversion Rate</p>
                      <p className="text-xl font-bold text-white mt-0.5">
                        {data.memory.decisionRetrievalRate}%
                      </p>
                      <p className="text-[11px] text-slate-400">of activated users</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Avg Retrievals / Active Org</p>
                      <p className="text-xl font-bold text-white mt-0.5">
                        {data.memory.avgRetrievalsPerActiveOrg}
                      </p>
                      <p className="text-[11px] text-slate-400">retrieval interactions</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Memory Search Queries</p>
                      <p className="text-xl font-bold text-white mt-0.5">
                        {data.memory.historicalSearches}
                      </p>
                      <p className="text-[11px] text-slate-400">historical queries</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 4 Core Pillars Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* 1. Organizations */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Organizations</span>
                    <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Building2 className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-black text-brand-primary">{data.health.totalOrganizations}</div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      <span className="font-semibold text-emerald-600">{data.health.activeOrganizations} active</span>
                      <span>({data.health.totalOrganizations > 0 ? Math.round((data.health.activeOrganizations / data.health.totalOrganizations) * 100) : 0}% activity)</span>
                    </div>
                  </div>
                </div>

                {/* 2. User Activation */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">User Activation</span>
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-black text-brand-primary">{data.health.activationRate}%</div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      <span className="font-semibold text-brand-primary">{data.health.activatedUsers}</span>
                      <span>of {data.health.totalUsers} users activated</span>
                    </div>
                  </div>
                </div>

                {/* 3. Decision Memory */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Decisions Stored</span>
                    <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                      <Brain className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-black text-brand-primary">{data.memory.decisionsSaved}</div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      <span className="font-semibold text-purple-600">{data.memory.decisionsCreated} extracted</span>
                      <span>from meetings</span>
                    </div>
                  </div>
                </div>

                {/* 4. Contribution Margin */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Contribution Margin</span>
                    <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                      <DollarSign className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <div className="text-3xl font-black text-brand-primary">
                      {data.economics.totalRevenue > 0 ? `${data.economics.contributionMarginPercent}%` : 'N/A'}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      <span>MRR: ${data.business.mrr}</span>
                      <span>• Cost: ${data.economics.totalVariableCost}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Funnel & Retention Preview */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Funnel Preview */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-brand-primary">Activation Loop Funnel</h2>
                    <button 
                      onClick={() => setActiveTab('funnel')}
                      className="text-xs font-semibold text-brand-primary hover:underline flex items-center gap-1"
                    >
                      Full Funnel <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    {data.funnel.slice(0, 6).map((step, idx) => (
                      <div key={step.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700">{idx + 1}. {step.name}</span>
                          <span className="font-semibold text-slate-900">{step.count} ({step.conversionFromFirst}%)</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-brand-primary rounded-full transition-all duration-500" 
                            style={{ width: `${Math.max(4, step.conversionFromFirst)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Retention Preview */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-brand-primary">Retention & Memory Utility</h2>
                    <button 
                      onClick={() => setActiveTab('retention')}
                      className="text-xs font-semibold text-brand-primary hover:underline flex items-center gap-1"
                    >
                      Cohort Matrix <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Day 1', cohort: data.retention.day1 },
                      { label: 'Day 7', cohort: data.retention.day7 },
                      { label: 'Day 14', cohort: data.retention.day14 },
                      { label: 'Day 28', cohort: data.retention.day28 }
                    ].map(item => (
                      <div key={item.label} className="bg-slate-50/70 border border-slate-100 rounded-xl p-3 text-center space-y-1">
                        <span className="text-[11px] font-bold text-slate-500 uppercase">{item.label}</span>
                        <div className="text-xl font-bold text-brand-primary">{item.cohort.rate}%</div>
                        <div className="text-[10px] text-emerald-600 font-medium">
                          {item.cohort.retrievalRate}% retrieved
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-100 text-xs text-blue-900 leading-relaxed">
                    <span className="font-semibold">Memory Retention Distinction:</span> Shows returning users who actively query previous decision records vs. passive logins.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ACTIVATION & RETRIEVAL FUNNEL */}
          {activeTab === 'funnel' && (
            <div className="bg-white rounded-2xl p-8 border border-slate-200/80 shadow-sm space-y-6 animate-in fade-in">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-brand-primary">Complete Strategic Product Loop</h2>
                <p className="text-xs text-slate-500">
                  Tracking progression: Entry &rarr; Capture &rarr; Transcription &rarr; Decision &rarr; Memory &rarr; Retrieval (North Star) &rarr; Subscription
                </p>
              </div>

              <div className="space-y-4">
                {data.funnel.map((step, idx) => {
                  const isNorthStar = step.event === 'DECISION_RETRIEVED';
                  return (
                    <div 
                      key={step.name} 
                      className={`p-4 rounded-xl border transition-all ${
                        isNorthStar 
                          ? 'bg-emerald-50/40 border-emerald-300 ring-1 ring-emerald-200' 
                          : 'bg-slate-50/50 border-slate-200/70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 mb-2">
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            isNorthStar ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'
                          }`}>
                            {idx + 1}
                          </span>
                          <div>
                            <span className="text-sm font-bold text-brand-primary">{step.name}</span>
                            {isNorthStar && (
                              <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 uppercase tracking-wide">
                                North Star Value
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-6 text-right">
                          <div>
                            <div className="text-sm font-bold text-slate-900">{step.count}</div>
                            <div className="text-[11px] text-slate-500">Events</div>
                          </div>
                          <div className="w-20">
                            <div className="text-sm font-bold text-brand-primary">{step.conversionFromFirst}%</div>
                            <div className="text-[11px] text-slate-500">Funnel Total</div>
                          </div>
                          <div className="w-20">
                            <div className="text-sm font-bold text-red-600">
                              {idx === 0 ? '0%' : `-${step.dropoffRate}%`}
                            </div>
                            <div className="text-[11px] text-slate-500">Drop-off</div>
                          </div>
                        </div>
                      </div>

                      {/* Bar */}
                      <div className="h-2.5 w-full bg-slate-200/60 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${
                            isNorthStar ? 'bg-emerald-500' : 'bg-brand-primary'
                          }`}
                          style={{ width: `${Math.max(2, step.conversionFromFirst)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: RETENTION & COHORTS */}
          {activeTab === 'retention' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="bg-white rounded-2xl p-8 border border-slate-200/80 shadow-sm space-y-6">
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-brand-primary">Longitudinal Cohort Retention</h2>
                  <p className="text-xs text-slate-500">
                    Comparing general return sessions with verified decision memory retrievals across standard day intervals.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {[
                    { label: 'Day 1 Retention', cohort: data.retention.day1, target: 'Next Day Recall' },
                    { label: 'Day 7 Retention', cohort: data.retention.day7, target: 'Weekly Planning Cycle' },
                    { label: 'Day 14 Retention', cohort: data.retention.day14, target: 'Bi-Weekly Sprints' },
                    { label: 'Day 28 Retention', cohort: data.retention.day28, target: 'Monthly Review' }
                  ].map(item => (
                    <div key={item.label} className="bg-slate-50 rounded-2xl p-6 border border-slate-200/80 space-y-4">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{item.label}</span>
                        <p className="text-xs text-slate-400 mt-0.5">{item.target}</p>
                      </div>

                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-600">General Return</span>
                          <span className="text-lg font-bold text-brand-primary">{item.cohort.rate}%</span>
                        </div>
                        <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-primary rounded-full" style={{ width: `${item.cohort.rate}%` }} />
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                          <span className="text-xs font-semibold text-emerald-700">Memory Retrieval</span>
                          <span className="text-lg font-bold text-emerald-600">{item.cohort.retrievalRate}%</span>
                        </div>
                        <div className="h-2 w-full bg-emerald-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${item.cohort.retrievalRate}%` }} />
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-200">
                        Cohort base: {item.cohort.eligible} users
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Verified Retrievals Stream */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-brand-primary flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    Verified Decision Retrieval Stream (Anonymized Audit)
                  </h3>
                  <span className="text-xs text-slate-400">Zero PII / No transcript content</span>
                </div>

                {data.recentRetrievals.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    No verified retrieval events recorded in this timeframe yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.recentRetrievals.map(r => (
                      <div key={r.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          <span className="font-mono text-slate-700 font-semibold">{r.id}</span>
                          <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                            source: {r.source || 'history'}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-slate-500">
                          <span>User: {r.userId?.substring(0, 8)}...</span>
                          <span className="font-mono">{new Date(r.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: UNIT ECONOMICS & MARGINS */}
          {activeTab === 'economics' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Total MRR</span>
                  <div className="text-3xl font-black text-brand-primary">${data.business.mrr}</div>
                  <p className="text-xs text-slate-400">ARR Run Rate: ${data.business.arr}</p>
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Variable AI & Audio Costs</span>
                  <div className="text-3xl font-black text-brand-primary">${data.economics.totalVariableCost}</div>
                  <p className="text-xs text-slate-400">
                    Gemini AI: ${data.economics.totalAICost} • Audio: ${data.economics.totalTranscriptionCost}
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Gross Contribution Margin</span>
                  <div className="text-3xl font-black text-emerald-600">
                    {data.economics.totalRevenue > 0 ? `${data.economics.contributionMarginPercent}%` : '$0.00'}
                  </div>
                  <p className="text-xs text-slate-400">
                    Net Margin: ${data.economics.contributionMarginDollars}
                  </p>
                </div>
              </div>

              {/* Unit Economics Breakdown Card */}
              <div className="bg-white rounded-2xl p-8 border border-slate-200/80 shadow-sm space-y-6">
                <h3 className="text-base font-bold text-brand-primary">Per-Unit Cost Breakdown</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/60 space-y-2">
                    <span className="text-xs font-bold text-slate-600">Avg AI Cost per Active Organization</span>
                    <div className="text-2xl font-bold text-brand-primary">
                      ${data.economics.avgAICostPerActiveOrg}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Calculated across {data.health.activeOrganizations} active team environments.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/60 space-y-2">
                    <span className="text-xs font-bold text-slate-600">Avg AI Cost per Active User</span>
                    <div className="text-2xl font-bold text-brand-primary">
                      ${data.economics.avgAICostPerActiveUser}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Calculated across {data.health.activeUsers} active user accounts.
                    </p>
                  </div>
                </div>

                {/* Transparent Uncalculated Metrics Notice */}
                <div className="space-y-3 pt-4 border-t border-slate-200">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Longitudinal Metrics Status
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200 text-xs text-amber-900 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                        Customer Acquisition Cost (CAC)
                      </div>
                      <p className="text-amber-800">{data.business.cacNotice}</p>
                    </div>

                    <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200 text-xs text-amber-900 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                        Customer Lifetime Value (LTV)
                      </div>
                      <p className="text-amber-800">{data.business.ltvNotice}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: DEFINITIONS & CRITERIA */}
          {activeTab === 'definitions' && (
            <div className="bg-white rounded-2xl p-8 border border-slate-200/80 shadow-sm space-y-6 animate-in fade-in">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-brand-primary">Official PMF Metric Definitions</h2>
                <p className="text-xs text-slate-500">
                  Standardized institutional criteria for measuring EchoNote's business viability and product utility.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {METRIC_DEFINITIONS.map(def => (
                  <div key={def.name} className="p-5 rounded-2xl bg-slate-50 border border-slate-200/70 space-y-2">
                    <h3 className="text-sm font-bold text-brand-primary">{def.name}</h3>
                    <div className="p-2 rounded-lg bg-white border border-slate-200 font-mono text-[11px] text-slate-700">
                      {def.formula}
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed pt-1">
                      {def.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
