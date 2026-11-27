import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate, formatMoney } from '../components/Money.jsx';
import ViolationList, { OutcomeBadge } from '../components/ViolationList.jsx';
import { ErrorBanner, Loading } from '../components/PageState.jsx';

const CATEGORIES = [
  { value: 'MEAL', label: 'Meal' },
  { value: 'HOTEL', label: 'Hotel' },
  { value: 'LOCAL_CAB', label: 'Local cab' },
  { value: 'TRAVEL', label: 'Travel (air / rail / bus)' },
  { value: 'OTHER', label: 'Other' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const RECEIPT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emptyLine = () => ({
  category: 'MEAL', expenseDate: today(), amount: '', vendor: '', city: '', nights: '', description: '',
});

function toRequest(form) {
  const hotel = form.category === 'HOTEL';
  return {
    category: form.category,
    expenseDate: form.expenseDate,
    amount: String(form.amount).trim(),
    vendor: form.vendor.trim(),
    city: hotel ? form.city.trim() : null,
    nights: hotel && form.nights !== '' ? Number(form.nights) : null,
    description: form.description.trim() || null,
  };
}

function fromLine(line) {
  return {
    category: line.category,
    expenseDate: line.expenseDate,
    amount: String(line.amount),
    vendor: line.vendor || '',
    city: line.city || '',
    nights: line.nights ?? '',
    description: line.description || '',
  };
}

export default function ClaimFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [claim, setClaim] = useState(null);
  const [rules, setRules] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [lineForm, setLineForm] = useState(emptyLine);
  const [editingLineId, setEditingLineId] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    apiGet('/policy-rules').then(setRules).catch(() => setRules([]));
    if (isNew) return;
    setClaim(null);
    apiGet(`/claims/${id}`)
      .then((c) => { setClaim(c); setTitle(c.title); })
      .catch((e) => setLoadError(e.status === 404 ? 'Claim not found.' : e.message));
  }, [id, isNew]);

  useEffect(load, [load]);

  /** Runs one API call that returns ClaimDetail, then re-renders from the response. */
  async function run(fn, successMessage) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (result && result.id) setClaim(result);
      if (successMessage) setNotice(successMessage);
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createDraft(e) {
    e.preventDefault();
    const created = await run(() => apiPost('/claims', { title: title.trim() }));
    if (created) navigate(`/claims/${created.id}/edit`, { replace: true });
  }

  function saveTitle(e) {
    e.preventDefault();
    run(() => apiPut(`/claims/${id}`, { title: title.trim() }), 'Title saved.');
  }

  async function saveLine(e) {
    e.preventDefault();
    const body = toRequest(lineForm);
    const result = await run(
      () => (editingLineId
        ? apiPut(`/claims/${id}/lines/${editingLineId}`, body)
        : apiPost(`/claims/${id}/lines`, body)),
      editingLineId ? 'Line updated.' : 'Line added. Attach a receipt below if you have one.',
    );
    if (result) {
      setLineForm(emptyLine());
      setEditingLineId(null);
    }
  }

  function editLine(line) {
    setEditingLineId(line.id);
    setLineForm(fromLine(line));
    setNotice(null);
    document.getElementById('line-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit() {
    setEditingLineId(null);
    setLineForm(emptyLine());
  }

  function deleteLine(line) {
    if (!window.confirm(`Delete the ${CATEGORY_LABEL[line.category] || line.category} line for ${formatMoney(line.amount)}?`)) return;
    if (editingLineId === line.id) cancelEdit();
    run(() => apiDelete(`/claims/${id}/lines/${line.id}`), 'Line deleted.');
  }

  function uploadReceipt(line, file, input) {
    if (!file) return;
    if (!RECEIPT_TYPES.includes(file.type)) {
      setError('Receipt must be a PDF, JPEG or PNG file.');
      input.value = '';
      return;
    }
    if (file.size > MAX_RECEIPT_BYTES) {
      setError('Receipt must be 5 MB or smaller.');
      input.value = '';
      return;
    }
    run(() => apiUpload(`/claims/${id}/lines/${line.id}/receipt`, file), 'Receipt uploaded.')
      .finally(() => { input.value = ''; });
  }

  async function submit() {
    if (!window.confirm('Submit this claim for approval? You cannot edit it afterwards unless it is sent back.')) return;
    const result = await run(() => apiPost(`/claims/${id}/submit`));
    if (result) navigate(`/claims/${id}`, { state: { justSubmitted: true } });
  }

  async function deleteDraft() {
    if (!window.confirm('Delete this draft claim permanently?')) return;
    setBusy(true);
    try {
      await apiDelete(`/claims/${id}`);
      navigate('/claims', { replace: true });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  // ---------- new claim: title only ----------
  if (isNew) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>New claim</h1>
            <p className="muted small">Start with a title. You can then add expense lines and receipts.</p>
          </div>
        </div>
        <ErrorBanner error={error} />
        <form className="card" onSubmit={createDraft} style={{ maxWidth: 560 }}>
          <div className="field">
            <label htmlFor="title">Claim title</label>
            <input id="title" value={title} maxLength={200} required autoFocus
              placeholder="e.g. Client visit — Mumbai, Nov 2026"
              onChange={(e) => setTitle(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !title.trim()}>
            {busy ? 'Creating…' : 'Create draft'}
          </button>
        </form>
      </>
    );
  }

  if (loadError) return <ErrorBanner error={loadError} onRetry={load} />;
  if (!claim) return <Loading />;

  const actions = claim.allowedActions || [];
  if (!actions.includes('EDIT')) {
    return (
      <div className="card">
        <p>This claim can no longer be edited (status: <StatusBadge status={claim.status} />).</p>
        <Link to={`/claims/${claim.id}`} className="btn">View claim</Link>
      </div>
    );
  }

  const sendBack = [...(claim.history || [])].reverse().find((h) => h.action === 'SEND_BACK');
  const activeRules = rules.filter((r) => r.active);
  const categoryRules = activeRules.filter((r) => r.category === lineForm.category);
  const receiptRule = activeRules.find((r) => r.code === 'RECEIPT_REQUIRED');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{claim.claimNumber} <StatusBadge status={claim.status} /></h1>
          <p className="muted small">Total <strong><Money value={claim.totalAmount} /></strong> · {claim.lines.length} line(s)</p>
        </div>
        <div className="actions">
          <Link to={`/claims/${claim.id}`} className="btn">View</Link>
          {actions.includes('DELETE') && (
            <button type="button" className="btn-danger" onClick={deleteDraft} disabled={busy}>Delete draft</button>
          )}
          {actions.includes('SUBMIT') && (
            <button type="button" className="btn-primary" onClick={submit} disabled={busy || claim.lines.length === 0}>
              {claim.status === 'CLARIFICATION_REQUESTED' ? 'Resubmit' : 'Submit for approval'}
            </button>
          )}
        </div>
      </div>

      {sendBack && claim.status === 'CLARIFICATION_REQUESTED' && (
        <div className="banner banner-info">
          <div className="banner-body">
            <strong>{sendBack.actorName} asked for clarification:</strong> {sendBack.comment}
          </div>
        </div>
      )}
      <ErrorBanner error={error} />
      {notice && <div className="banner banner-success" role="status">{notice}</div>}

      <form className="card" onSubmit={saveTitle}>
        <div className="field">
          <label htmlFor="title">Claim title</label>
          <input id="title" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
        </div>
        <button type="submit" disabled={busy || !title.trim() || title.trim() === claim.title}>Save title</button>
      </form>

      <section className="card">
        <h2>Expense lines</h2>
        {claim.lines.length === 0 && <p className="muted">No lines yet. Add your first expense below.</p>}
        <div className="line-list">
          {claim.lines.map((line) => (
            <div key={line.id} className="line-card">
              <div className="line-card-head">
                <div>
                  <strong>{CATEGORY_LABEL[line.category] || line.category}</strong>{' '}
                  <span className="muted">· {line.vendor} · {formatDate(line.expenseDate)}</span>
                  {line.category === 'HOTEL' && <span className="muted"> · {line.city}, {line.nights} night(s)</span>}
                </div>
                <span className="line-card-amount"><Money value={line.amount} /></span>
              </div>
              {line.description && <div className="small muted">{line.description}</div>}
              {line.outcome && <div style={{ marginTop: 6 }}><OutcomeBadge outcome={line.outcome} /></div>}
              <ViolationList violations={line.violations} />
              <div className="receipt-row">
                {line.hasReceipt
                  ? <span className="badge b-green">Receipt attached</span>
                  : <span className="badge b-grey">No receipt</span>}
                <label className="small" htmlFor={`receipt-${line.id}`} style={{ margin: 0 }}>
                  {line.hasReceipt ? 'Replace receipt:' : 'Attach receipt:'}
                </label>
                <input id={`receipt-${line.id}`} type="file" accept="image/*,application/pdf" capture="environment"
                  disabled={busy} onChange={(e) => uploadReceipt(line, e.target.files[0], e.target)} />
              </div>
              <div className="actions">
                <button type="button" className="btn-small" onClick={() => editLine(line)} disabled={busy}>Edit</button>
                <button type="button" className="btn-small btn-danger" onClick={() => deleteLine(line)} disabled={busy}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <form id="line-form" className="card" onSubmit={saveLine}>
        <h2>{editingLineId ? 'Edit line' : 'Add a line'}</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="category">Category</label>
            <select id="category" value={lineForm.category}
              onChange={(e) => setLineForm({ ...lineForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="expenseDate">Expense date</label>
            <input id="expenseDate" type="date" required value={lineForm.expenseDate} max={today()}
              onChange={(e) => setLineForm({ ...lineForm, expenseDate: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="amount">Amount (₹)</label>
            <input id="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required
              value={lineForm.amount} onChange={(e) => setLineForm({ ...lineForm, amount: e.target.value })} />
            {receiptRule && receiptRule.limitAmount != null && (
              <div className="hint">Receipt required above {formatMoney(receiptRule.limitAmount)}.</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="vendor">Vendor</label>
            <input id="vendor" required maxLength={120} value={lineForm.vendor}
              onChange={(e) => setLineForm({ ...lineForm, vendor: e.target.value })} />
          </div>
          {lineForm.category === 'HOTEL' && (
            <>
              <div className="field">
                <label htmlFor="city">City</label>
                <input id="city" required maxLength={60} value={lineForm.city}
                  onChange={(e) => setLineForm({ ...lineForm, city: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="nights">Nights</label>
                <input id="nights" type="number" inputMode="numeric" min="1" max="365" step="1" required
                  value={lineForm.nights} onChange={(e) => setLineForm({ ...lineForm, nights: e.target.value })} />
              </div>
            </>
          )}
          <div className="field span-2">
            <label htmlFor="description">Description (optional)</label>
            <textarea id="description" maxLength={500} value={lineForm.description}
              onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} />
          </div>
        </div>

        {categoryRules.length > 0 && (
          <div className="banner banner-info small">
            <div className="banner-body">
              <strong>Policy for {CATEGORY_LABEL[lineForm.category]}:</strong>
              <ul>
                {categoryRules.map((r) => (
                  <li key={r.id}>
                    {r.description}{r.limitAmount != null && <> — limit {formatMoney(r.limitAmount)}</>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="actions">
          <button type="submit" className="btn-primary" disabled={busy}>
            {editingLineId ? 'Save line' : 'Add line'}
          </button>
          {editingLineId && <button type="button" onClick={cancelEdit} disabled={busy}>Cancel</button>}
        </div>
      </form>
    </>
  );
}
