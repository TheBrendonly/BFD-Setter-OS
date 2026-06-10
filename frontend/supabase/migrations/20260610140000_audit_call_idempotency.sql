-- Audit 2026-06-10 (CAD-02): make-retell-outbound-call dedup key. The caller
-- (placeOutboundCall, keyed `${execution_id}:${node_index}:${channel_index}`)
-- passes an idempotency_key; the edge fn checks for an existing call_history
-- row with that key before placing a new Retell call, and stamps the key on
-- the row it creates. Partial unique index so legacy rows (null key) and
-- UI test calls (no key) are unaffected.
ALTER TABLE public.call_history ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS call_history_idempotency_key_uidx
  ON public.call_history (idempotency_key) WHERE idempotency_key IS NOT NULL;
