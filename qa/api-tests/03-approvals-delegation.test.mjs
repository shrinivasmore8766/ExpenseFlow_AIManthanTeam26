// Approval thresholds (exact boundaries), chain integrity, history, clarification, bulk approve, delegation.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  call, ok, submittedClaim, approve, reject, sendBack, weekday, todayUtc,
} from './lib.mjs';

const CLAIMANT = 'employee'; // reports to `manager` (Vikram Rao)

/** One TRAVEL line (always routed to a human) with a receipt, so approvedAmount == amount. */
const travel = (amount, n = 10) => [{ category: 'TRAVEL', amount, receipt: true, date: weekday(n) }];

async function expectStatus(user, id, status) {
  const c = await ok(user, 'GET', `/api/claims/${id}`);
  assert.equal(c.status, status);
  return c;
}

describe('Approval thresholds (exact boundaries)', () => {
  test('THR-01 ₹25,000: manager approval is final', async () => {
    const c = await submittedClaim(CLAIMANT, 'threshold 25000', travel(25000));
    assert.equal(c.status, 'PENDING_MANAGER');
    assert.equal(c.currentApproverName, 'Vikram Rao');
    const r = await approve('manager', c.id, 'ok');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'APPROVED');
    assert.equal((await approve('auditor', c.id)).status, 409); // nothing left to approve
  });

  test('THR-02 ₹25,001: manager then auditor', async () => {
    const c = await submittedClaim(CLAIMANT, 'threshold 25001', travel(25001));
    assert.equal((await approve('manager', c.id)).json.status, 'PENDING_AUDITOR');
    const r = await approve('auditor', c.id);
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'APPROVED');
  });

  test('THR-03 ₹1,00,000: manager then auditor, no finance head', async () => {
    const c = await submittedClaim(CLAIMANT, 'threshold 100000', travel(100000));
    assert.equal((await approve('manager', c.id)).json.status, 'PENDING_AUDITOR');
    assert.equal((await approve('auditor', c.id)).json.status, 'APPROVED');
  });

  test('THR-04 ₹1,00,001: manager, auditor, finance head; no level can be skipped', async () => {
    const c = await submittedClaim(CLAIMANT, 'threshold 100001', travel(100001));
    // PENDING_MANAGER: auditor / finance head / other employee cannot jump the queue
    assert.equal((await approve('auditor', c.id)).status, 403);
    assert.equal((await approve('financehead', c.id)).status, 403);
    assert.equal((await approve('employee2', c.id)).status, 404);
    assert.equal((await approve(CLAIMANT, c.id)).status, 403); // own claim
    assert.equal((await approve('manager', c.id)).json.status, 'PENDING_AUDITOR');
    // PENDING_AUDITOR: manager (already approved) and finance head cannot act
    assert.equal((await approve('manager', c.id)).status, 403);
    assert.equal((await approve('financehead', c.id)).status, 403);
    assert.equal((await approve('auditor', c.id)).json.status, 'PENDING_FINANCE_HEAD');
    // PENDING_FINANCE_HEAD: the other auditor and the manager cannot act
    assert.equal((await approve('auditor2', c.id)).status, 403);
    assert.equal((await approve('manager', c.id)).status, 403);
    const fh = await approve('financehead', c.id, 'final approval');
    assert.equal(fh.json.status, 'APPROVED');
    const chain = fh.json.history.filter((h) => h.action === 'APPROVE').map((h) => `${h.fromStatus}>${h.toStatus}:${h.actorName}`);
    assert.deepEqual(chain, [
      'PENDING_MANAGER>PENDING_AUDITOR:Vikram Rao',
      'PENDING_AUDITOR>PENDING_FINANCE_HEAD:Anil Kumar',
      'PENDING_FINANCE_HEAD>APPROVED:Priya Sharma',
    ]);
  });

  test('THR-05 queue membership follows the current level', async () => {
    const c = await submittedClaim(CLAIMANT, 'queue membership', travel(30000, 11));
    const inQueue = async (u) => (await ok(u, 'GET', '/api/approvals')).some((x) => x.id === c.id);
    assert.equal(await inQueue('manager'), true);
    assert.equal(await inQueue('auditor'), false);
    await approve('manager', c.id);
    assert.equal(await inQueue('manager'), false);
    assert.equal(await inQueue('auditor'), true);
    assert.equal(await inQueue('auditor2'), true);
    await approve('auditor2', c.id);
    assert.equal(await inQueue('auditor'), false);
  });
});

describe('Reject, clarification, history and concurrency', () => {
  test('APR-01 reject and send back require a comment', async () => {
    const c = await submittedClaim(CLAIMANT, 'comment required', travel(1200, 12));
    assert.equal((await reject('manager', c.id, '')).status, 400);
    assert.equal((await reject('manager', c.id, '   ')).status, 400);
    assert.equal((await sendBack('manager', c.id, '')).status, 400);
    await expectStatus(CLAIMANT, c.id, 'PENDING_MANAGER');
  });

  test('APR-02 a rejected claim is final and never reaches payout', async () => {
    const c = await submittedClaim(CLAIMANT, 'rejected', travel(1300, 12));
    const r = await reject('manager', c.id, 'Not a business expense');
    assert.equal(r.json.status, 'REJECTED');
    assert.equal((await approve('manager', c.id)).status, 409);
    assert.equal((await approve('auditor', c.id)).status, 409);
    const eligible = await ok('financehead', 'GET', '/api/payouts/eligible');
    assert.ok(!eligible.some((x) => x.id === c.id));
    const h = r.json.history.at(-1);
    assert.equal(h.action, 'REJECT');
    assert.equal(h.comment, 'Not a business expense');
    assert.equal(h.actorName, 'Vikram Rao');
  });

  test('APR-03 clarification: send back, employee edits and resubmits, chain restarts at the manager', async () => {
    let c = await submittedClaim(CLAIMANT, 'clarification', travel(30000, 13));
    c = (await approve('manager', c.id)).json;
    assert.equal(c.status, 'PENDING_AUDITOR');
    c = (await sendBack('auditor', c.id, 'Attach the boarding pass')).json;
    assert.equal(c.status, 'CLARIFICATION_REQUESTED');
    const mine = await ok(CLAIMANT, 'GET', `/api/claims/${c.id}`);
    assert.deepEqual(mine.allowedActions, ['EDIT', 'SUBMIT']);
    const line = mine.lines[0];
    await ok(CLAIMANT, 'PUT', `/api/claims/${c.id}/lines/${line.id}`,
      { category: 'TRAVEL', expenseDate: line.expenseDate, amount: 29000, vendor: line.vendor });
    c = await ok(CLAIMANT, 'POST', `/api/claims/${c.id}/submit`);
    assert.equal(c.status, 'PENDING_MANAGER');            // restarts at the manager, not the auditor
    assert.equal(c.totalAmount, 29000);
    c = (await approve('manager', c.id)).json;          // manager may approve again in the new round
    assert.equal(c.status, 'PENDING_AUDITOR');
    c = (await approve('auditor', c.id)).json;
    assert.equal(c.status, 'APPROVED');
    const actions = c.history.map((h) => h.action);
    assert.deepEqual(actions, ['SUBMIT', 'POLICY_DECISION', 'APPROVE', 'SEND_BACK', 'SUBMIT', 'POLICY_DECISION', 'APPROVE', 'APPROVE']);
    assert.ok(c.history.every((h, i) => i === 0 || h.at >= c.history[i - 1].at), 'history is chronological');
  });

  test('APR-04 concurrent approvals of the same claim: exactly one succeeds', async () => {
    const c = await submittedClaim(CLAIMANT, 'concurrent', travel(1400, 14));
    const results = await Promise.all([approve('manager', c.id), approve('manager', c.id), approve('manager', c.id)]);
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 200).length, 1, `statuses ${statuses}`);
    assert.ok(statuses.filter((s) => s !== 200).every((s) => [403, 409].includes(s)), `statuses ${statuses}`);
    const final = await ok(CLAIMANT, 'GET', `/api/claims/${c.id}`);
    assert.equal(final.history.filter((h) => h.action === 'APPROVE').length, 1);
  });

  test('APR-05 bulk approve skips flagged claims and claims the caller cannot act on', async () => {
    const flagged = await submittedClaim(CLAIMANT, 'bulk flagged', travel(26000, 15));
    await approve('manager', flagged.id); // now PENDING_AUDITOR, has NO_LIMIT_CATEGORY violation
    const notMine = await submittedClaim(CLAIMANT, 'bulk not auditor level', travel(1500, 15));
    const r = await ok('auditor', 'POST', '/api/approvals/bulk-approve', { claimIds: [flagged.id, notMine.id, 999999999] });
    assert.deepEqual(r.approved, []);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.id, s.reason]));
    assert.equal(reasons[flagged.id], 'Has policy violations; review it individually');
    assert.ok(reasons[notMine.id]);
    assert.equal(reasons[999999999], 'Claim not found');
  });
});

describe('Delegation', () => {
  let maria;
  const created = [];
  after(async () => {
    for (const id of created) await call('manager', 'DELETE', `/api/delegations/${id}`);
  });

  test('DEL-00 find the delegate (maria.sharma, a manager in another reporting line)', async () => {
    const users = await ok('manager', 'GET', '/api/users?role=MANAGER');
    maria = users.find((u) => u.username === 'maria.sharma');
    assert.ok(maria);
  });

  test('DEL-01 invalid delegations are rejected', async () => {
    const me = await ok('manager', 'GET', '/api/me');
    const cases = [
      [{ delegateId: me.id, startDate: todayUtc(), endDate: todayUtc(1) }, 400, 'self'],
      [{ delegateId: maria.id, startDate: todayUtc(3), endDate: todayUtc(1) }, 400, 'end before start'],
      [{ delegateId: maria.id, startDate: todayUtc(-10), endDate: todayUtc(-1) }, 400, 'already expired'],
      [{ delegateId: 999999999, startDate: todayUtc(), endDate: todayUtc(1) }, 400, 'unknown delegate'],
      [{ startDate: todayUtc(), endDate: todayUtc(1) }, 400, 'missing delegate'],
    ];
    for (const [body, status, label] of cases) {
      const r = await call('manager', 'POST', '/api/delegations', body);
      assert.equal(r.status, status, `${label}: ${r.text}`);
    }
  });

  test('DEL-02 employees cannot create delegations', async () => {
    const r = await call('employee', 'POST', '/api/delegations', { delegateId: maria.id, startDate: todayUtc(), endDate: todayUtc() });
    assert.equal(r.status, 403);
  });

  test('DEL-03 a future delegation gives no rights yet', async () => {
    const d = await ok('manager', 'POST', '/api/delegations', { delegateId: maria.id, startDate: todayUtc(2), endDate: todayUtc(4) });
    created.push(d.id);
    assert.equal(d.active, false);
    const c = await submittedClaim(CLAIMANT, 'future delegation', travel(1600, 16));
    assert.equal((await approve('maria.sharma', c.id)).status, 404);
    await ok('manager', 'DELETE', `/api/delegations/${d.id}`, undefined, 204);
    created.pop();
  });

  test('DEL-04 active delegate approves on behalf of the manager; identity kept in history', async () => {
    const d = await ok('manager', 'POST', '/api/delegations', { delegateId: maria.id, startDate: todayUtc(), endDate: todayUtc(2) });
    created.push(d.id);
    assert.equal(d.active, true);
    const c = await submittedClaim(CLAIMANT, 'delegated approval', travel(1700, 17));
    const queue = await ok('maria.sharma', 'GET', '/api/approvals');
    assert.ok(queue.some((x) => x.id === c.id), 'claim appears in the delegate queue');
    const r = await approve('maria.sharma', c.id, 'Approving while Vikram is on leave');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'APPROVED');
    const h = r.json.history.at(-1);
    assert.equal(h.actorName, 'Maria Sharma');
    assert.equal(h.onBehalfOfName, 'Vikram Rao');
  });

  test('DEL-05 delegate cannot exceed the delegator: no auditor-level approval', async () => {
    const c = await submittedClaim(CLAIMANT, 'delegate scope', travel(26000, 18));
    assert.equal((await approve('manager', c.id)).json.status, 'PENDING_AUDITOR');
    const r = await approve('maria.sharma', c.id);
    assert.ok([403, 404].includes(r.status), `got ${r.status}`);
  });

  test('DEL-06 only the delegator can remove a delegation; removal revokes rights', async () => {
    const id = created[0];
    assert.equal((await call('auditor', 'DELETE', `/api/delegations/${id}`)).status, 404);
    await ok('manager', 'DELETE', `/api/delegations/${id}`, undefined, 204);
    created.shift();
    const c = await submittedClaim(CLAIMANT, 'after revoke', travel(1800, 19));
    assert.equal((await approve('maria.sharma', c.id)).status, 404);
    assert.equal((await approve('manager', c.id)).status, 200);
  });
});
