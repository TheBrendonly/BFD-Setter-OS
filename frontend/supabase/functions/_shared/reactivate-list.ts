// Pure helpers for bulk reactivation (reactivate-lead-list). Kept separate
// from index.ts so they can be unit-tested under Node without triggering the
// Deno.serve entrypoint. The UI is expected to send normalized rows, but we
// accept a few common key variants defensively.

export interface NormalizedLead {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  lead_id: string | null;
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/**
 * Normalise one raw lead row into the shape the enroller needs, or null when
 * the row has neither a phone nor an email (nothing to contact). lead_id is
 * null when not supplied — the caller assigns one.
 */
export function normalizeLeadRow(raw: Record<string, unknown>): NormalizedLead | null {
  // Accept snake_case, camelCase, and the Title-Case-with-spaces headers used
  // by the CSV template + the Contacts picker (e.g. "First Name", "Phone").
  const first_name = str(raw.first_name) || str(raw.firstName) || str(raw["First Name"]);
  const last_name = str(raw.last_name) || str(raw.lastName) || str(raw["Last Name"]);
  const phone = str(raw.phone) || str(raw.Phone) || str(raw.phone_number) || str(raw["Phone Number"]);
  const email = str(raw.email) || str(raw.Email);
  const lead_id = str(raw.lead_id) || str(raw.id) || str(raw["Lead ID"]);
  if (!phone && !email) return null;
  return { first_name, last_name, phone, email, lead_id: lead_id || null };
}

/** Split an array into fixed-size chunks (for bounded concurrency). */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
