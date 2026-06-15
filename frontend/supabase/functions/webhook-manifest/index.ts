// webhook-manifest — returns the INBOUND webhook manifest for a client: the
// "copy these into HighLevel / Retell / Twilio / Unipile" list, with computed
// URLs, the header/token each needs, a secured/forgeable status, and a passive
// "last received" signal. None of this was surfaced anywhere before (it lived
// only in the onboarding SOP), so operators hand-built URLs and never knew which
// inbound paths were actually wired or secured.
//
// Auth: dual-mode via _shared/authorize-client-request.ts (service-role OR the
// JWT owner of clientId). Never trust clientId alone. Deploy with verify_jwt=false.
//
// Secrets: generates + persists ghl_webhook_secret + intake_lead_secret when NULL
// (idempotent, fills NULLs only) so a URL is never shown live-but-forgeable. Does
// NOT generate retell_webhook_secret — the Retell sig-verify scheme is fixed but
// arming is a separate controlled live test, so Retell rows stay "leave blank".

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// URL-safe random secret (~32 chars). Mirrors the strength of the intake secret
// minted at client-create in Onboarding.tsx.
function mintSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => null)) as { clientId?: string } | null;
    const clientId = body?.clientId;
    if (!clientId) return json({ error: "clientId is required" }, 400);

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const base = `${supabaseUrl}/functions/v1`;

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, ghl_location_id, ghl_webhook_secret, intake_lead_secret, retell_webhook_secret, unipile_webhook_secret, retell_phone_1, retell_phone_2, retell_phone_3, auto_engagement_workflow_id")
      .eq("id", clientId)
      .maybeSingle();
    if (clientErr || !client) return json({ error: "Client not found" }, 404);

    // Fill NULL secrets only (idempotent) so a URL is never shown forgeable.
    const fills: Record<string, string> = {};
    if (!client.ghl_webhook_secret) fills.ghl_webhook_secret = mintSecret();
    if (!client.intake_lead_secret) fills.intake_lead_secret = mintSecret();
    if (Object.keys(fills).length > 0) {
      const { error: upErr } = await supabase.from("clients").update(fills).eq("id", clientId);
      if (upErr) console.warn("webhook-manifest: secret fill failed (non-fatal)", upErr.message);
      else Object.assign(client, fills);
    }

    const ghlSecret = client.ghl_webhook_secret as string | null;
    const intakeSecret = client.intake_lead_secret as string | null;
    const ghlLocation = client.ghl_location_id as string | null;
    const phones = [client.retell_phone_1, client.retell_phone_2, client.retell_phone_3]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0);

    // Passive "last received" signal — proves the operator actually pasted the URL
    // upstream. Each query is best-effort (tables vary across the platform DB).
    async function lastReceived(table: string): Promise<string | null> {
      try {
        const { data } = await supabase
          .from(table)
          .select("created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return (data?.created_at as string) ?? null;
      } catch {
        return null;
      }
    }
    const [ghlSig, callSig, msgSig, intakeSig] = await Promise.all([
      lastReceived("sync_ghl_executions"),
      lastReceived("call_history"),
      lastReceived("message_queue"),
      lastReceived("engagement_executions"),
    ]);

    const ghlHeaders = ghlSecret
      ? [{ key: "x-wh-token", value: ghlSecret }, { key: "Content-Type", value: "application/json" }]
      : [{ key: "Content-Type", value: "application/json" }];

    const entries = [
      // ── GHL-bound (GoHighLevel → Workflows → Custom Webhook action) ──
      {
        key: "sync-ghl-contact", label: "Lead created / updated (main lead ingress)",
        url: `${base}/sync-ghl-contact?clientId=${clientId}`, method: "POST",
        headers: ghlHeaders, destination: "GoHighLevel",
        sopRef: "5.3", lastReceivedAt: ghlSig,
        required: true, secretStatus: ghlSecret ? "secured" : "forgeable",
      },
      {
        key: "ghl-tag-webhook", label: "Contact tag added",
        url: `${base}/ghl-tag-webhook`, method: "POST",
        headers: ghlHeaders, destination: "GoHighLevel",
        sopRef: "5.4", lastReceivedAt: ghlSig,
        required: false, secretStatus: ghlSecret ? "secured" : "forgeable",
      },
      {
        key: "bookings-webhook", label: "Calendar appointment created / updated / cancelled",
        url: `${base}/bookings-webhook`, method: "POST",
        headers: ghlHeaders, destination: "GoHighLevel",
        sopRef: "5.5", lastReceivedAt: null,
        required: true, secretStatus: ghlSecret ? "secured" : "forgeable",
      },
      {
        key: "sync-ghl-booking", label: "Booking sync (by GHL account)",
        url: `${base}/sync-ghl-booking${ghlLocation ? `?GHL_Account_ID=${ghlLocation}` : ""}`, method: "POST",
        headers: ghlHeaders, destination: "GoHighLevel",
        sopRef: "5.5", lastReceivedAt: null,
        required: false, secretStatus: ghlSecret ? "secured" : "forgeable",
      },
      {
        key: "workflow-inbound-webhook", label: "Workflow inbound (strict once secret set)",
        url: `${base}/workflow-inbound-webhook?client_id=${clientId}&workflow_id=${client.auto_engagement_workflow_id ?? "<workflow_id>"}`, method: "POST",
        headers: ghlHeaders, destination: "GoHighLevel",
        sopRef: "5.6", lastReceivedAt: null,
        required: false, secretStatus: ghlSecret ? "secured" : "forgeable",
      },
      {
        key: "receive-dm-webhook", label: "Inbound DM / message",
        url: `${base}/receive-dm-webhook?GHL_Account_ID=${ghlLocation ?? "<location_id>"}&Lead_ID=&Message_Body=&Name=&Phone=&Email=&Setter_Number=`, method: "POST",
        headers: ghlHeaders, destination: "GoHighLevel",
        sopRef: "5.7", lastReceivedAt: msgSig,
        required: false, secretStatus: ghlSecret ? "secured" : "forgeable",
      },

      // ── Web form / intake ──
      {
        key: "intake-lead", label: "Web form lead intake",
        url: `${base}/intake-lead`, method: "POST",
        headers: [{ key: "Authorization", value: intakeSecret ? `Bearer ${intakeSecret}` : "Bearer <intake_lead_secret>" }, { key: "Content-Type", value: "application/json" }],
        destination: "Web form", note: "clientId in the POST body",
        sopRef: "5.2", lastReceivedAt: intakeSig,
        required: false, secretStatus: intakeSecret ? "secured" : "forgeable",
      },

      // ── Retell (set in the Retell dashboard, NOT GHL) ──
      {
        key: "retell-inbound-webhook", label: "Phone inbound webhook (per BYO phone → inbound_webhook_url)",
        url: `${base}/retell-inbound-webhook`, method: "POST",
        headers: [{ key: "Content-Type", value: "application/json" }], destination: "Retell",
        note: phones.length ? `Set on phone(s): ${phones.join(", ")}` : "Set on each BYO phone number",
        sopRef: "6.1", lastReceivedAt: callSig,
        required: false, secretStatus: "verification-not-yet-supported",
      },
      {
        key: "retell-call-webhook+analysis", label: "Agent webhook_url (call events + post-call analysis)",
        url: `${base}/retell-call-analysis-webhook`, method: "POST",
        headers: [{ key: "Content-Type", value: "application/json" }], destination: "Retell",
        note: "Agent-level webhook_url (auto-set on push). retell-call-webhook shares the same secret.",
        sopRef: "6.2", lastReceivedAt: callSig,
        required: false, secretStatus: "verification-not-yet-supported",
      },

      // ── Twilio ──
      {
        key: "receive-twilio-sms", label: "Inbound SMS (Phone → Messaging → A message comes in)",
        url: `${base}/receive-twilio-sms`, method: "POST",
        headers: [], destination: "Twilio",
        note: "Auto-set by the Configure Twilio Webhook button; shown read-only.",
        sopRef: "5.8", lastReceivedAt: msgSig,
        required: false, secretStatus: "auto",
      },

      // ── Unipile ──
      {
        key: "unipile-webhook", label: "Unipile account events",
        url: `${base}/unipile-webhook?client_id=${clientId}`, method: "POST",
        headers: [{ key: "x-unipile-signature", value: client.unipile_webhook_secret ? "<configured>" : "<leave blank for now>" }],
        destination: "Unipile",
        sopRef: "5.9", lastReceivedAt: null,
        required: false, secretStatus: "verification-not-yet-supported",
      },
    ];

    const requiredSecured = entries
      .filter((e) => e.required)
      .every((e) => e.secretStatus === "secured");

    return json({
      ok: true,
      clientId,
      entries,
      // Go-live readiness: every REQUIRED inbound webhook is secured. The UI gates
      // the auto_engagement_workflow_id flip (SOP 8.1) on this.
      goLiveReady: requiredSecured,
      generated: Object.keys(fills),
    });
  } catch (err) {
    console.error("webhook-manifest error:", err);
    return json({ error: (err as Error).message ?? "Internal server error" }, 500);
  }
});
