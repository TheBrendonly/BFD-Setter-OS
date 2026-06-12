import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from 'lucide-react';

// One-click live check of the tenant's saved provider credentials. Calls the
// verify-credentials edge function (which does the real reads server-side so
// secrets never reach the browser) and shows pass/fail per provider. High value
// at onboarding: catches dead-on-arrival credentials before going live.
type ProviderResult = { provider: string; ok: boolean; detail: string };

const PROVIDER_LABELS: Record<string, string> = {
  retell: 'Retell (voice)',
  ghl: 'GoHighLevel',
  twilio: 'Twilio (SMS)',
  openrouter: 'OpenRouter (LLM)',
};

export function CredentialVerifyCard({ clientId }: { clientId: string | undefined }) {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<ProviderResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    if (!clientId) return;
    setChecking(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('verify-credentials', {
        body: { clientId },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      setResults(Array.isArray(data?.results) ? data.results : []);
    } catch (e: any) {
      setError(e?.message || 'Verification failed');
      setResults(null);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card className="material-surface mb-6">
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" /> Connection Check
            </CardTitle>
            <CardDescription className="mt-1">
              Live test of the saved Retell, GoHighLevel, Twilio and OpenRouter credentials.
            </CardDescription>
          </div>
          <Button onClick={runCheck} disabled={checking || !clientId} size="sm">
            {checking ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            {checking ? 'Checking...' : 'Verify Credentials'}
          </Button>
        </div>
      </CardHeader>
      {(results || error) && (
        <CardContent className="pt-0">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {results && (
            <div className="space-y-1.5">
              {results.map((r) => (
                <div key={r.provider} className="flex items-center gap-2 text-sm">
                  {r.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive shrink-0" />
                  )}
                  <span className="font-medium">{PROVIDER_LABELS[r.provider] || r.provider}</span>
                  <span className="text-muted-foreground">{r.detail}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
