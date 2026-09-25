import type { Bill } from "./bill-api";
import type { BillItem, ReceiptDraftItem } from "./receipt-api";

// The frozen denominators and per-item rounding offsets reproduce the original
// largest-remainder allocations. Corrections never redistribute other items.
function allocation(amount: number, weight: number, denominator: number | null | undefined, offset: number | null | undefined): number | null {
  if (!weight) return 0;
  if (!denominator || denominator < 0 || offset == null) return null;
  const magnitude = BigInt(Math.abs(amount)) * BigInt(weight);
  const rounded = (magnitude * 2n + BigInt(denominator)) / (2n * BigInt(denominator));
  return (amount < 0 ? -Number(rounded) : Number(rounded)) + offset;
}

export function previewCorrection(bill: Bill, original: BillItem, item: ReceiptDraftItem): ReceiptDraftItem {
  if (!bill.receipt) return item;
  const base = item.amountCents === null || item.discountCents > item.amountCents
    ? null : item.amountCents - item.discountCents;
  const discount = base === null ? null : allocation(bill.receipt.discountCents, base, bill.frozenDiscountBaseCents, original.frozenDiscountRoundingCents);
  const net = base === null || discount === null || discount > base ? null : base - discount;
  const tax = net === null ? null : item.taxable === false || bill.receipt.pricesIncludeTax ? 0
    : allocation(bill.frozenTaxRate?.taxCents ?? bill.receipt.taxCents, net, bill.frozenTaxRate?.taxableBaseCents, original.frozenTaxRoundingCents);
  const extra = net === null ? null : allocation(bill.receipt.extraCents, net, bill.frozenExtraBaseCents, original.frozenExtraRoundingCents);
  const calculated = net === null || tax === null || extra === null ? null : net + tax + extra;
  return {
    ...item,
    allocatedDiscountCents: discount,
    allocatedTaxCents: tax,
    allocatedExtraCents: extra,
    finalCents: item.manualFinal ? item.finalCents : calculated === null || calculated < 0 || calculated > 1_000_000 ? null : calculated,
  };
}
