import { allocate } from "./fractions.js";
import { draftInput, checked, type ReceiptDraftData } from "./receipt-input.js";

// Stored item breakdowns remain the entered values. Recalculation changes only
// final costs, so applying receipt-wide adjustments twice never compounds them.
export function priceDraft(input: ReceiptDraftData) {
  const data = checked(draftInput, input);
  const receipt = data.receipt;
  const warnings: string[] = [];
  let invalid = data.items.some((i) => i.amountCents === null);
  const spread = (amount: number, weights: number[]) => {
    try {
      return allocate(amount, weights);
    } catch (error) {
      invalid = true;
      warnings.push(
        error instanceof Error ? error.message : "Enter final costs manually.",
      );
      return weights.map(() => 0);
    }
  };
  const base = data.items.map((i) => (i.amountCents ?? 0) - i.discountCents);
  if (base.some((n) => n < 0)) invalid = true;
  const discounts = spread(
    receipt?.discountCents ?? 0,
    base.map((n) => Math.max(0, n)),
  );
  const net = base.map((n, index) => Math.max(0, n - discounts[index]!));
  const tax = spread(
    receipt?.pricesIncludeTax ? 0 : (receipt?.taxCents ?? 0),
    net.map((n, index) => (data.items[index]!.taxable === false ? 0 : n)),
  );
  const extra = spread(receipt?.extraCents ?? 0, net);
  const items = data.items.map((item, index) => {
    const final =
      base[index]! -
      discounts[index]! +
      tax[index]! +
      extra[index]! +
      item.extraCents +
      (receipt?.pricesIncludeTax ? 0 : item.taxCents);
    return {
      ...item,
      finalCents: item.manualFinal
        ? item.finalCents
        : invalid || final < 0 || final > 1_000_000
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
