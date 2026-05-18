import { useState } from 'react';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Phone, Loader2, X } from 'lucide-react';

const FONT = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;
const LABEL_FONT = { fontFamily: "'VT323', monospace", fontSize: '18px', letterSpacing: '0.5px' } as const;

interface TestCallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  voiceSetterSlotId: string;
  setterName?: string;
}

export default function TestCallDialog({ open, onOpenChange, clientId, voiceSetterSlotId, setterName }: TestCallDialogProps) {
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('Test');
  const [lastName, setLastName] = useState('Call');
  const [email, setEmail] = useState('');
  const [calling, setCalling] = useState(false);

  const voiceSetterId = voiceSetterSlotId.toLowerCase();

  const handleCall = async () => {
    const cleaned = phone.replace(/\s/g, '');
    if (!cleaned || cleaned.length < 7) {
      toast.error('Please enter a valid phone number');
      return;
    }

    setCalling(true);
    try {
      const { data, error } = await supabase.functions.invoke('make-retell-outbound-call', {
        body: {
          client_id: clientId,
          voice_setter_id: voiceSetterId,
          contact_fields: {
            phone: cleaned,
            first_name: firstName.trim() || 'Test',
            last_name: lastName.trim() || 'Call',
            email: email.trim() || '',
          },
        },
      });

      // Phase 3.1 UX fix: when supabase.functions.invoke gets a non-2xx, error.context
      // holds the Response object — parse its JSON body to surface the backend's
      // structured {error, code, hint} instead of the generic "Edge Function returned
      // a non-2xx status code" toast Brendan saw during the 2026-05-18 smoke test.
      if (error) {
        let backendError = error.message || 'Failed to initiate call';
        let hint: string | undefined;
        try {
          const ctx: any = (error as any)?.context;
          let body: any = null;
          if (ctx?.json) body = await ctx.json();
          else if (ctx?.text) {
            const txt = await ctx.text();
            try { body = JSON.parse(txt); } catch { /* not JSON */ }
          }
          if (body?.error) backendError = body.error;
          if (body?.hint) hint = body.hint;
        } catch { /* ignore parse failures, fall back to error.message */ }
        toast.error(backendError, hint ? { description: hint, duration: 10000 } : undefined);
        return;
      }
      if (data?.error) {
        toast.error(data.error, data.hint ? { description: data.hint, duration: 10000 } : undefined);
        return;
      }

      toast.success(`Call initiated! Call ID: ${data?.call_id?.slice(0, 8) || 'unknown'}`);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate call');
    } finally {
      setCalling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col !p-0 overflow-y-auto" style={{ width: '440px', maxWidth: '90vw' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 shrink-0" style={{ borderBottom: '3px groove hsl(var(--border-groove))', paddingTop: '14px', paddingBottom: '14px' }}>
          <DialogTitle>TEST CALL</DialogTitle>
          <DialogClose asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8 !bg-muted !border-border hover:!bg-accent shrink-0" title="Close">
              <X className="w-4 h-4" />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        <div className="px-6 py-5 space-y-[13px]">
          <p style={FONT} className="text-muted-foreground">
            Simulate an outbound call using {setterName || voiceSetterSlotId}. Include country code (e.g. +1 for US).
          </p>

          <div className="space-y-1.5">
            <Label className="text-foreground" style={{ ...FONT, fontSize: '12px' }}>Phone Number *</Label>
            <Input
              placeholder="+1 555 123 4567"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !calling && handleCall()}
            />
          </div>

          <div className="grid grid-cols-2 gap-[13px]">
            <div className="space-y-1.5">
              <Label className="text-foreground" style={{ ...FONT, fontSize: '12px' }}>First Name</Label>
              <Input
                placeholder="John"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground" style={{ ...FONT, fontSize: '12px' }}>Last Name</Label>
              <Input
                placeholder="Doe"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-foreground" style={{ ...FONT, fontSize: '12px' }}>Email</Label>
            <Input
              placeholder="john@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          <p className="text-muted-foreground" style={FONT}>
            To test appointment booking, provide an email — it will be included in the booking details.
          </p>

          <Button
            onClick={handleCall}
            disabled={calling || !phone.trim()}
            className="w-full groove-btn"
            style={LABEL_FONT}
          >
            {calling ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                DIALING...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Phone className="w-4 h-4" />
                MAKE TEST CALL
              </span>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
