// One-off Supabase edge function deployer.
//
//   SUPABASE_PAT=… node scripts/deploy_single_fn.mjs <slug>
//
// Bundles index.ts plus every sibling *.ts in the function directory (so per-
// function helpers like ./contactId.ts ship with the deploy). Does NOT include
// _shared/ — use scripts/deploy_with_shared.mjs for functions that need it.
import { readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const PAT = process.env.SUPABASE_PAT;
if (!PAT) {
  console.error('Missing SUPABASE_PAT in env');
  process.exit(1);
}
const REF = 'bjgrgbgykvjrsuwwruoh'; // BFD Supabase project ref
// Resolve relative to this script so the deployer works in any worktree.
const FN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'supabase', 'functions');

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: SUPABASE_PAT=… node scripts/deploy_single_fn.mjs <slug>');
  process.exit(1);
}

const dir = join(FN_DIR, slug);
const indexPath = join(dir, 'index.ts');
const siblings = readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts'));

// Bundle _shared/ helpers so functions importing from ../_shared/ resolve at
// deploy time. Mirrors the pattern in deploy_with_shared.mjs. Including extra
// files is harmless — Supabase only counts ones the bundle actually imports.
const sharedDir = join(FN_DIR, '_shared');
let sharedFiles = [];
try {
  sharedFiles = readdirSync(sharedDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
} catch {
  // _shared not present — fine.
}

console.log(`Deploying ${slug}`);
console.log(`  index.ts + siblings: ${siblings.join(', ') || '(none)'}`);
console.log(`  _shared bundled: ${sharedFiles.join(', ') || '(none)'}`);

// Preserve verify_jwt by reading current.
const getRes = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/${slug}`, {
  headers: { Authorization: `Bearer ${PAT}` },
});
if (!getRes.ok) {
  console.error(`GET function metadata failed: ${getRes.status}`);
  process.exit(1);
}
const current = await getRes.json();
const verifyJwt = !!current.verify_jwt;
console.log(`  current version: ${current.version}, verify_jwt: ${verifyJwt}`);

const fd = new FormData();
fd.append('metadata', JSON.stringify({
  name: slug,
  verify_jwt: verifyJwt,
  entrypoint_path: 'index.ts',
}));
fd.append('file', new Blob([readFileSync(indexPath, 'utf8')], { type: 'application/typescript' }), 'index.ts');
for (const sib of siblings) {
  fd.append('file', new Blob([readFileSync(join(dir, sib), 'utf8')], { type: 'application/typescript' }), sib);
}
for (const sf of sharedFiles) {
  fd.append('file', new Blob([readFileSync(join(sharedDir, sf), 'utf8')], { type: 'application/typescript' }), `../_shared/${sf}`);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${slug}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}` },
  body: fd,
});
const json = await res.json();
console.log(`  result: ${res.ok ? 'OK' : 'FAIL'} status=${res.status} version=${json.version} fn_status=${json.status}`);
if (!res.ok) {
  console.error(JSON.stringify(json, null, 2));
  process.exit(1);
}
