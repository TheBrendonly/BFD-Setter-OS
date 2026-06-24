import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';


/**
 * Global hook: subscribes to real-time error_logs INSERT events
 * where severity = 'error' and shows a toast notification.
 */
export function useErrorLogNotifications() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const ghlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.from('clients_public').select('ghl_location_id').eq('id', clientId).single();
      if (cancelled || !data?.ghl_location_id) return;
      ghlRef.current = data.ghl_location_id;

      const channel = supabase
        .channel(`error-log-notifications-${clientId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'error_logs',
          filter: `client_ghl_account_id=eq.${data.ghl_location_id}`,
        }, (payload: any) => {
          const row = payload.new;
          if (row.severity !== 'error') return;

          const title = row.title || row.error_type || 'Error';
          const msg = row.error_message
            ? row.error_message.length > 80
              ? row.error_message.substring(0, 80) + '…'
              : row.error_message
            : 'An error occurred';

          toast.error(title, {
            description: msg,
            duration: 8000,
            action: {
              label: 'View',
              onClick: () => {
                // Navigate to logs page with the log id in state so the drawer opens
                navigate(`/client/${clientId}/logs`, { state: { openLogId: row.id } });
              },
            },
          });
        })
        .subscribe();

      // Store cleanup ref
      (ghlRef as any).__channel = channel;
    })();

    return () => {
      cancelled = true;
      const ch = (ghlRef as any).__channel;
      if (ch) supabase.removeChannel(ch);
    };
  }, [clientId, navigate]);
}
