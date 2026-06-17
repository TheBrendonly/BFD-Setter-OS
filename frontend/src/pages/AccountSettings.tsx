import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import RetroLoader from "@/components/RetroLoader";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePageHeader } from '@/contexts/PageHeaderContext';
import { Save, LogOut, User, CreditCard, Eye, EyeOff, Users, CheckCircle2, DollarSign, Lock } from "@/components/icons";
import { useSubscription } from "@/hooks/useSubscription";
import { useCreatorMode } from "@/hooks/useCreatorMode";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { ClientAccountSettingsCard } from "@/components/ClientAccountSettingsCard";


export default function AccountSettings() {
  const { user, role: userRole } = useAuth();
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId: string }>();
  const isAgency = userRole === 'agency';
  const { isCreatorMode, enableCreatorMode, disableCreatorMode } = useCreatorMode();
  const [showCreatorConfirm, setShowCreatorConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accountData, setAccountData] = useState({
    full_name: "",
    email: "",
  });
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  usePageHeader({
    title: 'My Account',
    rightExtra: isCreatorMode ? (
      <Button
        variant="outline"
        size="sm"
        className="groove-btn !h-8"
        style={{ fontFamily: "'VT323', monospace", fontSize: '16px', fontWeight: 'bold' }}
        onClick={disableCreatorMode}
      >
        <EyeOff className="w-4 h-4" />
        <span className="ml-1.5" style={{ fontFamily: "'VT323', monospace", fontSize: '16px', fontWeight: 'bold' }}>Disable Creator Mode</span>
      </Button>
    ) : (
      <Button
        variant="destructive"
        size="sm"
        className="groove-btn groove-btn-destructive !h-8"
        style={{ fontFamily: "'VT323', monospace", fontSize: '16px', fontWeight: 'bold' }}
        onClick={() => setShowCreatorConfirm(true)}
      >
        <Eye className="w-4 h-4" />
        <span className="ml-1.5" style={{ fontFamily: "'VT323', monospace", fontSize: '16px', fontWeight: 'bold' }}>Enable Creator Mode</span>
      </Button>
    ),
  }, [isCreatorMode]);

  useEffect(() => {
    fetchAccountData();
  }, [user]);

  const fetchAccountData = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .single();
      if (error) throw error;
      if (data) {
        setAccountData({
          full_name: data.full_name || "",
          email: data.email || "",
        });
      }
    } catch (error) {
      console.error("Error fetching account data:", error);
      toast.error("Failed to load account settings");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!user) return;
    setUpdating(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: accountData.full_name,
          email: accountData.email,
        })
        .eq("id", user.id);
      if (error) throw error;
      toast.success("Account settings updated successfully");
    } catch (error) {
      console.error("Error updating account:", error);
      toast.error("Failed to update account settings");
    } finally {
      setUpdating(false);
    }
  };

  // Change the logged-in user's OWN password (both agency and client roles). This
  // is distinct from ClientSettings' "Update Client Login Password", which is the
  // agency setting a sub-account user's password via the update-client-password fn.
  const handleChangePassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast.error("Please fill in both password fields");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords don't match");
      return;
    }
    if (newPassword.length < 12) {
      toast.error("Password must be at least 12 characters");
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Password updated successfully");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      console.error("Error updating password:", error);
      toast.error(error?.message || "Failed to update password");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut({ scope: 'global' });
      toast.success("Signed out successfully");
    } catch (error) {
      console.error("Error signing out:", error);
      toast.success("Signed out");
    } finally {
      setSigningOut(false);
      navigate("/auth", { replace: true });
    }
  };

  if (loading) {
    return <RetroLoader />;
  }

  return (
    <div className="h-full min-h-0 bg-background flex flex-col overflow-hidden">
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="container mx-auto max-w-7xl px-12 pt-6 pb-12 space-y-6">

          {/* Creator Mode Confirmation Dialog */}
          <DeleteConfirmDialog
            open={showCreatorConfirm}
            onOpenChange={setShowCreatorConfirm}
            onConfirm={() => { enableCreatorMode(); toast.success('Creator Mode enabled'); }}
            title="ENABLE CREATOR MODE?"
            description="All sensitive information (lead names, phone numbers, emails, API keys, etc.) will be blurred across the entire sub-account. This is useful for screen recording or live streaming."
            confirmLabel="Yes, Enable"
            confirmIcon={<Eye className="w-4 h-4 mr-2" />}
          />
          {/* Profile Card */}
          <Card className="material-surface">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="w-5 h-5" />
                Profile Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="full_name" className="field-text">Full Name</Label>
                <Input
                  id="full_name"
                  value={accountData.full_name}
                  onChange={(e) => setAccountData({ ...accountData, full_name: e.target.value })}
                  className="field-text"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="field-text">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={accountData.email || ""}
                  onChange={(e) => setAccountData({ ...accountData, email: e.target.value })}
                  className="field-text"
                />
              </div>
              <div className="flex gap-4 pt-2">
                <Button onClick={handleUpdate} disabled={updating}>
                  <Save className="h-4 w-4 mr-2" />
                  {updating ? "Updating..." : "Save Changes"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 border-destructive"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  {signingOut ? "Signing Out..." : "Sign Out"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Change Password (the logged-in user's own login) */}
          <Card className="material-surface">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Change Password
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new_password" className="field-text">New Password</Label>
                <Input
                  id="new_password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 12 characters"
                  autoComplete="new-password"
                  className="field-text"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm_password" className="field-text">Confirm New Password</Label>
                <Input
                  id="confirm_password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  className="field-text"
                />
              </div>
              <Button onClick={handleChangePassword} disabled={changingPassword}>
                <Lock className="h-4 w-4 mr-2" />
                {changingPassword ? "Updating..." : "Update Password"}
              </Button>
            </CardContent>
          </Card>

          {/* Two-Factor Authentication (TOTP) — opt-in for the logged-in user */}
          <TwoFactorCard />

          {/* Sub-Account Settings (client self-serve over admin-governed fields) */}
          {!isAgency && clientId && <ClientAccountSettingsCard clientId={clientId} />}

          {/* Sub-Account Subscription Overview (Agency only) */}
          {isAgency && <SubAccountOverview />}

          {/* Billing for client users */}
          {!isAgency && clientId && <ClientBillingCard clientId={clientId} />}
        </div>
      </main>
    </div>
  );
}

function TwoFactorCard() {
  const [factors, setFactors] = useState<{ id: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [newFactorId, setNewFactorId] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const loadFactors = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setFactors((data?.totp || []).map((f) => ({ id: f.id, status: f.status })));
    } catch {
      setFactors([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadFactors(); }, []);

  const verifiedFactor = factors.find((f) => f.status === "verified");

  const startEnroll = async () => {
    setCode("");
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      setNewFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setEnrolling(true);
    } catch (e: any) {
      toast.error(e?.message || "Could not start 2FA enrollment");
    }
  };

  const confirmEnroll = async () => {
    if (!newFactorId || code.trim().length < 6) { toast.error("Enter the 6-digit code from your authenticator app"); return; }
    setVerifying(true);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: newFactorId });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId: newFactorId, challengeId: ch.id, code: code.trim() });
      if (vErr) throw vErr;
      toast.success("Two-factor authentication enabled");
      setEnrolling(false); setQrCode(""); setSecret(""); setNewFactorId(""); setCode("");
      loadFactors();
    } catch (e: any) {
      toast.error(e?.message || "Invalid code — try again");
    } finally {
      setVerifying(false);
    }
  };

  const cancelEnroll = async () => {
    // Remove the unverified factor so it does not linger.
    if (newFactorId) { try { await supabase.auth.mfa.unenroll({ factorId: newFactorId }); } catch { /* ignore */ } }
    setEnrolling(false); setQrCode(""); setSecret(""); setNewFactorId(""); setCode("");
  };

  const removeFactor = async (factorId: string) => {
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast.success("Two-factor authentication removed");
      loadFactors();
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove 2FA");
    }
  };

  return (
    <Card className="material-surface">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Lock className="w-5 h-5" />
          Two-Factor Authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-muted-foreground field-text">Loading...</p>
        ) : verifiedFactor && !enrolling ? (
          <div className="space-y-3">
            <p className="text-sm text-green-600 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> 2FA is enabled — you'll be asked for a code at sign-in.</p>
            <Button variant="outline" onClick={() => removeFactor(verifiedFactor.id)}>Remove 2FA</Button>
          </div>
        ) : enrolling ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground field-text">Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code to confirm.</p>
            {qrCode && <img src={qrCode} alt="2FA QR code" className="h-44 w-44 border border-border rounded bg-white p-2" />}
            {secret && <p className="text-xs text-muted-foreground break-all">Or enter this secret manually: <code>{secret}</code></p>}
            <div className="space-y-2">
              <Label htmlFor="mfa_code" className="field-text">6-digit code</Label>
              <Input id="mfa_code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="field-text w-40" />
            </div>
            <div className="flex gap-2">
              <Button onClick={confirmEnroll} disabled={verifying}>{verifying ? "Verifying..." : "Confirm & Enable"}</Button>
              <Button variant="outline" onClick={cancelEnroll} disabled={verifying}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground field-text">Add a second step at sign-in using an authenticator app. Recommended for the agency login.</p>
            <Button onClick={startEnroll}><Lock className="h-4 w-4 mr-2" /> Enable 2FA</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClientBillingCard({ clientId }: { clientId: string }) {
  const { clientStatus } = useSubscription();
  const status = clientStatus(clientId);
  const [openingPortal, setOpeningPortal] = useState(false);

  const handleManageBilling = async () => {
    setOpeningPortal(true);

    try {
      const { data, error } = await supabase.functions.invoke('stripe-portal', {
        body: { type: 'client', client_id: clientId, return_url: window.location.href },
      });

      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (!data?.url) throw new Error('No billing portal URL returned');

      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (error: any) {
      toast.error(error.message || 'Failed to open billing portal');
    } finally {
      setOpeningPortal(false);
    }
  };

  const statusLabel =
    status === 'active'
      ? 'Active'
      : status === 'grace_period'
        ? 'Grace Period'
        : status === 'locked'
          ? 'Locked'
          : status === 'cancelled'
            ? 'Cancelled'
            : 'Free';

  const canManageBilling = status === 'active' || status === 'grace_period';
  const canResubscribe = status === 'cancelled' || status === 'locked' || status === 'free';
  const [subscribing, setSubscribing] = useState(false);

  const handleResubscribe = async () => {
    setSubscribing(true);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: {
          type: 'client',
          client_id: clientId,
          return_url: window.location.href,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (data?.url) window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || 'Failed to start checkout');
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <Card className="material-surface">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          Billing & Subscription
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-4">
          <div>
            <p className="font-medium">Building Flow setters</p>
            <p className="text-sm text-muted-foreground">Current status: {statusLabel}</p>
          </div>
           <div className="text-sm text-muted-foreground">$10/month</div>
        </div>

        <div className="flex flex-wrap gap-3">
          {canManageBilling && (
            <Button variant="outline" onClick={handleManageBilling} disabled={openingPortal}>
              <CreditCard className="h-4 w-4 mr-2" />
              {openingPortal ? 'Opening...' : 'Manage Billing'}
            </Button>
          )}
          {canResubscribe && (
            <Button onClick={handleResubscribe} disabled={subscribing}>
              <CreditCard className="h-4 w-4 mr-2" />
              {subscribing ? 'Processing...' : status === 'cancelled' || status === 'locked' ? 'Resubscribe — $10/mo' : 'Subscribe — $10/mo'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const SUB_COLS = [
  { key: 'name', label: 'Sub-Account', defaultWidth: 220 },
  { key: 'plan', label: 'Plan', defaultWidth: 100 },
  { key: 'status', label: 'Status', defaultWidth: 130 },
  { key: 'started', label: 'Started', defaultWidth: 120 },
  { key: 'renewal', label: 'Renewal', defaultWidth: 120 },
  { key: 'action', label: 'Action', defaultWidth: 160 },
] as const;

const FONT_STYLE = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px' } as const;

function SubAccountOverview() {
  const { clientId } = useParams<{ clientId: string }>();
  const { isCreatorMode } = useCreatorMode();
  const [clients, setClients] = useState<{
    id: string;
    name: string;
    subscription_status: string;
    stripe_customer_id: string | null;
    subscription_start_date: string | null;
    subscription_end_date: string | null;
    email: string | null;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  // Column widths state + persistence
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    for (const c of SUB_COLS) defaults[c.key] = c.defaultWidth;
    return defaults;
  });
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoadedWidthsRef = useRef(false);

  const fetchClients = async () => {
    const { data } = await supabase
      .from('clients')
      .select('id, name, subscription_status, stripe_customer_id, subscription_start_date, subscription_end_date, email')
      .order('created_at', { ascending: true });
    setClients(data || []);
    setLoading(false);
  };

  // Load saved widths
  useEffect(() => {
    if (!clientId || hasLoadedWidthsRef.current) return;
    hasLoadedWidthsRef.current = true;
    (async () => {
      const { data } = await supabase
        .from('clients')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const cfg = (data as any)?.crm_filter_config;
      if (cfg?.sub_account_col_widths && typeof cfg.sub_account_col_widths === 'object') {
        setColWidths(prev => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(cfg.sub_account_col_widths)) {
            if (typeof v === 'number' && v >= 60 && v <= 800) next[k] = v;
          }
          return next;
        });
      }
    })();
  }, [clientId]);

  const saveWidthsToDB = useCallback((widths: Record<string, number>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (!clientId) return;
      const { data } = await supabase
        .from('clients')
        .select('crm_filter_config')
        .eq('id', clientId)
        .single();
      const cfg = (data as any)?.crm_filter_config || {};
      await (supabase as any)
        .from('clients')
        .update({ crm_filter_config: { ...cfg, sub_account_col_widths: widths } })
        .eq('id', clientId);
    }, 500);
  }, [clientId]);

  const handleResizeStart = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] || 120 };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(60, resizingRef.current.startWidth + diff);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.key]: newWidth }));
    };
    const onMouseUp = () => {
      setColWidths(prev => {
        saveWidthsToDB(prev);
        return prev;
      });
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [colWidths, saveWidthsToDB]);

  const totalTableWidth = useMemo(() => {
    return SUB_COLS.reduce((sum, col) => sum + (colWidths[col.key] || col.defaultWidth), 0);
  }, [colWidths]);

  useEffect(() => {
    fetchClients();
    const channel = supabase.channel('sub-account-billing').on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'clients',
    }, () => {
      fetchClients();
    }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const getStatusBadge = (status: string, isDefault: boolean) => {
    if (isDefault) {
      return <span className="inline-block rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Active (Free)</span>;
    }
    switch (status) {
      case 'active':
        return <span className="inline-block rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Active</span>;
      case 'grace_period':
        return <span className="inline-block rounded bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Grace Period</span>;
      case 'locked':
        return <span className="inline-block rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">Locked</span>;
      case 'cancelled':
        return <span className="inline-block rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">Cancelled</span>;
      default:
        return <span className="inline-block rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Free (Locked)</span>;
    }
  };

  const headerCellStyle = (isLast: boolean): React.CSSProperties => ({
    height: '52px',
    minHeight: '52px',
    borderBottom: '3px groove hsl(var(--border-groove))',
    borderRight: isLast ? 'none' : '3px groove hsl(var(--border-groove))',
  });

  const bodyCellStyle = (isLast: boolean): React.CSSProperties => ({
    borderBottom: '1px solid hsl(var(--border))',
    borderRight: isLast ? 'none' : '1px solid hsl(var(--border-groove) / 0.3)',
  });

  if (loading) return null;

  const totalActive = clients.filter((c, i) => i === 0 || c.subscription_status === 'active').length;
  const totalMonthly = clients.filter((c, i) => i !== 0 && c.subscription_status === 'active').length * 10;

  return (
    <Card className="material-surface">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          Sub-Account Subscriptions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary widgets - identical to campaign dashboard Overview number_card widgets */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Sub-Accounts', value: String(clients.length) },
            { label: 'Active', value: String(totalActive) },
            { label: 'Monthly Total', value: `$${totalMonthly}/mo` },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="stat-cell relative h-full flex flex-col"
              style={{ padding: '12px 16px', minHeight: '140px' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div
                  style={{ fontSize: '13px', textTransform: 'capitalize' }}
                  className="font-medium text-muted-foreground"
                >
                  {label}
                </div>
              </div>
              <div className="border-t border-dashed border-border -mx-4 mb-0" />
              <div className="flex-1 flex items-center justify-center">
                <div
                  style={{
                    fontSize: '45px',
                    fontFamily: "'VT323', monospace",
                    lineHeight: 1,
                    marginTop: '5px',
                  }}
                  className={`font-light ${isCreatorMode ? 'creator-blur' : ''}`}
                >
                  {value}
                </div>
              </div>
            </div>
          ))}
        </div>

        {clients.length === 0 ? (
          <p className="text-muted-foreground text-sm">No sub-accounts yet.</p>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ border: '3px groove hsl(var(--border-groove))' }}>
            <div className="flex-1 overflow-auto" style={{ overscrollBehavior: 'none' }}>
              <table className="text-base" style={{ tableLayout: 'fixed', width: Math.max(totalTableWidth, 0) || '100%', minWidth: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <colgroup>
                  {SUB_COLS.map(col => (
                    <col key={col.key} style={{ width: colWidths[col.key] || col.defaultWidth }} />
                  ))}
                </colgroup>
                <thead className="bg-background sticky top-0 z-10">
                  <tr>
                    {SUB_COLS.map((col, i) => {
                      const isLast = i === SUB_COLS.length - 1;
                      return (
                        <th
                          key={col.key}
                          className="sticky top-0 z-20 h-[52px] px-4 text-left align-middle text-[13px] font-medium tracking-wide text-foreground relative bg-background"
                          style={headerCellStyle(isLast)}
                        >
                          <div className="flex items-center gap-1 select-none overflow-hidden" style={{ textOverflow: 'clip' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'clip', whiteSpace: 'nowrap' }}>{col.label}</span>
                          </div>
                          {!isLast && (
                            <div
                              className="absolute right-0 top-0 bottom-0 w-[18px] translate-x-1/2 cursor-col-resize z-20"
                              onMouseDown={e => handleResizeStart(col.key, e)}
                            />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="bg-card">
                  {clients.map((client, index) => {
                    const isDefault = index === 0;
                    const isCancelled = client.subscription_status === 'cancelled';
                    return (
                      <tr key={client.id} className="hover:bg-accent transition-colors duration-100">
                         <td className="px-4 py-2.5" style={{ ...FONT_STYLE, ...bodyCellStyle(false) }}>
                           <div>
                             <p className={`font-medium text-[13px] ${isCreatorMode ? 'creator-blur' : ''}`}>{client.name}</p>
                             {client.email && <p className={`text-xs text-muted-foreground ${isCreatorMode ? 'creator-blur' : ''}`}>{client.email}</p>}
                           </div>
                         </td>
                         <td className={`px-4 py-2.5 ${isCreatorMode ? 'creator-blur' : ''}`} style={{ ...FONT_STYLE, ...bodyCellStyle(false) }}>{isDefault ? 'Free Tier' : '$10/mo'}</td>
                         <td className={`px-4 py-2.5 ${isCreatorMode ? 'creator-blur' : ''}`} style={bodyCellStyle(false)}>{getStatusBadge(client.subscription_status, isDefault)}</td>
                         <td className={`px-4 py-2.5 text-muted-foreground ${isCreatorMode ? 'creator-blur' : ''}`} style={{ ...FONT_STYLE, ...bodyCellStyle(false) }}>
                           {isDefault ? '—' : client.subscription_start_date
                             ? new Date(client.subscription_start_date).toLocaleDateString()
                             : '—'}
                         </td>
                         <td className={`px-4 py-2.5 text-muted-foreground ${isCreatorMode ? 'creator-blur' : ''}`} style={{ ...FONT_STYLE, ...bodyCellStyle(false) }}>
                           {isDefault ? '—' : isCancelled ? 'Cancelled' : client.subscription_end_date
                             ? new Date(client.subscription_end_date).toLocaleDateString()
                             : '—'}
                         </td>
                        <td className="px-4 py-2.5" style={bodyCellStyle(true)}>
                          <div className="flex gap-2">
                            {!isDefault && (isCancelled || client.subscription_status === 'locked' || client.subscription_status === 'free') && (
                              <ResubscribeButton clientId={client.id} email={client.email} />
                            )}
                            {!isDefault && (client.subscription_status === 'active' || client.subscription_status === 'grace_period') && (
                              <ManageBillingButton clientId={client.id} />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResubscribeButton({ clientId, email }: { clientId: string; email: string | null }) {
  const [loading, setLoading] = useState(false);

  const handleResubscribe = async () => {
    setLoading(true);
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
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast.error(err.message || 'Failed to start checkout');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={handleResubscribe} disabled={loading}>
      {loading ? 'Processing...' : 'Resubscribe'}
    </Button>
  );
}

function ManageBillingButton({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false);

  const handleManage = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-portal', {
        body: {
          type: 'client',
          client_id: clientId,
          return_url: window.location.href,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast.error(err.message || 'Failed to open billing portal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={handleManage} disabled={loading}>
      {loading ? 'Opening...' : 'Manage / Cancel'}
    </Button>
  );
}
