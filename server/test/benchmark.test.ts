import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createAzureExtractor, mapAzureAnalysis, type AnalyzeResult } from "../src/azure-receipt.js";
import { mapAzureAnalysis as frozenMap } from "../benchmark/frozen-baseline/azure-receipt.js";
import { buildReceiptNameRequest, parseReceiptNameResponse } from "../benchmark/frozen-baseline/receipt-names.js";
import { candidateRecorder } from "../benchmark/candidate-recorder.js";
import { CANDIDATE_MODEL_VERSION } from "../benchmark/candidate.js";
import { baselineAdapter, BASELINE_MODEL_VERSION } from "../benchmark/baseline.js";
import { invokeAdapter, projectAzureDescriptions } from "../benchmark/adapter.js";
import { aggregateScores, scoreReceipt } from "../benchmark/scorer.js";
import { AZURE_CONFIGS, canonicalJson, inputHash, recordedItemIds, replayModel, validateAzureRecording, validateModelRecording, type ModelRecording } from "../benchmark/recordings.js";
import { offline } from "../benchmark/offline.js";
import { runBenchmark } from "../benchmark/runner.js";

const server = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(server, "benchmark");
const synthetic: AnalyzeResult = { apiVersion: "2024-11-30", modelId: "prebuilt-receipt", content: "TEST ONLY SHOP\nMILK 2.00\nTOTAL 2.00", documents: [{ fields: {
  MerchantName: { valueString: "TEST ONLY SHOP" }, Total: { valueCurrency: { amount: 2, currencyCode: "CAD" } }, Subtotal: { valueNumber: 2 },
  Items: { valueArray: [{ valueObject: { Description: { valueString: "MILK" }, Quantity: { valueNumber: 1 }, Price: { valueNumber: 2 }, TotalPrice: { valueNumber: 2 }, ProductCode: { valueString: "TEST-1" } } }] },
} }] };
const syntheticResponse = { output: [{ content: [{ type: "output_text", text: JSON.stringify({ items: [{ id: "0", name: "Milk", taxable: false }] }) }] }] };
const config = { baseURL: "https://synthetic-test.invalid/v1", model: "synthetic-test-model" };
async function syntheticRecording(): Promise<ModelRecording> {
  const snapshot = JSON.parse(await readFile(resolve(server, "test/fixtures/benchmark/frozen-names-request-1650993.json"), "utf8"));
  assert.equal(snapshot.commit, "16509935cb34d505ee8d48c5616c2a22ff908e2f");
  assert.deepEqual(snapshot.analysis, synthetic);
  assert.deepEqual(snapshot.config, config);
  assert.deepEqual(snapshot.response, syntheticResponse);
  return { schemaVersion: 1, version: BASELINE_MODEL_VERSION, config: snapshot.config,
    input: snapshot.input, inputSha256: inputHash(snapshot.input), outcome: { kind: "result", value: snapshot.response } };
}
const json = (path: string, value: unknown) => writeFile(path, JSON.stringify(value));
const cli = (args: string[]) => spawnSync(process.execPath, ["--import=tsx", resolve(root, "cli.ts"), ...args], { cwd: server, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });

test("pure Azure mapper matches production extractor for all 11 real raw fixtures", async () => {
  const snapshot = JSON.parse(await readFile(resolve(server, "test/fixtures/benchmark/frozen-azure-1650993.json"), "utf8"));
  assert.equal(snapshot.commit, "16509935cb34d505ee8d48c5616c2a22ff908e2f");
  for (const id of ["000", "001", "002", "010", "075", "175", "225", "275", "450", "525", "550"]) {
    const raw = JSON.parse(await readFile(resolve(server, "test/fixtures/azure-receipt", `azure-${id}.json`), "utf8")) as AnalyzeResult;
    let calls = 0;
    const extractor = createAzureExtractor({ AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://azure-test.invalid", AZURE_DOCUMENT_INTELLIGENCE_KEY: "test-only" }, async () => {
      calls++;
      return calls === 1 ? new Response(null, { status: 202, headers: { "operation-location": "https://azure-test.invalid/operation" } }) : new Response(JSON.stringify({ status: "succeeded", analyzeResult: raw }));
    }, async () => undefined);
    const { scanTimings, ...extracted } = await extractor(Buffer.from("test-only"));
    assert.ok(scanTimings && Object.values(scanTimings).every((value) => value >= 0));
    assert.deepEqual(extracted, mapAzureAnalysis(raw), id);
    const { rawAnalysis, ...frozen } = frozenMap(raw);
    assert.deepEqual(rawAnalysis, raw, `Frozen #48 raw evidence ${id}`);
    assert.deepEqual(frozen, snapshot.outputs[id], `Frozen #48 pinned production snapshot ${id}`);
    assert.equal(calls, 2);
  }
});

test("shared Azure descriptions preserve source bindings across filtering and ignore plugin-supplied evidence", () => {
  const analysis: AnalyzeResult = { documents: [{ fields: { Items: { valueArray: [
    { valueObject: { Description: { valueString: "MILK" } } },
    { valueObject: { Description: { valueString: "COUPON" } } },
    { valueObject: { Description: { content: "BREAD" } } },
  ] } } }] };
  const projected = projectAzureDescriptions(analysis, { supportedFields: ["items", "items.description", "items.linePrice"], items: [
    { sourceIndex: 2, description: "RAW WHOLE ROW 3", azureDescription: "PLUGIN FABRICATION", linePrice: 100 },
    { sourceIndex: 0, description: "RAW WHOLE ROW 1", linePrice: 200 },
  ] });
  assert.deepEqual(projected.items?.map((item) => item.azureDescription), ["BREAD", "MILK"]);
  const score = scoreReceipt({ items: [{ description: "MILK", linePrice: 200 }, { description: "BREAD", linePrice: 100 }] }, projected);
  assert.deepEqual(score.matching, { matched: 2, missing: 0, extra: 0 });
  assert.equal(score.fields["items.description"].correct, 0);
  assert.equal(score.fields["items.azureDescription"].correct, 2);
  assert.deepEqual(aggregateScores([score, score]).matching, { matched: 4, missing: 0, extra: 0 });
  assert.throws(() => projectAzureDescriptions(analysis, { supportedFields: ["items"], items: [{ description: "unbound" }] }), /sourceIndex/);
  assert.throws(() => projectAzureDescriptions(analysis, { supportedFields: ["items"], items: [{ sourceIndex: 0 }, { sourceIndex: 0 }] }), /sourceIndex/);
  assert.throws(() => projectAzureDescriptions(analysis, { supportedFields: ["items"], items: [{ sourceIndex: 3 }] }), /sourceIndex/);
  assert.equal(projectAzureDescriptions(analysis, { supportedFields: ["items"], items: [{ sourceIndex: null, azureDescription: "fake" }] }).items?.[0]?.azureDescription, null);
});

test("frozen builder and parser match the pinned production request and response", async () => {
  const recording = await syntheticRecording();
  const items = [{ id: "0", originalText: "MILK", taxable: null }];
  const context = { merchant: "TEST ONLY SHOP", currency: "CAD", text: synthetic.content };
  assert.deepEqual(buildReceiptNameRequest(items, { ...config, apiKey: "never-recorded" }, context), recording.input);
  assert.deepEqual(parseReceiptNameResponse(items, syntheticResponse, context), [{ id: "0", name: "Milk", taxable: false }]);
  assert.equal(JSON.stringify(recording).includes("never-recorded"), false);
  assert.throws(() => parseReceiptNameResponse([{ ...items[0]!, id: "different" }], syntheticResponse, context), /mismatched item IDs/);
});

test("baseline replay uses production parser, preserves printed evidence, and is deterministic offline", async () => {
  const recording = await syntheticRecording();
  await offline(async () => {
    const a = await invokeAdapter(baselineAdapter, synthetic, recording);
    const b = await invokeAdapter(baselineAdapter, synthetic, recording);
    assert.deepEqual(a, b);
    assert.equal(a.complete, true);
    assert.equal(a.prediction.items?.[0]?.description, "MILK");
    assert.equal(a.prediction.items?.[0]?.linePrice, 200);
    assert.equal(a.prediction.items?.[0]?.unitPrice, 200);
    assert.equal(a.prediction.items?.[0]?.productCode, "TEST-1");
    assert.equal(a.prediction.items?.[0]?.taxable, false);
    const absent = await invokeAdapter(baselineAdapter, synthetic, null);
    assert.equal(absent.complete, false);
    assert.equal(absent.prediction.supportedFields.includes("taxability"), false);
    assert.throws(() => fetch("https://must-not-connect.invalid"), /Network access is disabled/);
  });
});

test("timeout, error, malformed model output replay production fallback; drift never silently falls back", async () => {
  const recording = await syntheticRecording();
  for (const outcome of [{ kind: "timeout" as const }, { kind: "error" as const, message: "recorded failure" }, { kind: "result" as const, value: { output: [] } }]) {
    const run = await invokeAdapter(baselineAdapter, synthetic, { ...recording, outcome });
    assert.equal(run.complete, true);
    assert.equal(run.prediction.items?.[0]?.taxable, true);
  }
  const stale = { ...recording, input: { stale: true }, inputSha256: inputHash({ stale: true }) };
  await assert.rejects(invokeAdapter(baselineAdapter, synthetic, stale), /input drift/);
  await assert.rejects(invokeAdapter(baselineAdapter, synthetic, { ...recording, version: "wrong" }), /version/);
  await assert.rejects(invokeAdapter(baselineAdapter, synthetic, { ...recording, config: { model: "bad" } }));
});

test("recordings bind image/config/raw shape and validate complete hashed input and ID correlation", async () => {
  const digest = "a".repeat(64);
  const envelope = { schemaVersion: 1, imageSha256: digest, request: AZURE_CONFIGS.default, analyzeResult: synthetic };
  assert.deepEqual(validateAzureRecording(envelope, digest, "default"), synthetic);
  assert.throws(() => validateAzureRecording(envelope, "b".repeat(64), "default"), /imageSha256/);
  assert.throws(() => validateAzureRecording(envelope, digest, "locale-en"), /configurations/);
  assert.throws(() => validateAzureRecording({ ...envelope, analyzeResult: { analyzeResult: synthetic } }, digest, "default"));
  const recording = await syntheticRecording();
  assert.deepEqual(validateModelRecording(recording), recording);
  assert.throws(() => validateModelRecording({ ...recording, inputSha256: "0".repeat(64) }), /inputSha256/);
  assert.throws(() => validateModelRecording({ ...recording, itemIds: ["a", "a"] }), /Duplicate/);
  assert.deepEqual(recordedItemIds({ ...recording, itemIds: ["old-uuid"] }, 1), ["old-uuid"]);
  assert.throws(() => recordedItemIds({ ...recording, itemIds: ["old-uuid"] }, 2), /count/);
  assert.throws(() => replayModel(recording, recording.input, { version: recording.version, config: { ...config, model: "changed" } }), /config drift/);
  assert.equal(canonicalJson({ z: 1, a: { b: 2, a: 0 } }), '{"a":{"a":0,"b":2},"z":1}');
});

async function testDataset() {
  const directory = await mkdtemp(resolve(tmpdir(), "receipt-benchmark-test-"));
  const corpus = resolve(directory, "receipts", "synthetic");
  await mkdir(corpus, { recursive: true });
  const bytes = Buffer.from("explicit synthetic TEST ONLY image bytes");
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");
  const recording = await syntheticRecording();
  const candidate = await candidateRecorder.record({ analysis: synthetic,
    env: { RECEIPT_NAME_BASE_URL: config.baseURL, RECEIPT_NAME_MODEL: config.model, RECEIPT_NAME_API_KEY: "fake-test-key" },
    request: async (_url, init) => {
      const input = JSON.parse(String(init?.body));
      const evidence = JSON.parse(input.input.slice(input.input.indexOf("{")));
      return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ items: evidence.items.map((item: { id: string }) => ({ id: item.id, name: "Milk", taxable: false })) }) }] }] });
    } });
  const candidateRecording = { ...candidate, schemaVersion: 1, version: CANDIDATE_MODEL_VERSION, inputSha256: inputHash(candidate.input) };
  const manifest = [];
  for (let i = 0; i < 20; i++) {
    const id = `test-${i}`;
    manifest.push({ id, image: `${id}.png`, groundTruth: `${id}.json`, imageSha256 });
    await writeFile(resolve(corpus, `${id}.png`), bytes);
    await json(resolve(corpus, `${id}.json`), { schemaVersion: 1, id, merchant: "TEST ONLY SHOP", currency: "CAD", items: [{ id: "item-1", description: "MILK", productCode: "TEST-1", quantity: "1", unit: null, unitPrice: 200, linePrice: 200, ownDiscount: 0 }], receiptDiscounts: [], subtotal: 200, subtotalBasis: "printed", taxLines: null, taxTotal: null, taxMode: "exclusive", charges: [], rounding: null, total: 200, taxability: [{ itemId: "item-1", taxable: false }] });
    const dir = resolve(directory, "recordings", id);
    await mkdir(dir, { recursive: true });
    for (const [name, request] of Object.entries(AZURE_CONFIGS)) {
      await json(resolve(dir, `${name}.json`), { schemaVersion: 1, imageSha256, request, analyzeResult: synthetic });
      await json(resolve(dir, `${name}.model.baseline.json`), recording);
      await json(resolve(dir, `${name}.model.candidate.json`), recording);
      await json(resolve(dir, `${name}.model.two-stage.json`), candidateRecording);
    }
  }
  await json(resolve(corpus, "manifest.json"), manifest);
  const plugin = resolve(directory, "candidate.mjs");
  const baselineUrl = pathToFileURL(resolve(root, "baseline.ts")).href;
  await writeFile(plugin, `import baseline from ${JSON.stringify(baselineUrl)}; export default {...baseline,id:'candidate'};`);
  return { directory, plugin, baselineUrl };
}

test("CLI public20 x3 candidate gate passes, detects local field regressions, and cannot substitute missing config", async () => {
  const { directory, plugin, baselineUrl } = await testDataset();
  try {
    const good = cli(["--root", directory, "--candidate", plugin, "--json"]);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(JSON.parse(good.stdout).gate.status, "pass");
    await writeFile(plugin, `import baseline from ${JSON.stringify(baselineUrl)}; export default {...baseline,id:'candidate',async run(input){const p=await baseline.run(input);return {...p,total:p.total+1}}};`);
    const bad = cli(["--root", directory, "--candidate", plugin, "--json", "--allow-incomplete"]);
    assert.equal(bad.status, 1, bad.stderr);
    assert.ok(JSON.parse(bad.stdout).gate.regressions.some((r: { field: string }) => r.field === "total"));
    await writeFile(plugin, `import baseline from ${JSON.stringify(baselineUrl)}; export default {...baseline,id:'candidate'};`);
    await rm(resolve(directory, "recordings/test-0/locale-en.json"));
    const absent = cli(["--root", directory, "--candidate", plugin, "--json"]);
    assert.equal(absent.status, 2, absent.stderr);
    assert.deepEqual(JSON.parse(absent.stdout).coverage.missingAzure, ["test-0/locale-en"]);
    await writeFile(resolve(directory, "recordings/test-0/locale-en.json"), "{malformed");
    const malformed = cli(["--root", directory, "--candidate", plugin, "--json"]);
    assert.equal(malformed.status, 2);
    assert.equal(JSON.parse(malformed.stdout).public.receipts.find((r: { id: string; config: string }) => r.id === "test-0" && r.config === "locale-en").azure, "invalid");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("default CLI compares the actual built-in candidate across all synthetic20 x3 cases and rejects absent model coverage", async () => {
  const { directory } = await testDataset();
  try {
    const result = cli(["--root", directory, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.candidateId, "two-stage");
    assert.equal(report.mode, "candidate-comparison");
    assert.equal(report.coverage.completePairs, 60);
    assert.equal(report.gate.status, "pass");
    await rm(resolve(directory, "recordings/test-0/default.model.two-stage.json"));
    const missing = cli(["--root", directory, "--json"]);
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stdout).coverage.completePairs, 59);
    assert.deepEqual(JSON.parse(missing.stdout).coverage.missingCandidateModel, ["test-0/default"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("default one-command diagnostic reports useful legacy11 and all60 missing recordings, not pass", async () => {
  const report = await runBenchmark({ root });
  assert.equal(report.gate.status, "incomplete");
  assert.equal(report.mode, "candidate-comparison");
  assert.equal(report.candidateId, "two-stage");
  // The default genuinely executes #52, rather than relabelling a frozen self-comparison.
  const discounted = report.legacy.receipts.find((row) => row.id === "sroie-001")!;
  assert.notDeepEqual(discounted.candidate.score, discounted.baseline.score);
  assert.equal(report.coverage.publicReceipts, 20);
  assert.equal(report.coverage.missingAzure.length, 60);
  assert.equal(report.coverage.legacyReceipts, 11);
  assert.ok(report.legacy.baseline.scored > 0);
  assert.equal(report.legacy.receipts.filter((r) => r.errors.length).length, 0);
  const process = cli(["--allow-incomplete"]);
  assert.equal(process.status, 0, process.stderr);
  assert.match(process.stdout, /Gate: INCOMPLETE/);
  assert.match(process.stdout, /Missing public Azure recordings \(60\)/);
  assert.match(process.stdout, /sroie-001/);
});
