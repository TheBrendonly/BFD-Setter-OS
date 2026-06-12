import React from 'react';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// EE1 Voice-Setter direction multi-select. Determines which
// clients.retell_*_agent_id columns get pointed at this slot's agent on the next
// "Push to Retell". Shared by the legacy section editor and the doc page so both
// surfaces stay identical. State (value / otherSlotDirections) lives in
// PromptManagement; this is presentation + the cross-slot conflict hint only.
interface DirectionsToggleProps {
  value: string[];
  onChange: (next: string[]) => void;
  otherSlotDirections: Record<string, string[]>;
}

const TOGGLE_ITEM_CLASS =
  'data-[state=on]:!bg-green-500 data-[state=on]:!text-white data-[state=on]:!border-green-600 data-[state=on]:hover:!bg-green-600 border-2 border-border';
const MONO13: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };
const MONO12: React.CSSProperties = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px' };

export const DirectionsToggle: React.FC<DirectionsToggleProps> = ({ value, onChange, otherSlotDirections }) => {
  const conflicts = value
    .map((dir) => {
      const owner = Object.entries(otherSlotDirections).find(([, dirs]) => dirs.includes(dir));
      return owner ? { dir, slot: owner[0] } : null;
    })
    .filter(Boolean) as Array<{ dir: string; slot: string }>;

  return (
    <div className="space-y-3 p-4" style={{ border: '3px groove hsl(var(--border-groove))' }}>
      <div>
        <Label style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '1px', textTransform: 'uppercase' }}>
          DIRECTIONS — WHICH CALLS USE THIS SETTER?
        </Label>
        <p className="text-muted-foreground mt-1" style={MONO12}>
          Pick any combination. Inbound = calls landing on your number. Outbound (initial) = first-touch outbound dial. Outbound (follow-up) = subsequent callbacks. Saving one direction does NOT touch the others.
        </p>
      </div>
      <ToggleGroup
        type="multiple"
        value={value}
        onValueChange={onChange}
        className="!justify-start gap-2"
      >
        <ToggleGroupItem value="inbound" aria-label="Inbound" className={TOGGLE_ITEM_CLASS} style={MONO13}>
          Inbound
        </ToggleGroupItem>
        <ToggleGroupItem value="outbound_initial" aria-label="Outbound initial" className={TOGGLE_ITEM_CLASS} style={MONO13}>
          Outbound (initial)
        </ToggleGroupItem>
        <ToggleGroupItem value="outbound_followup" aria-label="Outbound follow-up" className={TOGGLE_ITEM_CLASS} style={MONO13}>
          Outbound (follow-up)
        </ToggleGroupItem>
      </ToggleGroup>
      {conflicts.length === 0 ? (
        value.length === 0 ? (
          <div className="text-amber-500" style={MONO12}>
            No direction selected — this setter is not routed to any phone. Pick at least one direction before pushing.
          </div>
        ) : null
      ) : (
        <div className="text-amber-500" style={MONO12}>
          {conflicts.map((c) => (
            <div key={c.dir}>
              Heads up — {c.dir.replace('_', ' ')} is currently owned by {c.slot}. Pushing will move it to this slot.
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
