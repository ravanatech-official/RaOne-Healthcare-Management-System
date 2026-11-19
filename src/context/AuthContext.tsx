import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiClient } from '../lib/api-client.ts';
import type { SessionContextResponse, SupportedLocale } from '../contracts/api.ts';

interface AuthContextValue {
  firebaseUser: User | null;
  authReady: boolean;
  isLocked: boolean;
  activeTenantId: string | undefined;
  session: SessionContextResponse | undefined;
  sessionLoading: boolean;
  sessionError: Error | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  lockScreen: () => void;
  unlockWithGoogle: () => Promise<void>;
  switchTenant: (tenantId: string) => void;
  changeLanguage: (locale: SupportedLocale) => Promise<void>;
  refetchSession: () => Promise<unknown>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [activeTenantId, setActiveTenantId] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setActiveTenantId(undefined);
        setIsLocked(false);
        queryClient.clear();
      }
    });
    return () => unsub();
  }, [queryClient]);

  const {
    data: session,
    isLoading: sessionLoading,
    error: sessionError,
    refetch: refetchSession,
  } = useQuery({
    queryKey: ['session-context', firebaseUser?.uid ?? 'anon', activeTenantId ?? 'default'],
    queryFn: () => apiClient.getSessionContext(activeTenantId),
    enabled: Boolean(firebaseUser && !isLocked),
    retry: false,
  });

  useEffect(() => {
    if (session?.user.preferredLocale && i18n.language !== session.user.preferredLocale) {
      i18n.changeLanguage(session.user.preferredLocale);
    }
  }, [session?.user.preferredLocale, i18n]);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleAuthProvider);
    setIsLocked(false);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setActiveTenantId(undefined);
    setIsLocked(false);
    queryClient.clear();
  }, [queryClient]);

  const lockScreen = useCallback(() => {
    setIsLocked(true);
    queryClient.removeQueries({ queryKey: ['today'] });
    queryClient.removeQueries({ queryKey: ['team'] });
    queryClient.removeQueries({ queryKey: ['audit'] });
  }, [queryClient]);

  const unlockWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleAuthProvider);
    setIsLocked(false);
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const switchTenant = useCallback(
    (tenantId: string) => {
      // Clear previous tenant query cache on switch (v4 §35, SEC-02)
      queryClient.removeQueries({ queryKey: ['today'] });
      queryClient.removeQueries({ queryKey: ['team'] });
      queryClient.removeQueries({ queryKey: ['audit'] });
      setActiveTenantId(tenantId);
    },
    [queryClient]
  );

  const changeLanguage = useCallback(
    async (locale: SupportedLocale) => {
      await i18n.changeLanguage(locale);
      if (firebaseUser && !isLocked) {
        await apiClient.updateLocale(locale).catch(() => undefined);
      }
    },
    [firebaseUser, isLocked, i18n]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        authReady,
        isLocked,
        activeTenantId: session?.workspace?.tenantId ?? activeTenantId,
        session,
        sessionLoading,
        sessionError: sessionError as Error | null,
        signInWithGoogle,
        signOut,
        lockScreen,
        unlockWithGoogle,
        switchTenant,
        changeLanguage,
        refetchSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
