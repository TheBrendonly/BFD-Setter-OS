import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const EVENT_NAME = 'what-to-do-acknowledged-change';

export const useWhatToDoAcknowledged = (clientId: string | undefined) => {
  const [acknowledged, setAcknowledged] = useState(true); // Default to true to avoid flash
  const [isLoading, setIsLoading] = useState(true);

  // Fetch acknowledged state from database
  useEffect(() => {
    if (!clientId) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const fetchAcknowledged = async () => {
      try {
        const { data, error } = await supabase
          .from('clients_public')
          .select('what_to_do_acknowledged')
          .eq('id', clientId)
          .maybeSingle();

        if (!isMounted) return;

        if (error) {
          console.error('Error fetching what_to_do_acknowledged:', error);
          setAcknowledged(false);
          setIsLoading(false);
          return;
        }

        setAcknowledged(data?.what_to_do_acknowledged ?? false);
        setIsLoading(false);
      } catch (err) {
        console.error('Error fetching what_to_do_acknowledged:', err);
        if (isMounted) {
          setAcknowledged(false);
          setIsLoading(false);
        }
      }
    };

    fetchAcknowledged();

    // Listen for changes from other components
    const handleChange = (e: CustomEvent<{ clientId: string; acknowledged: boolean }>) => {
      if (e.detail.clientId === clientId && isMounted) {
        setAcknowledged(e.detail.acknowledged);
      }
    };

    window.addEventListener(EVENT_NAME, handleChange as EventListener);
    return () => {
      isMounted = false;
      window.removeEventListener(EVENT_NAME, handleChange as EventListener);
    };
  }, [clientId]);

  const acknowledge = useCallback(async () => {
    if (!clientId) return;

    // Optimistic update
    setAcknowledged(true);

    try {
      const { data, error } = await supabase
        .from('clients')
        .update({ what_to_do_acknowledged: true })
        .eq('id', clientId)
        .select('id');

      if (error || !data || data.length === 0) {
        console.error('Error updating what_to_do_acknowledged:', error);
        setAcknowledged(false);
        return;
      }

      // Notify other components
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, {
          detail: { clientId, acknowledged: true },
        })
      );
    } catch (err) {
      console.error('Error updating what_to_do_acknowledged:', err);
      setAcknowledged(false);
    }
  }, [clientId]);

  return { acknowledged, acknowledge, isLoading };
};
