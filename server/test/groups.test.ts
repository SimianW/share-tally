import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
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
    'TRUNCATE TABLE item_claims, bill_items, receipt_evidence, receipt_photos, receipt_drafts, repayments, bill_shares, bills, group_members, groups, users',
  )
})


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

async function create(token = 'alice-token', icon = { type: 'unicode', value: '👨‍👩‍👧‍👦' }) {
  return (await json(await api('/groups', token, 'POST', { name: ' Costco ', icon }), 201)).group;
}

test('creating a group persists its creator membership and returns the same icon contract', async () => {
  const group = await create();
  assert.equal(group.name, 'Costco');
  assert.deepEqual(group.icon, { type: 'unicode', value: '👨‍👩‍👧‍👦' });
  assert.equal(group.isCreator, true);
  assert.equal(group.memberCount, 1);
  const detail = (await json(await api(`/groups/${group.id}`))).group;
  assert.equal(detail.members.length, 1);
  assert.equal(detail.members[0].displayName, 'Alice');
  assert.equal(detail.members[0].id, group.createdBy);
  assert.equal(detail.members[0].isCurrentUser, true);
  assert.deepEqual((await json(await api('/groups'))).groups, [group]);
  await stopServer();
  await startServer();
  assert.deepEqual((await json(await api(`/groups/${group.id}`))).group, detail);
});

test('creator invites a friend, repeated joins preserve membership, and outsiders see no group data', async () => {
  const group = await create();
  assert.deepEqual((await json(await api('/groups', 'bob-token'))).groups, []);
  await json(await api(`/groups/${group.id}`, 'bob-token'), 404);
  const invitation = await json(await api(`/groups/${group.id}/invitation`));
  assert.match(invitation.path, /^\/#\/join\/[0-9a-f]{64}$/);
  const token = invitation.path.split('/').at(-1);
  const joined = await json(await api('/groups/join', 'bob-token', 'POST', { token }));
  assert.equal(joined.group.id, group.id);
  assert.equal(joined.group.isCreator, false);
  const again = await json(await api('/groups/join', 'bob-token', 'POST', { token }));
  assert.deepEqual(again, joined);
  const detail = (await json(await api(`/groups/${group.id}`, 'bob-token'))).group;
  assert.deepEqual(detail.members.map((m: { displayName: string }) => m.displayName).sort(), ['Alice', 'Bob']);
  assert.equal(detail.memberCount, 2);
  await json(await api(`/groups/${group.id}/invitation`, 'bob-token'), 403);
  await json(await api(`/groups/${group.id}/invitation`, 'bob-token', 'POST'), 403);
  await json(await api(`/groups/${group.id}/invitation`, 'carol-token'), 404);
  const newInvitation = await json(await api(`/groups/${group.id}/invitation`, 'alice-token', 'POST'));
  assert.notEqual(newInvitation.path, invitation.path);
  assert.deepEqual(await json(await api(`/groups/${group.id}/invitation`)), newInvitation);
  await json(await api('/groups/join', 'carol-token', 'POST', { token }), 404);
  await json(await api(`/groups/${group.id}`, 'carol-token'), 404);
  assert.equal((await json(await api(`/groups/${group.id}`, 'bob-token'))).group.memberCount, 2);
  const newToken = newInvitation.path.split('/').at(-1);
  const third = await json(await api('/groups/join', 'carol-token', 'POST', { token: newToken }));
  assert.equal(third.group.memberCount, 3);
  for (const response of [await api('/groups'), await api(`/groups/${group.id}`, 'bob-token')]) {
    const text = await response.text();
    assert.ok(!text.includes(newToken));
    assert.ok(!text.includes('clerkUserId'));
    assert.ok(!text.includes('invitationToken'));
  }
});

test('anonymous and forged identities cannot read groups or manage invitations', async () => {
  const group = await create();
  const path = `/groups/${group.id}`;
  for (const [url, method, body] of [
    ['/groups', 'GET', undefined], ['/groups', 'POST', { name: 'Fake', icon: { type: 'lucide', value: 'house' } }],
    [path, 'GET', undefined], [`${path}/deletion`, 'GET', undefined], [`${path}/invitation`, 'GET', undefined],
    [`${path}/invitation`, 'POST', undefined], ['/groups/join', 'POST', { token: '0'.repeat(64) }],
  ] as const) {
    await json(await api(url, 'unknown-token', method, body), 401);
  }
  await json(await api(`${path}?userId=${group.createdBy}`, 'bob-token'), 404);
  await json(await api(`${path}/invitation?userId=${group.createdBy}`, 'bob-token', 'POST', { createdBy: group.createdBy }), 404);
  const forged = await fetch(`${baseUrl}/api${path}`, {
    headers: { Authorization: 'Bearer bob-token', 'x-user-id': group.createdBy, 'x-clerk-user-id': 'user_test_alice' },
  });
  await json(forged, 404);
  await json(await api('/groups/not-a-uuid'), 404);
  await json(await api('/groups/00000000-0000-0000-0000-000000000000'), 404);
  await json(await api(path, 'bob-token', 'DELETE', { userId: group.createdBy }), 404);
  assert.equal((await api(path, 'alice-token', 'PATCH', { userId: group.createdBy })).status, 404);
});

test('invalid bodies and links grant no membership or group', async () => {
  for (const body of [null, [], {}, { name: ' ', icon: { type: 'lucide', value: 'house' } },
    { name: 'x'.repeat(41), icon: { type: 'unicode', value: 'A' } },
    { name: 'bad\u0000name', icon: { type: 'unicode', value: 'A' } },
    { name: 'Costco', icon: { type: 'unicode', value: 'ab' } }]) {
    await json(await api('/groups', 'alice-token', 'POST', body), 400);
  }
  for (const token of [undefined, '', 42, 'not-a-link', '0'.repeat(64)]) {
    await json(await api('/groups/join', 'bob-token', 'POST', { token, groupId: 'ignored' }), 404);
  }
  assert.deepEqual((await json(await api('/groups'))).groups, []);
  assert.deepEqual((await json(await api('/groups', 'bob-token'))).groups, []);
  for (const [body, status] of [['{', 400], [JSON.stringify({ text: 'a'.repeat(20_000) }), 413]] as const) {
    const response = await fetch(`${baseUrl}/api/groups`, {
      method: 'POST', headers: { Authorization: 'Bearer alice-token', 'Content-Type': 'application/json' }, body,
    });
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('Lucide and visible Unicode icons survive persistence', async () => {
  for (const icon of [{ type: 'lucide', value: 'house' }, { type: 'unicode', value: ':' },
    { type: 'unicode', value: 'A' }, { type: 'unicode', value: '中' }, { type: 'unicode', value: '👍🏽' }]) {
    const group = await create('alice-token', icon);
    assert.deepEqual((await json(await api(`/groups/${group.id}`))).group.icon, icon);
  }
});

test('membership failure rolls back group creation', async () => {
  await pool.query(`CREATE FUNCTION reject_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'deliberate test failure'; END $$;
    CREATE TRIGGER reject_membership BEFORE INSERT ON group_members FOR EACH ROW EXECUTE FUNCTION reject_membership();`);
  try {
    await json(await api('/groups', 'alice-token', 'POST', { name: 'Rollback', icon: { type: 'unicode', value: 'A' } }), 500);
    assert.deepEqual((await json(await api('/groups'))).groups, []);
    // Listing alone could hide an orphan group; verify the agreed persisted outcome too.
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM groups')).rows[0].count, 0);
  } finally {
    await pool.query('DROP TRIGGER reject_membership ON group_members; DROP FUNCTION reject_membership()');
  }
});

test('concurrent invitation retrieval and repeated joins produce one token and one membership', async () => {
  const group = await create();
  const invitations = await Promise.all(Array.from({ length: 6 }, async () => json(await api(`/groups/${group.id}/invitation`))));
  for (const invite of invitations) assert.deepEqual(invite, invitations[0]);
  const token = invitations[0].path.split('/').at(-1);
  const joins = await Promise.all(Array.from({ length: 8 }, async () => json(await api('/groups/join', 'bob-token', 'POST', { token }))));
  for (const join of joins) assert.equal(join.group.memberCount, 2);
  const creatorJoin = await json(await api('/groups/join', 'alice-token', 'POST', { token }));
  assert.equal(creatorJoin.group.memberCount, 2);
  assert.equal(creatorJoin.group.isCreator, true);
  assert.equal((await json(await api('/groups', 'bob-token'))).groups.length, 1);
});

test('a join waiting behind invitation regeneration cannot use the old token', async () => {
  const group = await create();
  const old = await json(await api(`/groups/${group.id}/invitation`));
  const token = old.path.split('/').at(-1);
  await pool.query(`CREATE FUNCTION pause_rotation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(7143); RETURN NEW; END $$;
    CREATE TRIGGER pause_rotation AFTER UPDATE OF invitation_token ON groups
      FOR EACH ROW EXECUTE FUNCTION pause_rotation();`);
  const blocker = await pool.connect();
  let rotation: Promise<Response> | undefined;
  let joining: Promise<Response> | undefined;
  async function waitForLock(event: string) {
    const deadline = Date.now() + 5_000;
    while (true) {
      const result = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = $1`, [event]);
      if (result.rowCount) return;
      assert.ok(Date.now() < deadline, `Expected ${event} contention`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  try {
    await blocker.query('SELECT pg_advisory_lock(7143)');
    rotation = api(`/groups/${group.id}/invitation`, 'alice-token', 'POST');
    void rotation.catch(() => {});
    await waitForLock('advisory');
    joining = api('/groups/join', 'bob-token', 'POST', { token });
    void joining.catch(() => {});
    await waitForLock('transactionid');
    await blocker.query('SELECT pg_advisory_unlock(7143)');
    const renewed = await json(await rotation);
    assert.notEqual(renewed.path, old.path);
    await json(await joining, 404);
    assert.deepEqual((await json(await api('/groups', 'bob-token'))).groups, []);
  } finally {
    await blocker.query('SELECT pg_advisory_unlock_all()');
    blocker.release();
    await Promise.allSettled([rotation, joining]);
    await pool.query('DROP TRIGGER pause_rotation ON groups; DROP FUNCTION pause_rotation()');
  }
});


test('membership cap serializes competing joins and permits repeats at capacity', async () => {
  const group = (await json(await api('/groups', 'alice-token', 'POST', {
    name: 'Capacity', icon: { type: 'lucide', value: 'shopping-basket' },
  }), 201)).group;
  const invitation = await json(await api(`/groups/${group.id}/invitation`));
  const token = invitation.path.split('/').at(-1);
  for (let i = 1; i <= 14; i++)
    await json(await api('/groups/join', `member-${i}-token`, 'POST', { token }));
  const competing = await Promise.all([15, 16].map(i =>
    api('/groups/join', `member-${i}-token`, 'POST', { token })));
  assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
  const rejected = competing.find(r => r.status === 409)!;
  assert.match((await rejected.json()).error, /full.*16/i);
  await json(await api('/groups/join', 'member-17-token', 'POST', { token }), 409);
  const repeats = await Promise.all([1, 1].map(i =>
    api('/groups/join', `member-${i}-token`, 'POST', { token })));
  for (const response of repeats) assert.equal((await json(response)).group.memberCount, 16);
  const detail = (await json(await api(`/groups/${group.id}`))).group;
  assert.equal(detail.members.length, 16);
  assert.equal(new Set(detail.members.map((m: { id: string }) => m.id)).size, 16);
});

async function inviteMember(groupId: string, token = 'bob-token') {
  const invitation = await json(await api(`/groups/${groupId}/invitation`));
  await json(await api('/groups/join', token, 'POST', { token: invitation.path.split('/').at(-1) }));
  return invitation.path.split('/').at(-1) as string;
}

async function groupBill(groupId: string, aliceId: string, bobId: string) {
  return (await json(await api(`/groups/${groupId}/bills`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), title: 'Shared lunch', purchaseDate: '2026-01-01',
    timeZone: 'America/Toronto', notes: '', totalCents: 1000, ownShareCents: 400,
    participantIds: [aliceId, bobId],
  }), 201)).bill;
}

test('only a creator can delete a cleared group; deletion hides every entry point', async () => {
  const group = await create();
  const invitationToken = await inviteMember(group.id);
  const other = await create('bob-token');
  const eligibilityPath = `/groups/${group.id}/deletion`;
  assert.deepEqual(await json(await api(eligibilityPath)), { eligible: true, reasons: [] });
  await json(await api(eligibilityPath, 'bob-token'), 403);
  await json(await api(eligibilityPath, 'carol-token'), 404);
  await json(await api(`/groups/${group.id}`, 'bob-token', 'DELETE'), 403);
  await json(await api(`/groups/${group.id}`, 'carol-token', 'DELETE'), 404);
  assert.equal((await pool.query('SELECT deleted_at FROM groups WHERE id = $1', [group.id])).rows[0].deleted_at, null);

  const deleted = await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'));
  assert.deepEqual(deleted, { deleted: true });
  assert.ok((await pool.query('SELECT deleted_at FROM groups WHERE id = $1', [group.id])).rows[0].deleted_at);
  await json(await api(eligibilityPath), 404);
  await json(await api(eligibilityPath, 'bob-token'), 404);
  assert.deepEqual((await json(await api('/groups'))).groups, []);
  assert.deepEqual((await json(await api('/groups', 'bob-token'))).groups.map((g: { id: string }) => g.id), [other.id]);
  assert.deepEqual((await json(await api('/attention'))).actions, []);
  assert.deepEqual((await json(await api('/attention', 'bob-token'))).actions, []);
  for (const memberToken of ['alice-token', 'bob-token']) {
    for (const path of [
      `/groups/${group.id}`, `/groups/${group.id}/bills`, `/groups/${group.id}/receipt-drafts`, `/groups/${group.id}/invitation`,
      `/groups/${group.id}/events`,
    ]) await json(await api(path, memberToken), 404);
    await json(await api(`/groups/${group.id}/invitation`, memberToken, 'POST'), 404);
    await json(await api(`/groups/${group.id}/receipt-preview/prices`, memberToken, 'POST', {}), 404);
    await json(await api(`/groups/${group.id}`, memberToken, 'DELETE'), 404);
  }
  await json(await api('/groups/join', 'carol-token', 'POST', { token: invitationToken }), 404);
  await json(await api(`/groups/${group.id}/bills`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), title: 'No more bills', purchaseDate: '2026-01-01',
    timeZone: 'America/Toronto', notes: '', totalCents: 100, ownShareCents: 100,
    participantIds: [group.createdBy],
  }), 404);
  await json(await api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: group.createdBy, amountCents: 100,
  }), 404);
});

test('deletion notifies every connected member with its name after commit, then ends their streams', async () => {
  const group = await create();
  await inviteMember(group.id);
  const controllers = [new AbortController(), new AbortController()];
  const responses = await Promise.all(['alice-token', 'bob-token'].map((token, i) =>
    fetch(`${baseUrl}/api/groups/${group.id}/events`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controllers[i]!.signal,
    })));
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  }
  // Fetch resolves when the ready frame flushes. Reading the whole body waits for EOF.
  const bodies = responses.map(response => response.text());
  const ended = bodies.map(() => false);
  bodies.forEach((body, index) => { void body.then(() => { ended[index] = true; }, () => {}); });
  try {
    await pool.query(`CREATE FUNCTION reject_group_delete_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced rollback'; END; $$;
      CREATE TRIGGER reject_group_delete_event AFTER UPDATE OF deleted_at ON groups
        FOR EACH ROW EXECUTE FUNCTION reject_group_delete_event();`);
    try {
      await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'), 500);
      assert.deepEqual(ended, [false, false]);
      assert.equal((await pool.query('SELECT deleted_at FROM groups WHERE id = $1', [group.id])).rows[0].deleted_at, null);
    } finally {
      await pool.query('DROP TRIGGER reject_group_delete_event ON groups; DROP FUNCTION reject_group_delete_event()');
    }

    await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'));
    assert.ok((await pool.query('SELECT deleted_at FROM groups WHERE id = $1', [group.id])).rows[0].deleted_at);
    const timeout = AbortSignal.timeout(5_000);
    const streams = await Promise.race([
      Promise.all(bodies),
      new Promise<never>((_, reject) => timeout.addEventListener('abort', () => reject(new Error('Group streams did not end')), { once: true })),
    ]);
    for (const stream of streams) {
      const frames = stream.trim().split('\n\n');
      assert.deepEqual(frames, [
        'event: ready\ndata: {}',
        `event: group-deleted\ndata: ${JSON.stringify({ id: group.id, name: group.name })}`,
      ]);
    }
  } finally {
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(bodies);
  }
});

test('completed bills and confirmed repayments remain stored after a cleared group is deleted', async () => {
  const group = await create();
  await inviteMember(group.id);
  const bobId = (await json(await api(`/groups/${group.id}`))).group.members
    .find((m: { displayName: string }) => m.displayName === 'Bob').id;
  const bill = await groupBill(group.id, group.createdBy, bobId);
  const completed = (await json(await api(`/bills/${bill.id}/share`, 'bob-token', 'POST', {
    amountCents: 600, revision: bill.revision, expectedAmountCents: null,
  }))).bill;
  assert.ok(completed.completedAt);
  const balanceReason = { code: 'nonzero_balances', members: [
    { userId: group.createdBy, displayName: 'Alice', netCents: 600 },
    { userId: bobId, displayName: 'Bob', netCents: -600 },
  ].sort((a, b) => a.userId.localeCompare(b.userId)) };
  assert.deepEqual(await json(await api(`/groups/${group.id}/deletion`)), { eligible: false, reasons: [balanceReason] });
  const nonzero = await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'), 409);
  assert.deepEqual(nonzero.reasons, [balanceReason]);
  assert.match(nonzero.error, /balance/i);
  const repayment = (await json(await api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: group.createdBy, amountCents: 600,
  }), 201)).repayment;
  await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'), 409);
  await json(await api(`/repayments/${repayment.id}/decision`, 'alice-token', 'POST', { decision: 'confirmed' }));
  await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM bills WHERE group_id = $1', [group.id])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT status FROM repayments WHERE id = $1', [repayment.id])).rows[0].status, 'confirmed');
  await json(await api(`/bills/${bill.id}`), 404);
  await json(await api(`/repayments/${repayment.id}/decision`, 'alice-token', 'POST', { decision: 'confirmed' }), 404);
});

test('incomplete bills and pending repayments each block deletion independently', async () => {
  const group = await create();
  await inviteMember(group.id);
  const bill = await groupBill(group.id, group.createdBy,
    (await json(await api(`/groups/${group.id}`))).group.members.find((m: { displayName: string }) => m.displayName === 'Bob').id);
  const incompleteReason = { code: 'incomplete_bills', count: 1 };
  assert.deepEqual(await json(await api(`/groups/${group.id}/deletion`)), { eligible: false, reasons: [incompleteReason] });
  const incomplete = await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'), 409);
  assert.deepEqual(incomplete.reasons, [incompleteReason]);
  assert.match(incomplete.error, /incomplete/i);
  await json(await api(`/bills/${bill.id}/cancel`, 'alice-token', 'POST', { revision: bill.revision }));
  const repayment = (await json(await api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: group.createdBy, amountCents: 100,
  }), 201)).repayment;
  const pendingReason = { code: 'pending_repayments', count: 1 };
  assert.deepEqual(await json(await api(`/groups/${group.id}/deletion`)), { eligible: false, reasons: [pendingReason] });
  const pending = await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'), 409);
  assert.deepEqual(pending.reasons, [pendingReason]);
  assert.match(pending.error, /pending/i);
  await json(await api(`/repayments/${repayment.id}/decision`, 'alice-token', 'POST', { decision: 'rejected' }));
  await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'));
});

test('a receipt draft does not block deletion and becomes inaccessible afterward', async () => {
  const group = await create();
  const draftId = crypto.randomUUID();
  await pool.query('INSERT INTO receipt_drafts (id, group_id, initiator_id, data) VALUES ($1, $2, $3, $4)',
    [draftId, group.id, group.createdBy, JSON.stringify({ items: [], title: 'Unfinished' })]);
  assert.equal((await json(await api(`/groups/${group.id}/receipt-drafts`))).drafts.length, 1);
  await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipt_drafts WHERE id = $1', [draftId])).rows[0].n, 0);
  await json(await api(`/receipt-drafts/${draftId}`), 404);
  await json(await api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', {
    revision: 1, data: { mode: 'manual', title: 'Unfinished', purchaseDate: '2026-01-01', timeZone: 'America/Toronto',
      notes: '', totalCents: 100, ownShareCents: 100, participantIds: [group.createdBy], items: [] },
  }), 404);
  await json(await api(`/receipt-drafts/${draftId}/initialize`, 'alice-token', 'POST', { revision: 1 }), 404);
  await json(await api(`/groups/${group.id}/receipt-drafts`), 404);
});

test('deletion purges draft and initiated bill photos and evidence while keeping reviewed items and receipt text', async () => {
  const group = await create();
  const unrelated = await create('bob-token');
  const draftId = crypto.randomUUID();
  const initiatedId = crypto.randomUUID();
  const unrelatedId = crypto.randomUUID();
  const billId = crypto.randomUUID();
  await pool.query(`INSERT INTO bills
    (id, group_id, initiator_id, request_id, request_payload, mode, title, purchase_date, total_cents, completed_at, adjustment_cents)
    VALUES ($1, $2, $3, $4, '{}', 'items', 'Reviewed items', '2026-01-01', 100, now(), 0)`,
    [billId, group.id, group.createdBy, crypto.randomUUID()]);
  await pool.query('INSERT INTO bill_shares (bill_id, user_id, amount_cents, confirmed_at) VALUES ($1, $2, 100, now())',
    [billId, group.createdBy]);
  const itemId = crypto.randomUUID();
  await pool.query(`INSERT INTO bill_items
    (id, bill_id, position, name, original_text, quantity, amount_cents, discount_cents, final_cents)
    VALUES ($1, $2, 0, 'Apple', 'APPLE', '1', 100, 0, 100)`, [itemId, billId]);
  for (const [id, groupId, initiatorId, linkedBill] of [
    [draftId, group.id, group.createdBy, null],
    [initiatedId, group.id, group.createdBy, billId],
    [unrelatedId, unrelated.id, unrelated.createdBy, null],
  ]) {
    await pool.query('INSERT INTO receipt_drafts (id, group_id, initiator_id, data, bill_id) VALUES ($1, $2, $3, $4, $5)',
      [id, groupId, initiatorId, JSON.stringify({ title: 'Reviewed receipt', receipt: { text: 'APPLE 1.00' }, items: [] }), linkedBill]);
    await pool.query("INSERT INTO receipt_photos (draft_id, base64, expires_at) VALUES ($1, 'cGhvdG8=', now() + interval '6 months')", [id]);
    await pool.query("INSERT INTO receipt_evidence (draft_id, analysis) VALUES ($1, '{\"raw\":true}')", [id]);
  }
  assert.deepEqual(await json(await api(`/groups/${group.id}/deletion`)), { eligible: true, reasons: [] });
  await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'));
  for (const table of ['receipt_photos', 'receipt_evidence']) {
    const remaining = await pool.query(`SELECT draft_id FROM ${table} ORDER BY draft_id`);
    assert.deepEqual(remaining.rows.map(row => row.draft_id), [unrelatedId]);
  }
  const drafts = await pool.query('SELECT id, data FROM receipt_drafts ORDER BY id');
  assert.deepEqual(drafts.rows.map(row => row.id).sort(), [initiatedId, unrelatedId].sort());
  assert.equal(drafts.rows.find(row => row.id === initiatedId).data.receipt.text, 'APPLE 1.00');
  assert.equal((await pool.query('SELECT name FROM bill_items WHERE id = $1', [itemId])).rows[0].name, 'Apple');
  await json(await api(`/receipt-drafts/${initiatedId}/photo`), 404);
  // The scheduled expiry pass still handles another group's surviving photos.
  await pool.query("UPDATE receipt_photos SET expires_at = now() - interval '1 day' WHERE draft_id = $1", [unrelatedId]);
  const purged = once(child!, 'message'); child!.send('purge-photos');
  assert.equal((await purged)[0], 'photos-purged');
  assert.equal((await pool.query('SELECT base64 FROM receipt_photos WHERE draft_id = $1', [unrelatedId])).rows[0].base64, '');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipt_evidence WHERE draft_id = $1', [unrelatedId])).rows[0].n, 0);
});

test('deleting a group while receipt interpretation is held discards late completion quietly', async () => {
  const group = await create();
  const id = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const data = { mode: 'items', title: 'Scanning', purchaseDate: '2026-01-01', timeZone: 'America/Toronto',
    notes: '', totalCents: 300, ownShareCents: 0, participantIds: [group.createdBy],
    items: [{ id: itemId, name: 'Apple', originalText: 'APPLE', quantity: '1', amountCents: 300,
      discountCents: 0, finalCents: 300, taxable: null, manualFinal: false }] };
  const sharp = (await import('sharp')).default;
  const photoBase64 = (await sharp({ create: { width: 30, height: 60, channels: 3, background: 'white' } }).png().toBuffer()).toString('base64');
  const saved = (await json(await api(`/groups/${group.id}/receipt-drafts/${id}`, 'alice-token', 'PUT',
    { revision: 0, data, photoBase64 }))).draft;
  const recording = once(child!, 'message'); child!.send('recorded-evidence');
  assert.equal((await recording)[0], 'recorded-evidence-ready');
  const holding = once(child!, 'message'); child!.send('hold-model');
  assert.equal((await holding)[0], 'holding-model');
  const errorsBefore = serverErrors.length;
  try {
    const held = once(child!, 'message');
    const scan = await json(await api(`/receipt-drafts/${id}/extract`, 'alice-token', 'POST',
      { revision: saved.revision }));
    assert.equal((await held)[0], 'model-held');
    assert.equal(scan.draft.processingStatus, 'processing');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipt_evidence WHERE draft_id = $1', [id])).rows[0].n, 1);
    assert.deepEqual(await json(await api(`/groups/${group.id}/deletion`)), { eligible: true, reasons: [] });
    await json(await api(`/groups/${group.id}`, 'alice-token', 'DELETE'));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipt_drafts WHERE id = $1', [id])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipt_photos WHERE draft_id = $1', [id])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipt_evidence WHERE draft_id = $1', [id])).rows[0].n, 0);
    const released = once(child!, 'message'); child!.send('release-model');
    assert.equal((await released)[0], 'model-released');
    await json(await api(`/receipt-drafts/${id}`), 404);
    await json(await api(`/receipt-drafts/${id}/initialize`, 'alice-token', 'POST', { revision: scan.draft.revision }), 404);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM receipt_drafts WHERE id = $1', [id])).rows[0].n, 0);
    assert.equal(serverErrors.slice(errorsBefore).includes('Receipt processing completion failed'), false);
  } finally {
    child!.send('release-model');
    const stopped = once(child!, 'message'); child!.send('recorded-evidence-off');
    assert.equal((await stopped)[0], 'recorded-evidence-stopped');
  }
});

test('bill and repayment creation waiting behind deletion cannot create records', async () => {
  const group = await create();
  await inviteMember(group.id);
  await pool.query(`CREATE FUNCTION pause_group_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(7643); RETURN NEW; END $$;
    CREATE TRIGGER pause_group_delete AFTER UPDATE OF deleted_at ON groups
      FOR EACH ROW EXECUTE FUNCTION pause_group_delete();`);
  const blocker = await pool.connect();
  let deletion: Promise<Response> | undefined;
  let bill: Promise<Response> | undefined;
  let repayment: Promise<Response> | undefined;
  try {
    await blocker.query('SELECT pg_advisory_lock(7643)');
    deletion = api(`/groups/${group.id}`, 'alice-token', 'DELETE');
    void deletion.catch(() => {});
    const deadline = Date.now() + 5_000;
    while (true) {
      const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'");
      if (result.rowCount) break;
      assert.ok(Date.now() < deadline, 'Expected deletion to pause before committing');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    bill = api(`/groups/${group.id}/bills`, 'alice-token', 'POST', {
      requestId: crypto.randomUUID(), title: 'Late bill', purchaseDate: '2026-01-01',
      timeZone: 'America/Toronto', notes: '', totalCents: 100, ownShareCents: 100,
      participantIds: [group.createdBy],
    });
    repayment = api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', {
      requestId: crypto.randomUUID(), recipientId: group.createdBy, amountCents: 100,
    });
    void bill.catch(() => {});
    void repayment.catch(() => {});
    await blocker.query('SELECT pg_advisory_unlock(7643)');
    await json(await deletion);
    await json(await bill, 404);
    await json(await repayment, 404);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM bills WHERE group_id = $1', [group.id])).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM repayments WHERE group_id = $1', [group.id])).rows[0].n, 0);
  } finally {
    await blocker.query('SELECT pg_advisory_unlock_all()');
    blocker.release();
    await Promise.allSettled([deletion, bill, repayment]);
    await pool.query('DROP TRIGGER pause_group_delete ON groups; DROP FUNCTION pause_group_delete()');
  }
});
