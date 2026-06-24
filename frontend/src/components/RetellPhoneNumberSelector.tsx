import React, { useState, useEffect, useCallback } from 'react';
import { useRetellApi, RetellPhoneNumber, getInboundAgentId, getOutboundAgentId } from '@/hooks/useRetellApi';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { Check } from '@/components/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { edgeFunctionUrl } from '@/integrations/supabase/functionsBase';
import { fetchTwilioPhoneNumbers } from '@/lib/twilioNumbers';

const PixelRefreshIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" style={{ imageRendering: 'pixelated' as const }}>
    <rect x="3" y="3" width="10" height="2" />
    <rect x="3" y="3" width="2" height="6" />
    <rect x="11" y="7" width="2" height="6" />
    <rect x="3" y="11" width="10" height="2" />
    <rect x="11" y="1" width="2" height="4" />
    <rect x="3" y="11" width="2" height="4" />
  </svg>
);

const PixelPlusIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" style={{ imageRendering: 'pixelated' as const }}>
    <rect x="7" y="3" width="2" height="10" />
    <rect x="3" y="7" width="10" height="2" />
  </svg>
);

const monoStyle = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;

function PhoneNumberSelect({ value, onChange, options, placeholder, disabled }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "relative flex h-8 w-full items-center groove-border bg-card px-3 pr-10 py-1 text-left",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          style={{ ...monoStyle }}
        >
          <span className={cn("truncate flex-1", !value || value === 'none' ? "text-muted-foreground" : "text-foreground")}>
            {selected?.label || placeholder || 'Select...'}
          </span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 text-foreground" fill="currentColor" style={{ imageRendering: 'pixelated' }}>
              <rect x="7" y="9" width="2" height="2" />
              <rect x="9" y="11" width="2" height="2" />
              <rect x="11" y="13" width="2" height="2" />
              <rect x="13" y="11" width="2" height="2" />
              <rect x="15" y="9" width="2" height="2" />
            </svg>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 groove-border bg-sidebar" align="start" sideOffset={4}>
        <div className="max-h-[260px] overflow-y-auto p-1">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                "flex items-center w-full gap-2 rounded-sm px-3 py-1.5 cursor-pointer",
                "hover:bg-accent hover:text-accent-foreground",
                value === opt.value && "bg-accent text-accent-foreground"
              )}
              style={{ ...monoStyle }}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <Check className={cn("h-3.5 w-3.5 shrink-0", value === opt.value ? "opacity-100" : "opacity-0")} />
              <span className="truncate flex-1 text-left">{opt.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface RetellPhoneNumberSelectorProps {
  clientId: string;
  slotId?: string;
  disabled?: boolean;
  onMarkNeedsSync?: () => void;
}

export const RetellPhoneNumberSelector: React.FC<RetellPhoneNumberSelectorProps> = ({
  clientId,
  slotId,
  disabled = false,
  onMarkNeedsSync,
}) => {
  const { listPhoneNumbers, updatePhoneNumber } = useRetellApi(clientId);
  const { importPhoneNumber } = useRetellApi(clientId);
  const [phoneNumbers, setPhoneNumbers] = useState<RetellPhoneNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedPhone, setSelectedPhone] = useState<string>('none');
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importPhone, setImportPhone] = useState('');
  const [importNickname, setImportNickname] = useState('');
  const [importingNumber, setImportingNumber] = useState(false);
  const [twilioConfigured, setTwilioConfigured] = useState(false);
  const [twilioNumbers, setTwilioNumbers] = useState<Array<{ phone_number: string; friendly_name: string }>>([]);
  const [loadingTwilioNumbers, setLoadingTwilioNumbers] = useState(false);

  const slotNumber = slotId ? parseInt(slotId.replace('Voice-Setter-', ''), 10) : null;

  const fetchPhoneNumbers = useCallback(async () => {
    setLoading(true);
    try {
      const numbers = await listPhoneNumbers();
      setPhoneNumbers(Array.isArray(numbers) ? numbers : []);
    } catch (err: any) {
      console.error('Failed to fetch phone numbers:', err);
    } finally {
      setLoading(false);
    }
  }, [listPhoneNumbers]);

  // Fetch agent ID for current slot
  useEffect(() => {
    if (!clientId || !slotNumber) return;
    const SLOT_COLUMNS: Record<number, string> = {
      1: 'retell_inbound_agent_id', 2: 'retell_outbound_agent_id',
      3: 'retell_outbound_followup_agent_id', 4: 'retell_agent_id_4',
      5: 'retell_agent_id_5', 6: 'retell_agent_id_6',
      7: 'retell_agent_id_7', 8: 'retell_agent_id_8',
      9: 'retell_agent_id_9', 10: 'retell_agent_id_10',
    };
    const col = SLOT_COLUMNS[slotNumber];
    if (!col) return;
    supabase.from('clients_public').select(`${col},twilio_account_sid,has_twilio_auth_token`).eq('id', clientId).single().then(({ data }) => {
      setCurrentAgentId((data as any)?.[col] || null);
      setTwilioConfigured(!!((data as any)?.twilio_account_sid && (data as any)?.has_twilio_auth_token));
    });
  }, [clientId, slotNumber]);

  useEffect(() => {
    fetchPhoneNumbers();
  }, [fetchPhoneNumbers]);

  // Determine which phone is currently assigned to this setter's agent
  useEffect(() => {
    if (!currentAgentId || phoneNumbers.length === 0) {
      setSelectedPhone('none');
      return;
    }
    const assigned = phoneNumbers.find(
      (p) => getInboundAgentId(p) === currentAgentId || getOutboundAgentId(p) === currentAgentId
    );
    setSelectedPhone(assigned?.phone_number || 'none');
  }, [currentAgentId, phoneNumbers]);

  const handleAssign = async (phoneNumber: string) => {
    if (!currentAgentId) {
      toast.error('No Retell agent found for this setter. Save the setter first to create the agent.');
      return;
    }
    setAssigning(true);
    try {
      if (phoneNumber === 'none') {
        // Unassign: find currently assigned phone and clear it
        const current = phoneNumbers.find(
          (p) => getInboundAgentId(p) === currentAgentId || getOutboundAgentId(p) === currentAgentId
        );
        if (current) {
          await updatePhoneNumber(current.phone_number, {
            outbound_agents: [],
          });
        }
        setSelectedPhone('none');
        // Clear DB column
        if (slotNumber) {
          const phoneCol = `retell_phone_${Math.min(slotNumber, 3)}` as 'retell_phone_1' | 'retell_phone_2' | 'retell_phone_3';
          if (slotNumber <= 3) {
            await supabase.from('clients').update({ [phoneCol]: null }).eq('id', clientId);
          }
        }
        toast.success('Phone number unassigned');
      } else {
        // Assign outbound only (no inbound assignment)
        await updatePhoneNumber(phoneNumber, {
          outbound_agents: [{ agent_id: currentAgentId, weight: 1 }],
        });
        setSelectedPhone(phoneNumber);
        // Persist to DB so make-retell-outbound-call can find it
        if (slotNumber) {
          const phoneCol = slotNumber <= 3
            ? `retell_phone_${slotNumber}` as 'retell_phone_1' | 'retell_phone_2' | 'retell_phone_3'
            : 'retell_phone_1' as const;
          await supabase.from('clients').update({ [phoneCol]: phoneNumber }).eq('id', clientId);
          console.log(`📞 Persisted ${phoneNumber} to clients.${phoneCol}`);
        }
        toast.success('Phone number assigned for outbound calls');
      }
      onMarkNeedsSync?.();
      await fetchPhoneNumbers();
    } catch (err: any) {
      console.error('Failed to assign phone number:', err);
      toast.error(err?.message || 'Failed to assign phone number');
    } finally {
      setAssigning(false);
    }
  };

  const fetchTwilioNumbers = useCallback(async () => {
    setLoadingTwilioNumbers(true);
    try {
      const numbers = await fetchTwilioPhoneNumbers({ clientId });
      setTwilioNumbers(numbers.map((n) => ({
        phone_number: n.phone_number || '',
        friendly_name: n.friendly_name || '',
      })));
    } catch (err: any) {
      console.error('Failed to fetch Twilio numbers:', err);
      setTwilioNumbers([]);
    } finally {
      setLoadingTwilioNumbers(false);
    }
  }, [clientId]);

  const handleImportFromTwilio = async () => {
    if (!importPhone.trim()) return;
    setImportingNumber(true);
    try {
      await importPhoneNumber({
        phone_number: importPhone.trim(),
        phone_number_type: 'twilio',
        termination_uri: edgeFunctionUrl('retell-call-webhook'),
        ...(importNickname.trim() ? { nickname: importNickname.trim() } : {}),
      });
      toast.success(`Phone number ${importPhone} imported to Retell`);
      setShowImportDialog(false);
      setImportPhone('');
      setImportNickname('');
      await fetchPhoneNumbers();
    } catch (err: any) {
      console.error('Failed to import phone number:', err);
      toast.error(err?.message || 'Failed to import phone number to Retell');
    } finally {
      setImportingNumber(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-foreground" style={monoStyle as any}>Phone Number</span>
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={fetchPhoneNumbers}
          disabled={loading}
          className="h-8 gap-1.5 groove-border"
          style={monoStyle as any}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PixelRefreshIcon />}
          Reload
        </Button>
      </div>
      {loading && phoneNumbers.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs py-2" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading phone numbers...
        </div>
      ) : phoneNumbers.length === 0 ? (
        <p className="text-muted-foreground text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          No phone numbers found in your Retell account. Import one in the Retell dashboard first.
        </p>
      ) : (
        <PhoneNumberSelect
          value={selectedPhone}
          onChange={handleAssign}
          options={[
            { value: 'none', label: 'No phone number' },
            ...phoneNumbers.map((p) => {
              const assignedTo = getInboundAgentId(p) || getOutboundAgentId(p);
              const isAssignedHere = assignedTo === currentAgentId;
              const isAssignedElsewhere = assignedTo && !isAssignedHere;
              return {
                value: p.phone_number,
                label: `${p.phone_number_pretty || p.phone_number}${p.nickname ? ` (${p.nickname})` : ''}${isAssignedHere ? ' ✓' : ''}${isAssignedElsewhere ? ' (in use)' : ''}`,
              };
            }),
          ]}
          placeholder={currentAgentId ? "Select a phone number..." : "Save setter first to assign phone"}
          disabled={disabled || assigning || !currentAgentId}
        />
      )}
      {assigning && (
        <div className="flex items-center gap-2 text-muted-foreground text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Assigning...
        </div>
      )}

      {/* Import from Twilio button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setShowImportDialog(true);
          if (twilioConfigured) {
            fetchTwilioNumbers();
          }
        }}
        disabled={disabled}
        className="w-full groove-btn gap-1.5 mt-1"
        style={{ fontFamily: "'VT323', monospace", fontSize: '16px', letterSpacing: '0.5px' }}
      >
        <PixelPlusIcon />
        Import Phone Number from Twilio
      </Button>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-md !p-0">
          <DialogHeader>
            <DialogTitle>Import Twilio Number to Retell</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-5 space-y-4">
            {!twilioConfigured ? (
              <p className="text-muted-foreground" style={monoStyle as any}>
                Twilio credentials are not configured. Please add your Twilio Account SID and Auth Token in{' '}
                <a href={`/client/${clientId}/credentials?highlight=twilio-configuration`} className="text-primary underline">API Credentials</a> first.
              </p>
            ) : (
              <>
                {loadingTwilioNumbers ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4" style={monoStyle as any}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading Twilio numbers...
                  </div>
                ) : twilioNumbers.length > 0 ? (
                  <div className="space-y-2">
                    <span className="text-foreground" style={{ ...monoStyle, fontWeight: 500 } as any}>Select a Twilio Number</span>
                    <Select
                      value={importPhone}
                      onValueChange={(val) => {
                        setImportPhone(val);
                        const found = twilioNumbers.find(n => n.phone_number === val);
                        if (found) setImportNickname(found.friendly_name || '');
                      }}
                    >
                      <SelectTrigger className="groove-input" style={monoStyle as any}>
                        <SelectValue placeholder="Select a number..." />
                      </SelectTrigger>
                      <SelectContent>
                        {twilioNumbers.map((n) => (
                          <SelectItem key={n.phone_number} value={n.phone_number} style={monoStyle as any}>
                            {n.phone_number} {n.friendly_name ? `(${n.friendly_name})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <span className="text-foreground" style={{ ...monoStyle, fontWeight: 500 } as any}>Or enter phone number manually</span>
                  <Input
                    value={importPhone}
                    onChange={(e) => setImportPhone(e.target.value)}
                    placeholder="+1234567890"
                  />
                </div>
                <div className="space-y-2">
                  <span className="text-foreground" style={{ ...monoStyle, fontWeight: 500 } as any}>Nickname (optional)</span>
                  <Input
                    value={importNickname}
                    onChange={(e) => setImportNickname(e.target.value)}
                    placeholder="My business line"
                  />
                </div>
                <p className="text-muted-foreground" style={monoStyle as any}>
                  This will import the Twilio number into your Retell account using your Twilio Account SID and Auth Token.
                </p>
              </>
            )}
          </div>
          <div className="flex gap-3 px-6 pb-6 pt-1">
            <Button variant="default" className="flex-1" onClick={() => setShowImportDialog(false)} style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}>
              CANCEL
            </Button>
            {twilioConfigured && (
              <Button
                variant="default"
                className="flex-1"
                onClick={handleImportFromTwilio}
                disabled={importingNumber || !importPhone.trim()}
                style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
              >
                {importingNumber ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> IMPORTING...</> : 'IMPORT'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};