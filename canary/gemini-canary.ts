/**
 * ==============================================================================
 * EchoNote — Standalone Gemini Credential Canary Service (Step 3B.4U-Y)
 * ==============================================================================
 * 
 * ARCHITECTURE & ISOLATION SPECIFICATION:
 * - Minimal, standalone HTTP service designed for deployment on Google Cloud Run as
 *   an isolated canary verification service (echonote-gemini-canary).
 * - ZERO IMPORTS of server.ts, lib/firebaseAdmin.ts, firebase-admin, resend,
 *   razorpay, or third-party integration modules.
 * - ZERO runtime connection to production Firestore databases, schedulers, or live payment/email gateways.
 * - Reads GEMINI_API_KEY ONLY from the process environment at runtime.
 * - Never prints, logs, or returns the API key string, request headers, or raw provider bodies.
 * - Implements the production transcription prompt and structured JSON response schema
 *   verbatim from server.ts:16075-16140 (gemini-3.5-flash).
 * - Application construction (createCanaryApp) is decoupled from listener startup (startCanaryServer),
 *   enabling deterministic offline unit testing with mocked Gemini clients.
 * - SECURITY NOTICE: In Cloud Run production deployment, this service MUST be protected by
 *   Cloud Run Invoker IAM authentication (--no-allow-unauthenticated). Application-level
 *   checks are not a substitute for network and IAM-level ingress protection.
 * ==============================================================================
 */

import express, { Request, Response, Express } from 'express';
import cors from 'cors';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

export interface CanaryConfig {
  apiKey?: string;
  port?: number;
  maxAudioBytes?: number;
  operationTimeoutMs?: number;
}

export interface VerificationRequest {
  audioBase64?: string;
  mimeType?: string;
  targetLanguage?: 'english' | 'original';
}

export interface TranscriptionSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface CallSummary {
  mainTopic: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: string[];
}

export interface TranscriptionResult {
  transcript: TranscriptionSegment[];
  qualityScore: number;
  summary: CallSummary;
}

export interface CanaryVerifyResponse {
  status: 'SUCCESS' | 'FAILED';
  modelUsed: string;
  catalogReachable: boolean;
  transcriptionValid: boolean;
  qualityScore?: number;
  segmentCount?: number;
  error?: string;
  errorCategory?: string;
}

export const SUPPORTED_CANARY_AUDIO_MIMES = new Set([
  'audio/wav',
  'audio/webm',
  'audio/mp3',
  'audio/mpeg',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/mp4',
  'audio/m4a'
]);

export function normalizeCanaryAudioMime(rawMime?: string): string {
  let cleanMime = (rawMime || '').trim().toLowerCase();
  if (cleanMime.includes(';')) {
    cleanMime = cleanMime.split(';')[0].trim();
  }
  if (cleanMime === 'audio/x-wav') {
    return 'audio/wav';
  }
  return cleanMime;
}

export function validateTranscriptionSchema(data: any): data is TranscriptionResult {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.transcript)) return false;
  if (typeof data.qualityScore !== 'number') return false;
  if (!data.summary || typeof data.summary !== 'object') return false;

  const { mainTopic, keyPoints, decisions, actionItems } = data.summary;
  if (typeof mainTopic !== 'string') return false;
  if (!Array.isArray(keyPoints) || !Array.isArray(decisions) || !Array.isArray(actionItems)) return false;

  for (const seg of data.transcript) {
    if (!seg || typeof seg !== 'object') return false;
    if (typeof seg.speaker !== 'string' || typeof seg.text !== 'string') return false;
    if (typeof seg.startTime !== 'number' || typeof seg.endTime !== 'number') return false;
  }

  return true;
}

export function sanitizeCanaryError(error: any): { category: string; message: string } {
  // 1. Structured numeric status evaluation (reliable for @google/genai APIError subclasses)
  const status = typeof error?.status === 'number' ? error.status : null;
  if (status !== null) {
    if (status === 400) {
      return { category: 'INVALID_ARGUMENT', message: 'Invalid argument or request payload rejected by provider.' };
    }
    if (status === 401 || status === 403) {
      return { category: 'AUTHENTICATION_OR_PERMISSION_ERROR', message: 'Authentication or restriction failure.' };
    }
    if (status === 404) {
      return { category: 'MODEL_NOT_FOUND', message: 'Target model not available or accessible.' };
    }
    if (status === 429) {
      return { category: 'RATE_LIMIT_EXCEEDED', message: 'Quota or rate limit exceeded.' };
    }
    if (status === 408) {
      return { category: 'OPERATION_TIMEOUT', message: 'Verification operation timed out.' };
    }
  }

  // 2. Structured name-based evaluation (e.g. APIUserAbortError, APIConnectionTimeoutError)
  const errorName = typeof error?.name === 'string' ? error.name : '';
  if (errorName === 'BadRequestError') {
    return { category: 'INVALID_ARGUMENT', message: 'Invalid argument or request payload rejected by provider.' };
  }
  if (errorName === 'AuthenticationError' || errorName === 'PermissionDeniedError') {
    return { category: 'AUTHENTICATION_OR_PERMISSION_ERROR', message: 'Authentication or restriction failure.' };
  }
  if (errorName === 'NotFoundError') {
    return { category: 'MODEL_NOT_FOUND', message: 'Target model not available or accessible.' };
  }
  if (errorName === 'RateLimitError') {
    return { category: 'RATE_LIMIT_EXCEEDED', message: 'Quota or rate limit exceeded.' };
  }
  if (errorName === 'APIUserAbortError' || errorName === 'APIConnectionTimeoutError' || errorName === 'AbortError') {
    return { category: 'OPERATION_TIMEOUT', message: 'Verification operation timed out.' };
  }

  // 3. Fallback matching on safe string indicators for generic Error objects
  const msg = error && typeof error.message === 'string' ? error.message : '';
  if (/401|403|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) {
    return { category: 'AUTHENTICATION_OR_PERMISSION_ERROR', message: 'Authentication or restriction failure.' };
  }
  if (/400|INVALID_ARGUMENT/i.test(msg)) {
    return { category: 'INVALID_ARGUMENT', message: 'Invalid argument or request payload rejected by provider.' };
  }
  if (/404|NOT_FOUND|MODEL_NOT_FOUND/i.test(msg)) {
    return { category: 'MODEL_NOT_FOUND', message: 'Target model not available or accessible.' };
  }
  if (/429|RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED/i.test(msg)) {
    return { category: 'RATE_LIMIT_EXCEEDED', message: 'Quota or rate limit exceeded.' };
  }
  if (/aborted|timeout|timed out|ETIMEDOUT/i.test(msg)) {
    return { category: 'OPERATION_TIMEOUT', message: 'Verification operation timed out.' };
  }

  // 4. Safe default
  return { category: 'PROVIDER_ERROR', message: 'Gemini service invocation failed.' };
}

export interface Base64ValidationResult {
  valid: boolean;
  byteLength?: number;
  error?: string;
}

/**
 * Strict Base64 audio validator.
 * - Enforces standard Base64 alphabet ([A-Za-z0-9+/])
 * - Validates length and padding:
 *   * Len % 4 === 1 is mathematically impossible in Base64
 *   * Length must be >= 2 for meaningful unpadded, >= 4 for padded
 *   * Padded strings must have length multiple of 4, ending with = or ==
 *   * Unpadded strings (len % 4 === 2 or 3) are supported and decoded length calculated accurately
 * - Calculates exact decoded byte length without allocating any Buffer
 */
export function validateStrictBase64(input: unknown): Base64ValidationResult {
  if (typeof input !== 'string') {
    return { valid: false, error: 'Input is not a string.' };
  }
  const str = input.trim();
  if (str.length === 0) {
    return { valid: false, error: 'Empty Base64 audio input.' };
  }
  if (str.length % 4 === 1) {
    return { valid: false, error: 'Impossible Base64 length (remainder 1).' };
  }

  // Reject invalid characters (strictly standard base64: A-Z, a-z, 0-9, +, /, =)
  if (/[^A-Za-z0-9+/=]/.test(str)) {
    return { valid: false, error: 'Invalid characters in Base64 string.' };
  }

  const padIndex = str.indexOf('=');
  let byteLength = 0;

  if (padIndex !== -1) {
    // Padded Base64 must have length multiple of 4
    if (str.length % 4 !== 0) {
      return { valid: false, error: 'Malformed padding: length is not a multiple of 4.' };
    }
    // Padding can only be at the end, either 1 or 2 =
    const padCount = str.length - padIndex;
    if (padCount > 2) {
      return { valid: false, error: 'Malformed padding: more than 2 padding characters.' };
    }
    const expectedPad = padCount === 1 ? '=' : '==';
    if (!str.endsWith(expectedPad) || str.slice(0, padIndex).includes('=')) {
      return { valid: false, error: 'Malformed padding: invalid padding character placement.' };
    }
    byteLength = (str.length / 4) * 3 - padCount;
  } else {
    // Unpadded Base64
    const rem = str.length % 4;
    if (rem === 0) {
      byteLength = (str.length / 4) * 3;
    } else if (rem === 2) {
      byteLength = ((str.length - 2) / 4) * 3 + 1;
    } else if (rem === 3) {
      byteLength = ((str.length - 3) / 4) * 3 + 2;
    }
  }

  return { valid: true, byteLength };
}

export interface ProviderDiagnosticEvent {
  event: 'gemini_provider_failure';
  operation: 'models_list' | 'generate_content';
  errorName: string;
  httpStatus: number | 'none';
  networkCode: string;
}

const ALLOWED_ERROR_NAMES = new Set([
  'APIError',
  'BadRequestError',
  'AuthenticationError',
  'PermissionDeniedError',
  'NotFoundError',
  'ConflictError',
  'UnprocessableEntityError',
  'RateLimitError',
  'InternalServerError',
  'APIUserAbortError',
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'AbortError',
  'TypeError',
  'RangeError',
  'Error'
]);

const ALLOWED_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH'
]);

export function logDiagnosticProviderFailure(operation: 'models_list' | 'generate_content', error: any): ProviderDiagnosticEvent {
  const rawName = typeof error?.name === 'string' ? error.name : (error?.constructor?.name || '');
  const errorName = ALLOWED_ERROR_NAMES.has(rawName) ? rawName : 'unknown';

  const rawStatus = typeof error?.status === 'number' ? error.status : null;
  const httpStatus = (rawStatus !== null && Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599)
    ? rawStatus
    : 'none';

  const topCode = typeof error?.code === 'string' ? error.code : '';
  const causeCode = typeof error?.cause?.code === 'string' ? error.cause.code : '';
  const rawCode = ALLOWED_NETWORK_CODES.has(topCode) ? topCode : causeCode;
  const networkCode = ALLOWED_NETWORK_CODES.has(rawCode) ? rawCode : 'none';

  const eventPayload: ProviderDiagnosticEvent = {
    event: 'gemini_provider_failure',
    operation,
    errorName,
    httpStatus,
    networkCode
  };

  try {
    process.stderr.write(JSON.stringify(eventPayload) + '\n');
  } catch (_) {
    // Fail-safe; logging failure must never crash the service
  }

  return eventPayload;
}

export function createCanaryApp(config: CanaryConfig, mockGenAiInstance?: any | ((options: { apiKey: string }) => any)): Express {
  const app = express();
  const maxAudioBytes = config.maxAudioBytes || 1048576;
  const operationTimeoutMs = config.operationTimeoutMs || 15000;

  let isVerificationRunning = false;

  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'HEALTHY',
      service: 'echonote-gemini-canary',
      timestamp: new Date().toISOString()
    });
  });

  app.post('/verify', async (req: Request, res: Response) => {
    if (isVerificationRunning) {
      return res.status(429).json({
        status: 'FAILED',
        errorCategory: 'CONCURRENT_VERIFICATION_REJECTED',
        error: 'A verification operation is already in progress.'
      });
    }

    const { audioBase64, mimeType, targetLanguage } = req.body as VerificationRequest;

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({
        status: 'FAILED',
        errorCategory: 'INVALID_REQUEST',
        error: 'Missing or invalid audioBase64 string.'
      });
    }

    const cleanMime = normalizeCanaryAudioMime(mimeType);
    if (!SUPPORTED_CANARY_AUDIO_MIMES.has(cleanMime)) {
      return res.status(400).json({
        status: 'FAILED',
        errorCategory: 'UNSUPPORTED_MIME_TYPE',
        error: 'Unsupported audio MIME type: ' + (cleanMime || 'unknown')
      });
    }

    const b64Result = validateStrictBase64(audioBase64);
    if (!b64Result.valid || b64Result.byteLength === undefined) {
      return res.status(400).json({
        status: 'FAILED',
        errorCategory: 'INVALID_BASE64_AUDIO',
        error: 'Malformed or invalid Base64 audio payload.'
      });
    }

    if (b64Result.byteLength > maxAudioBytes) {
      return res.status(413).json({
        status: 'FAILED',
        errorCategory: 'AUDIO_SIZE_LIMIT_EXCEEDED',
        error: 'Audio payload exceeds canary limit of ' + maxAudioBytes + ' bytes.'
      });
    }

    const rawApiKey = config.apiKey !== undefined ? config.apiKey : process.env.GEMINI_API_KEY;
    const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
    if ((!apiKey || apiKey.length === 0) && !mockGenAiInstance) {
      return res.status(500).json({
        status: 'FAILED',
        errorCategory: 'CREDENTIAL_UNCONFIGURED',
        error: 'GEMINI_API_KEY is not configured in runtime environment.'
      });
    }

    if (!mockGenAiInstance && /[^\x20-\x7E]/.test(apiKey)) {
      return res.status(500).json({
        status: 'FAILED',
        errorCategory: 'CREDENTIAL_MALFORMED',
        error: 'Configured GEMINI_API_KEY contains invalid header characters.'
      });
    }

    isVerificationRunning = true;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, operationTimeoutMs);

    try {
      const ai = typeof mockGenAiInstance === 'function'
        ? mockGenAiInstance({ apiKey })
        : (mockGenAiInstance || new GoogleGenAI({ apiKey }));
      const model = 'gemini-3.5-flash';

      let catalogReachable = false;
      try {
        if (typeof ai.models?.list === 'function') {
          await ai.models.list();
          catalogReachable = true;
        } else {
          catalogReachable = true;
        }
      } catch (catErr) {
        logDiagnosticProviderFailure('models_list', catErr);
        catalogReachable = false;
      }

      const languageInstruction = targetLanguage === 'english'
        ? "MANDATORY: Translate all spoken content into English. The final transcript and summary MUST be in English, regardless of the input language."
        : "Transcribe in 'Hinglish' (a mix of Hindi and English written in Roman script) if the speakers are using Hindi or a mix of Hindi and English. If they are using other languages, transcribe exactly as spoken. Do not translate to pure English if the original is Hindi/Hinglish.";

      const promptText = "Provide a highly accurate, word-for-word, literal (verbatim) transcription of the entire audio.\n\n" +
        "TRANSCRIPTION REQUIREMENTS:\n" +
        "1. This MUST be a true, word-for-word verbatim transcription. Do NOT summarize, condense, paraphrase, or truncate any spoken words in the transcript segments.\n" +
        "2. Fully preserve all speaker changes, correct punctuation, and natural paragraph structures.\n" +
        "3. Keep disfluencies and spoken text intact to ensure a high-fidelity verbatim record.\n" +
        "4. Map the transcript to precise start and end timestamps (in seconds).\n" +
        "5. " + languageInstruction + "\n\n" +
        "TRANSCRIPTION QUALITY SCORE:\n" +
        "Calculate a 'Transcription Quality Score' (0-100) based on:\n" +
        "- Audio clarity (30%)\n" +
        "- Speaker clarity (40%)\n" +
        "- Verbatim fidelity (30%)\n\n" +
        "EXECUTIVE SUMMARY RULES (Kept strictly separate):\n" +
        "- Provide a professional, concise executive summary of the discussion under the 'summary' property.\n" +
        "- This summary remains completely separate from the transcript and should not shorten or summarize the transcript text itself.\n\n" +
        "Format the output strictly as a JSON object containing:\n" +
        "- 'transcript' (array of {speaker, text, startTime, endTime})\n" +
        "- 'qualityScore' (number)\n" +
        "- 'summary' (object with mainTopic, keyPoints[], decisions[], actionItems[])";

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: audioBase64,
                  mimeType: cleanMime
                }
              },
              {
                text: promptText
              }
            ]
          }
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcript: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                    startTime: { type: Type.NUMBER },
                    endTime: { type: Type.NUMBER }
                  },
                  required: ['speaker', 'text', 'startTime', 'endTime']
                }
              },
              qualityScore: {
                type: Type.NUMBER
              },
              summary: {
                type: Type.OBJECT,
                properties: {
                  mainTopic: { type: Type.STRING },
                  keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                  decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  actionItems: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ['mainTopic', 'keyPoints', 'decisions', 'actionItems']
              }
            },
            required: ['transcript', 'qualityScore', 'summary']
          },
          abortSignal: abortController.signal
        }
      });

      clearTimeout(timeoutId);

      const responseText = response?.text || '';
      let parsedData: any = null;
      try {
        parsedData = JSON.parse(responseText);
      } catch (jsonErr) {
        return res.status(502).json({
          status: 'FAILED',
          modelUsed: model,
          catalogReachable,
          transcriptionValid: false,
          errorCategory: 'MALFORMED_JSON_RESPONSE',
          error: 'Gemini provider returned malformed non-JSON output.'
      });
      }

      if (!validateTranscriptionSchema(parsedData)) {
        return res.status(502).json({
          status: 'FAILED',
          modelUsed: model,
          catalogReachable,
          transcriptionValid: false,
          errorCategory: 'SCHEMA_VALIDATION_FAILED',
          error: 'Gemini provider output did not conform to the expected transcription schema.'
        });
      }

      const responsePayload: CanaryVerifyResponse = {
        status: 'SUCCESS',
        modelUsed: model,
        catalogReachable,
        transcriptionValid: true,
        qualityScore: parsedData.qualityScore,
        segmentCount: parsedData.transcript.length
      };

      return res.status(200).json(responsePayload);

    } catch (err: any) {
      clearTimeout(timeoutId);
      logDiagnosticProviderFailure('generate_content', err);
      const sanitized = sanitizeCanaryError(err);
      return res.status(502).json({
        status: 'FAILED',
        modelUsed: 'gemini-3.5-flash',
        catalogReachable: false,
        transcriptionValid: false,
        errorCategory: sanitized.category,
        error: sanitized.message
      });
    } finally {
      isVerificationRunning = false;
    }
  });

  return app;
}

export function startCanaryServer(port = Number(process.env.PORT) || 3000): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    process.stderr.write('[FATAL] GEMINI_API_KEY environment variable is missing or empty. Cannot start canary service.\n');
    process.exit(1);
  }

  const app = createCanaryApp({ apiKey, port });
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      process.stdout.write("[INFO] EchoNote Gemini Canary service listening on port " + port + "\n");
      resolve(server);
    });
  });
}

if (process.env.RUN_CANARY_SERVER === 'true') {
  startCanaryServer();
}