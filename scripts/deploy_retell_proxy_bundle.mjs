import { readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Missing SUPABASE_PAT'); process.exit(1); }
const REF = 'bjgrgbgykvjrsuwwruoh';
// Worktree-aware: resolve relative to this script so dev-branch worktrees work.
const FN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'supabase', 'functions');
const SLUG = process.argv[2] || 'retell-proxy';

const sharedFiles = readdirSync(join(FN_DIR, '_shared')).filter(f => f.endsWith('.ts'));
console.log(`Bundling _shared: ${sharedFiles.join(', ')}`);

const getRes = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/${SLUG}`, { headers: { Authorization: `Bearer ${PAT}` } });
const current = await getRes.json();
const verifyJwt = !!current.verify_jwt;
console.log(`Pre-deploy: ${SLUG} v${current.version} (verify_jwt=${verifyJwt})`);

const fd = new FormData();
fd.append('metadata', JSON.stringify({ name: SLUG, verify_jwt: verifyJwt, entrypoint_path: 'index.ts' }));
const indexBody = readFileSync(join(FN_DIR, SLUG, 'index.ts'), 'utf8');
fd.append('file', new Blob([indexBody], { type: 'application/typescript' }), 'index.ts');
for (const sf of sharedFiles) {
  const body = readFileSync(join(FN_DIR, '_shared', sf), 'utf8');
  fd.append('file', new Blob([body], { type: 'application/typescript' }), `../_shared/${sf}`);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${SLUG}`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}` }, body: fd });
const json = await res.json();
console.log(`${res.ok ? '✓' : '✗'} ${SLUG} HTTP ${res.status} → v${json.version} (${json.status})`);
if (!res.ok) { console.log(JSON.stringify(json).slice(0, 400)); process.exit(1); }

// Smoke probe: GET on a non-existent slot should boot but 401 or 400 (auth required)
const probe = await fetch(`https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/${SLUG}`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
console.log(`Boot probe: HTTP ${probe.status} (expect 401 = booted + auth required)`);
process.exit(probe.status === 503 ? 1 : 0);
