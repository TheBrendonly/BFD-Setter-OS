import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Save, Upload, X, Settings } from '@/components/icons';
import { supabase } from '@/integrations/supabase/client';
import { ClientQuietHoursCard } from '@/components/setters/ClientQuietHoursCard';
import { ClientVoicemailCard } from '@/components/setters/ClientVoicemailCard';
import type { AccountFieldConfig } from '@/hooks/useClientAccountFieldConfig';

// Timezone list mirrors the one in ClientSettings.tsx (kept in sync with the
// edge function's ALLOWED_TIMEZONES set).
const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEDT/AEST)' },
  { value: 'Australia/Melbourne', label: 'Australia/Melbourne (AEDT/AEST)' },
  { value: 'Australia/Brisbane', label: 'Australia/Brisbane (AEST)' },
  { value: 'Australia/Adelaide', label: 'Australia/Adelaide (ACDT/ACST)' },
  { value: 'Australia/Perth', label: 'Australia/Perth (AWST)' },
  { value: 'Australia/Darwin', label: 'Australia/Darwin (ACST)' },
  { value: 'Australia/Hobart', label: 'Australia/Hobart (AEDT/AEST)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZDT/NZST)' },
  { value: 'America/New_York', label: 'America/New_York (EDT/EST)' },
  { value: 'America/Chicago', label: 'America/Chicago (CDT/CST)' },
  { value: 'America/Denver', label: 'America/Denver (MDT/MST)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PDT/PST)' },
  { value: 'Europe/London', label: 'Europe/London (BST/GMT)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CEST/CET)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'UTC', label: 'UTC' },
];

type FieldGov = { visible: boolean; editable: boolean };

// Client-facing "My Account" sub-account settings, scoped to the admin-governed
// subset. Reads + writes go through the save-account-settings edge function
// (the clients table is not client-readable/writable via RLS).
export function ClientAccountSettingsCard({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gov, setGov] = useState<Record<string, FieldGov>>({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState({ name: '', email: '', description: '', brand_voice: '', timezone: 'Australia/Sydney' });
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [imageRemoved, setImageRemoved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('save-account-settings', {
        body: { action: 'read', client_id: clientId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const fields = (data?.fields ?? []) as AccountFieldConfig[];
      const govMap: Record<string, FieldGov> = {};
      for (const f of fields) govMap[f.key] = { visible: f.visible, editable: f.editable };
      setGov(govMap);
      const v = (data?.values ?? {}) as Record<string, unknown>;
      setValues(v);
      setForm({
        name: (v.name as string) ?? '',
        email: (v.email as string) ?? '',
        description: (v.description as string) ?? '',
        brand_voice: (v.brand_voice as string) ?? '',
        timezone: (v.timezone as string) ?? 'Australia/Sydney',
      });
      setSelectedImage(null);
      setImagePreview('');
      setImageRemoved(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load account settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const g = (key: string): FieldGov => gov[key] ?? { visible: false, editable: false };

  // Persist a single field via the edge function (used by the quiet-hours /
  // voicemail cards' onPersist).
  const persistField = async (key: string, value: unknown): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke('save-account-settings', {
      body: { action: 'save', client_id: clientId, patch: { [key]: value } },
    });
    if (error) {
      toast.error(error.message);
      return false;
    }
    if (data?.error) {
      toast.error(data.error);
      return false;
    }
    return true;
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Please select an image smaller than 5MB'); return; }
    setSelectedImage(file);
    setImageRemoved(false);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setSelectedImage(null);
    setImagePreview('');
    setImageRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadLogo = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${clientId}-${Date.now()}.${fileExt}`;
    const { error } = await supabase.storage.from('logos').upload(fileName, file, { cacheControl: '0', upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(fileName);
    return `${publicUrl}?t=${Date.now()}`;
  };

  // Save the editable simple fields (name/email/description/brand_voice/timezone)
  // + logo in one patch. Quiet hours / voicemail save through their own cards.
  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      const text = (k: 'name' | 'email' | 'description' | 'brand_voice') => {
        if (g(k).visible && g(k).editable) patch[k] = form[k];
      };
      text('name');
      text('email');
      text('description');
      text('brand_voice');
      if (g('timezone').visible && g('timezone').editable) patch.timezone = form.timezone;

      if (g('logo').visible && g('logo').editable) {
        if (selectedImage) patch.logo = await uploadLogo(selectedImage);
        else if (imageRemoved) patch.logo = null;
      }

      if (Object.keys(patch).length === 0) {
        toast('Nothing to save');
        return;
      }

      const { data, error } = await supabase.functions.invoke('save-account-settings', {
        body: { action: 'save', client_id: clientId, patch },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Account settings updated');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update account settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  const showSimple =
    g('name').visible || g('email').visible || g('description').visible ||
    g('brand_voice').visible || g('timezone').visible || g('logo').visible;

  // Nothing surfaced to the client at all.
  if (!showSimple && !g('quiet_hours').visible && !g('voicemail').visible) return null;

  const existingLogo = (values.logo as string) || '';
  const simpleEditableCount =
    (g('name').editable ? 1 : 0) + (g('email').editable ? 1 : 0) + (g('description').editable ? 1 : 0) +
    (g('brand_voice').editable ? 1 : 0) + (g('timezone').editable ? 1 : 0) + (g('logo').editable ? 1 : 0);

  return (
    <Card className="material-surface">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Sub-Account Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {g('name').visible && (
          <div className="space-y-2">
            <Label htmlFor="acct-name" className="field-text">Name</Label>
            <Input
              id="acct-name"
              value={form.name}
              disabled={!g('name').editable}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="field-text"
            />
          </div>
        )}

        {g('email').visible && (
          <div className="space-y-2">
            <Label htmlFor="acct-email" className="field-text">Email</Label>
            <Input
              id="acct-email"
              type="email"
              value={form.email}
              disabled={!g('email').editable}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="field-text"
            />
          </div>
        )}

        {g('description').visible && (
          <div className="space-y-2">
            <Label htmlFor="acct-desc" className="field-text">Description</Label>
            <Textarea
              id="acct-desc"
              value={form.description}
              disabled={!g('description').editable}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="field-text"
            />
          </div>
        )}

        {g('brand_voice').visible && (
          <div className="space-y-2">
            <Label htmlFor="acct-brand" className="field-text">Brand Voice</Label>
            <Textarea
              id="acct-brand"
              value={form.brand_voice}
              disabled={!g('brand_voice').editable}
              onChange={(e) => setForm({ ...form, brand_voice: e.target.value })}
              placeholder="Tone and style notes the AI uses when generating engagement copy"
              className="field-text"
            />
          </div>
        )}

        {g('timezone').visible && (
          <div className="space-y-2">
            <Label htmlFor="acct-tz" className="field-text">Timezone</Label>
            <Select
              value={form.timezone || 'Australia/Sydney'}
              onValueChange={(value) => setForm({ ...form, timezone: value })}
              disabled={!g('timezone').editable}
            >
              <SelectTrigger id="acct-tz" className="field-text">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {g('logo').visible && (
          <div className="space-y-2">
            <Label className="field-text">Logo</Label>
            <div className="flex flex-col gap-4">
              {(imagePreview || (existingLogo && !imageRemoved)) && (
                <div className="relative inline-block">
                  <img
                    src={imagePreview || existingLogo}
                    alt="Logo preview"
                    className="h-16 object-contain border border-border rounded p-2"
                  />
                  {g('logo').editable && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6"
                      onClick={removeImage}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
              {g('logo').editable && (
                <div>
                  <Input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" />
                    {(imagePreview || existingLogo) && !imageRemoved ? 'Change Logo' : 'Upload Logo'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {g('quiet_hours').visible && (
          <ClientQuietHoursCard
            clientId={clientId}
            readOnly={!g('quiet_hours').editable}
            initialValue={values.quiet_hours}
            fallbackTz={form.timezone}
            onPersist={(config) => persistField('quiet_hours', config)}
          />
        )}

        {g('voicemail').visible && (
          <ClientVoicemailCard
            clientId={clientId}
            readOnly={!g('voicemail').editable}
            initialValue={values.voicemail}
            onPersist={(config) => persistField('voicemail', config)}
          />
        )}

        {showSimple && simpleEditableCount > 0 && (
          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
