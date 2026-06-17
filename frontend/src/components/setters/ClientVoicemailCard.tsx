import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from '@/components/icons';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type VoicemailMode = 'hangup' | 'static' | 'prompt';

interface VoicemailConfig {
  mode: VoicemailMode;
  text: string | null;
  detect_enabled: boolean;
  detect_timeout_ms: number;
}

const DEFAULT_CONFIG: VoicemailConfig = {
  mode: 'hangup',
  text: null,
  detect_enabled: true,
  detect_timeout_ms: 30000,
};

const TIMEOUT_PRESETS = [5000, 10000, 15000, 30000, 60000];

interface Props {
  clientId: string;
  title?: string;
  description?: string;
  // Client mode (My Account): a client cannot read/write the clients table
  // directly (RLS is agency-only). When `onPersist` is provided the card uses
  // the injected value + persists via the callback (the save-account-settings
  // edge function, which performs the Retell push server-side) instead of
  // touching the clients table / retell-proxy. Omit these in the agency context
  // to keep the original self-load / self-save + push behaviour.
  readOnly?: boolean;
  initialValue?: unknown;
  onPersist?: (config: VoicemailConfig) => Promise<boolean>;
}

function parseVoicemail(raw: unknown): VoicemailConfig {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const mode = (r.mode as VoicemailMode) || 'hangup';
    const text = typeof r.text === 'string' ? r.text : null;
    const detect_enabled = typeof r.detect_enabled === 'boolean' ? r.detect_enabled : true;
    const detect_timeout_ms =
      typeof r.detect_timeout_ms === 'number' && r.detect_timeout_ms > 0 ? r.detect_timeout_ms : 30000;
    return { mode, text, detect_enabled, detect_timeout_ms };
  }
  return DEFAULT_CONFIG;
}

export const ClientVoicemailCard: React.FC<Props> = ({ clientId, title, description, readOnly, initialValue, onPersist }) => {
  const clientMode = !!onPersist;
  const [config, setConfig] = useState<VoicemailConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(!clientMode);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [textDirty, setTextDirty] = useState(false);

  useEffect(() => {
    if (clientMode) {
      setConfig(parseVoicemail(initialValue));
      setLoading(false);
      return;
    }
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
        setConfig(parseVoicemail((data as { voicemail_config?: unknown } | null)?.voicemail_config));
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Failed to load voicemail config');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, clientMode, initialValue]);

  const persistAndPush = async (next: VoicemailConfig) => {
    if (readOnly) return;
    // Client mode: persist (+ server-side Retell push) via the edge function.
    if (clientMode) {
      setSaving(true);
      try {
        const ok = await onPersist!(next);
        if (!ok) throw new Error('Failed to save voicemail config');
        setConfig(next);
        setTextDirty(false);
        toast.success('Voicemail config saved');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save voicemail config');
      } finally {
        setSaving(false);
      }
      return;
    }

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
      setTextDirty(false);
      toast.success('Voicemail config saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save voicemail config');
      return;
    } finally {
      setSaving(false);
    }

    setPushing(true);
    try {
      const { data, error } = await supabase.functions.invoke('retell-proxy', {
        body: { action: 'set-voicemail', clientId },
      });
      if (error) throw error;
      const r = data as {
        success?: boolean;
        action?: string;
        reason?: string;
        patched?: number;
        total?: number;
        detect_enabled?: boolean;
      };
      if (r?.success) {
        const detectLabel = r.detect_enabled === false ? ' (detection OFF)' : '';
        toast.success(`Pushed voicemail to ${r.patched}/${r.total} Retell agent(s)${detectLabel}`);
      } else {
        toast.warning(r?.reason || `Push partial: ${r?.action}`);
      }
    } catch (err) {
      toast.error(`Saved to DB but Retell push failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPushing(false);
    }
  };

  const handleDetectionToggle = (checked: boolean) => {
    if (saving || pushing) return;
    const next: VoicemailConfig = { ...config, detect_enabled: checked };
    setConfig(next);
    void persistAndPush(next);
  };

  const handleTimeoutChange = (ms: number) => {
    if (saving || pushing) return;
    const next: VoicemailConfig = { ...config, detect_timeout_ms: ms };
    setConfig(next);
    void persistAndPush(next);
  };

  const handleTimeoutInput = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    setConfig({ ...config, detect_timeout_ms: n });
  };

  const handleTimeoutBlur = () => {
    if (saving || pushing) return;
    void persistAndPush(config);
  };

  const handleModeChange = (mode: VoicemailMode) => {
    if (mode === config.mode || saving || pushing) return;
    const next: VoicemailConfig = {
      ...config,
      mode,
      text: mode === 'hangup' ? null : (config.text ?? ''),
    };
    setConfig(next);
    if (mode === 'hangup') {
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

  const busy = loading || saving || pushing || !!readOnly;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-wide">
          {title || 'Voicemail'}
        </CardTitle>
        <CardDescription className="text-xs">
          {description || "Voicemail detection + behaviour for every Retell agent on this client. Client-wide setting. Detection controls whether the agent attempts to recognise voicemail in the first place; the mode below controls what happens after detection. Push happens automatically on save."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Detection</div>
          <div className="flex items-start space-x-2">
            <Checkbox
              id="vm-detect"
              checked={config.detect_enabled}
              onCheckedChange={(checked) => handleDetectionToggle(checked === true)}
              disabled={busy}
              className="mt-0.5"
            />
            <Label htmlFor="vm-detect" className="text-sm font-normal cursor-pointer">
              <span className="font-medium">Enable voicemail detection</span>
              <span className="block text-[11px] text-muted-foreground">
                When enabled, Retell listens for voicemail tones / silence and triggers the post-detection action below.
                When disabled, the agent treats every connected call as a live human.
              </span>
            </Label>
          </div>

          {config.detect_enabled && (
            <div className="space-y-1.5 pl-6">
              <Label className="text-xs">Detection timeout</Label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {TIMEOUT_PRESETS.map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    onClick={() => handleTimeoutChange(ms)}
                    disabled={busy}
                    className={`h-7 px-2 rounded text-xs border transition-colors ${
                      config.detect_timeout_ms === ms
                        ? 'bg-green-500 text-white border-green-600'
                        : 'bg-background text-muted-foreground border-border hover:bg-muted'
                    } disabled:opacity-50`}
                  >
                    {ms / 1000}s
                  </button>
                ))}
                <Input
                  type="number"
                  min={1000}
                  step={1000}
                  value={config.detect_timeout_ms}
                  onChange={(e) => handleTimeoutInput(e.target.value)}
                  onBlur={handleTimeoutBlur}
                  disabled={busy}
                  className="h-7 w-24 text-xs"
                />
                <span className="text-[11px] text-muted-foreground">ms</span>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3 pt-3 border-t border-border/50">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">After detection</div>
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
                onChange={(e) => {
                  setConfig({ ...config, text: e.target.value });
                  setTextDirty(true);
                }}
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
                <Button size="sm" onClick={handleTextSave} disabled={busy || (!textDirty && !!config.text)}>
                  {(saving || pushing) && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  {pushing ? 'Pushing...' : saving ? 'Saving...' : 'Save & push'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
