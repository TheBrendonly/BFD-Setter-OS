// Client for the public `demo-callback` edge function.
//
// Kept out of the page component so the request/response contract is unit
// testable under `npm run test:frontend`. Deliberately free of `import.meta.env`
// so it parses under Node's type-stripping test runner — the caller passes the
// endpoint and key in.

// Explicit .ts extension: `npm run test:frontend` runs this under Node's
// type-stripping runner, which does not resolve extensionless specifiers.
// tsconfig.app.json sets allowImportingTsExtensions, and Vite resolves it fine.
import { normalizePhone } from './normalizePhone.ts';

export interface DemoCallbackRequest {
  readonly slug: string;
  readonly firstName: string;
  readonly email: string;
  readonly phone: string;
}

export interface DemoCallbackConfig {
  readonly endpoint: string;
  readonly anonKey: string;
}

export type DemoCallbackResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const GENERIC_ERROR = "Something went wrong. Please try again.";
const AU_MOBILE = /^\+614\d{8}$/;

/**
 * Client-side pre-check so an obvious mistake is caught before a round trip.
 * The edge function re-validates everything; this is UX, never a security
 * boundary.
 */
export function validateLocally(request: DemoCallbackRequest): string | null {
  if (!request.firstName.trim()) return 'Please enter your first name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(request.email.trim())) {
    return 'Please enter a valid email address.';
  }
  const normalized = normalizePhone(request.phone, 'AU');
  if (!normalized || !AU_MOBILE.test(normalized)) {
    return 'Please enter a valid Australian mobile number.';
  }
  return null;
}

export async function requestDemoCallback(
  request: DemoCallbackRequest,
  config: DemoCallbackConfig,
  fetchImpl: FetchLike = fetch,
): Promise<DemoCallbackResult> {
  let response: Response;
  try {
    response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
      },
      body: JSON.stringify({
        slug: request.slug,
        first_name: request.firstName,
        email: request.email,
        phone: request.phone,
      }),
    });
  } catch {
    return { ok: false, error: 'Network error. Please check your connection and try again.' };
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : GENERIC_ERROR;
    return { ok: false, error: message };
  }
  if (payload?.ok !== true) {
    return { ok: false, error: GENERIC_ERROR };
  }
  return { ok: true };
}
