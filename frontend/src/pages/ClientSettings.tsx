import { useParams, useNavigate } from "react-router-dom";
import { useCreatorMode } from "@/hooks/useCreatorMode";
import RetroLoader from "@/components/RetroLoader";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload, X, CreditCard } from "@/components/icons";
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { useAuth } from "@/hooks/useAuth";
import { ClientMenuConfigEditor } from "@/components/ClientMenuConfigEditor";
import { ClientAccountFieldConfigEditor } from "@/components/ClientAccountFieldConfigEditor";
import { useSubscription } from "@/hooks/useSubscription";
import { UnsavedChangesDialog } from '@/components/UnsavedChangesDialog';
import { ClientVoicemailCard } from '@/components/setters/ClientVoicemailCard';
import { ClientQuietHoursCard } from '@/components/setters/ClientQuietHoursCard';


export default function ClientSettings() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { role: userRole } = useAuth();
  const isAgency = userRole === 'agency';

  const { cb } = useCreatorMode();

  usePageHeader({ title: 'Sub-Account Config' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [hasClientUser, setHasClientUser] = useState<boolean | null>(null);
  const [updating, setUpdating] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageRemoved, setImageRemoved] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [clientData, setClientData] = useState({
    name: "",
    email: "",
    description: "",
    image_url: "",
    brand_voice: "",
    timezone: "Australia/Sydney",
    weekly_cost_ceiling: "",
    monthly_cost_ceiling: "",
  });
  const [rollup, setRollup] = useState<{ week_cents: number; month_cents: number } | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const savedSnapshotRef = useRef<string>('');

  useEffect(() => {
    fetchClientData();
    if (isAgency && clientId) checkClientUser();
  }, [clientId]);

  const checkClientUser = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("client_id", clientId)
        .limit(1);
      if (error) throw error;
      setHasClientUser(data && data.length > 0);
    } catch {
      setHasClientUser(false);
    }
  };

  const fetchClientData = async () => {
    try {
      const { data, error } = await supabase
        .from("clients_public")
        .select("name, email, description, image_url, timezone, brand_voice, weekly_cost_ceiling_cents, monthly_cost_ceiling_cents")
        .eq("id", clientId)
        .single();

      if (error) throw error;
      if (data) {
        const d = data as typeof data & { weekly_cost_ceiling_cents?: number | null; monthly_cost_ceiling_cents?: number | null; brand_voice?: string | null };
        // Default timezone fallback for clients provisioned before the column was added.
        // Cost ceilings are stored in cents but edited in dollars.
        const merged = {
          name: d.name ?? "",
          email: d.email ?? "",
          description: d.description ?? "",
          image_url: d.image_url ?? "",
          brand_voice: d.brand_voice ?? "",
          timezone: d.timezone || "Australia/Sydney",
          weekly_cost_ceiling: d.weekly_cost_ceiling_cents != null ? String(d.weekly_cost_ceiling_cents / 100) : "",
          monthly_cost_ceiling: d.monthly_cost_ceiling_cents != null ? String(d.monthly_cost_ceiling_cents / 100) : "",
        };
        setClientData(merged);
        savedSnapshotRef.current = JSON.stringify(merged);
      }

      // Rolling spend badge (best-effort; RLS-scoped via the security_invoker view).
      const { data: rollupRow } = await supabase
        .from("client_cost_rollup")
        .select("week_cents, month_cents")
        .eq("client_id", clientId)
        .maybeSingle();
      if (rollupRow) setRollup({ week_cents: Number(rollupRow.week_cents ?? 0), month_cents: Number(rollupRow.month_cents ?? 0) });
    } catch (error) {
      console.error("Error fetching client data:", error);
      toast.error("Failed to load sub-account settings");
    } finally {
      setLoading(false);
    }
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error("Please select an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Please select an image smaller than 5MB"); return; }
    setSelectedImage(file);
    setImageRemoved(false);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const uploadImage = async (file: File, clientId: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${clientId}-${Date.now()}.${fileExt}`;
    const { error } = await supabase.storage.from('logos').upload(fileName, file, { cacheControl: '0', upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(fileName);
    return `${publicUrl}?t=${Date.now()}`;
  };

  const removeImage = () => {
    setSelectedImage(null);
    setImagePreview('');
    setImageRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      let imageUrl = clientData.image_url;
      if (selectedImage) {
        imageUrl = await uploadImage(selectedImage, clientId!);
      } else if (imageRemoved) {
        imageUrl = "";
      }

      // Cost ceilings: dollars in the UI -> integer cents in the DB; blank = no ceiling (null).
      const parseCeilingCents = (v: string): number | null => {
        const t = (v ?? "").trim();
        if (!t) return null;
        const n = Math.round(parseFloat(t) * 100);
        if (!Number.isFinite(n) || n < 0) return null;
        // Clamp to PostgreSQL int4 max so a huge value can't silently fail the insert.
        return Math.min(n, 2147483647);
      };

      const { error } = await supabase
        .from("clients")
        .update({
          name: clientData.name,
          email: clientData.email || null,
          description: clientData.description || null,
          image_url: imageUrl || null,
          brand_voice: clientData.brand_voice || null,
          timezone: clientData.timezone || "Australia/Sydney",
          weekly_cost_ceiling_cents: parseCeilingCents(clientData.weekly_cost_ceiling),
          monthly_cost_ceiling_cents: parseCeilingCents(clientData.monthly_cost_ceiling),
        })
        .eq("id", clientId);

      if (error) throw error;
      toast.success("Sub-account settings updated successfully");
      setSelectedImage(null);
      setImagePreview("");
      setImageRemoved(false);
      fetchClientData();
    } catch (error) {
      console.error("Error updating client:", error);
      toast.error("Failed to update sub-account settings");
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setUpdatingPassword(true);
    try {
      const response = await supabase.functions.invoke('update-client-password', {
        body: { client_id: clientId, new_password: newPassword },
      });
      const result = response.data;
      if (result?.error) throw new Error(result.error);
      if (response.error) throw new Error(response.error.message);
      toast.success("Client login password updated successfully");
      setNewPassword("");
    } catch (error: any) {
      console.error("Error updating password:", error);
      toast.error(error.message || "Failed to update password");
    } finally {
      setUpdatingPassword(false);
    }
  };


  if (loading) {
    return <RetroLoader />;
  }

  return (
    <div className="h-full min-h-0 bg-background flex flex-col overflow-hidden">
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="container mx-auto max-w-7xl px-12 pt-6 pb-12 space-y-6">
          {/* Update General Settings */}
          <div className="space-y-4">
            <h2 className="uppercase tracking-wider" style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}>
              Update General Settings
            </h2>

            <div className="space-y-2">
              <Label htmlFor="name" className="field-text">Client Name</Label>
              <Input
                id="name"
                value={clientData.name}
                onChange={(e) => setClientData({ ...clientData, name: e.target.value })}
                className="field-text"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="field-text">Email</Label>
              <Input
                id="email"
                type="email"
                value={clientData.email || ""}
                onChange={(e) => setClientData({ ...clientData, email: e.target.value })}
                className={`field-text ${cb}`}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="field-text">Description</Label>
              <Textarea
                id="description"
                value={clientData.description || ""}
                onChange={(e) => setClientData({ ...clientData, description: e.target.value })}
                rows={3}
                className={`resize-none field-text ${cb}`}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand_voice" className="field-text">Brand Voice</Label>
              <Textarea
                id="brand_voice"
                value={clientData.brand_voice || ""}
                onChange={(e) => setClientData({ ...clientData, brand_voice: e.target.value })}
                rows={3}
                placeholder="Tone and style notes the AI uses when generating engagement copy (e.g. warm and concise, Aussie, no jargon, never pushy)."
                className={`resize-none field-text ${cb}`}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="timezone" className="field-text">Timezone</Label>
              <Select
                value={clientData.timezone || "Australia/Sydney"}
                onValueChange={(value) => setClientData({ ...clientData, timezone: value })}
              >
                <SelectTrigger id="timezone" className="field-text">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Australia/Sydney">Australia/Sydney (AEDT/AEST)</SelectItem>
                  <SelectItem value="Australia/Melbourne">Australia/Melbourne (AEDT/AEST)</SelectItem>
                  <SelectItem value="Australia/Brisbane">Australia/Brisbane (AEST)</SelectItem>
                  <SelectItem value="Australia/Adelaide">Australia/Adelaide (ACDT/ACST)</SelectItem>
                  <SelectItem value="Australia/Perth">Australia/Perth (AWST)</SelectItem>
                  <SelectItem value="Australia/Darwin">Australia/Darwin (ACST)</SelectItem>
                  <SelectItem value="Australia/Hobart">Australia/Hobart (AEDT/AEST)</SelectItem>
                  <SelectItem value="Pacific/Auckland">Pacific/Auckland (NZDT/NZST)</SelectItem>
                  <SelectItem value="America/New_York">America/New_York (EDT/EST)</SelectItem>
                  <SelectItem value="America/Chicago">America/Chicago (CDT/CST)</SelectItem>
                  <SelectItem value="America/Denver">America/Denver (MDT/MST)</SelectItem>
                  <SelectItem value="America/Los_Angeles">America/Los_Angeles (PDT/PST)</SelectItem>
                  <SelectItem value="Europe/London">Europe/London (BST/GMT)</SelectItem>
                  <SelectItem value="Europe/Paris">Europe/Paris (CEST/CET)</SelectItem>
                  <SelectItem value="Asia/Singapore">Asia/Singapore (SGT)</SelectItem>
                  <SelectItem value="Asia/Tokyo">Asia/Tokyo (JST)</SelectItem>
                  <SelectItem value="Asia/Dubai">Asia/Dubai (GST)</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                Drives booking time formatting, cadence quiet-hours scheduling, and what the voice agent says ("Sydney time", etc.). Used by voice-booking-tools, make-retell-outbound-call, and retell-proxy.
              </p>
            </div>

            {/* F8-1: cost ceilings are an agency governance control — hidden from
                client roles so a sub-account can't edit its own spend limit. */}
            {isAgency && (
            <div className="space-y-2">
              <Label className="field-text">Cost Ceiling (flag only)</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="weekly_cost_ceiling" className="text-muted-foreground text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Weekly ($)</Label>
                  <Input
                    id="weekly_cost_ceiling"
                    type="number"
                    min="0"
                    step="0.01"
                    value={clientData.weekly_cost_ceiling}
                    onChange={(e) => setClientData({ ...clientData, weekly_cost_ceiling: e.target.value })}
                    placeholder="no limit"
                    className="field-text"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="monthly_cost_ceiling" className="text-muted-foreground text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Monthly ($)</Label>
                  <Input
                    id="monthly_cost_ceiling"
                    type="number"
                    min="0"
                    step="0.01"
                    value={clientData.monthly_cost_ceiling}
                    onChange={(e) => setClientData({ ...clientData, monthly_cost_ceiling: e.target.value })}
                    placeholder="no limit"
                    className="field-text"
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                {rollup
                  ? `Rolling spend — this week $${(rollup.week_cents / 100).toFixed(2)}, this month $${(rollup.month_cents / 100).toFixed(2)}. `
                  : ""}
                Crossing a ceiling logs an alert (error_logs: cost_ceiling_breach); it never auto-pauses cadences. Estimate based on cadence_metrics (SMS/email/voice/AI).
              </p>
            </div>
            )}

            {clientId && (
              <div className="space-y-4">
                <ClientQuietHoursCard clientId={clientId} />
                <ClientVoicemailCard clientId={clientId} />
              </div>
            )}

            <div className="space-y-2">
              <Label className="field-text">Logo</Label>
              <div className="flex flex-col gap-4">
                {(imagePreview || (clientData.image_url && !imageRemoved)) && (
                  <div className="relative inline-block">
                    <img
                      src={imagePreview || clientData.image_url}
                      alt="Client logo preview"
                      className="h-16 object-contain border border-border rounded p-2"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6"
                      onClick={removeImage}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                <div>
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
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {(imagePreview || clientData.image_url) && !imageRemoved ? "Change Logo" : "Upload Logo"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-4">
              <Button variant="outline" onClick={() => {
                const hasChanges = JSON.stringify(clientData) !== savedSnapshotRef.current || selectedImage || imageRemoved;
                if (hasChanges) {
                  setShowUnsavedDialog(true);
                } else {
                  navigate(-1);
                }
              }}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={updating}>
                {updating ? "Updating..." : "Save Changes"}
              </Button>
            </div>
          </div>

          {/* Update Client Login Password - Agency only */}
          {isAgency && (
            <div className="border-t border-dashed border-border pt-6 space-y-4">
              <h2 className="uppercase tracking-wider" style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}>
                Update Client Login Password
              </h2>
              {hasClientUser === false ? (
                <p className="text-muted-foreground field-text">
                  No login user exists for this client. Create a client login first from Manage Clients.
                </p>
              ) : (
                <>
                  <p className="text-muted-foreground field-text">
                    Set a new password for the client user(s) linked to this account.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="new-password" className="field-text">New Password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      placeholder="Minimum 6 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="field-text"
                    />
                  </div>
                  <Button
                    onClick={handleUpdatePassword}
                    disabled={updatingPassword || newPassword.length < 6}
                  >
                    {updatingPassword ? "Updating..." : "Update Password"}
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Billing Section */}
          <SubAccountBilling clientId={clientId} checkoutEmail={clientData.email || undefined} />

          

          {/* My Account Field Access - Agency only: governs which fields the client sees/edits on My Account */}
          {isAgency && clientId && (
            <div className="border-t border-dashed border-border pt-6">
              <ClientAccountFieldConfigEditor clientId={clientId} />
            </div>
          )}

          {/* Client Menu Settings - Agency only */}
          {isAgency && clientId && (
            <div className="border-t border-dashed border-border pt-6">
              <ClientMenuConfigEditor clientId={clientId} />
            </div>
          )}
        </div>
      </main>

      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onOpenChange={setShowUnsavedDialog}
        description="You have unsaved changes to this sub-account. Do you want to discard them or continue editing?"
        onDiscard={() => navigate(-1)}
      />
    </div>
  );
}

function SubAccountBilling({ clientId, checkoutEmail }: { clientId: string | undefined; checkoutEmail?: string }) {
  const { clientStatus, defaultClientId, refetch } = useSubscription();
  const { user } = useAuth();
  const { cb } = useCreatorMode();
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paymentOpened, setPaymentOpened] = useState(false);

  if (!clientId) return null;

  const isDefault = clientId === defaultClientId;
  const status = clientStatus(clientId);

  const handleSubscribe = async () => {
    const email = checkoutEmail || user?.email;
    const paymentWindow = window.open('', '_blank', 'noopener,noreferrer');

    try {
      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: {
          type: 'client',
          client_id: clientId,
          checkout_email: email || undefined,
          return_url: window.location.href,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error('No checkout URL returned');

      if (paymentWindow) {
        paymentWindow.location.href = data.url;
      } else {
        window.location.href = data.url;
      }

      setPaymentOpened(true);
    } catch (err: any) {
      paymentWindow?.close();
      toast.error(err.message || 'Failed to start checkout');
    }
  };

  const handleConfirmPayment = async () => {
    setCheckingPayment(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (!accessToken) {
        toast.error('Your session is not ready yet. Please try again in a moment.');
        return;
      }

      const { data: userData, error: authError } = await supabase.auth.getUser(accessToken);
      if (authError || !userData.user) {
        toast.error('We could not verify your session right now. Please try again.');
        return;
      }

      const { data, error } = await supabase.functions.invoke('check-client-subscription', {
        body: { client_id: clientId },
      });
      if (error) {
        const errorMsg = typeof error === 'object' && 'message' in error ? error.message : String(error);
        if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
          toast.error('Session verification is temporarily unavailable. Please try again.');
          return;
        }
        throw error;
      }
      if (data?.subscribed) {
        toast.success('Subscription activated!');
        await refetch();
      } else {
        toast.error('No active subscription found. Please complete payment first.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to verify subscription');
    } finally {
      setCheckingPayment(false);
    }
  };

  const handleManageBilling = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('stripe-portal', {
        body: { type: 'client', client_id: clientId, return_url: window.location.href },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.url) window.open(data.url, '_blank');
    } catch (err: any) {
      toast.error(err.message || 'Failed to open billing portal');
    }
  };

  return (
    <div className="border-t border-dashed border-border pt-6 space-y-4">
      <h2 className="uppercase tracking-wider flex items-center gap-2" style={{ fontFamily: "'VT323', monospace", fontSize: '18px' }}>
        <CreditCard className="w-4 h-4" />
        Billing & Subscription
      </h2>

      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
        <div>
          <p className={`font-medium ${cb}`}>{isDefault ? 'Free Tier' : 'Building Flow setters'}</p>
          <p className={`text-sm text-muted-foreground ${cb}`}>{isDefault ? 'Included with your account' : '$10/month'}</p>
        </div>
        <div className="text-right">
          <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
            status === 'active' ? 'bg-green-500/20 text-green-400' :
            status === 'grace_period' ? 'bg-yellow-500/20 text-yellow-400' :
            status === 'locked' ? 'bg-red-500/20 text-red-400' :
            status === 'cancelled' ? 'bg-red-500/20 text-red-400' :
            'bg-muted text-muted-foreground'
          }`}>
            {status === 'active' ? 'Active' :
             status === 'grace_period' ? 'Grace Period' :
             status === 'locked' ? 'Locked' :
             status === 'cancelled' ? 'Cancelled' : 'Free'}
          </span>
        </div>
      </div>

      {!isDefault && (
        <>
          {(status === 'active' || status === 'grace_period') ? (
            <Button variant="outline" onClick={handleManageBilling}>
              Manage Billing
            </Button>
          ) : !paymentOpened ? (
            <Button onClick={handleSubscribe}>
              <CreditCard className="h-4 w-4 mr-2" />
              Subscribe — $10/mo
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button onClick={handleConfirmPayment} disabled={checkingPayment}>
                {checkingPayment ? 'Verifying...' : "I've Completed Payment"}
              </Button>
              <Button variant="outline" onClick={handleSubscribe}>
                Reopen Payment
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
