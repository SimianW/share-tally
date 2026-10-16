// Bill scenarios: sharing, confirming, correcting and live updates.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { screenshots } from '../environment.mjs';
import { aliceBill, costcoFriends, weekendGroceries, shareTicket, billSummary, billPanel, billPeople } from './fixtures.mjs';
import { groupNet, homeRow, homeGroupNames, openGroupSwitcher, splitByAmount, splitMethod } from '../ui.mjs';

export const scenarios = [
  { name: 'bill-sharing', run: billSharing },
  { name: 'manual-share-nothing', run: manualShareNothing },
  { name: 'manual-share-cleared', run: manualShareCleared },
  { name: 'bill-corrections', run: billCorrections },
  { name: 'bill-live-updates', run: billLiveUpdates },
];

async function manualShareNothing(env) {
  const { pageFor, base } = env;
  const { group, ids } = await costcoFriends(env);
  const bill = await aliceBill(env, group.id, 'Nothing purchased', 10000, [ids.Alice, ids.Bob]);
  const bob = await pageFor('bob-token', { width: 1280, height: 900 });
  await bob.goto(`${base}#/bills/${bill.id}`);
  const input = bob.getByLabel('Your share (CAD)', { exact: true });
  const nothing = bob.getByRole('button', { name: 'Confirm I purchased nothing', exact: true });
  const submit = bob.getByRole('button', { name: 'Submit and confirm my share', exact: true });
  const ownRow = billPeople(bob).getByRole('listitem').filter({ hasText: 'Bob (you)' });
  await expect(input).toHaveValue('');
  await expect(nothing).toBeEnabled();
  await expect(bob.getByText('Include your tax, discounts, and rounding. Leave this empty if you purchased nothing.', { exact: true })).toBeVisible();
  for (const amount of ['25.00', '0', '0.00']) {
    await input.fill(amount);
    await expect(submit).toBeEnabled();
    await expect(nothing).toHaveCount(0);
  }
  for (const [amount, message] of [
    ['oops', 'Enter an amount with at most two decimal places.'],
    ['101.00', 'Your share cannot exceed the bill total.'],
  ]) {
    await input.fill(amount);
    await expect(submit).toBeEnabled();
    await expect(nothing).toHaveCount(0);
    await submit.click();
    await expect(bob.getByText(message, { exact: true })).toBeVisible();
    await bob.reload();
    await expect(ownRow).toContainText('Not confirmed');
    await expect(ownRow).toContainText('—');
    await expect(input).toHaveValue('');
  }
  await nothing.click();
  await expect(bob.getByRole('heading', { name: 'Your share is confirmed.' })).toBeVisible();
  await bob.reload();
  await expect(ownRow.getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(ownRow).toContainText('$0.00');
  await bob.context().close();
}

async function manualShareCleared(env) {
  const { pageFor, base } = env;
  const { group, ids } = await costcoFriends(env);
  const bill = await aliceBill(env, group.id, 'Changed my share to nothing', 10000, [ids.Alice, ids.Bob, ids.Carol], [
    ['alice-token', 4000], ['bob-token', 2000],
  ]);
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  await alice.goto(`${base}#/bills/${bill.id}`);
  const input = alice.getByLabel('Your share (CAD)', { exact: true });
  const nothing = alice.getByRole('button', { name: 'Confirm I purchased nothing', exact: true });
  const people = billPeople(alice).getByRole('listitem');
  const ownRow = people.filter({ hasText: 'Alice (you)' });
  const bobRow = people.filter({ hasText: 'Bob' });
  await expect(input).toHaveValue('40.00');
  await input.fill('');
  await expect(nothing).toBeEnabled();
  await input.fill('   ');
  await expect(nothing).toBeEnabled();
  await nothing.click();
  await expect(ownRow).toContainText('$0.00');
  await expect(ownRow).toContainText('Confirmed, paid the bill');
  await expect(bobRow.getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(bobRow).toContainText('$20.00');
  await input.fill('   ');
  await expect(nothing).toBeDisabled();
  await alice.reload();
  await expect(ownRow).toContainText('$0.00');
  await expect(ownRow).toContainText('Confirmed, paid the bill');
  await expect(bobRow.getByText('Confirmed', { exact: true })).toBeVisible();
  await input.fill('');
  await expect(nothing).toBeDisabled();
  await alice.context().close();
}

// Creating a bill with a response-loss retry, live snapshots, share confirmation, the initiator adjustment and balances (#4).
async function billSharing(env) {
  const { pageFor, base } = env;
  const { group, groupUrl } = await costcoFriends(env);
  // Alice starts in the members dialog, Bob signed in on his phone, Carol on the group page.
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  await alice.goto(groupUrl);
  const bob = await pageFor('bob-token', { width: 390, height: 844 });
  const carol = await pageFor('carol-token', { width: 1280, height: 900 });
  await carol.goto(`${base}#/group-bills/${group.id}`);
  // Wait for an actual subscribed snapshot; an empty selector also matches the loading screen.
  await expect(groupNet(carol)).toContainText("You're settled up");
  await expect(carol.getByRole('region', { name: 'Open bills', exact: true }).getByRole('link')).toHaveCount(0);
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
  const people = alice.getByRole('group', { name: "Who's in?" });
  await expect(splitMethod(alice).or(people).first()).toBeVisible();
  if (await splitMethod(alice).count()) await splitByAmount(alice, '100.00');
  await expect(people).toBeVisible();
  await expect(alice.getByRole('checkbox', { name: 'You', exact: true })).toBeDisabled();
  await alice.getByRole('button', { name: 'Everyone', exact: true }).click();
  await expect(alice.getByRole('checkbox', { name: 'Carol', exact: true })).toBeChecked();
  await alice.getByRole('button', { name: 'Just me', exact: true }).click();
  await expect(alice.getByRole('checkbox', { name: 'Carol', exact: true })).not.toBeChecked();
  await alice.getByLabel('Bill title', { exact: true }).fill('Weekend groceries');
  await alice.getByLabel('Total paid (CAD)', { exact: true }).fill('100.00');
  await alice.getByLabel('Total paid (CAD)', { exact: true }).fill('100.001');
  await expect(alice.getByLabel('Your share (CAD)', { exact: true })).toHaveCount(0);
  await alice.getByRole('checkbox', { name: 'Bob', exact: true }).check();
  await alice.getByRole('button', { name: 'Share bill' }).click();
  assert.equal(await alice.getByLabel('Total paid (CAD)', { exact: true }).evaluate(el => el.validity.valid), false);
  await alice.getByLabel('Total paid (CAD)', { exact: true }).fill('100.00');
  let creationAttempts = 0;
  await alice.route('**/api/receipt-drafts/*/initialize', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    creationAttempts++;
    if (creationAttempts === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await alice.getByRole('button', { name: 'Share bill' }).click();
  await expect(alice.getByRole('button', { name: 'Retry sharing' })).toBeVisible();
  releaseSnapshot();
  await expect(carol.getByRole('region', { name: 'Open bills', exact: true }).getByRole('link')).toContainText('Weekend groceries', { timeout: 3000 });
  await alice.reload();
  // The new-bill page is its own route, so a reload restores the unsent bill in place.
  await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Weekend groceries');
  await alice.getByRole('button', { name: 'Retry sharing' }).click();
  await expect(alice.getByRole('heading', { name: 'Weekend groceries' })).toBeVisible();
  assert.equal(creationAttempts, 2);
  await expect(alice.getByText('paid by you, in CAD', { exact: false })).toBeVisible();
  await expect(billSummary(alice).getByText('In progress', { exact: true })).toBeVisible();
  await expect(billSummary(alice)).toContainText(/Total\s*\$100\.00/);
  await expect(billSummary(alice)).toContainText(/Left to match\s*\$100\.00/);
  await expect(billSummary(alice)).toContainText('0 of 2 confirmed');
  await expect(shareTicket(alice)).toContainText('Not submitted yet');
  await expect(shareTicket(alice).getByText('Needs your confirmation', { exact: true })).toBeVisible();
  await alice.getByLabel('Your share (CAD)', { exact: true }).fill('40.00');
  await alice.getByRole('button', { name: 'Submit and confirm my share' }).click();
  await expect(billSummary(alice)).toContainText(/Left to match\s*\$60\.00/);
  await expect(billSummary(alice)).toContainText('1 of 2 confirmed');
  await expect(shareTicket(alice)).toContainText('$40.00');
  await expect(shareTicket(alice).getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(shareTicket(alice)).toContainText("You're done for now. Waiting on Bob.");
  await expect(billPanel(alice)).toContainText('Waiting for Bob to confirm.');
  await expect(billPanel(alice)).toContainText('Up to 5¢ of difference goes to the initiator');
  await expect(alice.locator('.bill-header').getByRole('button', { name: 'Cancel this bill', exact: true })).toBeVisible();
  const billUrl = alice.url();
  await bob.goto(base);
  const bobAttention = bob.getByRole('region', { name: 'Needs your attention' });
  await expect(bobAttention.getByRole('link', { name: /Enter your share.*Weekend groceries/ })).toBeVisible();
  // A member with one group still lands on Home, and the heading counts the same actions as the list.
  await expect(bob).toHaveURL(base);
  assert.deepEqual(await homeGroupNames(bob), ['Costco friends']);
  await expect(homeRow(bob, 'Costco friends')).toContainText('All square Settled');
  await expect(homeRow(bob, 'Costco friends')).toContainText('1 to do');
  await bob.screenshot({ path: `${screenshots}/home-pending-mobile.png`, fullPage: true, animations: 'disabled' });
  await bob.setViewportSize({ width: 1280, height: 900 });
  await bob.screenshot({ path: `${screenshots}/home-pending-desktop.png`, fullPage: true, animations: 'disabled' });
  await bob.setViewportSize({ width: 390, height: 844 });
  await homeRow(bob, 'Costco friends').click();
  const pendingOptions = await openGroupSwitcher(bob);
  const singularBadge = pendingOptions.getByRole('option', { name: /Costco friends.*1 pending action/ }).locator('.group-switcher-count');
  await expect(singularBadge).toHaveText('1 pending action');
  await expect(singularBadge).not.toHaveAttribute('aria-label', /pending action/);
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Pending dropdown overflows at 390px');
  await bob.screenshot({ path: `${screenshots}/group-switcher-pending-mobile.png`, animations: 'disabled' });
  await bob.setViewportSize({ width: 1280, height: 900 });
  await bob.screenshot({ path: `${screenshots}/group-switcher-pending-desktop.png`, animations: 'disabled' });
  await bob.setViewportSize({ width: 390, height: 844 });
  await bob.goto(base);
  await expect(bob.getByRole('heading', { level: 1 })).toHaveText('Hey Bob, 1 thing needs you');
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await bob.screenshot({ path: `${screenshots}/attention-mobile.png`, fullPage: true });
  await bobAttention.getByRole('link', { name: /Enter your share.*Weekend groceries/ }).click();
  await expect(bob).toHaveURL(billUrl);
  await expect(shareTicket(bob)).toContainText('Not submitted yet');
  await expect(shareTicket(bob).getByText('Needs your confirmation', { exact: true })).toBeVisible();
  await expect(shareTicket(bob)).toContainText('Enter what you owe, including tax, and confirm it.');
  await expect(shareTicket(bob).getByLabel('Your share (CAD)', { exact: true })).toBeVisible();
  await expect(bob.getByText('paid by Alice, in CAD', { exact: false })).toBeVisible();
  await expect(billPanel(bob)).toContainText('Waiting for you to confirm.');
  // Check the people rows on another member's desktop view.
  await bob.setViewportSize({ width: 1280, height: 900 });
  const bobPeople = billPeople(bob).getByRole('listitem');
  await expect(bobPeople.filter({ hasText: 'Alice' })).toContainText('Confirmed, paid the bill');
  await expect(bobPeople.filter({ hasText: 'Bob (you)' })).toContainText('Not confirmed');
  await expect(bobPeople.filter({ hasText: 'Bob (you)' })).toContainText('—');
  const aliceAvatar = bobPeople.filter({ hasText: 'Alice' }).locator('.avatar');
  await expect(aliceAvatar.locator('img')).toBeVisible();
  assert.equal(await aliceAvatar.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  const bobAvatar = bobPeople.filter({ hasText: 'Bob' }).locator('.avatar');
  await expect(bobAvatar).toHaveText('B');
  await expect(bobAvatar).toHaveCSS('display', 'flex');
  await expect(bobAvatar).toHaveCSS('align-items', 'center');
  await expect(bobAvatar).toHaveCSS('justify-content', 'center');
  await bob.setViewportSize({ width: 390, height: 844 });
  await bob.getByLabel('Your share (CAD)', { exact: true }).fill('59.97');
  let shareAttempts = 0;
  await bob.route('**/api/bills/*/share', async route => {
    const response = await route.fetch();
    shareAttempts++;
    if (shareAttempts === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  const liveStarted = Date.now();
  await bob.getByRole('button', { name: 'Submit and confirm my share' }).click();
  await expect(carol.getByRole('region', { name: 'History', exact: true }).getByRole('link')).toContainText('Complete', { timeout: 3000 });
  await expect(carol.getByRole('region', { name: 'Group balances and repayments' })).toContainText('$59.97');
  console.log(`Live completion observed within ${Date.now() - liveStarted} ms of the submit click`);
  await expect(bob.getByRole('button', { name: 'Retry confirmation' })).toBeVisible();
  // The committed stream snapshot resolves the uncertain response without replaying the write.
  await expect(bob.locator('.share-form button[type=submit]')).toBeDisabled();
  await expect(billSummary(bob).getByText('Complete', { exact: true })).toBeVisible();
  await expect(billSummary(bob)).toContainText(/Adjustment\s*\+\$0\.03/);
  await expect(billPanel(bob)).toContainText('$40.03 effective cost');
  await expect(billPanel(bob)).toContainText('Complete and final.');
  await expect(shareTicket(bob).getByText('Final', { exact: true })).toBeVisible();
  await expect(shareTicket(bob)).toContainText('Your final share');
  await expect(shareTicket(bob)).toContainText('Your final share is $59.97 of the $100.00 bill. Nothing left to confirm.');

  await expect(billSummary(alice).getByText('Complete', { exact: true })).toBeVisible();
  // The initiator's ticket breaks down how the adjustment reaches their cost.
  await expect(shareTicket(alice).getByText('Final', { exact: true })).toBeVisible();
  await expect(shareTicket(alice)).toContainText(/You submitted\s*\$40\.00/);
  await expect(shareTicket(alice)).toContainText(/Initiator adjustment\s*\+\$0\.03/);
  await expect(shareTicket(alice)).toContainText(/Effective cost\s*\$40\.03/);
  await carol.goto(billUrl);
  await expect(shareTicket(carol)).toContainText("You're not on this bill");
  await expect(shareTicket(carol).getByText('Viewing only', { exact: true })).toBeVisible();
  await expect(carol.getByLabel('Your share (CAD)', { exact: true })).toHaveCount(0);
  await expect(carol.getByRole('button', { name: 'Submit and confirm my share' })).toHaveCount(0);
  await alice.screenshot({ path: `${screenshots}/bills-desktop.png`, fullPage: true });
  await bob.screenshot({ path: `${screenshots}/bills-mobile.png`, fullPage: true });
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.getByRole('link', { name: 'Group bills', exact: false }).click();
  await expect(alice.getByRole('region', { name: 'History', exact: true }).getByRole('link')).toHaveCount(1);
  await expect(groupNet(alice)).toContainText('$59.97');
  const aliceGroupBalance = await groupNet(alice).innerText().then(text => text.match(/\$[\d,.]+/)[0]);
  await alice.getByRole('link', { name: 'ShareTally home', exact: true }).click();
  // Home's row shows the group page's number; there is no cross-group balance.
  await expect(homeRow(alice, 'Costco friends')).toContainText(`You're owed ${aliceGroupBalance}`);
  await expect(homeRow(alice, 'Costco friends')).toContainText('Nothing to do');
  await expect(alice.getByRole('region', { name: 'Where you stand' })).toHaveCount(0);
  await expect(alice.getByText(/ACROSS YOUR GROUPS|, net/)).toHaveCount(0);
  await bob.goto(base);
  await expect(homeRow(bob, 'Costco friends')).toContainText(`You owe ${aliceGroupBalance}`);
  await expect(homeRow(bob, 'Costco friends')).toContainText('Nothing to do');
}

// Completed bills are final; corrections, reconfirmation, participant removal and cancellation start from incomplete bills (#5).
async function billCorrections(env) {
  const { pageFor, base } = env;
  const { group, ids } = await costcoFriends(env);
  const billUrl = `${base}#/bills/${(await weekendGroceries(env, group, ids)).id}`;
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  // Issue #5: completed bills are final; corrections start from incomplete bills.
  const bobAgain = await pageFor('bob-token', { width: 390, height: 844 });
  await alice.goto(billUrl);
  await expect(billPanel(alice)).toContainText('Complete and final.');
  await expect(alice.getByRole('button', { name: 'Edit details & participants' })).toHaveCount(0);
  await expect(alice.getByLabel('Your share (CAD)', { exact: true })).toHaveCount(0);
  async function incompleteBill(title) {
    await alice.getByRole('link', { name: 'Group bills', exact: false }).click();
    await alice.getByRole('button', { name: 'New bill', exact: true }).click();
    await splitByAmount(alice, '100.00');
    await alice.getByLabel('Bill title', { exact: true }).fill(title);
    await alice.getByLabel('Total paid (CAD)', { exact: true }).fill('100.00');
    await expect(alice.getByLabel('Your share (CAD)', { exact: true })).toHaveCount(0);
    await alice.getByRole('checkbox', { name: 'Bob', exact: true }).check();
    await alice.getByRole('button', { name: 'Share bill' }).click();
    await expect(alice.getByRole('heading', { name: title })).toBeVisible();
    await expect(shareTicket(alice)).toContainText('Not submitted yet');
    await alice.getByLabel('Your share (CAD)', { exact: true }).fill('40.00');
    await alice.getByRole('button', { name: 'Submit and confirm my share' }).click();
    await expect(billSummary(alice)).toContainText('1 of 2 confirmed');
    await bobAgain.goto(alice.url());
    await bobAgain.getByLabel('Your share (CAD)', { exact: true }).fill('59.00');
    await bobAgain.getByRole('button', { name: 'Submit and confirm my share' }).click();
    await expect(billSummary(bobAgain)).toContainText('2 of 2 confirmed');
    await expect(billSummary(bobAgain).getByText('Needs correction', { exact: true })).toBeVisible();
    await expect(shareTicket(bobAgain).getByText('Check your amount', { exact: true })).toBeVisible();
    await expect(shareTicket(bobAgain)).toContainText('Shares are $1.00 under the total.');
    const correction = bobAgain.getByRole('alert').filter({ hasText: 'Shares are $1.00 under the total' });
    await expect(correction).toBeVisible();
    await expect(correction).toContainText('within $0.05');
    await expect(correction.getByRole('button', { name: 'Dismiss notification' })).toHaveCount(0);
    await correction.getByRole('button', { name: 'Edit my share' }).click();
    await expect(bobAgain.getByLabel('Your share (CAD)', { exact: true })).toBeFocused();

  }
  await incompleteBill('Correctable groceries');
  // Initiator controls join export in the header, before the share form.
  const headerActions = alice.locator('.bill-header').getByRole('group', { name: 'Bill actions', exact: true });
  const editBill = headerActions.getByRole('group', { name: 'Initiator controls', exact: true }).getByRole('button', { name: 'Edit details & participants' });
  await expect(editBill).toBeVisible();
  await expect(headerActions.getByRole('button', { name: 'Export bill file' })).toBeVisible();
  assert.equal(await editBill.evaluate(edit =>
    Boolean(edit.compareDocumentPosition(document.getElementById('my-share-amount')) & Node.DOCUMENT_POSITION_FOLLOWING),
  ), true, 'Header controls precede the share form in DOM order');
  // At 390px the bill summary strip comes before the Your share card, without overflow.
  const summaryBox = await billSummary(bobAgain).boundingBox();
  const ticketBox = await shareTicket(bobAgain).boundingBox();
  assert.ok(summaryBox.y + summaryBox.height <= ticketBox.y, 'Mobile bill summary precedes the Your share card');
  assert.equal(await bobAgain.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Bill page overflows at 390px');
  await bobAgain.screenshot({ path: `${screenshots}/bill-correction-mobile.png`, fullPage: true });
  // Only a total change clears confirmations (ADR-0015); preserve Bob's draft on the next revision.
  await alice.getByRole('button', { name: 'Edit details & participants' }).click();
  await alice.getByRole('dialog').getByLabel('Total · CAD', { exact: true }).fill('101.00');
  await alice.getByRole('dialog').getByLabel('Notes').fill('Initial correction');
  await alice.getByRole('button', { name: 'Save & request confirmations' }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await bobAgain.goto(base);
  await bobAgain.getByRole('region', { name: 'Needs your attention' }).getByRole('link', { name: /Confirm your share.*Correctable groceries/ }).click();
  await expect(bobAgain.getByRole('button', { name: 'Confirm my share', exact: true })).toBeVisible();
  await bobAgain.getByLabel('Your share (CAD)', { exact: true }).fill('60.00');
  await alice.getByRole('button', { name: 'Edit details & participants' }).click();
  // Restore the final total so Alice's $40 and Bob's $60 keep the later ledger figures unchanged.
  await alice.getByRole('dialog').getByLabel('Total · CAD', { exact: true }).fill('100.00');
  await alice.getByRole('dialog').getByLabel('Notes').fill('Corrected purchase notes');
  await alice.getByRole('button', { name: 'Save & request confirmations' }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await expect(bobAgain.getByRole('alert').filter({ hasText: 'This bill changed' })).toBeVisible();
  await expect(bobAgain.getByRole('button', { name: 'Save changed amount', exact: true })).toBeDisabled();
  await expect(bobAgain.getByLabel('Your share (CAD)', { exact: true })).toHaveValue('60.00');
  await bobAgain.getByRole('button', { name: 'Review latest bill' }).click();
  await expect(bobAgain.getByText('Corrected purchase notes', { exact: true })).toBeVisible();
  await bobAgain.getByLabel('Your share (CAD)', { exact: true }).fill('60.00');
  await bobAgain.getByRole('button', { name: 'Save changed amount' }).click();
  // Saving the changed share confirms Bob immediately (ADR-0015).
  await expect(billSummary(bobAgain)).toContainText('1 of 2 confirmed');

  // Bob's share save does not advance the revision, so Alice can confirm without another review (ADR-0015).
  await alice.getByRole('button', { name: 'Confirm my share', exact: true }).click();
  await expect(billSummary(alice).getByText('Complete', { exact: true })).toBeVisible();
  await alice.screenshot({ path: `${screenshots}/bill-corrected-desktop.png`, fullPage: true });
  await expect(alice.getByRole('button', { name: 'Edit details & participants' })).toHaveCount(0);
  await incompleteBill('Canceled groceries');
  await alice.getByRole('button', { name: 'Edit details & participants' }).click();
  await expect(alice.getByRole('dialog').getByRole('checkbox', { name: 'You', exact: true })).toBeDisabled();
  await alice.getByRole('dialog').getByRole('checkbox', { name: 'Bob', exact: true }).uncheck();
  await alice.getByRole('button', { name: 'Save & request confirmations' }).click();
  // Removing Bob leaves Alice's unchanged share confirmation intact (ADR-0015).
  await expect(billSummary(alice)).toContainText('1 of 1 confirmed');
  await bobAgain.reload();
  await expect(shareTicket(bobAgain)).toContainText("You're not on this bill");
  await expect(bobAgain.getByLabel('Your share (CAD)', { exact: true })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Cancel this bill', exact: true }).click();
  await alice.getByRole('button', { name: 'Yes, cancel bill' }).click();
  await expect(billSummary(alice).getByText('Canceled', { exact: true })).toBeVisible();
  await expect(shareTicket(alice).getByText('Canceled', { exact: true })).toBeVisible();
  await expect(shareTicket(alice).locator('s')).toHaveText('$40.00');
  await expect(billPanel(alice)).toContainText('Canceled bills are excluded from balances.');
  await bobAgain.reload();
  await expect(billSummary(bobAgain).getByText('Canceled', { exact: true })).toBeVisible();
  assert.equal(await bobAgain.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await bobAgain.screenshot({ path: `${screenshots}/bill-canceled-mobile.png`, fullPage: true });
  await alice.getByRole('link', { name: 'Group bills', exact: false }).click();
  // History hides canceled bills until revealed; the retained record stays linked (#201).
  const history = alice.getByRole('region', { name: 'History', exact: true });
  await expect(history.getByRole('link').filter({ hasText: 'Canceled groceries' })).toHaveCount(0);
  await history.getByRole('button', { name: 'Show canceled · 1' }).click();
  await expect(history.getByRole('link').filter({ hasText: 'Canceled groceries' })).toContainText('Canceled');
  await expect(groupNet(alice)).toContainText('$119.97');
}

// Overage warnings, the unclaimed remainder, drafts kept through live changes, and rolling amounts.
async function billLiveUpdates(env) {
  const { api, pageFor, base } = env;
  const { group } = await costcoFriends(env);
  const ledgerUrl = `${base}#/group-bills/${group.id}`;
  const liveApi = api;
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  const carol = await pageFor('carol-token', { width: 390, height: 844 });
  // Live drafts remain mounted through progress updates and terminal changes.
  const liveGroupId = ledgerUrl.split('/').pop();
  const liveGroup = (await liveApi(`/groups/${liveGroupId}`, 'alice-token')).group;
  const liveIds = Object.fromEntries(liveGroup.members.map(member => [member.displayName, member.id]));
  // Even an overage within tolerance cannot make the initiator's cost negative.
  const { bill: negativeAdjustment } = await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), title: 'Small overage', purchaseDate: '2026-01-01',
    timeZone: 'America/Toronto', notes: '', totalCents: 10000,
    participantIds: [liveIds.Alice, liveIds.Bob, liveIds.Carol],
  });
  await liveApi(`/bills/${negativeAdjustment.id}/share`, 'alice-token', 'POST', { revision: 1, expectedAmountCents: null, amountCents: 0 });
  await liveApi(`/bills/${negativeAdjustment.id}/share`, 'bob-token', 'POST', { revision: 1, expectedAmountCents: null, amountCents: 5000 });
  await carol.goto(`${base}#/bills/${negativeAdjustment.id}`);
  await carol.getByLabel('Your share (CAD)', { exact: true }).fill('50.03');
  await carol.getByRole('button', { name: 'Submit and confirm my share' }).click();
  await expect(billSummary(carol)).toContainText('3 of 3 confirmed');
  // With nobody left to wait for, the panel still states the completion rule.
  await expect(billPanel(carol)).toContainText('Up to 5¢ of difference goes to the initiator');
  await expect(billPanel(carol)).not.toContainText('Waiting for');
  const negativeWarning = carol.getByRole('alert').filter({ hasText: 'Shares are $0.03 over the total' });
  await expect(negativeWarning).toBeVisible();
  await expect(negativeWarning).toContainText('below $0.00');
  await expect(carol.locator('.notification-success')).toHaveCount(0);
  await expect(negativeWarning.getByRole('button', { name: 'Dismiss notification' })).toHaveCount(0);
  await negativeWarning.getByRole('button', { name: 'Edit my share' }).click();
  await expect(carol.getByLabel('Your share (CAD)', { exact: true })).toBeFocused();
  // Cancel the fixture so it does not affect subsequent attention checks.
  await liveApi(`/bills/${negativeAdjustment.id}/cancel`, 'alice-token', 'POST', { revision: 1 });
  // An item-based bill's initiator who confirms without claims sees the
  // unclaimed remainder as their own cost.
  const itemDraftId = crypto.randomUUID();
  const { draft: itemDraft } = await liveApi(`/groups/${liveGroupId}/receipt-drafts/${itemDraftId}`, 'alice-token', 'PUT', {
    revision: 0,
    data: {
      mode: 'items', title: 'Unclaimed apples', purchaseDate: '2026-01-01', timeZone: 'America/Toronto', notes: '',
      totalCents: 2000, participantIds: [liveIds.Alice, liveIds.Bob],
      receipt: { subtotalCents: 2000, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: [{ id: crypto.randomUUID(), name: 'Shared apples', originalText: 'APPLES', quantity: '1',
        amountCents: 2000, discountCents: 0, taxable: false, finalCents: 2000, manualFinal: false }],
    },
  });
  const { bill: itemBill } = await liveApi(`/receipt-drafts/${itemDraftId}/initialize`, 'alice-token', 'POST', { revision: itemDraft.revision });
  await liveApi(`/bills/${itemBill.id}/claims`, 'alice-token', 'POST', {
    reviewedItems: itemBill.items.map(({ id, version }) => ({ itemId: id, version })), claims: [],
  });
  await alice.goto(`${base}#/bills/${itemBill.id}`);
  await expect(shareTicket(alice).getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(shareTicket(alice)).toContainText(/Your claims\s*\$0\.00/);
  await expect(shareTicket(alice)).toContainText(/Unassigned, yours as initiator\s*\+\$20\.00/);
  await expect(shareTicket(alice)).toContainText(/Effective cost\s*\$20\.00/);
  await expect(billSummary(alice)).toContainText(/Unclaimed \(initiator\)\s*\$20\.00/);
  await expect(billPanel(alice)).toContainText('Every item must be fully claimed');
  await alice.screenshot({ path: `${screenshots}/bill-items-initiator-desktop.png`, fullPage: true });
  await liveApi(`/bills/${itemBill.id}/cancel`, 'alice-token', 'POST', { revision: (await liveApi(`/bills/${itemBill.id}`)).bill.revision });
  const { bill: liveBill } = await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), title: 'Live draft protection', purchaseDate: '2026-01-01',
    timeZone: 'America/Toronto', notes: '', totalCents: 10000,
    participantIds: [liveIds.Alice, liveIds.Bob, liveIds.Carol],
  });
  await liveApi(`/bills/${liveBill.id}/share`, 'alice-token', 'POST', { revision: 1, expectedAmountCents: null, amountCents: 4000 });
  await alice.goto(`${base}#/bills/${liveBill.id}`);
  await alice.getByRole('button', { name: 'Edit details & participants' }).click();
  await alice.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Keep this unsent title');
  await liveApi(`/bills/${liveBill.id}/share`, 'bob-token', 'POST', { revision: 1, expectedAmountCents: null, amountCents: 6000 });
  await expect(billSummary(alice)).toContainText('2 of 3 confirmed');
  await expect(alice.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue('Keep this unsent title');
  await expect(alice.getByRole('button', { name: 'Save & request confirmations' })).toBeEnabled();
  await liveApi(`/bills/${liveBill.id}/share`, 'carol-token', 'POST', { revision: 1, expectedAmountCents: null, amountCents: 0 });
  await expect(alice.getByRole('dialog')).toContainText('This bill is complete. Your draft is retained');
  await expect(alice.getByRole('dialog').getByLabel('Title', { exact: true })).toHaveValue('Keep this unsent title');
  await expect(alice.getByRole('button', { name: 'Save & request confirmations' })).toBeDisabled();
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.goto(ledgerUrl);
  const liveView = await liveApi(`/groups/${liveGroupId}/bills`, 'alice-token');
  await expect(groupNet(alice)).toContainText(`$${(liveView.summary.netCents / 100).toFixed(2)}`);
  assert.equal(await alice.locator('[data-animating]').count(), 0, 'First load displays real amounts');
  await alice.emulateMedia({ reducedMotion: 'reduce' });
  const { repayment: reverse } = await liveApi(`/groups/${liveGroupId}/repayments`, 'bob-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Alice, amountCents: liveView.summary.netCents + 1000,
  });
  await liveApi(`/repayments/${reverse.id}/decision`, 'alice-token', 'POST', { decision: 'confirmed' });
  await expect(groupNet(alice)).toContainText('$10.00');
  await expect(groupNet(alice)).toContainText('You owe');
  assert.equal(await alice.locator('[data-animating]').count(), 0, 'Reduced motion skips rolling amounts');
  await alice.emulateMedia({ reducedMotion: 'no-preference' });
  const { repayment: zero } = await liveApi(`/groups/${liveGroupId}/repayments`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), recipientId: liveIds.Bob, amountCents: 1000,
  });
  await liveApi(`/repayments/${zero.id}/decision`, 'bob-token', 'POST', { decision: 'confirmed' });
  await expect(groupNet(alice)).toContainText("You're settled up");
  await expect(alice.getByRole('region', { name: 'Group balances and repayments' })).toContainText('No transfers needed.');
  await expect(alice.locator('[data-animating]')).toHaveCount(0);
}
