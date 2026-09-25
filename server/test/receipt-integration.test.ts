import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeAzure } from "../src/azure-receipt.js";
import { extractionDefaults, extractedReceipt } from "../src/receipt-extraction.js";
import { priceDraft } from "../src/receipt-pricing.js";
import { applyReceiptModelResult, receiptModelEvidence } from "../src/receipt-processing.js";

const draftFields = {
  purchaseDate: "", timeZone: "", notes: "", ownShareCents: 0, participantIds: [],
};

function scannedFixture(name: string, subtotalOverride?: number, extraSharedDiscount = false) {
  const analysis = JSON.parse(readFileSync(new URL(`./fixtures/azure-receipt/${name}.json`, import.meta.url), "utf8"));
  if (subtotalOverride !== undefined) {
    analysis.documents[0].fields.Subtotal.valueCurrency.amount = subtotalOverride;
    if (subtotalOverride === 24) analysis.documents[0].fields.Total.valueCurrency.amount = 24;
  }
  if (extraSharedDiscount) analysis.documents[0].fields.Items.valueArray.unshift({
    content: "UNSPECIFIED PROMOTION -1.00",
    valueObject: { TotalPrice: { valueCurrency: { amount: -1, currencyCode: "CAD" } } },
  });
  const azure = normalizeAzure(analysis);
  const scanned = extractedReceipt.parse({
    merchant: azure.merchant,
    evidence: azure.evidence,
    rawAnalysis: analysis,
    text: analysis.content,
    currency: azure.currency,
    total: azure.total,
    subtotal: azure.subtotal,
    items: azure.items.map((item) => ({
      description: item.description,
      evidence: item.evidence,
      plainEnglish: null,
      quantity: item.quantity === null ? null : String(item.quantity),
      amount: item.totalPrice,
      discount: item.discountCents / 100,
      ...(item.discountCents ? { discountSource: "receipt" as const } : {}),
      tax: null,
      taxable: null,
    })),
    discountTotal: (azure.discountTotal + azure.items.reduce((sum, item) => sum + item.discountCents, 0)) / 100,
    discountFallback: azure.discountFallback,
    taxTotal: null,
    otherCharges: null,
    warnings: azure.warnings,
  });
  return { azure, scanned, defaults: extractionDefaults(scanned) };
}

test("removed coupon rows cannot shift model IDs; own discounts survive repricing", () => {
  const { azure, scanned, defaults } = scannedFixture("costco-coupon.synthetic");
  assert.equal(azure.items.length, 2, "four Azure lines become two claimable items");
  assert.deepEqual(defaults.items.map((item) => [item.discountCents, item.discountSource]), [[300, "receipt"], [200, "receipt"]]);
  assert.equal(defaults.receipt.discountCents, 0);
  assert.equal(defaults.receipt.discountFallback, false);
  const evidence = receiptModelEvidence(scanned, defaults.items);
  assert.deepEqual(evidence.items.map((item) => item.id), defaults.items.map((item) => item.id));
  assert.deepEqual(evidence.items.map((item) => item.productCode), ["1234567", "8901234"]);
  const [paper, coffee] = defaults.items;
  const applied = applyReceiptModelResult(defaults.items, { kind: "result", value: {
    // Deliberately reversed: correlation must use IDs, not original Azure row indexes.
    items: [
      { id: coffee!.id, name: "Roasted coffee", taxable: false },
      { id: paper!.id, name: "Paper towels", taxable: true },
    ],
  } });
  assert.equal(applied.outcome, "ok");
  const priced = priceDraft({ ...draftFields, mode: "items", title: defaults.title,
    receipt: defaults.receipt, totalCents: defaults.totalCents, items: applied.items });
  assert.deepEqual(priced.items.map((item) => [item.name, item.taxable, item.discountCents, item.discountSource, item.finalCents]), [
    ["Paper towels", true, 300, "receipt", 1700],
    ["Roasted coffee", false, 200, "receipt", 800],
  ]);
  assert.equal(defaults.totalCents, 2500);
  assert.equal(priced.items.reduce((total, item) => total + item.finalCents!, 0), defaults.totalCents);
});

test("own and receipt-wide discounts both survive model completion without changing paid total", () => {
  // One unquoted coupon before all items remains receipt-wide; two coded
  // coupons attach to their own items in the same Azure mapping pass.
  const { azure, defaults } = scannedFixture("costco-coupon.synthetic", 24, true);
  assert.equal(azure.discountFallback, false);
  assert.equal(azure.discountTotal, 100);
  assert.deepEqual(defaults.items.map((item) => item.discountCents), [300, 200]);
  assert.equal(defaults.receipt.discountCents, 100);
  const answer = applyReceiptModelResult(defaults.items, { kind: "result", value: {
    items: defaults.items.map((item) => ({ id: item.id, name: item.name, taxable: true })),
  } });
  const priced = priceDraft({ ...draftFields, mode: "items", title: defaults.title,
    receipt: defaults.receipt, totalCents: defaults.totalCents, items: answer.items });
  assert.deepEqual(priced.items.map((item) => [item.discountCents, item.discountSource, item.allocatedDiscountCents, item.finalCents]), [
    [300, "receipt", 68, 1632], [200, "receipt", 32, 768],
  ]);
  assert.equal(priced.items.reduce((total, item) => total + item.finalCents!, 0), defaults.totalCents);
  assert.equal(defaults.totalCents, 2400);
});

test("failed discount attachment remains receipt-wide through model defaults and repricing", () => {
  // A missing positive row makes attachment fail; the coupons remain receipt-wide.
  const { azure, defaults } = scannedFixture("costco-coupon.synthetic", 29);
  assert.equal(azure.discountFallback, true);
  assert.equal(azure.discountTotal, 500);
  assert.deepEqual(azure.items.map((item) => item.discountCents), [0, 0]);
  const data = { ...draftFields, mode: "items" as const, title: defaults.title,
    receipt: defaults.receipt, totalCents: defaults.totalCents, items: defaults.items };
  assert.deepEqual(data.items.map((item) => item.discountSource), [undefined, undefined]);
  const applied = applyReceiptModelResult(data.items, { kind: "error" });
  const priced = priceDraft({ ...data, items: applied.items });
  assert.equal(applied.outcome, "fallback");
  assert.deepEqual(priced.items.map((item) => [item.taxable, item.taxNotChecked, item.discountCents, item.discountSource, item.allocatedDiscountCents, item.finalCents]), [
    [true, true, 0, undefined, 333, 1667],
    [true, true, 0, undefined, 167, 833],
  ]);
  assert.equal(data.receipt.discountCents, 500);
  assert.equal(data.receipt.discountFallback, true);
  assert.equal(data.totalCents, 2500);
  assert.equal(priced.items.reduce((total, item) => total + item.finalCents!, 0), 2500);
  // The incorrect printed subtotal is not rewritten to conceal the discrepancy.
  assert.equal(data.receipt.subtotalCents, 2900);
});
