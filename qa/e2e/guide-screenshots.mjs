// Captures the screenshots used in docs/USER-GUIDE.md (real UI, real backend).
import fs from 'node:fs';
import path from 'node:path';
import { launch, closeBrowser, login, dialog, receiptFile, UI } from './ui.mjs';

const OUT = path.resolve('../../docs/guide/images');
fs.mkdirSync(OUT, { recursive: true });
const snap = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const settle = async (page, ms = 600) => {
  await page.waitForFunction(() => document.querySelectorAll('.skeleton').length === 0);
  await page.waitForTimeout(ms);
};
const browser = await launch();

// 1. Login
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${UI}/login`);
  await page.getByRole('button', { name: /Employee/ }).click();
  await snap(page, '01-login');
  await ctx.close();
}

// 2–3. Employee: dashboard, then a new claim with three expenses and receipts
const emp = await login('ishaan.mehta');
await settle(emp.page, 1800);
await snap(emp.page, '02-employee-dashboard');
const p = emp.page;
await p.getByRole('link', { name: 'New claim' }).first().click();
await p.locator('#title').fill('Client visit – Pune (Nov 2026)');
await p.getByRole('button', { name: /Create draft/ }).click();
await p.waitForURL(/edit$/);
const lines = [
  ['Hotel', '2026-11-18', '9000', 'Vivanta Pune', 'Pune', '2'],
  ['Travel', '2026-11-17', '6200', 'IndiGo 6E-512'],
  ['Meal', '2026-11-18', '950', 'Malaka Spice'],
];
for (const [i, [cat, date, amount, vendor, city, nights]] of lines.entries()) {
  await p.getByRole('radio', { name: new RegExp(cat) }).click();
  await p.locator('#expenseDate').fill(date);
  await p.locator('#amount').fill(amount);
  await p.locator('#vendor').fill(vendor);
  if (city) { await p.locator('#city').fill(city); await p.locator('#nights').fill(nights); }
  await p.getByRole('button', { name: /Add expense/ }).click();
  await p.waitForFunction((n) => document.querySelectorAll('.line-card').length === n, i + 1);
  await p.locator('.line-card').nth(i).locator('input[type=file]').setInputFiles(receiptFile(`guide-${i}`));
  await p.waitForFunction((n) => document.querySelectorAll('.dropzone.has-file').length === n, i + 1);
}
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(4800); // let toasts fade
await snap(p, '03-new-claim');
await p.getByRole('button', { name: /Submit for approval/ }).click();
await dialog(p).getByRole('button', { name: 'Submit claim' }).click();
await p.waitForURL(/\/claims\/\d+$/);
const claimUrl = p.url();
await emp.ctx.close();

// 4–5. Manager: approval queue and claim review with the receipt side by side
const mgr = await login('manager');
await mgr.page.getByRole('link', { name: /Approvals/ }).click();
await settle(mgr.page);
await snap(mgr.page, '05-approvals-queue');
await mgr.page.goto(claimUrl);
await mgr.page.locator('.receipt-frame img').waitFor();
await settle(mgr.page);
await snap(mgr.page, '04-claim-review');
await mgr.page.locator('.decision-bar').getByRole('button', { name: 'Approve' }).click();
await dialog(mgr.page).locator('textarea').fill('Approved – client visit');
await dialog(mgr.page).getByRole('button', { name: 'Approve' }).click();
await dialog(mgr.page).waitFor({ state: 'detached' });
await mgr.ctx.close();

// 6–7. Finance Head: dashboard and payouts
const fh = await login('financehead');
await fh.page.locator('.recharts-area-area').first().waitFor();
await settle(fh.page, 1800);
await snap(fh.page, '06-finance-dashboard');
await fh.page.getByRole('link', { name: 'Payouts' }).click();
await settle(fh.page);
await snap(fh.page, '07-payouts');
await fh.ctx.close();

await closeBrowser();
console.log('claim', claimUrl);
console.log(fs.readdirSync(OUT).map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)} KB`).join('\n'));
