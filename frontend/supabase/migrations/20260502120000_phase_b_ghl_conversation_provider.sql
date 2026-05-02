-- Phase B (GHL push gaps 2+3) — clients.ghl_conversation_provider_id
--
-- Optional config knob for the SMS-body-mirror helper (_shared/ghl-conversations.ts).
-- When set, the helper logs SMS bodies via GHL's Conversations API
-- (POST /conversations/messages/{inbound|outbound}, requires a Custom
-- Conversation Provider provisioned in GHL Marketplace). When null, the
-- helper falls back to writing a Note on the contact (POST /contacts/{id}/notes).
--
-- Backwards-compatible: nullable, no default. Existing clients keep working
-- via the Notes fallback until they provision a provider id.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS ghl_conversation_provider_id text;

COMMENT ON COLUMN public.clients.ghl_conversation_provider_id IS
  'GHL Custom Conversation Provider id (provisioned in GHL Marketplace) used by _shared/ghl-conversations.ts to log SMS bodies into the conversation thread. NULL → helper falls back to Notes API.';
