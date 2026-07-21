// pollRetellDrift (F9 v2)
//
// Hourly server-side drift detector for LOCKED voice setters. v1 only surfaced drift in
// the browser (PromptManagement) as a live version compare when the list was open; this
// runs unattended so a locked Retell agent that (a) is published past the version BFD last
// synced, or (b) silently loses its BFD booking tools, is caught without anyone opening the
// UI. Read-only against Retell (get-agent / get-retell-llm) — NEVER writes to Retell.
//
// On a positive it stamps a persisted flag on voice_setters (drives the tile badge) and,
// only on FIRST detection (flag null -> now), writes an error_logs row (the in-app alert
// channel) + an optional Slack push. A clean result clears the flag (drift resolved).
//
// Retell keys are per-client (clients.retell_api_key), read here with service-role access
// exactly like retell-proxy's getRetellApiKey — no global Retell secret needed.

import { schedules } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import { computeDriftState } from "./_shared/retellDrift";
import { postAlert } from "./_shared/postAlert.ts";

const RETELL_BASE = "https://api.retellai.com";

async function retellGet(apiKey: string, path: string): Promise<any | null> {
  try {
    const res = await fetch(`${RETELL_BASE}/${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.warn(`pollRetellDrift: retellGet ${path} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`pollRetellDrift: retellGet ${path} threw: ${(e as Error).message}`);
    return null;
  }
}

async function postDriftAlert(message: string): Promise<void> {
  await postAlert(`🔒 BFD voice-setter drift: ${message}`);
}

export const pollRetellDrift = schedules.task({
  id: "poll-retell-drift",
  // Hourly (Trigger.dev free-tier minimum). Drift is low-frequency; hourly is ample.
  cron: "0 * * * *",
  maxDuration: 180,
  retry: { maxAttempts: 1 },

  run: async () => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: setters, error: settersErr } = await supabase
      .from("voice_setters")
      .select(
        "id, client_id, legacy_slot, name, retell_agent_id, retell_synced_version, retell_config_snapshot, retell_drift_detected_at, retell_booking_tools_lost_at",
      )
      .eq("is_retell_locked", true)
      .not("retell_agent_id", "is", null);

    if (settersErr) {
      console.error(`pollRetellDrift: setters query failed: ${settersErr.message}`);
      return { ok: false, error: settersErr.message };
    }
    if (!setters || setters.length === 0) {
      return { ok: true, checked: 0 };
    }

    // Resolve each client's ghl_account_id (for error_logs) + per-client Retell key once.
    const clientIds = [...new Set(setters.map((s: any) => s.client_id).filter(Boolean))];
    const ghlByClient = new Map<string, string>();
    const keyByClient = new Map<string, string>();
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id, ghl_location_id, retell_api_key")
      .in("id", clientIds);
    for (const c of clientRows ?? []) {
      ghlByClient.set(c.id, (c.ghl_location_id as string | null) || c.id);
      if (c.retell_api_key) keyByClient.set(c.id, c.retell_api_key as string);
    }

    const nowIso = new Date().toISOString();
    let checked = 0;
    let skippedNoKey = 0;
    let flagged = 0;

    for (const s of setters as any[]) {
      const retellKey = keyByClient.get(s.client_id);
      if (!retellKey) { skippedNoKey++; continue; }
      checked++;

      const agent = await retellGet(retellKey, `get-agent/${s.retell_agent_id}`);
      const liveAgentVersion: number | null =
        typeof agent?.version === "number" ? agent.version : null;

      let liveLlmToolNames: string[] = [];
      if (agent?.response_engine?.type === "retell-llm" && agent?.response_engine?.llm_id) {
        const llm = await retellGet(retellKey, `get-retell-llm/${agent.response_engine.llm_id}`);
        liveLlmToolNames = Array.isArray(llm?.general_tools)
          ? llm.general_tools
              .map((t: Record<string, unknown>) => (typeof t?.name === "string" ? t.name : null))
              .filter((n: string | null): n is string => !!n)
          : [];
      }

      const drift = computeDriftState({
        syncedVersion: s.retell_synced_version ?? null,
        snapshot: s.retell_config_snapshot ?? null,
        liveAgentVersion,
        liveLlmToolNames,
      });

      const alreadyDrift = s.retell_drift_detected_at != null;
      const alreadyToolsLost = s.retell_booking_tools_lost_at != null;

      const update: Record<string, unknown> = {};
      if (drift.versionDrifted && !alreadyDrift) update.retell_drift_detected_at = nowIso;
      if (!drift.versionDrifted && alreadyDrift) update.retell_drift_detected_at = null;
      if (drift.bookingToolsLost && !alreadyToolsLost) update.retell_booking_tools_lost_at = nowIso;
      if (!drift.bookingToolsLost && alreadyToolsLost) update.retell_booking_tools_lost_at = null;

      if (Object.keys(update).length) {
        await supabase.from("voice_setters").update(update).eq("id", s.id);
      }

      const newlyDrift = drift.versionDrifted && !alreadyDrift;
      const newlyToolsLost = drift.bookingToolsLost && !alreadyToolsLost;

      if (newlyDrift || newlyToolsLost) {
        flagged++;
        const conditions: string[] = [];
        if (newlyDrift) conditions.push(`version drift (live v${liveAgentVersion} > synced v${s.retell_synced_version})`);
        if (newlyToolsLost) conditions.push("booking tools missing (in-call booking would break)");
        const errorType = newlyToolsLost ? "retell_booking_tools_lost" : "retell_drift";
        const msg = `Locked voice setter "${s.name ?? s.legacy_slot}" drifted: ${conditions.join("; ")}`;
        try {
          await supabase.from("error_logs").insert({
            client_ghl_account_id: ghlByClient.get(s.client_id) || s.client_id,
            error_type: errorType,
            error_message: msg,
            severity: newlyToolsLost ? "error" : "warning",
            source: "trigger.pollRetellDrift",
            context: {
              voice_setter_id: s.id,
              voice_setter_slot: s.legacy_slot,
              client_id: s.client_id,
              agent_id: s.retell_agent_id,
              live_agent_version: liveAgentVersion,
              synced_version: s.retell_synced_version,
              version_drifted: drift.versionDrifted,
              booking_tools_lost: drift.bookingToolsLost,
            },
          });
        } catch (e) {
          console.warn(`pollRetellDrift: error_logs insert failed (non-fatal): ${(e as Error).message}`);
        }
        await postDriftAlert(msg);
      }
    }

    console.log(`pollRetellDrift: checked ${checked}, flagged ${flagged}, skipped_no_key ${skippedNoKey}`);
    return { ok: true, checked, flagged, skipped_no_key: skippedNoKey };
  },
});
