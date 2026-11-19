import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { auth, configureAuthPersistence, googleAuthProvider } from '../lib/firebase.ts';
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
  signInWithGoogle: (rememberMe?: boolean) => Promise<void>;
  signInWithEmail: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName: string,
    rememberMe?: boolean
  ) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  lockScreen: () => void;
  unlockWithGoogle: () => Promise<void>;
  unlockWithShiftPin: (pin: string) => Promise<void>;
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

  const signInWithGoogle = useCallback(async (rememberMe = false) => {
    await configureAuthPersistence(rememberMe);
    await signInWithPopup(auth, googleAuthProvider);
    setIsLocked(false);
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string, rememberMe = false) => {
      await configureAuthPersistence(rememberMe);
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setIsLocked(false);
    },
    []
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName: string, rememberMe = false) => {
      await configureAuthPersistence(rememberMe);
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (displayName.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim() });
      }
      setIsLocked(false);
    },
    []
  );

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
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
    queryClient.removeQueries({ queryKey: ['billing-overview'] });
  }, [queryClient]);

  const unlockWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleAuthProvider);
    setIsLocked(false);
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const unlockWithShiftPin = useCallback(
    async (pin: string) => {
      const targetTenant = session?.workspace?.tenantId ?? activeTenantId;
      if (!targetTenant) {
        throw new Error('No active workspace context for PIN unlock. Please sign in with Google.');
      }
      await apiClient.verifyShiftPin(targetTenant, pin);
      setIsLocked(false);
      await queryClient.invalidateQueries();
    },
    [activeTenantId, queryClient, session?.workspace?.tenantId]
  );

  const switchTenant = useCallback(
    (tenantId: string) => {
      queryClient.removeQueries({ queryKey: ['today'] });
      queryClient.removeQueries({ queryKey: ['team'] });
      queryClient.removeQueries({ queryKey: ['audit'] });
      queryClient.removeQueries({ queryKey: ['billing-overview'] });
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
        signInWithEmail,
        signUpWithEmail,
        resetPassword,
        signOut,
        lockScreen,
        unlockWithGoogle,
        unlockWithShiftPin,
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

