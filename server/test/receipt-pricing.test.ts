import assert from "node:assert/strict";
import { test } from "node:test";
import { unassignedReceiptTaxMessage } from "../src/receipt-pricing.js";
import type { ReceiptDraftData } from "../src/receipt-input.js";
import {
  extractionDefaults,
  type ExtractedReceipt,
} from "../src/receipt-extraction.js";
const receipt = (
  missingTaxable: boolean,
  discountTotal = 0,
): ExtractedReceipt => ({
  merchant: null,
  currency: "CAD",
  total: 16.83,
  pricesIncludeTax: false,
  discountTotal,
  taxTotal: 1.75,
  otherCharges: null,
  warnings: [],
  items: [
    { description: "Food", amount: 5.59, taxable: false },
    { description: "Drink", amount: 9.49, taxable: true },
    { description: "Unread price", amount: null, taxable: missingTaxable },
  ].map((item) => ({
    ...item,
    plainEnglish: null,
    quantity: "1",
    discount: null,
    tax: null,
  })),
});
test("positive tax without a derived taxable positive-net item has an initiation error", () => {
  const data: ReceiptDraftData = {
    title: "Groceries", purchaseDate: "2026-01-01", timeZone: "America/Toronto",
    notes: "", totalCents: 1125, ownShareCents: 0, participantIds: [], mode: "items",
    receipt: { subtotalCents: 1000, taxCents: 125, discountCents: 0, extraCents: 0, pricesIncludeTax: false },
    items: [{ id: crypto.randomUUID(), name: "Bread", originalText: "", quantity: "1",
      amountCents: 1000, discountCents: 0, finalCents: 1000, taxable: false, manualFinal: false }],
  };
  assert.equal(unassignedReceiptTaxMessage(data),
    "Receipt tax $1.25 isn't assigned to any item. Mark the taxable items or set final costs manually.");
});

test("tax assignment rule distinguishes manual finals, inclusive or zero tax, and positive taxable net", () => {
  const receipt = { subtotalCents: 2000, taxCents: 125, discountCents: 0, extraCents: 0, pricesIncludeTax: false };
  const item = (taxable: boolean | null, manualFinal = false) => ({
    id: crypto.randomUUID(), name: "Item", originalText: "", quantity: "1",
    amountCents: 1000, discountCents: 0, finalCents: 1000, taxable, manualFinal,
  });
  const data: ReceiptDraftData = {
    title: "Groceries", purchaseDate: "2026-01-01", timeZone: "America/Toronto",
    notes: "", totalCents: 2125, ownShareCents: 0, participantIds: [], mode: "items",
    receipt, items: [item(false)],
  };
  const message = "Receipt tax $1.25 isn't assigned to any item. Mark the taxable items or set final costs manually.";
  const examples: [string, ReceiptDraftData, string | null][] = [
    ["all manual finals", { ...data, items: [item(false, true)] }, null],
    ["tax already included", { ...data, receipt: { ...receipt, pricesIncludeTax: true } }, null],
    ["zero receipt tax", { ...data, receipt: { ...receipt, taxCents: 0 } }, null],
    ["manual taxable but derived exempt", { ...data, items: [item(true, true), item(false)] }, message],
    ["null taxability means taxable", { ...data, items: [item(null), item(false)] }, null],
    ["taxable derived positive net", { ...data, items: [item(true), item(false)] }, null],
    ["taxable derived zero net after own discount", { ...data, items: [{ ...item(true), discountCents: 1000 }, item(false)] }, message],
    ["taxable derived zero net after receipt discount", { ...data, receipt: { ...receipt, discountCents: 1000 }, items: [item(true), { ...item(false), amountCents: 0 }] }, message],
    ["manual bills are unchanged", { ...data, mode: "manual" }, null],
  ];
  for (const [name, input, expected] of examples)
    assert.equal(unassignedReceiptTaxMessage(input), expected, name);
});

test("one missing non-taxable price does not erase other final costs or tax allocation", () => {
  assert.deepEqual(
    extractionDefaults(receipt(false)).items.map((i) => i.finalCents),
    [559, 1124, null],
  );
});
test("missing taxable price blocks only dependent tax calculations", () => {
  assert.deepEqual(
    extractionDefaults(receipt(true)).items.map((i) => i.finalCents),
    [559, null, null],
  );
});
test("missing price blocks shared discount allocation rather than guessing weights", () => {
  assert.deepEqual(
    extractionDefaults(receipt(false, 1)).items.map((i) => i.finalCents),
    [null, null, null],
  );
});
