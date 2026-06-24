import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { AuthApiError } from '@supabase/supabase-js';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';

export type SubscriptionStatus = 'free' | 'active' | 'cancelled' | 'locked' | 'grace_period';

interface UseSubscriptionReturn {
  /** @deprecated Agency is always free now */
  agencyStatus: SubscriptionStatus;
  clientStatus: (clientId: string) => SubscriptionStatus;
  loading: boolean;
  refetch: () => Promise<void>;
  clientStatuses: Record<string, SubscriptionStatus>;
  /** The ID of the oldest (default/free) sub-account */
  defaultClientId: string | null;
}

const RECHECK_INTERVAL_MS = 60_000;

export const useSubscription = (): UseSubscriptionReturn => {
  const { user, role, userClientId } = useAuth();
  const [clientStatuses, setClientStatuses] = useState<Record<string, SubscriptionStatus>>({});
  const [defaultClientId, setDefaultClientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const recheckTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatuses = useCallback(async () => {
    if (!user) {
      setClientStatuses({});
      setDefaultClientId(null);
      setLoading(false);
      return;
    }

    try {
      const { data: clients, error } = await supabase
        .from('clients_public')
        .select('id, subscription_status, created_at')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const allClients = clients ?? [];
      const trueDefaultId = allClients.length > 0 ? allClients[0].id : null;

      const visibleClients = allClients.filter((client) => {
        if (role === 'client') {
          return !!userClientId && client.id === userClientId;
        }
        return true;
      });

      if (visibleClients.length > 0) {
        setDefaultClientId(trueDefaultId);

        const statuses: Record<string, SubscriptionStatus> = {};
        visibleClients.forEach((c) => {
          if (c.id === trueDefaultId) {
            statuses[c.id] = 'active';
          } else {
            statuses[c.id] = (c.subscription_status as SubscriptionStatus) || 'free';
          }
        });
        setClientStatuses(statuses);
      } else {
        setDefaultClientId(null);
        setClientStatuses({});
      }
    } catch (err) {
      console.error('Error fetching subscription status:', err);
    } finally {
      setLoading(false);
    }
  }, [user, role, userClientId]);

  const verifyWithStripe = useCallback(async (clientId: string) => {
    if (!user) return;
    if (role === 'client' && userClientId && clientId !== userClientId) {
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        console.warn('No active session, skipping subscription verify');
        return;
      }

      const { data: userData, error: authValidationError } = await supabase.auth.getUser(accessToken);
      if (authValidationError || !userData.user) {
        console.warn('Invalid session detected during subscription verify, skipping verification');
        return;
      }

      const { data, error } = await supabase.functions.invoke('check-client-subscription', {
        body: { client_id: clientId },
      });

      if (error) {
        const errorMsg = typeof error === 'object' && 'message' in error ? error.message : String(error);

        const isAuthError =
          errorMsg.includes('401') ||
          errorMsg.includes('Unauthorized') ||
          errorMsg.includes('403') ||
          errorMsg.includes('Forbidden') ||
          errorMsg.includes('non-2xx');

        if (isAuthError) {
          console.warn('Skipping subscription verify due to auth/access restrictions');
          return;
        }
        console.error('Subscription verify error:', error);
        return;
      }

      await fetchStatuses();
    } catch (err) {
      if (err instanceof AuthApiError) {
        console.warn('Auth error verifying subscription, skipping verification');
        return;
      }

      console.error('Error verifying subscription:', err);
    }
  }, [user, role, userClientId, fetchStatuses]);

  // Handle checkout success redirect
  useEffect(() => {
    const checkoutSuccess = searchParams.get('checkout_success');
    const checkoutClientId = searchParams.get('checkout_client_id');

    if (checkoutSuccess === 'true' && checkoutClientId && user) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('checkout_success');
      newParams.delete('checkout_client_id');
      setSearchParams(newParams, { replace: true });

      verifyWithStripe(checkoutClientId);
    }
  }, [searchParams, user, setSearchParams, verifyWithStripe]);

  // Re-fetch fresh statuses from Supabase on EVERY route change
  useEffect(() => {
    fetchStatuses();
  }, [fetchStatuses, location.pathname]);

  // Periodic re-check: verify non-free clients with Stripe
  useEffect(() => {
    if (!user) return;

    const runPeriodicCheck = async () => {
      const checkableStatuses: SubscriptionStatus[] = ['active', 'grace_period', 'locked'];
      const clientIdsToCheck = Object.entries(clientStatuses)
        .filter(([id, status]) => id !== defaultClientId && checkableStatuses.includes(status as SubscriptionStatus))
        .map(([id]) => id);

      for (const cid of clientIdsToCheck) {
        await verifyWithStripe(cid);
      }
    };

    const initialTimeout = setTimeout(runPeriodicCheck, 5_000);
    recheckTimerRef.current = setInterval(runPeriodicCheck, RECHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      if (recheckTimerRef.current) {
        clearInterval(recheckTimerRef.current);
      }
    };
  }, [user, defaultClientId, clientStatuses, verifyWithStripe]);

  const clientStatus = (clientId: string): SubscriptionStatus => {
    return clientStatuses[clientId] || 'free';
  };

  return {
    agencyStatus: 'active',
    clientStatus,
    loading,
    refetch: fetchStatuses,
    clientStatuses,
    defaultClientId,
  };
};
