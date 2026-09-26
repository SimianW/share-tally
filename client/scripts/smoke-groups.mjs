import { checkGroupRefresh } from './smoke-group-refresh.mjs';
import { checkNavigation, homeRow, homeGroupNames, openGroupSwitcher, switchGroup } from './smoke-navigation.mjs';
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
// Screenshots Home on desktop and at 390px, where nothing may overflow sideways.
async function checkHomeLayout(page, label) {
  const viewport = page.viewportSize();
  await page.screenshot({ path: `${clientRoot}/test-results/home-${label}-desktop.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} Home overflows at 390px`);
  await page.screenshot({ path: `${clientRoot}/test-results/home-${label}-mobile.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize(viewport);
}
const errors = [];
const networkChangeFailures = new Map();
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
    page.on('requestfailed', request => {
      if (request.failure()?.errorText !== 'net::ERR_NETWORK_CHANGED') return;
      // Report resource paths only, never authorization headers or query strings.
      const resource = `${request.resourceType()} ${new URL(request.url()).pathname}`;
      networkChangeFailures.set(resource, (networkChangeFailures.get(resource) ?? 0) + 1);
    });
    page.on('console', message => { if (message.text().includes('net::ERR_NETWORK_CHANGED')) return; if (message.type() === 'error') { console.error('Browser console:', message.text()); if (message.text().includes('Encountered two children')) errors.push(message.text()); } });
    return page;
  }
  // Set GROUP_DELETE_ONLY=1 to skip unrelated bill workflows and run this scenario alone.
  if (process.env.GROUP_DELETE_ONLY !== '1') {
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
  const copiedNotice = alice.getByRole('status').filter({ hasText: 'Invitation link copied.' });
  await expect(copiedNotice).toBeVisible();
  await copiedNotice.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(copiedNotice).toHaveCount(0);
  await alice.getByRole('button', { name: 'Copy invitation link' }).click();
  await expect(copiedNotice).toBeVisible();
  const groupUrl = alice.url();

  // A signed-out mobile visitor keeps the invitation across the sign-in boundary.
  const bob = await pageFor(null, { width: 390, height: 844 });
  await bob.goto(oldLink);
  await expect(bob.getByText('Sign in to accept your group invitation.')).toBeVisible();
  await bob.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(bob.getByRole('dialog')).toContainText('Join your friends');
  await bob.getByRole('button', { name: 'Join group', exact: true }).click();
  // Accepting an invitation lands on the joined group's page.
  await expect(bob).toHaveURL(/#\/group-bills\//);
  await expect(bob.getByRole('dialog')).toHaveCount(0);
  await expect(bob.locator('#main-content').getByRole('heading', { name: 'Costco friends' })).toBeVisible();
  await expect(bob.locator('.group-member-count')).toContainText('2 members');
  await bob.getByRole('button', { name: 'Members & invites', exact: true }).click();
  await expect(bob.getByRole('dialog')).toContainText('Bob · You');
  await expect(bob.getByRole('button', { name: 'Get invitation link' })).toHaveCount(0);
  await bob.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await bob.reload();
  await expect(bob.locator('.group-member-count')).toContainText('2 members');
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await bob.goto(oldLink);
  await bob.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(bob).toHaveURL(/#\/group-bills\//);
  await expect(bob.locator('.group-member-count')).toContainText('2 members');

  await alice.getByRole('button', { name: 'Refresh members' }).click();
  await expect(alice.getByRole('dialog')).toContainText('Bob');
  await alice.getByRole('button', { name: 'Regenerate link', exact: true }).click();
  await alice.getByRole('button', { name: 'Replace link', exact: true }).click();
  await expect(alice.getByLabel('Invitation link', { exact: true })).not.toHaveValue(oldLink);
  const newLink = await alice.getByLabel('Invitation link', { exact: true }).inputValue();

  const carol = await pageFor('carol-token', { width: 1280, height: 900 });
  await carol.goto(groupUrl);
  await expect(carol.getByRole('alert')).toContainText('Group not found.');
  await carol.goto(oldLink);
  await carol.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(carol.getByRole('alert')).toContainText('invalid or has been replaced');
  await carol.goto(newLink);
  await carol.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(carol).toHaveURL(/#\/group-bills\//);
  await expect(carol.locator('.group-member-count')).toContainText('3 members');
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
  // The new-bill page reads its group before showing either the receipt step or the people step.
  const splitByAmounts = alice.getByRole('button', { name: 'Split by amounts instead', exact: true });
  const people = alice.getByRole('group', { name: 'Who shared this purchase?' });
  await expect(splitByAmounts.or(people).first()).toBeVisible();
  if (await splitByAmounts.count()) await splitByAmounts.click();
  await expect(people).toBeVisible();
  await expect(alice.getByRole('checkbox', { name: 'Alice · You, initiator' })).toBeDisabled();
  await alice.getByRole('button', { name: 'Select everyone', exact: true }).click();
  await expect(alice.getByRole('checkbox', { name: 'Carol', exact: true })).toBeChecked();
  await alice.getByRole('button', { name: 'Just me', exact: true }).click();
  await expect(alice.getByRole('checkbox', { name: 'Carol', exact: true })).not.toBeChecked();
  await alice.getByLabel('Bill title', { exact: true }).fill('Weekend groceries');
  await alice.getByLabel('Actual paid total · CAD', { exact: true }).fill('100.00');
  await alice.getByLabel('Actual paid total · CAD', { exact: true }).fill('100.001');
  await alice.getByLabel('My share · CAD', { exact: true }).fill('40.00');
  await alice.getByRole('checkbox', { name: 'Bob', exact: true }).check();
  await alice.getByRole('button', { name: 'Initiate bill' }).click();
  assert.equal(await alice.getByLabel('Actual paid total · CAD', { exact: true }).evaluate(el => el.validity.valid), false);
  await alice.getByLabel('Actual paid total · CAD', { exact: true }).fill('100.00');
  let creationAttempts = 0;
  await alice.route('**/api/receipt-drafts/*/initialize', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    creationAttempts++;
    if (creationAttempts === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await alice.getByRole('button', { name: 'Initiate bill' }).click();
  await expect(alice.getByRole('button', { name: 'Retry initiation' })).toBeVisible();
  releaseSnapshot();
  await expect(carol.locator('.bill-list-row')).toContainText('Weekend groceries', { timeout: 3000 });
  await alice.reload();
  // The new-bill page is its own route, so a reload restores the unsent bill in place.
  await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Weekend groceries');
  await alice.getByRole('button', { name: 'Retry initiation' }).click();
  await expect(alice.getByRole('heading', { name: 'Weekend groceries' })).toBeVisible();
  assert.equal(creationAttempts, 2);
  await expect(alice.locator('.difference-number')).toHaveText('$60.00');
  await expect(alice.locator('.difference-card')).toContainText('1/2 confirmed');
  const billUrl = alice.url();
  await bob.goto(base);
  const bobAttention = bob.getByRole('region', { name: 'Needs your attention' });
  await expect(bobAttention.getByRole('link', { name: /Enter your share.*Weekend groceries/ })).toBeVisible();
  // A member with one group still lands on Home, and the heading counts the same actions as the list.
  await expect(bob).toHaveURL(base);
  assert.deepEqual(await homeGroupNames(bob), ['Costco friends']);
  await expect(homeRow(bob, 'Costco friends')).toContainText('All square Settled');
  await expect(homeRow(bob, 'Costco friends')).toContainText('1 to do');
  await bob.screenshot({ path: `${clientRoot}/test-results/home-pending-mobile.png`, fullPage: true, animations: 'disabled' });
  await bob.setViewportSize({ width: 1280, height: 900 });
  await bob.screenshot({ path: `${clientRoot}/test-results/home-pending-desktop.png`, fullPage: true, animations: 'disabled' });
  await bob.setViewportSize({ width: 390, height: 844 });
  await homeRow(bob, 'Costco friends').click();
  const pendingOptions = await openGroupSwitcher(bob);
  const singularBadge = pendingOptions.getByRole('option', { name: /Costco friends.*1 pending action/ }).locator('.group-switcher-count');
  await expect(singularBadge).toHaveText('1 pending action');
  await expect(singularBadge).not.toHaveAttribute('aria-label', /pending action/);
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Pending dropdown overflows at 390px');
  await bob.screenshot({ path: `${clientRoot}/test-results/group-switcher-pending-mobile.png`, animations: 'disabled' });
  await bob.setViewportSize({ width: 1280, height: 900 });
  await bob.screenshot({ path: `${clientRoot}/test-results/group-switcher-pending-desktop.png`, animations: 'disabled' });
  await bob.setViewportSize({ width: 390, height: 844 });
  await bob.goto(base);
  await expect(bob.getByRole('heading', { level: 1 })).toHaveText('Hey Bob, 1 thing needs you');
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
  const aliceGroupBalance = await alice.locator('.balance-number').innerText();
  await alice.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  // Home's row shows the group page's number; there is no cross-group balance.
  await expect(homeRow(alice, 'Costco friends')).toContainText(`You're owed ${aliceGroupBalance}`);
  await expect(homeRow(alice, 'Costco friends')).toContainText('Nothing to do');
  await expect(alice.locator('.balance-card')).toHaveCount(0);
  await expect(alice.getByText(/ACROSS YOUR GROUPS|, net/)).toHaveCount(0);
  await bob.goto(base);
  await expect(homeRow(bob, 'Costco friends')).toContainText(`You owe ${aliceGroupBalance}`);
  await expect(homeRow(bob, 'Costco friends')).toContainText('Nothing to do');
  // Group navigation opens finances directly and survives reloads.
  await alice.getByRole('button', { name: 'New group', exact: true }).first().click();
  await alice.getByLabel('Group name').fill('Apartment');
  await alice.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(alice.getByRole('dialog')).toContainText('Apartment');
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await expect(alice.locator('#main-content').getByRole('heading', { name: 'Apartment' })).toBeVisible();
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  await switchGroup(alice, 'Costco friends');
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$59.97');
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
  await alice.unroute(selectedBillsPattern);
  // The visible group recovers through automatic reconnection without a manual retry.
  await expect(alice.getByRole('alert')).toHaveCount(0, { timeout: 20_000 });
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$59.97', { timeout: 20_000 });
  await expect(alice.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await alice.screenshot({ path: `${clientRoot}/test-results/workspace-desktop.png`, fullPage: true });
  await alice.setViewportSize({ width: 390, height: 844 });
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.screenshot({ path: `${clientRoot}/test-results/workspace-mobile.png`, fullPage: true });
  await alice.getByRole('button', { name: 'Members & invites', exact: true }).click();
  await expect(alice.getByRole('dialog')).toContainText('3 members');
  await expect(alice.getByRole('button', { name: 'View bills and balance' })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await alice.setViewportSize({ width: 1280, height: 900 });
  await alice.goto(groupUrl);
  await bob.goto(groupUrl);
  await carol.goto(groupUrl);
  await bob.reload();
  await expect(bob.getByRole('dialog')).toContainText('3 members');
  await bob.getByRole('button', { name: 'Close dialog' }).click();
  await bob.getByRole('button', { name: 'Account menu', exact: true }).click();
  await bob.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
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
  await alice.getByRole('button', { name: 'Split by amounts instead', exact: true }).click();
    await alice.getByLabel('Bill title', { exact: true }).fill(title);
    await alice.getByLabel('Actual paid total · CAD', { exact: true }).fill('100.00');
    await alice.getByLabel('My share · CAD', { exact: true }).fill('40.00');
    await alice.getByRole('checkbox', { name: 'Bob', exact: true }).check();
    await alice.getByRole('button', { name: 'Initiate bill' }).click();
    await expect(alice.getByRole('heading', { name: title })).toBeVisible();
    await bobAgain.goto(alice.url());
    await bobAgain.getByLabel('My share · CAD', { exact: true }).fill('59.00');
    await bobAgain.getByRole('button', { name: 'Submit and confirm my share' }).click();
    await expect(bobAgain.locator('.difference-card')).toContainText('2/2 confirmed');
    const correction = bobAgain.getByRole('alert').filter({ hasText: 'Shares are $1.00 under the total' });
    await expect(correction).toBeVisible();
    await expect(correction).toContainText('within $0.05');
    await expect(correction.getByRole('button', { name: 'Dismiss notification' })).toHaveCount(0);
    await correction.getByRole('button', { name: 'Edit my share' }).click();
    await expect(bobAgain.getByLabel('My share · CAD', { exact: true })).toBeFocused();

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
  await expect(bobAgain.getByRole('alert').filter({ hasText: 'This bill changed' })).toBeVisible();
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
  await alice.getByRole('button', { name: 'Split by amounts instead', exact: true }).click();
  await alice.getByLabel('Bill title', { exact: true }).fill('After repayment');
  await alice.getByLabel('Actual paid total · CAD', { exact: true }).fill('10.00');
  await alice.getByLabel('My share · CAD', { exact: true }).fill('10.00');
  await alice.getByRole('button', { name: 'Initiate bill' }).click();
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
  // Even an overage within tolerance cannot make the initiator's cost negative.
  const { bill: negativeAdjustment } = await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), title: 'Small overage', purchaseDate: '2026-01-01',
    timeZone: 'America/Toronto', notes: '', totalCents: 10000, ownShareCents: 0,
    participantIds: [liveIds.Alice, liveIds.Bob, liveIds.Carol],
  });
  await liveApi(`/bills/${negativeAdjustment.id}/share`, 'bob-token', 'POST', { revision: 1, expectedAmountCents: null, amountCents: 5000 });
  await carol.goto(`${base}#/bills/${negativeAdjustment.id}`);
  await carol.getByLabel('My share · CAD', { exact: true }).fill('50.03');
  await carol.getByRole('button', { name: 'Submit and confirm my share' }).click();
  await expect(carol.locator('.difference-card')).toContainText('3/3 confirmed');
  const negativeWarning = carol.getByRole('alert').filter({ hasText: 'Shares are $0.03 over the total' });
  await expect(negativeWarning).toBeVisible();
  await expect(negativeWarning).toContainText('below $0.00');
  await expect(carol.locator('.notification-success')).toHaveCount(0);
  await expect(negativeWarning.getByRole('button', { name: 'Dismiss notification' })).toHaveCount(0);
  await negativeWarning.getByRole('button', { name: 'Edit my share' }).click();
  await expect(carol.getByLabel('My share · CAD', { exact: true })).toBeFocused();
  // Cancel the fixture so it does not affect subsequent attention checks.
  await liveApi(`/bills/${negativeAdjustment.id}/cancel`, 'alice-token', 'POST', { revision: 1 });
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
  await expect(attention).toHaveCount(0);
  const { repayment: incoming } = await liveApi(`/groups/${liveGroupId}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Alice, amountCents: 321,
  });
  await alice.evaluate(() => window.dispatchEvent(new Event('focus')));
  const incomingLink = attention.getByRole('link', { name: /Review incoming transfer.*From Bob/ });
  await expect(incomingLink).toContainText('$3.21');
  const aliceHeading = alice.getByRole('heading', { level: 1 });
  await expect(aliceHeading).toHaveText('Hey Alice, 1 thing needs you');
  await expect(alice.locator('.home-actions-announcement')).toHaveText('1 thing needs you');
  await expect(attention.locator('.attention-list > li')).toHaveCount(1);
  await expect(homeRow(alice, 'Costco friends')).toContainText('1 to do');
  await checkHomeLayout(alice, 'busy');
  const { repayment: secondIncoming } = await liveApi(`/groups/${liveGroupId}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Alice, amountCents: 100,
  });
  await alice.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(attention.locator('.attention-list > li')).toHaveCount(2);
  await expect(homeRow(alice, 'Costco friends')).toContainText('2 to do');
  await expect(alice.locator('.home-actions-announcement')).toHaveText('2 things need you');
  await homeRow(alice, 'Costco friends').click();
  const twoActions = await openGroupSwitcher(alice);
  const pluralBadge = twoActions.getByRole('option', { name: /Costco friends.*2 pending actions/ }).locator('.group-switcher-count');
  await expect(pluralBadge).toHaveText('2 pending actions');
  await expect(pluralBadge).not.toHaveAttribute('aria-label', /pending actions/);
  await expect(alice.locator('.home-actions-announcement')).toHaveCount(0);
  await liveApi(`/repayments/${secondIncoming.id}/decision`, 'alice-token', 'POST', { decision: 'rejected' });
  await alice.goto(base);
  await expect(attention.locator('.attention-list > li')).toHaveCount(1);
  await expect(homeRow(alice, 'Costco friends')).toContainText('1 to do');
  await expect(alice.locator('.home-actions-announcement')).toHaveText('1 thing needs you');
  const incomingHref = await incomingLink.getAttribute('href');
  await alice.route('**/api/attention', route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
  await attention.getByRole('button', { name: 'Refresh actions' }).click();
  await expect(attention.getByRole('alert')).toContainText('Could not load your actions');
  await expect(homeRow(alice, 'Costco friends').locator('.home-group-pending')).toHaveCount(0);
  await expect(incomingLink).toHaveCount(0);
  // Unknown actions never read as caught up.
  await expect(aliceHeading).toHaveText('Hey Alice');
  await alice.unroute('**/api/attention');
  await attention.getByRole('button', { name: 'Refresh actions' }).click();
  await incomingLink.click();
  await expect(alice.getByRole('dialog', { name: 'Review repayment' })).toContainText('$3.21');
  await alice.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  // While the actions load, the heading shows a placeholder and never the caught-up message.
  let releaseAttention;
  const attentionHeld = new Promise(resolve => { releaseAttention = resolve; });
  await alice.route('**/api/attention', async route => { await attentionHeld; await route.continue(); });
  await alice.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  await expect(aliceHeading.getByRole('status')).toBeVisible();
  await expect(aliceHeading).toHaveText('Hey Alice, checking what needs you');
  await expect(alice.locator('.home-actions-announcement')).toBeEmpty();
  await expect(alice.locator('.home-actions-announcement')).toHaveAttribute('aria-busy', 'true');
  await expect(attention.getByRole('status', { name: 'Checking your actions' })).toBeVisible();
  releaseAttention();
  await alice.unroute('**/api/attention');
  await expect(aliceHeading).toHaveText("Hey Alice, you're all caught up");
  await expect(attention).toHaveCount(0);
  await expect(homeRow(alice, 'Costco friends')).toContainText('Nothing to do');
  await checkHomeLayout(alice, 'caught-up');
  await alice.goto(`${base}${incomingHref}`);
  await expect(alice.getByRole('dialog')).toContainText('already confirmed');
  await expect(alice.getByRole('button', { name: 'Confirm receipt', exact: true })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  const { repayment: rejected } = await liveApi(`/groups/${liveGroupId}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Alice, amountCents: 123,
  });
  await alice.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  await incomingLink.click();
  await alice.getByRole('button', { name: 'Reject record', exact: true }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await alice.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  await expect(alice.getByRole('heading', { name: /Hey Alice/ })).toBeVisible();
  await expect(attention).toHaveCount(0);
  assert.equal((await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token')).repayments.find(r => r.id === rejected.id).status, 'rejected');
  assert.equal((await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token')).repayments.find(r => r.id === incoming.id).status, 'confirmed');
  await liveApi(`/groups/${liveGroupId}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Alice, amountCents: 456,
  });
  await alice.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(incomingLink).toContainText('$4.56');
  await alice.getByRole('button', { name: 'Account menu', exact: true }).click();
  await alice.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(alice.getByRole('region', { name: 'Needs your attention' })).toHaveCount(0);
  const signedInBobAttention = alice.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/attention' && response.ok());
  await alice.getByRole('button', { name: 'Sign in', exact: true }).click(); // Bob in the test boundary.
  await expect(alice.getByRole('heading', { name: /Hey Bob/ })).toBeVisible();
  await signedInBobAttention;
  await expect(alice.getByRole('region', { name: 'Needs your attention' })).toHaveCount(0);
  console.log('Attention smoke passed: mobile missing shares, reconfirmation links, refresh recovery, receipt decisions, stale links, and account isolation.');
  }
  // Issue #76: creator-only deletion of a cleared group uses its own fixture.
  const deleteOwner = await pageFor('alice-token', { width: 1280, height: 900 });
  await deleteOwner.goto(base);
  await deleteOwner.getByRole('button', { name: 'New group', exact: true }).first().click();
  await deleteOwner.getByLabel('Group name').fill('Deletion smoke group');
  await deleteOwner.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(deleteOwner.getByRole('dialog')).toContainText('Deletion smoke group');
  await deleteOwner.getByRole('button', { name: 'Get invitation link', exact: true }).click();
  const deleteInvite = await deleteOwner.getByLabel('Invitation link', { exact: true }).inputValue();
  const deleteMember = await pageFor('bob-token', { width: 1280, height: 900 });
  await deleteMember.goto(deleteInvite);
  await deleteMember.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(deleteMember).toHaveURL(/#\/group-bills\//);
  await expect(deleteMember.getByRole('button', { name: 'Delete group', exact: true })).toHaveCount(0);
  // The populated workspace confirms Bob's group stream has delivered its ready snapshot.
  await expect(deleteMember.locator('#main-content').getByRole('heading', { name: 'Deletion smoke group' })).toBeVisible();
  await deleteOwner.getByRole('button', { name: 'Delete group', exact: true }).click();
  const deleteDialog = deleteOwner.getByRole('dialog', { name: 'Delete Deletion smoke group?' });
  await expect(deleteDialog.getByRole('textbox')).toBeVisible();
  const deletionId = (await pool.query('SELECT id FROM groups WHERE name = $1', ['Deletion smoke group'])).rows[0].id;
  const deleteMembers = (await pool.query('SELECT user_id FROM group_members WHERE group_id = $1', [deletionId])).rows.map(row => row.user_id);
  const blockedBill = await fetch(`http://127.0.0.1:${port}/api/groups/${deletionId}/bills`, {
    method: 'POST', headers: { Authorization: 'Bearer alice-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), title: 'Not settled', purchaseDate: '2026-01-01',
      timeZone: 'America/Toronto', notes: '', totalCents: 100, ownShareCents: 40,
      participantIds: deleteMembers }),
  });
  assert.equal(blockedBill.status, 201, await blockedBill.clone().text());
  const bill = (await blockedBill.json()).bill;
  // The previously eligible dialog must also handle a bill added before DELETE.
  await deleteDialog.getByRole('textbox').fill('Deletion smoke group');
  await deleteDialog.getByRole('button', { name: 'Delete group', exact: true }).click();
  await expect(deleteDialog).toContainText('1 incomplete bill');
  await expect(deleteDialog.getByRole('textbox')).toHaveCount(0);
  // Opening again performs a new eligibility read before offering confirmation.
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await deleteOwner.getByRole('button', { name: 'Delete group', exact: true }).click();
  await expect(deleteDialog).toContainText('1 incomplete bill');
  await expect(deleteDialog.getByRole('textbox')).toHaveCount(0);
  const canceled = await fetch(`http://127.0.0.1:${port}/api/bills/${bill.id}/cancel`, {
    method: 'POST', headers: { Authorization: 'Bearer alice-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: bill.revision }),
  });
  assert.equal(canceled.status, 200, await canceled.clone().text());
  await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await deleteOwner.getByRole('button', { name: 'Delete group', exact: true }).click();
  const deleteInput = deleteDialog.getByRole('textbox');
  const deleteButton = deleteDialog.getByRole('button', { name: 'Delete group', exact: true });
  await expect(deleteButton).toBeDisabled();
  await deleteInput.fill('Wrong group name');
  await expect(deleteButton).toBeDisabled();
  await deleteInput.fill('Deletion smoke group');
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  // Both the creator and a member viewing the group return to Home.
  await expect(deleteOwner).toHaveURL(`${base}#`);
  await expect(deleteOwner.getByRole('heading', { name: 'Your groups' })).toBeVisible();
  await expect(homeRow(deleteOwner, 'Deletion smoke group')).toHaveCount(0);
  await expect(deleteMember).toHaveURL(`${base}#`);
  await expect(deleteMember.getByRole('heading', { name: 'Your groups' })).toBeVisible();
  await expect(homeRow(deleteMember, 'Deletion smoke group')).toHaveCount(0);
  await expect(deleteMember.getByRole('status').filter({ hasText: 'Deletion smoke group was deleted by the group creator' })).toBeVisible();
  await expect(deleteOwner.getByText('Deletion smoke group was deleted by the group creator')).toHaveCount(0);
  console.log('Delete group smoke passed: creator-only action, eligibility read, 409 race reasons, exact-name confirmation, and live member navigation with a deletion notice.');
  assert.deepEqual(errors, []);
  if (process.env.GROUP_DELETE_ONLY !== '1')
    console.log('Group and bill browser smoke passed: creation, Unicode icon, persistence, sign-in return, membership, invitation permissions, rotation, invalid links, repeat joining, mobile layout, sign-out, bill creation and confirmation, response-loss retries, initiator adjustment, balances, completed-bill finality, stale confirmation, correction, reconfirmation, removal, and cancellation.');
} catch (error) {
  if (networkChangeFailures.size) {
    console.error('Browser resource loading was interrupted by ERR_NETWORK_CHANGED. Host network changes, including concurrent Docker container startup/shutdown, can leave the app blank before UI assertions run. Run browser smoke separately from container-changing jobs; the assertion still fails.');
    console.error('Affected resource samples:', [...networkChangeFailures.entries()].slice(0, 8));
  }
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
