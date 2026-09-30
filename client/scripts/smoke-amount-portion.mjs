// Issue #162: picking a portion of the total on a By amount bill, in the initiator's
// draft setup and on each participant's share form. The caller owns the server,
// browser, and test identities; this creates its own group so other checks are unaffected.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

const shareInput = page => page.getByLabel('Your share (CAD)', { exact: true });
const choices = page => page.getByRole('group', { name: 'Your share', exact: true });
const choice = (page, name) => choices(page).getByRole('button', { name, exact: true });
const choiceNames = page => choices(page).getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
const pressedNames = page => choices(page).locator('[aria-pressed="true"]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')));
const card = page => page.locator('.amount-portion .claim-portion');
const totalPaid = page => page.getByLabel('Total paid (CAD)', { exact: true });

export async function checkAmountPortion(pageFor, base, api, screenshots) {
  const { group } = await api('/groups', 'alice-token', 'POST', { name: 'Portion friends', icon: { type: 'unicode', value: '🍕' } });
  const invitation = await api(`/groups/${group.id}/invitation`);
  for (const token of ['bob-token', 'carol-token']) await api('/groups/join', token, 'POST', { token: invitation.path.split('/').at(-1) });
  const ids = Object.fromEntries((await api(`/groups/${group.id}`)).group.members.map(member => [member.displayName, member.id]));
  const amounts = async billId => Object.fromEntries((await api(`/bills/${billId}`)).bill.participants.map(p => [p.displayName, p.amountCents]));

  // Draft setup: the initiator's own share.
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  await alice.goto(`${base}#/group-bills/${group.id}`);
  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  const splitByAmounts = alice.getByRole('button', { name: 'Split by amount instead', exact: true });
  const people = alice.getByRole('group', { name: "Who's in?" });
  await expect(splitByAmounts.or(people).first()).toBeVisible();
  if (await splitByAmounts.count()) await splitByAmounts.click();
  await alice.getByLabel('Bill title', { exact: true }).fill('Split three ways');
  await alice.getByRole('button', { name: 'Everyone', exact: true }).click();
  // Without a total paid there is nothing to take a portion of.
  await expect(alice.getByText('Enter the total paid to pick a portion', { exact: true })).toBeVisible();
  assert.deepEqual(await choiceNames(alice), ['Even · 1/3', 'All', '1/2', '1/4', '1/5', '1/6', 'Custom']);
  for (const button of await choices(alice).getByRole('button').all()) await expect(button).toBeDisabled();
  await totalPaid(alice).fill('100.00');
  await expect(alice.getByText('Enter the total paid to pick a portion', { exact: true })).toHaveCount(0);
  await expect(card(alice)).toContainText('Pick a portion of $100.00 or type an amount');
  // N = 3, then 1 and 2: the fixed choice equal to Even is left out.
  assert.deepEqual(await choiceNames(alice),
    ['Even · 1/3 · $33.33', 'All · $100.00', '1/2 · $50.00', '1/4 · $25.00', '1/5 · $20.00', '1/6 · $16.67', 'Custom']);
  await alice.getByRole('button', { name: 'Just me', exact: true }).click();
  assert.deepEqual(await choiceNames(alice),
    ['Even · All · $100.00', '1/2 · $50.00', '1/3 · $33.33', '1/4 · $25.00', '1/5 · $20.00', '1/6 · $16.67', 'Custom']);
  await alice.getByRole('checkbox', { name: 'Bob', exact: true }).check();
  assert.deepEqual(await choiceNames(alice),
    ['Even · 1/2 · $50.00', 'All · $100.00', '1/3 · $33.33', '1/4 · $25.00', '1/5 · $20.00', '1/6 · $16.67', 'Custom']);
  await alice.getByRole('checkbox', { name: 'Carol', exact: true }).check();
  // A picked portion follows a corrected total, even through an empty total.
  await choice(alice, 'Even · 1/3 · $33.33').click();
  await expect(shareInput(alice)).toHaveValue('33.33');
  assert.deepEqual(await pressedNames(alice), ['Even · 1/3 · $33.33']);
  await expect(card(alice)).toContainText('1/3 of $100.00');
  await totalPaid(alice).fill('90.00');
  await expect(shareInput(alice)).toHaveValue('30.00');
  assert.deepEqual(await pressedNames(alice), ['Even · 1/3 · $30.00']);
  await totalPaid(alice).fill('');
  await expect(choice(alice, 'Even · 1/3')).toBeDisabled();
  await totalPaid(alice).fill('87.43');
  await expect(shareInput(alice)).toHaveValue('29.14');
  // A typed share is left alone and clears the highlight.
  await shareInput(alice).fill('40');
  await shareInput(alice).blur();
  await expect(shareInput(alice)).toHaveValue('40.00');
  assert.deepEqual(await pressedNames(alice), []);
  await expect(card(alice)).toContainText('of $87.43 total');
  await totalPaid(alice).fill('100.00');
  await expect(shareInput(alice)).toHaveValue('40.00');
  // A reloaded draft shows the share it restored.
  await alice.reload();
  await expect(shareInput(alice)).toHaveValue('40.00');
  await expect(card(alice)).toContainText('of $100.00 total');
  // A typed share that matches the custom fraction follows the total like a pick.
  await choice(alice, 'Custom').click();
  await alice.getByLabel('Custom fraction', { exact: true }).fill('2/5');
  await alice.getByRole('button', { name: 'Use custom fraction', exact: true }).click();
  await shareInput(alice).fill('39.00');
  await shareInput(alice).fill('40.00');
  assert.deepEqual(await pressedNames(alice), ['Custom · 2/5 · $40.00']);
  await totalPaid(alice).fill('120.00');
  await expect(shareInput(alice)).toHaveValue('48.00');
  // An open Custom input is disabled too once the total is cleared.
  await choice(alice, 'Custom · 2/5 · $48.00').click();
  await totalPaid(alice).fill('');
  await expect(alice.getByRole('button', { name: 'Use custom fraction', exact: true })).toBeDisabled();
  await totalPaid(alice).fill('100.00');
  await expect(shareInput(alice)).toHaveValue('40.00');
  // A share over the total paid is an error that blocks sharing.
  await shareInput(alice).fill('120.00');
  await expect(card(alice).getByRole('alert')).toHaveText("Your share can't be more than the total paid.");
  await expect(alice.getByRole('button', { name: 'Share bill' })).toBeDisabled();
  // Picking a portion by keyboard works too.
  await choice(alice, 'Even · 1/3 · $33.33').focus();
  await alice.keyboard.press('Enter');
  await expect(shareInput(alice)).toHaveValue('33.33');
  await expect(card(alice).getByRole('alert')).toHaveCount(0);
  await expect(card(alice).locator('[data-segment="over"]')).toHaveCount(0);
  await screenshots(alice, 'amount-portion-draft');
  await alice.getByRole('button', { name: 'Share bill' }).click();
  await expect(alice.getByRole('heading', { name: 'Split three ways' })).toBeVisible();
  const billId = alice.url().split('/').pop();
  assert.deepEqual(await amounts(billId), { Alice: 3333, Bob: null, Carol: null });

  // Participant form: Bob picks Even, edits by hand, then uses a custom fraction.
  const bob = await pageFor('bob-token', { width: 390, height: 844 });
  await bob.goto(`${base}#/bills/${billId}`);
  await expect(card(bob)).toContainText('Alice · $33.33');
  await expect(card(bob)).toContainText('Carol · not yet');
  await expect(card(bob)).toContainText('Pick a portion of $100.00 or type an amount');
  await expect(bob.getByRole('button', { name: 'Take the $66.67 left', exact: true })).toBeVisible();
  await choice(bob, 'Even · 1/3 · $33.33').click();
  await expect(shareInput(bob)).toHaveValue('33.33');
  assert.deepEqual(await pressedNames(bob), ['Even · 1/3 · $33.33']);
  await expect(card(bob)).toContainText('You · $33.33');
  await expect(card(bob)).toContainText('Free · $33.34');
  await shareInput(bob).fill('33.00');
  assert.deepEqual(await pressedNames(bob), []);
  await expect(card(bob)).toContainText('of $100.00 total');
  await choice(bob, 'Custom').click();
  await bob.getByLabel('Custom fraction', { exact: true }).fill('2/5');
  await bob.getByRole('button', { name: 'Use custom fraction', exact: true }).click();
  await expect(shareInput(bob)).toHaveValue('40.00');
  assert.deepEqual(await pressedNames(bob), ['Custom · 2/5 · $40.00']);
  await expect(card(bob)).toContainText('2/5 of $100.00');
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Share form overflows at 390px');
  await screenshots(bob, 'amount-portion-participant');
  await choice(bob, 'Even · 1/3 · $33.33').click();
  await bob.getByRole('button', { name: 'Submit and confirm my share' }).click();
  await expect(bob.getByRole('heading', { name: 'Your share is confirmed.' })).toBeVisible();
  assert.deepEqual(await amounts(billId), { Alice: 3333, Bob: 3333, Carol: null });

  // The last participant takes what is left, so the shares add up exactly.
  const carol = await pageFor('carol-token', { width: 1280, height: 900 });
  await carol.goto(`${base}#/bills/${billId}`);
  await carol.getByRole('button', { name: 'Take the $33.34 left', exact: true }).click();
  await expect(shareInput(carol)).toHaveValue('33.34');
  await expect(carol.getByRole('button', { name: /^Take the/ })).toHaveCount(0);
  await carol.getByRole('button', { name: 'Submit and confirm my share' }).click();
  await expect(carol.getByRole('region', { name: 'Bill summary', exact: true }).getByText('Complete', { exact: true })).toBeVisible();
  assert.deepEqual(await amounts(billId), { Alice: 3333, Bob: 3333, Carol: 3334 });

  // Shares over the total only warn; a share over the total itself is still blocked.
  const { bill: over } = await api(`/groups/${group.id}/bills`, 'alice-token', 'POST', {
    requestId: crypto.randomUUID(), title: 'Too much claimed', purchaseDate: '2026-01-01',
    timeZone: 'America/Toronto', notes: '', totalCents: 10000, ownShareCents: 5000,
    participantIds: [ids.Alice, ids.Bob, ids.Carol],
  });
  await api(`/bills/${over.id}/share`, 'bob-token', 'POST', { revision: 1, expectedAmountCents: null, amountCents: 4000 });
  await carol.goto(`${base}#/bills/${over.id}`);
  await choice(carol, '1/2 · $50.00').click();
  await expect(card(carol).getByRole('status')).toHaveText("Shares are $40.00 over the total. The bill can't complete until someone lowers theirs.");
  await expect(card(carol).locator('.claim-bar-edge')).toHaveAttribute('title', 'Total ends here');
  for (const button of await choices(carol).getByRole('button').all()) await expect(button).toBeEnabled();
  await carol.getByRole('button', { name: 'Submit and confirm my share' }).click();
  await expect(carol.getByRole('heading', { name: 'Your share is confirmed.' })).toBeVisible();
  assert.equal((await amounts(over.id)).Carol, 5000);
  await shareInput(carol).fill('120.00');
  await expect(card(carol).getByRole('alert')).toHaveText("Your share can't be more than the total paid.");
  await carol.getByRole('button', { name: 'Save changed amount', exact: true }).click();
  await expect(carol.getByText('Your share cannot exceed the bill total.', { exact: true })).toBeVisible();
  assert.equal((await amounts(over.id)).Carol, 5000);

  // A reopened bill with a new total keeps the saved amount; the choices show the new total.
  await alice.goto(`${base}#/bills/${over.id}`);
  await alice.getByRole('button', { name: 'Edit details & participants' }).click();
  await alice.getByRole('dialog').getByLabel('Total · CAD', { exact: true }).fill('120.00');
  await alice.getByRole('button', { name: 'Save & request confirmations' }).click();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await carol.reload();
  await expect(carol.getByRole('heading', { name: 'Check your saved amount.' })).toBeVisible();
  await expect(shareInput(carol)).toHaveValue('50.00');
  await expect(choice(carol, 'Even · 1/3 · $40.00')).toBeVisible();
  await expect(choice(carol, '1/2 · $60.00')).toHaveAttribute('aria-pressed', 'false');
  assert.equal((await amounts(over.id)).Carol, 5000);
  for (const page of [alice, bob, carol]) await page.context().close();
  console.log('Amount portion smoke passed: draft choices for 1 to 3 people, disabled without a total, following a corrected total, typed shares, custom fractions, taking what is left, over-total warning, own-share error, and reopened bills.');
}
