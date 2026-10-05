import { SubscriptionTier, TranscriptSegment, CallSummary, DecisionIntelligenceResult, StrategicAnalysis, UnifiedMeetingIntelligence, SmartRecap } from "../types";
import { apiFetch, ApiNetworkError } from "../lib/apiClient";

export const transcribeAudio = async (
  base64Data: string, 
  mimeType: string, 
  targetLanguage: 'original' | 'english' = 'english',
  fileName?: string
): Promise<{ transcript: TranscriptSegment[], qualityScore: number, summary: CallSummary }> => {
  if (!base64Data || base64Data.trim().length === 0) {
    throw new Error("No audio data provided for transcription.");
  }

  // Normalize MIME type and strip parameter suffixes like ';codecs=opus'
  let cleanMime = (mimeType || 'audio/webm').trim().toLowerCase();
  if (cleanMime.includes(';')) {
    cleanMime = cleanMime.split(';')[0].trim();
  }

  // Direct supported MIME types for Gemini models
  const isDirectSupported = [
    'audio/webm',
    'audio/ogg',
    'audio/mp3',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    'audio/flac',
    'audio/mp4',
    'audio/m4a'
  ].includes(cleanMime);

  let processedBase64 = base64Data;
  let processedMimeType = cleanMime === 'audio/x-wav' ? 'audio/wav' : cleanMime;

  // If MIME is audio/opus or non-standard container, convert to standard WAV via backend
  if (!isDirectSupported || cleanMime === 'audio/opus') {
    console.log(`[GeminiService] Audio format '${mimeType}' requires conversion. Invoking backend converter...`);
    try {
      const convResponse = await apiFetch('/api/convert-opus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          base64Audio: base64Data,
          fileName: fileName || (cleanMime === 'audio/opus' ? 'recording.opus' : 'audio_input'),
          mimeType: cleanMime
        })
      });
      
      if (!convResponse.ok) {
        const errorData = await convResponse.json().catch(() => ({}));
        throw new Error(errorData.error || "EchoNote couldn't process this audio format. Please try another audio file.");
      }
      
      const convData = await convResponse.json();
      processedBase64 = convData.base64Audio;
      processedMimeType = convData.mimeType || 'audio/wav';
      console.log(`[GeminiService] Conversion successful. Transcribing as ${processedMimeType}`);
    } catch (err: any) {
      console.error(`[GeminiService] Audio conversion pipeline failed:`, err);
      if (err instanceof ApiNetworkError) {
        throw new Error("EchoNote couldn't reach the audio processing service. Please check your connection and try again.");
      }
      throw new Error(err.message || "EchoNote couldn't process this audio format. Please try another audio file.");
    }
  }

  // Send normalized audio to Gemini Transcription endpoint
  try {
    const response = await apiFetch('/api/ai/transcribe-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base64Data: processedBase64,
        mimeType: processedMimeType,
        targetLanguage
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'The audio was processed, but transcription could not be completed. Please try again.');
    }

    return await response.json();
  } catch (err: any) {
    console.error(`[GeminiService] Audio transcription error:`, err);
    if (err instanceof ApiNetworkError) {
      throw new Error("EchoNote couldn't reach the transcription service. Please check your connection and try again.");
    }
    throw new Error(err.message || "The audio was processed, but transcription could not be completed. Please try again.");
  }
};

export const summarizeTranscript = async (transcript: TranscriptSegment[], tier: SubscriptionTier = 'free'): Promise<CallSummary> => {
  if (transcript.length === 0) {
    return { mainTopic: "No content available", keyPoints: [], decisions: [], actionItems: [] };
  }

  try {
    const response = await apiFetch('/api/ai/summarize-transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, tier, plan: tier })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Transcript summarization failed');
    }

    return await response.json();
  } catch (err: any) {
    if (err instanceof ApiNetworkError) {
      throw new Error("EchoNote couldn't reach the summarization service. Please check your connection and try again.");
    }
    throw err;
  }
};

export const synthesizeSpeech = async (text: string, gender: 'male' | 'female'): Promise<{ data: string; mimeType: string }> => {
  if (!text.trim()) throw new Error("Input text is empty");

  try {
    const response = await apiFetch('/api/ai/synthesize-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, gender })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Speech synthesis failed');
    }

    const { base64Audio } = await response.json();
    if (!base64Audio) throw new Error("Audio generation failed.");

    return {
      data: base64Audio,
      mimeType: 'audio/mp3'
    };
  } catch (err: any) {
    if (err instanceof ApiNetworkError) {
      throw new Error("EchoNote couldn't reach the speech synthesis service. Please check your connection and try again.");
    }
    throw err;
  }
};

export const pcmToWavUrl = (base64Pcm: string, sampleRate: number = 24000): string => {
  const blob = audioToBlob(base64Pcm, 'audio/pcm');
  return URL.createObjectURL(blob);
};

export const audioToBlob = (base64Data: string, mimeType: string): Blob => {
  const dataPart = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const binaryString = atob(dataPart);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  if (mimeType.toLowerCase().includes('pcm')) {
    const sampleRate = 24000;
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + len, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, len, true);
    return new Blob([header, bytes], { type: 'audio/wav' });
  }

  return new Blob([bytes], { type: mimeType });
};

export const audioToBlobUrl = (base64Data: string, mimeType: string): string => {
  return URL.createObjectURL(audioToBlob(base64Data, mimeType));
};

export const analyzeStrategically = async (
  input: string,
  inputType: 'transcript' | 'summary',
  tier: SubscriptionTier = 'free',
  userId?: string,
  email?: string
): Promise<StrategicAnalysis> => {
  try {
    const response = await apiFetch('/api/ai/analyze-strategically', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, inputType, tier, userId, email, plan: tier })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Strategic analysis failed');
    }

    return await response.json();
  } catch (err: any) {
    if (err instanceof ApiNetworkError) {
      throw new Error("EchoNote couldn't reach the strategic analysis service. Please check your connection.");
    }
    throw err;
  }
};

export const analyzeDecisionIntelligence = async (
  input: string,
  inputType: 'transcript' | 'summary',
  tier: SubscriptionTier = 'free',
  userId?: string,
  email?: string
): Promise<DecisionIntelligenceResult> => {
  try {
    const response = await apiFetch('/api/ai/decision-intelligence', {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input,
        inputType,
        tier,
        userId,
        email,
        plan: tier
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Decision Intelligence analysis failed");
    }

    return await response.json();
  } catch (err: any) {
    if (err instanceof ApiNetworkError) {
      throw new Error("EchoNote couldn't reach the decision intelligence service. Please check your connection.");
    }
    throw err;
  }
};

export const processUnifiedMeetingIntelligence = async (transcript: string, tier: SubscriptionTier = 'free'): Promise<UnifiedMeetingIntelligence> => {
  try {
    const response = await apiFetch('/api/ai/unified-meeting-intelligence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, tier, plan: tier })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Meeting intelligence processing failed');
    }

    return await response.json();
  } catch (err: any) {
    if (err instanceof ApiNetworkError) {
      throw new Error("EchoNote couldn't reach the meeting intelligence service. Please check your connection.");
    }
    throw err;
  }
};

export const generateSmartRecap = async (
  recordingId: string,
  transcript: TranscriptSegment[] | string,
  projectId?: string,
  knownMembers?: { email?: string; name?: string; role?: string }[]
): Promise<SmartRecap> => {
  try {
    const response = await apiFetch('/api/ai/smart-recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recordingId,
        transcript,
        projectId,
        knownMembers
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'AI Smart Recap generation failed');
    }

    const data = await response.json();
    return data.smartRecap;
  } catch (err: any) {
    if (err instanceof ApiNetworkError) {
      throw new Error("EchoNote couldn't reach the AI Smart Recap service. Please check your connection.");
    }
    throw err;
  }
};

export const detectAndAssignTeamMentions = async (params: {
  transcript: TranscriptSegment[] | string;
  recordingId?: string;
  projectId?: string;
  teamMembers?: Array<{ name?: string; email: string; role?: string; uid?: string }>;
  tasks?: Array<{ id: string; title: string; description?: string; assigneeEmail?: string; status?: string; dueDate?: string }>;
  autoApply?: boolean;
  autoCreateTasks?: boolean;
}): Promise<{
  success: boolean;
  summaryOfMentions?: string;
  detections: any[];
  updatedTasksCount: number;
  createdTasksCount: number;
  updatedTaskIds: string[];
  createdTaskIds?: string[];
  message: string;
}> => {
  try {
    const response = await apiFetch('/api/ai/automated-tagging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Automated member tagging failed');
    }

    return await response.json();
  } catch (err: any) {
    if (err instanceof ApiNetworkError) {
      throw new Error("EchoNote couldn't reach the automated tagging service. Please check your connection.");
    }
    throw err;
  }
};

