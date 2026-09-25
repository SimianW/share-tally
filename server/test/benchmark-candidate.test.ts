import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { azureItemRowIndices, mapAzureAnalysis, normalizeAzure, type AnalyzeResult } from "../src/azure-receipt.js";
import { buildReceiptNameRequest, interpretReceiptNames, parseReceiptNameResponse } from "../src/receipt-names.js";
import { applyReceiptModelResult, processReceipt, receiptModelEvidence } from "../src/receipt-processing.js";
import { invokeAdapter } from "../benchmark/adapter.js";
import { baselineAdapter, BASELINE_MODEL_VERSION } from "../benchmark/baseline.js";
import { candidateAdapter, candidateDraft, candidateInput, CANDIDATE_MODEL_VERSION } from "../benchmark/candidate.js";
import { candidateRecorder } from "../benchmark/candidate-recorder.js";
import { inputHash, noModelInput, validateModelRecording, type ModelRecording, type ModelOutcome } from "../benchmark/recordings.js";
import { offline } from "../benchmark/offline.js";

// All model outcomes and this Azure-shaped receipt are synthetic mechanics tests,
// never public release accuracy observations or genuine owner recordings.
const config = { baseURL: "https://model.synthetic.invalid/v1", model: "synthetic-model" };
const env = { RECEIPT_NAME_BASE_URL: config.baseURL, RECEIPT_NAME_MODEL: config.model, RECEIPT_NAME_API_KEY: "fake-test-key" };
const synthetic: AnalyzeResult = { content: "SYNTHETIC SHOP\nA = exempt\nB = taxable", documents: [{ fields: {
  MerchantName: { valueString: "SYNTHETIC SHOP" }, MerchantAddress: { content: "Ontario" },
  Subtotal: { valueNumber: 24 }, Total: { valueCurrency: { amount: 25.3, currencyCode: "CAD" } }, TotalTax: { valueNumber: 1.3 },
  Items: { valueArray: [
    { content: "SHARED COUPON -1.00", valueObject: { TotalPrice: { valueNumber: -1 } } },
    { content: "111 SAME 20.00 A", valueObject: { Description: { valueString: "SAME", confidence: 0.9 }, ProductCode: { valueString: "111" }, TotalPrice: { valueNumber: 20 }, Price: { valueNumber: 20 } } },
    { content: "111 COUPON -3.00", valueObject: { TotalPrice: { valueNumber: -3 } } },
    { content: "222 SAME 10.00 B", valueObject: { Description: { valueString: "SAME", confidence: 0.8 }, ProductCode: { valueString: "222" }, TotalPrice: { valueNumber: 10 }, Price: { valueNumber: 10 } } },
    // Price-only negative lines must use the exact production filter too.
    { content: "222 COUPON -2.00", valueObject: { Price: { valueNumber: -2 } } },
  ] },
} }] };
const envelope = (items: unknown[]) => ({ id: "synthetic-response", status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ items }) }] }], usage: { input_tokens: 123 } });
function recording(analysis = synthetic, outcome?: ModelOutcome, ids?: string[]): ModelRecording {
  const draft = candidateDraft(analysis, (count) => ids ?? Array.from({ length: count }, (_, index) => String(index)));
  const input = candidateInput(draft.evidence, config) as ModelRecording["input"];
  return { schemaVersion: 1, version: CANDIDATE_MODEL_VERSION, config, input, inputSha256: inputHash(input),
    ...(ids ? { itemIds: ids } : {}), outcome: outcome ?? { kind: "result", value: envelope([
      { id: "1", name: "Second", taxable: true }, { id: "0", name: "First", taxable: false },
    ]) } };
}

test("built-in candidate applies saved IDs after coupon filtering with source gaps, duplicate descriptions and Azure-only money", async () => {
  const run = await offline(() => invokeAdapter(candidateAdapter, synthetic, recording()));
  assert.equal(run.complete, true);
  assert.deepEqual(run.prediction.items?.map((item) => [item.sourceIndex, item.azureDescription, item.linePrice, item.ownDiscount, item.taxable]),
    [[1, "SAME", 2000, 300, false], [3, "SAME", 1000, 200, true]]);
  assert.deepEqual(run.prediction.receiptDiscounts, [{ label: null, amount: 100 }]);
  assert.equal(run.prediction.subtotal, 2400);
  assert.equal(run.prediction.taxTotal, 130);
  assert.equal(run.prediction.total, 2530);
  assert.equal(run.prediction.items?.[0]?.description, "111 SAME 20.00 A");
  assert.equal(run.prediction.supportedFields.includes("taxability"), true);
  const saved = recording(synthetic, { kind: "result", value: envelope([
    { id: "saved-second", name: "Second", taxable: false }, { id: "saved-first", name: "First", taxable: true },
  ]) }, ["saved-first", "saved-second"]);
  const swapped = await invokeAdapter(candidateAdapter, synthetic, saved);
  assert.deepEqual(swapped.prediction.items?.map((item) => item.taxable), [true, false]);
  await assert.rejects(invokeAdapter(candidateAdapter, synthetic, { ...saved, itemIds: ["saved-first"] }), /count/);
});

test("raw row selection is transient and never leaks into normalized, draft, stored evidence or model fields", () => {
  assert.deepEqual(azureItemRowIndices(synthetic), [1, 3]);
  const scanned = mapAzureAnalysis(synthetic);
  const draft = processReceipt(scanned);
  for (const value of [normalizeAzure(synthetic), scanned, draft, receiptModelEvidence(scanned, draft.items)]) {
    assert.equal(JSON.stringify(value).includes('"sourceIndex"'), false);
    assert.equal(JSON.stringify(value).includes('"sourceIndices"'), false);
    assert.equal(JSON.stringify(value).includes('"itemIndex"'), false);
  }
  const fresh = candidateDraft(synthetic, () => ["0", "1"]);
  assert.deepEqual(fresh.evidence.items.map((item) => item.id), ["0", "1"]);
  assert.deepEqual(fresh.evidence.items.map((item) => item.description), ["SAME", "SAME"]);
  assert.equal(fresh.evidence.items[0]?.confidence.description, 0.9);
  assert.equal(fresh.evidence.items[1]?.confidence.description, 0.8);
});

test("success, partial, invalid, timeout and error predictions come only from the production applicator", async () => {
  const cases: ModelOutcome[] = [
    { kind: "result", value: envelope([{ id: "0", name: "One", taxable: false }]) },
    { kind: "result", value: envelope([{ id: "0", name: "One", taxable: false }, { id: "1", name: "Two", taxable: null }]) },
    { kind: "result", value: envelope([{ id: "0", name: "One", taxable: false, amountCents: 1 }]) },
    { kind: "result", value: envelope([{ id: "unknown", name: "One", taxable: false }]) },
    { kind: "result", value: envelope([{ id: "0", name: "One", taxable: false }, { id: "0", name: "Again", taxable: true }]) },
    { kind: "result", value: { output: [] } },
    { kind: "result", value: { status: "incomplete", output: [] } },
    { kind: "timeout" }, { kind: "error" },
  ];
  const { items } = candidateDraft(synthetic, () => ["0", "1"]);
  for (const outcome of cases) {
    const attempt = outcome.kind === "result" ? (() => {
      try { return { kind: "result" as const, value: parseReceiptNameResponse(outcome.value) }; }
      catch { return { kind: "error" as const }; }
    })() : { kind: outcome.kind as "error" | "timeout" };
    const expected = applyReceiptModelResult(items, attempt);
    const run = await invokeAdapter(candidateAdapter, synthetic, recording(synthetic, outcome));
    assert.equal(run.complete, true);
    assert.deepEqual(run.prediction.items?.map((item) => item.taxable), expected.items.map((item) => item.taxable));
    assert.deepEqual(run.prediction.items?.map((item) => item.linePrice), [2000, 1000]);
    assert.deepEqual(run.prediction.items?.map((item) => item.ownDiscount), [300, 200]);
  }
  const missing = await invokeAdapter(candidateAdapter, synthetic, null);
  assert.equal(missing.complete, false);
  assert.equal(missing.replayed, false);
  assert.equal(missing.prediction.supportedFields.includes("taxability"), false);
  assert.deepEqual(missing.prediction.items?.map((item) => item.taxable), [true, true]);
});

test("version/config/input drift is an invalid benchmark, never production fallback", async () => {
  const saved = recording();
  const staleInput = { stale: true };
  for (const changed of [
    { ...saved, version: "stale" },
    { ...saved, config: { ...config, extra: true } },
    { ...saved, config: { ...config, baseURL: "https://u:p@model.invalid" } },
    { ...saved, config: { ...config, baseURL: `${config.baseURL}?key=x` } },
    { ...saved, config: { ...config, model: "different" } },
    { ...saved, input: staleInput, inputSha256: inputHash(staleInput) },
  ]) await assert.rejects(invokeAdapter(candidateAdapter, synthetic, changed));
  const changedAzure = structuredClone(synthetic);
  changedAzure.content = "Changed raw receipt evidence";
  // This changes the tax-code evidence included in the actual request.
  changedAzure.content += "\nNEW = taxable";
  await assert.rejects(invokeAdapter(candidateAdapter, changedAzure, saved), /input drift/);
});

test("built-in recorder captures actual wire request, raw envelope and post-filter UUIDs; offline replay is identical", async () => {
  let capturedBody: string | undefined;
  let capturedResponse: unknown;
  const recorded = await candidateRecorder.record({ analysis: synthetic, env, request: async (url, init) => {
    assert.equal(String(url), `${config.baseURL}/responses`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    capturedBody = String(init?.body);
    const wire = JSON.parse(capturedBody);
    const evidence = JSON.parse(wire.input.slice(wire.input.indexOf("{")));
    assert.equal(evidence.items.length, 2);
    assert.ok(evidence.items.every((item: { id: string }) => /^[a-f0-9-]{36}$/.test(item.id)));
    capturedResponse = envelope([...evidence.items].reverse().map((item: { id: string; productCode: string }) => ({ id: item.id, name: "Named", taxable: item.productCode === "222" })));
    return Response.json(capturedResponse);
  } });
  assert.equal(JSON.stringify(recorded.input), capturedBody);
  assert.deepEqual(recorded.outcome, { kind: "result", value: capturedResponse });
  assert.equal(recorded.itemIds?.length, 2);
  assert.equal(JSON.stringify(recorded).includes(env.RECEIPT_NAME_API_KEY), false);
  const saved = validateModelRecording({ ...recorded, schemaVersion: 1, version: CANDIDATE_MODEL_VERSION, inputSha256: inputHash(recorded.input) });
  await offline(async () => {
    const replay = await invokeAdapter(candidateAdapter, synthetic, saved);
    assert.equal(replay.complete, true);
    assert.deepEqual(replay.prediction.items?.map((item) => item.taxable), [false, true]);
  });
});

test("recorder retains invalid and partial actual envelopes and sanitized timeout/error outcomes", async () => {
  for (const value of [{ output: [] }, { status: "incomplete", output: [] }, envelope([])]) {
    const recorded = await candidateRecorder.record({ analysis: synthetic, env, request: async () => Response.json(value) });
    assert.deepEqual(recorded.outcome, { kind: "result", value });
  }
  for (const name of ["TimeoutError", "AbortError", "Error"]) {
    const recorded = await candidateRecorder.record({ analysis: synthetic, env, request: async () => { throw Object.assign(new Error("SECRET DETAIL"), { name }); } });
    assert.equal(recorded.outcome.kind, name === "Error" ? "error" : "timeout");
    assert.equal(JSON.stringify(recorded).includes("SECRET DETAIL"), false);
  }
});

test("zero items record the production no-call path, validate input/version/config, and never invent a provider response", async () => {
  const empty: AnalyzeResult = { documents: [{ fields: {} }] };
  let calls = 0;
  const recorded = await candidateRecorder.record({ analysis: empty, env, request: async () => { calls++; throw Error("must not call"); } });
  assert.equal(calls, 0);
  assert.deepEqual(recorded.outcome, { kind: "skipped", reason: "no-items" });
  assert.deepEqual(recorded.itemIds, []);
  const saved = validateModelRecording({ ...recorded, schemaVersion: 1, version: CANDIDATE_MODEL_VERSION, inputSha256: inputHash(recorded.input) });
  const run = await invokeAdapter(candidateAdapter, empty, saved);
  assert.equal(run.complete, true);
  assert.deepEqual(run.prediction.items, []);
  assert.deepEqual(await interpretReceiptNames(candidateDraft(empty).evidence, { ...config, apiKey: "fake" }, async () => { throw Error("no call"); }), { items: [] });
  assert.equal(applyReceiptModelResult([], { kind: "result", value: { items: [] } }).outcome, "ok");
  for (const changed of [
    { ...saved, version: "stale" }, { ...saved, config: { ...config, extra: true } },
    { ...saved, config: { ...config, model: "changed" } },
    { ...saved, input: { stale: true }, inputSha256: inputHash({ stale: true }) },
    { ...saved, outcome: { kind: "result" as const, value: envelope([]) } },
  ]) await assert.rejects(invokeAdapter(candidateAdapter, empty, changed));
  await assert.rejects(invokeAdapter(candidateAdapter, synthetic, saved), /count/);
  await assert.rejects(invokeAdapter(candidateAdapter, synthetic, recording(synthetic, { kind: "skipped", reason: "no-items" })), /drift/);
  const baselineInput = noModelInput({ config, items: [], context: { merchant: null, currency: null } });
  const baseline = { ...saved, version: BASELINE_MODEL_VERSION, input: baselineInput, inputSha256: inputHash(baselineInput) };
  assert.equal((await invokeAdapter(baselineAdapter, empty, baseline)).complete, true);
});

test("shared production builder/parser retain HTTP wire and parse behavior", async () => {
  const { evidence } = candidateDraft(synthetic, () => ["0", "1"]);
  const raw = envelope([{ id: "0", name: "Name", taxable: false }]);
  const parsed = await interpretReceiptNames(evidence, { ...config, apiKey: "fake" }, async (_url, init) => {
    assert.equal(init?.body, JSON.stringify(buildReceiptNameRequest(evidence, config)));
    return Response.json(raw);
  });
  assert.deepEqual(parsed, parseReceiptNameResponse(raw));
  assert.deepEqual(parsed, { items: [{ id: "0", name: "Name", taxable: false }] });
  assert.throws(() => parseReceiptNameResponse({ status: "incomplete", output: [] }), /did not complete/);
  assert.throws(() => parseReceiptNameResponse({ output: [] }), /no text/);
});

test("real inline savings and explicitly synthetic Costco attachment survive current pure mapper replay", async () => {
  const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/azure-receipt");
  for (const file of ["azure-001.json", "azure-525.json", "costco-coupon.synthetic.json"]) {
    const analysis = JSON.parse(await readFile(resolve(fixtures, file), "utf8"));
    const run = await invokeAdapter(candidateAdapter, analysis, null);
    if (file === "costco-coupon.synthetic.json") assert.deepEqual(run.prediction.items?.map((item) => item.ownDiscount), [300, 200]);
    else assert.ok(run.prediction.items?.some((item) => (item.ownDiscount ?? 0) > 0));
  }
  const failed = structuredClone(synthetic);
  failed.documents![0]!.fields!.Subtotal = { valueNumber: 23 };
  const run = await invokeAdapter(candidateAdapter, failed, null);
  assert.deepEqual(run.prediction.items?.map((item) => item.ownDiscount), [0, 0]);
  assert.deepEqual(run.prediction.receiptDiscounts, [{ label: null, amount: 600 }]);
  assert.equal(run.prediction.subtotal, 2300); // Unreconciled gap stays visible, never invented as discount.
});
