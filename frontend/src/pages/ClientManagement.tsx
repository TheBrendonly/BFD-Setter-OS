import React, { useState, useEffect, useRef } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Edit, Eye, Plus, Users, Calendar, Upload, X, Image, Activity } from '@/components/icons';
import AppHeader from '@/components/AppHeader';
interface Client {
  id: string;
  name: string;
  email: string | null;
  description: string | null;
  image_url: string | null;
  created_at: string;
  supabase_service_key?: string | null;
  supabase_table_name?: string | null;
  supabase_url?: string | null;
}
interface Analytics {
  totalClients: number;
}
const ClientManagement = () => {
  const {
    user
  } = useAuth();
  const navigate = useNavigate();
  const {
    toast
  } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    totalClients: 0
  });
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    clientId: '',
    clientName: ''
  });
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
    fetchClients();
    fetchAnalytics();
  }, [user]);
  const fetchAnalytics = async () => {
    if (!user) return;
    try {
      // Get user's agency clients
      const {
        data: agencyClients,
        error: clientsError
      } = await supabase.from('clients_public').select('id, created_at').order('created_at', {
        ascending: false
      });
      if (clientsError) throw clientsError;
      const totalClients = agencyClients.length;
      
      setAnalytics({
        totalClients
      });
    } catch (error: any) {
      console.error('Error fetching analytics:', error);
      // Set fallback analytics
      setAnalytics({
        totalClients: clients.length
      });
    }
  };
  const fetchClients = async () => {
    if (!user) return;
    try {
      const {
        data,
        error
      } = await supabase.from('clients_public').select('*').order('created_at', {
        ascending: false
      });
      if (error) throw error;
      setClients(data || []);
    } catch (error: any) {
      console.error('Error fetching clients:', error);
      toast({
        title: "Error",
        description: "Failed to fetch clients",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };
  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file (JPG, PNG, GIF, etc.)",
        variant: "destructive"
      });
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image smaller than 5MB",
        variant: "destructive"
      });
      return;
    }

    setSelectedImage(file);
    setImageRemoved(false); // Reset removal state when new image is selected
    
    // Create preview URL
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const uploadImage = async (file: File, clientId: string): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${clientId}-${Date.now()}.${fileExt}`;

    // Delete existing logo if it exists to clear cache
    if (editingClient?.image_url) {
      try {
        const urlParts = editingClient.image_url.split('/');
        const existingFileName = urlParts[urlParts.length - 1].split('?')[0]; // Remove query params
        await supabase.storage
          .from('logos')
          .remove([existingFileName]);
      } catch (error) {
        console.log('Note: Could not remove existing logo file');
      }
    }

    const { data, error } = await supabase.storage
      .from('logos')
      .upload(fileName, file, {
        cacheControl: '0', // Disable caching
        upsert: true
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('logos')
      .getPublicUrl(fileName);

    // Add cache-busting timestamp
    const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;
    return cacheBustedUrl;
  };

  const removeImage = () => {
    setSelectedImage(null);
    setImagePreview('');
    setImageRemoved(true); // Track that image was explicitly removed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setUploading(true);
    try {
      // Get user's agency_id
      const {
        data: profile,
        error: profileError
      } = await supabase.from('profiles').select('agency_id').eq('id', user.id).single();
      if (profileError || !profile.agency_id) {
        throw new Error('Agency not found');
      }

      let imageUrl = clientData.image_url;

      if (editingClient) {
        // Handle image changes for existing client
        if (selectedImage) {
          // User uploaded a new image
          imageUrl = await uploadImage(selectedImage, editingClient.id);
        } else if (imageRemoved) {
          // User explicitly removed the image
          imageUrl = null;
        }

        // Update existing client
        const {
          error
        } = await supabase.from('clients').update({
          name: clientData.name,
          email: clientData.email || null,
          description: clientData.description || null,
          image_url: imageUrl
        }).eq('id', editingClient.id);
        if (error) throw error;
        toast({
          title: "Client updated",
          description: "Client information has been updated successfully"
        });
      } else {
        // Create new client first to get the ID
        const {
          data: newClient,
          error: insertError
        } = await supabase.from('clients').insert({
          agency_id: profile.agency_id,
          name: clientData.name,
          email: clientData.email || null,
          description: clientData.description || null
        }).select().single();

        if (insertError) throw insertError;

        // Handle image upload for new client
        if (selectedImage) {
          imageUrl = await uploadImage(selectedImage, newClient.id);
          
          // Update the client with the image URL
          const { error: updateError } = await supabase.from('clients')
            .update({ image_url: imageUrl })
            .eq('id', newClient.id);
          
          if (updateError) throw updateError;
        }

        toast({
          title: "Sub-account created",
          description: "New sub-account has been created successfully"
        });

        // Navigate to the new client's dashboard
        navigate(`/client/${newClient.id}/analytics/chatbot/dashboard`);
        return;
      }
      
      setClientData({
        name: '',
        email: '',
        description: '',
        image_url: ''
      });
      setSelectedImage(null);
      setImagePreview('');
      setImageRemoved(false);
      setEditingClient(null);
      setDialogOpen(false);
      fetchClients();
      fetchAnalytics(); // Refresh analytics after changes
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
  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setClientData({
      name: client.name,
      email: client.email || '',
      description: client.description || '',
      image_url: client.image_url || ''
    });
    setImagePreview(client.image_url || '');
    setSelectedImage(null);
    setImageRemoved(false); // Reset removal state when editing
    setDialogOpen(true);
  };
  const handleDelete = (clientId: string, clientName: string) => {
    setDeleteDialog({
      open: true,
      clientId,
      clientName
    });
  };
  const handleDeleteConfirm = async () => {
    try {
      const { error } = await supabase.rpc('delete_client_with_data', {
        client_id_param: deleteDialog.clientId
      });
      
      if (error) throw error;
      
      toast({
        title: "Client deleted",
        description: "Client and all associated data have been deleted"
      });
      fetchClients();
      fetchAnalytics(); // Refresh analytics after deletion
      setDeleteDialog({
        open: false,
        clientId: '',
        clientName: ''
      });
    } catch (error: any) {
      console.error('Error deleting client:', error);
      toast({
        title: "Error",
        description: "Failed to delete client",
        variant: "destructive"
      });
    }
  };
  const openCreateDialog = () => {
    setEditingClient(null);
    setClientData({
      name: '',
      email: '',
      description: '',
      image_url: ''
    });
    setSelectedImage(null);
    setImagePreview('');
    setImageRemoved(false); // Reset removal state when creating new client
    setDialogOpen(true);
  };
  if (loading) {
    return <RetroLoader />;
  }
  return <div className="min-h-screen bg-background pb-12">
      <AppHeader title="" isMainDashboard={true} />
      
      <div className="mobile-container mobile-section-padding">

        {/* Analytics Card - Single card for total clients */}
        <div className="flex justify-center mb-6 sm:mb-8">
          <div className="w-full max-w-md">
            <Card className="modern-card bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="mobile-text font-medium text-primary">Total Current Clients</CardTitle>
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Users className="h-5 w-5 text-primary" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl sm:text-4xl font-bold text-primary mb-2">{analytics.totalClients}</div>
                <p className="text-xs text-muted-foreground">All registered clients</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Actions Section */}
        <div className="mobile-flex-col justify-between items-start gap-4 sm:gap-6 mb-6">
          <div>
            <h2 className="mobile-heading-2 mb-2">Your Clients</h2>
            <p className="text-muted-foreground mobile-text">Manage and organize all your client accounts</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog} className="modern-button-primary mobile-button-full sm:w-auto animate-pulse-glow">
                <Plus className="w-4 h-4 mr-2" />
                Add New Client
              </Button>
            </DialogTrigger>
            <DialogContent className="w-full max-w-lg mx-auto max-h-[90vh] flex flex-col overflow-hidden">
              <DialogHeader className="shrink-0">
                <DialogTitle>{editingClient ? 'Edit Client' : 'Create New Client'}</DialogTitle>
                <DialogDescription>
                  {editingClient ? 'Update client information' : 'Add a new client to your agency'}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="name" className="text-sm font-medium">Client Name</Label>
                      <Input id="name" value={clientData.name} onChange={e => setClientData({
                      ...clientData,
                      name: e.target.value
                    })} placeholder="Enter client name" className="w-full" required />
                    </div>
                    <div>
                      <Label htmlFor="email" className="text-sm font-medium">Email (Optional)</Label>
                      <Input id="email" type="email" value={clientData.email} onChange={e => setClientData({
                      ...clientData,
                      email: e.target.value
                    })} placeholder="Enter client email" className="w-full" />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Client Logo (Optional)</Label>
                      <div className="space-y-3">
                        {imagePreview ? (
                          <div className="relative w-24 h-24">
                            <div className="w-24 h-24 rounded-lg overflow-hidden bg-muted border-2 border-border">
                              <img 
                                src={imagePreview} 
                                alt="Client logo preview" 
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <Button
                              type="button"
                              onClick={removeImage}
                              size="sm"
                              variant="destructive"
                              className="absolute -top-2 -right-2 w-6 h-6 rounded-full p-0"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <div className="w-24 h-24 rounded-lg bg-muted border-2 border-dashed border-border flex items-center justify-center">
                            <Image className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                        
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            variant="outline"
                            size="sm"
                            className="flex-1 min-w-0"
                          >
                            <Upload className="w-4 h-4 mr-2 shrink-0" />
                            <span className="truncate">{imagePreview ? 'Change Image' : 'Upload Logo'}</span>
                          </Button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleImageSelect}
                            className="hidden"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          JPG, PNG, GIF up to 5MB. Image will be resized automatically.
                        </p>
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="description" className="text-sm font-medium">Description (Optional)</Label>
                      <Textarea id="description" value={clientData.description} onChange={e => setClientData({
                      ...clientData,
                      description: e.target.value
                    })} placeholder="Enter client description" className="w-full resize-none" rows={3} />
                    </div>
                  </div>
                </div>
                <DialogFooter className="shrink-0 gap-3 pt-4 border-t mt-4">
                  <Button 
                    type="submit" 
                    className="w-full sm:w-auto min-w-0" 
                    disabled={uploading}
                  >
                    {uploading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2 shrink-0"></div>
                        <span className="truncate">{editingClient ? 'Updating...' : 'Creating...'}</span>
                      </>
                    ) : (
                      <span className="truncate">{editingClient ? 'Update Client' : 'Create Client'}</span>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Clients Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {clients.map((client, index) => (
             <Card 
               key={client.id} 
               className="group hover:shadow-lg transition-all duration-300 border border-border/50 bg-card animate-fade-in flex flex-col h-full" 
               style={{ animationDelay: `${index * 100}ms` }}
             >
               {/* Header Section - Fixed Height */}
               <CardHeader className="pb-4 flex-shrink-0">
                 <div className="flex items-center gap-3">
                   <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden border border-border/20 flex-shrink-0">
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
                     <Users className={`w-5 h-5 text-primary fallback-icon ${client.image_url ? 'hidden' : ''}`} />
                   </div>
                   <div className="flex-1 min-w-0">
                     <CardTitle className="text-base font-semibold leading-tight group-hover:text-primary transition-colors truncate">
                       {client.name}
                     </CardTitle>
                     {client.email && (
                       <CardDescription className="text-sm text-muted-foreground truncate mt-1">
                         {client.email}
                       </CardDescription>
                     )}
                   </div>
                 </div>
               </CardHeader>
              
               {/* Description Section */}
               <CardContent className="pt-0 pb-3 flex-1 flex flex-col">
                 {client.description && (
                   <div className="mb-4">
                     <p className="text-sm text-muted-foreground leading-relaxed">
                       {client.description}
                     </p>
                   </div>
                 )}
                
                {/* Date Section */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 pb-3 border-b border-border/20">
                  <Calendar className="w-3 h-3 flex-shrink-0" />
                  <span>
                    {new Date(client.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </span>
                </div>
                
                {/* Action Buttons - Fixed Height */}
                <div className="flex gap-2 mt-auto">
                  <Button 
                    size="sm" 
                    onClick={() => navigate(`/client/${client.id}`)} 
                    className="flex-1 h-9 bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    View
                  </Button>
                  <Button 
                    size="sm" 
                    onClick={() => handleEdit(client)} 
                    className="flex-1 h-9 bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs"
                  >
                    <Edit className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                  <Button 
                    size="sm" 
                    onClick={() => handleDelete(client.id, client.name)} 
                    className="flex-1 h-9 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

         {/* Empty State */}
         {clients.length === 0 && <Card className="modern-card mobile-text-center py-8 sm:py-12">
             <CardContent className="mobile-card-spacing">
               <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                 <Users className="w-8 h-8 sm:w-10 sm:h-10 text-primary" />
               </div>
               <h3 className="mobile-heading-2 mb-2">No clients yet</h3>
               <p className="text-muted-foreground mobile-text mb-6">
                 Create your first client to get started with managing campaigns, prompts, and knowledge base.
               </p>
               <Button onClick={openCreateDialog} className="modern-button-primary mobile-button-full sm:w-auto">
                 <Plus className="w-4 h-4 mr-2" />
                 Add Your First Client
               </Button>
             </CardContent>
           </Card>}
       </div>
       
       {/* Floating Add Button */}
       

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog open={deleteDialog.open} onOpenChange={open => setDeleteDialog(prev => ({
      ...prev,
      open
    }))} onConfirm={handleDeleteConfirm} title="Delete Client" description="This will permanently delete the client and all associated campaigns, leads, prompts, and knowledge base entries. This action cannot be undone." itemName={deleteDialog.clientName} />
    </div>;
};
export default ClientManagement;