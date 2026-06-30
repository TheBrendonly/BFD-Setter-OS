// F8 — currency-aware minor-unit money formatter (Intl-based).
//
// `minor` is an integer in the currency's minor unit (cents by default, but pass
// minorPerMajor: 1_000_000 to render micro-precise rate-table line items). This is
// a NEW helper; UsageCredits.tsx keeps its own USD-only `formatCurrency` untouched.
export interface FormatMinorCurrencyOptions {
  locale?: string;
  minorPerMajor?: number;
  maximumFractionDigits?: number;
}

export function formatMinorCurrency(
  minor: number,
  currency: string,
  opts: FormatMinorCurrencyOptions = {},
): string {
  const { locale = "en-AU", minorPerMajor = 100, maximumFractionDigits } = opts;
  const major = minor / minorPerMajor;
  const fmtOpts: Intl.NumberFormatOptions = { style: "currency", currency };
  if (maximumFractionDigits != null) fmtOpts.maximumFractionDigits = maximumFractionDigits;
  return new Intl.NumberFormat(locale, fmtOpts).format(major);
}
