// Receipt scenarios: the bill-draft editor's recovery, request ordering and navigation
// guard. Each starts from its own group and records.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { processingTitle, receiptEnvironment, receiptGroup, receiptPhoto } from './fixtures.mjs';

export const scenarios = [
  { name: 'editor-recovery', environment: receiptEnvironment, run: editorRecovery },
  { name: 'editor-scan-reordering', environment: receiptEnvironment, run: scanReordering },
  { name: 'editor-repeated-initiation', environment: receiptEnvironment, run: repeatedInitiation },
  { name: 'editor-storage-failure', environment: receiptEnvironment, run: storageFailure },
  { name: 'editor-group-deletion', environment: receiptEnvironment, run: groupDeletion },
  { name: 'editor-removed-draft', environment: receiptEnvironment, run: removedDraft },
  { name: 'editor-failed-reads', environment: receiptEnvironment, run: failedReads },
  { name: 'editor-rescan', environment: receiptEnvironment, run: rescan },
];

// A saved By amount draft, which opens on the People step with its title.
async function amountDraft(env, group, memberIds, title) {
  const id = randomUUID();
  await env.api(`/groups/${group.id}/receipt-drafts/${id}`, 'alice-token', 'PUT', {
    revision: 0,
    data: {
      mode: 'manual', title, purchaseDate: '2026-09-24', timeZone: 'America/Toronto',
      notes: '', totalCents: 1200, participantIds: [memberIds.Alice, memberIds.Bob], items: [],
      receipt: { subtotalCents: null, discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
    },
  });
  return id;
}

// The editor's browser copy of a draft, or null when none is kept.
const storedDraft = (page, id) => page.evaluate(draftId => {
  const key = Object.keys(sessionStorage).find(entry => entry.startsWith('receipt-draft:') && entry.endsWith(`:${draftId}`));
  return key ? JSON.parse(sessionStorage.getItem(key)) : null;
}, id);

const titleField = page => page.getByLabel('Bill title', { exact: true });
const discardDialog = page => page.getByRole('heading', { name: 'Discard unsaved changes?' });
const recoveredNotice = page => page.getByText('Recovered your unsaved changes.', { exact: true });

// Browser back on clean and dirty drafts, a failed save recovered after reopening,
// and an older recovery copy that never replaces a newer saved draft.
async function editorRecovery(env) {
  const { api } = env;
  const { group, memberIds, groupRoute, newBillRoute, alice, expectNewBillRoute } = await receiptGroup(env);
  const id = await amountDraft(env, group, memberIds, 'Recovery check');

  // Back on a clean draft leaves at once and keeps no browser copy.
  await alice.goto(`${newBillRoute}/${id}`);
  await expect(titleField(alice)).toHaveValue('Recovery check');
  await expect.poll(async () => (await storedDraft(alice, id))?.data.title).toBe('Recovery check');
  await alice.goBack();
  await expect(alice).toHaveURL(groupRoute);
  await expect(discardDialog(alice)).toHaveCount(0);
  assert.equal(await storedDraft(alice, id), null);

  // A failed save keeps the edit in the browser, not on the server.
  await alice.goto(`${newBillRoute}/${id}`);
  await titleField(alice).fill('Edited before failure');
  const saveRequest = `**/api/groups/${group.id}/receipt-drafts/${id}`;
  await alice.route(saveRequest, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Saving is unavailable.' }) })
    : route.continue());
  await alice.getByRole('button', { name: 'Save draft & close', exact: true }).click();
  await expect(alice.getByText('Saving is unavailable.', { exact: true })).toBeVisible();
  await expectNewBillRoute(id);
  await alice.unroute(saveRequest);
  // Back on a dirty draft asks first.
  await alice.goBack();
  await expect(discardDialog(alice)).toBeVisible();
  await alice.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expectNewBillRoute(id);
  await expect.poll(async () => (await storedDraft(alice, id))?.data.title).toBe('Edited before failure');
  await alice.reload();
  await expect(recoveredNotice(alice)).toBeVisible();
  await expect(titleField(alice)).toHaveValue('Edited before failure');
  assert.equal((await api(`/receipt-drafts/${id}`)).draft.data.title, 'Recovery check');

  // A save elsewhere makes the browser copy incompatible: the newer saved draft opens.
  const saved = (await api(`/receipt-drafts/${id}`)).draft;
  await api(`/groups/${group.id}/receipt-drafts/${id}`, 'alice-token', 'PUT', {
    revision: saved.revision, data: { ...saved.data, title: 'Saved elsewhere' },
  });
  // The open editor keeps its unrelated local edit rather than merging fields.
  await expect(titleField(alice)).toHaveValue('Edited before failure');
  await alice.reload();
  await expect(titleField(alice)).toHaveValue('Saved elsewhere');
  await expect(recoveredNotice(alice)).toHaveCount(0);
  await expect.poll(async () => (await storedDraft(alice, id))?.revision).toBe(saved.revision + 1);
}

// A scan result delivered over the live stream before the scan reply is kept.
async function scanReordering(env) {
  const { api } = env;
  const { newBillRoute, alice, titledDraft } = await receiptGroup(env);
  const id = await titledDraft('Reordered scan');
  await alice.goto(`${newBillRoute}/${id}`);
  await expect(alice.getByRole('heading', { name: 'Start with your receipt' })).toBeVisible();
  let releaseReply;
  const replyHeld = new Promise(resolve => { releaseReply = resolve; });
  await alice.route('**/api/receipt-drafts/*/extract', async route => {
    // route.fetch runs in Node, outside Chromium's test-host DNS mapping.
    const upstream = new URL(route.request().url());
    upstream.hostname = '127.0.0.1';
    const response = await route.fetch({ url: upstream.href });
    await replyHeld;
    await route.fulfill({ response });
  });
  const liveResult = alice.waitForResponse(async response =>
    response.request().method() === 'GET' && response.url().endsWith(`/api/receipt-drafts/${id}`) &&
    (await response.json()).draft.processingStatus === 'ready');
  await alice.getByLabel('Choose a receipt image').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: await receiptPhoto(300, 500) });
  await alice.getByRole('button', { name: 'Use this photo', exact: true }).click();
  await liveResult;
  assert.equal((await api(`/receipt-drafts/${id}`)).draft.processingStatus, 'ready');
  // The older, still-processing reply arrives last and must not lock the draft again.
  releaseReply();
  await expect(alice.getByRole('heading', { name: 'Check your items' })).toBeVisible();
  await expect(alice.getByRole('status').filter({ hasText: 'Reading receipt…' })).toHaveCount(0);
  await expect(alice.getByRole('button', { name: 'Edit Friendly item 1', exact: true })).toBeEnabled();
  await expect(alice.getByText(processingTitle, { exact: true })).toHaveCount(0);
  await expect(alice.getByRole('button', { name: 'Continue to sharing' })).toBeEnabled();
}

// Repeated clicks send one initiation; a retry after a lost reply resends its revision.
async function repeatedInitiation(env) {
  const { api } = env;
  const { group, memberIds, newBillRoute, alice } = await receiptGroup(env);
  const id = await amountDraft(env, group, memberIds, 'Initiated once');
  await alice.goto(`${newBillRoute}/${id}`);
  await expect(titleField(alice)).toHaveValue('Initiated once');
  const revisions = [];
  await alice.route('**/api/receipt-drafts/*/initialize', async route => {
    revisions.push(route.request().postDataJSON().revision);
    if (revisions.length > 1) return route.continue();
    const upstream = new URL(route.request().url());
    upstream.hostname = '127.0.0.1';
    await route.fetch({ url: upstream.href });
    await route.abort('failed');
  });
  await alice.getByRole('button', { name: 'Share bill', exact: true }).dblclick();
  const retry = alice.getByRole('button', { name: 'Retry sharing', exact: true });
  await expect(retry).toBeVisible();
  assert.equal(revisions.length, 1);
  await expect(alice.getByText("We didn't hear back. Retrying sends the same bill.", { exact: true })).toBeVisible();
  await expect(titleField(alice)).toBeDisabled();
  await retry.dblclick();
  await expect(alice.getByRole('heading', { name: 'Initiated once' })).toBeVisible();
  assert.equal(revisions.length, 2);
  assert.equal(revisions[1], revisions[0]);
  assert.equal((await api(`/groups/${group.id}/bills`)).bills.filter(bill => bill.title === 'Initiated once').length, 1);
  assert.equal(await storedDraft(alice, id), null);
}

// Unavailable or full browser storage never claims a recovery copy, and editing continues.
async function storageFailure(env) {
  const { api } = env;
  const { group, groupRoute, newBillRoute, alice, titledDraft } = await receiptGroup(env);
  // Copies holding an unsaved photo exceed the quota; `fail-recovery` makes every copy fail.
  await alice.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (this === window.sessionStorage && name.startsWith('receipt-draft:') &&
        (localStorage.getItem('fail-recovery') || value.includes('"pendingPhoto"')))
        throw new DOMException('Storage is full', 'QuotaExceededError');
      return setItem.call(this, name, value);
    };
  });
  const id = await titledDraft('Storage check');
  await alice.goto(`${newBillRoute}/${id}`);
  await alice.reload();
  await expect(alice.getByRole('heading', { name: 'Start with your receipt' })).toBeVisible();
  await expect.poll(async () => (await storedDraft(alice, id))?.data.title).toBe('Storage check');

  // A large unsaved photo removes the older copy instead of leaving it as if it were current.
  let releaseSave, saveSent;
  const saveHeld = new Promise(resolve => { releaseSave = resolve; });
  const saveContinued = new Promise(resolve => { saveSent = resolve; });
  const saveRequest = `**/api/groups/${group.id}/receipt-drafts/${id}`;
  await alice.route(saveRequest, async route => {
    await saveHeld;
    await route.continue();
    saveSent();
  });
  await alice.getByLabel('Choose a receipt image').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: await receiptPhoto(300, 500) });
  await alice.getByRole('button', { name: 'Use this photo', exact: true }).click();
  await expect.poll(() => storedDraft(alice, id)).toBe(null);
  releaseSave();
  await saveContinued;
  await alice.unroute(saveRequest);
  await expect(alice.getByRole('button', { name: 'Edit Friendly item 1', exact: true })).toBeEnabled();
  await expect.poll(async () => (await storedDraft(alice, id))?.data.items.length).toBe(1);

  // With storage failing, a reload opens the saved draft and claims no recovered edits.
  await alice.evaluate(() => localStorage.setItem('fail-recovery', '1'));
  await alice.getByRole('button', { name: 'Continue to sharing' }).click();
  await titleField(alice).fill('Only in memory');
  await expect.poll(() => storedDraft(alice, id)).toBe(null);
  await alice.reload();
  await expect(titleField(alice)).toHaveValue('Storage check');
  await expect(recoveredNotice(alice)).toHaveCount(0);
  // Explicit saving still persists the draft.
  await titleField(alice).fill('Saved without a copy');
  await alice.getByRole('button', { name: 'Save draft & close', exact: true }).click();
  await expect(alice).toHaveURL(groupRoute);
  assert.equal((await api(`/receipt-drafts/${id}`)).draft.data.title, 'Saved without a copy');
  await alice.evaluate(() => localStorage.removeItem('fail-recovery'));
}

// Deleting the group while a draft has unsaved edits leaves the editor without
// asking and clears the group's browser copies.
async function groupDeletion(env) {
  const { api, base } = env;
  const { group, memberIds, newBillRoute, alice } = await receiptGroup(env);
  const id = await amountDraft(env, group, memberIds, 'Deleted with group');
  await alice.goto(`${newBillRoute}/${id}`);
  await titleField(alice).fill('Unsaved when deleted');
  await expect.poll(async () => (await storedDraft(alice, id))?.data.title).toBe('Unsaved when deleted');
  await api(`/groups/${group.id}`, 'alice-token', 'DELETE');
  await expect(alice).toHaveURL(`${base}#`);
  // Alice has no other group, so Home offers to create one.
  await expect(alice.getByRole('button', { name: 'Create your first group', exact: true })).toBeVisible();
  await expect(discardDialog(alice)).toHaveCount(0);
  assert.deepEqual(await alice.evaluate(groupId => Object.keys(sessionStorage)
    .filter(key => key.startsWith('receipt-draft:') && key.includes(`:${groupId}:`)), group.id), []);
}

// A draft deleted elsewhere cannot be saved or reloaded; leaving does not ask to discard it.
async function removedDraft(env) {
  const { api } = env;
  const { group, memberIds, groupRoute, newBillRoute, alice } = await receiptGroup(env);
  const id = await amountDraft(env, group, memberIds, 'Removed elsewhere');
  await alice.goto(`${newBillRoute}/${id}`);
  await titleField(alice).fill('Unsaved when removed');
  const saved = (await api(`/receipt-drafts/${id}`)).draft;
  await api(`/receipt-drafts/${id}`, 'alice-token', 'DELETE', { revision: saved.revision });
  await alice.getByRole('button', { name: 'Save draft & close', exact: true }).click();
  await alice.getByRole('button', { name: 'Reload saved draft, discarding local edits', exact: true }).click();
  await expect(alice.getByText('This draft no longer exists. It may have been deleted or shared elsewhere.', { exact: true })).toBeVisible();
  assert.equal(await storedDraft(alice, id), null);
  await alice.getByRole('button', { name: 'Back to group' }).click();
  await expect(alice).toHaveURL(groupRoute);
  await expect(discardDialog(alice)).toHaveCount(0);
}

// A failed first save of a new bill, then a reload that finds nothing saved, keeps the
// local work; a failed opening read keeps recovery until Try again opens the draft.
async function failedReads(env) {
  const { api } = env;
  const { group, memberIds, groupRoute, newBillRoute, alice } = await receiptGroup(env);
  const failure = message => route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: message }) });

  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  await alice.getByRole('button', { name: 'Split by amount instead' }).click();
  await titleField(alice).fill('Never saved');
  const saveRequest = `**/api/groups/${group.id}/receipt-drafts/*`;
  await alice.route(saveRequest, route => route.request().method() === 'PUT' ? failure('Saving is unavailable.')(route) : route.continue());
  await alice.getByRole('button', { name: 'Save draft & close', exact: true }).click();
  await expect(alice.getByText('Saving is unavailable.', { exact: true })).toBeVisible();
  await alice.getByRole('button', { name: 'Reload saved draft, discarding local edits', exact: true }).click();
  await expect(alice.getByRole('status').filter({ hasText: 'Reloading…' })).toHaveCount(0);
  await expect(alice.getByText('This draft no longer exists. It may have been deleted or shared elsewhere.', { exact: true })).toHaveCount(0);
  await expect(titleField(alice)).toHaveValue('Never saved');
  await expect(titleField(alice)).toBeEnabled();
  await alice.unroute(saveRequest);
  await alice.getByRole('button', { name: 'Save draft & close', exact: true }).click();
  await expect(alice).toHaveURL(groupRoute);
  assert.deepEqual((await api(`/groups/${group.id}/receipt-drafts`)).drafts.map(draft => draft.data.title), ['Never saved']);

  const id = await amountDraft(env, group, memberIds, 'Opened after retry');
  await alice.goto(`${newBillRoute}/${id}`);
  await titleField(alice).fill('Recovered after retry');
  await expect.poll(async () => (await storedDraft(alice, id))?.data.title).toBe('Recovered after retry');
  const unloadBlocked = () => alice.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  let failing = true, releaseRead;
  const readHeld = new Promise(resolve => { releaseRead = resolve; });
  const draftRequest = `**/api/receipt-drafts/${id}`;
  await alice.route(draftRequest, async route => {
    if (!failing || route.request().method() !== 'GET') return route.continue();
    await readHeld;
    await failure('Drafts are unavailable.')(route);
  });
  await alice.reload();
  // While the read is pending, closing the tab would discard the recovered copy.
  await expect(alice.getByText('Opening draft…', { exact: true })).toBeVisible();
  assert.equal(await unloadBlocked(), true);
  releaseRead();
  await expect(alice.getByText('Drafts are unavailable.', { exact: true })).toBeVisible();
  await expect(titleField(alice)).toHaveCount(0);
  assert.equal((await storedDraft(alice, id))?.data.title, 'Recovered after retry');
  // Closing the tab would discard that copy, so unloading still asks first.
  assert.equal(await unloadBlocked(), true);
  failing = false;
  await alice.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(titleField(alice)).toHaveValue('Recovered after retry');
  await expect(recoveredNotice(alice)).toBeVisible();
  await alice.unroute(draftRequest);
}

// Replacing scanned items with a new photo returns to the usual scan controls, and a
// scan whose photo is unavailable is an ordinary error, not a deleted draft.
async function rescan(env) {
  const { newBillRoute, alice, titledDraft } = await receiptGroup(env);
  const id = await titledDraft('Rescanned receipt');
  await alice.goto(`${newBillRoute}/${id}`);
  const chooseAndCrop = async name => {
    await alice.getByLabel('Choose a receipt image').setInputFiles({ name, mimeType: 'image/png', buffer: await receiptPhoto(300, 500) });
    await alice.getByRole('button', { name: 'Use this photo', exact: true }).click();
  };
  const row = alice.getByRole('button', { name: 'Edit Friendly item 1', exact: true });
  const replaceItems = alice.getByRole('button', { name: 'Scan and replace current items…', exact: true });
  const keepItems = alice.getByRole('button', { name: 'Keep current items', exact: true });
  await chooseAndCrop('receipt.png');
  await expect(row).toBeEnabled();

  await replaceItems.click();
  await expect(keepItems).toBeVisible();
  await alice.getByRole('button', { name: 'Replace receipt photo', exact: true }).click();
  await expect(alice.getByRole('heading', { name: 'Start with your receipt' })).toBeVisible();
  await chooseAndCrop('second.png');
  await expect(alice.getByRole('heading', { name: 'Check your items' })).toBeVisible();
  await expect(row).toBeEnabled();
  await expect(replaceItems).toBeVisible();
  await expect(keepItems).toHaveCount(0);

  const unavailable = 'No photo is available. Receipt photos expire after six months.';
  const extractRequest = '**/api/receipt-drafts/*/extract';
  await alice.route(extractRequest, route => route.fulfill({
    status: 404, contentType: 'application/json', body: JSON.stringify({ error: unavailable }),
  }));
  await replaceItems.click();
  await alice.getByRole('button', { name: 'Replace current items with a new scan', exact: true }).click();
  await expect(alice.getByText(unavailable, { exact: true })).toBeVisible();
  await expect(alice.getByText('This draft no longer exists. It may have been deleted or shared elsewhere.', { exact: true })).toHaveCount(0);
  await expect(row).toBeEnabled();
  await expect.poll(async () => (await storedDraft(alice, id))?.data.title).toBe('Rescanned receipt');
  await alice.unroute(extractRequest);
}
