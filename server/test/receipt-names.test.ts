import assert from "node:assert/strict";
import { test } from "node:test";
import {
  interpretReceiptNames,
  receiptNameConfig,
} from "../src/receipt-names.js";

test("custom name provider uses gateway key and never falls back to the OpenAI key", () => {
  assert.throws(
    () =>
      receiptNameConfig({
        RECEIPT_NAME_BASE_URL: "http://dev-2a1m:8317/v1",
        OPENAI_API_KEY: "production-secret",
      }),
    /RECEIPT_NAME_API_KEY/,
  );
  assert.deepEqual(
    receiptNameConfig({
      RECEIPT_NAME_BASE_URL: "http://dev-2a1m:8317/v1/",
      RECEIPT_NAME_API_KEY: "proxy-key",
    }),
    {
      baseURL: "http://dev-2a1m:8317/v1",
      apiKey: "proxy-key",
      model: "gpt-5.6-luna",
    },
  );
});
test("name requests use Responses with medium reasoning and preserve reordered items", async () => {
  const config = {
    baseURL: "http://example.test/v1",
    apiKey: "proxy-key",
    model: "model-from-env",
  };
  const items = [
    { id: "a", originalText: "GF-table lamp/switch-I", amountCents: 1200 },
    { id: "b", originalText: "???", amountCents: 1300 },
  ];
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, "http://example.test/v1/responses");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "model-from-env");
    assert.deepEqual(body.reasoning, { effort: "medium" });
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.name, "receipt_item_names");
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema.required, ["items"]);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(
      body.text.format.schema.properties.items.items.required,
      ["id", "name"],
    );
    assert.equal(
      body.text.format.schema.properties.items.items.additionalProperties,
      false,
    );
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 8192);
    assert.match(body.input, /Return JSON only/);
    assert.equal(JSON.stringify(body).includes("amountCents"), false);
    assert.equal(init?.redirect, "error");
    return Response.json({
      output: [
        { type: "reasoning" },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                items: [
                  { id: "b", name: "Unclear Item" },
                  { id: "a", name: "Table lamp" },
                ],
              }),
            },
          ],
        },
      ],
    });
  };
  assert.deepEqual(await interpretReceiptNames(items, config, request), [
    { id: "a", name: "Table lamp" },
    { id: "b", name: "Unclear Item" },
  ]);
  assert.equal(items[0]!.amountCents, 1200);
});
test("mismatched names and added financial fields are rejected", async () => {
  const config = {
    baseURL: "http://example.test/v1",
    apiKey: "key",
    model: "gpt-5.6-luna",
  };
  for (const items of [
    [{ id: "other", name: "Lamp" }],
    [{ id: "a", name: "Lamp", amountCents: 0 }],
  ]) {
    const request: typeof fetch = async () =>
      Response.json({
        output: [
          {
            content: [
              { type: "output_text", text: JSON.stringify({ items }) },
            ],
          },
        ],
      });
    await assert.rejects(
      interpretReceiptNames(
        [{ id: "a", originalText: "lamp" }],
        config,
        request,
      ),
    );
  }
});
test("a Responses result without output text is rejected", async () => {
  const request: typeof fetch = async () =>
    Response.json({ output: [{ type: "reasoning" }] });
  await assert.rejects(
    interpretReceiptNames(
      [{ id: "a", originalText: "lamp" }],
      {
        baseURL: "http://example.test/v1",
        apiKey: "key",
        model: "configured-model",
      },
      request,
    ),
    /no text output/,
  );
});
