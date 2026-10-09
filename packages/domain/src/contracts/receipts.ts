
export type ReceiptItem = {
  id: string;
  name: string;
  originalText: string;
  quantity: string;
  amountCents: number;
  taxCents: number;
  discountCents: number;
  extraCents: number;
  finalCents: number;
};
export type BoundingRegion = { pageNumber: number; polygon: number[] };
export type ItemEvidence = {
  descriptionConfidence?: number;
  priceConfidence?: number;
  unitPriceConfidence?: number;
  descriptionRegions?: BoundingRegion[];
  priceRegions?: BoundingRegion[];
  unitPriceRegions?: BoundingRegion[];
  regions?: BoundingRegion[];
  productCode?: string;
  quantityUnit?: string;
  unitPrice?: number;
  content?: string;
};
export type ReceiptPage = { pageNumber: number; width: number; height: number; unit: string };
export type ReceiptEvidenceFields = {
  pages?: ReceiptPage[];
  countryRegion?: string;
  taxDetails?: { amount?: number; rate?: number; netAmount?: number; description?: string }[];
};
export type ReceiptDraftItem = Omit<
  ReceiptItem,
  "amountCents" | "finalCents" | "taxCents" | "extraCents"
> & {
  amountCents: number | null;
  finalCents: number | null;
  taxNotChecked?: boolean;
  needsCheck?: boolean;
  discountSource?: "receipt";
  allocatedTaxCents?: number | null;
  allocatedDiscountCents?: number | null;
  allocatedExtraCents?: number | null;
  taxable?: boolean | null;
  manualFinal?: boolean;
  evidence?: ItemEvidence;
};
export type LegacyReceiptItem = ReceiptItem & { manualFinal?: boolean | null };
export type LegacyCorrectionItem = Omit<LegacyReceiptItem, "amountCents" | "finalCents"> & {
  amountCents: number | null;
  finalCents: number | null;
};
export type ReceiptCorrectionItem = ReceiptDraftItem;
export type ReceiptCorrection = Pick<ReceiptCorrectionItem, "name" | "quantity" | "discountCents" | "manualFinal"> & { amountCents: number; taxable: boolean; finalCents?: number };
export type ReviewedItem = { itemId: string; version: number };
export type ItemClaim = {
  itemId: string;
  userId: string;
  numerator: number;
  denominator: number;
  confirmedAt: string | null;
};
export type BillItem = Omit<ReceiptItem, "taxCents" | "extraCents"> & {
  version: number;
  taxCents: number | null;
  extraCents: number | null;
  claims: ItemClaim[];
  receiptRegion?: BoundingRegion | null;
  taxable?: boolean | null;
  manualFinal?: boolean | null;
  frozenDiscountWeightCents?: number | null;
  frozenNetWeightCents?: number | null;
  allocatedDiscountCents?: number | null;
  allocatedTaxCents?: number | null;
  allocatedExtraCents?: number | null;
  frozenTaxRoundingCents?: number | null;
  frozenDiscountRoundingCents?: number | null;
  frozenExtraRoundingCents?: number | null;
};
export type ReceiptPricing = {
  subtotalCents: number | null;
  taxCents: number;
  taxLabel?: string | null;
  discountCents: number;
  extraCents: number;
  pricesIncludeTax: boolean;
  discountFallback?: boolean;
  evidence?: ReceiptEvidenceFields;
};
export type ReceiptData = {
  receipt?: ReceiptPricing;
  mode: "manual" | "items";
  title: string;
  purchaseDate: string;
  timeZone: string;
  notes: string;
  totalCents: number | null;
  participantIds: string[];
  items: ReceiptDraftItem[];
};
export type ReceiptDraft = {
  initializationRevision?: number;
  updatedAt?: string;
  pendingPhoto?: string;
  id: string;
  revision: number;
  processingStatus: "ready" | "processing" | "fallback";
  processingStartedAt: string | null;
  data: ReceiptData;
  billId?: string | null;
  photo?: { expiresAt: string; expired?: boolean } | null;
  /** Present on draft reads and saves; scan replies leave it out. */
  notePhotos?: import('./bills.js').NotePhoto[];
};
export type Extraction = {
  receipt: ReceiptPricing;
  items: ReceiptDraftItem[];
  title: string;
  totalCents: number | null;
  summary?: {
    subtotalCents: number | null;
    taxCents: number | null;
    pricesIncludeTax: boolean;
  };
  warnings: string[];
};
