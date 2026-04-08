import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

const SUPABASE_CONFIGURED = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

interface DemoUser {
  id: string;
  name: string;
  email: string;
}

interface DemoAuthContextType {
  user: DemoUser | null;
  isAuthenticated: boolean;
  /** False until the first Supabase getSession completes (avoid protected-route flash). True when not using Supabase. */
  authReady: boolean;
  signIn: (email: string, password: string) => void;
  createAccount: (name: string, email: string, password: string) => void;
  signOut: () => void;
}

const DemoAuthContext = createContext<DemoAuthContextType | undefined>(undefined);

export const useDemoAuth = () => {
  const context = useContext(DemoAuthContext);
  if (context === undefined) {
    throw new Error('useDemoAuth must be used within a DemoAuthProvider');
  }
  return context;
};

function demoUserFromSupabaseUser(user: User): DemoUser {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const nameFromMeta = meta?.name;
  const name =
    typeof nameFromMeta === 'string' && nameFromMeta.trim()
      ? nameFromMeta.trim()
      : (user.email?.split('@')[0] ?? 'User');
  return {
    id: user.id,
    name,
    email: user.email ?? '',
  };
}

interface DemoAuthProviderProps {
  children: ReactNode;
}

export const DemoAuthProvider: React.FC<DemoAuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<DemoUser | null>(null);
  const [authReady, setAuthReady] = useState(!SUPABASE_CONFIGURED);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;

    const applySession = (session: { user: User } | null) => {
      setUser(session?.user ? demoUserFromSupabaseUser(session.user) : null);
    };

    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        applySession(session);
      } finally {
        setAuthReady(true);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = (email: string, password: string) => {
    if (SUPABASE_CONFIGURED) {
      console.warn(
        '[DemoAuth] signIn() is ignored when Supabase is configured — use Auth page or supabase.auth.signInWithPassword',
      );
      return;
    }
    void password;
    setUser({
      id: DEMO_USER_ID,
      name: 'Demo User',
      email,
    });
  };

  const createAccount = (name: string, email: string, password: string) => {
    if (SUPABASE_CONFIGURED) {
      console.warn(
        '[DemoAuth] createAccount() is ignored when Supabase is configured — use Auth page or supabase.auth.signUp',
      );
      return;
    }
    void password;
    setUser({
      id: DEMO_USER_ID,
      name,
      email,
    });
  };

  const signOut = () => {
    setUser(null);
  };

  const value: DemoAuthContextType = {
    user,
    isAuthenticated: !!user,
    authReady,
    signIn,
    createAccount,
    signOut,
  };

  return <DemoAuthContext.Provider value={value}>{children}</DemoAuthContext.Provider>;
};

export { SUPABASE_CONFIGURED };
