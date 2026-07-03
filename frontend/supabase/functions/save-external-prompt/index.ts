import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";
import { lintTextSetterPrompt, type LintFinding } from "../_shared/promptLint.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      client_id,
      card_name,
      content,
      persona,
      booking_function_enabled,
      agent_settings,
      channel, // 'text' | 'voice'
    } = await req.json();

    console.log(`🔍 Incoming request: card_name=${card_name}, channel=${channel}, agent_settings keys=${agent_settings ? Object.keys(agent_settings).join(',') : 'NONE'}, followup_instructions=${agent_settings?.followup_instructions ?? 'NOT_SET'}`);

    // Build the full consolidated prompt (persona + content) for system_prompt
    const SAVE_SEPARATOR = '\n\n── ── ── ── ── ── ── ── ── ── ── ── ── ──\n\n';
    const personaTrimmed = (persona || '').trim();
    const contentTrimmed = (content || '').trim();
    const fullConsolidatedPrompt = [personaTrimmed, contentTrimmed].filter(Boolean).join(SAVE_SEPARATOR);

    if (!client_id || !card_name) {
      return new Response(
        JSON.stringify({ error: "client_id and card_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), client_id);
    } catch (e) {
      if (e instanceof AssertAccessError) {
        return new Response(JSON.stringify({ error: e.message }), { status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    // Normalize card_name: strip 'Voice-Setter-' prefix so both channels use 'Setter-N'
    const normalizedCardName = card_name.replace(/^Voice-Setter-/, 'Setter-');

    const isVoice = channel === 'voice';

    // ── PROMPT-AUTH-1: save-time lint (TEXT channel only — voice prompts use
    // Retell-interpolated {{...}} tokens legitimately). Errors block the save
    // BEFORE any write, with exact line numbers so the operator can fix them in
    // the UI. Warnings never block; they ride back on the success response.
    //
    // PROMPT-LINT-1: also lint the followup instruction fields — a stale
    // weekday policy or legacy tool name is just as dangerous there as in the
    // main prompt, but they were previously never scanned at all.
    let lintWarnings: LintFinding[] = [];
    if (!isVoice) {
      const lint = lintTextSetterPrompt(fullConsolidatedPrompt);
      let lintErrors: LintFinding[] = [...lint.errors];
      lintWarnings = [...lint.warnings];

      const followupFields: Array<[string, string | undefined]> = [
        ["followup_instructions", agent_settings?.followup_instructions],
        ["followup_cancellation_instructions", agent_settings?.followup_cancellation_instructions],
      ];
      for (const [field, value] of followupFields) {
        if (!value) continue;
        const fieldLint = lintTextSetterPrompt(value);
        lintErrors = lintErrors.concat(fieldLint.errors.map((e) => ({ ...e, rule: `${field}.${e.rule}` })));
        lintWarnings = lintWarnings.concat(fieldLint.warnings.map((w) => ({ ...w, rule: `${field}.${w.rule}` })));
      }

      if (lintErrors.length > 0) {
        return new Response(
          JSON.stringify({
            error: "Prompt failed save-time lint. Fix the flagged lines and save again — none of this content was saved.",
            lint_errors: lintErrors,
            lint_warnings: lintWarnings,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // Try new table names first, fall back to legacy 'prompts' for text channel
    const primaryTable = isVoice ? 'voice_prompts' : 'text_prompts';
    const fallbackTable = isVoice ? null : 'prompts'; // legacy fallback for text only

    // Get client's external Supabase credentials from internal DB
    const internalSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: client, error: clientError } = await internalSupabase
      .from("clients")
      .select("supabase_url, supabase_service_key")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      console.error("Client fetch error:", clientError);
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!client.supabase_url || !client.supabase_service_key) {
      return new Response(
        JSON.stringify({ error: "Client Supabase credentials not configured. Please update them on the Credentials page." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to external Supabase
    const externalSupabase = createClient(client.supabase_url, client.supabase_service_key);
    const currentTimestamp = new Date().toISOString();

    const extractMissingColumnName = (message: string) => {
      const schemaCacheMatch = message.match(/Could not find the '([^']+)' column/);
      if (schemaCacheMatch?.[1]) return schemaCacheMatch[1];

      const relationMatch = message.match(/column "([^"]+)" of relation "[^"]+" does not exist/);
      if (relationMatch?.[1]) return relationMatch[1];

      return null;
    };

    const persistWithFallback = async (
      table: string,
      operation: 'update' | 'insert' | 'upsert',
      payload: Record<string, unknown>,
      filterColumn?: string,
      filterValue?: string,
    ) => {
      const mutablePayload = { ...payload };

      while (true) {
        let result;
        if (operation === 'update' && filterColumn && filterValue) {
          result = await externalSupabase.from(table).update(mutablePayload).eq(filterColumn, filterValue);
        } else if (operation === 'upsert') {
          result = await externalSupabase.from(table).upsert(mutablePayload, { onConflict: filterColumn || 'id' });
        } else {
          result = await externalSupabase.from(table).insert(mutablePayload);
        }

        if (!result.error) {
          return null;
        }

        const missingColumn = extractMissingColumnName(result.error.message || '');
        if (missingColumn && Object.prototype.hasOwnProperty.call(mutablePayload, missingColumn)) {
          console.warn(`Skipping unsupported column on ${table}: ${missingColumn}`);
          delete mutablePayload[missingColumn];
          continue;
        }

        return result.error;
      }
    };

    // ── Build sync payload based on channel ──
    const syncPayload: Record<string, unknown> = {
      system_prompt: fullConsolidatedPrompt,
      booking_prompt: contentTrimmed,
      updated_at: currentTimestamp,
      ...(typeof booking_function_enabled === 'boolean'
        ? { booking_function_enabled }
        : {}),
    };

    if (agent_settings && typeof agent_settings === 'object') {
      if (agent_settings.model !== undefined) syncPayload.model = agent_settings.model;
      if (agent_settings.booking_prompt !== undefined) syncPayload.booking_prompt = agent_settings.booking_prompt;

      if (!isVoice) {
        if (agent_settings.response_delay_seconds !== undefined) syncPayload.response_delay_seconds = agent_settings.response_delay_seconds;
        if (agent_settings.followup_1_delay_seconds !== undefined) syncPayload.followup_1_delay_seconds = agent_settings.followup_1_delay_seconds;
        if (agent_settings.followup_2_delay_seconds !== undefined) syncPayload.followup_2_delay_seconds = agent_settings.followup_2_delay_seconds;
        if (agent_settings.followup_3_delay_seconds !== undefined) syncPayload.followup_3_delay_seconds = agent_settings.followup_3_delay_seconds;
        if (agent_settings.followup_instructions !== undefined) syncPayload.followup_instructions = agent_settings.followup_instructions;
        if (agent_settings.followup_max_attempts !== undefined) {
          syncPayload.followup_max_attempts = agent_settings.followup_max_attempts;
          // Zero out unused follow-up delays based on max attempts
          const maxAttempts = Number(agent_settings.followup_max_attempts) || 0;
          if (maxAttempts < 1) syncPayload.followup_1_delay_seconds = 0;
          if (maxAttempts < 2) syncPayload.followup_2_delay_seconds = 0;
          if (maxAttempts < 3) syncPayload.followup_3_delay_seconds = 0;
        }
        if (agent_settings.followup_cancellation_instructions !== undefined) syncPayload.followup_cancellation_instructions = agent_settings.followup_cancellation_instructions;
        if (agent_settings.file_processing_enabled !== undefined) syncPayload.file_processing_enabled = agent_settings.file_processing_enabled;
        if (agent_settings.human_transfer_enabled !== undefined) syncPayload.human_transfer_enabled = agent_settings.human_transfer_enabled;
      }

      console.log(`📦 Combined sync payload for ${normalizedCardName}:`, JSON.stringify(syncPayload));
    }

    // Try primary table first; if not found, fall back to legacy table
    let resolvedTable = primaryTable;
    let resolvedExisting: any = null;

    const isTableOrColumnMissing = (msg: string) =>
      msg.includes('schema cache') || msg.includes('does not exist') || msg.includes('42703');

    const { data: existing, error: selectError } = await externalSupabase
      .from(primaryTable)
      .select("id")
      .eq("card_name", normalizedCardName)
      .maybeSingle();

    if (selectError && isTableOrColumnMissing(selectError.message || '') && fallbackTable) {
      // Primary table doesn't exist, try legacy fallback
      console.warn(`Table '${primaryTable}' not found, falling back to '${fallbackTable}'`);
      resolvedTable = fallbackTable;
      const { data: fbData, error: fbError } = await externalSupabase
        .from(fallbackTable)
        .select("id")
        .eq("card_name", normalizedCardName)
        .maybeSingle();
      if (fbError) {
        console.error("Fallback select error:", fbError);
        return new Response(
          JSON.stringify({ error: `Failed to query external table: ${fbError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      resolvedExisting = fbData;
    } else if (selectError) {
      console.error("External select error:", selectError);
      return new Response(
        JSON.stringify({ error: `Failed to query external ${primaryTable} table: ${selectError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      resolvedExisting = existing;
    }

    let result;
    if (resolvedExisting) {
      const updateError = await persistWithFallback(resolvedTable, 'update', syncPayload, 'id', resolvedExisting.id);
      if (updateError) {
        console.error("External update error:", updateError);
        return new Response(
          JSON.stringify({ error: `Failed to update external prompt: ${updateError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      result = { action: "updated", card_name: normalizedCardName, table: resolvedTable };
    } else {
      const insertError = await persistWithFallback(resolvedTable, 'upsert', {
        card_name: normalizedCardName,
        created_at: currentTimestamp,
        ...syncPayload,
      }, 'card_name');
      if (insertError) {
        console.error("External insert error:", insertError);
        return new Response(
          JSON.stringify({ error: `Failed to insert external prompt: ${insertError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      result = { action: "created", card_name: normalizedCardName, table: resolvedTable };
    }

    console.log(`✅ External prompt saved to ${resolvedTable}: ${result.action} ${normalizedCardName}`);

    // ── PROMPT-AUTH-1 (Q9): snapshot every deploy to platform prompt_versions so
    // the runtime artifact has an audit trail ("when did rule X enter this
    // prompt?") and a rollback source. Non-fatal — a snapshot hiccup must never
    // break the save.
    try {
      const { data: latest } = await internalSupabase
        .from("prompt_versions")
        .select("version_number")
        .eq("client_id", client_id)
        .eq("slot_id", card_name)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = ((latest?.version_number as number | null) ?? 0) + 1;
      const { error: snapshotError } = await internalSupabase.from("prompt_versions").insert({
        client_id,
        slot_id: card_name,
        version_number: nextVersion,
        prompt_content: fullConsolidatedPrompt,
        label: "deploy",
      });
      if (snapshotError) console.warn("prompt_versions snapshot failed:", snapshotError.message);
    } catch (snapshotErr) {
      console.warn("prompt_versions snapshot failed:", (snapshotErr as Error)?.message);
    }

    return new Response(
      JSON.stringify({ success: true, ...result, lint_warnings: lintWarnings }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
