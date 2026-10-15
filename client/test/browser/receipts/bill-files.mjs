import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { receiptEnvironment, receiptGroup, receiptPhoto } from './fixtures.mjs';

export const scenarios = [
  { name: 'bill-file-type', environment: receiptEnvironment, run: wrongBillFileType },
  { name: 'bill-file-large', environment: receiptEnvironment, run: largeBillFile },
  { name: 'bill-file-invalid', environment: receiptEnvironment, run: invalidBillFile },
  { name: 'bill-file-replace', environment: receiptEnvironment, run: replaceDraft },
  { name: 'bill-file-import', environment: receiptEnvironment, run: importBillFile },
  { name: 'bill-file-export', environment: receiptEnvironment, run: exportBillFile },
  { name: 'bill-file-busy', environment: receiptEnvironment, run: importWhileSaving },
  { name: 'bill-file-save-failure', environment: receiptEnvironment, run: importSaveFailure },
];

async function importWhileSaving(env) {
  const { alice, newBillRoute, group, stepButton } = await receiptGroup(env);
  await alice.goto(newBillRoute);
  // A user can start saving while the picker is still reading a file.
  await alice.evaluate(() => {
    const text = File.prototype.text;
    File.prototype.text = function () {
      return new Promise(resolve => { window.finishBillRead = () => resolve(text.call(this)); });
    };
  });
  await alice.getByLabel('Import a bill file', { exact: true }).setInputFiles({
    name: 'dinner.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      format: 'sharetally.bill', version: 1, mode: 'manual', title: 'Dinner', totalCents: 1234, notes: '',
    })),
  });
  await expect.poll(() => alice.evaluate(() => typeof window.finishBillRead)).toBe('function');
  let finishSave;
  const saving = new Promise(resolve => { finishSave = resolve; });
  await alice.route(`**/api/groups/${group.id}/receipt-drafts/*`, async route => {
    await saving;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Saving is unavailable.' }) });
  });
  try {
    await alice.getByRole('button', { name: 'Save draft & close', exact: true }).click();
    await expect(alice.getByText('Saving draft…', { exact: true })).toBeVisible();
    await alice.evaluate(() => window.finishBillRead());
    await expect(alice.getByRole('alert')).toContainText("Couldn't import the bill right now. Try again.");
    await expect(alice.getByRole('alert')).toContainText('Nothing has been filled in.');
    await expect(alice.getByRole('dialog')).toHaveCount(0);
  } finally {
    finishSave();
  }
  await expect(alice.getByText('Saving is unavailable.', { exact: true })).toBeVisible();
  await expect(stepButton('People')).toBeDisabled();
  await alice.getByRole('radio', { name: 'By amount', exact: true }).check();
  await expect(alice.getByLabel('Total to split', { exact: true })).toHaveValue('');
  assert.deepEqual((await env.api(`/groups/${group.id}/receipt-drafts`)).drafts, []);
}

async function importSaveFailure(env) {
  for (const replace of [false, true]) {
    const { alice, newBillRoute, groupRoute, titledDraft, stepButton, group } = await receiptGroup(env);
    const id = replace ? await titledDraft('Original draft') : null;
    await alice.goto(id ? `${newBillRoute}/${id}` : newBillRoute);
    const original = id ? (await env.api(`/receipt-drafts/${id}`)).draft : null;
    let saves = 0;
    await alice.route(`**/api/groups/${group.id}/receipt-drafts/*`, route => ++saves === 1
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Saving is unavailable.' }) })
      : route.continue());
    await alice.getByLabel('Import a bill file', { exact: true }).setInputFiles({
      name: 'dinner.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
        format: 'sharetally.bill', version: 1, mode: 'manual', title: 'Dinner', totalCents: 1234, notes: '',
      })),
    });
    if (replace) await alice.getByRole('button', { name: 'Replace draft', exact: true }).click();
    await expect(alice.getByRole('alert')).toContainText('Draft needs attention');
    await expect(alice.getByRole('alert')).toContainText('Saving is unavailable.');
    await expect(alice.getByText('Nothing has been filled in.', { exact: true })).toHaveCount(0);
    await expect(alice.getByRole('heading', { name: 'How do you want to split it?' })).toBeVisible();
    if (original) assert.deepEqual((await env.api(`/receipt-drafts/${id}`)).draft, original);
    else assert.deepEqual((await env.api(`/groups/${group.id}/receipt-drafts`)).drafts, []);
    await stepButton('People').click();
    await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Dinner');
    await expect(alice.getByLabel('Total paid (CAD)', { exact: true })).toHaveValue('12.34');
    await alice.getByRole('button', { name: 'Save draft & close', exact: true }).click();
    await expect(alice).toHaveURL(groupRoute);
    const [saved] = (await env.api(`/groups/${group.id}/receipt-drafts`)).drafts;
    assert.equal(saved.data.title, 'Dinner');
    assert.equal(saves, 2);
  }
}

async function savedItemBill(env, group, memberIds) {
  const id = randomUUID();
  const { draft } = await env.api(`/groups/${group.id}/receipt-drafts/${id}`, 'alice-token', 'PUT', {
    revision: 0,
    data: {
      mode: 'items', title: 'Weekly groceries', notes: 'Bring bags', purchaseDate: '2026-09-01', timeZone: 'America/Toronto',
      totalCents: 3200, participantIds: [memberIds.Alice, memberIds.Bob],
      receipt: { subtotalCents: 3000, taxCents: 100, discountCents: 0, extraCents: 0, pricesIncludeTax: false },
      items: [
        { id: randomUUID(), name: 'Apples', originalText: 'APPLES', quantity: '2', amountCents: 1000, discountCents: 0, taxable: true, finalCents: 1100, manualFinal: false },
        { id: randomUUID(), name: 'Milk', originalText: 'MILK', quantity: '1', amountCents: 2000, discountCents: 0, taxable: false, finalCents: 2000, manualFinal: false },
      ],
    },
  });
  return (await env.api(`/receipt-drafts/${id}/initialize`, 'alice-token', 'POST', { revision: draft.revision })).bill;
}

async function exportBillFile(env) {
  const { group, memberIds } = await receiptGroup(env);
  const bill = await savedItemBill(env, group, memberIds);
  // A participant who did not pay can export too.
  const bob = await env.pageFor('bob-token', { width: 1440, height: 1000 });
  await bob.goto(`${env.base}#/bills/${bill.id}`);
  await expect(bob.getByRole('button', { name: 'Export bill file', exact: true })).toBeVisible({ timeout: 3000 });
  const [file] = await Promise.all([bob.waitForEvent('download'), bob.getByRole('button', { name: 'Export bill file', exact: true }).click()]);
  await mkdir('/tmp/bill-file-impl', { recursive: true });
  await file.saveAs('/tmp/bill-file-impl/export.sharetally.json');
  assert.equal(file.suggestedFilename(), 'weekly-groceries-2026-09-01.sharetally.json');
  assert.deepEqual(JSON.parse(await readFile('/tmp/bill-file-impl/export.sharetally.json', 'utf8')), {
    format: 'sharetally.bill', version: 1, mode: 'items', title: 'Weekly groceries', notes: 'Bring bags', totalCents: 3200,
    receipt: { subtotalCents: 3000, taxCents: 100, discountCents: 0, extraCents: 0, pricesIncludeTax: false },
    items: [
      { name: 'Apples', quantity: '2', amountCents: 1000, discountCents: 0, taxable: true },
      { name: 'Milk', quantity: '1', amountCents: 2000, discountCents: 0, taxable: false },
    ],
  });
  await mkdir('/tmp/bill-file-impl', { recursive: true });
  await bob.screenshot({ path: '/tmp/bill-file-impl/bill-export-1440.png', fullPage: true, animations: 'disabled' });
  return bob;
}

async function importBillFile(env) {
  const bob = await exportBillFile(env);
  const { group } = await env.api('/groups', 'bob-token', 'POST', { name: 'Other friends', icon: { type: 'unicode', value: '🍽️' } });
  const invitation = await env.api(`/groups/${group.id}/invitation`, 'bob-token');
  await env.api('/groups/join', 'carol-token', 'POST', { token: invitation.path.split('/').at(-1) });
  await bob.goto(`${env.base}#/new-bill/${group.id}`);
  const importLink = bob.getByRole('button', { name: 'Import a bill', exact: true });
  await expect(importLink).toBeVisible({ timeout: 3000 });
  await bob.screenshot({ path: '/tmp/bill-file-impl/step01-idle-1440.png', fullPage: true, animations: 'disabled' });
  await bob.setViewportSize({ width: 390, height: 844 });
  await importLink.scrollIntoViewIfNeeded();
  await expect(importLink).toBeInViewport();
  assert.equal(await bob.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await bob.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await bob.screenshot({ path: '/tmp/bill-file-impl/step01-idle-390.png', fullPage: true, animations: 'disabled' });
  await bob.setViewportSize({ width: 1440, height: 1000 });
  // Test the real picker separately from the receipt photo inputs.
  const chooserPromise = bob.waitForEvent('filechooser');
  await importLink.click();
  const chooser = await chooserPromise;
  assert.equal(await chooser.element().getAttribute('accept'), '.json,application/json');
  await chooser.setFiles('/tmp/bill-file-impl/export.sharetally.json');
  await expect(bob.getByRole('heading', { name: 'Who’s sharing this bill?' })).toBeVisible();
  await expect(bob.getByLabel('Bill title', { exact: true })).toHaveValue('Weekly groceries');
  await expect(bob.getByLabel('Total paid (CAD)', { exact: true })).toHaveValue('32.00');
  await expect(bob.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(bob.getByText('You paid this bill · You’re the initiator', { exact: true })).toBeVisible();
  const today = await bob.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  await expect(bob.getByLabel('Purchase date', { exact: true })).toHaveValue(today);
  await expect.poll(async () => (await env.api(`/groups/${group.id}/receipt-drafts`, 'bob-token')).drafts.length).toBe(1);
  const [saved] = (await env.api(`/groups/${group.id}/receipt-drafts`, 'bob-token')).drafts;
  assert.deepEqual(saved.data.participantIds, []);
  assert.deepEqual(saved.data.items.map(item => item.finalCents), [1100, 2000]);
  assert.equal(saved.data.notes, 'Bring bags');
  await bob.screenshot({ path: '/tmp/bill-file-impl/step03-imported-1440.png', fullPage: true, animations: 'disabled' });
  await bob.reload();
  await expect(bob.getByLabel('Bill title', { exact: true })).toHaveValue('Weekly groceries');
  await expect(bob.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(bob.getByRole('radio', { name: 'By item', exact: true })).toBeChecked();
  await expect(bob.getByRole('button', { name: 'Share bill', exact: true })).toBeDisabled();
  await bob.getByRole('navigation', { name: 'New bill steps' }).getByRole('button', { name: /Items$/ }).click();
  await expect(bob.getByRole('button', { name: 'Edit Apples', exact: true })).toBeVisible();
  await bob.getByRole('button', { name: 'Continue to sharing', exact: true }).click();
  await bob.getByRole('button', { name: 'Everyone', exact: true }).click();
  await bob.getByRole('button', { name: 'Share bill', exact: true }).click();
  await expect(bob.getByRole('heading', { name: 'Weekly groceries', exact: true })).toBeVisible();
  const imported = (await env.api(`/bills/${bob.url().split('/').at(-1)}`, 'bob-token')).bill;
  assert.equal(imported.initiatorId, imported.participants.find(person => person.displayName === 'Bob').userId);
  assert.equal(imported.groupId, group.id);
}

async function replaceDraft(env) {
  const { alice, newBillRoute, titledDraft, stepButton } = await receiptGroup(env);
  await alice.setViewportSize({ width: 1440, height: 1000 });
  const id = await titledDraft('Draft to keep');
  await alice.goto(`${newBillRoute}/${id}`);
  await alice.getByLabel('Choose a receipt image').setInputFiles({
    name: 'old-receipt.png', mimeType: 'image/png', buffer: await receiptPhoto(300, 500),
  });
  await alice.getByRole('button', { name: 'Use this photo', exact: true }).click();
  await expect(alice.getByRole('heading', { name: 'Check your items' })).toBeVisible();
  await expect.poll(async () => (await env.api(`/receipt-drafts/${id}`)).draft.processingStatus).toBe('ready');
  await stepButton('Receipt').click();
  await expect(alice.getByRole('img', { name: 'Original cropped receipt' })).toBeVisible();
  await alice.getByRole('radio', { name: 'By amount', exact: true }).check();
  await alice.getByLabel('Total to split', { exact: true }).fill('55');
  const original = (await env.api(`/receipt-drafts/${id}`)).draft;
  assert.ok(original.photo);
  const file = { name: 'dinner.sharetally.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'sharetally.bill', version: 1, mode: 'items', title: 'Dinner', notes: 'Split dessert too', totalCents: 8765,
    receipt: { subtotalCents: 8765, taxCents: 0, discountCents: 0, extraCents: 0, pricesIncludeTax: false },
    items: [{ name: 'Dinner', quantity: '1', amountCents: 8765, discountCents: 0, taxable: false }],
  })) };
  const pick = () => alice.getByLabel('Import a bill file', { exact: true }).setInputFiles(file);
  await pick();
  const confirm = alice.getByRole('dialog', { name: "Replace what's in this draft with the imported bill?", exact: true });
  await expect(confirm).toBeVisible({ timeout: 3000 });
  await expect(confirm).toContainText('dinner.sharetally.json');
  await mkdir('/tmp/bill-file-impl', { recursive: true });
  await alice.screenshot({ path: '/tmp/bill-file-impl/step01-confirm-1440.png', fullPage: true, animations: 'disabled' });
  await confirm.getByRole('button', { name: 'Keep draft', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(alice.getByLabel('Total to split', { exact: true })).toHaveValue('55.00');
  assert.deepEqual((await env.api(`/receipt-drafts/${id}`)).draft, original);
  await alice.getByRole('button', { name: 'Continue to people', exact: true }).click();
  await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Draft to keep');
  await expect(alice.getByLabel('Purchase date', { exact: true })).toHaveValue('2026-09-24');
  await expect(alice.getByRole('checkbox', { name: 'You', exact: true })).toBeChecked();
  await stepButton('Receipt').click();
  await pick();
  await confirm.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(alice.getByRole('heading', { name: 'Who’s sharing this bill?' })).toBeVisible();
  await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Dinner');
  await expect(alice.getByLabel('Total paid (CAD)', { exact: true })).toHaveValue('87.65');
  await expect(alice.getByRole('radio', { name: 'By item', exact: true })).toBeChecked();
  await expect(alice.getByRole('checkbox', { checked: true })).toHaveCount(0);
  const saved = (await env.api(`/receipt-drafts/${id}`)).draft;
  assert.equal(saved.data.notes, 'Split dessert too');
  assert.deepEqual(saved.data.items.map(item => item.name), ['Dinner']);
  assert.deepEqual(saved.data.participantIds, []);
  assert.equal(saved.data.receipt.subtotalCents, 8765);
  assert.equal(saved.data.receipt.evidence, undefined);
  assert.ok(saved.data.items.every(item => item.evidence === undefined));
  assert.equal(saved.photo, null);
  // The current editor must drop the previous scan too, before any reload.
  await stepButton('Receipt').click();
  await alice.getByRole('radio', { name: 'By item', exact: true }).check();
  await expect(alice.getByRole('heading', { name: 'Scan a receipt' })).toBeVisible();
  await expect(alice.getByRole('img', { name: 'Original cropped receipt' })).toHaveCount(0);
  await stepButton('People').click();
  await alice.reload();
  await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Dinner');
  await expect(alice.getByRole('radio', { name: 'By item', exact: true })).toBeChecked();
  await alice.getByRole('button', { name: 'Everyone', exact: true }).click();
  await alice.getByRole('button', { name: 'Share bill', exact: true }).click();
  await expect(alice.getByRole('heading', { name: 'Dinner', exact: true })).toBeVisible();
  const billId = alice.url().split('/').at(-1);
  assert.equal((await env.api(`/bills/${billId}`, 'bob-token')).bill.photo, null);
  await expect(alice.getByRole('button', { name: 'View receipt', exact: true })).toHaveCount(0);
}

async function invalidBillFile(env) {
  const { alice, newBillRoute, group, stepButton } = await receiptGroup(env);
  await alice.setViewportSize({ width: 1440, height: 1000 });
  await alice.goto(newBillRoute);
  const input = alice.getByLabel('Import a bill file', { exact: true });
  await input.setInputFiles({ name: 'not-a-bill.json', mimeType: 'application/json', buffer: Buffer.from('{ broken') });
  await expect(alice.getByRole('alert')).toContainText("This file isn't a sharetally bill", { timeout: 3000 });
  await expect(alice.getByRole('alert')).toContainText('Nothing has been filled in.');
  await expect(stepButton('People')).toBeDisabled();
  assert.deepEqual((await env.api(`/groups/${group.id}/receipt-drafts`)).drafts, []);
  await mkdir('/tmp/bill-file-impl', { recursive: true });
  await alice.screenshot({ path: '/tmp/bill-file-impl/step01-error-1440.png', fullPage: true, animations: 'disabled' });
  await input.setInputFiles({ name: 'over-limit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'sharetally.bill', version: 1, mode: 'items', title: 'Equipment', totalCents: 1_000_000, notes: '',
    receipt: { subtotalCents: null, taxCents: 0, discountCents: 0, extraCents: 0, pricesIncludeTax: false },
    items: ['First', 'Second'].map(name => ({ name, quantity: '1', amountCents: 600_000, discountCents: 0, taxable: false })),
  })) });
  await expect(alice.getByRole('alert')).toContainText('This bill is over the $10,000 limit');
  await expect(alice.getByRole('alert')).toContainText('Nothing has been filled in.');
  await expect(stepButton('People')).toBeDisabled();
  assert.deepEqual((await env.api(`/groups/${group.id}/receipt-drafts`)).drafts, []);
  await alice.getByRole('radio', { name: 'By amount', exact: true }).check();
  await expect(alice.getByLabel('Total to split', { exact: true })).toHaveValue('');
  await input.setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    format: 'sharetally.bill', version: 1, mode: 'manual', title: 'Dinner', totalCents: 1234, notes: '',
  })) });
  await expect(alice.getByRole('heading', { name: 'Who’s sharing this bill?' })).toBeVisible();
  await expect(alice.getByRole('alert')).toHaveCount(0);
  await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Dinner');
}

async function largeBillFile(env) {
  const { alice, newBillRoute, group, stepButton } = await receiptGroup(env);
  await alice.goto(newBillRoute);
  // Valid bill data padded past the limit: it would otherwise import successfully.
  const contents = JSON.stringify({ format: 'sharetally.bill', version: 1, mode: 'manual', title: 'Too big', totalCents: 1234, notes: '' }) + ' '.repeat(1024 * 1024);
  await alice.getByLabel('Import a bill file', { exact: true }).setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
  await expect(alice.getByRole('alert')).toContainText('This file is too large (max 1 MB)', { timeout: 3000 });
  await expect(stepButton('People')).toBeDisabled();
  assert.deepEqual((await env.api(`/groups/${group.id}/receipt-drafts`)).drafts, []);
}

async function wrongBillFileType(env) {
  const { alice, group, stepButton } = await receiptGroup(env);
  await alice.getByRole('button', { name: 'New bill', exact: true }).click();
  const file = JSON.stringify({ format: 'sharetally.bill', version: 1, mode: 'manual', title: 'Dinner', totalCents: 1234, notes: '' });
  // A JSON MIME type cannot make a non-JSON filename eligible.
  await alice.getByLabel('Import a bill file', { exact: true }).setInputFiles({ name: 'bill.txt', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(alice.getByRole('alert')).toContainText("This file isn't a sharetally bill", { timeout: 3000 });
  await expect(stepButton('People')).toBeDisabled();
  assert.deepEqual((await env.api(`/groups/${group.id}/receipt-drafts`)).drafts, []);
  // Browsers may report valid JSON as plain text; content validation decides.
  await alice.getByLabel('Import a bill file', { exact: true }).setInputFiles({ name: 'bill.json', mimeType: 'text/plain', buffer: Buffer.from(file) });
  await expect(alice.getByRole('heading', { name: 'Who’s sharing this bill?' })).toBeVisible();
  await expect(alice.getByRole('alert')).toHaveCount(0);
  await expect(alice.getByLabel('Bill title', { exact: true })).toHaveValue('Dinner');
  const [saved] = (await env.api(`/groups/${group.id}/receipt-drafts`)).drafts;
  assert.equal(saved.data.title, 'Dinner');
}
