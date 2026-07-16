import { SubscriptionTier, TranscriptSegment, CallSummary, DecisionIntelligenceResult, StrategicAnalysis, UnifiedMeetingIntelligence } from "../types";

export const transcribeAudio = async (
  base64Data: string, 
  mimeType: string, 
  targetLanguage: 'original' | 'english' = 'english'
): Promise<{ transcript: TranscriptSegment[], qualityScore: number, summary: CallSummary }> => {
  let processedBase64 = base64Data;
  let processedMimeType = mimeType;

  // Detect OPUS or OGG (often used for OPUS) and convert via backend
  if (mimeType === 'audio/opus' || mimeType === 'audio/ogg' || mimeType.includes('opus')) {
    console.log(`[GeminiService] Detected OPUS-compatible audio (${mimeType}). Converting via backend...`);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || "";
      const convResponse = await fetch(`${baseUrl}/api/convert-opus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64Audio: base64Data })
      });
      
      if (!convResponse.ok) {
        const errorData = await convResponse.json();
        throw new Error(errorData.error || 'Backend audio conversion failed');
      }
      
      const convData = await convResponse.json();
      processedBase64 = convData.base64Audio;
      processedMimeType = convData.mimeType;
      console.log(`[GeminiService] Conversion successful. Proceeding with ${processedMimeType}`);
    } catch (err) {
      console.error(`[GeminiService] Audio conversion pipeline failed:`, err);
      throw new Error(`Audio processing failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  const baseUrl = import.meta.env.VITE_API_URL || "";
  const response = await fetch(`${baseUrl}/api/ai/transcribe-audio`, {
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
    throw new Error(errorData.error || 'Audio transcription failed');
  }

  return response.json();
};

export const summarizeTranscript = async (transcript: TranscriptSegment[], tier: SubscriptionTier = 'free'): Promise<CallSummary> => {
  if (transcript.length === 0) {
    return { mainTopic: "No content available", keyPoints: [], decisions: [], actionItems: [] };
  }

  const baseUrl = import.meta.env.VITE_API_URL || "";
  const response = await fetch(`${baseUrl}/api/ai/summarize-transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, tier, plan: tier })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Transcript summarization failed');
  }

  return response.json();
};

export const synthesizeSpeech = async (text: string, gender: 'male' | 'female'): Promise<{ data: string; mimeType: string }> => {
  if (!text.trim()) throw new Error("Input text is empty");

  const baseUrl = import.meta.env.VITE_API_URL || "";
  const response = await fetch(`${baseUrl}/api/ai/synthesize-speech`, {
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
    mimeType: 'audio/mp3' // backend returns standard audio data
  };
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
  const baseUrl = import.meta.env.VITE_API_URL || "";
  const response = await fetch(`${baseUrl}/api/ai/analyze-strategically`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, inputType, tier, userId, email, plan: tier })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Strategic analysis failed');
  }

  return response.json();
};

export const analyzeDecisionIntelligence = async (
  input: string,
  inputType: 'transcript' | 'summary',
  tier: SubscriptionTier = 'free',
  userId?: string,
  email?: string
): Promise<DecisionIntelligenceResult> => {
  const baseUrl = import.meta.env.VITE_API_URL || "";
  const response = await fetch(`${baseUrl}/api/ai/decision-intelligence`, {
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

  return response.json();
};

export const processUnifiedMeetingIntelligence = async (transcript: string, tier: SubscriptionTier = 'free'): Promise<UnifiedMeetingIntelligence> => {
  const baseUrl = import.meta.env.VITE_API_URL || "";
  const response = await fetch(`${baseUrl}/api/ai/unified-meeting-intelligence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript, tier, plan: tier })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Meeting intelligence processing failed');
  }

  return response.json();
};
