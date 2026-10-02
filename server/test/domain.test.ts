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
