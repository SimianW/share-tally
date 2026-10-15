import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocate, roundedCost, sumFractions } from '@share-tally/domain/fractions';
import { priceReceiptDraft } from '@share-tally/domain/draft-pricing';
import { priceFrozenItem } from '@share-tally/domain/frozen-pricing';

test('shared arithmetic keeps thirds exact and rounds the whole share once', () => {
  assert.deepEqual(sumFractions(Array.from({ length: 3 }, () => ({ numerator: 1, denominator: 3 }))), { n: 1n, d: 1n });
  assert.equal(roundedCost(Array.from({ length: 3 }, () => ({ numerator: 1, denominator: 3, finalCents: 1 }))), 1);
  assert.equal(roundedCost([{ numerator: 1, denominator: 2, finalCents: 1 }]), 1);
});

test('shared allocation keeps source-order remainder ties, including negative adjustments', () => {
  assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(allocate(-2, [1, 1, 1]), [-1, -1, -0]);
  assert.deepEqual(allocate(0, [0, 0]), [0, 0]);
  assert.throws(() => allocate(1, [0, 0]), /zero-cost items/);
});

test('draft pricing preserves unknown amounts without discarding independent exempt prices', () => {
  const result = priceReceiptDraft({
    receipt: { discountCents: 0, taxCents: 13, extraCents: 0, pricesIncludeTax: false },
    items: [
      { id: 'exempt', amountCents: 100, discountCents: 0, finalCents: null, taxable: false },
      { id: 'taxable', amountCents: null, discountCents: 0, finalCents: null, taxable: true },
    ],
  });
  assert.deepEqual(result.items.map(item => [item.id, item.finalCents]), [['exempt', 100], ['taxable', null]]);
  assert.ok(result.warnings.length);
});

test('frozen zero tax retains its original rounding residual only at the original weight', () => {
  const bill = { receipt: { discountCents: 0, taxCents: 0, extraCents: 0, pricesIncludeTax: false },
    frozenTaxRate: { taxCents: 0, taxableBaseCents: 100 } };
  const original = { frozenNetWeightCents: 100, frozenTaxRoundingCents: 1 };
  assert.equal(priceFrozenItem(bill, original, { amountCents: 100, discountCents: 0, taxable: true }).finalCents, 101);
  assert.equal(priceFrozenItem(bill, original, { amountCents: 200, discountCents: 0, taxable: true }).finalCents, 200);
  assert.equal(priceFrozenItem(bill, original, { amountCents: 100, discountCents: 0, taxable: false }).finalCents, 100);
});

const itemBill = {
  mode: 'items' as const, id: 'bill-id', groupId: 'group-id', initiatorId: 'alice',
  title: 'Weekly groceries', purchaseDate: '2026-09-01', notes: 'Bring bags', notePhotos: [{ id: 'photo', position: 0 }],
  totalCents: 3200, submittedCents: 0, differenceCents: 3200, confirmedCount: 0,
  adjustmentCents: null, completedAt: null, canceledAt: null, revision: 4,
  participants: [{ userId: 'alice', displayName: 'Alice', isCurrentUser: true, amountCents: null, confirmedAt: null }],
  photo: { draftId: 'draft-id', expiresAt: '2026-10-01' },
  receipt: { subtotalCents: 3000, taxCents: 100, discountCents: 0, extraCents: 0, pricesIncludeTax: false, totalCents: 3200 },
  items: [
    { id: 'apples', version: 4, name: 'Apples', originalText: 'APPLES', quantity: '2', amountCents: 1000, discountCents: 0, taxable: true, taxCents: 100, extraCents: 0, finalCents: 9999, claims: [{ itemId: 'apples', userId: 'alice', numerator: 1, denominator: 1, confirmedAt: null }] },
    { id: 'milk', version: 4, name: 'Milk', originalText: 'MILK', quantity: '1', amountCents: 2000, discountCents: 0, taxable: false, taxCents: 0, extraCents: 0, finalCents: 2000, claims: [] },
  ],
};

test('By item bill files round-trip purchase data and reprice costs, keeping the total paid', async () => {
  const { toBillFile, readBillFile } = await import('@share-tally/domain/bill-file');
  const result = readBillFile(JSON.stringify(toBillFile(itemBill)));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.mode, 'items');
  assert.equal(result.draft.title, 'Weekly groceries');
  assert.equal(result.draft.notes, 'Bring bags');
  assert.equal(result.draft.totalCents, 3200);
  assert.deepEqual(result.draft.receipt, { subtotalCents: 3000, taxCents: 100, discountCents: 0, extraCents: 0, pricesIncludeTax: false });
  assert.deepEqual(result.draft.items.map(item => [item.name, item.quantity, item.amountCents, item.taxable, item.finalCents]), [
    ['Apples', '2', 1000, true, 1100], ['Milk', '1', 2000, false, 2000],
  ]);
});

test('By amount bill files round-trip without receipt or items', async () => {
  const { toBillFile, readBillFile } = await import('@share-tally/domain/bill-file');
  const file = toBillFile({ ...itemBill, mode: 'manual' });
  assert.deepEqual(file, { format: 'sharetally.bill', version: 1, mode: 'manual', title: 'Weekly groceries', totalCents: 3200, notes: 'Bring bags' });
  assert.deepEqual(readBillFile(JSON.stringify(file)), { ok: true, draft: { mode: 'manual', title: 'Weekly groceries', totalCents: 3200, notes: 'Bring bags', items: [] } });
});

test('item exports allowlist purchase fields and exclude people, claims, photos, IDs, lifecycle and final costs', async () => {
  const { toBillFile } = await import('@share-tally/domain/bill-file');
  assert.deepEqual(toBillFile(itemBill), {
    format: 'sharetally.bill', version: 1, mode: 'items', title: 'Weekly groceries', totalCents: 3200, notes: 'Bring bags',
    receipt: { subtotalCents: 3000, taxCents: 100, discountCents: 0, extraCents: 0, pricesIncludeTax: false },
    items: [
      { name: 'Apples', quantity: '2', amountCents: 1000, discountCents: 0, taxable: true },
      { name: 'Milk', quantity: '1', amountCents: 2000, discountCents: 0, taxable: false },
    ],
  });
});

test('hand-edited final costs and identity fields are ignored on import', async () => {
  const { toBillFile, readBillFile } = await import('@share-tally/domain/bill-file');
  const file = toBillFile(itemBill);
  assert.equal(file.mode, 'items');
  if (file.mode !== 'items') return;
  const edited = { ...file, initiatorId: 'somebody', participantIds: ['somebody'], items: file.items.map(item => ({ ...item, id: 'old-id', finalCents: -20, claims: ['somebody'] })) };
  const result = readBillFile(JSON.stringify(edited));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.draft.items.map(item => item.finalCents), [1100, 2000]);
  assert.equal('participantIds' in result.draft, false);
  assert.equal('id' in result.draft.items[0]!, false);
});

test('manual final overrides survive export and import while ordinary finals are recalculated', async () => {
  const { toBillFile, readBillFile } = await import('@share-tally/domain/bill-file');
  const file = toBillFile({ ...itemBill, items: itemBill.items.map((item, index) => index === 1 ? { ...item, manualFinal: true, finalCents: 2200 } : item) });
  assert.equal(file.mode, 'items');
  if (file.mode !== 'items') return;
  assert.equal(file.items[1]!.manualFinalCents, 2200);
  assert.equal('finalCents' in file.items[1]!, false);
  const result = readBillFile(JSON.stringify(file));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.draft.items.map(item => [item.manualFinal, item.finalCents]), [[false, 1100], [true, 2200]]);
});

test('invalid JSON is rejected as a non-sharetally bill without throwing', async () => {
  const { readBillFile } = await import('@share-tally/domain/bill-file');
  assert.deepEqual(readBillFile('{ broken'), { ok: false, reason: 'invalid' });
});

test('manual final overrides do not hide invalid discount bases in bill files', async (t) => {
  const { readBillFile } = await import('@share-tally/domain/bill-file');
  const file = {
    format: 'sharetally.bill', version: 1, mode: 'items', title: 'Lunch', notes: '', totalCents: 100,
    receipt: { subtotalCents: 100, taxCents: 0, discountCents: 0, extraCents: 0, pricesIncludeTax: false },
    items: [{ name: 'Lunch', quantity: '1', amountCents: 100, discountCents: 0, taxable: false, manualFinalCents: 100 }],
  };
  await t.test('item discount cannot exceed the printed price, even without receipt adjustments', () => {
    const invalid = { ...file, items: [{ ...file.items[0], discountCents: 101 }] };
    assert.deepEqual(readBillFile(JSON.stringify(invalid)), { ok: false, reason: 'numbers' });
  });
  await t.test('receipt discount cannot exceed the basis left after item discounts', () => {
    const invalid = { ...file, receipt: { ...file.receipt, discountCents: 91 }, items: [{ ...file.items[0], discountCents: 10 }] };
    assert.deepEqual(readBillFile(JSON.stringify(invalid)), { ok: false, reason: 'numbers' });
  });
  await t.test('valid item and receipt discounts still preserve a manual final', () => {
    const valid = { ...file, receipt: { ...file.receipt, discountCents: 90 }, items: [{ ...file.items[0], discountCents: 10 }] };
    const result = readBillFile(JSON.stringify(valid));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.draft.items.map(item => [item.manualFinal, item.finalCents]), [[true, 100]]);
  });
});

test('wrong or missing format markers and non-object JSON are rejected', async () => {
  const { toBillFile, readBillFile } = await import('@share-tally/domain/bill-file');
  for (const value of [null, [], 42, { ...toBillFile(itemBill), format: 'other.bill' }, { ...toBillFile(itemBill), format: undefined }]) {
    assert.deepEqual(readBillFile(JSON.stringify(value)), { ok: false, reason: 'invalid' });
  }
});

test('newer versions are distinguished from missing, malformed or unsupported version numbers', async () => {
  const { toBillFile, readBillFile } = await import('@share-tally/domain/bill-file');
  assert.deepEqual(readBillFile(JSON.stringify({ ...toBillFile(itemBill), version: 2 })), { ok: false, reason: 'newer-version' });
  for (const version of [undefined, null, '1', 0, -1, 1.5]) {
    assert.deepEqual(readBillFile(JSON.stringify({ ...toBillFile(itemBill), version })), { ok: false, reason: 'invalid' });
  }
});

test('missing or malformed purchase fields are rejected before pricing', async () => {
  const { toBillFile, readBillFile } = await import('@share-tally/domain/bill-file');
  const file = toBillFile(itemBill);
  assert.equal(file.mode, 'items');
  if (file.mode !== 'items') return;
  const cases = [
    { mode: undefined }, { mode: 'cash' }, { title: undefined }, { title: 1 }, { title: 'x'.repeat(121) },
    { notes: null }, { notes: 'x'.repeat(2001) }, { totalCents: '3200' }, { totalCents: 1.5 }, { totalCents: 1_000_001 },
    { receipt: undefined }, { receipt: null }, { receipt: {} }, { receipt: { ...file.receipt, pricesIncludeTax: 'false' } },
    { receipt: { ...file.receipt, taxCents: -1 } }, { receipt: { ...file.receipt, extraCents: -1_000_001 } },
    { receipt: { ...file.receipt, subtotalCents: '3000' } }, { items: undefined }, { items: {} },
    ...[
      null, {}, { ...file.items[0], name: 1 }, { ...file.items[0], name: 'x'.repeat(161) },
      { ...file.items[0], quantity: 1 }, { ...file.items[0], quantity: 'x'.repeat(41) },
      { ...file.items[0], amountCents: null }, { ...file.items[0], amountCents: -1 },
      { ...file.items[0], discountCents: '0' }, { ...file.items[0], taxable: 'yes' },
      { ...file.items[0], manualFinalCents: null }, { ...file.items[0], manualFinalCents: -1 },
    ].map(item => ({ items: [item] })),
  ];
  for (const patch of cases) {
    assert.deepEqual(readBillFile(JSON.stringify({ ...file, ...patch })), { ok: false, reason: 'invalid' }, JSON.stringify(patch));
  }
});

test('bill files with over 200 items are rejected, while 200 items are accepted', async () => {
  const { toBillFile, readBillFile } = await import('@share-tally/domain/bill-file');
  const file = toBillFile(itemBill);
  if (file.mode !== 'items') throw new Error('Expected item file');
  assert.deepEqual(readBillFile(JSON.stringify({ ...file, items: Array(201).fill(file.items[0]) })), { ok: false, reason: 'too-many-items' });
  assert.equal(readBillFile(JSON.stringify({ ...file, items: Array(200).fill(file.items[0]) })).ok, true);
});

test('inconsistent pricing and failed People prerequisites reject the whole bill', async () => {
  const { toBillFile, readBillFile } = await import('@share-tally/domain/bill-file');
  const file = toBillFile(itemBill);
  if (file.mode !== 'items') throw new Error('Expected item file');
  const cases = [
    { title: '   ' }, { totalCents: 0 }, { items: [] },
    { items: [{ ...file.items[0], name: '  ' }] },
    { items: [{ ...file.items[0], discountCents: 1001 }] },
    { receipt: { ...file.receipt, discountCents: 3001 } },
    { receipt: { ...file.receipt, extraCents: -5000 } },
    { items: file.items.map(item => ({ ...item, taxable: false })) },
    // Manual finals cannot hide an impossible receipt allocation.
    { receipt: { ...file.receipt, discountCents: 9999 }, items: file.items.map(item => ({ ...item, manualFinalCents: 100 })) },
    { items: [{ ...file.items[0], amountCents: 1_000_000 }] },
  ];
  for (const patch of cases) assert.deepEqual(readBillFile(JSON.stringify({ ...file, ...patch })), { ok: false, reason: 'numbers' }, JSON.stringify(patch));
  assert.deepEqual(readBillFile(JSON.stringify({ ...toBillFile({ ...itemBill, mode: 'manual' }), totalCents: 0 })), { ok: false, reason: 'numbers' });
});

test('version 1 purchase fields pass through the current empty upgrade chain unchanged', async () => {
  const { readBillFile } = await import('@share-tally/domain/bill-file');
  const file = {
    format: 'sharetally.bill', version: 1, mode: 'items', title: 'Tax included', notes: '', totalCents: 999,
    receipt: { subtotalCents: null, discountCents: 10, taxCents: 30, extraCents: -5, pricesIncludeTax: true },
    items: [{ name: 'Lunch', quantity: '1/2', amountCents: 1000, discountCents: 100, taxable: null }],
  };
  const result = readBillFile(JSON.stringify(file));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.draft.title, 'Tax included');
  assert.equal(result.draft.totalCents, 999);
  assert.deepEqual(result.draft.receipt, file.receipt);
  assert.deepEqual(result.draft.items.map(item => [item.name, item.quantity, item.amountCents, item.discountCents, item.taxable, item.finalCents]), [['Lunch', '1/2', 1000, 100, null, 885]]);
});
