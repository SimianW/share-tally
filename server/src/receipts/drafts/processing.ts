import { editable, ownDraft } from './access.js';
import { RECEIPT_MODEL_TIMEOUT_MS } from "../providers/receipt-names.js";
import type { ExtractedReceipt, extractionDefaults } from "../processing/receipt-extraction.js";
import { applyReceiptModelResult } from "../processing/receipt-processing.js";
import { and, eq, lte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { receiptDrafts, receiptEvidence, receiptPhotos } from "../../db/schema.js";
import { checked, draftInput, type ReceiptDraftData } from "../receipt-input.js";
import { BillError } from "../../shared/bill-error.js";
import { notifyGroupChanged } from "../../realtime/group-events.js";
import { priceDraft } from "../pricing/receipt-pricing.js";
import { printedTax } from "../pricing/frozen-receipt-pricing.js";

// Persist the Azure result and its evidence under the same revision check. The
// model never runs against a draft that changed while Azure was reading it.
export async function saveProcessingDraft(
  id: string,
  userId: string,
  revision: number,
  extraction: ReturnType<typeof extractionDefaults>,
  analysis: ExtractedReceipt["rawAnalysis"],
) {
  const result = await db.transaction(async (tx) => {
    const old = await ownDraft(tx, id, userId, true);
    editable(old, revision);
    const [photo] = await tx.select({ expiresAt: receiptPhotos.expiresAt })
      .from(receiptPhotos).where(eq(receiptPhotos.draftId, id));
    if (!photo || photo.expiresAt <= new Date())
      throw new BillError(409, "Receipt photo expired during scanning.");
    // Replace rather than retain an earlier scan's evidence when an adapter
    // supplies no analysis (for example a test or manually entered receipt).
    await tx.delete(receiptEvidence).where(eq(receiptEvidence.draftId, id));
    if (analysis) await tx.insert(receiptEvidence).values({ draftId: id, analysis });
    const now = new Date();
    const label = printedTax(extraction.receipt.evidence)?.label;
    const [draft] = await tx.update(receiptDrafts).set({
      data: checked(draftInput, {
        ...old.data,
        mode: "items",
        title: old.data.title || extraction.title,
        items: extraction.items,
        receipt: { ...extraction.receipt, ...(label ? { taxLabel: label } : {}) },
        totalCents: extraction.totalCents,
      }),
      processingStatus: "processing",
      processingStartedAt: now,
      revision: old.revision + 1,
      updatedAt: now,
    }).where(eq(receiptDrafts.id, id)).returning();
    return { ...draft!, photo: { ...photo, expired: false } };
  });
  notifyGroupChanged(result.groupId);
  return result;
}
// Holding the row lock lets either the model or recovery complete this scan,
// never both. The start time identifies the processing operation.
export async function completeProcessingDraft(
  id: string,
  startedAt: Date,
  attempt: Parameters<typeof applyReceiptModelResult>[1],
) {
  const result = await db.transaction(async (tx) => {
    const [draft] = await tx.select().from(receiptDrafts)
      .where(eq(receiptDrafts.id, id)).for("update");
    if (!draft || draft.processingStatus !== "processing" ||
        draft.processingStartedAt?.getTime() !== startedAt.getTime()) return null;
    const expired = Date.now() - startedAt.getTime() >= RECEIPT_MODEL_TIMEOUT_MS;
    const receipt = draft.data.receipt;
    const applied = applyReceiptModelResult(draft.data.items, expired ? { kind: "timeout" } : attempt,
      receipt && { taxCents: receipt.taxCents, subtotalCents: receipt.subtotalCents, totalCents: draft.data.totalCents });
    const data: ReceiptDraftData = { ...draft.data, items: applied.items };
    // Reallocate the same Azure tax, never change the receipt's amounts.
    data.items = priceDraft(data).items;
    await tx.update(receiptDrafts).set({
      data,
      processingStatus: applied.fellBack ? "fallback" : "ready",
      processingStartedAt: null,
      revision: draft.revision + 1,
      updatedAt: new Date(),
    }).where(eq(receiptDrafts.id, id));
    return { groupId: draft.groupId, outcome: applied.outcome, reason: applied.reason };
  });
  if (result) notifyGroupChanged(result.groupId);
  return result;
}
export async function sweepStaleProcessingDrafts(
  scope: { id?: string; groupId?: string; userId?: string } = {},
) {
  const stale = await db.select({ id: receiptDrafts.id, startedAt: receiptDrafts.processingStartedAt })
    .from(receiptDrafts).where(and(
      eq(receiptDrafts.processingStatus, "processing"),
      lte(receiptDrafts.processingStartedAt, new Date(Date.now() - RECEIPT_MODEL_TIMEOUT_MS)),
      scope.id ? eq(receiptDrafts.id, scope.id) : undefined,
      scope.groupId ? eq(receiptDrafts.groupId, scope.groupId) : undefined,
      scope.userId ? eq(receiptDrafts.initiatorId, scope.userId) : undefined,
    ));
  for (const draft of stale) {
    if (!draft.startedAt) continue;
    const result = await completeProcessingDraft(draft.id, draft.startedAt, { kind: "timeout" });
    if (result) console.info("Receipt processing recovered", {
      outcome: result.outcome, reason: result.reason,
      elapsedMs: Date.now() - draft.startedAt.getTime(),
    });
  }
}
