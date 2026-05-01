import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
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

  const handleBlur = async (key: string) => {
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
      toast.success('Setter name saved');
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
                  onBlur={() => handleBlur(key)}
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
          Logs, Outbound runs, and conversation history.
        </p>
      </CardContent>
    </Card>
  );
};
