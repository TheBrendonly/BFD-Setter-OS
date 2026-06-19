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

### GHL field-type check (read-only) — FINDINGS ✅
Verified live 2026-06-19 (`GET /locations/xo0XjmenBBJxJgSnAdyM/customFields`, HTTP 200, 116 fields, key from `clients.ghl_api_key`). Rule: TEXT/LARGE_TEXT → wire id directly; SINGLE_OPTIONS/CHECKBOX/DATE/RADIO → mint a dedicated `Setter *` TEXT field (2026-06-19 precedent — plain-string writes to typed fields silently fail).

| GHL field | id | dataType | wire decision |
|---|---|---|---|
| AI Call Summary | `sbwpZdkcp1OxoAwffLEA` | **LARGE_TEXT** | ✅ wire id directly → `ghl_call_summary_field_id` |
| Callback Datetime | `hZxMXCpQM1JTvdSbsV79` | **TEXT** | ✅ wire id directly → `ghl_callback_datetime_field_id` |
| Appointment Datetime | `Yu0pBpa0X99NjJbiWa2X` | **TEXT** | ✅ wire id directly → `ghl_appointment_datetime_field_id` |
| Call Outcome | `YD9wo2UYpfsewexEExb6` | SINGLE_OPTIONS | ⚠️ [B] mint dedicated TEXT `Setter Call Outcome` → `ghl_call_outcome_field_id` |
| Call Intent | `ZOpyG5eQLYdNeXA7UW9w` | SINGLE_OPTIONS | ⚠️ [B] mint dedicated TEXT `Setter Call Intent` → `ghl_call_intent_field_id` |
| Lead Qualified | `zoNSLEjOucDtumqREGoG` | CHECKBOX | ⚠️ [B] mint dedicated TEXT `Setter Lead Qualified` → `ghl_lead_qualified_field_id` |
| Last Call Date | `9rtxGevOeSiJZpD3zFfi` | DATE | ⚠️ [B] mint dedicated TEXT `Setter Last Call Date` → `ghl_last_call_date_field_id` |
| Callback Requested | `qvA1ZKUP2QcwffoTR8DS` | CHECKBOX | ⚠️ [B] mint dedicated TEXT `Setter Callback Requested` → `ghl_callback_requested_field_id` |
| (wired) Setter Call Sentiment | `jWPaRl6ysDgR7KWzW89d` | TEXT | already wired |
| (wired) Setter Appointment Booked | `IJVbAhkWv94dRW6Ddnze` | TEXT | already wired |

**Net wiring (coordinated step 4):** 3 existing fields wire directly; **5 dedicated `Setter *` TEXT fields are [B] to create** then wire. The code writes plain strings/ISO/labels, so it is correct once TEXT-safe ids are in the columns. SMS fields (`Setter SMS *`) are also [B] to create.

**Model-config anomaly (report-only, [B]):** live `clients.llm_model = "~google/gemini-flash-latest"` (free-text field, stray leading `~`). The SMS analyzer normalizes it (`normalizeModel`); but `processSetterReply` + `aiGenerateEngagementCopy` pass `llm_model` **raw** to OpenRouter — the `~` likely breaks those LLM calls too. Brendan should fix the value in the UI (Api Credentials → LLM model) to `google/gemini-flash-latest`.

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

### Verification — FINDINGS ✅ (read-only, 2026-06-19)
- Both field **definitions exist** on location `xo0XjmenBBJxJgSnAdyM`, dataType **TEXT** (`6uO14dISilgbMcn35Ne4` Supabase Service Role Key; `eRGxS6OZhW20KLxP2c1n` Supabase Project URL).
- **No contact holds a value** for either field (contacts scanned = 0 after the clean-slate wipe — so no live secret value found; caveat: 0 contacts means the scan can't disprove future population, but the definitions are the risk surface).
- **No code reads or writes** either field id (grep over `*.ts`/`*.sql`). Deleting them is code-safe.
- **Exposure: LOW today** (definitions only, unpopulated, code-unused) but the names invite a workflow to store a service-role key in a CRM field → delete the definitions.

### [B] action
Delete both field definitions in GHL after confirming no live GHL **workflow** references them. **If a real service-role key value is found, rotate the Supabase service-role key out-of-band regardless of deletion.**

---

## 5. ~101-field cleanup ([B])

Live total confirmed: **116** custom fields (matches the hit-list estimate). See `Docs/GHL_CUSTOM_FIELDS_HITLIST.md` for the full grouped delete list + action order. Gate: confirm no live GHL workflow references a field before deleting. No live deletion this session.

**Finalized KEEP/wire set after §2 type-check:**
- **KEEP + wire directly (3):** AI Call Summary `sbwpZdkcp1OxoAwffLEA`, Callback Datetime `hZxMXCpQM1JTvdSbsV79`, Appointment Datetime `Yu0pBpa0X99NjJbiWa2X` (all TEXT/LARGE_TEXT).
- **KEEP (already wired, TEXT):** Setter Call Sentiment `jWPaRl6ysDgR7KWzW89d`, Setter Appointment Booked `IJVbAhkWv94dRW6Ddnze`.
- **SUPERSEDED by new dedicated `Setter *` TEXT fields (5):** Call Outcome `YD9wo2UYpfsewexEExb6` (SINGLE_OPTIONS), Call Intent `ZOpyG5eQLYdNeXA7UW9w` (SINGLE_OPTIONS), Lead Qualified `zoNSLEjOucDtumqREGoG` (CHECKBOX), Last Call Date `9rtxGevOeSiJZpD3zFfi` (DATE), Callback Requested `qvA1ZKUP2QcwffoTR8DS` (CHECKBOX). BFD will no longer write these; they are **deletable IF no live GHL workflow references them** (else leave — harmless).
- **DELETE (2, security):** `6uO14dISilgbMcn35Ne4`, `eRGxS6OZhW20KLxP2c1n` (see §4).
- **CREATE (9 new TEXT, [B]):** 5 `Setter Call Outcome / Setter Call Intent / Setter Lead Qualified / Setter Last Call Date / Setter Callback Requested` + 4 `Setter SMS Sentiment / Setter SMS Intent / Setter SMS Qualified / Setter SMS Summary`.

---

## 6. Coordinated-deploy list (post-merge)

Verified this session (read-only): `tsc --noEmit` exit 0; `deno test` 26/26 green; webhook `deno check` = only the pre-existing GenericStringError + callDirectionForConv classes (no new class); migration columns not yet live; GHL field types + 6.13 confirmed live.

1. **Apply migration** `20260619120000_ghl_outcome_field_ids.sql` (additive nullable columns on `clients` + `leads.last_sms_analyzed_at` — backward-compatible).
2. **Redeploy edge fn** `retell-call-analysis-webhook` (6.11 stamp + 6.12b call outcome writes). Deploy with `--use-api --no-verify-jwt` like the others.
3. **Deploy edge fn** `analyze-sms-conversation` (`--use-api --no-verify-jwt`) + **one Trigger deploy** for `analyzeSmsConversations` — coordinate this single Trigger deploy with the feature session (shared deploy surface).
4. **Wire TEXT-safe ids now** (no field creation needed) on the BFD client `e467dabc-57ee-416c-8831-83ecd9c7c925`:
   ```sql
   update clients set
     ghl_call_summary_field_id='sbwpZdkcp1OxoAwffLEA',
     ghl_callback_datetime_field_id='hZxMXCpQM1JTvdSbsV79',
     ghl_appointment_datetime_field_id='Yu0pBpa0X99NjJbiWa2X'
   where id='e467dabc-57ee-416c-8831-83ecd9c7c925';
   ```
5. **[B] Create 9 dedicated TEXT custom fields** in GHL, then wire their ids:
   - Call path (5): `Setter Call Outcome` → `ghl_call_outcome_field_id`; `Setter Call Intent` → `ghl_call_intent_field_id`; `Setter Lead Qualified` → `ghl_lead_qualified_field_id`; `Setter Last Call Date` → `ghl_last_call_date_field_id`; `Setter Callback Requested` → `ghl_callback_requested_field_id`.
   - SMS path (4): `Setter SMS Sentiment/Intent/Qualified/Summary` → `ghl_sms_*_field_id`.
   (Existing typed fields stay untouched; they're superseded — delete only if no workflow references them, see §5.)
6. **[B] 6.12a** marketplace conversation provider (runbook §3) + set `ghl_conversation_provider_id`.
7. **[B] 6.13** delete the 2 security field definitions (low exposure, code-unused); rotate the Supabase service-role key only if a value is ever found populated.
8. **[B] model fix**: set `clients.llm_model` to `google/gemini-flash-latest` (drop the stray `~`).
9. **[B] ~101-field cleanup** (hit-list), after confirming no workflow refs.

## Notes for Brendan (report-only)
- **"Lead Qualified" source**: written from the agent's `success_rate` boolean (live agent defines it as "user asked ≥3 questions"), falling back to `call_successful`. Functional; refine the source later if a different qualification signal is preferred.
- Code review (adversarial, full diff) returned **no Critical/Important issues**; isolation contract verified clean; 26/26 deno tests green; `tsc` exit 0.

## Decisions (defaults, documented)
- Stamp clears `active_call_id`; narrow 500-on-write-failure retry; dedicated SMS fields (no clobbering call outcomes); typed appt-booked `nMV3jNAZIZyrclc6H5N3` left untouched (keep dedicated TEXT `IJVbAhkWv94dRW6Ddnze`).
