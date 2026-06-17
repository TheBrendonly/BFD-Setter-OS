// save-account-settings
//
// Single chokepoint for a CLIENT-role user to read + write the admin-governed
// subset of their own sub-account (clients row) from the "My Account" page.
//
// Why an edge function instead of RLS: the clients table holds tenant secrets
// (twilio/ghl/supabase keys) and per-field governance cannot be expressed in
// row-level RLS. This function runs as service-role and re-derives the editable
// allow-set server-side from client_account_field_config, so the frontend
// `editable` flag is advisory only — a tampering client cannot write a
// non-editable or secret column, nor read a hidden field's value.
//
// Actions:
//   { action: "read", client_id }              -> { values, fields }
//   { action: "save", client_id, patch: {...} } -> { success, updated }
//
// Auth: assertClientAccess / resolveClientAccess (JWT signature + ownership).
// Accepts both client (own row) and agency (their client) callers.

import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { resolveClientAccess, AssertAccessError } from "../_shared/assert-client-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// IANA timezones offered by the UI (mirror of ClientSettings.tsx timezone Select).
const ALLOWED_TIMEZONES = new Set([
  "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Adelaide",
  "Australia/Perth", "Australia/Darwin", "Australia/Hobart", "Pacific/Auckland",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Asia/Singapore", "Asia/Tokyo", "Asia/Dubai", "UTC",
]);

// Field catalog: maps a governance KEY -> the real clients column + value type.
// MUST stay in sync with the frontend DEFAULT_ACCOUNT_FIELDS / catalog in
// frontend/src/hooks/useClientAccountFieldConfig.ts (key list is the contract).
const FIELD_CATALOG: Record<string, { column: string; type: string }> = {
  name: { column: "name", type: "text_required" },
  email: { column: "email", type: "text_nullable" },
  description: { column: "description", type: "text_nullable" },
  brand_voice: { column: "brand_voice", type: "text_nullable" },
  timezone: { column: "timezone", type: "timezone" },
  logo: { column: "image_url", type: "text_nullable" },
  quiet_hours: { column: "cadence_quiet_hours", type: "quiet_hours" },
  voicemail: { column: "voicemail_config", type: "voicemail" },
  weekly_cost_ceiling: { column: "weekly_cost_ceiling_cents", type: "cents" },
  monthly_cost_ceiling: { column: "monthly_cost_ceiling_cents", type: "cents" },
};

// Server-side default split (Branding + prefs). Mirrors the frontend default.
const DEFAULT_ACCOUNT_FIELDS = [
  { key: "email", visible: true, editable: true },
  { key: "description", visible: true, editable: true },
  { key: "brand_voice", visible: true, editable: true },
  { key: "timezone", visible: true, editable: true },
  { key: "logo", visible: true, editable: true },
  { key: "quiet_hours", visible: true, editable: true },
  { key: "name", visible: true, editable: false },
  { key: "voicemail", visible: true, editable: false },
  { key: "weekly_cost_ceiling", visible: false, editable: false },
  { key: "monthly_cost_ceiling", visible: false, editable: false },
];

// Columns the read action may return (none are secret).
const READABLE_COLUMNS = [
  "name", "email", "description", "brand_voice", "timezone", "image_url",
  "cadence_quiet_hours", "voicemail_config", "weekly_cost_ceiling_cents", "monthly_cost_ceiling_cents",
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type GovField = { key: string; visible: boolean; editable: boolean };

function normalizeGovernance(raw: unknown): GovField[] {
  const byKey = new Map<string, GovField>();
  for (const d of DEFAULT_ACCOUNT_FIELDS) byKey.set(d.key, { ...d });
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const key = typeof r.key === "string" ? r.key : null;
      if (!key || !FIELD_CATALOG[key]) continue;
      const visible = typeof r.visible === "boolean" ? r.visible : true;
      // A hidden field can never be editable.
      const editable = visible && typeof r.editable === "boolean" ? r.editable : false;
      byKey.set(key, { key, visible, editable });
    }
  }
  return [...byKey.values()];
}

// ── Value validators (return the column-ready value, or throw a 400) ──
function validate(key: string, type: string, value: unknown): unknown {
  switch (type) {
    case "text_required": {
      if (typeof value !== "string" || !value.trim()) {
        throw new AssertAccessError(400, `${key} must be a non-empty string`);
      }
      return value.trim();
    }
    case "text_nullable": {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") throw new AssertAccessError(400, `${key} must be a string`);
      const t = value.trim();
      return t === "" ? null : t;
    }
    case "timezone": {
      if (typeof value !== "string" || !ALLOWED_TIMEZONES.has(value)) {
        throw new AssertAccessError(400, `${key} is not an allowed timezone`);
      }
      return value;
    }
    case "cents": {
      // Patch sends DOLLARS (matching the UI + the read action, which returns
      // dollars); blank/null = no ceiling. Invalid input fails loud rather than
      // silently clearing the spend guardrail.
      if (value === null || value === undefined || value === "") return null;
      const n = Math.round(parseFloat(String(value)) * 100);
      if (!Number.isFinite(n) || n < 0) {
        throw new AssertAccessError(400, `${key} must be a non-negative number`);
      }
      return Math.min(n, 2147483647);
    }
    case "quiet_hours": {
      if (!value || typeof value !== "object") throw new AssertAccessError(400, `${key} must be an object`);
      const r = value as Record<string, unknown>;
      const time = (v: unknown, d: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : d);
      const days = Array.isArray(r.days)
        ? r.days.filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7)
        : [1, 2, 3, 4, 5, 6, 7];
      if (days.length === 0) throw new AssertAccessError(400, "quiet_hours: at least one day required");
      const tz = typeof r.tz === "string" && ALLOWED_TIMEZONES.has(r.tz) ? r.tz : "Australia/Sydney";
      return { start: time(r.start, "09:00"), end: time(r.end, "21:00"), tz, days };
    }
    case "voicemail": {
      if (!value || typeof value !== "object") throw new AssertAccessError(400, `${key} must be an object`);
      const r = value as Record<string, unknown>;
      const mode = r.mode === "static" || r.mode === "prompt" ? r.mode : "hangup";
      const text = typeof r.text === "string" ? r.text : null;
      const detect_enabled = typeof r.detect_enabled === "boolean" ? r.detect_enabled : true;
      const detect_timeout_ms =
        typeof r.detect_timeout_ms === "number" && r.detect_timeout_ms > 0 ? r.detect_timeout_ms : 30000;
      return { mode, text: mode === "hangup" ? null : text, detect_enabled, detect_timeout_ms };
    }
    default:
      throw new AssertAccessError(400, `Unknown field type for ${key}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authHeader = req.headers.get("Authorization");
    const body = await req.json().catch(() => ({}));
    const { action, client_id, patch } = body as {
      action?: string;
      client_id?: string;
      patch?: Record<string, unknown>;
    };

    if (!client_id) return json({ error: "Missing client_id" }, 400);

    let role: "agency" | "client";
    try {
      ({ role } = await resolveClientAccess(authHeader, client_id));
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    // Load governance (fall back to the default split if no row exists).
    const { data: govRow } = await supabase
      .from("client_account_field_config")
      .select("fields")
      .eq("client_id", client_id)
      .maybeSingle();
    const governance = normalizeGovernance(govRow?.fields);
    const govByKey = new Map(governance.map((g) => [g.key, g]));

    // ── READ ──
    if (action === "read") {
      const { data: client, error } = await supabase
        .from("clients")
        .select(READABLE_COLUMNS.join(", "))
        .eq("id", client_id)
        .maybeSingle();
      if (error || !client) return json({ error: "Client not found" }, 404);

      const c = client as unknown as Record<string, unknown>;
      const values: Record<string, unknown> = {};
      for (const [key, meta] of Object.entries(FIELD_CATALOG)) {
        const g = govByKey.get(key);
        // Clients only receive values for VISIBLE fields; agency receives all.
        if (role === "client" && !(g?.visible ?? true)) continue;
        const raw = c[meta.column] ?? null;
        // cost ceilings are stored in cents but the UI + save path use dollars —
        // return dollars so read/write round-trips at the same unit.
        values[key] = meta.type === "cents" && typeof raw === "number" ? raw / 100 : raw;
      }
      return json({ values, fields: governance });
    }

    // ── SAVE ──
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return json({ error: "Missing patch" }, 400);
    }

    const allowedKeys = new Set(
      role === "agency"
        ? Object.keys(FIELD_CATALOG)
        : governance.filter((g) => g.editable).map((g) => g.key),
    );

    const mapped: Record<string, unknown> = {};
    const updated: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
      const meta = FIELD_CATALOG[key];
      if (!meta) continue; // unknown field — drop
      if (!allowedKeys.has(key)) continue; // not editable for this caller — drop
      mapped[meta.column] = validate(key, meta.type, value);
      updated.push(key);
    }

    if (updated.length === 0) {
      return json({ error: "No editable fields in patch for this account" }, 403);
    }

    const { error: updErr } = await supabase.from("clients").update(mapped).eq("id", client_id);
    if (updErr) return json({ error: updErr.message }, 500);

    // Voicemail save has a side effect: push the new config to the Retell agents
    // (mirrors ClientVoicemailCard). retell-proxy requires a real user JWT and
    // re-checks ownership, so forward the CALLER's Authorization header (the
    // client/agency who owns this row). Non-fatal if the push fails.
    let voicemailPushed: boolean | undefined;
    if (updated.includes("voicemail")) {
      try {
        const baseUrl = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");
        const pushRes = await fetch(`${baseUrl}/functions/v1/retell-proxy`, {
          method: "POST",
          headers: { Authorization: authHeader ?? "", "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set-voicemail", clientId: client_id }),
        });
        voicemailPushed = pushRes.ok;
      } catch (pushErr) {
        console.warn("save-account-settings: voicemail Retell push failed (non-fatal)", pushErr);
        voicemailPushed = false;
      }
    }

    return json({ success: true, updated, ...(voicemailPushed !== undefined ? { voicemailPushed } : {}) });
  } catch (error) {
    console.error("save-account-settings error:", error);
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
