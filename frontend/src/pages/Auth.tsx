import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, Link } from 'react-router-dom';
import logoImg from '@/assets/1prompt-logo.png';

const Auth = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { user, signIn, loading: authLoading, role, userClientId } = useAuth();
  const { toast } = useToast();

  if (!authLoading && user) {
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
        </div>

      </div>
    </div>
  );
};

export default Auth;
