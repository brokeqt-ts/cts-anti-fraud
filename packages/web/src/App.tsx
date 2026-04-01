import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/layout.js';
import { DashboardPage } from './pages/dashboard.js';
import { AccountsPage } from './pages/accounts.js';
import { AccountDetailPage } from './pages/account-detail.js';
import { BansPage } from './pages/bans.js';
import { BanDetailPage } from './pages/ban-detail.js';
import { BanFormPage } from './pages/ban-form.js';
import { SettingsPage } from './pages/settings.js';
import { DomainsPage } from './pages/domains.js';
import { CtsIntegrationPage } from './pages/cts-integration.js';
import { AnalyticsPage } from './pages/analytics.js';
import { AssessmentPage } from './pages/assessment.js';
import { AIAnalysisPage } from './pages/ai-analysis.js';
import { BestPracticesPage } from './pages/best-practices.js';
import { LoginPage } from './pages/login.js';
import { NotificationsPage } from './pages/notifications.js';
import { UsersPage } from './pages/users.js';
import { AdminNotificationsPage } from './pages/admin-notifications.js';
import { AuditLogPage } from './pages/audit-log.js';
import { useAuth } from './contexts/auth-context.js';
import { Loader2 } from 'lucide-react';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-base)' }}>
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export function App() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show login page at /login without layout
  // Show loading spinner while checking auth
  return (
    <Routes>
      <Route
        path="/login"
        element={
          isLoading ? (
            <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-base)' }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : isAuthenticated ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage />
          )
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/" element={<DashboardPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="/accounts/:id" element={<AccountDetailPage />} />
        <Route path="/bans" element={<BansPage />} />
        <Route path="/bans/new" element={<BanFormPage />} />
        <Route path="/bans/:id" element={<BanDetailPage />} />
        <Route path="/domains" element={<DomainsPage />} />
        <Route path="/cts" element={<CtsIntegrationPage />} />
        <Route path="/assessment" element={<AssessmentPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/ai-analysis" element={<AIAnalysisPage />} />
        <Route path="/best-practices" element={<BestPracticesPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route
          path="/users"
          element={
            <RequireAdmin>
              <UsersPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/notifications"
          element={
            <RequireAdmin>
              <AdminNotificationsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <RequireAdmin>
              <AuditLogPage />
            </RequireAdmin>
          }
        />
      </Route>
    </Routes>
  );
}
