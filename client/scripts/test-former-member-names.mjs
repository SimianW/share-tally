import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupView } from '../src/features/ledger/group-view.ts';
import { repaymentDisplayName } from '../src/features/repayments/repayment-names.ts';

const currentMembers = [
  { id: 'alice', displayName: 'Alice', isCurrentUser: true },
  { id: 'bob', displayName: 'Bob', isCurrentUser: false },
];
const formerMembers = [{ userId: 'carol', displayName: 'Carol' }];

function pageData() {
  return {
    bills: [], summary: { receivableCents: 0, payableCents: 0, netCents: 0 }, repayments: [],
    group: { members: currentMembers },
    ledger: {
      members: [
        { userId: 'alice', displayName: 'Alice', netCents: 0 },
        { userId: 'bob', displayName: 'Bob', netCents: 0 },
        { userId: 'carol', displayName: 'Carol', netCents: 0 },
      ],
      formerMembers,
      suggestions: [
        { fromUserId: 'alice', toUserId: 'bob', amountCents: 100, explanation: {} },
        { fromUserId: 'alice', toUserId: 'carol', amountCents: 100, explanation: {} },
      ],
      incompleteBillIds: [], entries: [], directDebts: [],
    },
  };
}

test('ledger names former people while keeping balance members and transfer targets current', () => {
  const view = groupView(pageData());
  assert.equal(view.name('carol'), 'Carol');
  assert.equal(view.name('unknown'), 'Member');
  assert.deepEqual(view.members.map(member => member.userId), ['alice', 'bob']);
  assert.deepEqual(view.suggestions.map(suggestion => [suggestion.fromUserId, suggestion.toUserId]), [['alice', 'bob']]);
});

test('repayment history resolves former names without changing current-name precedence', () => {
  const group = { members: currentMembers };
  assert.equal(repaymentDisplayName(group, formerMembers, 'carol'), 'Carol');
  assert.equal(repaymentDisplayName(group, [...formerMembers, { userId: 'bob', displayName: 'Old Bob' }], 'bob'), 'Bob');
  assert.equal(repaymentDisplayName(group, formerMembers, 'unknown'), 'Member');
});
