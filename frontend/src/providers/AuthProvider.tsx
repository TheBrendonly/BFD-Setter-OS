import React, { createContext, useEffect, useMemo, useState } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type UserRole = 'agency' | 'client' | null;

export type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: UserRole;
  userClientId: string | null;
  // True when the session is at aal1 but a verified TOTP factor makes aal2 the
  // required level — i.e. the user signed in with a password but has NOT yet passed
  // the MFA challenge. Route guards bounce such sessions back to /auth so a reload or
  // a direct deep link can't bypass the TOTP step.
  mfaRequired: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
};

export const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>(null);
  const [userClientId, setUserClientId] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);

  // Recompute whether the current session still owes an MFA challenge. aal1 + a
  // verified factor (nextLevel=aal2) means "password done, TOTP pending".
  const refreshMfaRequired = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error || !data) { setMfaRequired(false); return; }
      setMfaRequired(data.currentLevel === 'aal1' && data.nextLevel === 'aal2');
    } catch {
      setMfaRequired(false);
    }
  };

  const fetchUserRole = async (userId: string) => {
    try {
      // Fetch role from user_roles table
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (roleError) {
        // Transient/query error. Do NOT assume a privileged role — previously this
        // silently defaulted to 'agency', so any read hiccup granted full access.
        // Leave the role null; the user can retry.
        console.error('Error fetching role:', roleError);
        setRole(null);
        setUserClientId(null);
        return;
      }

      if (!roleData) {
        // No role row exists. Every real account is assigned 'agency' or 'client'
        // at creation, so a missing row means an unprovisioned/invalid account.
        // Least privilege: do NOT grant a default role — sign the user out.
        console.warn('No role assigned to user; signing out.');
        setRole(null);
        setUserClientId(null);
        toast.error('Your account has no role assigned. Please contact support.');
        await supabase.auth.signOut({ scope: 'global' });
        return;
      }

      const resolvedRole = roleData.role as UserRole;
      setRole(resolvedRole);

      // Fetch client_id from profiles
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('client_id')
        .eq('id', userId)
        .single();

      if (profileError) console.error('Error fetching profile:', profileError);
      const clientId = profileError ? null : (profileData?.client_id || null);
      setUserClientId(clientId);

      // A 'client' user with no client_id cannot be routed to a workspace and must
      // not fall through to agency-level surfaces. Treat as unprovisioned. (An
      // 'agency' user legitimately has a null client_id, so this only gates clients.)
      if (resolvedRole === 'client' && !clientId) {
        console.warn('Client user has no client_id; signing out.');
        toast.error('Your account is not fully set up. Please contact support.');
        await supabase.auth.signOut({ scope: 'global' });
      }
    } catch (err) {
      console.error('Unexpected error fetching role:', err);
      setRole(null);
      setUserClientId(null);
    }
  };

  useEffect(() => {
    let mounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setRole(null);
        setUserClientId(null);
        setMfaRequired(false);
        setLoading(false);
      } else if (event === 'MFA_CHALLENGE_VERIFIED') {
        // TOTP passed — re-evaluate (should clear the gate to aal2).
        setSession(session);
        setUser(session?.user ?? null);
        void refreshMfaRequired();
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          void refreshMfaRequired();
          // Defer to avoid Supabase auth deadlock
          setTimeout(() => {
            if (mounted) {
              fetchUserRole(session.user.id).finally(() => {
                if (mounted) setLoading(false);
              });
            }
          }, 0);
        } else {
          setMfaRequired(false);
          setLoading(false);
        }
      }
    });

    const initializeSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Session initialization error:', error);
          setSession(null);
          setUser(null);
        } else if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          if (session?.user) {
            await refreshMfaRequired();
            await fetchUserRole(session.user.id);
          }
        }
      } catch (error) {
        console.error('Unexpected session error:', error);
        setSession(null);
        setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initializeSession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { full_name: fullName }
      }
    });
    return { error } as { error: Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error } as { error: Error | null };
  };

  const signOut = async () => {
    try {
      // Clear any stale auth tokens left behind by dead/old Supabase projects.
      localStorage.removeItem('sb-qfbhcixkxzivpmxlciot-auth-token');
      localStorage.removeItem('sb-awzlcmdomhtyqjabzvnn-auth-token');
      await supabase.auth.signOut({ scope: 'global' }).catch(() => {});
      setSession(null);
      setUser(null);
      setRole(null);
      setUserClientId(null);
      return { error: null };
    } catch (err) {
      console.error('Unexpected sign out error:', err);
      setSession(null);
      setUser(null);
      setRole(null);
      setUserClientId(null);
      return { error: null };
    }
  };

  const value = useMemo<AuthContextType>(() => ({
    user,
    session,
    loading,
    role,
    userClientId,
    mfaRequired,
    signUp,
    signIn,
    signOut,
  }), [user, session, loading, role, userClientId, mfaRequired]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
