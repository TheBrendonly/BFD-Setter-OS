#!/usr/bin/env node
// onboard-client.mjs — phase-11h
//
// Automates the SQL portion of SOP/CLIENT_ONBOARDING_SOP.md §3-§5 for a new
// client: INSERT clients row, create the GHL last_synced_from custom field,
// clone the BFD default workflow, and print a follow-up checklist for the
// click-path steps that still require human judgement.
//
// Usage:
//   node --env-file=.env scripts/onboard-client.mjs \
//     --name "Client Display Name" \
//     --agency-id <agency-uuid> \
//     --ghl-location-id <id> \
//     --ghl-pit <pit> \
//     --twilio-sid <sid> \
//     --twilio-token <token> \
//     --twilio-phone <e164> \
//     --default-tz "Australia/Brisbane" \
//     [--retell-api-key <key>] \
//     [--openrouter-key <key>] \
//     [--llm-model <model>]            (default openai/gpt-4.1-nano) \
//     [--subscription-status <status>] (default active) \
//     [--source-workflow-id <uuid>]    (default BFD canonical default) \
//     [--ghl-calendar-id <id>] [--ghl-assignee-id <id>] \
//     [--retell-inbound-agent-id <id>] [--retell-outbound-agent-id <id>] \
//     [--retell-outbound-followup-agent-id <id>] \
//     [--retell-llm-id <id>]           (if set, PATCH voice-booking tool URLs onto it) \
//     [--external-supabase-url <url>] [--external-supabase-service-key <key>] \
//     [--external-supabase-table <name>] \
//     [--dry-run]
//
// Env vars (from .env):
//   SUPABASE_PAT          — Supabase Management API token (sbp_*)
//   SUPABASE_PROJECT_REF  — defaults to bjgrgbgykvjrsuwwruoh (BFD platform)
//
// The script sets subscription_status='active' and llm_model (so the scaffold is
// immediately usable) and will set any optional column passed as a flag above.
// It prints a "REQUIRED MANUAL" checklist of every gating column still unset.
//
// The script ALSO (automated, see steps 5-6 in main):
//   - Sets the Twilio inbound SMS webhook for --twilio-phone → receive-twilio-sms
//   - PATCHes the BFD voice-booking tool URLs onto --retell-llm-id when supplied
//     (rewrites tools already on the LLM; the first UI prompt-push otherwise seeds them)
//
// The script does NOT:
//   - Wire GHL Calendar workflow → bookings-webhook (click-path in §5.2)
//   - Set ghl_webhook_secret / retell_webhook_secret (click-path in §5.3,
//     §5.5 — paste once provider dashboards expose them)
//   - Set auto_engagement_workflow_id (post copy-review step in SOP §6)
//   - Provision the client's external Supabase project (SOP §3.1 — manual)

import { randomBytes } from "node:crypto";

const BFD_DEFAULT_WORKFLOW_ID = "40e8bea3-b6f6-4562-98d1-f7e6599af6a1";
const DEFAULT_PROJECT_REF = "bjgrgbgykvjrsuwwruoh";

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

function genIntakeSecret() {
  return randomBytes(24).toString("base64");
}

function sqlEscapeString(s) {
  if (s == null) return "NULL";
  return `'${String(s).replace(/'/g, "''")}'`;
}

async function runManagementSql({ pat, projectRef, sql, dryRun }) {
  if (dryRun) {
    console.log("\n--- [dry-run] SQL would be executed ---");
    console.log(sql);
    console.log("--- end SQL ---\n");
    return null;
  }
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await r.text();
  if (!r.ok) {
    die(`Management API SQL failed ${r.status}: ${txt.slice(0, 400)}`);
  }
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

async function createGhlCustomField({ pit, locationId, dryRun }) {
  if (dryRun) {
    console.log(`[dry-run] POST https://services.leadconnectorhq.com/locations/${locationId}/customFields`);
    console.log(`[dry-run] body: { name: "last_synced_from", dataType: "TEXT", model: "contact" }`);
    return { id: "<would-be-returned-by-ghl>" };
  }
  const r = await fetch(
    `https://services.leadconnectorhq.com/locations/${locationId}/customFields`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pit}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: "last_synced_from",
        dataType: "TEXT",
        model: "contact",
      }),
    },
  );
  const txt = await r.text();
  if (!r.ok) {
    // 400 with existing-field id means it already exists; surface the id.
    try {
      const j = JSON.parse(txt);
      if (j?.meta?.existingId || j?.customField?.id) {
        const existingId = j?.meta?.existingId ?? j?.customField?.id;
        console.warn(`GHL custom field already exists; using id ${existingId}`);
        return { id: existingId };
      }
    } catch { /* fall through */ }
    die(`GHL custom field create failed ${r.status}: ${txt.slice(0, 400)}`);
  }
  let json;
  try {
    json = JSON.parse(txt);
  } catch {
    die(`GHL custom field create returned non-JSON: ${txt.slice(0, 200)}`);
  }
  const id = json?.customField?.id ?? json?.id;
  if (!id) die(`GHL custom field create returned no id: ${txt.slice(0, 200)}`);
  return { id };
}

// Tool names the BFD voice setter routes through voice-booking-tools. Mirrors
// frontend/supabase/functions/_shared/bfdVoiceTools.ts (can't import a Deno module
// from a Node .mjs — duplicated here, same precedent as backfill_voice_setter_tools.mjs).
const BFD_VOICE_TOOL_NAMES = new Set([
  "get-available-slots",
  "book-appointments", "book-appointment",
  "cancel-appointments", "cancel-appointment",
  "get-contact-appointments",
  "update-appointment",
  "lookup-contact", "lookup_contact",
  "send-sms", "send_sms",
  "schedule-callback", "schedule_callback",
]);

// Sets the Twilio number's inbound SMS webhook to receive-twilio-sms. Replicates
// the twilio-configure-webhook edge function directly (the edge fn needs a user
// JWT; here we already hold the Twilio creds, so no JWT round-trip is needed).
async function configureTwilioWebhook({ sid, token, phone, projectRef, dryRun }) {
  const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/receive-twilio-sms`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  if (dryRun) {
    console.log(`[dry-run] GET  https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${phone}`);
    console.log(`[dry-run] POST .../IncomingPhoneNumbers/<sid>.json  SmsUrl=${webhookUrl}  SmsMethod=POST`);
    return { phoneSid: "<would-be-returned-by-twilio>", webhookUrl };
  }
  const lookupUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`;
  const lookup = await fetch(lookupUrl, { headers: { Authorization: `Basic ${auth}` } });
  const lookupTxt = await lookup.text();
  if (!lookup.ok) die(`Twilio number lookup failed ${lookup.status}: ${lookupTxt.slice(0, 300)}`);
  let phoneSid;
  try {
    phoneSid = JSON.parse(lookupTxt)?.incoming_phone_numbers?.[0]?.sid;
  } catch {
    die(`Twilio number lookup returned non-JSON: ${lookupTxt.slice(0, 200)}`);
  }
  if (!phoneSid) die(`Twilio number ${phone} not found on account ${sid} (cannot set webhook)`);
  const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers/${phoneSid}.json`;
  const update = await fetch(updateUrl, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ SmsUrl: webhookUrl, SmsMethod: "POST" }),
  });
  const updateTxt = await update.text();
  if (!update.ok) die(`Twilio webhook update failed ${update.status}: ${updateTxt.slice(0, 300)}`);
  return { phoneSid, webhookUrl };
}

// Rewrites the BFD voice-booking tool URLs on a Retell LLM to point at this
// client's voice-booking-tools endpoint. Mirrors retell-proxy forceBfdToolUrl:
// only rewrites tools already present on the LLM (does NOT fabricate tool defs).
async function patchRetellToolUrls({ apiKey, llmId, clientId, intakeSecret, projectRef, dryRun }) {
  const toolsUrl = `https://${projectRef}.supabase.co/functions/v1/voice-booking-tools`;
  if (dryRun) {
    console.log(`[dry-run] GET   https://api.retellai.com/get-retell-llm/${llmId}`);
    console.log(`[dry-run] would rewrite any of these tools present on the LLM to:`);
    console.log(`[dry-run]   ${toolsUrl}?tool=<name>&clientId=${clientId}  (Authorization: Bearer <intake_lead_secret>)`);
    console.log(`[dry-run]   tools: ${[...BFD_VOICE_TOOL_NAMES].join(", ")}`);
    console.log(`[dry-run] PATCH https://api.retellai.com/update-retell-llm/${llmId}  { general_tools: [...rewritten] }`);
    return { rewritten: -1 };
  }
  const get = await fetch(`https://api.retellai.com/get-retell-llm/${llmId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const getTxt = await get.text();
  if (!get.ok) die(`Retell get-retell-llm failed ${get.status}: ${getTxt.slice(0, 300)}`);
  let llm;
  try { llm = JSON.parse(getTxt); } catch { die(`Retell get-retell-llm returned non-JSON: ${getTxt.slice(0, 200)}`); }
  const tools = Array.isArray(llm?.general_tools) ? llm.general_tools : [];
  let rewritten = 0;
  const patched = tools.map((t) => {
    const name = typeof t?.name === "string" ? t.name.trim() : "";
    if (!BFD_VOICE_TOOL_NAMES.has(name)) return t;
    rewritten++;
    return {
      ...t,
      name,
      url: toolsUrl,
      query_params: { tool: name, clientId },
      headers: intakeSecret ? { Authorization: `Bearer ${intakeSecret}` } : {},
    };
  });
  if (rewritten === 0) {
    console.warn(`  ! no BFD voice tools found on LLM ${llmId}; nothing rewritten. The first prompt-push from the BFD setter UI will seed them.`);
    return { rewritten: 0 };
  }
  const patch = await fetch(`https://api.retellai.com/update-retell-llm/${llmId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ general_tools: patched }),
  });
  const patchTxt = await patch.text();
  if (!patch.ok) {
    // A published LLM version is immutable in Retell; surface guidance rather than abort onboarding.
    console.warn(`  ! Retell update-retell-llm failed ${patch.status}: ${patchTxt.slice(0, 300)}`);
    console.warn(`  ! If this is a published/immutable version, push the setter via the BFD UI instead (it handles the editable-draft flow).`);
    return { rewritten, patched: false };
  }
  return { rewritten, patched: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args["dry-run"];

  const required = [
    "name",
    "agency-id",
    "ghl-location-id",
    "ghl-pit",
    "twilio-sid",
    "twilio-token",
    "twilio-phone",
    "default-tz",
  ];
  const missing = required.filter((k) => !args[k] || typeof args[k] !== "string");
  if (missing.length) {
    die(`Missing required flags: ${missing.map((m) => "--" + m).join(", ")}`);
  }

  const pat = process.env.SUPABASE_PAT;
  if (!pat) die("SUPABASE_PAT env var is required (set in .env)");
  const projectRef = process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF;

  const intakeSecret = genIntakeSecret();
  const tz = args["default-tz"];
  const cadenceQH = JSON.stringify({
    start: "09:00",
    end: "21:00",
    tz,
    days: [1, 2, 3, 4, 5],
  });
  const retellApiKey = args["retell-api-key"] || null;
  const openrouterKey = args["openrouter-key"] || null;
  // llm_model is nullable with no DB default; match the SOP default unless overridden.
  const llmModel = (typeof args["llm-model"] === "string" && args["llm-model"].trim())
    ? args["llm-model"].trim()
    : "openai/gpt-4.1-nano";
  // CRITICAL: without subscription_status the DB default is 'free', which gates
  // the client OUT of every feature. Default to 'active' so the scaffold is usable.
  const subscriptionStatus = (typeof args["subscription-status"] === "string" && args["subscription-status"].trim())
    ? args["subscription-status"].trim()
    : "active";
  const sourceWorkflowId = (typeof args["source-workflow-id"] === "string" && args["source-workflow-id"].trim())
    ? args["source-workflow-id"].trim()
    : BFD_DEFAULT_WORKFLOW_ID;

  // Optional columns — included in the INSERT only when supplied via a flag.
  // Anything left unset must be filled in afterwards (see the REQUIRED MANUAL
  // block printed at the end).
  const optionalCols = [
    ["ghl_calendar_id", args["ghl-calendar-id"]],
    ["ghl_assignee_id", args["ghl-assignee-id"]],
    ["retell_api_key", retellApiKey],
    ["openrouter_api_key", openrouterKey],
    ["retell_inbound_agent_id", args["retell-inbound-agent-id"]],
    ["retell_outbound_agent_id", args["retell-outbound-agent-id"]],
    ["retell_outbound_followup_agent_id", args["retell-outbound-followup-agent-id"]],
    ["supabase_url", args["external-supabase-url"]],
    ["supabase_service_key", args["external-supabase-service-key"]],
    ["supabase_table_name", args["external-supabase-table"]],
  ].filter(([, v]) => typeof v === "string" && v.trim());
  const optionalColSql = optionalCols.map(([c]) => `  ${c},`).join("\n");
  const optionalValSql = optionalCols.map(([, v]) => `  ${sqlEscapeString(v)},`).join("\n");

  // 1. INSERT clients row.
  const insertSql = `
INSERT INTO public.clients (
  id, agency_id, name,
  ghl_location_id, ghl_api_key,
  twilio_account_sid, twilio_auth_token, twilio_default_phone, retell_phone_1,
${optionalColSql}
  llm_model,
  subscription_status,
  cadence_quiet_hours,
  intake_lead_secret,
  use_native_text_engine,
  dm_enabled,
  created_at
)
VALUES (
  gen_random_uuid(),
  ${sqlEscapeString(args["agency-id"])},
  ${sqlEscapeString(args["name"])},
  ${sqlEscapeString(args["ghl-location-id"])},
  ${sqlEscapeString(args["ghl-pit"])},
  ${sqlEscapeString(args["twilio-sid"])},
  ${sqlEscapeString(args["twilio-token"])},
  ${sqlEscapeString(args["twilio-phone"])},
  ${sqlEscapeString(args["twilio-phone"])},
${optionalValSql}
  ${sqlEscapeString(llmModel)},
  ${sqlEscapeString(subscriptionStatus)},
  ${sqlEscapeString(cadenceQH)}::jsonb,
  ${sqlEscapeString(intakeSecret)},
  true,
  false,
  now()
)
RETURNING id, name;
`.trim();

  console.log(`▶ Creating clients row for "${args["name"]}"...`);
  const insertResult = await runManagementSql({ pat, projectRef, sql: insertSql, dryRun });
  const newClientId = dryRun ? "<would-be-returned>" : insertResult?.[0]?.id;
  if (!dryRun && !newClientId) {
    die(`clients INSERT did not return id. raw: ${JSON.stringify(insertResult).slice(0, 300)}`);
  }
  console.log(`  ✓ client id: ${newClientId}`);

  // 2. Create GHL last_synced_from custom field.
  console.log(`▶ Creating GHL custom field 'last_synced_from'...`);
  const { id: fieldId } = await createGhlCustomField({
    pit: args["ghl-pit"],
    locationId: args["ghl-location-id"],
    dryRun,
  });
  console.log(`  ✓ field id: ${fieldId}`);

  // 3. UPDATE clients with the field id.
  const updateFieldSql = `
UPDATE public.clients
  SET ghl_last_synced_from_field_id = ${sqlEscapeString(fieldId)}
WHERE id = ${dryRun ? "'<new-client-id>'" : sqlEscapeString(newClientId)};
`.trim();
  console.log(`▶ Storing custom field id on clients row...`);
  await runManagementSql({ pat, projectRef, sql: updateFieldSql, dryRun });
  console.log(`  ✓ ghl_last_synced_from_field_id set`);

  // 4. Clone BFD default workflow.
  const cloneSql = `
INSERT INTO public.engagement_workflows (id, client_id, name, nodes, is_active, created_at)
SELECT
  gen_random_uuid(),
  ${dryRun ? "'<new-client-id>'" : sqlEscapeString(newClientId)},
  'Default new-lead cadence',
  nodes,
  false,
  now()
FROM public.engagement_workflows
WHERE id = ${sqlEscapeString(sourceWorkflowId)}
RETURNING id;
`.trim();
  console.log(`▶ Cloning BFD default workflow...`);
  const cloneResult = await runManagementSql({ pat, projectRef, sql: cloneSql, dryRun });
  const newWorkflowId = dryRun ? "<would-be-returned>" : cloneResult?.[0]?.id;
  if (!dryRun && !newWorkflowId) {
    die(`workflow clone did not return id. raw: ${JSON.stringify(cloneResult).slice(0, 300)}`);
  }
  console.log(`  ✓ cloned workflow id: ${newWorkflowId}`);

  // 5. Configure the Twilio inbound SMS webhook for the provisioned number.
  console.log(`▶ Configuring Twilio inbound webhook for ${args["twilio-phone"]}...`);
  const twilioResult = await configureTwilioWebhook({
    sid: args["twilio-sid"],
    token: args["twilio-token"],
    phone: args["twilio-phone"],
    projectRef,
    dryRun,
  });
  console.log(`  ✓ SmsUrl → ${twilioResult.webhookUrl} (number sid ${twilioResult.phoneSid})`);

  // 6. PATCH the BFD voice-booking tool URLs onto a Retell LLM (only if one is given).
  const retellLlmId = (typeof args["retell-llm-id"] === "string" && args["retell-llm-id"].trim())
    ? args["retell-llm-id"].trim()
    : null;
  if (retellLlmId && !retellApiKey) {
    console.warn(`  ! --retell-llm-id given but --retell-api-key missing; skipping Retell tool wiring.`);
  } else if (retellLlmId) {
    console.log(`▶ Wiring Retell voice-booking tool URLs on LLM ${retellLlmId}...`);
    const r = await patchRetellToolUrls({
      apiKey: retellApiKey,
      llmId: retellLlmId,
      clientId: dryRun ? "<new-client-id>" : newClientId,
      intakeSecret,
      projectRef,
      dryRun,
    });
    if (!dryRun && r.patched) console.log(`  ✓ rewrote ${r.rewritten} tool URL(s)`);
  } else {
    console.log(`▶ Skipping Retell tool wiring (no --retell-llm-id). retell-proxy seeds these on the first UI prompt-push.`);
  }

  // 7. Print the follow-up checklist.
  console.log(`\n${"=".repeat(72)}`);
  console.log("ONBOARDING SCAFFOLD COMPLETE — manual follow-ups remaining:");
  console.log("=".repeat(72));
  console.log("\nClient values to record (these are the only outputs you can't get back):");
  console.log(`  client_id: ${newClientId}`);
  console.log(`  intake_lead_secret: ${intakeSecret}`);
  console.log(`  cloned_workflow_id: ${newWorkflowId}`);
  console.log(`  ghl_last_synced_from_field_id: ${fieldId}`);
  console.log("");

  // REQUIRED MANUAL — columns that gate features and are NOT (or only partially)
  // set by this scaffold. Anything still [TODO] must be filled in before go-live.
  const providedCols = new Set(optionalCols.map(([c]) => c));
  const gatingCols = [
    "ghl_calendar_id", "ghl_assignee_id",
    "supabase_url", "supabase_service_key", "supabase_table_name",
    "retell_inbound_agent_id", "retell_outbound_agent_id", "retell_outbound_followup_agent_id",
    "retell_agent_id_4..10 (voice setter slots, as needed)",
    "voicemail_config (set via Sub-Account Settings UI)",
    "ghl_channel_field_id",
    "ghl_webhook_secret", "retell_webhook_secret", "unipile_webhook_secret",
    "auto_engagement_workflow_id (set at go-live, §8.1)",
  ];
  console.log("!".repeat(72));
  console.log("REQUIRED MANUAL — set these before go-live (UPDATE public.clients ...):");
  console.log("!".repeat(72));
  console.log(`  [set]  subscription_status = '${subscriptionStatus}'  (this scaffold)`);
  console.log(`  [set]  llm_model           = '${llmModel}'  (this scaffold)`);
  for (const col of gatingCols) {
    const baseName = col.split(" ")[0].split("..")[0];
    const done = providedCols.has(baseName);
    console.log(`  ${done ? "[set] " : "[TODO]"} ${col}`);
  }
  console.log("");

  console.log("Click-path follow-ups (see SOP/CLIENT_ONBOARDING_SOP.md):");
  console.log("");
  console.log("§3.1  Provision external Supabase project + run seed SQL.");
  console.log("§5.1  Configure GHL 'Send Setter Reply' workflow (or skip if");
  console.log("      use_native_text_engine = true, which is set by default).");
  console.log("§5.2  Wire GHL Calendar webhook → bookings-webhook (URL:");
  console.log("        https://bjgrgbgykvjrsuwwruoh.supabase.co/functions/v1/bookings-webhook).");
  console.log("§5.3  GHL Webhook V2 → paste secret into clients.ghl_webhook_secret.");
  console.log(retellLlmId
    ? "§5.4  Retell custom-tool URLs → AUTOMATED above (--retell-llm-id). Re-run / push via UI if the LLM had no tools yet."
    : "§5.4  Repoint Retell custom-tool URLs: pass --retell-llm-id to automate, or push the setter via the BFD UI.");
  console.log("§5.5  Retell webhook signing secret → clients.retell_webhook_secret.");
  console.log("§5.8  Provide intake-lead embed snippet (template in SOP).");
  console.log("        Replace <client-uuid> + <intake_lead_secret> with values above.");
  console.log("§5.9  Twilio inbound SMS webhook → AUTOMATED above for --twilio-phone (receive-twilio-sms).");
  console.log("§5.10 (Optional) GHL workflow on tag-add → ghl-tag-webhook for tag-based");
  console.log("        auto-enrol. Flip the NEW LEADS toggle in the Workflows UI first.");
  console.log("§6    Cadence copy review with the client. Replace [BRENDAN: …] placeholders.");
  console.log("§8.1  Once copy is approved + dry-run is clean:");
  console.log(`        UPDATE public.clients SET auto_engagement_workflow_id = ${sqlEscapeString(newWorkflowId)},`);
  console.log(`               dm_enabled = true WHERE id = ${sqlEscapeString(newClientId)};`);
  console.log("");
  if (dryRun) {
    console.log("[dry-run] No SQL or GHL writes were executed.");
  }
  console.log("=".repeat(72));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
