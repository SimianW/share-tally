import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AnalyzeResult } from "../src/azure-receipt.js";
import { invokeAdapter, type BenchmarkAdapter } from "./adapter.js";
import { baselineAdapter, BASELINE_COMMIT } from "./baseline.js";
import { loadDataset, type DatasetEntry } from "./dataset.js";
import { AZURE_CONFIGS, readJson, validateAzureRecording, validateModelRecording, type AzureConfig, type ModelRecording } from "./recordings.js";
import { SUPPORTED_FIELDS, aggregateScores, compareScores, scoreReceipt, type BenchmarkPrediction, type ScoreResult } from "./scorer.js";
import { offline } from "./offline.js";

export interface RunOptions { root: string; recordings?: string; candidate?: string }
interface PipelineResult { score: ScoreResult; complete: boolean; model: "replayed" | "missing" | "not-used"; error?: string }
export interface ReceiptRun { id: string; config: string; azure: "recorded" | "missing" | "legacy" | "invalid"; baseline: PipelineResult; candidate: PipelineResult; errors: string[] }
export async function loadAdapter(path: string): Promise<BenchmarkAdapter> {
  const module = await import(pathToFileURL(resolve(path)).href) as { default?: BenchmarkAdapter; adapter?: BenchmarkAdapter };
  const adapter = module.default ?? module.adapter;
  if (!adapter || !/^[a-zA-Z0-9_-]+$/.test(adapter.id) || typeof adapter.requiresModel !== "boolean" || typeof adapter.run !== "function") throw new Error("Candidate must export default (or adapter) implementing BenchmarkAdapter with filename-safe id, requiresModel and run.");
  return adapter;
}
async function runPipeline(adapter: BenchmarkAdapter, entry: DatasetEntry, analysis: AnalyzeResult | null, modelPath: string): Promise<PipelineResult> {
  if (!analysis) return { score: scoreReceipt(entry.label, null), complete: false, model: "missing" };
  let recording: ModelRecording | null = null;
  try {
    const value = await readJson(modelPath);
    recording = value === null ? null : validateModelRecording(value);
    const result = await invokeAdapter(adapter, analysis, recording);
    // A plugin returning malformed values is a failed run, never an implicit perfect score.
    validatePrediction(result.prediction);
    return { score: scoreReceipt(entry.label, result.prediction), complete: result.complete,
      model: result.replayed ? "replayed" : recording ? "not-used" : "missing" };
  } catch (error) {
    return { score: scoreReceipt(entry.label, null), complete: false, model: recording ? "not-used" : "missing", error: String(error) };
  }
}
function validatePrediction(prediction: BenchmarkPrediction) {
  if (!prediction || !Array.isArray(prediction.supportedFields) || (prediction.items != null && !Array.isArray(prediction.items))) throw new Error("Invalid adapter prediction.");
  const valid = new Set<string>(SUPPORTED_FIELDS);
  if (prediction.supportedFields.some((field) => !valid.has(field))) throw new Error("Unknown supported prediction field.");
  for (const field of ["subtotal", "taxTotal", "rounding", "total"] as const) if (prediction[field] != null && !Number.isSafeInteger(prediction[field])) throw new Error(`Prediction ${field} must use integer minor units.`);
  for (const item of prediction.items ?? []) for (const field of ["unitPrice", "linePrice", "ownDiscount"] as const) if (item[field] != null && !Number.isSafeInteger(item[field])) throw new Error(`Prediction ${field} must use integer minor units.`);
}
export async function runBenchmark(options: RunOptions) {
  return offline(async () => {
    const { publicEntries, legacyEntries } = await loadDataset(options.root);
    const candidate = options.candidate ? await loadAdapter(options.candidate) : baselineAdapter;
    if (options.candidate && candidate.id === baselineAdapter.id) throw new Error("Candidate adapter ID must differ from baseline to keep pipeline recordings separate.");
    const recordingRoot = options.recordings ?? resolve(options.root, "recordings");
    const rows: ReceiptRun[] = [];
    const legacy: ReceiptRun[] = [];
    async function evaluate(entry: DatasetEntry, config: AzureConfig, isLegacy = false) {
      let analysis: AnalyzeResult | null = null;
      let azure: ReceiptRun["azure"] = "missing";
      const errors: string[] = [];
      try {
        const raw = await readJson(isLegacy ? entry.fixture! : resolve(recordingRoot, entry.id, `${config}.json`));
        if (raw !== null) {
          analysis = isLegacy ? raw as AnalyzeResult : validateAzureRecording(raw, entry.imageSha256!, config);
          azure = isLegacy ? "legacy" : "recorded";
        } else if (isLegacy) throw new Error(`Missing committed legacy fixture ${entry.fixture}`);
      } catch (error) { azure = "invalid"; errors.push(String(error)); }
      const baseline = await runPipeline(baselineAdapter, entry, analysis, resolve(recordingRoot, entry.id, `${config}.model.${baselineAdapter.id}.json`));
      const candidateResult = options.candidate ? await runPipeline(candidate, entry, analysis, resolve(recordingRoot, entry.id, `${config}.model.${candidate.id}.json`)) : baseline;
      if (baseline.error) errors.push(`baseline: ${baseline.error}`);
      if (candidateResult.error && candidateResult !== baseline) errors.push(`candidate: ${candidateResult.error}`);
      const row = { id: entry.id, config: isLegacy ? "legacy-unspecified" : config, azure, baseline, candidate: candidateResult, errors };
      (isLegacy ? legacy : rows).push(row);
    }
    for (const entry of publicEntries) for (const config of Object.keys(AZURE_CONFIGS) as AzureConfig[]) await evaluate(entry, config);
    for (const entry of legacyEntries) await evaluate(entry, "default", true);
    const baseline = aggregateScores(rows.map((row) => row.baseline.score));
    const candidateScores = aggregateScores(rows.map((row) => row.candidate.score));
    // Compare only genuine replay pairs. Missing recordings must not masquerade as
    // regressions, improvements, or a successful self-comparison release gate.
    const paired = rows.filter((row) => row.baseline.complete && row.candidate.complete);
    const comparison = compareScores(aggregateScores(paired.map((row) => row.baseline.score)), aggregateScores(paired.map((row) => row.candidate.score)));
    const reasons: string[] = [];
    if (!options.candidate) reasons.push("Baseline self-check only; provide --candidate for a candidate release gate.");
    if (publicEntries.length < 20) reasons.push(`Expected at least 20 release receipts; found ${publicEntries.length}.`);
    if (paired.length !== rows.length) reasons.push(`${rows.length - paired.length}/${rows.length} public receipt/config pairs lack complete baseline and candidate model replay.`);
    if (!rows.length) reasons.push("No public release cases.");
    const status = comparison.status === "regression" ? "regression" : reasons.length || comparison.status === "incomplete" ? "incomplete" : "pass";
    return {
      schemaVersion: 1, mode: options.candidate ? "candidate-comparison" : "baseline-self-check", baselineId: baselineAdapter.id, baselineCommit: BASELINE_COMMIT, candidateId: candidate.id,
      gate: { ...comparison, status, reasons },
      coverage: { publicReceipts: publicEntries.length, requiredAzureRecordings: rows.length, recordedAzure: rows.filter((r) => r.azure === "recorded").length,
        missingAzure: rows.filter((r) => r.azure === "missing").map((r) => `${r.id}/${r.config}`),
        invalidAzure: rows.filter((r) => r.azure === "invalid").map((r) => `${r.id}/${r.config}`),
        baselineModelReplays: rows.filter((r) => r.baseline.complete).length, candidateModelReplays: rows.filter((r) => r.candidate.complete).length,
        missingBaselineModel: rows.filter((r) => r.baseline.model === "missing").map((r) => `${r.id}/${r.config}`),
        missingCandidateModel: rows.filter((r) => r.candidate.model === "missing").map((r) => `${r.id}/${r.config}`),
        completePairs: paired.length, legacyReceipts: legacy.length },
      public: { baseline, candidate: candidateScores, receipts: rows },
      legacy: { diagnosticOnly: true, note: "Legacy fixture request configurations and image provenance are unknown; never included in the public release denominator. Missing model recordings run Azure-only production fallback diagnostics.", baseline: aggregateScores(legacy.map((r) => r.baseline.score)), candidate: aggregateScores(legacy.map((r) => r.candidate.score)), receipts: legacy },
    };
  });
}
export type BenchmarkReport = Awaited<ReturnType<typeof runBenchmark>>;
export function readableReport(report: BenchmarkReport): string {
  const lines = [`Receipt benchmark: ${report.mode}`, `Gate: ${report.gate.status.toUpperCase()}`, ...report.gate.reasons,
    `Public Azure recordings: ${report.coverage.recordedAzure}/${report.coverage.requiredAzureRecordings}; complete model replay pairs: ${report.coverage.completePairs}/${report.coverage.requiredAzureRecordings}`,
    `Legacy diagnostics: ${report.coverage.legacyReceipts} receipts (excluded from release gate).`,
    `Legacy item matching: ${report.legacy.baseline.matching.matched} matched, ${report.legacy.baseline.matching.missing} missing, ${report.legacy.baseline.matching.extra} extra.`,
    `Legacy baseline: ${report.legacy.baseline.correct}/${report.legacy.baseline.scored} field checks; unprinted ${report.legacy.baseline.unprinted}, unsupported ${report.legacy.baseline.unsupported}, missing recording ${report.legacy.baseline.missingRecording}.`,
    "", "Per-field legacy diagnostic accuracy (taxability scored independently):"];
  for (const [field, score] of Object.entries(report.legacy.baseline.fields)) lines.push(`  ${field}: ${score.correct}/${score.scored}; unprinted=${score.unprinted} unsupported=${score.unsupported} missingRecording=${score.missingRecording}`);
  lines.push("", "Per-receipt legacy diagnostics:");
  for (const row of report.legacy.receipts) lines.push(`  ${row.id}: ${row.baseline.score.correct}/${row.baseline.score.scored}; model=${row.baseline.model}${row.errors.length ? `; ${row.errors.join("; ")}` : ""}`);
  lines.push("", "Per-field public scores (baseline -> candidate; missing recordings are not errors):");
  for (const [field, before] of Object.entries(report.public.baseline.fields)) {
    const after = report.public.candidate.fields[field as keyof typeof report.public.candidate.fields];
    lines.push(`  ${field}: ${before.correct}/${before.scored} -> ${after.correct}/${after.scored}; unprinted=${after.unprinted} unsupported=${after.unsupported} missingRecording=${after.missingRecording}`);
  }
  lines.push("", "Recorded public receipt/config scores:");
  for (const row of report.public.receipts.filter((entry) => entry.azure === "recorded")) lines.push(`  ${row.id}/${row.config}: ${row.baseline.score.correct}/${row.baseline.score.scored} -> ${row.candidate.score.correct}/${row.candidate.score.scored}; model=${row.baseline.model}/${row.candidate.model}`);
  lines.push("", `Missing public Azure recordings (${report.coverage.missingAzure.length}):`, ...report.coverage.missingAzure.map((name) => `  ${name}`));
  for (const row of report.public.receipts) for (const error of row.errors) lines.push(`ERROR ${row.id}/${row.config}: ${error}`);
  for (const regression of report.gate.regressions) lines.push(`REGRESSION ${regression.field}: ${regression.baseline} -> ${regression.candidate}`);
  for (const regression of report.gate.receiptRegressions) lines.push(`REGRESSION ${regression.receiptId ?? regression.receiptIndex}/${regression.field}: ${regression.baseline} -> ${regression.candidate}`);
  return `${lines.join("\n")}\n`;
}
