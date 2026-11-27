import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

// Seeded demo accounts (see backend/CLAUDE.md §4.9). Password is the seeded demo password.
const DEMO_USERS = [
  { label: 'Employee', username: 'employee' },
  { label: 'Manager', username: 'manager' },
  { label: 'Auditor', username: 'auditor' },
  { label: 'Finance Head', username: 'financehead' },
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

  if (user) return <Navigate to={location.state?.from || '/claims'} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      navigate(location.state?.from || '/claims', { replace: true });
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
    <div className="login-wrap">
      <div className="card login-card">
        <h1>ExpenseFlow</h1>
        <p className="muted">Sign in to submit and approve expense claims.</p>

        <p className="small muted" style={{ marginBottom: 6 }}>Demo users</p>
        <div className="demo-users">
          {DEMO_USERS.map((d) => (
            <button key={d.username} type="button" onClick={() => pick(d)}>{d.label}</button>
          ))}
        </div>

        {error && <div className="banner banner-error" role="alert">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" autoComplete="username" value={username}
              onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
