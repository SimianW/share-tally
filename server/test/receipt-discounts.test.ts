import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeAzure } from "../src/azure-receipt.js";
import { attachReceiptDiscounts } from "../src/receipt-discounts.js";

function fixture(name: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/azure-receipt/${name}.json`, import.meta.url), "utf8"));
}
test("recorded inline discounts reconcile as own discounts, not rounding adjustments", () => {
  const disc = normalizeAzure(fixture("azure-001"));
  assert.deepEqual(disc.items.map((item) => item.discountCents), [0, 559]);
  assert.equal(disc.discountTotal, 0);
  assert.equal(disc.discountFallback, false);
  assert.equal(disc.subtotal, 60.31);
  assert.equal(disc.total, 60.30);
  const aeon = normalizeAzure(fixture("azure-525"));
  assert.deepEqual(aeon.items.map((item) => item.discountCents).filter(Boolean), [257, 190, 700]);
  assert.equal(aeon.discountFallback, false);
  assert.equal(aeon.discountTotal, 0);
  assert.equal(aeon.subtotal, 127.37);
  assert.equal(aeon.total, 127.35);
});
test("synthetic Costco-shaped coupons attach by quoted code, never as claimable rows", () => {
  // This is NOT an Azure recording. Replace with a real redacted #50 recording.
  const result = normalizeAzure(fixture("costco-coupon.synthetic"));
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.discountCents), [300, 200]);
  assert.equal(result.discountTotal, 0);
  assert.equal(result.discountFallback, false);
});
test("a negative unit-price-only row also cannot become a claimable item", () => {
  const raw = fixture("costco-coupon.synthetic");
  const coupon = raw.documents[0].fields.Items.valueArray[1].valueObject;
  coupon.Price = coupon.TotalPrice;
  delete coupon.TotalPrice;
  const result = normalizeAzure(raw);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map((item) => item.discountCents), [300, 200]);
});
test("code wins over adjacency, with adjacency used when no code is quoted", () => {
  const items = [
    { amountCents: 1000, productCode: "12345", content: "12345 APPLE 10.00" },
    { amountCents: 1000, productCode: "67890", content: "67890 PEAR 10.00" },
  ];
  const result = attachReceiptDiscounts(items, [
    { amountCents: 1000, content: items[0]!.content, itemIndex: 0 },
    { amountCents: 1000, content: items[1]!.content, itemIndex: 1 },
    { amountCents: -200, content: "coupon 12345 -2.00" },
    { amountCents: 1000, content: items[1]!.content, itemIndex: 1 },
    { amountCents: -100, content: "promotion -1.00" },
  ], 1700);
  assert.deepEqual(result, { itemDiscountsCents: [200, 100], receiptDiscountCents: 0, fallback: false });
});
test("ambiguous product codes stay receipt-wide instead of choosing an item", () => {
  const items = [
    { amountCents: 1000, productCode: "12345", content: "FIRST 10.00" },
    { amountCents: 1000, productCode: "12345", content: "SECOND 10.00" },
  ];
  assert.deepEqual(attachReceiptDiscounts(items, [
    { amountCents: 1000, content: items[0]!.content, itemIndex: 0 },
    { amountCents: 1000, content: items[1]!.content, itemIndex: 1 },
    { amountCents: -200, content: "coupon 12345 -2.00" },
  ], 1800), { itemDiscountsCents: [0, 0], receiptDiscountCents: 200, fallback: false });
});
test("a failed reconciliation falls back for the whole receipt and keeps the missing-item gap", () => {
  const raw = fixture("costco-coupon.synthetic");
  // Simulate a missed 4.00 item in the printed subtotal.
  raw.documents[0].fields.Subtotal.valueCurrency.amount = 29;
  const result = normalizeAzure(raw);
  assert.deepEqual(result.items.map((item) => item.discountCents), [0, 0]);
  assert.equal(result.discountTotal, 500);
  assert.equal(result.discountFallback, true);
  assert.equal(result.subtotal! - (result.items.reduce((sum, item) => sum + (item.totalPrice ?? 0), 0) - result.discountTotal / 100), 4);
  assert.ok(result.warnings.some((warning) => warning.includes("remaining gap")));
});
test("failed guard discards even the merged inline discount while keeping negative lines shared", () => {
  const raw = fixture("azure-001");
  raw.documents[0].fields.Items.valueArray.push({
    content: "coupon -1.00",
    valueObject: { TotalPrice: { valueCurrency: { amount: -1, currencyCode: "MYR" } } },
  });
  const result = normalizeAzure(raw);
  assert.equal(result.discountFallback, true);
  assert.deepEqual(result.items.map((item) => item.discountCents), [0, 0]);
  assert.equal(result.discountTotal, 100);
  assert.equal(result.items.reduce((sum, item) => sum + Math.round((item.totalPrice ?? 0) * 100), 0) - result.discountTotal - Math.round(result.subtotal! * 100), 459);
});
test("missing positive item is not invented as a discount; malformed inline savings stay untouched", () => {
  const original = fixture("azure-001");
  original.documents[0].fields.Items.valueArray.pop();
  const missing = normalizeAzure(original);
  assert.equal(missing.discountFallback, true);
  assert.deepEqual(missing.items.map((item) => item.discountCents), [0]);
  assert.equal(missing.discountTotal, 0);
  const malformed = attachReceiptDiscounts(
    [{ amountCents: 1000, content: "APPLE 10.00 promo -1.5" }],
    [{ amountCents: 1000, content: "APPLE 10.00 promo -1.5", itemIndex: 0 }],
    1000,
  );
  assert.deepEqual(malformed, { itemDiscountsCents: [0], receiptDiscountCents: 0, fallback: false });
});
