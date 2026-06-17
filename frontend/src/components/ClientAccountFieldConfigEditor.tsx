import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RotateCcw, Save, Loader2, Settings } from '@/components/icons';
import { toast } from 'sonner';
import {
  useClientAccountFieldConfig,
  ACCOUNT_FIELD_CATALOG,
  DEFAULT_ACCOUNT_FIELDS,
  type AccountFieldConfig,
} from '@/hooks/useClientAccountFieldConfig';

// Agency-only editor: governs which "My Account" fields a client may SEE and
// EDIT, per sub-account. Mirrors ClientMenuConfigEditor but with two switches
// per field (Visible, Editable) and no reordering.
export function ClientAccountFieldConfigEditor({ clientId }: { clientId: string }) {
  const { fieldConfig, loading, saving, saveConfig, refetch } = useClientAccountFieldConfig(clientId);
  const [items, setItems] = useState<AccountFieldConfig[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!loading) {
      setItems(fieldConfig);
      setHasChanges(false);
    }
  }, [fieldConfig, loading]);

  const metaFor = (key: string) => ACCOUNT_FIELD_CATALOG.find((m) => m.key === key);

  const setVisible = (key: string, visible: boolean) => {
    setItems((prev) =>
      prev.map((f) =>
        f.key === key ? { ...f, visible, editable: visible ? f.editable : false } : f
      )
    );
    setHasChanges(true);
  };

  const setEditable = (key: string, editable: boolean) => {
    setItems((prev) =>
      prev.map((f) => (f.key === key ? { ...f, editable: f.visible && editable } : f))
    );
    setHasChanges(true);
  };

  const handleReset = () => {
    setItems(DEFAULT_ACCOUNT_FIELDS.map((f) => ({ ...f })));
    setHasChanges(true);
  };

  const handleSave = async () => {
    const success = await saveConfig(items);
    if (success) {
      toast.success('Account field access saved');
      setHasChanges(false);
      await refetch();
    } else {
      toast.error('Failed to save account field access');
    }
  };

  if (loading) return null;

  return (
    <Card className="material-surface">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Settings className="w-5 h-5" />
          My Account Field Access
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4 field-text">
          Control which sub-account settings this client can see and edit on their My Account page.
          Turn off Visible to hide a field entirely; leave Visible on but Editable off to show it read-only.
        </p>

        <div className="flex flex-col gap-2">
          {items.map((f) => {
            const meta = metaFor(f.key);
            return (
              <div
                key={f.key}
                className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg border border-border"
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="uppercase"
                    style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}
                  >
                    {meta?.label ?? f.key}
                  </div>
                  {meta?.description && (
                    <div className="text-[11px] text-muted-foreground truncate">{meta.description}</div>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[11px] uppercase text-muted-foreground">Visible</Label>
                    <Switch checked={f.visible} onCheckedChange={(v) => setVisible(f.key, v)} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-[11px] uppercase text-muted-foreground">Editable</Label>
                    <Switch
                      checked={f.editable}
                      disabled={!f.visible}
                      onCheckedChange={(v) => setEditable(f.key, v)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={saving}
            className="groove-btn !h-8"
            style={{ fontFamily: "'VT323', monospace", fontSize: '16px', fontWeight: 'bold' }}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            DEFAULT ACCESS
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium !h-8"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
            ) : (
              <><Save className="h-4 w-4 mr-2" /> Save</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
