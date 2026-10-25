import { z } from "zod";
import { BillError } from "../shared/bill-error.js";

// Check the raw length before Zod allocates parsed elements or their issues.
export function boundedArray<T extends z.ZodType>(schema: z.ZodArray<T>, maximum: number) {
  return z.unknown().superRefine((value, context) => {
    if (Array.isArray(value) && value.length > maximum)
      context.addIssue({ code: "too_big", origin: "array", maximum, inclusive: true, fatal: true });
  }).pipe(schema.max(maximum));
}

const amount = z.number().int().min(0).max(1_000_000);
export const itemInput = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(160),
    originalText: z.string().max(1000),
    quantity: z.string().max(40),
    amountCents: amount,
    taxCents: amount,
    discountCents: amount,
    extraCents: z.number().int().min(-1_000_000).max(1_000_000),
    finalCents: amount,
  })
  .strict();
// Azure source observations are optional: drafts created before this mapping have none.
// A scan is one photo, normally one page with eight coordinates per region.
// Leave room for richer evidence while bounding every nested collection.
export const boundingRegion = z.object({
  pageNumber: z.number(),
  polygon: boundedArray(z.array(z.number()), 32),
});
export const itemEvidence = z.object({
  descriptionConfidence: z.number().optional(),
  priceConfidence: z.number().optional(),
  unitPriceConfidence: z.number().optional(),
  descriptionRegions: boundedArray(z.array(boundingRegion), 16).optional(),
  priceRegions: boundedArray(z.array(boundingRegion), 16).optional(),
  unitPriceRegions: boundedArray(z.array(boundingRegion), 16).optional(),
  regions: boundedArray(z.array(boundingRegion), 16).optional(),
  productCode: z.string().optional(),
  quantityUnit: z.string().optional(),
  unitPrice: z.number().optional(),
  content: z.string().optional(),
});
export const receiptEvidenceFields = z.object({
  pages: boundedArray(z.array(z.object({
    pageNumber: z.number().int().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
    unit: z.string(),
  })), 16).optional(),
  countryRegion: z.string().optional(),
  taxDetails: boundedArray(z.array(z.object({
    amount: z.number().optional(),
    rate: z.number().optional(),
    netAmount: z.number().optional(),
    description: z.string().optional(),
  })), 32).optional(),
});
export const draftItemInput = itemInput.omit({ taxCents: true, extraCents: true }).extend({
  // Response-only derivation metadata: accepted for round trips, never trusted.
  allocatedTaxCents: amount.nullable().optional(),
  allocatedDiscountCents: amount.nullable().optional(),
  allocatedExtraCents: z.number().int().min(-1_000_000).max(1_000_000).nullable().optional(),
  discountSource: z.literal("receipt").optional(),
  taxNotChecked: z.boolean().optional(),
  // Review state is assigned by scanning and cleared only by a real edit or confirmation.
  needsCheck: z.boolean().optional(),
  evidence: itemEvidence.optional(),
  manualFinal: z.boolean().default(false),
  name: z.string().max(160),
  amountCents: amount.nullable(),
  finalCents: amount.nullable(),
  taxable: z.boolean().nullable().default(null),
});
export const draftInput = z.preprocess(
  (value): unknown => value && typeof value === "object" && !Array.isArray(value)
    ? withoutLegacyShare(value as ReceiptDraftData) : value,
  z
  .object({
    receipt: z
      .object({
        subtotalCents: amount.nullable(),
        taxCents: amount,
        discountCents: amount,
        extraCents: z.number().int().min(-1_000_000).max(1_000_000),
        pricesIncludeTax: z.boolean(),
        discountFallback: z.boolean().optional(),
        taxLabel: z.string().optional(),
        evidence: receiptEvidenceFields.optional(),
      })
      .strict()
      .optional(),
    title: z.string().max(120),
    purchaseDate: z.string().max(10),
    timeZone: z.string().max(100),
    notes: z.string().max(2000),
    totalCents: amount.nullable(),
    participantIds: boundedArray(z.array(z.uuid()), 16),
    mode: z.enum(["manual", "items"]),
    items: boundedArray(z.array(draftItemInput), 200),
  })
  .strict(),
);
export type ReceiptDraftData = z.infer<typeof draftInput>;
// Stored drafts and their round trips may still carry this retired setup field.
export function withoutLegacyShare(data: ReceiptDraftData): ReceiptDraftData {
  const { ownShareCents: _legacy, ...current } = data as ReceiptDraftData & { ownShareCents?: unknown };
  return current;
}
export type DraftItemInput = z.infer<typeof draftItemInput>;
export function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BillError(
      400,
      result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
}
export const revisionInput = z.number().int().positive();
export const reviewedItemsInput = boundedArray(z.array(z.object({
  itemId: z.uuid(),
  version: z.number().int().positive(),
}).strict()), 200).refine(items => new Set(items.map(item => item.itemId)).size === items.length,
  'Reviewed items must have unique IDs.');
export const claimInput = z
  .object({
    reviewedItems: reviewedItemsInput,
    claims: boundedArray(z
      .array(
        z
          .object({
            itemId: z.uuid(),
            numerator: z.number().int().min(1).max(10000),
            denominator: z.number().int().min(1).max(10000),
          })
          .strict(),
      ), 200),
  })
  .strict();
