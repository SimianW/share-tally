import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let child: ChildProcess | undefined;
let baseUrl: string;
let serverErrors = '';

async function startServer() {
  assert.ok(container);
  // Never read .env or use the developer's DATABASE_URL in this suite.
  const processUnderTest = fork(new URL('./server-process.ts', import.meta.url), {
    execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
    stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
  });
  processUnderTest.stderr!.on('data', (chunk: Buffer) => {
    serverErrors += chunk.toString();
    process.stderr.write(chunk);
  });
  child = processUnderTest;
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 10_000);
    processUnderTest.once('message', (message) => {
      clearTimeout(timer);
      if (typeof message !== 'number') reject(new Error('Invalid server port'));
      else resolve(message);
    });
    processUnderTest.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Test server exited before startup: ${code}`));
    });
    processUnderTest.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
  baseUrl = `http://127.0.0.1:${port}`;
}

function waitForProcessMessage(expected: string) {
  return new Promise<void>((resolve, reject) => {
    assert.ok(child);
    const onMessage = (message: unknown) => {
      if (message !== expected) return;
      child!.off('message', onMessage);
      resolve();
    };
    child.on('message', onMessage);
    child.once('exit', code => { child?.off('message', onMessage); reject(new Error(`Server exited before ${expected}: ${code}`)); });
  });
}

async function stopServer() {
  const running = child;
  child = undefined;
  if (!running || running.exitCode !== null || running.signalCode !== null) return;
  const exited = once(running, 'exit');
  const timer = setTimeout(() => running.kill('SIGKILL'), 5_000);
  running.kill('SIGTERM');
  try { await exited; } finally { clearTimeout(timer); }
}

before(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  // Apply the committed migration history, rather than creating a test-only schema.
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await startServer();
}, { timeout: 120_000 });

after(async () => {
  try { await stopServer(); }
  finally {
    try { await pool?.end(); }
    finally { await container?.stop(); }
  }
});

beforeEach(async () => {
  // 仅清空本测试创建的临时数据库。
  //
  // 三张表一起清空，避免外键引用阻止 TRUNCATE。
  // 不要把这条语句拿去开发或生产数据库手动执行。
  await pool.query(
    'TRUNCATE TABLE note_photos, item_claims, bill_items, receipt_evidence, receipt_photos, receipt_drafts, repayments, bill_shares, bills, group_members, groups, users',
  )
  await clerk('reset-profiles', 'profiles-reset');
})

async function clerk(message: unknown, reply: string) {
  const replied = waitForProcessMessage(reply);
  child!.send(message as string);
  await replied;
}

async function api(path: string, token = 'alice-token', method = 'GET', body?: unknown) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
}

async function json(response: Response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}

type Member = { id: string; displayName: string; isOwner: boolean; isCurrentUser: boolean };

// A group created by Alice with the given friends joined through its invitation.
async function groupWith(...tokens: string[]) {
  const group = (await json(await api('/groups', 'alice-token', 'POST', {
    name: 'Costco', icon: { type: 'lucide', value: 'shopping-basket' },
  }), 201)).group;
  const invitation = (await json(await api(`/groups/${group.id}/invitation`))).path.split('/').at(-1) as string;
  for (const token of tokens) await json(await api('/groups/join', token, 'POST', { token: invitation }));
  const members: Member[] = (await json(await api(`/groups/${group.id}`))).group.members;
  const id = (name: string) => members.find(member => member.displayName === name)!.id;
  return { id: group.id as string, invitation, alice: id('Alice'), bob: tokens.includes('bob-token') ? id('Bob') : '',
    carol: tokens.includes('carol-token') ? id('Carol') : '' };
}

const leave = (groupId: string, token: string, body: unknown = {}) => api(`/groups/${groupId}/leave`, token, 'POST', body);
const remove = (groupId: string, userId: string, token = 'alice-token') => api(`/groups/${groupId}/members/${userId}`, token, 'DELETE');
const eligibility = (groupId: string, userId: string, token = 'alice-token') => api(`/groups/${groupId}/members/${userId}/departure`, token);
const detail = async (groupId: string, token = 'alice-token') => (await json(await api(`/groups/${groupId}`, token))).group;

test('an ordinary member leaves; the group continues for everyone else and the former member loses access', async () => {
  const group = await groupWith('bob-token', 'carol-token');
  assert.deepEqual(await json(await eligibility(group.id, group.bob, 'bob-token')), { eligible: true, reasons: [] });
  assert.deepEqual(await json(await leave(group.id, 'bob-token')), { left: true });
  const remaining = await detail(group.id);
  assert.deepEqual(remaining.members.map((m: Member) => m.displayName), ['Alice', 'Carol']);
  assert.equal(remaining.memberCount, 2);
  assert.deepEqual((await json(await api('/groups', 'bob-token'))).groups, []);
  for (const path of [`/groups/${group.id}`, `/groups/${group.id}/bills`, `/groups/${group.id}/receipt-drafts`, `/groups/${group.id}/events`])
    await json(await api(path, 'bob-token'), 404);
  await json(await leave(group.id, 'bob-token'), 404);
});

const tokens: Record<string, string> = {};
// Creates a manual bill and, when shares are given, submits them so it completes.
async function bill(groupId: string, initiator: string, participants: Record<string, number | null>, totalCents?: number) {
  const ids = Object.keys(participants);
  const created = (await json(await api(`/groups/${groupId}/bills`, tokens[initiator], 'POST', {
    requestId: crypto.randomUUID(), title: 'Shared lunch', purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '',
    totalCents: totalCents ?? Object.values(participants).reduce<number>((sum, cents) => sum + (cents ?? 0), 0),
    participantIds: ids,
  }), 201)).bill;
  let current = created;
  for (const [userId, amountCents] of Object.entries(participants)) if (amountCents !== null)
    current = (await json(await api(`/bills/${created.id}/share`, tokens[userId], 'POST', {
      amountCents, revision: created.revision, expectedAmountCents: null,
    }))).bill;
  return current;
}
async function repay(groupId: string, sender: string, recipient: string, amountCents: number, decision?: 'confirmed' | 'rejected') {
  const record = (await json(await api(`/groups/${groupId}/repayments`, tokens[sender], 'POST', {
    requestId: crypto.randomUUID(), recipientId: recipient, amountCents,
  }), 201)).repayment;
  if (decision) await json(await api(`/repayments/${record.id}/decision`, tokens[recipient], 'POST', { decision }));
  return record;
}
// Remembers whose token acts for each user ID in a group from groupWith.
async function members(...friends: string[]) {
  const group = await groupWith(...friends);
  tokens[group.alice] = 'alice-token';
  if (group.bob) tokens[group.bob] = 'bob-token';
  if (group.carol) tokens[group.carol] = 'carol-token';
  return group;
}

test('only the group owner removes another member, and only a current member of that group', async () => {
  const group = await members('bob-token', 'carol-token');
  const other = await groupWith('bob-token');
  await json(await remove(group.id, group.carol, 'bob-token'), 403);
  await json(await eligibility(group.id, group.carol, 'bob-token'), 403);
  await json(await remove(group.id, group.alice, 'alice-token'), 400);
  await json(await remove(group.id, crypto.randomUUID()), 404);
  await json(await remove(group.id, group.bob, 'member-1-token'), 404);
  // Bob belongs to another group of Alice's, but she cannot remove Carol from it.
  await json(await remove(other.id, group.carol), 404);
  assert.equal((await detail(group.id)).memberCount, 3);

  assert.deepEqual(await json(await eligibility(group.id, group.carol)), { eligible: true, reasons: [] });
  assert.deepEqual(await json(await remove(group.id, group.carol)), { removed: true });
  assert.deepEqual((await detail(group.id, 'bob-token')).members.map((m: Member) => m.displayName), ['Alice', 'Bob']);
  await json(await api(`/groups/${group.id}`, 'carol-token'), 404);
  // A repeat removes no one else.
  await json(await remove(group.id, group.carol), 404);
  assert.equal((await detail(group.id)).memberCount, 2);
  // Ordinary members cannot remove the owner either.
  await json(await remove(group.id, group.alice, 'bob-token'), 403);
});

test('departure requires an exactly zero net balance in that group, whichever way it is owed', async () => {
  const group = await members('bob-token', 'carol-token');
  const other = await members('bob-token');
  // Bob owes Alice in another group; that does not hold him in this one.
  await bill(other.id, other.alice, { [other.alice]: 100, [other.bob]: 900 });
  // Alice absorbs a one-cent difference: she is owed 500 and Bob owes 500.
  await bill(group.id, group.alice, { [group.alice]: 500, [group.bob]: 500 }, 1001);
  const owes = await json(await leave(group.id, 'bob-token'), 409);
  assert.deepEqual(owes.reasons, [{ code: 'nonzero_balance', netCents: -500 }]);
  assert.match(owes.error, /balance/);
  assert.deepEqual(await json(await eligibility(group.id, group.bob)), { eligible: false, reasons: [{ code: 'nonzero_balance', netCents: -500 }] });
  assert.deepEqual((await json(await remove(group.id, group.bob), 409)).reasons, [{ code: 'nonzero_balance', netCents: -500 }]);
  await repay(group.id, group.bob, group.alice, 499, 'confirmed');
  assert.deepEqual((await json(await leave(group.id, 'bob-token'), 409)).reasons, [{ code: 'nonzero_balance', netCents: -1 }]);
  // Bob overpays: now he is owed one cent.
  await repay(group.id, group.bob, group.alice, 2, 'confirmed');
  assert.deepEqual((await json(await leave(group.id, 'bob-token'), 409)).reasons, [{ code: 'nonzero_balance', netCents: 1 }]);
  await repay(group.id, group.alice, group.bob, 1, 'confirmed');
  assert.deepEqual(await json(await eligibility(group.id, group.bob, 'bob-token')), { eligible: true, reasons: [] });
  // A settled member's nonzero historical shares do not hold them.
  await json(await leave(group.id, 'bob-token'));
  assert.equal((await detail(other.id, 'bob-token')).memberCount, 2);
});

test('a zero-net member leaves even while pairwise direct debts remain, and remaining balances stay correct', async () => {
  const group = await members('bob-token', 'carol-token');
  // Bob owes Alice, Carol owes Bob and Alice owes Carol 1000 each: every net is zero.
  await bill(group.id, group.alice, { [group.alice]: 0, [group.bob]: 1000 });
  await bill(group.id, group.bob, { [group.bob]: 0, [group.carol]: 1000 });
  await bill(group.id, group.carol, { [group.carol]: 0, [group.alice]: 1000 });
  const before = (await json(await api(`/groups/${group.id}/bills`))).ledger;
  assert.equal(before.directDebts.length, 3);
  await json(await leave(group.id, 'bob-token'));
  const after = (await json(await api(`/groups/${group.id}/bills`))).ledger;
  assert.deepEqual(after.members.map((m: { displayName: string; netCents: number }) => [m.displayName, m.netCents]).sort(),
    [['Alice', 0], ['Carol', 0]]);
  assert.deepEqual(after.formerMembers, [{ userId: group.bob, displayName: 'Bob', netCents: 0 }]);
  assert.deepEqual(after.suggestions, []);
  assert.deepEqual(after.entries, before.entries);
  assert.deepEqual(after.directDebts, before.directDebts);
});

async function itemBill(groupId: string, participantIds: string[]) {
  const id = crypto.randomUUID();
  const data = { mode: 'items', title: 'Costco haul', purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '',
    totalCents: 600, participantIds, items: [{ id: crypto.randomUUID(), name: 'Apples', originalText: 'APPLES', quantity: '1',
      amountCents: 600, finalCents: 600, discountCents: 0 }] };
  const saved = (await json(await api(`/groups/${groupId}/receipt-drafts/${id}`, 'alice-token', 'PUT', { revision: 0, data }))).draft;
  return (await json(await api(`/receipt-drafts/${id}/initialize`, 'alice-token', 'POST', { revision: saved.revision }))).bill;
}

test('incomplete bills block only the members who initiated or take part in them, until resolved by existing bill rules', async () => {
  const group = await members('bob-token', 'carol-token');
  const manual = await bill(group.id, group.alice, { [group.alice]: null, [group.bob]: null }, 1000);
  const items = await itemBill(group.id, [group.alice, group.carol]);
  const bobsOwn = await bill(group.id, group.bob, { [group.bob]: null, [group.alice]: null }, 400);
  const blocked = (id: string, title: string, role: string) => ({ id, title, role });
  assert.deepEqual((await json(await eligibility(group.id, group.bob))).reasons, [{ code: 'incomplete_bills',
    bills: [blocked(manual.id, 'Shared lunch', 'participant'), blocked(bobsOwn.id, 'Shared lunch', 'initiator')] }]);
  assert.deepEqual((await json(await remove(group.id, group.carol), 409)).reasons, [{ code: 'incomplete_bills',
    bills: [blocked(items.id, 'Costco haul', 'participant')] }]);
  const owner = await json(await eligibility(group.id, group.alice));
  assert.equal(owner.reasons[0].bills.length, 3);

  // Bob cancels his own bill; Alice removes him as a participant from hers.
  await json(await api(`/bills/${bobsOwn.id}/cancel`, 'bob-token', 'POST', { revision: bobsOwn.revision }));
  await json(await api(`/bills/${manual.id}`, 'alice-token', 'PATCH', { revision: manual.revision, title: 'Shared lunch',
    purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '', totalCents: 1000, participantIds: [group.alice] }));
  assert.deepEqual(await json(await eligibility(group.id, group.bob, 'bob-token')), { eligible: true, reasons: [] });
  await json(await leave(group.id, 'bob-token'));
  // Carol's item bill still blocks her, but not Bob, who is unrelated to it.
  assert.equal((await json(await remove(group.id, group.carol), 409)).reasons[0].code, 'incomplete_bills');
  await json(await api(`/bills/${items.id}/cancel`, 'alice-token', 'POST', { revision: items.revision }));
  await json(await remove(group.id, group.carol));
});

test('pending repayments block their sender and recipient until the recipient decides', async () => {
  const group = await members('bob-token', 'carol-token');
  const toAlice = await repay(group.id, group.bob, group.alice, 300);
  const toBob = await repay(group.id, group.carol, group.bob, 200);
  const record = (r: { id: string; senderId: string; recipientId: string; amountCents: number }) =>
    ({ id: r.id, senderId: r.senderId, recipientId: r.recipientId, amountCents: r.amountCents });
  const reasons = (await json(await leave(group.id, 'bob-token'), 409)).reasons;
  assert.deepEqual(reasons, [{ code: 'pending_repayments', repayments: [record(toAlice), record(toBob)] }]);
  // Rejected records have no balance effect and no longer block.
  await json(await api(`/repayments/${toAlice.id}/decision`, 'alice-token', 'POST', { decision: 'rejected' }));
  // A confirmed record keeps its balance effect: Bob is now owed 200 by Carol's payment.
  await json(await api(`/repayments/${toBob.id}/decision`, 'bob-token', 'POST', { decision: 'confirmed' }));
  assert.deepEqual((await json(await leave(group.id, 'bob-token'), 409)).reasons, [{ code: 'nonzero_balance', netCents: -200 }]);
  await repay(group.id, group.bob, group.carol, 200, 'confirmed');
  // An unrelated pending record between Alice and Carol does not hold Bob.
  await repay(group.id, group.carol, group.alice, 100);
  await json(await leave(group.id, 'bob-token'));
  const history = (await json(await api(`/groups/${group.id}/bills`))).repayments;
  assert.deepEqual(history.map((r: { status: string }) => r.status).sort(), ['confirmed', 'confirmed', 'pending', 'rejected']);
});

test('the sole owner cannot leave and is pointed to deleting the cleared group', async () => {
  const group = await members();
  assert.deepEqual(await json(await eligibility(group.id, group.alice)), { eligible: false, reasons: [{ code: 'sole_member' }] });
  const refused = await json(await leave(group.id, 'alice-token'), 409);
  assert.deepEqual(refused.reasons, [{ code: 'sole_member' }]);
  assert.match(refused.error, /delete/);
  await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'));
});

test('the owner transfers ownership and leaves together; the successor manages the group at once', async () => {
  const group = await members('bob-token', 'carol-token');
  // A member of another of Alice's groups, but not this one.
  const other = await members();
  const otherInvitation = (await json(await api(`/groups/${other.id}/invitation`))).path.split('/').at(-1);
  const outsider = (await json(await api('/groups/join', 'member-1-token', 'POST', { token: otherInvitation }))).group
    .members.find((m: Member) => m.isCurrentUser).id;
  // The successor may have any balance: Carol owes Bob.
  await bill(group.id, group.bob, { [group.bob]: 0, [group.carol]: 700 });
  assert.match((await json(await leave(group.id, 'alice-token'), 409)).error, /new owner|group owner/);
  await json(await leave(group.id, 'bob-token', { successorId: group.carol }), 403);
  for (const successorId of [group.alice, crypto.randomUUID(), outsider])
    await json(await leave(group.id, 'alice-token', { successorId }), 400);
  await json(await leave(group.id, 'alice-token', { successorId: 'not-a-uuid' }), 400);
  await json(await leave(group.id, 'alice-token', { successorId: group.carol, extra: true }), 400);
  assert.equal((await detail(group.id)).isOwner, true);

  assert.deepEqual(await json(await leave(group.id, 'alice-token', { successorId: group.carol })), { left: true });
  const seen = await detail(group.id, 'carol-token');
  assert.equal(seen.isOwner, true);
  assert.equal(seen.ownerId, group.carol);
  assert.equal(seen.ownerName, 'Carol');
  assert.equal(seen.createdBy, group.alice);
  assert.deepEqual(seen.members.map((m: Member) => [m.displayName, m.isOwner]), [['Bob', false], ['Carol', true]]);
  assert.equal((await detail(group.id, 'bob-token')).isOwner, false);
  await json(await api(`/groups/${group.id}`, 'alice-token'), 404);
  // Carol manages the invitation; the original creator's permissions do not return on rejoining.
  const invitation = (await json(await api(`/groups/${group.id}/invitation`, 'carol-token'))).path.split('/').at(-1);
  assert.equal(invitation, group.invitation);
  await json(await api(`/groups/${group.id}/invitation`, 'bob-token'), 403);
  const rejoined = (await json(await api('/groups/join', 'alice-token', 'POST', { token: invitation }))).group;
  assert.equal(rejoined.isOwner, false);
  assert.equal(rejoined.ownerId, group.carol);
  await json(await api(`/groups/${group.id}/invitation`, 'alice-token'), 403);
  await json(await remove(group.id, group.bob, 'alice-token'), 403);
  await json(await api(`/groups/${group.id}/deletion`, 'alice-token'), 403);
  assert.equal((await json(await api(`/groups/${group.id}/deletion`, 'carol-token'))).eligible, false);
  // Ownership left the bill's initiator and amounts untouched.
  const [shared] = (await json(await api(`/groups/${group.id}/bills`, 'carol-token'))).bills;
  assert.equal(shared.initiatorId, group.bob);
  assert.deepEqual((await json(await api(`/groups/${group.id}/bills`, 'carol-token'))).ledger.members
    .map((m: { displayName: string; netCents: number }) => [m.displayName, m.netCents]).sort(),
  [['Alice', 0], ['Bob', 700], ['Carol', -700]]);
});

test('an ineligible owner or a failed cleanup keeps ownership, membership and drafts unchanged', async () => {
  const group = await members('bob-token');
  const lunch = await bill(group.id, group.alice, { [group.alice]: null, [group.bob]: null }, 500);
  await json(await leave(group.id, 'alice-token', { successorId: group.bob }), 409);
  assert.equal((await detail(group.id, 'bob-token')).ownerId, group.alice);
  await json(await api(`/bills/${lunch.id}/cancel`, 'alice-token', 'POST', { revision: lunch.revision }));
  const draftId = crypto.randomUUID();
  await pool.query('INSERT INTO receipt_drafts (id, group_id, initiator_id, data) VALUES ($1, $2, $3, $4)',
    [draftId, group.id, group.alice, JSON.stringify({ items: [], title: 'Unfinished' })]);
  await pool.query(`CREATE FUNCTION reject_draft_purge() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced rollback'; END; $$;
    CREATE TRIGGER reject_draft_purge BEFORE DELETE ON receipt_drafts FOR EACH ROW EXECUTE FUNCTION reject_draft_purge();`);
  try {
    await json(await leave(group.id, 'alice-token', { successorId: group.bob }), 500);
  } finally {
    await pool.query('DROP TRIGGER reject_draft_purge ON receipt_drafts; DROP FUNCTION reject_draft_purge()');
  }
  const unchanged = await detail(group.id);
  assert.equal(unchanged.ownerId, group.alice);
  assert.equal(unchanged.memberCount, 2);
  assert.equal((await json(await api(`/groups/${group.id}/receipt-drafts`))).drafts.length, 1);
  await json(await leave(group.id, 'alice-token', { successorId: group.bob }));
  assert.equal((await detail(group.id, 'bob-token')).isOwner, true);
});

test('departure keeps shared history readable by remaining members, purges only the leaver’s drafts, and rejoining restores no draft', async () => {
  const group = await members('bob-token', 'carol-token');
  // A completed item bill Alice paid, whose only item Bob claimed in full.
  const billId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  await pool.query(`INSERT INTO bills
    (id, group_id, initiator_id, request_id, request_payload, mode, title, purchase_date, total_cents, completed_at, adjustment_cents)
    VALUES ($1, $2, $3, $4, '{}', 'items', 'Costco haul', '2026-01-01', 600, now(), 0)`, [billId, group.id, group.alice, crypto.randomUUID()]);
  await pool.query(`INSERT INTO bill_shares (bill_id, user_id, amount_cents, confirmed_at) VALUES ($1, $2, 0, now()), ($1, $3, 600, now())`,
    [billId, group.alice, group.bob]);
  await pool.query(`INSERT INTO bill_items (id, bill_id, position, name, original_text, quantity, amount_cents, discount_cents, final_cents)
    VALUES ($1, $2, 0, 'Apples', 'APPLES', '1', 600, 0, 600)`, [itemId, billId]);
  await pool.query('INSERT INTO item_claims (item_id, user_id, numerator, denominator, confirmed_at) VALUES ($1, $2, 1, 1, now())', [itemId, group.bob]);
  const repayment = await repay(group.id, group.bob, group.alice, 600, 'confirmed');
  const draft = async (id: string, initiatorId: string, linkedBill: string | null) => {
    await pool.query('INSERT INTO receipt_drafts (id, group_id, initiator_id, data, bill_id) VALUES ($1, $2, $3, $4, $5)',
      [id, group.id, initiatorId, JSON.stringify({ items: [], title: 'Receipt' }), linkedBill]);
    await pool.query("INSERT INTO receipt_photos (draft_id, base64, expires_at) VALUES ($1, 'cGhvdG8=', now() + interval '6 months')", [id]);
    await pool.query("INSERT INTO receipt_evidence (draft_id, analysis) VALUES ($1, '{\"raw\":true}')", [id]);
    return (await pool.query('INSERT INTO note_photos (draft_id, position, bytes) VALUES ($1, 0, $2) RETURNING id', [id, Buffer.from('note')])).rows[0].id as string;
  };
  const [initiated, bobs, bobsOther, carols] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await draft(initiated, group.alice, billId);
  const bobsNote = await draft(bobs, group.bob, null);
  await draft(bobsOther, group.bob, null);
  await pool.query("UPDATE receipt_drafts SET processing_status = 'processing', processing_started_at = now() WHERE id = $1", [bobsOther]);
  const carolsNote = await draft(carols, group.carol, null);
  const billNote = (await pool.query('INSERT INTO note_photos (bill_id, position, bytes) VALUES ($1, 0, $2) RETURNING id', [billId, Buffer.from('bill note')])).rows[0].id;
  const before = await json(await api(`/groups/${group.id}/bills`, 'carol-token'));

  await json(await leave(group.id, 'bob-token'));
  const count = async (sql: string, ids: string[]) => (await pool.query(sql, [ids])).rows[0].n;
  assert.equal(await count('SELECT count(*)::int AS n FROM receipt_drafts WHERE id = ANY($1)', [bobs, bobsOther]), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM receipt_photos WHERE draft_id = ANY($1)', [bobs, bobsOther]), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM receipt_evidence WHERE draft_id = ANY($1)', [bobs, bobsOther]), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM note_photos WHERE id = ANY($1)', [bobsNote]), 0);
  assert.equal(await count('SELECT count(*)::int AS n FROM receipt_drafts WHERE id = ANY($1)', [initiated, carols]), 2);
  assert.equal(await count('SELECT count(*)::int AS n FROM note_photos WHERE id = ANY($1)', [carolsNote, billNote]), 2);

  // Remaining members still read the whole history, naming Bob.
  const after = await json(await api(`/groups/${group.id}/bills`, 'carol-token'));
  assert.deepEqual(after.bills, before.bills);
  assert.deepEqual(after.repayments, before.repayments);
  assert.deepEqual(after.ledger.entries, before.ledger.entries);
  assert.deepEqual(after.ledger.formerMembers, [{ userId: group.bob, displayName: 'Bob', netCents: 0 }]);
  const [haul] = after.bills;
  assert.deepEqual(haul.participants.map((p: { displayName: string }) => p.displayName).sort(), ['Alice', 'Bob']);
  assert.equal((await api(`/receipt-drafts/${initiated}/photo`, 'carol-token')).status, 200);
  assert.equal((await api(`/note-photos/${billNote}`, 'carol-token')).status, 200);
  assert.equal((await json(await api(`/groups/${group.id}/receipt-drafts`, 'carol-token'))).drafts.length, 1);

  // Bob reaches nothing through identifiers he already knows.
  for (const path of [`/bills/${billId}`, `/receipt-drafts/${initiated}/photo`, `/note-photos/${billNote}`, `/receipt-drafts/${bobs}`])
    await json(await api(path, 'bob-token'), 404);
  await json(await api(`/repayments/${repayment.id}/decision`, 'bob-token', 'POST', { decision: 'confirmed' }), 404);
  await json(await api(`/bills/${billId}/claims`, 'bob-token', 'POST', { reviewedItems: [], claims: [] }), 404);
  await json(await api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: group.alice, amountCents: 100 }), 404);
  await json(await api(`/groups/${group.id}/receipt-drafts/${bobs}`, 'bob-token', 'PUT', { revision: 0, data: {
    mode: 'manual', title: 'Again', purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '', totalCents: 100,
    participantIds: [group.bob], items: [] } }), 404);
  // Nor can anyone add him to a bill or send him a repayment.
  await json(await api(`/groups/${group.id}/bills`, 'alice-token', 'POST', { requestId: crypto.randomUUID(), title: 'Later',
    purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '', totalCents: 100, participantIds: [group.alice, group.bob] }), 400);
  await json(await api(`/groups/${group.id}/repayments`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: group.bob, amountCents: 100 }), 400);

  // Rejoining reconnects Bob's identity to the history, but not to his deleted drafts.
  await json(await api('/groups/join', 'bob-token', 'POST', { token: group.invitation }));
  assert.deepEqual((await json(await api(`/groups/${group.id}/receipt-drafts`, 'bob-token'))).drafts, []);
  await json(await api(`/receipt-drafts/${bobs}`, 'bob-token'), 404);
  const rejoined = await json(await api(`/groups/${group.id}/bills`, 'bob-token'));
  assert.deepEqual(rejoined.ledger.entries, before.ledger.entries);
  assert.deepEqual(rejoined.ledger.formerMembers, []);
  assert.equal((await detail(group.id, 'bob-token')).isOwner, false);
});

// Holds the first request whose transaction reaches this table write, while it
// keeps every lock it has taken, until released. Nothing relies on sleeping.
async function pauseAt(table: string, event: 'INSERT' | 'DELETE' | 'UPDATE', key: number) {
  await pool.query(`CREATE FUNCTION pause_${key}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${key}); RETURN NULL; END $$;
    CREATE TRIGGER pause_${key} AFTER ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION pause_${key}();`);
  const blocker = await pool.connect();
  await blocker.query(`SELECT pg_advisory_lock(${key})`);
  const waiting = (events: string[]) => pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event = ANY($1)', [events]);
  const until = async (events: string[], n: number) => {
    const deadline = Date.now() + 5_000;
    while ((await waiting(events)).rows[0]!.n < n) {
      assert.ok(Date.now() < deadline, `Expected ${n} request(s) waiting on ${events.join(' or ')}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  return {
    // The paused request holds the group row; later requests queue behind it.
    paused: () => until(['advisory'], 1),
    // The first waiter on the row waits for the holder's transaction, the rest for the row.
    queued: (n = 1) => until(['transactionid', 'tuple'], n),
    release: () => blocker.query(`SELECT pg_advisory_unlock(${key})`),
    async cleanup() {
      try { await blocker.query('SELECT pg_advisory_unlock_all()'); } finally { blocker.release(); }
      await pool.query(`DROP TRIGGER pause_${key} ON ${table}; DROP FUNCTION pause_${key}()`);
    },
  };
}

test('writes that need the departed member wait behind the departure and then fail without side effects', async () => {
  const group = await members('bob-token', 'carol-token');
  const draftId = crypto.randomUUID();
  const draftData = { mode: 'manual', title: 'Bob’s draft', purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '',
    totalCents: 100, participantIds: [group.bob, group.alice], items: [] };
  const saved = (await json(await api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'bob-token', 'PUT', { revision: 0, data: draftData }))).draft;
  const pause = await pauseAt('group_members', 'DELETE', 9101);
  const requests: Promise<Response>[] = [];
  try {
    const departure = leave(group.id, 'bob-token');
    requests.push(departure);
    await pause.paused();
    const late = [
      api(`/groups/${group.id}/bills`, 'alice-token', 'POST', { requestId: crypto.randomUUID(), title: 'Late', purchaseDate: '2026-01-01',
        timeZone: 'America/Toronto', notes: '', totalCents: 100, participantIds: [group.alice, group.bob] }),
      api(`/groups/${group.id}/repayments`, 'carol-token', 'POST', { requestId: crypto.randomUUID(), recipientId: group.bob, amountCents: 100 }),
      api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'bob-token', 'PUT', { revision: saved.revision, data: { ...draftData, title: 'Saved late' } }),
      api(`/receipt-drafts/${draftId}/initialize`, 'bob-token', 'POST', { revision: saved.revision }),
      api(`/groups/${group.id}/receipt-drafts/${crypto.randomUUID()}`, 'bob-token', 'PUT', { revision: 0, data: draftData }),
    ];
    requests.push(...late);
    await pause.queued(late.length);
    await pause.release();
    await json(await departure);
    const statuses = await Promise.all(late.map(async response => (await response).status));
    assert.deepEqual(statuses, [400, 400, 404, 404, 404]);
  } finally {
    await pause.release();
    await Promise.allSettled(requests);
    await pause.cleanup();
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM bills WHERE group_id = $1', [group.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM repayments WHERE group_id = $1', [group.id])).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipt_drafts WHERE group_id = $1', [group.id])).rows[0].n, 0);
});

test('a bill, initiation or repayment decision committing first makes a waiting departure stale, and it is rejected', async () => {
  const group = await members('bob-token');
  const draftId = crypto.randomUUID();
  const saved = (await json(await api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'bob-token', 'PUT', { revision: 0, data: {
    mode: 'manual', title: 'Bob’s draft', purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '', totalCents: 100,
    participantIds: [group.bob], items: [] } }))).draft;
  const pending = await repay(group.id, group.alice, group.bob, 100);
  const firstWrites: [string, 'INSERT' | 'UPDATE', () => Promise<Response>, string][] = [
    ['bill_shares', 'INSERT', () => api(`/groups/${group.id}/bills`, 'alice-token', 'POST', { requestId: crypto.randomUUID(), title: 'First',
      purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '', totalCents: 100, participantIds: [group.alice, group.bob] }),
    'incomplete_bills'],
    ['bill_shares', 'INSERT', () => api(`/receipt-drafts/${draftId}/initialize`, 'bob-token', 'POST', { revision: saved.revision }),
      'incomplete_bills'],
    ['repayments', 'UPDATE', () => api(`/repayments/${pending.id}/decision`, 'bob-token', 'POST', { decision: 'confirmed' }),
      'nonzero_balance'],
  ];
  for (const [index, [table, event, write, reason]] of firstWrites.entries()) {
    const pause = await pauseAt(table, event, 9110 + index);
    const requests: Promise<Response>[] = [];
    try {
      const first = write();
      requests.push(first);
      await pause.paused();
      const departure = leave(group.id, 'bob-token');
      const removal = remove(group.id, group.bob);
      requests.push(departure, removal);
      await pause.queued(2);
      await pause.release();
      assert.ok((await first).ok);
      assert.ok((await json(await departure, 409)).reasons.some((r: { code: string }) => r.code === reason));
      assert.ok((await json(await removal, 409)).reasons.some((r: { code: string }) => r.code === reason));
    } finally {
      await pause.release();
      await Promise.allSettled(requests);
      await pause.cleanup();
    }
    assert.equal((await detail(group.id)).memberCount, 2);
  }
});

test('competing transfers and departures commit in one order and leave exactly one current owner', async () => {
  const group = await members('bob-token', 'carol-token');
  const pause = await pauseAt('group_members', 'DELETE', 9103);
  const requests: Promise<Response>[] = [];
  try {
    const toBob = leave(group.id, 'alice-token', { successorId: group.bob });
    requests.push(toBob);
    await pause.paused();
    const competing = [
      leave(group.id, 'alice-token', { successorId: group.carol }),
      remove(group.id, group.carol, 'alice-token'),
      leave(group.id, 'bob-token'),
      api(`/groups/${group.id}`, 'alice-token', 'DELETE'),
    ];
    requests.push(...competing);
    await pause.queued(competing.length);
    await pause.release();
    await json(await toBob);
    const statuses = [];
    for (const response of competing) statuses.push((await response).status);
    // Alice is no longer a member; Bob is now the owner and must name a successor.
    assert.deepEqual(statuses, [404, 404, 409, 404]);
  } finally {
    await pause.release();
    await Promise.allSettled(requests);
    await pause.cleanup();
  }
  const seen = await detail(group.id, 'carol-token');
  assert.equal(seen.ownerId, group.bob);
  assert.deepEqual(seen.members.map((m: Member) => [m.displayName, m.isOwner]), [['Bob', true], ['Carol', false]]);
});

test('a departure frees capacity for a join waiting behind it, and a deletion first leaves nothing to depart', async () => {
  const group = await members('bob-token');
  for (let i = 1; i <= 14; i++) await json(await api('/groups/join', `member-${i}-token`, 'POST', { token: group.invitation }));
  await json(await api('/groups/join', 'member-15-token', 'POST', { token: group.invitation }), 409);
  const pause = await pauseAt('group_members', 'DELETE', 9104);
  const requests: Promise<Response>[] = [];
  try {
    const departure = leave(group.id, 'bob-token');
    requests.push(departure);
    await pause.paused();
    const join = api('/groups/join', 'member-15-token', 'POST', { token: group.invitation });
    requests.push(join);
    await pause.queued();
    await pause.release();
    await json(await departure);
    assert.equal((await json(await join)).group.memberCount, 16);
  } finally {
    await pause.release();
    await Promise.allSettled(requests);
    await pause.cleanup();
  }
  const cleared = await members('bob-token');
  const deletion = await pauseAt('groups', 'UPDATE', 9105);
  const raced: Promise<Response>[] = [];
  try {
    const deleted = api(`/groups/${cleared.id}`, 'alice-token', 'DELETE');
    raced.push(deleted);
    await deletion.paused();
    const departure = leave(cleared.id, 'bob-token');
    raced.push(departure);
    await deletion.queued();
    await deletion.release();
    await json(await deleted);
    await json(await departure, 404);
  } finally {
    await deletion.release();
    await Promise.allSettled(raced);
    await deletion.cleanup();
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM group_members WHERE group_id = $1', [cleared.id])).rows[0].n, 2);
});

test('a departed member’s open group streams end with a final event, while the others continue', async () => {
  const group = await members('bob-token', 'carol-token');
  const controllers = ['alice-token', 'bob-token', 'carol-token'].map(() => new AbortController());
  const responses = await Promise.all(['alice-token', 'bob-token', 'carol-token'].map((token, i) =>
    fetch(`${baseUrl}/api/groups/${group.id}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controllers[i]!.signal })));
  for (const response of responses) assert.equal(response.status, 200);
  const decoder = new TextDecoder();
  const readers = responses.map(response => response.body!.getReader());
  // Collects frames until one with the expected event arrives or the stream ends.
  async function next(index: number, event: string) {
    let text = '';
    while (!text.includes(`event: ${event}\n`)) {
      const chunk = await readers[index]!.read();
      if (chunk.done) return { text, ended: true };
      text += decoder.decode(chunk.value);
    }
    return { text, ended: false };
  }
  try {
    for (let i = 0; i < 3; i++) await next(i, 'ready');
    await json(await leave(group.id, 'bob-token'));
    const bob = await next(1, 'membership-ended');
    assert.match(bob.text, new RegExp(`event: membership-ended\\ndata: ${JSON.stringify(JSON.stringify({ id: group.id, name: 'Costco', removed: false })).slice(1, -1)}`));
    assert.equal((await readers[1]!.read()).done, true);
    for (const index of [0, 2]) assert.equal((await next(index, 'changed')).ended, false);
    await json(await remove(group.id, group.carol));
    assert.match((await next(2, 'membership-ended')).text, /event: membership-ended\ndata: .*"removed":true/);
    assert.equal((await readers[2]!.read()).done, true);
    assert.equal((await next(0, 'changed')).ended, false);
    // A reconnecting former member is refused.
    await json(await api(`/groups/${group.id}/events`, 'bob-token'), 404);
  } finally {
    for (const controller of controllers) controller.abort();
  }
});

test('departing while receipt interpretation is held discards its late completion and restores no draft', async () => {
  const group = await members('bob-token');
  const id = crypto.randomUUID();
  const data = { mode: 'items', title: 'Scanning', purchaseDate: '2026-01-01', timeZone: 'America/Toronto',
    notes: '', totalCents: 300, participantIds: [group.bob],
    items: [{ id: crypto.randomUUID(), name: 'Apple', originalText: 'APPLE', quantity: '1', amountCents: 300,
      discountCents: 0, finalCents: 300, taxable: null, manualFinal: false }] };
  const sharp = (await import('sharp')).default;
  const photoBase64 = (await sharp({ create: { width: 30, height: 60, channels: 3, background: 'white' } }).png().toBuffer()).toString('base64');
  const saved = (await json(await api(`/groups/${group.id}/receipt-drafts/${id}`, 'bob-token', 'PUT', { revision: 0, data, photoBase64 }))).draft;
  const recording = once(child!, 'message'); child!.send('recorded-evidence');
  assert.equal((await recording)[0], 'recorded-evidence-ready');
  const holding = once(child!, 'message'); child!.send('hold-model');
  assert.equal((await holding)[0], 'holding-model');
  const errorsBefore = serverErrors.length;
  try {
    const held = once(child!, 'message');
    const scan = await json(await api(`/receipt-drafts/${id}/extract`, 'bob-token', 'POST', { revision: saved.revision }));
    assert.equal((await held)[0], 'model-held');
    assert.equal(scan.draft.processingStatus, 'processing');
    await json(await leave(group.id, 'bob-token'));
    for (const table of ['receipt_drafts WHERE id', 'receipt_photos WHERE draft_id', 'receipt_evidence WHERE draft_id'])
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} = $1`, [id])).rows[0].n, 0);
    const tracking = once(child!, 'message'); child!.send('track-processing-settled');
    assert.equal((await tracking)[0], 'tracking-processing-settled');
    const released = waitForProcessMessage('model-released');
    const settled = waitForProcessMessage('receipt-processing-settled');
    child!.send('release-model');
    await Promise.all([released, settled]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipt_drafts WHERE id = $1', [id])).rows[0].n, 0);
    await json(await api('/groups/join', 'bob-token', 'POST', { token: group.invitation }));
    await json(await api(`/receipt-drafts/${id}`, 'bob-token'), 404);
    assert.equal(serverErrors.slice(errorsBefore).includes('Receipt processing completion failed'), false);
  } finally {
    child!.send('release-model');
    const stopped = once(child!, 'message'); child!.send('recorded-evidence-off');
    assert.equal((await stopped)[0], 'recorded-evidence-stopped');
  }
});

test('the ownership migration makes each existing group’s creator its owner and keeps its invitation and members', async () => {
  const { cp, mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  await pool.query('DROP DATABASE IF EXISTS migration_check');
  await pool.query('CREATE DATABASE migration_check');
  const url = new URL(container!.getConnectionUri());
  url.pathname = '/migration_check';
  const before = await mkdtemp(join(tmpdir(), 'migrations-'));
  const scratch = new Pool({ connectionString: url.href });
  try {
    await cp('./drizzle', before, { recursive: true });
    const journalPath = join(before, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((entry: { tag: string }) => entry.tag < '0019');
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(drizzle(scratch), { migrationsFolder: before });
    const users = (await scratch.query(`INSERT INTO users (clerk_user_id) VALUES ('creator'), ('friend') RETURNING id`)).rows.map(row => row.id);
    const group = (await scratch.query(`INSERT INTO groups (name, created_by, invitation_token) VALUES ('Old', $1, 'token') RETURNING id`, [users[0]])).rows[0].id;
    await scratch.query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2), ($1, $3)', [group, users[0], users[1]]);
    await migrate(drizzle(scratch), { migrationsFolder: './drizzle' });
    assert.deepEqual((await scratch.query('SELECT created_by, owner_id, invitation_token FROM groups')).rows,
      [{ created_by: users[0], owner_id: users[0], invitation_token: 'token' }]);
    assert.equal((await scratch.query('SELECT count(*)::int AS n FROM group_members')).rows[0].n, 2);
  } finally {
    await scratch.end();
    await rm(before, { recursive: true, force: true });
    await pool.query('DROP DATABASE IF EXISTS migration_check');
  }
});
