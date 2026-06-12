// Public base URL for this project's Supabase Edge Functions, derived from the
// same env var the generated client uses (VITE_SUPABASE_URL). Use this ONLY for
// the few places that need a literal function URL — user-facing "copy this URL"
// fields and third-party webhook registration (Retell termination_uri, GHL
// workflow webhooks). For actual calls from the app, prefer
// supabase.functions.invoke(), which needs no URL and forwards the user's JWT.
//
// Historically several components hardcoded a now-dead project ref
// (qfbhcixkxzivpmxlciot). Deriving from VITE_SUPABASE_URL keeps every surface
// pointed at the live project automatically.
export const SUPABASE_PUBLIC_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";

export const edgeFunctionUrl = (slug: string): string =>
  `${SUPABASE_PUBLIC_URL}/functions/v1/${slug}`;
