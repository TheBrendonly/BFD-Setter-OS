# Voice Agent Latency Investigation (2026-06-10)

**Status:** Research complete. Root cause identified and measured. No changes applied yet.
**Symptom:** Lag between the lead finishing speaking and the setter responding is too long for natural conversation. Leads say "You there?" / "Hello?" mid-call and hang up.
**Method:** Live per-call telemetry from the Retell API (`latency`, `llm_token_usage`, `public_log_url`, `tool_calls`), Retell engine logs, full audit of the agent-config push path in this repo, audit of `voice-booking-tools`, and external research verified against Retell's documentation.

---

## 1. Root cause (measured, not theorized)

The live voice setter prompts reference the template variable `{{available_time_slots}}` **19-21 times each** in their instruction text. Retell substitutes the **full ~11,257-character slots JSON at every occurrence**. A ~55k-character saved prompt therefore resolves to **~270-291k characters (~155-230k tokens) sent to the LLM on every conversational turn**.

Consequences, from Retell's own data:

| Metric | Fast calls (May 17 era / Crazy Gary now) | Slow calls (June, canonical agents) |
|---|---|---|
| Tokens per LLM request (`llm_token_usage.average`) | 2.5k-16k | **149k-189k** |
| LLM latency p50 | 0.66-1.0s | **2.0-6.4s** |
| Voice-to-voice e2e p50 | 1.2-1.4s | **2.6-6.8s** |
| TTS / ASR p50 | ~175ms / ~250ms | ~175ms / ~250ms (fine, unchanged) |

Retell's documented normal range for LLM latency is **500-900ms**, with **e2e P90 > 3s** as the official troubleshooting trigger (verified verbatim at docs.retellai.com/reliability/troubleshoot-latency). The June agents run 3-7x beyond that line.

### The smoking-gun call (`call_b9fb9836785e9405e73b89aecc4`, 2026-06-10, Voice-Setter-Test)

- Engine log (`public_log_url`) shows **9x** `"Streaming LLM response attempt 1 failed: 4500ms timeout reached for first token"`. gemini-3.0-flash cannot start streaming over a ~190k-token context inside Retell's 4.5s first-token timeout, so Retell silently retries, re-sending the giant context each time.
- Timeline: lead answered at 2.3s; agent's first word at **8.5s** (2,000ms configured `begin_message_delay_ms` + slow first generation), and the greeting was cut off and restarted at 14s. Later: a **24s stall** after "Can we do Friday at eleven AM?", then **51s of dead air** after the lead confirmed, during which the lead said "You there?"/"Hello?" four times, swore, and hung up.
- `tool_calls = []`: **no booking tool was ever invoked.** The post-call analysis "Call Booked" was wrong. The stalls were pure LLM timeout loops, not slow tools.
- Cost: ~5.1M LLM tokens billed on this 3.3-minute call. `llm_token_surcharge` was **92% of the call's cost** (474.6 of 516.6 units). Fixing latency also cuts voice-call cost roughly 10x.

### Fleet state (verified live via Retell API)

| Agent | Model | Saved prompt | `{{available_time_slots}}` count | Resolved context |
|---|---|---|---|---|
| Voice-Setter-Test (dogfood; takes the live calls) | gemini-3.0-flash | 54,966 ch | **21** | ~291k ch |
| Gary - Mortgage Broker | gemini-3.0-flash | 53,617 ch | **19** | ~268k ch |
| Gary - Property Coach | gemini-3.0-flash | 55,411 ch | **19** | ~269k ch |
| Gary - Finance Strategist | gemini-3.0-flash | 54,784 ch | **19** | ~269k ch |
| Gary - Crazy Gary | gemini-3.0-flash | 3,570 ch | 0 | 3.6k ch (the fast control) |
| Voice-Setter-master | **gpt-5.4** | 69,952 ch | 1 (correct pattern) | ~81k ch |

### Why we are confident (three independent cross-checks)

1. **Natural experiment, same day:** Crazy Gary (3.5k prompt, 0 slot references, same model and identical voice/turn-taking settings) ran at 1.0s LLM / 1.3s e2e on 2026-06-09. The big-prompt agents ran 2.0-6.4s LLM the same week.
2. **Longitudinal, same pipeline:** May 17 calls ran 0.66-0.73s LLM / 1.2-1.4s e2e at 15.7k tokens/request, before the prompts ballooned. Nothing else in the pipeline changed.
3. **Token math matches billing:** 21 substitutions x 11.3k chars of timestamp-dense JSON (~2.5 ch/token) + prompt + tools + conversation ≈ the measured ~155k-token request series, and 27 requests x ~189k average ≈ the ~5.1M tokens Retell billed.

Ruled out: TTS (175ms), ASR (250ms), `responsiveness` 0.97 (good), `interruption_sensitivity` 0.9 (documented as barge-in only, not response speed), backchannel, knowledge bases (none attached), network/region (May calls on the same stack were fast).

### Secondary findings

- The ~55k prompts contain **duplicated sections** (~17% of long lines are exact duplicates; the booking block appears twice).
- `begin_message` is None, so the greeting requires a full LLM generation; `begin_message_delay_ms` is 2,000 (Retell default is 0). Together these explain the 6-8s silent openings.
- `voice-booking-tools` (matters once tools actually fire): no fetch timeouts, no retries, **sequential** GHL phone-then-email contact searches, and a **blocking** cadence-cancellation loop (per-row Trigger.dev cancel calls) before responding to Retell — worst case ~35-50s. `book-appointments` has `speak_after_execution: false`, so even a successful booking ends in silence.
- The two interleaved per-request token series (~155k and ~230k) imply two internal Retell request classes; exact decomposition would need Retell support, but it does not change the fix.

---

## 2. Recommendations

### Tier 0 — Brendan, via the setter UI (no code; biggest win; ~1 hour)
Per the no-prompt-edits rule these are reported, not applied. The editable "Verify Setter Prompt" box (shipped 2026-06-10) is the tool for this.

1. In each big-prompt setter, keep **exactly ONE** real `{{available_time_slots}}` substitution (in the dynamic-variables/booking-data section) and reword the other 18-20 instruction-text mentions to plain words (e.g. "the available slots list"). Expected: resolved context ~291k → ~65k chars; LLM p50 back to ~0.7-1.2s (the May data and Crazy Gary prove the pipeline does this).
2. De-duplicate the prompt (booking/identity sections appear twice) and trim toward the ~15k-char repo baseline.
3. Optional same session: set a static `begin_message` (e.g. "Hey {{first_name}}, it's Gary from …") so the greeting is instant TTS; lower `begin_message_delay_ms` 2000 → ~500-800ms.
4. Fix Voice-Setter-Test first, place a test call, compare against an unedited Gary as control, then roll out.

### Tier 1 — code changes (this repo), after Tier 0
1. **Push-time guard in `retell-proxy`:** count `{{available_time_slots}}` (and other large vars) in `generalPrompt`; warn or auto-collapse >1 occurrence so this never regresses.
2. **Compact slots payload** in `make-retell-outbound-call` (`buildAvailabilityDynamicVariable`): 11.3k chars of JSON for 30 days → compact per-day format (~2k chars).
3. **Harden `voice-booking-tools`:** parallelize phone+email GHL contact searches; add ~10s fetch timeouts + 1 retry; make the cadence-cancel loop fire-and-forget after responding to Retell; flip `book-appointments` to `speak_after_execution: true` so bookings are verbally confirmed.
4. **Latency visibility:** surface `get-call.latency` (e2e/llm p50/p90) and `llm_token_usage.average` in the call-log UI so regressions are spotted immediately.

### Tier 2 — within Retell, after Tier 0/1
- Model A/B at small prompt size: gemini-3.0-flash vs gpt-4.1-mini vs claude-4.5-haiku. **Move Voice-Setter-master off gpt-5.4** (reasoning-class deliberation adds seconds per turn; Retell support's documented fix for a comparable case was switching to Haiku/4.1-mini class).
- Keep `model_high_priority: true` (already on for all agents; Retell: 25% faster average, 50% less variance, 1.5x per-minute cost).
- Optional micro-levers: `stt_mode` accurate → fast (~100ms class; Retell's default is fast); `enable_dynamic_responsiveness` A/B. Leave `responsiveness` and `interruption_sensitivity` as-is.

### Tier 3 — outside the box (only if "sub-second always" becomes the goal)
- **Retell Custom-LLM WebSocket:** run our own LLM endpoint (4.1-mini/Haiku class) with token streaming and cached openers/objection responses; latency becomes fully ours to control.
- **Speech-to-speech (OpenAI Realtime class) via Retell:** removes the cascaded ASR→LLM→TTS floor; Retell documents 600-1,000ms average at ~$1.5/min.
- **Self-hosted pipeline (LiveKit/Pipecat): NOT recommended now** — months of work to beat a config fix that demonstrably reaches ~1.2s e2e, and only worth evaluating above ~10k minutes/month.

---

## 3. Realistic targets after the fix

| Metric | Now (June, big prompts) | Target post-Tier-0 | Evidence it's reachable |
|---|---|---|---|
| LLM p50 | 2.0-6.4s | **< 1.2s** | May-era 0.66-0.73s; Crazy Gary 1.0s |
| Voice-to-voice p50 | 2.6-6.8s | **~1.0-1.4s** | May-era 1.2-1.4s; industry P50 1.4-1.7s |
| e2e P90 | 3.3-7.3s | **< 2.5s** | Retell threshold 3s; practitioner target 2.5s |
| Tokens/request | 149k-189k | **< 25k** | Static content is ~17-20k tokens |
| First-token timeouts | Frequent | **Zero** | None observed on small-prompt calls |

## 4. Verification plan (after Brendan's Tier 0 edit)

1. Edit one setter (Voice-Setter-Test) → place one test call → pull `GET /v2/get-call/{id}`: expect `llm_token_usage.average` < 25k, `latency.llm.p50` < 1.2s, and zero "4500ms timeout" lines in `public_log_url`.
2. Compare with an unedited Gary as control; then roll the edit to Mortgage/Property/Finance and re-check.
3. After Tier 1 code lands: re-run the booking flow end-to-end; `tool_calls` must be populated and the agent must verbally confirm the booking.

## 5. Diagnosis kit (for any future latency question)

- `GET https://api.retellai.com/v2/get-call/{call_id}` → `latency` (e2e/llm/tts/asr percentiles per call), `llm_token_usage` (average tokens per LLM request), `tool_calls` (empty array = tool never fired, regardless of what call analysis claims), `public_log_url` (engine log; grep for `timeout reached for first token`).
- `POST /v3/list-calls` for bulk pulls (note: returns `{items, pagination_key}`; the Retell MCP server strips the `latency` object, use REST directly).
- API key: `BFD_RETELL_API_KEY` in the project `.env`.

---

*Investigation 2026-06-10/11. Sources: Retell API telemetry (200-call sample, 146 with latency data), Retell engine logs, repo audit (retell-proxy, voice-booking-tools, make-retell-outbound-call, prompt assembly), docs.retellai.com (claims verified verbatim), plus indicative third-party benchmarks (Hamming, Artificial Analysis, ElevenLabs docs).*
