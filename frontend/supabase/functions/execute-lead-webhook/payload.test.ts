// G3-8(a) — unit tests for the reactivation webhook payload builder.
//
// Run via: deno test --no-check frontend/supabase/functions/execute-lead-webhook/payload.test.ts
//
// G3-8(a): LeadRow read supabase_service_key in the browser (campaigns->clients join) and
// forwarded it in the database-reactivation webhook payload. This moves the build
// server-side; the payload shape stays BYTE-IDENTICAL to the old in-browser webhookData so
// the live n8n receiver is unchanged — only the secret no longer transits the browser.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildReactivationWebhookPayload } from "./payload.ts";

Deno.test("payload mirrors the legacy webhookData shape, secret sourced from server config", () => {
  const payload = buildReactivationWebhookPayload({
    leadData: { name: "Jane", phone: "+61400000000" },
    campaignName: "DB Reactivation Q3",
    reactivationNotes: "warm list",
    leadId: "lead-1",
    campaignId: "camp-1",
    scheduledFor: "2026-07-02T09:00:00Z",
    processedAt: "2026-07-01T00:00:00Z",
    clientConfig: {
      supabase_url: "https://ext.supabase.co",
      supabase_service_key: "sb_secret_xyz",
      supabase_table_name: "leads",
      database_reactivation_inbound_webhook_url: "https://n8n/in",
    },
  });

  assertEquals(payload, {
    leadData: { name: "Jane", phone: "+61400000000" },
    campaignName: "DB Reactivation Q3",
    reactivationNotes: "warm list",
    leadId: "lead-1",
    campaignId: "camp-1",
    scheduledFor: "2026-07-02T09:00:00Z",
    processedAt: "2026-07-01T00:00:00Z",
    supabase_url: "https://ext.supabase.co",
    supabase_service_key: "sb_secret_xyz",
    supabase_table_name: "leads",
    database_reactivation_inbound_webhook_url: "https://n8n/in",
  });
});

Deno.test("missing notes / config fall back to '' and null (legacy parity)", () => {
  const payload = buildReactivationWebhookPayload({
    leadData: null,
    campaignName: null,
    reactivationNotes: null,
    leadId: "lead-2",
    campaignId: "camp-2",
    scheduledFor: null,
    processedAt: "2026-07-01T00:00:00Z",
    clientConfig: {},
  });
  assertEquals(payload.reactivationNotes, "");
  assertEquals(payload.supabase_url, null);
  assertEquals(payload.supabase_service_key, null);
  assertEquals(payload.supabase_table_name, null);
  assertEquals(payload.database_reactivation_inbound_webhook_url, null);
});
