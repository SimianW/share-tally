import assert from "node:assert/strict";
import { normalizeAzure } from "../src/azure-receipt.js";
import { test } from "node:test";
import { processReceipt, receiptTaxMarker } from "../src/receipt-processing.js";
import { interpretReceiptNames } from "../src/receipt-names.js";
import type { ExtractedReceipt } from "../src/receipt-extraction.js";

const receipt: ExtractedReceipt = {
  merchant: "Store",
  currency: "CAD",
  total: 21.01,
  pricesIncludeTax: false,
  discountTotal: null,
  taxTotal: 1.01,
  otherCharges: null,
  warnings: [],
  items: ["Apples N", "Soap T", "Milk"].map((description) => ({
    description,
    plainEnglish: null,
    quantity: "1",
    amount: 10,
    discount: null,
    tax: null,
    taxable: null,
  })),
  text: "N = Not taxable\nT = Taxable",
};

test("receipt-local markers take priority; missing markers use model suggestions before cent allocation", async () => {
  const result = await processReceipt(
    receipt,
    async (items, _config, _request, context) => {
      assert.equal(context?.text, receipt.text);
      assert.deepEqual(
        items.map((i) => i.taxable),
        [false, true, null],
      );
      return items.map((i) => ({
        id: i.id,
        name: i.originalText,
        taxable: false,
      }));
    },
  );
  assert.deepEqual(
    result.items.map((i) => i.taxable),
    [false, true, false],
  );
  assert.deepEqual(
    result.items.map((i) => i.finalCents),
    [1000, 1101, 1000],
  );
  assert.equal(result.totalCents, 2101);
});

test("ambiguous codes never become universal rules", () => {
  assert.equal(receiptTaxMarker("Product N"), null);
  assert.equal(
    receiptTaxMarker("Product N", "N = Taxable\nN = Not taxable"),
    null,
  );
  assert.equal(receiptTaxMarker("Product Tax exempt"), false);
  assert.equal(receiptTaxMarker("Product Taxable"), true);
});

test("model failure preserves OCR, explicit markers, paid total and editable fallback", async () => {
  const result = await processReceipt(receipt, async () => {
    throw Error("offline");
  });
  assert.deepEqual(
    result.items.map((i) => i.taxable),
    [false, true, true],
  );
  assert.deepEqual(
    result.items.map((i) => i.finalCents),
    [1000, 1051, 1050],
  );
  assert.equal(result.totalCents, receipt.total! * 100);
  assert.ok(
    result.warnings.some((warning) => warning.includes("default to Taxable")),
  );
});

test("classification requests validate booleans and forbid monetary output", async () => {
  for (const taxable of [false, null, "false"]) {
    const request: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(
        body.text.format.schema.properties.items.items.required,
        ["id", "name", "taxable"],
      );
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  items: [{ id: "a", name: "Milk", taxable }],
                }),
              },
            ],
          },
        ],
      });
    };
    const promise = interpretReceiptNames(
      [{ id: "a", originalText: "Milk" }],
      { baseURL: "https://example.test", apiKey: "test", model: "test" },
      request,
      { merchant: "Store", currency: "CAD" },
    );
    if (typeof taxable === "string") await assert.rejects(promise);
    else assert.equal((await promise)[0]!.taxable, taxable);
  }
});

test("Azure retains item markers and their printed legends for processing", () => {
  const output = normalizeAzure({
    documents: [
      {
        fields: {
          Items: {
            valueArray: [
              {
                content: "Apples 10.00 N",
                valueObject: { Description: { valueString: "Apples" } },
              },
              {
                content: "Soap 10.00 T",
                valueObject: { Description: { valueString: "Soap" } },
              },
            ],
          },
        },
      },
    ],
  });
  assert.deepEqual(
    output.items.map((item) =>
      receiptTaxMarker(item.description, "N = Not taxable\nT = Taxable"),
    ),
    [false, true],
  );
});
