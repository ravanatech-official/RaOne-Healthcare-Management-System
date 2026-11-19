import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './locales/i18n.ts';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { AppShell } from './components/AppShell.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { OnboardingPage } from './pages/OnboardingPage.tsx';
import { HomeAssistantPage } from './pages/HomeAssistantPage.tsx';
import { TodayBoardPage } from './pages/TodayBoardPage.tsx';
import { AuditPage, TeamPage } from './pages/TeamAndAuditPage.tsx';
import { PharmacyCataloguePage } from './pages/PharmacyCataloguePage.tsx';
import { PharmacyPosPage } from './pages/PharmacyPosPage.tsx';
import { PharmacyReceivingPage } from './pages/PharmacyReceivingPage.tsx';
import { PharmacyStockPage } from './pages/PharmacyStockPage.tsx';
import { PlatformModulesPage } from './pages/PlatformModulesPage.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});

function AuthenticatedRoutes() {
  const { authReady, firebaseUser, isLocked, session, sessionLoading, sessionError, refetchSession } =
    useAuth();

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-sm text-slate-600">
        Loading session...
      </div>
    );
  }

  if (!firebaseUser) {
    return <SignInPage mode="signin" />;
  }

  if (isLocked) {
    return <SignInPage mode="locked" />;
  }

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-sm text-slate-600">
        Verifying workspace access...
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full space-y-4">
          <h1 className="text-lg font-semibold text-slate-900">Unable to verify workspace access</h1>
          <p className="text-sm text-slate-600">{sessionError.message}</p>
          <button
            type="button"
            onClick={() => refetchSession()}
            className="min-h-[44px] px-4 bg-teal-700 text-white text-sm font-medium rounded-lg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!session || session.requiresOnboarding || !session.workspace) {
    return <OnboardingPage />;
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<HomeAssistantPage />} />
        <Route path="/today" element={<TodayBoardPage />} />
        <Route path="/pharmacy/pos" element={<PharmacyPosPage />} />
        <Route path="/pharmacy/catalogue" element={<PharmacyCataloguePage />} />
        <Route path="/pharmacy/receiving" element={<PharmacyReceivingPage />} />
        <Route path="/pharmacy/stock" element={<PharmacyStockPage />} />
        <Route path="/modules" element={<PlatformModulesPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AuthenticatedRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
