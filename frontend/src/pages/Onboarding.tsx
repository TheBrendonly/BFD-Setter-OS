import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Upload } from '@/components/icons';
import logoImg from '@/assets/bfd-logo.png';

const Onboarding = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Error', description: 'Please select an image file', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Error', description: 'Image must be under 5MB', variant: 'destructive' });
      return;
    }
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: 'Error', description: 'Sub-account name is required', variant: 'destructive' });
      return;
    }
    if (!user) return;

    setSubmitting(true);
    try {
      // Get agency_id
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('agency_id')
        .eq('id', user.id)
        .single();

      if (profileError || !profile?.agency_id) {
        throw new Error('Could not find your agency.');
      }

      // Find and update the default "My First Account" sub-account
      const { data: existingClient, error: fetchError } = await supabase
        .from('clients_public')
        .select('id')
        .eq('agency_id', profile.agency_id)
        .eq('name', 'My First Account')
        .limit(1)
        .maybeSingle();

      let clientId: string;

      if (existingClient) {
        // Update the default sub-account
        const { error: updateError } = await supabase
          .from('clients')
          .update({
            name: name.trim(),
            email: email.trim() || null,
            description: description.trim() || null,
          })
          .eq('id', existingClient.id);

        if (updateError) throw updateError;
        clientId = existingClient.id;
      } else {
        // Create a new sub-account
        // Auto-mint intake_lead_secret for this tenant so the platform's edge fns
        // (voice-booking-tools, intake-lead) can authenticate the tenant's
        // tool-calls + form submissions without manual credential setup.
        // Mirrors scripts/onboard-client.mjs:169.
        const mintSecret = () => {
          const b = new Uint8Array(24);
          crypto.getRandomValues(b);
          return btoa(String.fromCharCode(...b));
        };
        const intakeLeadSecret = mintSecret();
        // Also mint the GHL inbound-webhook token up front so the inbound webhook
        // manifest is "secured" from day one (the operator copies it into GHL's
        // x-wh-token header). Verify-if-present until the upstream actually sends
        // it. The webhook-manifest edge fn back-fills this for existing clients.
        const ghlWebhookSecret = mintSecret();
        const { data: newClient, error: createError } = await supabase
          .from('clients')
          .insert({
            name: name.trim(),
            email: email.trim() || null,
            description: description.trim() || null,
            agency_id: profile.agency_id,
            subscription_status: 'free',
            intake_lead_secret: intakeLeadSecret,
            ghl_webhook_secret: ghlWebhookSecret,
          })
          .select('id')
          .single();

        if (createError) throw createError;
        clientId = newClient.id;
      }

      // Upload logo if selected
      if (selectedImage) {
        const fileExt = selectedImage.name.split('.').pop();
        const fileName = `${clientId}-${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('logos')
          .upload(fileName, selectedImage, { cacheControl: '0', upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('logos').getPublicUrl(fileName);
          await supabase
            .from('clients')
            .update({ image_url: `${urlData.publicUrl}?t=${Date.now()}` })
            .eq('id', clientId);
        }
      }

      // Mark onboarding as completed
      await supabase
        .from('profiles')
        .update({ onboarding_completed: true } as any)
        .eq('id', user.id);

      toast({ title: 'Welcome aboard!', description: 'Your sub-account has been set up.' });
      navigate(`/client/${clientId}/analytics/chatbot/dashboard`, { replace: true });
    } catch (error: any) {
      console.error('Onboarding error:', error);
      toast({ title: 'Error', description: error.message || 'Something went wrong', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center mobile-container pb-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-4 sm:mb-6">
          <div className="flex items-center justify-center mb-4 sm:mb-6">
            <img src={logoImg} alt="BFD-setter Logo" className="h-12 sm:h-16 w-auto" />
          </div>
          <h1 className="mobile-heading-2 text-on-surface font-semibold">Welcome! Let's Get You Started</h1>
          <p className="text-on-surface-variant mt-2 field-text">
            Set up your first sub-account to begin managing your AI setters.
          </p>
        </div>

        {/* Onboarding Form */}
        <div className="material-surface p-4 sm:p-6 lg:p-8 mt-2">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="account-name" className="field-text font-medium text-on-surface">
                Sub-Account Name *
              </Label>
              <Input
                id="account-name"
                type="text"
                placeholder="e.g. My Business Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="modern-input"
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="account-email" className="field-text font-medium text-on-surface">
                Email
              </Label>
              <Input
                id="account-email"
                type="email"
                placeholder="business@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="modern-input"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="account-description" className="field-text font-medium text-on-surface">
                Description
              </Label>
              <Textarea
                id="account-description"
                placeholder="Brief description of this account"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="modern-input resize-none"
                rows={3}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <Label className="field-text font-medium text-on-surface">Logo</Label>
              <div className="flex flex-col gap-2">
                {imagePreview && (
                  <div className="relative w-24 h-24 border border-border rounded-md overflow-hidden">
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-contain" />
                  </div>
                )}
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={submitting}
                  className="w-fit"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {imagePreview ? 'Change Logo' : 'Upload Logo'}
                </Button>
              </div>
            </div>

            <div className="pt-3">
              <Button
                type="submit"
                disabled={submitting || !name.trim()}
                className="material-button-primary modern-button-primary w-full py-3 mobile-touch"
              >
                {submitting ? 'Setting Up...' : 'Create Sub-Account & Continue'}
              </Button>
            </div>
          </form>

          <div className="mt-4 text-center">
            <p className="text-on-surface-variant field-text">
              Already have an account?{' '}
              <Link to="/auth" className="font-bold text-primary hover:text-primary/80 transition-colors underline">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
