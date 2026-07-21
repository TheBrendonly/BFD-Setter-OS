# BFD-Setter — FIRST-CLIENT ARMING RUNBOOK (PREP ONLY)

**Status: PREP / REPORT ONLY. Nothing in this document is armed.** This is an ordered, rollback-aware runbook for the
event-gated first-client go-live "arming" steps. It flips **nothing** by existing: no live gate is set, no Stripe /
Twilio / Supabase write is made, no env var is changed, no secret is armed. Writing this doc is the whole deliverable.

**Do NOT execute any step here until a contract actually signs.** The canonical execution runbook remains
`Docs/FIRST_CLIENT_MILESTONE.md` (trigger: Brendan says "I'm onboarding a client"). This file is the pre-flight:
the exact ordered steps, the exact verification for each, and the exact rollback, so arm-day is calm and reversible.
Backlog/index of everything the milestone must cover: `Docs/FIRST_CLIENT_TASKS.md`.

Sourced from: `Docs/FIRST_CLIENT_MILESTONE.md`, `Docs/FIRST_CLIENT_TASKS.md`, `Docs/DEFERRED.md`,
`Docs/SECURITY_REVIEW_2026-07-08.md`, `Docs/SECURITY_REVIEW_2026-07-07.md`,
`frontend/supabase/functions/_shared/assertActiveSubscription.ts`, `frontend/supabase/functions/_shared/verify-webhook.ts`,
`scripts/onboard-client.mjs`, `SOP/CLIENT_ONBOARDING_SOP.md`.

Platform Supabase ref `bjgrgbgykvjrsuwwruoh`. Live DB writes via the Supabase Management API `/database/query` (NOT the
postgres MCP). No em dashes in generated copy.

---

## 1. Preconditions (must be true before ANY arming)

| # | Precondition | State today | Verify |
|---|---|---|---|
| P0 | **GATE A (RLS role-gate) shipped** | ✅ DONE 2026-07-13 (Opus 4.8, plan-approved). 3 migrations + 4 edge fns + ticker role-branch; 24/24 client-role probe. `FIRST_CLIENT_TASKS.md:21-48`. | `pg_policies` shows `clients` command-split + `guard_client_clients_update`; `clients_public` is `security_definer`. |
| P1 | **A signed contract exists** | Event gate. Do not proceed on a verbal. | Brendan confirms signature (setup fee 50% at signature per the offer). |
| P2 | **Brendan-supervised window** | Required. GATE A/B + Stripe are high-blast-radius; not unattended. `SECURITY_REVIEW_2026-07-08.md:33,63`. | Brendan present for the whole arm-day pass, authenticator ready (agency login is TOTP + single-use refresh token, see project CLAUDE.md). |
| P3 | **M1 Resend SMTP done** (pulled to step 0) | Deferred-to-onboarding by design. Brendan 2026-07-07 + **2026-07-21 decision: do Resend + Supabase backups at onboarding-START, not mid-run.** `FIRST_CLIENT_MILESTONE.md:67-73`. | Supabase Auth custom SMTP `smtp_host/user/pass/sender` non-NULL; `RESEND_API_KEY` set on Trigger.dev prod; F14 invite E2E lands on "Set Your Password". |
| P4 | **Supabase backups armed** (pulled to step 0) | Per Brendan 2026-07-21, paired with P3 at onboarding-start. | Supabase project shows PITR / daily backups enabled (pairs with the Supabase Pro flip that HIBP also needs). [TBC — confirm Pro tier is active] |
| P5 | **M2 Setter-1 prompt migration** | ✅ DONE 2026-07-07 (no longer a prerequisite). `FIRST_CLIENT_MILESTONE.md:74`. | n/a |

**Step 0 (do FIRST, per the 2026-07-21 decision):** complete P3 (Resend) and P4 (Supabase backups) before touching Stripe
or the webhook secrets. They were deliberately pulled forward to the start of onboarding so email + backups exist before
any live client data flows. Resend steps: free Resend account → verify `buildingflowdigital.com` DKIM/SPF DNS → API key →
PATCH Supabase Auth custom SMTP + set `RESEND_API_KEY` on Trigger.dev prod + a report recipient. Payload:
`Operations/handoffs/2026-07-02-usage-billing-auth.md`. **Rollback for step 0:** NULL the SMTP columns back / unset
`RESEND_API_KEY` (reverts to Supabase default email); backups are additive, no rollback needed.

---

## 2. Stripe go-live (subscription enforcement)

The server-side gate `_shared/assertActiveSubscription.ts` **ships dormant**: it is a no-op unless
`ENFORCE_SUBSCRIPTION_GATE === "true"` (`assertActiveSubscription.ts:8,32-33`). It is wired into the billable leaf
actions (`intake-lead`, `twilio-send-sms`, `make-retell-outbound-call`, `campaign-enroll-webhook`). Passing statuses are
`active` and `grace_period`; `is_system` clients (the synthetic probe) and the globally-oldest client are exempt
(`assertActiveSubscription.ts:29,50-61`).

**Order matters: backfill statuses BEFORE flipping the env var, or you break every not-yet-`active` client, the probe,
try-gary, and the dogfood client** (`assertActiveSubscription.ts:10-13`).

### Test-mode-first plan (Stripe)
Build the products/prices in **Stripe TEST mode first**, run a full block/allow proof against a test client, and only
then create the live-mode equivalents. Products to model on the offer (`project_first_client_pricing_strategy_2026_07_01`,
`Company/knowledge/sales-assets/first-client-offer-and-discovery-playbook.md`):

| Line | Amount (AUD) | Notes |
|---|---|---|
| Setup fee (one-off) | **A$2,500** | 50/50 at signature / go-live. |
| Managed retainer (monthly) | **A$2,000/mo** target (floor A$1,500) | The recurring subscription that drives `subscription_status`. |
| Internal voice-minute pool | **1,500 min** (client never sees it) | NOT a Stripe line: internal margin guardrail. Overage footnote A$1.25/min. Do NOT model as a metered Stripe price unless Brendan wants overage billed. [TBC — Brendan confirms whether overage is invoiced via Stripe or absorbed] |
| DB reactivation (optional) | A$2,500 flat/blast | Separate one-off, gate on consent first. Not part of the recurring sub. |

SMS is client-BYO Twilio (their cost + legal liability), kept out of Stripe entirely.

### Steps

| # | Step | Verify | Rollback |
|---|---|---|---|
| S1 | Backfill `subscription_status` on every real client to `active` (or `grace_period`). New client from `onboard-client.mjs` is born `active` (`onboard-client.mjs:22,36`); UI-created clients are born `free` and must be flipped. | `SELECT id, subscription_status, is_system FROM clients` shows no non-exempt client left on `free`. Confirm `is_system=true` on the probe and `active` on the oldest client. | `UPDATE clients SET subscription_status='<prior>'` from the pre-change snapshot (take one first). |
| S2 | Create Stripe **test-mode** products/prices matching the table above; wire the test webhook to `stripe-webhook`. | Test checkout writes a `stripe_webhook_events` row and sets the test client `subscription_status`. | Delete/archive the test products; they are test-mode, no live effect. |
| S3 | Set `ENFORCE_SUBSCRIPTION_GATE=true` (edge-fn env). **Only after S1.** | Prove a **delinquent** test client (status `free`/`past_due`, not exempt) gets **402 "Subscription inactive"** from a billable leaf; prove an **active** client is NOT blocked. `assertActiveSubscription.ts:66-67`. | Set `ENFORCE_SUBSCRIPTION_GATE=false` (instant revert to dormant no-op). |
| S4 | Create Stripe **live-mode** products/prices; point the live webhook secret at `stripe-webhook`. | A real (or Brendan-driven) live subscription flips the client to `active` via the webhook. | Cancel the live subscription in Stripe; flip `subscription_status` back manually. |

**Env note:** the env var is the master kill-switch. If anything misbehaves after go-live, set
`ENFORCE_SUBSCRIPTION_GATE=false` first (restores the shipped dormant behavior) and diagnose with the gate off.
Do NOT set the var here in prep.

---

## 3. Webhook signing secrets (GATE B)

Three columns exist on `clients` and are **verify-if-present** (inert while NULL, enforced once set):
`retell_webhook_secret`, `ghl_webhook_secret`, `unipile_webhook_secret` (`types.ts:1346,1385,1415`). Live state
2026-07-11: `0` clients with `retell_webhook_secret`; `ghl_webhook_secret` IS set for both internal clients (GHL
webhooks are signature-enforced today); `missed_call_textback_enabled` = `0` clients (`FIRST_CLIENT_TASKS.md:11-14`,
`SECURITY_REVIEW_2026-07-08.md:21`).

### 3a. Retell (`retell_webhook_secret`)

- **What the secret IS:** the client's **Retell API key** (the org webhook key), NOT a separate value. Retell signs
  `X-Retell-Signature: v={ts},d={hex}` where `hex = HMAC_SHA256(rawBody + ts, RETELL_API_KEY)` with a 5-min replay
  window (`verify-webhook.ts:2-8,33-73`).
- **Where stored:** `clients.retell_webhook_secret` (plaintext at rest today; encryption is deferred, `DEFERRED.md:41`).
- **What it covers:** arming it authenticates **all three Retell receivers at once** (`retell-call-webhook`,
  `retell-call-analysis-webhook`, `retell-inbound-webhook`) — they byte-share `verify-webhook.ts`
  (`SECURITY_REVIEW_2026-07-08.md:27`, `FIRST_CLIENT_TASKS.md:52-54`).
- **Arm step:** set `clients.retell_webhook_secret = <the client's Retell API key>`; configure Retell dashboard webhook
  signing to the same key; make **one controlled live call**.
- **Verify:** the controlled call's webhooks are accepted (no 403); a forged/unsigned POST is rejected.
- **Rollback:** on ANY 403, `UPDATE clients SET retell_webhook_secret = NULL` (reverts all three receivers to the
  status-quo forgeable-but-functional state; do not leave them 403-ing live traffic).

### 3b. GHL (`ghl_webhook_secret`)

- **What the secret IS:** a **generated static `x-wh-token`** value, added as a custom header on the GHL Workflow
  "Custom Webhook" action (BFD's canonical Pattern-B ingress). The receiver accepts either a static `x-wh-token` equal
  to the secret OR an HMAC-SHA256 `x-wh-signature` over the raw body (`sync-ghl-contact/index.ts:343-363`,
  `ghl-tag-webhook/index.ts:399-405`, `verify-webhook.ts:76-91`).
- **IMPORTANT:** GHL **native Webhook V2 signs with RSA (not HMAC)**, which is NOT supported. Provision the secret as a
  **static token** (SOP §5.3), configured as a custom header in the GHL Workflow, NOT as a native Webhook V2 secret, or
  real traffic 403s (`sync-ghl-contact/index.ts:349-351`).
- **Where stored:** `clients.ghl_webhook_secret` + the identical value pasted as the `x-wh-token` custom header in every
  GHL Workflow webhook action for that client's location.
- **Generate the token ON ARM-DAY (do NOT commit a usable secret to git):**

  ```
  openssl rand -hex 32
  ```

  Generate it at arm-time and paste the SAME value into both the DB column and the GHL workflow header. Deliberately
  NOT pre-generated here: a token embedded in this committed doc would live in git history (incl. the GitHub mirror)
  forever once armed. The value only has to match on both ends.
- **Arm step:** `UPDATE clients SET ghl_webhook_secret = '<token>'`; add the same token as an `x-wh-token` custom header
  on each GHL Workflow webhook action.
- **Verify:** a real GHL workflow fire is accepted; a POST without the header 403s.
- **Rollback:** `UPDATE clients SET ghl_webhook_secret = NULL` (reverts to inert/unauthenticated). Note the internal
  clients already have this SET, so for the new client this is a first-arm, not a change.

### 3c. Unipile (`unipile_webhook_secret`)

- **What the secret IS:** a static custom-header token (Unipile is assumed to use the static-header model, NOT HMAC).
  The receiver constant-time compares the configured secret against the header value (`verify-webhook.ts:76-91`).
- **CAVEAT:** Unipile's signing scheme is not documented as HMAC. **Confirm the exact header name + value against the
  live Unipile webhook config BEFORE arming.** Until confirmed, leave `unipile_webhook_secret` NULL / inert
  (`verify-webhook.ts:80-84`). Only arm if the client actually uses the LinkedIn/IG (Unipile) channel.
- **Where stored:** `clients.unipile_webhook_secret`.
- **Arm step:** [TBC — confirm Unipile header name/scheme] then set the column + configure the Unipile side.
- **Verify:** a real Unipile event is accepted; a forged one is rejected.
- **Rollback:** `UPDATE clients SET unipile_webhook_secret = NULL`.

### 3d. F16C-SMS-1 fail-closed precondition (BEFORE enabling F16(c) missed-call text-back)

- **What it is:** the F16(c) missed-call text-back sends an SMS to a caller-controlled `from_number` off a public
  (`verify_jwt=false`) endpoint — an SMS-pumping / toll-fraud vector unless the webhook is authenticated
  (`SECURITY_REVIEW_2026-07-07.md:28`).
- **The guard is already shipped:** `retell-call-webhook` **v24** carries the fail-closed
  `shouldSendMissedCallTextback` predicate — it returns `false` unless `signatureVerified === true`, i.e. the tenant's
  `retell_webhook_secret` is armed AND the HMAC checked out (`missedCallTextback.ts:1-39`, esp. `:31`;
  `FIRST_CLIENT_TASKS.md:68-70`).
- **Precondition to honor:** keep `missed_call_textback_enabled = false` until **after** 3a (Retell secret) is armed and
  proven. Enabling it while `retell_webhook_secret` is NULL means `signatureVerified` is always false, so the feature is
  inert anyway; but do not flip the flag on until the secret proves out, so a real signed missed call actually sends.
- **Siblings closed by arming 3a:** RETELL-BOOKING-SMS-1 (forged booking-confirm SMS to attacker number, High),
  RETELL-CALLHIST-POISON-1 (Med), RETELL-CALLBACK-DIAL-1 (Med), RETELL-INBOUND-PII-1 (Low)
  (`FIRST_CLIENT_TASKS.md:59-67`, `SECURITY_REVIEW_2026-07-08.md:35-46`). The same `signatureVerified` fail-closed
  pattern should be applied to the auto-actions in `retell-call-analysis-webhook` + `retell-inbound-webhook` at arm time
  (`SECURITY_REVIEW_2026-07-08.md:65`) — CODE step, folded into the milestone, not this prep doc.

---

## 4. AU SMS A2P registration answers (DRAFT)

For **`+61481614530`**. Under BYO-Twilio the CLIENT is the carrier-of-record and legal sender; this draft is the
questionnaire content, to be submitted on the account that owns the number (BFD's for the dogfood number, or the
client's own Twilio for their number). Plain Twilio long codes are **exempt from the ACMA Sender ID Register** (live
1 July 2026); register an alpha sender ID **only** if the client wants branded SMS (`FIRST_CLIENT_TASKS.md:79-82`,
`Docs/BRENDAN_TODO.md:100`). Mark every real-business field `[TBC]`.

| Field | Draft answer |
|---|---|
| Business legal name | Building Flow Digital ([TBC — exact registered entity name]) |
| Website | buildingflowdigital.com |
| ABN | [TBC — Brendan to supply] |
| Business address / contact | [TBC — Brendan to supply] |
| Number | +61481614530 (Twilio long code) |
| Use case | Appointment-setting and lead follow-up SMS (conversational two-way: booking, reminders, reschedule). |
| Opt-in description (how leads consent) | Leads provide their mobile number and consent to be contacted when they submit an enquiry form / request a callback / respond to an ad. Consent source, method, and timestamp are recorded per lead. [TBC — confirm the exact live consent-capture wording on the client's form] |
| Opt-out | "Reply STOP to unsubscribe" — implemented in code: the `OPT_OUT_FOOTER = "Reply STOP to unsubscribe"` ships on commercial sends (`trigger/_shared/optOutFooter.ts:17`), and `receive-twilio-sms` honors STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT/OPT-OUT (`receive-twilio-sms/index.ts:49-52`). |
| Volume estimate | [TBC — Brendan to supply; low initial volume, one client, one agent first] |
| Alpha sender ID | Not registered (long code is ACMA-exempt). Register only if branded SMS is wanted. [TBC] |

**Sample messages (each SHOWS the STOP footer):**

1. **Cadence first-touch:** "Hi {{first_name}}, it's {{agent_name}} from {{business_name}} following up on your enquiry. Do you have 2 minutes for a quick call to find a time that suits? Reply STOP to unsubscribe."
2. **Follow-up:** "Hi {{first_name}}, just checking back in about booking your {{service}} appointment. Happy to work around your schedule. What day suits you best? Reply STOP to unsubscribe."
3. **Booking confirmation:** "You're booked, {{first_name}}. {{business_name}} appointment confirmed for {{appt_time}}. Reply RESCHEDULE if you need a different time, or STOP to unsubscribe."

---

## 5. Arming order + master checklist (arm-day)

Single ordered sequence. Each item has a checkbox and its verification. Do these top to bottom; do not skip ahead.

- [ ] **0. Step 0 — Resend SMTP + Supabase backups** (P3/P4). Verify: F14 invite E2E lands on "Set Your Password"; backups enabled.
- [ ] **1. Confirm preconditions** (§1): GATE A shipped ✅, contract signed, Brendan-supervised window, authenticator ready.
- [ ] **2. Snapshot** current `clients.subscription_status` + the three webhook-secret columns (for rollback). Verify: snapshot saved.
- [ ] **3. Onboard the client** via `scripts/onboard-client.mjs` (BYO Twilio SID/token/E.164, GHL location + PIT, calendars, setter provisioning, external Supabase project). Verify: dry-run first (`--dry-run`), then real run; client row exists; **FRESH agency minted for this client** (RLS-UISTATE-1, `FIRST_CLIENT_TASKS.md:104-105`).
- [ ] **4. Stripe S1** — backfill `subscription_status=active` on real clients. Verify: no non-exempt client on `free`; probe `is_system`; oldest `active`.
- [ ] **5. Stripe S2/S3** — test-mode products, then `ENFORCE_SUBSCRIPTION_GATE=true`. Verify: delinquent test client → 402; active client passes.
- [ ] **6. Arm GHL `ghl_webhook_secret`** (§3b) — DB + `x-wh-token` header on every GHL Workflow action. Verify: real GHL fire accepted; headerless POST 403s.
- [ ] **7. Arm Retell `retell_webhook_secret`** (§3a) — = the client's Retell API key + Retell dashboard signing. One controlled live call. Verify: call webhooks accepted; forged/unsigned rejected. On any 403 → NULL the column (rollback) and stop.
- [ ] **8. Apply the F16C-SMS-1 fail-closed guard to the analysis + inbound webhooks** (CODE, milestone step; `SECURITY_REVIEW_2026-07-08.md:65`), THEN optionally flip `missed_call_textback_enabled=true`. Verify: forged unsigned `call_ended` → suppressed warn + NO SMS; real signed missed call → SMS sent.
- [ ] **9. Unipile** (§3c) — ONLY if the client uses the channel and the header scheme is confirmed. Verify: [TBC] or leave NULL.
- [ ] **10. AU A2P** — submit the §4 questionnaire on the number-owning Twilio account. Verify: submission accepted; confirm AU handset delivery on a real send.
- [ ] **11. Compliance close-out** — recording disclosure ON for the client's agent (PU-6), calling-hours enforcement confirmed (F17 phase 1), consent source/method/timestamp recorded; flip HIBP if Supabase Pro landed (`FIRST_CLIENT_TASKS.md:131-135`).
- [ ] **12. Billing config** — set per-client billing anchor day + client-visibility toggles (Sub-Account Config → Cost-to-Price Calculator); sanity-check the `sms_llm` seed rate (`FIRST_CLIENT_TASKS.md:124-129`).
- [ ] **13. FULL SMOKE of the CLIENT's own flows** — **one voice booking, one SMS booking, one cadence step** end-to-end (`FIRST_CLIENT_MILESTONE.md:52-53`). Verify: booking lands in GHL; cost events accrue (COST-1/2/3); no 403s; client login sees only its own data.

---

## 6. Rollback summary table

| Armed thing | One-line rollback |
|---|---|
| Resend SMTP (step 0) | NULL the Supabase Auth `smtp_*` columns + unset `RESEND_API_KEY` (reverts to Supabase default email). |
| `subscription_status` backfill | `UPDATE clients SET subscription_status='<prior>'` from the pre-change snapshot. |
| `ENFORCE_SUBSCRIPTION_GATE=true` | Set it `false` — instant revert to the shipped dormant no-op (`assertActiveSubscription.ts:33`). |
| Stripe live products/subscription | Cancel the live subscription in Stripe + flip `subscription_status` back manually. |
| `retell_webhook_secret` | `UPDATE clients SET retell_webhook_secret = NULL` on any 403 (reverts all 3 Retell receivers at once). |
| `ghl_webhook_secret` | `UPDATE clients SET ghl_webhook_secret = NULL` (reverts to inert). |
| `unipile_webhook_secret` | `UPDATE clients SET unipile_webhook_secret = NULL`. |
| `missed_call_textback_enabled=true` | Set it `false` (feature default-OFF; also inert while the Retell secret is NULL). |
| AU A2P submission | Withdraw/cancel the pending Twilio registration; long-code sending continues (ACMA-exempt). |

---

*Prep doc only. Execution is gated on a signed contract and runs from `Docs/FIRST_CLIENT_MILESTONE.md` under Brendan's
supervision. Update this runbook if the offer figures, the webhook mechanics, or the gate wiring change.*
