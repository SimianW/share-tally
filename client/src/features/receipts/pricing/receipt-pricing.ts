import type { ReceiptData, ReceiptDraftItem } from '@share-tally/domain/contracts/receipts';
import { hasUnassignedReceiptTax } from '@share-tally/domain/draft-pricing';
import { money } from '../../../shared/money';

export function unassignedReceiptTaxMessage(data: ReceiptData): string | null {
  if (!hasUnassignedReceiptTax(data)) return null;
  return `Receipt tax ${money(data.receipt!.taxCents)} isn't assigned to any item. Mark the taxable items or set final costs manually.`;
}

// Unsaved session recovery can predate the server migration. Match its rule:
// An entered tax differing from its allocation in either direction, or a nonzero
// item adjustment, makes the whole draft manual. Missing tax is not an edit;
// a missing allocation means zero. Preserve every reviewed final, including siblings.
export function recoverReceiptData(data: ReceiptData): ReceiptData {
  const legacy = data.items as (ReceiptDraftItem & { taxCents?: number; extraCents?: number })[];
  const preserve = legacy.some((item) => (item.taxCents != null && item.taxCents !== (item.allocatedTaxCents ?? 0)) || !!item.extraCents);
  const cleanData = { ...data } as ReceiptData & { ownShareCents?: unknown };
  delete cleanData.ownShareCents;
  return {
    ...cleanData,
    items: legacy.map((item) => {
      const clean = { ...item };
      delete clean.taxCents;
      delete clean.extraCents;
      return preserve ? { ...clean, manualFinal: true } : clean;
    }),
  };
}
