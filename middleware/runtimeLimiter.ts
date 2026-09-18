/**
 * ECHO NOTE — RUNTIME ABUSE & CONCURRENCY LIMITER (STEP 8.1A)
 *
 * ARCHITECTURAL NOTICE & CLOUD RUN HORIZONTAL SCALING:
 * ==============================================================================
 * This module provides an in-process, sliding-window rate limiter and concurrency
 * semaphore for high-cost runtime operations (Gemini AI inference & FFmpeg audio transcoding).
 *
 * CRITICAL CLOUD RUN CONSTRAINT:
 * This implementation is PER-INSTANCE.
 * In Google Cloud Run, where instances scale horizontally (0..N), each instance maintains
 * its own local memory state. This limiter protects each container instance independently
 * from CPU starvation, memory saturation, and rogue fast-loop attacks, but it does NOT
 * provide a globally shared quota across all instances.
 *
 * The storage interface (IRateLimitStore) is explicitly abstracted so that it can be
 * backed by a distributed key-value store (e.g. Google Cloud Memorystore / Redis) in
 * future remediations without rewriting endpoint business logic.
 * ==============================================================================
 */

import { Response, NextFunction } from "express";
import { LRUCache } from "lru-cache";
import { AuthenticatedRequest } from "./auth.js";

export interface RateLimitConfig {
  maxPerMinute: number;
  maxPerHour: number;
  maxConcurrentPerUser: number;
  maxConcurrentInstance: number;
}

/**
 * Standard rate and concurrency profiles mandated by Step 8.1A:
 * - AI: 15 req/min, 100 req/hour per authenticated UID; max 2 concurrent per UID
 * - FFmpeg: 6 req/min, 30 req/hour per authenticated UID; max 1 concurrent per UID
 */
export const AI_LIMIT_CONFIG: RateLimitConfig = {
  maxPerMinute: 15,
  maxPerHour: 100,
  maxConcurrentPerUser: 2,
  // Conservative instance ceiling for 2 vCPU / 4GB RAM Cloud Run environment
  maxConcurrentInstance: parseInt(process.env.INSTANCE_MAX_CONCURRENT_AI || "10", 10),
};

export const FFMPEG_LIMIT_CONFIG: RateLimitConfig = {
  maxPerMinute: 6,
  maxPerHour: 30,
  maxConcurrentPerUser: 1,
  // Conservative instance ceiling: FFmpeg uses 100% of 1 core per job; max 2 for 2 vCPUs
  maxConcurrentInstance: parseInt(process.env.INSTANCE_MAX_CONCURRENT_FFMPEG || "2", 10),
};

export const INSTANCE_MAX_CONCURRENT_EXPENSIVE = parseInt(
  process.env.INSTANCE_MAX_CONCURRENT_EXPENSIVE_WORK || "10",
  10
);

export interface ConcurrencySlot {
  release: () => void;
}

export interface AdmissionResult {
  admitted: boolean;
  status?: number;
  error?: string;
  code?: string;
  retryAfter?: number;
  slot?: ConcurrencySlot;
}

interface UserWindowData {
  timestamps: number[];
  activeCount: number;
}

/**
 * Pluggable store interface to allow replacing in-memory storage with distributed Redis/Memorystore.
 */
export interface IRateLimitStore {
  admit(uid: string, type: 'ai' | 'ffmpeg'): AdmissionResult;
  getActiveCount(type: 'ai' | 'ffmpeg'): number;
  getUserActiveCount(uid: string, type: 'ai' | 'ffmpeg'): number;
  reset(): void;
}

export class LRUCacheRateLimitStore implements IRateLimitStore {
  private aiUserCache: LRUCache<string, UserWindowData>;
  private ffmpegUserCache: LRUCache<string, UserWindowData>;
  
  private activeAiInstance = 0;
  private activeFfmpegInstance = 0;

  constructor(options?: { maxUsers?: number; ttlMs?: number }) {
    const max = options?.maxUsers ?? 10000;
    const ttl = options?.ttlMs ?? (3600 * 1000); // 1 hour TTL matches maximum sliding window

    this.aiUserCache = new LRUCache<string, UserWindowData>({
      max,
      ttl,
      updateAgeOnGet: false,
      updateAgeOnHas: false,
    });

    this.ffmpegUserCache = new LRUCache<string, UserWindowData>({
      max,
      ttl,
      updateAgeOnGet: false,
      updateAgeOnHas: false,
    });
  }

  public getActiveCount(type: 'ai' | 'ffmpeg'): number {
    return type === 'ai' ? this.activeAiInstance : this.activeFfmpegInstance;
  }

  public getUserActiveCount(uid: string, type: 'ai' | 'ffmpeg'): number {
    const cache = type === 'ai' ? this.aiUserCache : this.ffmpegUserCache;
    return cache.get(uid)?.activeCount || 0;
  }

  public admit(uid: string, type: 'ai' | 'ffmpeg'): AdmissionResult {
    const config = type === 'ai' ? AI_LIMIT_CONFIG : FFMPEG_LIMIT_CONFIG;
    const cache = type === 'ai' ? this.aiUserCache : this.ffmpegUserCache;

    const totalActiveExpensive = this.activeAiInstance + this.activeFfmpegInstance;
    const typeActiveInstance = type === 'ai' ? this.activeAiInstance : this.activeFfmpegInstance;

    // 1. Instance-Level Concurrency Ceiling
    if (totalActiveExpensive >= INSTANCE_MAX_CONCURRENT_EXPENSIVE) {
      return {
        admitted: false,
        status: 429,
        code: "INSTANCE_BUSY",
        error: "The server is currently processing the maximum volume of intensive requests. Please try again shortly.",
        retryAfter: 3
      };
    }

    if (typeActiveInstance >= config.maxConcurrentInstance) {
      return {
        admitted: false,
        status: 429,
        code: "INSTANCE_BUSY",
        error: `The server has reached maximum capacity for ${type === 'ai' ? 'AI intelligence tasks' : 'audio processing'}. Please retry shortly.`,
        retryAfter: 3
      };
    }

    // Retrieve or initialize user data from LRU Cache
    let userData = cache.get(uid);
    if (!userData) {
      userData = { timestamps: [], activeCount: 0 };
    }

    // 2. Per-User Concurrency Limit
    if (userData.activeCount >= config.maxConcurrentPerUser) {
      return {
        admitted: false,
        status: 429,
        code: "CONCURRENCY_LIMIT_EXCEEDED",
        error: `Too many concurrent ${type === 'ai' ? 'AI' : 'audio conversion'} requests. Please wait for your ongoing request to complete.`,
        retryAfter: 2
      };
    }

    // 3. Per-User Sliding-Window Rate Limits
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 3600 * 1000;

    // Prune entries older than 1 hour
    userData.timestamps = userData.timestamps.filter(t => t > oneHourAgo);

    // Count in 1-minute window
    const minuteTimestamps = userData.timestamps.filter(t => t > oneMinuteAgo);
    if (minuteTimestamps.length >= config.maxPerMinute) {
      const oldestInMinute = minuteTimestamps[0];
      const retryAfter = Math.max(1, Math.ceil((oldestInMinute + 60 * 1000 - now) / 1000));
      return {
        admitted: false,
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        error: `Rate limit exceeded: maximum ${config.maxPerMinute} requests per minute for this feature.`,
        retryAfter
      };
    }

    // Count in 1-hour window
    if (userData.timestamps.length >= config.maxPerHour) {
      const oldestInHour = userData.timestamps[0];
      const retryAfter = Math.max(1, Math.ceil((oldestInHour + 3600 * 1000 - now) / 1000));
      return {
        admitted: false,
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        error: `Hourly rate limit reached: maximum ${config.maxPerHour} requests per hour for this feature.`,
        retryAfter
      };
    }

    // Admission granted: increment counters & record timestamp in LRU cache
    userData.timestamps.push(now);
    userData.activeCount++;
    cache.set(uid, userData);

    if (type === 'ai') {
      this.activeAiInstance++;
    } else {
      this.activeFfmpegInstance++;
    }

    let released = false;
    const slot: ConcurrencySlot = {
      release: () => {
        if (released) return;
        released = true;

        const current = cache.get(uid) || userData;
        if (current && current.activeCount > 0) {
          current.activeCount--;
          cache.set(uid, current);
        }

        if (type === 'ai') {
          if (this.activeAiInstance > 0) this.activeAiInstance--;
        } else {
          if (this.activeFfmpegInstance > 0) this.activeFfmpegInstance--;
        }
      }
    };

    return {
      admitted: true,
      slot
    };
  }

  public reset(): void {
    this.aiUserCache.clear();
    this.ffmpegUserCache.clear();
    this.activeAiInstance = 0;
    this.activeFfmpegInstance = 0;
  }
}

// Keep InMemoryRateLimitStore as an alias/subclass for full backwards compatibility
export class InMemoryRateLimitStore extends LRUCacheRateLimitStore {}

// Default singleton store instance
export const runtimeLimiterStore: IRateLimitStore = new LRUCacheRateLimitStore();

/**
 * Admits an expensive operation for an authenticated user.
 * 
 * Enforces the strict ordering:
 * 1. Authentication check (req.user.uid)
 * 2. Rate limit admission & concurrency slot acquisition
 * 
 * If admitted, returns a ConcurrencySlot whose .release() method MUST be called in a finally block.
 * If rejected, sends a safe 429 response with Retry-After header and returns null.
 */
export function admitExpensiveOperation(
  req: AuthenticatedRequest,
  res: Response,
  type: 'ai' | 'ffmpeg'
): ConcurrencySlot | null {
  const uid = req.user?.uid;
  if (!uid || typeof uid !== 'string') {
    res.status(401).json({
      error: "Unauthorized",
      message: "Authentication required.",
      code: "UNAUTHORIZED"
    });
    return null;
  }

  const result = runtimeLimiterStore.admit(uid, type);
  if (!result.admitted) {
    const retryAfterSeconds = result.retryAfter ?? 3;
    res.set("Retry-After", String(retryAfterSeconds));
    
    // Sanitized logging: safe metadata only (no tokens, authorization headers, raw audio, or prompts)
    console.warn(`[RuntimeLimiter] Throttled request: type=${type}, status=429, code=${result.code}, retryAfter=${retryAfterSeconds}s`);
    res.status(result.status || 429).json({
      error: result.error || "Too Many Requests",
      code: result.code || "RATE_LIMIT_EXCEEDED",
      retryAfter: retryAfterSeconds
    });
    return null;
  }

  return result.slot || null;
}

/**
 * Standard Express middleware to protect routes with in-process LRU rate limiting.
 * Automatically releases concurrency slot on res.finish / res.close.
 */
export function createRateLimiterMiddleware(type: 'ai' | 'ffmpeg') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const slot = admitExpensiveOperation(req, res, type);
    if (!slot) return;

    let released = false;
    const releaseOnce = () => {
      if (!released) {
        released = true;
        slot.release();
      }
    };

    res.on("finish", releaseOnce);
    res.on("close", releaseOnce);
    next();
  };
}
