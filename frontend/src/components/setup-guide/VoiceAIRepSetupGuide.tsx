import React from 'react';
import SetupGuideDialog from '@/components/SetupGuideDialog';
import { SETUP_PHASES } from '@/components/SetupGuideDialog';

// Phase IDs for Voice AI Rep (subset of the full phases). The n8n-era wiring
// phases (voice-inbound-setup, voice-outbound-setup) were removed 2026-07-10
// in the branding purge - the platform binds agents, webhooks, and numbers.
export const VOICE_AI_REP_PHASE_IDS: (keyof typeof SETUP_PHASES)[] = [
  'twilio-setup',
  'voice-accounts-setup',
  'voice-prompts-setup'
];

// Step counts for each Voice AI Rep phase
export const VOICE_AI_REP_PHASES: Record<string, number> = {
  'twilio-setup': SETUP_PHASES['twilio-setup'],
  'voice-accounts-setup': SETUP_PHASES['voice-accounts-setup'],
  'voice-prompts-setup': SETUP_PHASES['voice-prompts-setup']
};

// Helper function to check if a phase is complete
export const isPhaseComplete = (phaseId: string, completedSteps: string[]): boolean => {
  const stepCount = VOICE_AI_REP_PHASES[phaseId];
  if (!stepCount) return false;
  for (let i = 0; i < stepCount; i++) {
    if (!completedSteps.includes(`${phaseId}-${i}`)) {
      return false;
    }
  }
  return true;
};

interface VoiceAIRepSetupGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  initialPhase?: number;
  initialStep?: number;
  navigationKey?: number;
}

const VoiceAIRepSetupGuide: React.FC<VoiceAIRepSetupGuideProps> = ({ 
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
      phaseFilter={VOICE_AI_REP_PHASE_IDS}
      dialogTitle="Voice AI Rep Setup Guide"
    />
  );
};

export default VoiceAIRepSetupGuide;
