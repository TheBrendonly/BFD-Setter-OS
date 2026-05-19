import React, { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  MessageSquare, 
  Send, 
  Bot, 
  User, 
  CheckCircle, 
  Copy,
  Loader2,
  Sparkles,
  X,
  Plus,
  ChevronDown,
  Trash2
} from '@/components/icons';
import { preserveMarkdownFormatting } from '@/utils/markdownConverter';
import { extractPromptContent } from '@/utils/promptExtractor';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

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

interface EmbeddedPromptChatProps {
  onAcceptPrompt: (prompt: { name: string; content: string }) => void;
  onClose: () => void;
  systemPrompt?: string;
  currentPromptContent?: string;
  promptTitle?: string;
  disableAutoScroll?: boolean;
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
    description: 'Most capable flagship'
  },
  { 
    id: 'openai/gpt-4o', 
    name: 'GPT-4o', 
    logo: openaiLogo,
    description: 'Advanced reasoning'
  },
  { 
    id: 'openai/gpt-4o-mini', 
    name: 'GPT-4o Mini', 
    logo: openaiLogo,
    description: 'Fast and cost-effective'
  },
  // Anthropic - newest to oldest
  { 
    id: 'anthropic/claude-sonnet-4.5', 
    name: 'Claude Sonnet 4.5', 
    logo: anthropicLogo,
    description: 'Latest flagship model'
  },
  { 
    id: 'anthropic/claude-haiku-4.5', 
    name: 'Claude Haiku 4.5', 
    logo: anthropicLogo,
    description: 'Fast and lightweight'
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
    description: 'Excellent for writing'
  },
  // Google - newest to oldest
  { 
    id: 'google/gemini-3-flash-preview', 
    name: 'Gemini 3 Flash', 
    logo: googleLogo,
    description: 'Latest fast multimodal'
  },
  { 
    id: 'google/gemini-2.5-pro', 
    name: 'Gemini 2.5 Pro', 
    logo: googleLogo,
    description: 'Advanced reasoning'
  },
  { 
    id: 'google/gemini-2.5-flash', 
    name: 'Gemini 2.5 Flash', 
    logo: googleLogo,
    description: 'Fast and efficient'
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
    description: 'Latest open-source'
  }
];

export const EmbeddedPromptChat: React.FC<EmbeddedPromptChatProps> = ({
  onAcceptPrompt,
  onClose,
  systemPrompt,
  currentPromptContent,
  promptTitle,
  disableAutoScroll = false
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
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [hasLLMConfig, setHasLLMConfig] = useState(false);
  const [hasSupabaseConfig, setHasSupabaseConfig] = useState(false);
  
  // Fetch system prompt and OpenRouter API key from DB when clientId changes
  useEffect(() => {
    const fetchClientSettings = async () => {
      if (!clientId) return;
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('system_prompt, openrouter_api_key, openai_api_key, supabase_url, supabase_service_key')
          .eq('id', clientId)
          .maybeSingle();
        if (!error && data) {
          setFetchedSystemPrompt(data.system_prompt || '');
          setOpenRouterApiKey(data.openrouter_api_key || '');
          
          // Check LLM configuration
          const hasLLM = !!(data.openrouter_api_key || data.openai_api_key);
          setHasLLMConfig(hasLLM);
          
          // Check Supabase configuration
          const hasSupabase = !!(data.supabase_url && data.supabase_service_key);
          setHasSupabaseConfig(hasSupabase);
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

  // Handle model selection with persistence
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    localStorage.setItem('preferred-ai-model', model);
  };

  useEffect(() => {
    if (clientId) {
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
  if (!disableAutoScroll) {
    scrollToBottom();
  }
}, [messages, disableAutoScroll]);

const scrollToBottom = () => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    }
  };

  const createNewThread = async () => {
    if (!clientId) return;

    try {
      const { data, error } = await supabase
        .from('prompt_chat_threads')
        .insert({
          client_id: clientId,
          title: 'New Chat'
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

  const switchThread = async (threadId: string) => {
    setActiveThreadId(threadId);
    await fetchMessages(threadId);
  };

  const sendMessage = async () => {
    if (!currentMessage.trim() || !activeThreadId || isLoading) return;

    // Check if OpenRouter API key is configured
    if (!openRouterApiKey) {
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
      // Save user message to database
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
        // Generate a meaningful title from the first user message
        const cleanText = userMessage.trim();
        const words = cleanText.split(' ').slice(0, 4); // Take first 4 words
        const smartTitle = words.length > 0 
          ? words.join(' ').substring(0, 30) + (cleanText.length > 30 ? '...' : '')
          : 'New Conversation';
        await updateThreadTitle(activeThreadId, smartTitle);
      }

      // Get current thread's message history for context
      const currentThreadMessages = threadSessions.get(activeThreadId) || messages;

      // Format chat history for webhook (exclude the current user message since it's in userLastUtterance)
      const chatHistory = currentThreadMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // System-managed AI prompt generation webhook. Set VITE_AI_PROMPT_WEBHOOK_URL
      // in the deployment env. Hardcoded upstream URL removed in N5 2026-05-19.
      const WEBHOOK_URL = import.meta.env.VITE_AI_PROMPT_WEBHOOK_URL as string | undefined;
      if (!WEBHOOK_URL) {
        throw new Error('AI prompt generation is not configured for this deployment (VITE_AI_PROMPT_WEBHOOK_URL is unset).');
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
        editorPrompt: currentPromptContent || 'No_Prompt',
        llmModel: { id: selectedModel, name: selected?.name || selectedModel },
        action: 'chat',
        promptName: promptTitle || 'New Chat',
        threadId: activeThreadId,
        sessionId: activeSessionId,
        chatHistory: chatHistory,
        openRouterApiKey: openRouterApiKey
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

      // Save AI response to database
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
      onClose();
    } catch (e) {
      toast({
        title: 'No Prompt Detected',
        description: 'Could not extract a valid prompt. Please regenerate and try again.',
        variant: 'destructive'
      });
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="border rounded-lg bg-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1">
          {threads.length > 0 && (
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 text-sm max-w-[200px]">
                    <span className="truncate">
                      {threads.find(t => t.id === activeThreadId)?.title || 'Select Thread'}
                    </span>
                    <ChevronDown className="h-3 w-3 ml-1 flex-shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64 max-h-[60vh] overflow-y-auto overflow-x-hidden bg-popover border shadow-lg z-[100]">
                  {threads.map((thread) => (
                    <DropdownMenuItem
                      key={thread.id}
                      onClick={() => switchThread(thread.id)}
                      className="flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="truncate flex-1">{thread.title}</span>
                      {thread.id === activeThreadId && (
                        <CheckCircle className="h-3 w-3 flex-shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => createNewThread()}
                className="h-auto px-2 py-1"
                title="Create New Chat"
                disabled={!hasLLMConfig || !hasSupabaseConfig}
              >
                <Plus className="h-3 w-3 mr-1" />
                <span className="text-sm">New Chat</span>
              </Button>
            </div>
          )}
          {threads.length === 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => createNewThread()}
              className="h-8"
              disabled={!hasLLMConfig || !hasSupabaseConfig}
            >
              <Plus className="h-4 w-4 mr-1" />
              New Chat
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedModel} onValueChange={handleModelChange}>
            <SelectTrigger className="w-48 h-8">
              <div className="flex items-center gap-2 overflow-hidden">
                <img 
                  src={llmOptions.find(m => m.id === selectedModel)?.logo} 
                  alt="Model logo" 
                  className="h-3 w-3 flex-shrink-0" 
                />
                <span className="text-sm truncate">
                  {llmOptions.find(m => m.id === selectedModel)?.name}
                </span>
              </div>
            </SelectTrigger>
            <SelectContent className="z-50 bg-popover border shadow-lg">
              {llmOptions.map((model) => (
                <SelectItem key={model.id} value={model.id} className="py-2">
                  <div className="flex items-center gap-2 w-full">
                    <img src={model.logo} alt={`${model.name} logo`} className="h-4 w-4 flex-shrink-0" />
                    <div className="flex flex-col items-start min-w-0 flex-1">
                      <span className="text-sm font-medium">{model.name}</span>
                      <span className="text-xs text-muted-foreground">{model.description}</span>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="h-[50vh] sm:h-[55vh] lg:h-[65vh] border rounded-md p-3">
        <div className="space-y-3">
          {!activeThreadId ? (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm mb-2">Welcome to AI Prompt Assistant</p>
              <Button
                onClick={() => createNewThread()}
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={!hasLLMConfig || !hasSupabaseConfig}
              >
                <Plus className="h-3 w-3 mr-1" />
                Start New Chat
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Start chatting to generate or refine your prompt</p>

              <p className="text-xs mt-1">Ask me to create, modify, or improve prompts</p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-2 ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`flex gap-2 max-w-[85%] ${
                    message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                    message.role === 'user' 
                      ? 'bg-primary text-primary-foreground' 
                      : 'bg-secondary text-secondary-foreground'
                  }`}>
                    {message.role === 'user' ? (
                      <User className="h-3 w-3" />
                    ) : (
                      <Bot className="h-3 w-3" />
                    )}
                  </div>
                  <div
                    className={`rounded-lg p-3 ${
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
                        <div className="flex items-center gap-1 pt-1 border-t border-border/20">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => copyToClipboard(message.content)}
                            className="h-5 px-1 text-xs"
                          >
                            <Copy className="h-2 w-2 mr-1" />
                            Copy
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => acceptPrompt(message.content)}
                            className="h-5 px-1 text-xs"
                          >
                            <CheckCircle className="h-2 w-2 mr-1" />
                            Accept
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
            <div className="flex gap-2 justify-start">
              <div className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center flex-shrink-0">
                <Bot className="h-3 w-3" />
              </div>
              <div className="bg-muted rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-xs text-muted-foreground">Thinking...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input Area */}
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
            !hasLLMConfig || !hasSupabaseConfig
              ? "Configure LLM and Supabase settings first..."
              : !activeThreadId 
              ? "Create a new chat to start messaging..." 
              : "Ask me to generate, modify or improve your prompt..."
          }
          disabled={isLoading || !activeThreadId || !hasLLMConfig || !hasSupabaseConfig}
          className="flex-1 !h-8"
          style={{ fontSize: '13px' }}
        />
        <Button
          onClick={sendMessage}
          disabled={!currentMessage.trim() || isLoading || !activeThreadId || !hasLLMConfig || !hasSupabaseConfig}
          size="sm"
          className="shrink-0"
        >
          {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending...</> : <><Send className="h-4 w-4 mr-2" />Send</>}
        </Button>
      </div>
    </div>
  );
};