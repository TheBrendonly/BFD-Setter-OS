import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3 } from '@/components/icons';
import { hasFunnel, useShowRateFunnel, type FunnelCounts } from '@/hooks/useShowRateFunnel';

// F15(a) — show-rate funnel card (booked -> held -> no-show + show rate).
// Renders for BOTH roles off the server-branched get-show-rate-funnel response
// (a client sees it only when the agency toggled it on; the numbers are the
// client's own performance data so both roles see the same counts). Fails
// closed (renders nothing) on { show: false } or any error, like UsageSummaryCard.

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

function sourceLabel(key: string): string {
  const map: Record<string, string> = {
    voice_call: 'Voice',
    sms_link: 'SMS',
    manual: 'Manual',
    ghl_calendar: 'GHL',
    intake_form: 'Form',
    unknown: 'Other',
  };
  return map[key] ?? key;
}

export function ShowRateFunnelCard({ clientId }: { clientId: string }) {
  const { funnel } = useShowRateFunnel(clientId, 0);

  if (!hasFunnel(funnel)) return null;
  const f: FunnelCounts = funnel.overall;
  if (f.booked === 0) return null; // nothing to show yet this period

  const sources = Object.entries(funnel.by_source)
    .filter(([, c]) => c.booked > 0)
    .sort((a, b) => b[1].booked - a[1].booked);

  return (
    <Card className="material-surface">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Show-rate funnel ({funnel.period.label})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span><strong>{f.booked}</strong> booked</span>
          <span>{f.held} held</span>
          <span>{f.no_show} no-show</span>
          <span>{f.cancelled} cancelled</span>
          {f.upcoming > 0 && <span className="text-muted-foreground">{f.upcoming} upcoming</span>}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-green-600 font-medium">Show rate {pct(f.show_rate)}</span>
          <span className={f.no_show_rate && f.no_show_rate > 0.2 ? 'text-red-600' : 'text-muted-foreground'}>
            No-show {pct(f.no_show_rate)}
          </span>
        </div>
        {sources.length > 1 && (
          <div className="pt-1 border-t text-xs text-muted-foreground space-y-0.5">
            {sources.map(([key, c]) => (
              <div key={key} className="flex flex-wrap gap-x-4">
                <span className="font-medium text-foreground">{sourceLabel(key)}</span>
                <span>{c.booked} booked</span>
                <span>{c.held} held</span>
                <span>show {pct(c.show_rate)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
