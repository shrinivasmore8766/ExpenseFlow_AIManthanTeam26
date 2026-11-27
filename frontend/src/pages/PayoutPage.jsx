import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDownload, apiGet, apiPost } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Money, { formatDate, formatDateTime, formatMoney, formatMoneyCompact } from '../components/Money.jsx';
import Icon from '../components/Icon.jsx';
import StatCard from '../components/StatCard.jsx';
import Pagination, { usePagination } from '../components/Pagination.jsx';
import { useToast } from '../components/ToastContext.jsx';
import { useConfirm } from '../components/ConfirmContext.jsx';
import { initials } from '../components/Layout.jsx';
import { EmptyState, ErrorBanner, Loading } from '../components/PageState.jsx';

export default function PayoutPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [eligible, setEligible] = useState(null);
  const [batches, setBatches] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    return Promise.all([apiGet('/payouts/eligible'), apiGet('/payouts')])
      .then(([e, b]) => { setEligible(e); setBatches(b); })
      .catch((e) => setLoadError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const eligiblePager = usePagination(eligible, 10);
  const batchPager = usePagination(batches, 8);

  async function act(key, fn) {
    setBusyId(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const createBatch = async () => {
    const ok = await confirm({
      title: 'Create payout batch?',
      message: `${eligible.length} approved claim(s) totalling ${formatMoney(eligibleTotal)} will be grouped into one batch for the bank.`,
      confirmLabel: 'Create batch',
    });
    if (!ok) return;
    act('create', async () => {
      const batch = await apiPost('/payouts');
      await load();
      toast.success(`${batch.claimCount} claim(s), ${formatMoney(batch.totalAmount)}. Download the CSV for the bank.`, `Batch ${batch.batchNumber} created`);
    });
  };

  const downloadCsv = (batch) => act(`csv-${batch.id}`, async () => {
    const { blob, filename } = await apiDownload(`/payouts/${batch.id}/csv`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `payout_${batch.batchNumber}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.info(`${a.download} downloaded.`);
  });

  const markPaid = async (batch) => {
    const ok = await confirm({
      title: `Mark ${batch.batchNumber} as paid?`,
      message: `Confirm the bank has paid this batch. All ${batch.claimCount} claim(s) become PAID. This cannot be undone.`,
      confirmLabel: 'Mark as paid',
    });
    if (!ok) return;
    act(`paid-${batch.id}`, async () => {
      const updated = await apiPost(`/payouts/${batch.id}/mark-paid`);
      await load();
      toast.success(`${updated.claimCount} claim(s) are now paid.`, `Batch ${updated.batchNumber} paid`);
    });
  };

  if (loadError) return <ErrorBanner error={loadError} onRetry={load} />;
  if (!eligible || !batches) return <><Loading variant="cards" /><Loading /></>;

  const eligibleTotal = eligible.reduce((sum, c) => sum + Number(c.approvedAmount || 0), 0);
  const paidBatches = batches.filter((b) => b.status === 'PAID');
  const awaiting = batches.filter((b) => b.status === 'EXPORTED');
  const reimbursed = paidBatches.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
  const lastPaid = paidBatches.map((b) => b.paidAt).filter(Boolean).sort().pop();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Finance</div>
          <h1>Payouts</h1>
          <p>Batch approved claims, export the bank CSV, then confirm payment.</p>
        </div>
        <button type="button" className="btn-primary" disabled={busyId !== null || eligible.length === 0} onClick={createBatch}>
          {busyId === 'create' ? <span className="spinner" /> : <Icon name="plus" size={16} />} Create payout batch
        </button>
      </div>

      <div className="kpi-grid">
        <StatCard label="Ready for payout" icon="wallet" tone="accent" value={formatMoneyCompact(eligibleTotal)}
          sub={`${eligible.length} approved claim(s)`} />
        <StatCard label="Awaiting bank confirmation" icon="clock" tone="warning" value={awaiting.length}
          sub={awaiting.length ? formatMoney(awaiting.reduce((s, b) => s + Number(b.totalAmount), 0)) : 'No open batches'} />
        <StatCard label="Total reimbursed" icon="bank" tone="success" value={formatMoneyCompact(reimbursed)}
          sub={`${paidBatches.length} paid batch(es)`} />
        <StatCard label="Last payout" icon="calendar" tone="neutral" value={lastPaid ? formatDate(lastPaid) : '—'}
          sub={lastPaid ? 'Most recent bank confirmation' : 'No payouts yet'} />
      </div>

      <section className="card card-flush">
        <div className="card-head">
          <div><h2>Ready for payout</h2><p>Approved claims not yet in a batch.</p></div>
          {eligible.length > 0 && <span className="badge badge-accent">{eligible.length} · {formatMoney(eligibleTotal)}</span>}
        </div>
        {eligible.length === 0 ? (
          <EmptyState icon="checkCircle" title="Nothing to pay out">Approved claims will appear here, ready to batch.</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Claim</th><th>Employee</th><th className="hide-mobile">Submitted</th><th className="num">Payable</th></tr>
                </thead>
                <tbody>
                  {eligiblePager.pageItems.map((c) => (
                    <tr key={c.id}>
                      <td><Link to={`/claims/${c.id}`} className="claim-link">{c.claimNumber}</Link><div className="cell-sub">{c.title}</div></td>
                      <td>
                        <div className="cell-person">
                          <span className="avatar hide-mobile">{initials(c.employeeName)}</span>
                          <div><div className="strong">{c.employeeName}</div><div className="cell-sub">{c.departmentName || '—'}</div></div>
                        </div>
                      </td>
                      <td className="nowrap hide-mobile">{formatDate(c.submittedAt)}</td>
                      <td className="num strong"><Money value={c.approvedAmount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...eligiblePager} />
          </>
        )}
      </section>

      <section className="card card-flush">
        <div className="card-head"><div><h2>Payout batches</h2><p>Newest first.</p></div></div>
        {batches.length === 0 ? <EmptyState icon="bank" title="No batches yet">Create a batch from the approved claims above.</EmptyState> : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Batch</th><th>Status</th><th className="hide-mobile">Created</th>
                    <th className="num">Claims</th><th className="num">Total</th><th className="hide-mobile">Paid on</th><th />
                  </tr>
                </thead>
                <tbody>
                  {batchPager.pageItems.map((b) => (
                    <tr key={b.id}>
                      <td className="nowrap strong">{b.batchNumber}</td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="nowrap hide-mobile">{formatDateTime(b.createdAt)}</td>
                      <td className="num">{b.claimCount}</td>
                      <td className="num strong"><Money value={b.totalAmount} /></td>
                      <td className="nowrap hide-mobile">{b.paidAt ? formatDate(b.paidAt) : '—'}</td>
                      <td>
                        <div className="actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                          <button type="button" className="btn-sm" disabled={busyId !== null} onClick={() => downloadCsv(b)}>
                            {busyId === `csv-${b.id}` ? <span className="spinner" /> : <Icon name="download" size={14} />} CSV
                          </button>
                          {b.status === 'EXPORTED' && (
                            <button type="button" className="btn-sm btn-primary" disabled={busyId !== null} onClick={() => markPaid(b)}>
                              {busyId === `paid-${b.id}` ? <span className="spinner" /> : <Icon name="check" size={14} />} Mark paid
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...batchPager} />
          </>
        )}
      </section>
    </>
  );
}
