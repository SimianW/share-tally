import type { Bill } from "./bill-api";
import type { BillItem, ReceiptDraftItem } from "./receipt-api";

// The frozen denominators and per-item rounding offsets reproduce the original
// largest-remainder allocations only at the original weights. Changed weights
// use the uncapped frozen rate; corrections never redistribute other items.
function allocation(amount: number, weight: number | null, denominator: number | null | undefined, offset: number | null | undefined, frozenWeight: number | null | undefined): number | null {
  if (!amount || weight === 0) return 0;
  if (weight === null || !denominator || denominator < 0 || (weight === frozenWeight && offset == null)) return null;
  const magnitude = BigInt(Math.abs(amount)) * BigInt(weight);
  const rounded = (magnitude * 2n + BigInt(denominator)) / (2n * BigInt(denominator));
  return (amount < 0 ? -Number(rounded) : Number(rounded)) + (weight === frozenWeight ? offset! : 0);
}

export function previewCorrection(bill: Bill, original: BillItem & { frozenDiscountWeightCents?: number | null; frozenNetWeightCents?: number | null }, item: ReceiptDraftItem): ReceiptDraftItem {
  if (!bill.receipt) return item;
  const base = item.amountCents === null || item.discountCents > item.amountCents
    ? null : item.amountCents - item.discountCents;
  const discount = allocation(bill.receipt.discountCents, base, bill.frozenDiscountBaseCents, original.frozenDiscountRoundingCents, original.frozenDiscountWeightCents);
  const net = base === null || discount === null || discount > base ? null : base - discount;
  const tax = item.taxable === false || bill.receipt.pricesIncludeTax ? 0
    : allocation(bill.receipt.taxCents, net, bill.frozenTaxRate?.taxableBaseCents, original.frozenTaxRoundingCents, original.frozenNetWeightCents);
  const extra = allocation(bill.receipt.extraCents, net, bill.frozenExtraBaseCents, original.frozenExtraRoundingCents, original.frozenNetWeightCents);
  const calculated = net === null || tax === null || extra === null ? null : net + tax + extra;
  return {
    ...item,
    allocatedDiscountCents: discount,
    allocatedTaxCents: tax,
    allocatedExtraCents: extra,
    finalCents: item.manualFinal ? item.finalCents : calculated === null || calculated < 0 || calculated > 1_000_000 ? null : calculated,
  };
}
