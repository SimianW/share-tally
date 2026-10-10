// Group membership scenarios: creating, joining, departure, ownership, capacity and deletion.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { screenshots } from '../environment.mjs';
import { aliceBill, billPeople, costcoFriends, observeGroupReady } from './fixtures.mjs';
import { groupNet, homeRow, openGroupSwitcher } from '../ui.mjs';

export const scenarios = [
  { name: 'group-refresh', run: groupRefresh },
  { name: 'group-invitations', run: groupInvitations },
  { name: 'group-self-departure', run: groupSelfDeparture },
  { name: 'group-owner-removal', run: groupOwnerRemoval },
  { name: 'group-ownership-succession', run: groupOwnershipSuccession },
  { name: 'group-departure-blockers', run: groupDepartureBlockers },
  { name: 'group-capacity', run: groupCapacity },
  { name: 'group-deletion', run: groupDeletion },
];

// A member without groups can start one, or ask a friend for an invitation link.
async function checkNoGroups(page, label) {
  const empty = page.getByRole('region', { name: 'Your people, together.' });
  await expect(empty.getByText('Start with a group for your next shared purchase.')).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Create your first group', exact: true })).toBeVisible();
  await expect(empty).toContainText("Joining friends? Ask them to send you their group's invitation link.");
  await expect(page.getByRole('region', { name: /^Your groups/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Hey Member, you're all caught up");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} zero-group Home overflows`);
  await page.screenshot({ path: `${screenshots}/home-zero-${label}.png`, fullPage: true, animations: 'disabled' });
}

// Records the dev server's emoji data module requests, which only the Emoji tab may trigger.
function watchEmojiData(page) {
  const requests = [];
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (/\/(?:src|node_modules)\//i.test(pathname) && /emoji-catalog|emojibase-data|emoji-data/i.test(pathname)) requests.push(pathname);
  });
  return requests;
}

// Successful membership writes must remain visible even when the list read fails.
async function groupRefresh({ pageFor, base }) {
  const owner = await pageFor('member-15-token', { width: 1280, height: 900 });
  const joiner = await pageFor('member-16-token', { width: 390, height: 844 });
  const name = 'Refresh failure group';
  await owner.goto(base);
  await checkNoGroups(owner, 'desktop');
  await owner.route('**/api/groups', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, json: { error: 'Group list temporarily unavailable.' } }) : route.continue());
  await owner.getByRole('button', { name: 'New group', exact: true }).click();
  await owner.getByLabel('Group name').fill(name);
  await owner.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(owner.getByRole('dialog')).toContainText(name);
  await owner.getByRole('button', { name: 'Get invitation link', exact: true }).click();
  const link = await owner.getByLabel('Invitation link', { exact: true }).inputValue();
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click();
  // Closing the new group's details leaves its creator on that group's page.
  await expect(owner).toHaveURL(/#\/group-bills\//);
  await expect(owner.locator('#main-content').getByRole('heading', { name })).toBeVisible();
  await expect(owner.getByRole('region', { name: 'Where you stand' })).toContainText("You're settled up");
  await expect(owner.getByRole('region', { name: 'Open bills', exact: true })).toContainText('No open bills');
  // The group list failure shows where it matters: in the group switcher.
  const switcher = await openGroupSwitcher(owner);
  await expect(switcher.getByRole('option', { name, exact: true })).toHaveCount(1);
  await expect(owner.locator('.group-switcher').getByRole('alert')).toContainText('Group list temporarily unavailable.');
  await owner.screenshot({ path: `${screenshots}/group-switcher-error-desktop.png`, animations: 'disabled' });
  await owner.unroute('**/api/groups');
  await owner.getByRole('button', { name: 'Retry groups', exact: true }).click();
  await expect(owner.locator('.group-switcher').getByRole('alert')).toHaveCount(0);
  // Removing the focused Retry button must not strand focus on the body: the list
  // stays open with its current group focused, and its keys still work.
  await expect(switcher).toBeVisible();
  await expect(switcher.getByRole('option', { name, exact: true })).toHaveCount(1);
  await expect(switcher.getByRole('option', { name, exact: true })).toBeFocused();
  await owner.keyboard.press('ArrowDown');
  await expect(switcher.getByRole('option', { name, exact: true })).toBeFocused();
  await owner.keyboard.press('Escape');
  await expect(switcher).toHaveCount(0);
  await expect(owner.locator('#main-content').getByRole('heading', { level: 2 }).getByRole('button')).toBeFocused();

  await joiner.goto(base);
  await checkNoGroups(joiner, 'mobile');
  await joiner.route('**/api/groups', route => route.fulfill({ status: 503, json: { error: 'Group list temporarily unavailable.' } }));
  // Repeat joining also exercises replacement rather than duplicate insertion.
  for (let attempt = 0; attempt < 2; attempt++) {
    await joiner.evaluate(hash => { location.hash = hash; }, new URL(link).hash);
    await joiner.getByRole('button', { name: 'Join group', exact: true }).click();
    // Accepting an invitation lands on the joined group's page.
    await expect(joiner).toHaveURL(/#\/group-bills\//);
    await expect(joiner.getByRole('dialog')).toHaveCount(0);
    await expect(joiner.locator('.group-member-count')).toContainText('2 members');
    await expect((await openGroupSwitcher(joiner)).getByRole('option', { name, exact: true })).toHaveCount(1);
    await joiner.keyboard.press('Escape');
  }
  await joiner.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  await expect(homeRow(joiner, name)).toHaveCount(1);
  // Without a list read the joined group's balance is unknown, so none is shown.
  await expect(homeRow(joiner, name).locator('.home-balance')).toHaveCount(0);
  await joiner.unroute('**/api/groups');
  await joiner.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(homeRow(joiner, name)).toHaveCount(1);
  await expect(homeRow(joiner, name)).toContainText('All square Settled');
  console.log('Group refresh regression passed: create/join survive list failure, retry recovers, repeated joins do not duplicate.');
}

// Creating a group with a Unicode icon, inviting through the sign-in boundary, rotating links and rejecting stale ones.
async function groupInvitations(env) {
  const { pageFor, base } = env;
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  const emojiModuleRequests = watchEmojiData(alice);
  await alice.goto(base);
  await expect(alice.getByRole('button', { name: 'New group', exact: true })).toBeVisible();
  assert.deepEqual(emojiModuleRequests, [], 'Home should not load emoji data modules');
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
  assert.deepEqual(emojiModuleRequests, [], 'Emoji data should stay unloaded until the Emoji tab is clicked');
  await alice.getByRole('button', { name: /^Emoji/ }).click();
  await expect.poll(() => emojiModuleRequests.length).toBeGreaterThan(0);
  await alice.getByLabel('Search icons and emoji').fill('pizza');
  await expect(alice.getByRole('button', { name: 'Select pizza', exact: true })).toContainText('🍕');
  await alice.getByRole('button', { name: 'Select pizza', exact: true }).click();
  await alice.getByLabel('Paste emoji or symbol').fill('ab');
  await expect(alice.getByRole('button', { name: 'Use icon', exact: true })).toBeDisabled();
  await expect(alice.getByRole('alert')).toContainText('one visible character');
  await alice.getByLabel('Paste emoji or symbol').fill('👨‍👩‍👧‍👦');
  await mkdir(`${screenshots}`, { recursive: true });
  await alice.screenshot({ path: `${screenshots}/icon-picker-desktop.png`, fullPage: true });
  await alice.setViewportSize({ width: 390, height: 844 });
  await expect(alice.getByRole('button', { name: 'Use icon', exact: true })).toBeVisible();
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.screenshot({ path: `${screenshots}/icon-picker-mobile.png`, fullPage: true });
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
  const groupPage = await pageFor('alice-token', { width: 1280, height: 900 });
  const groupEmojiModules = watchEmojiData(groupPage);
  await groupPage.goto(groupUrl);
  await expect(groupNet(groupPage)).toContainText("You're settled up");
  assert.deepEqual(groupEmojiModules, [], 'Group page should not load emoji data modules');
  await groupPage.context().close();
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
}

// Fresh contexts wait for a real subscription before a different member mutates
// membership; cached rendering alone would not establish live-refresh coverage.
async function membershipPage(env, token, url, viewport = { width: 1280, height: 900 }) {
  const page = await env.pageFor(token, viewport);
  await observeGroupReady(page);
  await page.goto(url);
  return page;
}
async function readyForMembership(page, groupId) {
  await page.waitForFunction(id => window.membershipReadyGroups.includes(id), groupId);
}
const memberRow = (dialog, name) => dialog.locator('.member-row').filter({ hasText: name });
async function expectOwner(dialog, name) {
  await expect(dialog.locator('.member-row strong').filter({ hasText: /^Owner$/ })).toHaveCount(1);
  await expect(memberRow(dialog, name).getByText('Owner', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Creator', { exact: true })).toHaveCount(0);
}
async function expectDepartureHome(page, base, name) {
  await expect(page).toHaveURL(`${base}#`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(homeRow(page, name)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Where you stand' })).toHaveCount(0);
}

// Mobile voluntary departure clears the workspace, refreshes current membership,
// and leaves an unrelated group available in Home and the group switcher.
async function groupSelfDeparture(env) {
  const { group, groupUrl, billsUrl, invitationToken } = await costcoFriends(env);
  await costcoFriends(env, { name: 'Another shopping group' });
  const owner = await membershipPage(env, 'alice-token', groupUrl);
  const bob = await membershipPage(env, 'bob-token', billsUrl, { width: 390, height: 844 });
  const members = owner.getByRole('dialog', { name: group.name, exact: true });
  await readyForMembership(owner, group.id);
  await readyForMembership(bob, group.id);
  await expectOwner(members, 'Alice');
  await bob.getByRole('button', { name: 'Members & invites', exact: true }).click();
  const bobMembers = bob.getByRole('dialog', { name: group.name, exact: true });
  await expectOwner(bobMembers, 'Alice');
  await expect(bobMembers.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await bobMembers.getByRole('button', { name: 'Leave group', exact: true }).click();
  const leave = bob.getByRole('dialog', { name: `Leave ${group.name}?`, exact: true });
  await expect(leave).toContainText(/unpublished bill drafts.*deleted/);
  await expect(leave.getByLabel('New owner', { exact: true })).toHaveCount(0);
  await leave.getByRole('button', { name: 'Leave group', exact: true }).click();
  await expectDepartureHome(bob, env.base, group.name);
  await expect(homeRow(bob, 'Another shopping group')).toBeVisible();
  await expect(members).toContainText('2 members');
  await expect(memberRow(members, 'Bob')).toHaveCount(0);
  await expectOwner(members, 'Alice');
  await homeRow(bob, 'Another shopping group').click();
  await expect((await openGroupSwitcher(bob)).getByRole('option', { name: group.name, exact: true })).toHaveCount(0);
  await bob.keyboard.press('Escape');
  // Ending membership is not a ban: the existing invitation still reconnects Bob.
  await bob.goto(`${env.base}#/join/${invitationToken}`);
  await bob.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(bob.locator('.group-member-count')).toContainText('3 members');
  await expect(members).toContainText('3 members');
  await expectOwner(members, 'Alice');
}

// Only the owner sees per-member removal. An already-open removed workspace
// returns to Home, while another current member's mobile count updates in place.
async function groupOwnerRemoval(env) {
  const { group, groupUrl, billsUrl } = await costcoFriends(env);
  const owner = await membershipPage(env, 'alice-token', groupUrl);
  const bob = await membershipPage(env, 'bob-token', billsUrl);
  const carol = await membershipPage(env, 'carol-token', billsUrl, { width: 390, height: 844 });
  for (const page of [owner, bob, carol]) await readyForMembership(page, group.id);
  const members = owner.getByRole('dialog', { name: group.name, exact: true });
  await expectOwner(members, 'Alice');
  await expect(memberRow(members, 'Alice').getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await expect(members.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(2);
  await carol.getByRole('button', { name: 'Members & invites', exact: true }).click();
  const carolMembers = carol.getByRole('dialog', { name: group.name, exact: true });
  await expect(carolMembers.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
  await memberRow(members, 'Bob').getByRole('button', { name: 'Remove', exact: true }).click();
  const remove = owner.getByRole('dialog', { name: 'Remove Bob?', exact: true });
  await expect(remove).toContainText(/Bob's unpublished bill drafts.*deleted/);
  await remove.getByRole('button', { name: 'Remove member', exact: true }).click();
  await expect(remove).toHaveCount(0);
  await expectDepartureHome(bob, env.base, group.name);
  for (const dialog of [members, carolMembers]) {
    await expect(dialog).toContainText('2 members');
    await expect(memberRow(dialog, 'Bob')).toHaveCount(0);
    await expectOwner(dialog, 'Alice');
  }
  await carolMembers.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(carol.locator('.group-member-count')).toContainText('2 members');
  await expect(carol.getByRole('region', { name: 'Where you stand' })).toBeVisible();
}

// Transfer and departure are one confirmation. A successor's unfinished bill
// does not block succession, and bill Initiator controls stay bill-specific.
async function groupOwnershipSuccession(env) {
  const { group, ids, groupUrl } = await costcoFriends(env);
  const historical = await aliceBill(env, group.id, 'Settled original-owner purchase', 200,
    [ids.Alice, ids.Bob], [['alice-token', 100], ['bob-token', 100]]);
  const { repayment } = await env.api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: ids.Alice, amountCents: 100,
  });
  await env.api(`/repayments/${repayment.id}/decision`, 'alice-token', 'POST', { decision: 'confirmed' });
  const { bill: bobBill } = await env.api(`/groups/${group.id}/bills`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), title: "Bob's ongoing purchase", purchaseDate: '2026-01-01',
    timeZone: 'America/Toronto', notes: '', totalCents: 200, participantIds: [ids.Bob, ids.Carol],
  });
  const owner = await membershipPage(env, 'alice-token', groupUrl);
  const bob = await membershipPage(env, 'bob-token', groupUrl, { width: 390, height: 844 });
  const carol = await membershipPage(env, 'carol-token', `${env.base}#/bills/${historical.id}`);
  for (const page of [owner, bob, carol]) await readyForMembership(page, group.id);
  const members = owner.getByRole('dialog', { name: group.name, exact: true });
  const bobMembers = bob.getByRole('dialog', { name: group.name, exact: true });
  await expectOwner(bobMembers, 'Alice');
  await expect(bobMembers.getByRole('button', { name: 'Get invitation link', exact: true })).toHaveCount(0);
  await members.getByRole('button', { name: 'Leave group', exact: true }).click();
  const leave = owner.getByRole('dialog', { name: `Leave ${group.name}?`, exact: true });
  const transfer = leave.getByRole('button', { name: 'Transfer and leave', exact: true });
  await expect(transfer).toBeDisabled();
  await leave.getByLabel('New owner', { exact: true }).selectOption(ids.Bob);
  await expect(leave).toContainText('Bob');
  await transfer.click();
  await expectDepartureHome(owner, env.base, group.name);
  await expectOwner(bobMembers, 'Bob');
  await expect(bobMembers).toContainText('2 members');
  await expect(bobMembers.getByRole('button', { name: 'Get invitation link', exact: true })).toBeVisible();
  await expect(bobMembers.getByRole('button', { name: 'Delete group', exact: true })).toBeVisible();
  await expect(memberRow(bobMembers, 'Carol').getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  // Retained bill history continues to identify Alice, not the new group owner.
  await expect(billPeople(carol).getByRole('listitem').filter({ hasText: 'Alice' })).toContainText('paid the bill');
  await expect(billPeople(carol).getByRole('listitem').filter({ hasText: 'Bob' })).not.toContainText('paid the bill');
  await bobMembers.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await bob.goto(`${env.base}#/bills/${bobBill.id}`);
  await expect(bob.getByText('INITIATOR CONTROLS', { exact: true })).toBeVisible();
  await bob.goto(`${env.base}#/bills/${historical.id}`);
  await expect(bob.getByText('INITIATOR CONTROLS', { exact: true })).toHaveCount(0);
  // The original creator returns as an ordinary member, without reclaiming ownership.
  await bob.goto(groupUrl);
  await bob.getByRole('button', { name: 'Get invitation link', exact: true }).click();
  const invitation = await bob.getByLabel('Invitation link', { exact: true }).inputValue();
  await owner.goto(invitation);
  await owner.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(owner.locator('.group-member-count')).toContainText('3 members');
  await owner.getByRole('button', { name: 'Members & invites', exact: true }).click();
  const returned = owner.getByRole('dialog', { name: group.name, exact: true });
  await expectOwner(returned, 'Bob');
  for (const name of ['Remove', 'Delete group', 'Get invitation link'])
    await expect(returned.getByRole('button', { name, exact: true })).toHaveCount(0);
}

// Actionable financial/activity reasons remain in the dialog until resolved.
// Check again rereads committed eligibility rather than trusting an earlier view.
async function groupDepartureBlockers(env) {
  const { group, ids, billsUrl } = await costcoFriends(env);
  await aliceBill(env, group.id, 'One-dollar share', 200, [ids.Alice, ids.Bob],
    [['alice-token', 100], ['bob-token', 100]]);
  const incomplete = await aliceBill(env, group.id, 'Unfinished purchase', 200, [ids.Alice, ids.Bob]);
  const { repayment } = await env.api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: ids.Alice, amountCents: 100,
  });
  const bob = await membershipPage(env, 'bob-token', billsUrl, { width: 390, height: 844 });
  await readyForMembership(bob, group.id);
  await bob.getByRole('button', { name: 'Members & invites', exact: true }).click();
  await bob.getByRole('button', { name: 'Leave group', exact: true }).click();
  const leave = bob.getByRole('dialog', { name: `Leave ${group.name}?`, exact: true });
  await expect(leave).toContainText(/owes.*\$1\.00/);
  await expect(leave).toContainText('Relevant incomplete bills:');
  await expect(leave).toContainText('Unfinished purchase');
  await expect(leave).toContainText('The Initiator must complete or cancel this bill');
  await expect(leave).toContainText('Relevant pending repayments:');
  await expect(leave).toContainText('Alice must confirm or reject this pending repayment.');
  await expect(leave.getByRole('button', { name: 'Leave group', exact: true })).toHaveCount(0);
  await env.api(`/bills/${incomplete.id}/cancel`, 'alice-token', 'POST', { revision: incomplete.revision });
  await leave.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(leave).not.toContainText('Relevant incomplete bills:');
  await expect(leave).toContainText('Relevant pending repayments:');
  await expect(leave).toContainText(/owes.*\$1\.00/);
  await env.api(`/repayments/${repayment.id}/decision`, 'alice-token', 'POST', { decision: 'confirmed' });
  await leave.getByRole('button', { name: 'Check again', exact: true }).click();
  const submit = leave.getByRole('button', { name: 'Leave group', exact: true });
  await expect(submit).toBeEnabled();
  await expect(leave).not.toContainText('Relevant pending repayments:');
  await submit.click();
  await expectDepartureHome(bob, env.base, group.name);
}

// A group holds at most 16 members.
async function groupCapacity(env) {
  const { pageFor, base } = env;
  const { group, invitationToken: token } = await costcoFriends(env);
  const newLink = `${base}#/join/${token}`;
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  await alice.goto(`${base}#/group-bills/${group.id}`);
  const ledger = alice.getByRole('region', { name: 'Group balances and repayments' });
  const invitationToken = newLink.split('/').pop();
  for (let i = 1; i <= 13; i++) {
    const response = await fetch(`${env.apiUrl}/api/groups/join`, {
      method: 'POST', headers: { Authorization: `Bearer member-${i}-token`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: invitationToken }),
    });
    assert.equal(response.status, 200);
  }
  const extra = await pageFor('member-14-token', { width: 390, height: 844 });
  await extra.goto(newLink);
  await extra.getByRole('button', { name: 'Join group', exact: true }).click();
  await expect(extra.getByRole('alert')).toContainText('This group is full. Groups can have up to 16 members.');
  await expect(ledger.getByRole('region', { name: "Everyone's balance" }).getByRole('listitem')).toHaveCount(16);
}

// Owner-only deletion of a cleared group, with eligibility reads and live member navigation (#76).
async function groupDeletion(env) {
  const { pageFor, base, pool } = env;
  // Alice and Bob share another group, so Home still lists their groups once this one is deleted.
  await costcoFriends(env);
  // Issue #76: owner-only deletion of a cleared group uses its own fixture.
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
  const blockedBill = await fetch(`${env.apiUrl}/api/groups/${deletionId}/bills`, {
    method: 'POST', headers: { Authorization: 'Bearer alice-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), title: 'Not settled', purchaseDate: '2026-01-01',
      timeZone: 'America/Toronto', notes: '', totalCents: 100,
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
  const canceled = await fetch(`${env.apiUrl}/api/bills/${bill.id}/cancel`, {
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
  // Both the owner and a member viewing the group return to Home.
  await expect(deleteOwner).toHaveURL(`${base}#`);
  await expect(deleteOwner.getByRole('heading', { name: 'Your groups' })).toBeVisible();
  await expect(homeRow(deleteOwner, 'Deletion smoke group')).toHaveCount(0);
  await expect(deleteMember).toHaveURL(`${base}#`);
  await expect(deleteMember.getByRole('heading', { name: 'Your groups' })).toBeVisible();
  await expect(homeRow(deleteMember, 'Deletion smoke group')).toHaveCount(0);
  await expect(deleteMember.getByRole('status').filter({ hasText: 'Deletion smoke group was deleted by the group owner' })).toBeVisible();
  await expect(deleteOwner.getByText('Deletion smoke group was deleted by the group owner')).toHaveCount(0);
  console.log('Delete group smoke passed: owner-only action, eligibility read, 409 race reasons, exact-name confirmation, and live member navigation with a deletion notice.');
}
