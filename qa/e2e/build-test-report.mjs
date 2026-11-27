// Builds docs/testing/ExpenseFlow-Test-Results.pdf from the recorded evidence (JSON + run logs + screenshots).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const T = path.resolve(here, '../../docs/testing');
const EV = path.join(T, 'evidence');
const read = (f) => fs.readFileSync(path.join(EV, f), 'utf8');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const img = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;

// ---- numbers taken from the run outputs
const e2e = JSON.parse(read('e2e-results.json'));
const fe = JSON.parse(read('frontend-results.json'));
const num = (txt, re) => Number((txt.match(re) || [])[1] || 0);
const api = read('api-tests.txt');
const cli = read('frontend-client-tests.txt');
const be = read('backend-unit-tests.txt');
const beTotal = num(be, /Tests run: (\d+), Failures: \d+, Errors: \d+, Skipped: \d+\s*$/m);
const beFail = num(be, /Tests run: \d+, Failures: (\d+), Errors: \d+, Skipped: \d+\s*$/m);
const suites = [
  ['Backend unit tests (JUnit 5)', 'Policy engine, approval rules, CSV writer, receipt validation', beTotal, beTotal - beFail, beFail],
  ['API integration tests (live backend + PostgreSQL)', 'Auth, RBAC, isolation, validation, policy, thresholds, delegation, payout, security', num(api, /ℹ tests (\d+)/), num(api, /ℹ pass (\d+)/), num(api, /ℹ fail (\d+)/)],
  ['Frontend API-client tests', 'Request/error handling, 401 logout, uploads, downloads', num(cli, /ℹ tests (\d+)/), num(cli, /ℹ pass (\d+)/), num(cli, /ℹ fail (\d+)/)],
  ['End-to-end cases (real UI in Chrome)', 'The 10 required business scenarios', e2e.total, e2e.passed, e2e.failed],
  ['Frontend functional checks (Chrome)', 'All 4 roles, routes, states, XSS, responsive', fe.total, fe.passed, fe.failed],
];
const tot = suites.reduce((a, s) => [a[0] + s[2], a[1] + s[3], a[2] + s[4]], [0, 0, 0]);

const e2eExpected = {
  'E2E-01': 'Pending · Manager (above ₹5,000 auto-approve limit) → manager approves → Approved',
  'E2E-02': 'Manager → Pending · Auditor → Approved',
  'E2E-03': 'Manager → Auditor → Pending · Finance Head → Approved',
  'E2E-04': 'CAB_TRIP_LIMIT flagged, line “Needs approval”, Pending · Manager',
  'E2E-05': 'Hint “Receipt required above ₹500”; claim Rejected with RECEIPT_REQUIRED',
  'E2E-06': '2nd claim flagged DUPLICATE_EXPENSE → Pending · Manager',
  'E2E-07': '2nd claim DUPLICATE_RECEIPT → Rejected',
  'E2E-08': 'WEEKEND_EXPENSE, Pending · Manager, ⚠ in manager queue',
  'E2E-09': 'Empty comment blocked; send back → edit → resubmit → Pending · Manager → Approved',
  'E2E-10': 'Delegate approves “on behalf of” manager; batch CSV contains claims; batch & claim Paid',
};
const actual = (r) => {
  const o = r.observed;
  switch (r.id) {
    case 'E2E-01': return `Claim ${o.claimId}: ${o.afterSubmit} → ${o.afterManager}; “${o.policyMessage.replace('Policy engine: ', '')}”`;
    case 'E2E-02': return `Claim ${o.claimId}: ${o.afterSubmit} → ${o.afterManager} → ${o.afterAuditor}`;
    case 'E2E-03': return `Claim ${o.claimId}: ${o.afterManager} → ${o.afterAuditor} → ${o.afterFinanceHead}; ${o.approvals.join(', ')}`;
    case 'E2E-04': return `Claim ${o.claimId}: ${o.afterSubmit}; violations ${o.violations.join(', ')}; badge “${o.lineOutcome}”`;
    case 'E2E-05': return `Hint “${o.formHint}”; claim ${o.claimId}: ${o.afterSubmit}; ${o.violations.join(', ')}`;
    case 'E2E-06': return `Claim A ${o.firstClaim.id}: ${o.firstClaim.status}, no violations; claim B ${o.secondClaim.id}: ${o.secondClaim.status}, ${o.secondClaim.violations.join(', ')}`;
    case 'E2E-07': return `Claim A ${o.firstClaim.id}: ${o.firstClaim.status}${o.firstClaim.status.includes('Auditor') ? ' (randomly picked for 10% sample audit)' : ''}; claim B ${o.secondClaim.id}: ${o.secondClaim.status}, ${o.secondClaim.violations.join(', ')}`;
    case 'E2E-08': return `Claim ${o.claimId} dated ${o.expenseDate} (Sat): ${o.afterSubmit}; ${o.violations.join(', ')}; flagged in queue: ${o.flaggedInQueue}`;
    case 'E2E-09': return `Claim ${o.claimId}: “${o.emptyCommentError}”; ${o.afterSendBack} → ${o.afterResubmit} → ${o.afterApproval}; 2 submissions in history`;
    case 'E2E-10': return `Claim ${o.claimId}: “${o.delegateHistory}”; batch ${o.batch} (${o.csvRows} CSV rows, header ${o.csvHeader}); batch ${o.batchStatus}, claim ${o.finalStatus}`;
    default: return '';
  }
};

const policyRows = [
  ['Meals ₹1,500 / day', '1,499.99 ✓', '1,500.00 ✓', '1,500.01 → ROUTE', 'Daily total across lines & claims; inactive rule skipped'],
  ['Hotel tier-1 ₹6,000 / night', '5,999.99 ✓', '6,000.00 ✓', '6,000.01 → ROUTE', 'Per-night maths (÷ nights); city match case-insensitive'],
  ['Hotel other ₹4,000 / night', '3,999.99 ✓', '4,000.00 ✓', '4,000.01 → ROUTE', 'Missing city → stricter limit; nights 0/null → 1'],
  ['Local cab ₹2,000 / trip', '1,999.99 ✓', '2,000.00 ✓', '2,000.01 → ROUTE', 'Limit is per trip, not per day'],
  ['Receipt above ₹500', '499.99 ✓', '500.00 ✓', '500.01 no receipt → AUTO_REJECT', 'Applies to all 5 categories'],
  ['Duplicate vendor+amount+date', 'Different key ✓', 'Same key → ROUTE', '2nd line in same claim flagged', 'Vendor case/space-insensitive; blank vendor = no key'],
  ['Duplicate receipt hash', 'New hash ✓', 'Used hash → AUTO_REJECT', '2nd file in same claim rejected', 'No receipt never a duplicate'],
  ['Weekend flag', 'Fri / Mon ✓', 'Saturday → ROUTE', 'Sunday → ROUTE', '—'],
  ['10% sample audit', 'Roll 0–9 → sampled', 'Roll 10 → approved', 'Roll 99 → approved', 'Exactly 10/100 rolls select; 0% / 100% config; never on routed claims. Seed data: 89/1,025 = 8.68% (95% range 8.2–11.8%)'],
];

const thrRows = [
  ['₹25,000', 'Manager', 'Approved after manager; auditor gets 409', 'Pass'],
  ['₹25,001', 'Manager → Auditor', 'Pending · Auditor → Approved', 'Pass'],
  ['₹1,00,000', 'Manager → Auditor', 'Approved after auditor (no FH)', 'Pass'],
  ['₹1,00,001', 'Manager → Auditor → Finance Head', 'Each level enforced; skip attempts → 403', 'Pass'],
];
const apprChecks = [
  ['Approvals cannot be skipped / unauthorised roles', 'Auditor, FH at manager level → 403; other employee → 404', 'Pass'],
  ['No self-approval, no double approval', 'Claimant → 403 in every role; same approver twice → 403', 'Pass'],
  ['Rejected claims never reach payout', 'Approve after reject → 409; absent from eligible list; DB: 0 rejected paid', 'Pass'],
  ['Clarification & resubmission', 'Send back → edit → resubmit restarts at manager → approved; history in order', 'Pass'],
  ['Concurrent approvals', '3 simultaneous approves → exactly one 200 (optimistic locking)', 'Pass'],
  ['Delegation', 'Delegate approves “on behalf of”; future/expired/invalid/self → denied or 400; no auditor rights via manager grant', 'Pass'],
  ['Finance Head as manager-level approver, claim > ₹1,00,000', 'Claim stuck at Pending · Finance Head — nobody may act (DEF-02)', 'Fail'],
];

const defects = [
  ['DEF-01', 'Payout CSV', 'Medium', 'CSV-injection guard missed leading tab / carriage return', 'Guard extended to “=+-@\\t\\r”; unit + CSV regression tests pass', 'Verified'],
  ['DEF-02', 'Approval workflow', 'High', 'Claims > ₹1,00,000 whose manager-level approver is the Finance Head can never complete (FH own claims + 4 direct reports)', 'Not fixed — needs a business decision (escalation target vs. four-eyes rule); reproduced twice', 'Open'],
  ['DEF-03', 'Claim lines API', 'Low', 'Future expense dates accepted by the API (UI blocks them)', 'Not fixed — needs a timezone rule (server UTC vs users in IST)', 'Open'],
  ['DEF-04', 'Authentication', 'Medium', 'No lockout or throttling after repeated failed logins', 'Not fixed — new capability, out of scope', 'Open'],
  ['DEF-05', 'Logging', 'Low', 'Handled optimistic-lock conflicts (HTTP 409) logged at ERROR by Hibernate', 'Not fixed — handle in SRE alerting', 'Open'],
];

const security = [
  ['Authentication & invalid logins', 'Fail', '401 for bad/unknown users, no enumeration; but no lockout (DEF-04)'],
  ['Password handling & storage', 'Pass', '150/150 BCrypt hashes; never returned or logged (HTTPS required in production)'],
  ['Authorization & RBAC', 'Pass', '16 forbidden role/endpoint pairs → 403; UI route guards'],
  ['Employee data isolation', 'Pass', 'Other employees’ claims & receipts → 404'],
  ['Unauthorized API access', 'Pass', 'All /api/** need auth (note: /actuator/prometheus public for demo)'],
  ['Privilege escalation', 'Pass', 'Mass-assignment fields ignored; self-approval & level skipping blocked'],
  ['Upload type & size', 'Pass', 'Content-sniffed PDF/JPEG/PNG only; > 5 MB → 413'],
  ['Upload access restrictions', 'Pass', 'UUID names, path traversal rejected, nosniff, auth required'],
  ['SQL injection', 'Pass', 'Payloads stored as text; bad params → 400; bound parameters only'],
  ['Cross-site scripting', 'Pass', 'Script in titles rendered as text in browser; nothing executed'],
  ['CSRF', 'Pass', 'Header-based auth, no cookies; no CORS grant to foreign origins'],
  ['Sensitive data in logs/responses', 'Pass', '0 credentials in ~4.4k log lines; no stack traces; 0 HTTP 500s'],
  ['Secrets in source/config', 'Fail', 'No real secrets, but committed demo defaults (DB password, Demo@123)'],
  ['Audit trail integrity', 'Pass', 'DB trigger blocks UPDATE/DELETE on audit_log; every action logged'],
  ['Unauthorized payout / approval', 'Pass', 'Non-FH payout calls → 403; double mark-paid → 409'],
];

const badge = (s) => `<span class="b ${/pass|verified/i.test(s) ? 'ok' : /open|fail/i.test(s) ? 'bad' : 'n'}">${esc(s)}</span>`;
const sev = (s) => `<span class="b ${s === 'High' ? 'bad' : s === 'Medium' ? 'warn' : 'n'}">${s}</span>`;
const shots = [
  ['E2E-03 — ₹1,10,000 claim approved by Manager, Auditor and Finance Head', path.join(EV, 'screenshots/E2E-03-finance-head-approved.png')],
  ['E2E-10 — payout batch created, CSV downloaded, marked paid', path.join(EV, 'screenshots/E2E-10-payout-paid.png')],
];
const runDate = new Date(e2e.executedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

const html = `<!doctype html><html><head><meta charset="utf-8"><title>ExpenseFlow — Test Results</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 16mm 14mm 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #1f2937; font-size: 9.6pt; line-height: 1.42; margin: 0; }
  h1 { font-size: 24pt; margin: 0; color: #0b1435; letter-spacing: -0.02em; }
  h2 { font-size: 13pt; color: #0b1435; margin: 20px 0 8px; padding-bottom: 5px; border-bottom: 2px solid #e4e8ef; break-after: avoid; }
  h3 { font-size: 10.5pt; margin: 12px 0 6px; color: #0f172a; }
  p { margin: 0 0 6px; }
  .muted { color: #64748b; }
  .cover { background: linear-gradient(120deg, #0b1435, #1c2a5e); color: #dbe3f7; border-radius: 12px; padding: 26px 28px; margin-bottom: 16px; }
  .cover h1 { color: #fff; }
  .cover .sub { color: #a9b6d9; margin-top: 6px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 6px; }
  .kpi { border: 1px solid #e4e8ef; border-radius: 10px; padding: 10px 12px; }
  .kpi .v { font-size: 18pt; font-weight: 700; color: #0f172a; }
  .kpi .l { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .kpi.ok .v { color: #15803d; } .kpi.bad .v { color: #dc2626; } .kpi.warn .v { color: #b45309; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 8.6pt; }
  th { background: #f1f4f9; color: #475569; text-align: left; font-weight: 600; font-size: 7.6pt; text-transform: uppercase; letter-spacing: .04em; padding: 6px 7px; border-bottom: 1px solid #d3d9e3; }
  td { padding: 5px 7px; border-bottom: 1px solid #edf0f5; vertical-align: top; }
  tr { break-inside: avoid; }
  td.n, th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .b { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 7.6pt; font-weight: 600; white-space: nowrap; }
  .b.ok { background: #e8f6ee; color: #15803d; } .b.bad { background: #fdeeee; color: #dc2626; }
  .b.warn { background: #fff6e5; color: #b45309; } .b.n { background: #f1f4f8; color: #475569; }
  .env { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 18px; font-size: 8.6pt; }
  .env div span { color: #64748b; }
  .note { background: #f8fafc; border: 1px solid #e4e8ef; border-left: 3px solid #2563eb; border-radius: 6px; padding: 8px 10px; margin: 8px 0; font-size: 8.6pt; }
  .shot { break-inside: avoid; margin: 10px 0; }
  .shot img { width: 100%; border: 1px solid #e4e8ef; border-radius: 8px; }
  .shot p { font-size: 8.2pt; color: #64748b; margin-top: 4px; }
  .pb { break-before: page; }
  code { font-family: Consolas, monospace; font-size: 8pt; background: #f1f4f8; padding: 0 4px; border-radius: 3px; }
</style></head><body>

<div class="cover">
  <h1>ExpenseFlow — Test Results</h1>
  <div class="sub">QA phase · AI Manthan hackathon · Team 26 · final regression run ${esc(runDate)} IST</div>
</div>

<div class="kpis">
  <div class="kpi"><div class="l">Automated tests run</div><div class="v">${tot[0]}</div></div>
  <div class="kpi ok"><div class="l">Passed</div><div class="v">${tot[1]}</div></div>
  <div class="kpi ${tot[2] ? 'bad' : 'ok'}"><div class="l">Failed</div><div class="v">${tot[2]}</div></div>
  <div class="kpi warn"><div class="l">Open defects</div><div class="v">4</div></div>
</div>
<p class="muted">0 blocked · 0 skipped · 5 defects found, 1 fixed &amp; verified, 4 open (1 High). Security checklist: 13 Pass, 2 Fail, 0 Not Tested.</p>

<h2>Test environment</h2>
<div class="env">
  <div><span>Backend:</span> Spring Boot 3.3.5, Java 17 (Docker)</div>
  <div><span>Database:</span> PostgreSQL 16, seeded 150 users / 3,000 claims</div>
  <div><span>Frontend:</span> React 18 + Vite 6, Chrome (headless)</div>
  <div><span>Tools:</span> JUnit 5, AssertJ, Node test runner, playwright-core</div>
</div>

<h2>Results by test suite</h2>
<table><thead><tr><th>Suite</th><th>Covers</th><th class="n">Run</th><th class="n">Pass</th><th class="n">Fail</th></tr></thead><tbody>
${suites.map((s) => `<tr><td><b>${esc(s[0])}</b></td><td>${esc(s[1])}</td><td class="n">${s[2]}</td><td class="n">${s[3]}</td><td class="n">${s[4]}</td></tr>`).join('')}
<tr><td><b>Total</b></td><td></td><td class="n"><b>${tot[0]}</b></td><td class="n"><b>${tot[1]}</b></td><td class="n"><b>${tot[2]}</b></td></tr>
</tbody></table>
<p class="muted">Also executed: 15-item security checklist, 7 database/log/config integrity checks, and 2 defect reproduction scripts. Both applications build successfully.</p>

<h2>Policy engine — every rule at its boundary</h2>
<p>All comparisons are “strictly greater than”, so an amount exactly at the limit passes. 45 unit tests plus 10 checks through the real submit API — all passed.</p>
<table><thead><tr><th>Rule</th><th>Below</th><th>At limit</th><th>Above</th><th>Also verified</th></tr></thead><tbody>
${policyRows.map((r) => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`).join('')}
</tbody></table>

<h2>Approval thresholds and delegation</h2>
<table><thead><tr><th>Approved amount</th><th>Expected chain</th><th>Observed (live API)</th><th>Result</th></tr></thead><tbody>
${thrRows.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${esc(r[2])}</td><td>${badge(r[3])}</td></tr>`).join('')}
</tbody></table>
<table><thead><tr><th>Check</th><th>Observed</th><th>Result</th></tr></thead><tbody>
${apprChecks.map((r) => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td>${badge(r[2])}</td></tr>`).join('')}
</tbody></table>

<h2>End-to-end cases (executed in the real UI)</h2>
<table><thead><tr><th>ID</th><th>Scenario</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead><tbody>
${e2e.results.map((r) => `<tr><td><b>${r.id}</b></td><td>${esc(r.scenario)}</td><td>${esc(e2eExpected[r.id])}</td><td>${esc(actual(r))}</td><td>${badge(r.status)}</td></tr>`).join('')}
</tbody></table>

<h2>Frontend checks (all four roles)</h2>
<table><thead><tr><th>ID</th><th>Check</th><th>Status</th></tr></thead><tbody>
${fe.results.map((r) => `<tr><td>${r.id}</td><td>${esc(r.name)}</td><td>${badge(r.status)}</td></tr>`).join('')}
</tbody></table>

<h2>Defects</h2>
<table><thead><tr><th>ID</th><th>Module</th><th>Severity</th><th>Description</th><th>Fix / note</th><th>Status</th></tr></thead><tbody>
${defects.map((d) => `<tr><td><b>${d[0]}</b></td><td>${d[1]}</td><td>${sev(d[2])}</td><td>${esc(d[3])}</td><td>${esc(d[4])}</td><td>${badge(d[5])}</td></tr>`).join('')}
</tbody></table>

<h2>Basic security checklist</h2>
<table><thead><tr><th>#</th><th>Check</th><th>Result</th><th>Evidence</th></tr></thead><tbody>
${security.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s[0])}</b></td><td>${badge(s[1])}</td><td>${esc(s[2])}</td></tr>`).join('')}
</tbody></table>
<div class="note">This is a basic checklist on a local demo build, not a penetration test. It does not establish that the application is secure.</div>

<h2>Limitations</h2>
<table><tbody>
<tr><td><b>Frontend component tests</b></td><td>Not done: frontend/CLAUDE.md excludes a unit-test framework (jsdom/Testing Library). Covered instead by API-client tests and real-browser tests.</td></tr>
<tr><td><b>Backend @WebMvcTest / Testcontainers</b></td><td>Not used; equivalent behaviour verified by API integration tests against the real backend and database.</td></tr>
<tr><td><b>Browsers</b></td><td>Chrome only (headless); Firefox/Safari not tested. Mobile checked by viewport emulation (390 px, 820 px).</td></tr>
<tr><td><b>Out of scope</b></td><td>Load/performance, TLS, dependency CVE scanning, deployment (owned by other phases).</td></tr>
<tr><td><b>Test data</b></td><td>QA claims are titled “QA-…”. Approved QA claims went through real payout batches; two stuck DEF-02 reproduction claims were removed from the database.</td></tr>
</tbody></table>

<h2>Where to find the evidence</h2>
<table><tbody>
<tr><td>Detailed reports</td><td><code>docs/testing/01–05 *.md</code></td></tr>
<tr><td>Raw run outputs</td><td><code>docs/testing/evidence/*.txt, *.json</code></td></tr>
<tr><td>Screenshots, exported CSV</td><td><code>docs/testing/evidence/screenshots/, payout_PB-00023.csv</code></td></tr>
<tr><td>Test code</td><td><code>backend/src/test/java/…</code>, <code>qa/api-tests/</code>, <code>qa/frontend-tests/</code>, <code>qa/e2e/</code>, <code>qa/repro/</code></td></tr>
</tbody></table>

<h2 class="pb">Evidence screenshots</h2>
${shots.map(([cap, p]) => `<div class="shot"><img src="${img(p)}"><p>${esc(cap)}</p></div>`).join('')}
</body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
const out = path.join(T, 'ExpenseFlow-Test-Results.pdf');
await page.pdf({
  path: out, format: 'A4', printBackground: true,
  margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="font-size:7pt;color:#94a3b8;width:100%;padding:0 14mm;display:flex;justify-content:space-between;font-family:Arial"><span>ExpenseFlow — Test Results</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log(out, `${(fs.statSync(out).size / 1024).toFixed(0)} KB`, `tests ${tot.join('/')}`);
