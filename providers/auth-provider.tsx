"use client";

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { createSupabaseBrowserClient } from '@/lib/database/client';

interface AuthUser {
  id: string;
  email?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  useEffect(() => {
    if (!supabase) {
      const timer = window.setTimeout(() => {
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    let isMounted = true;

    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      setUser(session?.user ? { id: session.user.id, email: session.user.email } : null);
      setLoading(false);
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return;
      }

      setUser(session?.user ? { id: session.user.id, email: session.user.email } : null);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      return { error: new Error('Supabase is not configured.') };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
      router.replace('/dashboard');
    }
    return { error };
  }, [router, supabase]);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    if (!supabase) {
      return { error: new Error('Supabase is not configured.') };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName ?? email,
        },
      },
    });

    if (!error && data.user) {
      await supabase.from('users').upsert(
        {
          id: data.user.id,
          email: data.user.email ?? email,
          display_name: displayName ?? null,
          avatar_url: data.user.user_metadata?.avatar_url ?? null,
          is_active: true,
        },
        { onConflict: 'id' }
      );

      await supabase.from('profiles').upsert(
        {
          user_id: data.user.id,
          first_name: displayName ?? null,
          last_name: null,
          locale: 'en',
        },
        { onConflict: 'user_id' }
      );
    }

    return { error };
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setUser(null);
    router.replace('/auth/sign-in');
  }, [router, supabase]);

  const resetPassword = useCallback(async (email: string) => {
    if (!supabase) {
      return { error: new Error('Supabase is not configured.') };
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    return { error };
  }, [supabase]);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) {
      return { error: new Error('Supabase is not configured.') };
    }

    const { error } = await supabase.auth.updateUser({ password });
    return { error };
  }, [supabase]);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, resetPassword, updatePassword }),
    [user, loading, signIn, signUp, signOut, resetPassword, updatePassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
