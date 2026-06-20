import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Send, Loader2, RefreshCw, Phone, User } from '@/components/icons';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface SmsMessage {
  id: string;
  contact_id: string;
  client_id: string;
  direction: string;
  body: string;
  twilio_sid: string | null;
  status: string;
  from_number: string | null;
  to_number: string | null;
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  phone_number: string;
  notes: string | null;
  created_at: string;
}

export default function DemoPageContactChat() {
  const { clientId, contactId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [contact, setContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');

  usePageHeader({
    title: contact?.name || 'SMS Chat',
    actions: [{
      label: 'BACK',
      icon: <ArrowLeft className="h-4 w-4" />,
      onClick: () => navigate(`/client/${clientId}/sms-contacts`),
      variant: 'outline' as const,
    }],
  });

  useEffect(() => {
    if (clientId && contactId) {
      fetchContact();
      fetchMessages();
    }
  }, [clientId, contactId]);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!contactId) return;

    const channel = supabase
      .channel(`sms-messages-${contactId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sms_messages',
          filter: `contact_id=eq.${contactId}`,
        },
        (payload) => {
          const newMsg = payload.new as SmsMessage;
          setMessages(prev => {
            // Avoid duplicates
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [contactId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchContact = async () => {
    const { data, error } = await supabase
      .from('demo_page_contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (error) {
      console.error('Error fetching contact:', error);
      toast({ title: 'Error', description: 'Contact not found', variant: 'destructive' });
      return;
    }
    setContact(data as unknown as Contact);
  };

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('sms_messages')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages((data || []) as unknown as SmsMessage[]);
    } catch (error: any) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !clientId || !contactId) return;

    setSending(true);
    const messageText = newMessage.trim();
    setNewMessage('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast({ title: 'Error', description: 'Not authenticated', variant: 'destructive' });
        setSending(false);
        return;
      }

      const { data: result, error } = await supabase.functions.invoke('twilio-send-sms', {
        body: {
          client_id: clientId,
          contact_id: contactId,
          message: messageText,
        },
      });

      if (error) throw error;
      if (result?.error) throw new Error(result.error);

      // Message will appear via realtime, but add it immediately for UX
      if (result.message) {
        setMessages(prev => {
          if (prev.some(m => m.id === result.message.id)) return prev;
          return [...prev, result.message as SmsMessage];
        });
      }

      toast({ title: 'Sent', description: 'SMS sent successfully' });
      inputRef.current?.focus();
    } catch (error: any) {
      console.error('Error sending SMS:', error);
      toast({ title: 'Error', description: error.message || 'Failed to send SMS', variant: 'destructive' });
      setNewMessage(messageText); // Restore the message
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl py-6 space-y-4">
        {/* Contact Info */}
        {contact && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{contact.name}</h3>
                  <p className="text-sm text-muted-foreground font-mono">{contact.phone_number}</p>
                </div>
                {contact.notes && (
                  <p className="text-sm text-muted-foreground max-w-[300px] truncate">{contact.notes}</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Messages */}
        <Card className="flex flex-col" style={{ height: 'calc(100vh - 300px)', minHeight: '400px' }}>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base">Conversation</CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchMessages}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto space-y-3 pb-2">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <p>No messages yet. Send the first SMS below.</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex',
                    msg.direction === 'outbound' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[75%] rounded-lg px-4 py-2.5 space-y-1',
                      msg.direction === 'outbound'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-[10px]',
                          msg.direction === 'outbound'
                            ? 'text-primary-foreground/60'
                            : 'text-muted-foreground'
                        )}
                      >
                        {format(new Date(msg.created_at), 'MMM d, h:mm a')}
                      </span>
                      {msg.direction === 'outbound' && (
                        <span
                          className={cn(
                            'text-[10px]',
                            msg.direction === 'outbound'
                              ? 'text-primary-foreground/60'
                              : 'text-muted-foreground'
                          )}
                        >
                          {msg.status}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </CardContent>

          {/* Input */}
          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                placeholder="Type a message..."
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
                className="flex-1"
              />
              <Button
                onClick={handleSend}
                disabled={sending || !newMessage.trim()}
                size="icon"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
