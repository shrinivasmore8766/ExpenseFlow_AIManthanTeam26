// DEF-02 (wider impact): a claim above ₹1,00,000 from a direct report of the Finance Head (e.g. auditor2)
// is approved by the FH at manager level, then can never pass the FH level ("already approved").
import { ok, submittedClaim, approve, weekday } from '../api-tests/lib.mjs';

const c = await submittedClaim('auditor2', 'DEF-02b repro (FH direct report > 1L)',
  [{ category: 'TRAVEL', amount: 100001, receipt: true, date: weekday(31) }]);
console.log(`claim ${c.id} ${c.claimNumber}: ${c.status}, manager-level approver ${c.currentApproverName}`);
console.log('financehead approve ->', (await approve('financehead', c.id)).json?.status);
console.log('auditor approve     ->', (await approve('auditor', c.id)).json?.status);
for (const u of ['financehead', 'auditor', 'ceo']) {
  const r = await approve(u, c.id);
  console.log(`${u.padEnd(19)} approve -> HTTP ${r.status} ${r.json?.detail ?? r.json?.status}`);
}
const final = await ok('auditor2', 'GET', `/api/claims/${c.id}`);
console.log(`final status ${final.status}`);
console.log(`CLAIM_ID=${c.id}`);
