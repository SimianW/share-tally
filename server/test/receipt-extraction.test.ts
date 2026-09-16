import assert from "node:assert/strict";
import { test } from "node:test";
import { createAzureExtractor } from "../src/azure-receipt.js";
import {
  extractionDefaults,
  type ExtractedReceipt,
} from "../src/receipt-extraction.js";
import { draftItemInput, itemInput } from "../src/receipt-input.js";
import { priceDraft } from "../src/receipt-pricing.js";

function receipt(patch: Partial<ExtractedReceipt> = {}): ExtractedReceipt {
  return {
    merchant: "Shop",
    currency: "CAD",
    total: 3.05,
    pricesIncludeTax: false,
    items: Array.from({ length: 3 }, () => ({
      description: "Printed item",
      plainEnglish: null,
      quantity: "1",
      amount: 1,
      discount: null,
      tax: null,
      taxable: null,
    })),
    discountTotal: null,
    taxTotal: 0.05,
    otherCharges: null,
    warnings: [],
    ...patch,
  };
}
test("tax allocation preserves cents and included tax is not charged twice", () => {
  const exclusive = extractionDefaults(receipt());
  assert.deepEqual(
    exclusive.items.map((i) => i.taxCents),
    [2, 2, 1],
  );
  assert.deepEqual(
    exclusive.items.map((i) => i.finalCents),
    [102, 102, 101],
  );
  const repriced = priceDraft({
    mode: "items",
    title: "Shop",
    notes: "",
    purchaseDate: "2026-09-16",
    timeZone: "America/Toronto",
    totalCents: exclusive.totalCents,
    ownShareCents: 0,
    participantIds: [],
    receipt: exclusive.receipt,
    items: exclusive.items,
  });
  assert.deepEqual(
    repriced.items.map((i) => [i.taxCents, i.finalCents]),
    [
      [2, 102],
      [2, 102],
      [1, 101],
    ],
  );
  const inclusive = extractionDefaults(receipt({ pricesIncludeTax: true }));
  assert.deepEqual(
    inclusive.items.map((i) => i.finalCents),
    [100, 100, 100],
  );
  assert.equal(inclusive.summary?.taxCents, 5);
  assert.equal(inclusive.totalCents, 305);
});
test("missing money stays empty, explicit zero is valid, undefined allocation requires correction", () => {
  const missing = receipt({ total: null });
  missing.items[0]!.amount = null;
  const output = extractionDefaults(missing);
  assert.equal(output.totalCents, null);
  assert.equal(output.items[0]!.amountCents, null);
  assert.equal(output.items[0]!.finalCents, null);
  assert.equal(draftItemInput.safeParse(output.items[0]).success, true);
  assert.equal(itemInput.safeParse(output.items[0]).success, false);
  const zero = receipt({ taxTotal: null });
  zero.items.forEach((i) => {
    i.amount = 0;
  });
  const explicitZero = extractionDefaults(zero);
  const {
    taxable: _taxable,
    manualFinal: _manualFinal,
    allocatedTaxCents: _allocatedTaxCents,
    ...zeroItem
  } = explicitZero.items[0]!;
  assert.equal(itemInput.safeParse(zeroItem).success, true);
  zero.taxTotal = 0.01;
  assert.ok(extractionDefaults(zero).items.every((i) => i.finalCents === null));
});
test("discrepancy is never converted into a discount and invalid financial data is rejected", () => {
  const output = extractionDefaults(receipt({ total: 1, taxTotal: null }));
  assert.deepEqual(
    output.items.map((i) => i.discountCents),
    [0, 0, 0],
  );
  assert.equal(
    output.items.reduce((sum, i) => sum + i.finalCents!, 0),
    300,
  );
  assert.throws(() => extractionDefaults(receipt({ total: Infinity })));
  assert.throws(() => extractionDefaults(receipt({ total: -1 })));
});
const env = {
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://azure.example.test",
  AZURE_DOCUMENT_INTELLIGENCE_KEY: "test-only",
};
test("Azure uses the selected receipt API, polls, and preserves missing amounts", async () => {
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    if (++calls === 1) {
      assert.match(
        String(url),
        /prebuilt-receipt:analyze\?api-version=2024-11-30/,
      );
      assert.equal(init?.method, "POST");
      return new Response(null, {
        status: 202,
        headers: {
          "operation-location": "https://azure.example.test/results/1",
        },
      });
    }
    if (calls === 2) return Response.json({ status: "running" });
    return Response.json({
      status: "succeeded",
      analyzeResult: {
        content: "Tax included",
        documents: [
          {
            fields: {
              Items: {
                valueArray: [
                  { valueObject: { Description: { valueString: "APPLE" } } },
                ],
              },
              TotalTax: { valueCurrency: { amount: 0.25 } },
            },
          },
        ],
      },
    });
  };
  const output = await createAzureExtractor(env, request, async () => {})(
    Buffer.from("image"),
  );
  assert.equal(calls, 3);
  assert.equal(output.total, null);
  assert.equal(output.items[0]!.amount, null);
  assert.equal(output.items[0]!.description, "APPLE");
  assert.equal(output.pricesIncludeTax, true);
});
test("Azure rejects foreign polling URLs without forwarding credentials and returns recoverable errors", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return new Response(null, {
      status: 202,
      headers: { "operation-location": "https://other.example.test/results/1" },
    });
  };
  await assert.rejects(
    createAzureExtractor(env, request, async () => {})(Buffer.from("image")),
    /Your draft is safe/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    createAzureExtractor({}, request)(Buffer.from("image")),
    /not configured/,
  );
});
