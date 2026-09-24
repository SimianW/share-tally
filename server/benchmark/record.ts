import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { AnalyzeResult } from "../src/azure-receipt.js";
import { baselineAdapter, BASELINE_MODEL_VERSION } from "./baseline.js";
import { loadDataset } from "./dataset.js";
import { analyzeAzureImage, type Wait } from "./recording-provider.js";
import { AZURE_CONFIGS, inputHash, readJson, validateAzureRecording, validateModelRecording, type AzureConfig, type ModelRecording, type ModelOutcome } from "./recordings.js";
import { mapAzureAnalysis } from "./frozen-baseline/azure-receipt.js";
import { processReceipt } from "./frozen-baseline/receipt-processing.js";
import { buildReceiptNameRequest, parseReceiptNameResponse, receiptNameConfig } from "./frozen-baseline/receipt-names.js";

/** Trusted local candidate recorder; it must record its real model request and raw outcome. */
export interface CandidateRecorder {
  id: string;
  version: string;
  record(args: { analysis: AnalyzeResult; env: NodeJS.ProcessEnv; request: typeof fetch }): Promise<{
    config: Record<string, unknown>; input: unknown; itemIds?: string[]; outcome: ModelOutcome;
  }>;
}
export interface RecordOptions {
  root: string;
  recordings?: string;
  receipt?: string;
  config?: AzureConfig;
  confirmPaidRequests: boolean;
  overwrite?: boolean;
  azureOnly?: boolean;
  candidateRecorder?: CandidateRecorder;
  env?: NodeJS.ProcessEnv;
  request?: typeof fetch;
  wait?: Wait;
}

const safeId = /^[a-zA-Z0-9_-]+$/;
const credentialKey = /^(?:authorization|proxy-authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|ocp-apim-subscription-key)$/i;
function assertSafeToSave(value: unknown, env: NodeJS.ProcessEnv) {
  const secretValues = [env.AZURE_DOCUMENT_INTELLIGENCE_KEY, env.RECEIPT_NAME_API_KEY, env.OPENAI_API_KEY]
    .filter((secret): secret is string => typeof secret === "string" && secret.length > 0);
  function walk(node: unknown): void {
    if (typeof node === "string") {
      if (secretValues.some((secret) => node.includes(secret))) throw new Error("Recording contains a configured credential; refusing to save.");
      // Signed source URLs, URL userinfo and query tokens do not belong in a
      // committed model request or recording configuration.
      for (const match of node.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
        let url: URL;
        try { url = new URL(match[0]); } catch { continue; }
        if (url.username || url.password || url.search || url.hash)
          throw new Error("Recording contains a URL with credentials, query parameters or fragment; refusing to save.");
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") for (const [key, child] of Object.entries(node)) {
      if (credentialKey.test(key)) throw new Error("Recording contains a credential field; refusing to save.");
      walk(child);
    }
  }
  walk(value);
}
async function saveRecording(path: string, value: unknown, overwrite: boolean, env: NodeJS.ProcessEnv) {
  assertSafeToSave(value, env);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  try {
    if (overwrite) await rename(temporary, path);
    else await link(temporary, path); // Atomic no-clobber even if a second recorder races us.
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
async function imageFor(root: string, id: string): Promise<Buffer> {
  const receipts = resolve(root, "receipts");
  for (const dir of await readdir(receipts, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name === "owner-slots") continue;
    const manifest = await readJson(resolve(receipts, dir.name, "manifest.json"));
    if (!Array.isArray(manifest)) throw new Error("Invalid public manifest.");
    for (const entry of manifest) {
      if (entry?.id !== id) continue;
      if (typeof entry.image !== "string" || basename(entry.image) !== entry.image || !entry.image.endsWith(".png"))
        throw new Error("Public image must be a committed PNG in its manifest directory.");
      const imagePath = resolve(receipts, dir.name, entry.image);
      if (!(await lstat(imagePath)).isFile()) throw new Error("Public image must be a regular committed PNG.");
      const bytes = await readFile(imagePath);
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error("Public image is not a PNG.");
      return bytes;
    }
  }
  throw new Error(`No public image for ${id}.`);
}
function timeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
async function recordBaseline(analysis: AnalyzeResult, env: NodeJS.ProcessEnv, request: typeof fetch): Promise<ModelRecording | null> {
  const { baseURL, model, apiKey } = receiptNameConfig(env);
  const config = { baseURL, model };
  const scanned = mapAzureAnalysis(analysis);
  let recording: ModelRecording | null = null;
  await processReceipt(scanned, async (items, _unusedConfig, _unusedRequest, context) => {
    if (!items.length) return [];
    const input = buildReceiptNameRequest(items, { ...config, apiKey }, context);
    const itemIds = items.map((item) => item.id);
    let outcome: ModelOutcome;
    let raw: unknown;
    try {
      const response = await request(`${baseURL}/responses`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Provider returned non-success status.");
      raw = await response.json();
      outcome = { kind: "result", value: raw as ModelRecording["input"] };
    } catch (error) {
      // Do not persist provider error bodies, URLs, headers or exception messages.
      outcome = timeout(error) ? { kind: "timeout" } : { kind: "error", message: "Model request failed." };
    }
    recording = { schemaVersion: 1, version: BASELINE_MODEL_VERSION, config, input,
      inputSha256: inputHash(input), itemIds, outcome };
    if (outcome.kind !== "result") throw new Error("Model request failed.");
    // Parse after recording: even an invalid response is a real response and must
    // replay through production's normal fallback, not be replaced by a fake result.
    return parseReceiptNameResponse(items, raw, context);
  });
  return recording;
}

/** No paid traffic is possible without the explicit opt-in, including when called as a library. */
export async function recordBenchmark(options: RecordOptions): Promise<string[]> {
  if (!options.confirmPaidRequests) throw new Error("Live paid requests require --confirm-paid-requests.");
  if (options.receipt && !safeId.test(options.receipt)) throw new Error("Invalid receipt ID.");
  if (options.config && !Object.hasOwn(AZURE_CONFIGS, options.config)) throw new Error("Unknown Azure configuration.");
  const candidate = options.candidateRecorder;
  if (candidate && (!safeId.test(candidate.id) || candidate.id === baselineAdapter.id || !candidate.version || typeof candidate.record !== "function"))
    throw new Error("Candidate recorder needs a distinct filename-safe id, version and record function.");
  const env = options.env ?? process.env;
  // Validate required credentials before any paid call, not after a successful Azure charge.
  if (!options.azureOnly) receiptNameConfig(env);
  const request = options.request ?? fetch;
  const { publicEntries } = await loadDataset(options.root);
  if (options.receipt && !publicEntries.some((entry) => entry.id === options.receipt)) throw new Error("Unknown public receipt ID.");
  const selected = publicEntries.filter((entry) => !options.receipt || entry.id === options.receipt);
  const configs = options.config ? [options.config] : Object.keys(AZURE_CONFIGS) as AzureConfig[];
  const recordingRoot = options.recordings ?? resolve(options.root, "recordings");
  const written: string[] = [];
  for (const entry of selected) for (const config of configs) {
    const dir = resolve(recordingRoot, entry.id);
    const azurePath = resolve(dir, `${config}.json`);
    const existing = await readJson(azurePath);
    let analysis: AnalyzeResult;
    if (existing !== null && !options.overwrite) {
      analysis = validateAzureRecording(existing, entry.imageSha256!, config);
    } else {
      if (!env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || !env.AZURE_DOCUMENT_INTELLIGENCE_KEY)
        throw new Error("Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.");
      const image = await imageFor(options.root, entry.id);
      if (createHash("sha256").update(image).digest("hex") !== entry.imageSha256) throw new Error("Committed image SHA-256 changed.");
      analysis = await analyzeAzureImage(image, config, env, request, options.wait);
      const envelope = { schemaVersion: 1, imageSha256: entry.imageSha256!, request: AZURE_CONFIGS[config], analyzeResult: analysis };
      validateAzureRecording(envelope, entry.imageSha256!, config);
      await saveRecording(azurePath, envelope, !!options.overwrite, env);
      written.push(azurePath);
    }
    if (options.azureOnly) continue;
    const modelPath = resolve(dir, `${config}.model.${baselineAdapter.id}.json`);
    const modelExisting = await readJson(modelPath);
    if (modelExisting !== null && !options.overwrite) {
      const parsed = validateModelRecording(modelExisting);
      if (parsed.version !== BASELINE_MODEL_VERSION) throw new Error("Existing baseline version differs; use --overwrite to replace.");
      const { baseURL, model, apiKey } = receiptNameConfig(env);
      if (!isDeepStrictEqual(parsed.config, { baseURL, model })) throw new Error("Existing baseline model configuration differs; use --overwrite to replace.");
      let expectedInput: unknown;
      let expectedItemIds: string[] = [];
      await processReceipt(mapAzureAnalysis(analysis), async (items, _config, _request, context) => {
        expectedInput = buildReceiptNameRequest(items, { baseURL, model, apiKey }, context);
        expectedItemIds = items.map((item) => item.id);
        return [];
      });
      if (expectedInput === undefined || inputHash(expectedInput) !== parsed.inputSha256 || !isDeepStrictEqual(parsed.itemIds, expectedItemIds))
        throw new Error("Existing baseline model input differs from this Azure recording; use --overwrite to replace.");
    } else {
      const baseline = await recordBaseline(analysis, env, request);
      if (!baseline) throw new Error(`No baseline model request for ${entry.id}/${config}; no response was fabricated.`);
      validateModelRecording(baseline);
      await saveRecording(modelPath, baseline, !!options.overwrite, env);
      written.push(modelPath);
    }
    if (candidate) {
      const path = resolve(dir, `${config}.model.${candidate.id}.json`);
      const candidateExisting = await readJson(path);
      if (candidateExisting !== null && !options.overwrite) {
        const parsed = validateModelRecording(candidateExisting);
        if (parsed.version !== candidate.version) throw new Error("Existing candidate version differs; use --overwrite to replace.");
      } else {
        const recorded = await candidate.record({ analysis: structuredClone(analysis), env, request });
        const envelope: ModelRecording = { schemaVersion: 1, version: candidate.version,
          config: recorded.config, input: recorded.input as ModelRecording["input"], inputSha256: inputHash(recorded.input),
          ...(recorded.itemIds ? { itemIds: recorded.itemIds } : {}), outcome: recorded.outcome };
        validateModelRecording(envelope);
        if (isDeepStrictEqual(envelope.config, {}) && envelope.input == null) throw new Error("Candidate recorder supplied no request.");
        await saveRecording(path, envelope, !!options.overwrite, env);
        written.push(path);
      }
    }
  }
  return written;
}

const usage = `OWNER-ONLY live recording (paid API traffic):\n  pnpm --dir server benchmark:record --confirm-paid-requests [--receipt ID] [--config default|locale-en|ocr-high-resolution] [--candidate-recorder PATH] [--azure-only] [--overwrite]\nWithout --azure-only, records baseline model requests too. Existing valid recordings are reused; --overwrite replaces them. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, AZURE_DOCUMENT_INTELLIGENCE_KEY, RECEIPT_NAME_BASE_URL (optional), RECEIPT_NAME_API_KEY (or OPENAI_API_KEY for default endpoint), RECEIPT_NAME_MODEL in the environment.\n`;
async function main(args: string[]) {
  if (args.includes("--help") || args.includes("-h")) { process.stdout.write(usage); return; }
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!["--confirm-paid-requests", "--overwrite", "--azure-only", "--receipt", "--config", "--candidate-recorder"].includes(flag) || flag in parsed) throw new Error(`Unknown or repeated argument ${flag}.\n${usage}`);
    if (["--receipt", "--config", "--candidate-recorder"].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
      parsed[flag] = value;
    } else parsed[flag] = true;
  }
  if (!parsed["--confirm-paid-requests"]) throw new Error("Live paid requests require --confirm-paid-requests.");
  if (parsed["--azure-only"] && parsed["--candidate-recorder"]) throw new Error("--azure-only cannot be combined with --candidate-recorder.");
  const candidatePath = parsed["--candidate-recorder"];
  const candidateRecorder = candidatePath ? (await import(pathToFileURL(resolve(String(candidatePath))).href) as { default?: CandidateRecorder }).default : undefined;
  if (candidatePath && !candidateRecorder) throw new Error("Candidate recorder module must export default CandidateRecorder.");
  const written = await recordBenchmark({ root: dirname(fileURLToPath(import.meta.url)),
    confirmPaidRequests: true, receipt: parsed["--receipt"] as string | undefined,
    config: parsed["--config"] as AzureConfig | undefined, overwrite: !!parsed["--overwrite"],
    azureOnly: !!parsed["--azure-only"], candidateRecorder });
  for (const path of written) process.stdout.write(`Recorded ${path}\n`);
  process.stdout.write(`Finished: ${written.length} new recording(s).\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((error) => { console.error(error instanceof Error ? error.message : "Recording failed."); process.exitCode = 1; });
