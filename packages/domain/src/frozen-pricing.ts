export type FrozenItem = {
  frozenDiscountWeightCents?: number | null; frozenNetWeightCents?: number | null;
  frozenDiscountRoundingCents?: number | null; frozenTaxRoundingCents?: number | null; frozenExtraRoundingCents?: number | null;
};
export type FrozenPricing = {
  receipt: { discountCents: number; taxCents: number; extraCents: number; pricesIncludeTax: boolean };
  frozenTaxRate?: { taxCents: number; taxableBaseCents: number } | null;
  frozenDiscountBaseCents?: number | null; frozenExtraBaseCents?: number | null;
};

export function roundRatio(numerator: number, weight: number, denominator: number): number {
  if (!weight || !numerator) return 0;
  const magnitude = BigInt(Math.abs(numerator)) * BigInt(weight);
  const rounded = Number((magnitude * 2n + BigInt(denominator)) / (2n * BigInt(denominator)));
  return numerator < 0 ? -rounded : rounded;
}

function allocation(amount: number, weight: number | null, denominator: number | null | undefined, offset: number | null | undefined, frozenWeight: number | null | undefined): number | null {
  if (weight === 0) return 0;
  // A printed zero rate can retain an original residual, only at its original weight.
  if (!amount) return weight !== null && weight === frozenWeight ? offset ?? 0 : 0;
  if (weight === null || !denominator || denominator < 0 || (weight === frozenWeight && offset == null)) return null;
  return roundRatio(amount, weight, denominator) + (weight === frozenWeight ? offset! : 0);
}

export function priceFrozenItem(bill: FrozenPricing, original: FrozenItem, input: {
  amountCents: number | null; discountCents: number; taxable?: boolean | null; manualFinal?: boolean | null; finalCents?: number | null;
}) {
  const base = input.amountCents === null || input.discountCents > input.amountCents ? null : input.amountCents - input.discountCents;
  const discount = allocation(bill.receipt.discountCents, base, bill.frozenDiscountBaseCents, original.frozenDiscountRoundingCents, original.frozenDiscountWeightCents);
  const net = base === null || discount === null || discount > base ? null : base - discount;
  const tax = input.taxable === false || bill.receipt.pricesIncludeTax ? 0
    : allocation(bill.frozenTaxRate?.taxCents ?? bill.receipt.taxCents, net, bill.frozenTaxRate?.taxableBaseCents, original.frozenTaxRoundingCents, original.frozenNetWeightCents);
  const extra = allocation(bill.receipt.extraCents, net, bill.frozenExtraBaseCents, original.frozenExtraRoundingCents, original.frozenNetWeightCents);
  const derived = net === null || tax === null || extra === null ? null : net + tax + extra;
  return { allocatedDiscountCents: discount, allocatedTaxCents: tax, allocatedExtraCents: extra, finalCents: input.manualFinal ? input.finalCents : derived };
}
