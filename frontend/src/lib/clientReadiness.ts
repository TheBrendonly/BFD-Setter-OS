// Pure read-only helper (S6-2): compute a sub-account's provisioning "readiness"
// from the PRESENCE (never the value) of the columns that gate going live. Used by
// the agency ManageClients dashboard. No secret values are surfaced — only "is it set".
//
// Tiers mirror the "set before go-live" gating columns that the onboard-client.mjs
// checklist enforces (scripts/onboard-client.mjs §REQUIRED MANUAL):
//   - required    => any missing makes the client RED (cannot run the core flow)
//   - recommended => all required present but some of these missing => AMBER (hardening / external DB)

export type ReadinessLevel = "green" | "amber" | "red";

export interface ReadinessField {
  column: string;
  label: string;
  tier: "required" | "recommended";
  // Secret columns are never exposed to the browser. The clients_public view
  // (security boundary, B5/S1-1) replaces their value with a has_<column>
  // boolean, so presence is checked off `has_<column>` instead of the value.
  secret?: boolean;
}

export const READINESS_FIELDS: ReadinessField[] = [
  // GHL connection + booking target
  { column: "ghl_location_id", label: "GHL location", tier: "required" },
  { column: "ghl_calendar_id", label: "GHL calendar", tier: "required" },
  { column: "ghl_assignee_id", label: "GHL assignee", tier: "required" },
  // Voice (Retell)
  { column: "retell_api_key", label: "Retell API key", tier: "required", secret: true },
  { column: "retell_outbound_agent_id", label: "Retell outbound agent", tier: "required" },
  { column: "retell_phone_1", label: "Retell phone number", tier: "required" },
  // LLM + lead intake auth
  { column: "openrouter_api_key", label: "OpenRouter API key", tier: "required", secret: true },
  { column: "intake_lead_secret", label: "Intake-lead secret", tier: "required", secret: true },
  // Cadence engine
  { column: "auto_engagement_workflow_id", label: "Cadence workflow", tier: "required" },
  // SMS (Twilio, BYO per client)
  { column: "twilio_account_sid", label: "Twilio account SID", tier: "required" },
  { column: "twilio_auth_token", label: "Twilio auth token", tier: "required", secret: true },
  { column: "twilio_default_phone", label: "Twilio phone number", tier: "required" },
  // Webhook hardening
  { column: "ghl_webhook_secret", label: "GHL webhook secret", tier: "recommended", secret: true },
  { column: "retell_webhook_secret", label: "Retell webhook secret", tier: "recommended", secret: true },
  // External client DB (gates outbound-call chat history + Chats view)
  { column: "supabase_url", label: "External Supabase URL", tier: "recommended" },
  { column: "supabase_service_key", label: "External Supabase key", tier: "recommended", secret: true },
];

export type ReadinessInput = Record<string, string | boolean | null | undefined>;

export interface FieldStatus extends ReadinessField {
  configured: boolean;
}

export interface ClientReadiness {
  level: ReadinessLevel;
  label: string;
  fields: FieldStatus[];
  requiredTotal: number;
  requiredSet: number;
  missingRequired: string[];
  missingRecommended: string[];
}

// Same idiom as isCredentialConfigured (hooks/useClientCredentials.ts); inlined to
// keep this module pure (no hook import).
const isSet = (value: string | boolean | null | undefined): boolean =>
  typeof value === "string" ? Boolean(value.trim()) : Boolean(value);

export function computeClientReadiness(client: ReadinessInput): ClientReadiness {
  const fields: FieldStatus[] = READINESS_FIELDS.map((field) => ({
    ...field,
    // Secret columns arrive from clients_public as a has_<column> boolean
    // (the value never reaches the browser); non-secret columns as their value.
    configured: field.secret ? isSet(client[`has_${field.column}`]) : isSet(client[field.column]),
  }));

  const required = fields.filter((field) => field.tier === "required");
  const missingRequired = required.filter((field) => !field.configured).map((field) => field.column);
  const missingRecommended = fields
    .filter((field) => field.tier === "recommended" && !field.configured)
    .map((field) => field.column);

  let level: ReadinessLevel;
  let label: string;
  if (missingRequired.length > 0) {
    level = "red";
    label = "Not ready";
  } else if (missingRecommended.length > 0) {
    level = "amber";
    label = "Almost ready";
  } else {
    level = "green";
    label = "Live";
  }

  return {
    level,
    label,
    fields,
    requiredTotal: required.length,
    requiredSet: required.length - missingRequired.length,
    missingRequired,
    missingRecommended,
  };
}
