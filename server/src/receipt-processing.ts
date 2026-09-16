import {
  extractionDefaults,
  type ExtractedReceipt,
} from "./receipt-extraction.js";
import { interpretReceiptNames } from "./receipt-names.js";

// Only explicit labels or a legend printed on this receipt establish a code.
// Bare merchant-specific letters are not portable tax rules.
export function receiptTaxMarker(row: string, text = ""): boolean | null {
  const label = (value: string) => {
    if (
      /^(?:not taxable|non[- ]taxable|tax exempt|zero[- ]rated)$/i.test(
        value.trim(),
      )
    )
      return false;
    if (/^taxable$/i.test(value.trim())) return true;
    return null;
  };
  const direct = row.match(
    /\b(not taxable|non[- ]taxable|tax exempt|zero[- ]rated|taxable)\s*$/i,
  );
  if (direct) return label(direct[1]!);
  const legends = [
    ...text.matchAll(
      /^\s*([A-Z]{1,3})\s*[=:]\s*(not taxable|non[- ]taxable|tax exempt|zero[- ]rated|taxable)\s*$/gim,
    ),
  ];
  const code = row.trim().match(/(?:^|\s)([A-Z]{1,3})$/)?.[1];
  const matches = legends.filter((entry) => entry[1]!.toUpperCase() === code);
  const values = new Set(matches.map((entry) => label(entry[2]!)));
  return values.size === 1 ? [...values][0]! : null;
}

export async function processReceipt(
  receipt: ExtractedReceipt,
  interpret: typeof interpretReceiptNames = interpretReceiptNames,
) {
  const source = {
    ...receipt,
    items: receipt.items.map((item) => ({
      ...item,
      taxable: item.taxable ?? receiptTaxMarker(item.description, receipt.text),
    })),
  };
  // IDs are internal to this single operation; pricing runs after classification.
  const items = source.items.map((item, index) => ({
    id: String(index),
    originalText: item.description,
    taxable: item.taxable,
  }));
  let suggestions: Awaited<ReturnType<typeof interpretReceiptNames>> = [];
  const warnings = [...source.warnings];
  try {
    suggestions = await interpret(items, undefined, undefined, {
      merchant: receipt.merchant,
      currency: receipt.currency,
      text: receipt.text,
    });
  } catch {
    warnings.push(
      "Item interpretation unavailable. Original descriptions were kept. Review tax checkboxes and names before initiating.",
    );
  }
  let fallback = false;
  const result = extractionDefaults({
    ...source,
    warnings,
    items: source.items.map((item, index) => {
      const suggestion = suggestions.find(
        (value) => value.id === String(index),
      );
      const taxable = item.taxable ?? suggestion?.taxable;
      if (taxable == null) fallback = true;
      return {
        ...item,
        plainEnglish: suggestion?.name ?? item.plainEnglish,
        taxable: taxable ?? true,
      };
    }),
  });
  if (fallback)
    result.warnings.push(
      "Items without a usable tax classification default to Taxable. Correct the checkboxes before applying adjustments.",
    );
  return result;
}
