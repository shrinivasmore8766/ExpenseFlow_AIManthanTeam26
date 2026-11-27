// Claim CRUD, validation and every policy rule through the real submit endpoint.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  call, ok, draftClaim, submittedClaim, form, uniquePng, weekday, saturday, vendor, codes, todayUtc,
} from './lib.mjs';

const CLAIMANT = 'employee2';

describe('Claim drafts and validation', () => {
  test('EXP-01 create, rename, add/edit/delete lines, delete draft', async () => {
    let c = await ok(CLAIMANT, 'POST', '/api/claims', { title: 'QA draft lifecycle' });
    assert.equal(c.status, 'DRAFT');
    assert.deepEqual(c.allowedActions, ['EDIT', 'SUBMIT', 'DELETE']);
    c = await ok(CLAIMANT, 'PUT', `/api/claims/${c.id}`, { title: 'QA draft renamed' });
    assert.equal(c.title, 'QA draft renamed');
    c = await ok(CLAIMANT, 'POST', `/api/claims/${c.id}/lines`,
      { category: 'MEAL', expenseDate: weekday(0), amount: 100, vendor: vendor() });
    c = await ok(CLAIMANT, 'POST', `/api/claims/${c.id}/lines`,
      { category: 'LOCAL_CAB', expenseDate: weekday(0), amount: 250.5, vendor: vendor() });
    assert.equal(c.lines.length, 2);
    assert.equal(c.totalAmount, 350.5);
    const lineId = c.lines[0].id;
    c = await ok(CLAIMANT, 'PUT', `/api/claims/${c.id}/lines/${lineId}`,
      { category: 'MEAL', expenseDate: weekday(0), amount: 120, vendor: 'Edited vendor' });
    assert.equal(c.lines.find((l) => l.id === lineId).amount, 120);
    c = await ok(CLAIMANT, 'DELETE', `/api/claims/${c.id}/lines/${lineId}`);
    assert.equal(c.lines.length, 1);
    await ok(CLAIMANT, 'DELETE', `/api/claims/${c.id}`, undefined, 204);
    assert.equal((await call(CLAIMANT, 'GET', `/api/claims/${c.id}`)).status, 404);
  });

  test('EXP-02 title is required and limited', async () => {
    assert.equal((await call(CLAIMANT, 'POST', '/api/claims', { title: '' })).status, 400);
    assert.equal((await call(CLAIMANT, 'POST', '/api/claims', {})).status, 400);
    assert.equal((await call(CLAIMANT, 'POST', '/api/claims', { title: 'x'.repeat(201) })).status, 400);
  });

  const invalidLines = [
    ['missing category', { expenseDate: weekday(0), amount: 10, vendor: 'v' }, 'category'],
    ['zero amount', { category: 'MEAL', expenseDate: weekday(0), amount: 0, vendor: 'v' }, 'amount'],
    ['negative amount', { category: 'MEAL', expenseDate: weekday(0), amount: -5, vendor: 'v' }, 'amount'],
    ['three decimals', { category: 'MEAL', expenseDate: weekday(0), amount: 10.125, vendor: 'v' }, 'amount'],
    ['amount above 10,00,000', { category: 'TRAVEL', expenseDate: weekday(0), amount: 1000000.01, vendor: 'v' }, 'amount'],
    ['missing vendor', { category: 'MEAL', expenseDate: weekday(0), amount: 10, vendor: '  ' }, 'vendor'],
    ['missing date', { category: 'MEAL', amount: 10, vendor: 'v' }, 'expenseDate'],
    ['hotel without city/nights', { category: 'HOTEL', expenseDate: weekday(0), amount: 10, vendor: 'v' }, 'hotelDetailsValid'],
    ['hotel with 0 nights', { category: 'HOTEL', expenseDate: weekday(0), amount: 10, vendor: 'v', city: 'Pune', nights: 0 }, 'nights'],
    ['unknown category', { category: 'CASINO', expenseDate: weekday(0), amount: 10, vendor: 'v' }, null],
    ['bad date format', { category: 'MEAL', expenseDate: '27/11/2026', amount: 10, vendor: 'v' }, null],
  ];
  for (const [label, body, field] of invalidLines) {
    test(`EXP-03 line validation rejects ${label}`, async () => {
      const c = await ok(CLAIMANT, 'POST', '/api/claims', { title: 'QA validation' });
      const r = await call(CLAIMANT, 'POST', `/api/claims/${c.id}/lines`, body);
      assert.equal(r.status, 400, r.text);
      if (field) assert.ok(r.json.errors && field in r.json.errors, `errors should name ${field}: ${r.text}`);
      await ok(CLAIMANT, 'DELETE', `/api/claims/${c.id}`, undefined, 204);
    });
  }

  test('EXP-04 future expense date is accepted by the API (documented gap, see DEF-03)', async () => {
    const c = await ok(CLAIMANT, 'POST', '/api/claims', { title: 'QA future date' });
    const r = await call(CLAIMANT, 'POST', `/api/claims/${c.id}/lines`,
      { category: 'MEAL', expenseDate: todayUtc(30), amount: 10, vendor: 'v' });
    // Recorded as-is: requirement A16 (reject future dates) is not enforced server-side; the UI blocks it.
    assert.equal(r.status, 200);
    await ok(CLAIMANT, 'DELETE', `/api/claims/${c.id}`, undefined, 204);
  });

  test('EXP-05 submitting a claim without lines is refused', async () => {
    const c = await ok(CLAIMANT, 'POST', '/api/claims', { title: 'QA empty' });
    const r = await call(CLAIMANT, 'POST', `/api/claims/${c.id}/submit`);
    assert.equal(r.status, 400);
    await ok(CLAIMANT, 'DELETE', `/api/claims/${c.id}`, undefined, 204);
  });

  test('EXP-06 a submitted claim can no longer be edited, deleted or resubmitted', async () => {
    const c = await submittedClaim(CLAIMANT, 'locked after submit', [{ category: 'TRAVEL', amount: 300, date: weekday(1) }]);
    assert.equal(c.status, 'PENDING_MANAGER');
    assert.deepEqual(c.allowedActions, []);
    assert.equal((await call(CLAIMANT, 'PUT', `/api/claims/${c.id}`, { title: 'x' })).status, 409);
    assert.equal((await call(CLAIMANT, 'POST', `/api/claims/${c.id}/lines`,
      { category: 'MEAL', expenseDate: weekday(1), amount: 1, vendor: 'v' })).status, 409);
    assert.equal((await call(CLAIMANT, 'DELETE', `/api/claims/${c.id}`)).status, 409);
    assert.equal((await call(CLAIMANT, 'POST', `/api/claims/${c.id}/submit`)).status, 409);
  });

  test('EXP-07 receipt can be replaced and is served back with the right type', async () => {
    let c = await draftClaim(CLAIMANT, 'receipt replace', [{ category: 'MEAL', amount: 100, receipt: true }]);
    const line = c.lines[0];
    assert.equal(line.hasReceipt, true);
    c = await ok(CLAIMANT, 'POST', `/api/claims/${c.id}/lines/${line.id}/receipt`,
      form(Buffer.concat([Buffer.from('%PDF-1.4\n'), uniquePng()]), 'r.pdf', 'application/pdf'));
    assert.equal(c.lines[0].receiptContentType, 'application/pdf');
    const r = await call(CLAIMANT, 'GET', `/api/claims/${c.id}/lines/${line.id}/receipt`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    await ok(CLAIMANT, 'DELETE', `/api/claims/${c.id}`, undefined, 204);
  });
});

/** Submits a one-line claim and returns { claim, line }. */
async function one(title, line) {
  const claim = await submittedClaim(CLAIMANT, title, [line]);
  return { claim, line: claim.lines[0] };
}

describe('Policy rules through the submit API', () => {
  test('POL-API-01 meals: 1500 within limit, 1500.01 routed with reason', async () => {
    const atLimit = await one('meal at limit', { category: 'MEAL', amount: 1500, receipt: true, date: weekday(2) });
    assert.deepEqual(codes(atLimit.line), []);
    assert.ok(['APPROVED', 'PENDING_AUDITOR'].includes(atLimit.claim.status));
    assert.equal(atLimit.claim.autoApproved, true);
    const above = await one('meal above', { category: 'MEAL', amount: 1500.01, receipt: true, date: weekday(3) });
    assert.deepEqual(codes(above.line), ['MEAL_DAILY_LIMIT']);
    assert.equal(above.line.outcome, 'ROUTE');
    assert.equal(above.claim.status, 'PENDING_MANAGER');
    assert.match(above.line.violations[0].message, /above the daily limit of ₹1500/);
  });

  test('POL-API-02 meals: two claims on the same day add up for the daily limit', async () => {
    await one('meal day part 1', { category: 'MEAL', amount: 1000, receipt: true, date: weekday(4) });
    const second = await one('meal day part 2', { category: 'MEAL', amount: 500.01, receipt: true, date: weekday(4) });
    assert.deepEqual(codes(second.line), ['MEAL_DAILY_LIMIT']);
  });

  test('POL-API-03 hotel tier-1: 6000/night ok, 6000.01/night routed', async () => {
    const at = await one('hotel t1 at', { category: 'HOTEL', amount: 12000, city: 'Mumbai', nights: 2, receipt: true, date: weekday(5) });
    assert.deepEqual(codes(at.line), []);
    const above = await one('hotel t1 above', { category: 'HOTEL', amount: 12000.02, city: 'Mumbai', nights: 2, receipt: true, date: weekday(5) });
    assert.deepEqual(codes(above.line), ['HOTEL_TIER1_LIMIT']);
    assert.equal(above.claim.status, 'PENDING_MANAGER');
  });

  test('POL-API-04 hotel other city: 4000/night ok, 4000.01/night routed', async () => {
    const at = await one('hotel other at', { category: 'HOTEL', amount: 4000, city: 'Nagpur', nights: 1, receipt: true, date: weekday(5) });
    assert.deepEqual(codes(at.line), []);
    const above = await one('hotel other above', { category: 'HOTEL', amount: 4000.01, city: 'Nagpur', nights: 1, receipt: true, date: weekday(5) });
    assert.deepEqual(codes(above.line), ['HOTEL_OTHER_LIMIT']);
  });

  test('POL-API-05 cab: 2000 ok, 2000.01 routed', async () => {
    const at = await one('cab at', { category: 'LOCAL_CAB', amount: 2000, receipt: true, date: weekday(5) });
    assert.deepEqual(codes(at.line), []);
    const above = await one('cab above', { category: 'LOCAL_CAB', amount: 2000.01, receipt: true, date: weekday(5) });
    assert.deepEqual(codes(above.line), ['CAB_TRIP_LIMIT']);
    assert.equal(above.claim.status, 'PENDING_MANAGER');
  });

  test('POL-API-06 receipt: 500 without receipt ok, 500.01 without receipt auto-rejected', async () => {
    const at = await one('receipt at', { category: 'LOCAL_CAB', amount: 500, date: weekday(5) });
    assert.deepEqual(codes(at.line), []);
    const above = await one('receipt above', { category: 'LOCAL_CAB', amount: 500.01, date: weekday(5) });
    assert.deepEqual(codes(above.line), ['RECEIPT_REQUIRED']);
    assert.equal(above.line.outcome, 'AUTO_REJECT');
    assert.equal(above.claim.status, 'REJECTED');
    assert.equal(above.claim.approvedAmount, 0);
  });

  test('POL-API-07 duplicate vendor + amount + date across claims is routed', async () => {
    const v = vendor('DupVendor');
    const first = await one('dup expense 1', { category: 'LOCAL_CAB', amount: 450, vendor: v, date: weekday(6) });
    assert.deepEqual(codes(first.line), []);
    const second = await one('dup expense 2', { category: 'LOCAL_CAB', amount: 450, vendor: `  ${v.toUpperCase()} `, date: weekday(6) });
    assert.deepEqual(codes(second.line), ['DUPLICATE_EXPENSE']);
    assert.equal(second.claim.status, 'PENDING_MANAGER');
  });

  test('POL-API-08 duplicate receipt file is auto-rejected (any employee)', async () => {
    const bytes = uniquePng();
    const first = await one('dup receipt 1', { category: 'LOCAL_CAB', amount: 600, receipt: bytes, date: weekday(7) });
    assert.deepEqual(codes(first.line), []);
    const second = await submittedClaim('employee', 'dup receipt 2', [{ category: 'LOCAL_CAB', amount: 700, receipt: bytes, date: weekday(8) }]);
    assert.deepEqual(codes(second.lines[0]), ['DUPLICATE_RECEIPT']);
    assert.equal(second.status, 'REJECTED');
  });

  test('POL-API-09 weekend expense is flagged for the manager', async () => {
    const r = await one('weekend', { category: 'LOCAL_CAB', amount: 300, date: saturday(1) });
    assert.deepEqual(codes(r.line), ['WEEKEND_EXPENSE']);
    assert.equal(r.claim.status, 'PENDING_MANAGER');
    const history = r.claim.history.find((h) => h.action === 'POLICY_DECISION');
    assert.match(history.comment, /WEEKEND_EXPENSE/);
    assert.equal(history.actorName, 'System (policy engine)');
  });

  test('POL-API-10 auto-approve limit: 5000 clean -> auto-approved, 5000.01 -> manager', async () => {
    const at = await one('auto 5000', { category: 'HOTEL', amount: 5000, city: 'Pune', nights: 1, receipt: true, date: weekday(9) });
    assert.equal(at.claim.autoApproved, true);
    assert.ok(['APPROVED', 'PENDING_AUDITOR'].includes(at.claim.status));
    if (at.claim.status === 'PENDING_AUDITOR') assert.equal(at.claim.sampleAudit, true);
    const above = await one('auto 5000.01', { category: 'HOTEL', amount: 5000.01, city: 'Pune', nights: 1, receipt: true, date: weekday(9) });
    assert.equal(above.claim.status, 'PENDING_MANAGER');
    assert.equal(above.claim.autoApproved, false);
  });
});
