# GoHighLevel Setup Guide (forms, tags, automations, webhooks)

The operator playbook for wiring a client's GoHighLevel (GHL) account to BFD-Setter. It explains the framework, then gives the exact automations to build, then a checklist to verify everything is correct. Written for BFD's own account but applies to any client.

Verified against the live code and a real GHL webhook test on 2026-05-31.

---

## 1. The framework (how it all fits)

There are three layers, and they are deliberately decoupled:

```
FORM (source)        ->   TAG (routing key)      ->   ONE WEBHOOK (delivery)   ->   CADENCE (the app)
"Main form"               adds "bfd_setter-new_lead"   sync-ghl-contact              resolver picks the
"Try-Gary form"           adds "bfd_setter-try_gary"   (one URL for everything)      cadence whose tag matches
"Roofing form" (future)   adds "form-roofing"                                        else the default cadence
```

**Yes, your instinct is right, and it is the recommended standard:** each form's automation just **adds a tag**, and **one central automation** (triggered by those routing tags) fires the webhook. This is the model to use.

Why this is the right model:
- **Forms are delineated by their tag.** The tag is the only thing that decides routing. One tag per form/source.
- **Adding a new form later is trivial:** create one tiny "form submitted -> add tag" automation, then create one Campaign in the app bound to that tag. No new webhook plumbing, no new URL.
- **One webhook URL for all lead intake**, so there is a single thing to maintain and monitor.

### The one webhook URL
```
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/sync-ghl-contact
```

### How the client is identified (important)
The webhook figures out which client a lead belongs to from the **GHL location id**, which the **standard Outbound Webhook includes automatically** (as `location.id`, and BFD's also sends a `GHL Account ID` field). You do **not** need to put `?clientId=...` on the URL: that query param is ignored by the function. Just point the standard webhook at the bare URL above.

### How routing is decided (the resolver)
When a lead arrives, the resolver (`_shared/resolve-workflow.ts`) does this:
1. **Tag match:** if any tag on the contact matches the `Form Tag` of an **active** new-leads Campaign, route the lead into that Campaign.
2. **Default fallback:** otherwise route into the client's **default** Campaign (the one with the DEFAULT badge in the Workflows page; stored as `clients.auto_engagement_workflow_id`).
3. **None:** if there is no match and no default, the lead is created but not enrolled.

The standard webhook sends the contact's tags as a comma-separated string (for example `"bfd_setter-new_lead"`); the function parses that correctly (since `sync-ghl-contact` v17). You do not need to map tags into a custom payload.

### One caveat to respect: one routing tag per lead
The resolver takes the **first** matching routing tag (in Campaign sort order). So **routing tags should be mutually exclusive per lead**: a given lead should carry exactly one routing tag (`bfd_setter-new_lead` OR `bfd_setter-try_gary`, not both). If you ever need a lead that could carry several routing tags, use the per-form alternative below instead.

### Alternative: per-form webhook with a pinned tag (only if needed)
If you would rather not rely on the contact's tag list (for example a lead may carry several routing tags), each form's automation can fire its **own** webhook with the tag pinned in the URL:
```
.../sync-ghl-contact?tag=form-roofing
```
The function reads `?tag=` directly, so routing is unambiguous. This costs one webhook action per form (more to maintain), so prefer the central model above unless you specifically need this.

---

## 2. The automations to build

### A. Per-form bridge (one per form) — "delineate the forms"
One small automation per form/source. Its only job is to add that form's routing tag.

| Setting | Value |
|---|---|
| Name | `Form Submit: <Form Name> -> tag` |
| Trigger | **Form Submitted** (filtered to that specific form) |
| Action | **Add Contact Tag** = the routing tag for that form |

Routing tags in use:

| Form / source | Routing tag | Routes to |
|---|---|---|
| Main lead form | `bfd_setter-new_lead` | Main cadence (also the default) |
| Try-Gary form | `bfd_setter-try_gary` | Try-Gary cadence |
| Any future form | pick a unique tag, for example `form-roofing` | the Campaign you bind that tag to |

> The trigger does not have to be "Form Submitted": it can be any event that should start the cadence (a calendar booking, a manual tag, a list import). The pattern is the same: get the routing tag onto the contact.

### B. The one central "Add Lead" automation — "fire the webhook"
A single automation that fires the webhook whenever any routing tag is added.

| Setting | Value |
|---|---|
| Name | `Add Lead to 1Prompt OS` (BFD's existing one) |
| Trigger | **Contact Tag Added**, filtered to the set of routing tags (`bfd_setter-new_lead`, `bfd_setter-try_gary`, and any future ones) |
| Action | **Webhook (standard Outbound)** |
| Method | POST |
| URL | `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/sync-ghl-contact` |
| Payload | Standard (default) — sends the full contact incl. `location.id`, `contact_id`, name/phone/email, and `tags` |

Notes:
- The tag is already on the contact when this fires, because the tag-add **is** the trigger. No ordering problem.
- Use the **standard** Outbound Webhook. It already includes everything the function needs. You do **not** need the Custom Webhook for this.
- If you ever add a routing tag for a new form, just add it to this automation's trigger filter (one edit), then create the Campaign in the app.

### C. Bookings — two automations (BOOKED and CANCELLED)
GHL's appointment merge tags cannot reliably tell "booked" from "cancelled" in a single automation, so use two, each hardcoding its status. They post to a different endpoint (`bookings-webhook`).

Booking webhook URL:
```
https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook
```

| | BOOKED | CANCELLED |
|---|---|---|
| Name | `BFD bookings -> 1prompt (BOOKED)` | `BFD bookings -> 1prompt (CANCELLED)` |
| Trigger | Appointment Status = `confirmed` (and/or `new`) | Appointment Status = `cancelled` |
| Action | **Custom Webhook**, `application/x-www-form-urlencoded`, POST | same |
| Body fields | `appointmentId`, `contactId`, `calendarId`, `locationId`, `startTime`, `endTime`, `status=confirmed` | same but `status=cancelled` |

What it does: upserts the booking, and **BOOKED ends any active cadence** for that contact (stop reason `booking_created`). CANCELLED only records the status (it does not restart a cadence). Hardcode `calendarId`, `locationId`, and `status` per workflow; map `appointmentId`/`contactId`/`startTime`/`endTime` from GHL merge fields.

### D. Opt-out / STOP — already native, nothing to build
Inbound "STOP" is handled in code (`receive-twilio-sms` sets the contact to stopped). The old GHL "Stop / Activate Setter" workflow is vestigial: it is safe to leave published (it does not double-fire) or delete it.

### E. Dormant / deprecated automations (leave alone or delete)
These came from the snapshot and are not used by the native engine. They do no harm if left published:
- **Send Setter Reply**, **Send Engagement**, **Send Followup** — old n8n-era sending paths. The native engine sends directly; these are dormant.
- **Add Booking to 1Prompt OS** — replaced by the two split BOOKED/CANCELLED workflows above. Do not use it.
- The legacy Try-Gary **`source: "try-gary-landing"`** direct webhook — replaced by the tag pattern (it still works for backward compatibility, but new setups should use the tag).

---

## 3. Try-Gary specifics (lead picks the agent = tag-per-persona)

The Try-Gary demo lets the lead **choose which agent calls them**. Each choice is a genuinely different Retell agent, and we route it with the **tag-per-campaign** model (decided 2026-05-31): the agent picker maps each choice to its own tag, each tag routes to its own Try-Gary campaign, and each campaign's phone-call node is set to that persona's Retell agent. No code: it is all GHL config + app campaigns + a Retell agent per persona.

> There is no within-cadence "agent varies by field" override (that mechanism was retired 2026-05-31). The lead's choice picks a **tag/campaign**, not a dynamic agent inside one cadence.

### Tag scheme (one per persona) — campaigns already created
The persona campaigns are cloned and live (inactive) in the app. Generic Demo is the existing base Try-Gary campaign; the rest are dedicated clones.

| Lead picks | Tag the form adds | Campaign (app) | Voice/text setter |
|---|---|---|---|
| Generic Demo | `bfd_setter-try_gary` | Try-Gary (base) | the existing Gary |
| Property Coach | `bfd_setter-try_gary-property_coach` | Try-Gary: Property Coach | persona setters (you create) |
| Mortgage Broker | `bfd_setter-try_gary-mortgage_broker` | Try-Gary: Mortgage Broker | persona setters (you create) |
| Finance Strategist | `bfd_setter-try_gary-finance_strategist` | Try-Gary: Finance Strategist | persona setters (you create) |
| Crazy Gary | `bfd_setter-try_gary-crazy_gary` | Try-Gary: Crazy Gary | persona setters (you create) |

A lead must carry **exactly one** of these tags (mutually exclusive), so routing is unambiguous.

**Creating each persona's setters + pointing the campaign at them: see [PERSONA_SETUP.md](PERSONA_SETUP.md)** (Duplicate setter -> Modify with AI -> select the setter in the campaign).

### Where setters are selected (this is the part that is easy to miss)
You select setters **inside the campaign editor** (click into a campaign), not on the Workflows list:
- **Text setter = campaign-level.** The Engage config has a **"Text Setter"** picker ("Handles SMS and WhatsApp replies for this campaign"); it is stored on `engagement_campaigns.text_setter_number` and handles all inbound text replies for the campaign.
- **Voice setter = per phone-call node.** Each `phone_call` node has its own **Voice Setter** picker (`voice_setter_id`). The persona clones ship with a `TODO-confirm-...-agent` placeholder you replace there.

### Try-Gary form fields
First Name, Phone (required), Email, a consent checkbox, plus **"Choose your agent"** (radio/dropdown whose options are the personas above).

### Try-Gary form-bridge automation (branch on the choice)
- Node 1 (Trigger): **Form Submitted** -> Try-Gary form.
- Node 2 (If/Else on the "Choose your agent" value), one branch per persona, each branch action = **Add Contact Tag** -> the matching tag above. (If your form builder supports per-option tagging, you can skip the If/Else and tag directly from the option.)

### Central "Add Lead" automation
Add **all** the persona tags to Automation 3's trigger filter (the Contact Tag Added list), alongside `bfd_setter-new_lead`. They all post to the same one webhook URL.

### App: campaigns (already created)
The five persona campaigns exist in the app (cloned from the base Try-Gary cadence, inactive, correctly tagged). For each one you only need to: create the persona's setters, select them in the campaign (text setter at campaign level, voice setter on each phone-call node), then **activate**. Full steps: [PERSONA_SETUP.md](PERSONA_SETUP.md).

### Provisioning (Brendan, external + paid)
Each persona needs its own Retell agent (and an outbound number if it places calls), plus a text setter if it replies by SMS. Create them by duplicating the base Gary and re-shaping with "Modify with AI" (see PERSONA_SETUP.md), then select the resulting `Voice-Setter-N` / `Setter-N` in the campaign.

**Scaling note:** this is linear (N personas = N campaigns + N Retell agents). That is the trade-off of tag-per-campaign. If persona count grows large and per-persona cadence content is identical, the (retired) within-cadence override would cut maintenance to one cadence; revisit only if that becomes painful.

---

## 4. Verification checklist

For each automation, confirm:

**Lead intake**
- [ ] Each form has a "Form Submitted -> Add Tag" automation, and the tag is spelled **exactly** (e.g. `bfd_setter-try_gary`, underscores not hyphens).
- [ ] Exactly one central "Add Lead" automation exists; its trigger lists every routing tag.
- [ ] Its webhook is the **standard** Outbound Webhook, POST, to the bare `sync-ghl-contact` URL (no `?clientId=`).
- [ ] Each routing tag maps to exactly one **active** Campaign in the app (Workflows page), and the main cadence shows the **DEFAULT** badge.
- [ ] A lead carries only **one** routing tag at a time.

**Bookings**
- [ ] Two booking automations exist (BOOKED + CANCELLED), each posting form-encoded to `bookings-webhook` with `appointmentId`, `contactId`, `calendarId`, `locationId`, `startTime`, `endTime`, `status`.

**Cleanup**
- [ ] No GHL contact custom field holds a secret. (BFD currently has an empty field literally named "Supabase Service Role Key" — rename or remove it so a secret can never be sent in a webhook payload.)

### End-to-end test (safe)
1. Create a dummy contact and add a routing tag that is **not** bound to any active cadence (or use a contact with no phone) so no real call/SMS fires.
2. Confirm the lead arrived and routed:
   ```sql
   select form_source, workflow_id, enrollment_source, started_at
   from engagement_executions
   order by started_at desc limit 5;
   ```
   `form_source` should equal the routing tag, and `workflow_id` the intended cadence (or the default when the tag has no active cadence).

---

## 5. Reference: what each endpoint reads

| Endpoint | Purpose | Identifies client by | Routing tag from |
|---|---|---|---|
| `sync-ghl-contact` | Canonical lead intake (use this) | `location.id` / `GHL_Account_ID` | `?tag`/`?Tag`/`?Form_Tag`/`?route_tag`, `?tags=`, body `tag`/`tags`, `contact.tags` (array or comma-string) |
| `ghl-tag-webhook` | Older greenfield tag-trigger path (still works) | location id | `addedTags`/`tags` |
| `intake-lead` | API / website snippet (needs a bearer secret) | `?clientId` + secret | body `tags[]` |
| `bookings-webhook` | Appointment created/updated/cancelled | location id | n/a (booking, not lead) |

---

## 6. BFD current setup, build-ready (2 forms + 5 automations)

This is the exact set to have right now. Field = what the form collects (mapped to the GHL standard contact field). Nodes = the steps inside the GHL automation.

### Forms (2)

**Form 1 — Main Lead Form** (on buildingflowdigital.com)

| Form field | Maps to GHL contact field | Required? |
|---|---|---|
| First Name | `first_name` | yes |
| Last Name | `last_name` | recommended |
| Email | `email` | recommended |
| Phone | `phone` | **required** (no phone = no call/SMS) |

**Form 2 — Try-Gary Form**

| Form field | Maps to GHL contact field | Required? |
|---|---|---|
| First Name | `first_name` | yes |
| Phone | `phone` | **required** |
| Email | `email` | recommended |
| Consent checkbox ("I agree to be contacted by an AI agent") | a custom field or note | recommended (it places live calls) |

Only First Name + Phone + Email actually need to reach the webhook (they ride on the standard contact fields automatically). Extra form fields are fine; they just aren't used for routing/calling unless you add them as Custom Data on the webhook.

### Automations (5)

**Automation 1 — `Form Submit: Main Form -> tag`**
- Node 1 (Trigger): **Form Submitted** -> filter to the Main Lead Form.
- Node 2 (Action): **Add Contact Tag** -> `bfd_setter-new_lead`.

**Automation 2 — `Form Submit: Try-Gary -> tag`**
- Node 1 (Trigger): **Form Submitted** -> filter to the Try-Gary Form.
- Node 2 (Action): **Add Contact Tag** -> `bfd_setter-try_gary`.

**Automation 3 — `Add Lead to 1Prompt OS`** (the one central webhook)
- Node 1 (Trigger): **Contact Tag** (Added) -> filter tags: `bfd_setter-new_lead`, `bfd_setter-try_gary` (add future routing tags here).
- Node 2 (Action): **Webhook** (standard Outbound)
  - Method: `POST`
  - URL: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/sync-ghl-contact` (no `?clientId=`)
  - Payload: standard/default (sends `location.id`, `contact_id`, name/phone/email, `tags`). No custom mapping needed.

> You likely already have a combined version of Automations 1 + 3 for the main form ("Add Lead to BFD-Setter OS"). That still works. The clean split above is what scales as you add forms: every form just drops a tag, and Automation 3 is the only thing that talks to the webhook.

**Automation 4 — `BFD bookings -> 1prompt (BOOKED)`**
- Node 1 (Trigger): **Appointment Status** -> filter: `Confirmed` (and/or `New`).
- Node 2 (Action): **Custom Webhook**
  - Method: `POST`, Content-Type: `application/x-www-form-urlencoded`
  - URL: `https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook`
  - Body fields:
    - `appointmentId` = `{{appointment.id}}`
    - `contactId` = `{{contact.id}}`
    - `calendarId` = `{{appointment.calendar.id}}` (or hardcode the calendar id)
    - `locationId` = `{{location.id}}` (or hardcode)
    - `startTime` = `{{appointment.start_time}}`
    - `endTime` = `{{appointment.end_time}}`
    - `status` = `confirmed` (hardcoded)

**Automation 5 — `BFD bookings -> 1prompt (CANCELLED)`**
- Same as Automation 4, but Node 1 filter: `Cancelled`, and body `status` = `cancelled`.
- (BOOKED ends the active cadence; CANCELLED only records the status.)

### Tag spelling (exact)
- `bfd_setter-new_lead` (underscore between `bfd` `setter`... it is `bfd_setter` then hyphen `new_lead`).
- `bfd_setter-try_gary`.

These must match the Form Tag set on each Campaign in the app's Workflows page exactly.

---

See also: [FORM_ROUTING.md](FORM_ROUTING.md) (routing internals), [ARCHITECTURE.md](ARCHITECTURE.md) (system overview), [CADENCE_DESIGN.md](CADENCE_DESIGN.md) (the cadence engine).
