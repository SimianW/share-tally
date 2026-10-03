// Displayed names: the current Clerk Username, then Profile name, then Member,
// kept live across members, tabs, groups and old records (#206).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { costcoFriends, aliceBill, weekendGroceries, billPeople } from './fixtures.mjs';
import { homeRow, splitByAmount } from '../ui.mjs';

export const scenarios = [
  { name: 'member-renames', run: memberRenames },
];

// Stored records with stable identifiers, read straight from PostgreSQL.
async function financialRecords(pool) {
  const records = {};
  for (const query of [
    'SELECT id, clerk_user_id, created_at FROM users', 'SELECT * FROM group_members', 'SELECT * FROM bills',
    'SELECT * FROM bill_shares', 'SELECT * FROM bill_items', 'SELECT * FROM item_claims', 'SELECT * FROM repayments',
  ]) records[query] = (await pool.query(`${query} ORDER BY 1, 2`)).rows;
  return records;
}

// Another tab in the same browser session as `page`.
async function newTab(env, page, url) {
  const tab = await page.context().newPage();
  tab.setDefaultTimeout(10_000);
  tab.on('pageerror', error => env.errors.push(error.message));
  await tab.goto(url);
  return tab;
}

// Saves account fields through the account window, as a member does in Clerk.
async function editAccount(page, button, fields) {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Profile & security', exact: true }).click();
  const account = page.getByRole('dialog', { name: 'Clerk account' });
  await account.getByRole('button', { name: button, exact: true }).click();
  for (const [label, value] of Object.entries(fields)) await account.getByLabel(label, { exact: true }).fill(value);
  await account.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = Date.now();
  await expect(account.getByRole('button', { name: button, exact: true })).toBeVisible();
  await account.getByRole('button', { name: 'Close', exact: true }).click();
  // Other members' connected pages show the name within five seconds of the save.
  return () => ({ timeout: Math.max(1, saved + 5_000 - Date.now()) });
}

async function expectAccountName(page, name) {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.locator('.account-menu-identity strong')).toHaveText(name);
  await page.keyboard.press('Escape');
}

async function memberRenames(env) {
  const { api, base, pageFor, pool } = env;
  const { group, ids, billsUrl } = await costcoFriends(env);
  const { group: apartment } = await api('/groups', 'alice-token', 'POST', { name: 'Apartment', icon: { type: 'lucide', value: 'house' } });
  const apartmentInvitation = await api(`/groups/${apartment.id}/invitation`);
  await api('/groups/join', 'bob-token', 'POST', { token: apartmentInvitation.path.split('/').at(-1) });
  // Old and current records: a complete bill, an open bill, an item bill with a claim, and repayments.
  const complete = await weekendGroceries(env, group, ids);
  const open = await aliceBill(env, group.id, 'Open snacks', 3000, [ids.Alice, ids.Bob, ids.Carol], [['alice-token', 1000]]);
  const draftId = randomUUID();
  const apples = { id: randomUUID(), name: 'Apples', originalText: 'APPLES', quantity: '1', amountCents: 300, discountCents: 0, taxable: false, finalCents: 300, manualFinal: false };
  const draft = (await api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', { revision: 0, data: {
    mode: 'items', title: 'Fruit', purchaseDate: '2026-09-24', timeZone: 'America/Toronto', notes: '', totalCents: 300,
    participantIds: [ids.Alice, ids.Bob, ids.Carol],
    receipt: { subtotalCents: 300, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false }, items: [apples],
  } })).draft;
  const fruit = (await api(`/receipt-drafts/${draftId}/initialize`, 'alice-token', 'POST', { revision: draft.revision })).bill;
  await api(`/bills/${fruit.id}/claims`, 'bob-token', 'POST', {
    reviewedItems: fruit.items.map(({ id, version }) => ({ itemId: id, version })),
    claims: [{ itemId: apples.id, numerator: 1, denominator: 2 }],
  });
  const repay = async amountCents => (await api(`/groups/${group.id}/repayments`, 'bob-token', 'POST', {
    requestId: randomUUID(), recipientId: ids.Alice, amountCents,
  })).repayment;
  await api(`/repayments/${(await repay(1000)).id}/decision`, 'alice-token', 'POST', { decision: 'confirmed' });
  await api(`/repayments/${(await repay(500)).id}/decision`, 'alice-token', 'POST', { decision: 'rejected' });
  await repay(200);
  const stored = await financialRecords(pool);

  // Bob, who renames himself, on Home and, in another tab, the Apartment group.
  const bob = await pageFor('bob-token', { width: 1280, height: 900 });
  await bob.goto(base);
  await expect(bob.getByRole('heading', { level: 1 })).toContainText('Hey Bob');
  await expect(homeRow(bob, 'Costco friends').getByTitle('Bob', { exact: true })).toHaveCount(1);
  const bobApartment = await newTab(env, bob, `${base}#/group-bills/${apartment.id}`);
  await expect(bobApartment.locator('#main-content').getByTitle('Bob', { exact: true }).first()).toBeVisible();
  // Alice on the Costco page, and in another tab on the item bill with an unsaved claim.
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  await alice.goto(billsUrl);
  await expect(alice.getByText('Bob says they sent $2.00')).toBeVisible();
  const aliceFruit = await newTab(env, alice, `${base}#/bills/${fruit.id}`);
  await aliceFruit.getByRole('button', { name: 'View Apples · $3.00', exact: true }).click();
  const sheet = aliceFruit.getByRole('dialog', { name: 'Apples', exact: true });
  await expect(sheet.locator('.claim-legend')).toContainText('Bob · 1/2');
  await sheet.getByRole('button', { name: '1/4 · $0.75', exact: true }).click();
  // Picking the only item's portion closes its sheet, leaving the pick unsubmitted.
  await expect(sheet).toHaveCount(0);
  const unsubmitted = aliceFruit.getByText('Your portion 1/4 · not submitted');
  await expect(unsubmitted).toBeVisible();
  // Carol on the open bill with an unsaved share, and on Home in another tab.
  const carol = await pageFor('carol-token', { width: 390, height: 844 });
  await carol.goto(`${base}#/bills/${open.id}`);
  await expect(billPeople(carol)).toContainText('Bob');
  await carol.getByLabel('Your share (CAD)', { exact: true }).fill('7.77');
  const carolHome = await newTab(env, carol, base);
  await expect(homeRow(carolHome, 'Costco friends').getByTitle('Bob', { exact: true })).toHaveCount(1);
  // Participant pickers: Alice editing the open bill, and Carol starting a new one.
  const aliceEdit = await newTab(env, alice, `${base}#/bills/${open.id}`);
  await aliceEdit.getByRole('button', { name: 'Edit details & participants' }).click();
  const editPicker = aliceEdit.getByRole('dialog', { name: 'Edit bill' });
  await expect(editPicker.getByRole('checkbox', { name: 'Bob', exact: true })).toBeChecked();
  const carolNewBill = await newTab(env, carol, `${base}#/new-bill/${group.id}`);
  await splitByAmount(carolNewBill, '10.00');
  await expect(carolNewBill.getByRole('checkbox', { name: 'Bob', exact: true })).toBeVisible();

  // Bob saves a Username, which takes precedence over his Profile name.
  let within = await editAccount(bob, 'Update username', { Username: '111wsm' });
  await expect(bob.getByRole('heading', { level: 1 })).toContainText('Hey 111wsm', { timeout: 1_000 });
  await expectAccountName(bob, '111wsm');
  await expect(alice.getByText('111wsm says they sent $2.00')).toBeVisible(within());
  await expect(alice.getByRole('region', { name: 'Group balances and repayments' })).toContainText('111wsm', within());
  await expect(billPeople(aliceFruit)).toContainText('111wsm', within());
  await expect(billPeople(carol)).toContainText('111wsm', within());
  await expect(homeRow(carolHome, 'Costco friends').getByTitle('111wsm', { exact: true })).toHaveCount(1, within());
  await expect(bobApartment.locator('#main-content').getByTitle('111wsm', { exact: true }).first()).toBeVisible(within());
  await expect(homeRow(bob, 'Costco friends').getByTitle('111wsm', { exact: true })).toHaveCount(1, within());
  await expect(editPicker.getByRole('checkbox', { name: '111wsm', exact: true })).toBeChecked(within());
  await expect(carolNewBill.getByRole('checkbox', { name: '111wsm', exact: true })).toBeVisible(within());
  await expect(carolNewBill.getByRole('group', { name: "Who's in?" })).toBeVisible();
  // Unsaved input survives the refreshed names.
  await expect(unsubmitted).toBeVisible();
  await aliceFruit.getByRole('button', { name: 'View Apples · $3.00', exact: true }).click();
  await expect(sheet.locator('.claim-legend')).toContainText('111wsm · 1/2');
  await expect(sheet.getByRole('button', { name: '1/4 · $0.75', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(carol.getByLabel('Your share (CAD)', { exact: true })).toHaveValue('7.77');
  // Bob's other tab reloads his account too.
  await expectAccountName(bobApartment, '111wsm');

  // Old records use the current name: the repayment history and a completed bill.
  await alice.getByText('Older repayments (2)', { exact: true }).click();
  const history = alice.getByRole('region', { name: 'Repayment history' });
  await expect(history).toContainText('111wsm → Alice');
  await expect(history).not.toContainText('Bob');
  const aliceComplete = await newTab(env, alice, `${base}#/bills/${complete.id}`);
  await expect(billPeople(aliceComplete)).toContainText('111wsm');
  await expect(billPeople(aliceComplete)).not.toContainText('Bob');
  await aliceComplete.close();

  // Carol's pages lose their connection while Bob renames again, then catch up.
  await carol.context().route('**/api/**/events', route => route.abort());
  for (const page of [carol, carolHome]) await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await editAccount(bob, 'Update username', { Username: 'bobcat' });
  await expect(alice.getByText('bobcat says they sent $2.00')).toBeVisible(within());
  await expect(billPeople(carol)).toContainText('111wsm');
  await expect(homeRow(carolHome, 'Costco friends').getByTitle('111wsm', { exact: true })).toHaveCount(1);
  await carol.context().unroute('**/api/**/events');
  for (const page of [carol, carolHome]) await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(billPeople(carol)).toContainText('bobcat');
  await expect(homeRow(carolHome, 'Costco friends').getByTitle('bobcat', { exact: true })).toHaveCount(1);
  await expect(carol.getByLabel('Your share (CAD)', { exact: true })).toHaveValue('7.77');

  // Without a Username, the Profile name shows; a Profile name edit then follows.
  within = await editAccount(bob, 'Update username', { Username: '' });
  await expect(bob.getByRole('heading', { level: 1 })).toContainText('Hey Bob', { timeout: 1_000 });
  await expect(alice.getByText('Bob says they sent $2.00')).toBeVisible(within());
  within = await editAccount(bob, 'Update profile', { 'First name': 'Robert', 'Last name': 'Builder' });
  await expect(bob.getByRole('heading', { level: 1 })).toContainText('Hey Robert Builder', { timeout: 1_000 });
  await expect(alice.getByText('Robert Builder says they sent $2.00')).toBeVisible(within());
  await expect(sheet.locator('.claim-legend')).toContainText('Robert Builder · 1/2', within());
  await expect(sheet.getByRole('button', { name: '1/4 · $0.75', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Without either field, Member shows.
  within = await editAccount(bob, 'Update profile', { 'First name': '', 'Last name': '' });
  await expect(bob.getByRole('heading', { level: 1 })).toContainText('Hey Member', { timeout: 1_000 });
  await expect(alice.getByText('Member says they sent $2.00')).toBeVisible(within());

  // Renaming changed presentation only.
  assert.deepEqual(await financialRecords(pool), stored);

  // A member with an outdated cached name and no session is corrected by the
  // server's own synchronization, without signing in or editing again.
  await api('/groups/join', 'member-1-token', 'POST', { token: (await api(`/groups/${group.id}/invitation`)).path.split('/').at(-1) });
  await pool.query(`UPDATE users SET display_name = 'Old name' WHERE clerk_user_id = 'user_test_member_1'`);
  await alice.reload();
  await expect(alice.locator('#main-content').getByTitle('Old name', { exact: true }).first()).toBeVisible();
  await env.waitForServer('profile-set', { setProfile: { clerkUserId: 'user_test_member_1', username: 'quiet-friend' } });
  await env.waitForServer('profiles-synced', 'sync-profiles');
  await expect(alice.locator('#main-content').getByTitle('quiet-friend', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
}
