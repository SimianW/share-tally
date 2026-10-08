// Already-authorized data is shown while the group stream connects (#217).
// The authoritative read after `ready` still replaces it.
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { aliceBill, billSummary, costcoFriends } from './fixtures.mjs';
import { splitByAmount } from '../ui.mjs';

export const scenarios = [
  { name: 'provisional-bill-from-group', run: billFromGroup },
  { name: 'provisional-direct-bill', run: directBill },
  { name: 'provisional-new-bill-from-group', run: newBillFromGroup },
  { name: 'provisional-new-bill-direct', run: newBillDirect },
  { name: 'provisional-new-bill-denied', run: deniedCachedNewBill },
];

// Holds the group's next events request until released. Reaching it proves the
// page's authorized reads before subscription have finished. A channel attempt
// fails after 10 seconds, so each hold must be released well before then.
async function holdNextStream(page, groupId) {
  let release, captured = false;
  const held = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/groups/${groupId}/events`, async route => {
    captured = true;
    await held;
    await route.continue();
  }, { times: 1 });
  return { captured: () => captured, release };
}

// A bill opened from the group page appears before `ready`. An early share
// submission against a revision changed during the hold is rejected, and the
// page converges on the latest bill after release.
async function billFromGroup(env) {
  const { group, ids, billsUrl } = await costcoFriends(env);
  const title = 'Held stream groceries';
  const bill = await aliceBill(env, group.id, title, 10000, [ids.Alice, ids.Bob]);
  const bob = await env.pageFor('bob-token', { width: 1280, height: 900 });
  await bob.goto(billsUrl);
  const link = bob.getByRole('region', { name: 'Open bills', exact: true }).getByRole('link', { name: new RegExp(`^${title}\\b`) });
  await expect(link).toBeVisible();
  const stream = await holdNextStream(bob, group.id);
  await link.click();
  await expect.poll(stream.captured).toBe(true);
  await expect(bob.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(billSummary(bob)).toContainText('$100.00');
  await env.api(`/bills/${bill.id}`, 'alice-token', 'PATCH', {
    revision: bill.revision, title, purchaseDate: bill.purchaseDate, timeZone: 'America/Toronto',
    notes: '', totalCents: 10100, participantIds: [ids.Alice, ids.Bob],
  });
  await bob.getByLabel('Your share (CAD)', { exact: true }).fill('60.00');
  await bob.getByRole('button', { name: 'Submit and confirm my share', exact: true }).click();
  await expect(bob.getByRole('alert').filter({ hasText: 'This bill changed' })).toBeVisible();
  stream.release();
  await expect(billSummary(bob)).toContainText('$101.00');
  await expect(billSummary(bob)).toContainText('0 of 2 confirmed');
  await expect(bob.getByText('Loading bill...', { exact: true })).toHaveCount(0);
  await expect(bob.getByText('Live updates interrupted', { exact: false })).toHaveCount(0);
}

// A direct link needs only the bill lookup. A share confirmed by another
// participant during the hold appears after release without user action.
async function directBill(env) {
  const { group, ids } = await costcoFriends(env);
  const title = 'Direct held groceries';
  const bill = await aliceBill(env, group.id, title, 10000, [ids.Alice, ids.Bob]);
  const bob = await env.pageFor('bob-token', { width: 1280, height: 900 });
  const stream = await holdNextStream(bob, group.id);
  await bob.goto(`${env.base}#/bills/${bill.id}`);
  await expect.poll(stream.captured).toBe(true);
  await expect(bob.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(billSummary(bob)).toContainText('0 of 2 confirmed');
  await env.api(`/bills/${bill.id}/share`, 'alice-token', 'POST', { revision: bill.revision, expectedAmountCents: null, amountCents: 4000 });
  stream.release();
  await expect(billSummary(bob)).toContainText('1 of 2 confirmed');
  await expect(bob.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

// The group page caches the group's details, so New bill and Continue render
// from them before `ready`. The later snapshot updates the participant choices
// and keeps unsent input.
async function newBillFromGroup(env) {
  const { group, ids, billsUrl, invitationToken } = await costcoFriends(env);
  const draftId = randomUUID();
  await env.api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', {
    revision: 0,
    data: {
      mode: 'manual', title: 'Saved before ready', purchaseDate: '2026-10-01', timeZone: 'America/Toronto',
      notes: '', totalCents: null, participantIds: [ids.Alice], items: [],
      receipt: { subtotalCents: null, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
    },
  });
  const alice = await env.pageFor('alice-token', { width: 1280, height: 1000 });
  await alice.goto(billsUrl);
  const draftRow = alice.locator('.draft-list-row').filter({ hasText: 'Saved before ready' });
  await expect(draftRow).toBeVisible();
  let stream = await holdNextStream(alice, group.id);
  await draftRow.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(stream.captured).toBe(true);
  await expect(alice.getByRole('heading', { name: 'Continue your draft · Costco friends', exact: true })).toBeVisible();
  stream.release();
  await alice.goto(billsUrl);
  await expect(alice.getByRole('button', { name: 'New bill', exact: true })).toBeVisible();

  stream = await holdNextStream(alice, group.id);
  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  await expect.poll(stream.captured).toBe(true);
  await expect(alice.getByRole('heading', { name: 'New bill · Costco friends', exact: true })).toBeVisible();
  await splitByAmount(alice, '10.00');
  await expect(alice.getByRole('heading', { name: 'Who’s sharing this bill?' })).toBeVisible();
  const people = alice.getByRole('group', { name: "Who's in?", exact: true });
  await expect(people).toContainText('of 3');
  await alice.getByLabel('Bill title', { exact: true }).fill('Typed before ready');
  await env.api('/groups/join', 'member-1-token', 'POST', { token: invitationToken });
  stream.release();
  await expect(people).toContainText('of 4');
  await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Typed before ready');
  await expect(alice.getByText('Opening group…', { exact: true })).toHaveCount(0);
}

// With nothing cached, New bill waits for the group as before.
async function newBillDirect(env) {
  const { group } = await costcoFriends(env);
  const alice = await env.pageFor('alice-token', { width: 1280, height: 1000 });
  const stream = await holdNextStream(alice, group.id);
  await alice.goto(`${env.base}#/new-bill/${group.id}`);
  await expect.poll(stream.captured).toBe(true);
  await expect(alice.getByText('Opening group…', { exact: true })).toBeVisible();
  await expect(alice.getByRole('heading', { name: 'New bill · Costco friends', exact: true })).toHaveCount(0);
  stream.release();
  await expect(alice.getByRole('heading', { name: 'New bill · Costco friends', exact: true })).toBeVisible();
  await expect(alice.getByText('Opening group…', { exact: true })).toHaveCount(0);
}

// Cached group details must not outlive a stream denial.
async function deniedCachedNewBill(env) {
  const { group, billsUrl } = await costcoFriends(env);
  const alice = await env.pageFor('alice-token', { width: 1280, height: 1000 });
  await alice.goto(billsUrl);
  await expect(alice.getByRole('button', { name: 'New bill', exact: true })).toBeVisible();
  await alice.route(`**/api/groups/${group.id}/events`, route => route.fulfill({ status: 403, json: { error: 'Group access denied.' } }));
  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  await expect(alice.getByRole('alert')).toContainText('Could not open this group');
  await expect(alice.getByRole('heading', { name: 'New bill · Costco friends', exact: true })).toHaveCount(0);
  await expect(alice.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  await expect(alice.getByText('Opening group…', { exact: true })).toHaveCount(0);
}
