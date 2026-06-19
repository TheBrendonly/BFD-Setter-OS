# GHL-Sync Fix — Spec + Build Record (2026-06-19)

Branch `fix/ghl-sync-2026-06-19` (worktree). Covers BUG_LIST **6.11**, **6.12** (a+b), **6.13**, and the ~101-field cleanup list. Companion to the plan `~/.claude/plans/bfd-setter-ghl-sync-session-2026-06-19-lexical-pony.md`.

> Status legend: ✅ done · 🧪 built+tested (not deployed) · [B] Brendan-owned · ⏳ pending live verify.

---

## 1. 6.11 — stamp `last_call_outcome` for voicemail / no-answer

**Root cause (verified):** the live main agent `Voice-Setter-Test` (`agent_f45f4dd87a4072424f3c84b74c`) posts to `retell-call-analysis-webhook` (confirmed via Retell `get_agent`: `webhook_url = .../retell-call-analysis-webhook`). The function that stamps `last_call_outcome` (`retell-call-webhook/index.ts:168-219`) is therefore **never invoked for live calls**. In `retell-call-analysis-webhook`, Step 6 completes the execution only on **human pickup**; voicemail/no-answer never stamp `last_call_outcome`, so `runEngagement.waitForCallOutcome` polls its full 600 s ceiling before sending the missed-call SMS (~10 min late).

**Fix:** in `retell-call-analysis-webhook`, on the `call_ended` event with an `execution_id` dynamic var, stamp `engagement_executions.last_call_outcome` (enriched signal shape) + clear `active_call_id`, mirroring the proven `retell-call-webhook` writer. On write failure return 500 so Retell retries (narrow, documented exception to this handler's "always-200" rule). Human-pickup completion path (Step 6) is unchanged and idempotent.

**Stamp shape** (`buildCallOutcomeStamp`): `{ call_id, disconnect_reason, call_status, ended_at, duration_ms, transcript_turns, in_voicemail }` — richer than `retell-call-webhook`'s 4 fields so `runEngagement`'s re-`classifyCallOutcome` is correct on ambiguous reasons (`user_hangup` etc.).

**Coordination flag:** this webhook now also clears `active_call_id`. The `runEngagement` active_call_id-clear-on-timeout work remains with the feature session; both write `null`, so no conflict.

---

## 2. 6.12b — write outcome variables to GHL custom fields

### 2a. Calls (in `retell-call-analysis-webhook`, on `call_analyzed`)
New shared helper `writeGhlContactFields()` does one `PUT /contacts/{id}` with the full `customFields` array. New pure mapper `buildOutcomeFieldWrites()` maps the in-handler outcome data to field ids.

**Field map (call path):**
| clients column (NEW) | GHL field (hit-list id) | source value | format |
|---|---|---|---|
| `ghl_call_outcome_field_id` | Call Outcome `YD9wo2UYpfsewexEExb6` | `callHistoryClass` | enum→label: Answered/Voicemail/No Answer/Error |
| `ghl_call_summary_field_id` | AI Call Summary `sbwpZdkcp1OxoAwffLEA` | `record.call_summary` | string (slice 5000) |
| `ghl_call_intent_field_id` | Call Intent `ZOpyG5eQLYdNeXA7UW9w` | `custom_analysis_data.interested_status` | passthrough, null→skip |
| `ghl_lead_qualified_field_id` | Lead Qualified `zoNSLEjOucDtumqREGoG` | `success_rate` / `call_successful` | "true"/"false" |
| `ghl_last_call_date_field_id` | Last Call Date `9rtxGevOeSiJZpD3zFfi` | `record.end_timestamp`/`start_timestamp` | ISO (TEXT-safe) |
| `ghl_callback_requested_field_id` | Callback Requested `qvA1ZKUP2QcwffoTR8DS` | `wantsCallback` | "true"/"false" |
| `ghl_callback_datetime_field_id` | Callback Datetime `hZxMXCpQM1JTvdSbsV79` | parsed `scheduledFor` | ISO (TEXT-safe) |
| `ghl_appointment_datetime_field_id` | Appointment Datetime `Yu0pBpa0X99NjJbiWa2X` | `record.appointment_time` | ISO (TEXT-safe) |
| (existing) sentiment | `jWPaRl6ysDgR7KWzW89d` (TEXT) | `record.user_sentiment` | unchanged |
| (existing) appt-booked | `IJVbAhkWv94dRW6Ddnze` (TEXT) | `record.appointment_booked` | unchanged |

### 2b. SMS (NEW `analyze-sms-conversation` edge fn + Trigger driver)
Self-contained; never touches the SMS engine. Reconstructs the thread from `message_queue` (channels `sms_inbound`/`sms_outbound`/`sms`), LLM-classifies via OpenRouter, writes dedicated `Setter SMS *` fields, stamps `leads.last_sms_analyzed_at`.

**Field map (SMS path) — dedicated fields ([B] to create):**
| clients column (NEW) | dedicated GHL field | source |
|---|---|---|
| `ghl_sms_sentiment_field_id` | `Setter SMS Sentiment` (TEXT) | LLM sentiment |
| `ghl_sms_intent_field_id` | `Setter SMS Intent` (TEXT) | LLM intent |
| `ghl_sms_qualified_field_id` | `Setter SMS Qualified` (TEXT) | LLM qualified |
| `ghl_sms_summary_field_id` | `Setter SMS Summary` (TEXT) | LLM summary |

Driver: `trigger/analyzeSmsConversations.ts` — hourly `schedules.task`, POSTs the edge fn in scan mode (leads with SMS activity since `last_sms_analyzed_at`, last msg > 10 min ago).

### GHL field-type check (build-time, read-only) — FINDINGS
`GET /locations/xo0XjmenBBJxJgSnAdyM/customFields` (Version 2021-07-28). Rule: TEXT/LARGE_TEXT → wire id directly; DATE/SINGLE_OPTIONS/CHECKBOX/RADIO → mint a dedicated `Setter *` TEXT field (2026-06-19 precedent).

| field id | name | dataType | decision |
|---|---|---|---|
| _(filled at build)_ | | | |

---

## 3. 6.12a — SMS in the GHL Conversations tab ([B])

Code (`pushSmsToGhl`) is **already correct**: posts to `/conversations/messages/{inbound|outbound}` with `type:SMS` + `altId` dedupe when `ghl_conversation_provider_id` is set; else Notes fallback. The id is NULL on BFD. Enablement requires a **GHL Marketplace custom SMS conversation provider** (no API provisioning).

### [B] Runbook — register a custom SMS conversation provider
1. marketplace.gohighlevel.com → create/select an app for the BFD agency.
2. Auth → add scopes: `conversations/message.write`, `conversations.write`, `conversations.readonly`, `contacts.readonly`, `contacts.write`.
3. Add a **Conversation Provider** → Type **SMS** → tick **"Is this a Custom Conversation Provider"** → set a Delivery URL (receives outbound webhook events) → optionally tick "Always show this Conversation Provider" + set Alias/Logo.
4. The returned provider **ID** is the `conversationProviderId`. Install the app on the BFD location (auto-enabled on install; see Settings → Conversation Providers).
5. Set `clients.ghl_conversation_provider_id` = that id on the BFD client row (live UPDATE — [B]).
6. Verify: one inbound + one outbound SMS now appear in the **Conversations** tab (not Notes); re-firing the same Twilio `message_sid` does not duplicate (altId dedupe).

---

## 4. 6.13 — security fields (read-only verify + [B] delete)

Fields: `6uO14dISilgbMcn35Ne4` **Supabase Service Role Key**, `eRGxS6OZhW20KLxP2c1n` **Supabase Project URL**. Code grep: **no code reads/writes either id** → deletion is code-safe.

### Verification — FINDINGS
_(filled at build: field present? dataType? any contact holds a real value? exposure severity.)_

### [B] action
Delete both field definitions in GHL after confirming no live GHL **workflow** references them. **If a real service-role key value is found, rotate the Supabase service-role key out-of-band regardless of deletion.**

---

## 5. ~101-field cleanup ([B])

See `Docs/GHL_CUSTOM_FIELDS_HITLIST.md` for the full grouped list + action order. Gate: confirm no live GHL workflow references a field before deleting; run **after** §2 finalizes the KEEP/wire set. No live deletion this session.

---

## 6. Coordinated-deploy list (post-merge)
1. Apply migration `20260619120000_ghl_outcome_field_ids.sql` (additive nullable columns on `clients` + `leads.last_sms_analyzed_at`).
2. Redeploy edge fn `retell-call-analysis-webhook` (6.11 + 6.12b-calls).
3. Deploy edge fn `analyze-sms-conversation` + Trigger deploy `analyzeSmsConversations` (coordinate the single Trigger deploy with the feature session).
4. [B] wire the new `ghl_*_field_id` columns on the BFD client row (per the §2 type-check) + create dedicated `Setter *` / `Setter SMS *` TEXT fields where required.
5. [B] 6.12a marketplace conversation provider + set `ghl_conversation_provider_id`; 6.13 delete + key rotation if exposed; ~101-field cleanup.

## Decisions (defaults, documented)
- Stamp clears `active_call_id`; narrow 500-on-write-failure retry; dedicated SMS fields (no clobbering call outcomes); typed appt-booked `nMV3jNAZIZyrclc6H5N3` left untouched (keep dedicated TEXT `IJVbAhkWv94dRW6Ddnze`).
