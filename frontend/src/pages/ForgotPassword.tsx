import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import logoImg from '@/assets/1prompt-logo.png';
import { ArrowLeft, Mail, ShieldAlert } from 'lucide-react';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notAuthorized, setNotAuthorized] = useState(false);
  const { user, loading: authLoading, role, userClientId } = useAuth();

  if (!authLoading && user && role === 'agency') {
    return <Navigate to="/" replace />;
  }
  if (!authLoading && user && role === 'client' && userClientId) {
    return <Navigate to={`/client/${userClientId}/analytics/chatbot/dashboard`} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setNotAuthorized(false);
    try {
      // Check eligibility on the backend
      const { data, error } = await supabase.functions.invoke('check-reset-eligibility', {
        body: { email },
      });

      if (error || !data?.allowed) {
        setNotAuthorized(true);
        setSubmitting(false);
        return;
      }

      // Allowed — send the reset email
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // Silently ignore — always show success for security
    } finally {
      setSubmitting(false);
      if (!notAuthorized) {
        setSubmitted(true);
      }
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
          <h1 className="mobile-heading-2 text-on-surface font-semibold">Reset Password</h1>
          <p className="text-on-surface-variant mt-1 field-text">
            Enter your email address and we'll send you a reset link
          </p>
        </div>

        {/* Form */}
        <div className="material-surface px-4 sm:px-6 lg:px-8 py-[7px] mt-6">
          {notAuthorized ? (
            <div className="py-6 text-center space-y-3">
              <div className="flex justify-center">
                <ShieldAlert className="w-10 h-10 text-destructive" />
              </div>
              <p className="field-text text-on-surface font-medium">
                Not Authorized
              </p>
              <p className="field-text text-on-surface-variant">
                You are not authorized to reset your password. Please contact your administrator to update your password.
              </p>
            </div>
          ) : submitted ? (
            <div className="py-6 text-center space-y-3">
              <div className="flex justify-center">
                <Mail className="w-10 h-10 text-primary" />
              </div>
              <p className="field-text text-on-surface font-medium">
                Password reset link sent
              </p>
              <p className="field-text text-on-surface-variant">
                If an account exists for <span className="font-semibold text-on-surface">{email}</span>, you will receive a password reset email shortly.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="email" className="field-text font-medium text-on-surface">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="modern-input"
                  disabled={submitting}
                  required
                />
              </div>

              <div className="pt-1">
                <Button type="submit" disabled={submitting} className="material-button-primary modern-button-primary w-full py-3 mobile-touch">
                  {submitting ? 'Checking...' : 'Send Reset Link'}
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Back to login */}
        <div className="mt-6 text-center">
          <Link to="/auth" className="inline-flex items-center gap-1.5 field-text font-bold text-primary hover:text-primary/80 transition-colors underline">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
