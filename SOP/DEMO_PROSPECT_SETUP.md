# SOP — Demo prospect setup (callback funnel)

Spin up a personalised Gary demo for one named prospect: their own landing page, their own
persona, a real callback to their mobile, and a real booking on Brendan's calendar.

**Companion docs:** persona editing detail → `PERSONA_SETUP.md` · what happens when they sign →
`CLIENT_ONBOARDING_SOP.md` · live-verification bookkeeping → `Docs/TEST_LIST.md`.

**Target time: 30-40 min per prospect** once the one-time setup below is done. First one will be
slower. If you are past 60 minutes, stop and note where it went, per the 60-minute hard cap in the
acquisition playbook Stage 1 Motion B.

---

## 1. The architecture, and why it is this shape

**Pre-signature, everything lives inside BFD's own tenant.** Per prospect you create exactly three
things: a voice setter (their persona), a server registry entry, and a copy entry. You do NOT
create a `clients` row, a Twilio number, a GHL sub-account, or an external Supabase project.

This is not laziness, it is forced by two hard constraints found 2026-08-11:

1. **A second `clients` row carrying BFD's `ghl_location_id` breaks production.** 13 code sites
   reverse-look-up `clients` by that column with `.single()` / `.maybeSingle()`, including
   `sync-ghl-contact` (the canonical GHL ingress), `sync-ghl-booking`, `bookings-webhook` and
   `retell-call-analysis-webhook`. Two matching rows returns PGRST116 and silently takes the live
   pipeline down. But real bookings REQUIRE `ghl_location_id` on the calling client row
   (`voice-booking-tools/index.ts:306` throws 409 without it). Those two facts cannot both be
   satisfied by a per-prospect client row.
2. **Prompt authoring requires an external Supabase.** The UI create-setter and save-persona paths
   both hard-require it (`PromptManagement.tsx:5597`, `:6725`), and `save-external-prompt` keys
   external rows on `card_name` ALONE with no `client_id`, so two clients sharing one external
   Supabase share a slot namespace and overwrite each other.

Tenanting the demo under BFD sidesteps both, and it is semantically correct anyway: **a demo
prospect IS a BFD lead, and the booking IS Brendan's sales meeting.**

**At signature, nothing migrates.** Run `CLIENT_ONBOARDING_SOP.md` fresh against a new client row.
The demo assets are disposable. The only carry-over is soft: re-apply the persona tuning
(pronunciations, firm facts, NCCP phrasing) inside their tenant, roughly 30-60 min, because their
prompts live in THEIR external Supabase.

### What the demo does and does not do

| Real product | Demo |
|---|---|
| Ack SMS at T+0 | **nothing** |
| Outbound call ~1 min later | call within seconds |
| Text-back if they do not pick up | **nothing** |
| Books on the client's calendar | books on **Brendan's** calendar (real GHL appointment + confirmation email) |

The demo deliberately bypasses the cadence engine, because `intake-lead` would auto-enrol the
prospect into `clients.auto_engagement_workflow_id`, which on the BFD tenant is a 5-step multi-day
drip. A demo is one call, not a drip campaign. **Consequence: never promise the prospect a text.**
The landing page copy must not claim one (this was removed 2026-08-12 for exactly this reason).

---

## 2. One-time setup (already done, listed so it can be rebuilt)

- BFD client `e467dabc-57ee-416c-8831-83ecd9c7c925` holds all required credentials: `retell_api_key`,
  `ghl_api_key`, `ghl_location_id`, `ghl_calendar_id`, `ghl_assignee_id`, `intake_lead_secret`,
  external Supabase, Twilio.
- Dogfood number `+61481614530` is `retell_phone_1` + `twilio_default_phone` on that row, and
  **exactly one client row holds it** (verify before adding any other, see §6).
- Edge function `demo-callback` deployed, `verify_jwt=false`.
- Route `/g/:slug` registered in `frontend/src/App.tsx`, unlisted and `noindex`.

---

## 3. Per-prospect runbook

### Step 1 — Research the firm (5 min)

Fetch their site. Capture: firm name, principal first name (how Gary refers to them), service area,
and 2-3 specifics Gary can reference. Note anything hard to pronounce.

### Step 2 — Pick the slug (1 min)

`<firm-slug>-<4 random chars>`, e.g. `stapleton-finance-b7q4`. **The random suffix is required**: the
page presents a real firm's branding, so a guessable URL is a brand and misleading-conduct exposure
if a third party finds it. Lowercase only.

### Step 3 — Create the persona (10-15 min, Brendan, UI)

Path: `/client/e467dabc-57ee-416c-8831-83ecd9c7c925/prompts/voice`

1. **Copy** icon on an existing base persona (`Gary - Mortgage Broker` for brokers). Duplicating
   beats creating blank: the base already carries the compliance sections and booking tools.
2. Name it `<Firm Name> Demo`. It lands Not Active on the next free slot.
3. Open it, **Modify with AI** (Sparkles) on WHO YOU ARE + PERSONA RULES. Use the template in §4.
4. **Save Setter**, then **Push to Retell**.

> Slot allocation reads the `prompts` table, and voice reserves slots 1-3. **Never create a setter on
> slot 1** (SLOT-MAP-1: `SLOT_TO_AGENT_COLUMN[1]` clobbers `retell_inbound_agent_id`).

### Step 4 — Wire the setter (Claude, 5 min)

```bash
# a. get the setter UUID
node scripts/rest.mjs "voice_setters?client_id=eq.e467dabc-57ee-416c-8831-83ecd9c7c925&name=like.*Demo*&select=id,name,retell_agent_id,is_active"

# b. NO phone binding needed. voice_setter_phone_bindings has a UNIQUE
#    (client_id, phone_e164, direction) constraint and "Main Outbound" already
#    owns +61481614530 for both directions on this client, so an insert 409s.
#    With no binding, make-retell-outbound-call falls through to
#    client.retell_phone_1, which IS +61481614530. Same result, nothing disturbed.
```

Then two file edits:

- `frontend/supabase/functions/demo-callback/prospects.ts` → add a `DEMO_PROSPECTS` entry with the
  slug, `BFD_CLIENT_ID`, the real `voiceSetterId`, and `firmName`.
- `frontend/src/data/demoProspects.ts` → add the copy entry (eyebrow, headline, subhead, 3 bullets).

> **Never put `clientId` or `voiceSetterId` in the frontend file.** It ships to the browser, and the
> endpoint places real calls. The browser sends only a slug; everything else resolves server-side.

### Step 5 — Deploy

```bash
cd /srv/bfd/Projects/bfd-setter
npm test                                   # must be green before deploying
set -a; . ./.env; set +a; export SUPABASE_PAT
node scripts/deploy_single_fn.mjs demo-callback
git push github main                       # Railway prod deploy of the page
```

**Frontend verification is a render smoke, never tsc or vite build.** `npx tsc --noEmit` is a no-op in
this repo and Vite strips types. See `feedback_frontend_verify_render_smoke`.

### Step 6 — QA before sending (10 min)

Submit the form yourself with your own details and listen to the whole call. Check:

- [ ] Firm name pronounced correctly
- [ ] Qualification trio asked one at a time, not re-asked if volunteered
- [ ] NCCP guardrail holds when you push on rates or borrowing capacity, twice
- [ ] Booking offers real slots and the confirmation email lands
- [ ] **Role-play the principal**: say "I'm actually the broker here". A principal fielding
      qualification calls for a living is the most expert judge you will ever demo to, and the demo
      IS the pitch, so there is no human recovery if it fumbles.

### Step 7 — Send, then expire

Send the two-message DM (offer first, link in the second message only). When the cadence parks at
~3 weeks, **delete the registry entry** so the page 404s. That is also the honest scarcity mechanic:
"your page comes down Friday" is true because you delete it.

---

## 4. Modify-with-AI template

Adapt names only. The scripted lines below are ratified and must be used verbatim.

```
Rewrite WHO YOU ARE and PERSONA RULES so this agent is calling on behalf of [FIRM], a
[size/type] in [city] run by [PRINCIPAL]. [2-3 specifics from their site.] Refer to them as
"[FirstName]" on the call. Keep the existing AI disclosure, recording disclosure, and
compliance sections exactly as they are.

Use these lines VERBATIM. Do not reword them.

OPENING: "Hi, this is Gary, an AI assistant calling on behalf of [FIRM]. Just so you know,
this call is being recorded for quality, and I'm AI, not a person, so bear with me if I sound
a little different. I'm just here to grab a few quick details and get you booked in with
[FirstName]."

QUALIFICATION TRIO, one at a time, never re-ask something volunteered:
1. "First up, is this for a new purchase, refinancing your current loan, or looking at using
equity, maybe for an investment property?"
2. "And have you got a timeline in mind? Are you hoping to move on this in the next few weeks,
or is it more just exploring your options for now?"
3. "Last one, roughly where are you at with your deposit, or if it's a refinance or equity
play, roughly how much equity do you think you're sitting on? Doesn't need to be exact, just a
ballpark so [FirstName] can point you at the right options when you speak."

BOOKING: "Great, that's everything [FirstName] needs to get started. Let me check the calendar,
I've got [slot 1] or [slot 2], which works better for you?"

NCCP GUARDRAIL, never give credit assistance. On rates, products, borrowing capacity, whether
to refinance, or lender comparison: "That's exactly the kind of thing [FirstName] will walk you
through properly when you speak, I don't want to guess and give you the wrong steer. Let's get
you booked in and they'll cover all of that with you directly."
If pushed a second time: "I hear you, and it really is a [FirstName] question, not mine to
answer. I promise it'll be the first thing they cover."

CAN'T BOOK: "No worries, I'll pass your details straight through to [FirstName] and they'll
follow up with you directly, usually within the day."
```

---

## 5. Guardrails built into `demo-callback`

Do not weaken these without re-reading the security review. The endpoint dials real phones on BFD's
Twilio and Retell accounts.

| Guard | Value |
|---|---|
| Registry | server-side only; browser sends a slug and nothing else |
| Destination | AU mobiles only, `^\+614\d{8}$`, checked after normalisation |
| Rate limits | phone 2/hr · IP 5/hr · slug 25/day · slug spacing 60s. **All fail CLOSED** |
| Opt-outs | honoured, fail closed, response indistinguishable from a call failure |
| Calling hours | 8am-8pm client-local, honest decline outside |
| Idempotency | 300s bucket per slug+phone |
| Page | `noindex`, unlisted, attribution line, random slug suffix |

**Known open item:** nothing proves a submitter owns the number they type. Rate limits raise the bar
but do not close it. Before URLs circulate widely, add Turnstile or SMS-OTP. Tracked in
`Docs/BRENDAN_TODO.md`.

---

## 6. Pre-flight checks worth re-running

```bash
# exactly ONE client row may hold the dogfood number (PGRST116 guard)
node scripts/rest.mjs "clients?retell_phone_1=eq.%2B61481614530&select=id,name"

# no active legacy workflow with contact_created, or the leads upsert fires workflow-execute
node scripts/rest.mjs "workflows?client_id=eq.e467dabc-57ee-416c-8831-83ecd9c7c925&is_active=eq.true&select=id,name"

# occupied setter slots, so the new one does not collide
node scripts/rest.mjs "prompts?client_id=eq.e467dabc-57ee-416c-8831-83ecd9c7c925&slot_id=like.Voice-Setter-*&select=slot_id,name"
```

---

## 7. Scaling notes (read before prospect #5)

The current design costs **two code deploys per prospect** (registry redeploy + frontend push). That
is config-as-code in name only and turns a sales task into an engineering task.

**The one automation worth building**, after the motion is validated and before prospect #5: move
both registries into a `demo_prospects` table (`slug`, `client_id`, `voice_setter_id`, copy JSON,
`expires_at`) read at runtime. That deletes both deploys, makes prospect #2 a single INSERT, and
gives page expiry (the scarcity mechanic) for free.

Second automation, lower value: generate the persona draft from the scraped site. Modify-with-AI
already covers half of it.

---

**Created:** 2026-08-12 · **Source:** the 2026-08-11 build + four-way review (code, security,
breakage, GTM). Architecture decisions and their evidence are in
`Operations/daily-notes/2026-08-12.md` and the session handoff.
