export type SetterKind = 'voice' | 'text';

export type SetterDisplayNames = Record<string, string>;

export function setterLabel(
  kind: SetterKind,
  slot: number | string | null | undefined,
  map?: SetterDisplayNames | null,
): string {
  const n = typeof slot === 'number' ? slot : Number(slot);
  if (!Number.isFinite(n)) return 'Setter';
  const key = `${kind}-${n}`;
  const custom = map?.[key]?.trim();
  if (custom) return custom;
  return `Setter ${n}`;
}

export function setterKey(kind: SetterKind, slot: number): string {
  return `${kind}-${slot}`;
}
