import React, { useState, useEffect, useRef } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import AppHeader from '@/components/AppHeader';
import { ArrowLeft, Database, MessageSquare, BookOpen, BarChart3, Building2, Settings, TrendingUp, Edit, Upload, X, Image, Monitor } from '@/components/icons';

interface Client {
  id: string;
  name: string;
  email: string | null;
  description: string | null;
  image_url: string | null;
  supabase_service_key?: string | null;
  supabase_table_name?: string | null;
  supabase_url?: string | null;
}

interface ModuleStats {
  campaigns: number;
  prompts: number;
  knowledgeBase: number;
}

const ClientDashboard = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [client, setClient] = useState<Client | null>(null);
  const [stats, setStats] = useState<ModuleStats>({ campaigns: 0, prompts: 0, knowledgeBase: 0 });
  const [loading, setLoading] = useState(true);
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [clientData, setClientData] = useState({
    name: '',
    email: '',
    description: '',
    image_url: ''
  });
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [imageRemoved, setImageRemoved] = useState<boolean>(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (clientId) {
      fetchClientData();
      fetchStats();
    }
  }, [clientId, user]);

  const fetchClientData = async () => {
    if (!clientId || !user) return;

    try {
      // Add timestamp to force fresh data
      const { data, error } = await supabase
        .from('clients_public')
        .select('*')
        .eq('id', clientId)
        .single();

      if (error) throw error;
      setClient(data);
    } catch (error: any) {
      console.error('Error fetching client:', error);
      toast({
        title: "Error",
        description: "Failed to fetch client data",
        variant: "destructive"
      });
      navigate('/clients');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    if (!clientId) return;

    try {
      // Fetch campaigns count
      const { count: campaignsCount, error: campaignsError } = await supabase
        .from('campaigns')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId);

      if (campaignsError) throw campaignsError;

      // Fetch prompts count
      const { count: promptsCount, error: promptsError } = await supabase
        .from('prompts')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId);

      if (promptsError) throw promptsError;

      // Fetch knowledge base count
      const { count: knowledgeCount, error: knowledgeError } = await supabase
        .from('knowledge_base')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId);

      if (knowledgeError) throw knowledgeError;

      setStats({
        campaigns: campaignsCount || 0,
        prompts: promptsCount || 0,
        knowledgeBase: knowledgeCount || 0
      });
    } catch (error: any) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file (JPG, PNG, GIF, etc.)",
        variant: "destructive"
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image smaller than 5MB",
        variant: "destructive"
      });
      return;
    }

    setSelectedImage(file);
    setImageRemoved(false);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const uploadImage = async (file: File, clientId: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${clientId}-${Date.now()}.${fileExt}`;

    if (client?.image_url) {
      try {
        const urlParts = client.image_url.split('/');
        const existingFileName = urlParts[urlParts.length - 1].split('?')[0];
        await supabase.storage.from('logos').remove([existingFileName]);
      } catch (error) {
        console.log('Note: Could not remove existing logo file');
      }
    }

    const { data, error } = await supabase.storage
      .from('logos')
      .upload(fileName, file, {
        cacheControl: '0',
        upsert: true
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage.from('logos').getPublicUrl(fileName);
    return `${publicUrl}?t=${Date.now()}`;
  };

  const removeImage = () => {
    setSelectedImage(null);
    setImagePreview('');
    setImageRemoved(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleEditClick = () => {
    if (!client) return;
    setClientData({
      name: client.name,
      email: client.email || '',
      description: client.description || '',
      image_url: client.image_url || ''
    });
    setImagePreview(client.image_url || '');
    setSelectedImage(null);
    setImageRemoved(false);
    setEditDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !clientId) return;
    
    setUploading(true);
    try {
      let imageUrl = clientData.image_url;

      if (selectedImage) {
        imageUrl = await uploadImage(selectedImage, clientId);
      } else if (imageRemoved) {
        imageUrl = null;
      }

      const { error } = await supabase.from('clients').update({
        name: clientData.name,
        email: clientData.email || null,
        description: clientData.description || null,
        image_url: imageUrl
      }).eq('id', clientId);

      if (error) throw error;

      toast({
        title: "Client updated",
        description: "Client information has been updated successfully"
      });

      setClientData({
        name: '',
        email: '',
        description: '',
        image_url: ''
      });
      setSelectedImage(null);
      setImagePreview('');
      setImageRemoved(false);
      setEditDialogOpen(false);
      fetchClientData();
    } catch (error: any) {
      console.error('Error saving client:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save client",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <RetroLoader />;
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center mobile-container">
        <Card className="modern-card mobile-text-center p-4 sm:p-6">
          <CardContent className="mobile-card-spacing">
            <h2 className="mobile-heading-3 mb-2">Client not found</h2>
            <p className="text-muted-foreground mobile-text mb-4">The requested client could not be found.</p>
            <Button onClick={() => navigate('/clients')} className="modern-button-primary mobile-button-full sm:w-auto">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Clients
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <AppHeader
        backButton={{
          label: "Back to Dashboard",
          onClick: () => navigate('/clients')
        }}
        clientName={client.name}
      />

      <div className="mobile-container mobile-section-padding">
        {/* Client Info Section */}
        <div className="mb-8">
          <Card className="material-surface">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden border border-border/20 flex-shrink-0">
                  {client.image_url ? (
                    <img 
                      src={`${client.image_url}${client.image_url.includes('?') ? '&' : '?'}t=${Date.now()}`} 
                      alt={`${client.name} logo`} 
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        const fallback = target.parentElement?.querySelector('.fallback-icon');
                        if (fallback) fallback.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <Building2 className={`w-6 h-6 text-primary fallback-icon ${client.image_url ? 'hidden' : ''}`} />
                </div>
                <div className="flex-1">
                  <h1 className="text-2xl font-bold text-foreground">{client.name}</h1>
                  {client.email && (
                    <p className="text-muted-foreground mt-1">{client.email}</p>
                  )}
                  {client.description && (
                    <p className="text-sm text-muted-foreground mt-2">{client.description}</p>
                  )}
                </div>
                <Button
                  onClick={handleEditClick}
                  className="!h-8 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Client
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Module Cards - Organized in order: APIs, Prompts, Analytics, Knowledge Base, DB Reactivation, Demo Pages */}
        <div className="space-y-6">
          {/* First Row - 3 cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="material-surface cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => navigate(`/client/${clientId}/api-management`)}>
            <CardHeader className="p-4 pb-0 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-primary/10 rounded-xl group-hover:bg-primary/20 transition-colors">
                  <Settings className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">APIs & Integrations</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 px-4 pb-4 text-center">
              <p className="text-muted-foreground">
                Configure all of your API credentials, webhooks, integrations and parameters.
              </p>
            </CardContent>
          </Card>

          <Card className="material-surface cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => navigate(`/client/${clientId}/prompt-management`)}>
            <CardHeader className="p-4 pb-0 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-primary/10 rounded-xl group-hover:bg-primary/20 transition-colors">
                  <MessageSquare className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Prompt Management</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 px-4 pb-4 text-center">
              <p className="text-muted-foreground">
                Create, organize, and manage AI prompts for various use cases and campaigns.
              </p>
            </CardContent>
          </Card>

          <Card className="material-surface cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => navigate(`/client/${clientId}/chat-analytics`)}>
            <CardHeader className="p-4 pb-0 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-primary/10 rounded-xl group-hover:bg-primary/20 transition-colors">
                  <TrendingUp className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Chat Analytics</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 px-4 pb-4 text-center">
              <p className="text-muted-foreground">
                Connect to your Supabase and get AI-powered insights from chat history data.
              </p>
            </CardContent>
          </Card>
          </div>

          {/* Second Row - 3 cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="material-surface cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => navigate(`/client/${clientId}/knowledge-base`)}>
            <CardHeader className="p-4 pb-0 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-primary/10 rounded-xl group-hover:bg-primary/20 transition-colors">
                  <BookOpen className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Knowledge Base</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 px-4 pb-4 text-center">
              <p className="text-muted-foreground">
                Create and maintain a comprehensive knowledge base for reference and training.
              </p>
            </CardContent>
          </Card>

          <Card className="material-surface cursor-pointer hover:shadow-md transition-shadow group" 
                onClick={() => navigate(`/client/${clientId}/database-reactivation`)}>
            <CardHeader className="p-4 pb-0 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-primary/10 rounded-xl group-hover:bg-primary/20 transition-colors">
                  <Database className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Database Reactivation</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 px-4 pb-4 text-center">
              <p className="text-muted-foreground">
                Manage and execute database reactivation campaigns with scheduling.
              </p>
            </CardContent>
          </Card>

          {/* HIDDEN FOR PUBLISH - Demo Pages Card - Uncomment to restore:
          <Card className="material-surface cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => navigate(`/client/${clientId}/demo-pages`)}>
            <CardHeader className="p-4 pb-0 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-primary/10 rounded-xl group-hover:bg-primary/20 transition-colors">
                  <Monitor className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">Demo Pages</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 px-4 pb-4 text-center">
              <p className="text-muted-foreground">
                Create beautiful demo pages with creatives and lead capture forms for prospects.
              </p>
            </CardContent>
          </Card>
          */}
          </div>
        </div>
      </div>

      {/* Edit Client Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="w-full max-w-lg mx-auto max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
             <DialogTitle>Edit Sub-Account</DialogTitle>
            <DialogDescription>
              Update sub-account information
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name" className="text-sm font-medium">Sub-Account Name</Label>
                  <Input 
                    id="name" 
                    value={clientData.name} 
                    onChange={e => setClientData({ ...clientData, name: e.target.value })} 
                    required 
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="email" className="text-sm font-medium">Email (optional)</Label>
                  <Input 
                    id="email" 
                    type="email" 
                    value={clientData.email} 
                    onChange={e => setClientData({ ...clientData, email: e.target.value })} 
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="description" className="text-sm font-medium">Description (optional)</Label>
                  <Textarea 
                    id="description" 
                    value={clientData.description} 
                    onChange={e => setClientData({ ...clientData, description: e.target.value })} 
                    rows={3} 
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">Sub-Account Logo (optional)</Label>
                  <div className="mt-2 space-y-3">
                    {imagePreview && (
                      <div className="relative w-24 h-24 rounded-lg border-2 border-border overflow-hidden bg-muted">
                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="absolute top-1 right-1 h-6 w-6 p-0"
                          onClick={removeImage}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageSelect}
                        className="hidden"
                        id="logo-upload"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        {imagePreview ? 'Change Logo' : 'Upload Logo'}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Recommended: Square image, max 5MB (JPG, PNG, GIF)
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="shrink-0 mt-4">
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} disabled={uploading}>
                Cancel
              </Button>
              <Button type="submit" disabled={uploading || !clientData.name.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {uploading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2 shrink-0"></div>
                    <span className="truncate">Updating...</span>
                  </>
                ) : (
                  <span className="truncate">Update Client</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClientDashboard;