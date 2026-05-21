// trigger/_shared/ghl-conversations.ts — Node-runtime copy of the Deno helper.
//
// Mirrors frontend/supabase/functions/_shared/ghl-conversations.ts.
// Keep in sync until we factor a true cross-runtime shared module.
//
// Both files use only globalThis.fetch + JSON, no runtime-specific imports,
// so the source bodies are identical.

export type GhlSmsDirection = "inbound" | "outbound";

export type PushSmsToGhlArgs = {
  ghlApiKey: string;
  ghlLocationId: string;
  contactId: string;
  conversationProviderId: string | null;
  message: string;
  direction: GhlSmsDirection;
  altId: string | null;
  occurredAt?: string;
};

export type PushSmsToGhlResult = {
  ok: boolean;
  via: "conversations" | "notes" | "skipped";
  status?: number;
  error?: string;
};

const GHL_API_BASE = "https://services.leadconnectorhq.com";

// Bug 30 — Twilio Advanced Opt-Out auto-reply patterns. Mirror of the
// frontend/supabase/functions/_shared/ghl-conversations.ts list. Keep in sync.
const TWILIO_AUTO_REPLY_PATTERNS: ReadonlyArray<RegExp> = [
  /you have successfully been unsubscribed/i,
  /you have successfully been re-?subscribed/i,
  /you will not receive any more messages/i,
  /reply\s+start\s+to\s+resubscribe/i,
  /msg\s*&\s*data rates may apply/i,
];

function isTwilioAutoReply(body: string): boolean {
  for (const re of TWILIO_AUTO_REPLY_PATTERNS) {
    if (re.test(body)) return true;
  }
  return false;
}

export async function pushSmsToGhl(args: PushSmsToGhlArgs): Promise<PushSmsToGhlResult> {
  const {
    ghlApiKey,
    contactId,
    conversationProviderId,
    message,
    direction,
    altId,
    occurredAt,
  } = args;

  if (!ghlApiKey || !contactId || !message?.trim()) {
    return { ok: false, via: "skipped", error: "missing ghlApiKey/contactId/message" };
  }

  // Bug 30 — drop Twilio carrier auto-reply boilerplate so GHL conversations
  // stay clean. BFD sends its own STOP_REPLY / START_REPLY which lands as a
  // separate outbound mirror; the Twilio overlay would duplicate that.
  if (direction === "outbound" && isTwilioAutoReply(message)) {
    console.info("pushSmsToGhl skip: Twilio auto-reply pattern matched");
    return { ok: false, via: "skipped", error: "twilio_autoreply" };
  }

  const headers = {
    Authorization: `Bearer ${ghlApiKey}`,
    "Content-Type": "application/json",
    Version: "2021-04-15",
    Accept: "application/json",
  };

  if (conversationProviderId) {
    try {
      const path = direction === "inbound"
        ? "/conversations/messages/inbound"
        : "/conversations/messages/outbound";
      const body: Record<string, unknown> = {
        type: "SMS",
        contactId,
        message,
        conversationProviderId,
        direction,
      };
      if (altId) body.altId = altId;
      if (occurredAt) body.date = occurredAt;
      const r = await fetch(`${GHL_API_BASE}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (r.ok) return { ok: true, via: "conversations", status: r.status };
      const errText = await r.text().catch(() => "");
      console.warn(
        `pushSmsToGhl conversations ${direction} non-OK ${r.status}: ${errText.slice(0, 200)}`,
      );
      return { ok: false, via: "conversations", status: r.status, error: errText.slice(0, 200) };
    } catch (e) {
      console.warn("pushSmsToGhl conversations threw", e);
      return { ok: false, via: "conversations", error: (e as Error).message };
    }
  }

  try {
    const noteBody = `[platform → SMS ${direction}] ${message}`;
    const r = await fetch(
      `${GHL_API_BASE}/contacts/${contactId}/notes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghlApiKey}`,
          "Content-Type": "application/json",
          Version: "2021-07-28",
          Accept: "application/json",
        },
        body: JSON.stringify({ body: noteBody }),
      },
    );
    if (r.ok) return { ok: true, via: "notes", status: r.status };
    const errText = await r.text().catch(() => "");
    console.warn(
      `pushSmsToGhl notes ${direction} non-OK ${r.status}: ${errText.slice(0, 200)}`,
    );
    return { ok: false, via: "notes", status: r.status, error: errText.slice(0, 200) };
  } catch (e) {
    console.warn("pushSmsToGhl notes threw", e);
    return { ok: false, via: "notes", error: (e as Error).message };
  }
}

// ── Cadence v2 — outbound email via GHL Conversations API ────────────────
// Uses POST /conversations/messages with type: "Email" so GHL both SENDS
// the email (via the location's configured email infra) AND logs it on
// the contact's conversation thread.
//
// If GHL returns non-2xx (email channel not configured, no email on
// contact, etc.), falls back to a Notes write so the agent owner at least
// sees the intent on the contact timeline. Caller can inspect the via
// field to know which path was taken.

export type PushEmailToGhlArgs = {
  ghlApiKey: string;
  ghlLocationId: string;
  contactId: string;
  subject: string;
  body: string;
  bodyFormat?: "html" | "text";
  fromEmail?: string;
  toEmail?: string;
  altId?: string | null;
};

export type PushEmailToGhlResult = {
  ok: boolean;
  via: "conversations" | "notes" | "skipped";
  status?: number;
  emailMessageId?: string;
  error?: string;
};

export async function pushEmailToGhl(args: PushEmailToGhlArgs): Promise<PushEmailToGhlResult> {
  const { ghlApiKey, contactId, subject, body, bodyFormat, fromEmail, toEmail, altId } = args;

  if (!ghlApiKey || !contactId || !subject?.trim() || !body?.trim()) {
    return { ok: false, via: "skipped", error: "missing ghlApiKey/contactId/subject/body" };
  }

  const headers = {
    Authorization: `Bearer ${ghlApiKey}`,
    "Content-Type": "application/json",
    Version: "2021-04-15",
    Accept: "application/json",
  };

  // Try GHL Conversations Email send.
  try {
    const isHtml = (bodyFormat ?? "html") === "html";
    const payload: Record<string, unknown> = {
      type: "Email",
      contactId,
      subject,
    };
    if (isHtml) payload.html = body;
    else payload.message = body;
    if (fromEmail) payload.emailFrom = fromEmail;
    if (toEmail) payload.emailTo = [toEmail];
    if (altId) payload.altId = altId;

    const r = await fetch(`${GHL_API_BASE}/conversations/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      let emailMessageId: string | undefined;
      try {
        const j = (await r.json()) as { emailMessageId?: string; messageId?: string };
        emailMessageId = j.emailMessageId ?? j.messageId;
      } catch { /* ignore parse errors */ }
      return { ok: true, via: "conversations", status: r.status, emailMessageId };
    }
    const errText = await r.text().catch(() => "");
    console.warn(`pushEmailToGhl conversations non-OK ${r.status}: ${errText.slice(0, 300)}`);
    // fall through to notes
  } catch (e) {
    console.warn("pushEmailToGhl conversations threw", e);
  }

  // Fallback — log intent on the contact timeline as a Note so the agent
  // sees what would have been sent. Best-effort, non-blocking for caller.
  try {
    const noteBody = `[platform → Email outbound]\nSubject: ${subject}\n\n${body.slice(0, 4000)}`;
    const r = await fetch(`${GHL_API_BASE}/contacts/${contactId}/notes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghlApiKey}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
        Accept: "application/json",
      },
      body: JSON.stringify({ body: noteBody }),
    });
    if (r.ok) return { ok: false, via: "notes", status: r.status };
    const errText = await r.text().catch(() => "");
    return { ok: false, via: "notes", status: r.status, error: errText.slice(0, 200) };
  } catch (e) {
    return { ok: false, via: "notes", error: (e as Error).message };
  }
}
