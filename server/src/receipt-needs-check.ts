import type { DraftItemInput } from "./receipt-input.js";

export const RECEIPT_ITEM_CONFIDENCE_THRESHOLD = 0.8;

// Missing Azure observations are unknown, not low confidence. A missing
// printed price still needs review even when Azure reported no confidence.
export function needsCheckForScan(item: Pick<DraftItemInput, "amountCents" | "evidence">): boolean {
  return item.amountCents === null ||
    (item.evidence?.descriptionConfidence !== undefined &&
      item.evidence.descriptionConfidence < RECEIPT_ITEM_CONFIDENCE_THRESHOLD) ||
    (item.evidence?.priceConfidence !== undefined &&
      item.evidence.priceConfidence < RECEIPT_ITEM_CONFIDENCE_THRESHOLD);
}

// Derived allocations, model names, and receipt-wide edits are not user edits
// to an individual scanned row. Explicit review uses the confirm endpoint.
export function itemWasEdited(previous: DraftItemInput, next: DraftItemInput): boolean {
  return previous.name !== next.name ||
    previous.originalText !== next.originalText ||
    previous.quantity !== next.quantity ||
    previous.amountCents !== next.amountCents ||
    previous.discountCents !== next.discountCents ||
    previous.taxable !== next.taxable ||
    previous.manualFinal !== next.manualFinal ||
    (previous.manualFinal && previous.finalCents !== next.finalCents);
}
