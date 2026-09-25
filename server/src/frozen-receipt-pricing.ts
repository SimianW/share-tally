import { BillError } from "./bill-error.js";
import type { ReceiptDraftData, receiptEvidenceFields } from "./receipt-input.js";
import type { z } from "zod";
import type { bills, billItems } from "./db/schema.js";

type Bill = typeof bills.$inferSelect;
type Item = typeof billItems.$inferSelect;

type Evidence = z.infer<typeof receiptEvidenceFields> | undefined;
type Ratio = { taxCents: number; taxableBaseCents: number };

// Number.toString() is the decimal Azure sent after JSON parsing. Turn its
// digits (and optional exponent) into integers; never multiply a float by 100.
function decimalRatio(value: number): Ratio | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value.toString());
  if (!match) return null;
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  // Avoid unbounded powers for corrupt or subnormal observations.
  if (Math.abs(exponent) > 20) return null;
  let numerator = BigInt(match[1]! + (match[2] ?? ""));
  let denominator = 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator = 10n ** BigInt(-exponent);
  const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  if (numerator > BigInt(Number.MAX_SAFE_INTEGER) || denominator > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { taxCents: Number(numerator), taxableBaseCents: Number(denominator) };
}

export function printedTax(evidence: Evidence): { rate: Ratio; label: string } | null {
  const details = evidence?.taxDetails ?? [];
  const rates = details.flatMap(detail => detail.rate === undefined ? [] : [decimalRatio(detail.rate)]);
  if (!rates.length || rates.some(rate => rate === null)) return null;
  const [rate] = rates as Ratio[];
  if (rates.some(other => other!.taxCents !== rate!.taxCents || other!.taxableBaseCents !== rate!.taxableBaseCents)) return null;
  const description = details.find(detail => detail.rate !== undefined && detail.description?.trim())?.description?.trim() || "Tax";
  // Print at most six decimal places; formatting never feeds the frozen ratio.
  const scaled = BigInt(rate!.taxCents) * 100_000_000n / BigInt(rate!.taxableBaseCents);
  const percent = `${scaled / 1_000_000n}${scaled % 1_000_000n ? `.${(scaled % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "")}` : ""}`;
  return { rate: rate!, label: `${description} (${percent}%)` };
}

// Older bills have no printed rate; preserve their tax / taxable-base rule.
export function selectFrozenTaxRate(receipt: NonNullable<Bill["receipt"]>, taxableBaseCents: number): Ratio | null {
  if (receipt.printedTaxRate) return receipt.printedTaxRate;
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
    if (!weight) return 0;
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
      ? part(rate?.taxCents ?? receipt.taxCents, net, rate?.taxableBaseCents ?? null, old.frozenTaxRoundingCents) : 0;
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
