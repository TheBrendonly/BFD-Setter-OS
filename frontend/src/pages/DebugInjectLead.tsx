// Bug 11 — Debug Inject Lead page.
//
// Manual reactivation/test-injection harness. Picks a workflow, accepts a
// phone + (optional) name/email, and fires the reactivate-lead RPC with
// kind="manual" so the resulting engagement_executions row is tagged
// distinctly from real new_lead enrollments.
//
// Mounted at /client/:clientId/debug-inject-lead. No agency-level admin gate
// — the existing client-scoped route guard already restricts to the client's
// own users.
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Workflow {
  id: string;
  name: string;
  status: string | null;
}

const DebugInjectLead: React.FC = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState<string>('');
  const [leadId, setLeadId] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [firstName, setFirstName] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; payload: unknown } | null>(null);

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      const { data, error } = await supabase
        .from('engagement_workflows')
        .select('id, name, status')
        .eq('client_id', clientId)
        .order('updated_at', { ascending: false }) as any;
      if (error) {
        toast({ title: 'Failed to load workflows', description: error.message, variant: 'destructive' });
        return;
      }
      setWorkflows((data as Workflow[]) ?? []);
    })();
  }, [clientId, toast]);

  const canSubmit = useMemo(() => {
    return !!clientId && !!workflowId && !!leadId && !submitting;
  }, [clientId, workflowId, leadId, submitting]);

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setLastResult(null);
    try {
      const { data, error } = await (supabase.functions as any).invoke('reactivate-lead', {
        body: {
          client_id: clientId,
          workflow_id: workflowId,
          lead_id: leadId,
          phone: phone || undefined,
          email: email || undefined,
          kind: 'manual',
        },
      });
      if (error) {
        setLastResult({ ok: false, payload: { error: error.message ?? String(error) } });
        toast({ title: 'Inject failed', description: error.message, variant: 'destructive' });
        return;
      }
      setLastResult({ ok: true, payload: data });
      toast({
        title: 'Injected',
        description: `Execution ${(data as any)?.execution_id ?? '?'}, kind=manual`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      setLastResult({ ok: false, payload: { error: msg } });
      toast({ title: 'Inject error', description: msg, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Debug — Inject Lead</h1>
        <p className="text-sm text-muted-foreground">
          Manually enrol a lead into an engagement workflow with kind=manual.
          For internal testing / smoke runs. Uses the reactivate-lead RPC,
          same path Reactivate uses.
        </p>
      </div>

      <div className="space-y-3 border rounded-md p-4">
        <div>
          <label className="text-sm font-medium block mb-1">Workflow</label>
          <Select value={workflowId} onValueChange={setWorkflowId}>
            <SelectTrigger>
              <SelectValue placeholder="Select workflow..." />
            </SelectTrigger>
            <SelectContent>
              {workflows.map(w => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name} {w.status ? `(${w.status})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Lead ID (GHL contactId)</label>
          <Input value={leadId} onChange={e => setLeadId(e.target.value)} placeholder="e.g. abc123..." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium block mb-1">Phone (optional)</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+61..." />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Email (optional)</label>
            <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="test@example.com" />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">First Name (optional)</label>
          <Input value={firstName} onChange={e => setFirstName(e.target.value)} />
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {submitting ? 'Injecting...' : 'Inject Lead'}
          </Button>
        </div>
      </div>

      {lastResult && (
        <div className={`border rounded-md p-3 text-xs font-mono ${lastResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="font-semibold mb-1">{lastResult.ok ? 'OK' : 'ERROR'}</div>
          <pre className="whitespace-pre-wrap">{JSON.stringify(lastResult.payload, null, 2)}</pre>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        <p><strong>Note:</strong> requires an existing leads row OR will skip
        contact hydration (just uses the body fields). The phone/email defaults
        come from leads(client_id, lead_id) if present.</p>
      </div>
    </div>
  );
};

export default DebugInjectLead;
