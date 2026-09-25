import type { receiptDrafts } from "./db/schema.js";
import type { ExtractedReceipt } from "./receipt-extraction.js";
import { interpretReceiptNames } from "./receipt-names.js";
import { receiptModelEvidence, type ReceiptModelAttempt } from "./receipt-processing.js";
import { completeProcessingDraft, RECEIPT_MODEL_TIMEOUT_MS } from "./receipt-drafts.js";

// Work belongs to the saved draft, not the request or the initiator. Another
// bill can be created/scanned as soon as the Azure-stage request returns.
export function startReceiptModel(
  draft: typeof receiptDrafts.$inferSelect,
  scanned: ExtractedReceipt,
  interpret: typeof interpretReceiptNames,
) {
  void runReceiptModel(draft, scanned, interpret).catch(() => {
    // A persistence outage leaves the processing row recoverable on read/startup.
    // Never log provider exceptions, which can include receipt content.
    console.error("Receipt processing completion failed");
  });
}

async function runReceiptModel(
  draft: typeof receiptDrafts.$inferSelect,
  scanned: ExtractedReceipt,
  interpret: typeof interpretReceiptNames,
) {
  const startedAt = draft.processingStartedAt!;
  const modelStart = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt: ReceiptModelAttempt;
  try {
    const remaining = startedAt.getTime() + RECEIPT_MODEL_TIMEOUT_MS - Date.now();
    if (remaining <= 0) {
      attempt = { kind: "timeout" };
    } else {
      const deadline = new Promise<ReceiptModelAttempt>((resolve) => {
        timer = setTimeout(() => {
          controller.abort(new DOMException("Receipt model timed out", "TimeoutError"));
          resolve({ kind: "timeout" });
        }, remaining);
      });
      const response = Promise.resolve()
        .then(() => interpret(receiptModelEvidence(scanned, draft.data.items), undefined, undefined, controller.signal))
        .then((value): ReceiptModelAttempt => ({ kind: "result", value }))
        .catch((error: unknown): ReceiptModelAttempt => ({
          kind: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
            ? "timeout" : "error",
        }));
      attempt = await Promise.race([response, deadline]);
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  const modelMs = performance.now() - modelStart;
  const result = await completeProcessingDraft(draft.id, startedAt, attempt);
  console.info("Receipt scan", JSON.stringify({
    azureSubmitMs: scanned.scanTimings?.azureSubmitMs ?? null,
    azurePollMs: scanned.scanTimings?.azurePollMs ?? null,
    mappingMs: scanned.scanTimings?.mappingMs ?? null,
    modelMs,
    // A competing recovery sweep has already applied the timeout fallback.
    outcome: result?.outcome ?? "fallback",
    reason: result?.reason ?? (result ? null : "timeout"),
  }));
}
