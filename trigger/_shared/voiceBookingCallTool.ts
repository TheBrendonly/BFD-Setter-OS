// FOLLOWUP-PROMPT-1 review follow-up — the single shared voice-booking-tools HTTP
// caller. This closure previously existed twice: processSetterReply's copy had an
// AbortController + 30s timeout, sendFollowup's fork silently dropped both, so a
// hung GHL/edge call could stall a followup run for undici's ~300s default instead
// of 30s. Semantics are the live reply path's, verbatim: URL shape, optional intake
// bearer, { ok, tool, result } envelope unwrap, "voice-booking-tools <name> failed:"
// error prefix with a 300-char cap.
import type { CallTool } from "./setterToolLoop.ts";

export const DEFAULT_TOOL_TIMEOUT_MS = 30 * 1000;

export function makeVoiceBookingCallTool(opts: {
  supabaseUrl: string;
  clientId: string;
  intakeSecret?: string | null;
  timeoutMs?: number;
  // Injectable for tests only; production callers omit it.
  fetchImpl?: typeof fetch;
}): CallTool {
  const {
    supabaseUrl,
    clientId,
    intakeSecret,
    timeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
    fetchImpl = fetch,
  } = opts;
  const toolEndpoint = `${supabaseUrl}/functions/v1/voice-booking-tools`;

  return async (name, toolArgs) => {
    const url = `${toolEndpoint}?tool=${encodeURIComponent(name)}&clientId=${encodeURIComponent(clientId)}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (intakeSecret) headers.Authorization = `Bearer ${intakeSecret}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(toolArgs),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    const json = (await resp.json().catch(() => null)) as {
      ok?: boolean;
      result?: unknown;
      error?: string;
    } | null;
    if (!resp.ok || (json && json.ok === false)) {
      const msg = (json && (json.error || JSON.stringify(json))) || `HTTP ${resp.status}`;
      throw new Error(`voice-booking-tools ${name} failed: ${String(msg).slice(0, 300)}`);
    }
    // Unwrap the { ok, tool, result } envelope so the model sees the payload.
    return json && typeof json === "object" && "result" in json ? json.result : json;
  };
}
