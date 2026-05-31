# Form Routing & Voice Agent Provisioning

How inbound forms route to cadences/agents, the exact BFD setup (main form + Try-Gary), how to add more forms, and how to provision additional voice agents when needed.

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
The Try-Gary landing page posts `source: "try-gary-landing"` directly to `ghl-tag-webhook`, which has a dedicated handler. It routes to the cadence tagged **`bfd_setter-try_gary`** (constant `TRY_GARY_WORKFLOW_TAG`), falling back to the single active new-leads cadence if none is tagged. Persona → agent selection within that cadence is driven by `clients.try_gary_persona_slots` (maps `agent_style` → a voice setter slot 1-10).

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
3. No GHL form/workflow change needed: the Try-Gary landing posts directly to `ghl-tag-webhook` and now resolves to this tagged cadence.
4. (Optional) To use different voice personas, set `clients.try_gary_persona_slots`, e.g. `{ "property-coach": 4, "mortgage-broker": 5 }` (style → voice setter slot). Provision those slots first (see below).

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
4. **Use it in a cadence**: reference the slot (`Voice-Setter-N`) in a phone-call node, or (for Try-Gary) map a persona to the slot via `try_gary_persona_slots`.

Cost note: Retell agents and Twilio numbers are external, paid resources.

---

See also: [ARCHITECTURE.md](ARCHITECTURE.md) (capability set), [CADENCE_DESIGN.md](CADENCE_DESIGN.md) (cadence engine), [ROADMAP.md](ROADMAP.md) (planned voice-setter UI follow-ups).
