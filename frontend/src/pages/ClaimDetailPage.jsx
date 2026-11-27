import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiDelete, apiGet, apiPost } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate, formatDateTime } from '../components/Money.jsx';
import ViolationList, { OutcomeBadge } from '../components/ViolationList.jsx';
import ReceiptViewer from '../components/ReceiptViewer.jsx';
import HistoryTimeline from '../components/HistoryTimeline.jsx';
import Modal from '../components/Modal.jsx';
import Icon from '../components/Icon.jsx';
import { useToast } from '../components/ToastContext.jsx';
import { useConfirm } from '../components/ConfirmContext.jsx';
import { EmptyState, ErrorBanner, Loading } from '../components/PageState.jsx';
import { initials } from '../components/Layout.jsx';

const CATEGORY = {
  MEAL: ['Meal', '🍽️'], HOTEL: ['Hotel', '🏨'], LOCAL_CAB: ['Local cab', '🚕'], TRAVEL: ['Travel', '✈️'], OTHER: ['Other', '📦'],
};

const DECISIONS = {
  APPROVE: {
    label: 'Approve', path: 'approve', className: 'btn-success', icon: 'check', commentRequired: false,
    title: 'Approve claim', help: 'Add an optional note for the record.', done: 'Claim approved',
  },
  SEND_BACK: {
    label: 'Send back', path: 'send-back', className: '', icon: 'rotate', commentRequired: true,
    title: 'Send back for clarification', help: 'Tell the employee what to fix. They can edit and resubmit.', done: 'Claim sent back',
  },
  REJECT: {
    label: 'Reject', path: 'reject', className: 'btn-danger', icon: 'x', commentRequired: true,
    title: 'Reject claim', help: 'Explain why the claim is rejected. This is final.', done: 'Claim rejected',
  },
};

export default function ClaimDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [claim, setClaim] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState(null);
  const [decision, setDecision] = useState(null); // APPROVE | SEND_BACK | REJECT
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    setClaim(null);
    apiGet(`/claims/${id}`)
      .then((c) => {
        setClaim(c);
        setSelectedLineId((c.lines.find((l) => l.hasReceipt) || c.lines[0])?.id ?? null);
      })
      .catch((e) => setLoadError(e.status === 404 ? 'Claim not found.' : e.message));
  }, [id]);

  useEffect(load, [load]);

  function openDecision(action) {
    setDecision(action);
    setComment('');
    setCommentError(null);
  }

  async function decide() {
    const d = DECISIONS[decision];
    const text = comment.trim();
    if (d.commentRequired && !text) {
      setCommentError(`A comment is required to ${d.label.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    try {
      const updated = await apiPost(`/claims/${id}/${d.path}`, text ? { comment: text } : {});
      setClaim(updated);
      setDecision(null);
      toast.success(`Status is now shown on the claim.`, d.done);
    } catch (e) {
      setCommentError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const ok = await confirm({
      title: claim.status === 'CLARIFICATION_REQUESTED' ? 'Resubmit claim?' : 'Submit for approval?',
      message: 'The policy engine will check every line and route the claim.',
      confirmLabel: 'Submit claim',
    });
    if (!ok) return;
    setBusy(true);
    try {
      setClaim(await apiPost(`/claims/${id}/submit`));
      toast.success('The policy engine result is shown below.', 'Claim submitted');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
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
      toast.error(e.message);
      setBusy(false);
    }
  }

  if (loadError === 'Claim not found.') {
    return (
      <div className="card">
        <EmptyState icon="search" title="Claim not found"
          action={<Link to="/claims" className="btn"><Icon name="chevronLeft" size={16} /> Back to my claims</Link>}>
          It may have been deleted, or you do not have access to it.
        </EmptyState>
      </div>
    );
  }
  if (loadError) return <ErrorBanner error={loadError} onRetry={load} />;
  if (!claim) return <Loading variant="detail" />;

  const actions = claim.allowedActions || [];
  const decisionActions = ['APPROVE', 'SEND_BACK', 'REJECT'].filter((a) => actions.includes(a));
  const isClaimant = user.id === claim.employeeId;
  const selectedLine = claim.lines.find((l) => l.id === selectedLineId) || null;
  const policyEntry = [...(claim.history || [])].reverse().find((h) => h.action === 'POLICY_DECISION');
  const d = decision && DECISIONS[decision];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">{claim.claimNumber}</div>
          <div className="title-row">
            <h1>{claim.title}</h1>
            <StatusBadge status={claim.status} />
            {claim.hasViolations && <span className="badge badge-warning"><Icon name="alert" size={12} /> Policy flags</span>}
            {claim.autoApproved && <span className="badge badge-success"><Icon name="sparkle" size={12} /> Auto-approved</span>}
            {!isClaimant && claim.sampleAudit && <span className="badge badge-violet">Sample audit</span>}
          </div>
        </div>
        <div className="actions">
          {actions.includes('EDIT') && <Link to={`/claims/${claim.id}/edit`} className="btn"><Icon name="edit" size={16} /> Edit</Link>}
          {actions.includes('DELETE') && (
            <button type="button" className="btn-danger" onClick={deleteDraft} disabled={busy}><Icon name="trash" size={16} /> Delete</button>
          )}
          {actions.includes('SUBMIT') && (
            <button type="button" className="btn-primary" onClick={submit} disabled={busy || claim.lines.length === 0}>
              <Icon name="send" size={16} /> {claim.status === 'CLARIFICATION_REQUESTED' ? 'Resubmit' : 'Submit'}
            </button>
          )}
        </div>
      </div>

      {decisionActions.length > 0 && (
        <div className="decision-bar">
          <div className="decision-text">
            <span className="kpi-icon tone-accent"><Icon name="inbox" size={18} /></span>
            <div><strong>Your decision is needed</strong><span>Review the lines and receipts, then decide.</span></div>
          </div>
          <div className="actions">
            {decisionActions.map((a) => (
              <button key={a} type="button" className={DECISIONS[a].className} disabled={busy} onClick={() => openDecision(a)}>
                <Icon name={DECISIONS[a].icon} size={16} /> {DECISIONS[a].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {policyEntry?.comment && (
        <div className={`alert ${claim.hasViolations ? 'alert-warning' : 'alert-info'}`}>
          <Icon name="sparkle" size={18} />
          <span className="alert-body"><strong>Policy engine:</strong> {policyEntry.comment}</span>
        </div>
      )}

      <section className="card">
        <dl className="kv">
          <div>
            <dt>Employee</dt>
            <dd className="cell-person"><span className="avatar">{initials(claim.employeeName)}</span>{claim.employeeName}</dd>
          </div>
          <div><dt>Department</dt><dd>{claim.departmentName || '—'}</dd></div>
          <div><dt>Submitted</dt><dd>{claim.submittedAt ? formatDateTime(claim.submittedAt) : 'Not submitted'}</dd></div>
          <div><dt>Current approver</dt><dd>{claim.currentApproverName || '—'}</dd></div>
          <div><dt>Total claimed</dt><dd className="amount-lg"><Money value={claim.totalAmount} /></dd></div>
          <div><dt>Approvable</dt><dd className="amount-lg text-success"><Money value={claim.approvedAmount} /></dd></div>
        </dl>
      </section>

      <div className="grid-2 section-gap">
        <section className="card card-flush">
          <div className="card-head"><div><h2>Expense lines</h2><p>Select a line to view its receipt.</p></div></div>
          {claim.lines.length === 0 ? <EmptyState icon="receipt" title="No expense lines" /> : (
            <div className="table-wrap" style={{ maxHeight: 'none' }}>
              <table>
                <thead>
                  <tr><th>Expense</th><th className="num">Amount</th><th>Outcome</th></tr>
                </thead>
                <tbody>
                  {claim.lines.map((l) => (
                    <tr key={l.id} className={`clickable ${l.id === selectedLineId ? 'selected' : ''}`}
                      onClick={() => setSelectedLineId(l.id)}>
                      <td>
                        <div className="line-cat">
                          <span className="cat-icon" aria-hidden="true">{CATEGORY[l.category]?.[1]}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="cell-title">{l.vendor}</div>
                            <div className="cell-sub">
                              {CATEGORY[l.category]?.[0] || l.category} · {formatDate(l.expenseDate)}
                              {l.category === 'HOTEL' && <> · {l.city}, {l.nights} night(s)</>}
                              {' · '}{l.hasReceipt ? <span className="text-success">receipt ✓</span> : <span className="text-warning">no receipt</span>}
                            </div>
                          </div>
                        </div>
                        {l.description && <div className="small muted" style={{ marginTop: 6 }}>{l.description}</div>}
                        <ViolationList violations={l.violations} />
                      </td>
                      <td className="num strong"><Money value={l.amount} /></td>
                      <td><OutcomeBadge outcome={l.outcome} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card sticky-col">
          <div className="card-head" style={{ marginBottom: 12 }}>
            <div><h2>Receipt</h2><p>{selectedLine ? selectedLine.vendor : 'No line selected'}</p></div>
          </div>
          <ReceiptViewer claimId={claim.id} line={selectedLine} />
        </section>
      </div>

      <section className="card">
        <div className="card-head"><div><h2>Activity</h2><p>Every action on this claim, oldest first.</p></div></div>
        <HistoryTimeline history={claim.history} />
      </section>

      <Modal
        open={Boolean(d)}
        title={d?.title}
        onClose={() => setDecision(null)}
        busy={busy}
        footer={d && (
          <>
            <button type="button" onClick={() => setDecision(null)} disabled={busy}>Cancel</button>
            <button type="button" className={d.className === 'btn-danger' ? 'btn-danger-solid' : (d.className || 'btn-primary')}
              onClick={decide} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name={d.icon} size={16} />} {d.label}
            </button>
          </>
        )}
      >
        {d && (
          <>
            <p className="muted">{claim.claimNumber} · {claim.employeeName} · <Money value={claim.approvedAmount} /></p>
            <div className={`field ${commentError ? 'has-error' : ''}`}>
              <label htmlFor="decision-comment">
                Comment {d.commentRequired ? <span className="text-danger">*</span> : <span className="muted">(optional)</span>}
              </label>
              <textarea id="decision-comment" maxLength={1000} value={comment} placeholder={d.help}
                onChange={(e) => { setComment(e.target.value); setCommentError(null); }} />
              {commentError && <div className="field-error"><Icon name="alert" size={13} /> {commentError}</div>}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
