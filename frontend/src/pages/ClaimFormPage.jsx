import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate, formatMoney } from '../components/Money.jsx';
import ViolationList, { OutcomeBadge } from '../components/ViolationList.jsx';
import ReceiptDropzone from '../components/ReceiptDropzone.jsx';
import Icon from '../components/Icon.jsx';
import { useToast } from '../components/ToastContext.jsx';
import { useConfirm } from '../components/ConfirmContext.jsx';
import { ErrorBanner, Loading } from '../components/PageState.jsx';

export const CATEGORIES = [
  { value: 'MEAL', label: 'Meal', emoji: '🍽️' },
  { value: 'HOTEL', label: 'Hotel', emoji: '🏨' },
  { value: 'LOCAL_CAB', label: 'Local cab', emoji: '🚕' },
  { value: 'TRAVEL', label: 'Travel (air / rail / bus)', emoji: '✈️' },
  { value: 'OTHER', label: 'Other', emoji: '📦' },
];
const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]));
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

/** UX-only checks so users get instant feedback; the backend re-validates everything. */
function validateLine(f) {
  const e = {};
  if (!f.expenseDate) e.expenseDate = 'Pick the date of the expense.';
  else if (f.expenseDate > today()) e.expenseDate = 'The date cannot be in the future.';
  const amount = Number(f.amount);
  if (f.amount === '' || Number.isNaN(amount)) e.amount = 'Enter an amount.';
  else if (amount <= 0) e.amount = 'Amount must be greater than 0.';
  else if (!/^\d+(\.\d{1,2})?$/.test(String(f.amount).trim())) e.amount = 'Use at most 2 decimals.';
  if (!f.vendor.trim()) e.vendor = 'Who did you pay?';
  if (f.category === 'HOTEL') {
    if (!f.city.trim()) e.city = 'City is required for hotel stays.';
    if (!f.nights || Number(f.nights) < 1) e.nights = 'At least 1 night.';
  }
  return e;
}

function FieldError({ message }) {
  if (!message) return null;
  return <div className="field-error"><Icon name="alert" size={13} /> {message}</div>;
}

function Steps({ current }) {
  const steps = ['Create draft', 'Add expenses', 'Submit'];
  return (
    <div className="stepper" aria-label="Progress">
      {steps.map((s, i) => (
        <span key={s} style={{ display: 'contents' }}>
          {i > 0 && <span className="step-sep" />}
          <span className={`step ${i < current ? 'done' : ''} ${i === current ? 'current' : ''}`}>
            <span className="step-dot">{i < current ? <Icon name="check" size={12} /> : i + 1}</span>{s}
          </span>
        </span>
      ))}
    </div>
  );
}

export default function ClaimFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const isNew = !id;

  const [claim, setClaim] = useState(null);
  const [rules, setRules] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadingLine, setUploadingLine] = useState(null);

  const [title, setTitle] = useState('');
  const [lineForm, setLineForm] = useState(emptyLine);
  const [fieldErrors, setFieldErrors] = useState({});
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

  function setField(name, value) {
    setLineForm((f) => ({ ...f, [name]: value }));
    if (fieldErrors[name]) setFieldErrors((fe) => ({ ...fe, [name]: undefined }));
  }

  /** Runs one API call that returns ClaimDetail, then re-renders from the response. */
  async function run(fn, successMessage) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result && result.id) setClaim(result);
      if (successMessage) toast.success(successMessage);
      return result;
    } catch (e) {
      if (e.fieldErrors) setFieldErrors(e.fieldErrors);
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createDraft(e) {
    e.preventDefault();
    if (!title.trim()) { setFieldErrors({ title: 'Give your claim a short title.' }); return; }
    const created = await run(() => apiPost('/claims', { title: title.trim() }), 'Draft created. Now add your expenses.');
    if (created) navigate(`/claims/${created.id}/edit`, { replace: true });
  }

  function saveTitle(e) {
    e.preventDefault();
    run(() => apiPut(`/claims/${id}`, { title: title.trim() }), 'Title saved.');
  }

  async function saveLine(e) {
    e.preventDefault();
    const errs = validateLine(lineForm);
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    const body = toRequest(lineForm);
    const result = await run(
      () => (editingLineId
        ? apiPut(`/claims/${id}/lines/${editingLineId}`, body)
        : apiPost(`/claims/${id}/lines`, body)),
      editingLineId ? 'Expense updated.' : 'Expense added. Attach its receipt below.',
    );
    if (result) {
      setLineForm(emptyLine());
      setEditingLineId(null);
      setFieldErrors({});
    }
  }

  function editLine(line) {
    setEditingLineId(line.id);
    setLineForm(fromLine(line));
    setFieldErrors({});
    document.getElementById('line-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelEdit() {
    setEditingLineId(null);
    setLineForm(emptyLine());
    setFieldErrors({});
  }

  async function deleteLine(line) {
    const ok = await confirm({
      title: 'Delete expense?',
      message: `Remove the ${CATEGORY[line.category]?.label || line.category} expense of ${formatMoney(line.amount)} from this claim?`,
      confirmLabel: 'Delete', tone: 'danger',
    });
    if (!ok) return;
    if (editingLineId === line.id) cancelEdit();
    run(() => apiDelete(`/claims/${id}/lines/${line.id}`), 'Expense deleted.');
  }

  async function uploadReceipt(line, file) {
    if (!RECEIPT_TYPES.includes(file.type)) { toast.error('Receipt must be a PDF, JPEG or PNG file.'); return; }
    if (file.size > MAX_RECEIPT_BYTES) { toast.error('Receipt must be 5 MB or smaller.'); return; }
    setUploadingLine(line.id);
    await run(() => apiUpload(`/claims/${id}/lines/${line.id}/receipt`, file), 'Receipt uploaded.');
    setUploadingLine(null);
  }

  async function submit() {
    const ok = await confirm({
      title: claim.status === 'CLARIFICATION_REQUESTED' ? 'Resubmit claim?' : 'Submit for approval?',
      message: 'The policy engine will check every line and route the claim. You cannot edit it afterwards unless it is sent back.',
      confirmLabel: 'Submit claim',
    });
    if (!ok) return;
    const result = await run(() => apiPost(`/claims/${id}/submit`));
    if (result) {
      toast.success('The policy engine result is shown on the claim.', 'Claim submitted');
      navigate(`/claims/${id}`);
    }
  }

  async function deleteDraft() {
    const ok = await confirm({
      title: 'Delete draft?', message: 'This draft and its receipts will be permanently deleted.',
      confirmLabel: 'Delete draft', tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await apiDelete(`/claims/${id}`);
      toast.success('Draft deleted.');
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
            <div className="page-eyebrow">New claim</div>
            <h1>Start an expense claim</h1>
            <Steps current={0} />
          </div>
        </div>
        <ErrorBanner error={error} />
        <form className="card" onSubmit={createDraft} noValidate style={{ maxWidth: 620 }}>
          <div className={`field ${fieldErrors.title ? 'has-error' : ''}`}>
            <label htmlFor="title">Claim title</label>
            <input id="title" value={title} maxLength={200} autoFocus
              placeholder="e.g. Client visit — Mumbai, Nov 2026"
              onChange={(e) => { setTitle(e.target.value); setFieldErrors({}); }} />
            <FieldError message={fieldErrors.title} />
            <div className="hint">A short name helps approvers understand the trip or purpose at a glance.</div>
          </div>
          <div className="actions">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="arrowRight" size={16} />} Create draft
            </button>
            <Link to="/claims" className="btn btn-ghost">Cancel</Link>
          </div>
        </form>
      </>
    );
  }

  if (loadError) return <ErrorBanner error={loadError} onRetry={load} />;
  if (!claim) return <Loading variant="detail" />;

  const actions = claim.allowedActions || [];
  if (!actions.includes('EDIT')) {
    return (
      <div className="card">
        <div className="alert alert-info"><Icon name="info" size={18} />
          <span className="alert-body">This claim can no longer be edited. Current status: <StatusBadge status={claim.status} /></span>
        </div>
        <Link to={`/claims/${claim.id}`} className="btn"><Icon name="eye" size={16} /> View claim</Link>
      </div>
    );
  }

  const sendBack = [...(claim.history || [])].reverse().find((h) => h.action === 'SEND_BACK');
  const activeRules = rules.filter((r) => r.active);
  const categoryRules = activeRules.filter((r) => r.category === lineForm.category);
  const receiptRule = activeRules.find((r) => r.code === 'RECEIPT_REQUIRED');
  const withReceipt = claim.lines.filter((l) => l.hasReceipt).length;
  const fe = fieldErrors;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">{claim.claimNumber}</div>
          <div className="title-row"><h1>{claim.title}</h1><StatusBadge status={claim.status} /></div>
          <Steps current={claim.lines.length ? 2 : 1} />
        </div>
        <div className="actions">
          <Link to={`/claims/${claim.id}`} className="btn"><Icon name="eye" size={16} /> Preview</Link>
        </div>
      </div>

      {sendBack && claim.status === 'CLARIFICATION_REQUESTED' && (
        <div className="alert alert-info">
          <Icon name="rotate" size={18} />
          <div className="alert-body"><strong>{sendBack.actorName} asked for clarification:</strong> {sendBack.comment}</div>
        </div>
      )}
      <ErrorBanner error={error} />

      <div className="grid-2">
        <div>
          <section className="card">
            <div className="card-head">
              <div><h2>Expenses</h2><p>{claim.lines.length} line(s) · {withReceipt} with receipts</p></div>
            </div>
            {claim.lines.length === 0 && (
              <p className="muted">No expenses yet. Use the form below to add your first one.</p>
            )}
            <div className="line-list">
              {claim.lines.map((line) => (
                <div key={line.id} className={`line-card ${editingLineId === line.id ? 'is-editing' : ''}`}>
                  <div className="line-card-head">
                    <div className="line-cat">
                      <span className="cat-icon" aria-hidden="true">{CATEGORY[line.category]?.emoji}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="cell-title">{line.vendor}</div>
                        <div className="cell-sub">
                          {CATEGORY[line.category]?.label || line.category} · {formatDate(line.expenseDate)}
                          {line.category === 'HOTEL' && <> · {line.city}, {line.nights} night(s)</>}
                        </div>
                      </div>
                    </div>
                    <span className="line-card-amount"><Money value={line.amount} /></span>
                  </div>
                  {line.description && <p className="small muted" style={{ margin: '8px 0 0' }}>{line.description}</p>}
                  <ViolationList violations={line.violations} />
                  <ReceiptDropzone id={`receipt-${line.id}`} hasReceipt={line.hasReceipt}
                    disabled={busy || uploadingLine === line.id} onFile={(f) => uploadReceipt(line, f)} />
                  <div className="line-card-foot">
                    <span>{line.outcome && <OutcomeBadge outcome={line.outcome} />}</span>
                    <div className="actions">
                      <button type="button" className="btn-sm" onClick={() => editLine(line)} disabled={busy}>
                        <Icon name="edit" size={14} /> Edit
                      </button>
                      <button type="button" className="btn-sm btn-danger" onClick={() => deleteLine(line)} disabled={busy}>
                        <Icon name="trash" size={14} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <form id="line-form" className="card" onSubmit={saveLine} noValidate>
            <div className="card-head">
              <div><h2>{editingLineId ? 'Edit expense' : 'Add an expense'}</h2><p>One line per receipt.</p></div>
            </div>
            <div className="field">
              <label>Category</label>
              <div className="segmented" role="radiogroup" aria-label="Category">
                {CATEGORIES.map((c) => (
                  <button key={c.value} type="button" role="radio" aria-checked={lineForm.category === c.value}
                    className={lineForm.category === c.value ? 'active' : ''} onClick={() => setField('category', c.value)}>
                    <span aria-hidden="true">{c.emoji}</span> {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-grid">
              <div className={`field ${fe.expenseDate ? 'has-error' : ''}`}>
                <label htmlFor="expenseDate">Expense date</label>
                <input id="expenseDate" type="date" value={lineForm.expenseDate} max={today()}
                  onChange={(e) => setField('expenseDate', e.target.value)} />
                <FieldError message={fe.expenseDate} />
              </div>
              <div className={`field ${fe.amount ? 'has-error' : ''}`}>
                <label htmlFor="amount">Amount</label>
                <div className="input-prefix">
                  <span>₹</span>
                  <input id="amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00"
                    value={lineForm.amount} onChange={(e) => setField('amount', e.target.value)} />
                </div>
                <FieldError message={fe.amount} />
                {!fe.amount && receiptRule && receiptRule.limitAmount != null && (
                  <div className="hint">Receipt required above {formatMoney(receiptRule.limitAmount)}.</div>
                )}
              </div>
              <div className={`field span-2 ${fe.vendor ? 'has-error' : ''}`}>
                <label htmlFor="vendor">Vendor</label>
                <input id="vendor" maxLength={120} value={lineForm.vendor} placeholder="e.g. Taj Hotels, Uber, IndiGo"
                  onChange={(e) => setField('vendor', e.target.value)} />
                <FieldError message={fe.vendor} />
              </div>
              {lineForm.category === 'HOTEL' && (
                <>
                  <div className={`field ${fe.city ? 'has-error' : ''}`}>
                    <label htmlFor="city">City</label>
                    <input id="city" maxLength={60} value={lineForm.city} placeholder="e.g. Mumbai"
                      onChange={(e) => setField('city', e.target.value)} />
                    <FieldError message={fe.city} />
                  </div>
                  <div className={`field ${fe.nights ? 'has-error' : ''}`}>
                    <label htmlFor="nights">Nights</label>
                    <input id="nights" type="number" inputMode="numeric" min="1" max="365" step="1"
                      value={lineForm.nights} onChange={(e) => setField('nights', e.target.value)} />
                    <FieldError message={fe.nights} />
                  </div>
                </>
              )}
              <div className="field span-2">
                <label htmlFor="description">Description <span className="muted">(optional)</span></label>
                <textarea id="description" maxLength={500} value={lineForm.description} placeholder="Business purpose, attendees…"
                  onChange={(e) => setField('description', e.target.value)} />
              </div>
            </div>

            {categoryRules.length > 0 && (
              <div className="alert alert-info small">
                <Icon name="shield" size={16} />
                <div className="alert-body">
                  <strong>{CATEGORY[lineForm.category]?.label} policy</strong>
                  <ul>
                    {categoryRules.map((r) => (
                      <li key={r.id}>{r.description}{r.limitAmount != null && <> — limit <strong>{formatMoney(r.limitAmount)}</strong></>}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="actions">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? <span className="spinner" /> : <Icon name={editingLineId ? 'check' : 'plus'} size={16} />}
                {editingLineId ? 'Save expense' : 'Add expense'}
              </button>
              {editingLineId && <button type="button" onClick={cancelEdit} disabled={busy}>Cancel</button>}
            </div>
          </form>
        </div>

        <aside className="sticky-col">
          <section className="card">
            <h2 style={{ marginBottom: 14 }}>Claim summary</h2>
            <form onSubmit={saveTitle} noValidate>
              <div className="field">
                <label htmlFor="title">Title</label>
                <input id="title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              </div>
              {title.trim() && title.trim() !== claim.title && (
                <button type="submit" className="btn-sm" disabled={busy} style={{ marginTop: -6, marginBottom: 12 }}>
                  <Icon name="check" size={14} /> Save title
                </button>
              )}
            </form>
            {claim.lines.map((l) => (
              <div key={l.id} className="summary-row">
                <span>{CATEGORY[l.category]?.emoji} {l.vendor}</span><Money value={l.amount} />
              </div>
            ))}
            <div className="summary-total"><span className="muted">Total</span><strong><Money value={claim.totalAmount} /></strong></div>
            <div className="actions" style={{ marginTop: 18, flexDirection: 'column', alignItems: 'stretch' }}>
              {actions.includes('SUBMIT') && (
                <button type="button" className="btn-primary btn-lg" onClick={submit} disabled={busy || claim.lines.length === 0}>
                  <Icon name="send" size={16} /> {claim.status === 'CLARIFICATION_REQUESTED' ? 'Resubmit claim' : 'Submit for approval'}
                </button>
              )}
              {claim.lines.length === 0 && <span className="hint" style={{ textAlign: 'center' }}>Add at least one expense to submit.</span>}
              {actions.includes('DELETE') && (
                <button type="button" className="btn-ghost text-danger" onClick={deleteDraft} disabled={busy}>
                  <Icon name="trash" size={16} /> Delete draft
                </button>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
