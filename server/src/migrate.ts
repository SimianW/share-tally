import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDatabase } from './db/index.js';

// Every migration run, including an out-of-band one, waits for this lock.
// Drizzle's migrator takes no lock of its own.
const MIGRATION_LOCK_KEY = 2_280_001;

// Deployment runs this once before replacing API containers. A failed migration
// exits nonzero, preventing the pipeline from starting the new application.
try {
  // The lock belongs to this session, so the migration must use the same connection.
  const client = await db.$client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  } finally {
    // Discarding the connection ends the session, which releases the lock even
    // if the migration failed.
    client.release(true);
  }
} finally {
  await closeDatabase();
}
