// Deterministic receipt discount attachment. All amounts are integer cents; no model
// output or merchant-specific text is used here. Safe to replay over stored evidence.
export type DiscountItem = {
  amountCents: number | null;
  productCode?: string;
  content: string;
};
export type ReceiptLine = {
  amountCents: number | null;
  content: string;
  itemIndex?: number;
};

export function attachReceiptDiscounts(
  items: readonly DiscountItem[],
  lines: readonly ReceiptLine[],
  subtotalCents: number | null,
): {
  itemDiscountsCents: number[];
  receiptDiscountCents: number;
  fallback: boolean;
} {
  const own = items.map(() => 0);
  let shared = 0;
  const codeIsQuoted = (line: string, code: string) => {
    // Match the whole code, not a fragment of another barcode or SKU.
    const at = line.indexOf(code);
    if (!code || at < 0) return false;
    let position = at;
    while (position >= 0) {
      const before = line[position - 1];
      const after = line[position + code.length];
      if ((!before || !/[\p{L}\p{N}]/u.test(before)) &&
          (!after || !/[\p{L}\p{N}]/u.test(after))) return true;
      position = line.indexOf(code, position + 1);
    }
    return false;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.amountCents === null || line.amountCents >= 0) continue;
    const discount = -line.amountCents;
    const matches = items.flatMap((item, itemIndex) =>
      item.productCode && codeIsQuoted(line.content, item.productCode) ? [itemIndex] : [],
    );
    const previous = lines[index - 1]?.itemIndex;
    const target = matches.length === 1 ? matches[0] :
      matches.length === 0 ? previous : undefined;
    if (target !== undefined && items[target]?.amountCents != null)
      own[target]! += discount;
    else shared += discount;
  }
  // The item's own Azure line may include a promotion after the printed price.
  // Anchor to the *line total*, not the unit price or a percentage/promo price.
  for (const [index, item] of items.entries()) {
    if (item.amountCents === null || item.amountCents <= 0) continue;
    const price = (item.amountCents / 100).toFixed(2);
    const printed = new RegExp(`(?<![\\d.,])${price.replace('.', '[.,]')}(?![\\d.,])`, 'g');
    const matches = [...item.content.matchAll(printed)];
    const last = matches.at(-1);
    if (!last || last.index === undefined) continue;
    const trailing = item.content.slice(last.index + last[0].length);
    for (const match of trailing.matchAll(/(?:^|[^\p{L}\p{N}])-([\d]+)[.,]([\d]{2})(?!\d)/gu))
      own[index]! += Number(match[1]) * 100 + Number(match[2]);
  }
  const printedTotal = items.reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
  const canReconcile = subtotalCents !== null &&
    items.every((item) => item.amountCents !== null) &&
    own.every((discount, index) => discount <= items[index]!.amountCents!) &&
    Math.abs(printedTotal - own.reduce((a, b) => a + b, 0) - shared - subtotalCents) <= 1;
  return canReconcile
    ? { itemDiscountsCents: own, receiptDiscountCents: shared, fallback: false }
    : {
        itemDiscountsCents: items.map(() => 0),
        receiptDiscountCents: lines.reduce((sum, line) => sum + Math.max(0, -(line.amountCents ?? 0)), 0),
        fallback: true,
      };
}
