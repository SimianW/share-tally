// Group page acceptance at the browser and real-HTTP fixture seams. The caller
// owns the server, browser, and test identities; run this after the original
// non-delete group smoke flow so these extra groups cannot alter Home lists.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';

const date = '2026-09-24';
const labels = {
  'missing-share': { manual: 'Enter your share', items: 'Claim your items' },
  'confirm-share': { manual: 'Confirm your share', items: 'Confirm your items' },
};
const currency = cents => `$${(cents / 100).toFixed(2)}`;
const billLink = (region, title) => region.getByRole('link').filter({ hasText: title });

export async function checkGroupPage(pageFor, base, api) {
  const { group: created } = await api('/groups', 'alice-token', 'POST', {
    name: 'Costco Crew', icon: { type: 'unicode', value: '🛒' },
  });
  const groupId = created.id;
  const invitation = await api(`/groups/${groupId}/invitation`);
  for (const token of ['bob-token', 'carol-token', 'member-1-token']) {
    await api('/groups/join', token, 'POST', { token: invitation.path.split('/').at(-1) });
  }
  const { group } = await api(`/groups/${groupId}`);
  const ids = Object.fromEntries(group.members.map(member => [member.displayName, member.id]));
  assert.ok(ids.Alice && ids.Bob && ids.Carol && ids.Member, 'four real fixture identities joined');
  const route = `${base}#/group-bills/${groupId}`;

  async function manual(initiator, title, totalCents, ownShareCents, names) {
    return (await api(`/groups/${groupId}/bills`, `${initiator.toLowerCase()}-token`, 'POST', {
      requestId: randomUUID(), title, purchaseDate: date, timeZone: 'America/Toronto',
      notes: '', totalCents, ownShareCents, participantIds: names.map(name => ids[name]),
    })).bill;
  }
  async function share(bill, person, amountCents) {
    return (await api(`/bills/${bill.id}/share`, `${person.toLowerCase()}-token`, 'POST', {
      revision: bill.revision, expectedAmountCents: null, amountCents,
    })).bill;
  }
  async function itemBill(title) {
    const draftId = randomUUID();
    const itemId = randomUUID();
    const { draft } = await api(`/groups/${groupId}/receipt-drafts/${draftId}`, 'alice-token', 'PUT', {
      revision: 0,
      data: {
        mode: 'items', title, purchaseDate: date, timeZone: 'America/Toronto', notes: '',
        totalCents: 2000, ownShareCents: 0, participantIds: [ids.Alice, ids.Bob],
        receipt: { subtotalCents: 2000, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
        items: [{ id: itemId, name: 'Shared apples', originalText: 'APPLES', quantity: '1',
          amountCents: 2000, discountCents: 0, taxable: false, finalCents: 2000, manualFinal: false }],
      },
    });
    const { bill } = await api(`/receipt-drafts/${draftId}/initialize`, 'alice-token', 'POST', { revision: draft.revision });
    return { bill, itemId };
  }
  async function repayment(sender, recipient, amountCents) {
    return (await api(`/groups/${groupId}/repayments`, `${sender.toLowerCase()}-token`, 'POST', {
      requestId: randomUUID(), recipientId: ids[recipient], amountCents,
    })).repayment;
  }
  const [openName, confirmName, claimName, confirmItemsName, waitingName] = [
    'Coffee beans & pastries', 'Household supplies', 'Claim-only apples', 'Reconfirm shared apples', 'Bakery & breakfast',
  ];

  // A worked ledger: Alice owes Bob $40, and Carol/Member owe Alice $80/$60.
  // The server alone decides how to simplify these into suggested transfers.
  let warehouse = await manual('Bob', 'Saturday warehouse run', 10000, 6000, ['Alice', 'Bob']);
  warehouse = await share(warehouse, 'Alice', 4000);
  assert.ok(warehouse.completedAt);
  let produce = await manual('Alice', 'Produce & freezer aisle', 18000, 4000, ['Alice', 'Carol', 'Member']);
  produce = await share(produce, 'Carol', 8000);
  produce = await share(produce, 'member-1', 6000);
  assert.ok(produce.completedAt);
  // Older offsetting bills add four history entries without changing balances.
  for (const [index, pair] of [
    ['Pantry restock', 'Shared cleaning kit'], ['Holiday snacks', 'Bulk toiletries'],
  ].entries()) {
    let aliceBill = await manual('Alice', pair[0], 3000 + index * 200, 1000 + index * 100, ['Alice', 'Bob']);
    aliceBill = await share(aliceBill, 'Bob', 2000 + index * 100);
    assert.ok(aliceBill.completedAt);
    let bobBill = await manual('Bob', pair[1], 3000 + index * 200, 1000 + index * 100, ['Alice', 'Bob']);
    bobBill = await share(bobBill, 'Alice', 2000 + index * 100);
    assert.ok(bobBill.completedAt);
  }
  const missing = await manual('Bob', openName, 5400, 2100, ['Alice', 'Bob', 'Carol']);
  let unconfirmed = await manual('Alice', confirmName, 7600, 0, ['Alice', 'Bob', 'Member']);
  unconfirmed = (await api(`/bills/${unconfirmed.id}`, 'alice-token', 'PATCH', {
    revision: unconfirmed.revision, title: confirmName, purchaseDate: date,
    timeZone: 'America/Toronto', notes: 'Corrected receipt', totalCents: 7600,
    participantIds: [ids.Alice, ids.Bob, ids.Member],
  })).bill;
  assert.equal(unconfirmed.participants.find(p => p.isCurrentUser)?.confirmedAt, null);
  assert.equal(unconfirmed.participants.find(p => p.isCurrentUser)?.amountCents, 0, 'a submitted zero share still needs confirmation, not entry');
  const waiting = await manual('Alice', waitingName, 9200, 3000, ['Alice', 'Bob', 'Carol']);
  const claim = await itemBill(claimName);
  const confirmItems = await itemBill(confirmItemsName);
  // Item claims and corrections carry item versions, not the bill revision (ADR-0014).
  await api(`/bills/${confirmItems.bill.id}/claims`, 'alice-token', 'POST', {
    reviewedItems: confirmItems.bill.items.map(({ id, version }) => ({ itemId: id, version })),
    claims: [{ itemId: confirmItems.itemId, numerator: 1, denominator: 2 }],
  });
  const beforeCorrection = (await api(`/bills/${confirmItems.bill.id}`)).bill;
  await api(`/bills/${confirmItems.bill.id}/items/${confirmItems.itemId}`, 'alice-token', 'PATCH', {
    version: beforeCorrection.items.find(({ id }) => id === confirmItems.itemId).version, name: 'Shared apples', quantity: '1',
    amountCents: 2200, discountCents: 0, taxable: false, manualFinal: false,
  });
  const corrected = (await api(`/bills/${confirmItems.bill.id}`)).bill;
  assert.equal(corrected.participants.find(p => p.isCurrentUser)?.confirmedAt, null,
    'item price correction invalidates the former confirmation');
  assert.notEqual(corrected.participants.find(p => p.isCurrentUser)?.amountCents, null,
    'claim reservation keeps the confirm-items action distinct from claim-items');
  const privateDraftId = randomUUID();
  await api(`/groups/${groupId}/receipt-drafts/${privateDraftId}`, 'alice-token', 'PUT', {
    revision: 0,
    data: {
      mode: 'items', title: 'Receipt draft to review', purchaseDate: date,
      timeZone: 'America/Toronto', notes: '', totalCents: 2400, ownShareCents: 0,
      participantIds: [ids.Alice, ids.Bob],
      receipt: { subtotalCents: 2400, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: [{ id: randomUUID(), name: 'Organic apples', originalText: 'APPLES', quantity: '1',
        amountCents: 2400, discountCents: 0, taxable: false, finalCents: 2400, manualFinal: false }],
    },
  });
  const canceled = await manual('Alice', 'Duplicate register slip', 2300, 800, ['Alice', 'Bob']);
  await api(`/bills/${canceled.id}/cancel`, 'alice-token', 'POST', { revision: canceled.revision });

  // Older decisions do affect the server balance; pending records do not.
  const oldConfirmed = await repayment('Bob', 'Alice', 275);
  await api(`/repayments/${oldConfirmed.id}/decision`, 'alice-token', 'POST', { decision: 'confirmed' });
  const oldRejected = await repayment('Bob', 'Alice', 135);
  await api(`/repayments/${oldRejected.id}/decision`, 'alice-token', 'POST', { decision: 'rejected' });
  const bobIncoming = await repayment('Bob', 'Alice', 1250);
  const secondBobIncoming = await repayment('Bob', 'Alice', 425);
  let state = await api(`/groups/${groupId}/bills`);
  const carolSuggestion = state.ledger.suggestions.find(s => s.fromUserId === ids.Carol);
  assert.ok(carolSuggestion, 'owing Carol needs a server suggestion for I sent this');
  // Tied balances make the server's suggestion target depend on random user IDs,
  // so never send this record to Alice: her view must keep exactly two pending incoming records.
  const alternateRecipient = [ids.Bob, ids.Member].find(id => id !== carolSuggestion.toUserId);
  const alternateName = group.members.find(member => member.id === alternateRecipient).displayName;
  const carolOutgoing = await repayment('Carol', alternateName, 850);
  state = await api(`/groups/${groupId}/bills`);
  assert.equal(state.summary.netCents, 9725, 'confirmed repayment reduces Alice receivable; pending ones do not');
  assert.equal((await api(`/groups/${groupId}/bills`, 'carol-token')).summary.netCents, -8000);
  assert.equal(state.ledger.incompleteBillIds.length, 5);
  assert.equal(state.bills.filter(bill => bill.completedAt || bill.canceledAt).length, 7);
  assert.ok(state.repayments.some(record => record.id === secondBobIncoming.id && record.status === 'pending'));

  async function open(token, viewport = { width: 1280, height: 900 }) {
    const page = await pageFor(token, viewport);
    await page.goto(route);
    await expect(page.getByRole('region', { name: 'Where you stand' })).toBeVisible();
    return page;
  }
  async function sectionOrder(page) {
    const names = ['Where you stand', 'Open bills', 'Your drafts', 'History', 'Group balances and repayments'];
    const positions = await page.evaluate(labels => labels.map(label => {
      const region = label === 'Your drafts' ? document.querySelector('section.receipt-drafts')
        : [...document.querySelectorAll('section[aria-label]')].find(node => node.getAttribute('aria-label') === label);
      return region ? [...document.querySelectorAll('section')].indexOf(region) : -1;
    }), names);
    assert.ok(positions.every((position, i) => position >= 0 && (i === 0 || position > positions[i - 1])),
      `group sections must follow layout A: ${JSON.stringify(positions)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      'group page has no horizontal overflow');
  }
  const alice = await open('alice-token');
  const openBills = alice.getByRole('region', { name: 'Open bills', exact: true });
  const history = alice.getByRole('region', { name: 'History', exact: true });
  const dashboard = alice.getByRole('region', { name: 'Where you stand' });
  const audit = alice.getByRole('region', { name: 'Group balances and repayments' });
  await sectionOrder(alice);
  await expect(alice.getByRole('heading', { name: group.name })).toBeVisible();
  await expect(alice.locator('.group-member-count')).toContainText('4 members · CAD');
  await expect(alice.getByRole('button', { name: 'New bill' })).toBeVisible();
  await expect(dashboard.getByRole('heading', { name: /You're owed.*\$97\.25/ })).toBeVisible();
  await expect(dashboard).toContainText('From completed bills and confirmed repayments.');
  await expect(dashboard).toContainText("5 open bills aren't counted yet");
  for (const [title, label] of [[openName, 'Enter your share'], [confirmName, 'Confirm your share'],
    [claimName, 'Claim your items'], [confirmItemsName, 'Confirm your items']]) {
    await expect(billLink(openBills, title)).toContainText(label);
  }
  await expect(billLink(openBills, waitingName)).toContainText(/Waiting for (?:Bob, Carol|Carol, Bob)/);
  await expect(billLink(openBills, waitingName)).not.toContainText('your share');
  await expect(alice.getByRole('heading', { name: /Your drafts/ })).toBeVisible();
  await expect(alice.locator('section.receipt-drafts')).toContainText('Receipt draft to review');
  const openTitles = await openBills.getByRole('link').allTextContents();
  assert.ok(openTitles.slice(0, 4).every(text => /(?:Enter your share|Confirm your share|Claim your items|Confirm your items)/.test(text)),
    'bills requiring Alice come before waiting bills');
  await expect(history.getByRole('link')).toHaveCount(5);
  await expect(history.getByRole('button', { name: 'Show all 7' })).toBeVisible();
  await expect(billLink(history, 'Duplicate register slip')).toContainText('Canceled');
  await expect(billLink(history, 'Duplicate register slip').getByText('Duplicate register slip', { exact: true })).toHaveCSS('text-decoration-line', 'line-through');
  await expect(billLink(history, 'Duplicate register slip').getByText('$23.00', { exact: true })).toHaveCSS('text-decoration-line', 'line-through');
  const bobRows = dashboard.getByRole('listitem').filter({ hasText: 'Bob says' });
  await expect(bobRows).toHaveCount(1);
  await expect(bobRows).toContainText(currency(bobIncoming.amountCents));
  await expect(dashboard).toContainText(currency(secondBobIncoming.amountCents));
  await expect(dashboard.getByRole('button', { name: 'Review' })).toHaveCount(2);
  const expectedPeople = new Set([
    ...state.ledger.suggestions.flatMap(s => s.fromUserId === ids.Alice ? [s.toUserId]
      : s.toUserId === ids.Alice ? [s.fromUserId] : []),
    ...state.repayments.filter(r => r.status === 'pending' && (r.senderId === ids.Alice || r.recipientId === ids.Alice))
      .map(r => r.senderId === ids.Alice ? r.recipientId : r.senderId),
  ]);
  await expect(dashboard.getByRole('listitem')).toHaveCount(expectedPeople.size);
  const balances = audit.getByRole('region', { name: "Everyone's balance" });
  const suggestions = audit.getByRole('region', { name: 'Suggested transfers' });
  await expect(balances.getByRole('listitem')).toHaveCount(state.ledger.members.length);
  await expect(suggestions.getByRole('listitem')).toHaveCount(state.ledger.suggestions.length);
  for (const member of state.ledger.members) {
    const row = balances.getByRole('listitem').filter({ hasText: member.displayName });
    await expect(row).toContainText(currency(Math.abs(member.netCents)));
  }
  for (const suggestion of state.ledger.suggestions) {
    const from = suggestion.fromUserId === ids.Alice ? 'You' : group.members.find(member => member.id === suggestion.fromUserId).displayName;
    const to = suggestion.toUserId === ids.Alice ? 'You' : group.members.find(member => member.id === suggestion.toUserId).displayName;
    await expect(suggestions.getByRole('listitem').filter({ hasText: `${from} → ${to}` }))
      .toContainText(currency(suggestion.amountCents));
  }
  const records = audit.getByRole('region', { name: 'Repayment history' });
  await expect(records).toContainText(currency(bobIncoming.amountCents));
  await expect(records).toContainText(currency(secondBobIncoming.amountCents));
  const older = records.getByText(/Older repayments \(2\)/);
  await expect(older).toBeVisible();
  await expect(records.getByText(/\$2\.75 · Confirmed/)).toBeHidden();
  await older.click();
  await expect(records.getByText(/\$2\.75 · Confirmed/)).toBeVisible();
  await expect(records.getByText(/\$1\.35 · Rejected/)).toBeVisible();
  const firstReview = dashboard.getByRole('button', { name: 'Review' }).first();
  const line = await firstReview.evaluate(button => button.parentElement.textContent);
  const firstAmount = [bobIncoming.amountCents, secondBobIncoming.amountCents].find(amount => line.includes(currency(amount)));
  assert.ok(firstAmount, 'first Review belongs to a visible pending transfer');
  await firstReview.click();
  const review = alice.getByRole('dialog', { name: 'Review repayment' });
  await expect(review).toBeVisible();
  await expect(review).toContainText(currency(firstAmount));
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await firstReview.click();
  await expect(review).toContainText(currency(firstAmount));
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.goto(`${route}?repayment=${secondBobIncoming.id}`);
  await expect(alice.getByRole('dialog', { name: 'Review repayment' })).toBeVisible();
  await expect(alice.getByRole('dialog', { name: 'Review repayment' })).toContainText(currency(secondBobIncoming.amountCents));
  await expect(alice.getByRole('dialog', { name: 'Review repayment' }).getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.getByRole('button', { name: 'Members & invites' }).click();
  await expect(alice.getByRole('dialog')).toContainText('4 members');
  await alice.getByRole('button', { name: 'Close dialog' }).click();

  // Compare actual Home links against the same member's group badges. The API
  // confirms which member owns each action; it does not manufacture UI amounts.
  for (const [token, expected] of [
    ['alice-token', [[missing.id, openName, 'Enter your share'], [unconfirmed.id, confirmName, 'Confirm your share'],
      [claim.bill.id, claimName, 'Claim your items'], [confirmItems.bill.id, confirmItemsName, 'Confirm your items']]],
    ['carol-token', [[missing.id, openName, 'Enter your share'], [waiting.id, waitingName, 'Enter your share']]],
  ]) {
    const { actions } = await api('/attention', token);
    const memberPage = token === 'alice-token' ? alice : await pageFor(token, { width: 1280, height: 900 });
    await memberPage.goto(base);
    const home = memberPage.getByRole('region', { name: 'Needs your attention' });
    for (const [id, title, label] of expected) {
      const action = actions.find(candidate => candidate.billId === id);
      assert.ok(action, `${token} owns ${title} in Home attention`);
      assert.equal(labels[action.kind]?.[action.mode], label);
      await expect(home.getByRole('link', { name: new RegExp(`${label}.*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toBeVisible();
      await memberPage.goto(route);
      await expect(billLink(memberPage.getByRole('region', { name: 'Open bills', exact: true }), title)).toContainText(label);
      await memberPage.goto(base);
    }
    assert.equal(actions.some(action => action.billId === canceled.id), false, 'canceled bill is not a to-do');
    if (token !== 'alice-token') await memberPage.context().close();
  }
  const { actions: carolActions } = await api('/attention', 'carol-token');
  assert.equal(carolActions.some(action => action.billId === confirmItems.bill.id), false,
    'group membership alone never creates a bill to-do');

  // A new bill moves across the open/history boundary through another member's
  // HTTP submission, without navigating away from Alice's live group page.
  await alice.goto(route);
  let moving = await manual('Alice', 'Live completion', 1600, 600, ['Alice', 'Bob']);
  await expect(billLink(openBills, 'Live completion')).toContainText('Waiting for Bob');
  moving = await share(moving, 'Bob', 1000);
  assert.ok(moving.completedAt);
  await expect(billLink(openBills, 'Live completion')).toHaveCount(0);
  await expect(billLink(history, 'Live completion')).toContainText('Complete');
  const withdrawing = await manual('Alice', 'Live cancellation', 1200, 200, ['Alice', 'Bob']);
  await expect(billLink(openBills, 'Live cancellation')).toBeVisible();
  await api(`/bills/${withdrawing.id}/cancel`, 'alice-token', 'POST', { revision: withdrawing.revision });
  await expect(billLink(openBills, 'Live cancellation')).toHaveCount(0);
  await expect(billLink(history, 'Live cancellation')).toContainText('Canceled');
  await alice.context().close();

  // The owing member sees only their own suggestions; a prefill is editable and
  // the submitted partial payment remains pending, so net does not change.
  const carol = await open('carol-token');
  const carolDash = carol.getByRole('region', { name: 'Where you stand' });
  const carolOpen = carol.getByRole('region', { name: 'Open bills', exact: true });
  for (const title of [claimName, confirmItemsName]) {
    await expect(billLink(carolOpen, title)).toContainText('Waiting for');
    await expect(billLink(carolOpen, title)).not.toContainText('your items');
  }
  await expect(carol.locator('.group-drafts')).toBeHidden();
  await expect(carol.locator('section.receipt-drafts')).not.toContainText('Receipt draft to review');
  await expect(carolDash.getByRole('heading', { name: /You owe.*\$80\.00/ })).toBeVisible();
  await expect(carolDash).toContainText(`waiting for ${alternateName} to confirm`);
  const currentSuggestion = (await api(`/groups/${groupId}/bills`, 'carol-token')).ledger.suggestions
    .find(s => s.fromUserId === ids.Carol && s.toUserId === carolSuggestion.toUserId);
  assert.ok(currentSuggestion, 'server still suggests a transfer Carol can record');
  const recipientName = group.members.find(member => member.id === currentSuggestion.toUserId).displayName;
  const actionableRow = carolDash.getByRole('listitem').filter({ hasText: `You pay ${recipientName}` });
  await expect(actionableRow).toContainText(currency(currentSuggestion.amountCents));
  await actionableRow.getByRole('button', { name: 'I sent this' }).click();
  const dialog = carol.getByRole('dialog', { name: 'Record repayment' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Recipient', { exact: true })).toHaveValue(currentSuggestion.toUserId);
  await expect(dialog.getByLabel('Amount sent · CAD')).toHaveValue((currentSuggestion.amountCents / 100).toFixed(2));
  await dialog.getByLabel('Amount sent · CAD').fill('3.25');
  await dialog.getByRole('button', { name: 'Record transfer' }).click();
  await expect(dialog).toHaveCount(0);
  const recorded = (await api(`/groups/${groupId}/bills`, 'carol-token')).repayments;
  assert.ok(recorded.some(record => record.senderId === ids.Carol && record.recipientId === currentSuggestion.toUserId
    && record.amountCents === 325 && record.status === 'pending'), 'editable prefill submitted a real pending record');
  assert.ok(recorded.some(record => record.id === carolOutgoing.id && record.status === 'pending'));
  assert.equal((await api(`/groups/${groupId}/bills`, 'carol-token')).summary.netCents, -8000,
    'pending transfer never changes a server balance');
  await expect(carolDash.getByRole('heading', { name: /You owe.*\$80\.00/ })).toBeVisible();
  await expect(carolDash).not.toContainText('Bob pays you $12.50');
  await carol.context().close();

  // Capture history-expanded views in separate identity contexts at both widths.
  await mkdir('/tmp/st-pr-98', { recursive: true });
  for (const [name, token] of [['alice', 'alice-token'], ['carol', 'carol-token']]) {
    for (const [device, viewport] of [
      ['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }],
    ]) {
      const page = await open(token, viewport);
      const pageHistory = page.getByRole('region', { name: 'History', exact: true });
      const showAll = pageHistory.getByRole('button', { name: /Show all \d+/ });
      await expect(showAll).toBeVisible();
      await showAll.click();
      await expect(pageHistory.getByRole('link')).toHaveCount(9);
      const latest = (await api(`/groups/${groupId}/bills`, token)).bills
        .filter(bill => bill.completedAt || bill.canceledAt).map(bill => `#/bills/${bill.id}`);
      assert.deepEqual(await pageHistory.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))), latest,
        'expanded history follows the server newest-first bill order');
      await sectionOrder(page);
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.activeElement?.blur();
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.screenshot({ path: `/tmp/st-pr-98/group-${name}-history-${device}.png`, fullPage: true, animations: 'disabled' });
      await page.context().close();
    }
  }
}
