import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import logoImg from '@/assets/bfd-logo.png';

const Register = () => {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { user, signUp, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  if (!authLoading && user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure both passwords are the same.",
        variant: "destructive"
      });
      return;
    }

    setSubmitting(true);
    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const result = await signUp(email, password, fullName);
      if (result.error) {
        let description = result.error.message;
        if (result.error.message?.includes('rate limit')) {
          description = 'Too many attempts. Please wait a few minutes and try again.';
        } else if (result.error.message?.includes('invalid')) {
          description = 'This email address could not be verified. Please use a valid, real email address.';
        }
        toast({
          title: "Registration failed",
          description,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Verification code sent!",
          description: "Please check your email for a 6-digit verification code.",
        });
        navigate('/verify', { state: { email } });
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
        <div className="text-center mb-3 sm:mb-4">
          <div className="flex items-center justify-center mb-4 sm:mb-6">
            <img src={logoImg} alt="BFD-setter Logo" className="h-12 sm:h-16 w-auto" />
          </div>
          <h1 className="mobile-heading-2 text-on-surface font-semibold">Create Your Account</h1>
          <p className="text-on-surface-variant mt-1 field-text">
            Register for free to get started
          </p>
        </div>

        <div className="material-surface p-4 sm:p-6 lg:p-8 mt-2">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="firstName" className="field-text font-medium text-on-surface">
                  First Name
                </Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder="First name"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="modern-input"
                  disabled={submitting}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lastName" className="field-text font-medium text-on-surface">
                  Last Name
                </Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Last name"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="modern-input"
                  disabled={submitting}
                  required
                />
              </div>
            </div>

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
                placeholder="Create a password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="modern-input"
                disabled={submitting}
                required
                minLength={6}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="confirmPassword" className="field-text font-medium text-on-surface">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="modern-input"
                disabled={submitting}
                required
                minLength={6}
              />
            </div>

            <div className="pt-2">
              <Button type="submit" disabled={submitting} className="material-button-primary modern-button-primary w-full py-3 mobile-touch">
                {submitting ? 'Creating Account...' : 'Create Free Account'}
              </Button>
            </div>
          </form>

          <div className="mt-4 sm:mt-6 text-center">
            <p className="text-on-surface-variant field-text">
              Already have an account?{' '}
              <Link to="/auth" className="font-bold text-primary hover:text-primary/80 transition-colors underline">
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
