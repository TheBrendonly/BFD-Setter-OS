// MODEL-1-HARDENING — membership check for a candidate OpenRouter model id
// against the fetched/known model list. Used to gate OpenRouterModelSelector's
// "use as custom model" escape hatch behind an explicit confirmation instead
// of accepting any slash-containing string unchecked.
//
// Review follow-up: matching is case-insensitive but OpenRouter ids are
// case-sensitive lowercase slugs, so the CANONICAL id from the list is what
// must be saved — echoing the user's casing ("Google/Gemini-2.5-Flash")
// through the "known id" fast path would recreate the silent-400 class this
// gate exists to stop.

export function findKnownOpenRouterModelId(
  id: string,
  knownModels: Array<{ id: string }>
): string | null {
  const needle = id.trim().toLowerCase();
  if (!needle) return null;
  const match = knownModels.find((m) => m.id.trim().toLowerCase() === needle);
  return match ? match.id.trim() : null;
}

export function isKnownOpenRouterModelId(
  id: string,
  knownModels: Array<{ id: string }>
): boolean {
  return findKnownOpenRouterModelId(id, knownModels) !== null;
}
