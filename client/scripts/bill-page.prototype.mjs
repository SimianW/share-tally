// PROTOTYPE — throwaway. `pnpm prototype:bill` starts a scratch Postgres
// container, the API, and Vite with the smoke-test Clerk stub, seeds one
// group with bills in every state, and prints bill URLs. Flip between the bill
// page variants with ?variant=A..E or the floating bar. Needs Docker.
// Sign in (the stub signs you in as Bob) or set localStorage "smoke-token"
// to "alice-token" / "bob-token" / "carol-token" to switch people.
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const { PostgreSqlContainer } = serverRequire('@testcontainers/postgresql');
const { Pool } = serverRequire('pg');
const { drizzle } = serverRequire('drizzle-orm/node-postgres');
const { migrate } = serverRequire('drizzle-orm/node-postgres/migrator');
const clientRoot = fileURLToPath(new URL('../', import.meta.url));
const serverRoot = fileURLToPath(new URL('../../server/', import.meta.url));

const container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
const pool = new Pool({ connectionString: container.getConnectionUri() });
await migrate(drizzle(pool), { migrationsFolder: `${serverRoot}/drizzle` });
const child = fork(`${serverRoot}/test/server-process.ts`, {
  cwd: serverRoot, execArgv: ['--import=tsx'],
  env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
const port = await new Promise(resolve => child.once('message', resolve));
async function api(path, token = 'alice-token', method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
  return response.json();
}
const { group: created } = await api('/groups', 'alice-token', 'POST', { name: 'Costco Crew', icon: { type: 'unicode', value: '🛒' } });
const gid = created.id;
const invitation = await api(`/groups/${gid}/invitation`);
for (const token of ['bob-token', 'carol-token'])
  await api('/groups/join', token, 'POST', { token: invitation.path.split('/').at(-1) });
const { group } = await api(`/groups/${gid}`);
const ids = Object.fromEntries(group.members.map(m => [m.displayName, m.id]));
async function manual(initiator, title, totalCents, ownShareCents, names, notes = '') {
  return (await api(`/groups/${gid}/bills`, `${initiator.toLowerCase()}-token`, 'POST', {
    requestId: randomUUID(), title, purchaseDate: '2026-09-16', timeZone: 'America/Toronto',
    notes, totalCents, ownShareCents, participantIds: names.map(n => ids[n]),
  })).bill;
}
async function share(bill, person, amountCents) {
  const own = bill.participants.find(p => p.userId === ids[person]);
  return (await api(`/bills/${bill.id}/share`, `${person.toLowerCase()}-token`, 'POST', {
    revision: bill.revision, expectedAmountCents: own?.amountCents ?? null, amountCents,
  })).bill;
}
const out = {};
// Bob initiated, Alice confirmed; exact match waiting on Bob.
let b = await manual('Bob', 'Weekend groceries', 2200, 200, ['Bob', 'Alice'], 'Split the big bag of apples.');
out.exactWaiting = (await share(b, 'Alice', 2000)).id;
// Alice initiated; Carol hasn't submitted: left to match.
b = await manual('Alice', 'Household essentials', 7290, 2400, ['Alice', 'Bob', 'Carol']);
out.leftToMatch = (await share(b, 'Bob', 2500)).id;
// Over total: needs correction.
b = await manual('Alice', 'Pizza night', 5400, 2000, ['Alice', 'Bob', 'Carol']);
b = await share(b, 'Bob', 2000);
out.over = (await share(b, 'Carol', 2000)).id;
// Completed with a 3c adjustment.
b = await manual('Alice', 'Costco run', 12648, 4216, ['Alice', 'Bob', 'Carol']);
b = await share(b, 'Bob', 4215);
b = await share(b, 'Carol', 4214);
out.complete = b.id;
// Completed exact.
b = await manual('Bob', 'Coffee beans', 3000, 1500, ['Bob', 'Alice']);
out.completeExact = (await share(b, 'Alice', 1500)).id;
// Canceled.
b = await manual('Alice', 'Movie snacks', 1800, 900, ['Alice', 'Bob']);
out.canceled = (await api(`/bills/${b.id}/cancel`, 'alice-token', 'POST', { revision: b.revision })).bill.id;
// Everyone confirmed, but within tolerance -> should complete; so make negative-adjustment-free waiting on Alice confirm.
b = await manual('Bob', 'Paper towels', 2600, 1300, ['Bob', 'Alice', 'Carol']);
out.aliceToConfirm = (await share(b, 'Carol', 1300)).id;

// Item-claims bill.
const item = (name, c) => ({ id: randomUUID(), name, originalText: name.toUpperCase(), quantity: '1', amountCents: c, discountCents: 0, taxable: false, finalCents: c, manualFinal: false });
const draftId = randomUUID();
const { draft } = await api(`/groups/${gid}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', { revision: 0, data: {
  mode: 'items', title: 'Costco receipt', purchaseDate: '2026-09-16', timeZone: 'America/Toronto', notes: '',
  totalCents: 4600, ownShareCents: 0, participantIds: [ids.Alice, ids.Bob, ids.Carol],
  receipt: { subtotalCents: 4600, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
  items: [item('Shared apples', 2000), item('Paper towels', 1800), item('Croissants', 800)] } });
out.items = (await api(`/receipt-drafts/${draftId}/initialize`, 'alice-token', 'POST', { revision: draft.revision })).bill.id;

const vite = await createServer({
  root: clientRoot, configFile: false, envDir: false,
  cacheDir: `${clientRoot}/node_modules/.vite-preview`,
  define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('test-only-clerk-boundary') },
  plugins: [{ name: 'smoke-clerk', enforce: 'pre', resolveId(id) {
    if (id === '@clerk/react') return `${clientRoot}/test/clerk.tsx`;
  } }, react()],
  optimizeDeps: { exclude: ['@clerk/react'] },
  server: { host: '0.0.0.0', port: Number(process.env.PORT ?? 5188), strictPort: true, allowedHosts: true, proxy: { '/api': `http://127.0.0.1:${port}` } },
});
await vite.listen();
out.group = gid;
mkdirSync(`${clientRoot}/test-results`, { recursive: true });
writeFileSync(`${clientRoot}/test-results/preview.json`, JSON.stringify(out, null, 2));
console.log('PREVIEW READY');
for (const [key, id] of Object.entries(out))
  console.log(key.padEnd(14), key === 'group' ? `http://localhost:5188/#/group-bills/${id}` : `http://localhost:5188/?variant=B#/bills/${id}`);
