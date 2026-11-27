import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, query } from '../api/client.js';
import { ROLE_LABELS, useAuth } from '../auth/AuthContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate } from '../components/Money.jsx';
import { ErrorBanner, Loading } from '../components/PageState.jsx';

const STATUS_OPTIONS = [
  { value: '', label: 'All pending' },
  { value: 'PENDING_MANAGER', label: 'Pending · Manager' },
  { value: 'PENDING_AUDITOR', label: 'Pending · Auditor' },
  { value: 'PENDING_FINANCE_HEAD', label: 'Pending · Finance Head' },
];
const EMPTY_FILTERS = { status: '', departmentId: '', minAmount: '', flaggedOnly: false };

export default function ApprovalsPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const canBulk = hasRole('FINANCE_AUDITOR', 'FINANCE_HEAD');

  const [departments, setDepartments] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [claims, setClaims] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkResult, setBulkResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet('/departments').then(setDepartments).catch(() => setDepartments([]));
  }, []);

  const load = useCallback(() => {
    setError(null);
    setClaims(null);
    setSelected(new Set());
    apiGet(`/approvals${query(applied)}`).then(setClaims).catch((e) => setError(e.message));
  }, [applied]);

  useEffect(load, [load]);

  function applyFilters(e) {
    e.preventDefault();
    setBulkResult(null);
    setApplied({ ...filters });
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setBulkResult(null);
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allSelected = claims && claims.length > 0 && selected.size === claims.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(claims.map((c) => c.id)));
  }

  async function bulkApprove() {
    if (!window.confirm(`Approve ${selected.size} selected claim(s)? Flagged claims will be skipped by the server.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost('/approvals/bulk-approve', { claimIds: [...selected] });
      setBulkResult(result);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const claimNumberById = Object.fromEntries((claims || []).map((c) => [c.id, c.claimNumber]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Approvals</h1>
          <p className="muted small">Claims waiting for your decision (including as a delegate), oldest first.</p>
        </div>
        {canBulk && (
          <button type="button" className="btn-primary" disabled={busy || selected.size === 0} onClick={bulkApprove}>
            {busy ? 'Approving…' : `Bulk approve (${selected.size})`}
          </button>
        )}
      </div>

      <form className="filters" onSubmit={applyFilters}>
        <div className="field">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-dept">Department</label>
          <select id="f-dept" value={filters.departmentId}
            onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-min">Min amount (₹)</label>
          <input id="f-min" type="number" inputMode="decimal" min="0" step="0.01" value={filters.minAmount}
            onChange={(e) => setFilters({ ...filters, minAmount: e.target.value })} />
        </div>
        <div className="field check-field">
          <label className="check" htmlFor="f-flag">
            <input id="f-flag" type="checkbox" checked={filters.flaggedOnly}
              onChange={(e) => setFilters({ ...filters, flaggedOnly: e.target.checked })} />
            Flagged only
          </label>
        </div>
        <div className="actions">
          <button type="submit" className="btn-primary">Apply</button>
          <button type="button" onClick={resetFilters}>Reset</button>
        </div>
      </form>

      {bulkResult && (
        <div className={`banner ${bulkResult.skipped.length ? 'banner-warn' : 'banner-success'}`} role="status">
          <div className="banner-body">
            <strong>{bulkResult.approved.length} approved, {bulkResult.skipped.length} skipped.</strong>
            {bulkResult.skipped.length > 0 && (
              <ul>
                {bulkResult.skipped.map((s) => (
                  <li key={s.id}>
                    <Link to={`/claims/${s.id}`}>{claimNumberById[s.id] || `Claim #${s.id}`}</Link>: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="btn-small" onClick={() => setBulkResult(null)}>Dismiss</button>
        </div>
      )}

      <ErrorBanner error={error} onRetry={load} />
      {!claims && !error && <Loading />}
      {claims && claims.length === 0 && (
        <div className="card"><p>Nothing waiting for you. 🎉</p><p className="muted small">Try clearing the filters.</p></div>
      )}
      {claims && claims.length > 0 && (
        <>
          <p className="small muted">{claims.length} claim(s){claims.length >= 500 ? ' (showing the first 500)' : ''}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {canBulk && (
                    <th className="check-cell">
                      <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} />
                    </th>
                  )}
                  <th>Claim</th>
                  <th>Employee</th>
                  <th className="hide-mobile">Department</th>
                  <th>Status</th>
                  <th className="hide-mobile">Submitted</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => navigate(`/claims/${c.id}`)}>
                    {canBulk && (
                      <td className="check-cell" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${c.claimNumber}`}
                          checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                      </td>
                    )}
                    <td>
                      <Link to={`/claims/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.claimNumber}</Link>
                      {c.hasViolations && <span className="flag" title="Policy flags"> ⚠</span>}
                      <div className="small muted">{c.title}</div>
                      {c.sampleAudit && <span className="badge b-violet">Sample audit</span>}
                    </td>
                    <td>{c.employeeName}</td>
                    <td className="hide-mobile">{c.departmentName || '—'}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="nowrap hide-mobile">{formatDate(c.submittedAt)}</td>
                    <td className="num">
                      <Money value={c.approvedAmount} />
                      {Number(c.approvedAmount) !== Number(c.totalAmount) && (
                        <div className="small muted">of <Money value={c.totalAmount} /></div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <DelegationPanel />
    </>
  );
}

function DelegationPanel() {
  const { user } = useAuth();
  const [delegations, setDelegations] = useState(null);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ delegateId: '', startDate: '', endDate: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiGet('/delegations').then(setDelegations).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    apiGet('/users').then((list) => setUsers(list.filter((u) => u.id !== user.id))).catch(() => setUsers([]));
  }, [load, user.id]);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost('/delegations', { ...form, delegateId: Number(form.delegateId) });
      setForm({ delegateId: '', startDate: '', endDate: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(d) {
    if (!window.confirm(`Remove delegation to ${d.delegateName}?`)) return;
    setBusy(true);
    try {
      await apiDelete(`/delegations/${d.id}`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2>Delegation while on leave</h2>
      <p className="small muted">Let a colleague approve on your behalf for a date range.</p>
      <ErrorBanner error={error} />

      {delegations && delegations.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <thead>
              <tr><th>Delegate</th><th>From</th><th>To</th><th>State</th><th /></tr>
            </thead>
            <tbody>
              {delegations.map((d) => (
                <tr key={d.id}>
                  <td>{d.delegateName}</td>
                  <td className="nowrap">{formatDate(d.startDate)}</td>
                  <td className="nowrap">{formatDate(d.endDate)}</td>
                  <td>{d.active ? <span className="badge b-green">Active</span> : <span className="badge b-grey">Inactive</span>}</td>
                  <td><button type="button" className="btn-small btn-danger" disabled={busy} onClick={() => remove(d)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {delegations && delegations.length === 0 && <p className="muted small">You have no delegations.</p>}

      <form className="filters" onSubmit={create}>
        <div className="field">
          <label htmlFor="d-user">Delegate</label>
          <select id="d-user" required value={form.delegateId} onChange={(e) => setForm({ ...form, delegateId: e.target.value })}>
            <option value="">Choose a colleague…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} · {ROLE_LABELS[u.role] || u.role}{u.departmentName ? ` · ${u.departmentName}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="d-start">From</label>
          <input id="d-start" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="d-end">To</label>
          <input id="d-end" type="date" required min={form.startDate || undefined} value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>Add delegation</button>
      </form>
    </section>
  );
}
