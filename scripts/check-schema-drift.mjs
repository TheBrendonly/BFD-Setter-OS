#!/usr/bin/env node
// check-schema-drift.mjs — audit 2026-06-10 (DI-10)
//
// types.ts reflects the DEV Supabase project, not the live platform DB, so
// type-checked code can reference tables/columns that throw 42703 / PGRST205 at
// runtime (the class of bug behind DI-1..DI-9). This is a lightweight CI guard:
// it greps every `.from("<table>")` in the edge functions + Trigger.dev tasks,
// then asks the live platform DB which of those tables actually exist, and
// reports any referenced-but-missing tables.
//
// Usage:  node --env-file=.env scripts/check-schema-drift.mjs
// Env:    SUPABASE_PAT (sbp_*), SUPABASE_PROJECT_REF (default bjgrgbgykvjrsuwwruoh)
// Exit:   non-zero if any referenced table is missing (so it can gate CI).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "bjgrgbgykvjrsuwwruoh";
const ROOT = new URL("..", import.meta.url).pathname;

// Tables that legitimately live in each client's EXTERNAL Supabase project
// (not the platform DB) — referenced via a per-client createClient(), so their
// absence from the platform DB is expected, not drift.
const EXTERNAL_TABLES = new Set([
  "chat_history", "call_history", "documents", "text_prompts", "voice_prompts", "leads_external",
]);

const SCAN_DIRS = [
  "frontend/supabase/functions",
  "trigger",
];

function walk(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|mjs|js)$/.test(e)) out.push(p);
  }
  return out;
}

const refs = new Map(); // table -> Set(files)
const FROM_RE = /\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g;
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, "utf8");
    let m;
    while ((m = FROM_RE.exec(src)) !== null) {
      const t = m[1];
      if (!refs.has(t)) refs.set(t, new Set());
      refs.get(t).add(file.replace(ROOT, ""));
    }
  }
}

const referenced = [...refs.keys()].filter((t) => !EXTERNAL_TABLES.has(t)).sort();

const pat = process.env.SUPABASE_PAT;
if (!pat) {
  console.error("ERROR: SUPABASE_PAT not set (run with --env-file=.env)");
  process.exit(2);
}

const sql = `SELECT table_name FROM information_schema.tables WHERE table_schema='public';`;
const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
if (!r.ok) {
  console.error(`Management API failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
  process.exit(2);
}
const existing = new Set((await r.json()).map((row) => row.table_name));

const missing = referenced.filter((t) => !existing.has(t));

console.log(`Scanned ${SCAN_DIRS.join(", ")} — ${referenced.length} distinct platform tables referenced.`);
if (missing.length === 0) {
  console.log("✓ No schema drift: every referenced platform table exists.");
  process.exit(0);
}
console.log(`\n✗ ${missing.length} referenced table(s) MISSING from platform DB ${PROJECT_REF}:`);
for (const t of missing) {
  console.log(`  - ${t}`);
  for (const f of refs.get(t)) console.log(`      ${f}`);
}
console.log("\n(If a table is an external-client table, add it to EXTERNAL_TABLES.)");
process.exit(1);
