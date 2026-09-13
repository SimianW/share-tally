import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, closeDatabase } from './db/index.js'

// Deployment runs this once before replacing API containers. A failed migration
// exits nonzero, preventing the pipeline from starting the new application.
try {
  await migrate(db, { migrationsFolder: './drizzle' })
} finally {
  await closeDatabase()
}
