import assert from 'node:assert/strict';
import { test } from 'node:test';
import { departureReasons } from '../src/features/groups/departure-reasons.ts';

test('departure conflict reasons recognize both balance directions, bill roles, repayments and last member guidance', () => {
  for (const netCents of [-1, 1]) assert.equal(departureReasons([{ code: 'nonzero_balance', netCents }]), true);
  assert.equal(departureReasons([
    { code: 'incomplete_bills', bills: [{ id: 'bill', title: 'Groceries', role: 'initiator' }, { id: 'bill-2', title: 'Lunch', role: 'participant' }] },
    { code: 'pending_repayments', repayments: [{ id: 'repayment', senderId: 'alice', recipientId: 'bob', amountCents: 1 }] },
    { code: 'sole_member' },
  ]), true);
});

test('malformed, unknown and group-deletion reasons are not departure conflict reasons', () => {
  for (const value of [undefined, null, {}, [], [null], [{ code: 'unknown' }],
    [{ code: 'nonzero_balances', members: [{ userId: 'bob', displayName: 'Bob', netCents: 1 }] }],
    [{ code: 'nonzero_balance', netCents: 0 }], [{ code: 'nonzero_balance', netCents: 0.5 }], [{ code: 'nonzero_balance', netCents: '1' }],
    [{ code: 'incomplete_bills', count: 1 }], [{ code: 'incomplete_bills', bills: [] }],
    [{ code: 'incomplete_bills', bills: [{ id: 'bill', title: 'Dinner', role: 'owner' }] }],
    [{ code: 'pending_repayments', count: 1 }], [{ code: 'pending_repayments', repayments: [] }],
    [{ code: 'pending_repayments', repayments: [{ id: 'repayment', senderId: 'alice', recipientId: 'bob', amountCents: -1 }] }],
    [{ code: 'pending_repayments', repayments: [{ id: 'repayment', recipientId: 'bob', amountCents: 1 }] }],
  ]) assert.equal(departureReasons(value), false, JSON.stringify(value));
});
