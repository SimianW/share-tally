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

// Close sockets when a managed application process shuts down.
export async function closeDatabase(): Promise<void> {
  await pool.end();
}
