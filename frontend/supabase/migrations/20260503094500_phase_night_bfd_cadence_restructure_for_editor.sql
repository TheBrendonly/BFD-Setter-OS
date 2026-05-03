-- phase-night-bfd-cadence-restructure-for-editor
-- Restructures BFD's "Default New-Lead Cadence" workflow nodes from the
-- delay-between-engages model authored in CADENCE_DESIGN.md to the
-- wait_for_reply-between-engages model the Engagement editor canvas was
-- built for. Without this, the editor crashed on `wait!.id` at
-- frontend/src/pages/Engagement.tsx:3131 because the canvasNodes useMemo
-- assumes every non-last engage has a corresponding wait_for_reply node.
--
-- Runtime impact: minimal. wait_for_reply has the same wait semantics as
-- delay plus an extra end-of-window message_queue check for replies. The
-- reply-stops-cadence path already runs via Phase 4c receive-twilio-sms
-- webhook cancellation, so the inline check is redundant but harmless and
-- gives us a free `time_to_first_response_seconds` metric.
--
-- Also rolls in copy edits per the cadence copy review (User Todos.md A1):
--   n1 SMS — drop "Building Flow Digital", change "2 min" → "1 min"
--   n3 instructions — update "2 minutes ago" → "1 minute ago" to match new n2 timing
--   n7 SMS — drop "Got a window today if you're around"
--   n9 instructions — strip "If voicemail, drop the configured voicemail script"
--                     (voicemail handling deferred to Phase B4 UI)
--
-- Timing changes:
--   n2: 120s → 60s (delay → wait_for_reply)
--   n4: 1680s → 1s (immediate; minimum allowed by editor input min=1)
--   n6: 28800s → 28800s (unchanged duration; type change only)
--   n8: 57600s → 57600s (unchanged duration; type change only)

UPDATE public.engagement_workflows
SET nodes = $$[
  {"id":"n1","type":"engage","message":"Hey {{first_name}}, Brendan here — calling you in 1 min about your enquiry.","channels":[{"type":"sms","enabled":true,"message":"Hey {{first_name}}, Brendan here — calling you in 1 min about your enquiry.","delay_seconds":0}]},
  {"id":"n2","type":"wait_for_reply","timeout_seconds":60},
  {"id":"n3","type":"engage","message":"","channels":[{"type":"phone_call","enabled":true,"message":"","instructions":"First outbound call to a fresh lead. They enquired about BFD's AI setter and got an SMS 1 minute ago saying Brendan would call. Open with: 'Hey {{first_name}}, Brendan here, you enquired earlier, got 2 minutes?'. Be warm and Aussie-direct. Qualify their business, current lead volume, and how they handle first-touch follow-up. Book a 15-min strategy call if interested. Do NOT leave a voicemail if it goes to voicemail, the cadence will text instead.","delay_seconds":0,"voice_setter_id":"Voice-Setter-2","treat_pickup_as_reply":true}]},
  {"id":"n4","type":"wait_for_reply","timeout_seconds":1},
  {"id":"n5","type":"engage","message":"Hey {{first_name}}, just tried calling about your enquiry. When suits for a quick chat? Happy to lock something in. Brendan","channels":[{"type":"sms","enabled":true,"message":"Hey {{first_name}}, just tried calling about your enquiry. When suits for a quick chat? Happy to lock something in. Brendan","delay_seconds":0}]},
  {"id":"n6","type":"wait_for_reply","timeout_seconds":28800},
  {"id":"n7","type":"engage","message":"Hey {{first_name}}, still keen for a quick chat about your enquiry? Brendan","channels":[{"type":"sms","enabled":true,"message":"Hey {{first_name}}, still keen for a quick chat about your enquiry? Brendan","delay_seconds":0}]},
  {"id":"n8","type":"wait_for_reply","timeout_seconds":57600},
  {"id":"n9","type":"engage","message":"","channels":[{"type":"phone_call","enabled":true,"message":"","instructions":"Day-2 follow-up call. They missed yesterday's call and got two SMS. Open: 'Hey {{first_name}}, Brendan here, just trying you again about your enquiry, do you have a quick minute?'. Keep it casual and low-pressure. Book a 15-min strategy call if any interest.","delay_seconds":0,"voice_setter_id":"Voice-Setter-2","treat_pickup_as_reply":true}]}
]$$::jsonb,
    updated_at = now()
WHERE id = '40e8bea3-b6f6-4562-98d1-f7e6599af6a1';
