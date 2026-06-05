import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Mail, Send, RefreshCw, Inbox, Star, Archive, Trash2, Reply, Plus, ArrowLeft, Paperclip } from "lucide-react";
import RetroLoader from "@/components/RetroLoader";
import LockedToolPanel from "@/components/LockedToolPanel";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import { format } from "date-fns";
import DOMPurify from "dompurify";

interface UnipileAccount {
  id: string;
  client_id: string;
  unipile_account_id: string;
  provider: string;
  display_name: string | null;
  status: string;
}

interface EmailItem {
  id: string;
  subject?: string;
  from?: { display_name?: string; identifier?: string };
  from_attendee?: { display_name?: string; identifier?: string };
  to?: Array<{ display_name?: string; identifier?: string }>;
  to_attendees?: Array<{ display_name?: string; identifier?: string }>;
  body?: string;
  body_plain?: string;
  date?: string;
  read?: boolean;
  has_attachments?: boolean;
  role?: string;
  folders?: string[];
  attachments?: Array<{ name?: string; size?: number }>;
}

type FolderView = "inbox" | "sent" | "all";

const CACHE_KEY_PREFIX = "email_inbox_";
const POLL_INTERVAL = 30000;

export default function EmailInbox() {
  const { clientId } = useParams<{ clientId: string }>();
  const [accounts, setAccounts] = useState<UnipileAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<UnipileAccount | null>(null);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null);
  const [emailDetail, setEmailDetail] = useState<EmailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [folder, setFolder] = useState<FolderView>("inbox");
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyMode, setReplyMode] = useState(false);
  const [compose, setCompose] = useState({ to: "", subject: "", body: "" });
  const [sending, setSending] = useState(false);
  
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedAccountRef = useRef<UnipileAccount | null>(null);

  usePageHeader({ title: "Email" });

  useEffect(() => { selectedAccountRef.current = selectedAccount; }, [selectedAccount]);
  useEffect(() => {
    if (clientId) fetchAccounts();
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, [clientId]);

  const invokeProxy = async (action: string, params: Record<string, string> = {}, body?: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    const searchParams = new URLSearchParams({ action, ...params });
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.supabase.co/functions/v1/unipile-proxy?${searchParams}`;
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.error || errBody.title || errBody.detail || `Request failed: ${res.status}`;
      throw new Error(msg);
    }
    return res.json();
  };

  const loadCached = (accountId: string): EmailItem[] | null => {
    try {
      const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}${accountId}_${folder}`);
      if (!cached) return null;
      const { emails: e, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < 5 * 60 * 1000) return e;
      return null;
    } catch { return null; }
  };

  const saveCache = (accountId: string, emailList: EmailItem[]) => {
    try {
      localStorage.setItem(`${CACHE_KEY_PREFIX}${accountId}_${folder}`, JSON.stringify({ emails: emailList, timestamp: Date.now() }));
    } catch {}
  };

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from("unipile_accounts").select("*").eq("client_id", clientId!);
      if (error) throw error;
      const accs = (data as unknown as UnipileAccount[]) || [];

      if (accs.length === 0) {
        setAccounts([]);
        setSelectedAccount(null);
        setEmails([]);
        setSelectedEmail(null);
        setEmailDetail(null);
        setLoading(false);
        return;
      }

      // Try email-compatible providers first (Google/Microsoft), then fall back to others
      const compatibleProviders = ["GOOGLE", "GOOGLE_OAUTH", "MICROSOFT", "OUTLOOK"];
      const sorted = [
        ...accs.filter((a) => compatibleProviders.some((p) => a.provider?.toUpperCase().includes(p))),
        ...accs.filter((a) => !compatibleProviders.some((p) => a.provider?.toUpperCase().includes(p))),
      ];

      for (const account of sorted) {
        setSelectedAccount(account);
        setSelectedEmail(null);
        setEmailDetail(null);
        const success = await fetchEmails(account);
        if (success) return;
      }

      // No compatible account found
      setAccounts([]);
      setSelectedAccount(null);
      setEmails([]);
      setSelectedEmail(null);
      setEmailDetail(null);
    } catch (err: any) {
      console.error("Error fetching accounts:", err);
      setAccounts([]);
      setSelectedAccount(null);
      setEmails([]);
      setSelectedEmail(null);
      setEmailDetail(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmails = async (account: UnipileAccount) => {
    setLoadingEmails(true);
    setSelectedAccount(account);
    setSelectedEmail(null);
    setEmailDetail(null);
    try {
      const params: Record<string, string> = { account_id: account.unipile_account_id, limit: "50" };
      if (folder === "inbox") params.role = "inbox";
      else if (folder === "sent") params.role = "outbox";
      const data = await invokeProxy("list-emails", params);
      const emailList = data.items || data || [];
      setAccounts([account]);
      setEmails(emailList);
      saveCache(account.unipile_account_id, emailList);
      startPolling(account);
      return true;
    } catch (err: any) {
      if (err.message?.includes("Missing credentials") || err.message?.includes("401") || err.message?.includes("Invalid account") || err.message?.includes("invalid_account") || err.message?.includes("422") || err.message?.includes("insufficient_privileges") || err.message?.includes("out of your scopes")) {
        setAccounts([]);
        setSelectedAccount(null);
        setEmails([]);
        setSelectedEmail(null);
        setEmailDetail(null);
        return false;
      }
      toast.error("Failed to load emails: " + err.message);
      return false;
    } finally {
      setLoadingEmails(false);
    }
  };

  const fetchEmailsBackground = async (account: UnipileAccount) => {
    try {
      const params: Record<string, string> = { account_id: account.unipile_account_id, limit: "50" };
      if (folder === "inbox") params.role = "inbox";
      else if (folder === "sent") params.role = "outbox";
      const data = await invokeProxy("list-emails", params);
      const emailList = data.items || data || [];
      setEmails(emailList);
      saveCache(account.unipile_account_id, emailList);
      startPolling(account);
    } catch {
      setAccounts([]);
      setSelectedAccount(null);
      setEmails([]);
      setSelectedEmail(null);
      setEmailDetail(null);
    }
  };

  const startPolling = useCallback((account: UnipileAccount) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const params: Record<string, string> = { account_id: account.unipile_account_id, limit: "50" };
        if (folder === "inbox") params.role = "inbox";
        else if (folder === "sent") params.role = "outbox";
        const data = await invokeProxy("list-emails", params);
        const emailList = data.items || data || [];
        setEmails(emailList);
        saveCache(account.unipile_account_id, emailList);
      } catch {}
    }, POLL_INTERVAL);
  }, [folder]);

  const fetchEmailDetail = async (email: EmailItem) => {
    setSelectedEmail(email);
    setLoadingDetail(true);
    try {
      const data = await invokeProxy("get-email", { email_id: email.id });
      setEmailDetail(data);
    } catch {
      setEmailDetail(email);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSend = async () => {
    if (!compose.to || !compose.body || !selectedAccount) return;
    setSending(true);
    try {
      await invokeProxy("send-email", { account_id: selectedAccount.unipile_account_id }, {
        to: [{ identifier: compose.to }],
        subject: compose.subject,
        body: compose.body,
      });
      toast.success("Email sent");
      setComposeOpen(false);
      setReplyMode(false);
      setCompose({ to: "", subject: "", body: "" });
      fetchEmails(selectedAccount);
    } catch (err: any) {
      toast.error("Failed to send: " + err.message);
    } finally {
      setSending(false);
    }
  };

  const handleReply = (email: EmailItem) => {
    const detail = emailDetail || email;
    const sender = detail.from?.identifier || detail.from_attendee?.identifier || "";
    setCompose({
      to: sender,
      subject: `Re: ${detail.subject || ""}`,
      body: "",
    });
    setReplyMode(true);
    setComposeOpen(true);
  };

  const handleDeleteEmail = async (email: EmailItem) => {
    if (!selectedAccount) return;
    try {
      await invokeProxy("delete-email", { email_id: email.id });
      toast.success("Email deleted");
      setSelectedEmail(null);
      setEmailDetail(null);
      fetchEmails(selectedAccount);
    } catch (err: any) {
      toast.error("Failed to delete: " + err.message);
    }
  };

  useEffect(() => {
    if (selectedAccount && accounts.length > 0) fetchEmails(selectedAccount);
  }, [folder]);

  const getEmailSender = (email: EmailItem) => {
    return email.from?.display_name || email.from_attendee?.display_name || email.from?.identifier || email.from_attendee?.identifier || "Unknown";
  };

  const getEmailSenderInitial = (email: EmailItem) => {
    const name = getEmailSender(email);
    return name.charAt(0).toUpperCase();
  };


  if (loading) {
    return <RetroLoader />;
  }

  if (accounts.length === 0) {
    return <LockedToolPanel toolName="Email Tool" />;
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 px-6">
      {/* Folder sidebar */}
      <div className="w-48 flex flex-col border border-border rounded-l-lg bg-card flex-shrink-0">
        <div className="p-3 border-b border-border">
          <Button size="sm" className="w-full" onClick={() => { setReplyMode(false); setCompose({ to: "", subject: "", body: "" }); setComposeOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Compose
          </Button>
        </div>
        <nav className="p-2 space-y-1">
          {([
            { key: "inbox" as FolderView, label: "Inbox", icon: Inbox },
            { key: "sent" as FolderView, label: "Sent", icon: Send },
            { key: "all" as FolderView, label: "All Mail", icon: Mail },
          ]).map((f) => (
            <Button
              key={f.key}
              variant={folder === f.key ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start text-xs"
              onClick={() => setFolder(f.key)}
            >
              <f.icon className="w-3.5 h-3.5 mr-2" /> {f.label}
            </Button>
          ))}
        </nav>
        <div className="mt-auto p-2 border-t border-border">
          <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => selectedAccount && fetchEmails(selectedAccount)}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingEmails ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Email list */}
      <div className="w-80 flex flex-col border-y border-r border-border bg-card flex-shrink-0">
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm capitalize">{folder}</span>
            <Badge variant="secondary" className="text-xs ml-auto">{emails.length}</Badge>
          </div>
        </div>
        {loadingEmails && emails.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            {emails.map((email) => (
              <button
                key={email.id}
                onClick={() => fetchEmailDetail(email)}
                className={`w-full text-left p-3 border-b border-border hover:bg-accent/50 transition-colors ${
                  selectedEmail?.id === email.id ? "bg-accent" : ""
                } ${email.read === false ? "bg-primary/5" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                    {getEmailSenderInitial(email)}
                  </div>
                  <div className="overflow-hidden flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className={`text-xs truncate ${email.read === false ? "font-bold" : "font-medium"}`}>
                        {getEmailSender(email)}
                      </p>
                      {email.has_attachments && <Paperclip className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                    </div>
                    <p className={`text-xs truncate ${email.read === false ? "font-semibold" : ""}`}>
                      {email.subject || "(no subject)"}
                    </p>
                    {email.date && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {format(new Date(email.date), "MMM d, h:mm a")}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </ScrollArea>
        )}
      </div>

      {/* Email detail */}
      <div className="flex-1 flex flex-col border-y border-r border-border rounded-r-lg bg-card">
        {!selectedEmail ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select an email to read</p>
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold">{(emailDetail || selectedEmail).subject || "(no subject)"}</h2>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleReply(selectedEmail)}>
                    <Reply className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDeleteEmail(selectedEmail)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>From: {getEmailSender(emailDetail || selectedEmail)}</p>
                {(emailDetail || selectedEmail).date && (
                  <p>{format(new Date((emailDetail || selectedEmail).date!), "PPpp")}</p>
                )}
              </div>
            </div>
            <ScrollArea className="flex-1 p-4">
              {(emailDetail?.body || emailDetail?.body_plain || selectedEmail.body || selectedEmail.body_plain) ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none text-sm"
                  dangerouslySetInnerHTML={{
                    // SECURITY: email body is untrusted (external mailbox); sanitize
                    // before rendering to prevent stored/reflected XSS.
                    __html: DOMPurify.sanitize(
                      emailDetail?.body || selectedEmail.body || `<pre class="whitespace-pre-wrap">${emailDetail?.body_plain || selectedEmail.body_plain || ""}</pre>`,
                      { ADD_ATTR: ["target"] },
                    ),
                  }}
                />
              ) : (
                <p className="text-muted-foreground text-sm">(No content)</p>
              )}
            </ScrollArea>
          </>
        )}
      </div>

      {/* Compose dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{replyMode ? "Reply" : "New Email"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>To</Label>
              <Input value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} placeholder="recipient@example.com" />
            </div>
            <div>
              <Label>Subject</Label>
              <Input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} placeholder="Subject" />
            </div>
            <div>
              <Label>Body</Label>
              <Textarea value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} rows={8} placeholder="Write your email..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending || !compose.to || !compose.body}>
              <Send className="w-4 h-4 mr-1" /> {sending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
