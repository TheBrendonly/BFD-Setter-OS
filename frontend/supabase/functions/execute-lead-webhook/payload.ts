// G3-8(a) — pure builder for the database-reactivation webhook payload.
//
// Byte-identical to the webhookData LeadRow used to build in the browser, so the live n8n
// receiver is unchanged. The only difference: the client config (incl. supabase_service_key)
// is loaded SERVER-SIDE in the edge fn and passed here — the browser never reads the secret.

export type ReactivationClientConfig = {
  supabase_url?: string | null;
  supabase_service_key?: string | null;
  supabase_table_name?: string | null;
  database_reactivation_inbound_webhook_url?: string | null;
};

export function buildReactivationWebhookPayload(args: {
  leadData: unknown;
  campaignName: string | null;
  reactivationNotes: string | null;
  leadId: string;
  campaignId: string;
  scheduledFor: string | null;
  processedAt: string;
  clientConfig: ReactivationClientConfig;
}): Record<string, unknown> {
  return {
    leadData: args.leadData,
    campaignName: args.campaignName,
    reactivationNotes: args.reactivationNotes || "",
    leadId: args.leadId,
    campaignId: args.campaignId,
    scheduledFor: args.scheduledFor,
    processedAt: args.processedAt,
    supabase_url: args.clientConfig?.supabase_url || null,
    supabase_service_key: args.clientConfig?.supabase_service_key || null,
    supabase_table_name: args.clientConfig?.supabase_table_name || null,
    database_reactivation_inbound_webhook_url:
      args.clientConfig?.database_reactivation_inbound_webhook_url || null,
  };
}
