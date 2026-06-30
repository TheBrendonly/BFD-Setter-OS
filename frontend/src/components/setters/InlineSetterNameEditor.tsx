import React, { useEffect, useRef, useState } from 'react';
import { Pencil, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useClientCredentials } from '@/hooks/useClientCredentials';
import { setterKey, type SetterKind } from '@/lib/setterLabels';
import { cn } from '@/lib/utils';

interface Props {
  clientId: string;
  kind: SetterKind;
  slot: number;
  /** Shown when no custom name is set (e.g. "SETTER-1" / "Voice-Setter-1"). */
  fallback: string;
  /** className passed to the heading span (sizing/font). */
  className?: string;
  /** Inline style for the heading span. */
  style?: React.CSSProperties;
  /** Optional placeholder for the Input. Defaults to fallback. */
  placeholder?: string;
  /** Optional callback after a successful save. */
  onSaved?: (newName: string) => void;
  /**
   * F9-1: when true (voice setter is Retell-locked), the inline rename is refused —
   * no setter_display_names write, clear "unlock to rename" error. Without this the
   * editor wrote the display name unconditionally, then the guarded Retell push 423'd,
   * leaving the tile showing a name that never reached Retell / voice_setters.
   */
  isLocked?: boolean;
}

/**
 * Inline-edit-on-hover setter name editor.
 *
 * Single source of truth: clients.setter_display_names (JSONB column on clients).
 * Same write path as SetterDisplayNamesCard so the name propagates to:
 *   - Front Voice/Text Setter list cards (white CardTitle)
 *   - Editor heading (this component, rendered at top of editor body)
 *   - Logs page (setterLabel helper)
 *   - Simulator page
 *   - OutboundCallProcessing page
 * For voice setters, on save we also PATCH the Retell agent's agent_name via
 * retell-proxy's `set-agent-name` action (lightweight: PATCH + publish + repoint
 * phone version; never touches LLM prompt or voice). Text setters skip the Retell
 * push since they have no Retell agent.
 *
 * UX:
 *   - Hover the heading: pencil icon fades in (right side).
 *   - Click anywhere on the heading row OR the pencil icon to enter edit mode.
 *   - Edit mode shows an inline input with the current value (or empty if fallback).
 *     Enter or click checkmark to save; Escape or click X to cancel.
 *   - Blur also saves (so clicking outside commits).
 *   - On save: toast confirms; voice setters get a "+ pushed to Retell agent" suffix.
 *   - On Retell push failure: toast shows warning with the backend message.
 */
export const InlineSetterNameEditor: React.FC<Props> = ({
  clientId,
  kind,
  slot,
  fallback,
  className,
  style,
  placeholder,
  onSaved,
  isLocked,
}) => {
  const { credentials, updateCredential } = useClientCredentials(clientId);
  const stored = (credentials?.setter_display_names ?? {}) as Record<string, string>;
  const key = setterKey(kind, slot);
  const currentName = (stored[key] ?? '').trim();
  // F9-1: lock only applies to voice setters (text setters have no Retell agent).
  const renameLocked = !!isLocked && kind === 'voice';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep draft in sync when the stored value changes (e.g. another tab edits).
  useEffect(() => {
    if (!editing) setDraft(currentName);
  }, [currentName, editing]);

  // Autofocus + select-all when entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const enterEdit = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (saving) return;
    // F9-1: a Retell-locked voice setter cannot be renamed inline — refuse clearly
    // instead of letting the user type a name that won't reach Retell / voice_setters.
    if (renameLocked) {
      toast.error('Retell-locked — unlock this setter to rename it');
      return;
    }
    setDraft(currentName);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(currentName);
    setEditing(false);
  };

  const commitEdit = async () => {
    // F9-1: belt-and-suspenders — even if edit mode was entered (e.g. via blur),
    // a locked voice setter never writes setter_display_names. No silent leak.
    if (renameLocked) {
      toast.error('Retell-locked — unlock this setter to rename it');
      setEditing(false);
      return;
    }
    const newVal = draft.trim();
    if (newVal === currentName) {
      setEditing(false);
      return;
    }

    const next: Record<string, string> = { ...stored };
    if (newVal) next[key] = newVal;
    else delete next[key];

    setSaving(true);
    try {
      await updateCredential({ field: 'setter_display_names', value: next });

      // Push voice names to Retell as agent_name. Skip for text (no Retell agent).
      let retellWarning: string | null = null;
      if (kind === 'voice' && newVal) {
        try {
          const { data: retellResult, error: retellError } = await supabase.functions.invoke('retell-proxy', {
            body: {
              action: 'set-agent-name',
              clientId,
              slotNumber: slot,
              agentName: newVal,
            },
          });
          if (retellError) {
            retellWarning = retellError.message || 'Retell push failed';
          } else if (retellResult?.action === 'skipped_no_agent') {
            retellWarning = retellResult.reason || 'No Retell agent exists for this slot yet — name saved locally';
          } else if (retellResult?.action === 'patched_but_publish_failed') {
            retellWarning = `Name saved + agent updated but publish-agent failed: ${retellResult.publish_error || 'unknown error'}. Try a full Push to Retell from the editor.`;
          }
        } catch (retellErr) {
          retellWarning = retellErr instanceof Error ? retellErr.message : 'Retell push failed';
        }
      }

      if (retellWarning) {
        toast.warning('Setter name saved (Retell push warning)', { description: retellWarning, duration: 9000 });
      } else if (kind === 'voice' && newVal) {
        toast.success('Setter name saved + pushed to Retell agent');
      } else {
        toast.success(newVal ? 'Setter name saved' : 'Setter name cleared');
      }

      setEditing(false);
      onSaved?.(newVal);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save name');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const displayName = currentName || fallback;

  if (editing) {
    return (
      <div className="inline-flex items-center gap-2 max-w-full">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { void commitEdit(); }}
          disabled={saving}
          placeholder={placeholder || fallback}
          maxLength={64}
          className={cn(
            'bg-background border-b-2 border-primary outline-none px-1 py-0.5 min-w-[10ch] max-w-full',
            className,
          )}
          style={style}
          onClick={(e) => e.stopPropagation()}
        />
        {saving ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
        ) : (
          <>
            <button
              type="button"
              aria-label="Save name"
              onMouseDown={(e) => { e.preventDefault(); void commitEdit(); }}
              className="text-green-600 hover:text-green-500 shrink-0"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Cancel rename"
              onMouseDown={(e) => { e.preventDefault(); cancelEdit(); }}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={enterEdit}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') enterEdit(); }}
      className={cn(
        'group inline-flex items-center gap-2 cursor-text hover:opacity-90 transition-opacity',
        className,
      )}
      style={style}
      title="Click to rename (saves on enter or blur)"
    >
      <span className="truncate max-w-full">{displayName}</span>
      <Pencil
        className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
        aria-hidden="true"
      />
    </span>
  );
};
