import { z } from "zod";
import { BillError } from "./bill-error.js";

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
export const boundingRegion = z.object({
  pageNumber: z.number(),
  polygon: z.array(z.number()),
});
export const itemEvidence = z.object({
  descriptionConfidence: z.number().optional(),
  priceConfidence: z.number().optional(),
  unitPriceConfidence: z.number().optional(),
  descriptionRegions: z.array(boundingRegion).optional(),
  priceRegions: z.array(boundingRegion).optional(),
  unitPriceRegions: z.array(boundingRegion).optional(),
  regions: z.array(boundingRegion).optional(),
  productCode: z.string().optional(),
  quantityUnit: z.string().optional(),
  unitPrice: z.number().optional(),
  content: z.string().optional(),
});
export const receiptEvidenceFields = z.object({
  countryRegion: z.string().optional(),
  taxDetails: z.array(z.object({
    amount: z.number().optional(),
    rate: z.number().optional(),
    netAmount: z.number().optional(),
    description: z.string().optional(),
  })).optional(),
});
export const draftItemInput = itemInput.omit({ taxCents: true, extraCents: true }).extend({
  // Response-only derivation metadata: accepted for round trips, never trusted.
  allocatedTaxCents: amount.nullable().optional(),
  allocatedDiscountCents: amount.nullable().optional(),
  allocatedExtraCents: z.number().int().min(-1_000_000).max(1_000_000).nullable().optional(),
  discountSource: z.literal("receipt").optional(),
  taxNotChecked: z.boolean().optional(),
  evidence: itemEvidence.optional(),
  manualFinal: z.boolean().default(false),
  name: z.string().max(160),
  amountCents: amount.nullable(),
  finalCents: amount.nullable(),
  taxable: z.boolean().nullable().default(null),
});
export const draftInput = z
  .object({
    receipt: z
      .object({
        subtotalCents: amount.nullable(),
        taxCents: amount,
        discountCents: amount,
        extraCents: z.number().int().min(-1_000_000).max(1_000_000),
        pricesIncludeTax: z.boolean(),
        discountFallback: z.boolean().optional(),
        evidence: receiptEvidenceFields.optional(),
      })
      .strict()
      .optional(),
    title: z.string().max(120),
    purchaseDate: z.string().max(10),
    timeZone: z.string().max(100),
    notes: z.string().max(2000),
    totalCents: amount.nullable(),
    ownShareCents: amount.default(0),
    participantIds: z.array(z.uuid()).max(16),
    mode: z.enum(["manual", "items"]),
    items: z.array(draftItemInput).max(200),
  })
  .strict();
export type ReceiptDraftData = z.infer<typeof draftInput>;
export type DraftItemInput = z.infer<typeof draftItemInput>;
export type ItemInput = z.infer<typeof itemInput>;
export function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BillError(
      400,
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 3)
        .join("; "),
    );
  return result.data;
}
export const revisionInput = z.number().int().positive();
export const claimInput = z
  .object({
    revision: revisionInput,
    claims: z
      .array(
        z
          .object({
            itemId: z.uuid(),
            numerator: z.number().int().min(1).max(10000),
            denominator: z.number().int().min(1).max(10000),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
