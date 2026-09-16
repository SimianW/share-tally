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

async function startServer() {
  assert.ok(container);
  // Never read .env or use the developer's DATABASE_URL in this suite.
  const processUnderTest = fork(new URL('./server-process.ts', import.meta.url), {
    execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
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
    'TRUNCATE TABLE bill_shares, bills, group_members, groups, users',
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
    [path, 'GET', undefined], [`${path}/invitation`, 'GET', undefined],
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
  for (const method of ['DELETE', 'PATCH']) {
    assert.equal((await api(path, 'alice-token', method, { userId: group.createdBy })).status, 404);
  }
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
