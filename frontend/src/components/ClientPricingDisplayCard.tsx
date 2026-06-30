import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign } from '@/components/icons';
import { supabase } from '@/integrations/supabase/client';
import { formatMinorCurrency } from '@/lib/formatCurrency';

// F8 — client-facing read-only rate card. Sources the number from get-blended-rate
// (service role): the agency must have turned "show rate to client" on, and even
// then the client gets ONLY the final blended $/min — never the markup, FX, or
// breakdown. Renders nothing when the toggle is off or the call fails.
type Blended =
  | { show: false }
  | { show: true; blended_per_min_minor: number; display_currency: string };

export function ClientPricingDisplayCard({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Blended | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: res, error } = await supabase.functions.invoke('get-blended-rate', {
          body: { client_id: clientId },
        });
        if (error) throw error;
        if (active) setData((res ?? { show: false }) as Blended);
      } catch (err) {
        console.error('get-blended-rate failed:', err);
        if (active) setData({ show: false });
      }
    })();
    return () => {
      active = false;
    };
  }, [clientId]);

  if (!data || data.show !== true) return null;

  return (
    <Card className="material-surface">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          Your Rate
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">
          {formatMinorCurrency(data.blended_per_min_minor, data.display_currency)}
          <span className="text-base font-normal text-muted-foreground"> /min</span>
        </div>
      </CardContent>
    </Card>
  );
}
