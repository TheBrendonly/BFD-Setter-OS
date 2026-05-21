// UI Gap 17 — Credential drift detector.
//
//   SUPABASE_PAT=... node --env-file=.env scripts/check-creds.mjs
//
// Checks for Twilio auth-token drift between:
//   1. The DB row in `clients.twilio_auth_token` (stored when client onboarded).
//   2. The live token Twilio reports via the Account API.
//
// Twilio auth tokens DO rotate (manual rotation in Twilio Console; sometimes
// after security incidents). If the live token differs from what BFD-setter
// has stored, every outbound SMS via that account will 401, silently breaking
// the cadence. This script flags that drift in <1s so on-call can rotate
// proactively.
//
// Exit codes:
//   0 — all clients OK or no Twilio-configured clients
//   1 — at least one drift detected
//   2 — unable to query (missing PAT, network, etc)

import { Buffer } from 'node:buffer';

const PAT = process.env.SUPABASE_PAT;
const REF = 'bjgrgbgykvjrsuwwruoh';

if (!PAT) {
  console.error('Missing SUPABASE_PAT in env (place in .env then `node --env-file=.env scripts/check-creds.mjs`)');
  process.exit(2);
}

async function querySql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`SQL fetch ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function checkTwilio(sid, authToken) {
  const basic = Buffer.from(`${sid}:${authToken}`).toString('base64');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
  });
  return { ok: r.ok, status: r.status };
}

async function main() {
  console.log('check-creds — Twilio token drift scan');
  const rows = await querySql(`
    SELECT id, name, twilio_account_sid, twilio_auth_token
    FROM clients
    WHERE twilio_account_sid IS NOT NULL
      AND twilio_auth_token IS NOT NULL
    ORDER BY name;
  `);

  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('No Twilio-configured clients in DB. Nothing to check.');
    process.exit(0);
  }

  let drift = 0;
  for (const r of rows) {
    process.stdout.write(`  ${r.name}: `);
    try {
      const result = await checkTwilio(r.twilio_account_sid, r.twilio_auth_token);
      if (result.ok) {
        console.log('OK');
      } else if (result.status === 401) {
        console.log(`DRIFT — Twilio rejected stored token (401)`);
        drift++;
      } else {
        console.log(`Twilio returned ${result.status}`);
      }
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
  }

  if (drift > 0) {
    console.log(`\n${drift} client(s) have stored Twilio tokens that no longer authenticate.`);
    console.log('Remediation: rotate token in Twilio Console → copy new token →');
    console.log('  UPDATE clients SET twilio_auth_token=\'<new>\' WHERE id=\'<uuid>\';');
    process.exit(1);
  }
  console.log('\nAll Twilio credentials valid.');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(2);
});
