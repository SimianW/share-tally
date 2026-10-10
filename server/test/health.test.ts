import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

let container: StartedPostgreSqlContainer | undefined;
let child: ChildProcess | undefined;
let proxy: Server | undefined;
let baseUrl: string;

// The API reaches PostgreSQL only through this proxy, so a test can make the
// database refuse connections, accept them and never answer, or keep
// established connections open while ignoring their queries.
type DatabaseState = 'up' | 'refusing' | 'silent' | 'stalled';
let databaseState: DatabaseState = 'up';
const sockets = new Set<Socket>();
function track(socket: Socket) {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  socket.on('error', () => {});
}
function setDatabase(state: DatabaseState) {
  databaseState = state;
  // Existing pooled connections fail too, as they would in a real outage.
  if (state === 'refusing' || state === 'silent') for (const socket of sockets) socket.destroy();
}

async function startProxy(host: string, port: number) {
  const server = createServer(client => {
    track(client);
    if (databaseState === 'refusing') { client.destroy(); return; }
    if (databaseState === 'silent') return;
    const upstream = createConnection({ host, port });
    track(upstream);
    client.on('data', chunk => { if (databaseState !== 'stalled') upstream.write(chunk); });
    upstream.pipe(client);
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  proxy = server;
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function startServer(databaseUrl: string) {
  // Never read .env or use the developer's DATABASE_URL in this suite.
  const processUnderTest = fork(new URL('./server-process.ts', import.meta.url), {
    execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl },
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
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  try { await migrate(drizzle(pool), { migrationsFolder: './drizzle' }); }
  finally { await pool.end(); }
  const proxyPort = await startProxy(container.getHost(), container.getPort());
  const url = new URL(container.getConnectionUri());
  url.hostname = '127.0.0.1';
  url.port = String(proxyPort);
  await startServer(url.toString());
}, { timeout: 120_000 });

afterEach(() => setDatabase('up'));

after(async () => {
  try { await stopServer(); }
  finally {
    for (const socket of sockets) socket.destroy();
    proxy?.close();
    await container?.stop();
  }
});

async function check(path: string) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
  return { response, body: await response.text(), elapsed: Date.now() - started };
}

test('readiness succeeds while PostgreSQL answers', async () => {
  const { response, body } = await check('/api/health/ready');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(body), { status: 'ok' });
});

for (const state of ['refusing', 'silent'] as const) {
  test(`readiness reports 503 promptly while PostgreSQL is ${state}`, async () => {
    setDatabase(state);
    const { response, body, elapsed } = await check('/api/health/ready');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    // Only the status: no host, port, user, database or driver error text.
    assert.deepEqual(JSON.parse(body), { status: 'unavailable' });
    // Within the Compose health check's five-second timeout.
    assert.ok(elapsed < 4_000, `readiness took ${elapsed} ms`);
  });
}

test('readiness reports 503 promptly when an established connection stops answering', async () => {
  // A successful check leaves its connection idle in the pool for reuse.
  assert.equal((await check('/api/health/ready')).response.status, 200);
  setDatabase('stalled');
  const { response, body, elapsed } = await check('/api/health/ready');
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(body), { status: 'unavailable' });
  assert.ok(elapsed < 4_000, `readiness took ${elapsed} ms`);
});

test('liveness keeps succeeding while PostgreSQL is down', async () => {
  for (const state of ['refusing', 'silent', 'stalled'] as const) {
    setDatabase(state);
    const { response, body, elapsed } = await check('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(body), { status: 'ok' });
    assert.ok(elapsed < 1_000, `liveness took ${elapsed} ms`);
  }
});

test('readiness recovers once PostgreSQL answers again', async () => {
  setDatabase('silent');
  assert.equal((await check('/api/health/ready')).response.status, 503);
  setDatabase('up');
  const { response, body } = await check('/api/health/ready');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(body), { status: 'ok' });
});
