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
    'TRUNCATE TABLE group_members, groups, users',
  )
})


async function request(token?: string, suffix = '', extraHeaders = {}) {
  return fetch(`${baseUrl}/api/me${suffix}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    signal: AbortSignal.timeout(10_000),
  });
}

async function account(token: string, suffix = '', extraHeaders = {}) {
  const response = await request(token, suffix, extraHeaders);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['clerkUserId', 'id']);
  assert.match(body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  return body;
}

async function rows() {
  return (await pool.query('SELECT id, clerk_user_id, created_at FROM users ORDER BY clerk_user_id')).rows;
}

test('unauthenticated requests return 401 and create no users', async () => {
  const response = await request();
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unauthorized' });
  assert.deepEqual(await rows(), []);
});

test('first authenticated request persists an application identity', async () => {
  const user = await account('alice-token');
  assert.equal(user.clerkUserId, 'user_test_alice');
  const saved = await rows();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, user.id);
  assert.equal(saved[0].clerk_user_id, 'user_test_alice');
  assert.ok(saved[0].created_at instanceof Date);
});

test('repeated requests preserve the identity and creation time', async () => {
  const first = await account('alice-token');
  const originalRows = await rows();
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.deepEqual(await account('alice-token'), first);
  }
  assert.deepEqual(await rows(), originalRows);
});

test('concurrent first requests return one identity despite an uncommitted competing insert', async () => {
  // Pause the winning INSERT before it commits. All other requests must then
  // wait on the same unique key. This trigger exists only in the disposable DB.
  await pool.query(`
    CREATE FUNCTION pause_user_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(7142);
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER pause_user_insert AFTER INSERT ON users
      FOR EACH ROW EXECUTE FUNCTION pause_user_insert();
  `);
  const blocker = await pool.connect();
  let pending: Promise<unknown[]> | undefined;
  try {
    await blocker.query('SELECT pg_advisory_lock(7142)');
    pending = Promise.all(Array.from({ length: 6 }, () => account('alice-token')));
    // Attach a handler immediately; assertion/cleanup below still propagates failures.
    void pending.catch(() => { });
    const deadline = Date.now() + 8_000;
    while (true) {
      const { rows: [waiting] } = await pool.query(`
        SELECT count(*) FILTER (WHERE wait_event = 'advisory')::int AS winner,
               count(*) FILTER (WHERE wait_event = 'transactionid')::int AS competitors
        FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      `);
      if (waiting.winner === 1 && waiting.competitors === 5) break;
      assert.ok(Date.now() < deadline, 'Expected one blocked winner and five competing inserts');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await blocker.query('SELECT pg_advisory_unlock(7142)');
    const responses = await pending;
    for (const response of responses) assert.deepEqual(response, responses[0]);
    const saved = await rows();
    assert.equal(saved.length, 1);
    assert.deepEqual(responses[0], { id: saved[0].id, clerkUserId: 'user_test_alice' });
  } finally {
    // Always release the lock, including when the contention assertion fails.
    await blocker.query('SELECT pg_advisory_unlock_all()');
    blocker.release();
    try { await pending; }
    finally {
      await pool.query('DROP TRIGGER pause_user_insert ON users; DROP FUNCTION pause_user_insert()');
    }
  }
});

test('different authenticated users receive separate application identities', async () => {
  const alice = await account('alice-token');
  const bob = await account('bob-token');
  assert.equal(alice.clerkUserId, 'user_test_alice');
  assert.equal(bob.clerkUserId, 'user_test_bob');
  assert.notEqual(alice.id, bob.id);
  assert.deepEqual(await account('alice-token'), alice);
  assert.deepEqual((await rows()).map((row) => row.id), [alice.id, bob.id]);
});

test('application identity survives a backend process restart', async () => {
  const original = await account('alice-token');
  const originalRows = await rows();
  const oldPid = child?.pid;
  await stopServer();
  // A new Node process has no access to the previous process's module cache.
  // Only PostgreSQL remains running between requests.
  await startServer();
  assert.notEqual(child?.pid, oldPid);
  assert.deepEqual(await account('alice-token'), original);
  assert.deepEqual(await rows(), originalRows);
});

test('query and header identities cannot override the authenticated user', async () => {
  const alice = await account('alice-token');
  const bob = await account('bob-token');
  const beforeSpoof = await rows();
  const suffix = `?clerkUserId=user_test_bob&userId=${bob.id}`;
  const headers = { 'x-clerk-user-id': 'user_test_bob', 'x-user-id': bob.id };
  assert.deepEqual(await account('alice-token', suffix, headers), alice);
  const unsigned = await request(undefined, suffix, headers);
  assert.equal(unsigned.status, 401);
  assert.deepEqual(await rows(), beforeSpoof);
});
