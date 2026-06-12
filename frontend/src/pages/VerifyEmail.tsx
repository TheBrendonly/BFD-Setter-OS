import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import logoImg from '@/assets/bfd-logo.png';

const VerifyEmail = () => {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const email = (location.state as any)?.email || '';

  if (!authLoading && user) {
    return <Navigate to="/" replace />;
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast({
        title: "Missing email",
        description: "Please go back and register again.",
        variant: "destructive"
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: token.trim(),
        type: 'signup',
      });

      if (error) {
        toast({
          title: "Verification failed",
          description: error.message,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Email verified!",
          description: "Your account is now active. Redirecting...",
        });
        // Auth state change listener will handle the redirect
      }
    } catch (error) {
      toast({
        title: "An error occurred",
        description: "Please try again later",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!email) return;
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (error) {
        toast({
          title: "Resend failed",
          description: error.message,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Code resent",
          description: "Check your email for a new verification code.",
        });
      }
    } catch {
      toast({
        title: "An error occurred",
        description: "Please try again later",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center mobile-container pb-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-3 sm:mb-4">
          <div className="flex items-center justify-center mb-4 sm:mb-6">
            <img src={logoImg} alt="BFD-setter Logo" className="h-12 sm:h-16 w-auto" />
          </div>
          <h1 className="mobile-heading-2 text-on-surface font-semibold">Verify Your Email</h1>
          <p className="text-on-surface-variant mt-1 field-text">
            {email ? (
              <>We sent a 6-digit code to <span className="text-foreground font-semibold">{email}</span></>
            ) : (
              'Enter the 6-digit code sent to your email'
            )}
          </p>
        </div>

        <div className="material-surface p-4 sm:p-6 lg:p-8 mt-2">
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="token" className="field-text font-medium text-on-surface">
                Verification Code
              </Label>
              <Input
                id="token"
                type="text"
                placeholder="Enter 6-digit code"
                value={token}
                onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 8))}
                className="modern-input text-center tracking-[0.5em]"
                disabled={submitting}
                required
                maxLength={8}
                minLength={6}
                autoComplete="one-time-code"
              />
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={submitting || token.length < 6} className="material-button-primary modern-button-primary w-full py-3 mobile-touch">
                {submitting ? 'Verifying...' : 'Verify Email'}
              </Button>
            </div>
          </form>

          <div className="mt-4 sm:mt-6 text-center space-y-2">
            <p className="text-on-surface-variant field-text">
              Didn't receive the code?{' '}
              <button
                type="button"
                onClick={handleResend}
                className="font-bold text-primary hover:text-primary/80 transition-colors underline"
              >
                Resend code
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
