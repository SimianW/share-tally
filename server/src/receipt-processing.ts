import { z } from "zod";
import {
  extractionDefaults,
  type ExtractedReceipt,
} from "./receipt-extraction.js";
import type { DraftItemInput } from "./receipt-input.js";
import type { ReceiptModelEvidence } from "./receipt-names.js";

// Azure alone owns all amounts and the provisional draft. The language model
// runs separately after this result has been persisted.
export function processReceipt(receipt: ExtractedReceipt) {
  return extractionDefaults(receipt);
}

function merchantAddress(rawAnalysis: ExtractedReceipt["rawAnalysis"]): string | null {
  const documents = rawAnalysis?.documents;
  if (!Array.isArray(documents) || !documents.length) return null;
  const first = documents[0];
  if (!first || typeof first !== "object") return null;
  const fields = (first as { fields?: unknown }).fields;
  if (!fields || typeof fields !== "object") return null;
  const address = (fields as Record<string, unknown>).MerchantAddress;
  if (!address || typeof address !== "object") return null;
  const content = (address as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

// Draft rows may no longer have the same count/order as Azure rows after
// discount attachment. Match the original Description to its printed line,
// never an item index, and use persisted evidence when there is no match.
function azureDescriptions(receipt: ExtractedReceipt): Map<string, string> {
  const descriptions = new Map<string, string>();
  const documents = receipt.rawAnalysis?.documents;
  if (!Array.isArray(documents) || !documents.length) return descriptions;
  const document = documents[0] as {
    fields?: { Items?: { valueArray?: {
      content?: unknown;
      valueObject?: {
        Description?: { valueString?: unknown; content?: unknown };
      };
    }[] } };
  } | undefined;
  for (const row of document?.fields?.Items?.valueArray ?? []) {
    const description = row.valueObject?.Description;
    const value = description?.valueString ?? description?.content;
    if (typeof row.content === "string" && typeof value === "string" && value.trim())
      descriptions.set(row.content, value);
  }
  return descriptions;
}

// A filter for evidence, not a tax-code interpreter: the model sees both the
// original item line and receipt-local printed explanations of any code.
function taxCodeLines(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .filter((line) =>
      /\b(?:tax(?:able)?|non[- ]taxable|exempt|zero[- ]rated|GST|HST|PST|QST|VAT)\b/i.test(line) ||
      // A printed legend may say only "A = 0%" or "B: 13". Keep this
      // evidence without assigning any meaning to its code or rate ourselves.
      line.includes("%") || /^\s*\S{1,4}\s*[=:]\s*[-+]?\d/.test(line),
    );
}

export function receiptModelEvidence(
  receipt: ExtractedReceipt,
  items: DraftItemInput[],
): ReceiptModelEvidence {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error("Duplicate saved receipt item IDs.");
  const descriptions = azureDescriptions(receipt);
  return {
    merchant: receipt.merchant,
    address: merchantAddress(receipt.rawAnalysis),
    subtotal: receipt.subtotal ?? null,
    tax: receipt.taxTotal,
    total: receipt.total,
    taxDetails: receipt.evidence?.taxDetails ?? [],
    taxCodeLines: taxCodeLines(receipt.text),
    items: items.map((item) => ({
      id: item.id,
      description: descriptions.get(item.evidence?.content ?? "") ?? item.originalText,
      productCode: item.evidence?.productCode ?? null,
      quantity: item.quantity,
      quantityUnit: item.evidence?.quantityUnit ?? null,
      unitPrice: item.evidence?.unitPrice ?? null,
      lineTotal: item.amountCents === null ? null : item.amountCents / 100,
      confidence: {
        description: item.evidence?.descriptionConfidence ?? null,
        price: item.evidence?.priceConfidence ?? null,
        unitPrice: item.evidence?.unitPriceConfidence ?? null,
      },
      rawLineText: item.evidence?.content ?? item.originalText,
    })),
  };
}

export type ReceiptModelAttempt =
  | { kind: "result"; value: unknown }
  | { kind: "timeout" }
  | { kind: "error" };

const resultSchema = z
  .object({ items: z.array(z.unknown()).max(200) })
  .strict();
const answerSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1).max(160),
    taxable: z.boolean().nullable(),
  })
  .strict();

/** Printed receipt totals used to settle taxability without the model. */
export type ReceiptTaxEvidence = { taxCents: number; subtotalCents: number | null; totalCents: number | null };

// A receipt that prints no tax (zero tax and subtotal equal to total) taxes nothing, whatever the
// model says. Both conditions are required so a tax line Azure merely missed cannot trigger it.
export function receiptPrintsNoTax(receipt: ReceiptTaxEvidence | undefined): boolean {
  return !!receipt && receipt.taxCents === 0 && receipt.subtotalCents !== null &&
    receipt.subtotalCents === receipt.totalCents;
}

export function applyReceiptModelResult<
  T extends { id: string; name: string; taxable: boolean | null },
>(items: T[], attempt: ReceiptModelAttempt, receipt?: ReceiptTaxEvidence) {
  const applied = applyModelAnswers(items, attempt);
  if (!receiptPrintsNoTax(receipt)) return applied;
  return { ...applied, items: applied.items.map((item) => ({ ...item, taxable: false as const, taxNotChecked: false })) };
}

function applyModelAnswers<
  T extends { id: string; name: string; taxable: boolean | null },
>(items: T[], attempt: ReceiptModelAttempt) {
  const fallback = (reason: "timeout" | "error" | "invalid") => ({
    items: items.map((item) => ({
      ...item,
      taxable: true as const,
      taxNotChecked: true,
    })),
    outcome: "fallback" as const,
    fellBack: true,
    reason,
  });
  if (attempt.kind !== "result") return fallback(attempt.kind);
  const parsed = resultSchema.safeParse(attempt.value);
  if (!parsed.success) return fallback("invalid");
  const ids = new Set(items.map((item) => item.id));
  const seen = new Set<string>();
  const answers = new Map<string, z.infer<typeof answerSchema>>();
  for (const row of parsed.data.items) {
    if (!row || typeof row !== "object" || !("id" in row))
      return fallback("invalid");
    const id = (row as { id: unknown }).id;
    if (typeof id !== "string" || !ids.has(id) || seen.has(id))
      return fallback("invalid");
    seen.add(id);
    const valid = answerSchema.safeParse(row);
    if (valid.success) answers.set(id, valid.data);
  }
  const missing = answers.size !== items.length;
  return {
    items: items.map((item) => {
      const answer = answers.get(item.id);
      return answer
        ? answer.taxable === null
          ? { ...item, name: answer.name, taxable: true as const, taxNotChecked: true }
          : { ...item, name: answer.name, taxable: answer.taxable, taxNotChecked: false }
        : { ...item, taxable: true as const, taxNotChecked: true };
    }),
    outcome: missing
      ? (answers.size ? ("partial" as const) : ("fallback" as const))
      : ("ok" as const),
    fellBack: missing,
    reason: missing
      ? answers.size === 0 && parsed.data.items.length > 0
        ? ("invalid" as const)
        : ("partial" as const)
      : null,
  };
}
