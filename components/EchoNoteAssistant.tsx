import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, X, Send, Minus, Maximize2, Sparkles, Layout, FileText, Brain, CheckSquare, BarChart2, AlertCircle, RefreshCw, HelpCircle, Info, ThumbsUp, ThumbsDown, Check } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import { ProductEventName } from '../types';
import { trackProductEvent, trackDecisionRetrieved } from '../services/productAnalyticsService';

export type AssistantOutcome = 'ANSWERED' | 'INSUFFICIENT_CONTEXT' | 'CLARIFICATION_NEEDED' | 'ACTION_REQUESTED' | 'ACTION_EXECUTED';
export type AssistantIntent = 'summarize' | 'analyze thinking' | 'decisions' | 'add to project' | 'usage / minutes' | 'none';

export interface AssistantApiResponse {
  reply: string;
  intent: AssistantIntent;
  outcome: AssistantOutcome;
  executeAction: boolean;
  missingSources?: string[];
  suggestedNextStep?: string;
  code?: string;
  error?: string;
  retryable?: boolean;
}

interface AssistantContext {
  current_page: string;
  current_project: string;
  selected_file_name: string;
  transcript_text: string;
  summary: string;
  user_plan: string;
  minutes_used: number;
  minutes_remaining: number;
  recordingId?: string;
  projectId?: string;
}

interface AssistantActions {
  summarizeTranscript: () => void;
  runThinkingEngine: () => void;
  extractDecisions: () => void;
  assignToProject: () => void;
}

interface EchoNoteAssistantProps {
  context: AssistantContext;
  actions: AssistantActions;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  text: string;
  timestamp: number;
  outcome?: AssistantOutcome;
  intent?: AssistantIntent;
  missingSources?: string[];
  suggestedNextStep?: string;
  isRetryable?: boolean;
  retryQuery?: string;
}

const EchoNoteAssistant: React.FC<EchoNoteAssistantProps> = ({ context, actions }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { role: 'assistant', text: "Hi! I'm your EchoNote Assistant. How can I help you today?", timestamp: Date.now(), outcome: 'ANSWERED' }
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, 'helpful' | 'unhelpful'>>({});

  const handleFeedback = async (msgIndex: number, rating: 'helpful' | 'unhelpful', assistantMsg: ChatMessage) => {
    if (feedbackGiven[msgIndex]) return;
    setFeedbackGiven(prev => ({ ...prev, [msgIndex]: rating }));

    // Find preceding user question
    let userQuestion = '';
    for (let j = msgIndex - 1; j >= 0; j--) {
      if (chatHistory[j].role === 'user') {
        userQuestion = chatHistory[j].text;
        break;
      }
    }

    try {
      await apiFetch('/api/ai/assistant-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userQuestion || assistantMsg.text,
          responseReply: assistantMsg.text,
          outcome: assistantMsg.outcome,
          rating,
          context
        })
      });
    } catch (fbErr) {
      console.warn('Failed recording feedback:', fbErr);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, isOpen, isTyping]);

  const handleSendMessage = async (e?: React.FormEvent, overrideMessage?: string, isRetry: boolean = false) => {
    if (e) e.preventDefault();
    if (isTyping) return; // Prevent duplicate sends while request is in progress

    const textToSend = (overrideMessage !== undefined ? overrideMessage : message).trim();
    if (!textToSend) return;

    // Only add new user bubble if not retrying an already shown user bubble
    if (!isRetry) {
      const newUserMsg: ChatMessage = { role: 'user', text: textToSend, timestamp: Date.now() };
      setChatHistory(prev => [...prev, newUserMsg]);
      setMessage('');
    }

    setIsTyping(true);

    trackProductEvent({
      eventName: ProductEventName.DECISION_SEARCHED,
      entityType: 'search',
      source: 'ask_echonote',
      metadata: {
        searchQueryLength: textToSend.length
      }
    });

    // Prepare bounded conversation history for multi-turn support (excluding errors)
    const historyPayload = chatHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map(m => ({ role: m.role, text: m.text }));

    try {
      const response = await apiFetch('/api/ai/assistant-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          context,
          conversationHistory: historyPayload
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const sanitizedErrorMsg = errorData.error || (
          response.status === 429
            ? 'The AI assistant is temporarily rate-limited. Please wait a moment and try again.'
            : response.status === 504
              ? 'The AI assistant timed out while processing your request. Please try again.'
              : 'The AI assistant encountered an unexpected error. Please try again later.'
        );
        const retryable = errorData.retryable ?? (response.status === 429 || response.status >= 500);

        setChatHistory(prev => [
          ...prev,
          {
            role: 'error',
            text: sanitizedErrorMsg,
            timestamp: Date.now(),
            isRetryable: retryable,
            retryQuery: textToSend
          }
        ]);
        return;
      }

      const data: AssistantApiResponse = await response.json();
      
      const assistantMsg: ChatMessage = { 
        role: 'assistant', 
        text: data.reply, 
        timestamp: Date.now(),
        outcome: data.outcome || 'ANSWERED',
        intent: data.intent || 'none',
        missingSources: data.missingSources,
        suggestedNextStep: data.suggestedNextStep
      };

      setChatHistory(prev => [...prev, assistantMsg]);

      // Only execute action if executeAction is strictly true and matches an explicit action request
      // (Never run actions on informational questions, absent context, clarification, or fake ACTION_EXECUTED)
      if (data.executeAction === true) {
        if (data.intent === 'summarize') actions.summarizeTranscript();
        if (data.intent === 'analyze thinking') {
          actions.runThinkingEngine();
          trackDecisionRetrieved({
            entityId: context.selected_file_name || 'assistant_retrieval',
            source: 'ask_echonote'
          });
        }
        if (data.intent === 'decisions') {
          actions.extractDecisions();
          trackDecisionRetrieved({
            entityId: context.selected_file_name || 'assistant_retrieval',
            source: 'ask_echonote'
          });
        }
        if (data.intent === 'add to project') actions.assignToProject();
      }

    } catch (error: any) {
      console.error('AI Assistant Error:', error);
      setChatHistory(prev => [
        ...prev,
        { 
          role: 'error', 
          text: 'Unable to reach the assistant service. Please check your connection and try again.', 
          timestamp: Date.now(),
          isRetryable: true,
          retryQuery: textToSend
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleRetry = (queryToRetry?: string) => {
    if (!queryToRetry || isTyping) return;
    // Remove the trailing error message if it matches this retry
    setChatHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'error') {
        return prev.slice(0, -1);
      }
      return prev;
    });
    handleSendMessage(undefined, queryToRetry, true);
  };

  const quickActions = [
    { label: 'Summarize', icon: FileText, action: () => handleSendMessage(undefined, 'Summarize this call') },
    { label: 'Analyze Thinking', icon: Brain, action: () => handleSendMessage(undefined, 'Analyze the thinking in this transcript') },
    { label: 'Extract Decisions', icon: CheckSquare, action: () => handleSendMessage(undefined, 'What decisions were made?') },
    { label: 'Add to Project', icon: Layout, action: () => handleSendMessage(undefined, 'Add this to a project') },
  ];

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              y: 0,
              height: isMinimized ? '64px' : '520px'
            }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="mb-4 w-[380px] bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-brand-divider/20 overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="bg-brand-primary p-4 flex items-center justify-between text-white">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-full bg-brand-accent flex items-center justify-center text-brand-primary">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold">EchoNote Assistant</h3>
                  {!isMinimized && <p className="text-[10px] text-white/60">Action-driven AI Intelligence</p>}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setIsMinimized(!isMinimized)}
                  className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                  title={isMinimized ? "Maximize" : "Minimize"}
                >
                  {isMinimized ? <Maximize2 size={16} /> : <Minus size={16} />}
                </button>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {!isMinimized && (
              <>
                {/* Chat Area */}
                <div 
                  ref={scrollRef}
                  className="flex-1 p-4 overflow-y-auto bg-brand-background space-y-4 scroll-smooth"
                >
                  {/* Quick Actions */}
                  {chatHistory.length === 1 && (
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {quickActions.map((qa, i) => (
                        <button
                          key={i}
                          onClick={qa.action}
                          disabled={isTyping}
                          className="flex items-center space-x-2 p-3 bg-white border border-brand-divider/10 rounded-xl text-[11px] font-medium text-brand-primary hover:bg-brand-accent/10 transition-colors text-left disabled:opacity-50"
                        >
                          <qa.icon size={14} className="text-brand-accent shrink-0" />
                          <span>{qa.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {chatHistory.map((msg, i) => {
                    if (msg.role === 'user') {
                      return (
                        <div key={i} className="flex justify-end">
                          <div className="max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed bg-brand-primary text-white rounded-tr-none shadow-sm">
                            {msg.text}
                            <div className="text-[9px] mt-1 text-white/40">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (msg.role === 'error') {
                      return (
                        <div key={i} className="flex justify-start">
                          <div className="max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed bg-red-50 border border-red-200 text-red-800 rounded-tl-none shadow-sm">
                            <div className="flex items-start space-x-2">
                              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <p className="font-medium text-xs text-red-900">Request Issue</p>
                                <p className="text-xs mt-0.5 text-red-700">{msg.text}</p>
                                {msg.isRetryable && msg.retryQuery && (
                                  <button
                                    onClick={() => handleRetry(msg.retryQuery)}
                                    disabled={isTyping}
                                    className="mt-2 inline-flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-red-300 rounded-lg text-[11px] font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
                                  >
                                    <RefreshCw size={12} className={isTyping ? "animate-spin" : ""} />
                                    <span>Retry Question</span>
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="text-[9px] mt-1 text-red-400 text-right">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // Outcome-specific badge / styling for assistant messages
                    const isInsufficient = msg.outcome === 'INSUFFICIENT_CONTEXT';
                    const isClarification = msg.outcome === 'CLARIFICATION_NEEDED';

                    return (
                      <div key={i} className="flex justify-start">
                        <div className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed bg-white text-brand-primary border rounded-tl-none shadow-sm ${
                          isInsufficient 
                            ? 'border-amber-300 bg-amber-50/30' 
                            : isClarification 
                              ? 'border-sky-300 bg-sky-50/30' 
                              : 'border-brand-divider/10'
                        }`}>
                          {/* Outcome Indicator Tag */}
                          {isInsufficient && (
                            <div className="flex items-center space-x-1 mb-1.5 text-amber-700 text-[11px] font-medium">
                              <Info size={13} className="shrink-0 text-amber-600" />
                              <span>Not in current context</span>
                            </div>
                          )}
                          {isClarification && (
                            <div className="flex items-center space-x-1 mb-1.5 text-sky-700 text-[11px] font-medium">
                              <HelpCircle size={13} className="shrink-0 text-sky-600" />
                              <span>Clarification needed</span>
                            </div>
                          )}

                          <div className="whitespace-pre-wrap">{msg.text}</div>

                          {/* Missing sources or suggested next steps */}
                          {msg.missingSources && msg.missingSources.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-brand-divider/10 text-[11px] text-brand-secondary/80">
                              <span className="font-medium">Missing info:</span> {msg.missingSources.join(', ')}
                            </div>
                          )}
                          {msg.suggestedNextStep && (
                            <div className="mt-1.5 text-[11px] text-brand-primary/90 bg-brand-background/60 p-2 rounded-lg border border-brand-divider/10">
                              <span className="font-medium">Next step:</span> {msg.suggestedNextStep}
                            </div>
                          )}

                          <div className="text-[9px] mt-1.5 text-brand-secondary/40 text-right">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {isTyping && (
                    <div className="flex justify-start">
                      <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-brand-divider/10 shadow-sm">
                        <div className="flex space-x-1">
                          <div className="w-1.5 h-1.5 bg-brand-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 bg-brand-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-1.5 h-1.5 bg-brand-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input Area */}
                <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-brand-divider/10 flex items-center space-x-2">
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Ask me to summarize, analyze..."
                    disabled={isTyping}
                    className="flex-1 bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-brand-primary transition-colors disabled:opacity-60"
                  />
                  <button 
                    type="submit"
                    disabled={!message.trim() || isTyping}
                    className="w-10 h-10 rounded-xl bg-brand-primary text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
          isOpen ? 'bg-white text-brand-primary rotate-90' : 'bg-brand-primary text-white'
        }`}
      >
        {isOpen ? <X size={24} /> : <Sparkles size={24} />}
      </motion.button>
    </div>
  );
};

export default EchoNoteAssistant;
