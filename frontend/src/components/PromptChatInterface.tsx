import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  MessageSquare, 
  Send, 
  Plus, 
  Bot, 
  User, 
  CheckCircle, 
  Copy,
  Loader2,
  Trash2,
  Edit,
  Sparkles
} from '@/components/icons';
import { preserveMarkdownFormatting } from '@/utils/markdownConverter';
import { extractPromptContent } from '@/utils/promptExtractor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import openaiLogo from '@/assets/openai-logo.svg';
import anthropicLogo from '@/assets/anthropic-logo.svg';
import metaLogo from '@/assets/meta-logo.svg';
import googleLogo from '@/assets/google-logo.svg';
import xaiLogo from '@/assets/xai-logo.svg';

interface ChatThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

interface ChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  message_type: 'text' | 'prompt_generation';
  metadata?: any;
  created_at: string;
}

interface PromptChatInterfaceProps {
  onAcceptPrompt: (prompt: { name: string; content: string }) => void;
  systemPrompt?: string;
  startFreshOnMount?: boolean; // when true, auto-create a new thread on mount
  initialTitle?: string;       // optional title for the new thread
}

const llmOptions = [
  // OpenAI - newest to oldest
  { 
    id: 'openai/gpt-5.2', 
    name: 'GPT-5.2', 
    logo: openaiLogo,
    description: 'Latest advanced model'
  },
  { 
    id: 'openai/gpt-5', 
    name: 'GPT-5', 
    logo: openaiLogo,
    description: 'Most capable flagship model'
  },
  { 
    id: 'openai/gpt-4o', 
    name: 'GPT-4o', 
    logo: openaiLogo,
    description: 'Advanced reasoning and creativity'
  },
  { 
    id: 'openai/gpt-4o-mini', 
    name: 'GPT-4o Mini', 
    logo: openaiLogo,
    description: 'Fast and cost-effective for most tasks'
  },
  // Anthropic - newest to oldest
  { 
    id: 'anthropic/claude-sonnet-4.5', 
    name: 'Claude Sonnet 4.5', 
    logo: anthropicLogo,
    description: 'Latest flagship model with superior understanding'
  },
  { 
    id: 'anthropic/claude-haiku-4.5', 
    name: 'Claude Haiku 4.5', 
    logo: anthropicLogo,
    description: 'Fast and lightweight responses'
  },
  { 
    id: 'anthropic/claude-sonnet-4', 
    name: 'Claude Sonnet 4', 
    logo: anthropicLogo,
    description: 'High-performance reasoning'
  },
  { 
    id: 'anthropic/claude-3.5-sonnet', 
    name: 'Claude 3.5 Sonnet', 
    logo: anthropicLogo,
    description: 'Excellent for writing and analysis'
  },
  // Google - newest to oldest
  { 
    id: 'google/gemini-3-flash-preview', 
    name: 'Gemini 3 Flash', 
    logo: googleLogo,
    description: 'Latest fast multimodal model'
  },
  { 
    id: 'google/gemini-2.5-pro', 
    name: 'Gemini 2.5 Pro', 
    logo: googleLogo,
    description: 'Advanced reasoning and complex tasks'
  },
  { 
    id: 'google/gemini-2.5-flash', 
    name: 'Gemini 2.5 Flash', 
    logo: googleLogo,
    description: 'Fast and efficient multimodal model'
  },
  // xAI
  { 
    id: 'x-ai/grok-4.1-fast', 
    name: 'Grok 4.1 Fast', 
    logo: xaiLogo,
    description: 'Fast reasoning from xAI'
  },
  // Meta
  { 
    id: 'meta-llama/llama-3.3-70b-instruct', 
    name: 'Llama 3.3 70B', 
    logo: metaLogo,
    description: 'Latest open-source model from Meta'
  }
];

export const PromptChatInterface: React.FC<PromptChatInterfaceProps> = ({
  onAcceptPrompt,
  systemPrompt,
  startFreshOnMount,
  initialTitle
}) => {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('preferred-ai-model') || 'anthropic/claude-sonnet-4.5';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [fetchedSystemPrompt, setFetchedSystemPrompt] = useState('');
  // G3-6: presence-only — the OpenRouter key value never reaches the browser.
  const [hasOpenRouterKey, setHasOpenRouterKey] = useState(false);

  // Fetch system prompt and OpenRouter key presence from DB when clientId changes
  useEffect(() => {
    const fetchClientSettings = async () => {
      if (!clientId) return;
      try {
        const { data, error } = await supabase
          .from('clients_public')
          .select('system_prompt, has_openrouter_api_key')
          .eq('id', clientId)
          .maybeSingle();
        if (!error && data) {
          setFetchedSystemPrompt(data.system_prompt || '');
          setHasOpenRouterKey(!!data.has_openrouter_api_key);
        }
      } catch (e) {
        console.error('Error fetching client settings:', e);
      }
    };
    fetchClientSettings();
  }, [clientId]);
  
  // Thread session isolation
  const [threadSessions, setThreadSessions] = useState<Map<string, ChatMessage[]>>(new Map());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  
  // Thread editing state
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preferFreshRef = useRef(!!startFreshOnMount);
  const didFreshRef = useRef(false);

  // Handle model selection with persistence
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('preferred-ai-model', model);
  };

  useEffect(() => {
    if (clientId) {
      // If requested, start with a fresh thread
      if (startFreshOnMount && !didFreshRef.current) {
        didFreshRef.current = true;
        createNewThread(initialTitle);
      }
      fetchThreads();
    }
  }, [clientId]);

  useEffect(() => {
    if (activeThreadId) {
      // Generate session ID for this thread to ensure isolation
      const sessionId = `${clientId}-${activeThreadId}-${Date.now()}`;
      setActiveSessionId(sessionId);
      
      // Load messages for this thread
      fetchMessages(activeThreadId);
    } else {
      setActiveSessionId(null);
      setMessages([]);
    }
  }, [activeThreadId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 196) + 'px';
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [currentMessage]);

  const fetchThreads = async () => {
    if (!clientId) return;
    
    setThreadLoading(true);
    try {
      const { data, error } = await supabase
        .from('prompt_chat_threads')
        .select('*')
        .eq('client_id', clientId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setThreads(data || []);
      
      // If no active thread selected and there are threads, select the first one
      if (!activeThreadId && data && data.length > 0) {
        setActiveThreadId(data[0].id);
      }
    } catch (error: any) {
      console.error('Error fetching chat threads:', error);
      toast({
        title: "Error",
        description: "Failed to fetch chat threads",
        variant: "destructive"
      });
    } finally {
      setThreadLoading(false);
    }
  };

  const fetchMessages = async (threadId: string) => {
    if (!threadId) return;
    
    try {
      // Clear previous messages immediately to prevent cross-thread contamination
      setMessages([]);
      
      const { data, error } = await supabase
        .from('prompt_chat_messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      const threadMessages = (data || []) as ChatMessage[];
      
      // Store in thread sessions for isolation
      setThreadSessions(prev => {
        const newSessions = new Map(prev);
        newSessions.set(threadId, threadMessages);
        return newSessions;
      });
      
      // Only update messages if this is still the active thread
      if (activeThreadId === threadId) {
        setMessages(threadMessages);
      }
    } catch (error: any) {
      console.error('Error fetching messages:', error);
      toast({
        title: "Error",
        description: "Failed to fetch messages",
        variant: "destructive"
      });
    }
  };

  const createNewThread = async (title?: string) => {
    if (!clientId) return;

    try {
      const { data, error } = await supabase
        .from('prompt_chat_threads')
        .insert({
          client_id: clientId,
          title: (title && title.trim()) ? title.trim() : 'New Chat'
        })
        .select()
        .single();

      if (error) throw error;
      
      setThreads(prev => [data, ...prev]);
      setActiveThreadId(data.id);
      setMessages([]);
      
      toast({
        title: "New Chat Created",
        description: "Start a fresh conversation"
      });
    } catch (error: any) {
      console.error('Error creating new thread:', error);
      toast({
        title: "Error",
        description: "Failed to create new chat thread",
        variant: "destructive"
      });
    }
  };

  const updateThreadTitle = async (threadId: string, title: string) => {
    try {
      const { error } = await supabase
        .from('prompt_chat_threads')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', threadId);

      if (error) throw error;
      
      setThreads(prev => prev.map(thread => 
        thread.id === threadId ? { ...thread, title } : thread
      ));
    } catch (error: any) {
      console.error('Error updating thread title:', error);
    }
  };

  const deleteThread = async (threadId: string) => {
    try {
      const { error } = await supabase
        .from('prompt_chat_threads')
        .delete()
        .eq('id', threadId);

      if (error) throw error;
      
      setThreads(prev => prev.filter(thread => thread.id !== threadId));
      
      // Clean up thread session data
      setThreadSessions(prev => {
        const newSessions = new Map(prev);
        newSessions.delete(threadId);
        return newSessions;
      });
      
      if (activeThreadId === threadId) {
        const remainingThreads = threads.filter(t => t.id !== threadId);
        if (remainingThreads.length > 0) {
          setActiveThreadId(remainingThreads[0].id);
        } else {
          setActiveThreadId(null);
          setMessages([]);
          setActiveSessionId(null);
        }
      }
      
      toast({
        title: "Thread Deleted",
        description: "Chat thread has been removed"
      });
    } catch (error: any) {
      console.error('Error deleting thread:', error);
      toast({
        title: "Error",
        description: "Failed to delete chat thread",
        variant: "destructive"
      });
    }
  };

  const sendMessage = async () => {
    if (!currentMessage.trim() || !activeThreadId || isLoading) return;

    // Check if OpenRouter API key is configured
    if (!hasOpenRouterKey) {
      toast({
        title: "API Key Missing",
        description: "OpenRouter API key is not configured. Please add it in API & Integrations settings.",
        variant: "destructive"
      });
      return;
    }

    const userMessage = currentMessage.trim();
    setCurrentMessage('');
    setIsLoading(true);
    
    // Reset textarea height to original size
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      // Save user message
      const { data: userMsgData, error: userMsgError } = await supabase
        .from('prompt_chat_messages')
        .insert({
          thread_id: activeThreadId,
          role: 'user',
          content: userMessage,
          message_type: 'text'
        })
        .select()
        .single();

      if (userMsgError) throw userMsgError;

      // Update messages state with user message only for active thread
      if (activeThreadId === userMsgData.thread_id) {
        setMessages(prev => [...prev, userMsgData as ChatMessage]);
        
        // Update thread session cache
        setThreadSessions(prev => {
          const newSessions = new Map(prev);
          const currentMessages = newSessions.get(activeThreadId) || [];
          newSessions.set(activeThreadId, [...currentMessages, userMsgData as ChatMessage]);
          return newSessions;
        });
      }

      // Update thread title if it's the first message
      const activeThread = threads.find(t => t.id === activeThreadId);
      if (activeThread && activeThread.title === 'New Chat') {
        const shortTitle = userMessage.length > 50 
          ? userMessage.substring(0, 50) + '...' 
          : userMessage;
        await updateThreadTitle(activeThreadId, shortTitle);
      }

      // Get current thread's message history for context
      const currentThreadMessages = threadSessions.get(activeThreadId) || messages;

      // Format chat history for webhook (exclude the current user message since it's in userLastUtterance)
      const chatHistory = currentThreadMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // System-managed AI prompt generation webhook. Set VITE_AI_PROMPT_WEBHOOK_URL
      // in the deployment env. Hardcoded upstream URL removed in N5 2026-05-19 —
      // was sending chat history + openRouterApiKey to a shared upstream n8n.
      const WEBHOOK_URL = import.meta.env.VITE_AI_PROMPT_WEBHOOK_URL as string | undefined;
      if (!WEBHOOK_URL) {
        throw new Error('Modify Setter with AI is not configured for this deployment (VITE_AI_PROMPT_WEBHOOK_URL is unset).');
      }

      // Find readable model name
      const selected = llmOptions.find(m => m.id === selectedModel);

      const acceptanceInstruction = [
        'IMPORTANT: Return ONLY the final optimized prompt wrapped between the exact markers:',
        '<!-- PROMPT_START --> and <!-- PROMPT_END -->.',
        'Place the prompt inside a fenced code block labeled "prompt" like:',
        '```prompt',
        '...final prompt...',
        '```',
        'Do not include greetings or explanations inside the markers. Put any notes after a heading "## Rationale".'
      ].join('\n');

      const messageForLLM = `${userMessage}\n\n${acceptanceInstruction}`;

      const webhookPayload = {
        systemPrompt: fetchedSystemPrompt || '',
        userLastUtterance: messageForLLM,
        editorPrompt: 'No_Prompt',
        llmModel: { id: selectedModel, name: selected?.name || selectedModel },
        action: 'chat',
        promptName: activeThread?.title || 'New Chat',
        threadId: activeThreadId,
        sessionId: activeSessionId,
        chatHistory: chatHistory,
        // G3-6: secret intentionally omitted from the webhook payload.
      };

      const webhookResponse = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload),
      });

      if (!webhookResponse.ok) {
        const errorText = await webhookResponse.text();
        console.error('Webhook error response:', errorText);
        throw new Error(`Webhook request failed: ${webhookResponse.statusText}. ${errorText}`);
      }

      // Get response text first for better error handling
      const responseText = await webhookResponse.text();
      console.log('Webhook response:', responseText);

      let webhookData;
      try {
        webhookData = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse webhook response:', parseError, 'Response:', responseText);
        throw new Error('Invalid response from AI service. Please try again.');
      }

      const generatedContent = webhookData?.content || webhookData?.generatedContent || webhookData?.output || webhookData?.message;

      if (!generatedContent) {
        console.error('No content in webhook response:', webhookData);
        throw new Error(`AI returned empty response. Response structure: ${JSON.stringify(webhookData)}`);
      }

      // Clean up the content
      let cleanedContent = generatedContent
        .replace(/```markdown\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^\s+|\s+$/g, '')
        .trim();

      cleanedContent = preserveMarkdownFormatting(cleanedContent);

      // Save AI response
      const { data: aiMsgData, error: aiMsgError } = await supabase
        .from('prompt_chat_messages')
        .insert({
          thread_id: activeThreadId,
          role: 'assistant',
          content: cleanedContent,
          message_type: 'text',
          metadata: { model: selectedModel }
        })
        .select()
        .single();

      if (aiMsgError) throw aiMsgError;

      // Update messages state only if still on the same thread
      if (activeThreadId === aiMsgData.thread_id) {
        setMessages(prev => [...prev, aiMsgData as ChatMessage]);
        
        // Update thread session cache
        setThreadSessions(prev => {
          const newSessions = new Map(prev);
          const currentMessages = newSessions.get(activeThreadId) || [];
          newSessions.set(activeThreadId, [...currentMessages, aiMsgData as ChatMessage]);
          return newSessions;
        });
      }

      // Update thread's updated_at timestamp
      await supabase
        .from('prompt_chat_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', activeThreadId);

    } catch (error: any) {
      console.error('Error sending message:', error);
      
      let errorMessage = 'An unexpected error occurred';
      if (error instanceof Error) {
        try {
          const errorData = JSON.parse(error.message);
          errorMessage = errorData.userFriendly ? errorData.error : error.message;
        } catch {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: "Message Failed",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast({
        title: "Copied",
        description: "Content copied to clipboard"
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy content",
        variant: "destructive"
      });
    }
  };

  const acceptPrompt = (content: string) => {
    try {
      const result = extractPromptContent(content);
      const cleaned = result.content.trim();
      const isValid = cleaned.length >= 20 || /(you are|act as|system\s*prompt|role\s*:|task\s*:|objective\s*:)/i.test(cleaned);
      if (!isValid) {
        toast({
          title: 'No Prompt Detected',
          description: 'Ask the AI to include the final prompt between <!-- PROMPT_START --> and <!-- PROMPT_END -->.',
          variant: 'destructive'
        });
        return;
      }
      onAcceptPrompt({ name: result.title, content: cleaned });
      toast({ title: 'Prompt Added', description: 'Prompt added to the editor.' });
    } catch (e) {
      // Fallback: minimal cleanup
      const fallback = content
        .replace(/```markdown\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^(Hello|Hi|Hey|Sure|Absolutely|Here(?:'|)s|I(?:'|)ve|Let me|Please)[^\n]*\n/i, '')
        .replace(/\n\s*(If you have|Please let me know|Feel free to).*$/i, '')
        .trim();
      if (!fallback || fallback.length < 20) {
        toast({
          title: 'No Prompt Detected',
          description: 'Could not extract a valid prompt. Please regenerate and try again.',
          variant: 'destructive'
        });
        return;
      }
      const title = fallback.split('\n').map(l=>l.trim()).filter(Boolean)[0]?.replace(/^#+\s*/, '') || 'Generated Prompt';
      onAcceptPrompt({ name: title, content: fallback });
      toast({ title: 'Prompt Added', description: 'Prompt added to the editor.' });
    }
  };
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="h-full min-h-0 overflow-hidden grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className="lg:col-span-1 h-full min-h-0 overflow-hidden">
        <Card className="h-full min-h-0 flex flex-col overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-sm font-medium text-muted-foreground mb-2">Chat Threads</CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              <div className="space-y-2">
                {threadLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : threads.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No chat threads yet</p>
                    <p className="text-xs">Create a new chat to get started</p>
                  </div>
                ) : (
                  threads.map((thread) => (
                    <div
                      key={thread.id}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors group ${
                        activeThreadId === thread.id
                          ? 'bg-primary/10 border-primary'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setActiveThreadId(thread.id)}
                    >
                       <div className="flex items-center gap-2">
                         <div className="flex-1 min-w-0 pr-2">
                           {editingThreadId === thread.id ? (
                             <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                               <Input
                                 value={editingTitle}
                                 onChange={(e) => setEditingTitle(e.target.value)}
                                 onKeyDown={(e) => {
                                   if (e.key === 'Enter') {
                                     updateThreadTitle(thread.id, editingTitle);
                                     setEditingThreadId(null);
                                   } else if (e.key === 'Escape') {
                                     setEditingThreadId(null);
                                   }
                                 }}
                                 onBlur={() => {
                                   updateThreadTitle(thread.id, editingTitle);
                                   setEditingThreadId(null);
                                 }}
                                 className="text-sm flex-1"
                                 autoFocus
                               />
                             </div>
                           ) : (
                             <div
                               onDoubleClick={(e) => {
                                 e.stopPropagation();
                                 setEditingThreadId(thread.id);
                                 setEditingTitle(thread.title);
                               }}
                               className="cursor-text"
                               title="Double-click to edit"
                             >
                               <p className="text-sm font-medium truncate">
                                 {thread.title}
                               </p>
                               <p className="text-xs text-muted-foreground">
                                 {new Date(thread.updated_at).toLocaleDateString()}
                               </p>
                             </div>
                           )}
                         </div>
                         <div className="flex-shrink-0">
                           {editingThreadId !== thread.id && (
                             <Button
                               size="sm"
                               variant="ghost"
                               onClick={(e) => {
                                 e.stopPropagation();
                                 deleteThread(thread.id);
                               }}
                               className="opacity-60 hover:opacity-100 h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                               title="Delete chat"
                             >
                               <Trash2 className="h-4 w-4" />
                             </Button>
                           )}
                         </div>
                       </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-3 h-full min-h-0 overflow-hidden">
        <Card className="h-full min-h-0 flex flex-col overflow-hidden">
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-lg mb-3">AI Prompt Assistant</CardTitle>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 flex-1">
                <Select value={selectedModel} onValueChange={handleModelChange}>
                  <SelectTrigger className="w-auto min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <img 
                        src={llmOptions.find(m => m.id === selectedModel)?.logo} 
                        alt="Model logo" 
                        className="h-4 w-4 flex-shrink-0" 
                      />
                      <span className="font-medium">
                        {llmOptions.find(m => m.id === selectedModel)?.name}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="z-50 bg-popover border shadow-lg">
                    {llmOptions.map((model) => (
                      <SelectItem key={model.id} value={model.id} className="py-3">
                        <div className="flex items-center gap-3 w-full">
                          <img src={model.logo} alt={`${model.name} logo`} className="h-5 w-5 flex-shrink-0" />
                          <div className="flex flex-col items-start min-w-0 flex-1">
                            <span className="font-medium">{model.name}</span>
                            <span className="text-sm text-muted-foreground">{model.description}</span>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => createNewThread()}
                size="sm"
                variant="outline"
                className="flex-shrink-0"
              >
                <Plus className="h-4 w-4 mr-1" />
                New Chat
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0 overflow-hidden flex flex-col">
            {activeThreadId ? (
              <>
                {/* Messages Area */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                  <div className="space-y-4">
                    {messages.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <h3 className="text-lg font-medium mb-2">Start a Conversation</h3>
                        <p className="text-sm">Ask me to generate, modify, or help you refine prompts.</p>
                        <p className="text-xs mt-1">Each chat maintains its own context and memory.</p>
                      </div>
                    ) : (
                      messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex gap-3 ${
                            message.role === 'user' ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          <div
                            className={`flex gap-3 max-w-[80%] ${
                              message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                              message.role === 'user' 
                                ? 'bg-primary text-primary-foreground' 
                                : 'bg-secondary text-secondary-foreground'
                            }`}>
                              {message.role === 'user' ? (
                                <User className="h-4 w-4" />
                              ) : (
                                <Bot className="h-4 w-4" />
                              )}
                            </div>
                            <div
                              className={`rounded-lg p-4 ${
                                message.role === 'user'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted'
                              }`}
                            >
                              <div className="space-y-2">
                                <pre className="whitespace-pre-wrap font-sans" style={{
                                  fontSize: '14px',
                                  lineHeight: '1.75'
                                }}>
                                  {message.content}
                                </pre>
                                {message.role === 'assistant' && (
                                  <div className="flex items-center gap-2 pt-2 border-t border-border/20">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => copyToClipboard(message.content)}
                                      className="h-6 px-2 text-xs"
                                    >
                                      <Copy className="h-3 w-3 mr-1" />
                                      Copy
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => acceptPrompt(message.content)}
                                      className="h-6 px-2 text-xs"
                                    >
                                      <CheckCircle className="h-3 w-3 mr-1" />
                                      Accept Prompt
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                    {isLoading && (
                      <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center flex-shrink-0">
                          <Bot className="h-4 w-4" />
                        </div>
                        <div className="bg-muted rounded-lg p-4">
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-sm text-muted-foreground">Thinking...</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {/* Input Area */}
                <div className="border-t p-4 flex-shrink-0">
                  <div className="flex gap-2 items-center">
                    <Input
                      value={currentMessage}
                      onChange={(e) => setCurrentMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder={
                        !hasOpenRouterKey
                          ? "Configure OpenRouter API key first..."
                          : !activeThreadId
                          ? "Select or create a chat to start messaging..."
                          : "Ask me to generate, modify or improve your prompt..."
                      }
                      disabled={isLoading || !activeThreadId || !hasOpenRouterKey}
                      className="flex-1 !h-8"
                      style={{ fontSize: '13px' }}
                    />
                    <Button
                      onClick={sendMessage}
                      disabled={!currentMessage.trim() || isLoading || !activeThreadId || !hasOpenRouterKey}
                      size="sm"
                      className="shrink-0"
                      title={!hasOpenRouterKey ? 'Configure OpenRouter API key to enable sending' : 'Send message'}
                    >
                      {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Send</>}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center flex-1 text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No Chat Selected</h3>
                  <p className="text-sm">Create a new chat or select an existing one to start</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};