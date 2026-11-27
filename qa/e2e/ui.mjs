// UI helpers: every action goes through the real ExpenseFlow screens in Chrome (playwright-core).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const UI = process.env.UI_BASE || 'http://localhost:5173';
export const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@123';
export const RUN = `QA-${Date.now().toString(36)}`;
const here = path.dirname(fileURLToPath(import.meta.url));
export const EVIDENCE = path.resolve(here, '../../docs/testing/evidence');
export const TMP = path.resolve(here, '.tmp');
fs.mkdirSync(EVIDENCE, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// ---- dates: weekdays/saturdays in 2024 (outside the seeded 12-month window), offset per run
const seed = parseInt(crypto.createHash('sha1').update(RUN).digest('hex').slice(0, 6), 16);
const base = new Date(Date.UTC(2024, 0, 1 + (seed % 40) * 7)); // a Monday
const shift = (days) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const wednesday = (n = 0) => shift(2 + n * 7);
export const saturday = (n = 0) => shift(5 + n * 7);
export const todayLocal = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let seq = 0;
export const vendor = (label) => `${label} ${RUN}-${++seq}`;

// ---- receipts: a real, viewable PNG with a unique hash
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
export function receiptFile(name) {
  const w = 240, h = 320;
  const [r, g, b] = crypto.randomBytes(3);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3; const ink = y % 24 < 3 && x > 24 && x < w - 24;
    raw[o] = ink ? 50 : 245 - (r % 12); raw[o + 1] = ink ? 50 : 244 - (g % 12); raw[o + 2] = ink ? 60 : 240 - (b % 12);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const p = path.join(TMP, `${RUN}-${name}.png`);
  fs.writeFileSync(p, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return p;
}

// ---- browser sessions
let browser;
export async function launch() {
  browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', headless: true });
  return browser;
}
export async function closeBrowser() { await browser?.close(); }

/** Opens a context, logs in through the login form, waits for the dashboard. Tracks console/API problems. */
export async function login(username, { viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of (40[0-9]|409|413)/.test(m.text())) page.problems.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) page.problems.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`${UI}/login`);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  return { ctx, page };
}

export const dialog = (page) => page.getByRole('dialog');
export async function statusText(page) {
  return page.locator('.title-row .badge').first().innerText();
}
export async function violationCodes(page) {
  return (await page.locator('.violations code').allInnerTexts()).map((s) => s.trim()).sort();
}
export async function shot(page, name) {
  const file = path.join(EVIDENCE, 'screenshots', `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(path.resolve(EVIDENCE, '..'), file).replace(/\\/g, '/');
}

const CATEGORY_RADIO = { MEAL: /Meal/, HOTEL: /Hotel/, LOCAL_CAB: /Local cab/, TRAVEL: /Travel/, OTHER: /Other/ };

/**
 * Creates a claim through the New claim form. lines: { category, amount, date, vendor, city?, nights?, receipt? (file path) }
 * Returns the claim id. Leaves the page on the edit screen.
 */
export async function createClaim(page, title, lines) {
  await page.getByRole('link', { name: 'New claim' }).first().click();
  await page.locator('#title').fill(`${RUN} ${title}`);
  await page.getByRole('button', { name: /Create draft/ }).click();
  await page.waitForURL(/\/claims\/\d+\/edit$/);
  const id = Number(page.url().match(/claims\/(\d+)\/edit/)[1]);
  for (const [i, l] of lines.entries()) {
    await page.getByRole('radio', { name: CATEGORY_RADIO[l.category] }).click();
    await page.locator('#expenseDate').fill(l.date);
    await page.locator('#amount').fill(String(l.amount));
    await page.locator('#vendor').fill(l.vendor);
    if (l.category === 'HOTEL') {
      await page.locator('#city').fill(l.city);
      await page.locator('#nights').fill(String(l.nights));
    }
    await page.getByRole('button', { name: /Add expense/ }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.line-card').length === n, i + 1);
    if (l.receipt) {
      const before = await page.locator('.dropzone.has-file').count();
      await page.locator('.line-card').nth(i).locator('input[type=file]').setInputFiles(l.receipt);
      await page.waitForFunction((n) => document.querySelectorAll('.dropzone.has-file').length === n, before + 1);
    }
  }
  return id;
}

/** Submits from the edit screen through the confirm dialog; returns to the claim detail page. */
export async function submit(page) {
  await page.getByRole('button', { name: /Submit for approval|Resubmit claim/ }).click();
  await dialog(page).getByRole('button', { name: 'Submit claim' }).click();
  await page.waitForURL(/\/claims\/\d+$/);
  await page.locator('.title-row .badge').first().waitFor();
}

/** Opens the claim as an approver and takes a decision through the decision dialog. */
export async function decide(page, claimId, action, comment) {
  await page.goto(`${UI}/claims/${claimId}`);
  await page.locator('.decision-bar').waitFor();
  await page.locator('.decision-bar').getByRole('button', { name: action }).click();
  if (comment) await dialog(page).locator('textarea').fill(comment);
  await dialog(page).getByRole('button', { name: action }).click();
  await dialog(page).waitFor({ state: 'detached' });
  await page.locator('.title-row .badge').first().waitFor();
}

export async function historyEntries(page) {
  return page.locator('.timeline li').evaluateAll((lis) => lis.map((li) => ({
    head: li.querySelector('.timeline-head')?.innerText.replace(/\s+/g, ' ').trim(),
    comment: li.querySelector('.timeline-comment')?.innerText.trim() || null,
  })));
}
