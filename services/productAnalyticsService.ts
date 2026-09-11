import { db, collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, limit } from '../firebase';
import { ProductEventName, ProductEventPayload, StoredProductEvent, SubscriptionTier } from '../types';

const SESSION_STORAGE_KEY = 'echonote_pmf_session_id';
const SESSION_START_KEY = 'echonote_pmf_session_start';
const LAST_ACTIVITY_KEY = 'echonote_pmf_last_activity';
const FIRST_SEEN_KEY = 'echonote_pmf_first_seen';
const TOTAL_SESSIONS_KEY = 'echonote_pmf_total_sessions';
const EVENTS_BUFFER_KEY = 'echonote_pmf_events_buffer';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes inactivity boundary

/**
 * Minimum safe session identification without intrusive fingerprinting
 */
export function getOrCreateSessionId(): { sessionId: string; isNewSession: boolean; sessionIndex: number } {
  if (typeof window === 'undefined') {
    return { sessionId: 'server_session', isNewSession: false, sessionIndex: 1 };
  }

  const now = Date.now();
  let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
  const lastActiveStr = localStorage.getItem(LAST_ACTIVITY_KEY);
  const lastActive = lastActiveStr ? parseInt(lastActiveStr, 10) : 0;
  
  // Track total sessions count in localStorage
  let totalSessions = parseInt(localStorage.getItem(TOTAL_SESSIONS_KEY) || '0', 10);
  let isNewSession = false;

  if (!sessionId || (lastActive > 0 && now - lastActive > SESSION_TIMEOUT_MS)) {
    // Generate new lightweight session ID
    sessionId = `ses_${Math.random().toString(36).substring(2, 9)}_${now}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    sessionStorage.setItem(SESSION_START_KEY, now.toString());
    
    totalSessions += 1;
    localStorage.setItem(TOTAL_SESSIONS_KEY, totalSessions.toString());
    isNewSession = true;
  }

  if (!localStorage.getItem(FIRST_SEEN_KEY)) {
    localStorage.setItem(FIRST_SEEN_KEY, new Date().toISOString());
  }

  localStorage.setItem(LAST_ACTIVITY_KEY, now.toString());

  return { sessionId, isNewSession, sessionIndex: totalSessions };
}

/**
 * Initialize session tracker for user and fire RETURN_SESSION if user returned
 */
export function initSessionTracker(userId?: string, plan?: string, organizationId?: string): void {
  if (typeof window === 'undefined') return;

  const { sessionId, isNewSession, sessionIndex } = getOrCreateSessionId();
  const firstSeenStr = localStorage.getItem(FIRST_SEEN_KEY);
  const firstSeen = firstSeenStr ? new Date(firstSeenStr).getTime() : Date.now();
  const daysSinceFirstSeen = Math.floor((Date.now() - firstSeen) / (1000 * 60 * 60 * 24));

  // If this is a new session and user has visited before (sessionIndex > 1 or daysSinceFirstSeen >= 1)
  if (isNewSession && sessionIndex > 1) {
    trackProductEvent({
      eventName: ProductEventName.RETURN_SESSION,
      userId: userId || 'guest',
      organizationId,
      plan: plan || 'free',
      entityType: 'session',
      entityId: sessionId,
      metadata: {
        sessionIndex,
        daysSinceFirstSeen
      }
    });
  }
}

/**
 * Data minimization & privacy enforcement
 * Strips any sensitive conversation, raw transcripts, or full AI responses
 */
function sanitizeEventPayload(payload: ProductEventPayload): ProductEventPayload {
  const cleanPayload: ProductEventPayload = {
    eventName: payload.eventName,
    userId: payload.userId || 'guest',
    organizationId: payload.organizationId,
    teamId: payload.teamId,
    sessionId: payload.sessionId,
    plan: payload.plan || 'free',
    source: payload.source,
    entityType: payload.entityType,
    entityId: payload.entityId,
    isHistorical: payload.isHistorical,
    metadata: {}
  };

  if (payload.metadata) {
    // Only copy safe numeric/boolean/short categorical attributes
    for (const [key, val] of Object.entries(payload.metadata)) {
      if (typeof val === 'number' || typeof val === 'boolean') {
        cleanPayload.metadata![key] = val;
      } else if (typeof val === 'string') {
        // Strict privacy guard: Never pass raw transcript or conversation text
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('transcript') ||
          lowerKey.includes('text') ||
          lowerKey.includes('prompt') ||
          lowerKey.includes('response') ||
          lowerKey.includes('summary') ||
          lowerKey.includes('meeting') ||
          lowerKey.includes('audio') ||
          lowerKey.includes('question')
        ) {
          // Truncate to length only
          cleanPayload.metadata![`${key}Length`] = val.length;
        } else if (val.length <= 64) {
          // Safe short enum / status string
          cleanPayload.metadata![key] = val;
        }
      }
    }
  }

  return cleanPayload;
}

/**
 * Track strongly-typed product behavior event
 */
export async function trackProductEvent(rawPayload: ProductEventPayload): Promise<void> {
  const { sessionId } = getOrCreateSessionId();
  const payload = sanitizeEventPayload({
    ...rawPayload,
    sessionId: rawPayload.sessionId || sessionId
  });

  const timestamp = new Date().toISOString();
  const eventRecord: StoredProductEvent = {
    ...payload,
    id: `ev_${Math.random().toString(36).substring(2, 9)}`,
    timestamp
  };

  // 1. Write to local buffer (up to 200 events)
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(EVENTS_BUFFER_KEY);
      const list: StoredProductEvent[] = raw ? JSON.parse(raw) : [];
      list.unshift(eventRecord);
      if (list.length > 200) list.pop();
      localStorage.setItem(EVENTS_BUFFER_KEY, JSON.stringify(list));
    }
  } catch (err) {
    console.debug('Product event local storage warning:', err);
  }

  // 2. Developer console logging for instrumentation audits
  console.log(`[PMF Event] 📊 ${payload.eventName}`, {
    entityType: payload.entityType,
    entityId: payload.entityId,
    userId: payload.userId,
    plan: payload.plan,
    isHistorical: payload.isHistorical,
    metadata: payload.metadata
  });

  // 3. Firestore persistence if authenticated
  if (payload.userId && payload.userId !== 'guest' && db) {
    try {
      await addDoc(collection(db, 'productEvents'), {
        eventName: payload.eventName,
        userId: payload.userId,
        organizationId: payload.organizationId || null,
        teamId: payload.teamId || null,
        plan: payload.plan || 'free',
        source: payload.source || null,
        entityType: payload.entityType || null,
        entityId: payload.entityId || null,
        isHistorical: payload.isHistorical || false,
        metadata: payload.metadata || {},
        sessionId: payload.sessionId || sessionId,
        createdAt: serverTimestamp(),
        timestampISO: timestamp
      });
    } catch (err) {
      // Non-blocking fire-and-forget
      console.debug('Firestore product event persistence skipped:', err);
    }
  }
}

/**
 * NORTH STAR EVENT: VERIFIED DECISION RETRIEVAL
 * Only fires when a user actually retrieves a previous decision/history record through a valid product interaction.
 */
export function trackDecisionRetrieved(args: {
  userId?: string;
  organizationId?: string;
  entityId: string;
  source: 'decision_history' | 'history_dashboard' | 'ask_echonote' | 'activation_search' | 'deep_link';
  matchCount?: number;
  searchQueryLength?: number;
}): void {
  trackProductEvent({
    eventName: ProductEventName.DECISION_RETRIEVED,
    userId: args.userId,
    organizationId: args.organizationId,
    entityType: 'decision',
    entityId: args.entityId,
    isHistorical: true,
    source: args.source,
    metadata: {
      retrievalMatchCount: args.matchCount || 1,
      searchQueryLength: args.searchQueryLength
    }
  });
}

/**
 * Track decision saved to organizational memory
 */
export function trackDecisionSaved(args: {
  userId?: string;
  organizationId?: string;
  entityId?: string;
  source: string;
  decisionCount?: number;
}): void {
  trackProductEvent({
    eventName: ProductEventName.DECISION_SAVED,
    userId: args.userId,
    organizationId: args.organizationId,
    entityType: 'decision',
    entityId: args.entityId,
    source: args.source,
    metadata: {
      decisionCount: args.decisionCount || 1
    }
  });
}

/**
 * Track execution items created
 */
export function trackExecutionItemCreated(args: {
  userId?: string;
  organizationId?: string;
  count: number;
  entityId?: string;
}): void {
  trackProductEvent({
    eventName: ProductEventName.EXECUTION_ITEM_CREATED,
    userId: args.userId,
    organizationId: args.organizationId,
    entityType: 'task',
    entityId: args.entityId,
    metadata: {
      taskCount: args.count
    }
  });
}

/**
 * Track execution items completed
 */
export function trackExecutionItemCompleted(args: {
  userId?: string;
  organizationId?: string;
  taskId: string;
}): void {
  trackProductEvent({
    eventName: ProductEventName.EXECUTION_ITEM_COMPLETED,
    userId: args.userId,
    organizationId: args.organizationId,
    entityType: 'task',
    entityId: args.taskId
  });
}

export function getLocalProductEvents(): StoredProductEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(EVENTS_BUFFER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// -------------------------------------------------------------
// PMF & BUSINESS METRICS CALCULATION INTERFACES
// -------------------------------------------------------------

export interface ProductHealthMetrics {
  totalOrganizations: number;
  activeOrganizations: number;
  totalUsers: number;
  activeUsers: number;
  activatedUsers: number;
  activationRate: number; // activatedUsers / eligibleUsers
}

export interface MemoryValueMetrics {
  decisionsCreated: number;
  decisionsSaved: number;
  historicalSearches: number;
  verifiedDecisionRetrievals: number; // NORTH STAR
  decisionRetrievalRate: number; // users with retrieval / activated users
  avgRetrievalsPerActiveOrg: number;
}

export interface RetentionCohortMetrics {
  day1: { eligible: number; returned: number; rate: number; retrievedMemory: number; retrievalRate: number };
  day7: { eligible: number; returned: number; rate: number; retrievedMemory: number; retrievalRate: number };
  day14: { eligible: number; returned: number; rate: number; retrievedMemory: number; retrievalRate: number };
  day28: { eligible: number; returned: number; rate: number; retrievedMemory: number; retrievalRate: number };
}

export interface BusinessMetrics {
  paidOrganizations: number;
  freeOrganizations: number;
  paidConversionRate: number;
  mrr: number;
  arr: number;
  upgradeRate: number;
  totalRevenue: number;
  cacNotice: string;
  ltvNotice: string;
}

export interface UnitEconomicsMetrics {
  totalAICost: number;
  totalTranscriptionCost: number;
  totalVariableCost: number;
  totalRevenue: number;
  contributionMarginDollars: number;
  contributionMarginPercent: number;
  avgAICostPerActiveUser: number;
  avgAICostPerActiveOrg: number;
}

export interface FunnelStepMetric {
  name: string;
  event: ProductEventName;
  count: number;
  conversionFromFirst: number; // % of first step
  dropoffRate: number; // % dropped from previous step
}

export interface PMFDashboardData {
  timeframeDays: number;
  hasData: boolean;
  health: ProductHealthMetrics;
  memory: MemoryValueMetrics;
  retention: RetentionCohortMetrics;
  business: BusinessMetrics;
  economics: UnitEconomicsMetrics;
  funnel: FunnelStepMetric[];
  recentRetrievals: StoredProductEvent[];
}

/**
 * Standard USD Pricing mapping for Revenue computation
 */
export const TIER_REVENUE_MAPPING: Record<SubscriptionTier, number> = {
  guest: 0,
  free: 0,
  pro: 12.0,
  team: 30.0,
  enterprise: 120.0
};

/**
 * Metric Definitions Glossary
 */
export const METRIC_DEFINITIONS = [
  {
    name: 'Activated User',
    formula: 'Users who complete capture + view structured decision intelligence',
    description: 'A user who successfully processes a meaningful conversation and extracts an actionable decision output with ownership.'
  },
  {
    name: 'Verified Decision Retrieval (North Star)',
    formula: 'Explicit access/search of previously stored organizational memory',
    description: 'The core PMF signal: a user returns to query, recall, or reuse a decision agreed upon in a previous meeting.'
  },
  {
    name: 'Active Organization',
    formula: 'Organization with >= 1 decision, search, or transcript activity in period',
    description: 'B2B adoption signal indicating continuous team usage beyond initial onboarding.'
  },
  {
    name: 'Decision Retrieval Retention',
    formula: 'Cohort users returning AND retrieving past decisions / Activated cohort users',
    description: 'Differentiates users who merely reopen the tab from users who extract actual recurring utility from organizational memory.'
  },
  {
    name: 'Contribution Margin',
    formula: '(Total Customer Revenue - Total Variable AI/Audio Costs) / Total Revenue',
    description: 'Direct gross unit profitability after variable token generation and transcription infrastructure costs.'
  }
];

/**
 * Query and compute internal PMF & Business Metrics
 */
export async function calculatePMFMetrics(timeframeDays: number = 30): Promise<PMFDashboardData> {
  const cutoffTime = Date.now() - timeframeDays * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffTime);

  // In-memory containers for aggregation
  let events: StoredProductEvent[] = [];
  let usersList: any[] = [];
  let orgsList: any[] = [];
  let userAnalyticsList: any[] = [];

  // Try fetching from Firestore if available
  if (db) {
    try {
      // 1. Fetch product events
      const evQuery = query(
        collection(db, 'productEvents'),
        where('createdAt', '>=', cutoffDate),
        orderBy('createdAt', 'desc'),
        limit(500)
      );
      const evSnap = await getDocs(evQuery);
      evSnap.forEach(doc => {
        const d = doc.data();
        events.push({
          id: doc.id,
          eventName: d.eventName,
          userId: d.userId,
          organizationId: d.organizationId,
          plan: d.plan,
          source: d.source,
          entityType: d.entityType,
          entityId: d.entityId,
          isHistorical: d.isHistorical,
          metadata: d.metadata || {},
          timestamp: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString()
        });
      });

      // 2. Fetch Users
      const uSnap = await getDocs(collection(db, 'users'));
      uSnap.forEach(d => usersList.push({ id: d.id, ...d.data() }));

      // 3. Fetch Organizations
      const orgSnap = await getDocs(collection(db, 'organizations'));
      orgSnap.forEach(d => orgsList.push({ id: d.id, ...d.data() }));

      // 4. Fetch User Analytics (for AI costs)
      const uaSnap = await getDocs(collection(db, 'userAnalytics'));
      uaSnap.forEach(d => userAnalyticsList.push({ id: d.id, ...d.data() }));
    } catch (err) {
      console.warn('Firestore PMF query fallback to local events buffer:', err);
    }
  }

  // Fallback / merge with local buffer
  if (events.length === 0) {
    events = getLocalProductEvents().filter(e => new Date(e.timestamp).getTime() >= cutoffTime);
  }

  const hasData = events.length > 0 || usersList.length > 0;

  // --- HEALTH METRICS ---
  const activeUserIds = new Set<string>();
  const activatedUserIds = new Set<string>();
  const activeOrgIds = new Set<string>();
  const usersWithRetrieval = new Set<string>();

  let decisionsCreated = 0;
  let decisionsSaved = 0;
  let historicalSearches = 0;
  let verifiedDecisionRetrievals = 0;
  let totalUpgrades = 0;
  let totalSubscriptions = 0;

  const eventCounts: Record<string, number> = {};

  events.forEach(e => {
    eventCounts[e.eventName] = (eventCounts[e.eventName] || 0) + 1;
    if (e.userId && e.userId !== 'guest') activeUserIds.add(e.userId);
    if (e.organizationId) activeOrgIds.add(e.organizationId);

    if (e.eventName === ProductEventName.DECISION_VIEWED || e.eventName === ProductEventName.INTELLIGENCE_ANALYSIS_COMPLETED) {
      if (e.userId) activatedUserIds.add(e.userId);
    }

    if (e.eventName === ProductEventName.INTELLIGENCE_ANALYSIS_COMPLETED || e.eventName === ProductEventName.DECISION_VIEWED) {
      decisionsCreated += 1;
    }
    if (e.eventName === ProductEventName.DECISION_SAVED) {
      decisionsSaved += 1;
    }
    if (e.eventName === ProductEventName.DECISION_SEARCHED) {
      historicalSearches += 1;
    }
    if (e.eventName === ProductEventName.DECISION_RETRIEVED) {
      verifiedDecisionRetrievals += 1;
      if (e.userId) usersWithRetrieval.add(e.userId);
    }
    if (e.eventName === ProductEventName.UPGRADE_STARTED) {
      totalUpgrades += 1;
    }
    if (e.eventName === ProductEventName.SUBSCRIPTION_STARTED) {
      totalSubscriptions += 1;
    }
  });

  const totalUsers = Math.max(usersList.length, activeUserIds.size);
  const totalOrganizations = Math.max(orgsList.length, activeOrgIds.size);
  const activeUsers = activeUserIds.size;
  const activatedUsers = activatedUserIds.size;
  const activationRate = totalUsers > 0 ? Math.round((activatedUsers / totalUsers) * 100) : 0;

  // --- MEMORY VALUE METRICS ---
  const decisionRetrievalRate = activatedUsers > 0 
    ? Math.round((usersWithRetrieval.size / activatedUsers) * 100) 
    : 0;

  const avgRetrievalsPerActiveOrg = activeOrgIds.size > 0 
    ? Math.round((verifiedDecisionRetrievals / activeOrgIds.size) * 10) / 10 
    : verifiedDecisionRetrievals;

  // --- RETENTION CALCULATIONS ---
  // Simple cohort categorization based on days between first seen and return/retrieval events
  const calculateCohort = (dayTarget: number) => {
    let eligible = 0;
    let returned = 0;
    let retrievedMemory = 0;

    usersList.forEach(u => {
      const createdDate = u.createdAt ? new Date(u.createdAt).getTime() : 0;
      if (createdDate > 0 && Date.now() - createdDate >= dayTarget * 24 * 60 * 60 * 1000) {
        eligible += 1;
        // Check if user has events after dayTarget
        const hasReturn = events.some(e => e.userId === u.id && new Date(e.timestamp).getTime() >= createdDate + dayTarget * 24 * 60 * 60 * 1000);
        if (hasReturn) returned += 1;

        const hasRetrieval = events.some(e => e.userId === u.id && e.eventName === ProductEventName.DECISION_RETRIEVED && new Date(e.timestamp).getTime() >= createdDate + dayTarget * 24 * 60 * 60 * 1000);
        if (hasRetrieval) retrievedMemory += 1;
      }
    });

    // Fallback if usersList is empty but events exist
    if (eligible === 0 && events.length > 0) {
      eligible = Math.max(1, activeUserIds.size);
      returned = Math.min(eligible, events.filter(e => e.eventName === ProductEventName.RETURN_SESSION).length);
      retrievedMemory = Math.min(returned, verifiedDecisionRetrievals);
    }

    const rate = eligible > 0 ? Math.round((returned / eligible) * 100) : 0;
    const retrievalRate = eligible > 0 ? Math.round((retrievedMemory / eligible) * 100) : 0;

    return { eligible, returned, rate, retrievedMemory, retrievalRate };
  };

  const retention: RetentionCohortMetrics = {
    day1: calculateCohort(1),
    day7: calculateCohort(7),
    day14: calculateCohort(14),
    day28: calculateCohort(28)
  };

  // --- BUSINESS METRICS ---
  let paidOrgs = 0;
  let freeOrgs = 0;
  let mrr = 0;

  usersList.forEach(u => {
    const plan = (u.plan || 'free') as SubscriptionTier;
    const price = TIER_REVENUE_MAPPING[plan] || 0;
    if (price > 0) {
      paidOrgs += 1;
      mrr += price;
    } else {
      freeOrgs += 1;
    }
  });

  const arr = mrr * 12;
  const paidConversionRate = (paidOrgs + freeOrgs) > 0 
    ? Math.round((paidOrgs / (paidOrgs + freeOrgs)) * 100) 
    : 0;
  const upgradeRate = totalUsers > 0 ? Math.round((totalUpgrades / totalUsers) * 100) : 0;

  // --- UNIT ECONOMICS ---
  let totalAICost = 0;
  let totalTranscriptionCost = 0;

  userAnalyticsList.forEach(ua => {
    totalAICost += ua.totalAICost || ua.lifetimeAICost || 0;
    totalTranscriptionCost += (ua.transcriptionMinutesUsed || 0) * 0.006; // $0.006/min baseline audio inference
  });

  // If no user analytics collection records yet, estimate from token counts or safe zero
  const totalVariableCost = totalAICost + totalTranscriptionCost;
  const totalRevenue = mrr;
  const contributionMarginDollars = totalRevenue - totalVariableCost;
  const contributionMarginPercent = totalRevenue > 0 
    ? Math.round((contributionMarginDollars / totalRevenue) * 100) 
    : 0;

  const avgAICostPerActiveUser = activeUsers > 0 
    ? Math.round((totalAICost / activeUsers) * 100) / 100 
    : 0;
  const avgAICostPerActiveOrg = activeOrgIds.size > 0 
    ? Math.round((totalAICost / activeOrgIds.size) * 100) / 100 
    : 0;

  // --- FUNNEL METRICS ---
  const funnelKeys: { name: string; event: ProductEventName }[] = [
    { name: 'App Entry', event: ProductEventName.FIRST_APP_ENTRY },
    { name: 'Capture Initiated', event: ProductEventName.CAPTURE_STARTED },
    { name: 'Transcription Done', event: ProductEventName.TRANSCRIPTION_COMPLETED },
    { name: 'Intelligence Extracted', event: ProductEventName.INTELLIGENCE_ANALYSIS_COMPLETED },
    { name: 'Decision Viewed', event: ProductEventName.DECISION_VIEWED },
    { name: 'Decision Saved', event: ProductEventName.DECISION_SAVED },
    { name: 'Memory Searched', event: ProductEventName.DECISION_SEARCHED },
    { name: 'Decision Retrieved (North Star)', event: ProductEventName.DECISION_RETRIEVED },
    { name: 'Return Session', event: ProductEventName.RETURN_SESSION },
    { name: 'Upgrade Started', event: ProductEventName.UPGRADE_STARTED }
  ];

  const firstCount = Math.max(1, eventCounts[ProductEventName.FIRST_APP_ENTRY] || events.length);
  let prevCount = firstCount;

  const funnel: FunnelStepMetric[] = funnelKeys.map(k => {
    const count = eventCounts[k.event] || 0;
    const conversionFromFirst = Math.round((count / firstCount) * 100);
    const dropoffRate = prevCount > 0 ? Math.max(0, Math.round(((prevCount - count) / prevCount) * 100)) : 0;
    prevCount = Math.max(1, count);
    return {
      name: k.name,
      event: k.event,
      count,
      conversionFromFirst,
      dropoffRate
    };
  });

  const recentRetrievals = events
    .filter(e => e.eventName === ProductEventName.DECISION_RETRIEVED)
    .slice(0, 10);

  return {
    timeframeDays,
    hasData,
    health: {
      totalOrganizations,
      activeOrganizations: activeOrgIds.size,
      totalUsers,
      activeUsers,
      activatedUsers,
      activationRate
    },
    memory: {
      decisionsCreated,
      decisionsSaved,
      historicalSearches,
      verifiedDecisionRetrievals,
      decisionRetrievalRate,
      avgRetrievalsPerActiveOrg
    },
    retention,
    business: {
      paidOrganizations: paidOrgs,
      freeOrganizations: freeOrgs,
      paidConversionRate,
      mrr,
      arr,
      upgradeRate,
      totalRevenue,
      cacNotice: 'CAC cannot be calculated yet (requires marketing & paid acquisition ad spend input data).',
      ltvNotice: 'LTV cannot be calculated yet (requires longitudinal 6-12 month churn & renewal cohort data).'
    },
    economics: {
      totalAICost: Math.round(totalAICost * 1000) / 1000,
      totalTranscriptionCost: Math.round(totalTranscriptionCost * 1000) / 1000,
      totalVariableCost: Math.round(totalVariableCost * 1000) / 1000,
      totalRevenue,
      contributionMarginDollars: Math.round(contributionMarginDollars * 100) / 100,
      contributionMarginPercent,
      avgAICostPerActiveUser,
      avgAICostPerActiveOrg
    },
    funnel,
    recentRetrievals
  };
}
