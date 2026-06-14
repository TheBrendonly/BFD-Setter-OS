import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, LogOut } from "@/components/icons";
import RetroLoader from "@/components/RetroLoader";

export default function RedirectToFirstClient() {
  const navigate = useNavigate();
  const { user, loading: authLoading, role, userClientId } = useAuth();
  const { toast } = useToast();
  const [checking, setChecking] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientDescription, setNewClientDescription] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");

  useEffect(() => {
    if (authLoading) return;
    
    if (!user) {
      navigate("/auth");
      return;
    }

    // Client users go directly to their assigned client
    if (role === 'client' && userClientId) {
      navigate(`/client/${userClientId}/analytics/chatbot/dashboard`, { replace: true });
      return;
    }

    // Agency users: check onboarding first, then redirect to first client
    if (role === 'agency') {
      checkOnboardingAndRedirect();
    }
  }, [user, authLoading, role, userClientId]);

  const checkOnboardingAndRedirect = async () => {
    try {
      // Check if onboarding is completed
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user?.id)
        .single();

      if (profile && !(profile as any).onboarding_completed) {
        navigate("/onboarding", { replace: true });
        return;
      }

      // Onboarding done — find first client
      const { data, error } = await supabase
        .from("clients")
        .select("id")
        .eq("is_system", false)
        .order("sort_order")
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        navigate(`/client/${data.id}/analytics/chatbot/dashboard`);
      } else {
        setChecking(false);
      }
    } catch (error) {
      console.error("Error during redirect:", error);
      setChecking(false);
    }
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: "Error", description: "Please select an image file", variant: "destructive" });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Error", description: "Please select an image smaller than 5MB", variant: "destructive" });
      return;
    }

    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const uploadImage = async (file: File, clientId: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${clientId}-${Date.now()}.${fileExt}`;

    const { error } = await supabase.storage
      .from('logos')
      .upload(fileName, file, { cacheControl: '0', upsert: true });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('logos')
      .getPublicUrl(fileName);

    return `${publicUrl}?t=${Date.now()}`;
  };

  const handleCreateClient = async () => {
    if (!newClientName.trim()) {
      toast({
        title: "Error",
        description: "Client name is required",
        variant: "destructive"
      });
      return;
    }

    setCreating(true);
    try {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("agency_id")
        .eq("id", user?.id)
        .single();

      if (profileError || !profile?.agency_id) {
        throw new Error("Could not find your agency. Please contact support.");
      }

      const { data: newClient, error } = await supabase
        .from("clients")
        .insert({
          name: newClientName.trim(),
          email: newClientEmail.trim() || null,
          description: newClientDescription.trim() || null,
          agency_id: profile.agency_id,
          sort_order: 1
        })
        .select("id")
        .single();

      if (error) throw error;

      if (selectedImage && newClient) {
        const imageUrl = await uploadImage(selectedImage, newClient.id);
        await supabase
          .from('clients')
          .update({ image_url: imageUrl })
          .eq('id', newClient.id);
      }

      toast({
        title: "Sub-account created",
        description: `${newClientName} has been created successfully.`
      });

      setDialogOpen(false);
      setNewClientName("");
      setNewClientEmail("");
      setNewClientDescription("");
      setSelectedImage(null);
      setImagePreview("");
      navigate(`/client/${newClient.id}/analytics/chatbot/dashboard`);
    } catch (error: any) {
      console.error("Error creating client:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create client",
        variant: "destructive"
      });
    } finally {
      setCreating(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut({ scope: 'global' });
      toast({ title: "Signed out successfully" });
    } catch (error) {
      console.error("Error signing out:", error);
    } finally {
      navigate("/auth", { replace: true });
    }
  };

  if (authLoading || checking) {
    return <RetroLoader />;
  }

  // Only agency users see the "no clients" screen
  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 h-16 bg-card border-b border-border flex items-center justify-between px-6 z-50">
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        
        <Button variant="ghost" onClick={handleSignOut} className="text-destructive hover:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </header>

      <div className="pt-16 min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">No clients found. Create your first client to get started.</p>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create First Client
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Client</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 p-5">
                <div className="space-y-2">
                  <Label htmlFor="client-name">Client Name *</Label>
                  <Input
                    id="client-name"
                    placeholder="Enter client name"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-email">Email</Label>
                  <Input
                    id="client-email"
                    type="email"
                    placeholder="Enter client email"
                    value={newClientEmail}
                    onChange={(e) => setNewClientEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-description">Description</Label>
                  <Textarea
                    id="client-description"
                    placeholder="Enter client description"
                    value={newClientDescription}
                    onChange={(e) => setNewClientDescription(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client Logo</Label>
                  <div className="flex flex-col gap-2">
                    {imagePreview && (
                      <div className="relative w-32 h-32 border rounded-md overflow-hidden">
                        <img src={imagePreview} alt="Preview" className="w-full h-full object-contain" />
                      </div>
                    )}
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      setNewClientName("");
                      setNewClientEmail("");
                      setNewClientDescription("");
                      setSelectedImage(null);
                      setImagePreview("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleCreateClient}
                    disabled={creating || !newClientName.trim()}
                  >
                    {creating ? "Creating..." : "Create Client"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
