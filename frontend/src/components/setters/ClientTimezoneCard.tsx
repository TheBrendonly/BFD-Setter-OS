import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  clientId: string;
  title?: string;
  description?: string;
}

// Common IANA timezones for the dropdown — same list as ClientSettings for consistency.
// Drives voice-booking-tools time formatting, make-retell-outbound-call's `current_timezone`
// dynamic var, cadence quiet-hours scheduling, and what the voice agent says ("Sydney time" etc.).
const TZ_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEDT/AEST)' },
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEDT/AEST)' },
  { value: 'Australia/Brisbane', label: 'Australia/Brisbane (AEST)' },
  { value: 'Australia/Adelaide', label: 'Australia/Adelaide (ACDT/ACST)' },
  { value: 'Australia/Perth', label: 'Australia/Perth (AWST)' },
  { value: 'Australia/Darwin', label: 'Australia/Darwin (ACST)' },
  { value: 'Australia/Hobart', label: 'Australia/Hobart (AEDT/AEST)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZDT/NZST)' },
  { value: 'America/New_York', label: 'America/New_York (EDT/EST)' },
  { value: 'America/Chicago', label: 'America/Chicago (CDT/CST)' },
  { value: 'America/Denver', label: 'America/Denver (MDT/MST)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PDT/PST)' },
  { value: 'Europe/London', label: 'Europe/London (BST/GMT)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CEST/CET)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'UTC', label: 'UTC' },
];

export const ClientTimezoneCard: React.FC<Props> = ({ clientId, title, description }) => {
  const [tz, setTz] = useState<string>('Australia/Sydney');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('clients_public')
          .select('timezone')
          .eq('id', clientId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const value = (data as { timezone?: string | null } | null)?.timezone || 'Australia/Sydney';
        setTz(value);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load timezone');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const handleChange = async (next: string) => {
    if (next === tz || saving) return;
    setSaving(true);
    const prev = tz;
    setTz(next);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ timezone: next })
        .eq('id', clientId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      toast.success(`Timezone set to ${next}`);
    } catch (err) {
      setTz(prev);
      toast.error(err instanceof Error ? err.message : 'Failed to save timezone');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-wide">
          {title || 'Client Timezone'}
        </CardTitle>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <div>
            <Label className="text-xs">Timezone (IANA)</Label>
            <Select value={tz} onValueChange={handleChange} disabled={loading || saving}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder={loading ? 'Loading...' : 'Select timezone'} />
              </SelectTrigger>
              <SelectContent>
                {TZ_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Drives booking time formatting, cadence quiet-hours scheduling, what the voice agent says
            ("Sydney time", etc.), and the auto-injected Current Date & Time label in the Retell prompt.
            Saved on change.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
