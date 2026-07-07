// Single source of truth for the leads INSERT shape on create paths.
// BUG 6.10: every create path must derive normalized_phone from phone, because
// _shared/leadResolve.ts resolveLeadByPhone matches normalized_phone ONLY. Build
// the insert through here so the field can never be silently dropped again.
import { normalizePhone } from "./phone.ts";
import { isValidTimeZone } from "./leadTimezone.ts";

export interface LeadInsertInput {
  clientId: string;
  leadId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null | undefined;
  email: string | null;
  // Optional: sync-ghl-contact stamps form_source; campaign-enroll-webhook does not.
  formSource?: string | null;
  // BOOK-TZ-1: the GHL contact's timezone. IANA-validated here (GHL can store junk
  // labels); an invalid value is stored as NULL so the lead falls back to business tz.
  timezone?: string | null;
}

export function buildLeadInsert(input: LeadInsertInput): Record<string, unknown> {
  const row: Record<string, unknown> = {
    client_id: input.clientId,
    lead_id: input.leadId,
    first_name: input.firstName,
    last_name: input.lastName,
    phone: input.phone || null,
    normalized_phone: normalizePhone(input.phone),
    email: input.email,
  };
  if (input.formSource !== undefined) {
    row.form_source = input.formSource;
  }
  if (input.timezone !== undefined) {
    row.timezone = isValidTimeZone(input.timezone) ? input.timezone : null;
  }
  return row;
}
