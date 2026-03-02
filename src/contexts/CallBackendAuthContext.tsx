import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

const STORAGE_KEY_TOKEN = 'holdless_call_backend_token';
const STORAGE_KEY_REFRESH = 'holdless_call_backend_refresh';

interface CallBackendAuthContextType {
  /** JWT to send as Bearer on /api/chat and /api/call/:id. null if not signed in. From Supabase session or call-backend sign-in. */
  callBackendToken: string | null;
  /** Set token from Supabase session (call after signInWithPassword so token is available before navigate). */
  setTokenFromSupabaseSession: (session: { access_token: string } | null) => void;
  /** Sign in to the call backend (proxy: POST /api/auth/call-backend/signin). Fallback when not using Supabase. */
  signInToCallBackend: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  /** Refresh the JWT using refresh token. Call when API returns 401. */
  refreshCallBackendToken: () => Promise<boolean>;
  /** Clear stored token (e.g. on app sign-out). */
  signOutCallBackend: () => void;
  /** True when we have a token (calls are available). */
  isCallBackendReady: boolean;
}

const CallBackendAuthContext = createContext<CallBackendAuthContextType | undefined>(undefined);

export function useCallBackendAuth() {
  const ctx = useContext(CallBackendAuthContext);
  return ctx;
}

function loadStored(): { token: string | null; refresh: string | null } {
  try {
    const token = localStorage.getItem(STORAGE_KEY_TOKEN);
    const refresh = localStorage.getItem(STORAGE_KEY_REFRESH);
    return { token, refresh };
  } catch {
    return { token: null, refresh: null };
  }
}

function saveStored(token: string | null, refresh: string | null) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY_TOKEN, token);
    else localStorage.removeItem(STORAGE_KEY_TOKEN);
    if (refresh) localStorage.setItem(STORAGE_KEY_REFRESH, refresh);
    else localStorage.removeItem(STORAGE_KEY_REFRESH);
  } catch {}
}

export function CallBackendAuthProvider({ children }: { children: ReactNode }) {
  /** Option 1: token from Supabase session (production). Sent as Authorization: Bearer on /api/chat and /api/call/:id. */
  const [supabaseToken, setSupabaseToken] = useState<string | null>(null);
  /** Fallback: token from call-backend sign-in when Supabase is not used. */
  const [storedToken, setStoredToken] = useState<string | null>(() => loadStored().token);
  const [refreshToken, setRefreshToken] = useState<string | null>(() => loadStored().refresh);

  // Use Supabase session.access_token when user is signed in (Option 1 — Send Token From Frontend)
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSupabaseToken(session?.access_token ?? null);
    };
    getSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseToken(session?.access_token ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signInToCallBackend = useCallback(async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/call-backend/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: data.error || data.message || 'Sign-in failed' };
      }
      const newToken = data.token ?? data.access_token ?? null;
      const newRefresh = data.refreshToken ?? data.refresh_token ?? null;
      if (newToken) {
        setStoredToken(newToken);
        setRefreshToken(newRefresh);
        saveStored(newToken, newRefresh);
        return { ok: true };
      }
      return { ok: false, error: 'No token in response' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      return { ok: false, error: msg };
    }
  }, []);

  const refreshCallBackendToken = useCallback(async () => {
    const refresh = refreshToken ?? loadStored().refresh;
    if (!refresh) return false;
    try {
      const res = await fetch('/api/auth/call-backend/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return false;
      const newToken = data.token ?? data.access_token ?? null;
      const newRefresh = data.refreshToken ?? data.refresh_token ?? refresh;
      if (newToken) {
        setStoredToken(newToken);
        setRefreshToken(newRefresh);
        saveStored(newToken, newRefresh);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [refreshToken]);

  const signOutCallBackend = useCallback(() => {
    setSupabaseToken(null);
    setStoredToken(null);
    setRefreshToken(null);
    saveStored(null, null);
  }, []);

  const setTokenFromSupabaseSession = useCallback((session: { access_token: string } | null) => {
    setSupabaseToken(session?.access_token ?? null);
  }, []);

  // Prefer Supabase token (Option 1); fallback to stored token from call-backend sign-in
  const callBackendToken = supabaseToken ?? storedToken;

  const value: CallBackendAuthContextType = {
    callBackendToken,
    setTokenFromSupabaseSession,
    signInToCallBackend,
    refreshCallBackendToken,
    signOutCallBackend,
    isCallBackendReady: !!callBackendToken,
  };

  return (
    <CallBackendAuthContext.Provider value={value}>
      {children}
    </CallBackendAuthContext.Provider>
  );
}
