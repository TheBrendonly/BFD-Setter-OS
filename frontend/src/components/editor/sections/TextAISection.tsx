import { PageSection } from '@/types/editor';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import IPhoneMockup from '@/components/IPhoneMockup';
import WhatsAppChat from '@/components/WhatsAppChat';
import InstagramChat from '@/components/InstagramChat';
import MessengerChat from '@/components/MessengerChat';
import SMSChat from '@/components/SMSChat';

interface FormUserData {
  name: string;
  email: string;
  phone: string;
}

interface SectionProps {
  section: PageSection;
  isSelected: boolean;
  isEditor: boolean;
  onSelect: () => void;
  onUpdateProperty: (key: string, value: any) => void;
  clientId?: string;
  formUserData?: FormUserData | null;
}

interface Message {
  id: number;
  type: 'user' | 'bot';
  text: string;
  timestamp: Date;
}

const BATCH_DELAY_MS = 10000; // 10 seconds

export default function TextAISection({ section, isEditor, onUpdateProperty, clientId, formUserData }: SectionProps) {
  const props = section.properties;
  const { toast } = useToast();

  // Master state object
  const [textConfig, setTextConfig] = useState({
    title: props.heading || 'Test Your Text AI Sales Rep',
    subtitle: props.subheading || 'Have a conversation with your AI agent through your preferred messaging platform',
    companyName: props.companyName || 'AI Support',
    statusText: props.statusText || 'Online',
    initialMessage: props.initialMessage || 'How can I help you today?',
    webhookUrl: props.webhookUrl || '',
    platforms: {
      whatsapp: props.enabledPlatforms?.includes('whatsapp') ?? true,
      instagram: props.enabledPlatforms?.includes('instagram') ?? false,
      messenger: props.enabledPlatforms?.includes('messenger') ?? false,
      imessage: props.enabledPlatforms?.includes('imessage') ?? false,
    }
  });

  // Sync props with local state when props change (for public view loading)
  useEffect(() => {
    setTextConfig(prev => ({
      ...prev,
      title: props.heading || prev.title,
      subtitle: props.subheading || prev.subtitle,
      companyName: props.companyName || prev.companyName,
      statusText: props.statusText || prev.statusText,
      initialMessage: props.initialMessage || prev.initialMessage,
      webhookUrl: props.webhookUrl || prev.webhookUrl,
      platforms: {
        whatsapp: props.enabledPlatforms?.includes('whatsapp') ?? prev.platforms.whatsapp,
        instagram: props.enabledPlatforms?.includes('instagram') ?? prev.platforms.instagram,
        messenger: props.enabledPlatforms?.includes('messenger') ?? prev.platforms.messenger,
        imessage: props.enabledPlatforms?.includes('imessage') ?? prev.platforms.imessage,
      }
    }));
  }, [props.heading, props.subheading, props.companyName, props.statusText, props.initialMessage, props.webhookUrl, props.enabledPlatforms]);

  const [activePlatform, setActivePlatform] = useState('whatsapp');
  
  // Generate personalized initial message if coming from form submission
  const getInitialMessage = () => {
    if (formUserData?.name) {
      const firstName = formUserData.name.split(' ')[0];
      return `Hey ${firstName}, it's Gary from Building Flow, just saw your booking and have a few questions. Can we chat here?`;
    }
    return textConfig.initialMessage;
  };
  
  const [messages, setMessages] = useState<Message[]>([{
    id: 1,
    type: 'bot',
    text: getInitialMessage(),
    timestamp: new Date()
  }]);
  
  // Update messages when formUserData changes (user submitted form)
  useEffect(() => {
    if (formUserData?.name) {
      const firstName = formUserData.name.split(' ')[0];
      const personalizedMessage = `Hey ${firstName}, it's Gary from Building Flow, just saw your booking and have a few questions. Can we chat here?`;
      setMessages([{
        id: Date.now(),
        type: 'bot',
        text: personalizedMessage,
        timestamp: new Date()
      }]);
    }
  }, [formUserData]);
  
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [clientLogo, setClientLogo] = useState<string | null>(null);
  const [batchCountdown, setBatchCountdown] = useState<number | null>(null);

  // Refs for batching messages
  const pendingMessagesRef = useRef<string[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textConfigRef = useRef(textConfig);
  const formUserDataRef = useRef(formUserData);
  
  // Keep refs in sync
  useEffect(() => {
    formUserDataRef.current = formUserData;
  }, [formUserData]);

  // Keep textConfigRef in sync
  useEffect(() => {
    textConfigRef.current = textConfig;
  }, [textConfig]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (clientId) {
      const fetchClientDetails = async () => {
        try {
          const { data } = await supabase
            .from('clients')
            .select('image_url')
            .eq('id', clientId)
            .single();
          if (data) setClientLogo(data.image_url);
        } catch (error) {
          console.error('Error fetching client:', error);
        }
      };
      fetchClientDetails();
    }
  }, [clientId]);

  // Ref to track messages for payload (to ensure we have latest state)
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Function to send batched messages to webhook
  const sendBatchedMessages = useCallback(async () => {
    const messagesToSend = pendingMessagesRef.current;
    if (messagesToSend.length === 0) return;

    // Combine all pending messages into single payload
    const combinedMessage = messagesToSend.join('\n');
    pendingMessagesRef.current = [];
    setBatchCountdown(null);

    // Clear countdown interval
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    setIsSending(true);

    // Get current messages for conversation history - use ref to get latest state
    const currentMessages = messagesRef.current;
    const conversationHistory = currentMessages.map(msg => ({
      role: msg.type === 'bot' ? 'assistant' : 'user',
      content: msg.text
    }));

    try {
      if (textConfigRef.current.webhookUrl) {
        // Build data object
        const webhookData = {
          userMessage: combinedMessage,
          userID: formUserDataRef.current?.phone || textConfigRef.current.companyName.replace(/\s+/g, '_').toLowerCase(),
          userFullName: formUserDataRef.current?.name || textConfigRef.current.companyName,
          userEmail: formUserDataRef.current?.email || '',
          userPhone: formUserDataRef.current?.phone || '',
          conversationHistory: conversationHistory,
        };
        
        // Send both formats - flat AND nested in payload
        const response = await fetch(textConfigRef.current.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            payload: webhookData,
            ...webhookData
          })
        });

        const data = await response.json();
        const responseData = Array.isArray(data) ? data[0] : data;
        
        const messageKeys = Object.keys(responseData || {})
          .filter(key => key.startsWith('Message_'))
          .sort();
        
        if (messageKeys.length > 0) {
          for (let i = 0; i < messageKeys.length; i++) {
            const messageText = responseData[messageKeys[i]];
            if (messageText) {
              await new Promise(resolve => setTimeout(resolve, i * 800));
              
              const aiMessage: Message = {
                id: Date.now() + i + 1,
                type: 'bot',
                text: messageText,
                timestamp: new Date()
              };
              setMessages(prev => [...prev, aiMessage]);
            }
          }
        } else {
          const aiResponse = responseData?.output || responseData?.response || 'Thank you for your message!';
          const aiMessage: Message = {
            id: Date.now() + 1,
            type: 'bot',
            text: aiResponse,
            timestamp: new Date()
          };
          setMessages(prev => [...prev, aiMessage]);
        }
      } else {
        setTimeout(() => {
          const aiMessage: Message = {
            id: Date.now() + 1,
            type: 'bot',
            text: 'Configure webhook URL to get AI responses',
            timestamp: new Date()
          };
          setMessages(prev => [...prev, aiMessage]);
        }, 500);
      }
    } catch (error) {
      console.error('Webhook error:', error);
      const errorMessage: Message = {
        id: Date.now() + 1,
        type: 'bot',
        text: 'Sorry, I encountered an error.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  }, []);

  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;
    
    const userMessage = inputValue.trim();
    setInputValue('');

    // Add user message to chat immediately
    const newUserMessage: Message = {
      id: Date.now(),
      type: 'user',
      text: userMessage,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newUserMessage]);

    // Add to pending messages batch
    pendingMessagesRef.current.push(userMessage);

    // If this is the first message in batch, start the timer
    if (!batchTimerRef.current) {
      // Start countdown
      setBatchCountdown(10);
      countdownIntervalRef.current = setInterval(() => {
        setBatchCountdown(prev => {
          if (prev === null || prev <= 1) return null;
          return prev - 1;
        });
      }, 1000);

      // Set timer to send after 10 seconds
      batchTimerRef.current = setTimeout(() => {
        batchTimerRef.current = null;
        sendBatchedMessages();
      }, BATCH_DELAY_MS);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleResetConversation = () => {
    // Clear any pending batch
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    pendingMessagesRef.current = [];
    setBatchCountdown(null);
    
    setMessages([{
      id: Date.now(),
      type: 'bot',
      text: textConfig.initialMessage,
      timestamp: new Date()
    }]);
  };

  const enabledPlatforms = Object.entries(textConfig.platforms)
    .filter(([_, enabled]) => enabled)
    .map(([key]) => ({
      key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      emoji: key === 'whatsapp' ? '💬' : key === 'instagram' ? '📷' : key === 'messenger' ? '💬' : '💬'
    }));

  const handlePlatformToggle = (platform: string, enabled: boolean) => {
    const newPlatforms = { ...textConfig.platforms, [platform]: enabled };
    setTextConfig({ ...textConfig, platforms: newPlatforms });
    
    const enabledList = Object.entries(newPlatforms)
      .filter(([_, e]) => e)
      .map(([k]) => k);
    onUpdateProperty('enabledPlatforms', enabledList);
  };

  if (!isEditor) {
    // Public view - show only the preview
    return (
      <div className="w-full min-h-screen p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold mb-2">{textConfig.title}</h2>
            <p className="text-lg text-muted-foreground">{textConfig.subtitle}</p>
          </div>

          <div className="flex justify-center mb-8">
            <IPhoneMockup>
              {activePlatform === 'instagram' ? (
                <InstagramChat
                  messages={messages}
                  inputValue={inputValue}
                  setInputValue={setInputValue}
                  onSend={handleSend}
                  onKeyPress={handleKeyPress}
                  isSending={isSending}
                  companyName={textConfig.companyName}
                  statusText={textConfig.statusText}
                  clientLogo={clientLogo}
                  onReset={handleResetConversation}
                />
              ) : activePlatform === 'messenger' ? (
                <MessengerChat
                  messages={messages}
                  inputValue={inputValue}
                  setInputValue={setInputValue}
                  onSend={handleSend}
                  onKeyPress={handleKeyPress}
                  isSending={isSending}
                  companyName={textConfig.companyName}
                  statusText={textConfig.statusText}
                  clientLogo={clientLogo}
                  onReset={handleResetConversation}
                />
              ) : activePlatform === 'imessage' ? (
                <SMSChat
                  messages={messages}
                  inputValue={inputValue}
                  setInputValue={setInputValue}
                  onSend={handleSend}
                  onKeyPress={handleKeyPress}
                  isSending={isSending}
                  companyName={textConfig.companyName}
                  statusText={textConfig.statusText}
                  clientLogo={clientLogo}
                  onReset={handleResetConversation}
                />
              ) : (
                <WhatsAppChat
                  messages={messages}
                  inputValue={inputValue}
                  setInputValue={setInputValue}
                  onSend={handleSend}
                  onKeyPress={handleKeyPress}
                  isSending={isSending}
                  companyName={textConfig.companyName}
                  statusText={textConfig.statusText}
                  clientLogo={clientLogo}
                  onReset={handleResetConversation}
                />
              )}
            </IPhoneMockup>
          </div>

          {/* Batch countdown indicator */}
          {batchCountdown !== null && (
            <div className="flex justify-center mb-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-muted-foreground">
                  Sending in <span className="font-semibold text-primary">{batchCountdown}s</span> — keep typing to add more
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-center gap-3 flex-wrap">
            {enabledPlatforms.map(platform => (
              <button
                key={platform.key}
                onClick={() => setActivePlatform(platform.key)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all"
                style={{
                  border: activePlatform === platform.key ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
                  backgroundColor: activePlatform === platform.key ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--background))',
                  color: activePlatform === platform.key ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                }}
              >
                <span className="text-lg">{platform.emoji}</span>
                <span>{platform.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Editor view
  return (
    <div className="w-full min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Text AI Configuration</h2>
          <p className="text-muted-foreground">Configure your messaging AI assistant settings</p>
        </div>

        {/* Configuration Card */}
        <Card className="p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Webhook URL</Label>
            <Input
              id="webhook-url"
              type="url"
              value={textConfig.webhookUrl}
              onChange={(e) => {
                const newUrl = e.target.value;
                setTextConfig({ ...textConfig, webhookUrl: newUrl });
                onUpdateProperty('webhookUrl', newUrl);
              }}
              placeholder="https://your-webhook-endpoint.com"
            />
            <p className="text-xs text-muted-foreground">
              Messages will be sent to this endpoint for AI responses
            </p>
          </div>

          <div className="space-y-2">
            <Label>Enable Messaging Platforms</Label>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(textConfig.platforms).map(([platform, enabled]) => (
                <div key={platform} className="flex items-center space-x-2">
                  <Checkbox
                    id={platform}
                    checked={enabled}
                    onCheckedChange={(checked) => handlePlatformToggle(platform, checked as boolean)}
                  />
                  <label htmlFor={platform} className="text-sm font-medium cursor-pointer capitalize">
                    {platform.charAt(0).toUpperCase() + platform.slice(1)}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="company-name">Company/Bot Name</Label>
            <Input
              id="company-name"
              value={textConfig.companyName}
              onChange={(e) => {
                const newName = e.target.value;
                setTextConfig({ ...textConfig, companyName: newName });
                onUpdateProperty('companyName', newName);
              }}
              placeholder="AI Support"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status-text">Status Text</Label>
            <Input
              id="status-text"
              value={textConfig.statusText}
              onChange={(e) => {
                const newStatus = e.target.value;
                setTextConfig({ ...textConfig, statusText: newStatus });
                onUpdateProperty('statusText', newStatus);
              }}
              placeholder="Online"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="initial-message">Initial Bot Message</Label>
            <Input
              id="initial-message"
              value={textConfig.initialMessage}
              onChange={(e) => {
                setTextConfig({ ...textConfig, initialMessage: e.target.value });
                onUpdateProperty('initialMessage', e.target.value);
                setMessages([{
                  id: Date.now(),
                  type: 'bot',
                  text: e.target.value,
                  timestamp: new Date()
                }]);
              }}
              placeholder="How can I help you today?"
            />
            <p className="text-xs text-muted-foreground">
              This message appears first when users start a conversation
            </p>
          </div>
        </Card>

        {/* Live Preview */}
        <div className="space-y-2">
          <Label>Live Chat Preview</Label>
          <Card className="p-12">
            <div className="flex justify-center mb-8">
              <IPhoneMockup>
                {activePlatform === 'instagram' ? (
                  <InstagramChat
                    messages={messages}
                    inputValue={inputValue}
                    setInputValue={setInputValue}
                    onSend={handleSend}
                    onKeyPress={handleKeyPress}
                    isSending={isSending}
                    companyName={textConfig.companyName}
                    statusText={textConfig.statusText}
                    clientLogo={clientLogo}
                    onReset={handleResetConversation}
                  />
                ) : activePlatform === 'messenger' ? (
                  <MessengerChat
                    messages={messages}
                    inputValue={inputValue}
                    setInputValue={setInputValue}
                    onSend={handleSend}
                    onKeyPress={handleKeyPress}
                    isSending={isSending}
                    companyName={textConfig.companyName}
                    statusText={textConfig.statusText}
                    clientLogo={clientLogo}
                    onReset={handleResetConversation}
                  />
                ) : activePlatform === 'imessage' ? (
                  <SMSChat
                    messages={messages}
                    inputValue={inputValue}
                    setInputValue={setInputValue}
                    onSend={handleSend}
                    onKeyPress={handleKeyPress}
                    isSending={isSending}
                    companyName={textConfig.companyName}
                    statusText={textConfig.statusText}
                    clientLogo={clientLogo}
                    onReset={handleResetConversation}
                  />
                ) : (
                  <WhatsAppChat
                    messages={messages}
                    inputValue={inputValue}
                    setInputValue={setInputValue}
                    onSend={handleSend}
                    onKeyPress={handleKeyPress}
                    isSending={isSending}
                    companyName={textConfig.companyName}
                    statusText={textConfig.statusText}
                    clientLogo={clientLogo}
                    onReset={handleResetConversation}
                  />
                )}
              </IPhoneMockup>
            </div>

            {/* Batch countdown indicator */}
            {batchCountdown !== null && (
              <div className="flex justify-center mb-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-muted-foreground">
                    Sending in <span className="font-semibold text-primary">{batchCountdown}s</span> — keep typing to add more
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-center gap-3 flex-wrap">
              {enabledPlatforms.map(platform => (
                <button
                  key={platform.key}
                  onClick={() => setActivePlatform(platform.key)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all"
                  style={{
                    border: activePlatform === platform.key ? '2px solid hsl(var(--primary))' : '1px solid hsl(var(--border))',
                    backgroundColor: activePlatform === platform.key ? 'hsl(var(--primary) / 0.1)' : 'hsl(var(--background))',
                    color: activePlatform === platform.key ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
                  }}
                >
                  <span className="text-lg">{platform.emoji}</span>
                  <span>{platform.name}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
