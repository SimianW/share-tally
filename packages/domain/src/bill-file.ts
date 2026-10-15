import type { Bill } from './contracts/bills.js';
import type { ReceiptData, ReceiptDraftItem, ReceiptPricing } from './contracts/receipts.js';
import { hasUnassignedReceiptTax, MAX_BILL_ITEM_TOTAL_CENTS, priceReceiptDraft } from './draft-pricing.js';

type BillFileItem = {
  name: string;
  quantity: string;
  amountCents: number;
  discountCents: number;
  taxable: boolean | null;
  manualFinalCents?: number;
};
type BillFileReceipt = Pick<ReceiptPricing, 'subtotalCents' | 'taxCents' | 'discountCents' | 'extraCents' | 'pricesIncludeTax'>;
type BillFileBase = { format: 'sharetally.bill'; version: 1; title: string; totalCents: number; notes: string };
export type BillFile = BillFileBase & ({ mode: 'manual' } | { mode: 'items'; receipt: BillFileReceipt; items: BillFileItem[] });
export type BillFileDraft = Pick<ReceiptData, 'mode' | 'title' | 'totalCents' | 'notes' | 'receipt'> & {
  items: Omit<ReceiptDraftItem, 'id'>[];
};
export type BillFileReason = 'invalid' | 'newer-version' | 'too-many-items' | 'numbers' | 'over-limit';
export type BillFileResult = { ok: true; draft: BillFileDraft } | { ok: false; reason: BillFileReason };

export function toBillFile(bill: Bill): BillFile {
  if (bill.mode === 'manual') return { format: 'sharetally.bill', version: 1, mode: 'manual', title: bill.title, totalCents: bill.totalCents, notes: bill.notes };
  const receipt = bill.receipt;
  return {
    format: 'sharetally.bill', version: 1, mode: 'items',
    title: bill.title, totalCents: bill.totalCents, notes: bill.notes,
    receipt: {
      subtotalCents: receipt?.subtotalCents ?? null, taxCents: receipt?.taxCents ?? 0,
      discountCents: receipt?.discountCents ?? 0, extraCents: receipt?.extraCents ?? 0,
      pricesIncludeTax: receipt?.pricesIncludeTax ?? false,
    },
    items: (bill.items ?? []).map(item => ({
      name: item.name, quantity: item.quantity, amountCents: item.amountCents,
      discountCents: item.discountCents, taxable: item.taxable ?? null,
      ...(item.manualFinal ? { manualFinalCents: item.finalCents } : {}),
    })),
  };
}

// Upgrade n to n + 1 before validating the current purchase contract.
// No historical formats precede v1 yet.
const upgrades: readonly ((file: Record<string, unknown>) => Record<string, unknown>)[] = [];
const currentVersion = upgrades.length + 1;

function upgrade(file: Record<string, unknown>, version: number) {
  for (let v = version; v < currentVersion; v++) file = upgrades[v - 1]!(file);
  return file;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const textField = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const cents = (value: unknown, min = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= 1_000_000;

function validReceipt(value: unknown): value is BillFileReceipt {
  return record(value) && (value.subtotalCents === null || cents(value.subtotalCents)) &&
    cents(value.taxCents) && cents(value.discountCents) && cents(value.extraCents, -1_000_000) &&
    typeof value.pricesIncludeTax === 'boolean';
}
function validItem(value: unknown): value is BillFileItem {
  return record(value) && textField(value.name, 160) && textField(value.quantity, 40) &&
    cents(value.amountCents) && cents(value.discountCents) &&
    (value.taxable === null || typeof value.taxable === 'boolean') &&
    (value.manualFinalCents === undefined || cents(value.manualFinalCents));
}

export function readBillFile(text: string): BillFileResult {
  let file: unknown;
  try { file = JSON.parse(text); }
  catch { return { ok: false, reason: 'invalid' }; }
  if (!record(file) || file.format !== 'sharetally.bill') return { ok: false, reason: 'invalid' };
  if (typeof file.version !== 'number' || !Number.isSafeInteger(file.version) || file.version < 1) return { ok: false, reason: 'invalid' };
  if (file.version > currentVersion) return { ok: false, reason: 'newer-version' };
  file = upgrade(file, file.version);
  if (!record(file)) return { ok: false, reason: 'invalid' };
  if ((file.mode !== 'manual' && file.mode !== 'items') || !textField(file.title, 120) ||
    !textField(file.notes, 2000) || !cents(file.totalCents)) return { ok: false, reason: 'invalid' };
  const base: Pick<BillFileDraft, 'mode' | 'title' | 'totalCents' | 'notes'> = { mode: file.mode, title: file.title, totalCents: file.totalCents, notes: file.notes };
  if (!file.title.trim() || file.totalCents <= 0) return { ok: false, reason: 'numbers' };
  if (file.mode === 'manual') return { ok: true, draft: { ...base, items: [] } };
  if (Array.isArray(file.items) && file.items.length > 200) return { ok: false, reason: 'too-many-items' };
  if (!validReceipt(file.receipt) || !Array.isArray(file.items) || !file.items.every(validItem))
    return { ok: false, reason: 'invalid' };
  // Rebuild only purchase fields: unknown keys, including supplied final costs,
  // evidence and identity, can never leak into the draft save.
  const receipt = file.receipt;
  const cleanReceipt = {
    subtotalCents: receipt.subtotalCents, taxCents: receipt.taxCents, discountCents: receipt.discountCents,
    extraCents: receipt.extraCents, pricesIncludeTax: receipt.pricesIncludeTax,
  };
  const items = file.items.map(item => ({
    name: item.name, originalText: '', quantity: item.quantity,
    amountCents: item.amountCents, discountCents: item.discountCents,
    taxable: item.taxable, finalCents: item.manualFinalCents ?? null, manualFinal: item.manualFinalCents !== undefined,
  }));
  const priced = priceReceiptDraft({ items, receipt: cleanReceipt });
  const draft = { ...base, receipt: cleanReceipt, items: priced.items };
  if (priced.warnings.length || !items.length || priced.items.some(item =>
    !item.name.trim() || item.finalCents === null || item.finalCents < 0 ||
    item.allocatedDiscountCents === null || item.allocatedTaxCents === null || item.allocatedExtraCents === null ||
    item.amountCents - item.discountCents - item.allocatedDiscountCents < 0) ||
    hasUnassignedReceiptTax(draft)) return { ok: false, reason: 'numbers' };
  if (priced.items.reduce((sum, item) => sum + item.finalCents!, 0) > MAX_BILL_ITEM_TOTAL_CENTS)
    return { ok: false, reason: 'over-limit' };
  return { ok: true, draft };
}
