# Internal by-phone lead resolution — Spec 1 (go-forward correctness)

- **Date:** 2026-06-18
- **Status:** Approved design (pre-plan)
- **Author:** Brendan + Claude
- **Supersedes/relates:** roadmap 6.4 (lead-edit persistence) + 6.5 (STOP/inbound internal by-phone). This is the FIRST of a two-spec pivot; the historical merge is **Spec 2 (deferred)**.

## Context

BFD-setter identifies leads by the **GHL contact id** (`leads.lead_id`), not by phone. Every ingress
(intake-lead, inbound SMS, inbound voice, booking) resolves identity by calling GHL search-or-create and
writing `lead_id = <GHL contact id>`, with `UNIQUE(client_id, lead_id)` as the only uniqueness. The phone
index is deliberately **non-unique**, so one human phone fragments into N lead rows. This was confirmed live
during the 2026-06-18 verification session, when a successful voice booking attached to the *wrong* duplicate
contact.

Live evidence (dogfood client `e467dabc-57ee-416c-8831-83ecd9c7c925`): **`+61405482446` → 10 distinct lead
rows / 10 GHL contact ids**, all `setter_stopped=false`; `+61467853118` → 2 rows; 9 of 21 rows have NULL phone.
`lead_optouts` is empty.

Three live bugs all stem from the GHL-keyed, no-phone-uniqueness identity model:
- **BUG C (booking → wrong contact):** `voice-booking-tools` `resolveContactId` does GHL
  `/contacts?limit=1&query=<phone>` and takes `contacts[0]` (`voice-booking-tools/index.ts:287-304`),
  arbitrary across the 10 dupes.
- **Booking origin lost:** `voice-booking-tools` stamps `source='voice_call'` (`:523`) but `bookings-webhook`
  re-upserts the same `(client_id, ghl_appointment_id)` row and overwrites `source='ghl_calendar'`
  (`bookings-webhook/index.ts:217-218`). Verified: 0/6 rows are `voice_call`.
- **BUG B (edits revert):** `ContactDetail.handleSaveContact` pushes edits to GHL via `push-contact-to-ghl`;
  GHL's `contact.update` webhook re-enters `sync-ghl-contact`, which overwrites the lead from GHL
  (`sync-ghl-contact/index.ts:432-444`). The only guard is a leaky 60s echo check, and the writeback uses
  `if (value)` so a cleared field can never be re-cleared but can be repopulated.
- **STOP split-brained / re-arm leak:** inbound-SMS STOP is by-phone, but the UI STOP buttons stop one row by
  uuid (`stop-bot-webhook/index.ts:71-77`) — and the ContactDetail STOP is silently broken (passes a text
  `lead_id` against the uuid PK column, matches 0 rows). The real send-path gate is `leads.setter_stopped`;
  `lead_optouts` (already `(client_id, phone)`) is **never read on any send path**, so a freshly re-ingested
  duplicate is born `setter_stopped=false` and re-arms a stopped phone.

## Goals (this spec)

Make every **go-forward** lead resolution deterministic and by-phone, stop creating new duplicates, make
STOP/opt-out real and by-phone-enforced, preserve voice booking origin, and stop GHL overwriting BFD edits —
**without** the risky historical migration.

## Non-goals (deferred to Spec 2: historical merge)

- `UNIQUE(client_id, normalized_phone)` constraint.
- Merging the 10 existing duplicate rows per phone.
- Repointing child tables (`engagement_executions`, `bookings`, `campaign_events`, `dm_executions`,
  `scheduled_callbacks`) from `ghl_contact_id` to the internal key.
- GHL-side contact merge / cleanup of surplus GHL contacts.
- The `engagement_enrollments` lifecycle state machine (separate uncommitted WIP — do not touch).

## Decisions (locked)

1. **Sequencing:** go-forward correctness first; historical merge is a separate dry-run-first spec.
2. **GHL sync model (BUG B):** keep the BFD→GHL push (edits still reach GHL), but make `sync-ghl-contact`
   **BFD-wins / non-destructive** on identity fields (`first_name/last_name/email/phone`) for existing leads.
3. **Canonical key:** `leads.id` (uuid surrogate) stays the key; add `leads.normalized_phone` (nullable, NO
   unique constraint yet); `lead_id` stays as the GHL-mirror pointer.
4. **Phone normalization:** one shared `normalizePhone()` → strict E.164, per-client default region (BFD = AU;
   default to AU when a client has no region set).
5. **Deterministic survivor (pre-merge):** when multiple rows share a normalized phone, all resolvers pick the
   same row via `ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1` ("most recently active wins").
6. **Booking source:** never downgrade an existing non-`ghl_calendar` source to `ghl_calendar`.

## Design

### 1. `normalizePhone(raw, region)` — shared helper
- E.164 output; per-client default region (BFD = AU, so `0405…` → `+61405…`); returns `null` on unparseable.
- Lives in **both** `trigger/_shared/phone.ts` and `frontend/supabase/functions/_shared/phone.ts` (Deno +
  Node share by copy, matching the existing `_shared` convention). Single source of truth for the logic.
- Replaces the three ad-hoc `+`/no-`+` heuristics (`intake-lead` `normalisePhone`, `receive-twilio-sms`
  `findOrCreateGhlContact` match, `retell-inbound-webhook` last-9-digit suffix).

### 2. `leads.normalized_phone` column (additive, low-risk)
- Migration: `ALTER TABLE leads ADD COLUMN normalized_phone text;` backfill from existing `phone` via the
  normalizer; add **non-unique** index `(client_id, normalized_phone)`. No constraint, so the 10 dupes coexist.

### 3. Deterministic by-phone resolver + stop minting dupes
- Shared resolver `resolveLeadByPhone(client_id, normalized_phone)` → the single survivor (decision 5). Used by
  all ingress so booking / inbound voice / inbound SMS / STOP **converge on the same row**.
- Rewire the GHL-first identity points to resolve internally first, mirror to GHL second (never `contacts[0]`
  for identity, never create a GHL contact / lead when one already exists for the phone):
  - `voice-booking-tools` `resolveContactId` + `toolLookupContact` (`:271-367`, `:743-754`) — fixes the
    wrong-contact booking.
  - `receive-twilio-sms` `findOrCreateGhlContact` (`:320-392`, `:616`) — stop minting `SMS Lead` contacts.
  - `retell-inbound-webhook` (`:98-125`) — replace exact+suffix `ilike` (empty on >1 match) with the resolver.
  - `intake-lead` (`:297,337-350`) — resolve/reuse by normalized phone before creating.

### 4. STOP / opt-out by-phone, enforced
- Make `lead_optouts` (already `(client_id, phone)`) the **authoritative gate read on every send path**, keyed
  by normalized phone: `trigger/runEngagement.ts` `isCancelled` (`~292-334`), `trigger/processMessages.ts`
  STEP 1.5 (`~183-206`), `trigger/sendFollowup.ts` (`~104-117`), `trigger/nudgeColdReply.ts` (`77, 269-281`),
  `trigger/_shared/sendTwilioSmsAndStamp.ts`.
- UI STOP (`stop-bot-webhook/index.ts:71-77`): resolve the lead's normalized phone, set `setter_stopped` on
  **all** rows sharing it, **and** upsert `lead_optouts`. Fix the broken ContactDetail STOP (resolve phone,
  not uuid-vs-text).
- Enrolment-time: check `lead_optouts` by phone before arming a new lead (closes the re-arm hole).
- `setter_stopped` stays as a fast per-row cache; `lead_optouts` is the by-phone source of truth. Going
  forward, `lead_optouts.phone` stores the **normalized** phone (writes and reads both normalize first), so the
  gate matches regardless of inbound format.

### 5. BUG B — BFD-wins, edits still flow to GHL
- Keep `push-contact-to-ghl`. Make `sync-ghl-contact` (`:432-444`) **never overwrite** an existing lead's
  `first_name/last_name/email/phone` from a GHL `contact.update` (routing-only for existing leads). Fix the
  `if (value)` asymmetry so cleared fields stay cleared. The 60s echo-guard becomes irrelevant for identity
  fields.
- `push-contact-to-ghl`: a deliberately cleared field is pushed as a real clear (BFD value wins upstream too).

### 6. Booking origin preserved
- `bookings-webhook` (`:217-218`): set `source` only on insert / when null; never downgrade an existing
  `voice_call` (or other non-`ghl_calendar` origin) to `ghl_calendar`.

## Data flow (after)

Inbound (call/SMS) or booking → normalize the phone → `resolveLeadByPhone` returns the one survivor (or a
single new lead if none) → all writes key on that lead → GHL is mirrored to a single contact, never used to
choose identity. Send paths check `lead_optouts` by normalized phone before sending. GHL `contact.update`
never overwrites BFD identity fields.

## Error handling / edge cases

- Unparseable phone → `normalizePhone` returns `null`; resolver falls back to the existing `lead_id`/email
  path; phoneless leads (9 live rows) keep their non-phone identity unchanged.
- Unknown inbound number → resolver finds none → create exactly one new internal lead + one mirror GHL contact.
- Existing 10 dupes → resolver deterministically picks one survivor; the others sit untouched until Spec 2; the
  `lead_optouts` by-phone gate makes STOP correct regardless of which row a message arrives under.
- A phone change on a lead → surrogate `leads.id` keeps the lead stable; `normalized_phone` updates; no
  constraint to collide with (pre-merge).

## Testing

TDD where practical:
- `normalizePhone` unit tests: AU local (`0405…`), `+61…`, international, spaces/dashes/parens, junk, null.
- `resolveLeadByPhone` tests: N dupes → deterministic survivor; none → single create; phoneless lead.
- Send-path opt-out gate test: a standing `lead_optouts` row blocks send across all paths.
- `bookings-webhook` source-preservation test: a `voice_call` row is not downgraded.
- `sync-ghl-contact` non-destructive test: a GHL `contact.update` does not overwrite BFD identity fields, and a
  cleared field stays cleared.
- Existing gates: `deno check` on touched edge fns; `cd frontend && npx tsc --noEmit`.

## Rollout / risk

All schema changes are additive (no constraint, no merge); edge functions deploy independently; `lead_optouts`
is empty for the dogfood client so the new gate causes no live regression. The one intended behavior change:
UI STOP now stops all leads sharing a phone. Implementation will be isolated from the uncommitted cadence-v2
WIP in the working tree (do not touch those files).

## Deferred — Spec 2 (historical merge)

Add `UNIQUE(client_id, normalized_phone)`, merge the existing duplicate rows (survivor = richest/most-recent),
repoint child tables from `ghl_contact_id` to the internal key, optionally tag surplus GHL contacts via
`contact_merge_candidates`. Highest-risk step; needs a dry run on the 10-row dogfood case and a reversible plan.
