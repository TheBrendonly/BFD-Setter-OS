import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Plus, Trash2, RefreshCw, Loader2, Phone } from 'lucide-react';
import { useRetellApi, RetellPhoneNumber, RetellAgent, getInboundAgentId, getOutboundAgentId } from '@/hooks/useRetellApi';
import { supabase } from '@/integrations/supabase/client';
import { edgeFunctionUrl } from '@/integrations/supabase/functionsBase';
import { fetchTwilioPhoneNumbers } from '@/lib/twilioNumbers';

interface RetellPhoneNumbersTabProps {
  clientId: string;
}

const RetellPhoneNumbersTab: React.FC<RetellPhoneNumbersTabProps> = ({ clientId }) => {
  const retell = useRetellApi(clientId);
  const [phones, setPhones] = useState<RetellPhoneNumber[]>([]);
  const [agents, setAgents] = useState<RetellAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [deletingPhone, setDeletingPhone] = useState<string | null>(null);
  const [updatingPhone, setUpdatingPhone] = useState<string | null>(null);

  // Import form
  const [showImportForm, setShowImportForm] = useState(false);
  const [importNumber, setImportNumber] = useState('');
  const [importSid, setImportSid] = useState('');
  const [importToken, setImportToken] = useState('');
  const [importTermUri, setImportTermUri] = useState('');
  const [importNickname, setImportNickname] = useState('');

  // Twilio browsing
  const [twilioConfigured, setTwilioConfigured] = useState(false);
  const [twilioNumbers, setTwilioNumbers] = useState<Array<{ phone_number: string; friendly_name: string; sid: string }>>([]);
  const [loadingTwilioNumbers, setLoadingTwilioNumbers] = useState(false);
  const [selectedTwilioNumber, setSelectedTwilioNumber] = useState('');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [phonesData, agentsData] = await Promise.all([
        retell.listPhoneNumbers(),
        retell.listAgents(),
      ]);
      setPhones(Array.isArray(phonesData) ? phonesData : []);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load phone numbers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []); // eslint-disable-line

  // Check if Twilio credentials are configured
  useEffect(() => {
    supabase.from('clients_public').select('twilio_account_sid, has_twilio_auth_token').eq('id', clientId).single().then(({ data }) => {
      setTwilioConfigured(!!(data?.twilio_account_sid && data?.has_twilio_auth_token));
    });
  }, [clientId]);

  const fetchTwilioNumbers = useCallback(async () => {
    setLoadingTwilioNumbers(true);
    try {
      const numbers = await fetchTwilioPhoneNumbers({ clientId });
      const retellPhoneSet = new Set(phones.map(p => p.phone_number));
      const available = numbers
        .map((n) => ({
          phone_number: n.phone_number || '',
          friendly_name: n.friendly_name || '',
          sid: n.sid || '',
        }))
        .filter((n) => n.phone_number && !retellPhoneSet.has(n.phone_number));
      setTwilioNumbers(available);
    } catch (err: any) {
      console.error('Failed to fetch Twilio numbers:', err);
      toast.error('Failed to load Twilio numbers');
      setTwilioNumbers([]);
    } finally {
      setLoadingTwilioNumbers(false);
    }
  }, [clientId, phones]);

  const handleImportFromTwilio = async (phoneNumber?: string) => {
    const numberToImport = (phoneNumber || importNumber).trim();
    if (!numberToImport) { toast.error('Phone number is required'); return; }

    setImporting(true);
    try {
      const phoneData: Record<string, unknown> = {
        phone_number: numberToImport,
        phone_number_type: 'twilio',
        termination_uri: edgeFunctionUrl('retell-call-webhook'),
      };

      // If manual SID/token provided, use those; otherwise Retell uses the client's stored creds
      if (importSid.trim() && importToken.trim()) {
        phoneData.twilio_account_sid = importSid.trim();
        phoneData.twilio_auth_token = importToken.trim();
      }

      if (importTermUri.trim()) {
        phoneData.termination_uri = importTermUri.trim();
      }

      if (importNickname.trim()) {
        phoneData.nickname = importNickname.trim();
      }

      await retell.importPhoneNumber(phoneData);
      toast.success(`Phone number ${numberToImport} imported to Retell`);
      setShowImportForm(false);
      setImportNumber('');
      setImportSid('');
      setImportToken('');
      setImportTermUri('');
      setImportNickname('');
      setSelectedTwilioNumber('');
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
    }
  };

  const handleAssignAgent = async (phoneNumber: string, direction: 'inbound' | 'outbound', agentId: string | null) => {
    setUpdatingPhone(phoneNumber);
    try {
      const key = direction === 'inbound' ? 'inbound_agents' : 'outbound_agents';
      await retell.updatePhoneNumber(phoneNumber, { [key]: agentId ? [{ agent_id: agentId, weight: 1 }] : [] });
      toast.success('Phone number updated');
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setUpdatingPhone(null);
    }
  };

  const handleDelete = async (phoneNumber: string) => {
    setDeletingPhone(phoneNumber);
    try {
      await retell.deletePhoneNumber(phoneNumber);
      toast.success('Phone number deleted');
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeletingPhone(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">Phone Numbers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{phones.length} number{phones.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button size="sm" onClick={() => {
            setShowImportForm(!showImportForm);
            if (!showImportForm && twilioConfigured) fetchTwilioNumbers();
          }}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Import Number
          </Button>
        </div>
      </div>

      {showImportForm && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Import Phone Number from Twilio</CardTitle>
            <CardDescription className="text-xs">
              {twilioConfigured
                ? 'Select a Twilio number to import into Retell, or enter one manually.'
                : 'Configure Twilio credentials first, or enter details manually.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Twilio number browser */}
            {twilioConfigured && (
              <div>
                <Label className="text-xs">Your Twilio Numbers</Label>
                {loadingTwilioNumbers ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading Twilio numbers...
                  </div>
                ) : twilioNumbers.length > 0 ? (
                  <div className="space-y-2">
                    <Select
                      value={selectedTwilioNumber}
                      onValueChange={(val) => {
                        setSelectedTwilioNumber(val);
                        setImportNumber(val);
                        const found = twilioNumbers.find(n => n.phone_number === val);
                        if (found) setImportNickname(found.friendly_name || '');
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select a Twilio number..." />
                      </SelectTrigger>
                      <SelectContent>
                        {twilioNumbers.map(n => (
                          <SelectItem key={n.phone_number} value={n.phone_number}>
                            {n.phone_number} {n.friendly_name ? `(${n.friendly_name})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={fetchTwilioNumbers}>
                      <RefreshCw className="h-3 w-3 mr-1" /> Reload
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-1">
                    No available Twilio numbers found (all may already be in Retell).
                  </p>
                )}
              </div>
            )}

            {/* Manual entry */}
            <div>
              <Label className="text-xs">{twilioConfigured ? 'Or enter manually (E.164)' : 'Phone Number (E.164 format)'}</Label>
              <Input
                value={importNumber}
                onChange={e => { setImportNumber(e.target.value); setSelectedTwilioNumber(''); }}
                placeholder="+14157774444"
                className="h-8 text-sm"
              />
            </div>

            <div>
              <Label className="text-xs">Nickname (optional)</Label>
              <Input
                value={importNickname}
                onChange={e => setImportNickname(e.target.value)}
                placeholder="My business line"
                className="h-8 text-sm"
              />
            </div>

            {/* Manual Twilio creds (only if not configured on client) */}
            {!twilioConfigured && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Twilio Account SID</Label>
                  <Input
                    value={importSid}
                    onChange={e => setImportSid(e.target.value)}
                    placeholder="AC..."
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Twilio Auth Token</Label>
                  <Input
                    type="password"
                    value={importToken}
                    onChange={e => setImportToken(e.target.value)}
                    placeholder="Auth token"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowImportForm(false)}>Cancel</Button>
              <Button size="sm" onClick={() => handleImportFromTwilio()} disabled={importing || !importNumber.trim()}>
                {importing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Import to Retell
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {phones.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <Phone className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No phone numbers imported yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {phones.map(phone => (
            <Card key={phone.phone_number}>
              <div className="p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">
                      {phone.phone_number_pretty || phone.phone_number}
                    </span>
                    {phone.nickname && (
                      <span className="text-xs text-muted-foreground ml-2">({phone.nickname})</span>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {phone.phone_number_type || 'unknown'}
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={deletingPhone === phone.phone_number}>
                        {deletingPhone === phone.phone_number ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Phone Number</AlertDialogTitle>
                        <AlertDialogDescription>
                          Remove {phone.phone_number_pretty || phone.phone_number} from Retell?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(phone.phone_number)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {/* Agent Assignment */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Inbound Agent</Label>
                    <Select
                      value={getInboundAgentId(phone) || 'none'}
                      onValueChange={v => handleAssignAgent(phone.phone_number, 'inbound', v === 'none' ? null : v)}
                      disabled={updatingPhone === phone.phone_number}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {agents.map(a => (
                          <SelectItem key={a.agent_id} value={a.agent_id}>
                            {a.agent_name || a.agent_id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Outbound Agent</Label>
                    <Select
                      value={getOutboundAgentId(phone) || 'none'}
                      onValueChange={v => handleAssignAgent(phone.phone_number, 'outbound', v === 'none' ? null : v)}
                      disabled={updatingPhone === phone.phone_number}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {agents.map(a => (
                          <SelectItem key={a.agent_id} value={a.agent_id}>
                            {a.agent_name || a.agent_id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default RetellPhoneNumbersTab;
