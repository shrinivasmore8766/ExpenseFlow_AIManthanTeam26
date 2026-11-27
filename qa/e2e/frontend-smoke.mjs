// Frontend functional checks for all four roles in Chrome. Writes docs/testing/evidence/frontend-results.json.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launch, closeBrowser, login, shot, dialog, UI, PASSWORD, RUN, EVIDENCE } from './ui.mjs';

const results = [];
async function check(id, name, fn) {
  const sessions = [];
  const open = async (user, opts) => { const s = await login(user, opts); sessions.push(s); return s.page; };
  const observed = {};
  try {
    await fn({ open, observed });
    const problems = sessions.flatMap((s) => s.page.problems);
    if (problems.length) throw new Error(`Browser problems: ${problems.join(' | ')}`);
    results.push({ id, name, status: 'Pass', observed });
    console.log(`PASS ${id} ${name}`);
  } catch (e) {
    results.push({ id, name, status: 'Fail', observed, error: e.message.split('\n')[0] });
    console.log(`FAIL ${id} ${name}: ${e.message.split('\n')[0]}`);
  } finally {
    for (const s of sessions) await s.ctx.close();
  }
}
const browser = await launch();

const NAV = {
  employee: ['Dashboard', 'My claims', 'New claim', 'Policy rules'],
  manager: ['Dashboard', 'My claims', 'New claim', 'Approvals', 'Policy rules'],
  auditor: ['Dashboard', 'My claims', 'New claim', 'Audit queue', 'Policy rules'],
  financehead: ['Dashboard', 'My claims', 'New claim', 'Approvals', 'Payouts', 'Policy rules'],
};

async function settled(page) {
  await page.locator('h1').first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.skeleton').length === 0, null, { timeout: 15000 });
}

await check('FE-01', 'Invalid login shows an error and stays on the login page', async ({ observed }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${UI}/login`);
  await page.locator('#username').fill('employee');
  await page.locator('#password').fill('not-the-password');
  await page.getByRole('button', { name: /Sign in/ }).click();
  observed.error = await page.locator('.alert-error').innerText();
  assert.match(observed.error, /Invalid username or password/);
  assert.match(page.url(), /\/login$/);
  await ctx.close();
});

for (const [user, expected] of Object.entries(NAV)) {
  await check(`FE-02-${user}`, `${user}: login lands on the dashboard with role-specific navigation`, async ({ open, observed }) => {
    const page = await open(user);
    await settled(page);
    observed.navigation = (await page.locator('.sidebar .nav-link .nav-label').allInnerTexts()).filter((t) => t !== 'Log out');
    observed.welcome = await page.locator('.welcome h1').innerText();
    observed.kpiCards = await page.locator('.kpi-card').count();
    observed.charts = await page.locator('.recharts-surface').count();
    assert.deepEqual(observed.navigation, expected);
    assert.match(observed.welcome, /Good (morning|afternoon|evening)/);
    assert.ok(observed.kpiCards >= 4);
    assert.ok(observed.charts >= 1);
  });

  await check(`FE-03-${user}`, `${user}: every navigation page loads without console errors or failed API calls`, async ({ open, observed }) => {
    const page = await open(user);
    observed.pages = {};
    for (const label of expected) {
      await page.locator('.sidebar .nav-link', { hasText: label }).first().click();
      await settled(page);
      observed.pages[label] = await page.locator('h1').first().innerText();
    }
    // open one claim from My claims (if any) and check the detail page renders
    await page.locator('.sidebar .nav-link', { hasText: 'My claims' }).click();
    await settled(page);
    const first = page.locator('a.claim-link').first();
    if (await first.count()) {
      await first.click();
      await settled(page);
      observed.detailPage = await page.locator('.page-eyebrow').innerText();
    }
  });
}

await check('FE-04', 'Route guards: roles without access see an access message, not data', async ({ open, observed }) => {
  const emp = await open('employee');
  for (const p of ['/approvals', '/payouts']) {
    await emp.goto(`${UI}${p}`);
    observed[`employee ${p}`] = await emp.locator('.empty-state h3').innerText();
    assert.match(observed[`employee ${p}`], /do not have access/);
  }
  const mgr = await open('manager');
  await mgr.goto(`${UI}/payouts`);
  observed['manager /payouts'] = await mgr.locator('.empty-state h3').innerText();
  assert.match(observed['manager /payouts'], /do not have access/);
});

await check('FE-05', 'Broken routes and missing claims are handled', async ({ open, observed }) => {
  const page = await open('employee');
  await page.goto(`${UI}/this/does/not/exist`);
  observed.unknownRoute = await page.locator('.empty-state h3').innerText();
  await page.goto(`${UI}/claims/999999999`);
  observed.missingClaim = await page.locator('.empty-state h3').innerText();
  assert.equal(observed.unknownRoute, 'Page not found');
  assert.equal(observed.missingClaim, 'Claim not found');
});

await check('FE-06', 'Another employee\'s claim shows "Claim not found" (isolation in the UI)', async ({ open, observed }) => {
  const e1 = await open('employee');
  await e1.goto(`${UI}/claims`);
  await settled(e1);
  const href = await e1.locator('a.claim-link').first().getAttribute('href');
  const e2 = await open('employee2');
  await e2.goto(`${UI}${href}`);
  observed.otherEmployeeView = await e2.locator('.empty-state h3').innerText();
  assert.equal(observed.otherEmployeeView, 'Claim not found');
});

await check('FE-07', 'Form validation feedback on claim creation and expense lines', async ({ open, observed }) => {
  const page = await open('employee');
  await page.goto(`${UI}/claims/new`);
  await page.getByRole('button', { name: /Create draft/ }).click();
  observed.titleError = await page.locator('.field-error').innerText();
  await page.locator('#title').fill(`${RUN} FE-07 validation`);
  await page.getByRole('button', { name: /Create draft/ }).click();
  await page.waitForURL(/edit$/);
  await page.getByRole('button', { name: /Add expense/ }).click();
  observed.lineErrors = await page.locator('.field-error').allInnerTexts();
  await page.locator('#amount').fill('12.345');
  await page.getByRole('button', { name: /Add expense/ }).click();
  observed.decimalsError = await page.locator('.field.has-error .field-error').first().innerText();
  await page.getByRole('radio', { name: /Hotel/ }).click();
  await page.locator('#amount').fill('100');
  await page.locator('#vendor').fill('Hotel');
  await page.getByRole('button', { name: /Add expense/ }).click();
  observed.hotelErrors = await page.locator('.field-error').allInnerTexts();
  observed.submitDisabledWithoutLines = await page.getByRole('button', { name: /Submit for approval/ }).isDisabled();
  assert.match(observed.titleError, /short title/);
  assert.ok(observed.lineErrors.some((t) => /Enter an amount/.test(t)));
  assert.ok(observed.lineErrors.some((t) => /Who did you pay/.test(t)));
  assert.match(observed.decimalsError, /at most 2 decimals/);
  assert.ok(observed.hotelErrors.some((t) => /City is required/.test(t)));
  assert.ok(observed.hotelErrors.some((t) => /At least 1 night/.test(t)));
  assert.equal(observed.submitDisabledWithoutLines, true);
  // cleanup through the UI
  await page.getByRole('button', { name: /Delete draft/ }).click();
  await dialog(page).getByRole('button', { name: 'Delete draft' }).click();
  await page.waitForURL(/\/claims$/);
});

await check('FE-08', 'Script in user input is rendered as text, never executed (XSS)', async ({ open, observed }) => {
  const page = await open('employee');
  const payload = `${RUN} <img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
  await page.goto(`${UI}/claims/new`);
  await page.locator('#title').fill(payload);
  await page.getByRole('button', { name: /Create draft/ }).click();
  await page.waitForURL(/edit$/);
  await page.goto(`${UI}/claims`);
  await settled(page);
  observed.injectedImgElements = await page.locator('img[src="x"]').count();
  observed.xssFlag = await page.evaluate(() => window.__xss ?? null);
  observed.renderedAsText = await page.locator('.cell-sub', { hasText: '<img src=x' }).count() > 0;
  assert.equal(observed.injectedImgElements, 0);
  assert.equal(observed.xssFlag, null);
  assert.ok(observed.renderedAsText);
  await page.locator('a.claim-link').first().click();
  await page.getByRole('button', { name: /Delete/ }).first().click();
  await dialog(page).getByRole('button', { name: 'Delete draft' }).click();
  await page.waitForURL(/\/claims$/);
});

await check('FE-09', 'Error state with Retry when the API fails, then recovery', async ({ open, observed }) => {
  const page = await open('employee');
  await page.route('**/api/claims', (route) => route.abort('failed'));
  await page.goto(`${UI}/claims`);
  observed.errorBanner = await page.locator('.alert-error').innerText();
  page.problems.length = 0; // the aborted request is intentional
  await page.unroute('**/api/claims');
  await page.locator('.alert-error').getByRole('button', { name: /Retry/ }).click();
  await settled(page);
  observed.rowsAfterRetry = await page.locator('tbody tr').count();
  page.problems = page.problems.filter((p) => !p.includes('ERR_FAILED'));
  assert.match(observed.errorBanner, /Cannot reach the server/);
  assert.ok(observed.rowsAfterRetry > 0);
});

await check('FE-10', 'Empty states: approvals with no matches, search with no results', async ({ open, observed }) => {
  const aud = await open('auditor');
  await aud.goto(`${UI}/approvals`);
  await aud.locator('#f-min').fill('99999999');
  await aud.locator('#f-min').press('Enter');
  observed.approvalsEmpty = await aud.locator('.empty-state h3').innerText();
  const emp = await open('employee');
  await emp.goto(`${UI}/claims`);
  await settled(emp);
  await emp.locator('#q').fill('zz-no-such-claim-zz');
  observed.searchEmpty = await emp.locator('.empty-state h3').innerText();
  assert.match(observed.approvalsEmpty, /caught up|No matching/);
  assert.equal(observed.searchEmpty, 'No matching claims');
});

await check('FE-11', 'Search, status filter and pagination on My claims', async ({ open, observed }) => {
  const page = await open('employee');
  await page.goto(`${UI}/claims`);
  await settled(page);
  observed.paginationInfo = await page.locator('.pagination-info').innerText();
  const firstPageFirst = await page.locator('a.claim-link').first().innerText();
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.locator('.pagination-info', { hasText: /^16–30 of/ }).waitFor();
  observed.paginationInfoPage2 = await page.locator('.pagination-info').innerText();
  const secondPageFirst = await page.locator('a.claim-link').first().innerText();
  observed.pageChanged = firstPageFirst !== secondPageFirst;
  await page.locator('#q').fill(firstPageFirst);
  observed.searchRows = await page.locator('tbody tr').count();
  await page.locator('#q').fill('');
  await page.getByRole('button', { name: /^Paid/ }).click();
  observed.paidFilterBadges = [...new Set(await page.locator('tbody .badge').allInnerTexts())];
  assert.match(observed.paginationInfo, /^1–15 of \d+/);
  assert.ok(observed.pageChanged);
  assert.equal(observed.searchRows, 1);
  assert.deepEqual(observed.paidFilterBadges, ['Paid']);
});

await check('FE-12', 'Forged/expired credentials send the user back to the login page', async ({ open, observed }) => {
  const page = await open('employee');
  await page.evaluate(() => sessionStorage.setItem('expenseflow.auth', `Basic ${btoa('employee:wrong')}`));
  await page.reload();
  await page.waitForURL(/\/login/);
  observed.url = page.url();
  page.problems = page.problems.filter((p) => !p.includes('401'));
});

await check('FE-13', 'Logout clears the session and protects routes', async ({ open, observed }) => {
  const page = await open('manager');
  await page.getByRole('button', { name: /Log out/ }).click();
  await page.waitForURL(/\/login$/);
  observed.storageAfterLogout = await page.evaluate(() => sessionStorage.getItem('expenseflow.auth'));
  await page.goto(`${UI}/approvals`);
  await page.waitForURL(/\/login$/);
  assert.equal(observed.storageAfterLogout, null);
  assert.equal(await page.evaluate(() => localStorage.getItem('expenseflow.auth')), null);
});

await check('FE-14', 'Receipt viewer shows the uploaded receipt to the approver', async ({ open, observed }) => {
  const e2e = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'e2e-results.json'), 'utf8'));
  const id = e2e.results.find((r) => r.id === 'E2E-01').observed.claimId;
  const page = await open('manager');
  await page.goto(`${UI}/claims/${id}`);
  await page.locator('.receipt-frame img').waitFor();
  observed.naturalWidth = await page.locator('.receipt-frame img').evaluate((img) => img.naturalWidth);
  observed.blobUrl = (await page.locator('.receipt-frame img').getAttribute('src')).startsWith('blob:');
  assert.ok(observed.naturalWidth > 0);
  assert.ok(observed.blobUrl);
});

for (const [label, viewport] of [['phone 390px', { width: 390, height: 844 }], ['tablet 820px', { width: 820, height: 1180 }]]) {
  await check(`FE-15-${label.split(' ')[0]}`, `Responsive ${label}: no horizontal overflow; drawer navigation works`, async ({ open, observed }) => {
    const page = await open('financehead', { viewport });
    observed.overflow = {};
    for (const p of ['/dashboard', '/claims', '/claims/new', '/approvals', '/payouts', '/policy-rules']) {
      await page.goto(`${UI}${p}`);
      await settled(page);
      observed.overflow[p] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    }
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.locator('.sidebar .nav-link', { hasText: 'Payouts' }).click();
    await page.waitForURL(/\/payouts$/);
    observed.drawerClosedAfterNav = !(await page.locator('.app-shell').getAttribute('class')).includes('is-mobile-open');
    await shot(page, `FE-15-${label.split(' ')[0]}-payouts`);
    assert.ok(Object.values(observed.overflow).every((o) => o <= 1), JSON.stringify(observed.overflow));
    assert.ok(observed.drawerClosedAfterNav);
  });
}

await closeBrowser();
const summary = { run: RUN, executedAt: new Date().toISOString(), ui: UI, password: PASSWORD ? '(demo)' : null, total: results.length,
  passed: results.filter((r) => r.status === 'Pass').length, failed: results.filter((r) => r.status === 'Fail').length, results };
delete summary.password;
fs.writeFileSync(path.join(EVIDENCE, 'frontend-results.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\n${summary.passed}/${summary.total} passed`);
process.exitCode = summary.failed ? 1 : 0;
