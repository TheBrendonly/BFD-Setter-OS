// PROMPT-AUTH-1 — REPORT-ONLY migration audit for stored text-setter prompts.
//
// For every client's external text_prompts rows, this script:
//   1. runs the save-time lint (the same module save-external-prompt enforces),
//   2. locates the legacy auto-seeded "# BOOKING FUNCTION" region (only when it
//      carries the legacy markers: {{ $now }} / legacy tool names / day policy),
//   3. emits a per-row report: lint findings with line numbers, the proposed lean
//      prompt (legacy region removed, everything else byte-preserved), and the
//      exact UI steps for a HUMAN to apply.
//
// It NEVER writes to any database. Prompt content is report-only: a human applies
// changes through the BFD setter UI (which now lints on save and snapshots to
// prompt_versions).
//
// Usage:
//   node --experimental-strip-types scripts/report_text_prompt_migration.mjs            # summary to stdout
//   node --experimental-strip-types scripts/report_text_prompt_migration.mjs --out DIR  # + per-row report files
//
// Requires .env: SUPABASE_PAT (platform Management API, read-only query).

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { lintTextSetterPrompt } from "../frontend/supabase/functions/_shared/promptLint.ts";

const PLATFORM_REF = "bjgrgbgykvjrsuwwruoh";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function loadEnv() {
  try {
    for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* .env optional if vars already exported */ }
}

async function platformQuery(pat, query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PLATFORM_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`Management API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return await resp.json();
}

async function externalGet(url, key, path) {
  const resp = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) throw new Error(`external REST ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return await resp.json();
}

const LEGACY_MARKERS = [/\{\{ \$now \}\}/, /Get_Available_Slot/, /Available days?\s*[:*]/i];

// Locate the legacy "# BOOKING FUNCTION" region: from its heading line to the
// next top-level "# " heading (exclusive) or EOF. The legacy template's own
// "# SERVICE FUNCTIONS - TEXT AGENT WORKFLOW" header sits INSIDE the region
// (it is the template's first line), so it does not terminate the scan.
// Returns null when absent or when the region does not look legacy (no
// markers — leave modern content alone).
export function locateLegacyBookingRegion(lines) {
  const start = lines.findIndex((l) => /^# BOOKING FUNCTION\s*$/.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (
      /^# (?!#)/.test(lines[i]) &&
      !/^# BOOKING FUNCTION/.test(lines[i]) &&
      !/^# SERVICE FUNCTIONS - TEXT AGENT WORKFLOW/.test(lines[i])
    ) {
      end = i;
      break;
    }
  }
  const region = lines.slice(start, end).join("\n");
  if (!LEGACY_MARKERS.some((m) => m.test(region))) return null;
  return { start, end }; // 0-based [start, end)
}

export function buildProposedPrompt(stored) {
  const lines = stored.split("\n");
  const region = locateLegacyBookingRegion(lines);
  if (!region) return { proposed: stored, removed: 0, region: null };
  const kept = [...lines.slice(0, region.start), ...lines.slice(region.end)];
  // collapse the doubled separator/blank runs the removal can leave behind
  const proposed = kept.join("\n").replace(/\n{4,}/g, "\n\n\n");
  return { proposed, removed: region.end - region.start, region };
}

function formatFindings(findings) {
  return findings.map((f) => `  L${String(f.line).padStart(4)} [${f.severity}/${f.rule}] ${f.excerpt}`).join("\n");
}

async function main() {
  loadEnv();
  const pat = process.env.SUPABASE_PAT;
  if (!pat) {
    console.error("Missing SUPABASE_PAT in .env");
    process.exit(1);
  }
  const outIdx = process.argv.indexOf("--out");
  const outDir = outIdx !== -1 ? process.argv[outIdx + 1] : null;
  if (outDir) mkdirSync(outDir, { recursive: true });

  const clients = await platformQuery(
    pat,
    "select id, supabase_url, supabase_service_key from clients where supabase_url is not null and supabase_service_key is not null",
  );
  console.log(`clients with external DBs: ${clients.length}\n`);

  let flagged = 0;
  for (const client of clients) {
    let rows;
    try {
      rows = await externalGet(
        client.supabase_url,
        client.supabase_service_key,
        // PROMPT-LINT-1: also fetch the followup fields so they get linted too —
        // they were previously never selected or scanned by this report.
        "text_prompts?select=card_name,system_prompt,updated_at,followup_instructions,followup_cancellation_instructions",
      );
    } catch (err) {
      console.log(`client ${client.id}: SKIP (${err.message})`);
      continue;
    }
    for (const row of rows) {
      const stored = row.system_prompt || "";
      const lint = lintTextSetterPrompt(stored);
      const { proposed, removed, region } = buildProposedPrompt(stored);

      // PROMPT-LINT-1: fold the followup fields' lint findings in, tagged by
      // field, so a reworded day-restriction hiding there doesn't get a false
      // CLEAN verdict.
      const followupFields = [
        ["followup_instructions", row.followup_instructions],
        ["followup_cancellation_instructions", row.followup_cancellation_instructions],
      ];
      const followupErrors = [];
      const followupWarnings = [];
      for (const [field, value] of followupFields) {
        if (!value) continue;
        const fieldLint = lintTextSetterPrompt(value);
        followupErrors.push(...fieldLint.errors.map((e) => ({ ...e, rule: `${field}.${e.rule}` })));
        followupWarnings.push(...fieldLint.warnings.map((w) => ({ ...w, rule: `${field}.${w.rule}` })));
      }
      const allErrors = [...lint.errors, ...followupErrors];
      const allWarnings = [...lint.warnings, ...followupWarnings];

      const clean = allErrors.length === 0 && allWarnings.length === 0 && removed === 0;
      const status = clean ? "CLEAN" : "NEEDS MIGRATION";
      if (!clean) flagged++;
      console.log(
        `client ${client.id} / ${row.card_name}: ${status} ` +
          `(${stored.split("\n").length} lines, ${allErrors.length} errors, ${allWarnings.length} warnings` +
          `${removed ? `, legacy booking region lines ${region.start + 1}-${region.end} [${removed} lines]` : ""})`,
      );
      if (allErrors.length) console.log(formatFindings(allErrors));
      if (allWarnings.length) console.log(formatFindings(allWarnings));

      if (outDir && !clean) {
        const base = `${client.id}_${row.card_name}`.replace(/[^A-Za-z0-9_-]/g, "_");
        writeFileSync(join(outDir, `${base}.stored.txt`), stored);
        writeFileSync(join(outDir, `${base}.proposed.txt`), proposed);
        const proposedLint = lintTextSetterPrompt(proposed);
        writeFileSync(
          join(outDir, `${base}.report.md`),
          [
            `# Migration report: ${row.card_name} (client ${client.id})`,
            ``,
            `Stored: ${stored.split("\n").length} lines / ${stored.length} chars (updated_at ${row.updated_at}).`,
            `Proposed: ${proposed.split("\n").length} lines / ${proposed.length} chars` +
              (removed ? ` (legacy booking region removed: stored lines ${region.start + 1}-${region.end}, ${removed} lines).` : `.`),
            ``,
            `## Lint findings on the STORED prompt (system_prompt + followup fields)`,
            allErrors.length || allWarnings.length ? formatFindings([...allErrors, ...allWarnings]) : `  (none)`,
            ``,
            `## Lint on the PROPOSED prompt (system_prompt only — followup fields are unaffected by this script)`,
            proposedLint.errors.length || proposedLint.warnings.length
              ? formatFindings([...proposedLint.errors, ...proposedLint.warnings])
              : `  (clean)`,
            ``,
            `## How to apply (HUMAN, via the BFD setter UI — do NOT write the DB directly)`,
            `1. Open Prompt Management -> this setter -> SETTER CORE.`,
            `2. Enable "Booking Function" -> "View Prompt": clear the legacy booking text`,
            `   (or click "Return to Default" for the new minimal booking template).`,
            `3. Fix any remaining flagged lines in the sections that produced them.`,
            `4. Deploy. The save now lints (blocks stale content) and snapshots to prompt_versions.`,
            `5. Re-open "Verify Setter Prompt" -> "Load live stored prompt" to confirm the stored row is lean.`,
          ].join("\n"),
        );
      }
    }
  }
  console.log(`\nrows needing migration: ${flagged}${outDir ? ` (reports in ${outDir})` : " (pass --out DIR for full reports)"}`);
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
