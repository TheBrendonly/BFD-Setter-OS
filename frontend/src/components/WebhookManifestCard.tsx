import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Copy, Check, ShieldCheck, AlertCircle, RefreshCw, Loader2, Webhook } from '@/components/icons';
import { cn } from '@/lib/utils';

// Auto-surfaced INBOUND webhook manifest: the "copy these into HighLevel / Retell
// / Twilio / Unipile" list. Reads the server-side `webhook-manifest` edge fn (which
// also generates+persists any missing ghl/intake secret), so URLs are never shown
// live-but-forgeable. Pairs with the OUTBOUND CredentialVerifyCard.

interface ManifestHeader { key: string; value: string }
interface ManifestEntry {
  key: string;
  label: string;
  url: string;
  method: string;
  headers: ManifestHeader[];
  destination: string;
  note?: string;
  sopRef?: string;
  lastReceivedAt?: string | null;
  required?: boolean;
  secretStatus: 'secured' | 'forgeable' | 'verification-not-yet-supported' | 'auto';
}
interface Manifest {
  ok: boolean;
  entries: ManifestEntry[];
  goLiveReady: boolean;
  // GOLIVE-1: per-check breakdown behind goLiveReady (absent on older fn versions).
  goLiveChecklist?: Record<string, boolean>;
  generated: string[];
}

const GO_LIVE_CHECK_LABELS: Record<string, string> = {
  requiredWebhooksSecured: 'required webhook secrets',
  ghlLocationConfigured: 'GHL location',
  retellPhoneConfigured: 'Retell phone number',
  voiceSetterPushed: 'a pushed voice setter',
  externalSupabaseConfigured: 'external Supabase',
  requiredWebhooksReceived: 'traffic on the required webhooks',
};

const DESTINATION_HINT: Record<string, string> = {
  GoHighLevel: 'Paste into GoHighLevel → Workflows → Custom Webhook action.',
  Retell: 'Set in the Retell dashboard (phone inbound_webhook_url or agent webhook_url).',
  Twilio: 'Twilio Phone Number → Messaging. Auto-set by the Configure Twilio Webhook button.',
  Unipile: 'Set in the Unipile webhook configuration.',
  'Web form': 'Use from your web form / external lead source.',
};

const STATUS_PILL: Record<ManifestEntry['secretStatus'], { label: string; className: string }> = {
  secured: { label: 'Secured', className: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  forgeable: { label: 'Secret missing — forgeable', className: 'bg-red-500/15 text-red-600 border-red-500/30' },
  'verification-not-yet-supported': { label: 'Leave blank for now', className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  auto: { label: 'Auto-configured', className: 'bg-muted text-muted-foreground border-border' },
};

function tokenFromHeaders(headers: ManifestHeader[]): string | null {
  const h = headers.find((x) => x.key === 'x-wh-token' || x.key === 'Authorization');
  if (!h) return null;
  const v = h.value || '';
  if (!v || v.includes('<')) return null; // placeholder, not a real secret
  return v;
}

export function WebhookManifestCard({ clientId }: { clientId: string }) {
  const { toast } = useToast();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('webhook-manifest', {
        body: { clientId },
      });
      if (fnErr) throw fnErr;
      setManifest(data as Manifest);
    } catch (e: any) {
      setError(e?.message || 'Failed to load the webhook manifest');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      toast({ title: 'Copy failed', description: 'Select and copy manually.', variant: 'destructive' });
    }
  }, [toast]);

  const grouped = (manifest?.entries || []).reduce<Record<string, ManifestEntry[]>>((acc, e) => {
    (acc[e.destination] ||= []).push(e);
    return acc;
  }, {});

  return (
    <Card id="inbound-webhooks" className="material-surface border border-border scroll-mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Webhook className="w-5 h-5" /> Inbound Webhooks
          </CardTitle>
          <div className="flex items-center gap-2">
            {manifest && (
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  manifest.goLiveReady
                    ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-600 border-amber-500/30',
                )}
              >
                {manifest.goLiveReady ? 'Go-live ready' : 'Not go-live ready'}
              </Badge>
            )}
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>
        <CardDescription>
          The webhooks you paste into your upstream tools. Copy each URL (and token) into the named
          screen, then check that "last received" shows a recent hit. Required webhooks must be
          secured before the engagement workflow goes live.
        </CardDescription>
        {manifest && !manifest.goLiveReady && manifest.goLiveChecklist && (
          <p className="text-xs text-amber-600">
            Still missing:{' '}
            {Object.entries(manifest.goLiveChecklist)
              .filter(([, ok]) => !ok)
              .map(([key]) => GO_LIVE_CHECK_LABELS[key] || key)
              .join(', ')}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading manifest…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {!loading && !error && Object.entries(grouped).map(([destination, entries]) => (
          <div key={destination} className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold">{destination}</h4>
              {DESTINATION_HINT[destination] && (
                <p className="text-xs text-muted-foreground">{DESTINATION_HINT[destination]}</p>
              )}
            </div>
            {entries.map((e) => {
              const token = tokenFromHeaders(e.headers);
              const pill = STATUS_PILL[e.secretStatus]
                || { label: 'Unknown', className: 'bg-muted text-muted-foreground border-border' };
              return (
                <div key={e.key} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {e.label}
                      {e.required && <span className="ml-1 text-xs text-red-600">(required)</span>}
                    </span>
                    <Badge variant="outline" className={cn('text-xs', pill.className)}>
                      {e.secretStatus === 'secured' && <ShieldCheck className="h-3 w-3 mr-1" />}
                      {pill.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate text-xs bg-muted px-2 py-1.5 rounded font-mono">{e.url}</code>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => copy(e.url, `${e.key}-url`)}>
                      {copiedKey === `${e.key}-url` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span className="ml-1">URL</span>
                    </Button>
                  </div>
                  {token && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">
                        Header <code className="font-mono">{e.headers.find((h) => h.key === 'x-wh-token') ? 'x-wh-token' : 'Authorization'}</code>
                      </span>
                      <code className="flex-1 min-w-0 truncate text-xs bg-muted px-2 py-1.5 rounded font-mono">{token}</code>
                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => copy(token, `${e.key}-token`)}>
                        {copiedKey === `${e.key}-token` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        <span className="ml-1">Token</span>
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{e.note || `${e.method}${e.sopRef ? ` · SOP ${e.sopRef}` : ''}`}</span>
                    <span>{e.lastReceivedAt ? `Last received ${new Date(e.lastReceivedAt).toLocaleString()}` : 'No traffic yet'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
