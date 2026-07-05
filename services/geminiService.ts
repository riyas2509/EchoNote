
import { GoogleGenAI, Type, Modality, ThinkingLevel } from "@google/genai";
import { SubscriptionTier, TranscriptSegment, CallSummary, DecisionIntelligenceResult, StrategicAnalysis, UnifiedMeetingIntelligence, UnifiedDecision, UnifiedTask, UnifiedUnresolvedTopic, MeetingIntelligence, FollowUp, MeetingTopic } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

  const languageInstruction = targetLanguage === 'english' 
    ? "MANDATORY: Translate all spoken content into English. The final transcript and summary MUST be in English, regardless of the input language."
    : "Transcribe in 'Hinglish' (a mix of Hindi and English written in Roman script) if the speakers are using Hindi or a mix of Hindi and English. If they are using other languages, transcribe exactly as spoken. Do not translate to pure English if the original is Hindi/Hinglish.";

  console.log(`[GeminiService] Sending transcription request to Gemini API. MIME: ${processedMimeType}`);
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [
        {
          parts: [
            {
              inlineData: {
                data: processedBase64,
                mimeType: processedMimeType,
              },
            },
            {
              text: `Provide a highly accurate, word-for-word, literal (verbatim) transcription of the entire audio.
              
              TRANSCRIPTION REQUIREMENTS:
              1. This MUST be a true, word-for-word verbatim transcription. Do NOT summarize, condense, paraphrase, or truncate any spoken words in the transcript segments.
              2. Fully preserve all speaker changes, correct punctuation, and natural paragraph structures.
              3. Keep disfluencies and spoken text intact to ensure a high-fidelity verbatim record.
              4. Map the transcript to precise start and end timestamps (in seconds).
              5. ${languageInstruction}

              TRANSCRIPTION QUALITY SCORE:
              Calculate a 'Transcription Quality Score' (0-100) based on:
              - Audio clarity (30%)
              - Speaker clarity (40%)
              - Verbatim fidelity (30%)
   
              EXECUTIVE SUMMARY RULES (Kept strictly separate):
              - Provide a professional, concise executive summary of the discussion under the 'summary' property.
              - This summary remains completely separate from the transcript and should not shorten or summarize the transcript text itself.
              
              Format the output strictly as a JSON object containing:
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

    console.log(`[GeminiService] Received response from Gemini API`);
    const jsonStr = response.text || "{\"transcript\": [], \"qualityScore\": 0, \"summary\": {\"mainTopic\": \"\", \"keyPoints\": [], \"decisions\": [], \"actionItems\": []}}";
    console.log(`[GeminiService] Raw JSON Response:`, jsonStr.substring(0, 500) + (jsonStr.length > 500 ? '...' : ''));
    return JSON.parse(jsonStr);
  } catch (apiError: any) {
    console.error(`[GeminiService] Gemini API Error:`, apiError);
    if (apiError.response) {
      console.error(`[GeminiService] Full API Response Error:`, JSON.stringify(apiError.response, null, 2));
    }
    throw apiError;
  }
};

export const summarizeTranscript = async (transcript: TranscriptSegment[], tier: SubscriptionTier = 'free'): Promise<CallSummary> => {
  if (transcript.length === 0) {
    return { mainTopic: "No content available", keyPoints: [], decisions: [], actionItems: [] };
  }

  const isAdvanced = tier !== 'guest';
  const transcriptText = transcript.map(s => `${s.speaker}: ${s.text}`).join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      {
        parts: [
          {
            text: `Based on the following transcript, generate a structured, professional summary. 
            
            PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}

            RULES:
            - Keep it concise (Total length should not exceed ${isAdvanced ? '15-20' : '8-10'} lines).
            - Do not hallucinate. 
            - Use a professional corporate tone.
            ${!isAdvanced ? '- LIMITATION: Provide only a high-level summary. Focus on the most critical points only.' : ''}
            
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
  inputType: 'transcript' | 'summary',
  tier: SubscriptionTier = 'free'
): Promise<StrategicAnalysis> => {
  const isAdvanced = tier !== 'guest';
  
  const prompt = `
    You are the EchoNote Strategic Intelligence engine. Your goal is to transform the provided ${inputType} into deep, strategic insights that reveal the "thinking" behind the conversation.
    
    PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}

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
    8. Alternative Perspectives: What other ways could this situation be interpreted or approached? ${isAdvanced ? '(Multiple viewpoints)' : '(Single alternative)'}
    9. Ignored Questions: What important questions were left unasked or unanswered during the conversation?
    10. Unresolved Topics: ${isAdvanced ? 'Identify topics discussed but no decision made, open-ended discussions, or unanswered questions.' : 'Empty array (Advanced Feature)'}
       ${isAdvanced ? `
       - Do NOT include topics that already have decisions.
       - Avoid trivial or minor points.
       - Focus on meaningful gaps.
       - For each, provide: id, topic (title), context (short explanation), reasonUnresolved (why it remains open), and suggestedAction (next step).
       ` : ''}
    11. Decision Framework: A brief assessment of the framework or logic being used to make decisions.
    12. Next Steps: Concrete, actionable steps that move the strategy forward.

    RULES:
    - Be critical, analytical, and insightful.
    - Do not just summarize; find the hidden patterns and strategic implications.
    - Use a professional, high-level executive tone.
    - Return ONLY valid JSON.
    ${!isAdvanced ? '- LIMITATION: Provide only basic insights. Keep responses concise.' : ''}
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
          unresolvedTopics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                topic: { type: Type.STRING },
                context: { type: Type.STRING },
                reasonUnresolved: { type: Type.STRING },
                suggestedAction: { type: Type.STRING },
              },
              required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
            },
          },
          decisionFramework: { type: Type.STRING },
          nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          "coreIntent", "context", "assumptions", "logicalGaps", "blindSpots", 
          "strategicQuestions", "recommendations", "alternativePerspectives", 
          "ignoredQuestions", "unresolvedTopics", "decisionFramework", "nextSteps"
        ],
      },
    },
  });

  const jsonStr = response.text || "{}";
  return JSON.parse(jsonStr);
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
  const isAdvanced = tier !== 'guest';
  
  const prompt = `
    You are the EchoNote Decision Intelligence workspace engine. 
    Your task is to transform a raw meeting transcript into a unified, interconnected intelligence output.
    
    PLAN LEVEL: ${isAdvanced ? 'ADVANCED (Full Insights)' : 'BASIC (Limited Insights)'}

    INPUT (TRANSCRIPT):
    ${transcript}

    OUTPUT (STRICT UNIFIED JSON SCHEMA):
    1. title: A concise, professional title.
    2. summary: ${isAdvanced ? '5-7' : '2-3'} critical bullet points.
    3. topics: Categorized discussion points.
    4. keyInsights: ${isAdvanced ? 'High-level strategic takeaways' : 'Basic observations'}.
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
    7. unresolved_topics: Array of objects.
       - id: Unique ID (e.g., "unres-1").
       - topic: Topic title.
       - context: Short explanation.
       - reasonUnresolved: Why it remains open (e.g., no decision made, open-ended discussion, unanswered question).
       - suggestedAction: A specific recommendation for the next step.
    8. execution_tracker: ExecutionTracker object.
       - totalTasks: Total number of tasks.
       - completedTasks: Number of completed tasks (Do NOT assume completion unless specified).
       - pendingTasks: Number of pending tasks.
       - overdueTasks: Number of overdue tasks (based on current date if deadline passed).
       - completionRate: Percentage of completed tasks.
       - delayRate: Percentage of overdue tasks.
       - tasks: Array of objects.
         - id: Unique ID.
         - description: Task description.
         - assignee: Assigned person.
         - status: Status (Completed / Pending / Overdue).
       - keyInsights: Array of concise, meaningful insights (e.g., "Low execution rate", "High delays").
    9. meetingIntelligence: MeetingIntelligence object.
       - productivityScore (0-100)
       - productivityExplanation
       - clarityScore (0-100)
       - clarityExplanation
       - actionabilityScore (0-100)
       - actionabilityExplanation
       - effectivenessSummary
       - keyStrengths (array)
       - keyWeaknesses (array)
    10. strategicAnalysis: StrategicAnalysis object.
       - coreIntent
       - context
       - assumptions (array)
       - logicalGaps (array)
       - blindSpots (array)
       - strategicQuestions (array)
       - recommendations (array)
       - alternativePerspectives (array)
       - ignoredQuestions (array)
       - unresolvedTopics (array of objects with id, topic, context, reasonUnresolved, suggestedAction)
       - decisionFramework
       - nextSteps (array)
    11. followUp: FollowUp object.
       - email (draft)
       - nextMeetingAgenda (array)
       - keyPendingItems (array)
    12. calendar_reminders: SmartReminderSystem object.
       - reminders: Array of objects.
         - id: Unique ID.
         - title: Reminder title.
         - description: Detailed description.
         - suggestedDateTime: ISO 8601 string.
         - priority: "High" | "Medium" | "Low".
         - group: "Immediate" | "Upcoming" | "Long-term".
         - calendarEventFormat: Object.
           - title: Event title.
           - description: Event description.
           - location: Optional location.
           - startTime: ISO 8601 string.
           - endTime: ISO 8601 string.
       - summary: A brief summary of the reminder strategy.

    CRITICAL RULES:
    - Decisions ↔ Related Tasks: Link them using IDs.
    - Tasks ↔ People: Ensure assignees match speaker names where possible.
    - Unresolved Topics ↔ Suggested Actions: Provide clear paths forward.
    - NO DUPLICATE ENTRIES: Do not repeat information across sections.
    - CONSISTENT IDs: Use the same IDs for cross-referencing.
    - CLEAN HIERARCHY: The output must be a single, valid JSON object.
    - Unresolved Topics Detector: Identify topics discussed but no decision made, open-ended discussions, and questions that were not answered. Do NOT include topics that already have decisions. Avoid trivial or minor points. Focus on meaningful gaps.
    - Execution Tracker: Generate metrics based on extracted tasks. Do NOT assume completion unless specified. Keep insights concise and meaningful.
    - Smart Reminder System: Generate reminders for tasks and decisions requiring follow-up. Do NOT create reminders for completed tasks. Prioritize critical tasks and unresolved topics. Group reminders into: Immediate (within 24 hrs), Upcoming (within 3–7 days), Long-term. Use the current date/time as a reference: ${new Date().toISOString()}.
    ${!isAdvanced ? '- LIMITATION: Provide only basic extraction of decisions and tasks. Keep summaries very short.' : ''}
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
          unresolved_topics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                topic: { type: Type.STRING },
                context: { type: Type.STRING },
                reasonUnresolved: { type: Type.STRING },
                suggestedAction: { type: Type.STRING },
              },
              required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
            },
          },
          execution_tracker: {
            type: Type.OBJECT,
            properties: {
              totalTasks: { type: Type.NUMBER },
              completedTasks: { type: Type.NUMBER },
              pendingTasks: { type: Type.NUMBER },
              overdueTasks: { type: Type.NUMBER },
              completionRate: { type: Type.NUMBER },
              delayRate: { type: Type.NUMBER },
              tasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    description: { type: Type.STRING },
                    assignee: { type: Type.STRING },
                    status: { type: Type.STRING, enum: ["Completed", "Pending", "Overdue"] },
                  },
                  required: ["id", "description", "assignee", "status"],
                },
              },
              keyInsights: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["totalTasks", "completedTasks", "pendingTasks", "overdueTasks", "completionRate", "delayRate", "tasks", "keyInsights"],
          },
          meetingIntelligence: {
            type: Type.OBJECT,
            properties: {
              productivityScore: { type: Type.NUMBER },
              productivityExplanation: { type: Type.STRING },
              clarityScore: { type: Type.NUMBER },
              clarityExplanation: { type: Type.STRING },
              actionabilityScore: { type: Type.NUMBER },
              actionabilityExplanation: { type: Type.STRING },
              effectivenessSummary: { type: Type.STRING },
              keyStrengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              keyWeaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["productivityScore", "productivityExplanation", "clarityScore", "clarityExplanation", "actionabilityScore", "actionabilityExplanation", "effectivenessSummary", "keyStrengths", "keyWeaknesses"],
          },
          strategicAnalysis: {
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
              unresolvedTopics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    context: { type: Type.STRING },
                    reasonUnresolved: { type: Type.STRING },
                    suggestedAction: { type: Type.STRING },
                  },
                  required: ["id", "topic", "context", "reasonUnresolved", "suggestedAction"],
                },
              },
              decisionFramework: { type: Type.STRING },
              nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["coreIntent", "context", "assumptions", "logicalGaps", "blindSpots", "strategicQuestions", "recommendations", "alternativePerspectives", "ignoredQuestions", "unresolvedTopics", "decisionFramework", "nextSteps"],
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
          calendar_reminders: {
            type: Type.OBJECT,
            properties: {
              reminders: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    suggestedDateTime: { type: Type.STRING },
                    priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
                    group: { type: Type.STRING, enum: ["Immediate", "Upcoming", "Long-term"] },
                    calendarEventFormat: {
                      type: Type.OBJECT,
                      properties: {
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        location: { type: Type.STRING },
                        startTime: { type: Type.STRING },
                        endTime: { type: Type.STRING },
                      },
                      required: ["title", "description", "startTime", "endTime"],
                    },
                  },
                  required: ["id", "title", "description", "suggestedDateTime", "priority", "group", "calendarEventFormat"],
                },
              },
              summary: { type: Type.STRING },
            },
            required: ["reminders", "summary"],
          },
        },
        required: ["title", "summary", "topics", "keyInsights", "decisions", "tasks", "unresolved_topics", "execution_tracker", "meetingIntelligence", "strategicAnalysis", "followUp", "calendar_reminders"],
      },
    },
  });

  const jsonStr = response.text || "{}";
  const rawData = JSON.parse(jsonStr);
  
  // Map snake_case to camelCase for the interface
  return {
    ...rawData,
    unresolvedTopics: rawData.unresolved_topics,
    executionTracker: rawData.execution_tracker,
    calendarReminders: rawData.calendar_reminders
  };
};
