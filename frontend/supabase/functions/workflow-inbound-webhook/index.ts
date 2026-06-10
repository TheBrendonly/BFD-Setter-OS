import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wh-signature, x-wh-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Constant-time string compare for the static-token webhook proof.
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Optional GHL webhook auth (verify-if-present, mirrors sync-ghl-contact).
// Once the client has ghl_webhook_secret set, callers must present either a
// static `x-wh-token` header or an HMAC-SHA256 `x-wh-signature`; non-GHL
// callers that pass client_id directly must include the token header too.
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

    // Optional webhook auth (verify-if-present, STRICT — audit SEC-09). Once
    // the client has ghl_webhook_secret set, every caller (GHL workflow or
    // direct) must present a static `x-wh-token` header equal to the secret,
    // or an HMAC-SHA256 `x-wh-signature` over the raw body. Secret set but no
    // valid proof => 403 (previously warn-and-accept). NOTE: GHL *native*
    // Webhook V2 signs with RSA and is NOT supported — provision the secret
    // as a static token (SOP §5.3).
    {
      const { data: secretRow } = await supabase
        .from("clients")
        .select("ghl_webhook_secret")
        .eq("id", client_id)
        .maybeSingle();
      const secret = (secretRow?.ghl_webhook_secret as string | null) ?? null;
      if (secret) {
        const tokenOk = ctEqual(req.headers.get("x-wh-token") ?? "", secret);
        const sigOk = tokenOk ||
          await verifyGhlSignature(rawBody, req.headers.get("x-wh-signature"), secret);
        if (!sigOk) {
          console.warn("workflow-inbound-webhook: webhook auth failed", { client_id });
          return new Response(
            JSON.stringify({ error: "Forbidden" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
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
