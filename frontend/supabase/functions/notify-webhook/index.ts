// Supabase Edge Function: notify-webhook
// Purpose: Forward webhook notifications server-side to avoid browser CORS issues
// Accepts JSON body: { url: string, payload: Record<string, unknown>, headers?: Record<string,string> }
// Responds: { ok: boolean, status: number, statusText: string, body?: string }
//
// SECURITY: requires an authenticated caller (this is a server-side relay, not a
// public endpoint) and blocks SSRF to private / loopback / link-local / cloud
// metadata addresses so it cannot be turned into an internal-network probe.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function ipInPrivateRange(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = +v4[1], b = +v4[2];
    if (a === 0 || a === 10 || a === 127) return true;          // this-host, private, loopback
    if (a === 169 && b === 254) return true;                    // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;           // private
    if (a === 192 && b === 168) return true;                    // private
    if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
    return false;
  }
  const h = ip.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true; // link-local + ULA
  if (h.startsWith("::ffff:")) return ipInPrivateRange(h.replace("::ffff:", ""));     // IPv4-mapped
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) {
    return true;
  }
  if (/^[0-9.]+$/.test(h) || h.includes(":")) return ipInPrivateRange(h); // literal IP
  return false;
}

async function resolvesToPrivate(hostname: string): Promise<boolean> {
  // Best-effort DNS-rebinding defence. If the runtime forbids resolveDns we fall
  // back to the literal-host checks already applied.
  try {
    const ips: string[] = [];
    try { ips.push(...await Deno.resolveDns(hostname, "A")); } catch { /* ignore */ }
    try { ips.push(...await Deno.resolveDns(hostname, "AAAA")); } catch { /* ignore */ }
    return ips.some(ipInPrivateRange);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  // SECURITY: require an authenticated user. Frontend callers invoke this via
  // supabase.functions.invoke, which forwards the user's JWT.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }
  try {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  try {
    const { url, payload, headers } = await req.json();

    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers: corsHeaders });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid url' }), { status: 400, headers: corsHeaders });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return new Response(JSON.stringify({ error: 'Invalid or disallowed url' }), { status: 400, headers: corsHeaders });
    }
    if (isBlockedHost(parsed.hostname) || await resolvesToPrivate(parsed.hostname)) {
      return new Response(JSON.stringify({ error: 'Destination host is not allowed' }), { status: 400, headers: corsHeaders });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: JSON.stringify(payload),
      redirect: 'manual', // don't let a 3xx bounce us to an internal host
    });

    const text = await res.text();

    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, statusText: res.statusText, body: text }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
