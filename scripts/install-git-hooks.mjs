// Installs the repo's git hooks into this clone. Idempotent; safe to run on
// every `npm install` via the "prepare" script. Kept in-repo (unlike
// .git/hooks/, which is not version-controlled) so the pre-commit secret guard
// is auditable and reproducible across clones — the fix for the audit finding
// "No pre-commit secret hook, despite the runbook claiming one" (2026-07-20).
//
// Installs a pre-commit hook that runs scripts/check-secrets.mjs. Does NOT touch
// core.hooksPath (which would silently disable the graphify post-checkout/
// post-commit hooks that live in .git/hooks/).
import { execSync } from 'node:child_process';
import { writeFileSync, chmodSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = '# bfd-setter:check-secrets';
const HOOK = `#!/bin/sh
${MARKER}
node scripts/check-secrets.mjs || exit 1
`;

let hooksDir;
try {
  hooksDir = execSync('git rev-parse --git-path hooks', { encoding: 'utf8' }).trim();
} catch {
  console.error('install-git-hooks: not a git repo; skipping.');
  process.exit(0);
}
if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

const preCommit = join(hooksDir, 'pre-commit');
if (existsSync(preCommit)) {
  const cur = readFileSync(preCommit, 'utf8');
  if (cur.includes(MARKER)) {
    process.exit(0); // already ours, nothing to do
  }
  // Preserve an existing non-managed hook by chaining ours in front of it.
  const chained = `#!/bin/sh\n${MARKER}\nnode scripts/check-secrets.mjs || exit 1\n\n${cur.replace(/^#!.*\n/, '')}`;
  writeFileSync(preCommit, chained);
} else {
  writeFileSync(preCommit, HOOK);
}
chmodSync(preCommit, 0o755);
console.log('install-git-hooks: pre-commit secret guard installed at', preCommit);
