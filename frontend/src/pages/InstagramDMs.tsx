import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Instagram, Send, RefreshCw, LinkIcon, MessageCircle, ArrowLeft } from "lucide-react";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import AttendeeAvatar from "@/components/instagram/AttendeeAvatar";
import AttendeeProfileDialog from "@/components/instagram/AttendeeProfileDialog";

interface UnipileAccount {
  id: string;
  client_id: string;
  unipile_account_id: string;
  provider: string;
  display_name: string | null;
  status: string;
}

interface Chat {
  id: string;
  name?: string;
  attendee_id?: string;
  attendee_provider_id?: string;
  timestamp?: string;
  unread_count?: number;
  folder?: string[];
  attendees?: Array<{ display_name?: string; id?: string }>;
  last_message?: { text?: string; timestamp?: string };
}

interface Message {
  id: string;
  text?: string;
  sender_id?: string;
  timestamp?: string;
  is_sender?: boolean;
}

const CACHE_KEY_PREFIX = "ig_chats_";
const POLL_INTERVAL = 30000; // 30 seconds

export default function InstagramDMs() {
  const { clientId } = useParams<{ clientId: string }>();
  const [accounts, setAccounts] = useState<UnipileAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<UnipileAccount | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [selectedAttendeeId, setSelectedAttendeeId] = useState<string | null>(null);
  const [selectedAttendeeName, setSelectedAttendeeName] = useState<string | undefined>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedChatRef = useRef<Chat | null>(null);

  usePageHeader({ title: "Instagram DMs" });

  // Keep ref in sync
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  useEffect(() => {
    if (clientId) fetchAccounts();
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [clientId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const invokeProxy = async (action: string, params: Record<string, string> = {}, body?: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");

    const searchParams = new URLSearchParams({ action, ...params });
    // functions.invoke uses the canonical client URL (VITE_SUPABASE_URL); the
    // query string rides in the function name. Avoids the undefined.supabase.co
    // failure when VITE_SUPABASE_PROJECT_ID is unset (6.3).
    const { data, error } = await supabase.functions.invoke(
      `unipile-proxy?${searchParams}`,
      body ? { method: "POST", body } : { method: "GET" },
    );

    if (error) {
      const errBody: any = error instanceof FunctionsHttpError
        ? await error.context.json().catch(() => ({}))
        : {};
      const status = error instanceof FunctionsHttpError ? error.context.status : undefined;
      throw new Error(errBody.error || `Request failed: ${status ?? error.message}`);
    }
    return data;
  };

  const getCacheKey = (accountId: string) => `${CACHE_KEY_PREFIX}${accountId}`;

  const loadCachedChats = (accountId: string): Chat[] | null => {
    try {
      const cached = localStorage.getItem(getCacheKey(accountId));
      if (!cached) return null;
      const { chats: cachedChats, timestamp } = JSON.parse(cached);
      // Cache valid for 5 minutes
      if (Date.now() - timestamp < 5 * 60 * 1000) return cachedChats;
      return null;
    } catch { return null; }
  };

  const saveCachedChats = (accountId: string, chatList: Chat[]) => {
    try {
      localStorage.setItem(getCacheKey(accountId), JSON.stringify({ chats: chatList, timestamp: Date.now() }));
    } catch { /* ignore quota errors */ }
  };

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("unipile_accounts")
        .select("*")
        .eq("client_id", clientId!);

      if (error) throw error;
      const accs = (data as unknown as UnipileAccount[]) || [];
      setAccounts(accs);
      if (accs.length > 0) {
        const account = accs[0];
        setSelectedAccount(account);
        // Try loading from cache first, then fetch fresh
        const cached = loadCachedChats(account.unipile_account_id);
        if (cached) {
          setChats(cached);
          // Refresh in background
          fetchChatsBackground(account);
        } else {
          fetchChats(account);
        }
      }
    } catch (err: any) {
      console.error("Error fetching accounts:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchChatsBackground = async (account: UnipileAccount) => {
    try {
      const data = await invokeProxy("list-chats", {
        account_id: account.unipile_account_id,
        limit: "50",
      });
      const chatList = data.items || data || [];
      setChats(chatList);
      saveCachedChats(account.unipile_account_id, chatList);
    } catch { /* silent background refresh */ }
  };

  const startPolling = useCallback((account: UnipileAccount) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const data = await invokeProxy("list-chats", {
          account_id: account.unipile_account_id,
          limit: "50",
        });
        const chatList = data.items || data || [];
        setChats(chatList);
        saveCachedChats(account.unipile_account_id, chatList);

        // Also refresh current conversation messages
        if (selectedChatRef.current) {
          const msgData = await invokeProxy("get-messages", {
            chat_id: selectedChatRef.current.id,
            limit: "50",
          });
          const msgs = msgData.items || msgData || [];
          setMessages(msgs.reverse ? msgs.reverse() : msgs);
        }
      } catch { /* silent poll failure */ }
    }, POLL_INTERVAL);
  }, []);

  const fetchChats = async (account: UnipileAccount) => {
    setLoadingChats(true);
    setSelectedAccount(account);
    setSelectedChat(null);
    setMessages([]);
    try {
      const data = await invokeProxy("list-chats", {
        account_id: account.unipile_account_id,
        limit: "50",
      });
      const chatList = data.items || data || [];
      setChats(chatList);
      saveCachedChats(account.unipile_account_id, chatList);
      startPolling(account);
    } catch (err: any) {
      toast.error("Failed to load chats: " + err.message);
    } finally {
      setLoadingChats(false);
    }
  };

  const fetchMessages = async (chat: Chat) => {
    setLoadingMessages(true);
    setSelectedChat(chat);
    try {
      const data = await invokeProxy("get-messages", {
        chat_id: chat.id,
        limit: "50",
      });
      const msgs = data.items || data || [];
      setMessages(msgs.reverse ? msgs.reverse() : msgs);
    } catch (err: any) {
      toast.error("Failed to load messages: " + err.message);
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedChat) return;
    setSendingMessage(true);
    try {
      await invokeProxy("send-message", {}, {
        chatId: selectedChat.id,
        text: newMessage,
      });
      setNewMessage("");
      await fetchMessages(selectedChat);
    } catch (err: any) {
      toast.error("Failed to send: " + err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const getChatName = (chat: Chat) => {
    if (chat.name) return chat.name;
    if (chat.attendees && chat.attendees.length > 0) {
      return chat.attendees.map((a) => a.display_name || "Unknown").join(", ");
    }
    return "Conversation";
  };

  const getChatAttendeeId = (chat: Chat) => {
    return chat.attendee_id || chat.attendees?.[0]?.id;
  };

  const handleAttendeeClick = (chat: Chat) => {
    const attendeeId = getChatAttendeeId(chat);
    if (!attendeeId) return;
    setSelectedAttendeeId(attendeeId);
    setSelectedAttendeeName(getChatName(chat));
    setProfileDialogOpen(true);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const data = await invokeProxy("hosted-auth-link", {}, {
        clientId,
        providers: ["INSTAGRAM"],
      });
      if (data.url) {
        window.open(data.url, "_blank", "width=600,height=700");
        toast.success("Authentication window opened. Complete the login there, then refresh.");
      } else {
        toast.error("Failed to generate auth link");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  // No accounts connected - show connect screen
  if (!loading && accounts.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 to-accent flex items-center justify-center">
              <Instagram className="w-8 h-8 text-primary-foreground" />
            </div>
            <CardTitle>Connect Instagram</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Connect your Instagram account to manage DMs directly from this dashboard.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleConnect} disabled={connecting} className="w-full">
              <LinkIcon className="w-4 h-4 mr-2" />
              {connecting ? "Generating link..." : "Connect Instagram Account"}
            </Button>
            <Button variant="outline" onClick={fetchAccounts} className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4 px-6">
      {/* Chats sidebar */}
      <div className="w-80 flex flex-col border border-border rounded-lg bg-card">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Instagram className="w-4 h-4 text-pink-500" />
            <span className="font-semibold text-sm">Chats</span>
            {selectedAccount && (
              <Badge variant="secondary" className="text-xs">
                {selectedAccount.display_name || selectedAccount.unipile_account_id.slice(0, 8)}
              </Badge>
            )}
          </div>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleConnect}>
              <LinkIcon className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => selectedAccount && fetchChats(selectedAccount)}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {accounts.length > 1 && (
          <div className="p-2 border-b border-border">
            {accounts.map((acc) => (
              <Button
                key={acc.id}
                variant={selectedAccount?.id === acc.id ? "default" : "ghost"}
                size="sm"
                className="w-full justify-start text-xs mb-1"
                onClick={() => fetchChats(acc)}
              >
                {acc.display_name || acc.unipile_account_id.slice(0, 12)}
              </Button>
            ))}
          </div>
        )}

        {chats.length === 0 && !loadingChats && selectedAccount && (
          <div className="flex-1 flex items-center justify-center p-4">
            <Button onClick={() => fetchChats(selectedAccount)} variant="outline">
              <MessageCircle className="w-4 h-4 mr-2" />
              Load Conversations
            </Button>
          </div>
        )}

        {loadingChats && (
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        <ScrollArea className="flex-1">
          {chats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => fetchMessages(chat)}
              className={`w-full text-left p-3 border-b border-border hover:bg-accent/50 transition-colors ${
                selectedChat?.id === chat.id ? "bg-accent" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <AttendeeAvatar
                  attendeeId={getChatAttendeeId(chat)}
                  displayName={getChatName(chat)}
                  onClick={(e) => {
                    e?.stopPropagation();
                    handleAttendeeClick(chat);
                  }}
                />
                <div className="overflow-hidden flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">{getChatName(chat)}</p>
                    {(chat.unread_count ?? 0) > 0 && (
                      <Badge variant="default" className="text-[10px] h-5 min-w-5 flex items-center justify-center">
                        {chat.unread_count}
                      </Badge>
                    )}
                  </div>
                  {chat.timestamp && (
                    <p className="text-xs text-muted-foreground truncate">
                      {new Date(chat.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* Messages area */}
      <div className="flex-1 flex flex-col border border-border rounded-lg bg-card">
        {!selectedChat ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a conversation to view messages</p>
            </div>
          </div>
        ) : (
          <>
            <div className="p-3 border-b border-border flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 md:hidden"
                onClick={() => setSelectedChat(null)}
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <AttendeeAvatar
                attendeeId={getChatAttendeeId(selectedChat)}
                displayName={getChatName(selectedChat)}
                onClick={() => handleAttendeeClick(selectedChat)}
              />
              <span
                className="font-semibold text-sm cursor-pointer hover:underline"
                onClick={() => handleAttendeeClick(selectedChat)}
              >
                {getChatName(selectedChat)}
              </span>
            </div>

            <ScrollArea className="flex-1 p-4">
              {loadingMessages ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.is_sender ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${
                          msg.is_sender
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        <p>{msg.text || "(media)"}</p>
                        {msg.timestamp && (
                          <p
                            className={`text-[10px] mt-1 ${
                              msg.is_sender ? "text-primary-foreground/60" : "text-muted-foreground"
                            }`}
                          >
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            <div className="p-3 border-t border-border">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex gap-2"
              >
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  disabled={sendingMessage}
                  className="flex-1"
                />
                <Button type="submit" size="icon" disabled={sendingMessage || !newMessage.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          </>
        )}
      </div>

      <AttendeeProfileDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        attendeeId={selectedAttendeeId}
        displayName={selectedAttendeeName}
      />
    </div>
  );
}
