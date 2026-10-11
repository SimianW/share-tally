import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { startDatabaseProxy, type DatabaseProxy, type DatabaseState } from './database-proxy.js';

let container: StartedPostgreSqlContainer | undefined;
let child: ChildProcess | undefined;
let proxy: DatabaseProxy | undefined;
let baseUrl: string;
// The API's error output, still shown on this runner's stderr.
let serverErrors = '';
const setDatabase = (state: DatabaseState) => proxy!.set(state);

async function startServer(databaseUrl: string) {
  // Never read .env or use the developer's DATABASE_URL in this suite.
  const processUnderTest = fork(new URL('./server-process.ts', import.meta.url), {
    execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
  });
  child = processUnderTest;
  processUnderTest.stderr!.on('data', (chunk: Buffer) => {
    serverErrors += chunk.toString();
    process.stderr.write(chunk);
  });
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
  proxy = await startDatabaseProxy(container.getHost(), container.getPort());
  await startServer(proxy.url(container.getConnectionUri()));
}, { timeout: 120_000 });

afterEach(() => setDatabase('up'));

after(async () => {
  try { await stopServer(); }
  finally {
    proxy?.close();
    await container?.stop();
  }
});

test('an idle API sends no database traffic', async () => {
  // Startup has finished with no processing drafts, and this suite's server
  // process does not run the hourly tasks. Wait several former sweep intervals.
  assert.equal(await proxy!.trafficDuring(7_000), 0);
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

test('a failed pooled connection is logged without its connection details', async () => {
  // A signed-in read leaves an application connection idle in the pool.
  const me = await fetch(`${baseUrl}/api/me`, { headers: { authorization: 'Bearer alice-token' } });
  assert.equal(me.status, 200);
  const logged = serverErrors.length;
  setDatabase('refusing');
  const deadline = Date.now() + 5_000;
  while (!serverErrors.includes('Unexpected PostgreSQL error', logged)) {
    assert.ok(Date.now() < deadline, 'the pool error was not logged');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  // One line naming the failure: no client, host, port, user, database or secret key.
  assert.match(serverErrors.slice(logged), /^Unexpected PostgreSQL error \S+\n$/);
});

test('a failed request is logged without its query or values', async () => {
  const logged = serverErrors.length;
  setDatabase('refusing');
  const me = await fetch(`${baseUrl}/api/me`, { headers: { authorization: 'Bearer alice-token' } });
  assert.equal(me.status, 500);
  await new Promise(resolve => setTimeout(resolve, 200));
  const output = serverErrors.slice(logged);
  assert.ok(output.includes('Request failed'), 'the request failure was not logged');
  // Only error names and codes: no SQL, bound values, host or port.
  for (const line of output.trimEnd().split('\n'))
    assert.match(line, /^(Request failed|Unexpected PostgreSQL error) \S+$/);
  assert.ok(!output.includes('user_test_alice'));
});

test('readiness recovers once PostgreSQL answers again', async () => {
  setDatabase('silent');
  assert.equal((await check('/api/health/ready')).response.status, 503);
  setDatabase('up');
  const { response, body } = await check('/api/health/ready');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(body), { status: 'ok' });
});

// Runs the API image's Compose health check program against this suite's API.
async function healthcheck(marker: string) {
  try {
    await promisify(execFile)(process.execPath, ['--import=tsx', fileURLToPath(new URL('../src/healthcheck.ts', import.meta.url))], {
      env: { PATH: process.env.PATH, HEALTHCHECK_ORIGIN: baseUrl, HEALTHCHECK_MARKER: marker },
      timeout: 15_000,
    });
    return 0;
  } catch (error) {
    return (error as { code?: number }).code ?? 1;
  }
}

test('the health check gates on readiness until it first succeeds, then checks liveness only', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'share-tally-health-'));
  try {
    const marker = join(directory, 'ready');
    setDatabase('refusing');
    assert.notEqual(await healthcheck(marker), 0);
    setDatabase('up');
    assert.equal(await healthcheck(marker), 0);
    setDatabase('refusing');
    const since = proxy!.checkpoint();
    assert.equal(await healthcheck(marker), 0);
    assert.equal(since(), 0);
    // A new container starts without the marker and checks readiness again.
    const fresh = proxy!.checkpoint();
    assert.notEqual(await healthcheck(join(directory, 'fresh')), 0);
    assert.ok(fresh() > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
