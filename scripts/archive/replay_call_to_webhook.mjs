// Replay a Retell call to the retell-call-analysis-webhook to write call_history row
// Source secrets from .env. Run with: node --env-file=.env scripts/replay_call_to_webhook.mjs [CALL_ID]
import { request } from 'https';

const RETELL_KEY = process.env.BFD_RETELL_API_KEY;
if (!RETELL_KEY) { console.error('Missing BFD_RETELL_API_KEY in .env'); process.exit(1); }
const CALL_ID = process.argv[2] || process.env.REPLAY_CALL_ID || 'call_6d46e695cfcb54749aa0440102f';
const WEBHOOK_HOST = 'bjgrgbgykvjrsuwwruoh.supabase.co';
const WEBHOOK_PATH = '/functions/v1/retell-call-analysis-webhook';
const SUPABASE_ANON_KEY = process.env.BFD_PLATFORM_ANON_KEY;
if (!SUPABASE_ANON_KEY) { console.error('Missing BFD_PLATFORM_ANON_KEY in .env'); process.exit(1); }

const fetchJson = (hostname, path, method = 'GET', headers = {}, body = null) =>
  new Promise((resolve, reject) => {
    const opts = { hostname, path, method, headers };
    const req = request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch (e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

(async () => {
  // Fetch full call data from Retell
  console.log('Fetching call from Retell...');
  const retellRes = await fetchJson(
    'api.retellai.com',
    `/v3/list-calls`,
    'POST',
    { 'Authorization': `Bearer ${RETELL_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength('{"limit":50}') },
    '{"limit":50}'
  );

  // v3/list-calls returns { items, pagination_key, has_more } instead of a top-level array.
  const calls = Array.isArray(retellRes.body?.items)
    ? retellRes.body.items
    : Array.isArray(retellRes.body) ? retellRes.body : [];
  const call = calls.find(c => c.call_id === CALL_ID);
  if (!call) { console.error('Call not found in recent list'); process.exit(1); }

  console.log('Call found:', call.call_id, 'status:', call.call_status);

  // Build webhook payload matching Retell's call_analyzed format
  const payload = JSON.stringify({
    event: 'call_analyzed',
    call: call,
  });

  console.log('Sending to webhook...');
  const webhookRes = await fetchJson(
    WEBHOOK_HOST,
    WEBHOOK_PATH,
    'POST',
    {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Length': Buffer.byteLength(payload),
    },
    payload
  );

  console.log('Webhook HTTP:', webhookRes.status);
  console.log('Webhook response:', JSON.stringify(webhookRes.body, null, 2));
})();
