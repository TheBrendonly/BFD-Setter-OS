import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BarChart3, Loader2 } from '@/components/icons';
import { formatMinorCurrency } from '@/lib/formatCurrency';
import { isAgencyUsage, isClientUsage, useClientUsage } from '@/hooks/useClientUsage';

// F13 — the fuller Usage & Billing panel with a billing-period selector.
// Renders from the server-branched get-client-usage response: a client sees
// only the admin-toggled parts; the agency sees usage, billed at sell rates,
// actual provider cost and margin. Fails closed on { show: false } or error.

const PERIOD_OPTIONS = [
  { value: '0', label: 'Current period' },
  { value: '-1', label: 'Previous period' },
  ...Array.from({ length: 10 }, (_, i) => ({
    value: String(-(i + 2)),
    label: `${i + 2} periods back`,
  })),
];

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${muted ? 'text-muted-foreground' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function ClientUsagePanel({ clientId }: { clientId: string }) {
  const [offset, setOffset] = useState(0);
  const { usage, loading } = useClientUsage(clientId, offset);

  // Fail closed for clients with nothing toggled on: no panel at all (but keep
  // it visible while browsing periods once a first response has shown).
  if (!loading && !isAgencyUsage(usage) && !isClientUsage(usage) && offset === 0) return null;

  const periodSelect = (
    <Select value={String(offset)} onValueChange={(v) => setOffset(Number(v))}>
      <SelectTrigger className="w-44 !h-8 field-text">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIOD_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Card className="material-surface">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Usage &amp; Billing
          </CardTitle>
          {periodSelect}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading usage...
          </div>
        ) : isAgencyUsage(usage) ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground mb-1">
              {usage.period.label} · anchor day {usage.period.anchor_day} · {usage.period.timezone}
            </p>
            <Row
              label={`Voice: ${usage.voice.billable_minutes} min (${usage.voice.calls} calls)`}
              value={formatMinorCurrency(usage.voice.billed_minor, usage.display_currency)}
            />
            <Row
              label={`Rate ${formatMinorCurrency(usage.voice.blended_per_min_minor, usage.display_currency)}/min`}
              value={`cost ${formatMinorCurrency(usage.voice.actual_cost_minor, usage.display_currency)}`}
              muted
            />
            {usage.voice.null_cost_calls > 0 && (
              <Row
                label="Calls missing a Retell cost (cost side undercounts)"
                value={String(usage.voice.null_cost_calls)}
                muted
              />
            )}
            <Row
              label={`SMS: ${usage.sms.outbound_texts} outbound texts`}
              value={formatMinorCurrency(usage.sms.billed_minor, usage.display_currency)}
            />
            <Row
              label={`Per text ${formatMinorCurrency(usage.sms.per_message_minor, usage.display_currency)}`}
              value={`est cost ${formatMinorCurrency(usage.sms.est_cost_minor, usage.display_currency)}`}
              muted
            />
            <div className="border-t border-border mt-1 pt-1">
              <Row
                label="Billed usage"
                value={formatMinorCurrency(usage.totals.usage_billed_minor, usage.display_currency)}
              />
              {usage.totals.fixed_monthly_minor > 0 && (
                <Row
                  label="Fixed monthly (separate)"
                  value={formatMinorCurrency(usage.totals.fixed_monthly_minor, usage.display_currency)}
                  muted
                />
              )}
              <Row
                label="Actual provider cost"
                value={formatMinorCurrency(usage.totals.actual_cost_minor, usage.display_currency)}
                muted
              />
              <div className={`flex justify-between text-sm font-bold ${usage.totals.margin_minor >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                <span>Margin</span>
                <span>
                  {formatMinorCurrency(usage.totals.margin_minor, usage.display_currency)}
                  {usage.totals.margin_bps !== null
                    ? ` (${(usage.totals.margin_bps / 100).toFixed(1)}%)`
                    : ''}
                </span>
              </div>
            </div>
          </div>
        ) : isClientUsage(usage) ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground mb-1">{usage.period.label}</p>
            {usage.minutes !== undefined && <Row label="Minutes used" value={String(usage.minutes)} />}
            {usage.texts !== undefined && <Row label="Texts sent" value={String(usage.texts)} />}
            {usage.rate_per_min_minor !== undefined && (
              <Row
                label="Your rate"
                value={`${formatMinorCurrency(usage.rate_per_min_minor, usage.display_currency)}/min`}
              />
            )}
            {usage.total_minor !== undefined && (
              <div className="flex justify-between text-sm font-bold border-t border-border mt-1 pt-1">
                <span>Month total</span>
                <span>{formatMinorCurrency(usage.total_minor, usage.display_currency)}</span>
              </div>
            )}
            {usage.fixed_monthly_minor !== undefined && usage.fixed_monthly_minor > 0 && (
              <Row
                label="Fixed monthly (separate)"
                value={formatMinorCurrency(usage.fixed_monthly_minor, usage.display_currency)}
                muted
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">No usage data for this period.</p>
        )}
      </CardContent>
    </Card>
  );
}
