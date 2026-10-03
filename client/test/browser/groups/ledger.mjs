// Ledger scenarios: balances and repayments.
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { screenshots } from '../environment.mjs';
import { costcoFriends, aliceBill, weekendGroceries, shareTicket, billSummary } from './fixtures.mjs';
import { groupNet, splitByAmount } from '../ui.mjs';

export const scenarios = [
  { name: 'repayments', run: repayments },
];

// Balances and minimum suggestions, then recording, confirming and rejecting repayments with a response-loss retry (#6, #7).
async function repayments(env) {
  const { pageFor, base } = env;
  const { group, ids } = await costcoFriends(env);
  await weekendGroceries(env, group, ids);
  await aliceBill(env, group.id, 'Correctable groceries', 10000, [ids.Alice, ids.Bob], [['alice-token', 4000], ['bob-token', 6000]]);
  // Bob owes Alice $59.97 + $60.00.
  const alice = await pageFor('alice-token', { width: 1280, height: 900 });
  await alice.goto(`${base}#/group-bills/${group.id}`);
  await expect(groupNet(alice)).toContainText('$119.97');
  const bobAgain = await pageFor('bob-token', { width: 390, height: 844 });
  // Issue #6: balances, minimum suggestions, live membership updates, and capacity errors.
  const ledger = alice.getByRole('region', { name: 'Group balances and repayments' });
  await expect(ledger).toContainText('Bob → You');
  await expect(ledger).toContainText('$119.97');
  await expect(ledger).toContainText('Carol');
  await expect(ledger).toContainText('$0.00');
  await alice.setViewportSize({ width: 390, height: 844 });
  assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await alice.screenshot({ path: `${screenshots}/ledger-mobile.png`, fullPage: true });
  await alice.setViewportSize({ width: 1280, height: 900 });
  await alice.screenshot({ path: `${screenshots}/ledger-desktop.png`, fullPage: true });
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
  await expect(bobAgain.getByRole('button', { name: 'Review repayment', exact: true })).toHaveCount(0);
  await expect(alice.locator('.repayment-list')).toContainText('Pending');
  await expect(groupNet(alice)).toContainText('$119.97');
  await alice.getByRole('button', { name: 'Review repayment', exact: true }).click();
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
  await expect(groupNet(alice)).toContainText('$99.97');
  await alice.getByText('Older repayments (1)', { exact: true }).click();
  await expect(alice.getByRole('region', { name: 'Repayment history' }).getByText('$20.00 · Confirmed', { exact: true })).toBeVisible();
  await expect(groupNet(bobAgain)).toContainText('$99.97');
  await bobAgain.getByText('Older repayments (1)', { exact: true }).click();
  await expect(bobAgain.getByRole('region', { name: 'Repayment history' }).getByText('$20.00 · Confirmed', { exact: true })).toBeVisible();
  await expect(bobAgain.getByRole('region', { name: 'Group balances and repayments' })).toContainText('$99.97');
  await bobAgain.getByRole('button', { name: 'Record repayment', exact: true }).click();
  await bobAgain.getByLabel('Recipient', { exact: true }).selectOption({ label: 'Alice' });
  await bobAgain.getByLabel('Amount sent · CAD').fill('5.00');
  await bobAgain.getByRole('button', { name: 'Record transfer', exact: true }).click();
  await expect(bobAgain.getByRole('dialog')).toHaveCount(0);
  await alice.getByRole('button', { name: 'Review repayment', exact: true }).click();
  await alice.getByRole('button', { name: 'Reject record' }).click();
  await expect(alice.getByRole('region', { name: 'Repayment history' }).getByText('$5.00 · Rejected', { exact: true })).toBeVisible();
  await expect(groupNet(alice)).toContainText('$99.97');
  await bobAgain.reload();
  assert.equal(await bobAgain.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await bobAgain.screenshot({ path: `${screenshots}/repayments-mobile.png`, fullPage: true });
  // A solo bill remains open at initiation and completes after its explicit share submission.
  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  await splitByAmount(alice, '10.00');
  await alice.getByLabel('Bill title', { exact: true }).fill('After repayment');
  await alice.getByLabel('Total paid (CAD)', { exact: true }).fill('10.00');
  await expect(alice.getByLabel('Your share (CAD)', { exact: true })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Share bill' }).click();
  await expect(billSummary(alice).getByText('In progress', { exact: true })).toBeVisible();
  await expect(shareTicket(alice)).toContainText('Not submitted yet');
  await alice.getByLabel('Your share (CAD)', { exact: true }).fill('10.00');
  await alice.getByRole('button', { name: 'Submit and confirm my share' }).click();
  await expect(billSummary(alice).getByText('Complete', { exact: true })).toBeVisible();
  await alice.getByRole('link', { name: 'Group bills', exact: false }).click();
  await expect(groupNet(alice)).toContainText('$99.97');
  await expect(alice.getByRole('region', { name: 'History', exact: true }).getByRole('link').filter({ hasText: 'Weekend groceries' })).toContainText('Complete');
}
