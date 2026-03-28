import { GoogleGenAI, Type } from "@google/genai";
import { Transcript, TranscriptSegment } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export const processAudioTranscription = async (
  audioBase64: string,
  mimeType: string
): Promise<Partial<Transcript>> => {
  const model = "gemini-2.5-flash-native-audio-preview-12-2025";
  
  const prompt = `
    Analyze this audio. Provide a speaker-wise transcript. 
    Identify speakers as 'Speaker A', 'Speaker B', etc. 
    Also provide a high-level executive summary and a list of specific action items.
    Return the data in the following JSON format:
    {
      "summary": "string",
      "actionItems": ["string"],
      "segments": [
        { "speaker": "string", "text": "string", "startTime": number, "endTime": number }
      ]
    }
  `;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        inlineData: {
          data: audioBase64,
          mimeType
        }
      },
      { text: prompt }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speaker: { type: Type.STRING },
                text: { type: Type.STRING },
                startTime: { type: Type.NUMBER },
                endTime: { type: Type.NUMBER }
              },
              required: ["speaker", "text", "startTime", "endTime"]
            }
          }
        },
        required: ["summary", "actionItems", "segments"]
      }
    }
  });

  try {
    const result = JSON.parse(response.text);
    return result;
  } catch (error) {
    console.error("Failed to parse AI response:", error);
    throw new Error("AI processing failed to return valid JSON");
  }
};
