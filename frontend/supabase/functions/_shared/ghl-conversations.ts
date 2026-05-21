// _shared/ghl-conversations.ts — best-effort SMS body mirror to GHL.
//
// Closes audit Gap 2 (inbound SMS bodies) and Gap 3 (outbound SMS bodies).
// Used by:
//   - receive-twilio-sms      (inbound + STOP/START auto-reply outbound)
//   - processMessages         (setter-reply outbound, native engine only)
//   - runEngagement           (cadence-engine outbound)
//
// Two endpoint paths, picked at call time by `conversationProviderId`:
//
//   1. POST /conversations/messages/inbound  | /outbound
//        Requires a Custom Conversation Provider id (provisioned in GHL
//        Marketplace, ~10 min one-off per client). Logs a real conversation
//        message visible in the GHL contact's Conversations tab.
//
//   2. POST /contacts/{id}/notes
//        Fallback when no provider id is configured. Less polished — the
//        body lands on the contact's Notes tab instead of Conversations —
//        but always works without marketplace setup.
//
// Idempotency: when the inbound/outbound endpoints are used, `altId` is sent
// so GHL dedupes if the same Twilio message_sid is mirrored twice. Notes
// fallback is not idempotent — duplicate fires create duplicate notes; we
// rely on call sites only firing once per outbound.
//
// This helper NEVER throws. It returns a result object; callers can log on
// non-ok but should not block the inbound/outbound business logic on it.
//
// Mirrored at: trigger/_shared/ghl-conversations.ts (Node-runtime copy).
// Keep in sync until we factor a true cross-runtime shared module.

export type GhlSmsDirection = "inbound" | "outbound";

export type PushSmsToGhlArgs = {
  ghlApiKey: string;
  ghlLocationId: string;
  contactId: string;
  conversationProviderId: string | null;
  message: string;
  direction: GhlSmsDirection;
  altId: string | null;
  occurredAt?: string; // ISO; default = now
};

export type PushSmsToGhlResult = {
  ok: boolean;
  via: "conversations" | "notes" | "skipped";
  status?: number;
  error?: string;
};

const GHL_API_BASE = "https://services.leadconnectorhq.com";

// Bug 16 — push a call event to the GHL Conversations timeline.
//
// GHL Conversations API supports type: "Call" and type: "Voicemail" messages
// alongside the SMS / Email types. Surfaces the call inline in the contact's
// Conversations tab instead of just as a Note (which is the pre-Bug-16 state
// after Bug 19's note write).
//
// Idempotency: uses Retell `call_id` as `altId` so GHL dedupes if the same
// call_analyzed event re-fires (Retell may retry on transient failures).
//
// Falls back to a Note when `conversationProviderId` is null — same fallback
// shape as pushSmsToGhl, identical Note-tab visibility, lossy on metadata
// (no `type: Call` chip, no inline recording link).
//
// Never throws. Returns a result object; callers should log on non-ok but
// not block business logic.

export type GhlCallType = "Call" | "Voicemail";
export type GhlCallDirection = "inbound" | "outbound";

export type PushCallEventToGhlArgs = {
  ghlApiKey: string;
  contactId: string;
  conversationProviderId: string | null;
  callType: GhlCallType;
  direction: GhlCallDirection;
  durationSeconds: number | null;
  callId: string | null;
  recordingUrl: string | null;
  outcomeSummary: string | null;
  outcomeClass: string | null; // "human_pickup" | "voicemail" | "no_connect" | "error" | "unknown"
  altId: string | null;
  occurredAt?: string;
};

export type PushCallEventToGhlResult = {
  ok: boolean;
  via: "conversations" | "notes" | "skipped";
  status?: number;
  error?: string;
};

export async function pushCallEventToGhl(
  args: PushCallEventToGhlArgs,
): Promise<PushCallEventToGhlResult> {
  const {
    ghlApiKey,
    contactId,
    conversationProviderId,
    callType,
    direction,
    durationSeconds,
    callId,
    recordingUrl,
    outcomeSummary,
    outcomeClass,
    altId,
    occurredAt,
  } = args;

  if (!ghlApiKey || !contactId) {
    return { ok: false, via: "skipped", error: "missing ghlApiKey/contactId" };
  }

  // Render a human-readable body for the Conversations message + Notes fallback.
  const durationStr = typeof durationSeconds === "number" && durationSeconds > 0
    ? `${durationSeconds}s`
    : "unknown";
  const recordingLink = callId ? `https://app.retellai.com/calls/${callId}` : null;
  const lines = [
    `${callType === "Voicemail" ? "Voicemail" : "Call"} (${direction}) — outcome: ${outcomeClass ?? "unknown"}`,
    `Duration: ${durationStr}`,
  ];
  if (recordingLink) lines.push(`Recording: ${recordingLink}`);
  if (outcomeSummary) lines.push("", outcomeSummary);
  const body = lines.join("\n");

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
      const payload: Record<string, unknown> = {
        type: callType,
        contactId,
        message: body,
        conversationProviderId,
        direction,
      };
      if (altId) payload.altId = altId;
      if (occurredAt) payload.date = occurredAt;
      const r = await fetch(`${GHL_API_BASE}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (r.ok) return { ok: true, via: "conversations", status: r.status };
      const errText = await r.text().catch(() => "");
      console.warn(
        `pushCallEventToGhl conversations ${direction} ${callType} non-OK ${r.status}: ${errText.slice(0, 200)}`,
      );
      return { ok: false, via: "conversations", status: r.status, error: errText.slice(0, 200) };
    } catch (e) {
      console.warn("pushCallEventToGhl conversations threw", e);
      return { ok: false, via: "conversations", error: (e as Error).message };
    }
  }

  // Notes fallback — slightly different prefix so call events don't blur into
  // SMS notes in the Notes tab when both fallbacks are in play.
  try {
    const noteBody = `[platform → ${callType} ${direction}] ${body}`;
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
      `pushCallEventToGhl notes ${direction} ${callType} non-OK ${r.status}: ${errText.slice(0, 200)}`,
    );
    return { ok: false, via: "notes", status: r.status, error: errText.slice(0, 200) };
  } catch (e) {
    console.warn("pushCallEventToGhl notes threw", e);
    return { ok: false, via: "notes", error: (e as Error).message };
  }
}

// Bug 30 — Twilio Advanced Opt-Out auto-reply patterns. When a lead texts
// keywords like "yes", "stop", "start", "help" etc., Twilio's carrier-level
// Advanced Opt-Out injects a boilerplate auto-reply on top of any reply BFD
// itself sends. Mirroring those into GHL doubles the noise in the
// conversation thread. Match conservatively on the canonical Twilio body
// substrings; per Twilio docs (twilio.com/docs/messaging/services/advanced-opt-out)
// these strings are fixed unless the customer overrides them in the Service.
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

  // Notes fallback. Visible on the GHL contact timeline as a Note. Prefix the
  // direction so the agency owner can read the thread by skimming notes.
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
