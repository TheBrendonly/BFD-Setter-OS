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

## 3. Try-Gary specifics
1. Try-Gary form's automation adds the tag `bfd_setter-try_gary` (per section 2A).
2. The central "Add Lead" automation fires the webhook (per section 2B); it routes to the Try-Gary cadence because that cadence's Form Tag is `bfd_setter-try_gary`.
3. Before it will actually call anyone, in the app you must: (a) open the Try-Gary cadence and replace the `TODO-confirm-try-gary-agent` placeholder in each phone-call node with the real voice agent, and (b) toggle the cadence **active** (it ships inactive on purpose).

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

See also: [FORM_ROUTING.md](FORM_ROUTING.md) (routing internals), [ARCHITECTURE.md](ARCHITECTURE.md) (system overview), [CADENCE_DESIGN.md](CADENCE_DESIGN.md) (the cadence engine).
