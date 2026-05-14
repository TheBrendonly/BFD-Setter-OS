import React, { useState, useEffect } from 'react';
import RetroLoader from '@/components/RetroLoader';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Upload, Save, User, Lock, Mail, Building2 } from '@/components/icons';
import AppHeader, { refreshUserLogo } from '@/components/AppHeader';
const defaultLogo = '/bfd-logo.png';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  logo_url?: string;
}

const Settings = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  
  // Form states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Logo upload state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');

  useEffect(() => {
    if (user) {
      fetchUserProfile();
    }
  }, [user]);

  const fetchUserProfile = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setProfile(data);
      setFullName(data.full_name || '');
      setEmail(data.email || user.email || '');
      // Only update logo preview if it's not already showing an uploaded image
      if (!logoFile) {
        setLogoPreview(data.logo_url || defaultLogo);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
      toast({
        title: "Error",
        description: "Failed to load profile data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadLogo = async (): Promise<string | null> => {
    if (!logoFile || !user) return null;

    try {
      const fileExt = logoFile.name.split('.').pop();
      const fileName = `${user.id}/logo.${fileExt}`;
      
      // Delete existing logo if it exists
      if (profile?.logo_url) {
        const urlParts = profile.logo_url.split('/');
        const existingFileName = urlParts[urlParts.length - 1];
        const existingPath = `${user.id}/${existingFileName}`;
        
        await supabase.storage
          .from('logos')
          .remove([existingPath]);
      }

      // Upload new logo with timestamp to avoid caching issues
      const { data, error } = await supabase.storage
        .from('logos')
        .upload(fileName, logoFile, { upsert: true });

      if (error) throw error;

      // Get public URL with cache-busting parameter
      const { data: urlData } = supabase.storage
        .from('logos')
        .getPublicUrl(fileName);

      // Add timestamp to bust browser cache
      const cacheBustedUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      return cacheBustedUrl;
    } catch (error) {
      console.error('Error uploading logo:', error);
      toast({
        title: "Error",
        description: "Failed to upload logo",
        variant: "destructive"
      });
      return null;
    }
  };

  const updateProfile = async () => {
    if (!user || !profile) return;

    setUpdating(true);
    try {
      let logoUrl = profile.logo_url;

      // Upload logo if a new one was selected
      if (logoFile) {
        const uploadedLogoUrl = await uploadLogo();
        if (uploadedLogoUrl) {
          logoUrl = uploadedLogoUrl;
        }
      }

      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          email: email,
          logo_url: logoUrl,
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      // Update email in auth if changed
      if (email !== user.email) {
        const { error: emailError } = await supabase.auth.updateUser({
          email: email
        });
        if (emailError) throw emailError;
      }

      toast({
        title: "Success",
        description: "Profile updated successfully",
      });

      // Update logo preview immediately with new URL
      if (logoUrl) {
        setLogoPreview(logoUrl);
      }

      // Refresh logo in navigation immediately
      if (user && logoFile) {
        refreshUserLogo(user.id);
      }

      // Clear logo file state and refresh profile data
      setLogoFile(null);
      // Refresh profile but don't override the logo preview we just set
      await fetchUserProfile();
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        title: "Error",
        description: "Failed to update profile",
        variant: "destructive"
      });
    } finally {
      setUpdating(false);
    }
  };

  const updatePassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast({
        title: "Error",
        description: "Please fill in all password fields",
        variant: "destructive"
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords don't match",
        variant: "destructive"
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters",
        variant: "destructive"
      });
      return;
    }

    setUpdating(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Password updated successfully",
      });

      // Clear password fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      console.error('Error updating password:', error);
      toast({
        title: "Error",
        description: "Failed to update password",
        variant: "destructive"
      });
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <RetroLoader />;
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <AppHeader
        title="" 
        backButton={{
          label: "Back to Clients",
          onClick: () => navigate('/clients')
        }}
      />

      <div className="mobile-container mobile-section-padding">

      {/* Main Content */}
      <main className="max-w-4xl mx-auto py-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Profile Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Profile Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="logo">Logo Upload</Label>
                <div className="flex items-center gap-4">
                  <div className="h-20 w-24 bg-transparent border border-border rounded-lg flex items-center justify-center overflow-hidden">
                    <img 
                      src={logoPreview} 
                      alt="Logo preview" 
                      className="object-contain max-w-full max-h-full" 
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.setAttribute('style', 'display: flex');
                      }}
                    />
                    <div className="hidden items-center justify-center w-full h-full bg-muted rounded-lg">
                      <Building2 className="w-10 h-10" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <Input
                      id="logo"
                      type="file"
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="cursor-pointer"
                    />
                    <p className="text-xs text-on-surface-variant mt-1">
                      Upload a PNG, JPG or GIF (max 2MB)
                    </p>
                  </div>
                </div>
              </div>

              <Button 
                onClick={updateProfile} 
                disabled={updating}
                className="w-full"
              >
                <Save className="w-4 h-4 mr-2" />
                {updating ? 'Updating...' : 'Update Profile'}
              </Button>
            </CardContent>
          </Card>

          {/* Change Password */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Change Password
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                />
              </div>

              <Button 
                onClick={updatePassword} 
                disabled={updating}
                className="w-full"
              >
                <Lock className="w-4 h-4 mr-2" />
                {updating ? 'Updating...' : 'Update Password'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
      </div>
    </div>
  );
};

export default Settings;