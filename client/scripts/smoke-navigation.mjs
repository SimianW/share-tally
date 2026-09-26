import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Hold responses until assertions complete: loading flashes cannot hide behind timing.
export async function checkNavigation(page, pageFor) {
  const groupUrl = page.url();
  const path = new URL(groupUrl).hash.slice('#/group-bills/'.length);
  const pattern = `**/api/groups/${path}/bills`;
  await page.evaluate(() => {
    window.uxFlashes = [];
    window.uxObserver = new MutationObserver(() => {
      const text = document.body.innerText;
      if (/Live updates interrupted|Retry group bills|Loading bills\.\.\.|Loading balances\.\.\./.test(text)) window.uxFlashes.push(text);
    });
    window.uxObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.uxTopBar = document.querySelector('.top-bar');
  });
  await switchGroup(page, 'Apartment');
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
  await switchGroup(page, 'Costco friends');
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await expect(page.getByRole('status', { name: 'Loading group', exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.uxTopBar === document.querySelector('.top-bar')), true);
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
  await switchGroup(page, 'Apartment');
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  release();
  await expect.poll(() => active).toBe(0);
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  await expect(page.locator('#main-content').getByRole('heading', { level: 2 }).first()).toHaveText('Apartment');
  await switchGroup(page, 'Costco friends');
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  assert.equal(maxActive, 1, 'Group page reads are deduplicated');
  await page.unroute(pattern);
  await checkGroupSwitcher(page, 'desktop');
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await checkGroupSwitcher(page, 'mobile');
  await page.setViewportSize(desktop);
  await checkTopBar(page, 'desktop');
  // Rows keep the order Alice joined her groups in, and each shows her group page balance.
  assert.deepEqual(await homeGroupNames(page), ['Costco friends', 'Apartment']);
  await expect(homeRow(page, 'Costco friends')).toContainText("You're owed $59.97");
  await expect(homeRow(page, 'Apartment')).toContainText('All square Settled');
  await homeRow(page, 'Costco friends').click();
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  // Returning Home rereads the balances without replacing the known rows with a loading state.
  let listRead = false;
  gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/groups', async route => { listRead = true; await gate; await route.continue(); });
  await page.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  await expect.poll(() => listRead).toBe(true);
  await expect(homeRow(page, 'Costco friends')).toContainText('$59.97');
  await expect(page.getByRole('status', { name: 'Loading groups', exact: true })).toHaveCount(0);
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
  await expect(fresh.locator('#main-content')).not.toContainText('Costco friends');
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
  console.log('Navigation UX passed: top bar with Home and account menu, delayed cached navigation, group switcher, deduplication, no warning flashes, background recovery, initial failure, revoked access and account isolation.');
}

// Home lists one row per group, in the order the member joined them.
export function homeRow(page, name) {
  return page.getByRole('region', { name: /^Your groups/ }).locator('a.home-group-row').filter({
    has: page.locator('.home-group-name').getByText(name, { exact: true }),
  });
}
export async function homeGroupNames(page) {
  return page.getByRole('region', { name: /^Your groups/ }).locator('.home-group-name').allInnerTexts();
}

// The group page heading's dropdown switches groups.
export function groupSwitcher(page) {
  return page.locator('#main-content').getByRole('heading', { level: 2 }).getByRole('button');
}
export async function openGroupSwitcher(page) {
  const trigger = groupSwitcher(page);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const listbox = page.getByRole('listbox', { name: 'Switch group', exact: true });
  await expect(listbox).toBeVisible();
  return listbox;
}
export async function switchGroup(page, name) {
  const listbox = await openGroupSwitcher(page);
  await listbox.getByRole('option', { name, exact: true }).click();
  await expect(listbox).toHaveCount(0);
  await expect(groupSwitcher(page)).toHaveAccessibleName(name);
}

// Starts and ends on "Costco friends"; the member also belongs to "Apartment".
async function checkGroupSwitcher(page, label) {
  const clientRoot = new URL('../', import.meta.url).pathname;
  const costcoUrl = page.url();
  const trigger = groupSwitcher(page);
  const listbox = page.getByRole('listbox', { name: 'Switch group', exact: true });
  const option = name => listbox.getByRole('option', { name, exact: true });
  const options = listbox.getByRole('option');
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');
  await expect(page.getByRole('navigation', { name: 'Groups', exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => {
    const main = document.querySelector('#main-content');
    const style = getComputedStyle(main);
    const available = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return Math.abs(document.querySelector('.workspace-content').getBoundingClientRect().width - available) < 1;
  }), true, `Group page uses the full width: ${label}`);
  await expect(trigger).toHaveAccessibleName('Costco friends');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await assertNoHorizontalOverflow(page, `${label} group page`);
  // Screenshot the resting state, without a focus ring left over from earlier keyboard checks.
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: `${clientRoot}test-results/group-switcher-closed-${label}.png`, animations: 'disabled' });

  // Mouse: the current group is marked and focused; choosing another navigates.
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveAttribute('aria-controls', await listbox.getAttribute('id'));
  await expect(options).toHaveCount(2);
  await expect(option('Costco friends')).toHaveAttribute('aria-selected', 'true');
  await expect(option('Apartment')).toHaveAttribute('aria-selected', 'false');
  await expect(option('Costco friends')).toBeFocused();
  await assertNoHorizontalOverflow(page, `${label} group switcher`);
  await page.screenshot({ path: `${clientRoot}test-results/group-switcher-open-${label}.png`, animations: 'disabled' });
  await option('Apartment').click();
  await expect(listbox).toHaveCount(0);
  await expect(page).toHaveURL(/#\/group-bills\/[^/?#]+$/);
  assert.notEqual(page.url(), costcoUrl);
  const apartmentUrl = page.url();
  await expect(trigger).toHaveAccessibleName('Apartment');
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$0.00');
  await trigger.click();
  await expect(option('Apartment')).toHaveAttribute('aria-selected', 'true');
  await expect(option('Costco friends')).toHaveAttribute('aria-selected', 'false');
  // Choosing the current group only closes the list.
  await option('Apartment').click();
  await expect(listbox).toHaveCount(0);
  await expect(page).toHaveURL(apartmentUrl);

  // Keyboard: open, move through options without wrapping, Escape, choose with Enter.
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(option('Apartment')).toBeFocused();
  await page.keyboard.press('End');
  await expect(options.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(options.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(options.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(options.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(listbox).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(apartmentUrl);
  // Shift+Tab back to the still-open list's button; Escape must still close it.
  await page.keyboard.press('Enter');
  await expect(option('Apartment')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(trigger).toBeFocused();
  await expect(listbox).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(listbox).toHaveCount(0);
  // Tabbing out of the list closes it.
  await page.keyboard.press(' ');
  await expect(option('Apartment')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(listbox).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const costcoIndex = await options.evaluateAll(items => items.findIndex(item => item.textContent.includes('Costco friends')));
  await page.keyboard.press(costcoIndex === 0 ? 'ArrowUp' : 'ArrowDown');
  await expect(option('Costco friends')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(listbox).toHaveCount(0);
  await expect(page).toHaveURL(costcoUrl);
  await expect(trigger).toHaveAccessibleName('Costco friends');
  await expect(trigger).toBeFocused();
  await expect(page.locator('.workspace-content .balance-number')).toHaveText('$59.97');

  // A press outside closes the list, including a touch press that does not move focus.
  await trigger.click();
  await expect(listbox).toBeVisible();
  await page.mouse.click(5, 600);
  await expect(listbox).toHaveCount(0);
  await trigger.click();
  await page.evaluate(() => document.querySelector('.page-footer').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await expect(listbox).toHaveCount(0);
  await trigger.click();
  await page.evaluate(() => document.querySelector('[role="listbox"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await expect(listbox).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(listbox).toHaveCount(0);
  await expect(page).toHaveURL(costcoUrl);
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
  await expect(page.getByRole('heading', { name: 'Your groups' })).toBeVisible();
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
  // Shift+Tab from the first item returns to the still-open menu's button; Escape must still close it.
  await menuButton.click();
  await expect(menu.getByRole('menuitem', { name: 'Account', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(menuButton).toBeFocused();
  await expect(menu).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Your groups' })).toBeVisible();
  await page.screenshot({ path: `${clientRoot}test-results/top-bar-home-${label}.png`, fullPage: true, animations: 'disabled' });
}
