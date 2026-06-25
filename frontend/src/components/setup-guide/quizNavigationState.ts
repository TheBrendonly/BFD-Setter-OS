// Shared navigation-state contract for setup-guide "logic" steps. Extracted from
// the now-deleted VoiceInboundLogicStep (F6) so the surviving VoiceOutboundLogicStep
// and SetupGuideDialog still share one definition.
export interface QuizNavigationState {
  showBack: boolean;
  backLabel: string;
  onBack: () => void;
  hideProgressBar?: boolean;
  rightButton: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant: 'primary' | 'success' | 'outline';
    icon: 'check' | 'arrow-right';
  };
}
