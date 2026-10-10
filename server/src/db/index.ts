import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL');
}

const pool = new Pool({
  connectionString: databaseUrl,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL error', error);
});

export const db = drizzle(pool);

// Readiness probes use their own single connection, so a stalled database can
// neither hold application connections nor queue probes without bound. Each
// phase has its own limit, so a probe settles within three seconds.
const readinessPool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 1_500,
  query_timeout: 1_500,
});

readinessPool.on('error', () => {
  // A failed idle probe connection is replaced by the next probe.
});

// Resolves when PostgreSQL answers a query; rejects on failure or timeout.
export async function checkDatabase(): Promise<void> {
  await readinessPool.query('SELECT 1');
}

// Close sockets when a managed application process shuts down.
export async function closeDatabase(): Promise<void> {
  await Promise.all([pool.end(), readinessPool.end()]);
}
