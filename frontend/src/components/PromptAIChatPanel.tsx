import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Send, Sparkles } from '@/components/icons';
import { supabase } from '@/integrations/supabase/client';
import type { ChatMessage } from '@/hooks/usePromptChatHistory';

const LOADING_PHRASES = [
  'Analyzing prompt structure...',
  'Evaluating tone consistency...',
  'Reviewing section boundaries...',
  'Matching behavioral patterns...',
  'Optimizing conversation flow...',
  'Checking identity rules...',
  'Refining response patterns...',
  'Aligning with personality...',
  'Finalizing modifications...',
];

const LoadingIndicator: React.FC = () => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex(prev => (prev + 1) % LOADING_PHRASES.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="flex justify-start">
      <div className="px-3 py-2 groove-border bg-card" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' }}>
        <span className="animate-pulse" key={phraseIndex}>{LOADING_PHRASES[phraseIndex]}</span>
      </div>
    </div>
  );
};

interface PromptAIChatPanelProps {
  currentPrompt: string;
  sectionOrder: string[];
  clientId: string;
  onAIGenerating: () => void;
  onAIResult: (newPrompt: string, userRequest: string) => void;
  onAIError: (error: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  messages: ChatMessage[];
  onAddMessage: (msg: ChatMessage) => Promise<void>;
}

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };

export const PromptAIChatPanel: React.FC<PromptAIChatPanelProps> = ({
  currentPrompt,
  sectionOrder,
  clientId,
  onAIGenerating,
  onAIResult,
  onAIError,
  disabled = false,
  isLoading = false,
  messages,
  onAddMessage,
}) => {
  const [input, setInput] = useState('');
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    await onAddMessage(userMsg);
    setInput('');
    if (chatTextareaRef.current) { chatTextareaRef.current.rows = 1; chatTextareaRef.current.style.height = '32px'; chatTextareaRef.current.style.lineHeight = '26px'; chatTextareaRef.current.style.paddingTop = '0px'; chatTextareaRef.current.style.paddingBottom = '0px'; }
    onAIGenerating();

    // Only send last 10 messages of conversation history to keep payload small
    const recentHistory = messages.slice(-10);

    const MAX_RETRIES = 2;
    let lastError: string = '';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { data: jobData, error } = await supabase.functions.invoke('modify-prompt-ai', {
          body: {
            fullPrompt: currentPrompt,
            userMessage: trimmed,
            conversationHistory: recentHistory,
            clientId,
            sectionOrder,
          },
        });

        if (error) {
          let errorMessage = error.message || String(error);
          const ctx = (error as { context?: Response | undefined }).context;
          if (ctx && typeof ctx.json === 'function') {
            try {
              const body: unknown = await ctx.json();
              if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
                errorMessage = (body as { error: string }).error;
              }
            } catch { /* body unreadable, keep generic message */ }
          }
          if (errorMessage.includes('Failed to send a request') || errorMessage.includes('Failed to fetch')) {
            lastError = `Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}): Could not reach the AI service.`;
            if (attempt < MAX_RETRIES) {
              console.warn(`Retry ${attempt + 1}/${MAX_RETRIES} for modify-prompt-ai...`);
              await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
              continue;
            }
            throw new Error(lastError);
          }
          throw new Error(errorMessage);
        }

        if (jobData?.error) {
          const errMsg = `AI Error: ${jobData.error}`;
          await onAddMessage({ role: 'assistant', content: errMsg });
          onAIError(errMsg);
          return;
        }

        const jobId = jobData?.job_id;
        if (!jobId) throw new Error('No job_id returned');

        // Poll for result every 3 seconds
        const jobResult = await new Promise<any>((resolve, reject) => {
          const startTime = Date.now();
          const intervalId = setInterval(async () => {
            try {
              const { data } = await (supabase as any)
                .from('ai_generation_jobs')
                .select('status, result, error_message')
                .eq('id', jobId)
                .single();

              if (data?.status === 'completed') {
                clearInterval(intervalId);
                resolve(data.result);
              } else if (data?.status === 'failed') {
                clearInterval(intervalId);
                reject(new Error(data.error_message || 'AI generation failed'));
              }
            } catch (pollErr) {
              console.error('Polling error:', pollErr);
            }

            if (Date.now() - startTime > 300000) {
              clearInterval(intervalId);
              reject(new Error('AI generation timed out after 5 minutes.'));
            }
          }, 3000);
        });

        const modifiedPrompt = jobResult?.modifiedPrompt;
        if (!modifiedPrompt) {
          const errMsg = 'The AI returned an empty response. This can happen when the prompt is very large. Please try a simpler request.';
          await onAddMessage({ role: 'assistant', content: errMsg });
          onAIError(errMsg);
          return;
        }

        const summary = jobResult?.summary || 'Prompt has been modified. Review the changes below.';

        await onAddMessage({ role: 'assistant', content: summary });
        onAIResult(modifiedPrompt, trimmed.length > 50 ? trimmed.slice(0, 47) + '...' : trimmed);
        return;

      } catch (err: any) {
        console.error(`AI modify error (attempt ${attempt + 1}):`, err);
        
        if (attempt < MAX_RETRIES && (err.message?.includes('Network') || err.message?.includes('fetch'))) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        
        let errMsg: string;
        const msg = err.message || '';
        
        if (msg.includes('Network') || msg.includes('fetch') || msg.includes('Failed to send')) {
          errMsg = '⚠️ Network error: Could not connect to the AI service after multiple attempts. Please check your internet connection and try again.';
        } else if (msg.includes('401') || msg.includes('Invalid OpenRouter')) {
          errMsg = '🔑 Authentication error: Your OpenRouter API key appears to be invalid. Please check it in API Credentials.';
        } else if (msg.includes('402') || msg.includes('Insufficient')) {
          errMsg = '💳 Insufficient credits: Your OpenRouter account needs more credits. Please top up at openrouter.ai.';
        } else if (msg.includes('429') || msg.includes('Rate limit')) {
          errMsg = '⏱️ Rate limited: Too many requests. Please wait a moment and try again.';
        } else if (msg.includes('timeout') || msg.includes('Timeout')) {
          errMsg = '⏳ Request timed out: The AI took too long to respond. Try a shorter or simpler modification request.';
        } else {
          errMsg = `❌ Error: ${msg || 'Unknown error occurred'}. Please try again.`;
        }
        
        await onAddMessage({ role: 'assistant', content: errMsg });
        onAIError(errMsg);
        return;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ minWidth: '320px' }}>
      {/* Column Header */}
      <div
        className="flex items-center px-5 shrink-0 bg-background"
        style={{
          borderBottom: '3px groove hsl(var(--border-groove))',
          height: '40px',
        }}
      >
        <span className="text-foreground font-medium tracking-wide" style={FONT}>
          AI Assistant
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 bg-card">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="max-w-[280px] mx-auto text-center">
              <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <h3 className="font-medium mb-4 text-foreground" style={{ fontFamily: "'VT323', monospace", fontSize: '28px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ask Me Anything</h3>
            <div className="flex flex-col gap-2">
              {[
                'Make the tone more casual throughout',
                'Add stronger objection handling',
                'Remove the banned phrases section',
              ].map((suggestion, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setInput(suggestion)}
                  className="w-full text-left px-3 py-2 groove-border bg-card hover:bg-accent transition-colors text-foreground"
                  style={FONT}
                >
                  {suggestion}
                </button>
              ))}
            </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[85%] px-3 py-2 groove-border ${
                msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card'
              }`}
              style={{ ...FONT, lineHeight: '1.5' }}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && <LoadingIndicator />}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 bg-card" style={{ padding: '24px', paddingTop: '0px' }}>
        <div className="flex gap-2 items-end pt-2">
          <textarea
            ref={chatTextareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe changes..."
            disabled={disabled || isLoading}
            rows={1}
            onFocus={(e) => { e.currentTarget.rows = 4; e.currentTarget.style.height = 'auto'; e.currentTarget.style.lineHeight = '1.5'; e.currentTarget.style.paddingTop = '8px'; e.currentTarget.style.paddingBottom = '8px'; }}
            onBlur={(e) => { if (!e.currentTarget.value.trim()) { e.currentTarget.rows = 1; e.currentTarget.style.height = '32px'; e.currentTarget.style.lineHeight = '26px'; e.currentTarget.style.paddingTop = '0px'; e.currentTarget.style.paddingBottom = '0px'; } }}
            className="flex-1 field-text w-full bg-card px-3 text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus:ring-0 focus:shadow-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 groove-border resize-none transition-all duration-200"
            style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', letterSpacing: '0.3px', height: '32px', lineHeight: '26px', paddingTop: '0px', paddingBottom: '0px' }}
          />
          <Button
            type="button"
            size="icon"
            variant="default"
            onClick={handleSend}
            disabled={disabled || isLoading || !input.trim()}
            className="h-8 w-8 shrink-0 groove-btn-white"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
