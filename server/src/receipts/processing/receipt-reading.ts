import type { receiptDrafts } from "../../db/schema.js";
import type { ExtractedReceipt } from "./receipt-extraction.js";
import { interpretReceiptNames } from "../providers/receipt-names.js";
import { receiptModelEvidence, type ReceiptModelAttempt } from "./receipt-processing.js";
import { completeProcessingDraft } from "../drafts/processing.js";
import { RECEIPT_MODEL_TIMEOUT_MS } from "../providers/receipt-names.js";
import { setTimeout as sleep } from "node:timers/promises";

// Completion retries end when the server closes, so they never hold up shutdown.
const shutdown = new AbortController();
export function stopReceiptCompletionRetries() {
  shutdown.abort();
}

// Work belongs to the saved draft, not the request or the initiator. Another
// bill can be created/scanned as soon as the Azure-stage request returns.
export function startReceiptModel(
  draft: typeof receiptDrafts.$inferSelect,
  scanned: ExtractedReceipt,
  interpret: typeof interpretReceiptNames,
  onSettled?: () => void,
) {
  void runReceiptModel(draft, scanned, interpret).catch(() => {
    // Only shutdown ends completion retries; the processing row stays
    // recoverable on read/startup. Never log provider exceptions, which can
    // include receipt content.
    console.error("Receipt processing completion failed");
  }).finally(onSettled);
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
  const result = await completeUntilSettled(draft.id, startedAt, attempt);
  // The group may have been deleted while interpretation was in flight. Its
  // draft is gone; do not report a fabricated timeout or publish a result.
  if (!result) return;
  console.info("Receipt scan", JSON.stringify({
    azureSubmitMs: scanned.scanTimings?.azureSubmitMs ?? null,
    azurePollMs: scanned.scanTimings?.azurePollMs ?? null,
    mappingMs: scanned.scanTimings?.mappingMs ?? null,
    modelMs,
    outcome: result.outcome,
    reason: result.reason,
  }));
}

// A failed completion write retries until the draft settles or no longer needs
// completing (null: settled elsewhere, deleted or reprocessed). The row lock
// and start time keep a retry from applying a second outcome, and a write
// after the deadline falls back as it would on time.
async function completeUntilSettled(...args: Parameters<typeof completeProcessingDraft>) {
  while (true) {
    try {
      return await withinAttemptLimit(completeProcessingDraft(...args));
    } catch {
      // Database errors can include connection strings or receipt contents.
      console.error("Receipt processing completion failed; retrying");
      await sleep(2_000, undefined, { signal: shutdown.signal, ref: false });
    }
  }
}

// A database that keeps a connection open but never answers would leave an
// attempt waiting forever, so an unanswered attempt counts as failed and the
// retry takes another connection. If the abandoned attempt answers later, the
// row lock and start time still allow only one outcome.
const COMPLETION_ATTEMPT_MS = 5_000;
async function withinAttemptLimit<T>(attempt: Promise<T>) {
  attempt.catch(() => {});
  const limit = new AbortController();
  try {
    return await Promise.race([
      attempt,
      sleep(COMPLETION_ATTEMPT_MS, undefined, { signal: limit.signal, ref: false })
        .then(() => { throw new Error("Receipt processing completion timed out"); }),
    ]);
  } finally {
    limit.abort();
  }
}
