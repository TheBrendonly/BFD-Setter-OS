import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Upload, Plus, User } from "@/components/icons";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export default function CreateClient() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { role: userRole } = useAuth();
  const isAgency = userRole === "agency";
  usePageHeader({ title: "Create New Sub-Account" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [clientData, setClientData] = useState({ name: "", email: "", description: "" });
  const [createLogin, setCreateLogin] = useState(false);
  const [loginData, setLoginData] = useState({ email: "", password: "", full_name: "" });

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    setSelectedImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!clientData.name.trim()) {
      toast.error("Sub-account name is required");
      return;
    }
    if (!clientData.email.trim()) {
      toast.error("Sub-account email is required");
      return;
    }
    if (createLogin && (!loginData.email || !loginData.password)) {
      toast.error("Login email and password are required");
      return;
    }
    if (createLogin && loginData.password.length < 12) {
      toast.error("Password must be at least 12 characters");
      return;
    }

    setCreating(true);

    try {
      let imageUrl: string | null = null;
      if (selectedImage) {
        const fileExt = selectedImage.name.split(".").pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("logos")
          .upload(fileName, selectedImage, { cacheControl: "0", upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("logos").getPublicUrl(fileName);
        imageUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("You must be signed in to create a sub-account");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("agency_id")
        .eq("id", user.id)
        .single();

      if (profileError) throw profileError;

      const newClientId = crypto.randomUUID();

      // Auto-mint the tenant secrets so the sub-account is bookable from day one.
      // Without intake_lead_secret, intake-lead 403s every web-form submission.
      // Mirrors Onboarding.tsx:94-104 and scripts/onboard-client.mjs.
      const mintSecret = () => {
        const b = new Uint8Array(24);
        crypto.getRandomValues(b);
        return btoa(String.fromCharCode(...b));
      };

      const { error: createError } = await supabase.from("clients").insert({
        id: newClientId,
        name: clientData.name,
        email: clientData.email || null,
        description: clientData.description || null,
        image_url: imageUrl,
        agency_id: profile?.agency_id,
        subscription_status: "free",
        intake_lead_secret: mintSecret(),
        ghl_webhook_secret: mintSecret(),
      });

      if (createError) throw createError;

      if (createLogin) {
        const response = await supabase.functions.invoke("create-client-user", {
          body: {
            email: loginData.email,
            password: loginData.password,
            full_name: loginData.full_name,
            client_id: newClientId,
          },
        });

        if (response.error || response.data?.error) {
          toast.error("Sub-account created but login failed");
        } else {
          toast.success("Sub-account created — subscription required to unlock");
        }
      } else {
        toast.success("Sub-account created — subscription required to unlock");
      }

      // Redirect to the new sub-account's settings page where they can subscribe
      navigate(`/client/${newClientId}/settings`, { replace: true });
    } catch (error: any) {
      console.error("Error:", error);
      toast.error(error.message || "Failed to create sub-account");
    } finally {
      setCreating(false);
    }
  };

  const renderCheckbox = (isSelected: boolean) => (
    <div
      className={cn(
        "w-5 h-5 groove-border flex items-center justify-center flex-shrink-0",
        isSelected ? "bg-primary" : "bg-card"
      )}
    >
      {isSelected && (
        <span
          className="text-primary-foreground"
          style={{ fontFamily: "'VT323', monospace", fontSize: "18px" }}
        >
          ✓
        </span>
      )}
    </div>
  );

  return (
    <div className="h-full min-h-0 bg-background flex flex-col overflow-hidden">
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="container mx-auto max-w-7xl px-12 pt-6 pb-12 space-y-6">
          <form onSubmit={handleCreate}>
            <Card className="material-surface">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Sub-Account Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="field-text text-sm text-muted-foreground">
                  The new sub-account will be created in a locked state. A $10/month subscription is required to activate it.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="name" className="field-text">Sub-Account Name *</Label>
                  <Input
                    id="name"
                    value={clientData.name}
                    onChange={(e) => setClientData({ ...clientData, name: e.target.value })}
                    placeholder="Enter sub-account name"
                    required
                    className="field-text"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email" className="field-text">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={clientData.email}
                    onChange={(e) => setClientData({ ...clientData, email: e.target.value })}
                    placeholder="Enter sub-account email"
                    required
                    className="field-text"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description" className="field-text">Description</Label>
                  <Textarea
                    id="description"
                    value={clientData.description}
                    onChange={(e) => setClientData({ ...clientData, description: e.target.value })}
                    placeholder="Enter sub-account description"
                    rows={3}
                    className="resize-none field-text"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="field-text">Sub-Account Logo</Label>
                  <div className="flex flex-col gap-2">
                    {imagePreview && (
                      <div className="relative w-32 h-32 border border-border rounded-md overflow-hidden">
                        <img src={imagePreview} alt="Sub-account logo preview" className="w-full h-full object-contain" />
                      </div>
                    )}
                    <Input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-4 w-4 mr-2" />
                      {imagePreview ? "Change Logo" : "Upload Logo"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {isAgency && (
              <Card className="material-surface mt-6">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Create Sub-Account Login
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Label className="field-text">Create a separate login for this sub-account?</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setCreateLogin(true)}
                      className={cn(
                        "text-left p-2.5 transition-colors duration-100 groove-border relative",
                        createLogin ? "bg-card" : "bg-card hover:bg-muted/50"
                      )}
                    >
                      {createLogin && (
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            border: "1px solid hsl(var(--primary))",
                            boxShadow:
                              "inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)",
                          }}
                        />
                      )}
                      <div className="flex items-center gap-2">
                        {renderCheckbox(createLogin)}
                        <span
                          className={cn("text-foreground", createLogin && "text-primary")}
                          style={{
                            fontFamily: "'VT323', monospace",
                            fontSize: "18px",
                            letterSpacing: "0.5px",
                            textTransform: "uppercase",
                          }}
                        >
                          Yes
                        </span>
                      </div>
                      <p
                        className="text-muted-foreground mt-1"
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "13px",
                          lineHeight: "1.5",
                          paddingLeft: "28px",
                        }}
                      >
                        Create a login so the sub-account user can access their dashboard
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateLogin(false)}
                      className={cn(
                        "text-left p-2.5 transition-colors duration-100 groove-border relative",
                        !createLogin ? "bg-card" : "bg-card hover:bg-muted/50"
                      )}
                    >
                      {!createLogin && (
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            border: "1px solid hsl(var(--primary))",
                            boxShadow:
                              "inset 0 0 0 1px hsl(var(--primary) / 0.15), 0 0 0 1px hsl(var(--primary) / 0.1)",
                          }}
                        />
                      )}
                      <div className="flex items-center gap-2">
                        {renderCheckbox(!createLogin)}
                        <span
                          className={cn("text-foreground", !createLogin && "text-primary")}
                          style={{
                            fontFamily: "'VT323', monospace",
                            fontSize: "18px",
                            letterSpacing: "0.5px",
                            textTransform: "uppercase",
                          }}
                        >
                          No
                        </span>
                      </div>
                      <p
                        className="text-muted-foreground mt-1"
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: "13px",
                          lineHeight: "1.5",
                          paddingLeft: "28px",
                        }}
                      >
                        Skip login creation for now
                      </p>
                    </button>
                  </div>

                  {createLogin && (
                    <div className="space-y-4 pt-2">
                      <div className="space-y-2">
                        <Label htmlFor="login-name" className="field-text">Full Name</Label>
                        <Input
                          id="login-name"
                          value={loginData.full_name}
                          onChange={(e) => setLoginData({ ...loginData, full_name: e.target.value })}
                          placeholder="Sub-account user's name"
                          className="field-text"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="login-email" className="field-text">Login Email *</Label>
                        <Input
                          id="login-email"
                          type="email"
                          value={loginData.email}
                          onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                          placeholder="client@example.com"
                          className="field-text"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="login-password" className="field-text">Password *</Label>
                        <Input
                          id="login-password"
                          type="password"
                          value={loginData.password}
                          onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                          placeholder="Min 6 characters"
                          className="field-text"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="flex gap-4 pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(`/client/${clientId}/manage-clients`)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating || !clientData.name || !clientData.email.trim() || (createLogin && (!loginData.email || !loginData.password))}
              >
                {creating ? "Creating..." : "Create Sub-Account"}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
