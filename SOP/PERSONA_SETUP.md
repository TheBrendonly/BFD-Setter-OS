# Try-Gary Persona Setup (per-persona setters + campaigns)

How to stand up each Try-Gary persona end to end: push a voice setter from the base Gary template, shape it in Retell with Conductor, pull the known-good agent back into BFD, clone it across to the text setter, then point its campaign at those setters and activate it.

The persona campaigns are already created (cloned from the base Try-Gary cadence, 2026-06-01), inactive, each tagged `bfd_setter-try_gary-<persona>`:

| Persona | Campaign | Routing tag | Voice node placeholder |
|---|---|---|---|
| Generic Demo | Try-Gary (the base) | `bfd_setter-try_gary` | `TODO-confirm-try-gary-agent` |
| Property Coach | Try-Gary: Property Coach | `bfd_setter-try_gary-property_coach` | `TODO-confirm-property_coach-agent` |
| Mortgage Broker | Try-Gary: Mortgage Broker | `bfd_setter-try_gary-mortgage_broker` | `TODO-confirm-mortgage_broker-agent` |
| Finance Strategist | Try-Gary: Finance Strategist | `bfd_setter-try_gary-finance_strategist` | `TODO-confirm-finance_strategist-agent` |
| Crazy Gary | Try-Gary: Crazy Gary | `bfd_setter-try_gary-crazy_gary` | `TODO-confirm-crazy_gary-agent` |

Each campaign's phone-call nodes carry a `TODO-confirm-...-agent` placeholder for the voice setter, so they will not place a call until you point them at a real voice setter (below).

---

## Step 1 — Create the persona's setters (the Conductor workflow)

> **Ratified 2026-08-12; first live run pending.** Decision record:
> `Docs/RETELL_PIVOT_DECISION_2026-08-12.md`. Voice personas are shaped in Retell's dashboard
> with Conductor; BFD stays the system of record and owns push, lock, pull and restore. Text
> personas stay entirely in BFD, because Conductor cannot author text and Retell SMS is
> US-A2P-only with no cadences, so the native text engine is permanent.

Do the VOICE setter first and get it right; the text setter is then cloned from it (step 1b).

1. **Push a template from BFD.** In Prompts / setter management find the base Gary voice setter
   (a `Voice-Setter-N` slot), click **Copy**, pick an empty target slot. This clones the prompt +
   config, inactive. (Edge function: `duplicate-setter-config`.) Rename it for the persona, then
   **Save Setter** and **Push to Retell**. The push carries the 5 booking tools with this client's
   URLs and `intake_lead_secret`, which is the part Retell cannot do for you.
2. **F9-lock the slot BEFORE opening the Retell dashboard.** An unlocked slot has its dashboard
   edits clobbered by the next BFD push: the doc-model push sends the prompt verbatim.
3. **Shape it in Retell with Conductor.** One plain-English instruction carrying the persona's
   framing (templates below). **Instruct it that the compliance lines stay VERBATIM** (AI
   disclosure, recording disclosure, NCCP guardrail). Conductor exists to improve prompts and will
   reword a legal boundary unless told not to.
4. **Tweak and QA** (Step 4 below, plus the three post-Conductor checks in
   `SOP/DEMO_PROSPECT_SETUP.md` Step 6: compliance verbatim, 5 booking tools present, phone not
   pinned to an old agent version after a dashboard publish).
5. **Pull Retell Config** from the setter tile to archive the known-good agent into BFD. As of
   2026-08-12 this is a full-fidelity snapshot: prompt and tool definitions stored verbatim, so it
   can be restored, not just diffed.

### Step 1b — Clone the finished voice persona to text

Once the voice agent is good, open the persona's **text** setter, click **COPY OTHER SETTER**, and
pick the voice slot as the source. Voice-to-text runs the dedicated conversion
(`clone-voice-to-text`, built 2026-08-12): it converts the live prompt document, preserves the
compliance lines word for word, strips voice-only tooling, call flow and spoken filler, and refuses
to save anything that fails the text lint or that came back too short to be a real conversion.

> **Caveat, by design and worth knowing:** the clone lands in the text setter's live prompt, but the
> section editor below still shows the older parameter-built prompt. Do not re-save there afterwards
> or the clone is overwritten.

Note the slot id (`Voice-Setter-N` / `Setter-N`); you'll select it in the campaign next.

### Step 1c — Two things that still apply to every new voice setter

> **Confirm the agent is bookable.** After Save, check the agent has the 5 voice-booking tools
> (`get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`,
> `cancel-appointments`). If a new/cloned setter comes through without them, turn the **Booking
> Function** toggle ON and Save/Push (see CLIENT_ONBOARDING_SOP.md section 4.3 for the known
> create-setter bug + workaround). If you see a `get_contact` tool on the agent, that is a known
> phantom: report it to Brendan and do not rely on it (live booking uses the 5 tools above).

**Voice only:** assign a Twilio number to the agent if it places outbound calls (see [GHL_SETUP.md](GHL_SETUP.md) / FORM_ROUTING voice provisioning).

### Persona instruction templates (edit to taste — final wording is yours)

Paste these into **Conductor** in the Retell dashboard (step 1.3). They also still work verbatim in
the BFD UI's per-section **Modify with AI**, which is the legacy path (see the note at the end of
this section) and the only path for TEXT setters.

Base agent reference: `frontend/src/data/bfdVoiceSetterPrompt.md` (the current Gary). Keep the disclosure/compliance and booking sections intact; only re-shape persona framing.

- **Property Coach:** "Reframe this setter as a property-investment coaching assistant. Keep Gary's name, AI disclosure, and booking flow unchanged. Adjust tone and examples to property investors (portfolio growth, rental yield, first-touch follow-up of property enquiries)."
- **Mortgage Broker:** "Reframe for a mortgage-broker coaching audience. Keep disclosure + booking intact. Use broker-relevant framing (loan pipeline, client follow-up, settlement timelines)."
- **Finance Strategist:** "Reframe for a finance/wealth-strategist audience. Keep disclosure + booking intact. Use wealth-strategy framing (planning, advisory follow-up)."
- **Crazy Gary:** "Keep all compliance, disclosure, and booking sections intact. Make the personality noticeably high-energy and playful while staying professional and on-task."

> These are starting points. The actual persona copy is yours to finalize; Claude does not edit live
> prompt content directly.

<details>
<summary><strong>Legacy path: Modify with AI in the BFD UI</strong> (still works, no longer the default for voice)</summary>

Before 2026-08-12, voice personas were shaped here: open the new slot, click **MODIFY WITH AI**
(Sparkles) on the section to re-shape (typically "WHO YOU ARE" and "PERSONA RULES"), type the
instruction, review the diff, apply, then **Save Setter**.

Still true, and still the ONLY path for TEXT setters, which Conductor cannot author. Two caveats:
the **per-section Sparkles** buttons work, but the **top-bar Modify-with-AI button is dead** (dead
env var since 2026-05-19; backlogged by Brendan 2026-08-12, manual paste workaround stands). And a
UI edit re-pushes the prompt, so on a voice slot it clobbers Conductor's work unless you unlock
deliberately.

</details>

---

## Step 2 — Point the campaign at the persona's setters

Open the persona's campaign in the Workflows editor (click into it):

- **Text setter (campaign-level):** in the Engage config there is a **"Text Setter"** picker ("Handles SMS and WhatsApp replies for this campaign"). Set it to the persona's `Setter-N`. This is saved on the campaign (`engagement_campaigns.text_setter_number`) and used for all inbound text replies in this campaign.
- **Voice setter (per phone-call node):** open each `phone_call` node and set its **Voice Setter** picker to the persona's `Voice-Setter-N` (this replaces the `TODO-confirm-...-agent` placeholder).
- **Activate** the campaign (Power toggle).

That is the whole binding: text setter at the top of the campaign, voice setter on each call node. (See the note in GHL_SETUP.md about a future campaign-level voice-setter default.)

---

## Step 3 — Wire the form choice to the tag (GHL)

In the Try-Gary form's automation, branch on the lead's "Choose your agent" selection and add the matching tag from the table above. See [GHL_SETUP.md](GHL_SETUP.md) §3 for the exact automation nodes. Add all persona tags to the central "Add Lead" automation's trigger filter.

---

## Step 4 — Verify
Submit a test lead with one persona tag (use a tag bound to an **inactive** campaign, or a contact with no phone, to avoid a live call), then:
```sql
select form_source, workflow_id, started_at
from engagement_executions order by started_at desc limit 5;
```
`form_source` should be the persona tag and `workflow_id` the persona's campaign. Once you confirm routing and the agent is set, activate and run a real test.

See also: [GHL_SETUP.md](GHL_SETUP.md) (forms/automations), [FORM_ROUTING.md](../Docs/FORM_ROUTING.md) (routing internals + voice provisioning).
