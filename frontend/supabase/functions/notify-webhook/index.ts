// Supabase Edge Function: notify-webhook
// Purpose: Forward webhook notifications server-side to avoid browser CORS issues
// Accepts JSON body: { url: string, payload: Record<string, unknown>, headers?: Record<string,string> }
// Responds: { ok: boolean, status: number, statusText: string }


// Basic URL validation - accepts both HTTP and HTTPS, including localhost
function isAllowedUrl(url: string) {
  try {
    const u = new URL(url);
    // Allow both http and https protocols
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    // Valid URL format is confirmed by successful URL parsing
    return true;
  } catch {
    return false;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }

  try {
    const { url, payload, headers } = await req.json();

    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers: corsHeaders });
    }

    if (!isAllowedUrl(url)) {
      return new Response(JSON.stringify({ error: 'Invalid or disallowed url' }), { status: 400, headers: corsHeaders });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      body: JSON.stringify(payload)
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
