#!/usr/bin/env node
// snapshot_voice_tools.mjs
//
// READ-ONLY pre-flight for User Todos A3 (repoint Retell + ElevenLabs voice
// tool URLs). Snapshots BFD's current Retell agents + LLMs and prints a
// before/after report of every general_tool URL vs the canonical
// voice-booking-tools URL we plan to point at.
//
// Does NOT patch anything. Run before the A3 PATCH script so we have a
// rollback baseline + clear diff.
//
// Env (sourced from .env):
//   BFD_RETELL_API_KEY     required
//   SUPABASE_PAT           required (for Mgmt API SQL on bfd-platform)
//   BFD_CLIENT_ID          optional override; defaults to BFD's id
//
// Usage: node --env-file=.env scripts/snapshot_voice_tools.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_DIR = path.join(__dirname, ".snapshots");

const BFD_CLIENT_ID = process.env.BFD_CLIENT_ID || "e467dabc-57ee-416c-8831-83ecd9c7c925";
const BFD_PROJECT_REF = "bjgrgbgykvjrsuwwruoh";
const SUPABASE_URL = `https://${BFD_PROJECT_REF}.supabase.co`;

// The 5 tool slugs A3 says we need to point at voice-booking-tools.
// (Memory: User Todos.md A3.) Tool names in Retell may differ from slugs;
// the script prints both so we can map them by hand.
const A3_TOOL_SLUGS = [
  "get-available-slots",
  "book-appointments",
  "get-contact-appointments",
  "update-appointment",
  "cancel-appointments",
];

function envOrDie(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    console.error(`Add it to .env at the repo root, then re-run.`);
    process.exit(1);
  }
  return v;
}

const RETELL_KEY = envOrDie("BFD_RETELL_API_KEY");
const SUPABASE_PAT = envOrDie("SUPABASE_PAT");

async function mgmtSql(sql) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${BFD_PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await r.text();
  if (!r.ok) throw new Error(`Mgmt SQL ${r.status}: ${text}`);
  return JSON.parse(text);
}

async function retell(method, path, body) {
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${RETELL_KEY}`,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(`https://api.retellai.com${path}`, init);
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!r.ok) throw new Error(`Retell ${method} ${path} → ${r.status}: ${text.slice(0, 500)}`);
  return json;
}

function expectedUrl(slug) {
  return `${SUPABASE_URL}/functions/v1/voice-booking-tools?tool=${slug}&clientId=${BFD_CLIENT_ID}`;
}

function classifyToolUrl(currentUrl) {
  if (!currentUrl) return { kind: "no-url" };
  for (const slug of A3_TOOL_SLUGS) {
    const target = expectedUrl(slug);
    if (currentUrl === target) return { kind: "already-correct", slug };
    // Loose match: same path + tool param, different host or clientId.
    if (currentUrl.includes(`tool=${slug}`)) return { kind: "needs-repoint", slug, target };
  }
  return { kind: "unknown-tool" };
}

async function main() {
  console.log(`Snapshotting BFD voice tools — client ${BFD_CLIENT_ID}\n`);

  // 1. Resolve agent IDs + intake_lead_secret from clients table.
  const sql = `
    SELECT
      retell_inbound_agent_id,
      retell_outbound_agent_id,
      retell_outbound_followup_agent_id,
      retell_agent_id_4,
      retell_agent_id_5,
      retell_agent_id_6,
      retell_agent_id_7,
      retell_agent_id_8,
      retell_agent_id_9,
      retell_agent_id_10,
      intake_lead_secret IS NOT NULL AS has_intake_secret
    FROM clients
    WHERE id = '${BFD_CLIENT_ID}'
    LIMIT 1
  `;
  const rows = await mgmtSql(sql);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No clients row for ${BFD_CLIENT_ID}`);
  }
  const row = rows[0];

  console.log("clients row (BFD):");
  console.log(`  retell_inbound_agent_id          : ${row.retell_inbound_agent_id || "(null)"}`);
  console.log(`  retell_outbound_agent_id         : ${row.retell_outbound_agent_id || "(null)"}`);
  console.log(`  retell_outbound_followup_agent_id: ${row.retell_outbound_followup_agent_id || "(null)"}`);
  for (let i = 4; i <= 10; i++) {
    const v = row[`retell_agent_id_${i}`];
    if (v) console.log(`  retell_agent_id_${i.toString().padEnd(2)}              : ${v}`);
  }
  console.log(`  intake_lead_secret set?          : ${row.has_intake_secret ? "YES" : "NO (need to mint in step 2)"}`);
  console.log();

  const agentSlots = [];
  if (row.retell_inbound_agent_id) agentSlots.push(["inbound", row.retell_inbound_agent_id]);
  if (row.retell_outbound_agent_id) agentSlots.push(["outbound", row.retell_outbound_agent_id]);
  if (row.retell_outbound_followup_agent_id) agentSlots.push(["outbound_followup", row.retell_outbound_followup_agent_id]);
  for (let i = 4; i <= 10; i++) {
    const v = row[`retell_agent_id_${i}`];
    if (v && !agentSlots.some(([, id]) => id === v)) agentSlots.push([`slot_${i}`, v]);
  }
  if (agentSlots.length === 0) {
    throw new Error("No retell_*_agent_id columns set on BFD clients row.");
  }

  // 2. GET each agent, GET each unique LLM, snapshot.
  const snapshot = {
    snapshot_at: new Date().toISOString(),
    client_id: BFD_CLIENT_ID,
    expected_url_template: `${SUPABASE_URL}/functions/v1/voice-booking-tools?tool=<slug>&clientId=${BFD_CLIENT_ID}`,
    a3_tool_slugs: A3_TOOL_SLUGS,
    agents: {},
    skipped: [],
  };

  const llmCache = new Map();
  for (const [slot, agentId] of agentSlots) {
    let agent;
    try {
      agent = await retell("GET", `/get-agent/${agentId}`);
    } catch (err) {
      console.warn(`${slot} (${agentId}): SKIP — ${err.message}`);
      snapshot.skipped.push({ slot, agent_id: agentId, error: err.message });
      continue;
    }
    const llmId = agent?.response_engine?.llm_id;
    let llm = null;
    if (llmId) {
      if (llmCache.has(llmId)) {
        llm = llmCache.get(llmId);
      } else {
        llm = await retell("GET", `/get-retell-llm/${llmId}`);
        llmCache.set(llmId, llm);
      }
    }
    snapshot.agents[slot] = { agent_id: agentId, llm_id: llmId, agent, llm };
  }

  // 3. Print human report.
  console.log("=".repeat(80));
  console.log("CURRENT TOOL CONFIG vs A3 TARGET");
  console.log("=".repeat(80));

  const seenLlms = new Set();
  for (const [slot, info] of Object.entries(snapshot.agents)) {
    console.log(`\n[${slot}] agent ${info.agent_id} → llm ${info.llm_id || "(none)"}`);
    if (!info.llm) { console.log("  (no LLM attached — skipping tools)"); continue; }
    if (seenLlms.has(info.llm_id)) { console.log("  (LLM already shown above — agents share this LLM)"); continue; }
    seenLlms.add(info.llm_id);

    const tools = Array.isArray(info.llm.general_tools) ? info.llm.general_tools : [];
    if (tools.length === 0) { console.log("  (LLM has no general_tools)"); continue; }

    for (const t of tools) {
      const cls = classifyToolUrl(t.url);
      const hasAuth = !!(t.headers && t.headers.Authorization);
      let line = `  - ${t.name.padEnd(30)} `;
      if (cls.kind === "already-correct") line += `OK    (matches A3 target for ${cls.slug})`;
      else if (cls.kind === "needs-repoint") line += `PATCH (${cls.slug}: current → ${t.url})`;
      else if (cls.kind === "no-url") line += `n/a   (no URL — likely a built-in tool, skip)`;
      else line += `?     (not in A3 set; current → ${t.url || "(no url)"})`;
      console.log(line);
      if (cls.kind === "needs-repoint") {
        console.log(`    target: ${cls.target}`);
        console.log(`    bearer header set: ${hasAuth ? "YES" : "NO"}`);
      }
    }
  }

  // 4. Save snapshot.
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(SNAPSHOT_DIR, `bfd-voice-tools-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nFull snapshot: ${path.relative(REPO_ROOT, outPath)}`);
  console.log("Skipped agents:", snapshot.skipped.length);
  console.log("\nNext: review the report above, then we'll write the PATCH script for A3 step 3.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
