# HubSpot + GHL Coexistence: Internal Architecture Analysis

Internal working document. Source: 5 research finders + adversarial verification on the load-bearing claims. Use this to draft a short client-facing recommendation. All facts cited to developers.hubspot.com / knowledge.hubspot.com where possible; GHL and community sources flagged.

## 0. The single most important correction the verification surfaced (read this first)

The research repeatedly recommended a "custom `hasUniqueValue` unique-id property on contacts, upsert by `idProperty=<that property>`" as a dedup mechanism. **Verification REFUTED this for the Contacts object specifically.**

- HubSpot changelog "Bug fix: Contact Properties updated to indicate they do not force uniqueness" (announced 2023-04-05, live 2023-04-12, still current in 2026): "Currently HubSpot doesn't support unique properties in Contacts." Pre-existing `hasUniqueValue=true` values on contacts were "ignored and not enforced" and flipped to false. And: "If you use the API to create a Contact property and its definition includes hasUniqueValue set to true, you will receive a validation error" (`Properties.CANNOT_SET_CONTACT_HAS_UNIQUE_VALUE`).
  - Cite: https://developers.hubspot.com/changelog/bug-fix-contact-properties-updated-to-indicate-they-do-not-force-uniqueness
- This DIRECTLY CONTRADICTS three finder claims (Finder 1 claim 4, Finder 4 claim 1) that cited the 2023-09-21 "unique-properties-for-contacts" changelog and said contacts can have up to 10 custom unique properties. The two HubSpot changelogs are in tension; the verifier treated the "do not force uniqueness" / validation-error one as the operative current behavior, and the practical community evidence (batch upsert rejecting non-`email` idProperty on contacts as "Unable to perform update/upsert by non-unique 0-1 property") supports the refutation.
- **Net effect on our design:** for CONTACTS, the only reliable dedup keys are (a) the system **Record ID** (`hs_object_id`) and (b) the **email** property (system-enforced unique). A custom external-lead-id property is NOT a dependable unique upsert key for contacts. Companies/deals/custom objects DO support `hasUniqueValue`; contacts do not. Plan around Record ID + email only.

What survived verification cleanly (these are safe to build on):
- Email is the automatic, hard dedup key for contacts; phone is NOT (confirmed, both lenses). Phone-only / no-email leads duplicate on every blind create.
- `contact.creation` webhook delivers `objectId` (canonical contact id) + `portalId` at creation (confirmed, both lenses). Caveat: "immediately" is not an SLA — batched, retried up to 10x/24h, possibly out of order, possibly duplicate-delivered. Dedupe on `eventId`, ACK <5s, process async.
- **PATCH by known Record ID cannot create a duplicate** (confirmed, both lenses). This is the genuinely duplicate-safe path and the backbone of the recommendation. Even a PATCH to a stale/merged id lands on the surviving record (merge keeps old ids pointing at survivor); a PATCH to a purged id 404s rather than creating.
- You can set/change deal `dealstage`, a custom contact property, or `lifecyclestage` via API to signal "being worked by AI" then an outcome (confirmed). The only constraint is `lifecyclestage` is **forward-only** (must clear before moving backward); deal stages and custom properties have no such constraint.

Lower-confidence items to verify on the client's live account: CRM Search API rate limit (cited as 5 req/s/token, finder marked **medium**; the dedicated changelog still shows 1→4 — confirm via `X-HubSpot-RateLimit` headers on their account). The exact REST version path (`/crm/v3/...` vs dated `/crm/objects/2026-03/...`).

---

## A. Topology options (GHL kept as calendar, HubSpot is the client's CRM)

Decision constraints baked in: GHL stays as the appointment calendar (it bridges to Google/Microsoft and is reliable). Booking in GHL via `POST /calendars/events/appointments` REQUIRES a GHL `contactId`. The client is highly duplicate-sensitive on the HubSpot side and has a large existing HubSpot DB. Today the platform's `leads.lead_id` == the GHL contact id; this coupling must be broken for HubSpot clients (see Schema impact, §A.5).

### Option 1 — HubSpot-first / GHL operational mirror (RECOMMENDED)

- **Data flow:** Lead is born in HubSpot (the client's own ingress: form, list, manual, or a workflow that flags it). A HubSpot workflow or app-level `contact.creation` webhook fires to our ingress carrying `objectId` + `portalId`. We store `hubspot_contact_id = objectId` on our `leads` row at birth and run the cadence off platform-native data. We only ever PATCH HubSpot by that Record ID. GHL contact is created **lazily, only when a booking is imminent** (search GHL by email/phone → create if absent → store `ghl_contact_id` → book). Write-back to HubSpot is start-flag + on-booking + end-of-cadence (see §E).
- **Identity born:** in HubSpot. We hold its immutable `hs_object_id` from the first moment.
- **Duplicate risk (HubSpot): LOW.** We never blind-create a HubSpot contact; we only PATCH by Record ID, which is verified to be incapable of creating a duplicate. The client's duplicate fear is structurally eliminated, not merely mitigated.
- **Duplicate risk (GHL): LOW–MED.** GHL contact creation is lazy and gated by a search-before-create. Risk is only on the GHL side, only for leads that actually book, and GHL is not the system the client is sensitive about.
- **What breaks / costs:** Requires the client to make leads originate in (or be flagged in) HubSpot. Requires capturing `objectId` at birth (webhook or workflow webhook). Booking path gains one GHL get-or-create round-trip (small latency). Schema change to `leads` (decouple `lead_id` from GHL id).
- **Effort:** MEDIUM. Ingress webhook handler + leads-table schema change + lazy GHL get-or-create + write-back. No fragile dedup engine needed because of the Record-ID-only write rule.

### Option 2 — GHL-first / HubSpot end-sync

- **Data flow:** Lead born in our existing GHL (current model, `lead_id == ghl_contact_id`). Cadence runs. At the END we create/match the lead into the client's HubSpot.
- **Identity born:** in GHL.
- **Duplicate risk (HubSpot): HIGH.** This is the exact scenario the client fears. At end-of-cadence we must CREATE-or-match into a large HubSpot DB. If the lead has an email, an email-keyed upsert is safe-ish (matches existing). If the lead is phone-only / no-email — common for SMS/voice — there is **no reliable HubSpot dedup**: phone is not unique, search is eventually consistent (community: up to ~22 min lag), and phone search strips the country code so an E.164 `+61...` lookup can miss entirely (Search API guide: "refrain from including the country code"). We would create duplicates against people already in their HubSpot.
- **What breaks:** The client's stated #1 requirement (no HubSpot duplicates). Also loses the "always hold the HubSpot id" benefit during the cadence.
- **Effort:** LOW to build, but HIGH risk. Rejected on the duplicate ground alone.

### Option 3 — Fork-at-source (form posts to both HubSpot and GHL simultaneously)

- **Data flow:** The lead-capture form (or a router) writes to BOTH HubSpot and GHL at ingress; we hold both ids from the start.
- **Identity born:** in two places at once; we must reconcile them.
- **Duplicate risk (HubSpot): MED.** The HubSpot write at ingress is itself a create against the large DB — same dedup exposure as Option 2 unless it's an email-keyed upsert or a HubSpot-native form (which HubSpot dedups on email). Also forces a GHL contact for EVERY lead, not just bookers, inflating GHL.
- **What breaks:** Two ingress writers to keep in lockstep; partial-failure handling (HubSpot succeeds, GHL fails, or vice versa); GHL contact created for leads that never book. Doesn't exploit HubSpot's own email-dedup as cleanly as letting HubSpot be the origin.
- **Effort:** MED–HIGH (dual-write orchestration + reconciliation). Worse than Option 1 with no upside given GHL is calendar-only.

### Option 4 — Off-the-shelf 2-way sync (Zapier / Make / iPaaS / GHL native connector)

- **Prior art (confirmed):** No off-the-shelf product does genuine continuous two-way GHL↔HubSpot record sync with id-mapping, dedup-by-unique-key, echo-loop suppression, and conflict resolution. Everything available is trigger→action automation: Zapier LeadConnector app, Make HighLevel↔HubSpot modules, iPaaS aggregators (Appy Pie/Flozic, Integrately, Relay.app). GHL's own native marketplace HubSpot connector is action-oriented and the native marketplace caps at ~30 connectors.
  - Cite: https://zapier.com/apps/hubspot/integrations/leadconnector
- **Duplicate risk: MED–HIGH and uncontrolled.** None of these enforce HubSpot-as-identity-SoR, search-then-upsert dedup, or the structured write-back we need. An iPaaS tool can itself become a second writer that violates field ownership and an echo-loop source.
- **What breaks:** The load-bearing identity + write-back path would be outsourced to a tool that doesn't guarantee it. 
- **Effort:** LOW to wire, but it does NOT remove the need to own identity mapping and write-back in-platform. **Conclusion: at most a fallback for trivial, non-critical field mirroring; never the load-bearing path.**

### A.5 Schema impact common to all options

Today `leads.lead_id == GHL contact id`. For HubSpot clients this must change:
- `lead_id` becomes platform-native (e.g. our own UUID), no longer the GHL id.
- Add `hubspot_contact_id` (identity SoR for HubSpot clients), `ghl_contact_id` (nullable, operational, populated lazily at first booking).
- Persist `portalId` alongside `hubspot_contact_id` as the tenant discriminator (mirrors the existing `ghl_location_id` scoping pattern in this codebase). Make all downstream upserts idempotent on `(portalId, hubspot_contact_id)`.
- This touches the leads primary join key — treat as a real migration, gated to HubSpot clients (don't disturb GHL-only clients).

---

## B. Recommended option + rationale

**Recommend Option 1 (HubSpot-first / GHL operational mirror).**

Why it solves the client's duplicate-name fear at a structural level, not a best-effort level:
1. The lead is born in HubSpot, so we capture its immutable Record ID (`hs_object_id`) at birth via the `contact.creation` webhook (verified to carry `objectId` + `portalId`).
2. **Every** subsequent HubSpot write is a PATCH by that Record ID. Verification confirmed (both lenses) that PATCH-by-Record-ID is update-only and **cannot create a contact** — a non-existent id 404s rather than creating; a merged id resolves to the survivor. So our integration has **no code path that can spawn a HubSpot duplicate.**
3. We deliberately do NOT lean on the refuted "custom unique property upsert" or on search-then-create for the steady state — those are the duplicate-prone paths. We only need them in the fallback case (§C), and even then email-first.
4. GHL duplicate risk is contained: GHL contacts are created lazily, gated by search-before-create, and only for leads that actually book. GHL is calendar-only and not the system the client is precious about.

This is exactly the owner's instinct ("born in HubSpot, hold the id, write back at the end"), and the verification independently endorsed it: "rely on the record-id PATCH path … that is genuinely duplicate-safe."

Cost confirmation (removes a likely client objection): a contact born in / already living in HubSpot adds **zero** new billable marketing contacts, and **contacts created/touched via API default to NON-marketing (free)**. We never flip leads to marketing status. Caveat: if the "born in HubSpot" ingress is a HubSpot **marketing form**, the form's own setting (default = marketing) governs cost — verify the client's form config.
- Cite: https://knowledge.hubspot.com/records/marketing-contacts ; https://knowledge.hubspot.com/records/default-marketing-statuses-for-created-contacts

---

## C. Dedup strategy for the fallback (when we DO have to create/match a HubSpot contact)

This applies only to leads NOT born in HubSpot (e.g. a source that originates in GHL or our platform and must be pushed into HubSpot). Order of preference:

1. **If email is known → email-keyed upsert.** `POST /crm/v3/objects/contacts/batch/upsert` with `idProperty=email`. Matches the existing contact if the email exists (HubSpot enforces email uniqueness including secondary/additional emails); else creates one. This is the only contact upsert key the verification confirmed works besides Record ID.
   - Hard limitation (confirmed): **partial upserts are NOT supported with `idProperty=email`** — you must send the FULL property payload each time. There is no contact-side custom-unique-property workaround (refuted, §0), so accept full-payload upserts on this path.
   - Plain `POST /crm/v3/objects/contacts` with an existing email returns **409 CONFLICT** with the existing id in the message — parse it and PATCH, OR just use batch/upsert which handles it. Avoid `batch/create` (partial-conflict trap: one 409 still creates the non-conflicting items, leaving ambiguity).
   - Cite: https://developers.hubspot.com/docs/api-reference/crm-contacts-v3/batch/post-crm-v3-objects-contacts-batch-upsert
2. **If no email (phone-only) → there is no safe automatic dedup.** This is the genuinely dangerous case and we must be honest with the client about it:
   - Phone is not a unique key (confirmed both lenses; the "phone as unique identifier" HubSpot Idea is still open/unimplemented as of 2026).
   - Search-then-create is UNSAFE as the sole gate: Search API is eventually consistent (community max ~22 min), and phone search strips the country code, so an E.164 search can return nothing and we'd create a duplicate.
   - The previously-proposed "custom unique phone/external-id property" escape hatch **does not exist for contacts** (refuted, §0).
   - Mitigations, best-effort only: (a) best-effort search by area-code+local (country code dropped) and by name as a hint, surface likely matches for human review rather than auto-creating; (b) prefer to push these into HubSpot only at a point where an email has been captured during the cadence; (c) hand phone-only un-matchable leads to HubSpot's native **suggested-duplicates** tool (Professional/Enterprise) for assisted human merge after the fact (Starter has manual merge only).
   - **Strategic conclusion:** the cleanest way to avoid this whole class of risk is to keep the client on Option 1 (born in HubSpot) so the fallback create path is rarely or never exercised. If many of their real lead sources are phone-only and originate outside HubSpot, that is the one scenario where the duplicate fear cannot be fully engineered away — flag it loudly (see §G).

Search hygiene whenever we do search: search by unique-ish keys (email > phone), drop the `+<country code>` on phone, treat results as hints not gates, and budget for the separate, stricter CRM Search rate limit (cited 5 req/s/token, verify on their account).

---

## D. "Being worked by AI" modeling

Recommendation depends on the client's tier; ranked best-fit:

1. **Leads object + prospecting workspace (IF Sales Hub Professional/Enterprise).** Default stages New → Attempting → Connected → Qualified → Disqualified map almost 1:1 to AI-setter outcomes, and it's the SDR cockpit reps already use. Create `POST /crm/v3/objects/leads` (requires `hs_lead_name` + association to the existing contact — we already hold the contact id, so we spawn the lead off it). Change stage with `PATCH /crm/v3/objects/leads/{leadId}`.
   - Gotchas: lead needs an assigned **owner** to appear in the workspace; editing a lead's stage AFTER Qualified/Disqualified requires **Super Admin** (matters if AI sets a terminal stage then needs to reopen).
   - Cite: https://developers.hubspot.com/docs/api-reference/crm-leads-v3/guide
2. **Dedicated Deal pipeline (default for lower tiers / if no Leads object).** Pipeline "AI Setter" with stages New → Being Worked by AI → Booked / No-Answer / Disqualified. `POST /crm/v3/objects/deals`, move with `PATCH /crm/v3/objects/deals/{dealId}` setting `dealstage` (+`pipeline`) by **internal ID** (not label). Deal stages have **no forward-only constraint** — move freely in any direction (confirmed). Visible as a Kanban board reps live in.
   - Side-effect to audit first: creating/winning a deal can AUTO-advance the contact's `lifecyclestage` if the account has the "set lifecycle stage when a deal is created / closed won" toggles on (forward-only). Decide deliberately and check the account's lifecycle-sync settings before shipping.
   - Cite: https://developers.hubspot.com/docs/api-reference/crm-deals-v3/guide
3. **Custom contact property (lowest friction, good supplement or fallback).** e.g. `ai_setter_status` enum (in_progress / completed / booked / no_answer / dnc). `PATCH /crm/v3/objects/contacts/{id}` with `{"properties":{"ai_setter_status":"in_progress"}}`. **No forward-only restriction**, fully reversible — ideal for a flag that must flip back. Invisible unless added to a view, no native board UX.
4. **`lifecyclestage` — use ONLY as a coarse, monotonic nudge, never for transient state.** Forward-only (confirmed both lenses): a PATCH to an earlier stage is silently ignored; you must CLEAR then set. Plus every change can RE-ENROLL the contact in the client's existing workflows (loop risk). Keep transient AI working-state OFF lifecyclestage; at most set it forward once (e.g. to `salesqualifiedlead` on AI start, `opportunity` on booking) if the client wants it.
   - Cite: https://knowledge.hubspot.com/records/use-lifecycle-stages

**Net recommendation:** Leads object if Pro/Ent; otherwise a dedicated Deal pipeline; back either with a custom contact property `ai_setter_status` so we always have a reversible, re-enrollment-safe flag we control. Treat `lifecyclestage` as optional, forward-only, milestone-only.

---

## E. Write-back design — what we push and when

Timing model (verified-sound, upgraded per finder): **start flag at birth + ONE write-back at booking + full outcome dump at cadence end.** Pure end-only loses the booking event, which is the one thing a human needs in near-real-time to avoid double-booking / re-contacting. Booking is low-frequency (one write/lead) and trivial on rate limits.

Split structured PROPERTIES (filterable/reportable in lists, workflows, reports) from timeline ACTIVITIES (human-readable history). Anything buried in a note body is NOT filterable — so the same facts live in both layers.

### Structured properties (PATCH the contact, and/or the Deal/Lead)
Define once per portal via `POST /crm/v3/properties/contacts` (a write to an undefined property 400s/no-ops — provision as an onboarding step):
- `ai_setter_status` (enum: in_progress/completed/...) — set in_progress at START.
- `lead_booked` (bool checkbox) and `lead_appointment_time` (datetime, mirror of the GHL booking) — set at BOOKING.
- `lead_cadence_name` (text/dropdown), `lead_sms_count` (number), `lead_call_count` (number), `lead_call_sentiment` (dropdown), `lead_final_outcome` (dropdown: booked/no-answer/not-interested/handed-off/dnc) — set at END.
- All via `PATCH /crm/v3/objects/contacts/{id}` (by Record ID — duplicate-safe).
- Cite: https://developers.hubspot.com/docs/guides/api/crm/properties

### Timeline activities (the readable history), associated to the contact
- **CALL per Retell call:** `POST /crm/v3/objects/calls`. Key props: `hs_timestamp` (required), `hs_call_body` (put the Retell summary + transcript here — there is NO public writable `hs_call_transcript`), `hs_call_duration` **in MILLISECONDS** (47s = `47000`), `hs_call_from_number`/`hs_call_to_number`, `hs_call_recording_url` (clickable Retell link), `hs_call_status`, `hs_call_direction`, `hs_call_disposition` (standard GUIDs are stable/hardcodable: e.g. Connected `f240bbac-87c9-4f6e-bf70-924b57d47db7`, No answer `73a0d17f-1163-4015-bdd5-ec830791da20`, Left voicemail `b2cf5968-551e-4856-9783-52b3da59a7d0`).
  - Note: setting `hs_call_recording_url` gives a timeline link only; the Sept 30 2024 sunset means it NO LONGER drives HubSpot native playback/auto-transcription. HubSpot-hosted recording + native transcript would require registering as a calling-extension app (`/crm/extensions/calling/2026-03/...`) — heavyweight, only if the client explicitly wants it.
  - Cite: https://developers.hubspot.com/docs/api-reference/legacy/crm/activities/calls/guide
- **COMMUNICATION per SMS:** `POST /crm/v3/objects/communications`. `hs_timestamp`, `hs_communication_channel_type=SMS`, `hs_communication_logged_from='CRM'` (required or it's rejected/mis-attributed), `hs_communication_body`. (Alternative if they don't want N objects: summarize the thread in the end note + keep a count property.)
  - Cite: https://developers.hubspot.com/docs/guides/api/crm/engagements/communications
- **MEETING for the GHL booking (visibility only):** `POST /crm/v3/objects/meetings`. Use the **engagement** object (`crm/v3/objects/meetings`) — it is timeline-only, does NOT create a HubSpot calendar event or reserve scheduler availability (exactly right; GHL/Google stays the source of truth). Do NOT use `scheduler/v3/meetings` (that books a real HubSpot calendar event → double-booking risk). Props: `hs_meeting_title`, `hs_meeting_start_time`/`hs_meeting_end_time`, `hs_meeting_outcome=SCHEDULED`, `hs_meeting_location='Booked via GHL'`, `hs_meeting_external_url` (GHL appointment URL).
  - Cite: https://developers.hubspot.com/docs/api-reference/legacy/crm/activities/meetings/guide
- **NOTE for the narrative summary:** `POST /crm/v3/objects/notes`, `hs_note_body` (max 65,536 chars) — the human-readable "AI worked this lead, ran cadence X, N SMS, M calls, outcome BOOKED".
- **Associations:** associate every activity to the contact (else it won't render on the timeline). Inline on single creates: `associations:[{to:{id:<contactId>}, types:[{associationCategory:"HUBSPOT_DEFINED", associationTypeId:<id>}]}]` with activity→contact ids **Call 194, Meeting 200, Note 202, Communication 81** (NOT the reverse 193/199/201). For batch/create, inline associations are unreliable — do a follow-up v4 batch associations call.

### Rate-limit reality
~1 birth-flag + 1 booking write + 1 end batch per lead = a handful of requests/lead, trivially within limits (private app Pro/Ent 190 req/10s; daily 625k Pro / 1M Ent). Batch endpoints take up to 100 records/call. Reserve the separate, stricter CRM Search budget for the dedup-at-birth fallback only.
- Cite: https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines

### Echo-loop note
If we stay write-mostly (Option 1), loop surface is tiny. Bonus: HubSpot app webhooks do NOT fire for changes made with the SAME app's own credentials (community accepted-solution), so our own writes won't bounce back. `changeSource` only tells API/CRM_UI/WORKFLOW/IMPORT, not WHICH integration — so if we ever consume inbound webhooks, also stamp a custom `_sync_source` property and dedupe by `eventId`.
- Cite: https://community.hubspot.com/t5/APIs-Integrations/Which-values-can-the-changeSource-field-of-the-webhook-payload/m-p/308305

---

## F. What we still need from GHL for this client

- **Calendar / booking only.** GHL's sole role is the appointment calendar (it bridges to Google/Microsoft). Booking requires `POST /calendars/events/appointments` with a GHL `contactId`.
- **GHL contact can be created LAZILY at booking time — confirmed and recommended.** No GHL contact at lead birth. When the cadence reaches a booking: (1) search GHL by email/phone, (2) create if absent, (3) store returned `ghl_contact_id` on the lead row (nullable until then), (4) book. Only leads that actually book ever land in GHL → less GHL churn, contained GHL dedup. Cost: one extra get-or-create round-trip at booking (minor latency) and a GHL-side search-before-create to avoid GHL duplicates.
  - Cite: https://marketplace.gohighlevel.com/docs/ghl/calendars/create-appointment/index.html
- **Conversations mirror: NOT required for this client.** The SMS/voice transport is ours (Twilio/Retell); the readable history goes to the HubSpot timeline (§E). No need to mirror conversations into GHL. (Open if the client wants a GHL inbox view — see §G.)
- **Open item:** the GHL create-appointment request-body required-vs-optional schema didn't render in research — confirm against the live API for this client's calendar before building the booking call.

---

## G. Open questions for the client

1. **Do ALL their lead sources originate in HubSpot?** This is the make-or-break question. Option 1's zero-duplicate guarantee holds only for leads born in HubSpot. If real sources are phone-only and originate outside HubSpot, that's the one case where duplicate risk cannot be fully engineered away (§C.2) — we need to know the proportion.
2. **HubSpot tier?** Determines the "being worked by AI" model: Sales Hub Pro/Ent → Leads object (best); lower → dedicated Deal pipeline. Also gates the suggested-duplicates safety-net tool (Pro/Ent) and the fully-hydrated workflow "Send a webhook" action (Operations/Data Hub Pro+).
3. **Mid-cadence visibility, or start-flag + booking + end-only?** We recommend start + booking + end. Confirm reps don't need richer mid-cadence updates (extra writes, minor loop surface).
4. **Which start-flag mechanism** — Leads stage, Deal pipeline stage, or custom property? (We recommend the tier-appropriate object + a reversible custom property.) And do they want `lifecyclestage` touched at all (it's forward-only and can re-enroll their workflows)?
5. **Ingress for "born in HubSpot":** a HubSpot marketing form (defaults contacts to MARKETING = billable; form-config governs) vs the CRM API / a workflow (defaults NON-marketing = free)? Verify form config so we don't inflate their marketing-contact bill.
6. **Private app (per-account token, 190/10s) or marketplace OAuth app (110/10s/install)?** Sets rate-limit ceiling and self-credential webhook-suppression behavior.
7. **Dedup match key they trust in their large DB** for any fallback create: email only, email+phone, or assisted name match?
8. **Do they expect inbound HubSpot → platform changes** (e.g. a rep marks a lead DNC in HubSpot mid-cadence and we must pause)? If yes, we need to consume HubSpot webhooks + full echo-loop machinery; if no, the integration is write-mostly and much simpler.
9. **SMS timeline granularity:** one COMMUNICATION object per SMS (full fidelity) vs summary-note + count (fewer writes)? And do AI-logged activities want a dedicated "AI Setter" HubSpot owner for filtering/reporting?
10. **HubSpot-hosted recording + native transcript** (heavyweight calling-extension app) or just a clickable Retell link + transcript-in-body (simple)?

---

## H. Bottom line (adaptable to a client-facing summary)

We recommend making each lead **born in HubSpot** so we capture and hold its permanent HubSpot record id from the first moment, then only ever **update by that id** — a path HubSpot guarantees can never create a duplicate, which directly answers your concern about cluttering your HubSpot with duplicate contacts. GoHighLevel stays purely as the booking calendar, and we create a GHL contact **only when a lead actually books**, so it never accumulates contacts for leads that don't. We flag each lead as "being worked by AI" at the start (as a Lead/Deal stage or a property your reps can see), push the appointment to HubSpot the moment it's booked, and write a full outcome summary (calls, texts, sentiment, result) to the contact's timeline at the end. The one situation we can't fully eliminate is leads that arrive with **no email and don't originate in HubSpot** — HubSpot can't auto-dedupe those on phone — so we'd want to confirm where your leads come from and route as many as possible through HubSpot to keep your database clean.
