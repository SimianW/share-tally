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
test("name requests use Chat Completions and preserve item order despite reordered responses", async () => {
  const config = {
    baseURL: "http://example.test/v1",
    apiKey: "proxy-key",
    model: "gpt-5.6-luna",
  };
  const items = [
    { id: "a", originalText: "GF-table lamp/switch-I", amountCents: 1200 },
    { id: "b", originalText: "???", amountCents: 1300 },
  ];
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, "http://example.test/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(JSON.stringify(body).includes("amountCents"), false);
    assert.equal(init?.redirect, "error");
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              items: [
                { id: "b", name: "Unclear Item" },
                { id: "a", name: "Table lamp" },
              ],
            }),
          },
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
        choices: [{ message: { content: JSON.stringify({ items }) } }],
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
