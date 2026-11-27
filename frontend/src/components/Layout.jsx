import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { APPROVER_ROLES, ROLE_LABELS, useAuth } from '../auth/AuthContext.jsx';

export default function Layout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();

  const links = [
    { to: '/claims', label: 'My Claims', end: true },
    { to: '/claims/new', label: 'New Claim' },
  ];
  if (hasRole(...APPROVER_ROLES)) {
    links.push({ to: '/approvals', label: 'Approvals' }, { to: '/dashboard', label: 'Dashboard' });
  }
  if (hasRole('FINANCE_HEAD')) links.push({ to: '/payouts', label: 'Payouts' });
  links.push({ to: '/policy-rules', label: 'Policy Rules' });

  function onLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/claims" className="brand">ExpenseFlow</Link>
          <nav className="nav" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>
            ))}
          </nav>
          <div className="userbox">
            <span>
              <strong>{user.fullName}</strong>{' '}
              <span className="muted">· {ROLE_LABELS[user.role] || user.role}</span>
            </span>
            <button type="button" className="btn-small" onClick={onLogout}>Log out</button>
          </div>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </>
  );
}
