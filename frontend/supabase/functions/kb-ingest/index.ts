// kb-ingest — native replacement for the n8n knowledge-base ingest workflow.
//
// Phase 3 of the master rebuild. POST to ingest a document into the per-
// client external Supabase (`bfd-setter-live.documents` mirror). Replaces
// the n8n hop that currently does the same thing.
//
// Auth: per-client shared secret in clients.intake_lead_secret (reused —
// same model as voice-booking-tools and intake-lead). This is only called
// from the BFD-setter UI (KB upload) plus future setter prompts; not
// internet-public, so the bearer requirement is acceptable.
//
// Body:
//   { clientId, content, source_url?, title?, metadata? }
//
// Response: { ok, document_id }
//
// Implementation notes:
// - The destination is the CLIENT'S external Supabase (clients.supabase_url
//   / clients.supabase_service_key), NOT bfd-platform. KB lookups during
//   AI replies happen against the same DB that holds chat_history.
// - Embedding columns are present on some clients (`embedding` vector) but
//   not all. We don't compute embeddings here yet — that's a future task.
//   The document gets stored as-is and pgvector ingest can backfill.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class KbError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      clientId?: string;
      content?: string;
      source_url?: string | null;
      title?: string | null;
      metadata?: Record<string, unknown> | null;
    } | null;
    if (!body || typeof body !== "object") {
      throw new KbError(400, "Invalid JSON body");
    }
    const clientId = body.clientId;
    const content = (body.content ?? "").trim();
    if (!clientId) throw new KbError(400, "clientId is required");
    if (!content) throw new KbError(400, "content is required and must be non-empty");

    const auth = req.headers.get("Authorization") || "";
    const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, supabase_url, supabase_service_key, intake_lead_secret")
      .eq("id", clientId)
      .maybeSingle();
    if (clientErr || !client) throw new KbError(404, "Client not found");

    // Fail CLOSED: ingest writes to the client's knowledge base, so a client with
    // no intake_lead_secret configured must not be writable by an unauthenticated
    // caller (previously a NULL secret skipped auth entirely).
    if (client.intake_lead_secret) {
      if (!presented) throw new KbError(401, "Authorization Bearer required for this client");
      if (!constantTimeEqual(presented, client.intake_lead_secret as string)) {
        throw new KbError(403, "Invalid bearer token");
      }
    } else {
      throw new KbError(401, "Client not configured for ingest (no intake_lead_secret set).");
    }

    if (!client.supabase_url || !client.supabase_service_key) {
      throw new KbError(409, "Client has no external Supabase configured (cannot store document)");
    }

    const ext = createClient(client.supabase_url as string, client.supabase_service_key as string);

    // Insert into the client's `documents` table. Schema is per-client, so
    // we keep the insert minimal: content + metadata + source_url + title.
    // Metadata column is jsonb on most setups.
    const insertRow: Record<string, unknown> = {
      content,
      metadata: {
        ingested_at: new Date().toISOString(),
        ingested_via: "kb-ingest-native",
        ...(body.source_url ? { source_url: body.source_url } : {}),
        ...(body.title ? { title: body.title } : {}),
        ...(body.metadata ?? {}),
      },
    };

    const { data: doc, error: insertErr } = await ext
      .from("documents")
      .insert(insertRow)
      .select("id")
      .single();

    if (insertErr) {
      throw new KbError(502, `documents insert failed: ${insertErr.message}`);
    }

    return jsonResponse({ ok: true, document_id: doc?.id ?? null });
  } catch (err) {
    if (err instanceof KbError) {
      return jsonResponse({ ok: false, error: err.message }, err.status);
    }
    console.error("kb-ingest error:", err);
    return jsonResponse({ ok: false, error: (err as Error).message ?? "Internal server error" }, 500);
  }
});
