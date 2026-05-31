# Form Routing & Voice Agent Provisioning

How inbound forms route to cadences/agents, the exact BFD setup (main form + Try-Gary), how to add more forms, and how to provision additional voice agents when needed.

## Canonical client setup (the standard): ONE webhook URL + tag

Every client uses a **single inbound webhook URL** — the `sync-ghl-contact` edge function — and routing is decided entirely by the **tag** the lead arrives with. There is no per-form webhook URL.

Per form / per agent, the only setup is a **GHL automation** that:
1. adds the routing tag to the contact (e.g. `bfd_setter-new_lead`, `bfd_setter-try_gary`, `form-roofing`...), and
2. posts to the one webhook URL (`sync-ghl-contact`), passing that tag.

Then in the app you create one **Campaign** per tag (clone an existing one and change the tag), each carrying its own agent. The resolver matches the tag → that campaign; no match → the client's default campaign.

**"Different agent per form/field" = tag-per-campaign.** If a form field should pick the agent, have the GHL automation add a different tag per value, each mapped to its own campaign. (A within-cadence "agent varies by field, one cadence" override is intentionally NOT built — the tag-per-campaign model is the standard.)

**Try-Gary note:** historically Try-Gary used a separate direct webhook (`source=try-gary-landing`) plus a per-persona voice-setter override (`clients.try_gary_persona_slots`). Both are **legacy/deprecated as of 2026-05-31**. Try-Gary now follows the same pattern as everything else: its form's automation adds the `bfd_setter-try_gary` tag and posts to the one URL, and the Try-Gary cadence's own phone_call node decides which agent calls (tag-per-campaign). There is no within-cadence "agent varies by persona/field" override — that mechanism was removed.

## How routing works

Each client can have **many** "new leads" cadences (engagement workflows), each bound to a distinct GHL **tag** (`engagement_workflows.new_leads_tag`). When a lead arrives, the system resolves which cadence to enrol it in:

- **Tag match** → the cadence whose `new_leads_tag` equals an inbound tag.
- **No match** → the client's **default** cadence (`clients.auto_engagement_workflow_id`).
- **No default** → no enrolment.

Resolver: `frontend/supabase/functions/_shared/resolve-workflow.ts`. It's used by the three inbound ingress functions:

| Ingress | Used by | Tag source |
|---|---|---|
| `ghl-tag-webhook` | greenfield / tag-update flows | the added GHL tag(s) |
| `sync-ghl-contact` | snapshot clients (Pattern B) | `Tag`/`tag`/`Form_Tag`/`route_tag` query param, `body.tag`/`body.tags`, or `contact.tags` |
| `intake-lead` | API / website snippet | `tags[]` in the JSON body |

**Default-cadence rule:** in the Workflows UI, the **first** cadence you toggle "NEW LEADS" on becomes the client's default (untagged-fallback). Additional ones are tag-routed only.

### Try-Gary (BFD-specific)
The canonical path is the one-URL+tag pattern above: the Try-Gary form adds the `bfd_setter-try_gary` tag and posts to `sync-ghl-contact`, which routes to the cadence tagged **`bfd_setter-try_gary`**, else the default.

A **deprecated** legacy path still exists for backward compatibility: the old Try-Gary landing page posts `source: "try-gary-landing"` directly to `ghl-tag-webhook`, whose handler resolves the same `bfd_setter-try_gary` cadence (constant `TRY_GARY_WORKFLOW_TAG`), falling back to the single active new-leads cadence if none is tagged. As of 2026-05-31 this handler **no longer applies any per-persona voice-setter override** — `clients.try_gary_persona_slots` is retired and unread. The agent that calls is whatever the cadence's phone_call node is set to. New setups should not use the `try-gary-landing` direct webhook.

---

## Exact setup — BFD's two forms

You have a **main form** and the **Try-Gary form**. Both ingress paths already exist; you only configure cadences in the app.

### 1. Main form → main cadence (the default)
1. App → **Workflows**.
2. Open (or create) your **main cadence** and toggle **NEW LEADS** on. Because it's the first one toggled on, it becomes the client **default** (`auto_engagement_workflow_id`). Tag can be left blank (it's the fallback) or set to `bfd_setter-new_lead` for clarity.
3. No GHL change needed: your main form already tags + syncs leads, and as the default cadence it catches them.

### 2. Try-Gary form → Try-Gary cadence
1. App → **Workflows** → open (or create) the **Try-Gary cadence** (the persona/agent setup for the demo).
2. Toggle **NEW LEADS** on and set the **form tag** to exactly **`bfd_setter-try_gary`**.
3. Point the Try-Gary form's GHL automation at the one webhook URL (`sync-ghl-contact`) and have it add the `bfd_setter-try_gary` tag. (The legacy `try-gary-landing` direct webhook still resolves the same cadence, but the canonical setup is the one-URL+tag pattern.)
4. Set the agent that calls in the cadence itself: open the Try-Gary cadence's phone_call node(s) and choose the voice setter. (There is no per-persona override anymore — one cadence, one configured agent per phone_call node. To vary the agent by form, use a separate tag + campaign.)

### Result
- Main-form leads → main cadence/agent (default).
- Try-Gary leads → Try-Gary cadence/agent (tagged), with per-persona agent if configured.

### Verify
```sql
-- after a test lead from each form:
select form_source, workflow_id, enrollment_source, started_at
from engagement_executions order by started_at desc limit 5;
```

---

## Adding a new form later

To route a **third** form to its own cadence/agent:
1. Pick a tag, e.g. `form-webinar`.
2. **Make sure the tag reaches the webhook.** Easiest paths:
   - Greenfield: the GHL workflow adds the tag and the contact-tag webhook fires `ghl-tag-webhook` (the added tag is in the payload automatically).
   - Snapshot (Pattern B via `sync-ghl-contact`): include the tag in the call — either pass `?tag=form-webinar` / a `tags[]` body field, or ensure the webhook payload includes `contact.tags`. (If the tag can't reach the webhook, the lead falls back to the default cadence.)
3. App → **Workflows** → the target cadence → **NEW LEADS** on → set its **form tag** to `form-webinar`.
4. Test and confirm via the `engagement_executions` query above.

Each tag must be unique per client (the UI rejects duplicates).

---

## Provisioning additional voice agents (future reference)

Today a client supports up to **10 voice agents** via slots (`clients.retell_*_agent_id` / `retell_agent_id_4..10`), surfaced in the **Voice setup → Retell Agents** tab. They are mirrored into the `voice_setters` UUID model (with `voice_setter_phone_bindings`) automatically. You do NOT need to do this now; it's only required when you actually want a new distinct voice agent.

When you do need one:

1. **Create / configure the agent** in the app's voice setter editor and **Push to Retell** (this provisions the Retell LLM + agent and writes both the legacy slot column and the `voice_setters` row via `retell-proxy`).
2. **Assign it to a slot** in the **Retell Agents** tab (slots 1-10 are shown).
3. **Phone number** (Twilio): each agent that places/receives calls needs a number.
   - Slots 1-3 use the legacy columns `retell_phone_1..3` (already backfilled into `voice_setter_phone_bindings` as outbound bindings).
   - For slots 4-10 today, set the number via the legacy mechanism / DB; a per-setter phone-binding UI is a planned enhancement (see ROADMAP). The call resolver reads the outbound binding (`voice_setter_phone_bindings.direction='outbound'`), else the slot's legacy phone.
   - Buy/port numbers in Twilio; one number should belong to **one** client (run `scripts/phone_uniqueness_audit_and_fix.sql` before scaling clients).
4. **Use it in a cadence**: reference the slot (`Voice-Setter-N`) in a phone-call node of the relevant campaign. (To have a different agent per form, give each form its own tag + campaign and set that campaign's phone-call node to the desired agent.)

Cost note: Retell agents and Twilio numbers are external, paid resources.

---

See also: [ARCHITECTURE.md](ARCHITECTURE.md) (capability set), [CADENCE_DESIGN.md](CADENCE_DESIGN.md) (cadence engine), [ROADMAP.md](ROADMAP.md) (planned voice-setter UI follow-ups).
