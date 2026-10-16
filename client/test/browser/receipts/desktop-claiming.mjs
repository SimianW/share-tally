import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { receiptEnvironment, receiptGroup, receiptPhoto } from './fixtures.mjs';

export const scenarios = [
  { name: 'desktop-claim-table', environment: receiptEnvironment, run: desktopClaimTable },
];

async function desktopClaimTable(env) {
  const { api, base } = env;
  const { group, memberIds, alice } = await receiptGroup(env);
  await alice.setViewportSize({ width: 1440, height: 900 });
  const makeBill = async (title, names, participants) => {
    const draftId = randomUUID();
    const items = names.map(name => ({ id: randomUUID(), name, originalText: `${name.toUpperCase()} RECEIPT LINE`,
      quantity: '1', amountCents: 700, discountCents: 0, taxable: false, finalCents: 700, manualFinal: false,
      evidence: { regions: [{ pageNumber: 1, polygon: [40, 80, 360, 80, 360, 120, 40, 120] }] } }));
    const totalCents = names.length * 700;
    const draft = (await api(`/groups/${group.id}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', {
      revision: 0, photoBase64: (await receiptPhoto(400, 800)).toString('base64'),
      data: { mode: 'items', title, purchaseDate: '2026-09-24', timeZone: 'America/Toronto', notes: '',
        totalCents, participantIds: participants, items,
        receipt: { subtotalCents: totalCents, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false, evidence: { pages: [{ pageNumber: 1, width: 400, height: 800, unit: 'pixel' }] } } },
    })).draft;
    return (await api(`/receipt-drafts/${draftId}/initialize`, 'alice-token', 'POST', { revision: draft.revision })).bill;
  };
  const bill = await makeBill('Desktop grocery claims', ['Apples', 'Milk', 'Bread', ...Array.from({ length: 41 }, (_, index) => `Grocery item ${index + 4}`)], Object.values(memberIds));
  await api(`/bills/${bill.id}/claims`, 'bob-token', 'POST', {
    reviewedItems: bill.items.map(({ id, version }) => ({ itemId: id, version })),
    claims: [{ itemId: bill.items[0].id, numerator: 1, denominator: 2 }, { itemId: bill.items[2].id, numerator: 1, denominator: 1 }],
  });
  await alice.goto(`${base}#/bills/${bill.id}`);
  const table = alice.getByRole('table', { name: 'Items & claims' });
  const row = name => table.getByRole('row', { name, exact: true });
  const pick = (name, choice) => row(name).getByRole('button', { name: choice, exact: true });
  const details = name => alice.getByRole('region', { name, exact: true });
  const open = name => row(name).getByRole('button', { name: new RegExp(`^View ${name} ·`) });
  const fits = async () => assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Bill fits the viewport');
  await expect(table).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(45);
  await expect(row('Apples').getByText('APPLES RECEIPT LINE', { exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: "Everyone's portions" })).toBeVisible();
  await expect(pick('Apples', 'All of it · $7.00')).toBeDisabled();
  await expect(pick('Apples', 'All of it · $7.00')).toHaveAttribute('title', 'Only 1/2 left');
  for (const button of await row('Bread').getByRole('group', { name: 'Your portion' }).getByRole('button').all())
    await expect(button).toBeDisabled();
  await fits();
  await mkdir('/tmp/impl-256', { recursive: true });
  await table.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await alice.screenshot({ path: '/tmp/impl-256/table.png' });

  await pick('Apples', 'Custom').click();
  const popover = alice.getByRole('dialog', { name: 'Custom portion', exact: true });
  await expect(popover).toBeVisible();
  await popover.getByLabel('Custom fraction', { exact: true }).fill('3/4');
  await popover.getByRole('button', { name: 'Use custom fraction', exact: true }).click();
  await expect(popover.getByRole('alert')).toHaveText('Only 1/2 is available to you.');
  await popover.getByLabel('Custom fraction', { exact: true }).fill('invalid');
  await popover.getByRole('button', { name: 'Use custom fraction', exact: true }).click();
  await expect(popover.getByRole('alert')).toContainText('Use a positive fraction up to 1');
  await popover.getByLabel('Custom fraction', { exact: true }).fill('2/7');
  await alice.keyboard.press('Escape');
  await pick('Apples', 'Custom').click();
  await popover.getByLabel('Custom fraction', { exact: true }).fill('2/7');
  await alice.screenshot({ path: '/tmp/impl-256/custom-popover.png' });
  await popover.getByRole('button', { name: 'Use custom fraction', exact: true }).click();
  await expect(pick('Apples', 'Custom · 2/7 · $2.00')).toHaveAttribute('aria-pressed', 'true');
  await expect(details('Apples')).toHaveCount(0);
  await open('Apples').click();
  await expect(details('Apples')).toBeVisible();
  await expect(details('Apples').getByRole('button', { name: 'Custom · 2/7 · $2.00', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(table.getByRole('columnheader', { name: "Everyone's portions" })).toHaveCount(0);
  await expect(row('Apples').getByText('APPLES RECEIPT LINE', { exact: true })).toHaveCount(0);
  await expect(row('Apples')).toHaveAttribute('aria-current', 'true');
  await expect(details('Apples').getByText('Printed price', { exact: true })).toBeVisible();
  await expect(details('Apples').getByText('ON THE RECEIPT', { exact: true })).toBeVisible();
  await fits();
  await details('Apples').evaluate(element => element.scrollIntoView({ block: 'start' }));
  await alice.screenshot({ path: '/tmp/impl-256/panel.png' });
  for (const palette of ['classic', 'marigold', 'raspberry', 'plum-butter', 'lagoon', 'blueberry']) {
    for (const scheme of ['light', 'dark']) {
      await alice.evaluate(({ palette, scheme }) => {
        document.documentElement.dataset.palette = palette;
        document.documentElement.dataset.scheme = scheme;
      }, { palette, scheme });
      await fits();
      if (palette === 'lagoon' && scheme === 'dark') await alice.screenshot({ path: '/tmp/impl-256/panel-dark.png' });
      await expect(pick('Apples', '1/4 · $1.75')).toBeVisible();
      await expect(details('Apples').getByRole('heading', { name: 'Apples', exact: true })).toBeVisible();
    }
  }
  await alice.evaluate(() => { document.documentElement.dataset.palette = 'classic'; document.documentElement.dataset.scheme = 'light'; });
  await pick('Apples', '1/4 · $1.75').click();
  await expect(details('Apples').getByRole('button', { name: '1/4 · $1.75', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await details('Apples').getByRole('button', { name: '1/5 · $1.40', exact: true }).click();
  await expect(pick('Apples', '1/5 · $1.40')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('Apples')).toContainText('not submitted');
  await pick('Milk', 'All of it · $7.00').click();
  await expect(details('Apples')).toBeVisible();
  // A desktop pick never advances, even after the mobile timer would have fired.
  await alice.clock.install();
  await alice.clock.runFor(700);
  await expect(details('Apples')).toBeVisible();
  await alice.clock.resume();
  await open('Milk').click();
  await expect(details('Milk')).toBeVisible();
  await details('Milk').getByRole('button', { name: 'Previous item', exact: true }).click();
  await expect(details('Apples')).toContainText('CLAIM AN ITEM · 1 OF 44');
  await alice.keyboard.press('ArrowRight');
  await expect(details('Milk')).toContainText('CLAIM AN ITEM · 2 OF 44');
  await alice.keyboard.press('1');
  await expect(pick('Milk', 'Even · 1/3 · $2.33')).toHaveAttribute('aria-pressed', 'true');
  await expect(pick('Apples', '1/5 · $1.40')).toHaveAttribute('aria-pressed', 'true');
  await alice.keyboard.press('ArrowLeft');
  await expect(details('Apples')).toBeVisible();
  await alice.keyboard.press('Escape');
  await expect(details('Apples')).toHaveCount(0);
  await expect(open('Apples')).toBeFocused();
  await expect(table.getByRole('columnheader', { name: "Everyone's portions" })).toBeVisible();
  await alice.keyboard.press('ArrowDown');
  await expect(open('Milk')).toBeFocused();
  await alice.keyboard.press('j');
  await expect(open('Bread')).toBeFocused();
  await alice.keyboard.press('ArrowUp');
  await expect(open('Milk')).toBeFocused();
  await alice.keyboard.press('k');
  await expect(open('Apples')).toBeFocused();
  await alice.keyboard.press('ArrowDown');
  for (const [key, choice] of [['1', 'Even · 1/3 · $2.33'], ['2', 'All of it · $7.00'], ['3', '1/2 · $3.50'], ['4', '1/4 · $1.75'], ['5', '1/5 · $1.40'], ['6', '1/6 · $1.17']]) {
    await alice.keyboard.press(key);
    await expect(pick('Milk', choice)).toHaveAttribute('aria-pressed', 'true');
  }
  await alice.keyboard.press('7');
  await expect(popover).toBeVisible();
  await popover.getByLabel('Custom fraction', { exact: true }).fill('2/7');
  await alice.keyboard.press('ArrowDown');
  await alice.keyboard.press('j');
  await expect(popover.getByLabel('Custom fraction', { exact: true })).toHaveValue('2/7j');
  await alice.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await open('Milk').focus();
  for (let index = 0; index < 42; index++) await alice.keyboard.press('j');
  const lastRow = open('Grocery item 44');
  await expect(lastRow).toBeFocused();
  const lastBox = await lastRow.boundingBox();
  const confirmBox = await alice.getByRole('button', { name: 'Confirm my item claims', exact: true }).boundingBox();
  assert.ok(lastBox.y + lastBox.height < confirmBox.y, 'The focused row stays above the sticky footer');
  await open('Milk').focus();
  await alice.keyboard.press('Enter');
  await expect(details('Milk')).toBeVisible();

  // The exact breakpoint changes presentation without dropping unconfirmed picks.
  await alice.setViewportSize({ width: 1099, height: 900 });
  const sheet = alice.getByRole('dialog', { name: 'Milk', exact: true });
  await expect(sheet).toBeVisible();
  await expect(table).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: '1/6 · $1.17', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await alice.setViewportSize({ width: 390, height: 844 });
  await alice.screenshot({ path: '/tmp/impl-256/mobile-sheet.png' });
  await alice.setViewportSize({ width: 1100, height: 900 });
  await expect(details('Milk')).toBeVisible();
  await expect(alice.getByRole('dialog')).toHaveCount(0);
  await expect(pick('Milk', '1/6 · $1.17')).toHaveAttribute('aria-pressed', 'true');
  await fits();
  await details('Milk').getByRole('button', { name: 'Close claim', exact: true }).click();
  await row('Apples').getByRole('button', { name: 'Remove claim for Apples', exact: true }).click();
  await expect(row('Apples').getByRole('button', { pressed: true })).toHaveCount(0);
  await alice.getByRole('button', { name: 'Mine (1)', exact: true }).click();
  await expect(open('Apples')).toHaveCount(0);
  await open('Milk').click();
  await expect(details('Milk').getByRole('button', { name: 'Next item', exact: true })).toHaveCount(0);
  await details('Milk').getByRole('button', { name: 'Close claim', exact: true }).click();

  await alice.getByRole('button', { name: 'Confirm my item claims', exact: true }).click();
  await expect.poll(async () => (await api(`/bills/${bill.id}`)).bill.items[1].claims
    .filter(claim => claim.userId === memberIds.Alice).map(claim => `${claim.numerator}/${claim.denominator}`)).toEqual(['1/6']);
  assert.equal((await api(`/bills/${bill.id}`)).bill.items[0].claims.some(claim => claim.userId === memberIds.Alice), false);

  const completed = await makeBill('Completed desktop bill', ['Coffee'], [memberIds.Alice]);
  await alice.setViewportSize({ width: 1440, height: 900 });
  await alice.goto(`${base}#/bills/${completed.id}`);
  const observer = await env.pageFor('carol-token', { width: 1440, height: 900 });
  await observer.goto(`${base}#/bills/${completed.id}`);
  await expect(observer.getByRole('table', { name: 'Items & claims' })).toBeVisible();
  await expect(observer.getByRole('group', { name: 'Your portion' })).toHaveCount(0);
  await observer.getByRole('button', { name: 'View Coffee · $7.00', exact: true }).click();
  await expect(observer.getByRole('region', { name: 'Coffee', exact: true })).toBeVisible();
  await pick('Coffee', 'Even · All · $7.00').click();
  await alice.getByRole('button', { name: 'Confirm my item claims', exact: true }).click();
  await expect(alice.getByText('Complete and final.', { exact: false })).toBeVisible();
  await expect(row('Coffee').getByRole('group', { name: 'Your portion' })).toHaveCount(0);
  await expect(row('Coffee')).toContainText('$7.00');
  await alice.screenshot({ path: '/tmp/impl-256/completed.png' });
  await open('Coffee').click();
  await expect(details('Coffee')).toBeVisible();
  await expect(details('Coffee').getByRole('group', { name: 'Your portion' })).toHaveCount(0);
}

