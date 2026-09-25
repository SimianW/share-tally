import type { ReceiptData, ReceiptDraftItem } from "./receipt-api";
import { money } from "./bill-api";

// Live preview only. The server re-derives every amount when saving. Keep these
// largest-remainder rules aligned with server/src/receipt-pricing.ts.
function spread(amount: number, weights: (number | null)[]): (number | null)[] {
  if (!amount) return weights.map(() => 0);
  if (weights.some((weight) => weight === null))
    return weights.map((weight) => (weight === 0 ? 0 : null));
  const total = weights.reduce<bigint>((sum, weight) => sum + BigInt(weight!), 0n);
  if (!total) return weights.map(() => null);
  const magnitude = BigInt(Math.abs(amount));
  const rows = weights.map((weight, index) => ({
    index,
    cents: Number((magnitude * BigInt(weight!)) / total),
    remainder: (magnitude * BigInt(weight!)) % total,
  }));
  let remaining = Math.abs(amount) - rows.reduce((sum, row) => sum + row.cents, 0);
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (remaining-- > 0) row.cents++;
  }
  return rows.map((row) => (amount < 0 ? -row.cents : row.cents));
}

export function deriveReceiptItems(data: ReceiptData): ReceiptDraftItem[] {
  const { items, receipt } = data;
  const base = items.map((item) => item.amountCents === null || item.discountCents > item.amountCents
    ? null : item.amountCents - item.discountCents);
  const discounts = spread(receipt?.discountCents ?? 0, base);
  const net = base.map((amount, index) => amount === null || discounts[index] === null || discounts[index]! > amount
    ? null : amount - discounts[index]!);
  const taxes = spread(receipt?.pricesIncludeTax ? 0 : receipt?.taxCents ?? 0,
    net.map((amount, index) => items[index].taxable === false ? 0 : amount));
  const extras = spread(receipt?.extraCents ?? 0, net);
  return items.map((item, index) => {
    const tax = item.taxable === false ? 0 : taxes[index];
    const amount = net[index];
    const extra = extras[index];
    const final = amount === null || tax === null || extra === null ? null : amount + tax + extra;
    return {
      ...item,
      allocatedDiscountCents: discounts[index],
      allocatedTaxCents: tax,
      allocatedExtraCents: extra,
      finalCents: item.manualFinal ? item.finalCents : final === null || final < 0 || final > 1_000_000 ? null : final,
    };
  });
}

// Mirror the initiation-only server guard. Use freshly derived discount shares,
// not response metadata that may be stale after local edits.
export function unassignedReceiptTaxMessage(data: ReceiptData): string | null {
  const receipt = data.receipt;
  if (data.mode !== "items" || !receipt || receipt.taxCents <= 0 || receipt.pricesIncludeTax)
    return null;
  const derived = deriveReceiptItems(data).filter((item) => item.manualFinal !== true);
  if (!derived.length || derived.some((item) => item.taxable !== false &&
    item.amountCents !== null && item.allocatedDiscountCents !== null &&
    item.allocatedDiscountCents !== undefined &&
    item.amountCents - item.discountCents - item.allocatedDiscountCents > 0)) return null;
  return `Receipt tax ${money(receipt.taxCents)} isn't assigned to any item. Mark the taxable items or set final costs manually.`;
}

// Unsaved session recovery can predate the server migration. Match its rule:
// An entered tax differing from its allocation in either direction, or a nonzero
// item adjustment, makes the whole draft manual. Missing tax is not an edit;
// a missing allocation means zero. Preserve every reviewed final, including siblings.
export function recoverReceiptData(data: ReceiptData): ReceiptData {
  const legacy = data.items as (ReceiptDraftItem & { taxCents?: number; extraCents?: number })[];
  const preserve = legacy.some((item) => (item.taxCents != null && item.taxCents !== (item.allocatedTaxCents ?? 0)) || !!item.extraCents);
  return {
    ...data,
    items: legacy.map((item) => {
      const clean = { ...item };
      delete clean.taxCents;
      delete clean.extraCents;
      return preserve ? { ...clean, manualFinal: true } : clean;
    }),
  };
}
