# BFD-Setter — Brendan's Manual / UI Todo List

Things only Brendan can do (UI clicks, logins, provider dashboards, business calls). Testing actions live in
`TEST_LIST.md`; **everything gated on the first paying client lives in `Docs/FIRST_CLIENT_TASKS.md`**;
**prompt-content edits live in `PROMPT_UPDATE_LIST.md`**. Archive sweep 2026-07-22: all completed items moved to
`Docs/archive/COMPLETED_LOG.md` (this file is OPEN items only).

> **✅ STATUS 2026-07-22: NOTHING BLOCKING. `BUG_LIST` = 0 open; the live TEST pass is complete; GHL booking-sync
> is fixed end-to-end; the `lead_notes` console error is removed (`8851f79`). The items below are all OPTIONAL /
> low-priority / at-your-timing. The only things that MATTER next are (a) a new bug if one surfaces, or (b)
> onboarding a client (real, or a dummy dry-run to derisk the process — say "I'm onboarding a client").**

## Open (all optional / low-priority)

- [ ] **(Optional) Locate + delete the orphaned `qfbhcixkxzivpmxlciot` Supabase project.** It's an OLD project
  from before the platform migration to `bjgrgbgykvjrsuwwruoh`, still live but NOT visible in your current Supabase
  account — it's almost certainly under a separate/older Supabase login or org. It's now **harmless**: every GHL
  workflow was repointed to the live project and verified clean (2026-07-22), so nothing routes to it anymore.
  Delete it if/when you find it (check other Supabase logins/orgs); no urgency.
- [ ] **Enable the remaining per-client F16 features on the BFD dogfood client to test them** (default OFF). Agency
  view of the client → **Client Settings → "Calls & compliance"**: **Missed-call text-back** (F16c) is still OFF
  (speed-to-lead F16b + recording-disclosure are already ON since 2026-07-12). Optionally flip the **"Client ROI
  reporting"** visibility toggles. Then run the F16 rows in `TEST_LIST.md` ("Needs Brendan live").
- [ ] **Confirm sub-processor DPAs + data-retention/training terms before the pilot handles real PII.** Retell,
  Twilio, GHL, OpenRouter (retention + model-training terms specifically — pin a zero-retention/no-train route if
  available), Trigger.dev, Stripe. Pairs with the shipped code-side SEC-OPENROUTER-PII-1. `[B]`
- [ ] **Confirm MFA + least-privilege on every provider console.** Supabase, Railway, Trigger.dev, Retell, Twilio,
  GHL, Stripe. Any ONE dashboard compromise outranks any in-app bug (the Supabase console alone = the whole
  platform DB including the plaintext `clients` secret columns). `[B]`
- [ ] **5.1 Setup-guide screenshot re-shoot (content only).** `retell-bfd-setter-folder.png` still SHOWS the old
  folder name; re-shoot against a Retell folder named **"BFD Setter"** onto the same filename. Low priority. `[B]`
- [ ] **Optional GHL-side legacy renames (your GHL, your timing).** (a) Rename the automations still called
  `Add Lead to 1Prompt OS` / `... 1prompt ...` (cosmetic; URLs are what matter), then update SOP/GHL_SETUP.md to
  match. (b) New try-gary automations should tag `bfd-try-gary-<style>`; once nothing carries
  `1prompt-try-gary-*`, tell Claude to retire the legacy prefix from `ghl-tag-webhook`. (c) Delete the
  unreferenced legacy JSON exports from the Supabase storage bucket whenever. `[B]`
- [ ] **AU public-holiday refresh — NEXT DUE before end of 2028 (for 2029).** `trigger/_shared/businessHours.ts`
  `AU_PUBLIC_HOLIDAYS` now covers 2026 + 2027 + 2028 (2028 added `f31a3cf`, 2026-07-21). Annual ritual: ask Claude
  to add the next year's national holidays (~10-line edit + a Trigger deploy). `[B]`

- [ ] **(Low, pre-existing, cosmetic) `dm_executions` 400 on ContactDetail.** The contact page queries
  `dm_executions` for `messages`/`setter_messages` columns that don't exist in prod → 2 console 400s (same class as
  the old CHATS-DM-1). The DM channel has no live traffic, so the panel just returns empty — noise only. Have Claude
  guard the select (or fold it into the next CRM-panel cleanup) whenever; not blocking. Surfaced 2026-07-22.

## Standing notes

- **Alpha SMS sender IDs:** any future "branded/alpha sender" client request needs ACMA Sender ID Register
  registration FIRST (weeks of lead time) — https://www.acma.gov.au/sms-sender-id-register. The current plain long
  code `+61481614530` is exempt (verified 2026-07-04, 0 alpha senders configured).
- **B-4 field-access is self-serve config:** per-sub-account "which My Account fields a client may see/edit" lives
  at Sub-Account Config → "My Account Field Access". Tune per client; no build needed.
- The inbound number `+61481614530` answers on the dedicated **"Inbound BFD Agent"** (`agent_b2f6495`).
  Outbound calls pick the setter at the campaign/workflow level; only one setter is flagged inbound.
- **F21(b) reporting semantics (decided 2026-07-12):** the ROI funnel/report `booked` headline counts ONLY
  setter-created bookings (voice/SMS/cadence), EXCLUDING `source='ghl_calendar'`. Shipped in F21(b); recorded here
  so the semantic isn't re-litigated.
