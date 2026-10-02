import { priceReceiptDraft, hasUnassignedReceiptTax } from '@share-tally/domain/draft-pricing';
import { draftInput, checked, type ReceiptDraftData } from '../receipt-input.js';

// Validate untrusted input before using the shared pure calculation.
export function priceDraft(input: ReceiptDraftData) {
  return priceReceiptDraft(checked(draftInput, input));
}

// This guard is initiation-only; saving incomplete drafts remains valid.
export function unassignedReceiptTaxMessage(data: ReceiptDraftData): string | null {
  if (!hasUnassignedReceiptTax(data)) return null;
  const receipt = data.receipt!;
  const tax = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(receipt.taxCents / 100);
  return `Receipt tax ${tax} isn't assigned to any item. Mark the taxable items or set final costs manually.`;
}
