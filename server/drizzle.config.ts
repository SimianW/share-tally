import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL');
}

export default defineConfig({
  dialect: 'postgresql',

  schema: './src/db/schema.ts',

  out: './drizzle',

  dbCredentials: {
    url: databaseUrl,
  }
});