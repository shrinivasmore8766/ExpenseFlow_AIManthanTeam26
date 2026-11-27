// Unit/integration tests for frontend/src/api/client.js (the only module that talks to the backend).
// Runs on Node's built-in test runner with a mocked fetch; no browser or extra dependencies.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../../frontend/src/api/client.js';

let calls;
function mockFetch(responder) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return responder(url, init);
  };
}
const json = (status, body, headers = {}) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});

beforeEach(() => client.setAuth(null));

describe('query()', () => {
  test('builds a query string and skips empty values', () => {
    assert.equal(client.query({ status: 'PENDING_MANAGER', departmentId: '', minAmount: null, flaggedOnly: false }), '?status=PENDING_MANAGER');
    assert.equal(client.query({ flaggedOnly: true, minAmount: 0 }), '?flaggedOnly=true&minAmount=0');
    assert.equal(client.query({}), '');
  });

  test('encodes special characters', () => {
    assert.equal(client.query({ q: "a&b=c'" }), "?q=a%26b%3Dc%27");
  });
});

describe('basicAuthHeader()', () => {
  test('encodes ASCII and non-ASCII credentials as UTF-8 base64', () => {
    assert.equal(client.basicAuthHeader('employee', 'Demo@123'), `Basic ${Buffer.from('employee:Demo@123').toString('base64')}`);
    assert.equal(client.basicAuthHeader('ramesh', 'pässwörd₹'), `Basic ${Buffer.from('ramesh:pässwörd₹', 'utf8').toString('base64')}`);
  });
});

describe('request handling', () => {
  test('prefixes /api, sends Authorization and Accept, parses JSON', async () => {
    mockFetch(() => json(200, { id: 1 }));
    client.setAuth('Basic abc');
    const r = await client.apiGet('/me');
    assert.deepEqual(r, { id: 1 });
    assert.equal(calls[0].url, '/api/me');
    assert.equal(calls[0].init.headers.Authorization, 'Basic abc');
    assert.equal(calls[0].init.headers.Accept, 'application/json');
  });

  test('JSON bodies get a Content-Type; GET has no body', async () => {
    mockFetch(() => json(200, {}));
    await client.apiPost('/claims', { title: 't' });
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].init.body, '{"title":"t"}');
    await client.apiGet('/claims');
    assert.equal(calls[1].init.body, undefined);
  });

  test('apiUpload sends FormData and lets the browser set the multipart Content-Type', async () => {
    mockFetch(() => json(200, { ok: true }));
    await client.apiUpload('/claims/1/lines/2/receipt', new Blob(['x'], { type: 'image/png' }));
    assert.ok(calls[0].init.body instanceof FormData);
    assert.equal(calls[0].init.headers['Content-Type'], undefined);
    assert.ok(calls[0].init.body.get('file'));
  });

  test('204 No Content resolves to null', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    assert.equal(await client.apiDelete('/claims/1'), null);
  });

  test('errors carry ProblemDetail.detail, status and field errors', async () => {
    mockFetch(() => json(400, { title: 'Bad Request', status: 400, detail: 'amount: must be greater than 0', errors: { amount: 'must be greater than 0' } }));
    await assert.rejects(client.apiPost('/claims/1/lines', {}), (e) => {
      assert.equal(e.message, 'amount: must be greater than 0');
      assert.equal(e.status, 400);
      assert.deepEqual(e.fieldErrors, { amount: 'must be greater than 0' });
      return true;
    });
  });

  test('falls back to title, then to a generic message for non-JSON errors', async () => {
    mockFetch(() => json(409, { title: 'Conflict' }));
    await assert.rejects(client.apiGet('/x'), { message: 'Conflict', status: 409 });
    mockFetch(() => new Response('<html>gateway</html>', { status: 502 }));
    await assert.rejects(client.apiGet('/x'), { message: 'Request failed (502)', status: 502 });
  });

  test('401 clears credentials and calls the unauthorized handler', async () => {
    let fired = 0;
    client.setUnauthorizedHandler(() => { fired++; });
    client.setAuth('Basic abc');
    mockFetch(() => json(401, { detail: 'Authentication required.' }));
    await assert.rejects(client.apiGet('/me'), { status: 401 });
    assert.equal(fired, 1);
    assert.equal(client.hasAuth(), false);
  });

  test('403 keeps credentials (wrong role is not a logout)', async () => {
    let fired = 0;
    client.setUnauthorizedHandler(() => { fired++; });
    client.setAuth('Basic abc');
    mockFetch(() => json(403, { detail: 'You do not have permission to perform this action.' }));
    await assert.rejects(client.apiGet('/payouts'), { status: 403 });
    assert.equal(fired, 0);
    assert.equal(client.hasAuth(), true);
  });

  test('network failure produces a friendly message with status 0', async () => {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(client.apiGet('/me'), { status: 0, message: 'Cannot reach the server. Check that the backend is running.' });
  });

  test('apiDownload returns the blob and the server file name', async () => {
    mockFetch(() => new Response('H,EXPENSEFLOW', {
      status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="payout_PB-00001.csv"' },
    }));
    const d = await client.apiDownload('/payouts/1/csv');
    assert.equal(d.filename, 'payout_PB-00001.csv');
    assert.equal(d.contentType, 'text/csv');
    assert.equal(await d.blob.text(), 'H,EXPENSEFLOW');
  });
});
