import { Transcript } from "../types";
import { apiFetch } from "../lib/apiClient";

export const processAudioTranscription = async (
  audioBase64: string,
  mimeType: string
): Promise<Partial<Transcript>> => {
  try {
    const response = await apiFetch('/api/ai/process-audio-transcription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        audioBase64,
        mimeType
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Audio transcription failed");
    }

    const result = await response.json();
    return result;
  } catch (error: any) {
    console.error("Audio processing error:", error);
    throw new Error(error?.message || "AI audio processing failed");
  }
};
