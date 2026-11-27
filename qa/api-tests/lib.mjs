// Shared helpers for the ExpenseFlow API integration tests (Node 20+, no dependencies).
import crypto from 'node:crypto';

export const BASE = process.env.API_BASE || 'http://localhost:8080';
export const PASSWORD = process.env.DEMO_PASSWORD || 'Demo@123';
export const RUN = `QA-${Date.now().toString(36)}`;

function auth(user, password = PASSWORD) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

/** Raw request. user=null sends no credentials. Returns { status, headers, json, text }. */
export async function call(user, method, path, body, { password, headers = {} } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (user) h.Authorization = auth(user, password);
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, json, text };
}

/** Like call() but throws unless the status is expected (default 2xx). */
export async function ok(user, method, path, body, expected) {
  const r = await call(user, method, path, body);
  const good = expected ? r.status === expected : r.status >= 200 && r.status < 300;
  if (!good) throw new Error(`${method} ${path} as ${user}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return r.json;
}

/** A unique, valid PNG signature + random payload (unique SHA-256 every call). */
export function uniquePng() {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(48)]);
}

export function form(bytes, filename = 'receipt.png', type = 'image/png') {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), filename);
  return fd;
}

// Expense dates: weekdays in 2024, i.e. outside the seeded 12-month window, offset per run.
const seed = parseInt(crypto.createHash('sha1').update(RUN).digest('hex').slice(0, 6), 16);
const base = new Date(Date.UTC(2024, 0, 1 + (seed % 40) * 7)); // a Monday-aligned week (2024-01-01 is a Monday)
/** n-th Wednesday from the run's base week (distinct n => distinct dates => no meal-total interference). */
export function weekday(n = 0) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + 2 + n * 7);
  return d.toISOString().slice(0, 10);
}
export function saturday(n = 0) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + 5 + n * 7);
  return d.toISOString().slice(0, 10);
}
export function todayUtc(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

let vendorSeq = 0;
export const vendor = (label = 'Vendor') => `${label} ${RUN}-${++vendorSeq}`;

/**
 * Creates a draft claim with lines. Each line: { category, amount, date, vendor?, city?, nights?, receipt? }
 * receipt: true => a fresh unique PNG; Buffer => those exact bytes; falsy => no receipt.
 */
export async function draftClaim(user, title, lines) {
  let claim = await ok(user, 'POST', '/api/claims', { title: `${RUN} ${title}` });
  for (const l of lines) {
    claim = await ok(user, 'POST', `/api/claims/${claim.id}/lines`, {
      category: l.category,
      expenseDate: l.date || weekday(0),
      amount: l.amount,
      vendor: l.vendor || vendor(l.category),
      city: l.city ?? null,
      nights: l.nights ?? null,
      description: l.description ?? null,
    });
    if (l.receipt) {
      const line = claim.lines[claim.lines.length - 1];
      const bytes = Buffer.isBuffer(l.receipt) ? l.receipt : uniquePng();
      claim = await ok(user, 'POST', `/api/claims/${claim.id}/lines/${line.id}/receipt`, form(bytes));
    }
  }
  return claim;
}

export async function submittedClaim(user, title, lines) {
  const draft = await draftClaim(user, title, lines);
  return ok(user, 'POST', `/api/claims/${draft.id}/submit`);
}

export const approve = (user, id, comment) => call(user, 'POST', `/api/claims/${id}/approve`, comment ? { comment } : {});
export const reject = (user, id, comment) => call(user, 'POST', `/api/claims/${id}/reject`, { comment });
export const sendBack = (user, id, comment) => call(user, 'POST', `/api/claims/${id}/send-back`, { comment });

export const codes = (line) => line.violations.map((v) => v.ruleCode).sort();
