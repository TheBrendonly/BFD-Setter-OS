// F13 trap proof — the mandatory "a client-role token cannot read margin /
// actual provider cost, and sees ONLY the admin-toggled parts" gate. RUN LIVE
// after get-client-usage is deployed:
//   deno run --allow-net --allow-env --env-file=.env scripts/f13_usage_trap_proof.ts
//
// Sibling of scripts/f8_trap_proof.ts with two deltas: (a) a real
// client_pricing_config row now exists for the BFD client, so it is
// SNAPSHOT-AND-RESTORED instead of refused; (b) it seeds throwaway usage (2
// call_history rows + 2 message_queue rows, deleted in finally) and asserts
// usage DELTAS so real live usage on the client cannot break the assertions.
// Exits non-zero on any failure.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BFD_CLIENT_ID = Deno.env.get("BFD_CLIENT_ID")!;

const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function callUsage(jwt: string, clientId: string, offset = 0) {
  const res = await fetch(`${URL}/functions/v1/get-client-usage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: ANON,
      "content-type": "application/json",
    },
    body: JSON.stringify({ client_id: clientId, period_offset: offset }),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, json, text };
}

// Substrings that must NEVER appear in a client-role usage response.
const FORBIDDEN = [
  "margin", "actual", "cost", "markup", "fx", "micros", "rate_table",
  "usd_", "components", "lineItems", "bps", "billed",
];

const CONFIG_ALL_ON = {
  display_currency: "AUD",
  fx_usd_to_display_micros: 1_500_000,
  fx_buffer_bps: 0,
  markup_bps: 10_000, // 100%
  show_rate_to_client: true,
  billing_anchor_day: 1,
  client_display: { show_rate: true, show_minutes: true, show_texts: true, show_total: true },
  components: {
    retell: { enabled: true, currency: "USD", unit: "per_minute", rate_micros: 70_000 },
    sms_llm: { enabled: true, currency: "USD", unit: "per_message", rate_micros: 3_000 },
  },
};
const CONFIG_ALL_OFF = {
  ...CONFIG_ALL_ON,
  show_rate_to_client: false,
  client_display: { show_rate: false, show_minutes: false, show_texts: false, show_total: false },
};

let clientUserId: string | null = null;
let agencyUserId: string | null = null;
let savedConfig: unknown = null;
let pricingRowExisted = false;
let seededUsage = false;

async function makeUser(email: string, password: string, agencyId: string, clientId: string | null, role: string) {
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  const id = data.user.id;
  const profile: Record<string, unknown> = { id, agency_id: agencyId };
  if (clientId) profile.client_id = clientId;
  const { error: pErr } = await svc.from("profiles").upsert(profile, { onConflict: "id" });
  if (pErr) throw new Error(`profiles upsert ${email}: ${pErr.message}`);
  await svc.from("user_roles").delete().eq("user_id", id);
  const { error: rErr } = await svc.from("user_roles").insert({ user_id: id, role });
  if (rErr) throw new Error(`user_roles insert ${email}: ${rErr.message}`);
  return id;
}

async function signIn(email: string, password: string) {
  const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`signIn ${email}: ${error?.message}`);
  return data.session.access_token;
}

async function setConfig(config: unknown) {
  const { error } = await svc.from("client_pricing_config").upsert(
    { client_id: BFD_CLIENT_ID, config },
    { onConflict: "client_id" },
  );
  if (error) throw new Error(`set pricing config: ${error.message}`);
}

try {
  const { data: clientRow, error: cErr } = await svc
    .from("clients").select("agency_id, ghl_location_id").eq("id", BFD_CLIENT_ID).single();
  if (cErr || !clientRow) throw new Error(`load BFD client: ${cErr?.message}`);
  const agencyId = clientRow.agency_id as string;
  const ghlKey = (clientRow.ghl_location_id as string | null) ?? BFD_CLIENT_ID;

  const { data: otherClient } = await svc.from("clients").select("id").neq("id", BFD_CLIENT_ID).limit(1).maybeSingle();
  const otherClientId = (otherClient?.id as string) ?? "00000000-0000-0000-0000-000000000000";

  // SNAPSHOT the real pricing row (a live one exists post-F8) for restore.
  const { data: pre } = await svc.from("client_pricing_config").select("config").eq("client_id", BFD_CLIENT_ID).maybeSingle();
  pricingRowExisted = !!pre;
  savedConfig = pre?.config ?? null;

  const stamp = `${Math.floor(Date.now() / 1000)}`;
  const clientEmail = `f13proof-client-${stamp}@example.invalid`;
  const agencyEmail = `f13proof-agency-${stamp}@example.invalid`;
  const pw = `F13proof!${stamp}aZ`;

  clientUserId = await makeUser(clientEmail, pw, agencyId, BFD_CLIENT_ID, "client");
  agencyUserId = await makeUser(agencyEmail, pw, agencyId, null, "agency");
  const clientJwt = await signIn(clientEmail, pw);
  const agencyJwt = await signIn(agencyEmail, pw);

  await setConfig(CONFIG_ALL_ON);

  // BASELINE (before seeding) — agency view of the current + previous periods.
  const base = await callUsage(agencyJwt, BFD_CLIENT_ID, 0);
  const baseObj = (base.json ?? {}) as Record<string, any>;
  if (base.status !== 200 || baseObj.role !== "agency") {
    throw new Error(`baseline agency call failed: status=${base.status} body=${base.text}`);
  }
  const basePrev = await callUsage(agencyJwt, BFD_CLIENT_ID, -1);
  const basePrevObj = (basePrev.json ?? {}) as Record<string, any>;

  // SEED throwaway usage: 61s + 30s calls (ceil = 2 + 1 = 3 minutes) and 2 texts.
  const nowIso = new Date().toISOString();
  const { error: chErr } = await svc.from("call_history").insert([
    {
      client_id: BFD_CLIENT_ID,
      call_id: `f13proof-${stamp}-1`,
      duration_ms: 61_000,
      duration_seconds: 61,
      cost: 0.10,
      direction: "outbound",
      created_at: nowIso,
    },
    {
      client_id: BFD_CLIENT_ID,
      call_id: `f13proof-${stamp}-2`,
      duration_ms: 30_000,
      duration_seconds: 30,
      cost: 0.05,
      direction: "outbound",
      created_at: nowIso,
    },
  ]);
  if (chErr) throw new Error(`seed call_history: ${chErr.message}`);
  const { error: mqErr } = await svc.from("message_queue").insert([
    {
      lead_id: `f13proof-${stamp}`,
      ghl_account_id: ghlKey,
      message_body: "f13 trap proof",
      channel: "sms_outbound",
      twilio_message_sid: `F13PROOF_${stamp}_1`,
      processed: true,
    },
    {
      lead_id: `f13proof-${stamp}`,
      ghl_account_id: ghlKey,
      message_body: "f13 trap proof",
      channel: "sms_outbound",
      twilio_message_sid: `F13PROOF_${stamp}_2`,
      processed: true,
    },
  ]);
  if (mqErr) throw new Error(`seed message_queue: ${mqErr.message}`);
  seededUsage = true;

  // (i) all toggles OFF -> client gets exactly {show:false}.
  await setConfig(CONFIG_ALL_OFF);
  const r1 = await callUsage(clientJwt, BFD_CLIENT_ID);
  check("(i) all display toggles off -> client gets exactly {show:false}",
    r1.status === 200 && JSON.stringify(r1.json) === JSON.stringify({ show: false }),
    `status=${r1.status} body=${r1.text}`);

  // (ii) all toggles ON -> exact whitelisted key set + the seeded usage deltas.
  await setConfig(CONFIG_ALL_ON);
  const r2 = await callUsage(clientJwt, BFD_CLIENT_ID);
  const r2obj = (r2.json ?? {}) as Record<string, any>;
  const keys = Object.keys(r2obj).sort().join(",");
  check("(ii) toggles on -> exact client key set",
    r2.status === 200 &&
      keys === "display_currency,fixed_monthly_minor,minutes,period,rate_per_min_minor,show,texts,total_minor",
    `status=${r2.status} keys=${keys}`);
  const agencyAfter = await callUsage(agencyJwt, BFD_CLIENT_ID, 0);
  const aaObj = (agencyAfter.json ?? {}) as Record<string, any>;
  const minutesDelta = (aaObj.voice?.billable_minutes ?? -999) - (baseObj.voice?.billable_minutes ?? 0);
  const textsDelta = (aaObj.sms?.outbound_texts ?? -999) - (baseObj.sms?.outbound_texts ?? 0);
  check("(ii) seeded usage metered: +3 billable minutes (61s->2, 30s->1) and +2 texts",
    minutesDelta === 3 && textsDelta === 2,
    `minutesDelta=${minutesDelta} textsDelta=${textsDelta}`);
  check("(ii) client sees the same minute/text figures the agency does",
    r2obj.minutes === aaObj.voice?.billable_minutes && r2obj.texts === aaObj.sms?.outbound_texts,
    `client=${r2obj.minutes}/${r2obj.texts} agency=${aaObj.voice?.billable_minutes}/${aaObj.sms?.outbound_texts}`);

  // (iii) client response contains ZERO forbidden substrings.
  const leaked = FORBIDDEN.filter((n) => r2.text.toLowerCase().includes(n.toLowerCase()));
  check("(iii) client response leaks ZERO margin/cost/markup bytes",
    leaked.length === 0, `leaked=${JSON.stringify(leaked)}`);

  // (iv) single-toggle isolation: only show_minutes on -> only minutes appears.
  await setConfig({
    ...CONFIG_ALL_ON,
    show_rate_to_client: false,
    client_display: { show_rate: false, show_minutes: true, show_texts: false, show_total: false },
  });
  const r4 = await callUsage(clientJwt, BFD_CLIENT_ID);
  const r4keys = Object.keys((r4.json ?? {}) as Record<string, unknown>).sort().join(",");
  check("(iv) only show_minutes on -> only minutes (+period/currency/show)",
    r4keys === "display_currency,minutes,period,show",
    `keys=${r4keys}`);

  // (v) agency gets the margin/actual-cost view.
  await setConfig(CONFIG_ALL_ON);
  const r5 = await callUsage(agencyJwt, BFD_CLIENT_ID);
  const r5obj = (r5.json ?? {}) as Record<string, any>;
  check("(v) agency token -> margin + actual cost + client_display present",
    r5.status === 200 && r5obj.totals?.margin_minor !== undefined &&
      r5obj.totals?.actual_cost_minor !== undefined && r5obj.client_display !== undefined,
    `status=${r5.status} keys=${Object.keys(r5obj).join(",")}`);

  // (vi) cross-tenant: client requests a non-owned EXISTING client_id -> 403.
  const r6 = await callUsage(clientJwt, otherClientId);
  check("(vi) client requesting a non-owned existing client_id -> 403",
    r6.status === 403, `otherId=${otherClientId} status=${r6.status}`);

  // (vii) previous period unchanged by the seed (seeded rows are in the current period).
  const prevAfter = await callUsage(agencyJwt, BFD_CLIENT_ID, -1);
  const paObj = (prevAfter.json ?? {}) as Record<string, any>;
  check("(vii) period_offset -1 window untouched by the seeded usage",
    paObj.voice?.billable_minutes === (basePrevObj.voice?.billable_minutes ?? 0) &&
      paObj.sms?.outbound_texts === (basePrevObj.sms?.outbound_texts ?? 0),
    `prev before=${basePrevObj.voice?.billable_minutes}/${basePrevObj.sms?.outbound_texts} after=${paObj.voice?.billable_minutes}/${paObj.sms?.outbound_texts}`);
} catch (err) {
  check("harness ran without throwing", false, err instanceof Error ? err.message : String(err));
} finally {
  // Cleanup — restore the real pricing row, delete seeded usage + throwaway users.
  if (pricingRowExisted && savedConfig !== null) {
    await svc.from("client_pricing_config").upsert(
      { client_id: BFD_CLIENT_ID, config: savedConfig },
      { onConflict: "client_id" },
    );
  } else if (!pricingRowExisted) {
    await svc.from("client_pricing_config").delete().eq("client_id", BFD_CLIENT_ID);
  }
  if (seededUsage) {
    await svc.from("call_history").delete().like("call_id", "f13proof-%");
    await svc.from("message_queue").delete().like("twilio_message_sid", "F13PROOF_%");
  }
  for (const id of [clientUserId, agencyUserId]) {
    if (!id) continue;
    await svc.from("user_roles").delete().eq("user_id", id);
    await svc.from("profiles").delete().eq("id", id);
    await svc.auth.admin.deleteUser(id);
  }
  console.log("cleanup done");
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log("FAILED:", failed.map((f) => f.name).join("; "));
    Deno.exit(1);
  }
  console.log("F13 TRAP PROOF: ALL PASS");
}
