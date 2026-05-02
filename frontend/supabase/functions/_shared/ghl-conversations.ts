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
