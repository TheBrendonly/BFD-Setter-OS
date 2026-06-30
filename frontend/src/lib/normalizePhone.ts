// Frontend mirror of supabase/functions/_shared/phone.ts (and trigger/_shared/phone.ts).
// Keep byte-identical with those — single source of truth for phone normalization.
// E.164 output, AU default region. Dependency-free; extend region handling when a
// non-AU client lands. Used by ContactDetail to recompute normalized_phone on save
// (PHONE-CLEAR-1), since the lead-detail save writes leads directly from the browser.
export function normalizePhone(raw: string | null | undefined, region: string = "AU"): string | null {
  if (!raw) return null;
  const hadPlus = raw.trim().startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (hadPlus) {
    // Already international; trust the digits after the +.
    return digits.length >= 8 ? `+${digits}` : null;
  }
  if (region === "AU") {
    // AU national: 0XXXXXXXXX (10 digits) -> +61XXXXXXXXX
    if (digits.length === 10 && digits.startsWith("0")) return `+61${digits.slice(1)}`;
    // Bare AU subscriber number without trunk 0 (9 digits, mobile starts 4)
    if (digits.length === 9 && digits.startsWith("4")) return `+61${digits}`;
    // Already has 61 country code without +
    if (digits.startsWith("61") && digits.length === 11) return `+${digits}`;
  }
  // Fallback: a plausible-length raw international number without +.
  if (digits.length >= 11) return `+${digits}`;
  return null;
}
