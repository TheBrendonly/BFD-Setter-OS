import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const useSetupGuideProgress = (clientId: string | undefined) => {
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  
  // Refs to prevent race conditions
  const isSavingRef = useRef(false);
  const pendingStepsRef = useRef<string[] | null>(null);

  // Fetch completed steps from database
  useEffect(() => {
    if (!clientId) {
      setIsLoading(false);
      return;
    }

    const fetchProgress = async () => {
      try {
        const { data, error } = await supabase
          .from('clients_public')
          .select('setup_guide_completed_steps')
          .eq('id', clientId)
          .single();

        if (error) {
          console.error('Error fetching setup guide progress:', error);
          toast({
            title: "Failed to load progress",
            description: "Could not load your setup progress. Please refresh the page.",
            variant: "destructive"
          });
          return;
        }

        if (data?.setup_guide_completed_steps && Array.isArray(data.setup_guide_completed_steps)) {
          setCompletedSteps(data.setup_guide_completed_steps as string[]);
        }
      } catch (err) {
        console.error('Error fetching setup guide progress:', err);
        toast({
          title: "Failed to load progress",
          description: "Could not load your setup progress. Please refresh the page.",
          variant: "destructive"
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchProgress();
  }, [clientId, toast]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!clientId) return;

    const channel = supabase
      .channel(`setup-progress-${clientId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'clients', filter: `id=eq.${clientId}` },
        (payload) => {
          // Don't overwrite local state if we're saving
          if (isSavingRef.current || pendingStepsRef.current !== null) {
            return;
          }
          const steps = (payload.new.setup_guide_completed_steps as string[]) || [];
          setCompletedSteps(steps);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId]);

  const saveProgress = useCallback(async (newSteps: string[]): Promise<boolean> => {
    if (!clientId) return false;
    
    isSavingRef.current = true;
    pendingStepsRef.current = newSteps;
    setIsSaving(true);
    
    try {
      const { error } = await supabase
        .from('clients')
        .update({ setup_guide_completed_steps: newSteps })
        .eq('id', clientId);

      if (error) {
        console.error('Error updating setup guide progress:', error);
        toast({
          title: "Failed to save progress",
          description: "Your progress could not be saved. Please try again.",
          variant: "destructive"
        });
        return false;
      }
      return true;
    } catch (err) {
      console.error('Error updating setup guide progress:', err);
      toast({
        title: "Failed to save progress",
        description: "Your progress could not be saved. Please try again.",
        variant: "destructive"
      });
      return false;
    } finally {
      isSavingRef.current = false;
      pendingStepsRef.current = null;
      setIsSaving(false);
    }
  }, [clientId, toast]);

  const toggleStep = useCallback(async (stepId: string) => {
    if (!clientId) return;

    const isCompleted = completedSteps.includes(stepId);
    const newCompletedSteps = isCompleted
      ? completedSteps.filter(id => id !== stepId)
      : [...completedSteps, stepId];

    // Optimistic update
    setCompletedSteps(newCompletedSteps);

    // Save to database
    const success = await saveProgress(newCompletedSteps);
    
    if (!success) {
      // Revert on error
      setCompletedSteps(completedSteps);
    }
  }, [clientId, completedSteps, saveProgress]);

  const isStepCompleted = useCallback((stepId: string) => {
    return completedSteps.includes(stepId);
  }, [completedSteps]);

  // Force refresh from database
  const refreshProgress = useCallback(async () => {
    if (!clientId) return;
    
    try {
      const { data, error } = await supabase
        .from('clients_public')
        .select('setup_guide_completed_steps')
        .eq('id', clientId)
        .single();

      if (error) {
        console.error('Error refreshing setup guide progress:', error);
        return;
      }

      if (data?.setup_guide_completed_steps && Array.isArray(data.setup_guide_completed_steps)) {
        setCompletedSteps(data.setup_guide_completed_steps as string[]);
      }
    } catch (err) {
      console.error('Error refreshing setup guide progress:', err);
    }
  }, [clientId]);

  return {
    completedSteps,
    isLoading,
    isSaving,
    toggleStep,
    isStepCompleted,
    refreshProgress,
  };
};
