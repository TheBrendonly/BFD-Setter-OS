import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2 } from '@/components/icons';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface QuietHoursConfig {
  start: string; // HH:MM
  end: string;   // HH:MM
  tz: string;    // IANA
  days: number[]; // 1=Mon ... 7=Sun
}

const DEFAULT_CONFIG: QuietHoursConfig = {
  start: '09:00',
  end: '21:00',
  tz: 'Australia/Sydney',
  days: [1, 2, 3, 4, 5, 6, 7],
};

const DAY_LABELS = [
  { num: 1, label: 'M' },
  { num: 2, label: 'T' },
  { num: 3, label: 'W' },
  { num: 4, label: 'T' },
  { num: 5, label: 'F' },
  { num: 6, label: 'S' },
  { num: 7, label: 'S' },
];

interface Props {
  clientId: string;
}

function parseConfig(raw: unknown): QuietHoursConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  const r = raw as Record<string, unknown>;
  return {
    start: typeof r.start === 'string' ? r.start : DEFAULT_CONFIG.start,
    end: typeof r.end === 'string' ? r.end : DEFAULT_CONFIG.end,
    tz: typeof r.tz === 'string' ? r.tz : DEFAULT_CONFIG.tz,
    days: Array.isArray(r.days)
      ? r.days.filter((d): d is number => typeof d === 'number' && d >= 1 && d <= 7)
      : DEFAULT_CONFIG.days,
  };
}

function isWithinWindow(now: Date, qh: QuietHoursConfig): boolean {
  try {
    const localStr = now.toLocaleString('en-US', { timeZone: qh.tz });
    const local = new Date(localStr);
    const dayJs = local.getDay();
    const day = dayJs === 0 ? 7 : dayJs;
    if (!qh.days.includes(day)) return false;
    const cur = local.toTimeString().slice(0, 5);
    const overnight = qh.start > qh.end;
    if (overnight) return cur >= qh.start || cur <= qh.end;
    return cur >= qh.start && cur <= qh.end;
  } catch {
    return false;
  }
}

export const ClientQuietHoursCard: React.FC<Props> = ({ clientId }) => {
  const [config, setConfig] = useState<QuietHoursConfig>(DEFAULT_CONFIG);
  const [clientTz, setClientTz] = useState<string>('Australia/Sydney');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('cadence_quiet_hours, timezone')
          .eq('id', clientId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const tz = (data as { timezone?: string | null } | null)?.timezone || 'Australia/Sydney';
        setClientTz(tz);
        const raw = (data as { cadence_quiet_hours?: unknown } | null)?.cadence_quiet_hours;
        // Default the qh.tz to the client's timezone if config is missing
        const parsed = raw ? parseConfig(raw) : { ...DEFAULT_CONFIG, tz };
        setConfig(parsed);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load quiet hours');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const handleSave = async () => {
    if (saving) return;
    if (config.days.length === 0) {
      toast.error('At least one day must be selected');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ cadence_quiet_hours: config })
        .eq('id', clientId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      setDirty(false);
      toast.success('Contact hours saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save contact hours');
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<QuietHoursConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setDirty(true);
  };

  const toggleDay = (day: number) => {
    update({
      days: config.days.includes(day)
        ? config.days.filter((d) => d !== day)
        : [...config.days, day].sort((a, b) => a - b),
    });
  };

  const livePreview = useMemo(() => {
    const now = new Date();
    const localStr = now.toLocaleString('en-AU', {
      timeZone: config.tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    const inWindow = isWithinWindow(now, config);
    return { localStr, inWindow };
  }, [config]);

  const busy = loading || saving;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-wide">
          Contact hours (cadence quiet-hours window)
        </CardTitle>
        <CardDescription className="text-xs">
          When the engagement cadence is allowed to send SMS / make calls / send emails. Outside this window, scheduled messages park until the next opening. Used by runEngagement. Defaults to 09:00–21:00 in the client timezone if unset; new client rows still get this default behaviour.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="qh-start" className="text-xs">Start (24h)</Label>
            <Input
              id="qh-start"
              type="time"
              value={config.start}
              onChange={(e) => update({ start: e.target.value })}
              disabled={busy}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qh-end" className="text-xs">End (24h)</Label>
            <Input
              id="qh-end"
              type="time"
              value={config.end}
              onChange={(e) => update({ end: e.target.value })}
              disabled={busy}
              className="h-9 text-sm"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Days (Mon–Sun)</Label>
          <div className="flex gap-1">
            {DAY_LABELS.map(({ num, label }) => {
              const on = config.days.includes(num);
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => toggleDay(num)}
                  disabled={busy}
                  className={`h-8 w-8 rounded text-xs font-medium border transition-colors ${
                    on
                      ? 'bg-green-500 text-white border-green-600'
                      : 'bg-background text-muted-foreground border-border hover:bg-muted'
                  } disabled:opacity-50`}
                  aria-pressed={on}
                  aria-label={`Day ${num}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="qh-tz" className="text-xs">Timezone (IANA)</Label>
          <Input
            id="qh-tz"
            value={config.tz}
            onChange={(e) => update({ tz: e.target.value })}
            placeholder={clientTz}
            disabled={busy}
            className="h-9 text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Defaults to the client timezone ({clientTz}). Override here only if cadence hours should differ from the client's primary zone.
          </p>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="text-[11px] text-muted-foreground">
            Now in {config.tz}: <span className="font-mono">{livePreview.localStr}</span> —
            within window: <span className={livePreview.inWindow ? 'text-green-600 font-semibold' : 'text-amber-600 font-semibold'}>{livePreview.inWindow ? 'Yes' : 'No'}</span>
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
