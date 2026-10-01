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

  async function manual(initiator, title, totalCents, initiatorShareCents, names) {
    const bill = (await api(`/groups/${groupId}/bills`, `${initiator.toLowerCase()}-token`, 'POST', {
      requestId: randomUUID(), title, purchaseDate: date, timeZone: 'America/Toronto',
      notes: '', totalCents, participantIds: names.map(name => ids[name]),
    })).bill;
    assert.ok(bill.participants.every(participant => participant.amountCents === null && participant.confirmedAt === null),
      'bill initiation leaves every participant unsubmitted and unconfirmed');
    return share(bill, initiator, initiatorShareCents);
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
        totalCents: 2000, participantIds: [ids.Alice, ids.Bob],
        receipt: { subtotalCents: 2000, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
        items: [{ id: itemId, name: 'Shared apples', originalText: 'APPLES', quantity: '1',
          amountCents: 2000, discountCents: 0, taxable: false, finalCents: 2000, manualFinal: false }],
      },
    });
    const { bill } = await api(`/receipt-drafts/${draftId}/initialize`, 'alice-token', 'POST', { revision: draft.revision });
    assert.ok(bill.participants.every(participant => participant.amountCents === null && participant.confirmedAt === null),
      'draft initiation leaves every participant unsubmitted and unconfirmed');
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
  // Only a new total voids manual confirmations (ADR-0015), so the receipt correction changes it.
  let unconfirmed = await manual('Alice', confirmName, 7500, 0, ['Alice', 'Bob', 'Member']);
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
      timeZone: 'America/Toronto', notes: '', totalCents: 2400,
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
  await checkLedgerTrace(alice, audit, state);
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
  const liveTrace = audit.getByRole('region', { name: 'How the numbers add up' });
  await liveTrace.getByRole('button', { name: 'How the numbers add up' }).click();
  let moving = await manual('Alice', 'Live completion', 1600, 600, ['Alice', 'Bob']);
  await expect(billLink(openBills, 'Live completion')).toContainText('Waiting for Bob');
  await expect(liveTrace).toContainText(/Not counted yet: .*Live completion.* \(still open\)/);
  await expect(liveTrace.getByRole('link', { name: 'Live completion' })).toHaveCount(0);
  moving = await share(moving, 'Bob', 1000);
  assert.ok(moving.completedAt);
  await expect(billLink(openBills, 'Live completion')).toHaveCount(0);
  await expect(billLink(history, 'Live completion')).toContainText('Complete');
  // The explanation rides on the same live refresh as the balances it explains.
  await expect(liveTrace.getByRole('link', { name: 'Live completion' })).toHaveAttribute('href', `#/bills/${moving.id}`);
  await expect(liveTrace.getByText(/^Not counted yet:/)).not.toContainText('Live completion');
  await expectFooterMatchesList(audit, await api(`/groups/${groupId}/bills`));
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
      // The ledger table stays desktop-only; mobile rows open explanations instead.
      const pageAudit = page.getByRole('region', { name: 'Group balances and repayments' });
      await expect(pageAudit.getByRole('region', { name: 'How the numbers add up' })).toHaveCount(device === 'desktop' ? 1 : 0);
      if (device === 'desktop') {
        await expect(pageAudit.getByRole('button', { name: /'s balance, / })).toHaveCount(4);
        for (const button of await pageAudit.getByRole('button', { name: /'s balance, | pays .*\$/ }).all())
          await expect(button).not.toHaveAttribute('aria-haspopup', /./);
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
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
  console.log('Group page smoke passed: desktop balance tracing, live ledger refresh, member actions, and desktop/mobile history.');
  const transferFixture = await checkTransferTrace(pageFor, base, api);
  console.log('Desktop transfer trace smoke passed (#174).');
  const longFixture = await checkLongLedger(pageFor, base, api);
  console.log('Desktop long ledger smoke passed (#175).');
  await checkWideLedger(pageFor, base, api);
  console.log('Desktop wide ledger smoke passed (#175).');

  // Keep the new test-first checks after the existing ledger scenarios so a
  // missing mobile sheet does not hide a desktop regression result.
  const mobile = await open('alice-token', { width: 390, height: 844 });
  const mobileState = await api(`/groups/${groupId}/bills`);
  await checkMobileBalances(mobile, mobileState, ids.Alice);
  console.log('Mobile balance sheet smoke passed: server effects, paid/share detail, totals, and member titles.');
  await checkMobileSheetClosing(mobile, mobileState, ids.Alice);
  console.log('Mobile sheet closing smoke passed: close button, Escape, outside tap, focus return, and scroll lock.');
  await mobile.context().close();
  await checkMobileAdjustment(pageFor, base, api);
  console.log('Mobile initiator adjustment smoke passed.');
  await checkMobileTransfers(pageFor, base, api, transferFixture);
  console.log('Mobile transfer sheet smoke passed: direct lines, positive/negative passed along, totals, and split paragraphs.');
  await checkMobileLongLedger(pageFor, base, api, longFixture);
  console.log('Mobile long ledger smoke passed: ten recent effects, earlier subtotal, Show all, dates, and additive totals.');
}

const signedCurrency = cents => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${currency(Math.abs(cents))}`;
const ledgerTable = audit => audit.getByRole('region', { name: 'How the numbers add up' })
  .getByRole('table', { name: 'Bills and repayments by member' });

// Each member column's Balance footer equals that member's figure in the list.
async function expectFooterMatchesList(audit, state) {
  const expected = state.ledger.members.map(member => signedCurrency(member.netCents));
  const footer = ledgerTable(audit).getByRole('row')
    .filter({ has: audit.page().getByRole('rowheader', { name: 'Balance', exact: true }) });
  await expect(footer.getByRole('cell')).toHaveText(expected);
  await expect(audit.getByRole('region', { name: "Everyone's balance" }).getByRole('button', { name: /'s balance, / }))
    .toHaveText(expected);
}

// Desktop "How the numbers add up": collapsed by default, opened and pinned by a
// balance figure, traced by hover only while open, and cleared by collapsing.
async function checkLedgerTrace(page, audit, state) {
  const trace = audit.getByRole('region', { name: 'How the numbers add up' });
  const toggle = trace.getByRole('button', { name: 'How the numbers add up' });
  const table = ledgerTable(audit);
  const balances = audit.getByRole('region', { name: "Everyone's balance" });
  const figure = name => balances.getByRole('button', { name: new RegExp(`^${name}'s balance, `) });
  const traced = table.getByRole('columnheader', { name: / Balance$/ });
  const tracing = name => table.getByRole('columnheader', { name: `${name} Balance`, exact: true });
  const away = () => page.mouse.move(0, 0);

  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(trace).toHaveText('How the numbers add up');
  await expect(figure('Bob')).toHaveAttribute('title', 'Show how this adds up');
  await figure('Bob').hover();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(table).toHaveCount(0);

  await figure('Bob').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(figure('Bob')).toHaveAttribute('aria-pressed', 'true');
  await expect(figure('Bob')).not.toHaveAttribute('title', /./);
  await expect(tracing('Bob')).toBeVisible();
  await expect(traced).toHaveCount(1);
  await expect(trace).toContainText("Reading down Bob's column");
  await expect(trace.getByRole('button', { name: 'Unpin' })).toBeVisible();

  // The seven-entry Costco fixture needs neither an earlier subtotal nor Show all.
  assert.equal(state.ledger.entries.length, 7);
  await expect(table.getByRole('rowheader', { name: /^Earlier bills and repayments/ })).toHaveCount(0);
  await expect(table.getByRole('button', { name: 'Show all', exact: true })).toHaveCount(0);

  // One row per counted entry, bill rows linking to their bills, then the Balance footer.
  await expect(table.getByRole('row').filter({ has: page.getByRole('rowheader') })).toHaveCount(state.ledger.entries.length + 1);
  for (const entry of state.ledger.entries.filter(entry => entry.kind === 'bill'))
    await expect(table.getByRole('link', { name: entry.title, exact: true })).toHaveAttribute('href', `#/bills/${entry.id}`);
  // Rows follow the server's effective-time order; bills completed after their
  // purchase day also say when they were bought.
  assert.deepEqual(await table.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))),
    state.ledger.entries.filter(entry => entry.kind === 'bill').map(entry => `#/bills/${entry.id}`));
  const warehouseRow = table.getByRole('rowheader', { name: /^Saturday warehouse run/ });
  const warehouse = state.ledger.entries.find(entry => entry.title === 'Saturday warehouse run');
  const completedDay = await page.evaluate(iso => new Date(iso).toLocaleDateString('en-CA'), warehouse.completedAt);
  if (completedDay === warehouse.purchaseDate) await expect(warehouseRow).not.toContainText('bought');
  else await expect(warehouseRow).toContainText(/ · bought [A-Z][a-z]{2} 24 · paid by Bob · \$100\.00/);
  const confirmed = state.ledger.entries.find(entry => entry.kind === 'repayment');
  const repaymentCells = state.ledger.members.map(member => member.userId === confirmed.senderId ? signedCurrency(confirmed.amountCents)
    : member.userId === confirmed.recipientId ? signedCurrency(-confirmed.amountCents) : '—Not involved');
  await expect(table.getByRole('row').filter({ hasText: 'Repayment · Bob → You' }).getByRole('cell')).toHaveText(repaymentCells);
  // Every suggested transfer is traceable too, named by its payer and recipient.
  const displayName = id => state.ledger.members.find(member => member.userId === id).displayName;
  await expect(audit.getByRole('region', { name: 'Suggested transfers' }).getByRole('button'))
    .toHaveText(state.ledger.suggestions.map(s => currency(s.amountCents)));
  for (const s of state.ledger.suggestions)
    await expect(audit.getByRole('button', { name: `${displayName(s.fromUserId)} pays ${displayName(s.toUserId)}, ${currency(s.amountCents)}`, exact: true }))
      .toHaveAttribute('aria-pressed', 'false');
  await expectFooterMatchesList(audit, state);
  for (const bill of state.bills.filter(bill => state.ledger.incompleteBillIds.includes(bill.id)))
    await expect(trace.getByText(/^Not counted yet: .* \(still open\)$/)).toContainText(bill.title);

  // A pin outlasts hovering elsewhere; clicking the pinned figure again releases it.
  await figure('Carol').hover();
  await expect(tracing('Bob')).toBeVisible();
  await expect(traced).toHaveCount(1);
  await figure('Bob').click();
  await expect(figure('Bob')).toHaveAttribute('aria-pressed', 'false');
  await expect(trace.getByRole('button', { name: 'Unpin' })).toHaveCount(0);
  await away();
  await expect(traced).toHaveCount(0);
  await expect(trace).toContainText('Hover over a balance or transfer above to trace it');
  await figure('Carol').hover();
  await expect(tracing('Carol')).toBeVisible();
  await away();
  await expect(traced).toHaveCount(0);

  await figure('Alice').click();
  await expect(tracing('You')).toBeVisible();
  await away();
  await trace.getByRole('button', { name: 'Unpin' }).click();
  await expect(figure('Alice')).toHaveAttribute('aria-pressed', 'false');
  await expect(traced).toHaveCount(0);

  // Collapsing clears the pin, so reopening starts fresh.
  await figure('Bob').click();
  await expect(figure('Bob')).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(table).toHaveCount(0);
  await expect(figure('Bob')).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(traced).toHaveCount(0);

  // Keyboard: focus traces, Enter and Space toggle the pin.
  await figure('Carol').focus();
  await expect(tracing('Carol')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(figure('Carol')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(figure('Carol')).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}

// A small group whose members are Alice and the given other identities.
async function fixtureGroup(api, name, tokens) {
  const { group: created } = await api('/groups', 'alice-token', 'POST', { name, icon: { type: 'unicode', value: '🧾' } });
  const invitation = await api(`/groups/${created.id}/invitation`);
  for (const token of tokens) await api('/groups/join', token, 'POST', { token: invitation.path.split('/').at(-1) });
  const { group } = await api(`/groups/${created.id}`);
  const ids = Object.fromEntries(group.members.map(member => [member.displayName, member.id]));
  const names = { 'alice-token': 'Alice', 'bob-token': 'Bob', 'carol-token': 'Carol', 'member-1-token': 'Member' };
  const tokenOf = Object.fromEntries(['alice-token', ...tokens].map(token => [names[token], token]));
  assert.equal(group.members.length, tokens.length + 1);
  return {
    id: created.id, ids,
    // A complete manual bill: the initiator comes first in `shares`, each share in cents.
    async bill(title, shares, { purchaseDate = date, totalCents = shares.reduce((sum, [, cents]) => sum + cents, 0) } = {}) {
      const [initiator] = shares[0];
      let { bill } = await api(`/groups/${created.id}/bills`, tokenOf[initiator], 'POST', {
        requestId: randomUUID(), title, purchaseDate, timeZone: 'America/Toronto', notes: '',
        totalCents, participantIds: shares.map(([person]) => ids[person]),
      });
      for (const [person, amountCents] of shares)
        ({ bill } = await api(`/bills/${bill.id}/share`, tokenOf[person], 'POST', { revision: bill.revision, expectedAmountCents: null, amountCents }));
      assert.ok(bill.completedAt, `${title} completes`);
      return bill;
    },
    async repay(sender, recipient, amountCents) {
      const { repayment } = await api(`/groups/${created.id}/repayments`, tokenOf[sender], 'POST', {
        requestId: randomUUID(), recipientId: ids[recipient], amountCents,
      });
      await api(`/repayments/${repayment.id}/decision`, tokenOf[recipient], 'POST', { decision: 'confirmed' });
    },
  };
}

// Desktop transfer tracing (#174): a transfer figure pins the payer's and the
// recipient's columns, emphasizes the rows directly between them, and states
// direct + passed along = total with a reason that names a person only with
// that person's actual direct debt.
async function checkTransferTrace(pageFor, base, api) {
  const explanation = (state, from, to) => {
    const s = state.ledger.suggestions.find(s => s.fromUserId === from && s.toUserId === to);
    assert.ok(s, 'expected suggestion exists');
    assert.equal(s.explanation.directCents + s.explanation.passedAlongCents, s.amountCents);
    assert.equal(s.explanation.directLines.reduce((sum, line) => sum + line.cents, 0), s.explanation.directCents);
    return [s.amountCents, s.explanation.directCents, s.explanation.passedAlongCents, s.explanation.directLines.map(line => line.entryId)];
  };
  async function open(groupId) {
    const page = await pageFor('alice-token', { width: 1280, height: 900 });
    await page.goto(`${base}#/group-bills/${groupId}`);
    await expect(page.getByRole('region', { name: 'Where you stand' })).toBeVisible();
    const audit = page.getByRole('region', { name: 'Group balances and repayments' });
    const trace = audit.getByRole('region', { name: 'How the numbers add up' });
    const table = ledgerTable(audit);
    const suggestions = audit.getByRole('region', { name: 'Suggested transfers' });
    return {
      page, audit, trace, table, suggestions,
      toggle: trace.getByRole('button', { name: 'How the numbers add up' }),
      transfer: (from, to) => suggestions.getByRole('button', { name: new RegExp(`^${from} pays ${to}, `) }),
      column: (name, role) => table.getByRole('columnheader', { name: `${name} ${role}`, exact: true }),
      roles: table.getByRole('columnheader', { name: / (?:Pays|Receives|Balance)$/ }),
      directRows: table.getByRole('rowheader', { name: /, directly between them$/ }),
      sum: trace.getByText(/^Between them directly:/),
      away: () => page.mouse.move(0, 0),
    };
  }

  // The prototype's figures: Bob owes Carol $60.79 directly, Alice owed Carol
  // $19.92 and Bob owes Alice $28.50, so Bob pays Carol $80.71 and Alice $8.58.
  const trio = await fixtureGroup(api, 'Cabin trio', ['bob-token', 'carol-token']);
  const cabin = await trio.bill('Cabin groceries', [['Carol', 1000], ['Bob', 6079], ['Alice', 1992]]);
  await trio.bill('Ski rental', [['Alice', 1000], ['Bob', 2850]]);
  let state = await api(`/groups/${trio.id}/bills`);
  assert.deepEqual(explanation(state, trio.ids.Bob, trio.ids.Carol), [8071, 6079, 1992, [cabin.id]]);
  assert.deepEqual(explanation(state, trio.ids.Bob, trio.ids.Alice)?.slice(0, 3), [858, 2850, -1992]);
  let ui = await open(trio.id);
  const { page, trace, table, toggle, transfer, column, roles, directRows, sum, away, suggestions } = ui;

  await expect(transfer('Bob', 'Carol')).toHaveAccessibleName('Bob pays Carol, $80.71');
  await expect(transfer('Bob', 'Carol')).toHaveText('$80.71');
  await expect(transfer('Bob', 'Carol')).toHaveAttribute('title', 'Show how this adds up');
  await transfer('Bob', 'Carol').hover();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(table).toHaveCount(0);

  await transfer('Bob', 'Carol').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(transfer('Bob', 'Carol')).toHaveAttribute('aria-pressed', 'true');
  await expect(column('Bob', 'Pays')).toBeVisible();
  await expect(column('Carol', 'Receives')).toBeVisible();
  await expect(roles).toHaveCount(2);
  await expect(directRows).toHaveCount(1);
  await expect(directRows).toContainText('Cabin groceries');
  await expect(trace).toContainText('Bob pays Carol $80.71. Highlighted rows are the bills and repayments directly between them.');
  await expect(sum).toHaveText('Between them directly: $60.79 + $19.92 passed along = $80.71. '
    + 'You owed Carol $19.92. Bob owes you more than that, so Bob pays it to Carol directly — one fewer transfer.');
  await mkdir('/tmp/st-174', { recursive: true });
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.scheme)).toBe(colorScheme);
    await away();
    await ui.audit.screenshot({ path: `/tmp/st-174/transfer-trace-${colorScheme}.png`, animations: 'disabled' });
  }
  await page.emulateMedia({ colorScheme: 'light' });

  // Hovering another transfer leaves the pin; once released, hover traces it.
  await transfer('Bob', 'Alice').hover();
  await expect(column('Carol', 'Receives')).toBeVisible();
  await transfer('Bob', 'Carol').click();
  await expect(transfer('Bob', 'Carol')).toHaveAttribute('aria-pressed', 'false');
  await away();
  await expect(roles).toHaveCount(0);
  await expect(sum).toHaveCount(0);
  await transfer('Bob', 'Alice').hover();
  await expect(column('Bob', 'Pays')).toBeVisible();
  await expect(column('You', 'Receives')).toBeVisible();
  await expect(directRows).toHaveCount(1);
  await expect(directRows).toContainText('Ski rental');
  await expect(sum).toHaveText('Between them directly: $28.50 − $19.92 sent elsewhere = $8.58. '
    + 'You owed Carol $19.92. Bob pays that to Carol instead, so you receive $19.92 less here.');
  await away();
  await expect(roles).toHaveCount(0);

  // Keyboard: focus traces, Enter and Space toggle the pin. The earlier click
  // left this figure focused, so focus it afresh.
  await page.evaluate(() => document.activeElement?.blur());
  await transfer('Bob', 'Carol').focus();
  await expect(column('Carol', 'Receives')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(transfer('Bob', 'Carol')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(transfer('Bob', 'Carol')).toHaveAttribute('aria-pressed', 'false');

  // A pinned transfer that a live update settles is cleared, not left highlighted.
  await transfer('Bob', 'Alice').click();
  await expect(transfer('Bob', 'Alice')).toHaveAttribute('aria-pressed', 'true');
  await away();
  await trio.repay('Bob', 'Alice', 858);
  await expect(suggestions.getByRole('listitem')).toHaveCount(1);
  await expect(transfer('Bob', 'Alice')).toHaveCount(0);
  await expect(roles).toHaveCount(0);
  await expect(sum).toHaveCount(0);
  await expect(trace.getByRole('button', { name: 'Unpin' })).toHaveCount(0);
  await expect(trace).toContainText('Hover over a balance or transfer above to trace it');
  // The remaining transfer renders the refreshed explanation.
  state = await api(`/groups/${trio.id}/bills`);
  const [, direct, passed] = explanation(state, trio.ids.Bob, trio.ids.Carol);
  await transfer('Bob', 'Carol').click();
  await expect(sum).toContainText(`Between them directly: ${currency(direct)} + ${currency(passed)} passed along = $80.71.`);

  // A settled group keeps "No transfers needed." and its balances stay traceable.
  await trio.repay('Bob', 'Carol', 8071);
  await expect(suggestions).toContainText('No transfers needed.');
  await expect(roles).toHaveCount(0);
  await ui.audit.getByRole('button', { name: /^Alice's balance, / }).click();
  await expect(column('You', 'Balance')).toBeVisible();
  await page.context().close();

  // Four members where the would-be intermediaries' direct debts ($20 and $10)
  // differ from the $30 passed along: the reason must not name either of them.
  const quad = await fixtureGroup(api, 'Lake house four', ['bob-token', 'carol-token', 'member-1-token']);
  await quad.bill('Lake house groceries', [['Carol', 1000], ['Bob', 5000], ['Alice', 2000], ['Member', 1000]]);
  await quad.bill('Canoe rental', [['Alice', 1000], ['Bob', 4000]]);
  await quad.bill('Firewood', [['Member', 1000], ['Bob', 3000]]);
  state = await api(`/groups/${quad.id}/bills`);
  const debt = (from, to) => state.ledger.directDebts.find(d => d.fromUserId === from && d.toUserId === to)?.amountCents ?? 0;
  const memberIds = state.ledger.members.map(member => member.userId);
  const generic = state.ledger.suggestions.find(s => s.explanation.passedAlongCents > 0
    && memberIds.some(x => x !== s.fromUserId && x !== s.toUserId && debt(x, s.toUserId) > 0)
    && !memberIds.some(x => x !== s.fromUserId && x !== s.toUserId
      && debt(x, s.toUserId) === s.explanation.passedAlongCents && debt(s.fromUserId, x) >= s.explanation.passedAlongCents));
  assert.ok(generic, 'fixture has a passed-along amount with no matching intermediary');
  assert.deepEqual(explanation(state, quad.ids.Bob, quad.ids.Carol).slice(0, 3), [8000, 5000, 3000]);
  assert.deepEqual(explanation(state, quad.ids.Bob, quad.ids.Member).slice(0, 3), [2000, 3000, -1000]);
  ui = await open(quad.id);
  const nameOf = id => state.ledger.members.find(member => member.userId === id).displayName;
  const recipient = generic.toUserId === quad.ids.Alice ? 'you' : nameOf(generic.toUserId);
  await ui.transfer(nameOf(generic.fromUserId), nameOf(generic.toUserId)).click();
  await expect(ui.roles).toHaveCount(2);
  await expect(ui.sum).toHaveText(`Between them directly: ${currency(generic.explanation.directCents)} + `
    + `${currency(generic.explanation.passedAlongCents)} passed along = ${currency(generic.amountCents)}. `
    + `${currency(generic.explanation.passedAlongCents)} of other debts is passed along to ${recipient} so the group needs fewer transfers.`);
  await expect(ui.sum).not.toContainText('owed');
  // A negative passed-along amount names the recipient's actual direct debt.
  await ui.transfer('Bob', 'Member').click();
  await expect(ui.column('Member', 'Receives')).toBeVisible();
  await expect(ui.sum).toHaveText('Between them directly: $30.00 − $10.00 sent elsewhere = $20.00. '
    + 'Member owed Carol $10.00. Bob pays that to Carol instead, so Member receives $10.00 less here.');
  await ui.page.context().close();
  return quad;
}

// Long histories (#175): the earlier subtotal keeps every column additive,
// while completion time, not purchase date, decides which ten entries remain.
async function checkLongLedger(pageFor, base, api) {
  const trio = await fixtureGroup(api, 'Long ledger trio', ['bob-token', 'carol-token']);
  const hiddenDebt = await trio.bill('Early shared groceries', [['Alice', 1000], ['Bob', 1840]]);
  const hiddenSolo = await trio.bill('Early solo pantry', [['Alice', 725]]);
  const recentDebt = await trio.bill('Recent Carol groceries', [['Carol', 1000], ['Bob', 2300]]);
  for (let i = 1; i <= 8; i++) await trio.bill(`Recent solo purchase ${i}`, [['Alice', 500 + i]]);
  const oldPurchase = await trio.bill('Completed last, bought long ago', [['Alice', 900]], { purchaseDate: '2025-01-15' });
  const state = await api(`/groups/${trio.id}/bills`);
  assert.equal(state.ledger.entries.length, 12);
  const hidden = state.ledger.entries.slice(0, -10);
  const recent = state.ledger.entries.slice(-10);
  assert.deepEqual(hidden.map(entry => entry.id), [hiddenDebt.id, hiddenSolo.id]);
  assert.equal(recent.at(-1).id, oldPurchase.id, 'the old purchase completed last');
  const hiddenIds = new Set(hidden.map(entry => entry.id));
  const suggestion = recipient => {
    const s = state.ledger.suggestions.find(s => s.fromUserId === trio.ids.Bob && s.toUserId === trio.ids[recipient]);
    assert.ok(s, `Bob has a suggested transfer to ${recipient}`);
    assert.equal(s.explanation.directLines.reduce((sum, line) => sum + line.cents, 0), s.explanation.directCents);
    assert.equal(s.explanation.directCents + s.explanation.passedAlongCents, s.amountCents);
    return s;
  };
  const toAlice = suggestion('Alice');
  const toCarol = suggestion('Carol');
  assert.deepEqual(toAlice.explanation.directLines, [{ entryId: hiddenDebt.id, cents: 1840 }]);
  assert.deepEqual(toCarol.explanation.directLines, [{ entryId: recentDebt.id, cents: 2300 }]);
  const hiddenDirect = toAlice.explanation.directLines.filter(line => hiddenIds.has(line.entryId))
    .reduce((sum, line) => sum + line.cents, 0);
  assert.equal(hiddenDirect, 1840);
  assert.ok(toCarol.explanation.directLines.every(line => !hiddenIds.has(line.entryId)));
  const hiddenCents = { Alice: 1840, Bob: -1840, Carol: null };
  for (const member of state.ledger.members) {
    const effects = hidden.flatMap(entry => entry.effects.filter(effect => effect.userId === member.userId));
    assert.equal(effects.length ? effects.reduce((sum, effect) => sum + effect.netCents, 0) : null,
      hiddenCents[member.displayName], 'worked hidden effects agree with the HTTP ledger');
  }

  const page = await pageFor('alice-token', { width: 1280, height: 900 });
  await page.goto(`${base}#/group-bills/${trio.id}`);
  const audit = page.getByRole('region', { name: 'Group balances and repayments' });
  const trace = audit.getByRole('region', { name: 'How the numbers add up' });
  const toggle = trace.getByRole('button', { name: 'How the numbers add up' });
  const table = ledgerTable(audit);
  const earlier = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Earlier bills and repayments/ }) });
  const showAll = table.getByRole('button', { name: 'Show all', exact: true });
  const rows = table.getByRole('row').filter({ has: page.getByRole('rowheader') })
    .filter({ hasNot: page.getByRole('rowheader', { name: 'Balance', exact: true }) });
  const directRows = table.getByRole('rowheader', { name: /, directly between them$/ });
  await toggle.click();
  await expect(table).toBeVisible();
  await mkdir('/tmp/st-175', { recursive: true });
  await trace.screenshot({ path: '/tmp/st-175/long.png', animations: 'disabled' });

  async function expectRecent() {
    await expect(earlier).toBeVisible();
    await expect(rows).toHaveCount(11);
    await expect(rows.first().getByRole('rowheader')).toHaveAccessibleName(/^Earlier bills and repayments/);
    await expect(earlier.getByRole('rowheader')).toContainText('2 entries');
    await expect(earlier.getByRole('cell')).toHaveText(state.ledger.members.map(member =>
      hiddenCents[member.displayName] === null ? '—Not involved' : signedCurrency(hiddenCents[member.displayName])));
    await expect(showAll).toBeVisible();
    assert.deepEqual(await table.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))),
      recent.map(entry => `#/bills/${entry.id}`), 'only the last ten entries are visible, oldest to newest');
    await expect(table.getByRole('rowheader', { name: /^Completed last, bought long ago/ })).toContainText('bought Jan 15');
    await expectColumnSums(audit, state);
  }
  await expectRecent();
  await showAll.click();
  await expect(earlier).toHaveCount(0);
  await expect(showAll).toHaveCount(0);
  await expect(rows).toHaveCount(12);
  assert.deepEqual(await table.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href'))),
    state.ledger.entries.map(entry => `#/bills/${entry.id}`), 'Show all restores every entry in server order');
  await expectColumnSums(audit, state);
  await toggle.click();
  await expect(table).toHaveCount(0);
  await toggle.click();
  await expectRecent();

  const transfer = (recipient, s) => audit.getByRole('region', { name: 'Suggested transfers' })
    .getByRole('button', { name: `Bob pays ${recipient}, ${currency(s.amountCents)}`, exact: true });
  await transfer('Alice', toAlice).click();
  await expect(earlier).not.toHaveClass(/\bledger-row-faded\b/);
  await expect(earlier.getByRole('rowheader')).toContainText(`includes ${currency(hiddenDirect)} direct between Bob and you`);
  await expect(earlier.getByRole('rowheader')).not.toHaveAccessibleName(/, directly between them$/);
  await expect(directRows).toHaveCount(0);
  await showAll.click();
  await expect(directRows).toHaveCount(toAlice.explanation.directLines.length);
  await expect(directRows).toContainText('Early shared groceries');
  await toggle.click();
  await toggle.click();
  await transfer('Carol', toCarol).click();
  await expect(earlier).toHaveClass(/\bledger-row-faded\b/);
  await expect(earlier.getByRole('rowheader')).not.toContainText('includes');
  await expect(directRows).toHaveCount(toCarol.explanation.directLines.length);
  await expect(directRows).toContainText('Recent Carol groceries');

  const balances = audit.getByRole('region', { name: "Everyone's balance" });
  await balances.getByRole('button', { name: /^Bob's balance, / }).click();
  await expect(table.getByRole('columnheader', { name: 'Bob Balance', exact: true })).toBeVisible();
  await expect(earlier).not.toHaveClass(/\bledger-row-faded\b/);
  await expect(earlier.getByRole('rowheader')).not.toContainText('includes');
  await balances.getByRole('button', { name: /^Carol's balance, / }).click();
  await expect(table.getByRole('columnheader', { name: 'Carol Balance', exact: true })).toBeVisible();
  await expect(earlier).toHaveClass(/\bledger-row-faded\b/);
  await page.context().close();
  return trio;
}

// Sum the actual displayed cells (including the earlier row), not a client
// helper. Both the Balance footer and the figures above must match the server.
async function expectColumnSums(audit, state) {
  const page = audit.page();
  const table = ledgerTable(audit);
  const rows = table.getByRole('row').filter({ has: page.getByRole('rowheader') })
    .filter({ hasNot: page.getByRole('rowheader', { name: 'Balance', exact: true }) });
  const sums = state.ledger.members.map(() => 0);
  for (const row of await rows.all()) {
    const texts = await row.getByRole('cell').allTextContents();
    assert.equal(texts.length, sums.length);
    for (const [i, text] of texts.entries()) {
      if (text === '—Not involved') continue;
      assert.match(text, /^[+−]?\$\d+\.\d{2}$/);
      const cents = Number(text.replace(/[+−$.]/g, '')) * (text.startsWith('−') ? -1 : 1);
      sums[i] += cents;
    }
  }
  assert.deepEqual(sums, state.ledger.members.map(member => member.netCents),
    'earlier subtotal plus visible entry effects equals every server balance');
  await expectFooterMatchesList(audit, state);
}

// A full 16-member table stays keyboard-scrollable, with readable equal member
// columns and a sticky bill column. Rules remain real, adjacent table cells.
async function checkWideLedger(pageFor, base, api) {
  const group = await fixtureGroup(api, 'Wide ledger sixteen', [
    'bob-token', 'carol-token', ...Array.from({ length: 13 }, (_, i) => `member-${i + 1}-token`),
  ]);
  const bill = await group.bill('Wide shared groceries', [['Alice', 1000], ['Bob', 1840], ['Carol', 2300]]);
  const state = await api(`/groups/${group.id}/bills`);
  assert.equal(state.ledger.members.length, 16);
  assert.equal(state.ledger.members.filter(member => member.displayName === 'Member').length, 13,
    'member-1 through member-13 have the same test display name; locate columns in server order');
  assert.deepEqual(state.ledger.entries.map(entry => entry.id), [bill.id]);
  const page = await pageFor('alice-token', { width: 1280, height: 900 });
  await page.goto(`${base}#/group-bills/${group.id}`);
  const audit = page.getByRole('region', { name: 'Group balances and repayments' });
  const trace = audit.getByRole('region', { name: 'How the numbers add up' });
  await trace.getByRole('button', { name: 'How the numbers add up' }).click();
  const table = ledgerTable(audit);
  await expect(table).toBeVisible();
  await mkdir('/tmp/st-175', { recursive: true });
  await trace.screenshot({ path: '/tmp/st-175/wide.png', animations: 'disabled' });
  const scroll = trace.getByRole('region', { name: 'Ledger table', exact: true });
  await expect(scroll).toBeVisible();
  await expect(scroll).toHaveAttribute('tabindex', '0');
  await scroll.focus();
  await expect(scroll).toBeFocused();
  const viewport = await scroll.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
  });
  assert.ok(viewport.scrollWidth > viewport.clientWidth, 'sixteen readable member columns overflow their wrapper');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    'wide ledger scrolls within its wrapper, not the whole page');
  const headers = table.getByRole('columnheader');
  await expect(headers).toHaveText(['Bill or repayment', ...state.ledger.members.map(member =>
    member.userId === group.ids.Alice ? 'You' : member.displayName)]);
  const widths = await headers.evaluateAll(nodes => nodes.slice(1).map(node => node.getBoundingClientRect().width));
  assert.ok(widths.every(width => width >= 116), `member columns are at least 116px: ${widths}`);
  assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `member columns have equal widths: ${widths}`);
  await expectFooterMatchesList(audit, state);
  const fixed = table.getByRole('columnheader', { name: 'Bill or repayment', exact: true }).or(table.getByRole('rowheader'));
  const before = await fixed.evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node);
    return { x: node.getBoundingClientRect().x, position: style.position, left: style.left };
  }));
  for (const cell of before) {
    assert.equal(cell.position, 'sticky', 'the first-column header and every rowheader are sticky');
    assert.equal(cell.left, '0px');
  }
  const footer = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Balance', exact: true }) });
  async function footerRule(scrolled) {
    const cells = await footer.getByRole('rowheader').or(footer.getByRole('cell')).evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { left: rect.left, right: rect.right, borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle };
    }));
    assert.equal(cells.length, 17);
    for (const cell of cells) {
      assert.equal(cell.borderWidth, '2px', 'each footer cell keeps its 2px top rule');
      assert.equal(cell.borderStyle, 'solid');
    }
    // Once scrolled, the first td moves behind the sticky th; member cells
    // still abut each other, and their clipped visible rules meet the th edge.
    for (let i = scrolled ? 2 : 1; i < cells.length; i++)
      assert.ok(Math.abs(cells[i].left - cells[i - 1].right) <= 1, 'adjacent footer rules abut');
    let covered = cells[0].right;
    for (const cell of cells.slice(1).filter(cell => cell.right > covered && cell.left < viewport.right)) {
      const left = Math.max(cell.left, cells[0].right);
      assert.ok(left <= covered + 1, 'visible Balance rule has no gap at the sticky edge or between member cells');
      covered = Math.max(covered, Math.min(cell.right, viewport.right));
    }
    assert.ok(covered >= viewport.right - 1, 'visible Balance rule reaches the wrapper right edge');
  }
  await footerRule(false);
  await scroll.evaluate(async node => {
    node.scrollLeft = node.scrollWidth - node.clientWidth;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.ok(await scroll.evaluate(node => node.scrollLeft > 0), 'wrapper actually scrolls');
  const after = await fixed.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x));
  assert.equal(after.length, before.length);
  for (const [i, x] of after.entries()) assert.ok(Math.abs(x - before[i].x) <= 1, 'first-column headers stay fixed after scrolling');
  const last = await headers.last().boundingBox();
  assert.ok(last && last.x >= viewport.left - 1 && last.x + last.width <= viewport.right + 1,
    'the last member header is visible at maximum scroll');
  await footerRule(true);
  await trace.screenshot({ path: '/tmp/st-175/wide.png', animations: 'disabled' });
  await page.context().close();
}

// Mobile explanations (#176) are checked through the same member/suggestion
// names as desktop, with the HTTP ledger as the source of every expected cent.
const sheetRow = (table, name) => table.getByRole('row')
  .filter({ has: table.page().getByRole('rowheader', { name, exact: typeof name === 'string' }) });
const sheetRows = table => table.getByRole('row').filter({ has: table.page().getByRole('rowheader') });
const balanceButton = (page, member) => page.getByRole('region', { name: "Everyone's balance" })
  .getByRole('button', { name: `${member.displayName}'s balance, ${signedCurrency(member.netCents)}`, exact: true });
const memberEntries = (state, userId) => state.ledger.entries.filter(entry => entry.effects.some(effect => effect.userId === userId));

function displayedCents(text) {
  const amount = text.trim();
  assert.match(amount, /^[+−]?\$\d+\.\d{2}$/, 'sheet cells contain a signed currency amount, not extra explanation');
  return Number(amount.replace(/[+−$.]/g, '')) * (amount.startsWith('−') ? -1 : 1);
}

async function expectSheetSum(table, totalName, expectedCents, rows) {
  const total = sheetRow(table, totalName).getByRole('cell');
  const totalCents = displayedCents(await total.innerText());
  assert.equal(totalCents, expectedCents, `${totalName} agrees with the tapped server figure`);
  let sum = 0;
  for (const row of await rows.all()) {
    await expect(row.getByRole('cell')).toHaveCount(1);
    sum += displayedCents(await row.getByRole('cell').innerText());
  }
  assert.equal(sum, totalCents, `displayed line effects and earlier subtotal add up to ${totalName}`);
}

async function expectSheetEntry(row, entry, cents, effect) {
  await expect(row.getByRole('cell')).toHaveText(signedCurrency(cents));
  const header = row.getByRole('rowheader');
  await expect(header).toContainText(entry.kind === 'bill' ? entry.title : 'Repayment');
  const effective = entry.kind === 'bill' ? entry.completedAt : entry.decidedAt;
  const effectiveDate = await row.page().evaluate(iso => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }), effective);
  await expect(header).toContainText(effectiveDate);
  if (entry.kind !== 'bill') return;
  const effectiveDay = await row.page().evaluate(iso => new Date(iso).toLocaleDateString('en-CA'), effective);
  if (entry.purchaseDate !== effectiveDay) {
    const bought = await row.page().evaluate(day => new Date(`${day}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }), entry.purchaseDate);
    await expect(header).toContainText(`bought ${bought}`);
  }
  if (!effect) return;
  if (effect.shareCents !== 0) {
    await expect(header).toContainText(/share/i);
    await expect(header).toContainText(currency(effect.shareCents));
  }
  if (effect.paidCents !== 0) {
    await expect(header).toContainText(/paid/i);
    await expect(header).toContainText(currency(effect.paidCents));
  }
  if (effect.adjustmentCents !== 0) {
    await expect(header).toContainText(/adjustment/i);
    await expect(header).toContainText(signedCurrency(-effect.adjustmentCents));
  }
}

async function openBalanceSheet(page, member, viewerId) {
  const button = balanceButton(page, member);
  await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(button).toContainText(signedCurrency(member.netCents));
  await expect(button.locator('svg[aria-hidden="true"]')).toBeVisible();
  await button.click();
  const dialog = page.getByRole('dialog', { name: member.userId === viewerId ? 'Your balance' : `${member.displayName}'s balance`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty('tagName', 'DIALOG');
  await expect(dialog.getByRole('table')).toHaveCount(1);
  return dialog;
}

async function checkMobileBalances(page, state, viewerId) {
  const audit = page.getByRole('region', { name: 'Group balances and repayments' });
  await expect(audit.getByRole('region', { name: 'How the numbers add up' })).toHaveCount(0);
  const balances = audit.getByRole('region', { name: "Everyone's balance" });
  await expect(balances.getByRole('button')).toHaveCount(state.ledger.members.length);
  for (const member of state.ledger.members) {
    const button = balanceButton(page, member);
    await expect(balances.getByRole('listitem').filter({ has: page.getByRole('button', {
      name: `${member.displayName}'s balance, ${signedCurrency(member.netCents)}`, exact: true,
    }) }).getByRole('button')).toHaveCount(1);
    const dialog = await openBalanceSheet(page, member, viewerId);
    const table = dialog.getByRole('table');
    const entries = memberEntries(state, member.userId);
    assert.ok(entries.length <= 10, 'short mobile fixture needs no earlier subtotal');
    const rows = sheetRows(table).filter({ hasNot: page.getByRole('rowheader', { name: 'Balance', exact: true }) });
    await expect(rows).toHaveCount(entries.length);
    for (const [i, entry] of entries.entries()) {
      const effect = entry.effects.find(effect => effect.userId === member.userId);
      await expectSheetEntry(rows.nth(i), entry, effect.netCents, effect);
    }
    await expect(sheetRow(table, 'Balance').getByRole('cell')).toHaveText(signedCurrency(member.netCents));
    await expectSheetSum(table, 'Balance', member.netCents, rows);
    await dialog.getByRole('button', { name: 'Close explanation', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  }
}

async function checkMobileSheetClosing(page, state, viewerId) {
  const member = state.ledger.members.find(member => member.userId === viewerId);
  const button = balanceButton(page, member);
  await button.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  assert.ok(before > 0, 'the fixture page is scrollable before opening its bottom sheet');
  for (const close of ['button', 'Escape', 'outside']) {
    const dialog = await openBalanceSheet(page, member, viewerId);
    const box = await dialog.boundingBox();
    assert.ok(box && box.y > 30 && Math.abs(box.y + box.height - page.viewportSize().height) <= 2,
      'the mobile dialog is a bottom sheet, leaving an outside-tap area above it');
    const position = () => page.evaluate(() => ({ scrollY: window.scrollY, bodyY: document.body.getBoundingClientRect().y }));
    const locked = await position();
    await page.mouse.move(10, 10);
    await page.mouse.wheel(0, -600);
    await page.keyboard.press('PageUp');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await position(), locked, 'scrolling over the backdrop cannot move the underlying page');
    if (close === 'button') await dialog.getByRole('button', { name: 'Close explanation', exact: true }).click();
    else if (close === 'Escape') await page.keyboard.press('Escape');
    else await page.mouse.click(10, 10);
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
  }
  // A lock which leaks after close is also a regression: scrolling must work again.
  await page.mouse.move(10, 10);
  await page.mouse.wheel(0, -600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before);
}

async function checkMobileAdjustment(pageFor, base, api) {
  const group = await fixtureGroup(api, 'Mobile adjustment pair', ['bob-token']);
  await group.bill('Adjusted shared groceries', [['Alice', 1000], ['Bob', 2000]], { totalCents: 3003 });
  await group.repay('Bob', 'Alice', 75);
  const state = await api(`/groups/${group.id}/bills`);
  assert.equal(state.ledger.entries[0].effects.find(effect => effect.userId === group.ids.Alice).adjustmentCents, 3,
    'the mobile fixture exercises a real nonzero initiator adjustment');
  const page = await pageFor('alice-token', { width: 390, height: 844 });
  await page.goto(`${base}#/group-bills/${group.id}`);
  await checkMobileBalances(page, state, group.ids.Alice);
  await page.context().close();
}

async function checkMobileTransfers(pageFor, base, api, group) {
  let positive = false, negative = false;
  for (const [token, viewerId] of [['alice-token', group.ids.Alice], ['bob-token', group.ids.Bob]]) {
    const state = await api(`/groups/${group.id}/bills`, token);
    const nameOf = id => state.ledger.members.find(member => member.userId === id).displayName;
    const person = (id, subject = false) => id === viewerId ? (subject ? 'You' : 'you') : nameOf(id);
    const page = await pageFor(token, { width: 390, height: 844 });
    await page.goto(`${base}#/group-bills/${group.id}`);
    await expect(page.getByRole('region', { name: 'How the numbers add up' })).toHaveCount(0);
    const transfers = page.getByRole('region', { name: 'Suggested transfers' });
    await expect(transfers.getByRole('button')).toHaveCount(state.ledger.suggestions.length);
    for (const suggestion of state.ledger.suggestions) {
      const { fromUserId: from, toUserId: to, amountCents, explanation } = suggestion;
      const button = transfers.getByRole('button', { name: `${nameOf(from)} pays ${nameOf(to)}, ${currency(amountCents)}`, exact: true });
      await expect(transfers.getByRole('listitem').filter({ has: page.getByRole('button', {
        name: `${nameOf(from)} pays ${nameOf(to)}, ${currency(amountCents)}`, exact: true,
      }) }).getByRole('button')).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(button).toContainText(currency(amountCents));
      await expect(button.locator('svg[aria-hidden="true"]')).toBeVisible();
      await button.click();
      const payer = person(from, true), recipient = person(to);
      const dialog = page.getByRole('dialog', { name: `${payer} ${from === viewerId ? 'pay' : 'pays'} ${recipient}`, exact: true });
      await expect(dialog).toBeVisible();
      const table = dialog.getByRole('table');
      const directName = `${payer} ${from === viewerId ? 'owe' : 'owes'} ${recipient} directly`;
      const direct = sheetRow(table, directName);
      const passed = sheetRow(table, /^(?:Passed along|Sent elsewhere)/);
      const lines = sheetRows(table).filter({ hasNot: page.getByRole('rowheader', { name: directName, exact: true }) })
        .filter({ hasNot: page.getByRole('rowheader', { name: /^(?:Passed along|Sent elsewhere|Suggested transfer)/ }) });
      await expect(lines).toHaveCount(explanation.directLines.length);
      for (const [i, line] of explanation.directLines.entries())
        await expectSheetEntry(lines.nth(i), state.ledger.entries.find(entry => entry.id === line.entryId), line.cents);
      await expect(direct.getByRole('cell')).toHaveText(signedCurrency(explanation.directCents));
      await expectSheetSum(table, directName, explanation.directCents, lines);
      await expect(passed).toHaveCount(explanation.passedAlongCents === 0 ? 0 : 1);
      if (explanation.passedAlongCents !== 0) {
        positive ||= explanation.passedAlongCents > 0;
        negative ||= explanation.passedAlongCents < 0;
        await expect(passed.getByRole('rowheader')).toHaveAccessibleName(explanation.passedAlongCents > 0 ? /^Passed along/ : /^Sent elsewhere/);
        await expect(passed.getByRole('cell')).toHaveText(signedCurrency(explanation.passedAlongCents));
        // The passed-along reason is explanatory text, not merely an amount.
        await expect(passed.getByRole('rowheader')).toContainText(/(?:debt|owe|pays|transfer)/i);
      }
      await expect(sheetRow(table, 'Suggested transfer').getByRole('cell')).toHaveText(currency(amountCents));
      await expectSheetSum(table, 'Suggested transfer', amountCents, direct.or(passed));
      const payerBalance = state.ledger.members.find(member => member.userId === from).netCents;
      const split = dialog.getByRole('paragraph').filter({ hasText: /whole balance/ });
      await expect(split).toHaveCount(1);
      await expect(split).toContainText(`${from === viewerId ? 'Your' : `${nameOf(from)}'s`} whole balance is ${signedCurrency(payerBalance)}`);
      for (const s of state.ledger.suggestions.filter(s => s.fromUserId === from))
        await expect(split).toContainText(`${currency(s.amountCents)} to ${person(s.toUserId)}`);
      assert.equal(await split.evaluate(node => Boolean(node.compareDocumentPosition(node.closest('dialog').querySelector('table')) & Node.DOCUMENT_POSITION_PRECEDING)), true,
        'the payer split follows the explanation table');
      await dialog.getByRole('button', { name: 'Close explanation', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(button).toBeFocused();
    }
    await page.context().close();
  }
  assert.ok(positive && negative, 'mobile transfer checks cover both passed along and sent elsewhere');
}

async function checkMobileLongLedger(pageFor, base, api, group) {
  const state = await api(`/groups/${group.id}/bills`);
  assert.equal(state.ledger.entries.length, 12, 'reuse the desktop twelve-entry ledger fixture');
  const member = state.ledger.members.find(member => member.userId === group.ids.Alice);
  const entries = memberEntries(state, member.userId);
  assert.equal(entries.length, 11, 'Alice has eleven effects; the Carol/Bob bill does not involve her');
  const hidden = entries.slice(0, -10), recent = entries.slice(-10);
  const page = await pageFor('alice-token', { width: 390, height: 844 });
  await page.goto(`${base}#/group-bills/${group.id}`);
  const dialog = await openBalanceSheet(page, member, group.ids.Alice);
  const table = dialog.getByRole('table');
  const earlier = sheetRow(table, /^Earlier bills and repayments/);
  const rows = sheetRows(table).filter({ hasNot: page.getByRole('rowheader', { name: /^(?:Earlier bills and repayments|Balance$)/ }) });
  await expect(rows).toHaveCount(10);
  await expect(sheetRows(table).first().getByRole('rowheader')).toHaveAccessibleName(/^Earlier bills and repayments/);
  await expect(earlier.getByRole('rowheader')).toContainText(`${hidden.length} ${hidden.length === 1 ? 'entry' : 'entries'}`);
  await expect(earlier.getByRole('cell')).toHaveText(signedCurrency(hidden.reduce((sum, entry) =>
    sum + entry.effects.find(effect => effect.userId === member.userId).netCents, 0)));
  for (const [i, entry] of recent.entries()) {
    const effect = entry.effects.find(effect => effect.userId === member.userId);
    await expectSheetEntry(rows.nth(i), entry, effect.netCents, effect);
  }
  await expectSheetSum(table, 'Balance', member.netCents, rows.or(earlier));
  await earlier.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(earlier).toHaveCount(0);
  await expect(table.getByRole('button', { name: 'Show all', exact: true })).toHaveCount(0);
  await expect(rows).toHaveCount(entries.length);
  for (const [i, entry] of entries.entries()) {
    const effect = entry.effects.find(effect => effect.userId === member.userId);
    await expectSheetEntry(rows.nth(i), entry, effect.netCents, effect);
  }
  await expectSheetSum(table, 'Balance', member.netCents, rows);
  await dialog.getByRole('button', { name: 'Close explanation', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(balanceButton(page, member)).toBeFocused();
  await page.context().close();
}
