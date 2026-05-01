#!/usr/bin/env node
// install-lookup-contact-tool.mjs
//
// One-shot REST patcher: ensures every BFD Retell LLM has the
// `lookup_contact` custom tool, then republishes each agent so the change
// goes live. Idempotent: re-running it on an already-patched LLM is a no-op.
//
// Why REST and not MCP: per memory `reference_retell_rest_vs_mcp`, MCP strips
// custom-tool parameters and non-enum models on PATCH. We need full fidelity
// here.
//
// Pre-flight: snapshots every BFD Retell agent + LLM JSON to
//   Operations/handoffs/<date>-bfd-retell-pre-F2-backup.json
// so a one-line restore is possible if anything goes wrong.
//
// Env:
//   BFD_RETELL_API_KEY     required
//   SUPABASE_PAT           required (Management API PAT)
//   BFD_CLIENT_ID          optional override; defaults to BFD's hard-coded id
//
// Usage: node scripts/install-lookup-contact-tool.mjs [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const HANDOFF_DIR = path.resolve(REPO_ROOT, "..", "..", "Operations", "handoffs");

const BFD_CLIENT_ID = process.env.BFD_CLIENT_ID || "e467dabc-57ee-416c-8831-83ecd9c7c925";
const BFD_PROJECT_REF = "bjgrgbgykvjrsuwwruoh";
const SUPABASE_URL = `https://${BFD_PROJECT_REF}.supabase.co`;

const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_ALL = process.argv.includes("--include-all-agents");

// Optional explicit allowlist of Retell agents to patch, beyond what's stored
// on `clients.retell_*_agent_id`. The Retell account holds 17+ legacy upstream
// /template agents which we deliberately do NOT touch — pass --include-all-agents
// to patch every agent in the account if you really want that.
// IMPORTANT: stale entries here cause 404s on /get-agent. Verify each id exists
// in Retell before adding.
const BFD_KNOWN_AGENTS = {
  // "agent_xxxxxxxxxxxxxxxxxxxxxxxxxxxx": "outbound",
};

function envOrDie(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
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

function buildLookupTool(clientId, intakeSecret) {
  const tool = {
    type: "custom",
    name: "lookup_contact",
    description:
      "Look up the calling lead by phone (defaults to the caller's number). " +
      "Use this NEAR THE START of every call so you can greet by name and reference recent bookings or past conversations. " +
      "Only call again mid-call if the caller asks you to re-check after correcting their phone number.",
    url: `${SUPABASE_URL}/functions/v1/voice-booking-tools?tool=lookup-contact&clientId=${clientId}`,
    speak_during_execution: false,
    speak_after_execution: false,
    execution_message_description: "",
    execution_timeout_ms: 8000,
    parameters: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description:
            "E.164 phone of the caller; default to the caller's number from the call (Retell will inject {{from_number}}).",
        },
      },
      required: ["phone"],
    },
  };
  if (intakeSecret) {
    tool.headers = { Authorization: `Bearer ${intakeSecret}` };
  }
  return tool;
}

async function main() {
  // 1. Resolve BFD's intake_lead_secret + slot mapping from clients table
  const sql = `
    SELECT
      retell_inbound_agent_id,
      retell_outbound_agent_id,
      retell_outbound_followup_agent_id,
      retell_agent_id_4,
      intake_lead_secret
    FROM clients
    WHERE id = '${BFD_CLIENT_ID}'
    LIMIT 1
  `;
  const rows = await mgmtSql(sql);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No clients row for ${BFD_CLIENT_ID}`);
  }
  const row = rows[0];

  const slotByAgentId = { ...BFD_KNOWN_AGENTS };
  if (row.retell_inbound_agent_id) slotByAgentId[row.retell_inbound_agent_id] = "inbound";
  if (row.retell_outbound_agent_id) slotByAgentId[row.retell_outbound_agent_id] = "outbound";
  if (row.retell_outbound_followup_agent_id) slotByAgentId[row.retell_outbound_followup_agent_id] = "outbound_followup";
  if (row.retell_agent_id_4) slotByAgentId[row.retell_agent_id_4] = "slot_4";

  let agentSlots;
  if (INCLUDE_ALL) {
    const allAgents = await retell("GET", "/list-agents");
    const list = Array.isArray(allAgents) ? allAgents : [];
    agentSlots = list
      .filter((a) => a && typeof a.agent_id === "string")
      .map((a) => [slotByAgentId[a.agent_id] || `unassigned_${a.agent_id.slice(-6)}`, a.agent_id]);
  } else {
    agentSlots = Object.entries(slotByAgentId).map(([agentId, slot]) => [slot, agentId]);
  }

  if (agentSlots.length === 0) {
    throw new Error("No agents to patch — supply BFD_KNOWN_AGENTS or use --include-all-agents");
  }

  console.log(`Patching ${agentSlots.length} agent(s)${INCLUDE_ALL ? " (full Retell account)" : " (BFD working set only — pass --include-all-agents to extend)"}:`);
  for (const [slot, id] of agentSlots) console.log(`  ${slot}: ${id}`);

  // 2. Snapshot every agent + its LLM BEFORE any patch. Skip 404s (stale
  // entries in BFD_KNOWN_AGENTS) gracefully.
  const snapshot = {
    snapshot_at: new Date().toISOString(),
    client_id: BFD_CLIENT_ID,
    agents: {},
    skipped: [],
  };
  for (const [slot, agentId] of agentSlots) {
    let agent;
    try {
      agent = await retell("GET", `/get-agent/${agentId}`);
    } catch (err) {
      console.warn(`  ${slot}: SKIP — ${err.message}`);
      snapshot.skipped.push({ slot, agent_id: agentId, error: err.message });
      continue;
    }
    const llmId = agent?.response_engine?.llm_id;
    const llm = llmId ? await retell("GET", `/get-retell-llm/${llmId}`) : null;
    snapshot.agents[slot] = { agent_id: agentId, agent, llm };
  }

  if (!fs.existsSync(HANDOFF_DIR)) fs.mkdirSync(HANDOFF_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(HANDOFF_DIR, `${date}-bfd-retell-pre-F2-backup.json`);
  fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot written: ${backupPath}`);

  if (DRY_RUN) {
    console.log("\nDRY RUN — no PATCH/publish performed. Re-run without --dry-run to apply.");
    for (const [slot, info] of Object.entries(snapshot.agents)) {
      const tools = (info.llm?.general_tools || []).map((t) => t.name);
      const has = tools.includes("lookup_contact");
      console.log(`  ${slot}: ${has ? "ALREADY HAS" : "MISSING"} lookup_contact (current tools: ${tools.join(", ")})`);
    }
    return;
  }

  // 3. For each LLM, append lookup_contact if missing, PATCH, publish
  const lookupTool = buildLookupTool(BFD_CLIENT_ID, row.intake_lead_secret || null);
  const llmIdsPatched = new Set();
  for (const [slot, info] of Object.entries(snapshot.agents)) {
    const llm = info.llm;
    if (!llm?.llm_id) {
      console.log(`  ${slot}: no LLM attached — skipping`);
      continue;
    }
    if (llmIdsPatched.has(llm.llm_id)) {
      console.log(`  ${slot}: LLM ${llm.llm_id} already patched in this run — only republishing agent`);
      await retell("POST", `/publish-agent/${info.agent_id}`);
      continue;
    }

    const existing = Array.isArray(llm.general_tools) ? llm.general_tools : [];
    const already = existing.find((t) => t?.name === "lookup_contact");
    if (already) {
      // Already there — leave the LLM alone but make sure agent is published
      console.log(`  ${slot}: LLM ${llm.llm_id} already has lookup_contact — republishing agent only`);
      await retell("POST", `/publish-agent/${info.agent_id}`);
      llmIdsPatched.add(llm.llm_id);
      continue;
    }

    const newTools = [...existing, lookupTool];
    await retell("PATCH", `/update-retell-llm/${llm.llm_id}`, { general_tools: newTools });
    await retell("POST", `/publish-agent/${info.agent_id}`);
    console.log(`  ${slot}: LLM ${llm.llm_id} patched (${existing.length} → ${newTools.length} tools), agent ${info.agent_id} republished`);
    llmIdsPatched.add(llm.llm_id);
  }

  console.log(`\nDone. ${llmIdsPatched.size} LLM(s) touched. Restore command: copy general_tools[] from ${backupPath} per agent and PATCH /update-retell-llm/{id}.`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
