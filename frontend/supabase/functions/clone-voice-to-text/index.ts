// Clone a doc-model VOICE prompt across to a TEXT setter (2026-08-12, spec item 2).
//
// Ratified workflow step 6: once the voice agent is right, clone it to the text setter.
// Voice is the hard side; text follows. Text can NEVER live in Retell (US-A2P-only SMS,
// no cadences), so this conversion is permanently a BFD-side job.
//
// Two actions, because an LLM call this size cannot finish inside one edge request:
//
//   start -> read prompt_docs, extract compliance lines, dispatch an ai_generation_jobs
//            row through the EXISTING run-ai-job Trigger task (job_type
//            "modify-prompt-ai", already the plain-text path). No Trigger deploy needed.
//   apply -> take the model draft, run the deterministic transform, lint it, and only
//            then write.
//
// The finalise step lives HERE rather than trigger-side because promptLint.ts is
// importable from an edge function; doing it in trigger/ would force a twin copy of 178
// lines of compliance-critical regex, on the exact module that must never drift.
import { createClient } from "npm:@supabase/supabase-js@2.101.0";
import { authorizeClientRequest, AssertAccessError } from "../_shared/authorize-client-request.ts";
import {
  buildVoiceToTextMessages,
  extractComplianceLines,
  finalizeTextPrompt,
  type ComplianceLine,
} from "./transform.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action, clientId } = body ?? {};
    if (!clientId) return json({ error: "clientId is required." }, 400);
    if (action !== "start" && action !== "apply") {
      return json({ error: 'action must be "start" or "apply".' }, 400);
    }

    try {
      await authorizeClientRequest(req.headers.get("Authorization"), clientId);
    } catch (e) {
      if (e instanceof AssertAccessError) return json({ error: e.message }, e.status);
      throw e;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const triggerSecretKey = Deno.env.get("TRIGGER_SECRET_KEY");
    if (!supabaseUrl || !serviceKey) return json({ error: "Server configuration error." }, 500);
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── START ────────────────────────────────────────────────────────────────
    if (action === "start") {
      const { sourceSlotId, targetSlotId, userGuidelines } = body;
      if (!sourceSlotId || !targetSlotId) {
        return json({ error: "sourceSlotId and targetSlotId are required." }, 400);
      }
      if (!String(sourceSlotId).startsWith("Voice-Setter-")) {
        return json({ error: "sourceSlotId must be a voice setter slot." }, 400);
      }
      if (String(targetSlotId).startsWith("Voice-Setter-")) {
        return json({ error: "targetSlotId must be a text setter slot." }, 400);
      }
      if (!triggerSecretKey) return json({ error: "Server configuration error." }, 500);

      // The doc model is the ONLY honest source. Prefer what is actually deployed to
      // Retell over an unpushed draft, and fail loudly rather than falling back to the
      // stale prompt_configurations the old copy path silently used.
      const { data: doc } = await supabase
        .from("prompt_docs")
        .select("doc_content, deployed_doc_content, status")
        .eq("client_id", clientId)
        .eq("slot_id", sourceSlotId)
        .maybeSingle();

      const voiceDoc = (doc?.deployed_doc_content || doc?.doc_content || "").trim();
      if (!voiceDoc) {
        return json({
          error:
            `No prompt document for ${sourceSlotId}. Open that voice setter, save its ` +
            "prompt once to create the document, then clone.",
          code: "no_source_doc",
        }, 404);
      }

      const { data: clientRow } = await supabase
        .from("clients")
        .select("openrouter_api_key")
        .eq("id", clientId)
        .single();
      if (!clientRow?.openrouter_api_key) {
        return json({ error: "OpenRouter API key is not configured. Please add it in API Credentials." }, 400);
      }

      const compliance = extractComplianceLines(voiceDoc);
      const messages = buildVoiceToTextMessages({
        voiceDoc,
        compliance,
        sourceSlotId,
        targetSlotId,
        userGuidelines,
      });

      const { data: jobRow, error: insertError } = await supabase
        .from("ai_generation_jobs")
        .insert({
          client_id: clientId,
          // Reuses the existing plain-text job type: runAiJob returns
          // { modifiedPrompt, summary } for it, which is exactly the shape needed.
          job_type: "modify-prompt-ai",
          status: "pending",
          input_payload: {
            // Keyed to the TARGET slot so the existing realtime PROCESSING indicator
            // in PromptManagement lights up on the setter being written.
            slotId: targetSlotId,
            sourceSlotId,
            source: "clone-voice-to-text",
            // Stashed so apply() never has to re-derive from a doc that may have moved.
            compliance,
            sourceChars: voiceDoc.length,
            messages,
            max_tokens: 32000,
            temperature: 0.2,
            openrouter_api_key: clientRow.openrouter_api_key,
          },
        })
        .select("id")
        .single();
      if (insertError || !jobRow) {
        console.error("[clone-voice-to-text] job insert failed:", insertError);
        return json({ error: "Failed to create conversion job." }, 500);
      }

      const triggerResponse = await fetch(
        "https://api.trigger.dev/api/v1/tasks/run-ai-job/trigger",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${triggerSecretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            payload: {
              job_id: jobRow.id,
              client_id: clientId,
              job_type: "modify-prompt-ai",
              messages,
              max_tokens: 32000,
              temperature: 0.2,
            },
          }),
        },
      );
      if (!triggerResponse.ok) {
        const errText = await triggerResponse.text();
        console.error("[clone-voice-to-text] trigger failed:", triggerResponse.status, errText.slice(0, 200));
        await supabase
          .from("ai_generation_jobs")
          .update({
            status: "failed",
            error_message: `Failed to trigger AI job: ${triggerResponse.status}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobRow.id);
        return json({ error: "Failed to start the conversion job." }, 502);
      }

      return json({
        job_id: jobRow.id,
        source_chars: voiceDoc.length,
        compliance_lines: compliance.length,
        source_status: doc?.status ?? null,
      });
    }

    // ── APPLY ────────────────────────────────────────────────────────────────
    const { jobId, targetSlotId, dryRun } = body;
    if (!jobId || !targetSlotId) return json({ error: "jobId and targetSlotId are required." }, 400);

    const { data: job } = await supabase
      .from("ai_generation_jobs")
      .select("id, client_id, status, result, input_payload, error_message")
      .eq("id", jobId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (!job) return json({ error: "Conversion job not found." }, 404);
    if (job.status !== "completed") {
      return json({ error: `Job is ${job.status}.`, status: job.status, job_error: job.error_message }, 409);
    }

    const modelOutput = (job.result as { modifiedPrompt?: string } | null)?.modifiedPrompt ?? "";
    if (!modelOutput.trim()) return json({ error: "The conversion job returned no prompt." }, 422);

    const payload = job.input_payload as { compliance?: ComplianceLine[]; sourceChars?: number } | null;
    const compliance = payload?.compliance ?? [];
    const finalized = finalizeTextPrompt({
      modelOutput,
      compliance,
      sourceChars: payload?.sourceChars,
    });

    const report = {
      prompt_chars: finalized.prompt.length,
      removed_voice_isms: finalized.removedVoiceIsms,
      removed_sections: finalized.removedSections,
      dropped_token_lines: finalized.droppedTokenLines,
      replaced_tokens: finalized.replacedTokens,
      reasserted_compliance: finalized.reasserted.map((c) => ({ kind: c.kind, text: c.text })),
      compliance_lines_required: compliance.length,
      lint_warnings: finalized.lint.warnings,
      coverage: finalized.coverage,
    };

    // Coverage gate. A model that summarises instead of converting produces a prompt that
    // lints perfectly clean and is missing the entire persona, so lint alone cannot catch
    // it. Refuse rather than save a gutted setter.
    if (finalized.coverage && !finalized.coverage.ok) {
      return json({
        error:
          `The conversion returned only ${Math.round(finalized.coverage.ratio * 100)}% of the ` +
          "source length, which means it summarised rather than converted. Nothing was saved. " +
          "Re-run the clone.",
        code: "conversion_too_short",
        report,
      }, 422);
    }

    // Lint gate. A lint-failing clone landing in text_prompts.system_prompt is a live
    // content change with a known-bad prompt: exactly the class promptLint exists to
    // stop (2026-07-03 wrong-booking incident). Write nothing; the draft stays in
    // ai_generation_jobs.result for inspection, so nothing is re-paid for.
    if (!finalized.ok) {
      return json({
        error:
          "Converted prompt failed save-time lint. Nothing was saved. Fix the flagged " +
          "lines in the source voice prompt, or adjust the guidance and re-run.",
        lint_errors: finalized.lint.errors,
        lint_warnings: finalized.lint.warnings,
        report,
      }, 422);
    }

    if (dryRun === true) {
      return json({ success: true, dry_run: true, prompt: finalized.prompt, report });
    }

    // Mirror handleSaveDocDraft's ordering: internal row first, then the external table
    // the runtime actually reads, via save-external-prompt (which re-lints as defence in
    // depth and snapshots to prompt_versions).
    // NOTE: `prompts` has only a PK on id, no unique (client_id, slot_id), so an upsert
    // with onConflict would error. Select then update-or-insert.
    const { data: existingPrompt } = await supabase
      .from("prompts")
      .select("id")
      .eq("client_id", clientId)
      .eq("slot_id", targetSlotId)
      .maybeSingle();
    const promptWrite = existingPrompt?.id
      ? await supabase
        .from("prompts")
        .update({ content: finalized.prompt, persona: null, updated_at: new Date().toISOString() })
        .eq("id", existingPrompt.id)
      : await supabase
        .from("prompts")
        .insert({
          client_id: clientId,
          slot_id: targetSlotId,
          name: targetSlotId,
          content: finalized.prompt,
          persona: null,
          is_active: true,
        });
    if (promptWrite.error) {
      console.warn("[clone-voice-to-text] prompts write failed:", promptWrite.error.message);
    }

    const saveResp = await fetch(`${supabaseUrl}/functions/v1/save-external-prompt`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      // save-external-prompt takes snake_case client_id, not clientId.
      body: JSON.stringify({
        client_id: clientId,
        card_name: targetSlotId,
        channel: "text",
        persona: "",
        content: finalized.prompt,
      }),
    });
    const saveJson = await saveResp.json().catch(() => null);
    if (!saveResp.ok) {
      return json({
        error: "The prompt passed lint but the external save failed.",
        save_status: saveResp.status,
        save_error: (saveJson as { error?: string } | null)?.error ?? null,
        lint_errors: (saveJson as { lint_errors?: unknown } | null)?.lint_errors ?? null,
        report,
      }, 502);
    }

    return json({
      success: true,
      dry_run: false,
      target_slot_id: targetSlotId,
      report,
      // Structural caveat, surfaced not buried: for text setters the section editor
      // recompiles its content from param states, and __full_prompt__ is produced by the
      // builder rather than read back. The clone is correct in the live external prompt,
      // but the editor still shows the old param-built one and the next UI Save there
      // would overwrite this. Follow-up is to give text setters a prompt_docs row.
      warning: "section_editor_stale",
      warning_detail:
        "The clone is live in the text setter's prompt. The section editor below still " +
        "shows the older parameter-built prompt; do not re-save it there or the clone " +
        "will be overwritten.",
    });
  } catch (e) {
    console.error("clone-voice-to-text error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
