import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { LogOut, Settings, Building2, ArrowLeft, Plus } from '@/components/icons';
import { 
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage
} from '@/components/ui/breadcrumb';
const defaultLogo = '/bfd-logo.png';

// Cache for logo URLs to avoid repeated API calls
const logoCache = new Map<string, string>();

// Function to clear logo cache for a specific user
export const clearLogoCache = (userId: string) => {
  logoCache.delete(userId);
};

// Create a custom event for logo updates
const LOGO_UPDATE_EVENT = 'logoUpdated';

// Function to trigger logo refresh
export const refreshUserLogo = (userId: string) => {
  clearLogoCache(userId);
  window.dispatchEvent(new CustomEvent(LOGO_UPDATE_EVENT, { detail: { userId } }));
};
interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  isMainDashboard?: boolean;
  backButton?: {
    label: string;
    onClick: () => void;
  };
  onCreateClient?: () => void;
  clientName?: string;
}
const AppHeader = ({
  title,
  subtitle,
  isMainDashboard = false,
  backButton,
  onCreateClient,
  clientName
}: AppHeaderProps) => {
  const {
    user,
    signOut
  } = useAuth();
  const navigate = useNavigate();
  const [logoUrl, setLogoUrl] = useState<string>(defaultLogo);
  const [logoLoading, setLogoLoading] = useState(true);

  // Preload image for smooth loading
  const preloadImage = useCallback((url: string) => {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = reject;
      img.src = url;
    });
  }, []);
  const fetchUserLogo = useCallback(async () => {
    if (!user) {
      setLogoUrl(defaultLogo);
      setLogoLoading(false);
      return;
    }

    try {
      const {
        data,
        error
      } = await supabase.from('profiles').select('logo_url').eq('id', user.id).single();
      if (error) throw error;
      const finalLogoUrl = data?.logo_url || defaultLogo;

      // Preload the image to ensure smooth display
      await preloadImage(finalLogoUrl);

      // Cache the result and update state
      logoCache.set(user.id, finalLogoUrl);
      setLogoUrl(finalLogoUrl);
    } catch (error) {
      console.error('Error fetching user logo:', error);
      // Fallback to default logo and preload it
      const fallbackLogo = defaultLogo;
      await preloadImage(fallbackLogo);
      logoCache.set(user.id, fallbackLogo);
      setLogoUrl(fallbackLogo);
    } finally {
      setLogoLoading(false);
    }
  }, [user, preloadImage]);
  useEffect(() => {
    fetchUserLogo();
  }, [fetchUserLogo]);

  // Listen for logo update events
  useEffect(() => {
    const handleLogoUpdate = (event: CustomEvent) => {
      if (user && event.detail.userId === user.id) {
        setLogoLoading(true);
        fetchUserLogo();
      }
    };

    window.addEventListener(LOGO_UPDATE_EVENT, handleLogoUpdate as EventListener);
    return () => {
      window.removeEventListener(LOGO_UPDATE_EVENT, handleLogoUpdate as EventListener);
    };
  }, [user, fetchUserLogo]);
  const handleSignOut = async () => {
    try {
      const { error } = await signOut();
      if (error) {
        console.error('Sign out error:', error);
      }
    } catch (err) {
      console.error('Unexpected sign out error:', err);
    } finally {
      // Navigate to auth page regardless of error (session might already be invalid)
      navigate('/auth', { replace: true });
    }
  };
  const handleLogoClick = () => {
    navigate('/clients');
  };
  return <>
      {/* Fixed Navigation Bar - Always at top of screen */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-card shadow-sm" style={{ borderBottom: '2px groove hsl(var(--border-groove))' }}>
        <div className="mobile-container py-3 sm:py-4">
          <div className="grid grid-cols-3 items-center min-h-[48px] gap-2">
             {/* Left Section: Back Button or Add New Sub-Account */}
            <div className="flex justify-start">
              {isMainDashboard && onCreateClient ? <Button onClick={onCreateClient} size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 hidden sm:flex">
                  <Plus className="w-4 h-4 mr-2" />
                  Add New Sub-Account
                </Button> : backButton ? <Button variant="outline" onClick={backButton.onClick} className="border-border hover:bg-accent hover:text-accent-foreground">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  {backButton.label}
                </Button> : null}
            </div>

            {/* Center Section: Logo (Always Clickable) */}
            <div className="flex justify-center">
              <button onClick={handleLogoClick} className="h-10 sm:h-12 w-auto max-w-[100px] sm:max-w-48 bg-transparent hover:opacity-80 transition-opacity duration-200">
                <img src={logoUrl} alt="Company Logo" className={`object-contain h-full w-auto transition-opacity duration-300 ${logoLoading ? 'opacity-0' : 'opacity-100'}`} onLoad={() => setLogoLoading(false)} onError={() => {
                setLogoUrl(defaultLogo);
                setLogoLoading(false);
              }} />
                {logoLoading && <div className="bg-primary/10 rounded-lg transition-opacity duration-300 h-10 sm:h-12 w-10 sm:w-12 flex items-center justify-center">
                    <Building2 className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                  </div>}
              </button>
            </div>

            {/* Right Section: Client Name + Settings and Sign Out */}
            <div className="flex justify-end items-center gap-1 sm:gap-4">
              {clientName && (
                <div className="text-sm sm:text-lg font-medium text-foreground truncate max-w-[120px] sm:max-w-none">
                  {clientName}
                </div>
              )}
              {isMainDashboard && <>
                  <Button variant="outline" size="sm" onClick={() => navigate('/settings')} className="hover:bg-accent hover:text-accent-foreground p-2 sm:px-3">
                    <Settings className="w-4 h-4" />
                    <span className="hidden sm:inline sm:ml-2">Settings</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleSignOut} className="hover:bg-accent hover:text-accent-foreground text-muted-foreground hover:text-foreground p-2 sm:px-3">
                    <LogOut className="w-4 h-4" />
                    <span className="hidden sm:inline sm:ml-2">Sign Out</span>
                  </Button>
                </>}
            </div>
          </div>
        </div>
      </nav>

      {/* Spacer to push content below fixed navigation */}
      <div className="h-20"></div>

      {/* Page Header Content - only show if title exists */}
      {title ? (
        <div className="bg-background border-b border-border py-6">
          <div className="mobile-container">
            <div className="space-y-2">
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{title}</h1>
              {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
        </div>
      ) : null}
    </>;
};
export default AppHeader;