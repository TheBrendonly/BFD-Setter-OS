import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useClientCredentials } from '@/hooks/useClientCredentials';
import { setterKey, type SetterKind } from '@/lib/setterLabels';

interface Props {
  clientId: string;
  kind: SetterKind;
  slots: Array<{ slot: number; hint?: string }>;
  title?: string;
  description?: string;
}

export const SetterDisplayNamesCard: React.FC<Props> = ({
  clientId,
  kind,
  slots,
  title,
  description,
}) => {
  const { credentials, updateCredential } = useClientCredentials(clientId);
  const stored = (credentials?.setter_display_names || {}) as Record<string, string>;

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const { slot } of slots) {
      const k = setterKey(kind, slot);
      next[k] = stored[k] ?? '';
    }
    setDraft(next);
  }, [credentials, kind, slots]);

  const handleBlur = async (key: string, slot: number) => {
    const newVal = (draft[key] ?? '').trim();
    const prevVal = (stored[key] ?? '').trim();
    if (newVal === prevVal) return;

    const next: Record<string, string> = { ...stored };
    if (newVal) {
      next[key] = newVal;
    } else {
      delete next[key];
    }

    setSaving(key);
    try {
      await updateCredential({ field: 'setter_display_names', value: next });

      // Push voice setter names to Retell agent_name on save.
      // Text setters have no Retell agent so we skip the push for them.
      // The retell-proxy set-agent-name action is lightweight: PATCH agent_name
      // + publish-agent + repoint phone version. NEVER touches LLM prompt / voice.
      // If the slot has no Retell agent yet, the action returns "skipped_no_agent"
      // and we just save the local display name (next full Push to Retell will
      // create the agent with this name).
      let retellWarning: string | null = null;
      if (kind === 'voice' && newVal) {
        try {
          const { data: retellResult, error: retellError } = await supabase.functions.invoke('retell-proxy', {
            body: {
              action: 'set-agent-name',
              clientId,
              slotNumber: slot,
              agentName: newVal,
            },
          });
          if (retellError) {
            retellWarning = retellError.message || 'Retell push failed';
          } else if (retellResult?.action === 'skipped_no_agent') {
            retellWarning = retellResult.reason || 'No Retell agent exists for this slot yet';
          } else if (retellResult?.action === 'patched_but_publish_failed') {
            retellWarning = `Name saved + agent updated but publish-agent failed: ${retellResult.publish_error || 'unknown error'}. Try the full Push to Retell from the Voice Setter editor.`;
          }
        } catch (retellErr) {
          retellWarning = retellErr instanceof Error ? retellErr.message : 'Retell push failed';
        }
      }

      if (retellWarning) {
        toast.warning('Setter name saved (Retell push warning)', { description: retellWarning, duration: 9000 });
      } else if (kind === 'voice') {
        toast.success('Setter name saved + pushed to Retell agent');
      } else {
        toast.success('Setter name saved');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save name');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-wide">
          {title || 'Setter Display Names'}
        </CardTitle>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {slots.map(({ slot, hint }) => {
            const key = setterKey(kind, slot);
            return (
              <div key={key}>
                <Label className="text-xs">
                  Setter {slot}
                  {hint && <span className="text-muted-foreground"> · {hint}</span>}
                </Label>
                <Input
                  value={draft[key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  onBlur={() => handleBlur(key, slot)}
                  placeholder={`Setter ${slot}`}
                  disabled={saving === key}
                  className="h-8 text-sm"
                  maxLength={64}
                />
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Empty falls back to "Setter {slots[0]?.slot ?? 1}". Saved on blur. Used in Simulator,
          Logs, Outbound runs, conversation history{kind === 'voice' ? ', AND pushed to the Retell agent as agent_name (visible in the Retell dashboard)' : ''}.
        </p>
      </CardContent>
    </Card>
  );
};
