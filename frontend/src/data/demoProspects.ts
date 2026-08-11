// Per-prospect copy for the /g/:slug demo callback pages.
//
// COPY ONLY. No client_id, no voice_setter_id — those live server-side in
// supabase/functions/demo-callback/prospects.ts, because this file ships to the
// browser and the endpoint places real outbound calls.
//
// Adding prospect #2: one entry here + one entry in the server registry + a
// dedicated Retell persona. No component changes.
//
// NOTE FOR BRENDAN: this copy is a first draft in your voice's general shape,
// not a finished asset. Edit freely — it is plain text and needs no redeploy
// beyond the usual frontend push.

export interface DemoProspectCopy {
  readonly slug: string;
  /** Firm being demoed to. Shown prominently. */
  readonly firmName: string;
  /** How Gary refers to the principal on the call. Keep in sync with the persona. */
  readonly principalFirstName: string;
  readonly eyebrow: string;
  readonly headline: string;
  readonly subhead: string;
  /** Three short proof points. Keep each under ~70 characters. */
  readonly bullets: readonly [string, string, string];
}

// Slug keys carry the same random suffix as the server registry, so a demo URL
// cannot be guessed from the firm's name alone.
export const DEMO_PROSPECT_COPY: Readonly<Record<string, DemoProspectCopy>> = {
  'stapleton-finance-b7q4': {
    slug: 'stapleton-finance-b7q4',
    firmName: 'Stapleton Finance',
    principalFirstName: 'Gayle',
    eyebrow: 'A live demo, built for Stapleton Finance',
    headline: 'See what one of your enquiries feels like when it gets answered in under a minute.',
    subhead:
      "Put your details in below. Gary is an AI setter set up for Stapleton Finance. He'll ring you back in about a minute, qualify you the way he'd qualify a real enquiry, and book the meeting on a live calendar.",
    bullets: [
      'Calls back in under a minute, not the next business day',
      'Qualifies on purpose, timeline, and deposit or equity',
      'Never gives credit advice, books the broker instead',
    ],
  },
};

export function getDemoProspectCopy(slug: string | undefined): DemoProspectCopy | null {
  if (!slug) return null;
  return DEMO_PROSPECT_COPY[slug.trim().toLowerCase()] ?? null;
}
