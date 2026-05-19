import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2 } from '@/components/icons';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type VoicemailMode = 'hangup' | 'static' | 'prompt';

interface VoicemailConfig {
  mode: VoicemailMode;
  text: string | null;
}

const DEFAULT_CONFIG: VoicemailConfig = { mode: 'hangup', text: null };

interface Props {
  clientId: string;
  title?: string;
  description?: string;
}

export const ClientVoicemailCard: React.FC<Props> = ({ clientId, title, description }) => {
  const [config, setConfig] = useState<VoicemailConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('voicemail_config')
          .eq('id', clientId)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const raw = (data as { voicemail_config?: unknown } | null)?.voicemail_config;
        if (raw && typeof raw === 'object') {
          const r = raw as Record<string, unknown>;
          const mode = (r.mode as VoicemailMode) || 'hangup';
          const text = typeof r.text === 'string' ? r.text : null;
          setConfig({ mode, text });
        } else {
          setConfig(DEFAULT_CONFIG);
        }
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load voicemail config');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const persistAndPush = async (next: VoicemailConfig) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('clients')
        .update({ voicemail_config: next })
        .eq('id', clientId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      setConfig(next);
      toast.success('Voicemail config saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save voicemail config');
      return;
    } finally {
      setSaving(false);
    }

    // Push to Retell agents
    setPushing(true);
    try {
      const { data, error } = await supabase.functions.invoke('retell-proxy', {
        body: { action: 'set-voicemail', clientId },
      });
      if (error) throw error;
      const r = data as { success?: boolean; action?: string; reason?: string; patched?: number; total?: number };
      if (r?.success) {
        toast.success(`Pushed voicemail to ${r.patched}/${r.total} Retell agent(s)`);
      } else {
        toast.warning(r?.reason || `Push partial: ${r?.action}`);
      }
    } catch (err) {
      toast.error(`Saved to DB but Retell push failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPushing(false);
    }
  };

  const handleModeChange = (mode: VoicemailMode) => {
    if (mode === config.mode || saving || pushing) return;
    const next: VoicemailConfig = {
      mode,
      text: mode === 'hangup' ? null : (config.text ?? ''),
    };
    setConfig(next);
    // Don't auto-push on mode change alone; wait for explicit save (text may need editing)
    if (mode === 'hangup') {
      // hangup doesn't need text, safe to push immediately
      void persistAndPush(next);
    }
  };

  const handleTextSave = () => {
    if (saving || pushing) return;
    if ((config.mode === 'static' || config.mode === 'prompt') && !config.text?.trim()) {
      toast.error('Text is required for static and prompt modes');
      return;
    }
    void persistAndPush(config);
  };

  const busy = loading || saving || pushing;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-wide">
          {title || 'Voicemail'}
        </CardTitle>
        <CardDescription className="text-xs">
          {description || "What the voice agent does when a call hits voicemail. Client-wide setting that applies to every Retell agent on this client. Push happens automatically on save."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <RadioGroup
          value={config.mode}
          onValueChange={(v) => handleModeChange(v as VoicemailMode)}
          disabled={busy}
          className="space-y-1.5"
        >
          <div className="flex items-start space-x-2">
            <RadioGroupItem value="hangup" id="vm-hangup" className="mt-0.5" />
            <Label htmlFor="vm-hangup" className="text-sm font-normal cursor-pointer">
              <span className="font-medium">Hang up</span>
              <span className="block text-[11px] text-muted-foreground">End the call silently when voicemail is detected. (Default.)</span>
            </Label>
          </div>
          <div className="flex items-start space-x-2">
            <RadioGroupItem value="static" id="vm-static" className="mt-0.5" />
            <Label htmlFor="vm-static" className="text-sm font-normal cursor-pointer">
              <span className="font-medium">Static text</span>
              <span className="block text-[11px] text-muted-foreground">Speak a fixed message (TTS), then hang up.</span>
            </Label>
          </div>
          <div className="flex items-start space-x-2">
            <RadioGroupItem value="prompt" id="vm-prompt" className="mt-0.5" />
            <Label htmlFor="vm-prompt" className="text-sm font-normal cursor-pointer">
              <span className="font-medium">Dynamic (LLM-generated)</span>
              <span className="block text-[11px] text-muted-foreground">Pass a prompt template to the LLM, speak the generated message, then hang up.</span>
            </Label>
          </div>
        </RadioGroup>

        {(config.mode === 'static' || config.mode === 'prompt') && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <Label className="text-xs">
              {config.mode === 'static' ? 'Voicemail message (TTS)' : 'Voicemail prompt template'}
            </Label>
            <Textarea
              value={config.text ?? ''}
              onChange={(e) => setConfig({ ...config, text: e.target.value })}
              placeholder={
                config.mode === 'static'
                  ? "Hi, this is Gary from Building Flow. Sorry I missed you. I'll try again shortly, or you can call us back any time."
                  : "Leave a brief voicemail introducing yourself as Gary from Building Flow, apologise for the missed call, and let them know you'll try again or invite them to call back."
              }
              rows={4}
              className="text-sm"
              disabled={busy}
            />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                Push to Retell agent(s) on save.
              </p>
              <Button size="sm" onClick={handleTextSave} disabled={busy}>
                {(saving || pushing) && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                {pushing ? 'Pushing...' : saving ? 'Saving...' : 'Save & push'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
