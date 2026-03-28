
import { GoogleGenAI, Type, Modality, ThinkingLevel } from "@google/genai";
import { TranscriptSegment, CallSummary, DecisionIntelligenceResult, StrategicAnalysis, UnifiedMeetingIntelligence, UnifiedDecision, UnifiedTask, UnifiedUnresolvedTopic, MeetingInsights, FollowUp, MeetingTopic } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const transcribeAudio = async (
  base64Data: string, 
  mimeType: string, 
  targetLanguage: 'original' | 'english' = 'english'
): Promise<{ transcript: TranscriptSegment[], qualityScore: number, summary: CallSummary }> => {
  
  const languageInstruction = targetLanguage === 'english' 
    ? "MANDATORY: Translate all spoken content into English. The final transcript and summary MUST be in English, regardless of the input language."
    : "Transcribe in 'Hinglish' (a mix of Hindi and English written in Roman script) if the speakers are using Hindi or a mix of Hindi and English. If they are using other languages, transcribe exactly as spoken. Do not translate to pure English if the original is Hindi/Hinglish.";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          {
            text: `Transcribe this audio and provide a professional summary. ${languageInstruction} 
            
            CLEANING:
            1. Remove filler words (umm, ahh, etc.).
            2. Remove background noise.
            3. Merge broken words.
            4. Maintain speaker order.
            
            QUALITY SCORE:
            Calculate a 'Transcription Quality Score' (0-100) based on:
            - Audio clarity (30%)
            - Speaker clarity (40%)
            - Absence of disfluencies/filler words (30%)

            SUMMARY RULES:
            - Keep it concise (Total length should not exceed 8-10 lines).
            - Do not hallucinate. 
            - Use a professional corporate tone.
            
            Format: JSON with:
            - 'transcript' (array of {speaker, text, startTime, endTime})
            - 'qualityScore' (number)
            - 'summary' (object with mainTopic, keyPoints[], decisions[], actionItems[])`,
          },
        ],
      },
    ],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
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
                endTime: { type: Type.NUMBER },
              },
              required: ["speaker", "text", "startTime", "endTime"],
            },
          },
          qualityScore: { 
            type: Type.NUMBER,
            description: "A score from 0 to 100 representing the overall transcription quality."
          },
          summary: {
            type: Type.OBJECT,
            properties: {
              mainTopic: { type: Type.STRING },
              keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
              decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
              actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["mainTopic", "keyPoints", "decisions", "actionItems"],
          }
        },
        required: ["transcript", "qualityScore", "summary"],
      },
    },
  });

  const jsonStr = response.text || "{\"transcript\": [], \"qualityScore\": 0, \"summary\": {\"mainTopic\": \"\", \"keyPoints\": [], \"decisions\": [], \"actionItems\": []}}";
  return JSON.parse(jsonStr);
};

export const summarizeTranscript = async (transcript: TranscriptSegment[]): Promise<CallSummary> => {
  if (transcript.length === 0) {
    return { mainTopic: "No content available", keyPoints: [], decisions: [], actionItems: [] };
  }

  const transcriptText = transcript.map(s => `${s.speaker}: ${s.text}`).join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        parts: [
          {
            text: `Based on the following transcript, generate a structured, professional summary. 
            
            RULES:
            - Keep it concise (Total length should not exceed 8-10 lines).
            - Do not hallucinate. 
            - Use a professional corporate tone.
            
            TRANSCRIPT:
            ${transcriptText}`,
          },
        ],
      },
    ],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mainTopic: { 
            type: Type.STRING, 
            description: "A single concise sentence defining the primary discussion topic." 
          },
          keyPoints: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "List of 2-3 most critical points discussed." 
          },
          decisions: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "List of confirmed decisions or outcomes." 
          },
          actionItems: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "List of specific tasks assigned or next steps identified." 
          },
        },
        required: ["mainTopic", "keyPoints", "decisions", "actionItems"],
      },
    },
  });

  const jsonStr = response.text || "{}";
  return JSON.parse(jsonStr);
};

export const synthesizeSpeech = async (text: string, gender: 'male' | 'female'): Promise<string> => {
  if (!text.trim()) throw new Error("Input text is empty");

  // Selection of highly differentiated voices: 
  // Fenrir (Deep Masculine) vs Puck (Soft Feminine) for maximum audible distinction.
  const voiceName = gender === 'male' ? 'Fenrir' : 'Puck';
  
  // Refined prompt to ensure the model leans into the gender performance
  const genderDescriptor = gender === 'male' 
    ? 'deep, authoritative, and distinctly masculine' 
    : 'clear, melodic, and distinctly feminine';

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ 
      parts: [{ 
        text: `Narrate the following text in a ${genderDescriptor} tone with natural professional prosody. Ensure the pitch and timbre are unmistakably ${gender}. Text: ${text}` 
      }] 
    }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  if (!base64Audio) throw new Error("Audio generation failed.");
  
  return base64Audio;
};

export const pcmToWavUrl = (base64Pcm: string, sampleRate: number = 24000): string => {
  const dataPart = base64Pcm.includes(',') ? base64Pcm.split(',')[1] : base64Pcm;
  const binaryString = atob(dataPart);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

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

  const blob = new Blob([header, bytes], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

export const analyzeStrategically = async (
  input: string,
  inputType: 'transcript' | 'summary'
): Promise<StrategicAnalysis> => {
  const prompt = `
    You are the EchoNote Strategic Intelligence engine. Your goal is to transform the provided ${inputType} into deep, strategic insights that reveal the "thinking" behind the conversation.

    INPUT (${inputType.toUpperCase()}):
    ${input}

    TASK:
    Analyze the input and provide a structured JSON response with the following sections:
    1. Core Intent: What is the primary, underlying goal or purpose of this discussion?
    2. Context: What is the broader situation or background that gives this conversation meaning?
    3. Assumptions: What are the underlying assumptions being made by the participants?
    4. Logical Gaps: Where is the reasoning incomplete or where are there contradictions?
    5. Blind Spots: What are the participants missing or failing to consider?
    6. Strategic Questions: What high-level, critical questions should be asked now?
    7. Recommendations: What specific, strategic advice would you give based on this?
    8. Alternative Perspectives: What other ways could this situation be interpreted or approached?
    9. Ignored Questions: What important questions were left unasked or unanswered during the conversation?
    10. Decision Framework: A brief assessment of the framework or logic being used to make decisions.
    11. Next Steps: Concrete, actionable steps that move the strategy forward.

    RULES:
    - Be critical, analytical, and insightful.
    - Do not just summarize; find the hidden patterns and strategic implications.
    - Use a professional, high-level executive tone.
    - Return ONLY valid JSON.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          coreIntent: { type: Type.STRING },
          context: { type: Type.STRING },
          assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
          logicalGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
          blindSpots: { type: Type.ARRAY, items: { type: Type.STRING } },
          strategicQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
          alternativePerspectives: { type: Type.ARRAY, items: { type: Type.STRING } },
          ignoredQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          decisionFramework: { type: Type.STRING },
          nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          "coreIntent", "context", "assumptions", "logicalGaps", "blindSpots", 
          "strategicQuestions", "recommendations", "alternativePerspectives", 
          "ignoredQuestions", "decisionFramework", "nextSteps"
        ],
      },
    },
  });

  const jsonStr = response.text || "{}";
  return JSON.parse(jsonStr);
};

export const analyzeDecisionIntelligence = async (
  input: string,
  inputType: 'transcript' | 'summary'
): Promise<DecisionIntelligenceResult> => {
  const prompt = `
    You are the EchoNote Decision Intelligence engine. Your goal is to transform the provided ${inputType} into structured, actionable insights that help users move from conversation to clarity.

    INPUT (${inputType.toUpperCase()}):
    ${input}

    TASK:
    Analyze the input and provide a structured JSON response with the following sections:
    1. Key Decisions: What was actually decided?
    2. Assumptions: What are the underlying assumptions being made?
    3. Risks & Gaps: What could go wrong or what information is missing?
    4. Alternative Perspectives: What other ways could this be looked at?
    5. Ignored Questions: What important questions were left unasked or unanswered?
    6. Decision Clarity: A brief assessment of how clear and solid the current direction is.
    7. Next Actions: Specific, concrete steps to take now.

    RULES:
    - Be critical and analytical.
    - Do not just summarize; find the "thinking" behind the words.
    - Use a professional, high-level executive tone.
    - Return ONLY valid JSON.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          keyDecisions: { type: Type.ARRAY, items: { type: Type.STRING } },
          assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
          risksAndGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
          alternativePerspectives: { type: Type.ARRAY, items: { type: Type.STRING } },
          ignoredQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          decisionClarity: { type: Type.STRING },
          nextActions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["keyDecisions", "assumptions", "risksAndGaps", "alternativePerspectives", "ignoredQuestions", "decisionClarity", "nextActions"],
      },
    },
  });

  const jsonStr = response.text || "{}";
  return JSON.parse(jsonStr);
};

export const processUnifiedMeetingIntelligence = async (transcript: string): Promise<UnifiedMeetingIntelligence> => {
  const prompt = `
    You are the EchoNote Decision Intelligence workspace engine. 
    Your task is to transform a raw meeting transcript into a unified, interconnected intelligence output.

    INPUT (TRANSCRIPT):
    ${transcript}

    OUTPUT (STRICT UNIFIED JSON SCHEMA):
    1. title: A concise, professional title.
    2. summary: 5-7 critical bullet points.
    3. topics: Categorized discussion points.
    4. keyInsights: High-level strategic takeaways.
    5. decisions: Array of UnifiedDecision objects.
       - id: Unique ID (e.g., "dec-1").
       - title: Short title.
       - description: Detailed explanation.
       - context: Why it was made.
       - peopleInvolved: List of speakers.
       - confidenceLevel: High/Medium/Low.
       - relatedTaskIds: Array of IDs from the 'tasks' section.
    6. tasks: Array of UnifiedTask objects.
       - id: Unique ID (e.g., "task-1").
       - description: Actionable description.
       - assignee: Person responsible (or "Unassigned").
       - deadline: Optional deadline.
       - priority: High/Medium/Low.
       - relatedDecisionId: ID of the decision that triggered this task (if any).
    7. unresolvedTopics: Array of UnifiedUnresolvedTopic objects.
       - id: Unique ID (e.g., "unres-1").
       - topic: Name of the issue.
       - reasonUnresolved: Why it remains open.
       - suggestedActions: List of specific recommendations.
    8. insights: MeetingInsights object.
       - productivityScore (0-100)
       - productivityExplanation
       - decisionEffectivenessScore (0-100)
       - decisionEffectivenessExplanation
       - actionabilityScore (0-100)
       - actionabilityExplanation
       - strengths (array)
       - weaknesses (array)
    9. followUp: FollowUp object.
       - email (draft)
       - nextMeetingAgenda (array)
       - keyPendingItems (array)

    CRITICAL RULES:
    - Decisions ↔ Related Tasks: Link them using IDs.
    - Tasks ↔ People: Ensure assignees match speaker names where possible.
    - Unresolved Topics ↔ Suggested Actions: Provide clear paths forward.
    - NO DUPLICATE ENTRIES: Do not repeat information across sections.
    - CONSISTENT IDs: Use the same IDs for cross-referencing.
    - CLEAN HIERARCHY: The output must be a single, valid JSON object.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          summary: { type: Type.ARRAY, items: { type: Type.STRING } },
          topics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                items: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["category", "items"],
            },
          },
          keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
          decisions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                context: { type: Type.STRING },
                peopleInvolved: { type: Type.ARRAY, items: { type: Type.STRING } },
                confidenceLevel: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                relatedTaskIds: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["id", "title", "description", "context", "peopleInvolved", "confidenceLevel", "relatedTaskIds"],
            },
          },
          tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                description: { type: Type.STRING },
                assignee: { type: Type.STRING },
                deadline: { type: Type.STRING },
                priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                relatedDecisionId: { type: Type.STRING },
              },
              required: ["id", "description", "assignee", "priority"],
            },
          },
          unresolvedTopics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                topic: { type: Type.STRING },
                reasonUnresolved: { type: Type.STRING },
                suggestedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["id", "topic", "reasonUnresolved", "suggestedActions"],
            },
          },
          insights: {
            type: Type.OBJECT,
            properties: {
              productivityScore: { type: Type.NUMBER },
              productivityExplanation: { type: Type.STRING },
              decisionEffectivenessScore: { type: Type.NUMBER },
              decisionEffectivenessExplanation: { type: Type.STRING },
              actionabilityScore: { type: Type.NUMBER },
              actionabilityExplanation: { type: Type.STRING },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["productivityScore", "productivityExplanation", "decisionEffectivenessScore", "decisionEffectivenessExplanation", "actionabilityScore", "actionabilityExplanation", "strengths", "weaknesses"],
          },
          followUp: {
            type: Type.OBJECT,
            properties: {
              email: { type: Type.STRING },
              nextMeetingAgenda: { type: Type.ARRAY, items: { type: Type.STRING } },
              keyPendingItems: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["email", "nextMeetingAgenda", "keyPendingItems"],
          },
        },
        required: ["title", "summary", "topics", "keyInsights", "decisions", "tasks", "unresolvedTopics", "insights", "followUp"],
      },
    },
  });

  const jsonStr = response.text || "{}";
  return JSON.parse(jsonStr);
};
