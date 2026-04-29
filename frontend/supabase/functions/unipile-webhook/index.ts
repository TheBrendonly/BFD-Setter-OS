import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-unipile-signature",
};

// Phase 8c — Unipile webhook signature verification (HMAC-SHA256, hex).
// Verification requires `clients.unipile_webhook_secret` to be set on the
// resolved client; otherwise backwards-compat (no verification).
async function verifyUnipileSignature(
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
  const expected = hex.toLowerCase();
  const presented = signatureHeader.replace(/^sha256=/i, "").toLowerCase();
  if (expected.length !== presented.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get("client_id");

    // Read raw body once for sig + parsing
    const rawBodyText = await req.text();
    let body: any = {};
    try {
      body = rawBodyText ? JSON.parse(rawBodyText) : {};
    } catch {
      console.warn("unipile-webhook: invalid JSON body");
      return new Response(JSON.stringify({ error: "invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("Unipile webhook received:", JSON.stringify(body));

    // Phase 8c — verify sig when client has the secret. clientId comes
    // from `?client_id=` (preferred) or body.name (legacy).
    const supabaseUrlEnv = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKeyEnv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseSig = createClient(supabaseUrlEnv, serviceRoleKeyEnv);
    const sigClientId = clientId || body?.name || null;
    if (sigClientId) {
      const { data: secretRow } = await supabaseSig
        .from("clients")
        .select("unipile_webhook_secret")
        .eq("id", sigClientId)
        .maybeSingle();
      const unipileSecret = secretRow?.unipile_webhook_secret as string | null;
      if (unipileSecret) {
        const sigHeader = req.headers.get("x-unipile-signature");
        if (!sigHeader) {
          console.warn("unipile-webhook: secret configured but x-unipile-signature missing", { clientId: sigClientId });
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const sigOk = await verifyUnipileSignature(rawBodyText, sigHeader, unipileSecret);
        if (!sigOk) {
          console.warn("unipile-webhook: signature mismatch", { clientId: sigClientId });
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // body: { status: "CREATION_SUCCESS", account_id: "xxx", name: "clientId" }
    if (body.status === "CREATION_SUCCESS" && body.account_id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      const resolvedClientId = clientId || body.name;

      const { error } = await supabase.from("unipile_accounts").upsert(
        {
          client_id: resolvedClientId,
          unipile_account_id: body.account_id,
          provider: body.account_type || "UNKNOWN",
          status: "connected",
        },
        { onConflict: "client_id,unipile_account_id" }
      );

      if (error) {
        console.error("Error saving unipile account:", error);
      } else {
        console.log("Unipile account saved for client:", resolvedClientId);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unipile webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
