import { task, queue, AbortTaskRunError } from "@trigger.dev/sdk";

// Global queue for outbound Retell calls. concurrencyLimit caps how many
// place-outbound-call runs may execute simultaneously across the whole project.
// Retell's API tolerates ~20-30 concurrent calls — set to 20 with headroom.
// Increase if Retell raises the cap; decrease if rate-limit errors appear.
export const retellOutboundQueue = queue({
  name: "retell-outbound",
  concurrencyLimit: 20,
});

export const placeOutboundCall = task({
  id: "place-outbound-call",
  queue: retellOutboundQueue,
  // Each call attempt is bounded — don't tie up a queue slot for more than 2 min.
  maxDuration: 120,
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 30000,
    factor: 2,
    randomize: true,
  },

  run: async (payload: {
    make_retell_call_url: string;
    client_id: string;
    voice_setter_id: string;
    ghl_contact_id: string;          // lead_id
    ghl_account_id: string;
    execution_id: string;
    // CAD-02 — deterministic dedup key (`${execution_id}:${node_index}:${channel_index}`).
    // make-retell-outbound-call refuses to place a second Retell call for the
    // same key, so task retries cannot double-dial the lead.
    idempotency_key?: string;
    custom_instructions: string;
    contact_fields: Record<string, string>;
    treat_pickup_as_reply: boolean;
    timezone?: string;
    // Phase 11d — workflow-level voicemail config. make-retell-outbound-call
    // PATCHes the agent's voicemail_option from this payload before placing
    // the call (hash-cached so we don't PATCH on every call).
    voicemail_config?: { mode: "static" | "dynamic"; message: string } | null;
  }) => {
    const resp = await fetch(payload.make_retell_call_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        client_id: payload.client_id,
        voice_setter_id: payload.voice_setter_id,
        ghl_contact_id: payload.ghl_contact_id,
        ghl_account_id: payload.ghl_account_id,
        execution_id: payload.execution_id,
        idempotency_key: payload.idempotency_key ?? null,
        custom_instructions: payload.custom_instructions,
        contact_fields: payload.contact_fields,
        treat_pickup_as_reply: payload.treat_pickup_as_reply,
        timezone: payload.timezone,
        voicemail_config: payload.voicemail_config ?? null,
      }),
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok || data?.call_failed) {
      const errMsg = data?.error || `make-retell-outbound-call returned ${resp.status}`;
      // REL-01: the edge fn classifies Retell failures. retryable === false
      // means a permanent 4xx (bad number, missing agent, account issue) —
      // retrying re-bills the paid create-phone-call endpoint and can never
      // succeed, so abort instead of throwing into the retry policy.
      if (data?.call_failed && data?.retryable === false) {
        throw new AbortTaskRunError(`Phone call failed permanently (no retry): ${errMsg}`);
      }
      throw new Error(`Phone call failed: ${errMsg}`);
    }

    return {
      call_id: data?.call_id,
      agent_id: data?.agent_id,
      to_number: data?.to_number,
      from_number: data?.from_number,
      // true when the edge fn deduped this attempt onto an existing call
      // (no new dial) — callers skip double-counting metrics/events.
      already_placed: data?.already_placed === true,
    };
  },
});
