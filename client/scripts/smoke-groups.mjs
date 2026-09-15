// Run after installing both client and server dependencies and Chromium:
// cd client && pnpm exec playwright install chromium && pnpm test:groups
// Real UI + Express + temporary PostgreSQL. Only Clerk is replaced; this does
// not verify Google OAuth, production credentials, or session lifetime.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const { PostgreSqlContainer } = serverRequire('@testcontainers/postgresql');
const { Pool } = serverRequire('pg');
const { drizzle } = serverRequire('drizzle-orm/node-postgres');
const { migrate } = serverRequire('drizzle-orm/node-postgres/migrator');
const clientRoot = fileURLToPath(new URL('../', import.meta.url));
const serverRoot = fileURLToPath(new URL('../../server/', import.meta.url));
let container, pool, child, vite, browser;
const errors = [];
try {
  container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: `${serverRoot}/drizzle` });
  child = fork(`${serverRoot}/test/server-process.ts`, {
    cwd: serverRoot, execArgv: ['--import=tsx'],
    env: { PATH: process.env.PATH, DATABASE_URL: container.getConnectionUri() },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API startup timed out')), 10_000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`API exited: ${code}`)); });
  });
  vite = await createServer({
    root: clientRoot, configFile: false, envDir: false,
    define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('test-only-clerk-boundary') },
    plugins: [{ name: 'smoke-clerk', enforce: 'pre', resolveId(id) {
      if (id === '@clerk/react') return `${clientRoot}/test/clerk.tsx`;
    } }, react()],
    optimizeDeps: { exclude: ['@clerk/react'] },
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${port}` } },
  });
  await vite.listen();
  const base = vite.resolvedUrls.local[0];
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  async function pageFor(identity, viewport) {
    const context = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'] });
    if (identity) await context.addInitScript(token => {
      if (!sessionStorage.getItem('smoke-initialized')) {
        localStorage.setItem('smoke-token', token);
        sessionStorage.setItem('smoke-initialized', 'yes');
      }
    }, identity);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    return page;
  }
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  await alice.goto(base);
  await alice.getByRole('button', { name: 'New group', exact: true }).click();
  await alice.getByLabel('Group name').fill('Costco friends');
  await alice.getByRole('button', { name: 'Choose group icon' }).click();
  await alice.getByLabel('Search icons and emoji').fill('coffee');
  await expect(alice.getByRole('button', { name: 'Select Coffee', exact: true }).locator('svg.lucide-coffee')).toBeVisible();
  await alice.getByRole('button', { name: 'Select Coffee', exact: true }).click();
  await alice.keyboard.press('Escape');
  await expect(alice.getByRole('button', { name: 'Choose group icon' }).locator('svg.lucide-shopping-basket')).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Choose group icon' })).toBeFocused();
  await alice.getByRole('button', { name: 'Choose group icon' }).click();
  await alice.getByLabel('Search icons and emoji').fill('coffee');
  await alice.getByRole('button', { name: 'Select Coffee', exact: true }).click();
  await alice.getByRole('button', { name: 'Use icon', exact: true }).click();
  await expect(alice.getByRole('button', { name: 'Choose group icon' }).locator('svg.lucide-coffee')).toBeVisible();
  await alice.getByRole('button', { name: 'Choose group icon' }).click();
  await alice.getByRole('button', { name: /^Emoji/ }).click();
  await alice.getByLabel('Search icons and emoji').fill('pizza');
  await expect(alice.getByRole('button', { name: 'Select pizza', exact: true })).toContainText('🍕');
  await alice.getByRole('button', { name: 'Select pizza', exact: true }).click();
  await alice.getByLabel('Paste emoji or symbol').fill('ab');
  await expect(alice.getByRole('button', { name: 'Use icon', exact: true })).toBeDisabled();
  await expect(alice.getByRole('alert')).toContainText('one visible character');
  await alice.getByLabel('Paste emoji or symbol').fill('👨‍👩‍👧‍👦');
  await mkdir(`${clientRoot}/test-results`, { recursive: true });
  await alice.screenshot({ path: `${clientRoot}/test-results/icon-picker-desktop.png`, fullPage: true });
  await alice.setViewportSize({ width: 390, height: 844 });
  await expect(alice.getByRole('button', { name: 'Use icon', exact: true })).toBeVisible();
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.screenshot({ path: `${clientRoot}/test-results/icon-picker-mobile.png`, fullPage: true });
  await alice.getByRole('button', { name: 'Use icon', exact: true }).click();
  await expect(alice.getByRole('button', { name: 'Choose group icon' })).toContainText('👨‍👩‍👧‍👦');
  await alice.setViewportSize({ width: 1280, height: 900 });
  await alice.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(alice.getByRole('dialog')).toContainText('Alice · You');
  await alice.getByRole('button', { name: 'Get invitation link', exact: true }).click();
  const oldLink = await alice.getByLabel('Invitation link', { exact: true }).inputValue();
  await alice.getByRole('button', { name: 'Copy invitation link' }).click();
  assert.equal(await alice.evaluate(() => navigator.clipboard.readText()), oldLink);
  const groupUrl = alice.url();

  // A signed-out mobile visitor keeps the invitation across the sign-in boundary.
  const bob = await pageFor(null, { width: 390, height: 844 });
  await bob.goto(oldLink);
  await expect(bob.getByText('Sign in to accept your group invitation.')).toBeVisible();
  await bob.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(bob.getByRole('dialog')).toContainText('Join your friends');
  await bob.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(bob.getByRole('dialog')).toContainText('Bob · You');
  await expect(bob.getByRole('dialog')).toContainText('2 members');
  await expect(bob.getByRole('button', { name: 'Get invitation link' })).toHaveCount(0);
  await bob.reload();
  await expect(bob.getByRole('dialog')).toContainText('2 members');
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await bob.goto(oldLink);
  await bob.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(bob.getByRole('dialog')).toContainText('2 members');

  await alice.getByRole('button', { name: 'Refresh members' }).click();
  await expect(alice.getByRole('dialog')).toContainText('Bob');
  await alice.getByRole('button', { name: 'Regenerate link', exact: true }).click();
  await alice.getByRole('button', { name: 'Replace link', exact: true }).click();
  await expect(alice.getByLabel('Invitation link', { exact: true })).not.toHaveValue(oldLink);
  const newLink = await alice.getByLabel('Invitation link', { exact: true }).inputValue();

  const carol = await pageFor('carol-token', { width: 1280, height: 900 });
  await carol.goto(groupUrl);
  await expect(carol.getByRole('alert')).toHaveText('Group not found.');
  await carol.goto(oldLink);
  await carol.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(carol.getByRole('alert')).toContainText('invalid or has been replaced');
  await carol.goto(newLink);
  await carol.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(carol.getByRole('dialog')).toContainText('3 members');

  await bob.reload();
  await expect(bob.getByRole('dialog')).toContainText('3 members');
  await bob.getByRole('button', { name: 'Close dialog' }).click();
  await bob.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(bob.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(bob.getByText('Costco friends')).toHaveCount(0);
  await alice.reload();
  await expect(alice.getByRole('dialog')).toContainText('3 members');
  await mkdir(`${clientRoot}/test-results`, { recursive: true });
  await alice.screenshot({ path: `${clientRoot}/test-results/groups-desktop.png`, fullPage: true });
  await carol.setViewportSize({ width: 390, height: 844 });
  await carol.screenshot({ path: `${clientRoot}/test-results/groups-mobile.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Group browser smoke passed: creation, Unicode icon, persistence, sign-in return, membership, invitation permissions, rotation, invalid links, repeat joining, mobile layout, sign-out.');
} catch (error) {
  if (browser) {
    for (const context of browser.contexts()) for (const page of context.pages()) {
      console.error('Failed browser page:', page.url(), (await page.locator('body').innerText()).slice(0, 3000));
    }
  }
  console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser?.close();
  await vite?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.kill('SIGTERM');
    try { await exited; } finally { clearTimeout(timer); }
  }
  await pool?.end();
  await container?.stop();
}
