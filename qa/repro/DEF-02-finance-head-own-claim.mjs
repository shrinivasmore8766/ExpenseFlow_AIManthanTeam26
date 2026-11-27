// Reproduction for DEF-02: the Finance Head's own claim above ₹1,00,000 reaches PENDING_FINANCE_HEAD,
// where nobody is allowed to act (requirements A11 / B21 say it must escalate, e.g. to the CEO).
// Usage: node qa/repro/DEF-02-finance-head-own-claim.mjs   (prints the claim id for cleanup)
import { call, ok, submittedClaim, approve, weekday } from '../api-tests/lib.mjs';

const c = await submittedClaim('financehead', 'DEF-02 repro (FH own claim > 1L)',
  [{ category: 'TRAVEL', amount: 100001, receipt: true, date: weekday(30) }]);
console.log(`claim ${c.id} ${c.claimNumber}: ${c.status}, approver ${c.currentApproverName}`);
console.log('ceo approve        ->', (await approve('ceo', c.id)).json?.status);
console.log('auditor approve    ->', (await approve('auditor', c.id)).json?.status);

for (const u of ['financehead', 'ceo', 'auditor', 'auditor2', 'manager']) {
  const r = await approve(u, c.id);
  console.log(`${u.padEnd(18)} approve -> HTTP ${r.status} ${r.json?.detail ?? r.json?.status}`);
}
for (const u of ['financehead', 'ceo', 'auditor']) {
  const q = await ok(u, 'GET', '/api/approvals');
  console.log(`${u.padEnd(18)} queue contains claim: ${q.some((x) => x.id === c.id)}`);
}
const final = await ok('financehead', 'GET', `/api/claims/${c.id}`);
console.log(`final status ${final.status}; allowedActions for FH: ${JSON.stringify(final.allowedActions)}`);
console.log(`CLAIM_ID=${c.id}`);
