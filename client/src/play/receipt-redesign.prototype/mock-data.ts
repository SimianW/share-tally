// Throwaway receipt-redesign prototype data and cent-exact cost allocation.
export type Item = {
  id: string;
  originalText: string;
  name: string;
  quantity: number;
  printedCents: number | null;
  discountCents: number;
  taxable: boolean;
  confidence: { name: number; price: number };
  lineIndex: number;
  manualFinalCents?: number | null;
  confirmed?: boolean;
};

export type ReceiptSummary = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  otherCents: number;
  totalCents: number;
  pricesIncludeTax: boolean;
};

export type DerivedItem = Item & {
  finalCents: number;
  taxShareCents: number;
  otherShareCents: number;
  receiptDiscountShareCents: number;
};

export const participants = [
  { id: "alice", name: "Alice", color: "#c65d3a" },
  { id: "bob", name: "Bob", color: "#108f78"},
  { id: "carol", name: "Carol", color: "#6b62a8" },
  { id: "dan", name: "Dan", color: "#bd8b25" },
];

// The absent, non-taxable line is $64.99; entering it closes the exact gap.
export const expectedMissingCents = 6499;

export const initialItems: Item[] = [
  { id: "i01", originalText: "001 KIRKLAND OLIVE OIL 2L $22.99", name: "Kirkland olive oil", quantity: 1, printedCents: 2299, discountCents: 0, taxable: false, confidence: { name: 0.99, price: 0.99 }, lineIndex: 0 },
  { id: "i02", originalText: "002 KS ORGANIC MAPLE SYRUP $18.99", name: "Organic maple syrup", quantity: 1, printedCents: 1899, discountCents: 0, taxable: false, confidence: { name: 0.98, price: 0.99 }, lineIndex: 1 },
  { id: "i03", originalText: "003 ROTISSERIE CHICKEN 2 @ $9.99 $19.98", name: "Rotisserie chicken", quantity: 2, printedCents: 1998, discountCents: 0, taxable: false, confidence: { name: 0.99, price: 0.97 }, lineIndex: 2 },
  { id: "i04", originalText: "004 KS PAPER TOWEL 12RL $26.99 | INSTANT SAVINGS -$5.00", name: "Kirkland paper towels", quantity: 1, printedCents: 2699, discountCents: 500, taxable: true, confidence: { name: 0.98, price: 0.96 }, lineIndex: 3 },
  { id: "i05", originalText: "005 BANANAS 2.14KG @ $1.79/KG $3.83", name: "Bananas", quantity: 1, printedCents: 383, discountCents: 0, taxable: false, confidence: { name: 0.98, price: 0.99 }, lineIndex: 4 },
  { id: "i06", originalText: "006 STRAWBERRY 2LB $8.99", name: "Strawberries", quantity: 1, printedCents: 899, discountCents: 0, taxable: false, confidence: { name: 0.85, price: 0.99 }, lineIndex: 5 },
  { id: "i07", originalText: "007 KS GREEK YOGURT $7.99", name: "Greek yogurt", quantity: 1, printedCents: 799, discountCents: 0, taxable: false, confidence: { name: 0.98, price: 0.99 }, lineIndex: 6 },
  { id: "i08", originalText: "008 AGED CHEDDAR 2YR $14.99", name: "Aged cheddar", quantity: 1, printedCents: 1499, discountCents: 0, taxable: false, confidence: { name: 0.95, price: 0.98 }, lineIndex: 7 },
  { id: "i09", originalText: "009 KS ALMOND MILK 6PK $11.99", name: "Almond milk", quantity: 1, printedCents: 1199, discountCents: 0, taxable: false, confidence: { name: 0.98, price: 0.97 }, lineIndex: 8 },
  { id: "i10", originalText: "010 ORGANIC EGGS 24CT $9.49", name: "Organic eggs", quantity: 1, printedCents: 949, discountCents: 0, taxable: false, confidence: { name: 0.99, price: 0.99 }, lineIndex: 9 },
  { id: "i11", originalText: "011 AVOCADO 6CT $8.99", name: "Avocados", quantity: 1, printedCents: 899, discountCents: 0, taxable: false, confidence: { name: 0.98, price: 0.99 }, lineIndex: 10 },
  { id: "i12", originalText: "012 KS GRANOLA 1.4KG $10.99", name: "Kirkland granola", quantity: 1, printedCents: 1099, discountCents: 0, taxable: false, confidence: { name: 0.71, price: 0.74 }, lineIndex: 11 },
  { id: "i13", originalText: "013 CHICKEN BREAST 2.1KG $27.99", name: "Chicken breast", quantity: 1, printedCents: 2799, discountCents: 0, taxable: false, confidence: { name: 0.98, price: 0.98 }, lineIndex: 12 },
  { id: "i14", originalText: "014 SALMON FILLET 1.2KG $31.99", name: "Salmon fillet", quantity: 1, printedCents: 3199, discountCents: 0, taxable: false, confidence: { name: 0.76, price: 0.75 }, lineIndex: 13 },
  { id: "i15", originalText: "015 KS BOTTLED WATER 40PK $4.99", name: "Bottled water", quantity: 1, printedCents: 499, discountCents: 0, taxable: false, confidence: { name: 0.99, price: 0.99 }, lineIndex: 14 },
  { id: "i16", originalText: "016 DISH SOAP 2X1.27L $12.99 | INSTANT SAVINGS -$3.00", name: "Dish soap", quantity: 1, printedCents: 1299, discountCents: 300, taxable: true, confidence: { name: 0.94, price: 0.95 }, lineIndex: 15 },
  { id: "i17", originalText: "017 KS FREE & CLEAR LAUNDRY $17.99", name: "Laundry detergent", quantity: 1, printedCents: 1799, discountCents: 0, taxable: true, confidence: { name: 0.96, price: 0.97 }, lineIndex: 16 },
  { id: "i18", originalText: "018 PAPER PLATES 300CT $11.99", name: "Paper plates", quantity: 1, printedCents: 1199, discountCents: 0, taxable: true, confidence: { name: 0.96, price: 0.98 }, lineIndex: 17 },
  { id: "i19", originalText: "019 KS AA BATTERIES 48PK $15.99", name: "AA batteries", quantity: 1, printedCents: 1599, discountCents: 0, taxable: true, confidence: { name: 0.97, price: 0.97 }, lineIndex: 18 },
  { id: "i20", originalText: "020 VITAMIN D3 2X360 $17.99", name: "Vitamin D3", quantity: 1, printedCents: 1799, discountCents: 0, taxable: false, confidence: { name: 0.98, price: 0.96 }, lineIndex: 19 },
  { id: "i21", originalText: "021 KS TRAIL MIX 1.13KG $13.99", name: "Trail mix", quantity: 1, printedCents: 1399, discountCents: 0, taxable: false, confidence: { name: 0.97, price: 0.98 }, lineIndex: 20 },
  { id: "i22", originalText: "022 COFFEE BEANS 907G $16.99", name: "Coffee beans", quantity: 1, printedCents: 1699, discountCents: 0, taxable: false, confidence: { name: 0.96, price: 0.97 }, lineIndex: 21 },
  { id: "i23", originalText: "023 KS PARCHMENT PAPER $8.99", name: "Parchment paper", quantity: 1, printedCents: 899, discountCents: 0, taxable: true, confidence: { name: 0.73, price: 0.72 }, lineIndex: 22 },
  { id: "i24", originalText: "024 DARK CHOCOLATE ALMONDS $12.99", name: "Chocolate almonds", quantity: 1, printedCents: 1299, discountCents: 0, taxable: true, confidence: { name: 0.95, price: 0.96 }, lineIndex: 23 },
  { id: "i25", originalText: "025 COSTCO ITEM $?.??", name: "Costco item — verify printed price", quantity: 1, printedCents: null, discountCents: 0, taxable: true, confidence: { name: 0.58, price: 0.22 }, lineIndex: 24 },
];

const hstBaseCents = initialItems.reduce(
  (sum, item) => sum + (item.taxable ? (item.printedCents ?? 0) - item.discountCents : 0),
  expectedMissingCents,
);
const hstCents = Math.round(hstBaseCents * 0.13);
const grossSubtotalCents = initialItems.reduce((sum, item) => sum + (item.printedCents ?? 0), 0) + expectedMissingCents;
const lineDiscountCents = initialItems.reduce((sum, item) => sum + item.discountCents, 0);
const subtotalCents = grossSubtotalCents - lineDiscountCents;
const otherCents = 50;

export const receiptInitial: ReceiptSummary = {
  subtotalCents,
  discountCents: 0,
  taxCents: hstCents,
  otherCents,
  totalCents: subtotalCents + hstCents + otherCents,
  pricesIncludeTax: false,
};

export function money(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

function allocateLargestRemainder(amount: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (amount === 0 || totalWeight <= 0) return weights.map(() => 0);
  const sign = Math.sign(amount);
  const absolute = Math.abs(amount);
  const exact = weights.map((weight) => (absolute * weight) / totalWeight);
  const shares = exact.map(Math.floor);
  const leftover = absolute - shares.reduce((sum, share) => sum + share, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - shares[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < leftover; i += 1) shares[order[i].index] += 1;
  return shares.map((share) => share * sign);
}

export function deriveCosts(items: Item[], summary: ReceiptSummary): DerivedItem[] {
  const manual = items.map((item) => item.manualFinalCents != null);
  const bases = items.map((item, index) =>
    manual[index]
      ? Math.max(0, item.manualFinalCents ?? 0)
      : Math.max(0, item.printedCents ?? 0),
  );
  const lineDiscounts = items.map((item, index) =>
    manual[index] ? 0 : Math.min(bases[index], Math.max(0, item.discountCents)),
  );
  const afterLineDiscount = bases.map((base, index) => base - lineDiscounts[index]);
  const receiptDiscount = summary.discountCents;
  const discountShares = allocateLargestRemainder(
    receiptDiscount,
    afterLineDiscount.map((base, index) => (manual[index] ? 0 : base)),
  );
  const netBases = afterLineDiscount.map((base, index) =>
    manual[index] ? base : Math.max(0, base - discountShares[index]),
  );
  const taxWeights = netBases.map((base, index) =>
    !manual[index] && items[index].taxable ? base : 0,
  );
  const allocatedTax = allocateLargestRemainder(summary.taxCents, taxWeights);
  const taxShares = items.map((item, index) =>
    manual[index] || !item.taxable ? 0 : allocatedTax[index],
  );
  const otherShares = allocateLargestRemainder(
    summary.otherCents,
    netBases.map((base, index) => (manual[index] ? 0 : base)),
  );

  return items.map((item, index) => {
    const receiptDiscountShareCents = manual[index] ? 0 : discountShares[index];
    const taxShareCents = taxShares[index];
    const otherShareCents = manual[index] ? 0 : otherShares[index];
    const finalCents = manual[index]
      ? bases[index]
      : netBases[index] + otherShareCents + (summary.pricesIncludeTax ? 0 : taxShareCents);
    return {
      ...item,
      finalCents,
      taxShareCents,
      otherShareCents,
      receiptDiscountShareCents,
    };
  });
}
