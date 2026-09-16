import { randomUUID } from "node:crypto";
import { z } from "zod";
import { priceDraft } from "./receipt-pricing.js";
import type { DraftItemInput } from "./receipt-input.js";
const money = z.number().min(0).max(10000);
export const extractedReceipt = z.object({
  merchant: z.string().nullable(),
  currency: z.string().nullable(),
  total: money.nullable(),
  items: z
    .array(
      z.object({
        description: z.string(),
        plainEnglish: z.string().nullable(),
        quantity: z.string().nullable(),
        amount: money.nullable(),
        discount: money.nullable(),
        tax: money.nullable(),
        taxable: z.boolean().nullable(),
      }),
    )
    .max(200),
  subtotal: money.nullable().optional(),
  pricesIncludeTax: z.boolean().default(false),
  discountTotal: money.nullable(),
  taxTotal: money.nullable(),
  otherCharges: z.number().min(-10000).max(10000).nullable(),
  warnings: z.array(z.string()),
});
export type ExtractedReceipt = z.infer<typeof extractedReceipt>;
export type ReceiptExtractor = (image: Buffer) => Promise<ExtractedReceipt>;
const cents = (n: number | null) => Math.round((n ?? 0) * 100);
export function extractionDefaults(data: ExtractedReceipt) {
  data = extractedReceipt.parse(data);
  const warnings = [...data.warnings];
  if (data.currency && data.currency !== "CAD")
    warnings.push(
      `The receipt says ${data.currency}. Only CAD is supported; no currency conversion was applied.`,
    );
  const items: DraftItemInput[] = data.items.map((i) => ({
    id: randomUUID(),
    manualFinal: false,
    taxable: i.taxable,
    originalText: i.description.slice(0, 1000),
    name:
      i.plainEnglish?.trim().slice(0, 160) ||
      i.description.trim().slice(0, 160) ||
      "Unclear Item",
    quantity: (i.quantity || "1").slice(0, 40),
    amountCents: i.amount === null ? null : cents(i.amount),
    discountCents: cents(i.discount),
    taxCents: cents(i.tax),
    extraCents: 0,
    finalCents: 0,
  }));
  const receipt = {
    subtotalCents: data.subtotal == null ? null : cents(data.subtotal),
    taxCents: Math.max(
      0,
      cents(data.taxTotal) - items.reduce((sum, i) => sum + i.taxCents, 0),
    ),
    discountCents: Math.max(
      0,
      cents(data.discountTotal) -
        items.reduce((sum, i) => sum + i.discountCents, 0),
    ),
    extraCents: cents(data.otherCharges),
    pricesIncludeTax: data.pricesIncludeTax,
  };
  const priced = priceDraft({
    receipt,
    items,
    mode: "items",
    title: "",
    notes: "",
    purchaseDate: "",
    timeZone: "",
    totalCents: null,
    ownShareCents: 0,
    participantIds: [],
  });
  return {
    receipt,
    summary: {
      subtotalCents: receipt.subtotalCents,
      taxCents: data.taxTotal === null ? null : cents(data.taxTotal),
      pricesIncludeTax: data.pricesIncludeTax,
    },
    items: priced.items,
    title: data.merchant?.slice(0, 120) || "",
    totalCents: data.total === null ? null : cents(data.total),
    warnings: [
      ...warnings,
      ...priced.warnings,
      ...(!items.length ? ["No items found. Add the items manually."] : []),
    ],
  };
}
