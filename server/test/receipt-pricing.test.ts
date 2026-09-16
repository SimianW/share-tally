import assert from "node:assert/strict";
import { test } from "node:test";
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
