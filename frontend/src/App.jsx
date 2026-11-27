import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { APPROVER_ROLES, useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import { EmptyState, Loading } from './components/PageState.jsx';
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
  if (!ready) return <div className="boot-screen"><span className="brand-mark">₹</span></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !hasRole(...roles)) {
    return <EmptyState icon="shield" title="You do not have access to this page">This area is limited to other roles.</EmptyState>;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Suspense fallback={<Loading variant="cards" />}><DashboardPage /></Suspense>} />
        <Route path="/claims" element={<MyClaimsPage />} />
        <Route path="/claims/new" element={<ClaimFormPage />} />
        <Route path="/claims/:id" element={<ClaimDetailPage />} />
        <Route path="/claims/:id/edit" element={<ClaimFormPage />} />
        <Route path="/policy-rules" element={<PolicyRulesPage />} />
        <Route path="/approvals" element={<RequireAuth roles={APPROVER_ROLES}><ApprovalsPage /></RequireAuth>} />
        <Route path="/payouts" element={<RequireAuth roles={['FINANCE_HEAD']}><PayoutPage /></RequireAuth>} />
        <Route path="*" element={<EmptyState icon="search" title="Page not found">The page you are looking for does not exist.</EmptyState>} />
      </Route>
    </Routes>
  );
}
