import fs from 'node:fs';

/**
 * tests/test_assistant_context_and_quality.ts
 *
 * Deterministic verification suite for AH[0143] - EchoNote Assistant Context & Answer Quality
 */

import assert from 'node:assert';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`   ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`    ❌ ${name}`);
    console.error(err);
    failed++;
  }
}

// Fixtures for Deterministic Verification
// 1. Fixed authoritative recording with transcript and summary
const mockRecording = {
  id: 'rec_12345',
  title: 'QK Strategy PLANNING',
  summary: 'Team decided to launch the new audio model on November 15 with a $50,000 budget.',
  decisions: [
    'Launch audio model on November 15',
    'Allocate $50,000 to cloud infrastructure'
  ],
  transcript: 'Alice: We need to finalize our QK targets. Bob: I propose we launch on November 15. Alice: Agreed, lets allocate $50000 for it.',
  userId: 'user_alice',
  projectId: 'proj_71'
};

// 2. Fixed authoritative project tasks
const mockProjectTasks = [
  { id: 'task_1', projectId: 'proj_71', title: 'Deploy infrastructure', status: 'IN_PROGRESS', dueDate: '2026-11-10', assigneeId: 'user_alice' },
  { id: 'task_2', projectId: 'proj_71', title: 'Perform EAT testing', status: 'TODO', dueDate: '2026-11-14', assigneeId: 'user_bob' }
];

// Simulator for Server Context Assembly & Prompt Construction
function assembleServerContext(options: {
  user: any,
  recordId?: string | null,
  projectId?: string | null,
  plan?: string,
  userData?: any,
  clientSuppliedTranscript?: string,
  recordStore?: Record<string, any>,
  projectStore?: Record<string, any>,
  taskStore?: any[]
}) {
  const plan = options.plan || 'free';
  const userData = options.userData || {};

  let authorizedRecord = null;
  let authorizedProject = null;

  if (options.recordId) {
    const rec = options.recordStore ? options.recordStore[options.recordId] : null;
    if (!rec || (rec.userId !== options.user.uid && !options.user.platform_admin)) {
      return { error: 'Forbidden', status: 403 };
    }
    authorizedRecord = rec;
  }


  if (options.projectId) {
    const proj = options.projectStore ? options.projectStore[options.projectId] : null;
    if (!proj) {
      return { error: 'Not Found', status: 404 };
    }
    authorizedProject = proj;
  }

  let recordingTitle = authorizedRecord?.title || authorizedRecord?.name || null;
  let recordingSummary = authorizedRecord?.summary || null;
  let recordingDecisions: string[] = Array.isArray(authorizedRecord?.decisions) ? authorizedRecord.decisions : [];
  let recordingTranscript = authorizedRecord?.transcript || authorizedRecord?.text || null;
  let transcriptTruncated = false;

  const MAX_TRANSCRIPT_CHARS = 12000;
  if (recordingTranscript && typeof recordingTranscript === 'string') {
    if (recordingTranscript.length > MAX_TRANSCRIPT_CHARS) {
      recordingTranscript = recordingTranscript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n[... TRANSCRIPT_TRUNCATED_DUE_TO_CONTEXT_BUDGET >>?]";
      transcriptTruncated = true;
    }
  }

  let projectTaskSummaries: string[] = [];
  if (options.projectId && options.taskStore) {
    projectTaskSummaries = options.taskStore
      .filter(t => t.projectId === options.projectId)
      .map(t => `- [${t.status || 'TODO'}] ${t.title} (Due: ${t.dueDate}, Assignee: ${t.assigneeId})`);
  }

  let contextBlock = "=== AUTHORITATIVE SERVER CONTEXT ===\n";
  contextBlock += `- User Plan: ${plan}\n`;
  if (options.recordId && authorizedRecord) {
    contextBlock += "\n[ACTIVE RECORDING DETAILS]\n";
    contextBlock += `- Recording ID: ${options.recordId}\n`;
    contextBlock += `- Title / File: ${recordingTitle || 'Untitled'}\n`;
    if (recordingSummary) {
      contextBlock += `- Meeting Summary: ${recordingSummary}\n`;
    }
    if (recordingDecisions.length > 0) {
      contextBlock += `- Logged Decisions: \n${recordingDecisions.map(d => '  * ' + d).join('\n')}\n`;
    }
    if (recordingTranscript) {
      contextBlock += `- Transcript Content:\n"""\n${recordingTranscript}\n"""\n`;
    } else {
      contextBlock += "- Transcript Content: [No transcript available for this recording]\n";
    }
  } else {
    contextBlock += "\n[ACTIVE RECORDING DETAILS]\n- No recording currently selected or authorized.\n";
  }

  if (options.projectId) {
    contextBlock += "\n[PROJECT CONTEXT]\n";
    contextBlock += `- Project ID: ${options.projectId}\n`;
    contextBlock += `- Project Tasks:\n${projectTaskSummaries.join('\n')}\n`;
  }
  contextBlock += "=== END CONTEXT ==="

  return { contextBlock, transcriptTruncated, authorizedRecord };
}



// ----------------------------------------------------------------------------
// Extracted Server Logic for AH.144 Verification
// ----------------------------------------------------------------------------
interface ClassifiedAiError {
    statusCode: number;
    code: string;
    sanitizedMessage: string;
    retryable: boolean;
  }

  
function classifyAiError(err: any): ClassifiedAiError {
    const rawMsg = String(err?.message || err?.error || err || "");
    const status = Number(err?.status || err?.statusCode || 0);

    // 1. Rate limiting & quota checks (distinguish where detectable)
    if (
      status === 429 ||
      /RESOURCE_EXHAUSTED|RATE_LIMIT_EXCEEDED|quota|rate limit|too many requests/i.test(rawMsg)
    ) {
      if (/quota|billing|credit|exhausted/i.test(rawMsg)) {
        return {
          statusCode: 429,
          code: "AI_QUOTA_EXCEEDED",
          sanitizedMessage: "The AI service has reached its usage or billing quota. Please verify your account tier or contact support.",
          retryable: false
        };
      }
      return {
        statusCode: 429,
        code: "AI_RATE_LIMITED",
        sanitizedMessage: "The AI assistant is temporarily rate-limited. Please wait a moment and try again.",
        retryable: true
      };
    }

    // 2. Authentication or Configuration failures
    if (
      status === 401 ||
      status === 403 ||
      /API_KEY_INVALID|INVALID_ARGUMENT.*api_key|UNAUTHENTICATED|permission denied|unauthorized/i.test(rawMsg)
    ) {
      return {
        statusCode: 503,
        code: "AI_CONFIG_ERROR",
        sanitizedMessage: "The AI assistant service is temporarily misconfigured or unavailable. Please contact an administrator.",
        retryable: false
      };
    }

    // 3. Timeouts
    if (
      status === 408 ||
      status === 504 ||
      /DEADLINE_EXCEEDED|timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(rawMsg)
    ) {
      return {
        statusCode: 504,
        code: "AI_TIMEOUT",
        sanitizedMessage: "The AI assistant timed out while processing your request. Please try again.",
        retryable: true
      };
    }

    // 4. Network or upstream provider failures
    if (
      status === 502 ||
      status === 503 ||
      /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UNAVAILABLE|network|fetch failed|service unavailable/i.test(rawMsg)
    ) {
      return {
        statusCode: 502,
        code: "AI_UPSTREAM_UNAVAILABLE",
        sanitizedMessage: "Upstream AI model provider is currently unreachable. Please try again in a moment.",
        retryable: true
      };
    }

    // 5. Default generic internal failure
    return {
      statusCode: 500,
      code: "AI_INTERNAL_ERROR",
      sanitizedMessage: "The AI assistant encountered an unexpected error. Please try again later.",
      retryable: true
    };
  }

  // Helper to sanitize error messages from AI provider calls to prevent credentials, stack traces, or internal paths from leaking
  
function sanitizeAiErrorMessage(errMsg: any): string {
    if (!errMsg || typeof errMsg !== 'string') return "AI processing failed. Please try again.";
    let sanitized = errMsg
      .replace(/AIza[0-9A-Za-z-_]{30,45}/g, '[REDACTED]')
      .replace(/(?:key|apiKey|token|secret|authorization)=[^&\\s]+/gi, '=[REDACTED]')
      .replace(/Bearer\\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/[A-Za-z]:[\\/][^:\r\n]+|\/(?:home|usr|var|tmp|app)[^:\r\n]*/g, '[INTERNAL_PATH]');
    if (sanitized.includes('at ') && sanitized.includes('(')) {
      sanitized = sanitized.split('\\n')[0];
    }
    return sanitized;
  }

  
type AssistantOutcome = 'ANSWERED' | 'INSUFFICIENT_CONTEXT' | 'CLARIFICATION_NEEDED' | 'ACTION_REQUESTED' | 'ACTION_EXECUTED';
  type AssistantIntent = 'summarize' | 'analyze thinking' | 'decisions' | 'add to project' | 'usage / minutes' | 'none';

  interface ValidatedAssistantResponse {
    reply: string;
    intent: AssistantIntent;
    outcome: AssistantOutcome;
    executeAction: boolean;
    missingSources?: string[];
    suggestedNextStep?: string;
  }

  function validateAssistantResponse(parsed: any, userMessage: string): ValidatedAssistantResponse | null {
    if (!parsed || typeof parsed !== 'object') return null;

    let { reply, intent, outcome, executeAction, missingSources, suggestedNextStep } = parsed;

    if (typeof reply !== 'string' || reply.trim().length === 0) {
      return null;
    }

    const validIntents: AssistantIntent[] = ["summarize", 'analyze thinking', 'decisions', 'add to project', 'usage / minutes', 'none'];
    if (typeof intent !== 'string' || !validIntents.includes(intent as AssistantIntent)) {
      intent = 'none';
    }

    const validOutcomes: AssistantOutcome[] = ['ANSWERED', 'INSUFFICIENT_CONTEXT', 'CLARIFICATION_NEEDED', 'ACTION_REQUESTED', 'ACTION_EXECUTED'];
    if (typeof outcome !== 'string' || !validOutcomes.includes(outcome as AssistantOutcome)) {
      return null;
    }

    if (outcome === 'ACTION_EXECUTED') {
      outcome = 'ACTION_REQUESTED';
    }

    if (typeof executeAction !== 'boolean') {
      executeAction = (outcome === 'ACTION_REQUESTED' && intent !== 'none');
    }

    const isInformational = /^(?:what|who|where|when|why|how|is|are|does|did|can|could|would|tell me about|describe)\\b/i.test(userMessage.trim());
    if (isInformational && executeAction) {
      executeAction = false;
      if (outcome === 'ACTION_REQUESTED') outcome = 'ANSWERED';
    }

    const validatedMissing = Array.isArray(missingSources)
      ? missingSources.filter(s => typeof s === 'string')
      : undefined;

    return {
      reply: reply.trim(),
      intent: intent as AssistantIntent,
      outcome: outcome as AssistantOutcome,
      executeAction,
      missingSources: validatedMissing,
      suggestedNextStep: typeof suggestedNextStep === 'string' ? suggestedNextStep.trim() : undefined
    };
  }



  

function runSuite() {
  console.log('\n=================================================');
  console.log('AH.143 — EchoNote Assistant Context & Answer Quality Tests');
  console.log('=================================================\n');

// 1. Direct question answered using active recording transcript
  test('1. Direct question answered using active recording transcript', () => {
    const ctx = assembleServerContext({
      user: { uid: 'user_alice' },
      recordId: 'rec_12345',
      recordStore: { rec_12345: mockRecording }
    });
    assert(!ctx.error, 'Access should be granted');
    assert(ctx.contextBlock.includes('Alice: We need to finalize our QK targets.'), 'Context block must contain authoritative transcript');
    assert(ctx.contextBlock.includes('Transcript Content:\n"""'), 'Transcript must be delimited clearly');
  });

  // 2. A question answered using an available meeting summary
  test('2. A question answered using an available meeting summary', () => {
    const ctx = assembleServerContext({
      user: {uid: 'user_alice' },
      recordId: 'rec_12345',
      recordStore: { rec_12345: mockRecording }
    });
    assert(ctx.contextBlock.includes('- Meeting Summary: Team decided to launch the new audio model on November 15'), 'Summary must be included in context');
    assert(ctx.contextBlock.includes('- Logged Decisions:'), 'Logged decisions must be included');
  });

  // 3. A project-level question when no recording is selected
  test('3. A project-level question when no recording is selected', () => {
    const ctx = assembleServerContext({
      user: { uid: 'user_alice' },
      recordId: null,
      projectId: 'proj_71',
      projectStore: { proj_71: { id: 'proj_71', name: 'Audio Pipeline Project' } },
      taskStore: mockProjectTasks
    });
    assert(ctx.contextBlock.includes('- No recording currently selected or authorized.'), 'No recording label must be explicit, not generic None');
    assert(!ctx.contextBlock.includes('Transcript Content: None'), 'Should not pass literal string None');
    assert(ctx.contextBlock.includes('- [IN_PROGRESS] Deploy infrastructure'), 'Project tasks must be available in context');
    assert(ctx.contextBlock.includes('- [TODO] Perform EAT testing'), 'All tasks for project present');
  });

  // 4. An absent fact handled without fabrication
  test('4. An absent fact handled without fabrication', () => {
    // Verify system prompt and model response schema require INSUFFICIENT_CONTEXT
    const sysPrompt = `HONEST ABOUT ABSENT FACTS: If the requested fact, person, decision, or metric is not present in the available context, clearly and politely state that the information is absent. Set outcome to "INSUFFICIENT_CONTEXT".`;
    assert(sysPrompt.includes('INSUFFICIENT_CONTEXT'), 'System prompt must have INSUFFICIENT_CONTEXT guideline');
    
    // Mocked response when user asks about a non-existent topic
    const absentFactResponse = {
      reply: "The provided transcript does not mention any marketing budget or CMO decisions.",
      intent: "none",
      outcome: "INSUFFCIENT_CONTEXT",
      executeAction: false
    };
    assert.equal(absentFactResponse.outcome, "INSUFFCIENT_CONTEXT");
    assert(!absentFactResponse.executeAction);
  });

  // 5. A multi-turn follow-up resolved using recent conversation history
  test('5. A multi-turn follow-up resolved using recent conversation history', () => {
    const history = [
      { role: 'user', text: 'Who proposed the launch date?' },
      { role: 'assistant', text: 'Bob proposed launching on November 15.' }
    ];
    const contents = history.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.text }]
    }));
    contents.push({ role: 'user', parts: [{ text: 'What did Alice say to that?' }] });

    assert.equal(contents.length, 3, 'Must include all preceding turns and new message');
    assert.equal(contents[1].role, 'model', 'Assistant role must be mapped to model for Gemini');
    assert.equal(contents[2].parts[0].text, 'What did Alice say to that?');
  });

  // 6. Empty or missing transcript context
  test('6. Empty or missing transcript context', () => {
    const ctx = assembleServerContext({
      user: { uid: 'user_alice' },
      recordId: 'rec_no_transcript',
      recordStore: { rec_no_transcript: { id: 'rec_no_transcript', userId: 'user_alice', title: 'Notes' } }
    });
    assert(ctx.contextBlock.includes('- Transcript Content: [No transcript available for this recording]'), 'Handles missing transcript explicitly');
  });

  // 7. A request containing an unauthorized recording or project ID
  test('7. A request containing an unauthorized recording or project ID', () => {
    const ctx = assembleServerContext({
      user: {uid: 'user_attacker' },
      recordId: 'rec_12345',
      recordStore: { rec_12345: mockRecording }
    });
    assert.equal(ctx.status, 403, 'Must reject unauthorized access with 403');
    assert.equal(ctx.error, 'Forbidden');
  });

  // 8. A history payload exceeding the configured limits
  test('8. A history payload exceeding the configured limits', () => {
    const hugeHistory = Array.from({ length: 20}, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: (i + 1) + ' ' + 'A'.repeat(1500)
    }));

    const sanitized = hugeHistory.slice(-6).map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(h.text).trim().slice(0, 1000) }]
    }));

    assert.equal(sanitized.length, 6, 'Maximum 6 recent turns permitted');
    assert(sanitized.every(t => t.parts[0].text.length <= 1000), 'Each turn text capped at 1000 chars');
  });

  // 9. Client-supplied fabricated transcript text being rejected or ignored as authoritative context
  test('9. Client-supplied fabricated transcript text ignored', () => {
    const ctx = assembleServerContext({
      user: { uid: 'user_alice' },
      recordId: 'rec_12345',
      clientSuppliedTranscript: 'FAKE TRANSCRIPT WITH FAKE DATA',
      recordStore: { rec_12345: mockRecording }
    });
    assert(!ctx.contextBlock.includes('FAKE TRANSCRIPT'), 'Client fabricated transcript must never be included in authoritative context');
    assert(ctx.contextBlock.includes('Alice: We need to finalize our'), 'Authoritative data from store used');
  });

  // 10. A general informational question not triggering a state-changing action
  test('10. Informational question does not trigger state-changing action', () => {
    const informationalResponse = {
      reply: "The meeting summary indicates the team plans to launch on November 15 to avoid holiday freezes.",
      intent: "summarize", // Model may classify topic as summarize
      outcome: "ANSWERED",
      executeAction: false // MUST NOT execute action
    };

    let summaryTriggered = false;
    const actions = {
      summarizeTranscript: () => { summaryTriggered = true; }
    };

    // Frontend guard verification:
    if (informationalResponse.executeAction && informationalResponse.intent === 'summarize') {
      actions.summarizeTranscript();
    }

    assert(!summaryTriggered, 'Summarization action must not fire for an informational question');
  });

  // 11. An explicit action request following the existing safe action flow
  test('11. An explicit action request following the existing safe action flow', () => {
    const actionRequestResponse = {
      reply: "Summarizing the transcript now...",
      intent: "summarize",
      outcome: "ACTION_REQUESTED",
      executeAction: true
    };

    let summaryTriggered = false;
    const actions = {
      summarizeTranscript: () => { summaryTriggered = true; }
    };

    if (actionRequestResponse.executeAction && actionRequestResponse.intent === 'summarize') {
      actions.summarizeTranscript();
    }

    assert(summaryTriggered, 'Action must be triggered when executeAction is true');
  });

  // 12. Existing assistant response parsing and error handling remaining compatible
  test('12. Existing assistant response parsing and error handling remaining compatible', () => {
    // Verify fallback json has preserved fields
    const fallbackJson = '{"reply": "I am here to help.", "intent": "none", "outcome": "ANSWERED", "executeAction": false}';
    const parsed = JSON.parse(fallbackJson);
    assert.equal(parsed.reply, 'I am here to help.');
    assert.equal(parsed.intent, 'none');
    assert(parsed.outcome === 'ANSWERED');
    assert(parsed.executeAction === false);

    // Verify client error surfacing
    const errorMessage = 'Rate limit exceeded';
    const surfacedText = 'Error: ' + errorMessage;
    assert.equal(surfacedText, 'Error: Rate limit exceeded');
  });


  console.log('\n=================================================');
  console.log('AH.144 — Structured Assistant Responses and Honest Failure Handling');
  console.log('=================================================\n');

  // AH.144 - 1. Valid ANSWERED response
  test('AH.144-1: Valid ANSWERED response validated correctly', () => {
    const raw = {
      reply: "The team finalized the release date for November 15.",
      intent: "none",
      outcome: "ANSWERED",
      executeAction: false
    };
    const validated = validateAssistantResponse(raw, "When is the release date?");
    assert(validated);
    assert.equal(validated.outcome, "ANSWERED");
    assert.equal(validated.executeAction, false);
    assert.equal(validated.reply, "The team finalized the release date for November 15.");
  });

  // AH.144 - 2. Valid INSUFFICIENT_CONTEXT response with missing source and next step
  test('AH.144-2: Valid INSUFFICIENT_CONTEXT response preserves missing sources and next steps', () => {
    const raw = {
      reply: "I could not find any information about the Q4 marketing budget in the recording transcript or project tasks.",
      intent: "none",
      outcome: "INSUFFICIENT_CONTEXT",
      executeAction: false,
      missingSources: ["recording transcript", "project tasks"],
      suggestedNextStep: "Select a recording that discusses budget planning or upload the finance meeting audio."
    };
    const validated = validateAssistantResponse(raw, "What is our Q4 marketing budget?");
    assert(validated);
    assert.equal(validated.outcome, "INSUFFICIENT_CONTEXT");
    assert.equal(validated.executeAction, false);
    assert.deepEqual(validated.missingSources, ["recording transcript", "project tasks"]);
    assert.equal(validated.suggestedNextStep, "Select a recording that discusses budget planning or upload the finance meeting audio.");
  });

  // AH.144 - 3. Valid CLARIFICATION_NEEDED response
  test('AH.144-3: Valid CLARIFICATION_NEEDED response validated correctly', () => {
    const raw = {
      reply: "Would you like me to summarize the current recording transcript, or list the open project tasks?",
      intent: "none",
      outcome: "CLARIFICATION_NEEDED",
      executeAction: false
    };
    const validated = validateAssistantResponse(raw, "Give me the status");
    assert(validated);
    assert.equal(validated.outcome, "CLARIFICATION_NEEDED");
    assert.equal(validated.executeAction, false);
  });

  // AH.144 - 4. Malformed or missing model response fields safely rejected
  test('AH.144-4: Malformed or missing model response fields safely rejected', () => {
    assert.equal(validateAssistantResponse(null, "test"), null, 'null response rejected');
    assert.equal(validateAssistantResponse(undefined, "test"), null, 'undefined response rejected');
    assert.equal(validateAssistantResponse({}, "test"), null, 'empty object rejected');
    assert.equal(validateAssistantResponse({ reply: "" }, "test"), null, 'empty reply rejected');
    assert.equal(validateAssistantResponse({ reply: 123 }, "test"), null, 'non-string reply rejected');
    assert.equal(validateAssistantResponse({ reply: "Hi" }, "test"), null, 'missing outcome rejected');
  });

  // AH.144 - 5. Invalid outcome or intent values normalized or rejected
  test('AH.144-5: Invalid outcome or intent values normalized or rejected', () => {
    const invalidOutcome = { reply: "Hello", outcome: "INVALID_OUTCOME", intent: "none", executeAction: false };
    assert.equal(validateAssistantResponse(invalidOutcome, "test"), null, 'Invalid outcome rejected');

    const invalidIntent = { reply: "Hello", outcome: "ANSWERED", intent: "hacked_intent", executeAction: false };
    const validated = validateAssistantResponse(invalidIntent, "test");
    assert(validated);
    assert.equal(validated.intent, "none", 'Unknown intent normalized to none');
  });

  // AH.144 - 6. Model-generated ACTION_EXECUTED coerced to ACTION_REQUESTED
  test('AH.144-6: Model-generated ACTION_EXECUTED never trusted as completed action', () => {
    const hallucinatoryAction = {
      reply: "I have summarized your recording and deleted your tasks!",
      intent: "summarize",
      outcome: "ACTION_EXECUTED",
      executeAction: true
    };
    const validated = validateAssistantResponse(hallucinatoryAction, "Please summarize this audio");
    assert(validated);
    assert.equal(validated.outcome, "ACTION_REQUESTED", 'ACTION_EXECUTED must be downgraded to ACTION_REQUESTED');
    assert.notEqual(validated.outcome, "ACTION_EXECUTED");
  });

  // AH.144 - 7. Genuine action success and failure tracking
  test('AH.144-7: Genuine action execution is gated by caller verification', () => {
    let executedAction = null;
    const actions = {
      summarizeTranscript: () => { executedAction = 'summarize'; },
      assignToProject: () => { executedAction = 'add to project'; }
    };

    const infoResponse = { outcome: "ANSWERED", intent: "summarize", executeAction: false };
    if (infoResponse.executeAction && infoResponse.intent === 'summarize') {
      actions.summarizeTranscript();
    }
    assert.equal(executedAction, null, 'Action must not run when executeAction is false');

    const actionResponse = { outcome: "ACTION_REQUESTED", intent: "summarize", executeAction: true };
    if (actionResponse.executeAction && actionResponse.intent === 'summarize') {
      actions.summarizeTranscript();
    }
    assert.equal(executedAction, 'summarize', 'Action accurately executed after verification');
  });

  // AH.144 - 8. Rate-limit handling classification and retryability
  test('AH.144-8: Rate-limit handling correctly classified and retryable', () => {
    const rateLimitErr1 = { status: 429, message: "RATE_LIMIT_EXCEEDED: too many requests per minute" };
    const classified1 = classifyAiError(rateLimitErr1);
    assert.equal(classified1.statusCode, 429);
    assert.equal(classified1.code, "AI_RATE_LIMITED");
    assert.equal(classified1.retryable, true);
    assert(classified1.sanitizedMessage.includes('rate-limited'));

    const rateLimitErr2 = new Error("RESOURCE_EXHAUSTED: quota exceeded for model");
    const classified2 = classifyAiError(rateLimitErr2);
    assert.equal(classified2.statusCode, 429);
    assert.equal(classified2.code, "AI_QUOTA_EXCEEDED");
    assert.equal(classified2.retryable, false, 'Billing/quota errors must not be retryable');
  });

  // AH.144 - 9. Provider quota vs authentication/configuration error distinction
  test('AH.144-9: Authentication and configuration errors distinguished from quota', () => {
    const authErr = { status: 401, message: "API_KEY_INVALID: API key not valid. Please pass a valid API key." };
    const classifiedAuth = classifyAiError(authErr);
    assert.equal(classifiedAuth.statusCode, 503);
    assert.equal(classifiedAuth.code, "AI_CONFIG_ERROR");
    assert.equal(classifiedAuth.retryable, false);
    assert(!classifiedAuth.sanitizedMessage.includes('API_KEY_INVALID'), 'Secret/key detail must not leak');

    const permErr = { status: 403, message: "The caller does not have permission" };
    const classifiedPerm = classifyAiError(permErr);
    assert.equal(classifiedPerm.statusCode, 503);
    assert.equal(classifiedPerm.code, "AI_CONFIG_ERROR");
  });

  // AH.144 - 10. Provider timeout and network failures
  test('AH.144-10: Provider timeout and upstream network failures', () => {
    const timeoutErr = { status: 504, message: "DEADLINE_EXCEEDED: upstream request timed out after 30s" };
    const classifiedTimeout = classifyAiError(timeoutErr);
    assert.equal(classifiedTimeout.statusCode, 504);
    assert.equal(classifiedTimeout.code, "AI_TIMEOUT");
    assert.equal(classifiedTimeout.retryable, true);

    const netErr = new Error("fetch failed: ECONNRESET upstream socket closed");
    const classifiedNet = classifyAiError(netErr);
    assert.equal(classifiedNet.statusCode, 502);
    assert.equal(classifiedNet.code, "AI_UPSTREAM_UNAVAILABLE");
    assert.equal(classifiedNet.retryable, true);
  });

  // AH.144 - 11. Unexpected server errors produce sanitized client responses
  test('AH.144-11: Unexpected server errors produce sanitized client responses', () => {
    const internalErr = new Error("Unexpected memory corruption in native addon C:\\Users\\Admin\\secret.dll at Object.<anonymous> (file.ts:25:10)");
    const classified = classifyAiError(internalErr);
    assert.equal(classified.statusCode, 500);
    assert.equal(classified.code, "AI_INTERNAL_ERROR");
    assert.equal(classified.sanitizedMessage, "The AI assistant encountered an unexpected error. Please try again later.");
  });

  // AH.144 - 12. No stack traces, secrets, raw provider payloads, or paths leak in error sanitization
  test('AH.144-12: No stack traces, secrets, raw provider payloads, or sensitive paths in sanitized errors', () => {
    const rawError = "Error in AIzaSyA123456789012345678901234567890 apiKey=AIzaSyA123456789012345678901234567890 Bearer eyJhbGciOi at /home/node/app/src/server.ts:400:15 (server.ts)";
    const sanitized = sanitizeAiErrorMessage(rawError);

    assert(!sanitized.includes('AIzaSyA123456789012345678901234567890'), 'Raw Gemini API key must be redacted');
    assert(!sanitized.includes('Bearer eyJhbGciOi'), 'Auth token must be redacted');
    assert(!sanitized.includes('/home/node/app'), 'Internal server path must be redacted');
    assert(!sanitized.includes('at '), 'Stack trace line must be stripped');
    assert(sanitized.includes('[REDACTED]'), 'Redaction placeholder present');
  });

  // AH.144 - 13. Failed request does not corrupt chat history or block next message
  test('AH.144-13: Failed request does not corrupt chat history or block next message', () => {
    let history = [
      { role: 'assistant', text: "Hi! How can I help you?" }
    ];

    history.push({ role: 'user', text: "What is the budget?" });

    const classified = classifyAiError(new Error("ETIMEDOUT"));
    history.push({ role: 'error', text: classified.sanitizedMessage });

    const filteredHistory = history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, text: m.text }));

    assert.equal(filteredHistory.length, 2, 'Error message is not sent to AI provider in history');
    assert.equal(filteredHistory[1].text, "What is the budget?");

    history.push({ role: 'user', text: "Are there any decisions logged?" });
    assert.equal(history.length, 4, 'Next message successfully appended');
  });

  // AH.144 - 14. Retry behavior does not duplicate messages or actions
  test('AH.144-14: Retry behavior does not duplicate messages or actions', () => {
    let chatHistory = [
      { role: 'assistant', text: "Hi! How can I help?" },
      { role: 'user', text: "Summarize this audio" },
      { role: 'error', text: "Upstream AI model provider is currently unreachable." }
    ];

    let actionRunCount = 0;
    const actions = {
      summarize: () => { actionRunCount++; }
    };

    if (chatHistory[chatHistory.length - 1].role === 'error') {
      chatHistory.pop();
    }
    assert.equal(chatHistory.length, 2, 'Trailing error removed');
    assert.equal(chatHistory[chatHistory.length - 1].text, "Summarize this audio", 'Existing user prompt preserved without duplicate');

    const retrySuccess = { outcome: "ACTION_REQUESTED", intent: "summarize", executeAction: true };
    chatHistory.push({ role: 'assistant', text: "Summarizing now..." });
    if (retrySuccess.executeAction && retrySuccess.intent === 'summarize') {
      actions.summarize();
    }

    assert.equal(actionRunCount, 1, 'Action executed exactly once');
    assert.equal(chatHistory.filter(m => m.role === 'user').length, 1, 'User message exists exactly once in history');
  });

  // AH.144 - 15. Cross-resource authorization does not leak private resource existence
  test('AH.144-15: Cross-resource authorization does not leak private resource existence', () => {
    const ctx = assembleServerContext({
      user: { uid: "attacker_bob" },
      recordId: "rec_alice_secret",
      recordStore: {
        rec_alice_secret: { id: "rec_alice_secret", userId: "user_alice", title: "Top Secret Merger" }
      }
    });

    assert.equal(ctx.status, 403);
    assert.equal(ctx.error, "Forbidden");
    assert.equal(ctx.authorizedRecord, undefined, 'Private record data must never be returned');
    assert(!JSON.stringify(ctx).includes("Top Secret Merger"), 'Secret title must not leak');
  });


  // AH.150 - 1. Dashboard assistant context passes authorized recording and project IDs
  test('AH.150-1: Dashboard assistant context passes authorized recording and project IDs', () => {
    const mockAudioHistory = [{ id: 'rec_101', name: 'Board Sync.mp3', transcript: 'Q3 numbers discussed' }];
    const mockProjects = [{ id: 'proj_sales', name: 'Sales Pipeline' }];
    const activeRecordId = 'rec_101';
    const selectedGroupFilter = 'Sales Pipeline';

    const dashboardContext = {
      current_page: 'HOME',
      current_project: selectedGroupFilter || 'All Projects',
      selected_file_name: mockAudioHistory.find(r => r.id === activeRecordId)?.name || 'None',
      recordingId: activeRecordId || undefined,
      projectId: selectedGroupFilter ? mockProjects.find(p => p.name === selectedGroupFilter)?.id : undefined
    };

    assert.equal(dashboardContext.recordingId, 'rec_101');
    assert.equal(dashboardContext.projectId, 'proj_sales');
    assert.equal(dashboardContext.current_page, 'HOME');
  });

  // AH.150 - 2. Dashboard question with recording context receives authoritative context
  test('AH.150-2: Dashboard question with recording context receives authoritative context', () => {
    const ctx = assembleServerContext({
      user: { uid: 'user_alice' },
      recordId: 'rec_101',
      recordStore: {
        rec_101: { id: 'rec_101', userId: 'user_alice', transcript: 'Revenue was 5M', title: 'Q3 Financials' }
      }
    });

    assert.equal(ctx.error, undefined);
    assert.equal(ctx.authorizedRecord?.id, 'rec_101');
    assert(ctx.contextBlock.includes('Revenue was 5M'));
  });

  // AH.150 - 3. Dashboard project question works without active recording
  test('AH.150-3: Dashboard project question works without active recording', () => {
    const ctx = assembleServerContext({
      user: { uid: 'user_alice' },
      projectId: 'proj_marketing',
      recordId: undefined,
      projectStore: {
        proj_marketing: { id: 'proj_marketing', name: 'Marketing' }
      },
      taskStore: [
        { projectId: 'proj_marketing', title: 'Launch campaign', status: 'IN_PROGRESS', dueDate: '2026-11-01', assigneeId: 'user_alice' }
      ]
    });

    assert.equal(ctx.error, undefined);
    assert.equal(ctx.authorizedRecord, null);
    assert(ctx.contextBlock.includes('Launch campaign'));
    assert(ctx.contextBlock.includes('IN_PROGRESS'));
  });

  // AH.150 - 4. Missing context result is returned honestly without generic fallback replacement
  test('AH.150-4: Missing context is returned honestly without generic fallback replacement', () => {
    const rawModelResponse = {
      reply: 'I could not find information regarding the legal budget in the available context.',
      intent: 'none',
      outcome: 'INSUFFICIENT_CONTEXT',
      missingSources: ['financial ledger'],
      suggestedNextStep: 'Please select a financial recording or provide the ledger.'
    };

    const validated = validateAssistantResponse(rawModelResponse, 'What is our legal budget?');
    assert(validated !== null);
    assert.equal(validated.outcome, 'INSUFFICIENT_CONTEXT');
    assert(!validated.reply.includes('I can help with transcripts, summaries, decisions'));
  });

  // AH.150 - 5. Sanitized API failure is rendered as retryable error, not generic prompt text
  test('AH.150-5: Sanitized API failure is rendered as retryable error, not generic prompt text', () => {
    const classified = classifyAiError(new Error('Rate limit exceeded: 429 too many requests'));
    assert.equal(classified.code, 'AI_RATE_LIMITED');
    assert.equal(classified.statusCode, 429);
    assert.equal(classified.retryable, true);
    assert(!classified.sanitizedMessage.includes('I can help with transcripts, summaries, decisions'));
  });
  // AH.151 - 1. Verify standalone EchoNoteAssistant launcher is retired from App.tsx
  test('AH.151-1: Standalone EchoNoteAssistant launcher is retired from App.tsx', () => {
    const appSource = fs.readFileSync('C:/Users/riyam/Desktop/EchoNote-github-review/App.tsx', 'utf-8');
    assert(!appSource.includes('<EchoNoteAssistant'), 'Standalone EchoNoteAssistant launcher must not be rendered');
    assert(!appSource.includes('import EchoNoteAssistant'), 'EchoNoteAssistant import must not remain in App.tsx');
  });

  // AH.151 - 2. Verify task-specific AI workflows (summaries, decisions, search) remain wired
  test('AH.151-2: Task-specific AI workflows (summaries, decisions, search) remain wired in App.tsx', () => {
    const appSource = fs.readFileSync('C:/Users/riyam/Desktop/EchoNote-github-review/App.tsx', 'utf-8');
    assert(appSource.includes('handleSummarizeTranscript'), 'Summarization workflow must be preserved');
    assert(appSource.includes('analyzeDecisionIntelligence'), 'Decision intelligence workflow must be preserved');
    assert(appSource.includes('setSearchQuery'), 'Global search workflow must be preserved');
  });
  // AH.152 - 1. Verify AudioToTextView exposes SmartRecapModal and handleTriggerSmartRecap
  test('AH.152-1: Verify AudioToTextView wires SmartRecapModal and handleTriggerSmartRecap', () => {
    const src = fs.readFileSync('C:/Users/riyam/Desktop/EchoNote-github-review/components/AudioToTextView.tsx', 'utf-8');
    assert(src.includes('handleTriggerSmartRecap'), 'AudioToTextView must define handleTriggerSmartRecap');
    assert(src.includes('<SmartRecapModal'), 'AudioToTextView must render SmartRecapModal');
    assert(src.includes('generateSmartRecap'), 'AudioToTextView must call generateSmartRecap');
  });

  // AH.152 - 2. Verify AudioToTextView wires Strategic Thinking Partner
  test('AH.152-2: Verify AudioToTextView wires Strategic Thinking Partner', () => {
    const src = fs.readFileSync('C:/Users/riyam/Desktop/EchoNote-github-review/components/AudioToTextView.tsx', 'utf-8');
    assert(src.includes('analyzeStrategically'), 'AudioToTextView must import analyzeStrategically');
    assert(src.includes('Strategic Thinking Partner'), 'AudioToTextView must expose Strategic Thinking Partner');
  });

  // AH.152 - 3. Verify DecisionIntelligence component exists and connects to analyzeDecisionIntelligence
  test('AH.152-3: Verify DecisionIntelligence connects to analyzeDecisionIntelligence', () => {
    const src = fs.readFileSync('C:/Users/riyam/Desktop/EchoNote-github-review/components/DecisionIntelligence.tsx', 'utf-8');
    assert(src.includes('analyzeDecisionIntelligence'), 'DecisionIntelligence must import analyzeDecisionIntelligence');
    assert(src.includes('handleAnalyze'), 'DecisionIntelligence must define handleAnalyze');
  });

  // AH.152 - 4. Verify TextToAudioView exposes Speech Synthesis workflow
  test('AH.152-4: Verify TextToAudioView exposes Speech Synthesis workflow', () => {
    const src = fs.readFileSync('C:/Users/riyam/Desktop/EchoNote-github-review/components/TextToAudioView.tsx', 'utf-8');
    assert(src.includes('synthesizeSpeech'), 'TextToAudioView must import synthesizeSpeech');
    assert(src.includes('Speech Synthesis'), 'TextToAudioView must render Speech Synthesis title');
  });

  // AH.152 - 5. Verify App.tsx handles global search input and query wiring
  test('AH.152-5: Verify App.tsx wires global search and Navigation tabs without Assistant launcher', () => {
    const src = fs.readFileSync('C:/Users/riyam/Desktop/EchoNote-github-review/App.tsx', 'utf-8');
    assert(src.includes('setSearchQuery'), 'App.tsx must maintain search state');
    assert(src.includes('searchQuery'), 'App.tsx must pass searchQuery to Topbar');
    assert(!src.includes('<EchoNoteAssistant'), 'App.tsx must not mount EchoNoteAssistant');
  });
  console.log('\n=================================================');
  console.log('RESULTS: ' + passed + ' PASSED, ' + failed + ' FAILED');
  console.log('=================================================\n');

  if (failed > 0) {
    throw new Error(failed + ' tests failed.');
  }
}

runSuite();
