import React from 'react';
import SetupGuideDialog from '@/components/SetupGuideDialog';
import { SETUP_PHASES } from '@/components/SetupGuideDialog';

// Phase IDs for Text AI Rep (core setup phases only). The n8n-era phases
// (workflows-import, n8n-setup, knowledgebase-setup) were removed 2026-07-10
// in the branding purge - the native text engine made them obsolete.
export const TEXT_AI_REP_PHASE_IDS: (keyof typeof SETUP_PHASES)[] = [
  'account-creation',
  'supabase-setup',
  'text-prompts-setup',
  'highlevel-credentials',
  'highlevel-setup'
];

// Step counts for each Text AI Rep phase
export const TEXT_AI_REP_PHASES: Record<string, number> = {
  'account-creation': SETUP_PHASES['account-creation'],
  'supabase-setup': SETUP_PHASES['supabase-setup'],
  'text-prompts-setup': SETUP_PHASES['text-prompts-setup'],
  'highlevel-credentials': SETUP_PHASES['highlevel-credentials'],
  'highlevel-setup': SETUP_PHASES['highlevel-setup']
};

// Helper function to check if a phase is complete
export const isPhaseComplete = (phaseId: string, completedSteps: string[]): boolean => {
  const stepCount = TEXT_AI_REP_PHASES[phaseId];
  if (!stepCount) return false;
  for (let i = 0; i < stepCount; i++) {
    if (!completedSteps.includes(`${phaseId}-${i}`)) {
      return false;
    }
  }
  return true;
};

interface TextAIRepSetupGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  initialPhase?: number;
  initialStep?: number;
  navigationKey?: number;
}

const TextAIRepSetupGuide: React.FC<TextAIRepSetupGuideProps> = ({ 
  open, 
  onOpenChange, 
  clientId, 
  initialPhase = 0, 
  initialStep = 0,
  navigationKey = 0
}) => {
  return (
    <SetupGuideDialog
      open={open}
      onOpenChange={onOpenChange}
      clientId={clientId}
      initialPhase={initialPhase}
      initialStep={initialStep}
      navigationKey={navigationKey}
      phaseFilter={TEXT_AI_REP_PHASE_IDS}
      dialogTitle="Text AI Rep Setup Guide"
    />
  );
};

export default TextAIRepSetupGuide;
