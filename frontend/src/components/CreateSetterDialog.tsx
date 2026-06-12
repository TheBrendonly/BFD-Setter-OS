import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X } from '@/components/icons';
import { cn } from '@/lib/utils';

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' };
const LABEL_FONT = { fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' };

interface CreateSetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: 'text' | 'voice';
  submitting?: boolean;
  onConfirm: (name: string) => void;
}

export const CreateSetterDialog: React.FC<CreateSetterDialogProps> = ({
  open,
  onOpenChange,
  channel,
  submitting = false,
  onConfirm,
}) => {
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(''); }, [open]);

  const channelLabel = channel === 'voice' ? 'Voice' : 'Text';
  const submit = () => { if (!submitting) onConfirm(name.trim()); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col !p-0 overflow-y-auto" style={{ width: '544px', maxWidth: '90vw', maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-6 shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))', paddingTop: '14px', paddingBottom: '14px' }}>
          <DialogTitle>CREATE NEW {channelLabel.toUpperCase()} SETTER</DialogTitle>
          <DialogClose asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8 !bg-muted !border-border hover:!bg-accent shrink-0" title="Close">
              <X className="w-4 h-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div style={FONT} className="text-muted-foreground">
            Creates a new blank {channelLabel} setter. A free slot is assigned automatically — you identify it by name.
          </div>

          {channel === 'voice' && (
            <div className="space-y-1.5">
              <span style={FONT} className="text-foreground block">Engine</span>
              <div className="flex gap-2">
                <div
                  className="flex-1 p-3 border-2 border-primary bg-primary/5"
                  style={FONT}
                  aria-pressed="true"
                >
                  <p className="font-semibold">Single Prompt</p>
                  <p className="text-muted-foreground" style={{ fontSize: '11px' }}>
                    One full prompt document; set up via the section wizard.
                  </p>
                </div>
                <div
                  className="flex-1 p-3 border border-dashed border-border opacity-60 cursor-not-allowed"
                  style={FONT}
                  title="Conversation Flow setters are coming soon"
                >
                  <p className="font-semibold">Conversation Flow</p>
                  <p className="text-muted-foreground" style={{ fontSize: '11px' }}>
                    Node-based flow (rigid mode). Coming soon.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="new-setter-name" style={FONT} className="text-foreground block">Name</label>
            <Input
              id="new-setter-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="e.g. Gary - Property Coach"
              style={FONT}
              autoFocus
              disabled={submitting}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button className="flex-1 groove-btn" style={LABEL_FONT} onClick={() => onOpenChange(false)} disabled={submitting}>
              CANCEL
            </Button>
            <Button
              className={cn('flex-1 groove-btn-positive', submitting && 'opacity-50')}
              style={LABEL_FONT}
              disabled={submitting}
              onClick={submit}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  CREATING...
                </>
              ) : (
                'CREATE'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
