import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretReceiptNames, receiptNameConfig, type ReceiptModelEvidence } from "../src/receipt-names.js";

const config = { baseURL: "http://example.test/v1", apiKey: "proxy-key", model: "model-from-env" };
const evidence: ReceiptModelEvidence = {
  merchant: "Store", address: "Toronto", subtotal: 25, tax: 1.25, total: 26.25,
  taxDetails: [{ amount: 1.25, rate: 0.05, description: "GST" }], taxCodeLines: ["T = taxable"],
  items: [
    { id: "a", description: "GF-table lamp/switch-I", productCode: "01123", quantity: "1", quantityUnit: "ea", unitPrice: 12, lineTotal: 12, confidence: { description: 0.92, price: 0.97, unitPrice: 0.94 }, rawLineText: "01123 LAMP 12.00 T" },
    { id: "b", description: "???", productCode: null, quantity: "1", quantityUnit: null, unitPrice: null, lineTotal: 13, confidence: { description: null, price: null, unitPrice: null }, rawLineText: null },
  ],
};

function provider(items: unknown): typeof fetch {
  return async () => Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(items) }] }] });
}

test("custom model provider requires its own key instead of silently using a production key", () => {
  assert.throws(() => receiptNameConfig({ RECEIPT_NAME_BASE_URL: "http://dev-2a1m:8317/v1", OPENAI_API_KEY: "production-secret" }), /RECEIPT_NAME_API_KEY/);
  assert.deepEqual(receiptNameConfig({ RECEIPT_NAME_BASE_URL: "http://dev-2a1m:8317/v1/", RECEIPT_NAME_API_KEY: "proxy-key", RECEIPT_NAME_MODEL: "model-from-env" }), {
    baseURL: "http://dev-2a1m:8317/v1", apiKey: "proxy-key", model: "model-from-env",
  });
  assert.throws(() => receiptNameConfig({ RECEIPT_NAME_API_KEY: "provider-key" }), /RECEIPT_NAME_MODEL/);
});

test("model request sends structured receipt evidence without images and only asks for names and taxability", async () => {
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, "http://example.test/v1/responses");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "model-from-env");
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, "json_schema");
    assert.deepEqual(body.text.format.schema.properties.items.items.required, ["id", "name", "taxable"]);
    assert.equal(body.text.format.schema.properties.items.items.additionalProperties, false);
    assert.match(body.input, /GF-table lamp\/switch-I/);
    assert.match(body.input, /T = taxable/);
    assert.match(body.input, /01123 LAMP 12.00 T/);
    assert.match(body.input, /"unitPrice":0.94/);
    assert.equal(body.input.includes("imageBase64"), false);
    return provider({ items: [{ id: "b", name: "Unclear Item", taxable: false }, { id: "a", name: "Table lamp", taxable: true }] })(url, init);
  };
  assert.deepEqual(await interpretReceiptNames(evidence, config, request), {
    items: [{ id: "b", name: "Unclear Item", taxable: false }, { id: "a", name: "Table lamp", taxable: true }],
  });
});

test("malformed transport responses fail, while partial and unusable JSON reach the draft fallback policy", async () => {
  await assert.rejects(interpretReceiptNames(evidence, config, async () => Response.json({ output: [{ type: "reasoning" }] })), /no text output/);
  await assert.rejects(interpretReceiptNames(evidence, config, async () => new Response(null, { status: 502 })), /HTTP 502/);
  const partial = { items: [{ id: "a", name: "Lamp", taxable: false }] };
  assert.deepEqual(await interpretReceiptNames(evidence, config, provider(partial)), partial);
  const invalid = { items: [{ id: "a", name: "Lamp", amountCents: 0 }] };
  assert.deepEqual(await interpretReceiptNames(evidence, config, provider(invalid)), invalid);
});
