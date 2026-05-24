import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Copy, Loader2, X } from '@/components/icons';
import { cn } from '@/lib/utils';

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };
const LABEL_FONT = { fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' };

// Same slot count as PromptManagement's iteration — 10 slots per channel.
const SLOT_COUNT = 10;

interface DuplicateSetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  sourceSlotId: string;
  sourceChannel: 'text' | 'voice';
  sourceName: string;
  onDuplicated: (targetSlotId: string) => void;
}

interface SlotState {
  slotId: string;
  label: string;
  occupied: boolean;
}

export const DuplicateSetterDialog: React.FC<DuplicateSetterDialogProps> = ({
  open,
  onOpenChange,
  clientId,
  sourceSlotId,
  sourceChannel,
  sourceName,
  onDuplicated,
}) => {
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !clientId) return;
    setSelectedSlot(null);

    const loadSlots = async () => {
      setLoadingSlots(true);
      try {
        // Pull all occupied slot_ids from the three slot-keyed tables we care
        // about, then derive which of the SLOT_COUNT slots are free for the
        // active channel.
        const [{ data: pRows }, { data: cRows }, { data: aRows }] = await Promise.all([
          (supabase as any).from('prompts').select('slot_id').eq('client_id', clientId),
          (supabase as any).from('prompt_configurations').select('slot_id').eq('client_id', clientId),
          (supabase as any).from('agent_settings').select('slot_id').eq('client_id', clientId),
        ]);

        const occupied = new Set<string>();
        for (const arr of [pRows, cRows, aRows]) {
          for (const r of (arr ?? [])) {
            if (typeof r?.slot_id === 'string') occupied.add(r.slot_id);
          }
        }

        const prefix = sourceChannel === 'voice' ? 'Voice-Setter-' : 'Setter-';
        const built: SlotState[] = [];
        for (let i = 1; i <= SLOT_COUNT; i++) {
          const slotId = `${prefix}${i}`;
          if (slotId === sourceSlotId) continue;
          built.push({
            slotId,
            label: `Slot ${i}`,
            occupied: occupied.has(slotId),
          });
        }
        setSlots(built);
      } catch (e) {
        console.error('[DuplicateSetterDialog] load slots failed', e);
        toast.error('Failed to load slot inventory');
      } finally {
        setLoadingSlots(false);
      }
    };

    loadSlots();
  }, [open, clientId, sourceSlotId, sourceChannel]);

  const handleDuplicate = async () => {
    if (!selectedSlot || !clientId) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('duplicate-setter-config', {
        body: { clientId, sourceSlotId, targetSlotId: selectedSlot },
      });
      if (error) throw new Error(error.message || 'Failed to duplicate setter');
      if (data?.error) throw new Error(data.error);
      toast.success(`Duplicated to ${selectedSlot}. Open it + click Save Setter to activate.`);
      onDuplicated(selectedSlot);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to duplicate setter');
    } finally {
      setSubmitting(false);
    }
  };

  const channelLabel = sourceChannel === 'voice' ? 'Voice' : 'Text';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col !p-0 overflow-y-auto" style={{ width: '544px', maxWidth: '90vw', maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-6 shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))', paddingTop: '14px', paddingBottom: '14px' }}>
          <DialogTitle>DUPLICATE SETTER</DialogTitle>
          <DialogClose asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8 !bg-muted !border-border hover:!bg-accent shrink-0" title="Close">
              <X className="w-4 h-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div style={FONT} className="text-muted-foreground space-y-1">
            <p>
              Pure clone of <strong className="text-foreground">{sourceName || sourceSlotId}</strong> ({channelLabel} channel) into another empty slot. All parameters, prompts, and agent settings copied verbatim — no AI rewrite.
            </p>
            <p>
              The new setter starts as <strong>Not Active</strong>. Open it and click Save Setter to provision the Retell agent / push to the external Supabase.
            </p>
          </div>

          {loadingSlots ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground" style={FONT}>
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking slots...
            </div>
          ) : (
            <div className="space-y-2">
              <div style={FONT} className="text-foreground">{channelLabel} Setter slots</div>
              {slots.map((s) => {
                const isSelected = selectedSlot === s.slotId;
                const disabled = s.occupied;
                return (
                  <button
                    key={s.slotId}
                    onClick={() => !disabled && setSelectedSlot(s.slotId)}
                    disabled={disabled}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 groove-border text-left transition-colors',
                      isSelected ? 'bg-primary/10' : 'bg-card',
                      disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/40'
                    )}
                  >
                    <Checkbox checked={isSelected} disabled={disabled} className="flex-shrink-0" tabIndex={-1} />
                    <div className="flex-1 min-w-0 flex items-center justify-between">
                      <div style={{ ...FONT, fontWeight: 500 }} className="text-foreground">{s.label}</div>
                      <div style={FONT} className={disabled ? 'text-destructive/70' : 'text-muted-foreground'}>
                        {disabled ? 'Occupied' : 'Empty'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              className="flex-1 groove-btn"
              style={LABEL_FONT}
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              CANCEL
            </Button>
            <Button
              className={cn('flex-1 groove-btn-positive', (!selectedSlot || submitting) && 'opacity-50')}
              style={LABEL_FONT}
              disabled={!selectedSlot || submitting}
              onClick={handleDuplicate}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  DUPLICATING...
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-1.5" />
                  DUPLICATE
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
