import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity } from '@/components/icons';
import { formatMinorCurrency } from '@/lib/formatCurrency';
import { isAgencyUsage, isClientUsage, useClientUsage } from '@/hooks/useClientUsage';

// F13 — compact current-period usage card for the main dashboard. Renders for
// BOTH roles from the server-branched get-client-usage response: a client sees
// only the admin-toggled parts; the agency sees the billed / cost / margin
// one-liner. Fails closed (renders nothing) on { show: false } or any error,
// mirroring ClientPricingDisplayCard.

export function UsageSummaryCard({ clientId }: { clientId: string }) {
  const { usage } = useClientUsage(clientId, 0);

  if (isAgencyUsage(usage)) {
    const { voice, sms, totals, display_currency: cur, period } = usage;
    return (
      <Card className="material-surface">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5" />
            This billing month ({period.label})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>{voice.billable_minutes} min ({voice.calls} calls)</span>
            <span>{sms.outbound_texts} texts</span>
            <span>Billed {formatMinorCurrency(totals.usage_billed_minor, cur)}</span>
            <span className="text-muted-foreground">
              Cost {formatMinorCurrency(totals.actual_cost_minor, cur)}
            </span>
            <span className={totals.margin_minor >= 0 ? 'text-green-600' : 'text-red-600'}>
              Margin {formatMinorCurrency(totals.margin_minor, cur)}
              {totals.margin_bps !== null ? ` (${(totals.margin_bps / 100).toFixed(1)}%)` : ''}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isClientUsage(usage)) {
    const cur = usage.display_currency;
    const parts: string[] = [];
    if (usage.minutes !== undefined) parts.push(`${usage.minutes} min`);
    if (usage.texts !== undefined) parts.push(`${usage.texts} texts`);
    if (usage.total_minor !== undefined) {
      parts.push(formatMinorCurrency(usage.total_minor, cur));
    }
    if (usage.rate_per_min_minor !== undefined) {
      parts.push(`at ${formatMinorCurrency(usage.rate_per_min_minor, cur)}/min`);
    }
    if (parts.length === 0) return null;
    return (
      <Card className="material-surface">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5" />
            This billing month ({usage.period.label})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm">{parts.join(' · ')}</div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
