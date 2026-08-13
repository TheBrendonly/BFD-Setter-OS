-- 1C — explicit "warrants a reply" flag on leads.
--
-- Previously nudgeColdReply inferred "we sent last, they went quiet" purely
-- from timestamps (last_outbound_at > last_inbound_at). This adds an explicit,
-- queryable signal that the setter sets when it sends a message expecting a
-- reply, and that inbound replies clear. It is the driver the nudge task now
-- gates on, alongside the existing tier / timing checks.
--
--   awaiting_reply = true   set on outbound sends that expect a reply
--                           (setter reply, cadence engage, follow-up, nudge)
--   awaiting_reply = false  set on any inbound reply (SMS or voice), on opt-out,
--                           and when the nudge task gives up on a lead
--
-- Written by: trigger/_shared/sendTwilioSmsAndStamp.ts, trigger/processMessages.ts,
-- trigger/runEngagement.ts, trigger/nudgeColdReply.ts, and the edge functions
-- receive-twilio-sms, retell-call-webhook, voice-booking-tools.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS awaiting_reply boolean NOT NULL DEFAULT false;

-- Backfill so leads currently mid cold-cycle keep getting nudged without a gap:
-- any non-stopped, non-silent lead whose last message from us is unanswered.
UPDATE public.leads
   SET awaiting_reply = true
 WHERE setter_stopped = false
   AND tagged_silent_after_engagement = false
   AND last_inbound_at IS NOT NULL
   AND last_outbound_at IS NOT NULL
   AND last_outbound_at > last_inbound_at;

NOTIFY pgrst, 'reload schema';
