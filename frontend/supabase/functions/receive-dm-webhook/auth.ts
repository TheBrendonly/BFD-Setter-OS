// B3 fail-closed gate for receive-dm-webhook (2026-06-24).
//
// When a client has no `ghl_webhook_secret`, the handler previously skipped auth
// entirely and ran every side-effect (engagement + Trigger.dev run cancellation,
// campaign_events, leads/message_queue writes, process-messages dispatch)
// unauthenticated. It now rejects unless the secret verifies. This is enforced by
// default; set DM_WEBHOOK_REQUIRE_SECRET to a falsy value as a kill-switch if a
// real client's GHL workflow isn't yet sending the x-wh-token header.
export function dmWebhookRequiresSecret(envVal: string | undefined): boolean {
  if (envVal == null) return true; // unset -> enforce (safe default)
  const v = envVal.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "off" || v === "no") return false;
  return true;
}
