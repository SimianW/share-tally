import { z } from "zod";
import { mapAzureAnalysis } from "./frozen-baseline/azure-receipt.js";
import { processReceipt } from "./frozen-baseline/receipt-processing.js";
import { interpretReceiptNames } from "./frozen-baseline/receipt-names.js";
import type { BenchmarkAdapter } from "./adapter.js";
import type { BenchmarkPrediction } from "./scorer.js";
import { RecordingError } from "./recordings.js";

export const BASELINE_COMMIT = "16509935cb34d505ee8d48c5616c2a22ff908e2f";
export const BASELINE_MODEL_VERSION = "receipt-names-responses-v1";
const configSchema = z.object({ baseURL: z.string().url(), model: z.string().min(1) }).strict();
const cents = (amount: number | undefined) => amount === undefined ? null : Math.round(amount * 100);
/** Runs frozen #48 production mapping, interpretation parser, defaults and pricing; never calls a provider. */
export const baselineAdapter: BenchmarkAdapter = {
  id: "baseline", requiresModel: true,
  async run(input): Promise<BenchmarkPrediction> {
    const scanned = mapAzureAnalysis(input.analysis);
    const modelConfig = input.recording ? configSchema.parse(input.recording.config) : null;
    let replayFailure: unknown;
    const processed = await processReceipt(scanned, async (items, _config, _request, context) => {
      if (!input.recording) throw new Error("Model response not recorded; Azure-only diagnostic fallback.");
      const config = modelConfig!;
      return interpretReceiptNames(items, { ...config, apiKey: "offline-not-a-secret" }, async (_url, init) => {
        let outcome;
        try {
          outcome = input.replay(JSON.parse(String(init?.body)), { version: BASELINE_MODEL_VERSION, config });
        } catch (error) { replayFailure = error; throw error; }
        if (outcome.kind === "timeout") throw new Error("Recorded model timeout.");
        if (outcome.kind === "error") throw new Error(outcome.message ?? "Recorded model error.");
        return new Response(JSON.stringify(outcome.value), { status: 200, headers: { "content-type": "application/json" } });
      }, context);
    });
    // Production deliberately falls back on interpretation failures. Input drift is instead
    // an invalid benchmark recording and must not disappear inside that fallback catch.
    if (replayFailure) throw replayFailure;
    if (input.recording && input.recording.version !== BASELINE_MODEL_VERSION) throw new RecordingError("Baseline model version drift.");
    return {
      supportedFields: ["merchant", "currency", "items", "items.description", "items.productCode", "items.quantity", "items.unit", "items.unitPrice", "items.linePrice", "items.ownDiscount", "receiptDiscounts", "charges", "subtotal", "taxLines", "taxTotal", "taxMode", "total", ...(input.recording ? ["taxability" as const] : [])],
      merchant: scanned.merchant, currency: scanned.currency,
      items: processed.items.map((item, index) => ({
        sourceIndex: index, // Frozen #48 never filters or reorders Azure item rows.
        description: item.originalText,
        productCode: item.evidence?.productCode ?? null,
        quantity: item.quantity,
        unit: item.evidence?.quantityUnit ?? null,
        unitPrice: cents(item.evidence?.unitPrice),
        linePrice: item.amountCents, // Printed amount, NOT allocated finalCents.
        ownDiscount: item.discountCents,
        taxable: item.taxable,
      })),
      receiptDiscounts: processed.receipt.discountCents === 0 ? [] : [{ label: null, amount: processed.receipt.discountCents }],
      charges: processed.receipt.extraCents === 0 ? [] : [{ label: null, amount: processed.receipt.extraCents }],
      subtotal: processed.summary.subtotalCents,
      taxLines: scanned.evidence?.taxDetails?.map((detail) => ({
        label: detail.description ?? null, amount: cents(detail.amount),
        rate: detail.rate === undefined ? null : String(detail.rate),
      })) ?? null,
      taxTotal: processed.summary.taxCents,
      taxMode: processed.summary.pricesIncludeTax ? "inclusive" : "exclusive",
      total: processed.totalCents,
    };
  },
};
export default baselineAdapter;
