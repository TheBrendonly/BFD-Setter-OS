import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Loader2 } from '@/components/icons';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// Per-client cold-reply nudge config. When the AI setter sends a message that
// warrants a reply and the lead goes quiet, nudgeColdReply re-contacts them a
// set number of times, spaced apart, inside the client's contact hours. This
// card exposes "how many nudges, how far apart" (previously hardcoded in the
// trigger task). Mirrors the validation in trigger/_shared/nudgeConfig.ts.
//
// Agency-only surface: reads/writes the base clients row directly (GATE A
// gates base clients SELECT to agency-role).

const DEFAULT_OFFSETS = [24, 72];
const DEFAULT_RECOVERY_DAYS = 14;
const MAX_NUDGES = 10;
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 24 * 30;

function parseOffsets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_OFFSETS];
  const cleaned = raw
    .map((v) => (typeof v === 'number' ? v : Number(v)))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.min(Math.max(Math.round(n), MIN_INTERVAL_HOURS), MAX_INTERVAL_HOURS))
    .slice(0, MAX_NUDGES);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_OFFSETS];
}

interface Props {
  clientId: string;
}

export const ClientNudgeSettingsCard: React.FC<Props> = ({ clientId }) => {
  const [enabled, setEnabled] = useState(true);
  const [offsets, setOffsets] = useState<number[]>(DEFAULT_OFFSETS);
  const [recoveryDays, setRecoveryDays] = useState(DEFAULT_RECOVERY_DAYS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await (supabase as any)
          .from('clients')
          .select('nudge_enabled, nudge_offsets_hours, nudge_recovery_window_hours')
          .eq('id', clientId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const row = (data ?? {}) as {
          nudge_enabled?: boolean | null;
          nudge_offsets_hours?: unknown;
          nudge_recovery_window_hours?: number | null;
        };
        setEnabled(row.nudge_enabled !== false);
        setOffsets(parseOffsets(row.nudge_offsets_hours));
        const hours = Number(row.nudge_recovery_window_hours);
        setRecoveryDays(Number.isFinite(hours) && hours > 0 ? Math.round(hours / 24) : DEFAULT_RECOVERY_DAYS);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load nudge settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const markDirty = () => setDirty(true);

  const updateOffset = (index: number, value: number) => {
    setOffsets((prev) => prev.map((o, i) => (i === index ? value : o)));
    markDirty();
  };

  const addNudge = () => {
    if (offsets.length >= MAX_NUDGES) return;
    setOffsets((prev) => [...prev, prev[prev.length - 1] ?? 24]);
    markDirty();
  };

  const removeNudge = (index: number) => {
    if (offsets.length <= 1) return;
    setOffsets((prev) => prev.filter((_, i) => i !== index));
    markDirty();
  };

  const handleSave = async () => {
    if (saving) return;
    const cleaned = offsets
      .map((n) => Math.min(Math.max(Math.round(Number(n) || 0), MIN_INTERVAL_HOURS), MAX_INTERVAL_HOURS))
      .slice(0, MAX_NUDGES);
    if (cleaned.length === 0) {
      toast.error('Add at least one nudge, or turn nudges off');
      return;
    }
    const recoveryHours = Math.max(1, Math.round(recoveryDays)) * 24;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from('clients')
        .update({
          nudge_enabled: enabled,
          nudge_offsets_hours: cleaned,
          nudge_recovery_window_hours: recoveryHours,
        })
        .eq('id', clientId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      setOffsets(cleaned);
      setDirty(false);
      toast.success('Nudge settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save nudge settings');
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || saving;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-wide">
          Reply nudges (unanswered messages)
        </CardTitle>
        <CardDescription className="text-xs">
          When the setter sends a message that expects a reply and the lead goes quiet, re-contact
          them this many times, spaced this far apart, referencing the unanswered message. Nudges
          only send inside your contact hours and stop the moment the lead replies or opts out.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="nudge-enabled" className="text-xs">Send reply nudges</Label>
          <Switch
            id="nudge-enabled"
            checked={enabled}
            onCheckedChange={(on) => { setEnabled(on); markDirty(); }}
            disabled={busy}
          />
        </div>

        <div className={`space-y-2 ${enabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <Label className="text-xs">Nudge schedule</Label>
          <div className="space-y-2">
            {offsets.map((hours, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">Nudge {i + 1}</span>
                <span className="text-xs text-muted-foreground">send</span>
                <Input
                  type="number"
                  min={MIN_INTERVAL_HOURS}
                  max={MAX_INTERVAL_HOURS}
                  value={hours}
                  onChange={(e) => updateOffset(i, Number(e.target.value))}
                  disabled={busy}
                  className="h-8 w-20 text-sm"
                  aria-label={`Nudge ${i + 1} hours after previous message`}
                />
                <span className="text-xs text-muted-foreground">hours after the previous message</span>
                <button
                  type="button"
                  onClick={() => removeNudge(i)}
                  disabled={busy || offsets.length <= 1}
                  className="ml-auto text-muted-foreground hover:text-destructive disabled:opacity-30"
                  aria-label={`Remove nudge ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addNudge}
            disabled={busy || offsets.length >= MAX_NUDGES}
            className="h-8"
          >
            <Plus className="h-3 w-3 mr-1" /> Add nudge
          </Button>

          <div className="space-y-1 pt-2">
            <Label htmlFor="nudge-recovery" className="text-xs">Give up after the lead is silent for (days)</Label>
            <Input
              id="nudge-recovery"
              type="number"
              min={1}
              value={recoveryDays}
              onChange={(e) => { setRecoveryDays(Number(e.target.value)); markDirty(); }}
              disabled={busy}
              className="h-9 w-28 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              After this, the lead is tagged silent and drops out of nudging (into long-tail nurture once that ships).
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="text-[11px] text-muted-foreground">
            {enabled
              ? `${offsets.length} nudge${offsets.length === 1 ? '' : 's'} per unanswered message`
              : 'Reply nudges are off for this client'}
          </div>
          <Button size="sm" onClick={handleSave} disabled={busy || !dirty}>
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
