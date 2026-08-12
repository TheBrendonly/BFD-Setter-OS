---
name: demo-prospect
description: Use when Brendan wants to spin up a personalised Gary demo for a named prospect ("build a demo for X", "new demo drop", "spin up a prospect page", "demo prospect setup"), or to tear one down when its cadence parks. Creates the persona, landing page and callback wiring inside BFD's own tenant. NOT for onboarding a signed client, that is CLIENT_ONBOARDING_SOP.
---

# Demo prospect setup

Spin up one named prospect's demo: their own landing page at `/g/<slug>`, their own Gary persona,
a real callback to their mobile, and a real booking on Brendan's calendar.

**Full detail, decision rationale and the persona content template live in
`SOP/DEMO_PROSPECT_SETUP.md`. Read it before executing.** This skill is the workflow spine; the SOP
is the reference.

> **Persona shaping changed 2026-08-12 (ratified, first live run pending).** Voice personas are now
> shaped in Retell's dashboard with Conductor, not in the BFD UI: push the template from BFD, F9-lock
> the slot, shape with Conductor, QA, then Pull Retell Config to archive the known-good agent. The
> BFD Modify-with-AI path still works and is the legacy fallback (and the only path for text).
> Rationale: `Docs/RETELL_PIVOT_DECISION_2026-08-12.md`.

## Non-negotiables

Read these before touching anything. Each one exists because of a verified production hazard.

1. **Never create a `clients` row for a demo prospect.** 13 code sites reverse-look-up clients by
   `ghl_location_id` with `.single()`; a second row carrying BFD's location id returns PGRST116 and
   silently takes the live GHL pipeline down. Everything lives on BFD's tenant
   (`e467dabc-57ee-416c-8831-83ecd9c7c925`).
2. **Never put `clientId` or `voiceSetterId` in the frontend file.** It ships to the browser and this
   endpoint places real phone calls. Server registry only.
3. **Never create a setter on slot 1** (SLOT-MAP-1 clobbers `retell_inbound_agent_id`).
4. **Never promise the prospect a text.** The demo bypasses the cadence engine, so no SMS is sent at
   any point, including missed-call text-back.
5. **Never edit prompt content directly, in Retell or in repo prompt files.** Report the exact change
   and let Brendan apply it via the UI. House rule, see `feedback_no_internal_prompt_edits`.
6. **Slugs carry a random 4-char suffix.** The page shows a real firm's branding; a guessable URL is
   brand and misleading-conduct exposure.

## Workflow

Create a todo per step.

1. **Research the firm.** Fetch their site. Capture firm name, principal first name, service area,
   2-3 specifics, and anything hard to pronounce.
2. **Pick the slug**: `<firm-slug>-<4 random chars>`, lowercase.
3. **Pre-flight** (§6 of the SOP): confirm exactly one client row holds the dogfood number, no active
   legacy `workflows` row with `contact_created`, and which setter slots are occupied.
4. **Hand Brendan the persona click-path** with the persona content filled in from §4 of the SOP.
   He duplicates a base persona, renames, **saves and pushes, F9-locks the slot**, then shapes it in
   Retell with Conductor and pulls the config back. Wait for confirmation. Do not attempt this
   yourself: Conductor is dashboard-only with no API, and prompt content is Brendan's to author.
5. **Wire it** (§4 of the SOP): read the setter UUID, insert the `voice_setter_phone_bindings`
   outbound row for `+61481614530`, add the server registry entry and the frontend copy entry.
6. **Verify then deploy**: `npm test` green → `deploy_single_fn.mjs demo-callback` → render smoke →
   `git push github main`. Use the render smoke for frontend verification, never tsc or vite build
   (both are no-ops for type errors in this repo).
7. **QA before any send** (§3 step 6): submit it yourself, listen to the whole call, and role-play
   the principal ("I'm actually the broker"). The demo IS the pitch and there is no human recovery.
8. **Report** what is live, the URL, and what is left for Brendan.

## Teardown

When the cadence parks (~3 weeks), delete the registry entry so the page 404s. This is also the
honest scarcity mechanic: "your page comes down Friday" is true because the entry is deleted.

## Scaling trigger

At prospect #5, stop and build the `demo_prospects` table (§7 of the SOP). The current design costs
two code deploys per prospect, which turns a sales task into an engineering task. Do not build it
before the motion is validated by real sends.
