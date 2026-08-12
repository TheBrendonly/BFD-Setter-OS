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

// Slugs carry a short random suffix so a demo URL cannot be guessed from the
// firm's name alone. The page is unlisted + noindex; the suffix is the backstop
// against third parties finding a page that presents a real firm's branding.
export const DEMO_PROSPECTS: Readonly<Record<string, DemoProspect>> = {
  "stapleton-finance-b7q4": {
    slug: "stapleton-finance-b7q4",
    clientId: BFD_CLIENT_ID,
    voiceSetterId: "2dc0c2b7-694f-47d7-a783-fddb0c4108c0",
    firmName: "Stapleton Finance",
  },
};

export function resolveProspect(slug: unknown): DemoProspect | null {
  if (typeof slug !== "string") return null;
  const key = slug.trim().toLowerCase();
  // hasOwn guard: a slug of "__proto__"/"constructor" indexes the prototype
  // chain on a plain object and would throw further down instead of 404ing.
  if (!Object.hasOwn(DEMO_PROSPECTS, key)) return null;
  const prospect = DEMO_PROSPECTS[key];
  // A registry entry whose setter has not been provisioned yet must not dial.
  if (prospect.voiceSetterId.startsWith("__")) return null;
  return prospect;
}

// ── Rate limiting ──
// Four windows, all enforced, all through the same atomic bump_rate_limit RPC.
// Per-phone stops one number being dialled repeatedly. Per-slug caps the daily
// blast radius if a page URL leaks. Per-IP stops a single scripted client
// cycling distinct destination numbers (security review C1) — weak against a
// distributed attacker, but it turns "25 robocalls in one burst" into "25
// machines needed". Slug spacing forces >=60s between dials on one page, so
// the daily budget cannot be exhausted in seconds and a real prospect is not
// locked out by one burst.
export const PHONE_WINDOW_SECONDS = 3600;
export const PHONE_MAX_PER_WINDOW = 2;
export const SLUG_WINDOW_SECONDS = 86_400;
export const SLUG_MAX_PER_WINDOW = 25;
export const IP_WINDOW_SECONDS = 3600;
export const IP_MAX_PER_WINDOW = 5;
export const SLUG_SPACING_SECONDS = 60;
export const SLUG_SPACING_MAX = 1;

export function phoneBucketKey(normalizedPhone: string): string {
  return `demo-callback:phone:${normalizedPhone}`;
}

export function slugBucketKey(slug: string): string {
  return `demo-callback:slug:${slug}`;
}

export function ipBucketKey(ip: string): string {
  return `demo-callback:ip:${ip}`;
}

export function slugSpacingBucketKey(slug: string): string {
  return `demo-callback:slugmin:${slug}`;
}

/** First hop of x-forwarded-for, or null when the header is absent/blank. */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim();
  return first || null;
}

// ── Calling hours ──
// A prospect filling the form at 11pm should not receive an AI call at 11pm.
// Solicited, so likely lawful — but a bad look for a compliance-flavoured
// pitch. Coarse guard in the CLIENT's timezone (the demo tenant is AU).
export const CALL_HOURS_START = 8; // inclusive, local hour
export const CALL_HOURS_END = 20; // exclusive, local hour

export function isWithinCallingHours(now: Date, timeZone: string): boolean {
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-AU", {
        timeZone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    );
  } catch {
    // Unknown timezone string: fail open on the guard rather than dead-end the
    // funnel — the window is a courtesy, not a compliance gate.
    return true;
  }
  return hour >= CALL_HOURS_START && hour < CALL_HOURS_END;
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
