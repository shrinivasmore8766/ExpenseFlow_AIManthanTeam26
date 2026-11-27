import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import Icon from '../components/Icon.jsx';

// Seeded demo accounts (see backend/CLAUDE.md §4.9). Password is the seeded demo password.
const DEMO_USERS = [
  { label: 'Employee', username: 'employee', hint: 'Submit claims', initials: 'EM' },
  { label: 'Manager', username: 'manager', hint: 'Approve team', initials: 'MG' },
  { label: 'Auditor', username: 'auditor', hint: 'Review queue', initials: 'AU' },
  { label: 'Finance Head', username: 'financehead', hint: 'Payouts & policy', initials: 'FH' },
];
const DEMO_PASSWORD = 'Demo@123';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const target = location.state?.from && location.state.from !== '/' ? location.state.from : '/dashboard';
  if (user) return <Navigate to={target} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function pick(demo) {
    setUsername(demo.username);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="login-page">
      <section className="login-hero" aria-hidden="true">
        <div className="brand"><span className="brand-mark">₹</span><span className="brand-name">ExpenseFlow</span></div>
        <div>
          <h2>Expense claims, approved in hours, not weeks.</h2>
          <p>Capture receipts on the go, let the policy engine pre-check every line, and move claims from submission to payout with a full audit trail.</p>
          <ul className="feature-list">
            <li><Icon name="sparkle" size={18} /><span>Policy engine checks limits, duplicates and missing receipts instantly</span></li>
            <li><Icon name="inbox" size={18} /><span>Multi-level approvals with delegation and bulk review</span></li>
            <li><Icon name="bank" size={18} /><span>One-click payout batches with a bank-ready CSV</span></li>
          </ul>
        </div>
        <p className="small">Built for the AI Manthan hackathon · Team 26</p>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="brand"><span className="brand-mark">₹</span><span className="brand-name">ExpenseFlow</span></div>
          <h1>Welcome back</h1>
          <p>Sign in to submit and approve expense claims.</p>

          <div className="demo-users" role="group" aria-label="Demo users">
            {DEMO_USERS.map((d) => (
              <button key={d.username} type="button" className={`demo-user ${username === d.username ? 'active' : ''}`}
                onClick={() => pick(d)}>
                <span className="avatar">{d.initials}</span>
                <span>{d.label}<small>{d.hint}</small></span>
              </button>
            ))}
          </div>
          <div className="divider">or sign in with your account</div>

          {error && (
            <div className="alert alert-error" role="alert">
              <Icon name="xCircle" size={18} /><span className="alert-body">{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="username">Username</label>
              <input id="username" autoComplete="username" value={username} placeholder="e.g. employee"
                onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? <><span className="spinner" /> Signing in…</> : <>Sign in <Icon name="arrowRight" size={16} /></>}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
