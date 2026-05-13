-- Cadence v2 — Day 7. Insert BFD's "Default New-Lead Cadence v2" as a
-- DRAFT (is_active=false) so it can be eyeballed in the Engagement editor
-- canvas before being switched on. Phase 1 (Day 0-2, 6 touches, static
-- templates) preserves today's behavior; Phase 2 (Day 4-10, 4 touches,
-- AI-generated) and Phase 3 (Day 11-21, 3 email touches, AI-generated)
-- are net-new.
--
-- 28 nodes: 14 engage + 14 wait_for_reply. Channels: 6 SMS, 3 phone_call,
-- 5 email. 7 channels carry ai_generate=true.
--
-- To activate (after eyeballing in the editor):
--   UPDATE engagement_workflows SET is_active=true
--     WHERE id='c206da3e-b8b7-41f8-9de0-997679abefcb';  -- new v2
--   UPDATE engagement_workflows SET is_active=false
--     WHERE id='40e8bea3-b6f6-4562-98d1-f7e6599af6a1';  -- old v1
--   UPDATE clients SET auto_engagement_workflow_id='c206da3e-b8b7-41f8-9de0-997679abefcb'
--     WHERE id='e467dabc-57ee-416c-8831-83ecd9c7c925';
--
-- To roll back: invert above (point back to 40e8bea3-…).

-- Idempotent guard: only insert if no row exists for this client with
-- this exact name. (Production already has this row from the
-- Management API insert at 2026-05-13; the IF NOT EXISTS guard protects
-- a fresh clone from a duplicate.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM engagement_workflows
    WHERE client_id = 'e467dabc-57ee-416c-8831-83ecd9c7c925'
      AND name = 'Default New-Lead Cadence v2 (DRAFT — 28-node cadence-v2)'
  ) THEN
    INSERT INTO engagement_workflows (id, client_id, name, is_active, sort_order, nodes)
    VALUES (
      'c206da3e-b8b7-41f8-9de0-997679abefcb',
      'e467dabc-57ee-416c-8831-83ecd9c7c925',
      'Default New-Lead Cadence v2 (DRAFT — 28-node cadence-v2)',
      false,
      99,
      $cadence$
[
  {
    "id": "n1",
    "type": "engage",
    "message": "Hey {{first_name}}, Brendan here \u2014 calling you in 1 min about your enquiry.",
    "channels": [
      {
        "type": "sms",
        "enabled": true,
        "message": "Hey {{first_name}}, Brendan here \u2014 calling you in 1 min about your enquiry.",
        "delay_seconds": 0
      }
    ]
  },
  {
    "id": "n2",
    "type": "wait_for_reply",
    "timeout_seconds": 60
  },
  {
    "id": "n3",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "phone_call",
        "enabled": true,
        "message": "",
        "instructions": "First outbound call to a fresh lead. They enquired about BFD's AI setter and got an SMS 1 minute ago saying Brendan would call. Open with: 'Hey {{first_name}}, Brendan here, you enquired earlier, got 2 minutes?'. Be warm and Aussie-direct. Qualify their business, current lead volume, and how they handle first-touch follow-up. Book a 15-min strategy call if interested. Do NOT leave a voicemail if it goes to voicemail, the cadence will text instead.",
        "delay_seconds": 0,
        "voice_setter_id": "Voice-Setter-2",
        "treat_pickup_as_reply": true
      }
    ]
  },
  {
    "id": "n4",
    "type": "wait_for_reply",
    "timeout_seconds": 1
  },
  {
    "id": "n5",
    "type": "engage",
    "message": "Hey {{first_name}}, just tried calling about your enquiry. When suits for a quick chat? Happy to lock something in. Brendan",
    "channels": [
      {
        "type": "sms",
        "enabled": true,
        "message": "Hey {{first_name}}, just tried calling about your enquiry. When suits for a quick chat? Happy to lock something in. Brendan",
        "delay_seconds": 0
      }
    ]
  },
  {
    "id": "n6",
    "type": "wait_for_reply",
    "timeout_seconds": 28800
  },
  {
    "id": "n7",
    "type": "engage",
    "message": "Hey {{first_name}}, still keen for a quick chat about your enquiry? Brendan",
    "channels": [
      {
        "type": "sms",
        "enabled": true,
        "message": "Hey {{first_name}}, still keen for a quick chat about your enquiry? Brendan",
        "delay_seconds": 0
      }
    ]
  },
  {
    "id": "n8",
    "type": "wait_for_reply",
    "timeout_seconds": 57600
  },
  {
    "id": "n9",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "phone_call",
        "enabled": true,
        "message": "",
        "instructions": "Day-2 follow-up call. They missed yesterday's call and got two SMS. Open: 'Hey {{first_name}}, Brendan here, just trying you again about your enquiry, do you have a quick minute?'. Keep it casual and low-pressure. Book a 15-min strategy call if any interest.",
        "delay_seconds": 0,
        "voice_setter_id": "Voice-Setter-2",
        "treat_pickup_as_reply": true
      }
    ]
  },
  {
    "id": "n10",
    "type": "wait_for_reply",
    "timeout_seconds": 1
  },
  {
    "id": "n11",
    "type": "engage",
    "message": "Hey {{first_name}}, missed you again on the call \u2014 happy to lock in any time that works. Brendan",
    "channels": [
      {
        "type": "sms",
        "enabled": true,
        "message": "Hey {{first_name}}, missed you again on the call \u2014 happy to lock in any time that works. Brendan",
        "delay_seconds": 0
      }
    ]
  },
  {
    "id": "n12",
    "type": "wait_for_reply",
    "timeout_seconds": 172800
  },
  {
    "id": "n13",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "email",
        "enabled": true,
        "message": "Fallback body if AI generation fails: thought you might find this useful \u2014 a quick read on how teams in your space are using AI setters to handle first-touch follow-up without burning their team out. Open to a 15-min chat if it lands.",
        "subject": "Quick read on AI-setter follow-up",
        "delay_seconds": 0,
        "ai_generate": true,
        "ai_prompt": "Day-4 value-add email. Lead enquired 4 days ago and hasn't replied. Send a useful, non-pushy email that references their industry (from custom_fields) if available and shows how peers handle first-touch follow-up using an AI setter. Include ONE link-style ask (book a 15-min chat). Subject must be specific and benefit-oriented, never 'Following up' or 'Quick question'."
      }
    ]
  },
  {
    "id": "n14",
    "type": "wait_for_reply",
    "timeout_seconds": 172800
  },
  {
    "id": "n15",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "sms",
        "enabled": true,
        "message": "Hey {{first_name}}, sent you a quick read on Tuesday \u2014 any thoughts? Brendan",
        "delay_seconds": 0,
        "ai_generate": true,
        "ai_prompt": "Day-6 SMS follow-up on the value-add email sent 2 days ago. Reference what they last said in the conversation (if any) or the email content. \u2264300 chars. Don't ask 'still interested?' \u2014 ask something more specific. End with first-name only sign-off."
      }
    ]
  },
  {
    "id": "n16",
    "type": "wait_for_reply",
    "timeout_seconds": 172800
  },
  {
    "id": "n17",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "phone_call",
        "enabled": true,
        "message": "",
        "instructions": "Day-8 follow-up call. Final outbound voice attempt before the cadence cools down. They've had 1 voice attempt, 3 SMS, 1 email \u2014 go in soft. Open: 'Hey {{first_name}}, Brendan here, just checking in once more before I close out the loop on your enquiry \u2014 got a quick minute?'. If they pick up: qualify lightly, book if there's any interest, otherwise gracefully release.",
        "delay_seconds": 0,
        "voice_setter_id": "Voice-Setter-2",
        "treat_pickup_as_reply": true
      }
    ]
  },
  {
    "id": "n18",
    "type": "wait_for_reply",
    "timeout_seconds": 1
  },
  {
    "id": "n19",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "sms",
        "enabled": true,
        "message": "Just tried you again {{first_name}} \u2014 totally fine if the timing's off. Last shot from me here. Brendan",
        "delay_seconds": 0,
        "ai_generate": true,
        "ai_prompt": "Day-8 post-call SMS after the second voice attempt missed. Acknowledge they may be busy, no pressure. \u2264200 chars. Warm tone, signals this is one of the last touches before we ease off."
      }
    ]
  },
  {
    "id": "n20",
    "type": "wait_for_reply",
    "timeout_seconds": 172800
  },
  {
    "id": "n21",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "email",
        "enabled": true,
        "message": "Fallback: Happy to close this out if it's not the right time. I'll send the occasional industry update if you'd like, otherwise just reply 'close' and I'll bow out. Brendan",
        "subject": "Closing out unless you'd like to keep in touch",
        "delay_seconds": 0,
        "ai_generate": true,
        "ai_prompt": "Day-10 soft 'breakup' email. The lead has been silent through the active push (3 SMS, 2 voice attempts, 1 email). Position this as: 'happy to close the loop, but I'll send the occasional industry update unless you say otherwise'. Give them an explicit easy out (reply 'close'). Subject should signal you're stepping back, not a re-ask. No high-pressure CTA."
      }
    ]
  },
  {
    "id": "n22",
    "type": "wait_for_reply",
    "timeout_seconds": 345600
  },
  {
    "id": "n23",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "email",
        "enabled": true,
        "message": "Fallback: short industry note. Quick observation from the last 30 days working with teams in your space \u2014 the AI-setter pattern is starting to outperform manual first-touch by ~3x on speed-to-lead. Worth thinking about. Brendan",
        "subject": "Industry note: AI setters vs manual first-touch",
        "delay_seconds": 0,
        "ai_generate": true,
        "ai_prompt": "Day-14 educational email. The lead has been silent for ~4 days since the soft breakup. Send a no-ask, value-only email \u2014 share an industry observation about AI setters / first-touch follow-up in their vertical (use custom_fields.industry if present). 2-3 short paragraphs, no link, no CTA. Just useful. Subject should be specific and value-loaded, not a re-ask."
      }
    ]
  },
  {
    "id": "n24",
    "type": "wait_for_reply",
    "timeout_seconds": 345600
  },
  {
    "id": "n25",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "email",
        "enabled": true,
        "message": "Fallback: customer story. A 3-person ops team we worked with last quarter went from 8% to 24% inbound-to-booked over 30 days, mostly by shortening time-to-first-touch from 4h to 60s. Happy to share the playbook if useful. Brendan",
        "subject": "Customer story: 8% \u2192 24% inbound-to-booked",
        "delay_seconds": 0,
        "ai_generate": true,
        "ai_prompt": "Day-18 customer-story email. Short, concrete narrative + measurable result, relevant to lead's industry (custom_fields.industry). Subject is the headline number. Body is 2-3 short paragraphs. Soft ask at the end ('happy to share the playbook' or similar) \u2014 not a hard CTA."
      }
    ]
  },
  {
    "id": "n26",
    "type": "wait_for_reply",
    "timeout_seconds": 259200
  },
  {
    "id": "n27",
    "type": "engage",
    "message": "",
    "channels": [
      {
        "type": "email",
        "enabled": true,
        "message": "Fallback: checklist. Made a quick 5-point checklist on tightening first-touch follow-up \u2014 sharing in case it's useful to anyone on your team. No reply needed. Brendan",
        "subject": "5-point checklist: tighten first-touch follow-up",
        "delay_seconds": 0,
        "ai_generate": true,
        "ai_prompt": "Day-21 closing email. Position as a 'one-page checklist' or 'tool give-away' \u2014 a no-ask, useful resource the lead can use even if they never book. Mention the checklist topic in the body. Subject should look like a content piece, not an outreach. No CTA."
      }
    ]
  },
  {
    "id": "n28",
    "type": "wait_for_reply",
    "timeout_seconds": 259200
  }
]$cadence$::jsonb
    );
  END IF;
END $$;
