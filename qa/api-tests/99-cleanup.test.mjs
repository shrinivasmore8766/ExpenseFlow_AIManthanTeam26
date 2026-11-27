// Cleanup: reject QA claims still pending with the manager and delete QA drafts, so the demo queues stay clean.
// Approved/paid QA claims stay (they are part of payout evidence); every QA claim title starts with "QA-".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, ok } from './lib.mjs';

for (const user of ['employee', 'employee2', 'financehead']) {
  test(`CLEAN ${user}: reject pending QA claims and delete QA drafts`, async () => {
    const mine = (await ok(user, 'GET', '/api/claims')).filter((c) => c.title.startsWith('QA'));
    for (const c of mine) {
      if (c.status === 'DRAFT') {
        assert.equal((await call(user, 'DELETE', `/api/claims/${c.id}`)).status, 204);
      } else if (c.status.startsWith('PENDING_')) {
        for (const approver of ['manager', 'auditor', 'financehead', 'ceo']) {
          const r = await call(approver, 'POST', `/api/claims/${c.id}/reject`, { comment: 'QA cleanup' });
          if (r.status === 200) break;
        }
      }
    }
  });
}
