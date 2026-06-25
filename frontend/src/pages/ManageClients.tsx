import { useEffect, useState, useRef, useCallback } from "react";
import { useCreatorMode } from "@/hooks/useCreatorMode";
import RetroLoader from "@/components/RetroLoader";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, X, Wrench, Lock, Save, Loader2, CheckCircle, XCircle } from "@/components/icons";
import { StatusTag } from "@/components/StatusTag";
import { computeClientReadiness, READINESS_FIELDS } from "@/lib/clientReadiness";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClientMenuConfigEditor } from "@/components/ClientMenuConfigEditor";
import { ClientAccountFieldConfigEditor } from "@/components/ClientAccountFieldConfigEditor";
import { useSubscription } from "@/hooks/useSubscription";
import { CreditCard } from "@/components/icons";

interface Client {
  id: string;
  name: string;
  email: string | null;
  description: string | null;
  image_url: string | null;
  created_at: string;
  // Provisioning columns (presence-only) for the readiness badge — S6-2.
  // Index signature keeps the readiness column list DRY (see CLIENT_SELECT).
  [col: string]: string | null;
}

// Single source of truth for the SELECT: display fields + the readiness columns.
const CLIENT_SELECT = [
  "id",
  "name",
  "email",
  "description",
  "image_url",
  "created_at",
  // Secret columns are read as their non-secret has_<column> presence boolean
  // from clients_public (the value never reaches the browser, B5/S1-1).
  ...READINESS_FIELDS.map((field) => (field.secret ? `has_${field.column}` : field.column)),
].join(", ");

export default function ManageClients() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { role: userRole } = useAuth();
  const { cb } = useCreatorMode();

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [readinessTarget, setReadinessTarget] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Inline edit state
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editData, setEditData] = useState({ name: "", email: "", description: "" });
  const [updating, setUpdating] = useState(false);

  // Update client login password
  const [newPassword, setNewPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // Create client user state
  const [newUserData, setNewUserData] = useState({ email: "", password: "", full_name: "", client_id: "" });
  const [creatingUser, setCreatingUser] = useState(false);
  

  const handleCreateSubAccount = () => {
    if (!clientId) return;
    navigate(`/client/${clientId}/create-client`);
  };

  usePageHeader({
    title: 'Sub-Accounts',
    breadcrumbs: editingClient
      ? [
          { label: 'Sub-Accounts', onClick: () => setEditingClient(null) },
          { label: editingClient.name },
        ]
      : undefined,
    actions: !editingClient ? [
      {
        label: 'NEW SUB-ACCOUNT',
        icon: <Plus className="h-4 w-4" />,
        onClick: handleCreateSubAccount,
      },
    ] : undefined,
  }, [editingClient?.id ?? '', clientId ?? '']);

  const [searchParams, setSearchParams] = useSearchParams();

  // Handle pending client creation after successful payment
  useEffect(() => {
    const createPending = searchParams.get('create_pending');
    const checkoutSuccess = searchParams.get('checkout_success');
    
    if (createPending === 'true' && checkoutSuccess === 'true') {
      // Clean URL params
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('create_pending');
      newParams.delete('checkout_success');
      newParams.delete('checkout_client_id');
      setSearchParams(newParams, { replace: true });

      const pendingJson = sessionStorage.getItem('pending_client');
      if (pendingJson) {
        sessionStorage.removeItem('pending_client');
        createPendingClient(JSON.parse(pendingJson));
      }
    }
  }, [searchParams]);

  const createPendingClient = async (pending: any) => {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("agency_id")
        .eq("id", (await supabase.auth.getUser()).data.user!.id)
        .single();

      const { data: newClient, error } = await supabase
        .from("clients")
        .insert({
          name: pending.clientData.name,
          email: pending.clientData.email || null,
          description: pending.clientData.description || null,
          image_url: null,
          agency_id: profile?.agency_id,
          subscription_status: 'active',
        })
        .select("id")
        .single();

      if (error) throw error;

      if (pending.createLogin && pending.loginData && newClient) {
        const response = await supabase.functions.invoke("create-client-user", {
          body: {
            email: pending.loginData.email,
            password: pending.loginData.password,
            full_name: pending.loginData.full_name,
            client_id: newClient.id,
          },
        });
        if (response.error || response.data?.error) {
          toast.error("Sub-account created but login failed");
        } else {
          toast.success("Sub-account and login created successfully");
        }
      } else {
        toast.success("Sub-account created successfully");
      }

      fetchClients();
      navigate(`/client/${newClient!.id}/manage-clients`, { replace: true });
    } catch (error: any) {
      console.error("Error creating pending client:", error);
      toast.error(error.message || "Failed to create sub-account");
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      const { data, error } = await supabase
        .from("clients_public")
        .select(CLIENT_SELECT)
        .eq("is_system", false)
        .order("sort_order");
      if (error) throw error;
      setClients((data as unknown as Client[]) || []);
    } catch (error) {
      console.error("Error fetching clients:", error);
      toast.error("Failed to load sub-accounts");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmName !== deleteTarget.name) {
      toast.error("Sub-account name does not match");
      return;
    }
    setDeleting(true);
    try {
      const { error } = await supabase.rpc("delete_client_with_data", {
        client_id_param: deleteTarget.id,
      });
      if (error) throw error;
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      setDeleteConfirmName("");
      fetchClients();
      if (deleteTarget.id === clientId && clients.length > 1) {
        const remaining = clients.filter((c) => c.id !== deleteTarget.id);
        if (remaining.length > 0) {
          navigate(`/client/${remaining[0].id}/manage-clients`, { replace: true });
        }
      }
    } catch (error) {
      console.error("Error deleting client:", error);
      toast.error("Failed to delete sub-account");
    } finally {
      setDeleting(false);
    }
  };

  const startEditing = (client: Client) => {
    setEditingClient(client);
    setEditData({
      name: client.name,
      email: client.email || "",
      description: client.description || "",
    });
    setNewPassword("");
    setNewUserData({ email: "", password: "", full_name: "", client_id: client.id });
  };

  const handleUpdateClient = async () => {
    if (!editingClient) return;
    setUpdating(true);
    try {
      const { error } = await supabase
        .from("clients")
        .update({
          name: editData.name,
          email: editData.email || null,
          description: editData.description || null,
        })
        .eq("id", editingClient.id);

      if (error) throw error;
      toast.success("Sub-account updated successfully");
      setEditingClient(null);
      fetchClients();
    } catch (error) {
      console.error("Error updating client:", error);
      toast.error("Failed to update sub-account");
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!editingClient || !newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setUpdatingPassword(true);
    try {
      const response = await supabase.functions.invoke('update-client-password', {
        body: { client_id: editingClient.id, new_password: newPassword },
      });
      if (response.error) throw new Error(response.error.message);
      const result = response.data;
      if (result.error) throw new Error(result.error);
      toast.success("Sub-account login password updated");
      setNewPassword("");
    } catch (error: any) {
      console.error("Error updating password:", error);
      toast.error(error.message || "Failed to update password");
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleCreateClientUser = async () => {
    if (!newUserData.email || !newUserData.password || !newUserData.client_id) {
      toast.error("Email, password, and client account are required");
      return;
    }
    if (newUserData.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setCreatingUser(true);
    try {
      const response = await supabase.functions.invoke('create-client-user', {
        body: {
          email: newUserData.email,
          password: newUserData.password,
          full_name: newUserData.full_name,
          client_id: newUserData.client_id,
        },
      });
      if (response.error) throw new Error(response.error.message || 'Failed to create user');
      const result = response.data;
      if (result.error) throw new Error(result.error);
      toast.success(`Sub-account user created: ${newUserData.email}`);
      setNewUserData({ ...newUserData, email: "", password: "", full_name: "" });
    } catch (error: any) {
      console.error("Error creating client user:", error);
      toast.error(error.message || "Failed to create sub-account user");
    } finally {
      setCreatingUser(false);
    }
  };

  if (loading) {
    return <RetroLoader />;
  }

  // Inline edit view
  if (editingClient) {
    return (
      <div className="h-full min-h-0 bg-background flex flex-col overflow-hidden">
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="container mx-auto max-w-7xl px-12 pt-6 pb-12 space-y-6">
            {/* Update General Settings */}
            <Card className="material-surface">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wrench className="w-5 h-5" />
                  Update General Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name" className="field-text">Sub-Account Name</Label>
                  <Input
                    id="edit-name"
                    value={editData.name}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                    className={`field-text ${cb}`}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-email" className="field-text">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editData.email}
                    onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                    className={`field-text ${cb}`}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="edit-description" className="field-text">Description</Label>
                  <Textarea
                    id="edit-description"
                    value={editData.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    rows={3}
                    className={`resize-none field-text ${cb}`}
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleUpdateClient}
                    disabled={updating}
                    className="groove-btn groove-btn-positive"
                    style={{ fontFamily: "'VT323', monospace", fontSize: '16px' }}
                  >
                    {updating ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                    ) : (
                      <><Save className="h-4 w-4 mr-2" /> Save</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

             {/* Update Sub-Account Login Password */}
            <Card className="material-surface">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Lock className="w-5 h-5" />
                  Update Sub-Account Login Password
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
                <div className="flex justify-end">
                  <Button
                    onClick={handleUpdatePassword}
                    disabled={updatingPassword || newPassword.length < 6}
                    className="groove-btn groove-btn-positive"
                    style={{ fontFamily: "'VT323', monospace", fontSize: '16px' }}
                  >
                    {updatingPassword ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Updating...</>
                    ) : (
                      <><Save className="h-4 w-4 mr-2" /> Update Password</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

             {/* My Account Field Access — governs which My Account fields this sub-account sees/edits */}
            <ClientAccountFieldConfigEditor clientId={editingClient.id} />

             {/* Sub-Account Menu Settings */}
            <ClientMenuConfigEditor clientId={editingClient.id} />

            {/* Billing & Subscription */}
            <SubAccountBillingCard clientId={editingClient.id} />
          </div>
        </main>
      </div>
    );
  }

  // Client list view
  return (
    <div className="h-full min-h-0 bg-background flex flex-col overflow-hidden">
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="container mx-auto max-w-7xl px-12 pt-6 pb-12" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
           {/* Sub-Account List */}
          {clients.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground field-text">
                No sub-accounts yet. Create your first sub-account to get started.
              </CardContent>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {clients.map((client) => {
                const readiness = computeClientReadiness(client);
                const readinessVariant =
                  readiness.level === "green" ? "positive" : readiness.level === "amber" ? "warning" : "negative";
                return (
                <Card key={client.id}>
                  <CardContent className="flex items-center justify-between py-4 px-5">
                    {/* Click the sub-account to open its config page (6.1):
                        /client/<id>/settings = ClientSettings, scoped to this row. */}
                    <div
                      className="min-w-0 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      title="Open sub-account config"
                      onClick={() => navigate(`/client/${client.id}/settings`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/client/${client.id}/settings`);
                        }
                      }}
                    >
                      <p className={`font-medium truncate field-text ${cb}`}>{client.name}</p>
                      {client.email && (
                        <p className={`text-muted-foreground truncate field-text ${cb}`}>{client.email}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusTag
                        variant={readinessVariant}
                        className="cursor-pointer"
                        onClick={() => setReadinessTarget(client)}
                      >
                        {readiness.level === "green"
                          ? "Live"
                          : `${readiness.label} (${readiness.requiredSet}/${readiness.requiredTotal})`}
                      </StatusTag>
                      <button
                        onClick={() => startEditing(client)}
                        className="groove-btn !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center bg-muted/50 cursor-pointer"
                        title="Edit sub-account"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(client)}
                        className="groove-btn groove-btn-destructive !h-8 !w-8 !p-0 !min-h-[32px] !min-w-[32px] flex items-center justify-center cursor-pointer"
                        title="Delete sub-account"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          )}

          {/* Readiness detail — pure read of provisioning columns (S6-2) */}
          <Dialog open={!!readinessTarget} onOpenChange={() => setReadinessTarget(null)}>
            <DialogContent className="!p-0">
              <DialogHeader>
                <DialogTitle>Readiness — {readinessTarget?.name}</DialogTitle>
                <DialogDescription>
                  Which provisioning fields are set for this sub-account. Red = required for go-live;
                  amber = recommended hardening / external DB.
                </DialogDescription>
              </DialogHeader>
              {readinessTarget && (
                <div className="px-6 pb-6 space-y-4">
                  {(["required", "recommended"] as const).map((tier) => (
                    <div key={tier} className="space-y-1.5">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground field-text">
                        {tier === "required" ? "Required" : "Recommended"}
                      </p>
                      {READINESS_FIELDS.filter((field) => field.tier === tier).map((field) => {
                        const configured = Boolean(readinessTarget[field.column]?.trim());
                        return (
                          <div key={field.column} className="flex items-center gap-2 field-text">
                            {configured ? (
                              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                            ) : (
                              <XCircle className={`h-4 w-4 shrink-0 ${tier === "required" ? "text-red-500" : "text-amber-500"}`} />
                            )}
                            <span className={configured ? "" : "text-muted-foreground"}>{field.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation */}
          <Dialog open={!!deleteTarget} onOpenChange={() => { setDeleteTarget(null); setDeleteConfirmName(""); }}>
            <DialogContent className="!p-0">
              <DialogHeader>
                 <DialogTitle>Delete Sub-Account</DialogTitle>
                <DialogDescription>
                  This will permanently delete <strong>{deleteTarget?.name}</strong> and all associated data. Type the sub-account name below to confirm.
                </DialogDescription>
              </DialogHeader>
              <div className="px-6 pb-2">
                <Label htmlFor="confirm-name" className="field-text text-muted-foreground">
                  Type <strong>{deleteTarget?.name}</strong> to confirm
                </Label>
                <Input
                  id="confirm-name"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  placeholder={deleteTarget?.name}
                  className="mt-1 field-text"
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirmName(""); }} disabled={deleting} className="groove-btn" style={{ fontFamily: "'VT323', monospace", fontSize: '16px' }}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting || deleteConfirmName !== deleteTarget?.name}
                  className="groove-btn groove-btn-destructive"
                  style={{ fontFamily: "'VT323', monospace", fontSize: '16px' }}
                >
                  {deleting ? "Deleting..." : "Delete Sub-Account"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </main>
    </div>
  );
}

function SubAccountBillingCard({ clientId }: { clientId: string }) {
  const { clientStatus, defaultClientId } = useSubscription();
  const { cb } = useCreatorMode();
  const status = clientStatus(clientId);
  const isDefault = clientId === defaultClientId;

  const handleManageBilling = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('stripe-portal', {
        body: { type: 'client', client_id: clientId, return_url: window.location.href },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast.error(err.message || 'Failed to open billing portal');
    }
  };

  const statusLabel =
    status === 'active' ? 'Active' :
    status === 'grace_period' ? 'Grace Period' :
    status === 'locked' ? 'Locked' :
    status === 'cancelled' ? 'Cancelled' : 'Free';

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
            <p className={`font-medium ${cb}`}>{isDefault ? 'Free Tier' : 'Building Flow setters'}</p>
            <p className={`text-sm text-muted-foreground ${cb}`}>
              {isDefault ? 'Included with your account' : `$10/month — Status: ${statusLabel}`}
            </p>
          </div>
        </div>
        {!isDefault && (status === 'active' || status === 'grace_period') && (
          <Button variant="outline" onClick={handleManageBilling} className="groove-btn" style={{ fontFamily: "'VT323', monospace", fontSize: '16px' }}>
            <CreditCard className="h-4 w-4 mr-2" />
            Manage Billing
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
