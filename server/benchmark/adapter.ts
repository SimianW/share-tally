import type { AnalyzeResult } from "../src/azure-receipt.js";
import type { BenchmarkPrediction } from "./scorer.js";
import { recordedItemIds, replayModel, type ModelRecording, type ModelOutcome } from "./recordings.js";

/**
 * A trusted local plugin. It receives evidence, never labels, image paths, or ground truth.
 * items.description measures the pipeline's actual originalText, NOT its display name.
 * Every predicted item must set sourceIndex to its ORIGINAL raw Azure Items index,
 * preserving that binding through filtering/reordering (#52 removes coupon rows).
 * Set sourceIndex:null only for a newly created row without Azure item provenance.
 * invokeAdapter owns items.azureDescription: it overwrites plugin values using the same
 * raw Azure Description helper for every pipeline. That separate metric is also the
 * preferred description evidence for one-to-one matching (with code and line price).
 */
export interface BenchmarkAdapter {
  /** Stable filename-safe ID; model recordings are <azure-config>.model.<id>.json. */
  id: string;
  /** A model-less adapter is allowed for diagnostics, but cannot pass the release gate. */
  requiresModel: boolean;
  run(input: AdapterInput): Promise<BenchmarkPrediction> | BenchmarkPrediction;
}
export interface AdapterInput {
  analysis: AnalyzeResult;
  recording: ModelRecording | null;
  /** Reuse these IDs when constructing #51 receiptModelEvidence and applying its result. */
  itemIds(count: number): string[];
  /** Check full freshly built input, exact version and exact non-secret config before replay. */
  replay(input: unknown, expected: { version: string; config: Record<string, unknown> }): ModelOutcome;
}
export function azurePrintedDescription(rawItem: { valueObject?: { Description?: { valueString?: string; content?: string } } } | undefined): string | null {
  const field = rawItem?.valueObject?.Description;
  return field?.valueString ?? field?.content ?? null;
}
/** Shared projection: no labels and no assumptions that output rows retain Azure order/count. */
export function projectAzureDescriptions(analysis: AnalyzeResult, prediction: BenchmarkPrediction): BenchmarkPrediction {
  if (!prediction || !Array.isArray(prediction.supportedFields)) throw new Error("Invalid adapter prediction.");
  if (prediction.items == null) return prediction;
  if (!Array.isArray(prediction.items)) throw new Error("Prediction items must be an array.");
  const rawItems = analysis.documents?.[0]?.fields?.Items?.valueArray ?? [];
  const seen = new Set<number>();
  const items = prediction.items.map((item) => {
    if (!item || item.sourceIndex === undefined) throw new Error("Each predicted item must declare sourceIndex (original Azure index, or null for a new row).");
    if (item.sourceIndex === null) return { ...item, azureDescription: null };
    if (!Number.isInteger(item.sourceIndex) || item.sourceIndex < 0 || item.sourceIndex >= rawItems.length || seen.has(item.sourceIndex)) throw new Error("sourceIndex must uniquely reference an existing raw Azure item.");
    seen.add(item.sourceIndex);
    return { ...item, azureDescription: azurePrintedDescription(rawItems[item.sourceIndex]) };
  });
  return { ...prediction, items, supportedFields: [...new Set([...prediction.supportedFields, "items.azureDescription" as const])] };
}
export async function invokeAdapter(adapter: BenchmarkAdapter, analysis: AnalyzeResult, recording: ModelRecording | null) {
  let replayed = false;
  const prediction = await adapter.run({
    analysis: structuredClone(analysis), recording: structuredClone(recording),
    itemIds: (count) => recordedItemIds(recording, count),
    replay: (input, expected) => {
      const outcome = replayModel(recording, input, expected);
      replayed = true;
      return outcome;
    },
  });
  return { prediction: projectAzureDescriptions(analysis, prediction), replayed, complete: adapter.requiresModel && recording !== null && replayed };
}
