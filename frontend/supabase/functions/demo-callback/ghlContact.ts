// GHL contact find-or-create for the demo callback funnel.
//
// The demo lead MUST carry a real GHL contact id. voice-booking-tools
// resolveContactId() is internal-first (index.ts:311-319): it returns whatever
// lead_id our leads row holds, so a synthetic `bfd-<phone>` id would be handed
// to GHL as an appointment target and the booking would fail.
//
// DRY debt, deliberate: near-identical logic already exists privately in
// intake-lead/index.ts:76 and receive-twilio-sms/index.ts:331. Consolidating all
// three into _shared/ means editing and redeploying two live, load-bearing
// functions, which is not a trade worth making in this session. Tracked
// separately for consolidation.

const GHL_BASE = "https://services.leadconnectorhq.com";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GhlContactArgs {
  readonly ghlApiKey: string;
  readonly ghlLocationId: string;
  readonly firstName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly source: string;
  readonly tags?: readonly string[];
}

export class GhlContactError extends Error {}

function headersFor(ghlApiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${ghlApiKey}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
    Accept: "application/json",
  };
}

/**
 * Resolve a GHL contact id, creating the contact when no exact match exists.
 *
 * Search is fuzzy on GHL's side, so a candidate is accepted only on an EXACT
 * phone or email match — otherwise a partially-overlapping contact would win
 * and the booking would attach to the wrong person.
 */
export async function findOrCreateGhlContact(
  args: GhlContactArgs,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const { ghlApiKey, ghlLocationId, firstName, email, phone, source, tags } = args;
  const headers = headersFor(ghlApiKey);

  for (const term of [phone, email].filter((v): v is string => !!v)) {
    const searchUrl = new URL(`${GHL_BASE}/contacts/search`);
    searchUrl.searchParams.set("locationId", ghlLocationId);
    searchUrl.searchParams.set("query", term);

    const response = await fetchImpl(searchUrl.toString(), { headers });
    if (!response.ok) continue;

    const payload = await response.json().catch(() => null);
    const contacts: unknown = payload?.contacts;
    if (!Array.isArray(contacts)) continue;

    const exact = contacts.find((contact: Record<string, unknown>) => {
      if (typeof contact?.id !== "string") return false;
      const contactPhone = typeof contact.phone === "string" ? contact.phone : "";
      const contactEmail = typeof contact.email === "string" ? contact.email : "";
      if (phone && (contactPhone === phone || contactPhone === phone.replace(/^\+/, ""))) return true;
      if (email && contactEmail.trim().toLowerCase() === email.toLowerCase()) return true;
      return false;
    });
    if (exact) return exact.id as string;
  }

  const createBody: Record<string, unknown> = { locationId: ghlLocationId, source };
  if (firstName) createBody.firstName = firstName;
  if (phone) createBody.phone = phone;
  if (email) createBody.email = email;
  if (tags && tags.length > 0) createBody.tags = [...tags];

  const createResponse = await fetchImpl(`${GHL_BASE}/contacts/`, {
    method: "POST",
    headers,
    body: JSON.stringify(createBody),
  });
  const createJson = await createResponse.json().catch(() => null);

  if (createResponse.ok) {
    const newId = createJson?.contact?.id ?? createJson?.id;
    if (typeof newId !== "string" || !newId) {
      throw new GhlContactError("GHL contact create returned no id");
    }
    return newId;
  }

  // A 400 carrying meta.contactId means the contact already exists.
  // Treat it as found, per reference_ghl_contact_create_duplicate.
  const duplicateId = createJson?.meta?.contactId;
  if (createResponse.status === 400 && typeof duplicateId === "string" && duplicateId) {
    return duplicateId;
  }

  throw new GhlContactError(
    `GHL contact create failed ${createResponse.status}: ${JSON.stringify(createJson).slice(0, 200)}`,
  );
}
