import { z } from "zod";
import { azureItemRowIndices, mapAzureAnalysis, type AnalyzeResult } from "../src/azure-receipt.js";
import { buildReceiptNameRequest, parseReceiptNameResponse, receiptNameConfig, type ReceiptModelEvidence } from "../src/receipt-names.js";
import { applyReceiptModelResult, processReceipt, receiptModelEvidence, type ReceiptModelAttempt } from "../src/receipt-processing.js";
import { PIPELINE_FIELDS, scanFailedPrediction, type BenchmarkAdapter } from "./adapter.js";
import type { BenchmarkPrediction } from "./scorer.js";
import { noModelInput, RecordingError, type ModelOutcome } from "./recordings.js";

export const CANDIDATE_ID = "two-stage";
export const CANDIDATE_MODEL_VERSION = "receipt-evidence-names-taxability-v1";
const configSchema = z.object({ baseURL: z.string().url(), model: z.string().min(1) }).strict();

/** Validate recorded configuration, never read credentials or deployment configuration offline. */
export function candidateConfig(value: unknown) {
  const config = configSchema.parse(value);
  const normalized = receiptNameConfig({ RECEIPT_NAME_BASE_URL: config.baseURL,
    RECEIPT_NAME_MODEL: config.model, RECEIPT_NAME_API_KEY: "offline-not-a-secret" });
  if (normalized.baseURL !== config.baseURL || normalized.model !== config.model)
    throw new RecordingError("Candidate model config drift: configuration is not canonical.");
  return config;
}

export function candidateDraft(analysis: AnalyzeResult, itemIds?: (count: number) => string[]) {
  const scanned = mapAzureAnalysis(analysis);
  const processed = processReceipt(scanned);
  // Generate/price valid production UUIDs first. Replay IDs may be "0", "1", etc.;
  // they are correlation-only and must never pass back through draft/API validation.
  const ids = itemIds?.(processed.items.length) ?? processed.items.map((item) => item.id);
  const items = processed.items.map((item, index) => ({ ...item, id: ids[index]! }));
  return { scanned, processed, items, evidence: receiptModelEvidence(scanned, items) };
}

/** True where current production mapping throws and the extractor answers with a 502 (see scanFailedPrediction). */
export function candidateScanFails(analysis: AnalyzeResult): boolean {
  try { mapAzureAnalysis(analysis); return false; } catch { return true; }
}
export const candidateScanFailedInput = (config: { baseURL: string; model: string }) => noModelInput({ config }, "scan-failed");

export function candidateInput(evidence: ReceiptModelEvidence, config: { baseURL: string; model: string }): unknown {
  return evidence.items.length
    ? JSON.parse(JSON.stringify(buildReceiptNameRequest(evidence, config))) as unknown
    : noModelInput({ config, evidence });
}

function modelAttempt(outcome: ModelOutcome): ReceiptModelAttempt {
  if (outcome.kind === "timeout" || outcome.kind === "error") return { kind: outcome.kind };
  if (outcome.kind === "skipped") {
    // The caller validates this marker against the fresh empty input before reaching here.
    // Production interpretReceiptNames returns this local value without HTTP for no items.
    return { kind: "result", value: { items: [] } };
  }
  try { return { kind: "result", value: parseReceiptNameResponse(outcome.value) }; }
  catch { return { kind: "error" }; }
}
const cents = (amount: number | undefined) => amount === undefined ? null : Math.round(amount * 100);

/** Current #51+#52 pipeline; all scored amounts remain Azure-owned. */
export const candidateAdapter: BenchmarkAdapter = {
  id: CANDIDATE_ID, requiresModel: true,
  run(input): BenchmarkPrediction {
    if (candidateScanFails(input.analysis)) {
      if (input.recording) {
        const config = candidateConfig(input.recording.config);
        const outcome = input.replay(candidateScanFailedInput(config), { version: CANDIDATE_MODEL_VERSION, config });
        if (outcome.kind !== "skipped" || outcome.reason !== "scan-failed") throw new RecordingError("Candidate scan-failure drift.");
      }
      return scanFailedPrediction(!!input.recording);
    }
    const { scanned, processed, items, evidence } = candidateDraft(input.analysis, input.itemIds);
    let attempt: ReceiptModelAttempt = { kind: "error" };
    if (input.recording) {
      const config = candidateConfig(input.recording.config);
      // Drift and no-call mismatches are benchmark errors, outside production fallback catches.
      const outcome = input.replay(candidateInput(evidence, config), { version: CANDIDATE_MODEL_VERSION, config });
      if ((outcome.kind === "skipped") !== (items.length === 0))
        throw new RecordingError("Candidate no-items/model-call drift.");
      attempt = modelAttempt(outcome);
    }
    // Same printed totals production passes, so the zero-tax rule is measured too.
    const applied = applyReceiptModelResult(items, attempt, { taxCents: processed.receipt.taxCents,
      subtotalCents: processed.receipt.subtotalCents, totalCents: processed.totalCents });
    const sourceIndices = azureItemRowIndices(input.analysis);
    // No repricing is needed: final allocations are not benchmark fields. In particular,
    // never validate saved benchmark IDs as draft UUIDs or let the model replace money.
    return {
      supportedFields: [...PIPELINE_FIELDS, ...(input.recording ? ["taxability" as const] : [])],
      merchant: scanned.merchant, currency: scanned.currency,
      items: applied.items.map((item, index) => ({
        sourceIndex: sourceIndices[index]!, description: item.originalText,
        productCode: item.evidence?.productCode ?? null, quantity: item.quantity,
        unit: item.evidence?.quantityUnit ?? null, unitPrice: cents(item.evidence?.unitPrice),
        linePrice: item.amountCents, ownDiscount: item.discountCents, taxable: item.taxable,
      })),
      receiptDiscounts: processed.receipt.discountCents === 0 ? [] : [{ label: null, amount: processed.receipt.discountCents }],
      charges: processed.receipt.extraCents === 0 ? [] : [{ label: null, amount: processed.receipt.extraCents }],
      subtotal: processed.summary.subtotalCents,
      taxLines: scanned.evidence?.taxDetails?.map((detail) => ({ label: detail.description ?? null,
        amount: cents(detail.amount), rate: detail.rate === undefined ? null : String(detail.rate) })) ?? null,
      taxTotal: processed.summary.taxCents,
      taxMode: processed.summary.pricesIncludeTax ? "inclusive" : "exclusive",
      total: processed.totalCents,
    };
  },
};
export default candidateAdapter;
