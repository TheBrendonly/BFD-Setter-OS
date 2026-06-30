// F8 — the SINGLE boundary crossing between the React app and the shared,
// Deno-tested money-math core. The core lives under
// frontend/supabase/functions/_shared/ so `npm run test:edge` covers it; the
// frontend imports it through this one shim (consumers import `@/lib/blendedRate`)
// so there is exactly ONE place that reaches across into functions/_shared and
// exactly ONE math implementation. Do NOT raw-import the core from feature code.
export * from "../../supabase/functions/_shared/computeBlendedRate.ts";
export * from "../../supabase/functions/_shared/pricingDefaults.ts";
