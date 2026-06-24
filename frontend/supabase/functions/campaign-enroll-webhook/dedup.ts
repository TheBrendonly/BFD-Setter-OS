import { normalizePhone } from "../_shared/phone.ts";

// S2b-5 phone-dedup for campaign-enroll-webhook. Mirrors ghl-tag-webhook's
// 5-minute window, but keys on `normalized_phone` (the canonical match column
// resolveLeadByPhone uses) instead of the raw `phone` string. Returns true when
// the same client already has a DIFFERENT lead row with this phone created
// inside the window — i.e. a rapid duplicate enrolment that should be skipped so
// a leaked token can't fire repeated billable engagements for one number.
export const ENROLL_PHONE_DEDUP_WINDOW_MINUTES = 5;

export async function isPhoneRecentDuplicate(
  supabase: any,
  clientId: string,
  rawPhone: string | null,
  excludeLeadId: string | null,
): Promise<boolean> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return false;
  const cutoff = new Date(Date.now() - ENROLL_PHONE_DEDUP_WINDOW_MINUTES * 60_000).toISOString();
  let query = supabase
    .from("leads")
    .select("id, created_at")
    .eq("client_id", clientId)
    .eq("normalized_phone", normalized)
    .gte("created_at", cutoff)
    .limit(1);
  if (excludeLeadId) query = query.neq("lead_id", excludeLeadId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.warn("campaign-enroll-webhook: phone dedup query failed", error);
    return false; // fail open on a query error — dedup is a guard, not the gate
  }
  return Boolean(data);
}
