// Frozen benchmark baseline from commit 16509935cb34d505ee8d48c5616c2a22ff908e2f (#48).
// Intentional snapshot: do not update when production behavior changes. No secrets or recordings.
import { extractedReceipt } from "./receipt-extraction.js";
type Field = {
  type?: string;
  content?: string;
  valueString?: string;
  valueNumber?: number;
  valueCurrency?: { amount?: number; currencyCode?: string };
  valueArray?: Field[];
  valueObject?: Record<string, Field>;
  confidence?: number;
  valueCountryRegion?: string;
  boundingRegions?: { pageNumber: number; polygon: number[] }[];
};
export type AnalyzeResult = {
  modelId?: string;
  apiVersion?: string;
  content?: string;
  documents?: { fields?: Record<string, Field>; confidence?: number }[];
  pages?: unknown[];
};
function amount(field?: Field) {
  const n = field?.valueCurrency?.amount ?? field?.valueNumber;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function string(field?: Field) {
  return field?.valueString ?? field?.content ?? null;
}
export function normalizeAzure(result: AnalyzeResult) {
  const documents = result.documents ?? [];
  if (documents.length !== 1)
    throw new Error(
      `Expected one receipt, Azure returned ${documents.length} documents. Inspect the raw response.`,
    );
  const f = documents[0]!.fields ?? {};
  const rows = f.Items?.valueArray ?? [];
  const currencies = new Set<string>();
  function collect(field: Field) {
    if (field.valueCurrency?.currencyCode)
      currencies.add(field.valueCurrency.currencyCode);
    field.valueArray?.forEach(collect);
    Object.values(field.valueObject ?? {}).forEach(collect);
  }
  Object.values(f).forEach(collect);
  const totalTax = amount(f.TotalTax);
  const taxes =
    totalTax !== null
      ? [{ label: "TotalTax", amount: totalTax }]
      : (f.TaxDetails?.valueArray ?? []).flatMap((t) => {
          const fields = t.valueObject ?? {};
          const n = amount(fields.Amount);
          return n === null
            ? []
            : [{ label: string(fields.Description) || "Tax", amount: n }];
        });
  const taxDetails = f.TaxDetails?.valueArray?.map((entry) => {
    const detail = entry.valueObject ?? {};
    return {
      ...(amount(detail.Amount) !== null ? { amount: amount(detail.Amount)! } : {}),
      ...(amount(detail.Rate) !== null ? { rate: amount(detail.Rate)! } : {}),
      ...(amount(detail.NetAmount) !== null ? { netAmount: amount(detail.NetAmount)! } : {}),
      ...(string(detail.Description) !== null ? { description: string(detail.Description)! } : {}),
    };
  });
  return {
    evidence: {
      ...(f.CountryRegion?.valueCountryRegion ? { countryRegion: f.CountryRegion.valueCountryRegion } : {}),
      ...(taxDetails ? { taxDetails } : {}),
    },
    merchant: string(f.MerchantName),
    currency: currencies.size === 1 ? [...currencies][0] : null,
    items: rows.map((row) => {
      const item = row.valueObject ?? {};
      return {
        description: row.content || string(item.Description) || "Unclear Item",
        evidence: {
          ...(item.Description?.confidence !== undefined ? { descriptionConfidence: item.Description.confidence } : {}),
          ...(item.TotalPrice?.confidence !== undefined ? { priceConfidence: item.TotalPrice.confidence } : {}),
          ...(item.Price?.confidence !== undefined ? { unitPriceConfidence: item.Price.confidence } : {}),
          ...(item.Description?.boundingRegions ? { descriptionRegions: item.Description.boundingRegions } : {}),
          ...(item.TotalPrice?.boundingRegions ? { priceRegions: item.TotalPrice.boundingRegions } : {}),
          ...(item.Price?.boundingRegions ? { unitPriceRegions: item.Price.boundingRegions } : {}),
          ...(row.boundingRegions ? { regions: row.boundingRegions } : {}),
          ...(string(item.ProductCode) !== null ? { productCode: string(item.ProductCode)! } : {}),
          ...(string(item.QuantityUnit) !== null ? { quantityUnit: string(item.QuantityUnit)! } : {}),
          ...(amount(item.Price) !== null ? { unitPrice: amount(item.Price)! } : {}),
          ...(row.content !== undefined ? { content: row.content } : {}),
        },
        quantity: amount(item.Quantity),
        unitPrice: amount(item.Price),
        totalPrice: amount(item.TotalPrice),
      };
    }),
    subtotal: amount(f.Subtotal),
    total: amount(f.Total),
    taxes,
    discountTotal: null,
    roundingAdjustment: null,
    warnings: [
      "Review discounts and other adjustments. Azure does not provide standard receipt fields for them.",
      ...(currencies.size > 1
        ? ["Azure returned multiple currency codes; currency is left unknown."]
        : []),
      ...(rows.some((row) => amount(row.valueObject?.TotalPrice) === null)
        ? ["Some item amounts were not returned by Azure."]
        : []),
    ],
  };
}
/** Pure production mapping, shared by the extractor and offline benchmark. */
export function mapAzureAnalysis(result: AnalyzeResult) {
  const data = normalizeAzure(result);
  const content = result.content;
  return extractedReceipt.parse({
    merchant: data.merchant,
    evidence: data.evidence,
    rawAnalysis: result as Record<string, unknown>,
    text: content?.slice(0, 100000),
    currency: data.currency,
    total: data.total,
    subtotal: data.subtotal,
    pricesIncludeTax:
      /(?:prices?\s+(?:include|inclusive\s+of)\s+(?:tax|gst|hst|vat)|(?:tax|gst|hst|vat)\s+included)/i.test(
        content ?? "",
      ),
    items: data.items.map((item) => ({
      description: item.description,
      evidence: item.evidence,
      plainEnglish: null,
      quantity: item.quantity === null ? null : String(item.quantity),
      amount: item.totalPrice,
      discount: null,
      tax: null,
      taxable: null,
    })),
    taxTotal: data.taxes.length
      ? data.taxes.reduce((sum, tax) => sum + tax.amount, 0)
      : null,
    discountTotal: null,
    otherCharges: null,
    warnings: data.warnings,
  });
}
