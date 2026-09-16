import { checkGroupRefresh } from './smoke-group-refresh.mjs';
import { checkNavigation } from './smoke-navigation.mjs';
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
    // Keep the test-only Clerk bundle separate from production dependency caching.
    cacheDir: `${clientRoot}/node_modules/.vite-smoke`,
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
    page.on('console', message => { if (message.type() === 'error') { console.error('Browser console:', message.text()); if (message.text().includes('Encountered two children')) errors.push(message.text()); } });
    return page;
  }
  await checkGroupRefresh(pageFor, base);
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

  await carol.getByRole('button', { name: 'View bills and balance' }).click();
  // Wait for an actual subscribed snapshot; an empty selector also matches the loading screen.
  await expect(carol.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  await expect(carol.locator('.bill-list-row')).toHaveCount(0);
  // Hold an obsolete empty snapshot while another user commits a bill.
  // The notification during that read must cause a second authoritative read.
  let releaseSnapshot;
  const heldSnapshot = new Promise(resolve => { releaseSnapshot = resolve; });
  let capturedSnapshot = false;
  const carolBillsPattern = '**/api/groups/' + carol.url().split('/').pop() + '/bills';
  await carol.route(carolBillsPattern, async route => {
    const response = await route.fetch();
    capturedSnapshot = true;
    await heldSnapshot;
    await route.fulfill({ response });
  }, { times: 1 });
  await carol.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => capturedSnapshot).toBe(true);

  // Issue #4: real bill creation, response-loss retry, share confirmation, and balances.
  await alice.getByRole('button', { name: 'View bills and balance' }).click();
  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  await expect(alice.getByRole('group', { name: 'Who shared this purchase?' })).toBeVisible();
  await expect(alice.getByRole('checkbox', { name: 'Alice · You, initiator' })).toBeDisabled();
  await alice.getByRole('button', { name: 'Select everyone', exact: true }).click();
  await expect(alice.getByRole('checkbox', { name: 'Carol', exact: true })).toBeChecked();
  await alice.getByRole('button', { name: 'Just me', exact: true }).click();
  await expect(alice.getByRole('checkbox', { name: 'Carol', exact: true })).not.toBeChecked();
  await alice.getByLabel('Bill title', { exact: true }).fill('Weekend groceries');
  await alice.getByLabel('Bill total · CAD', { exact: true }).fill('100.001');
  await alice.getByLabel('My share · CAD', { exact: true }).fill('40.00');
  await alice.getByRole('checkbox', { name: 'Bob', exact: true }).check();
  await alice.getByRole('button', { name: 'Create bill and confirm my share' }).click();
  await expect(alice.getByRole('alert')).toContainText('at most two decimal places');
  await alice.getByLabel('Bill total · CAD', { exact: true }).fill('100.00');
  let creationAttempts = 0;
  await alice.route('**/api/groups/*/bills', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    creationAttempts++;
    if (creationAttempts === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await alice.getByRole('button', { name: 'Create bill and confirm my share' }).click();
  await expect(alice.getByRole('button', { name: 'Retry creation' })).toBeVisible();
  releaseSnapshot();
  await expect(carol.locator('.bill-list-row')).toContainText('Weekend groceries', { timeout: 3000 });
  await alice.reload();
  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Weekend groceries');
  await alice.getByRole('button', { name: 'Retry creation' }).click();
  await expect(alice.getByRole('heading', { name: 'Weekend groceries' })).toBeVisible();
  assert.equal(creationAttempts, 2);
  await expect(alice.locator('.difference-number')).toHaveText('$60.00');
  await expect(alice.locator('.difference-card')).toContainText('1/2 confirmed');
  const billUrl = alice.url();
  await bob.goto(base);
  const bobAttention = bob.getByRole('region', { name: 'Needs your attention' });
  await expect(bobAttention.getByRole('link', { name: /Enter your share.*Weekend groceries/ })).toBeVisible();
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await bob.screenshot({ path: `${clientRoot}/test-results/attention-mobile.png`, fullPage: true });
  await bobAttention.getByRole('link', { name: /Enter your share.*Weekend groceries/ }).click();
  await expect(bob).toHaveURL(billUrl);
  // The existing mobile layout hides avatars. Check another member's desktop view.
  await bob.setViewportSize({ width: 1280, height: 900 });
  const aliceAvatar = bob.locator('.bill-person').filter({ hasText: 'Alice' }).locator('.avatar');
  await expect(aliceAvatar.locator('img')).toBeVisible();
  assert.equal(await aliceAvatar.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  const bobAvatar = bob.locator('.bill-person').filter({ hasText: 'Bob' }).locator('.avatar');
  await expect(bobAvatar).toHaveText('B');
  await expect(bobAvatar).toHaveCSS('display', 'flex');
  await expect(bobAvatar).toHaveCSS('align-items', 'center');
  await expect(bobAvatar).toHaveCSS('justify-content', 'center');
  await bob.setViewportSize({ width: 390, height: 844 });
  await bob.getByLabel('My share · CAD', { exact: true }).fill('59.97');
  let shareAttempts = 0;
  await bob.route('**/api/bills/*/share', async route => {
    const response = await route.fetch();
    shareAttempts++;
    if (shareAttempts === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  const liveStarted = Date.now();
  await bob.getByRole('button', { name: 'Submit and confirm my share' }).click();
  await expect(carol.locator('.bill-list-row')).toContainText('Complete', { timeout: 3000 });
  await expect(carol.getByRole('region', { name: 'Group balances and repayment suggestions' })).toContainText('$59.97');
  console.log(`Live completion observed within ${Date.now() - liveStarted} ms of the submit click`);
  await expect(bob.getByRole('button', { name: 'Retry confirmation' })).toBeVisible();
  // The committed stream snapshot resolves the uncertain response without replaying the write.
  await expect(bob.locator('.share-form button[type=submit]')).toBeDisabled();
  await expect(bob.locator('.bill-status')).toContainText('COMPLETE');
  await expect(bob.locator('.difference-number')).toHaveText('$0.03');
  await expect(bob.locator('.bill-adjustment')).toContainText('$40.03 effective cost');

  await expect(alice.locator('.bill-status')).toContainText('COMPLETE');
  await carol.goto(billUrl);
  await expect(carol.getByText('Only its participants can submit shares.', { exact: false })).toBeVisible();
  await expect(carol.getByRole('button', { name: 'Submit and confirm my share' })).toHaveCount(0);
  await alice.screenshot({ path: `${clientRoot}/test-results/bills-desktop.png`, fullPage: true });
  await bob.screenshot({ path: `${clientRoot}/test-results/bills-mobile.png`, fullPage: true });
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.getByRole('link', { name: 'Group bills', exact: false }).click();
  await expect(alice.locator('.bill-list-row')).toHaveCount(1);
  await expect(alice.locator('.balance-number')).toHaveText('$59.97');
  await alice.getByRole('button', { name: 'My groups', exact: true }).click();
  await alice.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(alice.locator('.balance-number')).toHaveText('$59.97');
  // Group navigation opens finances directly and survives reloads.
  await alice.getByRole('button', { name: 'New group', exact: true }).first().click();
  await alice.getByLabel('Group name').fill('Apartment');
  await alice.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(alice.getByRole('dialog')).toContainText('Apartment');
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.getByRole('button', { name: 'My groups', exact: true }).click();
  await alice.getByRole('navigation', { name: 'Groups', exact: true }).getByRole('link', { name: /Apartment/ }).click();
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  await alice.getByRole('navigation', { name: 'Groups', exact: true }).getByRole('link', { name: /Costco friends/ }).click();
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await expect(alice.getByRole('navigation', { name: 'Groups', exact: true }).getByRole('link', { name: /Costco friends/ })).toContainText('You are owed $59.97');
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await checkNavigation(alice, pageFor);
  await alice.reload();
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  const selectedBillsPattern = '**/api/groups/' + alice.url().split('/').pop() + '/bills';
  await alice.route(selectedBillsPattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) }));
  await expect(alice.getByRole('button', { name: 'Refresh bills', exact: true })).toHaveCount(0);
  await alice.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(alice.getByRole('alert')).toHaveCount(0);
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await expect(alice.getByRole('navigation', { name: 'Groups', exact: true }).getByRole('link', { name: /Costco friends/ })).toContainText('You are owed $59.97');
  await alice.unroute(selectedBillsPattern);
  // The visible group recovers through automatic reconnection without a manual retry.
  await expect(alice.getByRole('alert')).toHaveCount(0, { timeout: 20_000 });
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$59.97', { timeout: 20_000 });
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await expect(alice.getByRole('navigation', { name: 'Groups', exact: true }).getByRole('link', { name: /Costco friends/ })).toContainText('You are owed $59.97');
  await alice.screenshot({ path: `${clientRoot}/test-results/workspace-desktop.png`, fullPage: true });
  await alice.setViewportSize({ width: 390, height: 844 });
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.screenshot({ path: `${clientRoot}/test-results/workspace-mobile.png`, fullPage: true });
  await alice.getByRole('button', { name: 'Members & invites', exact: true }).click();
  await expect(alice.getByRole('dialog')).toContainText('3 members');
  await alice.getByRole('button', { name: 'View bills and balance' }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await alice.setViewportSize({ width: 1280, height: 900 });
  await alice.goto(groupUrl);
  await bob.goto(groupUrl);
  await carol.goto(groupUrl);
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
  // Issue #5: completed bills are final; corrections start from incomplete bills.
  const bobAgain = await pageFor('bob-token', { width: 390, height: 844 });
  await alice.goto(billUrl);
  await expect(alice.getByText('Completed bills are final.', { exact: false })).toBeVisible();
  await expect(alice.locator('.bill-controls')).toHaveCount(0);
  await expect(alice.getByLabel('My share · CAD', { exact: true })).toHaveCount(0);
  async function incompleteBill(title) {
    await alice.getByRole('link', { name: 'Group bills', exact: false }).click();
    await alice.getByRole('button', { name: 'New bill', exact: true }).click();
    await alice.getByLabel('Bill title', { exact: true }).fill(title);
    await alice.getByLabel('Bill total · CAD', { exact: true }).fill('100.00');
    await alice.getByLabel('My share · CAD', { exact: true }).fill('40.00');
    await alice.getByRole('checkbox', { name: 'Bob', exact: true }).check();
    await alice.getByRole('button', { name: 'Create bill and confirm my share' }).click();
    await expect(alice.getByRole('heading', { name: title })).toBeVisible();
    await bobAgain.goto(alice.url());
    await bobAgain.getByLabel('My share · CAD', { exact: true }).fill('59.00');
    await bobAgain.getByRole('button', { name: 'Submit and confirm my share' }).click();
    await expect(bobAgain.locator('.difference-card')).toContainText('2/2 confirmed');

  }
  await incompleteBill('Correctable groceries');
  // Clear confirmations, then preserve Bob's draft while a new revision arrives.
  await alice.getByRole('button', { name: 'Edit details & participants' }).click();
  await alice.getByRole('dialog').getByLabel('Notes').fill('Initial correction');
  await alice.getByRole('button', { name: 'Save & request confirmations' }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await bobAgain.goto(base);
  await bobAgain.getByRole('region', { name: 'Needs your attention' }).getByRole('link', { name: /Confirm your share.*Correctable groceries/ }).click();
  await expect(bobAgain.getByRole('button', { name: 'Confirm my share', exact: true })).toBeVisible();
  await bobAgain.getByLabel('My share · CAD', { exact: true }).fill('60.00');
  await alice.getByRole('button', { name: 'Edit details & participants' }).click();
  await alice.getByRole('dialog').getByLabel('Notes').fill('Corrected purchase notes');
  await alice.getByRole('button', { name: 'Save & request confirmations' }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await expect(bobAgain.getByRole('alert')).toContainText('This bill changed');
  await expect(bobAgain.getByRole('button', { name: 'Save changed amount', exact: true })).toBeDisabled();
  await expect(bobAgain.getByLabel('My share · CAD', { exact: true })).toHaveValue('60.00');
  await bobAgain.getByRole('button', { name: 'Review latest bill' }).click();
  await expect(bobAgain.getByText('Corrected purchase notes', { exact: true })).toBeVisible();
  await bobAgain.getByLabel('My share · CAD', { exact: true }).fill('60.00');
  await bobAgain.getByRole('button', { name: 'Save changed amount' }).click();
  await expect(bobAgain.locator('.difference-card')).toContainText('0/2 confirmed');
  await bobAgain.getByRole('button', { name: 'Confirm my share', exact: true }).click();
  await expect(bobAgain.locator('.difference-card')).toContainText('1/2 confirmed');

  await alice.getByRole('button', { name: 'Review latest bill' }).click();
  await alice.getByRole('button', { name: 'Confirm my share', exact: true }).click();
  await expect(alice.locator('.bill-status')).toContainText('COMPLETE');
  await alice.screenshot({ path: `${clientRoot}/test-results/bill-corrected-desktop.png`, fullPage: true });
  await expect(alice.locator('.bill-controls')).toHaveCount(0);
  await incompleteBill('Canceled groceries');
  await alice.getByRole('button', { name: 'Edit details & participants' }).click();
  await expect(alice.getByRole('dialog').getByRole('checkbox', { name: /Alice/ })).toBeDisabled();
  await alice.getByRole('dialog').getByRole('checkbox', { name: 'Bob', exact: true }).uncheck();
  await alice.getByRole('button', { name: 'Save & request confirmations' }).click();
  await expect(alice.locator('.difference-card')).toContainText('0/1 confirmed');
  await bobAgain.reload();
  await expect(bobAgain.getByText('Only its participants can submit shares.', { exact: false })).toBeVisible();
  await expect(bobAgain.getByLabel('My share · CAD', { exact: true })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Cancel this bill', exact: true }).click();
  await alice.getByRole('button', { name: 'Yes, cancel bill' }).click();
  await expect(alice.locator('.bill-status')).toHaveText('CANCELED');
  await bobAgain.reload();
  await expect(bobAgain.locator('.bill-status')).toHaveText('CANCELED');
  assert.equal(await bobAgain.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await bobAgain.screenshot({ path: `${clientRoot}/test-results/bill-canceled-mobile.png`, fullPage: true });
  await alice.getByRole('link', { name: 'Group bills', exact: false }).click();
  await expect(alice.locator('.bill-list-row').filter({ hasText: 'Canceled groceries' })).toContainText('Canceled');
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$119.97');
  // Issue #6: balances, minimum suggestions, live membership updates, and capacity errors.
  const ledger = alice.getByRole('region', { name: 'Group balances and repayment suggestions' });
  await expect(ledger).toContainText('Bob → Alice');
  await expect(ledger).toContainText('$119.97');
  await expect(ledger).toContainText('Carol');
  await expect(ledger).toContainText('$0.00');
  await alice.setViewportSize({ width: 390, height: 844 });
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.screenshot({ path: `${clientRoot}/test-results/ledger-mobile.png`, fullPage: true });
  await alice.setViewportSize({ width: 1280, height: 900 });
  await alice.screenshot({ path: `${clientRoot}/test-results/ledger-desktop.png`, fullPage: true });
  // Issue #7: record through the UI, lose the response, reload and retry once.
  const ledgerUrl = alice.url();
  await bobAgain.goto(ledgerUrl);
  let repaymentAttempts = 0;
  await bobAgain.route('**/api/groups/*/repayments', async route => {
    const response = await route.fetch();
    repaymentAttempts++;
    if (repaymentAttempts === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await bobAgain.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await bobAgain.getByLabel('Recipient', { exact: true }).selectOption({ label: 'Alice' });
  await bobAgain.getByLabel('Amount sent · CAD').fill('20.001');
  await bobAgain.getByRole('button', { name: 'Record transfer', exact: true }).click();
  await expect(bobAgain.getByRole('alert')).toContainText('at most two decimal');
  await bobAgain.getByLabel('Amount sent · CAD').fill('20.00');
  await bobAgain.getByRole('button', { name: 'Record transfer', exact: true }).click();
  await expect(bobAgain.getByRole('button', { name: 'Retry recording' })).toBeVisible();
  await bobAgain.reload();
  await bobAgain.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await expect(bobAgain.getByLabel('Amount sent · CAD')).toHaveValue('20.00');
  await expect(bobAgain.getByLabel('Amount sent · CAD')).toBeDisabled();
  await bobAgain.getByRole('button', { name: 'Retry recording' }).click();
  await expect(bobAgain.getByRole('dialog')).toHaveCount(0);
  assert.equal(repaymentAttempts, 2);
  await expect(bobAgain.locator('.repayment-list li')).toHaveCount(1);
  await expect(bobAgain.getByRole('button', { name: 'Review repayment' })).toHaveCount(0);
  await expect(alice.locator('.repayment-list')).toContainText('Pending');
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$119.97');
  await alice.getByRole('button', { name: 'Review repayment' }).click();
  await expect(alice.getByRole('dialog')).toContainText('Bob');
  await expect(alice.getByRole('dialog')).toContainText('$20.00');
  let decisionAttempts = 0;
  await alice.route('**/api/repayments/*/decision', async route => {
    const response = await route.fetch();
    decisionAttempts++;
    if (decisionAttempts === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await alice.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(alice.getByRole('dialog').getByRole('alert')).toBeVisible();
  await expect(alice.getByRole('dialog')).toContainText('already confirmed');
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$99.97');
  await expect(alice.locator('.repayment-list')).toContainText('Confirmed');
  await expect(bobAgain.locator('.workspace-content .balance-number')).toHaveText('$99.97');
  await expect(bobAgain.locator('.repayment-list')).toContainText('Confirmed');
  await expect(bobAgain.getByRole('region', { name: 'Group balances and repayment suggestions' })).toContainText('$99.97');
  await expect(bobAgain.getByRole('navigation', { name: 'Groups', exact: true }).getByRole('link', { name: /Costco friends/ })).toContainText('You owe $99.97');
  await bobAgain.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await bobAgain.getByLabel('Recipient', { exact: true }).selectOption({ label: 'Alice' });
  await bobAgain.getByLabel('Amount sent · CAD').fill('5.00');
  await bobAgain.getByRole('button', { name: 'Record transfer', exact: true }).click();
  await expect(bobAgain.getByRole('dialog')).toHaveCount(0);
  await alice.getByRole('button', { name: 'Review repayment' }).click();
  await alice.getByRole('button', { name: 'Reject record' }).click();
  await expect(alice.locator('.repayment-list')).toContainText('Rejected');
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$99.97');
  await bobAgain.reload();
  assert.equal(await bobAgain.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await bobAgain.screenshot({ path: `${clientRoot}/test-results/repayments-mobile.png`, fullPage: true });
  // A new bill remains available after repayment decisions. It completes immediately.
  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  await alice.getByLabel('Bill title', { exact: true }).fill('After repayment');
  await alice.getByLabel('Bill total · CAD', { exact: true }).fill('10.00');
  await alice.getByLabel('My share · CAD', { exact: true }).fill('10.00');
  await alice.getByRole('button', { name: 'Create bill and confirm my share' }).click();
  await expect(alice.locator('.bill-status')).toContainText('COMPLETE');
  await alice.getByRole('link', { name: 'Group bills', exact: false }).click();
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$99.97');
  await expect(alice.locator('.bill-list-row').filter({ hasText: 'Weekend groceries' })).toContainText('Complete');
  const invitationToken = newLink.split('/').pop();
  for (let i = 1; i <= 13; i++) {
    const response = await fetch(`http://127.0.0.1:${port}/api/groups/join`, {
      method: 'POST', headers: { Authorization: `Bearer member-${i}-token`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invitationToken }),
    });
    assert.equal(response.status, 200);
  }
  const extra = await pageFor('member-14-token', { width: 390, height: 844 });
  await extra.goto(newLink);
  await extra.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(extra.getByRole('alert')).toContainText('This group is full. Groups can have up to 16 members.');
  await expect(ledger.locator('.ledger-rows').first().locator('li')).toHaveCount(16);
  // Live drafts remain mounted through progress updates and terminal changes.
  const liveGroupId = ledgerUrl.split('/').pop();
  async function liveApi(path, token, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  const liveGroup = (await liveApi(`/groups/${liveGroupId}`, 'alice-token')).group;
  const liveIds = Object.fromEntries(liveGroup.members.map(member => [member.displayName, member.id]));
  const { bill: liveBill } = await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), title: 'Live draft protection', purchaseDate: '2026-01-01',
    timeZone: 'America/Toronto', notes: '', totalCents: 10000, ownShareCents: 4000,
    participantIds: [liveIds.Alice, liveIds.Bob, liveIds.Carol],
  });
  await alice.goto(`${base}#/bills/${liveBill.id}`);
  await alice.getByRole('button', { name: 'Edit details & participants' }).click();
  await alice.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Keep this unsent title');
  await liveApi(`/bills/${liveBill.id}/share`, 'bob-token', 'POST', { revision: 1, expectedAmountCents: null, amountCents: 6000 });
  await expect(alice.locator('.difference-card')).toContainText('2/3 confirmed');
  await expect(alice.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue('Keep this unsent title');
  await expect(alice.getByRole('button', { name: 'Save & request confirmations' })).toBeEnabled();
  await liveApi(`/bills/${liveBill.id}/share`, 'carol-token', 'POST', { revision: 1, expectedAmountCents: null, amountCents: 0 });
  await expect(alice.getByRole('dialog')).toContainText('This bill is complete. Your draft is retained');
  await expect(alice.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue('Keep this unsent title');
  await expect(alice.getByRole('button', { name: 'Save & request confirmations' })).toBeDisabled();
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.goto(ledgerUrl);
  const liveView = await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token');
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText(`$${(liveView.summary.netCents / 100).toFixed(2)}`);
  assert.equal(await alice.locator('[data-animating]').count(), 0, 'First load displays real amounts');
  await alice.emulateMedia({ reducedMotion: 'reduce' });
  const { repayment: reverse } = await liveApi(`/groups/${liveGroupId}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Alice, amountCents: liveView.summary.netCents + 1000,
  });
  await liveApi(`/repayments/${reverse.id}/decision`, 'alice-token', 'POST', { decision: 'confirmed' });
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$10.00');
  await expect(alice.locator('.balance-card h2')).toHaveText('You owe, net');
  assert.equal(await alice.locator('[data-animating]').count(), 0, 'Reduced motion skips rolling amounts');
  await alice.emulateMedia({ reducedMotion: 'no-preference' });
  const { repayment: zero } = await liveApi(`/groups/${liveGroupId}/repayments`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Bob, amountCents: 1000,
  });
  await liveApi(`/repayments/${zero.id}/decision`, 'bob-token', 'POST', { decision: 'confirmed' });
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  await expect(alice.getByRole('region', { name: 'Group balances and repayment suggestions' })).toContainText('No repayments needed.');
  await expect(alice.locator('[data-animating]')).toHaveCount(0);
  // Attention refresh, direct repayment review, stale links, and account isolation.
  await alice.goto(base);
  const attention = alice.getByRole('region', { name: 'Needs your attention' });
  await expect(attention).toContainText('No actions waiting for you.');
  const { repayment: incoming } = await liveApi(`/groups/${liveGroupId}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Alice, amountCents: 321,
  });
  await attention.getByRole('button', { name: 'Refresh actions' }).click();
  const incomingLink = attention.getByRole('link', { name: /Review incoming transfer.*From Bob/ });
  await expect(incomingLink).toContainText('$3.21');
  const incomingHref = await incomingLink.getAttribute('href');
  await alice.route('**/api/attention', route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
  await attention.getByRole('button', { name: 'Refresh actions' }).click();
  await expect(attention.getByRole('alert')).toContainText('Could not load your actions');
  await expect(incomingLink).toHaveCount(0);
  await alice.unroute('**/api/attention');
  await attention.getByRole('button', { name: 'Refresh actions' }).click();
  await incomingLink.click();
  await expect(alice.getByRole('dialog', { name: 'Review repayment' })).toContainText('$3.21');
  await alice.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await alice.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(attention).toContainText('No actions waiting for you.');
  await alice.goto(`${base}${incomingHref}`);
  await expect(alice.getByRole('dialog')).toContainText('already confirmed');
  await expect(alice.getByRole('button', { name: 'Confirm receipt', exact: true })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  const { repayment: rejected } = await liveApi(`/groups/${liveGroupId}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Alice, amountCents: 123,
  });
  await alice.getByRole('button', { name: 'Overview', exact: true }).click();
  await incomingLink.click();
  await alice.getByRole('button', { name: 'Reject record', exact: true }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await alice.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(attention).toContainText('No actions waiting for you.');
  assert.equal((await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token')).repayments.find(r => r.id === rejected.id).status, 'rejected');
  assert.equal((await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token')).repayments.find(r => r.id === incoming.id).status, 'confirmed');
  await liveApi(`/groups/${liveGroupId}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Alice, amountCents: 456,
  });
  await attention.getByRole('button', { name: 'Refresh actions' }).click();
  await expect(incomingLink).toContainText('$4.56');
  await alice.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(alice.getByRole('region', { name: 'Needs your attention' })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Sign in', exact: true }).click(); // Bob in the test boundary.
  await expect(alice.getByRole('region', { name: 'Needs your attention' })).toContainText('No actions waiting for you.');
  console.log('Attention smoke passed: mobile missing shares, reconfirmation links, refresh recovery, receipt decisions, stale links, and account isolation.');
  assert.deepEqual(errors, []);
  console.log('Group and bill browser smoke passed: creation, Unicode icon, persistence, sign-in return, membership, invitation permissions, rotation, invalid links, repeat joining, mobile layout, sign-out, bill creation and confirmation, response-loss retries, initiator adjustment, balances, completed-bill finality, stale confirmation, correction, reconfirmation, removal, and cancellation.');
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
