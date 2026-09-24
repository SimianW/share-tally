// Frozen benchmark baseline from commit 16509935cb34d505ee8d48c5616c2a22ff908e2f (#48).
// Intentional snapshot: do not update when production behavior changes. No secrets or recordings.
import { allocate } from "./fractions.js";
import { draftInput, checked, type ReceiptDraftData } from "./receipt-input.js";

// Track the receipt-wide part of each displayed item tax separately. This lets
// recalculation replace the old allocation instead of compounding it.
export function priceDraft(input: ReceiptDraftData) {
  const data = checked(draftInput, input);
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
    const allocatedTax = item.taxable === false ? 0 : tax[index];
    const allocatedTaxCents = allocatedTax ?? 0;
    const itemTaxCents =
      Math.max(0, item.taxCents - (item.allocatedTaxCents ?? 0)) +
      allocatedTaxCents;
    const amount = net[index];
    const adjustment = extra[index];
    const final =
      amount == null || allocatedTax == null || adjustment == null
        ? null
        : amount +
          adjustment +
          item.extraCents +
          (receipt?.pricesIncludeTax ? 0 : itemTaxCents);
    return {
      ...item,
      allocatedTaxCents,
      taxCents: itemTaxCents,
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
