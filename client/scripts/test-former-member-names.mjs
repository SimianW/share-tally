import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupView } from '../src/features/ledger/group-view.ts';
import { repaymentDisplayName } from '../src/features/repayments/repayment-names.ts';

const currentMembers = [
  { id: 'alice', displayName: 'Alice', isCurrentUser: true },
  { id: 'bob', displayName: 'Bob', isCurrentUser: false },
];
const formerMembers = [{ userId: 'carol', displayName: 'Carol', netCents: 0 }];

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
  const ledger = { members: [], formerMembers };
  assert.equal(repaymentDisplayName(group, ledger, 'carol'), 'Carol');
  assert.equal(repaymentDisplayName(group, { members: [], formerMembers: [...formerMembers, { userId: 'bob', displayName: 'Old Bob' }] }, 'bob'), 'Bob');
  assert.equal(repaymentDisplayName(group, ledger, 'unknown'), 'Member');
});

// The member list counts current members only, so it carries no tag for Bob; the
// ledger also counts the former Bob and tags both.
test('financial views keep the history-scoped Username of a current member', () => {
  const data = pageData();
  data.ledger.members = [
    { userId: 'alice', displayName: 'Alice', netCents: 0 },
    { userId: 'bob', displayName: 'Bob', username: 'bob-now', netCents: 0 },
  ];
  data.ledger.formerMembers = [{ userId: 'old-bob', displayName: 'Bob', username: 'bob-then', netCents: 0 }];
  data.repayments = [{ id: 'r1', senderId: 'bob', recipientId: 'alice', status: 'pending', createdAt: '2026-10-01T00:00:00Z' }];
  const view = groupView(data);
  assert.equal(view.name('bob'), 'Bob @bob-now');
  assert.equal(view.name('old-bob'), 'Bob @bob-then');
  assert.equal(view.rows.find(row => row.member.id === 'bob').member.username, 'bob-now');
  assert.equal(repaymentDisplayName(data.group, data.ledger, 'bob'), 'Bob @bob-now');
  assert.equal(repaymentDisplayName(data.group, data.ledger, 'old-bob'), 'Bob @bob-then');
});
