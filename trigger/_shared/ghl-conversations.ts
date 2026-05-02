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
