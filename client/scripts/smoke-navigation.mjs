import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Hold responses until assertions complete: loading flashes cannot hide behind timing.
export async function checkNavigation(page, pageFor) {
  const groupUrl = page.url();
  const path = new URL(groupUrl).hash.slice('#/group-bills/'.length);
  const pattern = `**/api/groups/${path}/bills`;
  const groups = page.getByRole('navigation', { name: 'Groups', exact: true });
  await page.evaluate(() => {
    window.uxFlashes = [];
    window.uxObserver = new MutationObserver(() => {
      const text = document.body.innerText;
      if (/Live updates interrupted|Retry group bills|Loading bills\.\.\.|Loading balances\.\.\./.test(text)) window.uxFlashes.push(text);
    });
    window.uxObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.uxSidebar = document.querySelector('.workspace-groups');
  });
  await groups.getByRole('link', { name: /Apartment/ }).click();
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  let release;
  let reads = 0;
  let active = 0;
  let maxActive = 0;
  let gate = new Promise(resolve => { release = resolve; });
  await page.route(pattern, async route => {
    reads++; active++; maxActive = Math.max(maxActive, active);
    await gate;
    try { await route.continue(); } finally { active--; }
  });
  await groups.getByRole('link', { name: /Costco friends/ }).click();
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await expect(page.getByRole('status', { name: 'Loading group', exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.uxSidebar === document.querySelector('.workspace-groups')), true);
  release();
  await expect.poll(() => active).toBe(0);
  for (const event of ['focus', 'visibilitychange', 'online']) {
    reads = 0;
    gate = new Promise(resolve => { release = resolve; });
    await page.evaluate(event => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)), event);
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');
    release();
    await expect.poll(() => active).toBe(0);
  }
  // A held response for A cannot overwrite B, even through rapid switches.
  reads = 0;
  gate = new Promise(resolve => { release = resolve; });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => reads).toBeGreaterThan(0);
  await groups.getByRole('link', { name: /Apartment/ }).click();
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  release();
  await expect.poll(() => active).toBe(0);
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  await expect(page.locator('.workspace-content h2').first()).toHaveText('Apartment');
  await groups.getByRole('link', { name: /Costco friends/ }).click();
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  assert.equal(maxActive, 1, 'Sidebar and main panel share the same request');
  await page.unroute(pattern);
  await checkTopBar(page, 'desktop');
  await expect(page.locator('.balance-number')).toHaveText('$59.97');
  await page.locator('.group-card').filter({ hasText: 'Costco friends' }).click();
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  let summaryRead = false;
  gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/summary', async route => { summaryRead = true; await gate; await route.continue(); });
  await page.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  await expect.poll(() => summaryRead).toBe(true);
  await expect(page.locator('.balance-number')).toHaveText('$59.97');
  await expect(page.getByRole('status', { name: 'Loading balances', exact: true })).toHaveCount(0);
  release();
  await page.unrouteAll({ behavior: 'wait' });
  assert.deepEqual(await page.evaluate(() => window.uxFlashes), []);
  await page.evaluate(() => window.uxObserver.disconnect());
  await page.goto(groupUrl);
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');

  await page.evaluate(() => {
    window.recoveryFlashes = [];
    window.recoveryObserver = new MutationObserver(() => {
      if (/Live updates interrupted|Retry group bills/.test(document.body.innerText)) window.recoveryFlashes.push(document.body.innerText);
    });
    window.recoveryObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  let failures = 0;
  await page.route(pattern, route => { failures++; return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }); });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => failures).toBeGreaterThan(0);
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.unroute(pattern);
  let recovered = false;
  await page.route(pattern, async route => { recovered = true; await route.continue(); });
  await expect.poll(() => recovered, { timeout: 20000 }).toBe(true);
  await page.unroute(pattern);

  assert.deepEqual(await page.evaluate(() => window.recoveryFlashes), []);
  await page.evaluate(() => window.recoveryObserver.disconnect());

  const fresh = await pageFor('alice-token', { width: 390, height: 844 });
  gate = new Promise(resolve => { release = resolve; });
  await fresh.route(pattern, async route => { await gate; await route.continue(); });
  await fresh.goto(groupUrl);
  await expect(fresh.getByRole('status', { name: 'Loading group', exact: true })).toBeVisible();
  assert.ok((await fresh.locator('.financial-skeleton').boundingBox()).height >= 300);
  await expect(fresh.locator('.workspace-content .balance-number')).toHaveCount(0);
  release();
  await expect(fresh.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await fresh.unroute(pattern);
  await fresh.route(pattern, route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
  await fresh.reload();
  await expect(fresh.getByRole('alert')).toContainText("Couldn't load this group.");
  await expect(fresh.locator('.workspace-content .balance-number')).toHaveCount(0);
  await fresh.unroute(pattern);
  await fresh.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(fresh.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await fresh.route(pattern, route => route.fulfill({ status: 403, json: { error: 'Access revoked.' } }));
  await fresh.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(fresh.getByRole('alert').first()).toContainText('Access revoked.');
  await expect(fresh.locator('.workspace-content .balance-number')).toHaveCount(0);
  await fresh.unroute(pattern);
  // Switch identity without a reload. New-account requests are held while checking
  // that the previous account's cache disappears immediately.
  gate = new Promise(resolve => { release = resolve; });
  let accountRead = false;
  await fresh.route('**/api/**', async route => { accountRead = true; await gate; await route.continue(); });
  await fresh.evaluate(() => {
    localStorage.setItem('smoke-token', 'member-14-token');
    window.dispatchEvent(new Event('storage'));
  });
  await expect.poll(() => accountRead).toBe(true);
  await expect(fresh.locator('.workspace-content .balance-number')).toHaveCount(0);
  await expect(fresh.getByRole('navigation', { name: 'Groups', exact: true })).not.toContainText('Costco friends');
  release();
  await fresh.unrouteAll({ behavior: 'wait' });
  await fresh.getByRole('button', { name: 'Account menu', exact: true }).click();
  await fresh.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(fresh.getByText('Costco friends', { exact: true })).toHaveCount(0);
  await fresh.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(fresh.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await expect(fresh.locator('.balance-card h2')).toHaveText('You owe, net');
  await checkTopBar(fresh, 'mobile');
  await fresh.context().close();
  console.log('Navigation UX passed: top bar with Home and account menu, delayed cached navigation, shared group rail, deduplication, no warning flashes, background recovery, initial failure, revoked access and account isolation.');
}

async function assertNoHorizontalOverflow(page, where) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow: ${where}`);
}

// Home is the only top-level page. The logo returns to it; Account lives in the avatar menu.
async function checkTopBar(page, label) {
  const clientRoot = new URL('../', import.meta.url).pathname;
  const banner = page.getByRole('banner');
  const menuButton = banner.getByRole('button', { name: 'Account menu', exact: true });
  const menu = page.getByRole('menu', { name: 'Account menu', exact: true });
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toHaveCount(0);
  for (const name of ['Overview', 'My groups']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await assertNoHorizontalOverflow(page, `${label} group page`);

  await banner.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  await expect(page).toHaveURL(/#$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hey');
  await expect(page.getByRole('heading', { name: 'Your people' })).toBeVisible();
  await assertNoHorizontalOverflow(page, `${label} Home`);

  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await menuButton.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Account', 'Profile & security', 'Sign out']);
  await expect(menu.getByRole('menuitem', { name: 'Account', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Profile & security', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeFocused();
  await assertNoHorizontalOverflow(page, `${label} account menu`);
  await page.screenshot({ path: `${clientRoot}test-results/top-bar-menu-${label}.png`, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(5, 400); // Outside the menu, which covers the heading at 390px.
  await expect(menu).toHaveCount(0);
  // iOS Safari taps on non-focusable content do not blur the focused item; the press alone must close it.
  await menuButton.click();
  await expect(menu.getByRole('menuitem', { name: 'Account', exact: true })).toBeFocused();
  await page.evaluate(() => document.querySelector('main').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await expect(menu).toHaveCount(0);
  // A press inside the menu keeps it open.
  await menuButton.click();
  await page.evaluate(() => document.querySelector('[role="menu"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await menuButton.click();
  await menu.getByRole('menuitem', { name: 'Account', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(/#\/account$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check Account identity', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New group', exact: true })).toHaveCount(0);
  await assertNoHorizontalOverflow(page, `${label} Account`);
  await page.screenshot({ path: `${clientRoot}test-results/top-bar-account-${label}.png`, fullPage: true, animations: 'disabled' });

  await banner.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your people' })).toBeVisible();
  await page.screenshot({ path: `${clientRoot}test-results/top-bar-home-${label}.png`, fullPage: true, animations: 'disabled' });
}
