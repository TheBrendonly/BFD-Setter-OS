---
description: Brendan action plan after the 2026-05-31 single-ingress + campaign-UI + Try-Gary + cleanup build (HEAD 383de2f).
---

# Handoff — 2026-05-31 (single-ingress consolidation, campaign-row UI, Try-Gary clone, cleanup)

HEAD `383de2f` on `main` (pushed to github → Railway, and origin → Forgejo). All code deployed + verified. Supabase platform ref `bjgrgbgykvjrsuwwruoh`.

## What shipped (no action needed)
- `sync-ghl-contact` is now the single canonical lead-intake webhook (route by tag, default fallback). Deployed v16.
- `ghl-tag-webhook` Try-Gary handler deprecated-but-working; per-persona voice-setter override removed. Deployed v8.
- Workflows page campaign rows: Form-Tag field with label/helper/empty-warning, an activate/disable toggle, and a DEFAULT badge + "Set as default".
- Try-Gary campaign cadence cloned from the main cadence (9 nodes), left INACTIVE.
- Debug pages gated behind creator mode. Legacy CSV-campaign reactivation fully retired. Lockfile + types.ts cleaned up.

## Your step-by-step actions

### A. GHL — point every form at the one webhook URL + a tag (the core setup)

**Verified 2026-05-31 by live webhook test (both webhook types):**
- The **standard Outbound Webhook** is the recommended choice. It sends the contact's real tags as a **comma-separated string** (`"tags":"bfd_setter-new_lead"`), the location id as `location.id`, and the contact id as `contact_id` — all of which `sync-ghl-contact` now parses (a parser fix shipped this session so it accepts the comma-string tag; previously it only read arrays and would have dropped the tag → everything fell to default).
- The **custom webhook** also works (it sent fields as query params: `Lead_ID`, `Name`, `Email`, `Phone`, `GHL_Account_ID`), **but it sent no tag and an empty body** — so with the custom webhook you must explicitly add the routing tag yourself (e.g. `?tag=bfd_setter-try_gary` in the URL or a `tag` param). More manual; prefer the standard webhook.

Steps:
1. The one inbound URL for all forms is the `sync-ghl-contact` function URL:
   `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/sync-ghl-contact`
2. Use the **standard Outbound Webhook** action pointed at that URL.
3. **Main form** (already working): the contact carries `bfd_setter-new_lead`; that tag now matches the main cadence directly (same destination as before — no change needed).
4. **Try-Gary form**: ensure the automation **adds the `bfd_setter-try_gary` tag BEFORE the webhook step fires** (the payload only includes tags the contact has at fire time), then the standard webhook routes it to the Try-Gary cadence automatically. No query-param needed.
5. **Any future form/agent**: tag the contact with a unique tag before the webhook fires, then create one Campaign per tag in the app (below). No per-webhook config beyond the tag.
   - (Belt-and-suspenders option for any webhook type: also append `?tag=<routing-tag>` to the URL — `sync-ghl-contact` reads that too.)
   - The old `source: "try-gary-landing"` direct webhook still works for backward compatibility, but the one-URL+tag pattern is the standard.

### B. App — wire the cadences (Workflows page)
1. Open **Workflows → CAMPAIGNS** for BFD.
2. **Main cadence**: confirm NEW LEADS is on and it shows the **DEFAULT** badge (if not, click the Crown "Set as default" on it). Tag can be blank or `bfd_setter-new_lead`.
3. **Try-Gary cadence**: confirm NEW LEADS is on and the Form Tag is exactly **`bfd_setter-try_gary`** (it is set). Leave it disabled until step C/D.
4. For a new form later: open its campaign, toggle NEW LEADS on, set its Form Tag to that form's tag.

### C. Retell / Twilio — provision the Try-Gary voice agent + number
1. In **Voice setup → Retell Agents**, create/confirm the agent you want Try-Gary to use and Push to Retell (this also writes the `voice_setters` row).
2. Make sure that agent has a Twilio number assigned (slots 1-3 use `retell_phone_1..3`; for higher slots set the number via the legacy mechanism for now).
3. Decide which agent should call Try-Gary leads.

### D. Try-Gary cadence — confirm the agent + review content, then activate
1. Open the **Try-Gary** cadence editor. It has 9 nodes cloned from the main cadence. **Both phone_call nodes currently have `voice_setter_id = "TODO-confirm-try-gary-agent"`** — a deliberate placeholder.
2. In each phone_call node, replace that placeholder by selecting the real voice setter/agent from step C. (The cadence will NOT place calls correctly until you do this.)
3. Review/customize the cloned SMS + call-instruction content for Try-Gary (it's currently the main-cadence copy — I did not author new content).
4. When happy, toggle the Try-Gary campaign **active** (Power button on its row, or in the editor).

### E. End-to-end test
1. Submit a test lead through the Try-Gary form (or POST to the one URL with `tag=bfd_setter-try_gary`).
2. Confirm routing + enrolment:
   ```sql
   select form_source, workflow_id, enrollment_source, started_at
   from engagement_executions order by started_at desc limit 5;
   ```
   You should see `form_source = bfd_setter-try_gary` and `workflow_id = 3fda0794-006e-4285-8e4c-04b9667327c9`.
3. Confirm the right agent calls and the cadence steps as expected.

## Things I discovered that need your input / awareness

1. **Two Supabase projects.** `.env` has `BFD_PLATFORM_URL` (`bjgrgbgykvjrsuwwruoh`, where the app + edge fns + all engagement data live — this is what the app uses) and `BFD_SETTER_LIVE_URL` (`qildpilxjodxdifggmto`, a separate project). Worth confirming what `qildpilxjodxdifggmto` is for and whether it's still needed.

2. **types.ts could not be wholesale-regenerated.** A full `supabase gen types` from the platform DB jumped tsc errors from 26 → 232, because ~30 frontend files use typed `.from()` against tables that aren't in the platform schema (`campaign_leads`, `client_portals`, `lead_tags`, `webinar_setup`, `analytics_chat_*`, RPC `delete_campaign_with_data`, …). This means the frontend references a fair amount of legacy/other-DB surface. I did a surgical types update instead (added `cadence_metrics`, `leads.form_source`, `voice_setters.legacy_slot`; 26 → 24 errors, no regressions). **Decision for you:** the remaining drift is real tech-debt — at some point those legacy pages (the old campaign Dashboard/CampaignDetail and friends) should be removed so types can be regenerated cleanly. Not urgent; the build (`vite`) is unaffected by tsc errors.

3. **`campaign_leads` table doesn't exist in the platform DB.** The legacy campaign Dashboard (`/campaigns`) and CampaignDetail pages query it and therefore error/return empty at runtime. They're still routed (the "DB Reactivation" sidebar item lands on `/campaigns`). I left that legacy UI intact (out of scope) but it's effectively dead. Consider repointing the "DB Reactivation" sidebar item straight to `/campaigns/create` (the working native reactivation page) and removing the old Dashboard/CampaignDetail later.

4. **The 24 remaining tsc errors** are pre-existing local-type issues (mostly `LeadReactivation.tsx`'s `ReactivationTotals` interface, plus a couple of Json/Timeout mismatches) — not schema drift, and they don't break the build. Flag if you want them cleaned up.

5. **`clients.try_gary_persona_slots`** column is now unused (COMMENT-deprecated). Safe to drop in a future migration once you're sure nothing external reads it.

## Deferred (still on Claude's list, not in this session's scope)
- Per-setter phone-binding UI for voice slots 4-10 + UUID-native cadence picker in Engagement.tsx.
- Multi-tenant isolation P4 items (campaigns.client_id NOT NULL, message_queue client_id, phone-uniqueness guard) — run `scripts/phone_uniqueness_audit_and_fix.sql` first.
