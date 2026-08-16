import { useState, useEffect, useRef } from 'react';
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
import { supabase } from '@/integrations/supabase/client';

// Cost Ledger (agency-only) — reads get-cost-ledger, the first reader of the P2
// execution_cost_events ledger. Answers the P&L questions the Usage panel does not:
// cost by kind, cost-per-booking, an estimated-vs-actual split, and two burn-downs
// (voice minutes vs the pool, cost vs the monthly ceiling). USD (raw provider cost).
// Voice is ACTUAL; SMS + LLM are ESTIMATES today — labelled as such.

const PERIOD_OPTIONS = [
  { value: '0', label: 'Current period' },
  { value: '-1', label: 'Previous period' },
  ...Array.from({ length: 10 }, (_, i) => ({ value: String(-(i + 2)), label: `${i + 2} periods back` })),
];

interface BurnDown {
  limit: number | null;
  used: number;
  pct: number | null;
  over_80: boolean;
  over_100: boolean;
}
interface CostLedgerAgency {
  role: 'agency';
  currency: string;
  period: { label: string; anchor_day: number; timezone: string };
  by_kind: { cost_kind: string; cost_cents: number; is_estimated: boolean }[];
  voice_minutes: number;
  total_cost_cents: number;
  actual_cost_cents: number;
  estimated_cost_cents: number;
  booking_count: number;
  cost_per_booking_cents: number | null;
  cost_burn: BurnDown;
  minutes_burn: BurnDown;
}
type CostLedgerResponse = CostLedgerAgency | { role?: string; show?: boolean };

const isAgency = (r: CostLedgerResponse | null): r is CostLedgerAgency =>
  !!r && (r as CostLedgerAgency).role === 'agency';

const usd = (cents: number) => formatMinorCurrency(cents, 'USD');

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${muted ? 'text-muted-foreground' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function BurnBar({ label, burn, used, limit }: { label: string; burn: BurnDown; used: string; limit: string }) {
  if (burn.limit === null) {
    return <Row label={label} value={`${used} · no limit set`} muted />;
  }
  const pct = burn.pct ?? 0;
  const barColor = burn.over_100 ? 'bg-red-500' : burn.over_80 ? 'bg-amber-500' : 'bg-emerald-500';
  const textColor = burn.over_100 ? 'text-red-500' : burn.over_80 ? 'text-amber-500' : '';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className={textColor}>
          {used} / {limit} ({pct}%{burn.over_80 ? ' ⚠' : ''})
        </span>
      </div>
      <div className="h-2 w-full rounded bg-muted overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export function ClientCostLedgerCard({ clientId }: { clientId: string }) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<CostLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!clientId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    supabase.functions
      .invoke('get-cost-ledger', { body: { client_id: clientId, period_offset: offset } })
      .then(({ data: res, error }) => {
        if (seq !== seqRef.current) return;
        if (error) {
          console.error('get-cost-ledger failed:', error);
          setData({ show: false });
        } else {
          setData((res ?? { show: false }) as CostLedgerResponse);
        }
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }, [clientId, offset]);

  // Agency-only surface: a client (or an error) shows nothing.
  if (!loading && !isAgency(data) && offset === 0) return null;

  return (
    <Card className="material-surface">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Cost Ledger
          </CardTitle>
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
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading cost ledger...
          </div>
        ) : isAgency(data) ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {data.period.label} · {data.currency} · raw provider cost
            </p>

            {/* Headline: total + cost-per-booking */}
            <div className="flex flex-wrap gap-x-8 gap-y-1">
              <div>
                <p className="text-2xl font-semibold">{usd(data.total_cost_cents)}</p>
                <p className="text-xs text-muted-foreground">total cost this period</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">
                  {data.cost_per_booking_cents === null ? '—' : usd(data.cost_per_booking_cents)}
                </p>
                <p className="text-xs text-muted-foreground">
                  cost / booking ({data.booking_count} booked)
                </p>
              </div>
            </div>

            {/* Cost by kind */}
            <div className="flex flex-col gap-0.5 border-t border-dashed border-border pt-2">
              {data.by_kind.map((k) => (
                <Row
                  key={k.cost_kind}
                  label={`${k.cost_kind}${k.is_estimated ? ' (est.)' : ''}`}
                  value={usd(k.cost_cents)}
                  muted={k.is_estimated}
                />
              ))}
              <Row
                label="actual vs estimated"
                value={`${usd(data.actual_cost_cents)} actual + ${usd(data.estimated_cost_cents)} est.`}
                muted
              />
            </div>

            {/* Burn-downs */}
            <div className="flex flex-col gap-3 border-t border-dashed border-border pt-2">
              <BurnBar
                label="Voice minutes vs pool"
                burn={data.minutes_burn}
                used={`${data.voice_minutes} min`}
                limit={`${data.minutes_burn.limit ?? 0} min`}
              />
              <BurnBar
                label="Cost vs monthly ceiling"
                burn={data.cost_burn}
                used={usd(data.cost_burn.used)}
                limit={usd(data.cost_burn.limit ?? 0)}
              />
            </div>

            <p className="text-[10px] text-muted-foreground">
              Voice is actual (Retell ledger). SMS &amp; LLM are estimates until their cost events land in the ledger.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">No cost data for this period.</p>
        )}
      </CardContent>
    </Card>
  );
}
