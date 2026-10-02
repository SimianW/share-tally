import { allocate } from './fractions.js';

export type PricingItem = {
  amountCents: number | null; discountCents: number; finalCents: number | null;
  taxable?: boolean | null; manualFinal?: boolean | null;
};
export type DraftPricing<T extends PricingItem> = {
  items: T[]; receipt?: { discountCents: number; taxCents: number; extraCents: number; pricesIncludeTax: boolean };
};

// Printed price less its own discount is the allocation basis. Receipt discounts
// reduce that basis before tax (taxable items only) and adjustments (all items).
// Allocations are response-only metadata: always replace client-supplied values.
export function priceReceiptDraft<T extends PricingItem>(data: DraftPricing<T>) {
  const receipt = data.receipt;
  const warnings: string[] = [];
  // A missing price invalidates only calculations that depend on it.
  // Never allocate shared money using a missing price as a zero weight.
  const spread = (amount: number, weights: (number | null)[]) => {
    if (!amount) return weights.map(() => 0);
    if (weights.some((weight) => weight === null)) {
      warnings.push(
        "Some receipt adjustments need missing item prices. Enter the printed amounts to calculate those costs.",
      );
      return weights.map((weight) => (weight === 0 ? 0 : null));
    }
    try {
      return allocate(
        amount,
        weights.map((weight) => weight!),
      );
    } catch (error) {
      warnings.push(
        error instanceof Error ? error.message : "Enter final costs manually.",
      );
      return weights.map(() => null);
    }
  };
  const base = data.items.map((item) => {
    if (item.amountCents === null) return null;
    const net = item.amountCents - item.discountCents;
    return net < 0 ? null : net;
  });
  const discounts = spread(receipt?.discountCents ?? 0, base);
  const net = base.map((amount, index) => {
    const discount = discounts[index];
    return amount === null || discount == null || discount > amount
      ? null
      : amount - discount;
  });
  const tax = spread(
    receipt?.pricesIncludeTax ? 0 : (receipt?.taxCents ?? 0),
    net.map((amount, index) =>
      data.items[index]!.taxable === false ? 0 : amount,
    ),
  );
  const extra = spread(receipt?.extraCents ?? 0, net);
  const items = data.items.map((item, index) => {
    const allocatedTaxCents = item.taxable === false ? 0 : (tax[index] ?? null);
    const amount = net[index];
    const allocatedExtraCents = extra[index] ?? null;
    const final =
      amount == null || allocatedTaxCents === null || allocatedExtraCents === null
        ? null
        : amount + allocatedExtraCents + allocatedTaxCents;
    return {
      ...item,
      allocatedTaxCents,
      allocatedDiscountCents: discounts[index] ?? null,
      allocatedExtraCents,
      finalCents: item.manualFinal
        ? item.finalCents
        : final === null || final < 0 || final > 1_000_000
          ? null
          : final,
    };
  });
  if (items.some((i) => i.finalCents === null))
    warnings.push(
      "Some costs could not be calculated. Enter usable final costs before initiating.",
    );
  return { items, warnings };
}

export function hasUnassignedReceiptTax<T extends PricingItem>(data: DraftPricing<T> & { mode: 'manual' | 'items' }): boolean {
  const receipt = data.receipt;
  if (data.mode !== 'items' || !receipt || receipt.taxCents <= 0 || receipt.pricesIncludeTax) return false;
  const items = priceReceiptDraft(data).items.filter(item => !item.manualFinal);
  return items.length > 0 && !items.some(item => item.taxable !== false &&
    item.amountCents !== null && item.allocatedDiscountCents !== null &&
    item.amountCents - item.discountCents - item.allocatedDiscountCents > 0);
}
