import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wh-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Optional GHL Webhook V2 signature verification (HMAC-SHA256 hex over the raw
// body, keyed by clients.ghl_webhook_secret). Best-effort: this endpoint also
// serves non-GHL callers that pass client_id directly and may not sign, so we
// only reject on an actual mismatch when both a secret and a signature header
// are present (see the gate below).
async function verifyGhlSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const sigBytes = new Uint8Array(sigBuf);
  let hex = "";
  for (const b of sigBytes) hex += b.toString(16).padStart(2, "0");
  const expectedHex = hex.toLowerCase();
  const presented = signatureHeader.replace(/^sha256=/i, "").toLowerCase();
  if (expectedHex.length !== presented.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    mismatch |= expectedHex.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const rawBody = await req.text();
    let client_id = url.searchParams.get("client_id");
    const workflow_id = url.searchParams.get("workflow_id");
    const ghl_account_id = url.searchParams.get("GHL_Account_ID");

    if (!workflow_id) {
      return new Response(
        JSON.stringify({ error: "workflow_id query param is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve client_id from GHL_Account_ID if client_id not provided
    if (!client_id && ghl_account_id) {
      const { data: clientRow, error: clientErr } = await supabase
        .from("clients")
        .select("id")
        .eq("ghl_location_id", ghl_account_id)
        .single();

      if (clientErr || !clientRow) {
        return new Response(
          JSON.stringify({ error: "No client found for the provided GHL_Account_ID" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      client_id = clientRow.id;
    }

    if (!client_id) {
      return new Response(
        JSON.stringify({ error: "client_id or GHL_Account_ID query param is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Optional signature verification (best-effort). This endpoint also serves
    // non-GHL callers that pass client_id directly and may not sign, so we only
    // reject on an actual mismatch when the client has ghl_webhook_secret set AND
    // an x-wh-signature header is present. Secret set but no header => accept and
    // log (a non-GHL caller). NOTE for Brendan: if you want this strict (require
    // a signature whenever the secret is set), change the warn branch to a 403.
    {
      const { data: secretRow } = await supabase
        .from("clients")
        .select("ghl_webhook_secret")
        .eq("id", client_id)
        .maybeSingle();
      const secret = (secretRow?.ghl_webhook_secret as string | null) ?? null;
      const sigHeader = req.headers.get("x-wh-signature");
      if (secret && sigHeader) {
        const sigOk = await verifyGhlSignature(rawBody, sigHeader, secret);
        if (!sigOk) {
          console.warn("workflow-inbound-webhook: signature mismatch", { client_id });
          return new Response(
            JSON.stringify({ error: "Forbidden" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } else if (secret && !sigHeader) {
        console.warn("workflow-inbound-webhook: ghl_webhook_secret set but no x-wh-signature header; accepting (non-GHL caller?)", { client_id });
      }
    }

    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");

    // Verify workflow exists

    // Verify workflow exists (allow inactive workflows to still receive and store requests)
    const { data: workflow, error: wfError } = await supabase
      .from("workflows")
      .select("id, is_active, nodes")
      .eq("id", workflow_id)
      .eq("client_id", client_id)
      .single();

    if (wfError || !workflow) {
      return new Response(
        JSON.stringify({ error: "Workflow not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Collect trigger_data from the incoming request
    let requestBody = {};
    try {
      requestBody = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      // Body may not be JSON — that's fine
    }

    // Collect ALL headers
    const allHeaders: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      allHeaders[key] = value;
    });

    const trigger_data = {
      query: Object.fromEntries(url.searchParams),
      body: requestBody,
      headers: allHeaders,
      received_at: new Date().toISOString(),
    };

    // Store the raw request for mapping reference
    await supabase
      .from("workflow_webhook_requests")
      .insert({
        workflow_id,
        client_id,
        raw_request: trigger_data,
        received_at: new Date().toISOString(),
      });

    // Only trigger execution if workflow is active
    if (!workflow.is_active) {
      return new Response(
        JSON.stringify({
          status: "stored",
          message: "Request stored but workflow is not active",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create execution record
    const { data: execution, error: execError } = await supabase
      .from("workflow_executions")
      .insert({
        workflow_id,
        client_id,
        status: "pending",
        trigger_type: "inbound_webhook",
        trigger_data,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (execError) throw execError;

    // Call Trigger.dev
    if (!triggerSecretKey) {
      await supabase
        .from("workflow_executions")
        .update({
          status: "failed",
          error_message: "TRIGGER_SECRET_KEY not configured",
          completed_at: new Date().toISOString(),
        })
        .eq("id", execution.id);

      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const triggerResponse = await fetch(
      "https://api.trigger.dev/api/v1/tasks/execute-workflow/trigger",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${triggerSecretKey}`,
        },
        body: JSON.stringify({
          payload: {
            workflow_id,
            execution_id: execution.id,
            client_id,
            trigger_data,
          },
        }),
      }
    );

    if (!triggerResponse.ok) {
      const errText = await triggerResponse.text();
      await supabase
        .from("workflow_executions")
        .update({
          status: "failed",
          error_message: `Trigger.dev error: ${errText.slice(0, 200)}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", execution.id);

      return new Response(
        JSON.stringify({ error: "Failed to trigger workflow execution" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const triggerResult = await triggerResponse.json();
    const trigger_run_id = triggerResult.id || null;

    if (trigger_run_id) {
      await supabase
        .from("workflow_executions")
        .update({ trigger_run_id })
        .eq("id", execution.id);
    }

    return new Response(
      JSON.stringify({
        status: "triggered",
        execution_id: execution.id,
        trigger_run_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Inbound webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
