// BFD-wins rule helpers for sync-ghl-contact.
// Extracted so the identity-field protection logic can be unit-tested without
// the Deno.serve entanglement of the full edge function.

export const IDENTITY_FIELDS = ["first_name", "last_name", "email", "phone"] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

/**
 * Build the update payload for an EXISTING lead when processing a GHL
 * contact.update webhook. Identity fields are intentionally excluded: BFD is
 * authoritative for first_name, last_name, email, and phone; GHL re-syncs
 * must not overwrite edits made in the BFD UI.
 *
 * The CREATE path (brand-new leads) skips this function entirely and seeds
 * identity fields directly from the GHL payload.
 */
export function buildExistingLeadUpdatePayload(): Record<string, unknown> {
  // Only bump updated_at. Identity fields are owned by BFD and are never
  // written on the existing-lead path.
  return { updated_at: new Date().toISOString() };
}

/**
 * Verify that a payload built for an existing-lead update contains no identity
 * fields. Returns the list of any identity fields found (empty = correct).
 */
export function identityFieldsInPayload(
  payload: Record<string, unknown>,
): IdentityField[] {
  return IDENTITY_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(payload, f));
}
