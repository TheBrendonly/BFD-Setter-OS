# Connecting the AI Setter to HubSpot: Recommended Approach

*A short summary for the client conversation. Plain language, no jargon.*

## The recommendation in one line

Treat **HubSpot as the home of every lead**. The lead is created in HubSpot first, our system picks it up and works it (texts and calls), then writes the results back onto that same HubSpot contact. Because we only ever update contacts that HubSpot already created, your database stays clean. We never add duplicates.

## How a lead flows

1. **Lead enters HubSpot** your normal way (a form, an import, manual entry). HubSpot does what it always does.
2. **HubSpot tells our system** about the new lead and hands us that lead's permanent HubSpot ID. We mark the lead as "Being worked by AI" so your team can see it is in progress.
3. **Our AI setter works the lead** by SMS and voice call, using our own phone system. This step does not touch HubSpot.
4. **When the lead books**, the appointment is created in the calendar (via GoHighLevel, which connects to your Google or Microsoft calendar), and the booking is also written onto the HubSpot contact straight away so your team sees it.
5. **At the end of the sequence**, we update the HubSpot contact with the full story: booked or not, the appointment time, how many calls and texts, a call summary, and the final outcome.

## Why your HubSpot stays clean (the important part)

Because every lead is born in HubSpot, our system only ever **updates the contact that already exists, by its HubSpot ID**. HubSpot does not allow an update to create a new record, so there is no path for our integration to add a duplicate to your database. This is a built in guarantee, not a best effort.

One technical note worth knowing: HubSpot automatically prevents duplicates by **email address**, but it does **not** do this for phone numbers. That is exactly why we let HubSpot create the contact rather than creating it ourselves. It keeps the matching in HubSpot's hands, where it is reliable.

## What GoHighLevel is still used for

Only the **calendar and booking**. GoHighLevel already connects reliably to Google and Microsoft calendars, and it is the piece most likely to break if we rebuilt it, so we keep it for that one job. A GoHighLevel contact is created **only when a lead actually books**. Leads that never book never touch GoHighLevel.

## The one situation to be aware of

This clean, no duplicates approach is airtight for leads that **start in HubSpot**. The only tricky case is a lead that arrives with **no email address and from a source outside HubSpot**, because HubSpot cannot automatically match those by phone. The simple fix is to route lead sources through HubSpot wherever possible. If most leads already start in HubSpot, this is a non issue.

## A few things to confirm with the client

1. **Where do your leads come from?** Do they all start in HubSpot, or do some arrive somewhere else first? (This decides whether the no duplicates guarantee is total.)
2. **Which HubSpot plan are you on?** This decides whether we use HubSpot's "Leads" board or a deal pipeline to show the "Being worked by AI" status.
3. **When do you want HubSpot updated?** Our suggestion: a status flag at the start, the appointment the moment it is booked, and a full summary at the end. We can add live mid sequence updates if you prefer, at a small extra cost in complexity.
4. **Should a rep be able to stop the AI from inside HubSpot?** For example, if a rep marks a lead as do not contact mid sequence, do you want our system to pause automatically? (This is doable but adds two way syncing.)

## Getting connected: what we will need from you

Good news: connecting HubSpot is closer to "hand us a key" than to the involved Google API setup. There are no complicated approval screens. The whole process:

1. A HubSpot **Super Admin** creates a **Private App** (Settings, then Integrations, then Private Apps), names it "BFD Setter", and ticks the permissions we list.
2. They copy us **one access token** (it does not expire) and the app's secret. That single token lets our system read leads and write all the updates back.
3. On a quick **10 minute screen share**, they paste our web address into the app's **Webhooks** tab and switch on "Contact created". That is what lets HubSpot tell us the moment a new lead arrives. This one step has to be a click in HubSpot, it cannot be done with the key alone.
4. We send a test lead through to confirm it all connects.

That is it. **No paid HubSpot add-on is required** for any of this, we deliberately avoid the one feature that needs a higher plan. The only thing worth checking is your HubSpot plan: the fanciest "lead board" view needs Sales Hub Professional, and if you are not on that we simply use a status field on the contact instead, which works on every plan.

Down the track, if this is rolled out to more clients, the manual token step can be replaced with a one click "Connect HubSpot" button.

---

*Full technical analysis, with all the API details and sources, is in `Docs/HUBSPOT_GHL_COEXISTENCE_ANALYSIS.md`.*
