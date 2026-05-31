import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { setTimeout as sleep } from 'timers/promises';

const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Missing SUPABASE_PAT'); process.exit(1); }
const REF = 'bjgrgbgykvjrsuwwruoh';
const FN_DIR = '/srv/bfd/Projects/bfd-setter/frontend/supabase/functions';

// Functions affected by EE3 sweep. We redeploy every one with all _shared/*.ts
// included so any reference to ../_shared/X.ts resolves.
const SLUGS = [
  'analytics-v2-process','analytics-v2-suggest-widgets','analyze-chat-history','analyze-metric',
  'analyze-setter-prompt','analyze-simulation',
  'chat-with-history','check-client-subscription','copy-setter-config','format-metric-chart',
  'generate-ai-prompt','generate-conversation-examples','generate-setter-config',
  'generate-simulation-config','generate-simulation-personas','generate-simulation-report',
  'match-webinar-contacts','modify-prompt-ai','notify-webhook','process-lead-file',
  'push-contact-to-external','run-simulation','stripe-checkout','stripe-portal','stripe-webhook',
  'sync-external-contacts','sync-external-credentials','test-external-supabase',
  // Form-to-agent routing (2026-05-30): these import ../_shared/resolve-workflow.ts
  'sync-ghl-contact','intake-lead',
  // Native bulk reactivation (2026-05-31): imports ../_shared/{assert-client-access,reactivate-list}.ts
  'reactivate-lead-list',
];

const sharedFiles = readdirSync(join(FN_DIR, '_shared')).filter(f => f.endsWith('.ts'));
console.log(`Bundling _shared files: ${sharedFiles.join(', ')}`);

const results = [];
for (const slug of SLUGS) {
  try {
    // Read current verify_jwt
    const getRes = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/${slug}`, { headers: { Authorization: `Bearer ${PAT}` } });
    const current = await getRes.json();
    const verifyJwt = !!current.verify_jwt;

    const fd = new FormData();
    fd.append('metadata', JSON.stringify({
      name: slug,
      verify_jwt: verifyJwt,
      entrypoint_path: 'index.ts',
    }));

    const indexBody = readFileSync(join(FN_DIR, slug, 'index.ts'), 'utf8');
    fd.append('file', new Blob([indexBody], { type: 'application/typescript' }), 'index.ts');

    for (const sf of sharedFiles) {
      const body = readFileSync(join(FN_DIR, '_shared', sf), 'utf8');
      fd.append('file', new Blob([body], { type: 'application/typescript' }), `../_shared/${sf}`);
    }

    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}` },
      body: fd,
    });
    const json = await res.json();
    results.push({ slug, ok: res.ok, status: res.status, version: json.version, fn_status: json.status });
    process.stdout.write(`${res.ok ? '✓' : '✗'} ${slug} (v${json.version}) ${json.status || ''}${res.ok ? '' : ' ' + JSON.stringify(json).slice(0, 200)}\n`);
  } catch (e) {
    results.push({ slug, ok: false, err: e.message });
    process.stdout.write(`✗ ${slug} ERR ${e.message}\n`);
  }
  await sleep(200);
}

const ok = results.filter(r => r.ok).length;
console.log(`\n=== Summary === OK: ${ok}/${results.length}`);
if (ok !== results.length) {
  console.log('FAILED:');
  for (const f of results.filter(r => !r.ok)) console.log(' -', JSON.stringify(f));
}
process.exit(ok === results.length ? 0 : 1);
