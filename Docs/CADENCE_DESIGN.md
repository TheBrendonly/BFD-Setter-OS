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
  // CORRECTED 2026-07-20: the runtime also accepts "email" (Cadence v2), which this
  // block omitted. See trigger/runEngagement.ts:33 and the Cadence v2 note below.
  type: "sms" | "whatsapp" | "phone_call" | "email";
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

`isWithinBusinessHours()` lives in `frontend/supabase/functions/_shared/business-hours.ts` (originally inlined in the now-deleted `bulk-insert-leads`; extracted for reuse).

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

## Default new-lead cadence (BFD)

- **v1 (live)** — `engagement_workflows.id = 40e8bea3-b6f6-4562-98d1-f7e6599af6a1`, `is_active=true`. 9 nodes, 25-hour active phase (3 SMS + 2 calls then silence). Currently wired to `clients.auto_engagement_workflow_id` for BFD. This is the only active default cadence.

> **The flat 28-node "v2" draft (`c206da3e-…`) is being deleted (FEATURE_ROADMAP F7).** It is superseded by the **lead lifecycle system** (DEFERRED 3.5/3.6/3.7) — a multi-workflow enrollment state machine (Hot Pursuit → Cool Down → Long-Tail → Re-engage) rather than one flat mega-cadence. The v2 detail section below is retained for design reference only; do **not** activate `c206da3e`. The lifecycle WIP lives on branch `feat/cadence-v2-lifecycle-wip` (`engagement_enrollments` + `transition-lead`). See `Docs/DEFERRED.md`.

**Important model note:** the Engagement editor canvas (`frontend/src/pages/Engagement.tsx:3010-3181`) was built assuming `engage → wait_for_reply → engage → wait_for_reply → ...`. It will crash with `TypeError: Cannot read properties of undefined (reading 'id')` if a workflow uses `delay` nodes between engages instead. **Always use `wait_for_reply` between engagements**, never bare `delay` nodes. Phase 4c webhook cancellation already handles reply-stops-cadence so the inline reply check inside `wait_for_reply` is redundant but harmless, and gives a free `time_to_first_response_seconds` metric.

### v1 (live, 9 nodes)

| Node | Type | Timing | Channel | Copy / instructions |
|---|---|---|---|---|
| n1 | engage | T+0 | SMS | "Hey {{first_name}}, Brendan here — calling you in 1 min about your enquiry." |
| n2 | wait_for_reply | 1m | — | — |
| n3 | engage | T+1m | phone_call (Voice-Setter-2, treat_pickup_as_reply=true) | "First outbound call to a fresh lead… Open: 'Hey {{first_name}}, Brendan here, you enquired earlier, got 2 minutes?'… Do NOT leave a voicemail." |
| n4 | wait_for_reply | 1s | — | (post Bug-1 fix the runtime waits for call_ended before crossing this) |
| n5 | engage | post-call (if missed) | SMS | "Hey {{first_name}}, just tried calling about your enquiry. When suits for a quick chat? Happy to lock something in. Brendan" |
| n6 | wait_for_reply | 8h | — | — |
| n7 | engage | T+8h | SMS | "Hey {{first_name}}, still keen for a quick chat about your enquiry? Brendan" |
| n8 | wait_for_reply | 16h | — | — |
| n9 | engage | T+24h | phone_call (Voice-Setter-2, treat_pickup_as_reply=true) | "Day-2 follow-up call… Open: 'Hey {{first_name}}, Brendan here, just trying you again about your enquiry, do you have a quick minute?'… Keep casual and low-pressure." |

### v2 (DELETED draft, 28 nodes — design reference only)

> Superseded by the lifecycle system (see the note above). `c206da3e` is slated for deletion (F7); the table below is kept only because the lifecycle design reuses these phase shapes. Do not activate it.

Built per the cadence-redesign plan approved 2026-05-13. Phase 1 preserves v1's first 9 nodes plus a post-Day-2-call SMS pair (n10+n11) for symmetry; Phase 2 + Phase 3 are net-new and use the email channel + AI-generated copy.

| Phase | Days | Touches | Channels |
|---|---|---|---|
| Phase 1 — Hot Burst | 0-2 | 6 (n1, n3, n5, n7, n9, n11) | 4 SMS (static) + 2 phone_call |
| Phase 2 — Warm Pursuit | 4-10 | 5 (n13, n15, n17, n19, n21) | 1 email + 1 SMS + 1 phone_call + 1 SMS + 1 email (AI-generated from Phase 2 onwards) |
| Phase 3 — Cool Down | 14-21 | 3 (n23, n25, n27) | 3 email (AI-generated, educational, no ask) |

Phase 2's AI-generated touches use lead context + chat_history (last 10 rows from client's external supabase). Phase 3 emails reference the lead's industry / prior conversation but make no ask — the goal is to keep the relationship warm for behavioral re-warm (Phase B).

**Cold-reply re-engagement** runs in parallel via the `nudgeColdReply` scheduled task (06:00 UTC daily). Nudges fire at +24h and +72h since last outbound; at +7d (or anything >14d cold) the lead is tagged `tagged_silent_after_engagement=true` and stops receiving nudges. Code: `trigger/nudgeColdReply.ts`.

**Cost ceiling:** `cadence_metrics.cost_estimate_cents` is written on every cadence terminal state (SMS=1.4c, email=0.5c, voice=50c, AI in ¢). Above 500c, `error_logs` gets a `cadence_cost_ceiling` warning entry. Modelled max for v2 is ~250c (~$2.50/lead).

Voicemail handling for v2's phone_call nodes (n3, n9, n17) is intentionally NOT configured (`voicemail_config = null`) — deferred to Phase B4 UI ("Cadence Settings" bar).

**Do NOT activate `c206da3e`** — it is being deleted (F7) in favor of the lifecycle system. The former activation/rollback SQL was removed so it can't be run by mistake.

## Tone notes

- BFD (Building Flow Digital) is a B2B service. Tone: professional but warm, conversational, never salesy. Aussie-friendly. Avoid emoji in cold outreach.
- Keep first-touch SMS under 160 chars (1 SMS segment, faster delivery).
- Use `{{first_name}}` not `{{full_name}}`.
- Sign-offs: `— [agent first name]` is fine; no full company sigs (looks autoreply).

---

## Cadence v2 additions (documented 2026-07-20, previously undocumented)

Two capabilities shipped into `runEngagement.ts` on `main` without being written up here. Both are
**built and reachable**, and both default to OFF.

### Email channel

`EngageChannel.type` accepts `"email"` (`trigger/runEngagement.ts:33`). It is authored in the
Engagement editor (`frontend/src/pages/Engagement.tsx:685`, seeded `enabled: false` at `:230`) with
`subject`, `body_format` (`"html"` default) and an optional `from_email` override.

Sending goes through **GHL's Conversations API, not an email provider**
(`trigger/runEngagement.ts:1347-1397`). If the GHL location has no email infrastructure configured it
**falls back to writing a GHL Note** rather than failing. A missing `ghl_api_key`/`ghl_location_id` or a
missing subject throws. On success it increments `metricsBuffer.emails_sent`, logs a `message_sent`
campaign event with `channel: "email"`, and mirrors into chat history. Post-send writes are non-fatal.

This does **not** contradict the "BFD is SMS-only, email provider deferred" decision: no SMTP or email
provider is wired anywhere, and this channel is off by default. It reuses the GHL connection BFD
already has.

### AI-generated copy

When `ch.ai_generate` is true and the channel is `sms` or `email`, the runtime calls
`aiGenerateEngagementCopy` with `ai_prompt` as the touch intent and uses the LLM output as the message
(and the subject, for email). See `trigger/runEngagement.ts:1186-1206`.

### Known type drift

`frontend/src/lib/engagementExecutionState.ts:1` still declares
`EngageChannelType = 'sms' | 'whatsapp' | 'phone_call'`, omitting `email`. `Engagement.tsx` carries its
own wider local type, so the UI works, but the mismatch produces 2 of the 21 pre-existing typecheck
errors. Harmless at runtime; fix when regenerating types.
