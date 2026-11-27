import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import { APPROVER_ROLES, ROLE_LABELS, useAuth } from '../auth/AuthContext.jsx';
import Icon from './Icon.jsx';

const COLLAPSE_KEY = 'expenseflow.sidebar.collapsed';

const PAGE_TITLES = [
  [/^\/dashboard/, 'Dashboard'],
  [/^\/claims\/new/, 'New claim'],
  [/^\/claims\/\d+\/edit/, 'Edit claim'],
  [/^\/claims\/\d+/, 'Claim details'],
  [/^\/claims/, 'My claims'],
  [/^\/approvals/, 'Approvals'],
  [/^\/payouts/, 'Payouts'],
  [/^\/policy-rules/, 'Policy rules'],
];

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

export default function Layout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(null);
  const isApprover = hasRole(...APPROVER_ROLES);

  // Close the mobile drawer on navigation.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Live count of claims waiting for this approver (refreshed on navigation).
  useEffect(() => {
    if (!isApprover) return undefined;
    let cancelled = false;
    apiGet('/approvals')
      .then((list) => { if (!cancelled) setPendingCount(list.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isApprover, location.pathname]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  }

  function onLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const sections = [
    { title: 'Overview', links: [{ to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }] },
    {
      title: 'Expenses',
      links: [
        { to: '/claims', label: 'My claims', icon: 'receipt', end: true },
        { to: '/claims/new', label: 'New claim', icon: 'plus' },
      ],
    },
  ];
  if (isApprover) {
    const review = [{
      to: '/approvals',
      label: hasRole('FINANCE_AUDITOR') ? 'Audit queue' : 'Approvals',
      icon: 'inbox',
      count: pendingCount,
    }];
    if (hasRole('FINANCE_HEAD')) review.push({ to: '/payouts', label: 'Payouts', icon: 'wallet' });
    sections.push({ title: 'Review', links: review });
  }
  sections.push({ title: 'Governance', links: [{ to: '/policy-rules', label: 'Policy rules', icon: 'shield' }] });

  let pageTitle = (PAGE_TITLES.find(([re]) => re.test(location.pathname)) || [null, 'ExpenseFlow'])[1];
  if (pageTitle === 'Approvals' && hasRole('FINANCE_AUDITOR')) pageTitle = 'Audit queue';

  return (
    <div className={`app-shell ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <Link to="/dashboard" className="brand">
            <span className="brand-mark">₹</span>
            <span className="brand-name">ExpenseFlow</span>
          </Link>
          <button type="button" className="icon-btn sidebar-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {sections.map((s) => (
            <div key={s.title} className="nav-section">
              <div className="nav-section-title">{s.title}</div>
              {s.links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className="nav-link" title={collapsed ? l.label : undefined}>
                  <Icon name={l.icon} size={18} />
                  <span className="nav-label">{l.label}</span>
                  {l.count > 0 && <span className="nav-count">{l.count > 99 ? '99+' : l.count}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="profile">
            <span className="avatar">{initials(user.fullName)}</span>
            <div className="profile-text">
              <strong>{user.fullName}</strong>
              <span>{ROLE_LABELS[user.role] || user.role}{user.departmentName ? ` · ${user.departmentName}` : ''}</span>
            </div>
          </div>
          <button type="button" className="nav-link logout-link" onClick={onLogout} title={collapsed ? 'Log out' : undefined}>
            <Icon name="logout" size={18} />
            <span className="nav-label">Log out</span>
          </button>
          <button type="button" className="collapse-btn" onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
          </button>
        </div>
      </aside>

      <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />

      <div className="app-main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Icon name="menu" size={20} />
          </button>
          <div className="topbar-title">{pageTitle}</div>
          <div className="topbar-actions">
            {location.pathname !== '/claims/new' && (
              <Link to="/claims/new" className="btn btn-primary btn-sm topbar-cta">
                <Icon name="plus" size={16} /> <span>New claim</span>
              </Link>
            )}
            <span className="avatar avatar-sm" title={`${user.fullName} · ${ROLE_LABELS[user.role]}`}>
              {initials(user.fullName)}
            </span>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
