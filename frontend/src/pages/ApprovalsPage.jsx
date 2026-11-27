import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, query } from '../api/client.js';
import { ROLE_LABELS, useAuth } from '../auth/AuthContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate } from '../components/Money.jsx';
import Icon from '../components/Icon.jsx';
import Pagination, { usePagination } from '../components/Pagination.jsx';
import { useToast } from '../components/ToastContext.jsx';
import { useConfirm } from '../components/ConfirmContext.jsx';
import { initials } from '../components/Layout.jsx';
import { EmptyState, ErrorBanner, Loading } from '../components/PageState.jsx';

const STATUS_OPTIONS = [
  { value: '', label: 'All pending' },
  { value: 'PENDING_MANAGER', label: 'Pending · Manager' },
  { value: 'PENDING_AUDITOR', label: 'Pending · Auditor' },
  { value: 'PENDING_FINANCE_HEAD', label: 'Pending · Finance Head' },
];
const EMPTY_FILTERS = { status: '', departmentId: '', minAmount: '', flaggedOnly: false };

function daysWaiting(submittedAt) {
  if (!submittedAt) return null;
  return Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86400000);
}

export default function ApprovalsPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const canBulk = hasRole('FINANCE_AUDITOR', 'FINANCE_HEAD');
  const isAuditor = hasRole('FINANCE_AUDITOR');

  const [departments, setDepartments] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [minAmountDraft, setMinAmountDraft] = useState('');
  const [search, setSearch] = useState('');
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
    apiGet(`/approvals${query(filters)}`).then(setClaims).catch((e) => setError(e.message));
  }, [filters]);

  useEffect(load, [load]);

  function setFilter(name, value) {
    setBulkResult(null);
    setFilters((f) => ({ ...f, [name]: value }));
  }

  function applyMinAmount() {
    if (minAmountDraft !== filters.minAmount) setFilter('minAmount', minAmountDraft);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setMinAmountDraft('');
    setSearch('');
    setBulkResult(null);
  }

  const visible = useMemo(() => {
    if (!claims) return null;
    const q = search.trim().toLowerCase();
    if (!q) return claims;
    return claims.filter((c) => [c.claimNumber, c.title, c.employeeName, c.departmentName]
      .some((v) => v && v.toLowerCase().includes(q)));
  }, [claims, search]);

  const pager = usePagination(visible, 20);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allSelected = visible && visible.length > 0 && visible.every((c) => selected.has(c.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visible.map((c) => c.id)));
  }

  const selectedTotal = (claims || []).filter((c) => selected.has(c.id))
    .reduce((s, c) => s + Number(c.approvedAmount || 0), 0);
  const flaggedSelected = (claims || []).filter((c) => selected.has(c.id) && c.hasViolations).length;

  async function bulkApprove() {
    const ok = await confirm({
      title: `Approve ${selected.size} claim(s)?`,
      message: flaggedSelected
        ? `${flaggedSelected} of the selected claims have policy flags and will be skipped by the server. They need individual review.`
        : 'Each claim is checked again on the server before it is approved.',
      confirmLabel: 'Approve selected',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await apiPost('/approvals/bulk-approve', { claimIds: [...selected] });
      const numbers = Object.fromEntries((claims || []).map((c) => [c.id, c.claimNumber]));
      setBulkResult({ ...result, numbers });
      toast.success(`${result.approved.length} approved, ${result.skipped.length} skipped.`, 'Bulk approval complete');
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const activeFilterCount = [filters.status, filters.departmentId, filters.minAmount, filters.flaggedOnly].filter(Boolean).length;
  const flaggedCount = (claims || []).filter((c) => c.hasViolations).length;
  const queueTotal = (claims || []).reduce((s, c) => s + Number(c.approvedAmount || 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Review</div>
          <h1>{isAuditor ? 'Audit queue' : 'Approvals'}</h1>
          <p>Claims waiting for your decision (including as a delegate), oldest first.</p>
        </div>
        {claims && (
          <div className="actions">
            <span className="badge badge-accent">{claims.length} waiting</span>
            {flaggedCount > 0 && <span className="badge badge-warning"><Icon name="alert" size={12} /> {flaggedCount} flagged</span>}
            <span className="badge badge-neutral"><Money value={queueTotal} /></span>
          </div>
        )}
      </div>

      {bulkResult && (
        <div className={`alert ${bulkResult.skipped.length ? 'alert-warning' : 'alert-success'}`} role="status">
          <Icon name={bulkResult.skipped.length ? 'alert' : 'checkCircle'} size={18} />
          <div className="alert-body">
            <strong>{bulkResult.approved.length} approved, {bulkResult.skipped.length} skipped.</strong>
            {bulkResult.skipped.length > 0 && (
              <ul>
                {bulkResult.skipped.map((s) => (
                  <li key={s.id}>
                    <Link to={`/claims/${s.id}`}>{bulkResult.numbers[s.id] || `Claim #${s.id}`}</Link>: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setBulkResult(null)}><Icon name="x" size={16} /></button>
        </div>
      )}

      <div className="card card-flush">
        <div className="toolbar">
          <div className="field field-search">
            <label htmlFor="f-q">Search</label>
            <div className="input-icon">
              <Icon name="search" size={16} />
              <input id="f-q" type="search" placeholder="Claim, employee, department" value={search}
                onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-dept">Department</label>
            <select id="f-dept" value={filters.departmentId} onChange={(e) => setFilter('departmentId', e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-min">Min amount</label>
            <div className="input-prefix">
              <span>₹</span>
              <input id="f-min" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0" value={minAmountDraft}
                onChange={(e) => setMinAmountDraft(e.target.value)} onBlur={applyMinAmount}
                onKeyDown={(e) => { if (e.key === 'Enter') applyMinAmount(); }} />
            </div>
          </div>
          <div className="field field-check">
            <label className="check" htmlFor="f-flag">
              <input id="f-flag" type="checkbox" checked={filters.flaggedOnly}
                onChange={(e) => setFilter('flaggedOnly', e.target.checked)} />
              Flagged only
            </label>
          </div>
          {(activeFilterCount > 0 || search) && (
            <button type="button" className="btn-ghost btn-sm" onClick={resetFilters} style={{ alignSelf: 'center', marginTop: 18 }}>
              <Icon name="x" size={14} /> Clear
            </button>
          )}
        </div>

        {canBulk && selected.size > 0 && (
          <div className="bulk-bar">
            <strong>{selected.size} selected</strong>
            <span>· <Money value={selectedTotal} /></span>
            {flaggedSelected > 0 && <span className="text-warning" style={{ color: '#fbbf24' }}>· {flaggedSelected} flagged will be skipped</span>}
            <span className="spacer" />
            <button type="button" className="btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={bulkApprove}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={14} />} Approve selected
            </button>
          </div>
        )}

        <ErrorBanner error={error} onRetry={load} />
        {!claims && !error && <Loading rows={8} bare />}
        {visible && visible.length === 0 && (
          <EmptyState icon="checkCircle" title={claims.length ? 'No matching claims' : 'You are all caught up'}>
            {claims.length ? 'Try a different search.' : 'Nothing is waiting for your decision right now.'}
          </EmptyState>
        )}
        {visible && visible.length > 0 && (
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
                  <th>Status</th>
                  <th className="hide-mobile">Waiting</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((c) => {
                  const days = daysWaiting(c.submittedAt);
                  return (
                    <tr key={c.id} className={`clickable ${selected.has(c.id) ? 'is-checked' : ''}`} onClick={() => navigate(`/claims/${c.id}`)}>
                      {canBulk && (
                        <td className="check-cell" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`Select ${c.claimNumber}`}
                            checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                        </td>
                      )}
                      <td>
                        <Link to={`/claims/${c.id}`} className="claim-link" onClick={(e) => e.stopPropagation()}>{c.claimNumber}</Link>
                        {c.hasViolations && <span className="flag" title="Policy flags"><Icon name="alert" size={14} /></span>}
                        {c.sampleAudit && <> <span className="badge badge-violet">Sample audit</span></>}
                        <div className="cell-sub">{c.title}</div>
                      </td>
                      <td>
                        <div className="cell-person">
                          <span className="avatar hide-mobile">{initials(c.employeeName)}</span>
                          <div><div className="strong">{c.employeeName}</div><div className="cell-sub">{c.departmentName || '—'}</div></div>
                        </div>
                      </td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="nowrap hide-mobile">
                        <span className={days >= 3 ? 'text-danger strong' : ''}>{days === null ? '—' : days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`}</span>
                        <div className="cell-sub">{formatDate(c.submittedAt)}</div>
                      </td>
                      <td className="num">
                        <span className="strong"><Money value={c.approvedAmount} /></span>
                        {Number(c.approvedAmount) !== Number(c.totalAmount) && (
                          <div className="cell-sub">of <Money value={c.totalAmount} /></div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination {...pager} />
      </div>

      <DelegationPanel />
    </>
  );
}

function DelegationPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [delegations, setDelegations] = useState(null);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ delegateId: '', startDate: '', endDate: '' });
  const [formError, setFormError] = useState(null);
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
    if (!form.delegateId || !form.startDate || !form.endDate) { setFormError('Choose a colleague and a date range.'); return; }
    if (form.endDate < form.startDate) { setFormError('The end date must be on or after the start date.'); return; }
    setBusy(true);
    setFormError(null);
    try {
      await apiPost('/delegations', { ...form, delegateId: Number(form.delegateId) });
      setForm({ delegateId: '', startDate: '', endDate: '' });
      toast.success('Delegation added.');
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(d) {
    const ok = await confirm({
      title: 'Remove delegation?', message: `${d.delegateName} will no longer be able to approve on your behalf.`,
      confirmLabel: 'Remove', tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiDelete(`/delegations/${d.id}`);
      toast.success('Delegation removed.');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div className="card-head">
        <div>
          <h2>Delegation while on leave</h2>
          <p>Let a colleague approve on your behalf for a date range. Their actions are recorded as “on behalf of” you.</p>
        </div>
      </div>
      <ErrorBanner error={error} onRetry={load} />

      {delegations && delegations.length > 0 && (
        <ul className="list-rows" style={{ marginBottom: 16 }}>
          {delegations.map((d) => (
            <li key={d.id}>
              <span className="avatar">{initials(d.delegateName)}</span>
              <div className="grow">
                <div className="title">{d.delegateName}</div>
                <div className="cell-sub"><Icon name="calendar" size={12} /> {formatDate(d.startDate)} → {formatDate(d.endDate)}</div>
              </div>
              {d.active ? <span className="badge badge-success badge-dot">Active</span> : <span className="badge badge-neutral">Scheduled / ended</span>}
              <button type="button" className="icon-btn" aria-label={`Remove delegation to ${d.delegateName}`} disabled={busy} onClick={() => remove(d)}>
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {delegations && delegations.length === 0 && <p className="muted small">You have no delegations.</p>}

      <form className="form-grid" onSubmit={create} noValidate style={{ alignItems: 'end' }}>
        <div className="field span-2">
          <label htmlFor="d-user">Delegate</label>
          <select id="d-user" value={form.delegateId} onChange={(e) => { setForm({ ...form, delegateId: e.target.value }); setFormError(null); }}>
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
          <input id="d-start" type="date" value={form.startDate} onChange={(e) => { setForm({ ...form, startDate: e.target.value }); setFormError(null); }} />
        </div>
        <div className="field">
          <label htmlFor="d-end">To</label>
          <input id="d-end" type="date" min={form.startDate || undefined} value={form.endDate}
            onChange={(e) => { setForm({ ...form, endDate: e.target.value }); setFormError(null); }} />
        </div>
        {formError && <div className="field-error span-2" style={{ marginTop: -6, marginBottom: 12 }}><Icon name="alert" size={13} /> {formError}</div>}
        <div className="span-2">
          <button type="submit" className="btn-primary" disabled={busy}><Icon name="plus" size={16} /> Add delegation</button>
        </div>
      </form>
    </section>
  );
}
