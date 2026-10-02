import type { Bill } from '@share-tally/domain/contracts/bills';
import type { BillItem, ReceiptDraftItem } from '@share-tally/domain/contracts/receipts';
import { priceFrozenItem } from '@share-tally/domain/frozen-pricing';

export function previewCorrection(bill: Bill, original: BillItem, item: ReceiptDraftItem): ReceiptDraftItem {
  if (!bill.receipt) return item;
  const price = priceFrozenItem({ ...bill, receipt: bill.receipt }, original, item);
  const final = price.finalCents;
  return { ...item, ...price, finalCents: item.manualFinal ? item.finalCents
    : final == null || final < 0 || final > 1_000_000 ? null : final };
}
