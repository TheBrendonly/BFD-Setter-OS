import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RotateCcw, Save, Loader2, Calculator } from '@/components/icons';
import { toast } from 'sonner';
import { useClientPricingConfig } from '@/hooks/useClientPricingConfig';
import {
  DEFAULT_PRICING_CONFIG,
  computeBlendedRate,
  sanitizeAnchorDay,
  type MergedPricingConfig,
  type PricingComponent,
} from '@/lib/blendedRate';
import { formatMinorCurrency } from '@/lib/formatCurrency';

// Agency-only cost-to-price calculator. Edits the per-sub-account rate card
// (markup %, USD->display FX + buffer, per-component rates + toggles) and shows a
// LIVE blended $/min breakdown computed by the SAME shared util the edge fn uses.
// The raw inputs never reach a client: they live in client_pricing_config (agency
// RLS only); the client sees only the blended scalar via get-blended-rate.

const COMPONENT_LABELS: Record<string, string> = {
  retell: 'Retell voice',
  openrouter_llm: 'OpenRouter LLM',
  twilio_voice: 'Twilio voice',
  twilio_sms: 'Twilio SMS (client-billed)',
  sms_llm: 'SMS LLM (per text)',
  number_rental: 'Number rental',
  other: 'Other',
};

const componentUnitLabel = (unit: string) =>
  unit === 'per_month' ? 'fixed monthly' : unit === 'per_message' ? 'per text' : 'per minute';

// F13 — the four client-visibility toggles (server-enforced in get-client-usage).
const CLIENT_DISPLAY_PARTS: Array<{
  key: keyof MergedPricingConfig['client_display'];
  label: string;
  hint: string;
}> = [
  { key: 'show_rate', label: 'Rate per minute', hint: 'The blended $/min sell rate' },
  { key: 'show_minutes', label: 'Minutes used', hint: 'Billable minutes this billing month' },
  { key: 'show_texts', label: 'Texts sent', hint: 'Outbound SMS count this billing month' },
  { key: 'show_total', label: 'Month total', hint: 'Usage dollars at the sell rates (+ fixed monthly)' },
];

// micros <-> dollar-string helpers (no float maths reaches the stored config:
// strings are parsed to integer micros on change).
const microsToStr = (m: number) => (m / 1_000_000).toString();
const strToMicros = (s: string) => {
  const n = Math.round(parseFloat(s) * 1_000_000);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const bpsToPctStr = (bps: number) => (bps / 100).toString();
const pctToBps = (s: string) => {
  const n = Math.round(parseFloat(s) * 100);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const fxMicrosToStr = (m: number) => (m / 1_000_000).toString();
const strToFxMicros = (s: string) => {
  const n = Math.round(parseFloat(s) * 1_000_000);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function ClientPricingConfigEditor({ clientId }: { clientId: string }) {
  const { config, loading, saving, saveConfig, refetch } = useClientPricingConfig(clientId);
  const [form, setForm] = useState<MergedPricingConfig>(DEFAULT_PRICING_CONFIG);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!loading) {
      setForm(config);
      setHasChanges(false);
    }
  }, [config, loading]);

  const breakdown = useMemo(() => computeBlendedRate(form), [form]);

  const patch = (over: Partial<MergedPricingConfig>) => {
    setForm((prev) => ({ ...prev, ...over }));
    setHasChanges(true);
  };

  // F13 — keep the legacy show_rate_to_client flag mirrored with the new
  // client_display.show_rate so old and new readers always agree.
  const patchDisplayPart = (key: keyof MergedPricingConfig['client_display'], value: boolean) => {
    setForm((prev) => {
      const client_display = { ...prev.client_display, [key]: value };
      return {
        ...prev,
        client_display,
        show_rate_to_client: key === 'show_rate' ? value : prev.show_rate_to_client,
      };
    });
    setHasChanges(true);
  };

  const patchComponent = (key: string, over: Partial<PricingComponent>) => {
    setForm((prev) => ({
      ...prev,
      components: { ...prev.components, [key]: { ...prev.components[key], ...over } },
    }));
    setHasChanges(true);
  };

  const handleReset = () => {
    setForm(DEFAULT_PRICING_CONFIG);
    setHasChanges(true);
  };

  const handleSave = async () => {
    const ok = await saveConfig(form);
    if (ok) {
      toast.success('Pricing config saved');
      setHasChanges(false);
      await refetch();
    } else {
      toast.error('Failed to save pricing config');
    }
  };

  if (loading) return null;

  const componentKeys = Object.keys(form.components);

  return (
    <Card className="material-surface">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          Cost-to-Price Calculator
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4 field-text">
          Agency-only. Set the per-component provider costs, the USD-to-{form.display_currency} FX
          rate, and a markup to compute the blended price per minute and the SMS price per text.
          The "Client visibility" toggles below choose which final figures (never the breakdown)
          show on the client's dashboard and account page.
        </p>

        {/* Global controls */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">Display currency</Label>
            <Input
              value={form.display_currency}
              onChange={(e) => patch({ display_currency: e.target.value.toUpperCase().slice(0, 3) })}
              className="field-text"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">Markup (%)</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={bpsToPctStr(form.markup_bps)}
              onChange={(e) => patch({ markup_bps: pctToBps(e.target.value) })}
              className="field-text"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">FX USD &rarr; {form.display_currency}</Label>
            <Input
              type="number"
              min="0"
              step="0.0001"
              value={fxMicrosToStr(form.fx_usd_to_display_micros)}
              onChange={(e) =>
                patch({
                  fx_usd_to_display_micros: strToFxMicros(e.target.value),
                  fx_updated_at: new Date().toISOString(),
                })
              }
              className="field-text"
            />
            <p className="text-[10px] text-muted-foreground">
              {form.fx_updated_at ? `Updated ${new Date(form.fx_updated_at).toLocaleDateString()}` : 'Not set'}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">FX buffer (%)</Label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={bpsToPctStr(form.fx_buffer_bps)}
              onChange={(e) => patch({ fx_buffer_bps: pctToBps(e.target.value) })}
              className="field-text"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">Billing anchor day</Label>
            <Input
              type="number"
              min="1"
              max="31"
              step="1"
              value={String(form.billing_anchor_day)}
              onChange={(e) => patch({ billing_anchor_day: sanitizeAnchorDay(Number(e.target.value)) })}
              className="field-text"
            />
            <p className="text-[10px] text-muted-foreground">
              Day of month the billing period starts. Day 31 clamps to the last day of shorter months.
            </p>
          </div>
        </div>

        {/* Component rate table */}
        <div className="flex flex-col gap-2">
          {componentKeys.map((key) => {
            const c = form.components[key];
            return (
              <div
                key={key}
                className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg border border-border"
              >
                <Switch checked={c.enabled} onCheckedChange={(v) => patchComponent(key, { enabled: v })} />
                <div className="min-w-0 flex-1">
                  <div className="uppercase" style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}>
                    {COMPONENT_LABELS[key] ?? key}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.currency} &middot; {componentUnitLabel(c.unit)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-muted-foreground">{c.currency} $</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.0001"
                    disabled={!c.enabled}
                    value={microsToStr(c.rate_micros)}
                    onChange={(e) => patchComponent(key, { rate_micros: strToMicros(e.target.value) })}
                    className="field-text !h-8 w-28"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Client visibility toggles (F13) — server-enforced per-part display */}
        <div className="mt-4 px-3 py-2 rounded-lg border border-dashed border-border">
          <Label className="field-text">Client visibility</Label>
          <p className="text-[11px] text-muted-foreground mb-2">
            Each part shows on the client's dashboard and account page only while its toggle is on.
            The breakdown, markup and your costs never show.
          </p>
          <div className="flex flex-col gap-2">
            {CLIENT_DISPLAY_PARTS.map((part) => (
              <div key={part.key} className="flex items-center justify-between">
                <div>
                  <span className="text-sm">{part.label}</span>
                  <p className="text-[11px] text-muted-foreground">{part.hint}</p>
                </div>
                <Switch
                  checked={form.client_display[part.key]}
                  onCheckedChange={(v) => patchDisplayPart(part.key, v)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Live breakdown */}
        <div className="mt-4 p-3 rounded-lg bg-background border border-border">
          <div className="text-xs uppercase text-muted-foreground mb-2">Live breakdown</div>
          <div className="flex flex-col gap-1 text-sm">
            {breakdown.lineItems.map((li) => (
              <div key={li.key} className="flex justify-between">
                <span className="text-muted-foreground">{COMPONENT_LABELS[li.key] ?? li.key} ({li.currency}/min)</span>
                <span>{formatMinorCurrency(li.native_micros, li.currency, { minorPerMajor: 1_000_000, maximumFractionDigits: 4 })}</span>
              </div>
            ))}
            <div className="flex justify-between text-muted-foreground text-xs">
              <span>FX USD&rarr;{form.display_currency} {fxMicrosToStr(form.fx_usd_to_display_micros)}{form.fx_buffer_bps ? ` (+${bpsToPctStr(form.fx_buffer_bps)}% buffer)` : ''}</span>
              <span>markup {bpsToPctStr(form.markup_bps)}%</span>
            </div>
            <div className="flex justify-between font-bold border-t border-border pt-1 mt-1">
              <span>Blended price / min</span>
              <span>{formatMinorCurrency(breakdown.blended_per_min_minor, form.display_currency)}</span>
            </div>
            {breakdown.messageLineItems.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">SMS price / text</span>
                <span>{formatMinorCurrency(breakdown.per_message_minor, form.display_currency)}</span>
              </div>
            )}
            {breakdown.fixed_monthly_minor > 0 && (
              <div className="flex justify-between text-muted-foreground text-xs">
                <span>Fixed monthly (separate)</span>
                <span>{formatMinorCurrency(breakdown.fixed_monthly_minor, form.display_currency)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={saving}
            className="groove-btn !h-8"
            style={{ fontFamily: "'VT323', monospace", fontSize: '16px', fontWeight: 'bold' }}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            DEFAULT RATES
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium !h-8"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4 mr-2" /> Save</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
