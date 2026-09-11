
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, X, Send, Minus, Maximize2, Sparkles, Layout, FileText, Brain, CheckSquare, BarChart2 } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { ProductEventName } from '../types';
import { trackProductEvent, trackDecisionRetrieved } from '../services/productAnalyticsService';

interface AssistantContext {
  current_page: string;
  current_project: string;
  selected_file_name: string;
  transcript_text: string;
  summary: string;
  user_plan: string;
  minutes_used: number;
  minutes_remaining: number;
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

const EchoNoteAssistant: React.FC<EchoNoteAssistantProps> = ({ context, actions }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'assistant', text: string, timestamp: number}[]>([
    { role: 'assistant', text: 'Hi! I\'m your EchoNote Assistant. How can I help you today?', timestamp: Date.now() }
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, isOpen, isTyping]);

  const handleSendMessage = async (e?: React.FormEvent, overrideMessage?: string) => {
    if (e) e.preventDefault();
    const textToSend = overrideMessage || message;
    if (!textToSend.trim()) return;

    const newUserMsg = { role: 'user' as const, text: textToSend, timestamp: Date.now() };
    setChatHistory(prev => [...prev, newUserMsg]);
    setMessage('');
    setIsTyping(true);

    trackProductEvent({
      eventName: ProductEventName.DECISION_SEARCHED,
      entityType: 'search',
      source: 'ask_echonote',
      metadata: {
        searchQueryLength: textToSend.trim().length
      }
    });

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3-flash-preview";
      
      const systemInstruction = `You are EchoNote Assistant, an AI embedded inside an audio intelligence platform.
Your role is NOT just to answer questions, but to help users take actions on their audio data.
You have access to:
* transcripts
* summaries
* projects
* user usage data

Current Context:
- Page: ${context.current_page}
- Project: ${context.current_project}
- Selected File: ${context.selected_file_name}
- User Plan: ${context.user_plan}
- Minutes Used: ${context.minutes_used}
- Minutes Remaining: ${context.minutes_remaining}

You must:
1. Understand user intent
2. If the request is actionable → suggest or trigger an action
3. If unclear → ask a clarifying question
4. Keep responses short, clear, and actionable (2-5 lines)

You can perform:
* Summarization
* Thinking analysis
* Decision extraction
* Project assignment
* Usage explanation

Always prioritize helping the user move forward, not just explaining things.

If you detect an intent, specify it in the JSON response.
Intents: "summarize", "analyze thinking", "decisions", "add to project", "usage / minutes".`;

      const response = await ai.models.generateContent({
        model,
        contents: [
          { role: 'user', parts: [{ text: textToSend }] }
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              intent: { type: Type.STRING, enum: ["summarize", "analyze thinking", "decisions", "add to project", "usage / minutes", "none"] }
            },
            required: ["reply", "intent"]
          }
        }
      });

      const data = JSON.parse(response.text);
      
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        text: data.reply, 
        timestamp: Date.now() 
      }]);

      // Execute actions based on intent
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
      if (data.intent === 'usage / minutes') {
        // Handled by reply
      }

    } catch (error) {
      console.error('AI Assistant Error:', error);
      setChatHistory(prev => [...prev, { 
        role: 'assistant', 
        text: "I can help with transcripts, summaries, decisions, and projects. Try asking: 'Summarize this call' or 'What decisions were made?'", 
        timestamp: Date.now() 
      }]);
    } finally {
      setIsTyping(false);
    }
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
              height: isMinimized ? '64px' : '500px'
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
                >
                  {isMinimized ? <Maximize2 size={16} /> : <Minus size={16} />}
                </button>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="p-1 hover:bg-white/10 rounded-lg transition-colors"
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
                          className="flex items-center space-x-2 p-3 bg-white border border-brand-divider/10 rounded-xl text-[11px] font-medium text-brand-primary hover:bg-brand-accent/10 transition-colors text-left"
                        >
                          <qa.icon size={14} className="text-brand-accent shrink-0" />
                          <span>{qa.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {chatHistory.map((msg, i) => (
                    <div 
                      key={i} 
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${
                        msg.role === 'user' 
                          ? 'bg-brand-primary text-white rounded-tr-none' 
                          : 'bg-white text-brand-primary border border-brand-divider/10 rounded-tl-none shadow-sm'
                      }`}>
                        {msg.text}
                        <div className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-white/40' : 'text-brand-secondary/40'}`}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
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
                    className="flex-1 bg-brand-background border border-brand-divider/20 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-brand-primary transition-colors"
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
