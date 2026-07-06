import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ShieldCheck } from '@/components/icons';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// F17 phase 1 — per-client call-recording disclosure toggle (agency-set). The
// engine injects a {{recording_disclosure}} dynamic variable ("required" /
// "not_required") on every outbound + inbound call; the spoken LINE is PU-6
// (Brendan authors it in the prompt to reference the variable). This only flips
// the flag; it is inert until the prompt references the variable.

export function ComplianceSettingsCard({ clientId }: { clientId: string }) {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('clients_public')
          .select('recording_disclosure_enabled')
          .eq('id', clientId)
          .maybeSingle();
        if (error) throw error;
        if (live) setEnabled(data?.recording_disclosure_enabled === true);
      } catch (err) {
        console.error('load recording_disclosure_enabled failed:', err);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [clientId]);

  const onToggle = async (v: boolean) => {
    setSaving(true);
    const prev = enabled;
    setEnabled(v);
    try {
      const { error } = await (supabase as any)
        .from('clients')
        .update({ recording_disclosure_enabled: v })
        .eq('id', clientId);
      if (error) throw error;
      toast.success('Recording disclosure updated');
    } catch (err) {
      console.error('save recording_disclosure_enabled failed:', err);
      setEnabled(prev);
      toast.error('Update failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <Card className="material-surface">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          Compliance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="rec-disclosure">Call-recording disclosure</Label>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
              Injects a {'{{recording_disclosure}}'} variable on every call. Add the disclosure line to
              the agent prompt (referencing that variable) for NSW/WA/SA all-party consent.
            </p>
          </div>
          <Switch id="rec-disclosure" checked={enabled} disabled={saving} onCheckedChange={onToggle} />
        </div>
      </CardContent>
    </Card>
  );
}
