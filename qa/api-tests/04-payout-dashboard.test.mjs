// Payout batch, CSV export, mark paid, dashboard, policy rule administration and audit trail.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, call, ok, submittedClaim, approve, weekday, RUN } from './lib.mjs';

describe('Payout and CSV export', () => {
  let claim;
  let batch;

  test('PAY-01 an approved claim becomes eligible for payout', async () => {
    claim = await submittedClaim('employee', 'payout candidate', [{ category: 'TRAVEL', amount: 2345.67, receipt: true, date: weekday(20) }]);
    assert.equal((await approve('manager', claim.id)).json.status, 'APPROVED');
    const eligible = await ok('financehead', 'GET', '/api/payouts/eligible');
    assert.ok(eligible.some((c) => c.id === claim.id));
  });

  test('PAY-02 finance head creates a batch with every eligible claim', async () => {
    const before = await ok('financehead', 'GET', '/api/payouts/eligible');
    batch = await ok('financehead', 'POST', '/api/payouts');
    assert.equal(batch.status, 'EXPORTED');
    assert.equal(batch.claimCount, before.length);
    const sum = before.reduce((s, c) => s + c.approvedAmount, 0);
    assert.ok(Math.abs(batch.totalAmount - sum) < 0.005, `total ${batch.totalAmount} vs ${sum}`);
    assert.deepEqual(await ok('financehead', 'GET', '/api/payouts/eligible'), []);
    assert.equal((await call('financehead', 'POST', '/api/payouts')).status, 409); // nothing left
  });

  test('PAY-03 CSV has header, one detail row per claim, trailer, and the CSV-injection guard', async () => {
    const r = await fetch(`${BASE}/api/payouts/${batch.id}/csv`, {
      headers: { Authorization: `Basic ${Buffer.from('financehead:Demo@123').toString('base64')}` },
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.match(r.headers.get('content-disposition'), new RegExp(`payout_${batch.batchNumber}\\.csv`));
    const rows = (await r.text()).trim().split('\r\n');
    assert.match(rows[0], new RegExp(`^H,EXPENSEFLOW,${batch.batchNumber},\\d{4}-\\d{2}-\\d{2},${batch.claimCount},${batch.totalAmount.toFixed(2)}$`));
    assert.equal(rows.at(-1), `T,${batch.claimCount},${batch.totalAmount.toFixed(2)}`);
    assert.equal(rows.length, batch.claimCount + 2);
    const mine = rows.find((row) => row.startsWith(`D,${claim.claimNumber},`));
    assert.ok(mine, 'detail row for the QA claim');
    assert.match(mine, /,2345\.67,INR,/);
    assert.ok(rows.slice(1, -1).every((row) => row.startsWith('D,')));
    assert.ok(rows.every((row) => !/(^|,)[=+@]/.test(row)), 'no unescaped formula cells');
  });

  test('PAY-04 only the finance head can download or mark paid', async () => {
    assert.equal((await call('auditor', 'GET', `/api/payouts/${batch.id}/csv`)).status, 403);
    assert.equal((await call('employee', 'POST', `/api/payouts/${batch.id}/mark-paid`)).status, 403);
  });

  test('PAY-05 mark paid moves every claim to PAID once', async () => {
    const paid = await ok('financehead', 'POST', `/api/payouts/${batch.id}/mark-paid`);
    assert.equal(paid.status, 'PAID');
    assert.ok(paid.paidAt);
    assert.equal((await call('financehead', 'POST', `/api/payouts/${batch.id}/mark-paid`)).status, 409);
    const c = await ok('employee', 'GET', `/api/claims/${claim.id}`);
    assert.equal(c.status, 'PAID');
    const h = c.history.at(-1);
    assert.equal(h.action, 'PAID');
    assert.equal(h.comment, `Paid in batch ${batch.batchNumber}`);
  });

  test('PAY-06 unknown batch -> 404', async () => {
    assert.equal((await call('financehead', 'GET', '/api/payouts/999999999/csv')).status, 404);
  });
});

describe('Dashboard and policy administration', () => {
  test('DASH-01 dashboard returns every documented series for finance roles', async () => {
    const d = await ok('financehead', 'GET', '/api/dashboard');
    for (const k of ['spendByCategory', 'spendByDepartment', 'spendByMonth', 'violationsByRule', 'pendingByStatus']) {
      assert.ok(Array.isArray(d[k]), k);
    }
    assert.equal(typeof d.avgApprovalHours, 'number');
    assert.deepEqual(d.pendingByStatus.map((p) => p.label), ['PENDING_MANAGER', 'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD']);
    assert.ok(d.spendByMonth.length <= 13);
  });

  test('DASH-02 a manager sees only their own department', async () => {
    const d = await ok('manager', 'GET', '/api/dashboard');
    const labels = d.spendByDepartment.map((x) => x.label);
    assert.ok(labels.every((l) => l === 'Engineering'), `departments: ${labels}`);
  });

  test('POLADM-01 finance head can change a limit; invalid values rejected; change is reverted', async () => {
    const rules = await ok('employee', 'GET', '/api/policy-rules');
    const cab = rules.find((r) => r.code === 'CAB_TRIP_LIMIT');
    assert.equal((await call('financehead', 'PUT', `/api/policy-rules/${cab.id}`, { limitAmount: -1, active: true })).status, 400);
    assert.equal((await call('financehead', 'PUT', `/api/policy-rules/${cab.id}`, { limitAmount: 2100 })).status, 400);
    const changed = await ok('financehead', 'PUT', `/api/policy-rules/${cab.id}`, { limitAmount: 2100, active: true });
    assert.equal(changed.limitAmount, 2100);
    const restored = await ok('financehead', 'PUT', `/api/policy-rules/${cab.id}`, { limitAmount: cab.limitAmount, active: cab.active });
    assert.equal(restored.limitAmount, cab.limitAmount);
  });

  test('AUD-01 every claim action leaves a history entry with actor and time', async () => {
    const list = await ok('employee', 'GET', '/api/claims');
    const qa = list.filter((c) => c.title.startsWith(RUN) && c.status !== 'DRAFT').slice(0, 5);
    assert.ok(qa.length > 0);
    for (const s of qa) {
      const c = await ok('employee', 'GET', `/api/claims/${s.id}`);
      assert.ok(c.history.length >= 2, `${c.claimNumber} history`);
      assert.ok(c.history.every((h) => h.at && h.actorName && h.action));
    }
  });
});
