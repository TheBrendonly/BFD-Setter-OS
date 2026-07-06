import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ShieldCheck } from '@/components/icons';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// F17 phase 1 + F16 — per-client call automation + compliance toggles (agency-set):
//   recording_disclosure_enabled   F17: injects {{recording_disclosure}} on every
//                                  call (spoken line is PU-6, prompt-side).
//   speed_to_lead_enabled          F16(b): new lead -> AI call within 60s inside
//                                  the legal window (SMS fallback outside).
//   missed_call_textback_enabled   F16(c): an abandoned inbound call -> SMS back.
// All default OFF; the agency opts a client in here. Reads clients_public,
// writes clients (agency RLS).

type FlagKey = 'recording_disclosure_enabled' | 'speed_to_lead_enabled' | 'missed_call_textback_enabled';

const FLAGS: { key: FlagKey; label: string; help: string }[] = [
  {
    key: 'recording_disclosure_enabled',
    label: 'Call-recording disclosure',
    help: 'Injects a {{recording_disclosure}} variable on every call. Add the disclosure line to the agent prompt (referencing it) for NSW/WA/SA all-party consent.',
  },
  {
    key: 'speed_to_lead_enabled',
    label: 'Speed-to-lead auto-dial',
    help: 'A brand-new lead is AI-called within ~60s inside the legal calling window; outside hours they get an instant confirmation SMS instead.',
  },
  {
    key: 'missed_call_textback_enabled',
    label: 'Missed-call text-back',
    help: 'When an inbound call is abandoned (caller hangs up early), the setter texts back within ~60s to recover the lead into the SMS booking flow.',
  },
];

export function ComplianceSettingsCard({ clientId }: { clientId: string }) {
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>({
    recording_disclosure_enabled: false,
    speed_to_lead_enabled: false,
    missed_call_textback_enabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<FlagKey | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('clients_public')
          .select('recording_disclosure_enabled, speed_to_lead_enabled, missed_call_textback_enabled')
          .eq('id', clientId)
          .maybeSingle();
        if (error) throw error;
        if (live && data) {
          setFlags({
            recording_disclosure_enabled: data.recording_disclosure_enabled === true,
            speed_to_lead_enabled: data.speed_to_lead_enabled === true,
            missed_call_textback_enabled: data.missed_call_textback_enabled === true,
          });
        }
      } catch (err) {
        console.error('load call flags failed:', err);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [clientId]);

  const onToggle = async (key: FlagKey, v: boolean) => {
    setSavingKey(key);
    const prev = flags[key];
    setFlags((f) => ({ ...f, [key]: v }));
    try {
      const { error } = await (supabase as any)
        .from('clients')
        .update({ [key]: v })
        .eq('id', clientId);
      if (error) throw error;
      toast.success('Updated');
    } catch (err) {
      console.error(`save ${key} failed:`, err);
      setFlags((f) => ({ ...f, [key]: prev }));
      toast.error('Update failed');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return null;

  return (
    <Card className="material-surface">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          Calls &amp; compliance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {FLAGS.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor={f.key}>{f.label}</Label>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{f.help}</p>
            </div>
            <Switch
              id={f.key}
              checked={flags[f.key]}
              disabled={savingKey === f.key}
              onCheckedChange={(v) => onToggle(f.key, v)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
