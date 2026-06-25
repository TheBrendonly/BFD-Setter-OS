import React from 'react';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Voice-Setter inbound toggle. After P3a (2026-06-17) the direction concept is
// inbound-only: outbound routing is driven by the cadence node's UUID voice
// setter, so the legacy outbound direction columns + cross-slot fan-out are
// retired. This control records whether the slot is the inbound setter; the
// source of truth is voice_setters.is_inbound (B-6). State lives in
// PromptManagement; `disabled` is held true while the inbound write is in
// flight so a second toggle can't race it.
interface DirectionsToggleProps {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

const TOGGLE_ITEM_CLASS =
  'data-[state=on]:!bg-green-500 data-[state=on]:!text-white data-[state=on]:!border-green-600 data-[state=on]:hover:!bg-green-600 border-2 border-border';
const MONO13: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };
const MONO12: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' };

export const DirectionsToggle: React.FC<DirectionsToggleProps> = ({ value, onChange, disabled }) => {
  return (
    <div className="space-y-3 p-4" style={{ border: '3px groove hsl(var(--border-groove))' }}>
      <div>
        <Label style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '1px', textTransform: 'uppercase' }}>
          INBOUND CALLS — USE THIS SETTER?
        </Label>
        <p className="text-muted-foreground mt-1" style={MONO12}>
          Inbound = calls landing on your number. Outbound is routed per-cadence by the voice setter picked on each phone_call step, so it is no longer set here.
        </p>
      </div>
      <ToggleGroup
        type="multiple"
        value={value.filter((d) => d === 'inbound')}
        onValueChange={(next) => onChange(next.includes('inbound') ? ['inbound'] : [])}
        className="!justify-start gap-2"
        disabled={disabled}
      >
        <ToggleGroupItem value="inbound" aria-label="Inbound" className={TOGGLE_ITEM_CLASS} style={MONO13}>
          Inbound
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
};
