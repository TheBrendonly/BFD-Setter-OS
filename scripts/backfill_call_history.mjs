// Direct-insert the prior call into call_history using only existing columns
// (bypasses edge function which needs columns that haven't been added yet)
//
// Source secrets from .env. Run with: node --env-file=.env scripts/backfill_call_history.mjs
import { request } from 'https';

const BFDP_KEY = process.env.BFD_PLATFORM_SECRET_KEY;
if (!BFDP_KEY) {
  console.error('Missing BFD_PLATFORM_SECRET_KEY in .env');
  process.exit(1);
}
const CLIENT_ID = process.env.BFD_CLIENT_ID || 'e467dabc-57ee-416c-8831-83ecd9c7c925';

// Only columns confirmed to exist
const row = {
  call_id: 'call_6d46e695cfcb54749aa0440102f',
  client_id: CLIENT_ID,
  agent_id: 'agent_5ec5eb129f3165cfa07b581a1a',
  call_status: 'ended',
  call_type: 'phone_call',
  direction: 'inbound',
  from_number: '+61481614530',
  to_number: null,
  start_timestamp: new Date(1777348752751).toISOString(),
  end_timestamp: new Date(1777348840721).toISOString(),
  duration_ms: 87970,
  transcript: `Agent: Hi, this is \nUser: Hello? \nAgent: {name} with BFD Tester. Is this {{first_name}}?\nUser: Yeah. \nUser: Who's this? \nAgent: Hey, this is {name} with BFD Tester...`,
  recording_url: 'https://dxc03zgurdly9.cloudfront.net/5d196f0e41502a72e673105e36cbc225d0dc9728a6edb58ea56633c833dba64b/recording.wav',
  disconnect_reason: 'user_hangup',
  call_summary: 'Test call using old agent v5 with incorrect BFD Tester template. Agent did not know name or caller. Call ended in user frustration.',
  user_sentiment: 'Negative',
  call_successful: false,
  appointment_booked: false,
  lead_id: null,
  custom_analysis_data: JSON.stringify({ note: 'old_agent_v5_used_wrong_template', fixed_in: 'v6_with_aria_bfd_prompt' }),
  raw_payload: JSON.stringify({ event: 'call_analyzed', call_id: 'call_6d46e695cfcb54749aa0440102f', agent_version: 5 }),
  public_log_url: null,
  transcript_object: null,
  cost: null,
  pre_call_context: null,
  ghl_account_id: null,
  contact_id: null,
};

const body = JSON.stringify(row);
const opts = {
  hostname: 'bjgrgbgykvjrsuwwruoh.supabase.co',
  path: '/rest/v1/call_history',
  method: 'POST',
  headers: {
    'apikey': BFDP_KEY,
    'Authorization': `Bearer ${BFDP_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation,resolution=merge-duplicates',
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = request(opts, res => {
  let data = '';
  res.on('data', d => { data += d; });
  res.on('end', () => {
    console.log('HTTP:', res.statusCode);
    try {
      const r = JSON.parse(data);
      if (Array.isArray(r)) { console.log('Inserted:', r[0]?.call_id, 'status:', r[0]?.call_status); }
      else { console.log('Response:', JSON.stringify(r).substring(0, 200)); }
    } catch { console.log('Raw:', data.substring(0, 300)); }
  });
});
req.on('error', e => console.error('error:', e.message));
req.write(body);
req.end();
