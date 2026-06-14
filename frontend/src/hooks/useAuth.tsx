
import { useContext } from 'react';
import { AuthContext } from '@/providers/AuthProvider';
import type { UserRole } from '@/providers/AuthProvider';

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    console.warn('AuthProvider is missing. Wrap your app with <AuthProvider>.');
    return {
      user: null,
      session: null,
      loading: true,
      role: null as UserRole,
      userClientId: null as string | null,
      mfaRequired: false,
      signUp: async () => ({ error: new Error('AuthProvider missing') as any }),
      signIn: async () => ({ error: new Error('AuthProvider missing') as any }),
      signOut: async () => ({ error: new Error('AuthProvider missing') as any }),
    } as any;
  }
  return ctx;
};
