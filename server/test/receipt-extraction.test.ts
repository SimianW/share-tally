import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createAzureExtractor, normalizeAzure } from "../src/azure-receipt.js";
import { RECEIPT_ITEM_CONFIDENCE_THRESHOLD } from "../src/receipt-needs-check.js";
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
    exclusive.items.map((i) => i.allocatedTaxCents),
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
    repriced.items.map((i) => [i.allocatedTaxCents, i.finalCents]),
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
  assert.equal(draftItemInput.safeParse(explicitZero.items[0]).success, true);
  assert.equal(explicitZero.items[0]!.finalCents, 0);
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
function recorded(name: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/azure-receipt/${name}.json`, import.meta.url), "utf8"));
}
function extractorFor(result: object) {
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    if (++calls === 1) {
      assert.match(String(url), /prebuilt-receipt:analyze\?api-version=2024-11-30/);
      assert.equal(init?.method, "POST");
      return new Response(null, { status: 202, headers: { "operation-location": "https://azure.example.test/results/1" } });
    }
    if (calls === 2) return Response.json({ status: "running" });
    return Response.json({ status: "succeeded", analyzeResult: result });
  };
  return { extract: createAzureExtractor(env, request, async () => {}), calls: () => calls };
}
test("Azure adapter retains recorded evidence without changing prices", async () => {
  const withTax = extractorFor(recorded("azure-525"));
  const result = await withTax.extract(Buffer.from("image"));
  assert.equal(withTax.calls(), 3);
  assert.equal(result.evidence?.countryRegion, "MYS");
  assert.ok(result.evidence?.taxDetails?.length);
  assert.equal(result.evidence.taxDetails[0]?.rate, 0);
  assert.ok(result.items[0]?.evidence?.productCode);
  assert.ok(result.items[0]?.evidence?.descriptionRegions?.[0]?.polygon.length);
  assert.ok(result.items[0]?.evidence?.regions?.[0]?.polygon.length);
  assert.equal(result.items[0]?.evidence?.content, result.items[0]?.description);
  assert.ok(result.rawAnalysis?.documents);
  assert.equal(result.items[0]?.amount, 15.56);
  const withoutTax = await extractorFor(recorded("azure-225")).extract(Buffer.from("image"));
  assert.equal(withoutTax.evidence?.taxDetails, undefined);
  assert.equal(withoutTax.items[0]?.evidence?.unitPrice, 12);
  assert.ok(withoutTax.items[0]?.evidence?.priceConfidence);
  assert.ok(withoutTax.items[0]?.evidence?.unitPriceConfidence);
  assert.ok(withoutTax.items[0]?.evidence?.priceRegions?.length);
  assert.equal(withoutTax.items[0]?.amount, 24);
  const missing = structuredClone(recorded("azure-225"));
  const item = missing.documents[0].fields.Items.valueArray[0].valueObject;
  delete item.Description.confidence;
  delete item.Description.boundingRegions;
  delete item.TotalPrice.confidence;
  delete item.TotalPrice.boundingRegions;
  const noObservations = await extractorFor(missing).extract(Buffer.from("image"));
  assert.equal(noObservations.items[0]?.evidence?.descriptionConfidence, undefined);
  assert.equal(noObservations.items[0]?.evidence?.descriptionRegions, undefined);
  assert.equal(noObservations.items[0]?.evidence?.priceConfidence, undefined);
  assert.equal(noObservations.items[0]?.evidence?.priceRegions, undefined);
  assert.equal(extractionDefaults(noObservations).items[0]?.needsCheck, false);
});
test("recorded Azure shapes mark low description or total-price confidence, not absent observations", () => {
  const recordedResult = structuredClone(recorded("azure-225"));
  const rows = recordedResult.documents[0].fields.Items.valueArray;
  rows[0].valueObject.Description.confidence = RECEIPT_ITEM_CONFIDENCE_THRESHOLD - 0.01;
  rows[1].valueObject.TotalPrice.confidence = RECEIPT_ITEM_CONFIDENCE_THRESHOLD - 0.01;
  rows[2].valueObject.Description.confidence = RECEIPT_ITEM_CONFIDENCE_THRESHOLD;
  delete rows[2].valueObject.TotalPrice.confidence;
  const normalized = normalizeAzure(recordedResult);
  const scanned = extractedFromNormalized(normalized);
  assert.deepEqual(extractionDefaults(scanned).items.map((item) => item.needsCheck), [true, true, false]);
  assert.equal(normalized.items[2].evidence.priceConfidence, undefined);

  delete rows[2].valueObject.TotalPrice.valueCurrency;
  const missingPrice = normalizeAzure(recordedResult);
  assert.equal(extractionDefaults(extractedFromNormalized(missingPrice)).items[2]?.needsCheck, true);
});

function extractedFromNormalized(normalized: ReturnType<typeof normalizeAzure>): ExtractedReceipt {
  return {
    merchant: normalized.merchant, currency: normalized.currency, total: normalized.total,
    pricesIncludeTax: false, discountTotal: null, taxTotal: null, otherCharges: null, warnings: [],
    items: normalized.items.map((item) => ({
      description: item.description, plainEnglish: null, quantity: "1", amount: item.totalPrice,
      discount: null, tax: null, taxable: null, evidence: item.evidence,
    })),
  };
}

test("Azure discount total preserves both own and receipt-wide discounts through draft pricing", async () => {
  const raw = structuredClone(recorded("costco-coupon.synthetic"));
  raw.documents[0].fields.Items.valueArray.push({
    content: "general coupon -1.00",
    valueObject: { TotalPrice: { valueCurrency: { amount: -1, currencyCode: "CAD" } } },
  });
  raw.documents[0].fields.Subtotal.valueCurrency.amount = 24;
  const extraction = await extractorFor(raw).extract(Buffer.from("image"));
  const draft = extractionDefaults(extraction);
  assert.deepEqual(draft.items.map((item) => item.discountCents), [300, 200]);
  assert.equal(draft.receipt.discountCents, 100);
  assert.equal(draft.receipt.discountFallback, false);
  assert.equal(draft.items.length, 2);
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
