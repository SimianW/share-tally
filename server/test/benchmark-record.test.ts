import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { recordBenchmark, type CandidateRecorder } from "../benchmark/record.js";
import { AZURE_CONFIGS, inputHash, validateAzureRecording, validateModelRecording } from "../benchmark/recordings.js";
import { loadDataset } from "../benchmark/dataset.js";
import { candidateAdapter, CANDIDATE_MODEL_VERSION } from "../benchmark/candidate.js";
import { invokeAdapter } from "../benchmark/adapter.js";
import { baselineAdapter, BASELINE_MODEL_VERSION } from "../benchmark/baseline.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../benchmark");
const env = {
  AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: "https://azure.example.test",
  AZURE_DOCUMENT_INTELLIGENCE_KEY: "fake-azure-key",
  RECEIPT_NAME_BASE_URL: "https://models.example.test/v1",
  RECEIPT_NAME_API_KEY: "fake-model-key",
  RECEIPT_NAME_MODEL: "test-model-v1",
};
const analysis = {
  apiVersion: "2024-11-30", modelId: "prebuilt-receipt", content: "SHOP\nMILK 2.00\nTOTAL 2.00",
  documents: [{ fields: {
    MerchantName: { valueString: "SHOP" }, Total: { valueCurrency: { amount: 2 } },
    Items: { valueArray: [{ content: "MILK 2.00", valueObject: {
      Description: { valueString: "MILK" }, TotalPrice: { valueCurrency: { amount: 2 } },
    } }] },
  } }],
  pages: [{ pageNumber: 1 }], extraRealProviderField: { locations: [1, 2, 3] },
};
const modelResponse = { id: "response-test", output: [{ content: [{ type: "output_text", text: JSON.stringify({ items: [{ id: "0", name: "Milk", taxable: null }] }) }] }], usage: { input_tokens: 1 } };
const wait = async () => {};
function mockRequest(log: { url: string; init?: RequestInit }[], response: unknown = modelResponse, error?: Error): typeof fetch {
  return (async (url: URL | RequestInfo, init?: RequestInit) => {
    const href = String(url);
    log.push({ url: href, init });
    if (href.includes(":analyze")) return new Response(null, { status: 202, headers: { "operation-location": "https://azure.example.test/documentintelligence/documentModels/prebuilt-receipt/analyzeResults/test", "retry-after": "1" } });
    if (href.includes("analyzeResults")) return Response.json({ status: "succeeded", analyzeResult: analysis });
    if (error) throw error;
    return Response.json(response);
  }) as typeof fetch;
}
async function fixture() {
  const { publicEntries } = await loadDataset(root);
  const entry = publicEntries[0]!;
  const recordings = await mkdtemp(resolve(tmpdir(), "share-tally-record-test-"));
  return { entry, recordings, cleanup: () => rm(recordings, { recursive: true, force: true }) };
}

test("CLI and library refuse paid requests without explicit opt-in, before network", async () => {
  let called = false;
  await assert.rejects(recordBenchmark({ root, confirmPaidRequests: false, request: (async () => { called = true; throw Error("network"); }) as typeof fetch }), /confirm-paid-requests/);
  assert.equal(called, false);
  const server = resolve(root, "..");
  const result = spawnSync(process.execPath, ["--import=tsx", "benchmark/record.ts", "--receipt", "no-such-receipt"], { cwd: server, env: { ...process.env, ...env }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /confirm-paid-requests/);
  const { entry, recordings, cleanup } = await fixture();
  try {
    await assert.rejects(recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true,
      env: { ...env, RECEIPT_NAME_API_KEY: undefined }, request: (async () => { called = true; throw Error("network"); }) as typeof fetch }), /RECEIPT_NAME_API_KEY/);
    assert.equal(called, false);
    const isolatedEnv = { ...process.env };
    delete isolatedEnv.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    delete isolatedEnv.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    delete isolatedEnv.RECEIPT_NAME_API_KEY;
    delete isolatedEnv.RECEIPT_NAME_MODEL;
    delete isolatedEnv.OPENAI_API_KEY;
    const cli = spawnSync(process.execPath, ["--import=tsx", "benchmark/record.ts", "--confirm-paid-requests", "--receipt", entry.id],
      { cwd: server, env: isolatedEnv, encoding: "utf8" });
    assert.notEqual(cli.status, 0);
    assert.match(cli.stderr, /RECEIPT_NAME_API_KEY/);
  } finally { await cleanup(); }
});

test("records all three real Azure request configurations, SHA and exact frozen baseline model payload", async () => {
  const { entry, recordings, cleanup } = await fixture();
  try {
    const calls: { url: string; init?: RequestInit }[] = [];
    const written = await recordBenchmark({ root, recordings, receipt: entry.id, confirmPaidRequests: true, env, request: mockRequest(calls), wait });
    assert.equal(written.length, 9);
    const azureRequests = calls.filter((call) => call.url.includes(":analyze"));
    assert.equal(azureRequests.length, 3);
    for (const [config, options] of Object.entries(AZURE_CONFIGS)) {
      const azureRequest = azureRequests.find(({ url }) => url.includes(`api-version=${options.apiVersion}`) &&
        (config === "locale-en" ? url.includes("locale=en") : config === "ocr-high-resolution" ? url.includes("features=ocrHighResolution") : !url.includes("locale=") && !url.includes("features=")));
      assert.ok(azureRequest, `missing ${config}`);
      assert.equal((azureRequest.init?.headers as Record<string, string>)["Content-Type"], "image/png");
      assert.equal(createHash("sha256").update(azureRequest.init?.body as Uint8Array).digest("hex"), entry.imageSha256);
      const azure = JSON.parse(await readFile(resolve(recordings, entry.id, `${config}.json`), "utf8"));
      assert.deepEqual(azure.analyzeResult, analysis);
      assert.deepEqual(azure.request, options);
      validateAzureRecording(azure, entry.imageSha256!, config as keyof typeof AZURE_CONFIGS);
      const model = validateModelRecording(JSON.parse(await readFile(resolve(recordings, entry.id, `${config}.model.baseline.json`), "utf8")));
      assert.equal(model.version, BASELINE_MODEL_VERSION);
      assert.deepEqual(model.config, { baseURL: env.RECEIPT_NAME_BASE_URL, model: env.RECEIPT_NAME_MODEL });
      assert.equal(model.inputSha256, inputHash(model.input));
      assert.deepEqual(model.itemIds, ["0"]);
      assert.deepEqual(model.outcome, { kind: "result", value: modelResponse });
      assert.ok(!JSON.stringify(model).includes(env.RECEIPT_NAME_API_KEY));
      assert.ok(!JSON.stringify(azure).includes(env.AZURE_DOCUMENT_INTELLIGENCE_KEY));
      const modelCall = calls.find((call) => call.url === `${env.RECEIPT_NAME_BASE_URL}/responses` && JSON.stringify(model.input) === call.init?.body);
      assert.ok(modelCall, "recorded exact HTTP body, not a synthetic reconstruction");
      const candidate = validateModelRecording(JSON.parse(await readFile(resolve(recordings, entry.id, `${config}.model.two-stage.json`), "utf8")));
      assert.equal(candidate.version, CANDIDATE_MODEL_VERSION);
      assert.equal(candidate.itemIds?.length, 1);
      assert.ok(calls.some((call) => call.init?.body === JSON.stringify(candidate.input)));
      assert.deepEqual(candidate.outcome, { kind: "result", value: modelResponse });
      assert.equal((await invokeAdapter(candidateAdapter, analysis, candidate)).complete, true);
    }
    const callsBeforeResume = calls.length;
    assert.deepEqual(await recordBenchmark({ root, recordings, receipt: entry.id, confirmPaidRequests: true, env, request: mockRequest(calls), wait }), []);
    assert.equal(calls.length, callsBeforeResume);
    await assert.rejects(recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true,
      env: { ...env, RECEIPT_NAME_MODEL: "different-model" }, request: mockRequest(calls), wait }), /configuration differs/);
    const modelPath = resolve(recordings, entry.id, "default.model.baseline.json");
    const savedModel = await readFile(modelPath, "utf8");
    const drifted = JSON.parse(savedModel);
    drifted.input.model = "different-model";
    drifted.inputSha256 = inputHash(drifted.input);
    await writeFile(modelPath, `${JSON.stringify(drifted)}\n`);
    await assert.rejects(recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true,
      env, request: mockRequest(calls), wait }), /input differs/);
    await writeFile(modelPath, savedModel);
    assert.equal(calls.length, callsBeforeResume);
    const candidatePath = resolve(recordings, entry.id, "default.model.two-stage.json");
    const savedCandidate = await readFile(candidatePath, "utf8");
    for (const change of [
      (value: { version: string; config: { model: string }; input: { model: string }; inputSha256: string }) => { value.version = "stale"; },
      (value: { version: string; config: { model: string }; input: { model: string }; inputSha256: string }) => { value.config.model = "other"; },
      (value: { version: string; config: { model: string }; input: { model: string }; inputSha256: string }) => { value.input.model = "stale"; value.inputSha256 = inputHash(value.input); },
    ]) {
      const value = JSON.parse(savedCandidate); change(value);
      await writeFile(candidatePath, JSON.stringify(value));
      await assert.rejects(recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true,
        env, request: mockRequest(calls), wait }), /version|configuration|input drift/i);
    }
    await writeFile(candidatePath, savedCandidate);
    assert.equal(calls.length, callsBeforeResume);
    await writeFile(resolve(recordings, entry.id, "default.json"), "{}\n");
    await assert.rejects(recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true, env, request: mockRequest(calls), wait }), /invalid|expected|schema|imageSha256|request|documents/i);
    const overwrite = await recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true, overwrite: true, env, request: mockRequest(calls), wait });
    assert.equal(overwrite.length, 3);
  } finally { await cleanup(); }
});

test("preserves successful Azure recording if model times out and can add candidate version separately", async () => {
  const { entry, recordings, cleanup } = await fixture();
  try {
    const calls: { url: string; init?: RequestInit }[] = [];
    await recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true, env, request: mockRequest(calls, modelResponse, Object.assign(new Error("private provider details"), { name: "TimeoutError" })), wait });
    const azure = JSON.parse(await readFile(resolve(recordings, entry.id, "default.json"), "utf8"));
    validateAzureRecording(azure, entry.imageSha256!, "default");
    const timedOut = validateModelRecording(JSON.parse(await readFile(resolve(recordings, entry.id, "default.model.baseline.json"), "utf8")));
    assert.deepEqual(timedOut.outcome, { kind: "timeout" });
    assert.ok(!JSON.stringify(timedOut).includes("private provider details"));
    const candidate: CandidateRecorder = { id: "candidate", version: "candidate-v2", async record({ analysis: received }) {
      assert.deepEqual(received, analysis);
      return { config: { model: "candidate-v2" }, input: { prompt: "actual request" }, itemIds: ["0"], outcome: { kind: "result", value: { output: "candidate response" } } };
    } };
    const before = calls.length;
    const written = await recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true, env, request: mockRequest(calls), candidateRecorder: candidate, wait });
    assert.equal(calls.length, before);
    assert.equal(written.length, 1);
    const recorded = validateModelRecording(JSON.parse(await readFile(resolve(recordings, entry.id, "default.model.candidate.json"), "utf8")));
    assert.equal(recorded.version, "candidate-v2");
    assert.deepEqual(recorded.outcome, { kind: "result", value: { output: "candidate response" } });
    assert.equal(timedOut.version, BASELINE_MODEL_VERSION);
  } finally { await cleanup(); }
});

test("explicit Azure-only mode records no fabricated model response", async () => {
  const { entry, recordings, cleanup } = await fixture();
  try {
    const calls: { url: string; init?: RequestInit }[] = [];
    const written = await recordBenchmark({ root, recordings, receipt: entry.id, config: "locale-en", confirmPaidRequests: true,
      azureOnly: true, env: { ...env, RECEIPT_NAME_API_KEY: undefined }, request: mockRequest(calls), wait });
    assert.deepEqual(written, [resolve(recordings, entry.id, "locale-en.json")]);
    assert.equal(calls.filter(({ url }) => url.includes("/responses")).length, 0);
    await assert.rejects(readFile(resolve(recordings, entry.id, "locale-en.model.baseline.json"), "utf8"), { code: "ENOENT" });
  } finally { await cleanup(); }
});

test("JSON null recordings are malformed, not absent, even with allow-incomplete", async () => {
  const { entry, recordings, cleanup } = await fixture();
  try {
    const calls: { url: string; init?: RequestInit }[] = [];
    await recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true,
      env, request: mockRequest(calls), wait });
    const before = calls.length;
    for (const filename of ["default.json", "default.model.baseline.json"]) {
      const path = resolve(recordings, entry.id, filename);
      const saved = await readFile(path, "utf8");
      await writeFile(path, "null\n");
      const cli = spawnSync(process.execPath, ["--import=tsx", "benchmark/cli.ts", "--recordings", recordings, "--allow-incomplete", "--json"],
        { cwd: resolve(root, ".."), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
      assert.equal(cli.status, 2, `${filename} must not be accepted as missing coverage`);
      const report = JSON.parse(cli.stdout);
      assert.ok(report.public.receipts.some((row: { errors: string[] }) => row.errors.some((error) => error.includes("JSON null"))));
      await assert.rejects(recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true,
        env, request: mockRequest(calls), wait }), /JSON null/);
      assert.equal(calls.length, before, "malformed existing files must fail without making paid replacement calls");
      await writeFile(path, saved);
    }
  } finally { await cleanup(); }
});

test("sanitizes model errors and refuses secret-bearing candidate recordings", async () => {
  const { entry, recordings, cleanup } = await fixture();
  try {
    const calls: { url: string; init?: RequestInit }[] = [];
    await recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true, env, request: mockRequest(calls, modelResponse, new Error("Bearer private provider details")), wait });
    const model = validateModelRecording(JSON.parse(await readFile(resolve(recordings, entry.id, "default.model.baseline.json"), "utf8")));
    assert.deepEqual(model.outcome, { kind: "error", message: "Model request failed." });
    const unsafe: CandidateRecorder = { id: "candidate", version: "v1", async record() {
      return { config: { Authorization: "Bearer private" }, input: { body: "ok" }, outcome: { kind: "result", value: {} } };
    } };
    await assert.rejects(recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true, env, request: mockRequest(calls), candidateRecorder: unsafe, wait }), /credential/);
    await assert.rejects(readFile(resolve(recordings, entry.id, "default.model.candidate.json"), "utf8"), { code: "ENOENT" });
    const signedUrl: CandidateRecorder = { id: "candidate", version: "v1", async record() {
      return { config: { baseURL: "https://models.example.test/v1?token=private" }, input: { body: "ok" }, outcome: { kind: "result", value: {} } };
    } };
    await assert.rejects(recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true,
      env, request: mockRequest(calls), candidateRecorder: signedUrl, wait }), /URL with credentials/);
  } finally { await cleanup(); }
});


test("empty Azure recordings save explicit no-call markers for both pipelines and can resume without model traffic", async () => {
  const { entry, recordings, cleanup } = await fixture();
  const empty = { documents: [{ fields: {} }] };
  let calls = 0;
  const request: typeof fetch = async (url) => {
    calls++;
    if (String(url).includes(":analyze")) return new Response(null, { status: 202, headers: { "operation-location": "https://azure.example.test/documentintelligence/documentModels/prebuilt-receipt/analyzeResults/empty" } });
    if (String(url).includes("analyzeResults")) return Response.json({ status: "succeeded", analyzeResult: empty });
    throw Error("Empty production receipt must not call model");
  };
  try {
    assert.equal((await recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true, env, request, wait })).length, 3);
    assert.equal(calls, 2);
    for (const adapter of [baselineAdapter, candidateAdapter]) {
      const saved = validateModelRecording(JSON.parse(await readFile(resolve(recordings, entry.id, `default.model.${adapter.id}.json`), "utf8")));
      assert.deepEqual(saved.itemIds, []);
      assert.deepEqual(saved.outcome, { kind: "skipped", reason: "no-items" });
      assert.equal((await invokeAdapter(adapter, empty, saved)).complete, true);
    }
    assert.deepEqual(await recordBenchmark({ root, recordings, receipt: entry.id, config: "default", confirmPaidRequests: true, env, request, wait }), []);
    assert.equal(calls, 2);
  } finally { await cleanup(); }
});
