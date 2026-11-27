import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDownload, apiGet, apiPost } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate, formatDateTime, formatMoney } from '../components/Money.jsx';
import { ErrorBanner, Loading } from '../components/PageState.jsx';

export default function PayoutPage() {
  const [eligible, setEligible] = useState(null);
  const [batches, setBatches] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    return Promise.all([apiGet('/payouts/eligible'), apiGet('/payouts')])
      .then(([e, b]) => { setEligible(e); setBatches(b); })
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(fn) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const createBatch = () => act(async () => {
    if (!window.confirm(`Create a payout batch for ${eligible.length} approved claim(s)?`)) return;
    const batch = await apiPost('/payouts');
    await load();
    setNotice(`Batch ${batch.batchNumber} created: ${batch.claimCount} claim(s), ${formatMoney(batch.totalAmount)}. Download the CSV for the bank.`);
  });

  const downloadCsv = (batch) => act(async () => {
    const { blob, filename } = await apiDownload(`/payouts/${batch.id}/csv`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `payout_${batch.batchNumber}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const markPaid = (batch) => act(async () => {
    if (!window.confirm(`Mark batch ${batch.batchNumber} as paid? All ${batch.claimCount} claim(s) become PAID.`)) return;
    const updated = await apiPost(`/payouts/${batch.id}/mark-paid`);
    await load();
    setNotice(`Batch ${updated.batchNumber} marked as paid.`);
  });

  if (loadError) return <ErrorBanner error={loadError} onRetry={load} />;
  if (!eligible || !batches) return <Loading />;

  const eligibleTotal = eligible.reduce((sum, c) => sum + Number(c.approvedAmount || 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payouts</h1>
          <p className="muted small">Batch approved claims, export the bank CSV, then confirm payment.</p>
        </div>
        <button type="button" className="btn-primary" disabled={busy || eligible.length === 0} onClick={createBatch}>
          Create payout batch
        </button>
      </div>

      <ErrorBanner error={error} />
      {notice && <div className="banner banner-success" role="status">{notice}</div>}

      <section className="card">
        <h2>Ready for payout</h2>
        {eligible.length === 0 ? <p className="muted">No approved claims are waiting for payout.</p> : (
          <>
            <p className="small muted">{eligible.length} claim(s) · {formatMoney(eligibleTotal)}</p>
            <div className="table-wrap" style={{ maxHeight: '45vh' }}>
              <table>
                <thead>
                  <tr>
                    <th>Claim</th><th>Employee</th><th className="hide-mobile">Department</th>
                    <th className="hide-mobile">Submitted</th><th className="num">Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {eligible.map((c) => (
                    <tr key={c.id}>
                      <td><Link to={`/claims/${c.id}`}>{c.claimNumber}</Link><div className="small muted">{c.title}</div></td>
                      <td>{c.employeeName}</td>
                      <td className="hide-mobile">{c.departmentName || '—'}</td>
                      <td className="nowrap hide-mobile">{formatDate(c.submittedAt)}</td>
                      <td className="num"><Money value={c.approvedAmount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Payout batches</h2>
        {batches.length === 0 ? <p className="muted">No batches yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Batch</th><th>Status</th><th className="hide-mobile">Created</th>
                  <th className="num">Claims</th><th className="num">Total</th><th className="hide-mobile">Paid</th><th />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="nowrap"><strong>{b.batchNumber}</strong></td>
                    <td><StatusBadge status={b.status} /></td>
                    <td className="nowrap hide-mobile">{formatDateTime(b.createdAt)}</td>
                    <td className="num">{b.claimCount}</td>
                    <td className="num"><Money value={b.totalAmount} /></td>
                    <td className="nowrap hide-mobile">{b.paidAt ? formatDateTime(b.paidAt) : '—'}</td>
                    <td>
                      <div className="actions" style={{ flexWrap: 'nowrap' }}>
                        <button type="button" className="btn-small" disabled={busy} onClick={() => downloadCsv(b)}>CSV</button>
                        {b.status === 'EXPORTED' && (
                          <button type="button" className="btn-small btn-primary" disabled={busy} onClick={() => markPaid(b)}>Mark paid</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
