import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { APPROVER_ROLES, useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import MyClaimsPage from './pages/MyClaimsPage.jsx';
import ClaimFormPage from './pages/ClaimFormPage.jsx';
import ClaimDetailPage from './pages/ClaimDetailPage.jsx';
import ApprovalsPage from './pages/ApprovalsPage.jsx';
import PayoutPage from './pages/PayoutPage.jsx';
import PolicyRulesPage from './pages/PolicyRulesPage.jsx';

// Recharts is only needed on the dashboard, so load it on demand to keep the main bundle small.
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));

function RequireAuth({ roles, children }) {
  const { user, ready, hasRole } = useAuth();
  const location = useLocation();
  if (!ready) return <p className="page-state">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !hasRole(...roles)) {
    return <div className="banner banner-error">You do not have access to this page.</div>;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/claims" replace />} />
        <Route path="/claims" element={<MyClaimsPage />} />
        <Route path="/claims/new" element={<ClaimFormPage />} />
        <Route path="/claims/:id" element={<ClaimDetailPage />} />
        <Route path="/claims/:id/edit" element={<ClaimFormPage />} />
        <Route path="/policy-rules" element={<PolicyRulesPage />} />
        <Route path="/approvals" element={<RequireAuth roles={APPROVER_ROLES}><ApprovalsPage /></RequireAuth>} />
        <Route path="/dashboard" element={<RequireAuth roles={APPROVER_ROLES}><Suspense fallback={<p className="page-state">Loading…</p>}><DashboardPage /></Suspense></RequireAuth>} />
        <Route path="/payouts" element={<RequireAuth roles={['FINANCE_HEAD']}><PayoutPage /></RequireAuth>} />
        <Route path="*" element={<div className="banner banner-error">Page not found.</div>} />
      </Route>
    </Routes>
  );
}
