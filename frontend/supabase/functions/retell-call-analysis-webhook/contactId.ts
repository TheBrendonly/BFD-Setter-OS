// Resolve the GHL contact id from a Retell `retell_llm_dynamic_variables` blob.
//
// Order matters: the BFD outbound cadence emits `ghl_contact_id`, while older
// integrations used `contact_id` / `Contact_ID` / `Lead_ID`. Empty strings fall
// through to the next candidate so a blanked-out var doesn't pin contactId.
//
// Pure + dependency-free so it can be exercised in a small unit test.
export function resolveContactId(
  dynamicVars: Record<string, unknown> | null | undefined,
): string | null {
  if (!dynamicVars) return null;
  const candidates = [
    dynamicVars.ghl_contact_id,
    dynamicVars.contact_id,
    dynamicVars.Contact_ID,
    dynamicVars.Lead_ID,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}
