import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiDelete, apiGet, apiPost } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate, formatDateTime } from '../components/Money.jsx';
import ViolationList, { OutcomeBadge } from '../components/ViolationList.jsx';
import ReceiptViewer from '../components/ReceiptViewer.jsx';
import HistoryTimeline from '../components/HistoryTimeline.jsx';
import { ErrorBanner, Loading } from '../components/PageState.jsx';

const CATEGORY_LABEL = { MEAL: 'Meal', HOTEL: 'Hotel', LOCAL_CAB: 'Local cab', TRAVEL: 'Travel', OTHER: 'Other' };

const DECISIONS = {
  APPROVE: { label: 'Approve', path: 'approve', className: 'btn-primary', commentRequired: false },
  SEND_BACK: { label: 'Send back', path: 'send-back', className: '', commentRequired: true },
  REJECT: { label: 'Reject', path: 'reject', className: 'btn-danger', commentRequired: true },
};

export default function ClaimDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [claim, setClaim] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState(null);
  const [comment, setComment] = useState('');

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

  useEffect(() => {
    if (location.state?.justSubmitted) setNotice('Claim submitted. The policy engine result is shown below.');
  }, [location.state]);

  async function decide(action) {
    const d = DECISIONS[action];
    const text = comment.trim();
    if (d.commentRequired && !text) {
      setError(`A comment is required to ${d.label.toLowerCase()}.`);
      document.getElementById('decision-comment')?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiPost(`/claims/${id}/${d.path}`, text ? { comment: text } : {});
      setClaim(updated);
      setComment('');
      setNotice(`${d.label} recorded. Status is now shown above.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!window.confirm('Submit this claim for approval?')) return;
    setBusy(true);
    setError(null);
    try {
      setClaim(await apiPost(`/claims/${id}/submit`));
      setNotice('Claim submitted. The policy engine result is shown below.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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

  if (loadError) {
    return (
      <>
        <ErrorBanner error={loadError} onRetry={loadError === 'Claim not found.' ? null : load} />
        <Link to="/claims" className="btn">Back to my claims</Link>
      </>
    );
  }
  if (!claim) return <Loading />;

  const actions = claim.allowedActions || [];
  const decisionActions = ['APPROVE', 'SEND_BACK', 'REJECT'].filter((a) => actions.includes(a));
  const isClaimant = user.id === claim.employeeId;
  const selectedLine = claim.lines.find((l) => l.id === selectedLineId) || null;
  const policyEntry = [...(claim.history || [])].reverse().find((h) => h.action === 'POLICY_DECISION');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{claim.claimNumber} · {claim.title}</h1>
          <div className="actions">
            <StatusBadge status={claim.status} />
            {claim.hasViolations && <span className="badge b-amber">⚠ Policy flags</span>}
            {claim.autoApproved && <span className="badge b-green">Auto-approved</span>}
            {!isClaimant && claim.sampleAudit && <span className="badge b-violet">Sample audit</span>}
          </div>
        </div>
        <div className="actions">
          {actions.includes('EDIT') && <Link to={`/claims/${claim.id}/edit`} className="btn">Edit</Link>}
          {actions.includes('DELETE') && (
            <button type="button" className="btn-danger" onClick={deleteDraft} disabled={busy}>Delete draft</button>
          )}
          {actions.includes('SUBMIT') && (
            <button type="button" className="btn-primary" onClick={submit} disabled={busy || claim.lines.length === 0}>
              {claim.status === 'CLARIFICATION_REQUESTED' ? 'Resubmit' : 'Submit'}
            </button>
          )}
        </div>
      </div>

      <ErrorBanner error={error} />
      {notice && <div className="banner banner-success" role="status">{notice}</div>}
      {policyEntry?.comment && (
        <div className="banner banner-info small"><span className="banner-body"><strong>Policy engine:</strong> {policyEntry.comment}</span></div>
      )}

      <section className="card">
        <dl className="kv">
          <div><dt>Employee</dt><dd>{claim.employeeName}</dd></div>
          <div><dt>Department</dt><dd>{claim.departmentName || '—'}</dd></div>
          <div><dt>Submitted</dt><dd>{claim.submittedAt ? formatDateTime(claim.submittedAt) : 'Not submitted'}</dd></div>
          <div><dt>Current approver</dt><dd>{claim.currentApproverName || '—'}</dd></div>
          <div><dt>Total claimed</dt><dd><Money value={claim.totalAmount} /></dd></div>
          <div><dt>Approvable amount</dt><dd><Money value={claim.approvedAmount} /></dd></div>
        </dl>
      </section>

      {decisionActions.length > 0 && (
        <section className="card">
          <h2>Your decision</h2>
          <div className="field">
            <label htmlFor="decision-comment">Comment (required to reject or send back)</label>
            <textarea id="decision-comment" maxLength={1000} value={comment}
              onChange={(e) => setComment(e.target.value)} />
          </div>
          <div className="actions">
            {decisionActions.map((a) => (
              <button key={a} type="button" className={DECISIONS[a].className} disabled={busy} onClick={() => decide(a)}>
                {DECISIONS[a].label}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>Expense lines</h2>
          {claim.lines.length === 0 ? <p className="muted">No lines.</p> : (
            <div className="table-wrap" style={{ maxHeight: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th className="num">Amount</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {claim.lines.map((l) => (
                    <tr key={l.id} className={`clickable ${l.id === selectedLineId ? 'selected' : ''}`}
                      onClick={() => setSelectedLineId(l.id)}>
                      <td>
                        <strong>{CATEGORY_LABEL[l.category] || l.category}</strong> · {l.vendor}
                        <div className="small muted">
                          {formatDate(l.expenseDate)}
                          {l.category === 'HOTEL' && <> · {l.city}, {l.nights} night(s)</>}
                          {' · '}{l.hasReceipt ? '📎 receipt' : 'no receipt'}
                        </div>
                        {l.description && <div className="small">{l.description}</div>}
                        <ViolationList violations={l.violations} />
                      </td>
                      <td className="num"><Money value={l.amount} /></td>
                      <td><OutcomeBadge outcome={l.outcome} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card sticky-col">
          <h2>Receipt{selectedLine ? ` · ${selectedLine.vendor}` : ''}</h2>
          <ReceiptViewer claimId={claim.id} line={selectedLine} />
        </section>
      </div>

      <section className="card">
        <h2>History</h2>
        <HistoryTimeline history={claim.history} />
      </section>
    </>
  );
}
