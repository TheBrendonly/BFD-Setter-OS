// Pre-commit guard: fails the commit if any staged file contains a known
// secret pattern. Wire as `.git/hooks/pre-commit` (chmod +x):
//
//   #!/bin/sh
//   node scripts/check-secrets.mjs || exit 1
//
// Or invoke directly to scan staged files:
//   node scripts/check-secrets.mjs

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const patterns = [
  { name: 'Supabase JWT', re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'Supabase PAT', re: /sbp_[a-z0-9]{40}/ },
  { name: 'Retell API key', re: /key_[a-z0-9]{20,}/ },
  { name: 'GHL PIT', re: /pit-[a-z0-9-]{30,}/ },
  { name: 'Trigger.dev token', re: /tr_(prod|pat)_[a-z0-9]{20,}/ },
  { name: 'Twilio Account SID', re: /AC[a-f0-9]{32}/ },
  { name: 'Stripe secret key', re: /sk_(live|test)_[a-zA-Z0-9]{24,}/ },
];

// Skip files that are EXPECTED to mention these patterns (docs, examples).
const SKIP_FILES = new Set([
  '.env.example',
  'scripts/check-secrets.mjs',
]);

const SKIP_EXT = new Set(['.md', '.lock']);

let staged;
try {
  staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
} catch {
  console.error('Could not list staged files via git. Are you in a git repo?');
  process.exit(2);
}

if (staged.length === 0) {
  process.exit(0);
}

let leaked = false;
for (const file of staged) {
  if (SKIP_FILES.has(file)) continue;
  const ext = file.includes('.') ? '.' + file.split('.').pop() : '';
  if (SKIP_EXT.has(ext)) continue;

  let body;
  try { body = readFileSync(file, 'utf8'); } catch { continue; }

  for (const { name, re } of patterns) {
    const m = body.match(re);
    if (m) {
      const lineNum = body.slice(0, m.index).split('\n').length;
      console.error(`✗ ${file}:${lineNum} contains a likely ${name}: ${m[0].slice(0, 25)}…`);
      leaked = true;
    }
  }
}

if (leaked) {
  console.error('');
  console.error('Commit blocked. Move secrets to .env (which is gitignored) and reference them via process.env.');
  console.error('To bypass for a legitimate non-secret match, add the file to SKIP_FILES in scripts/check-secrets.mjs.');
  process.exit(1);
}

process.exit(0);
