import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;

before(async () => {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, { timeout: 120_000 });

after(async () => {
  try { await pool?.end(); }
  finally { await container?.stop(); }
});

// Runs the deployment's migration entry point as its own process, as a release does.
async function runMigrationProcess(): Promise<number | null> {
  assert.ok(container);
  const child = fork(new URL('../src/migrate.ts', import.meta.url), {
    execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const [code] = await once(child, 'exit');
  return code;
}

test('two migration runs started together both succeed and apply each migration once', async () => {
  const journal = JSON.parse(await readFile('./drizzle/meta/_journal.json', 'utf8')) as {
    entries: { when: number }[];
  };

  const exitCodes = await Promise.all([runMigrationProcess(), runMigrationProcess()]);

  assert.deepEqual(exitCodes, [0, 0]);
  const applied = await pool.query<{ created_at: string }>(
    'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
  );
  assert.deepEqual(
    applied.rows.map((row) => Number(row.created_at)),
    journal.entries.map((entry) => entry.when),
  );
});
