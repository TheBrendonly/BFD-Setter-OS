// GHL contact find-or-create, shared (consolidated 2026-08-12).
//
// Three near-identical private copies existed: intake-lead/index.ts, receive-twilio-sms/
// index.ts, and demo-callback/ghlContact.ts (whose header comment tracked the debt and
// deferred it because consolidating means redeploying two live, load-bearing functions).
//
// They differed in real ways, so this is a superset with explicit options rather than a
// lowest common denominator. Every existing behaviour is reachable and no call site
// changes behaviour:
//   - lastName            : intake-lead sends one, the others do not.
//   - multiMatch          : receive-twilio-sms resolves >1 exact phone match by
//                           most-recently-updated (mirroring _shared/leadResolve.ts so
//                           the GHL fallback and the internal resolver agree on who owns
//                           a shared number). The others take the first match.
//   - outcome             : receive-twilio-sms labels the contact differently depending
//                           on whether it was found, created, or already existed.
//
// SEC-PII-LOGS-1: GHL error payloads echo the submitted phone and email back. Two of the
// three copies interpolated the response body into a thrown message that reaches
// console.error. This throws the STATUS only.

const GHL_BASE = "https://services.leadconnectorhq.com";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GhlContactError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "GhlContactError";
    this.status = status;
  }
}

export interface GhlContactArgs {
  readonly ghlApiKey: string;
  readonly ghlLocationId: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly source: string;
  readonly tags?: readonly string[];
  /**
   * How to resolve more than one EXACT match. "first" takes GHL's order (what
   * intake-lead and demo-callback have always done); "mostRecent" applies the
   * deterministic survivor rule receive-twilio-sms uses.
   */
  readonly multiMatch?: "first" | "mostRecent";
}

export interface GhlContactResult {
  readonly contactId: string;
  /** Best-known display name, "" when GHL did not give one. Callers apply their own fallback. */
  readonly name: string;
  readonly email: string;
  readonly outcome: "found" | "created" | "duplicate";
}

function headersFor(ghlApiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${ghlApiKey}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
    Accept: "application/json",
  };
}

function displayName(contact: Record<string, unknown>): string {
  const first = typeof contact.firstName === "string" ? contact.firstName : "";
  const last = typeof contact.lastName === "string" ? contact.lastName : "";
  const joined = [first, last].filter(Boolean).join(" ");
  if (joined) return joined;
  return typeof contact.contactName === "string" ? contact.contactName : "";
}

/**
 * Deterministic survivor when GHL returns several contacts for one phone:
 * most-recently-updated wins, tie-break by dateAdded desc, then id desc.
 * Date.parse(undefined) is NaN and NaN || 0 is 0, so missing dates sort last.
 */
function mostRecentFirst(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const au = Date.parse(String(a?.dateUpdated ?? "")) || 0;
  const bu = Date.parse(String(b?.dateUpdated ?? "")) || 0;
  if (bu !== au) return bu - au;
  const aa = Date.parse(String(a?.dateAdded ?? "")) || 0;
  const ba = Date.parse(String(b?.dateAdded ?? "")) || 0;
  if (ba !== aa) return ba - aa;
  return String(b?.id ?? "").localeCompare(String(a?.id ?? ""));
}

/**
 * Resolve a GHL contact id, creating the contact when no exact match exists.
 *
 * GHL's search is fuzzy, so a candidate is accepted only on an EXACT phone or email
 * match. Otherwise a partially-overlapping contact wins and the booking attaches to the
 * wrong person.
 */
export async function findOrCreateGhlContact(
  args: GhlContactArgs,
  fetchImpl: FetchLike = fetch,
): Promise<GhlContactResult> {
  const { ghlApiKey, ghlLocationId, firstName, lastName, email, phone, source, tags } = args;
  const headers = headersFor(ghlApiKey);
  const multiMatch = args.multiMatch ?? "first";

  for (const term of [phone, email].filter((v): v is string => !!v)) {
    const searchUrl = new URL(`${GHL_BASE}/contacts/search`);
    searchUrl.searchParams.set("locationId", ghlLocationId);
    searchUrl.searchParams.set("query", term);

    const response = await fetchImpl(searchUrl.toString(), { headers });
    if (!response.ok) {
      console.warn(`GHL contact search failed ${response.status}`);
      continue;
    }

    const payload = await response.json().catch(() => null);
    const contacts: unknown = payload?.contacts;
    if (!Array.isArray(contacts)) continue;

    const exact = (contacts as Array<Record<string, unknown>>).filter((contact) => {
      if (typeof contact?.id !== "string") return false;
      const contactPhone = typeof contact.phone === "string" ? contact.phone : "";
      const contactEmail = typeof contact.email === "string" ? contact.email : "";
      if (phone && (contactPhone === phone || contactPhone === phone.replace(/^\+/, ""))) return true;
      if (email && contactEmail.trim().toLowerCase() === email.trim().toLowerCase()) return true;
      return false;
    });
    if (exact.length === 0) continue;

    const winner = multiMatch === "mostRecent" ? [...exact].sort(mostRecentFirst)[0] : exact[0];
    return {
      contactId: winner.id as string,
      name: displayName(winner),
      email: typeof winner.email === "string" ? winner.email : "",
      outcome: "found",
    };
  }

  const createBody: Record<string, unknown> = { locationId: ghlLocationId, source };
  if (firstName) createBody.firstName = firstName;
  if (lastName) createBody.lastName = lastName;
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
      throw new GhlContactError("GHL contact create returned no id", createResponse.status);
    }
    return { contactId: newId, name: "", email: email ?? "", outcome: "created" };
  }

  // A 400 carrying meta.contactId means the contact already exists (the phone-only
  // search above can miss it). Treat it as found, per reference_ghl_contact_create_duplicate.
  const duplicateId = createJson?.meta?.contactId;
  if (createResponse.status === 400 && typeof duplicateId === "string" && duplicateId) {
    return {
      contactId: duplicateId,
      name: typeof createJson?.meta?.contactName === "string" ? createJson.meta.contactName : "",
      email: email ?? "",
      outcome: "duplicate",
    };
  }

  // Status only, never the body: it echoes the submitted phone and email (SEC-PII-LOGS-1).
  throw new GhlContactError(`GHL contact create failed ${createResponse.status}`, createResponse.status);
}

/**
 * Best-effort tag add on an EXISTING contact, so a reused contact is just as filterable
 * from real pipeline as a freshly created one. POST /contacts/:id/tags appends, unlike a
 * contact PUT with a tags array, which can clobber existing tags. Never throws: tagging
 * is bookkeeping, not the funnel.
 */
export async function addContactTags(
  args: { ghlApiKey: string; contactId: string; tags: readonly string[] },
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `${GHL_BASE}/contacts/${encodeURIComponent(args.contactId)}/tags`,
      {
        method: "POST",
        headers: headersFor(args.ghlApiKey),
        body: JSON.stringify({ tags: [...args.tags] }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort email update on an EXISTING contact. The booking confirmation email goes to
 * the address GHL holds, so when a returning submitter gives a different email the stored
 * one must be refreshed or the confirmation lands in a stale inbox. Never throws.
 */
export async function updateContactEmail(
  args: { ghlApiKey: string; contactId: string; email: string },
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `${GHL_BASE}/contacts/${encodeURIComponent(args.contactId)}`,
      {
        method: "PUT",
        headers: headersFor(args.ghlApiKey),
        body: JSON.stringify({ email: args.email }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
