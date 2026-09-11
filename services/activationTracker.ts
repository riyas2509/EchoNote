import { db, collection, addDoc, serverTimestamp } from '../firebase';
import { AuthStatus, ProductEventName } from '../types';
import { trackProductEvent } from './productAnalyticsService';

export type ActivationEventName =
  | 'FIRST_APP_ENTRY'
  | 'ONBOARDING_VIEWED'
  | 'CAPTURE_STARTED'
  | 'AUDIO_UPLOADED'
  | 'RECORDING_STARTED'
  | 'TRANSCRIPTION_STARTED'
  | 'TRANSCRIPTION_COMPLETED'
  | 'INTELLIGENCE_ANALYSIS_STARTED'
  | 'INTELLIGENCE_ANALYSIS_COMPLETED'
  | 'DECISION_VIEWED'
  | 'DECISION_SAVED'
  | 'HISTORY_VIEWED'
  | 'DECISION_SEARCHED'
  | 'DECISION_RETRIEVED'
  | 'FIRST_VALUE_REACHED';

export interface ActivationEventPayload {
  eventName: ActivationEventName;
  authStatus?: AuthStatus;
  userId?: string;
  userEmail?: string;
  plan?: string;
  source?: 'upload' | 'live' | 'sample' | 'search' | 'onboarding' | 'history';
  recordId?: string;
  metadata?: {
    durationMs?: number;
    decisionCount?: number;
    searchQuery?: string;
    retrievalMatchCount?: number;
    step?: string;
    fileFormat?: string;
    [key: string]: any;
  };
}

export interface StoredActivationEvent extends ActivationEventPayload {
  id: string;
  timestamp: string;
  sessionId: string;
}

const SESSION_KEY = 'echonote_activation_session_id';
const EVENTS_BUFFER_KEY = 'echonote_activation_events_buffer';
const FIRST_VALUE_COMPLETED_KEY = 'echonote_first_value_completed';

export function getActivationSessionId(): string {
  if (typeof window === 'undefined') return 'server_session';
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = `act_ses_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }
  return sessionId;
}

export function isFirstValueCompleted(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(FIRST_VALUE_COMPLETED_KEY) === 'true';
}

export function markFirstValueCompleted(): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(FIRST_VALUE_COMPLETED_KEY, 'true');
  }
}

/**
 * Track an activation funnel event with zero latency
 * Persists locally and feeds into unified PMF telemetry
 */
export async function trackActivationEvent(payload: ActivationEventPayload): Promise<void> {
  const sessionId = getActivationSessionId();
  const timestamp = new Date().toISOString();
  const eventRecord: StoredActivationEvent = {
    ...payload,
    id: `ev_${Math.random().toString(36).substring(2, 9)}`,
    sessionId,
    timestamp
  };

  // 1. Log locally to localStorage buffer (max 100 recent events)
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(EVENTS_BUFFER_KEY);
      const list: StoredActivationEvent[] = raw ? JSON.parse(raw) : [];
      list.unshift(eventRecord);
      if (list.length > 100) list.pop();
      localStorage.setItem(EVENTS_BUFFER_KEY, JSON.stringify(list));
    }
  } catch (err) {
    console.debug('Activation event local storage warning:', err);
  }

  // 2. Feed into strongly-typed unified Product Event system
  try {
    const pEventName = payload.eventName as unknown as ProductEventName;
    trackProductEvent({
      eventName: pEventName,
      userId: payload.userId,
      plan: payload.plan,
      source: payload.source,
      entityType: payload.recordId ? 'decision' : 'onboarding',
      entityId: payload.recordId,
      metadata: payload.metadata
    });
  } catch (err) {
    console.debug('Product event sync note:', err);
  }

  // 3. Log to console for debugging and transparency
  console.log(`[Activation Tracker] ⚡ ${payload.eventName}`, {
    source: payload.source,
    userId: payload.userId || 'guest',
    plan: payload.plan || 'guest',
    metadata: payload.metadata
  });

  // 4. Record to Firestore activationEvents collection
  if (payload.userId && payload.userId !== 'guest' && db) {
    try {
      await addDoc(collection(db, 'activationEvents'), {
        eventName: payload.eventName,
        userId: payload.userId,
        userEmail: payload.userEmail || null,
        plan: payload.plan || 'free',
        source: payload.source || null,
        recordId: payload.recordId || null,
        metadata: payload.metadata || {},
        sessionId,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      console.debug('Firestore activation event save skipped:', err);
    }
  }
}

export function getLocalActivationEvents(): StoredActivationEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(EVENTS_BUFFER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

