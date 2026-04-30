# Engagement Cadence Engine — Design Spec

## Purpose

When a lead arrives, run a multi-channel sequence (SMS / WhatsApp / voice / voicemail-drop) that maximises booking probability. Stop the moment they reply or book. Respect regulatory + tone constraints.

## State machine

An `engagement_executions` row represents one lead going through one cadence (one workflow). Status transitions:

```
pending  ──> running  ──> waiting  ──┐
                  │                  │
                  └──> completed ◄───┤  (sequence finished, lead replied, lead booked, opted out, deferred-and-resumed-but-now-done)
                                     │
                  └──> cancelled ◄───┘  (manual cancel, error)
```

`stop_reason` (text) records WHY status moved to completed/cancelled:
- `sequence_complete` — ran every node successfully
- `inbound_reply` — lead sent SMS/DM mid-cadence (Phase 4c)
- `human_pickup` — voice call answered (existing in retell-call-analysis-webhook)
- `booking_created` — appointment booked, via voice tool OR GHL webhook (Phase 7c)
- `opt_out` — STOP keyword received (Phase 4a)
- `opt_out_pre_send` — lead was on opt-out list before the next node fired (Phase 4a)
- `client_disabled` — client disabled cadences for this lead manually (`leads.setter_stopped`)
- `error` — unrecoverable error mid-cadence (logged in error_logs)

## Node types

Defined in `trigger/runEngagement.ts:25-40`:

```ts
type EngagementNode =
  | { id: string; type: "delay"; delay_seconds: number }
  | { id: string; type: "engage"; message: string; channels: EngageChannel[] }
  | { id: string; type: "wait_for_reply"; timeout_seconds: number }
  | { id: string; type: "drip"; batch_size: number; interval_seconds: number };

type EngageChannel = {
  type: "sms" | "whatsapp" | "phone_call";
  enabled: boolean;
  message: string;
  delay_seconds: number;
  // WhatsApp
  whatsapp_type?: "template" | "text";
  template_name?: string;
  // Phone
  voice_setter_id?: string;             // slot like "Voice-Setter-2"
  instructions?: string;
  treat_pickup_as_reply?: boolean;
  // Phase 4d additions:
  call_mode?: "live_call" | "voicemail_drop";
  voicemail_audio_url?: string;
};
```

## Per-node guards (Phase 4a-4c)

Before EACH `engage` or `phone_call` channel fires, runEngagement.ts must:

1. **Opt-out check** (Phase 4a): `SELECT 1 FROM lead_optouts WHERE client_id = ? AND phone = ?`. If hit, end execution with `stop_reason='opt_out_pre_send'`.
2. **Active-execution check** (Phase 4c): re-read this execution row's status. If it's `cancelled` (because receive-twilio-sms / bookings-webhook cancelled it mid-sequence), exit cleanly without firing.
3. **Quiet-hours check** (Phase 4b): compute next valid send time per `client.cadence_quiet_hours` + per-lead TZ. If now is outside, `wait.until(nextValidTime)` and retry.
4. **Channel-specific guards:**
   - SMS: lead must have a phone number; check `leads.phone` non-null.
   - WhatsApp: requires GHL conversation provider ID for the lead.
   - phone_call: lead must have a phone; setter slot must be configured.

## Phase 4a — STOP / opt-out keyword detection

In `receive-twilio-sms/index.ts`, BEFORE the sig check is too early (we need the `client.id` to look up). After client resolution but before any side effects:

```ts
const STOP_KEYWORDS_RE = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|opt[- ]?out)\s*\.?\s*$/i;
const START_KEYWORDS_RE = /^\s*(start|unstop|resubscribe|yes)\s*\.?\s*$/i;

if (STOP_KEYWORDS_RE.test(messageBody)) {
  // 1. Insert into lead_optouts
  await supabase.from("lead_optouts").upsert({
    client_id: client.id,
    phone: fromPhone,
    source: "sms_stop",
    raw_keyword: messageBody.trim().toUpperCase(),
  }, { onConflict: "client_id,phone" });

  // 2. Mark setter_stopped on the lead
  await supabase.from("leads").update({ setter_stopped: true })
    .eq("client_id", client.id).eq("phone", fromPhone);

  // 3. Cancel active engagement_executions
  // (full code in Phase 4a deliverable)

  // 4. Send compliance reply (ONE-TIME, no further sends)
  await sendTwilioSms(client, fromPhone, toPhone,
    "You've been unsubscribed. Reply START to resubscribe.");

  // 5. Return TwiML — do NOT fall through to AI reply path
  return twimlEmpty200();
}

if (START_KEYWORDS_RE.test(messageBody)) {
  // Symmetric: delete opt-out, unset setter_stopped, send confirmation
}
```

**Compliance reply text** must be regulator-friendly: no marketing, just "you're unsubscribed". Per US/AU SMS regulations.

## Phase 4b — Quiet hours

`clients.cadence_quiet_hours jsonb` (default `null` → fall back to per-client default):

```json
{
  "start": "09:00",
  "end": "21:00",
  "tz": "Australia/Brisbane",
  "days": [1, 2, 3, 4, 5, 6, 7]   // 1=Mon ... 7=Sun
}
```

`isWithinBusinessHours()` from `bulk-insert-leads/index.ts:30-61` is reused (move to `frontend/supabase/functions/_shared/business-hours.ts`).

**Per-lead TZ resolution** (best-effort, not authoritative):

```ts
const PHONE_TZ_PREFIX_MAP: Record<string, string> = {
  "+61": "Australia/Brisbane",
  "+1":  "America/New_York",       // imperfect for US; default to Eastern
  "+44": "Europe/London",
  "+64": "Pacific/Auckland",
  // ... extend as needed
};
function resolveLeadTimezone(phone: string, clientDefault: string): string {
  for (const [prefix, tz] of Object.entries(PHONE_TZ_PREFIX_MAP)) {
    if (phone.startsWith(prefix)) return tz;
  }
  return clientDefault;
}
```

In runEngagement.ts:
```ts
const leadTz = resolveLeadTimezone(payload.Phone, client.cadence_quiet_hours?.tz ?? "Australia/Brisbane");
const nextValidTime = getNextValidTime(now, qh.start, qh.end, qh.days, leadTz);
if (nextValidTime > now) {
  await wait.until({ date: nextValidTime });
}
```

## Phase 4c — Reply-detected cadence-end

When a lead replies mid-cadence, the AI conversation should take over and the cadence should die.

In `receive-twilio-sms/index.ts` AND `receive-dm-webhook/index.ts`, after inserting `message_queue`:

```ts
// Cancel any active cadence for this lead — reply means human takes over
const { data: activeCadences } = await supabase
  .from("engagement_executions")
  .select("id, trigger_run_id")
  .eq("client_id", client.id)
  .eq("ghl_contact_id", contactId)
  .in("status", ["pending", "running", "waiting"]);

for (const exec of activeCadences ?? []) {
  await supabase.from("engagement_executions")
    .update({
      status: "completed",
      stop_reason: "inbound_reply",
      completed_at: new Date().toISOString(),
    })
    .eq("id", exec.id);
  if (exec.trigger_run_id) {
    await cancelTriggerRun(exec.trigger_run_id, triggerKey);
  }
}
```

`cancelTriggerRun` already exists in `receive-twilio-sms/index.ts:56-74`.

## Voicemail (Retell-native, phase-11d)

Voicemail behaviour is now handled by Retell natively. The legacy Twilio AMD `<Play>{audio}</Play>` branch (and the `EngageChannel.call_mode === "voicemail_drop"` shape) was removed in phase-11d.

### How it flows

1. The user configures voicemail per workflow in the Engagement editor's Cadence Settings bar:
   - Mode: `static` (a fixed message Retell speaks if voicemail is reached) or `dynamic` (an LLM prompt; Retell generates the voicemail per call).
   - Message: the script (Static) or prompt (Dynamic), with `{{first_name}}` style template vars.
   - Persisted to `engagement_workflows.voicemail_config jsonb` as `{ mode, message }`.
2. `runEngagement.ts` reads `workflow.voicemail_config` and forwards it through `placeOutboundCall.triggerAndWait` payload.
3. Inside `make-retell-outbound-call/index.ts`, `ensureVoicemailConfig(apiKey, agentId, cfg)` runs BEFORE the actual `POST /v2/create-phone-call`:
   - Computes `sha256(JSON.stringify(cfg))` and checks a module-level `voicemailHashCache` Map keyed by `agentId`. If the hash matches the last applied value, the PATCH is skipped (no Retell roundtrip).
   - Otherwise PATCHes `https://api.retellai.com/update-agent/{agentId}` with body `{ voicemail_option: { action: { type: "static_text", text: <msg> } | { type: "prompt", prompt: <msg> } } }` and stores the hash.
4. Retell's AMD runs in the first ~3 minutes of the call and ends with `disconnection_reason="voicemail_reached"` if it landed in voicemail.

### Cost trade-off

Retell-native voicemail costs the standard call rate (~$0.04-0.10 per voicemail) versus the previous Twilio MP3 path (sub-cent). Worth it for richer dynamic voicemails; the static path is roughly equivalent in semantics to the old MP3.

### Per-agent state

`voicemail_option` is per-agent on Retell; there is no per-call override via the public API. Different workflows that point at the same agent will overwrite each other's voicemail_option as they fire — the hash cache only protects against re-PATCHing identical config, not against cross-workflow overwrites. Configure separate agent slots when divergent voicemails are required for the same client.

### Reference

- Retell docs: https://docs.retellai.com/build/handle-voicemail and https://docs.retellai.com/api-references/update-agent
- Implementation: `frontend/supabase/functions/make-retell-outbound-call/index.ts` — `ensureVoicemailConfig` + `voicemailHashCache`
- Workflow plumbing: `trigger/runEngagement.ts` (reads `voicemail_config`) → `trigger/placeOutboundCall.ts` (forwards to edge fn body) → `make-retell-outbound-call`

## Default new-lead cadence (placeholder copy)

Already inserted as `engagement_workflows.id = 40e8bea3-b6f6-4562-98d1-f7e6599af6a1` for BFD. Brendan to review and rewrite copy:

| Node | Type | Timing | Channel | Placeholder copy |
|---|---|---|---|---|
| n1 | engage | T+0 | SMS | "Hey {{first_name}}, calling you in 2 min about your enquiry." |
| n2 | delay | 2m | — | — |
| n3 | engage | T+2m | phone_call (live, treat_pickup_as_reply=true) | Voice agent picks up |
| n4 | delay | 28m | — | — |
| n5 | engage | T+30m | SMS | "Hey {{first_name}}, just tried to call. Sent through some info that should help — let me know when works for you." |
| n6 | delay | 8h | — | — |
| n7 | engage | T+8h30m | SMS | "Bumping this — happy to find a window today if you're around." |
| n8 | delay | 16h | — | — |
| n9 | engage | T+24h | phone_call (voicemail_drop in Phase 4d) | Pre-recorded |

**To enable for BFD after copy review:**
```sql
UPDATE clients SET auto_engagement_workflow_id = '40e8bea3-b6f6-4562-98d1-f7e6599af6a1'
WHERE id = 'e467dabc-57ee-416c-8831-83ecd9c7c925';
```

## Tone notes

- BFD (Building Flow Digital) is a B2B service. Tone: professional but warm, conversational, never salesy. Aussie-friendly. Avoid emoji in cold outreach.
- Keep first-touch SMS under 160 chars (1 SMS segment, faster delivery).
- Use `{{first_name}}` not `{{full_name}}`.
- Sign-offs: `— [agent first name]` is fine; no full company sigs (looks autoreply).
