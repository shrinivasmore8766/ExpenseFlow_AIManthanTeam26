// Authentication, authorization, data isolation and basic security checks against the live API.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, call, ok, draftClaim, form, uniquePng, weekday } from './lib.mjs';

describe('Authentication', () => {
  test('AUTH-01 no credentials -> 401 without WWW-Authenticate (no browser popup)', async () => {
    const r = await call(null, 'GET', '/api/me');
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('www-authenticate'), null);
    assert.equal(r.json.status, 401);
  });

  test('AUTH-02 wrong password -> 401', async () => {
    const r = await call('employee', 'GET', '/api/me', undefined, { password: 'wrong-password' });
    assert.equal(r.status, 401);
  });

  test('AUTH-03 unknown user gets the same 401 body as a wrong password (no user enumeration)', async () => {
    const a = await call('no.such.user', 'GET', '/api/me', undefined, { password: 'x' });
    const b = await call('employee', 'GET', '/api/me', undefined, { password: 'x' });
    assert.equal(a.status, 401);
    assert.equal(a.text, b.text);
  });

  test('AUTH-04 valid credentials return the current user and role', async () => {
    const me = await ok('employee', 'GET', '/api/me');
    assert.equal(me.username, 'employee');
    assert.equal(me.role, 'EMPLOYEE');
    assert.ok(!('passwordHash' in me) && !('password' in me), 'no password material in /api/me');
  });

  test('AUTH-05 credentials are checked on every request (stateless, no session cookie)', async () => {
    const r = await call('employee', 'GET', '/api/me');
    assert.equal(r.headers.get('set-cookie'), null);
    const again = await call('employee', 'GET', '/api/me', undefined, { password: 'bad' });
    assert.equal(again.status, 401);
  });

  test('AUTH-06 health endpoint is public', async () => {
    const r = await call(null, 'GET', '/actuator/health');
    assert.equal(r.status, 200);
  });
});

describe('Role-based access control', () => {
  const forbidden = [
    ['employee', 'GET', '/api/approvals'],
    ['employee', 'GET', '/api/dashboard'],
    ['employee', 'GET', '/api/users'],
    ['employee', 'GET', '/api/delegations'],
    ['employee', 'GET', '/api/payouts'],
    ['employee', 'GET', '/api/payouts/eligible'],
    ['employee', 'POST', '/api/payouts'],
    ['employee', 'POST', '/api/approvals/bulk-approve', { claimIds: [1] }],
    ['employee', 'PUT', '/api/policy-rules/1', { limitAmount: 1, active: true }],
    ['manager', 'GET', '/api/payouts'],
    ['manager', 'POST', '/api/payouts'],
    ['manager', 'POST', '/api/approvals/bulk-approve', { claimIds: [1] }],
    ['manager', 'PUT', '/api/policy-rules/1', { limitAmount: 1, active: true }],
    ['auditor', 'GET', '/api/payouts'],
    ['auditor', 'POST', '/api/payouts/1/mark-paid'],
    ['auditor', 'PUT', '/api/policy-rules/1', { limitAmount: 1, active: true }],
  ];
  for (const [user, method, path, body] of forbidden) {
    test(`RBAC ${user} ${method} ${path} -> 403`, async () => {
      const r = await call(user, method, path, body);
      assert.equal(r.status, 403, r.text);
      assert.equal(r.json.detail, 'You do not have permission to perform this action.');
    });
  }

  const allowed = [
    ['manager', '/api/approvals'], ['manager', '/api/dashboard'], ['auditor', '/api/approvals'],
    ['auditor', '/api/dashboard'], ['financehead', '/api/payouts'], ['financehead', '/api/dashboard'],
    ['employee', '/api/policy-rules'], ['employee', '/api/departments'], ['employee', '/api/claims'],
  ];
  for (const [user, path] of allowed) {
    test(`RBAC ${user} GET ${path} -> 200`, async () => {
      const r = await call(user, 'GET', path);
      assert.equal(r.status, 200, r.text);
    });
  }
});

describe('Employee data isolation', () => {
  let claim;
  before(async () => {
    claim = await draftClaim('employee', 'isolation draft', [{ category: 'MEAL', amount: 200, receipt: true }]);
  });

  test('ISO-01 GET /api/claims returns only the caller\'s own claims', async () => {
    const mine = await ok('employee2', 'GET', '/api/claims');
    const me = await ok('employee2', 'GET', '/api/me');
    assert.ok(mine.length > 0);
    assert.ok(mine.every((c) => c.employeeName === me.fullName));
    assert.ok(!mine.some((c) => c.id === claim.id));
  });

  for (const [label, method, suffix, body] of [
    ['view', 'GET', '', undefined],
    ['rename', 'PUT', '', { title: 'hijack' }],
    ['add line', 'POST', '/lines', { category: 'MEAL', expenseDate: weekday(0), amount: 10, vendor: 'x' }],
    ['submit', 'POST', '/submit', undefined],
    ['delete', 'DELETE', '', undefined],
  ]) {
    test(`ISO-02 another employee cannot ${label} a claim (404, existence not revealed)`, async () => {
      const r = await call('employee2', method, `/api/claims/${claim.id}${suffix}`, body);
      assert.equal(r.status, 404, r.text);
    });
  }

  test('ISO-03 another employee cannot download the receipt', async () => {
    const r = await call('employee2', 'GET', `/api/claims/${claim.id}/lines/${claim.lines[0].id}/receipt`);
    assert.equal(r.status, 404);
  });

  test('ISO-04 a manager cannot open a claim from another department they are not assigned to', async () => {
    // Fixture: a Sales manager (reports to gaurav.reddy) submits a claim; Vikram Rao manages Engineering.
    const draft = await draftClaim('ira.shah', 'foreign dept', [{ category: 'TRAVEL', amount: 300, receipt: true }]);
    const foreign = await ok('ira.shah', 'POST', `/api/claims/${draft.id}/submit`);
    assert.equal(foreign.departmentName, 'Sales');
    assert.equal(foreign.currentApproverName, 'Gaurav Reddy');
    const r = await call('manager', 'GET', `/api/claims/${foreign.id}`);
    assert.equal(r.status, 404);
    assert.equal((await call('manager', 'POST', `/api/claims/${foreign.id}/approve`, {})).status, 404);
    await ok('gaurav.reddy', 'POST', `/api/claims/${foreign.id}/reject`, { comment: 'QA cleanup' });
  });

  test('ISO-05 unknown claim id -> 404', async () => {
    const r = await call('employee', 'GET', '/api/claims/999999999');
    assert.equal(r.status, 404);
  });

  test('ISO-cleanup delete the isolation draft', async () => {
    const r = await call('employee', 'DELETE', `/api/claims/${claim.id}`);
    assert.equal(r.status, 204);
  });
});

describe('Input handling and response hygiene', () => {
  test('SEC-01 SQL-injection text in a title is stored verbatim, tables intact', async () => {
    const title = "x'); DROP TABLE claim;--";
    const c = await ok('employee', 'POST', '/api/claims', { title });
    assert.equal(c.title, title);
    const list = await ok('employee', 'GET', '/api/claims');
    assert.ok(list.some((x) => x.id === c.id));
    await ok('employee', 'DELETE', `/api/claims/${c.id}`, undefined, 204);
  });

  for (const q of ['minAmount=1%20OR%201%3D1', 'status=APPROVED', "status=x'--", 'departmentId=1;DROP']) {
    test(`SEC-02 malicious or invalid query parameter is rejected: ${q}`, async () => {
      const r = await call('auditor', 'GET', `/api/approvals?${q}`);
      assert.equal(r.status, 400, r.text);
      assert.doesNotMatch(r.text, /Exception|at com\.|org\.hibernate|SQL/);
    });
  }

  test('SEC-03 script text is stored as data and returned JSON-encoded (rendering is checked in the browser)', async () => {
    const title = '<img src=x onerror=alert(1)>';
    const c = await ok('employee', 'POST', '/api/claims', { title });
    assert.equal(c.title, title);
    await ok('employee', 'DELETE', `/api/claims/${c.id}`, undefined, 204);
  });

  test('SEC-04 mass assignment: client-supplied status/owner/amount fields are ignored', async () => {
    const other = await ok('employee2', 'GET', '/api/me');
    const c = await ok('employee', 'POST', '/api/claims', {
      title: 'mass assignment', status: 'APPROVED', employeeId: other.id, approvedAmount: 99999, sampleAudit: true,
    });
    assert.equal(c.status, 'DRAFT');
    assert.notEqual(c.employeeId, other.id);
    assert.equal(c.approvedAmount, 0);
    await ok('employee', 'DELETE', `/api/claims/${c.id}`, undefined, 204);
  });

  test('SEC-05 malformed JSON -> 400 without internals', async () => {
    const r = await call('employee', 'POST', '/api/claims', '{"title": ');
    assert.equal(r.status, 400);
    assert.doesNotMatch(r.text, /Exception|at com\.|jackson/i);
  });

  test('SEC-06 security headers are present', async () => {
    const r = await call('employee', 'GET', '/api/me');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.match(r.headers.get('cache-control') || '', /no-store/);
  });

  test('SEC-07 no CORS grant for a foreign origin', async () => {
    const r = await call('employee', 'GET', '/api/me', undefined, { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });

  test('SEC-08 receipt upload: non-image content with an image name/type is rejected', async () => {
    const c = await draftClaim('employee', 'upload validation', [{ category: 'MEAL', amount: 100 }]);
    const lineId = c.lines[0].id;
    const r = await call('employee', 'POST', `/api/claims/${c.id}/lines/${lineId}/receipt`,
      form(Buffer.from('<script>alert(1)</script>'), 'receipt.png', 'image/png'));
    assert.equal(r.status, 400);
    assert.equal(r.json.detail, 'Only PDF, JPEG or PNG receipts are allowed.');
    await ok('employee', 'DELETE', `/api/claims/${c.id}`, undefined, 204);
  });

  test('SEC-09 receipt upload: file above 5 MB is rejected', async () => {
    const c = await draftClaim('employee', 'upload size', [{ category: 'MEAL', amount: 100 }]);
    const big = Buffer.concat([uniquePng(), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const r = await call('employee', 'POST', `/api/claims/${c.id}/lines/${c.lines[0].id}/receipt`, form(big));
    assert.ok([400, 413].includes(r.status), `got ${r.status}`);
    await ok('employee', 'DELETE', `/api/claims/${c.id}`, undefined, 204);
  });

  test('SEC-10 receipt type is taken from content, not the client (PNG bytes named .pdf)', async () => {
    const c = await draftClaim('employee', 'sniffing', [{ category: 'MEAL', amount: 100 }]);
    const up = await ok('employee', 'POST', `/api/claims/${c.id}/lines/${c.lines[0].id}/receipt`,
      form(uniquePng(), 'invoice.pdf', 'application/pdf'));
    assert.equal(up.lines[0].receiptContentType, 'image/png');
    const r = await fetch(`${BASE}/api/claims/${c.id}/lines/${c.lines[0].id}/receipt`, {
      headers: { Authorization: `Basic ${Buffer.from('employee:Demo@123').toString('base64')}` },
    });
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    await ok('employee', 'DELETE', `/api/claims/${c.id}`, undefined, 204);
  });

  test('SEC-11 repeated failed logins: no lockout or throttling (recorded as a finding)', async () => {
    const statuses = [];
    for (let i = 0; i < 15; i++) {
      statuses.push((await call('employee2', 'GET', '/api/me', undefined, { password: `bad-${i}` })).status);
    }
    assert.ok(statuses.every((s) => s === 401));
    // The real password still works afterwards: there is no lockout. See security checklist item 1.
    assert.equal((await call('employee2', 'GET', '/api/me')).status, 200);
  });
});
