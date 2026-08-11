// Demo callback funnel — prospect registry + request validation.
//
// Pure module: no network, no Deno APIs, so the whole validation surface is unit
// testable in the `test:edge` suite CI actually gates on.
//
// WHY THE REGISTRY LIVES SERVER-SIDE: this endpoint places a real outbound call
// on BFD's Twilio + Retell accounts. If the browser could name the client_id or
// voice_setter_id, anyone could make the platform dial any number as any tenant.
// The browser sends only a slug; everything else is resolved here.
//
// Adding prospect #2: one entry below + one entry in
// frontend/src/data/demoProspects.ts (copy only). No code changes.

import { normalizePhone } from "../_shared/phone.ts";

export interface DemoProspect {
  /** URL slug, i.e. /g/<slug> */
  readonly slug: string;
  /** Tenant that owns the lead and places the call. */
  readonly clientId: string;
  /** voice_setters.id of this prospect's dedicated persona. */
  readonly voiceSetterId: string;
  /** Used only for logging and the lead's source field. */
  readonly firmName: string;
}

/** BFD (Building Flow Digital). Demo prospects are BFD leads, so they are tenanted here. */
const BFD_CLIENT_ID = "e467dabc-57ee-416c-8831-83ecd9c7c925";

export const DEMO_PROSPECTS: Readonly<Record<string, DemoProspect>> = {
  "stapleton-finance": {
    slug: "stapleton-finance",
    clientId: BFD_CLIENT_ID,
    voiceSetterId: "__PENDING_SETTER_ID__",
    firmName: "Stapleton Finance",
  },
};

export function resolveProspect(slug: unknown): DemoProspect | null {
  if (typeof slug !== "string") return null;
  const prospect = DEMO_PROSPECTS[slug.trim().toLowerCase()];
  if (!prospect) return null;
  // A registry entry whose setter has not been provisioned yet must not dial.
  if (prospect.voiceSetterId.startsWith("__")) return null;
  return prospect;
}

// ── Rate limiting ──
// Both windows are enforced. Per-phone stops one number being dialled
// repeatedly; per-slug caps the blast radius if a page URL leaks.
export const PHONE_WINDOW_SECONDS = 3600;
export const PHONE_MAX_PER_WINDOW = 2;
export const SLUG_WINDOW_SECONDS = 86_400;
export const SLUG_MAX_PER_WINDOW = 25;

export function phoneBucketKey(normalizedPhone: string): string {
  return `demo-callback:phone:${normalizedPhone}`;
}

export function slugBucketKey(slug: string): string {
  return `demo-callback:slug:${slug}`;
}

// ── Request validation ──

export interface ValidCallbackRequest {
  readonly firstName: string;
  readonly email: string;
  readonly normalizedPhone: string;
  readonly rawPhone: string;
}

export type ValidationResult =
  | { readonly ok: true; readonly value: ValidCallbackRequest }
  | { readonly ok: false; readonly error: string };

const MAX_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;
// Deliberately narrow: AU mobiles only. The ICP is AU, and an unrestricted
// destination range on a public endpoint is an international toll-fraud vector.
const AU_MOBILE = /^\+614\d{8}$/;
// Intentionally loose. Real deliverability is proven by the confirmation email
// GHL sends on booking, not by a regex.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateCallbackRequest(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body." };
  }
  const { first_name: firstNameRaw, email: emailRaw, phone: phoneRaw } = body as Record<
    string,
    unknown
  >;

  if (typeof firstNameRaw !== "string" || !firstNameRaw.trim()) {
    return { ok: false, error: "Please enter your first name." };
  }
  const firstName = firstNameRaw.trim().slice(0, MAX_NAME_LENGTH);

  if (typeof emailRaw !== "string" || !EMAIL_SHAPE.test(emailRaw.trim())) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  const email = emailRaw.trim().slice(0, MAX_EMAIL_LENGTH).toLowerCase();

  if (typeof phoneRaw !== "string" || !phoneRaw.trim()) {
    return { ok: false, error: "Please enter your mobile number." };
  }
  const normalizedPhone = normalizePhone(phoneRaw, "AU");
  if (!normalizedPhone || !AU_MOBILE.test(normalizedPhone)) {
    return { ok: false, error: "Please enter a valid Australian mobile number." };
  }

  return {
    ok: true,
    value: { firstName, email, normalizedPhone, rawPhone: phoneRaw.trim() },
  };
}
