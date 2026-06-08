#!/usr/bin/env node
// backfill_voice_setter_tools.mjs
//
// ONE-TIME, IDEMPOTENT normalizer for stored voice-setter general_tools.
//
// Why: existing setters store stale upstream n8n webhook URLs for their booking
// tools, and predate send-sms / schedule-callback so they lack those entirely.
// retell-proxy now forces the correct URL at push time + injects the two tools,
// so the live behaviour is already fixed. This script also cleans up the STORED
// config (prompt_configurations._retell_voice_settings.general_tools) so the
// Advanced-Editing UI stops showing the misleading n8n URLs and both new tools
// appear without a manual re-save.
//
// Scope: touches ONLY the general_tools field inside _retell_voice_settings.
// Never reads or writes prompts rows (no prompt content is changed).
//
// For each canonical BFD tool: url -> "__BFD_VOICE_BOOKING_TOOLS__" placeholder,
// query_params -> { "function-type": <trimmed name> } (push rewrites these anyway).
// Appends send-sms + schedule-callback if missing. Leaves end_call/transfer_call
// and any non-BFD custom tool untouched.
//
// Env (sourced from .env): SUPABASE_PAT (Mgmt API SQL on the platform project).
//
// Usage:
//   node --env-file=.env scripts/backfill_voice_setter_tools.mjs           # DRY RUN
//   node --env-file=.env scripts/backfill_voice_setter_tools.mjs --apply   # writes

const REF = "bjgrgbgykvjrsuwwruoh"; // BFD platform project ref
const PAT = process.env.SUPABASE_PAT;
const APPLY = process.argv.includes("--apply");

if (!PAT) {
  console.error("Missing SUPABASE_PAT in env. Run with: node --env-file=.env scripts/backfill_voice_setter_tools.mjs");
  process.exit(1);
}

const PLACEHOLDER = "__BFD_VOICE_BOOKING_TOOLS__";

// Mirror of BFD_VOICE_BOOKING_TOOL_NAMES in _shared/bfdVoiceTools.ts.
const BFD_NAMES = new Set([
  "get-available-slots",
  "book-appointments", "book-appointment",
  "cancel-appointments", "cancel-appointment",
  "get-contact-appointments",
  "update-appointment",
  "lookup-contact", "lookup_contact",
  "send-sms", "send_sms",
  "schedule-callback", "schedule_callback",
]);

// Mirror of BFD_SEND_SMS_TOOL / BFD_SCHEDULE_CALLBACK_TOOL in _shared/bfdVoiceTools.ts.
const SEND_SMS_TOOL = {
  type: "custom",
  name: "send-sms",
  url: PLACEHOLDER,
  method: "POST",
  parameter_type: "json",
  args_at_root: false,
  query_params: { "function-type": "send-sms" },
  headers: {},
  timeout_ms: 120000,
  speak_during_execution: true,
  speak_after_execution: false,
  execution_message_description:
    'Say a brief natural phrase like "Sure, texting that to you now". Under 10 words.',
  response_variables: {},
  description:
    "Send an SMS to the lead during the call. Use when the caller asks you to text them a link, address, booking confirmation, or any info that's easier in writing.",
  parameters: {
    type: "object",
    properties: { message: { type: "string", description: "The exact SMS body to text the lead." } },
    required: ["message"],
  },
};
const SCHEDULE_CALLBACK_TOOL = {
  type: "custom",
  name: "schedule-callback",
  url: PLACEHOLDER,
  method: "POST",
  parameter_type: "json",
  args_at_root: false,
  query_params: { "function-type": "schedule-callback" },
  headers: {},
  timeout_ms: 120000,
  speak_during_execution: true,
  speak_after_execution: false,
  execution_message_description:
    'Confirm casually, e.g. "Great, I\'ll give you a call back then". Under 12 words.',
  response_variables: {},
  description:
    "Schedule an AI callback when the lead can't talk now but wants to be called back later. Use ONLY when they are NOT booking an appointment.",
  parameters: {
    type: "object",
    properties: {
      when: {
        type: "string",
        description:
          "When to call back, in the lead's own words, for example 'this afternoon', 'tomorrow morning', 'at 3pm', 'in an hour', or an explicit time.",
      },
    },
    required: ["when"],
  },
};

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Mgmt SQL ${r.status}: ${text}`);
  return JSON.parse(text);
}

function normalizeTools(gt) {
  // Force canonical BFD tools to the placeholder + clean query_params.
  const next = gt.map((t) => {
    if (t.type === "end_call" || t.type === "transfer_call") return t;
    const name = typeof t.name === "string" ? t.name.trim() : "";
    if (BFD_NAMES.has(name)) {
      return { ...t, name, url: PLACEHOLDER, query_params: { "function-type": name } };
    }
    return t;
  });
  // Inject the two defaults if absent.
  const present = new Set(next.map((t) => (typeof t.name === "string" ? t.name.trim() : "")));
  if (!(present.has("send-sms") || present.has("send_sms"))) next.push(SEND_SMS_TOOL);
  if (!(present.has("schedule-callback") || present.has("schedule_callback"))) next.push(SCHEDULE_CALLBACK_TOOL);
  return next;
}

const rows = await sql(
  `SELECT id, client_id, slot_id, custom_content
     FROM prompt_configurations
    WHERE config_key = '_retell_voice_settings'
    ORDER BY client_id, slot_id`,
);

console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY RUN (no writes)"}`);
console.log(`Rows: ${rows.length}\n`);

let updated = 0;
for (const row of rows) {
  const tag = `${String(row.client_id).slice(0, 8)} ${String(row.slot_id).padEnd(16)}`;
  let obj;
  try {
    obj = JSON.parse(row.custom_content);
  } catch (e) {
    console.log(`${tag} SKIP (custom_content not JSON): ${e.message}`);
    continue;
  }
  let gt;
  try {
    gt = typeof obj.general_tools === "string" ? JSON.parse(obj.general_tools) : (obj.general_tools || []);
  } catch (e) {
    console.log(`${tag} SKIP (general_tools not JSON): ${e.message}`);
    continue;
  }
  if (!Array.isArray(gt)) {
    console.log(`${tag} SKIP (general_tools not an array)`);
    continue;
  }

  const before = JSON.stringify(gt);
  const normalized = normalizeTools(gt);
  const after = JSON.stringify(normalized);
  const changed = before !== after;

  const names = normalized.map((t) => t.name || t.type).join(", ");
  console.log(`${tag} ${changed ? "WILL UPDATE" : "no change "} -> [${names}]`);

  if (!changed) continue;
  updated++;

  if (APPLY) {
    obj.general_tools = JSON.stringify(normalized, null, 2);
    const newCC = JSON.stringify(obj).replace(/'/g, "''");
    await sql(
      `UPDATE prompt_configurations
          SET custom_content = '${newCC}', updated_at = now()
        WHERE id = '${row.id}'`,
    );
    console.log(`    updated id=${row.id}`);
  }
}

console.log(`\n${APPLY ? "Updated" : "Would update"} ${updated} / ${rows.length} row(s).`);
if (!APPLY && updated > 0) console.log("Re-run with --apply to write.");
