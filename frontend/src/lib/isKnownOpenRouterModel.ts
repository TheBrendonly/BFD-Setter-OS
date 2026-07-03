// MODEL-1-HARDENING — membership check for a candidate OpenRouter model id
// against the fetched/known model list. Used to gate OpenRouterModelSelector's
// "use as custom model" escape hatch behind an explicit confirmation instead
// of accepting any slash-containing string unchecked.

export function isKnownOpenRouterModelId(
  id: string,
  knownModels: Array<{ id: string }>
): boolean {
  const needle = id.trim().toLowerCase();
  if (!needle) return false;
  return knownModels.some((m) => m.id.trim().toLowerCase() === needle);
}
