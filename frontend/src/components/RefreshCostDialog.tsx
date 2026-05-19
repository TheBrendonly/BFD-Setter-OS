import React, { useState, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Coins, Loader2 } from '@/components/icons';

// Set VITE_COST_ESTIMATE_URL in the deployment env to enable cost estimation.
// Hardcoded upstream URL removed in N5 2026-05-19 — was sending per-client
// supabase_service_key + openrouter_api_key + openai_api_key to the upstream
// n8n endpoint as a fallback for any caller without a per-tenant override.
const COST_ESTIMATE_URL = import.meta.env.VITE_COST_ESTIMATE_URL as string | undefined;

interface RefreshCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  timeRange: string;
  customStartDate?: Date;
  customEndDate?: Date;
  clientId?: string;
  supabaseUrl?: string | null;
  supabaseServiceKey?: string | null;
  openrouterApiKey?: string | null;
  openaiApiKey?: string | null;
}

export function RefreshCostDialog({
  open,
  onOpenChange,
  onConfirm,
  timeRange,
  customStartDate,
  customEndDate,
  clientId,
  supabaseUrl,
  supabaseServiceKey,
  openrouterApiKey,
  openaiApiKey,
}: RefreshCostDialogProps) {
  const [loading, setLoading] = useState(false);
  const [estimateMessage, setEstimateMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEstimateMessage(null);
      setError(null);
      return;
    }

    const fetchEstimate = async () => {
      setLoading(true);
      setError(null);
      setEstimateMessage(null);

      try {
        const body: Record<string, string> = { timeRange };
        if (clientId) body.clientId = clientId;
        if (supabaseUrl) body.supabase_url = supabaseUrl;
        if (supabaseServiceKey) body.supabase_service_key = supabaseServiceKey;
        if (openrouterApiKey) body.openrouter_api_key = openrouterApiKey;
        if (openaiApiKey) body.openai_api_key = openaiApiKey;
        if (timeRange === 'custom' && customStartDate && customEndDate) {
          body.startDate = customStartDate.toISOString().split('T')[0];
          body.endDate = customEndDate.toISOString().split('T')[0];
        }

        if (!COST_ESTIMATE_URL) {
          setError('Cost estimation is not configured for this deployment (VITE_COST_ESTIMATE_URL is unset).');
          return;
        }
        const response = await fetch(COST_ESTIMATE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const text = await response.text();
        let parsed: any = null;
        try { parsed = JSON.parse(text); } catch {}

        if (!response.ok) {
          setError(parsed?.message || text || 'Failed to get cost estimate');
          return;
        }

        // Support both { message: "..." } and plain string responses
        const msg = parsed?.message || parsed?.estimate || text;
        setEstimateMessage(msg);
      } catch (err: any) {
        setError(err.message || 'Failed to reach cost estimate endpoint');
      } finally {
        setLoading(false);
      }
    };

    fetchEstimate();
  }, [open, timeRange, customStartDate, customEndDate, clientId]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-muted-foreground" />
            Confirm Analytics Refresh
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2" asChild>
            <div>
              {loading && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Estimating cost...
                </span>
              )}
              {error && (
                <span className="block text-sm text-destructive">{error}</span>
              )}
              {error && (
                <span className="block text-sm text-muted-foreground mt-1">
                  Cost estimate unavailable. You can still proceed with the refresh.
                </span>
              )}
              {estimateMessage && !loading && (
                <span className="block text-sm text-foreground">{estimateMessage}</span>
              )}
              {!loading && !error && !estimateMessage && (
                <span className="block text-sm text-muted-foreground">
                  Running analytics will process your conversation data using AI tokens.
                </span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={loading}>
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
