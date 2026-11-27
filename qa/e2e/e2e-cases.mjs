// The 10 written end-to-end cases (docs/testing/03-e2e-test-cases.md), executed through the real UI.
// Writes docs/testing/evidence/e2e-results.json and one screenshot per case.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  launch, closeBrowser, login, createClaim, submit, decide, statusText, violationCodes, historyEntries,
  shot, dialog, receiptFile, wednesday, saturday, vendor, todayLocal, UI, RUN, EVIDENCE,
} from './ui.mjs';

const results = [];

async function runCase(id, scenario, fn) {
  const started = Date.now();
  const observed = {};
  const sessions = [];
  const open = async (user, opts) => { const s = await login(user, opts); sessions.push(s); return s.page; };
  try {
    await fn({ observed, open });
    const problems = sessions.flatMap((s) => s.page.problems);
    if (problems.length) throw new Error(`Browser problems: ${problems.join(' | ')}`);
    results.push({ id, scenario, status: 'Pass', observed, ms: Date.now() - started });
    console.log(`PASS ${id} ${scenario}`);
  } catch (e) {
    results.push({ id, scenario, status: 'Fail', observed, error: e.message.split('\n')[0], ms: Date.now() - started });
    console.log(`FAIL ${id} ${scenario}: ${e.message.split('\n')[0]}`);
  } finally {
    for (const s of sessions) await s.ctx.close();
  }
}

await launch();
const approvedForPayout = [];

await runCase('E2E-01', 'Normal expense submission and manager approval', async ({ observed, open }) => {
  const emp = await open('employee');
  const id = await createClaim(emp, 'E2E-01 Nagpur visit', [
    { category: 'HOTEL', amount: 7000, date: wednesday(0), vendor: vendor('Hotel Centre Point'), city: 'Nagpur', nights: 2, receipt: receiptFile('e2e01') },
  ]);
  await submit(emp);
  observed.claimId = id;
  observed.afterSubmit = await statusText(emp);
  observed.violations = await violationCodes(emp);
  observed.policyMessage = await emp.locator('.alert').filter({ hasText: 'Policy engine' }).innerText();
  assert.equal(observed.afterSubmit, 'Pending · Manager');
  assert.deepEqual(observed.violations, []);
  assert.match(observed.policyMessage, /amount above auto-approve limit ₹5000/);
  const mgr = await open('manager');
  await mgr.getByRole('link', { name: /Approvals/ }).click();
  await mgr.locator(`a.claim-link[href="/claims/${id}"]`).waitFor();
  await decide(mgr, id, 'Approve', 'Approved - client visit');
  observed.afterManager = await statusText(mgr);
  assert.equal(observed.afterManager, 'Approved');
  observed.history = (await historyEntries(mgr)).map((h) => h.head);
  assert.ok(observed.history.some((h) => /Approved by Vikram Rao/.test(h)));
  observed.screenshot = await shot(mgr, 'E2E-01-approved');
  approvedForPayout.push(id);
});

await runCase('E2E-02', 'Expense above ₹25,000 requires auditor review', async ({ observed, open }) => {
  const emp = await open('employee');
  const id = await createClaim(emp, 'E2E-02 Mumbai week', [
    { category: 'HOTEL', amount: 26000, date: wednesday(1), vendor: vendor('Trident'), city: 'Mumbai', nights: 5, receipt: receiptFile('e2e02') },
  ]);
  await submit(emp);
  observed.claimId = id;
  observed.afterSubmit = await statusText(emp);
  assert.equal(observed.afterSubmit, 'Pending · Manager');
  const mgr = await open('manager');
  await decide(mgr, id, 'Approve');
  observed.afterManager = await statusText(mgr);
  assert.equal(observed.afterManager, 'Pending · Auditor');
  const aud = await open('auditor');
  await aud.getByRole('link', { name: /Audit queue/ }).click();
  await aud.locator(`a.claim-link[href="/claims/${id}"]`).waitFor();
  await decide(aud, id, 'Approve', 'Hotel within tier-1 limit');
  observed.afterAuditor = await statusText(aud);
  assert.equal(observed.afterAuditor, 'Approved');
  observed.screenshot = await shot(aud, 'E2E-02-auditor-approved');
  approvedForPayout.push(id);
});

await runCase('E2E-03', 'Expense above ₹1,00,000 requires finance head approval', async ({ observed, open }) => {
  const emp = await open('employee');
  const id = await createClaim(emp, 'E2E-03 Mumbai project stay', [
    { category: 'HOTEL', amount: 110000, date: wednesday(2), vendor: vendor('Taj Lands End'), city: 'Mumbai', nights: 20, receipt: receiptFile('e2e03') },
  ]);
  await submit(emp);
  observed.claimId = id;
  const mgr = await open('manager');
  await decide(mgr, id, 'Approve');
  observed.afterManager = await statusText(mgr);
  const aud = await open('auditor');
  await decide(aud, id, 'Approve');
  observed.afterAuditor = await statusText(aud);
  assert.equal(observed.afterManager, 'Pending · Auditor');
  assert.equal(observed.afterAuditor, 'Pending · Finance Head');
  const fh = await open('financehead');
  await decide(fh, id, 'Approve', 'Project stay approved');
  observed.afterFinanceHead = await statusText(fh);
  assert.equal(observed.afterFinanceHead, 'Approved');
  observed.approvals = (await historyEntries(fh)).map((h) => h.head).filter((h) => h.startsWith('Approved'));
  assert.equal(observed.approvals.length, 3);
  observed.screenshot = await shot(fh, 'E2E-03-finance-head-approved');
  approvedForPayout.push(id);
});

await runCase('E2E-04', 'Expense exceeding a policy limit (cab ₹2,500 > ₹2,000/trip)', async ({ observed, open }) => {
  const emp = await open('employee');
  const id = await createClaim(emp, 'E2E-04 airport cab', [
    { category: 'LOCAL_CAB', amount: 2500, date: wednesday(3), vendor: vendor('Uber'), receipt: receiptFile('e2e04') },
  ]);
  observed.formPolicyHint = await emp.locator('.alert').filter({ hasText: 'policy' }).first().innerText().catch(() => null);
  await submit(emp);
  observed.claimId = id;
  observed.afterSubmit = await statusText(emp);
  observed.violations = await violationCodes(emp);
  observed.lineOutcome = await emp.locator('tbody .badge').filter({ hasText: /approval|policy|rejected/i }).first().innerText();
  assert.equal(observed.afterSubmit, 'Pending · Manager');
  assert.deepEqual(observed.violations, ['CAB_TRIP_LIMIT']);
  assert.match(observed.lineOutcome, /Needs approval/);
  observed.screenshot = await shot(emp, 'E2E-04-cab-limit');
});

await runCase('E2E-05', 'Missing mandatory receipt (meal ₹800, no receipt)', async ({ observed, open }) => {
  const emp = await open('employee');
  const id = await createClaim(emp, 'E2E-05 team dinner', [
    { category: 'MEAL', amount: 800, date: wednesday(4), vendor: vendor('Mainland China') },
  ]);
  observed.formHint = await emp.locator('.hint').filter({ hasText: 'Receipt required' }).innerText();
  await submit(emp);
  observed.claimId = id;
  observed.afterSubmit = await statusText(emp);
  observed.violations = await violationCodes(emp);
  observed.message = await emp.locator('.violations li').first().innerText();
  assert.match(observed.formHint, /Receipt required above ₹500/);
  assert.equal(observed.afterSubmit, 'Rejected');
  assert.deepEqual(observed.violations, ['RECEIPT_REQUIRED']);
  assert.match(observed.message, /Receipt required above ₹500/);
  observed.screenshot = await shot(emp, 'E2E-05-receipt-required');
});

await runCase('E2E-06', 'Duplicate expense submission (same vendor + amount + date)', async ({ observed, open }) => {
  const emp = await open('employee');
  const v = vendor('Ola');
  const first = await createClaim(emp, 'E2E-06 cab A', [{ category: 'LOCAL_CAB', amount: 450, date: wednesday(5), vendor: v }]);
  await submit(emp);
  observed.firstClaim = { id: first, status: await statusText(emp), violations: await violationCodes(emp) };
  const second = await createClaim(emp, 'E2E-06 cab B', [{ category: 'LOCAL_CAB', amount: 450, date: wednesday(5), vendor: v.toUpperCase() }]);
  await submit(emp);
  observed.secondClaim = { id: second, status: await statusText(emp), violations: await violationCodes(emp) };
  assert.deepEqual(observed.firstClaim.violations, []);
  assert.deepEqual(observed.secondClaim.violations, ['DUPLICATE_EXPENSE']);
  assert.equal(observed.secondClaim.status, 'Pending · Manager');
  observed.screenshot = await shot(emp, 'E2E-06-duplicate-expense');
});

await runCase('E2E-07', 'Duplicate receipt file upload', async ({ observed, open }) => {
  const emp = await open('employee');
  const file = receiptFile('e2e07-shared');
  const first = await createClaim(emp, 'E2E-07 cab with receipt', [{ category: 'LOCAL_CAB', amount: 600, date: wednesday(6), vendor: vendor('Meru'), receipt: file }]);
  await submit(emp);
  observed.firstClaim = { id: first, status: await statusText(emp), violations: await violationCodes(emp) };
  const second = await createClaim(emp, 'E2E-07 reused receipt', [{ category: 'LOCAL_CAB', amount: 700, date: wednesday(7), vendor: vendor('BluSmart'), receipt: file }]);
  await submit(emp);
  observed.secondClaim = { id: second, status: await statusText(emp), violations: await violationCodes(emp) };
  assert.deepEqual(observed.firstClaim.violations, []);
  assert.deepEqual(observed.secondClaim.violations, ['DUPLICATE_RECEIPT']);
  assert.equal(observed.secondClaim.status, 'Rejected');
  observed.screenshot = await shot(emp, 'E2E-07-duplicate-receipt');
});

await runCase('E2E-08', 'Weekend expense flagging (cab ₹300 on a Saturday)', async ({ observed, open }) => {
  const emp = await open('employee');
  const date = saturday(8);
  const id = await createClaim(emp, 'E2E-08 Saturday cab', [{ category: 'LOCAL_CAB', amount: 300, date, vendor: vendor('Rapido') }]);
  await submit(emp);
  observed.claimId = id;
  observed.expenseDate = date;
  observed.afterSubmit = await statusText(emp);
  observed.violations = await violationCodes(emp);
  assert.equal(new Date(`${date}T00:00:00Z`).getUTCDay(), 6);
  assert.equal(observed.afterSubmit, 'Pending · Manager');
  assert.deepEqual(observed.violations, ['WEEKEND_EXPENSE']);
  const mgr = await open('manager');
  await mgr.getByRole('link', { name: /Approvals/ }).click();
  const row = mgr.locator('tr', { has: mgr.locator(`a.claim-link[href="/claims/${id}"]`) });
  await row.waitFor();
  observed.flaggedInQueue = await row.locator('.flag').count() > 0;
  assert.ok(observed.flaggedInQueue);
  observed.screenshot = await shot(emp, 'E2E-08-weekend');
});

await runCase('E2E-09', 'Manager clarification, employee resubmission and approval', async ({ observed, open }) => {
  const emp = await open('employee');
  const id = await createClaim(emp, 'E2E-09 Indore trip', [
    { category: 'HOTEL', amount: 7200, date: wednesday(9), vendor: vendor('Radisson'), city: 'Indore', nights: 2, receipt: receiptFile('e2e09') },
  ]);
  await submit(emp);
  observed.claimId = id;
  const mgr = await open('manager');
  // comment is mandatory for send back
  await mgr.goto(`${UI}/claims/${id}`);
  await mgr.locator('.decision-bar').getByRole('button', { name: 'Send back' }).click();
  await dialog(mgr).getByRole('button', { name: 'Send back' }).click();
  observed.emptyCommentError = await dialog(mgr).locator('.field-error').innerText();
  await dialog(mgr).getByRole('button', { name: 'Cancel' }).click();
  await decide(mgr, id, 'Send back', 'Please split breakfast out of the room rate');
  observed.afterSendBack = await statusText(mgr);
  await emp.goto(`${UI}/claims/${id}/edit`);
  observed.employeeBanner = await emp.locator('.alert').filter({ hasText: 'asked for clarification' }).innerText();
  await emp.locator('.line-card').first().getByRole('button', { name: 'Edit' }).click();
  await emp.locator('#amount').fill('7000');
  await emp.getByRole('button', { name: /Save expense/ }).click();
  await emp.locator('.summary-total').filter({ hasText: '7,000.00' }).waitFor();
  await submit(emp);
  observed.afterResubmit = await statusText(emp);
  await decide(mgr, id, 'Approve');
  observed.afterApproval = await statusText(mgr);
  observed.history = (await historyEntries(mgr)).map((h) => h.head);
  assert.match(observed.emptyCommentError, /comment is required to send back/);
  assert.equal(observed.afterSendBack, 'Clarification requested');
  assert.match(observed.employeeBanner, /Please split breakfast/);
  assert.equal(observed.afterResubmit, 'Pending · Manager');
  assert.equal(observed.afterApproval, 'Approved');
  assert.equal(observed.history.filter((h) => h.startsWith('Submitted')).length, 2);
  assert.ok(observed.history.some((h) => h.startsWith('Sent back for clarification by Vikram Rao')));
  observed.screenshot = await shot(mgr, 'E2E-09-resubmitted-approved');
  approvedForPayout.push(id);
});

await runCase('E2E-10', 'Delegated approval, then payout and CSV export', async ({ observed, open }) => {
  // 1. Manager delegates to Maria Sharma through the Approvals page
  const mgr = await open('manager');
  await mgr.getByRole('link', { name: /Approvals/ }).click();
  const opt = await mgr.locator('#d-user option', { hasText: 'Maria Sharma' }).first().getAttribute('value');
  await mgr.locator('#d-user').selectOption(opt);
  await mgr.locator('#d-start').fill(todayLocal(0));
  await mgr.locator('#d-end').fill(todayLocal(2));
  await mgr.getByRole('button', { name: /Add delegation/ }).click();
  await mgr.locator('.list-rows li', { hasText: 'Maria Sharma' }).waitFor();
  observed.delegation = await mgr.locator('.list-rows li', { hasText: 'Maria Sharma' }).innerText();
  // 2. Employee submits a claim
  const emp = await open('employee');
  const id = await createClaim(emp, 'E2E-10 Nashik site visit', [
    { category: 'HOTEL', amount: 7500, date: wednesday(10), vendor: vendor('Express Inn'), city: 'Nashik', nights: 2, receipt: receiptFile('e2e10') },
  ]);
  await submit(emp);
  observed.claimId = id;
  // 3. Delegate approves on behalf of the manager
  const maria = await open('maria.sharma');
  await maria.getByRole('link', { name: /Approvals/ }).click();
  await maria.locator(`a.claim-link[href="/claims/${id}"]`).waitFor();
  await decide(maria, id, 'Approve', 'Approved as delegate for Vikram');
  observed.afterDelegate = await statusText(maria);
  observed.delegateHistory = (await historyEntries(maria)).map((h) => h.head).find((h) => h.startsWith('Approved'));
  assert.equal(observed.afterDelegate, 'Approved');
  assert.match(observed.delegateHistory, /Approved by Maria Sharma on behalf of Vikram Rao/);
  approvedForPayout.push(id);
  // 4. Finance head: batch, CSV, mark paid
  const fh = await open('financehead');
  await fh.getByRole('link', { name: 'Payouts' }).click();
  await fh.getByRole('heading', { name: 'Ready for payout' }).waitFor();
  await fh.getByRole('button', { name: /Create payout batch/ }).click();
  await dialog(fh).getByRole('button', { name: 'Create batch' }).click();
  const toast = await fh.locator('.toast').filter({ hasText: /Batch PB-\d+ created/ }).innerText();
  observed.batch = toast.match(/PB-\d+/)[0];
  const row = fh.locator('tr', { hasText: observed.batch });
  const [download] = await Promise.all([fh.waitForEvent('download'), row.getByRole('button', { name: /CSV/ }).click()]);
  const csvPath = path.join(EVIDENCE, `payout_${observed.batch}.csv`);
  await download.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8').trim().split('\r\n');
  observed.csvFile = path.basename(csvPath);
  observed.csvHeader = csv[0];
  observed.csvTrailer = csv.at(-1);
  observed.csvRows = csv.length;
  observed.csvHasClaims = {};
  const nums = {};
  for (const cid of approvedForPayout) {
    await emp.goto(`${UI}/claims/${cid}`);
    nums[cid] = await emp.locator('.page-eyebrow').innerText();
    observed.csvHasClaims[nums[cid]] = csv.some((r) => r.startsWith(`D,${nums[cid]},`));
  }
  assert.ok(Object.values(observed.csvHasClaims).every(Boolean), JSON.stringify(observed.csvHasClaims));
  await row.getByRole('button', { name: /Mark paid/ }).click();
  await dialog(fh).getByRole('button', { name: 'Mark as paid' }).click();
  await fh.locator('.toast').filter({ hasText: /paid/i }).first().waitFor();
  observed.batchStatus = await fh.locator('tr', { hasText: observed.batch }).locator('.badge').innerText();
  await emp.goto(`${UI}/claims/${id}`);
  observed.finalStatus = await statusText(emp);
  assert.equal(observed.batchStatus, 'Paid');
  assert.equal(observed.finalStatus, 'Paid');
  observed.screenshot = await shot(fh, 'E2E-10-payout-paid');
  // 5. Cleanup: remove the delegation through the UI
  await mgr.goto(`${UI}/approvals`);
  await mgr.locator('.list-rows li', { hasText: 'Maria Sharma' }).getByRole('button').click();
  await dialog(mgr).getByRole('button', { name: 'Remove' }).click();
  await mgr.locator('.list-rows li', { hasText: 'Maria Sharma' }).waitFor({ state: 'detached' });
  observed.delegationRemoved = true;
});

await closeBrowser();
const summary = { run: RUN, executedAt: new Date().toISOString(), ui: UI, total: results.length,
  passed: results.filter((r) => r.status === 'Pass').length, failed: results.filter((r) => r.status === 'Fail').length, results };
fs.writeFileSync(path.join(EVIDENCE, 'e2e-results.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${summary.passed}/${summary.total} passed`);
process.exitCode = summary.failed ? 1 : 0;
