// F9 — per-setter Retell lock, guard core (pure; no supabase-js / no HTTP).
//
// When voice_setters.is_retell_locked is true, BFD stops managing that setter:
//   - single-target write actions THROW a LockError (HTTP 423),
//   - bulk loops SKIP the locked setter and keep processing the rest,
//   - the outbound call path skips the at-call voicemail PATCH but still dials.
//
// The DB query (one SELECT of the client's locked setters) stays in the edge
// function; this module turns those rows into an index and exposes pure
// predicates + asserts so the logic is unit-testable.

export const LOCK_HTTP_STATUS = 423; // WebDAV "Locked" — precise + non-colliding
export const LOCK_ERROR_CODE = "setter_retell_locked";

/** Subset of a voice_setters row needed to decide a lock. */
export interface LockedSetterRow {
  retell_agent_id: string | null;
  retell_llm_id: string | null;
  legacy_slot: number | null;
  name: string | null;
}

/** Built once per request from the locked-setters query. */
export interface LockIndex {
  agentIds: Set<string>;
  llmIds: Set<string>;
  slots: Set<number>;
  nameByAgentId: Map<string, string>;
  nameBySlot: Map<number, string>;
  isEmpty: boolean;
}

/** Thrown by the single-target asserts; carries status + code for the catch block. */
export class LockError extends Error {
  readonly status = LOCK_HTTP_STATUS;
  readonly code = LOCK_ERROR_CODE;
  readonly setterName?: string;
  constructor(setterName?: string) {
    super(
      setterName
        ? `Voice setter "${setterName}" is Retell-locked. BFD will not overwrite your Retell edits. Unlock it in Prompt Management to resume BFD management.`
        : `This voice setter is Retell-locked. Unlock it to resume BFD management.`,
    );
    this.name = "LockError";
    this.setterName = setterName;
  }
}

/** PURE: build the lock index from the query rows. */
export function buildLockIndex(rows: LockedSetterRow[]): LockIndex {
  const idx: LockIndex = {
    agentIds: new Set<string>(),
    llmIds: new Set<string>(),
    slots: new Set<number>(),
    nameByAgentId: new Map<string, string>(),
    nameBySlot: new Map<number, string>(),
    isEmpty: rows.length === 0,
  };
  for (const r of rows) {
    const nm = r.name ?? "this setter";
    if (r.retell_agent_id) {
      idx.agentIds.add(r.retell_agent_id);
      idx.nameByAgentId.set(r.retell_agent_id, nm);
    }
    if (r.retell_llm_id) idx.llmIds.add(r.retell_llm_id);
    if (r.legacy_slot != null) {
      idx.slots.add(r.legacy_slot);
      idx.nameBySlot.set(r.legacy_slot, nm);
    }
  }
  return idx;
}

// PURE predicates — used by bulk SKIP loops and the outbound voicemail-skip.
export function isSlotLocked(idx: LockIndex, slot: number | null): boolean {
  return slot != null && idx.slots.has(slot);
}
export function isAgentLocked(idx: LockIndex, agentId: string | null): boolean {
  return !!agentId && idx.agentIds.has(agentId);
}
export function isLlmLocked(idx: LockIndex, llmId: string | null): boolean {
  return !!llmId && idx.llmIds.has(llmId);
}

// PURE asserts — used by single-target THROW actions. No-op when not locked.
export function assertSlotNotLocked(idx: LockIndex, slot: number | null): void {
  if (isSlotLocked(idx, slot)) throw new LockError(idx.nameBySlot.get(slot as number));
}
export function assertAgentNotLocked(idx: LockIndex, agentId: string | null): void {
  if (isAgentLocked(idx, agentId)) throw new LockError(idx.nameByAgentId.get(agentId as string));
}
export function assertLlmNotLocked(idx: LockIndex, llmId: string | null): void {
  if (isLlmLocked(idx, llmId)) throw new LockError();
}
