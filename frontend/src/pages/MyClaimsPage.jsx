import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate } from '../components/Money.jsx';
import { ErrorBanner, Loading } from '../components/PageState.jsx';

export default function MyClaimsPage() {
  const navigate = useNavigate();
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    setClaims(null);
    apiGet('/claims').then(setClaims).catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My Claims</h1>
          <p className="muted small">Your expense claims, newest first.</p>
        </div>
        <Link to="/claims/new" className="btn btn-primary">+ New claim</Link>
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {!claims && !error && <Loading />}
      {claims && claims.length === 0 && (
        <div className="card">
          <p>No claims yet.</p>
          <Link to="/claims/new" className="btn btn-primary">Create your first claim</Link>
        </div>
      )}
      {claims && claims.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Claim</th>
                <th>Title</th>
                <th>Status</th>
                <th className="hide-mobile">Submitted</th>
                <th className="num">Total</th>
                <th className="num hide-mobile">Approved</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/claims/${c.id}`)}>
                  <td className="nowrap"><Link to={`/claims/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.claimNumber}</Link></td>
                  <td>{c.title} {c.hasViolations && <span className="flag" title="Has policy flags">⚠</span>}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="nowrap hide-mobile">{formatDate(c.submittedAt)}</td>
                  <td className="num"><Money value={c.totalAmount} /></td>
                  <td className="num hide-mobile"><Money value={c.approvedAmount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
