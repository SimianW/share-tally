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
export const draftItemInput = itemInput.extend({
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
