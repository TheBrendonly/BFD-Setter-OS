#!/usr/bin/env node
// native-vs-n8n-diff.mjs — phase-11i (D-M1)
//
// Renders a side-by-side diff of native processSetterReply vs the legacy n8n
// text engine for N recent inbound messages on a client. Used to sanity-check
// the Phase 9 cutover (`UPDATE clients SET use_native_text_engine=true`)
// before flipping the flag in production.
//
// Usage:
//   node --env-file=.env scripts/native-vs-n8n-diff.mjs \
//     [--n 5] \
//     [--client-id <uuid>] \
//     [--out <path>] \
//     [--dry-run]
//
// Default --client-id = BFD. --n is how many recent inbound messages to diff.
// --dry-run prints the candidate inbound messages without calling LLM or n8n.
//
// What it does:
//   1. SELECT N most-recent inbound message_queue rows for the client (joined
//      with clients to get text_engine_webhook + external Supabase + OpenRouter
//      key + setter prompt source).
//   2. For each row, run two paths in parallel:
//      - PATH A (native): mirror processSetterReply.ts in-script. Build the
//        same OpenAI message array (system prompt + chat_history + inbound),
//        call OpenRouter with the same model + temperature 0.5, parse the
//        JSON response. Zero side-effects on chat_history.
//      - PATH B (n8n): POST to client.text_engine_webhook with the same
//        URL-encoded query params processMessages.ts uses (`Message_Body`,
//        `Lead_ID`, `Contact_ID`, `GHL_Account_ID`, `Name`, `Email`, `Phone`,
//        `Setter_Number`). Parse the JSON body it returns.
//   3. Render a side-by-side markdown report including a basic word-overlap
//      hint. Brendan eyeballs the output before B2.
//
// Env vars (from .env):
//   SUPABASE_PAT          — Supabase Management API token (sbp_*)
//   SUPABASE_PROJECT_REF  — defaults to bjgrgbgykvjrsuwwruoh (BFD platform)
//
// Notes:
//   - Both paths see the SAME current chat_history. Historical responses to
//     the inbound under test will already be in the history; that means both
//     paths are evaluated against the same context (fair). The output is
//     "what would each engine say next given everything we know now" —
//     sufficient for cutover sanity-checking, not a perfect replay.
//   - The native path replicates processSetterReply.ts logic; if that file is
//     refactored, this script may need a touch-up to match.
//   - Setter_Number defaults to "1". The actual cadence-time setter
//     assignment isn't recorded on message_queue; for diff purposes Setter-1
//     is fine because BFD's primary persona uses that slot.

import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const BFD_CLIENT_ID = "e467dabc-57ee-416c-8831-83ecd9c7c925";
const DEFAULT_PROJECT_REF = "bjgrgbgykvjrsuwwruoh";
const DEFAULT_N = 5;
const DEFAULT_MODEL = "openai/gpt-4.1-nano";
const MAX_HISTORY_ROWS = 30;
const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;
const N8N_TIMEOUT_MS = 10 * 60 * 1000;

const MULTI_MESSAGE_INSTRUCTION = `\n\n## Output format (REQUIRED)\nRespond with ONLY a single JSON object — no markdown, no code fences, no preamble:\n{"messages": ["first reply", "second reply if needed"]}\n\nRules:\n- One element if a single SMS is enough; up to 3 elements when the natural reply needs to be broken into separate SMS\n- Each element is a complete SMS by itself\n- Do not include any text outside the JSON\n- Plain text — no JSON inside the message strings`;

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return flags;
}

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function runManagementSql({ pat, projectRef, sql }) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await r.text();
  if (!r.ok) die(`Management API SQL failed ${r.status}: ${txt.slice(0, 400)}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

async function fetchClient({ pat, projectRef, clientId }) {
  const sql = `SELECT id, name, ghl_location_id, llm_model, openrouter_api_key, supabase_url, supabase_service_key, text_engine_webhook, use_native_text_engine
FROM public.clients WHERE id = '${clientId}';`;
  const rows = await runManagementSql({ pat, projectRef, sql });
  if (!Array.isArray(rows) || rows.length === 0) die(`No client found with id=${clientId}`);
  const c = rows[0];
  if (!c.openrouter_api_key) die(`Client ${clientId} has no openrouter_api_key`);
  if (!c.text_engine_webhook) die(`Client ${clientId} has no text_engine_webhook (cannot run path B)`);
  if (!c.supabase_url || !c.supabase_service_key) die(`Client ${clientId} missing external supabase credentials`);
  return c;
}

async function fetchInboundMessages({ pat, projectRef, ghlLocationId, n }) {
  const sql = `SELECT id, lead_id, ghl_contact_id, ghl_account_id, message_body, channel,
       contact_name, contact_email, contact_phone, created_at
FROM public.message_queue
WHERE ghl_account_id = '${ghlLocationId}'
  AND channel IN ('sms','whatsapp','dm')
  AND message_body IS NOT NULL
  AND length(trim(message_body)) > 0
  AND created_at < now() - interval '15 minutes'
ORDER BY created_at DESC
LIMIT ${n};`;
  const rows = await runManagementSql({ pat, projectRef, sql });
  if (!Array.isArray(rows)) die(`Unexpected message_queue response: ${JSON.stringify(rows).slice(0, 200)}`);
  return rows;
}

async function fetchSetterPrompt({ supabaseUrl, serviceKey, slotId }) {
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/text_prompts?select=system_prompt&card_name=eq.${encodeURIComponent(slotId)}`;
  const r = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) {
    console.warn(`fetchSetterPrompt: HTTP ${r.status} — proceeding with empty system prompt`);
    return "";
  }
  const rows = await r.json();
  return Array.isArray(rows) && rows[0]?.system_prompt ? String(rows[0].system_prompt) : "";
}

async function fetchChatHistory({ supabaseUrl, serviceKey, sessionId }) {
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/chat_history?select=message,timestamp&session_id=eq.${encodeURIComponent(sessionId)}&order=timestamp.desc&limit=${MAX_HISTORY_ROWS}`;
  const r = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!r.ok) {
    console.warn(`fetchChatHistory: HTTP ${r.status} for session=${sessionId}`);
    return [];
  }
  const rows = await r.json();
  return Array.isArray(rows) ? rows.slice().reverse() : [];
}

function parseHumanContent(raw) {
  if (!raw) return "";
  const utteranceMatch = raw.match(/# USER LAST UTTERANCE\s*\n([\s\S]*?)(?:\n\n#|$)/);
  if (utteranceMatch) return utteranceMatch[1].trim();
  const legacyMatch = raw.match(/User last input:\s*\n([\s\S]*?)(?:\n\n|$)/);
  if (legacyMatch) return legacyMatch[1].trim();
  return raw.trim();
}

function extractJson(text) {
  const blockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (blockMatch) return blockMatch[1];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return null;
}

function parseSetterMessages(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];
  const candidate = extractJson(trimmed);
  if (candidate) {
    try {
      const obj = JSON.parse(candidate);
      if (Array.isArray(obj.messages)) {
        const arr = obj.messages.map((m) => (typeof m === "string" ? m.trim() : "")).filter(Boolean);
        if (arr.length > 0) return arr;
      }
    } catch {}
  }
  const splitOnDelim = trimmed.split(/\n\s*---\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (splitOnDelim.length > 1) return splitOnDelim;
  return [trimmed];
}

async function pathANative({ client, msg, setterNumber }) {
  const slotId = `Setter-${setterNumber}`;
  const setterPrompt = await fetchSetterPrompt({
    supabaseUrl: client.supabase_url,
    serviceKey: client.supabase_service_key,
    slotId,
  });
  const history = await fetchChatHistory({
    supabaseUrl: client.supabase_url,
    serviceKey: client.supabase_service_key,
    sessionId: msg.lead_id,
  });

  const systemContent = [
    setterPrompt && setterPrompt.trim(),
    `## Lead Context\nName: ${msg.contact_name || "(unknown)"}\nEmail: ${msg.contact_email || "(none)"}\nPhone: ${msg.contact_phone || "(none)"}`,
    MULTI_MESSAGE_INSTRUCTION,
  ].filter(Boolean).join("\n\n");

  const messages = [{ role: "system", content: systemContent }];
  for (const row of history) {
    const m = row?.message;
    if (!m || typeof m !== "object") continue;
    if (m.type === "human") {
      const content = parseHumanContent(m.content || "");
      if (content) messages.push({ role: "user", content });
    } else if (m.type === "ai") {
      const content = (m.content || "").trim();
      if (content) messages.push({ role: "assistant", content });
    }
  }
  messages.push({ role: "user", content: msg.message_body || "" });

  const model = (client.llm_model || "").trim() || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RESPONSE_TIMEOUT_MS);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${client.openrouter_api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.5 }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, error: `OpenRouter ${r.status}: ${body.slice(0, 300)}`, history_rows: history.length };
    }
    const json = await r.json();
    const raw = json?.choices?.[0]?.message?.content?.trim() ?? "";
    const setterMessages = parseSetterMessages(raw);
    return { ok: true, raw, messages: setterMessages, history_rows: history.length, model };
  } catch (err) {
    return { ok: false, error: err?.name === "AbortError" ? "timed out" : String(err?.message || err), history_rows: history.length };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function pathBN8n({ client, msg, setterNumber }) {
  const params = new URLSearchParams({
    Message_Body: msg.message_body || "",
    Lead_ID: msg.lead_id || "",
    Contact_ID: msg.lead_id || "",
    GHL_Account_ID: msg.ghl_account_id || "",
    Name: msg.contact_name || "",
    Email: msg.contact_email || "",
    Phone: msg.contact_phone || "",
    Setter_Number: String(setterNumber),
  });
  const url = `${client.text_engine_webhook}?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `n8n HTTP ${r.status}: ${text.slice(0, 300)}` };
    if (!text || !text.trim()) return { ok: false, error: "n8n returned empty body" };
    let body;
    try { body = JSON.parse(text); } catch { return { ok: false, error: `n8n non-JSON: ${text.slice(0, 200)}`, raw: text }; }
    const arr = [];
    let i = 1;
    while (body?.[`Message_${i}`]) {
      arr.push(String(body[`Message_${i}`]));
      i++;
    }
    return { ok: true, raw: text, messages: arr, body };
  } catch (err) {
    return { ok: false, error: err?.name === "AbortError" ? "timed out" : String(err?.message || err) };
  } finally {
    clearTimeout(timeoutId);
  }
}

function tokenize(s) {
  return new Set((s || "").toLowerCase().match(/[a-z0-9']+/g) || []);
}

function jaccardOverlap(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 && B.size === 0) return 1;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection++;
  const union = A.size + B.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function renderReport({ client, n, results }) {
  const lines = [];
  lines.push(`# BFD native-vs-n8n diff — ${isoDate()}`);
  lines.push("");
  lines.push(`**Client:** ${client.name} (\`${client.id}\`)`);
  lines.push(`**Sample size:** ${n}`);
  lines.push(`**Native model:** \`${client.llm_model || DEFAULT_MODEL}\``);
  lines.push(`**n8n endpoint:** \`${client.text_engine_webhook}\``);
  lines.push("");
  lines.push("Both paths see the same current `chat_history`. The pre-filter excludes");
  lines.push("messages from the last 15 minutes to avoid races. Word overlap is a coarse");
  lines.push("hint, not a similarity score — read the messages.");
  lines.push("");
  let okCount = 0;
  let nativeFails = 0;
  let n8nFails = 0;
  for (const r of results) {
    if (r.native.ok && r.n8n.ok) okCount++;
    if (!r.native.ok) nativeFails++;
    if (!r.n8n.ok) n8nFails++;
  }
  lines.push(`## Summary`);
  lines.push(`- Both paths returned: ${okCount}/${results.length}`);
  lines.push(`- Native failures: ${nativeFails}`);
  lines.push(`- n8n failures: ${n8nFails}`);
  lines.push("");
  results.forEach((r, idx) => {
    lines.push(`---`);
    lines.push(`## Message ${idx + 1}`);
    lines.push(`- **lead_id:** \`${r.msg.lead_id}\``);
    lines.push(`- **created_at:** \`${r.msg.created_at}\``);
    lines.push(`- **channel:** \`${r.msg.channel}\``);
    lines.push(`- **contact:** ${r.msg.contact_name || "(unknown)"} <${r.msg.contact_email || ""}> ${r.msg.contact_phone || ""}`);
    lines.push("");
    lines.push("### Inbound");
    lines.push("```");
    lines.push(r.msg.message_body || "");
    lines.push("```");
    lines.push("");
    lines.push("### Native (path A)");
    if (r.native.ok) {
      lines.push(`- history rows: ${r.native.history_rows}`);
      lines.push(`- model: \`${r.native.model}\``);
      r.native.messages.forEach((m, i) => {
        lines.push(`- **Message_${i + 1}:**`);
        lines.push("  ```");
        lines.push(`  ${m.replace(/\n/g, "\n  ")}`);
        lines.push("  ```");
      });
    } else {
      lines.push(`**ERROR:** ${r.native.error}`);
    }
    lines.push("");
    lines.push("### n8n (path B)");
    if (r.n8n.ok) {
      r.n8n.messages.forEach((m, i) => {
        lines.push(`- **Message_${i + 1}:**`);
        lines.push("  ```");
        lines.push(`  ${m.replace(/\n/g, "\n  ")}`);
        lines.push("  ```");
      });
    } else {
      lines.push(`**ERROR:** ${r.n8n.error}`);
    }
    lines.push("");
    if (r.native.ok && r.n8n.ok) {
      const a = (r.native.messages || []).join(" ");
      const b = (r.n8n.messages || []).join(" ");
      const j = jaccardOverlap(a, b);
      const flag = j < 0.2 ? " ⚠️ low overlap" : "";
      lines.push(`### Word overlap (Jaccard): \`${j.toFixed(3)}\`${flag}`);
      lines.push("");
    }
  });
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pat = process.env.SUPABASE_PAT;
  if (!pat) die("SUPABASE_PAT env var is required (supply via .env)");
  const projectRef = process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF;
  const clientId = args["client-id"] || BFD_CLIENT_ID;
  const n = parseInt(args.n, 10) || DEFAULT_N;
  const dryRun = !!args["dry-run"];
  const setterNumber = args["setter-number"] || "1";
  const outPath = args.out || resolvePath(
    process.cwd(),
    "..",
    "..",
    "Operations",
    "handoffs",
    `${isoDate()}-bfd-native-vs-n8n-diff.md`,
  );

  console.log(`[diff] client=${clientId} n=${n} dry-run=${dryRun}`);
  console.log(`[diff] out=${outPath}`);

  const client = await fetchClient({ pat, projectRef, clientId });
  console.log(`[diff] resolved client: ${client.name} (ghl_location_id=${client.ghl_location_id}, native=${client.use_native_text_engine})`);

  const inbound = await fetchInboundMessages({ pat, projectRef, ghlLocationId: client.ghl_location_id, n });
  console.log(`[diff] picked ${inbound.length} inbound message(s)`);
  if (inbound.length === 0) die("No inbound messages found in the configured window. Widen --n or relax the WHERE clause.");

  if (dryRun) {
    console.log("\n[dry-run] would diff these messages:\n");
    for (const m of inbound) {
      console.log(`  ${m.created_at} | lead=${m.lead_id} | ${(m.message_body || "").slice(0, 80)}`);
    }
    return;
  }

  const results = [];
  for (const msg of inbound) {
    console.log(`[diff] processing lead=${msg.lead_id} created_at=${msg.created_at}`);
    const [native, n8n] = await Promise.all([
      pathANative({ client, msg, setterNumber }),
      pathBN8n({ client, msg, setterNumber }),
    ]);
    if (!native.ok) console.warn(`  native error: ${native.error}`);
    if (!n8n.ok) console.warn(`  n8n error: ${n8n.error}`);
    results.push({ msg, native, n8n });
  }

  const report = renderReport({ client, n: results.length, results });
  writeFileSync(outPath, report, "utf8");
  console.log(`\n[diff] report written → ${outPath}`);
  console.log(`[diff] summary: native_ok=${results.filter(r => r.native.ok).length}/${results.length} n8n_ok=${results.filter(r => r.n8n.ok).length}/${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
