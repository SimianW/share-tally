import { BillError } from "./bill-error.js";
import type { ReceiptDraftData } from "./receipt-input.js";
import type { bills, billItems } from "./db/schema.js";

type Bill = typeof bills.$inferSelect;
type Item = typeof billItems.$inferSelect;

// Exact rational rather than a rounded decimal. #53 can extend rate selection here.
export function selectFrozenTaxRate(receipt: NonNullable<Bill["receipt"]>, taxableBaseCents: number) {
  if (receipt.taxCents === 0)
    return { taxCents: 0, taxableBaseCents: taxableBaseCents || 1 };
  return taxableBaseCents > 0
    ? { taxCents: receipt.taxCents, taxableBaseCents }
    : null;
}

export function roundedRatio(numerator: number, weight: number, denominator: number) {
  if (!weight || !numerator) return 0;
  if (denominator <= 0) throw new BillError(400, "Receipt allocation is unavailable. Set the final cost manually.");
  const sign = numerator < 0 ? -1 : 1;
  return sign * Number((BigInt(Math.abs(numerator)) * BigInt(weight) * 2n + BigInt(denominator)) / (2n * BigInt(denominator)));
}

export function frozenBases(data: ReceiptDraftData) {
  const priced = data.items.map(item => item.amountCents === null ? null : item.amountCents - item.discountCents);
  const discountBase = priced.some(x => x === null || x < 0) ? null : priced.reduce<number>((s, x) => s + x!, 0);
  const net = priced.map((base, i) => base === null || data.items[i]!.allocatedDiscountCents == null ? null : base - data.items[i]!.allocatedDiscountCents!);
  return {
    discountBase,
    extraBase: net.some(x => x === null || x < 0) ? null : net.reduce<number>((s, x) => s + x!, 0),
    taxableBase: net.some((x, i) => (x === null || x < 0) && data.items[i]!.taxable !== false) ? null : net.reduce<number>((s, x, i) => s + (data.items[i]!.taxable === false ? 0 : x!), 0),
  };
}

export function roundingOffset(actual: number | null, numerator: number, weight: number | null, denominator: number | null) {
  return actual === null || weight === null || denominator === null || denominator === 0
    ? null : actual - roundedRatio(numerator, weight, denominator);
}

// One pure correction calculation; no other item is repriced. Each offset
// records largest-remainder's initial cent relative to independent half-up
// rounding, making an unchanged item's frozen-rate calculation exact.
export function correctedPrice(bill: Bill, old: Item, input: {
  amountCents: number; discountCents: number; taxable: boolean; manualFinal: boolean; finalCents?: number;
}) {
  const receipt = bill.receipt!;
  const base = input.amountCents - input.discountCents;
  if (base < 0) throw new BillError(400, "Discount cannot exceed the printed price.");
  function part(numerator: number, weight: number, denominator: number | null, offset: number | null) {
    if (!numerator || !weight) return 0;
    if (denominator === null || offset === null)
      throw new BillError(400, "Receipt allocation is unavailable. Set the final cost manually.");
    return roundedRatio(numerator, weight, denominator) + offset;
  }
  let discount: number | null = null;
  let tax: number | null = null;
  let extra: number | null = null;
  try {
    discount = part(receipt.discountCents, base, bill.frozenDiscountBaseCents, old.frozenDiscountRoundingCents);
    const net = base - discount;
    if (net < 0) throw new BillError(400, "Discount exceeds the corrected item price.");
    const rate = selectFrozenTaxRate(receipt, bill.frozenTaxBaseCents ?? 0);
    tax = input.taxable && !receipt.pricesIncludeTax
      ? part(receipt.taxCents, net, rate?.taxableBaseCents ?? null, old.frozenTaxRoundingCents) : 0;
    extra = part(receipt.extraCents, net, bill.frozenExtraBaseCents, old.frozenExtraRoundingCents);
  } catch (error) {
    if (!input.manualFinal) throw error;
  }
  const derived = discount === null || tax === null || extra === null ? null : base - discount + tax + extra;
  const finalCents = input.manualFinal ? input.finalCents : derived;
  if (finalCents == null || finalCents < 0 || finalCents > 1_000_000)
    throw new BillError(400, "Enter a usable final item cost or set it manually.");
  return { finalCents, taxCents: tax ?? old.taxCents, extraCents: extra ?? old.extraCents,
    allocatedDiscountCents: discount, taxable: input.taxable, manualFinal: input.manualFinal };
}
