// F8 trap proof — the mandatory "a client-role token cannot read the markup/cost
// inputs" gate. RUN LIVE after the migration is applied + get-blended-rate is
// deployed:  deno run --allow-net --allow-env --env-file=.env scripts/f8_trap_proof.ts
//
// It provisions a throwaway CLIENT-role user and a throwaway AGENCY-role user on
// the existing BFD client (Session-7 B-4 precedent), sets a high-markup pricing
// row with the toggle ON, mints REAL JWTs via signInWithPassword (a forged token
// would be rejected by auth.getUser), and asserts the boundary holds. Cleans up
// every throwaway artifact at the end. Exits non-zero on any failure.

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

async function callFn(jwt: string, clientId: string) {
  const res = await fetch(`${URL}/functions/v1/get-blended-rate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: ANON,
      "content-type": "application/json",
    },
    body: JSON.stringify({ client_id: clientId }),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, json, text };
}

const FORBIDDEN = ["markup", "rate_table", "fx", "components", "fixed", "lineItems", "subtotal", "micros"];

const HIGH_MARKUP_CONFIG = {
  display_currency: "AUD",
  fx_usd_to_display_micros: 1_520_000,
  fx_buffer_bps: 0,
  markup_bps: 10_000, // 100%
  show_rate_to_client: true,
  components: {
    retell: { enabled: true, currency: "USD", unit: "per_minute", rate_micros: 70_000 },
  },
};

let clientUserId: string | null = null;
let agencyUserId: string | null = null;
let pricingRowExisted = false;

async function makeUser(email: string, password: string, agencyId: string, clientId: string | null, role: string) {
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  const id = data.user.id;
  // profiles may be auto-created by a signup trigger; upsert the fields resolveClientAccess reads.
  const profile: Record<string, unknown> = { id, agency_id: agencyId };
  if (clientId) profile.client_id = clientId;
  const { error: pErr } = await svc.from("profiles").upsert(profile, { onConflict: "id" });
  if (pErr) throw new Error(`profiles upsert ${email}: ${pErr.message}`);
  // user_roles: ensure exactly this role.
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

try {
  const { data: clientRow, error: cErr } = await svc
    .from("clients").select("agency_id").eq("id", BFD_CLIENT_ID).single();
  if (cErr || !clientRow) throw new Error(`load BFD client: ${cErr?.message}`);
  const agencyId = clientRow.agency_id as string;

  // A real OTHER client (any existing id != BFD) for the cross-tenant 403 test.
  // A non-existent id would 404 (not found) before the 403 ownership check fires.
  const { data: otherClient } = await svc.from("clients").select("id").neq("id", BFD_CLIENT_ID).limit(1).maybeSingle();
  const otherClientId = (otherClient?.id as string) ?? "00000000-0000-0000-0000-000000000000";

  // Remember whether a real pricing row pre-existed (so cleanup is correct).
  const { data: pre } = await svc.from("client_pricing_config").select("id").eq("client_id", BFD_CLIENT_ID).maybeSingle();
  pricingRowExisted = !!pre;
  if (pricingRowExisted) {
    throw new Error("BFD client already has a client_pricing_config row — refusing to clobber it. Run against a throwaway client instead.");
  }

  const stamp = `${Math.floor(Date.now() / 1000)}`;
  const clientEmail = `f8proof-client-${stamp}@example.invalid`;
  const agencyEmail = `f8proof-agency-${stamp}@example.invalid`;
  const pw = `F8proof!${stamp}aZ`;

  clientUserId = await makeUser(clientEmail, pw, agencyId, BFD_CLIENT_ID, "client");
  agencyUserId = await makeUser(agencyEmail, pw, agencyId, null, "agency");

  await svc.from("client_pricing_config").upsert(
    { client_id: BFD_CLIENT_ID, config: HIGH_MARKUP_CONFIG },
    { onConflict: "client_id" },
  );

  const clientJwt = await signIn(clientEmail, pw);
  const agencyJwt = await signIn(agencyEmail, pw);
  const clientDb = createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${clientJwt}` } },
  });

  // (i) client edge call -> ONLY the scalar trio, zero forbidden bytes.
  const r1 = await callFn(clientJwt, BFD_CLIENT_ID);
  const r1obj = (r1.json ?? {}) as Record<string, unknown>;
  const keys = Object.keys(r1obj).sort().join(",");
  check("(i) client get-blended-rate returns only {blended_per_min_minor,display_currency,show}",
    r1.status === 200 && keys === "blended_per_min_minor,display_currency,show" && r1obj.show === true,
    `status=${r1.status} keys=${keys}`);
  const leaked = FORBIDDEN.filter((n) => r1.text.includes(n));
  check("(i) client response leaks ZERO markup/cost bytes", leaked.length === 0, `leaked=${JSON.stringify(leaked)}`);

  // (ii) direct table read -> 0 rows / denied.
  const r2 = await clientDb.from("client_pricing_config").select("*").eq("client_id", BFD_CLIENT_ID);
  check("(ii) client direct client_pricing_config.select('*') returns 0 rows", (r2.data?.length ?? 0) === 0,
    `rows=${r2.data?.length ?? 0} err=${r2.error?.message ?? "none"}`);

  // (iii) clients_public has no markup/fx/rate_table column.
  const r3 = await clientDb.from("clients_public").select("*").eq("id", BFD_CLIENT_ID).maybeSingle();
  const r3keys = Object.keys((r3.data ?? {}) as Record<string, unknown>);
  const badCols = r3keys.filter((k) => /markup|rate_table|fx/i.test(k));
  check("(iii) clients_public exposes no markup/fx/rate_table column", badCols.length === 0, `bad=${JSON.stringify(badCols)}`);

  // (iv) toggle OFF (agency write) -> {show:false}.
  await svc.from("client_pricing_config").upsert(
    { client_id: BFD_CLIENT_ID, config: { ...HIGH_MARKUP_CONFIG, show_rate_to_client: false } },
    { onConflict: "client_id" });
  const r4 = await callFn(clientJwt, BFD_CLIENT_ID);
  check("(iv) toggle OFF -> client gets {show:false}",
    JSON.stringify(r4.json) === JSON.stringify({ show: false }), JSON.stringify(r4.json));

  // (v) toggle ON -> still only the scalar.
  await svc.from("client_pricing_config").upsert(
    { client_id: BFD_CLIENT_ID, config: HIGH_MARKUP_CONFIG }, { onConflict: "client_id" });
  const r5 = await callFn(clientJwt, BFD_CLIENT_ID);
  const r5obj = (r5.json ?? {}) as Record<string, unknown>;
  check("(v) toggle ON -> still only the scalar",
    Object.keys(r5obj).sort().join(",") === "blended_per_min_minor,display_currency,show",
    Object.keys(r5obj).join(","));

  // (vi) client direct PATCH of the table -> denied; markup unchanged.
  await clientDb.from("client_pricing_config")
    .update({ config: { ...HIGH_MARKUP_CONFIG, markup_bps: 1 } }).eq("client_id", BFD_CLIENT_ID);
  const { data: after } = await svc.from("client_pricing_config").select("config").eq("client_id", BFD_CLIENT_ID).single();
  check("(vi) client PATCH dropped server-side (markup unchanged)",
    (after?.config as Record<string, unknown>)?.markup_bps === 10_000,
    `markup_bps=${(after?.config as Record<string, unknown>)?.markup_bps}`);

  // (vii) agency JWT -> full breakdown.
  const r7 = await callFn(agencyJwt, BFD_CLIENT_ID);
  const r7obj = (r7.json ?? {}) as Record<string, unknown>;
  check("(vii) agency token -> full breakdown (markup + rate_table present)",
    r7.status === 200 && "markup_bps" in r7obj && "rate_table" in r7obj,
    `keys=${Object.keys(r7obj).join(",")}`);

  // (viii) cross-tenant: client requests a non-owned EXISTING client_id -> 403.
  const r8 = await callFn(clientJwt, otherClientId);
  check("(viii) client requesting a non-owned existing client_id -> 403", r8.status === 403, `otherId=${otherClientId} status=${r8.status}`);
} catch (err) {
  check("harness ran without throwing", false, err instanceof Error ? err.message : String(err));
} finally {
  // Cleanup — delete the throwaway pricing row + users.
  if (!pricingRowExisted) {
    await svc.from("client_pricing_config").delete().eq("client_id", BFD_CLIENT_ID);
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
  console.log("F8 TRAP PROOF: ALL PASS");
}
