import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import logoImg from '@/assets/1prompt-logo.png';
import { ArrowLeft, CheckCircle, AlertTriangle } from 'lucide-react';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [expired, setExpired] = useState(false);
  const [validationError, setValidationError] = useState('');
  const { toast } = useToast();
  const navigate = useNavigate();

  // Check for recovery event from the URL hash
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User arrived via recovery link — form is ready
      }
    });

    // Check if there's already an error in the URL (expired link)
    const hash = window.location.hash;
    if (hash.includes('error=') || hash.includes('error_code=')) {
      setExpired(true);
    }

    return () => subscription.unsubscribe();
  }, []);

  const validate = (): boolean => {
    if (password.length < 6) {
      setValidationError('Password must be at least 6 characters');
      return false;
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match');
      return false;
    }
    setValidationError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        if (error.message.toLowerCase().includes('expired') || error.message.toLowerCase().includes('invalid')) {
          setExpired(true);
        } else {
          toast({
            title: 'Error resetting password',
            description: error.message,
            variant: 'destructive',
          });
        }
      } else {
        setSuccess(true);
        // Sign out so user logs in with new password
        await supabase.auth.signOut();
        setTimeout(() => navigate('/auth'), 3000);
      }
    } catch {
      toast({
        title: 'An error occurred',
        description: 'Please try again later',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center mobile-container pb-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center">
          <img src={logoImg} alt="BFD-setter Logo" className="h-12 sm:h-16 w-auto" />
        </div>

        {/* Title */}
        <div className="text-center mt-6">
          <h1 className="mobile-heading-2 text-on-surface font-semibold">Set New Password</h1>
          <p className="text-on-surface-variant mt-1 field-text">
            Enter your new password below
          </p>
        </div>

        {/* Form */}
        <div className="material-surface px-4 sm:px-6 lg:px-8 py-[7px] mt-6">
          {success ? (
            <div className="py-6 text-center space-y-3">
              <div className="flex justify-center">
                <CheckCircle className="w-10 h-10 text-primary" />
              </div>
              <p className="field-text text-on-surface font-medium">
                Password reset successful
              </p>
              <p className="field-text text-on-surface-variant">
                Redirecting you to the sign in page...
              </p>
            </div>
          ) : expired ? (
            <div className="py-6 text-center space-y-4">
              <div className="flex justify-center">
                <AlertTriangle className="w-10 h-10 text-destructive" />
              </div>
              <p className="field-text text-on-surface font-medium">
                Reset link has expired
              </p>
              <p className="field-text text-on-surface-variant">
                Password reset links are valid for 1 hour. Please request a new one.
              </p>
              <Link to="/forgot-password">
                <Button className="material-button-primary modern-button-primary w-full py-3 mobile-touch mt-2">
                  Request New Reset Link
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="password" className="field-text font-medium text-on-surface">
                  New Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter new password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setValidationError(''); }}
                  className="modern-input"
                  disabled={submitting}
                  required
                  minLength={6}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="confirmPassword" className="field-text font-medium text-on-surface">
                  Confirm New Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setValidationError(''); }}
                  className="modern-input"
                  disabled={submitting}
                  required
                  minLength={6}
                />
              </div>

              {validationError && (
                <p className="field-text text-destructive font-medium">{validationError}</p>
              )}

              <div className="pt-1">
                <Button type="submit" disabled={submitting} className="material-button-primary modern-button-primary w-full py-3 mobile-touch">
                  {submitting ? 'Resetting...' : 'Reset Password'}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Back to login */}
        {!success && (
          <div className="mt-6 text-center">
            <Link to="/auth" className="inline-flex items-center gap-1.5 field-text font-bold text-primary hover:text-primary/80 transition-colors underline">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sign In
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
