// Navigation scenarios: moving between Home, groups and accounts.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { screenshots } from '../environment.mjs';
import { costcoFriends, weekendGroceries } from './fixtures.mjs';
import { groupNet, homeRow, openGroupSwitcher, switchGroup, homeGroupNames, groupSwitcher } from '../ui.mjs';

export const scenarios = [
  { name: 'navigation-and-account-isolation', run: navigationAndAccountIsolation },
  { name: 'attention', run: attention },
];

// Group navigation, cached reads, the group switcher, the top bar, sign-out and account isolation.
async function navigationAndAccountIsolation(env) {
  const { pageFor, base } = env;
  const { group, ids, groupUrl } = await costcoFriends(env);
  await weekendGroceries(env, group, ids);
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  await alice.goto(base);
  const bob = await pageFor('bob-token', { width: 390, height: 844 });
  const carol = await pageFor('carol-token', { width: 1280, height: 900 });
  // Group navigation opens finances directly and survives reloads.
  await alice.getByRole('button', { name: 'New group', exact: true }).first().click();
  await alice.getByLabel('Group name').fill('Apartment');
  await alice.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(alice.getByRole('dialog')).toContainText('Apartment');
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await expect(alice.locator('#main-content').getByRole('heading', { name: 'Apartment' })).toBeVisible();
  await expect(groupNet(alice)).toContainText("You're settled up");
  await switchGroup(alice, 'Costco friends');
  await expect(groupNet(alice)).toContainText('$59.97');
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await checkNavigation(alice, pageFor);
  await alice.reload();
  await expect(groupNet(alice)).toContainText('$59.97');
  const selectedBillsPattern = '**/api/groups/' + alice.url().split('/').pop() + '/bills';
  await alice.route(selectedBillsPattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) }));
  await expect(alice.getByRole('button', { name: 'Refresh bills', exact: true })).toHaveCount(0);
  await alice.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(alice.getByRole('alert')).toHaveCount(0);
  await expect(groupNet(alice)).toContainText('$59.97');
  await alice.unroute(selectedBillsPattern);
  // The visible group recovers through automatic reconnection without a manual retry.
  await expect(alice.getByRole('alert')).toHaveCount(0, { timeout: 20_000 });
  await expect(groupNet(alice)).toContainText('$59.97', { timeout: 20_000 });
  await expect(groupNet(alice)).toContainText('$59.97');
  const newBillButton = alice.getByRole('button', { name: 'New bill', exact: true });
  const membersButton = alice.getByRole('button', { name: 'Members & invites', exact: true });
  await expect(newBillButton).toHaveCSS('min-height', '40px');
  await expect(newBillButton).toHaveCSS('box-shadow', 'none');
  await expect(membersButton).toHaveCSS('min-height', '40px');
  await expect(membersButton).toHaveCSS('box-shadow', 'none');
  assert.equal(await newBillButton.evaluate(button => getComputedStyle(button).backgroundColor === getComputedStyle(document.querySelector('.play')).color), true, 'Primary action uses ink');
  await newBillButton.hover();
  await expect(newBillButton).toHaveCSS('transform', 'none');
  await alice.mouse.move(0, 0);
  await alice.screenshot({ path: `${screenshots}/workspace-desktop.png`, fullPage: true });
  await alice.setViewportSize({ width: 390, height: 844 });
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.screenshot({ path: `${screenshots}/workspace-mobile.png`, fullPage: true });
  await alice.getByRole('button', { name: 'Members & invites', exact: true }).click();
  await expect(alice.getByRole('dialog')).toContainText('3 members');
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Members dialog overflows at 390px');
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
  await mkdir(`${screenshots}`, { recursive: true });
  await alice.screenshot({ path: `${screenshots}/groups-desktop.png`, fullPage: true });
  await carol.setViewportSize({ width: 390, height: 844 });
  await carol.screenshot({ path: `${screenshots}/groups-mobile.png`, fullPage: true });
}

// Home actions: refresh, direct repayment review, loading and failure states, stale links and account isolation.
async function attention(env) {
  const { api, pageFor, base } = env;
  const { group, ids: liveIds } = await costcoFriends(env);
  const liveGroupId = group.id;
  const liveApi = api;
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
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
  await alice.unrouteAll({ behavior: 'wait' });
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

// Hold responses until assertions complete: loading flashes cannot hide behind timing.
async function checkNavigation(page, pageFor) {
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
  await expect(groupNet(page)).toContainText("You're settled up");
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
  await expect(groupNet(page)).toContainText('$59.97');
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
    await expect(groupNet(page)).toContainText('$59.97');
    release();
    await expect.poll(() => active).toBe(0);
  }
  // A held response for A cannot overwrite B, even through rapid switches.
  reads = 0;
  gate = new Promise(resolve => { release = resolve; });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => reads).toBeGreaterThan(0);
  await switchGroup(page, 'Apartment');
  await expect(groupNet(page)).toContainText("You're settled up");
  release();
  await expect.poll(() => active).toBe(0);
  await expect(groupNet(page)).toContainText("You're settled up");
  await expect(page.locator('#main-content').getByRole('heading', { level: 2 }).first()).toHaveText('Apartment');
  await switchGroup(page, 'Costco friends');
  await expect(groupNet(page)).toContainText('$59.97');
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
  await expect(groupNet(page)).toContainText('$59.97');
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
  await expect(groupNet(page)).toContainText('$59.97');

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
  await expect(groupNet(page)).toContainText('$59.97');
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
  await expect(groupNet(fresh)).toHaveCount(0);
  release();
  await expect(groupNet(fresh)).toContainText('$59.97');
  await fresh.unroute(pattern);
  await fresh.route(pattern, route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
  await fresh.reload();
  await expect(fresh.getByRole('alert')).toContainText("Couldn't load this group.");
  await expect(groupNet(fresh)).toHaveCount(0);
  await fresh.unroute(pattern);
  await fresh.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(groupNet(fresh)).toContainText('$59.97');
  await fresh.route(pattern, route => route.fulfill({ status: 403, json: { error: 'Access revoked.' } }));
  await fresh.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(fresh.getByRole('alert').first()).toContainText('Access revoked.');
  await expect(groupNet(fresh)).toHaveCount(0);
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
  await expect(groupNet(fresh)).toHaveCount(0);
  await expect(fresh.locator('#main-content')).not.toContainText('Costco friends');
  release();
  await fresh.unrouteAll({ behavior: 'wait' });
  await fresh.getByRole('button', { name: 'Account menu', exact: true }).click();
  await fresh.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(fresh.getByText('Costco friends', { exact: true })).toHaveCount(0);
  await fresh.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(groupNet(fresh)).toContainText('$59.97');
  await expect(groupNet(fresh)).toContainText('You owe');
  await checkTopBar(fresh, 'mobile');
  await fresh.context().close();
  console.log('Navigation UX passed: top bar with Home and account menu, delayed cached navigation, group switcher, deduplication, no warning flashes, background recovery, initial failure, revoked access and account isolation.');
}

// Starts and ends on "Costco friends"; the member also belongs to "Apartment".
async function checkGroupSwitcher(page, label) {
  const costcoUrl = page.url();
  const trigger = groupSwitcher(page);
  const listbox = page.getByRole('listbox', { name: 'Switch group', exact: true });
  const option = name => listbox.getByRole('option', { name, exact: true });
  const options = listbox.getByRole('option');
  await expect(groupNet(page)).toContainText('$59.97');
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
  await page.screenshot({ path: `${screenshots}/group-switcher-closed-${label}.png`, animations: 'disabled' });

  // Mouse: the current group is marked and focused; choosing another navigates.
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveAttribute('aria-controls', await listbox.getAttribute('id'));
  await expect(options).toHaveCount(2);
  await expect(option('Costco friends')).toHaveAttribute('aria-selected', 'true');
  await expect(options.locator('.group-switcher-count')).toHaveCount(0);
  await expect(option('Apartment')).toHaveAttribute('aria-selected', 'false');
  await expect(option('Costco friends')).toBeFocused();
  await assertNoHorizontalOverflow(page, `${label} group switcher`);
  await page.screenshot({ path: `${screenshots}/group-switcher-open-${label}.png`, animations: 'disabled' });
  await option('Apartment').click();
  await expect(listbox).toHaveCount(0);
  await expect(page).toHaveURL(/#\/group-bills\/[^/?#]+$/);
  assert.notEqual(page.url(), costcoUrl);
  const apartmentUrl = page.url();
  await expect(trigger).toHaveAccessibleName('Apartment');
  await expect(groupNet(page)).toContainText("You're settled up");
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
  await expect(groupNet(page)).toContainText('$59.97');

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
  await page.screenshot({ path: `${screenshots}/top-bar-menu-${label}.png`, animations: 'disabled' });
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
  await page.screenshot({ path: `${screenshots}/top-bar-account-${label}.png`, fullPage: true, animations: 'disabled' });

  await banner.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your groups' })).toBeVisible();
  await page.screenshot({ path: `${screenshots}/top-bar-home-${label}.png`, fullPage: true, animations: 'disabled' });
}

// Screenshots Home on desktop and at 390px, where nothing may overflow sideways.
async function checkHomeLayout(page, label) {
  const viewport = page.viewportSize();
  await page.screenshot({ path: `${screenshots}/home-${label}-desktop.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} Home overflows at 390px`);
  await page.screenshot({ path: `${screenshots}/home-${label}-mobile.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize(viewport);
}
