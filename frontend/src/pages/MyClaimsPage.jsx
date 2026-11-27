import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate } from '../components/Money.jsx';
import Icon from '../components/Icon.jsx';
import Pagination, { usePagination } from '../components/Pagination.jsx';
import { EmptyState, ErrorBanner, Loading } from '../components/PageState.jsx';

const STATUS_GROUPS = [
  { key: 'ALL', label: 'All', match: () => true },
  { key: 'DRAFT', label: 'Drafts', match: (s) => s === 'DRAFT' || s === 'CLARIFICATION_REQUESTED' },
  { key: 'PENDING', label: 'In review', match: (s) => s.startsWith('PENDING_') },
  { key: 'APPROVED', label: 'Approved', match: (s) => s === 'APPROVED' },
  { key: 'PAID', label: 'Paid', match: (s) => s === 'PAID' },
  { key: 'REJECTED', label: 'Rejected', match: (s) => s === 'REJECTED' },
];

export default function MyClaimsPage() {
  const navigate = useNavigate();
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('ALL');

  const load = useCallback(() => {
    setError(null);
    setClaims(null);
    apiGet('/claims').then(setClaims).catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c = {};
    STATUS_GROUPS.forEach((g) => { c[g.key] = (claims || []).filter((x) => g.match(x.status)).length; });
    return c;
  }, [claims]);

  const filtered = useMemo(() => {
    if (!claims) return null;
    const q = search.trim().toLowerCase();
    const g = STATUS_GROUPS.find((x) => x.key === group);
    return claims.filter((c) => g.match(c.status)
      && (!q || c.claimNumber.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)));
  }, [claims, search, group]);

  const pager = usePagination(filtered, 15);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Expenses</div>
          <h1>My claims</h1>
          <p>Track every claim from draft to payout.</p>
        </div>
        <Link to="/claims/new" className="btn btn-primary"><Icon name="plus" size={16} /> New claim</Link>
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {!claims && !error && <Loading />}
      {claims && claims.length === 0 && (
        <div className="card">
          <EmptyState icon="receipt" title="No claims yet"
            action={<Link to="/claims/new" className="btn btn-primary"><Icon name="plus" size={16} /> Create your first claim</Link>}>
            Create a claim, add your expenses and receipts, and submit it for approval.
          </EmptyState>
        </div>
      )}
      {claims && claims.length > 0 && (
        <div className="card card-flush">
          <div className="toolbar">
            <div className="field field-search">
              <label htmlFor="q">Search</label>
              <div className="input-icon">
                <Icon name="search" size={16} />
                <input id="q" type="search" placeholder="Claim number or title" value={search}
                  onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="segmented" role="group" aria-label="Filter by status">
              {STATUS_GROUPS.map((g) => (
                <button key={g.key} type="button" className={group === g.key ? 'active' : ''} onClick={() => setGroup(g.key)}>
                  {g.label} <span className="muted">{counts[g.key]}</span>
                </button>
              ))}
            </div>
          </div>
          {filtered.length === 0 ? (
            <EmptyState icon="search" title="No matching claims">Try a different search or status filter.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Status</th>
                    <th className="hide-mobile">Submitted</th>
                    <th className="num">Total</th>
                    <th className="num hide-mobile">Approved</th>
                    <th className="hide-mobile" aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {pager.pageItems.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => navigate(`/claims/${c.id}`)}>
                      <td>
                        <Link to={`/claims/${c.id}`} className="claim-link" onClick={(e) => e.stopPropagation()}>{c.claimNumber}</Link>
                        {c.hasViolations && <span className="flag" title="Has policy flags"><Icon name="alert" size={14} /></span>}
                        <div className="cell-sub">{c.title}</div>
                      </td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="nowrap hide-mobile">{formatDate(c.submittedAt)}</td>
                      <td className="num strong"><Money value={c.totalAmount} /></td>
                      <td className="num hide-mobile"><Money value={c.approvedAmount} /></td>
                      <td className="hide-mobile"><Icon name="chevronRight" size={16} className="row-arrow" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination {...pager} />
        </div>
      )}
    </>
  );
}
