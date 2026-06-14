import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Navigate, Link } from 'react-router-dom';
import logoImg from '@/assets/bfd-logo.png';

const Auth = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // MFA (TOTP) login challenge. mfaStep gates the redirect so a logged-in-at-aal1
  // user is held on the code screen until they elevate to aal2.
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaChallengeId, setMfaChallengeId] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const { user, signIn, loading: authLoading, role, userClientId } = useAuth();
  const { toast } = useToast();

  // Do NOT redirect while a sign-in is in flight or an MFA challenge is pending,
  // otherwise the aal1 session would navigate away before the code is entered.
  if (!authLoading && user && !submitting && !mfaStep) {
    if (role === 'client' && userClientId) {
      return <Navigate to={`/client/${userClientId}/analytics/chatbot/dashboard`} replace />;
    }
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await signIn(email, password);
      if (result.error) {
        toast({
          title: "Sign in failed",
          description: result.error.message,
          variant: "destructive"
        });
        return;
      }
      // If the user has a verified TOTP factor, Supabase reports nextLevel aal2.
      // Issue a challenge and hold them on the code screen.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.find((f) => f.status === 'verified') || factors?.totp?.[0];
        if (totp) {
          const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
          if (!chErr && ch) {
            setMfaFactorId(totp.id);
            setMfaChallengeId(ch.id);
            setMfaStep(true);
          }
        }
      }
      // No MFA required -> the user state drives the redirect above once submitting clears.
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

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: mfaChallengeId,
        code: mfaCode.trim(),
      });
      if (error) {
        toast({ title: "Verification failed", description: error.message, variant: "destructive" });
        return;
      }
      // Now at aal2 — clear the gate so the redirect fires.
      setMfaStep(false);
      setMfaCode('');
    } catch {
      toast({ title: "An error occurred", description: "Please try again", variant: "destructive" });
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
          <h1 className="mobile-heading-2 text-on-surface font-semibold">BFD-setter</h1>
          <p className="text-on-surface-variant mt-1 field-text">
            Sign in to manage your Building Flow setters
          </p>
        </div>

        {/* Auth Form */}
        <div className="material-surface px-4 sm:px-6 lg:px-8 py-[7px] mt-6">
          {mfaStep ? (
            <form onSubmit={handleMfaVerify} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="mfa_login_code" className="field-text font-medium text-on-surface">
                  Authentication code
                </Label>
                <p className="text-on-surface-variant field-text text-sm">Enter the 6-digit code from your authenticator app.</p>
                <Input
                  id="mfa_login_code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  className="modern-input"
                  disabled={submitting}
                  required
                  autoFocus
                />
              </div>
              <div className="pt-1">
                <Button type="submit" disabled={submitting || mfaCode.length < 6} className="material-button-primary modern-button-primary w-full py-3 mobile-touch">
                  {submitting ? 'Verifying...' : 'Verify'}
                </Button>
              </div>
            </form>
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

            <div className="space-y-1">
              <Label htmlFor="password" className="field-text font-medium text-on-surface">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="modern-input"
                disabled={submitting}
                required
                minLength={6}
              />
              <div className="flex justify-end">
                <Link to="/forgot-password" className="field-text text-primary hover:text-primary/80 transition-colors underline font-medium">
                  Forgot Password?
                </Link>
              </div>
            </div>

            <div className="pt-1">
              <Button type="submit" disabled={submitting} className="material-button-primary modern-button-primary w-full py-3 mobile-touch">
                {submitting ? 'Processing...' : 'Sign In'}
              </Button>
            </div>
          </form>
          )}
        </div>

      </div>
    </div>
  );
};

export default Auth;
