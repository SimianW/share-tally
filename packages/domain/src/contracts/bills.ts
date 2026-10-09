
export type ItemConflicts = {
  stale: (
    | { itemId: string; kind: "changed"; finalCents: number; name: string }
    | { itemId: string; kind: "added" | "removed" }
  )[];
  overAllocated: { itemId: string; available: { numerator: string; denominator: string } }[];
};
/** A picture on a bill's notes; its bytes are fetched separately by id. */
export type NotePhoto = { id: string; position: number };
export type Bill = {
  mode: 'manual' | 'items';
  items?: import('./receipts.js').BillItem[];
  receipt?: import('./receipts.js').ReceiptPricing & { totalCents: number } | null;
  frozenTaxRate?: { taxCents: number; taxableBaseCents: number } | null;
  frozenDiscountBaseCents?: number | null;
  frozenExtraBaseCents?: number | null;
  photo?: { draftId: string; expiresAt: string; expired?: boolean; pages?: import('./receipts.js').ReceiptPage[] } | null;
  id: string;
  groupId: string;
  initiatorId: string;
  title: string;
  purchaseDate: string;
  notes: string;
  /** In the order they were added. */
  notePhotos: NotePhoto[];
  totalCents: number;
  submittedCents: number;
  differenceCents: number;
  confirmedCount: number;
  adjustmentCents: number | null;
  completedAt: string | null;
  canceledAt: string | null;
  revision: number;
  participants: {
    userId: string;
    displayName: string;
    imageUrl?: string | null; fallbackImageUrl?: string | null;
    isCurrentUser: boolean;
    amountCents: number | null;
    confirmedAt: string | null;
  }[];
};
export type BillDraft = {
  requestId: string;
  title: string;
  purchaseDate: string;
  timeZone: string;
  notes: string;
  totalCents: number;
  participantIds: string[];
};
export type BillEdit = Omit<BillDraft, "requestId"> & {
  revision: number;
};
export type ShareInput = {
  amountCents: number;
  expectedAmountCents: number | null;
  revision: number;
};
