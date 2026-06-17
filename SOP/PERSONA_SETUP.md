# Try-Gary Persona Setup (per-persona setters + campaigns)

How to stand up each Try-Gary persona end to end: create its voice + text setters (by duplicating the base Gary and re-shaping with "Modify with AI"), then point its campaign at those setters and activate it.

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

## Step 1 — Create the persona's setters (Duplicate + Modify with AI)

Do this once per persona, for **voice** and (if the persona replies by text) **text**.

1. **Duplicate the base setter.** Go to Prompts / setter management, find the base Gary setter (voice: a `Voice-Setter-N` slot; text: a `Setter-N` slot), click the **Copy** icon, and pick an empty target slot. This clones the prompts + config into the new slot, set inactive. (Edge function: `duplicate-setter-config`.)
2. **Open the new slot** and rename it for the persona (e.g. "Mortgage Broker").
3. **Modify with AI.** In the prompt editor, click **MODIFY WITH AI** (Sparkles icon) on the section(s) you want to re-shape (typically "WHO YOU ARE" and "PERSONA RULES"). Type a natural-language instruction (see templates below). The AI rewrites that section while preserving the prompt's structure. Review the diff, apply.
4. **Save Setter.** This provisions the Retell agent (voice) or triggers the text-setter sync. Note the slot id (`Voice-Setter-N` / `Setter-N`); you'll select it in the campaign next.

   > **Confirm the agent is bookable.** After Save, check the agent has the 5 voice-booking tools
   > (`get-available-slots`, `book-appointments`, `get-contact-appointments`, `update-appointment`,
   > `cancel-appointments`). If a new/cloned setter comes through without them, turn the **Booking
   > Function** toggle ON and Save/Push (see CLIENT_ONBOARDING_SOP.md section 4.3 for the known
   > create-setter bug + workaround). If you see a `get_contact` tool on the agent, that is a known
   > phantom: report it to Brendan and do not rely on it (live booking uses the 5 tools above).
5. **Voice only:** assign a Twilio number to the agent if it places outbound calls (see [GHL_SETUP.md](GHL_SETUP.md) / FORM_ROUTING voice provisioning).

### "Modify with AI" instruction templates (edit to taste — final wording is yours)
Base agent reference: `frontend/src/data/bfdVoiceSetterPrompt.md` (the current Gary). Keep the disclosure/compliance and booking sections intact; only re-shape persona framing.

- **Property Coach:** "Reframe this setter as a property-investment coaching assistant. Keep Gary's name, AI disclosure, and booking flow unchanged. Adjust tone and examples to property investors (portfolio growth, rental yield, first-touch follow-up of property enquiries)."
- **Mortgage Broker:** "Reframe for a mortgage-broker coaching audience. Keep disclosure + booking intact. Use broker-relevant framing (loan pipeline, client follow-up, settlement timelines)."
- **Finance Strategist:** "Reframe for a finance/wealth-strategist audience. Keep disclosure + booking intact. Use wealth-strategy framing (planning, advisory follow-up)."
- **Crazy Gary:** "Keep all compliance, disclosure, and booking sections intact. Make the personality noticeably high-energy and playful while staying professional and on-task."

> These are starting points. The actual persona copy is yours to finalize via the AI tool; Claude does not edit live prompt content directly.

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
