import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Copy, Loader2, X } from '@/components/icons';
import { cn } from '@/lib/utils';

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };
const LABEL_FONT = { fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' };

interface DuplicateSetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  sourceSlotId: string;
  sourceChannel: 'text' | 'voice';
  sourceName: string;
  onDuplicated: (targetSlotId: string) => void;
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
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill with "<source> (Copy)" each time the dialog opens so the user can
  // accept it or type a persona name (e.g. "Gary - Property Coach").
  useEffect(() => {
    if (open) setName(`${(sourceName || sourceSlotId).trim()} (Copy)`);
  }, [open, sourceName, sourceSlotId]);

  const handleDuplicate = async () => {
    if (!clientId || submitting) return;
    const finalName = name.trim();
    setSubmitting(true);
    try {
      // No targetSlotId — the edge function auto-allocates the lowest free slot
      // for this channel and applies the name. Slots never surface in the UI.
      const { data, error } = await supabase.functions.invoke('duplicate-setter-config', {
        body: { clientId, sourceSlotId, name: finalName || undefined },
      });
      if (error) throw new Error(error.message || 'Failed to duplicate setter');
      if (data?.error) throw new Error(data.error);
      toast.success(`Created "${finalName || `${sourceName} (Copy)`}". Open it + click Save Setter to activate.`);
      if (data?.targetSlotId) onDuplicated(data.targetSlotId);
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
              Pure clone of <strong className="text-foreground">{sourceName || sourceSlotId}</strong> ({channelLabel} channel). All parameters, prompts, and agent settings copied verbatim — no AI rewrite.
            </p>
            <p>
              The new setter starts as <strong>Not Active</strong>. Open it and click Save Setter to provision the Retell agent / push to the external Supabase.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="dup-setter-name" style={FONT} className="text-foreground block">Name</label>
            <Input
              id="dup-setter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDuplicate(); }}
              placeholder="e.g. Gary - Property Coach"
              style={FONT}
              autoFocus
              disabled={submitting}
            />
            <p style={FONT} className="text-muted-foreground">A free slot is assigned automatically. You identify the setter by this name.</p>
          </div>

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
              className={cn('flex-1 groove-btn-positive', submitting && 'opacity-50')}
              style={LABEL_FONT}
              disabled={submitting}
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
