// PROTOTYPE (throwaway): serve the real app with the browser tests' Clerk stand-in,
// a scratch PostgreSQL container and a seeded group, so the new-bill entry
// variants can be viewed at #/new-bill/<group>?variant=... Nothing persists:
// the container is removed when this process stops.
//
//   pnpm prototype:bill-entry            (PROTOTYPE_HOST / PROTOTYPE_PORT to override)
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { themeBootstrap } from '../build/theme-bootstrap.ts';
import { clientRoot, serverRoot, serverRequire } from './browser/environment.mjs';

const host = process.env.PROTOTYPE_HOST ?? 'dev-2a1m';
const port = Number(process.env.PROTOTYPE_PORT ?? 5199);
const disposers = [];
const dispose = async () => { while (disposers.length) await disposers.pop()().catch(console.error); };
process.on('SIGINT', () => void dispose().then(() => process.exit(0)));
process.on('SIGTERM', () => void dispose().then(() => process.exit(0)));

const { PostgreSqlContainer } = serverRequire('@testcontainers/postgresql');
const { Pool } = serverRequire('pg');
const { drizzle } = serverRequire('drizzle-orm/node-postgres');
const { migrate } = serverRequire('drizzle-orm/node-postgres/migrator');
const container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
disposers.push(() => container.stop());
const pool = new Pool({ connectionString: container.getConnectionUri() });
await migrate(drizzle(pool), { migrationsFolder: `${serverRoot}drizzle` });
await pool.end();

const api = fork(`${serverRoot}test/server-process.ts`, {
  cwd: serverRoot, execArgv: ['--import=tsx'],
  env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri(), TEST_FIRST_EXTRACTION_FAILS: '0' },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
disposers.push(async () => { if (api.exitCode === null) { api.kill('SIGTERM'); await once(api, 'exit'); } });
const [apiPort] = await once(api, 'message');
const apiUrl = `http://127.0.0.1:${apiPort}`;

async function request(path, token = 'alice-token', method = 'GET', body) {
  const response = await fetch(`${apiUrl}/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
  return response.json();
}
const { group } = await request('/groups', 'alice-token', 'POST', { name: 'Costco run', icon: { type: 'unicode', value: '🛒' } });
const invitation = await request(`/groups/${group.id}/invitation`);
for (const token of ['bob-token', 'carol-token'])
  await request('/groups/join', token, 'POST', { token: invitation.path.split('/').at(-1) });

const vite = await createServer({
  root: clientRoot, configFile: false, envDir: false,
  cacheDir: `${clientRoot}node_modules/.vite-prototype`,
  define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('test-only-clerk-boundary') },
  plugins: [
    themeBootstrap(),
    { name: 'prototype-clerk', enforce: 'pre', resolveId(id) { if (id === '@clerk/react') return `${clientRoot}test/clerk.tsx`; } },
    // Sign in as Alice, the group's owner, on first visit.
    { name: 'prototype-sign-in', transformIndexHtml: () => [{ tag: 'script', injectTo: 'head-prepend',
      children: "if (!localStorage.getItem('smoke-token')) localStorage.setItem('smoke-token', 'alice-token');" }] },
    react(),
  ],
  optimizeDeps: { exclude: ['@clerk/react'] },
  server: { host: '0.0.0.0', port, strictPort: true, allowedHosts: [host], proxy: { '/api': apiUrl } },
});
disposers.push(() => vite.close());
await vite.listen();

const base = `http://${host}:${port}/`;
console.log(`\nPrototype ready. Signed in as Alice in "Costco run" (Alice, Bob, Carol).`);
for (const key of ['current', 'A', 'B', 'C'])
  console.log(`  ${key.padEnd(8)} ${base}?variant=${key}#/new-bill/${group.id}`);
console.log('Use ← / → or the bottom bar to switch. Ctrl-C stops and removes the database.\n');
