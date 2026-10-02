import { requestId } from "../../../shared/browser/request-id";
import { localToday } from "../../../shared/browser/date";
import { type ReceiptData, type ReceiptDraft } from "@share-tally/domain/contracts/receipts";
import { unassignedReceiptTaxMessage } from "../pricing/receipt-pricing";

export function comparable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(comparable).join(",")}]`;
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          comparable((value as Record<string, unknown>)[key]),
        ]),
    );
  return JSON.stringify(value);
}
export function hasUnsavedChanges(draft: ReceiptDraft, baseline: ReceiptDraft | null, file: File | null, loading: boolean) {
  return !loading && !draft.initializationRevision && (
    !!file || !!draft.pendingPhoto || !baseline ||
    comparable(draft.data) !== comparable(baseline.data)
  );
}
export function itemsComplete(data: ReceiptData) {
  return data.items.length > 0 && data.items.every(
    (i) =>
      i.amountCents !== null &&
      i.finalCents !== null &&
      i.finalCents >= 0 &&
      i.name.trim(),
  );
}
// Items are ready for sharing when initiation would accept them: every item is
// complete and the receipt tax is assigned to at least one of them.
export function itemsReady(data: ReceiptData) {
  return data.mode === "items" && itemsComplete(data) && !unassignedReceiptTaxMessage(data);
}
// Later steps open only once the steps before them are done; Items needs a
// scanned or entered item, People needs By amount or ready items.
export function canOpenStep(data: ReceiptData, index: number) {
  if (index === 0) return true;
  if (index === 1) return data.mode === "items" && data.items.length > 0;
  return data.mode === "manual" || itemsReady(data);
}
export function openingStep(draft: ReceiptDraft, stored: string | null) {
  if (draft.initializationRevision) return 2;
  if (draft.processingStatus === "processing" && draft.data.mode === "items") return 1;
  if (stored !== null && [0, 1, 2].includes(Number(stored)) && canOpenStep(draft.data, Number(stored)))
    return Number(stored);
  return draft.data.mode === "manual" ? 2 : draft.data.items.length ? 1 : 0;
}
export function emptyDraft(userId: string, id = requestId()): ReceiptDraft {
  return {
    id,
    revision: 0,
    processingStatus: "ready",
    processingStartedAt: null,
    data: {
      mode: "items",
      title: "",
      purchaseDate: localToday(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      notes: "",
      totalCents: null,
      participantIds: [userId],
      items: [],
      receipt: {
        subtotalCents: null,
        taxCents: 0,
        discountCents: 0,
        extraCents: 0,
        pricesIncludeTax: false,
      },
    },
  };
}
