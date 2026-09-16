// Azure's documented receipt fields only; no LLM or fixture-dependent corrections.
// https://learn.microsoft.com/azure/ai-services/document-intelligence/prebuilt/receipt
import { BillError } from "./bill-error.js";
import {
  extractedReceipt,
  type ReceiptExtractor,
} from "./receipt-extraction.js";
import { setTimeout as delay } from "node:timers/promises";
type Field = {
  type?: string;
  content?: string;
  valueString?: string;
  valueNumber?: number;
  valueCurrency?: { amount?: number; currencyCode?: string };
  valueArray?: Field[];
  valueObject?: Record<string, Field>;
  confidence?: number;
};
type AnalyzeResult = {
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
  return {
    merchant: string(f.MerchantName),
    currency: currencies.size === 1 ? [...currencies][0] : null,
    items: rows.map((row) => {
      const item = row.valueObject ?? {};
      return {
        description: row.content || string(item.Description) || "Unclear Item",
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
async function azureReceipt(
  bytes: Buffer,
  request: typeof fetch,
  wait: (ms: number, signal: AbortSignal) => Promise<unknown>,
  env: NodeJS.ProcessEnv,
) {
  const endpoint = env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key)
    throw new Error(
      "Configure AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.",
    );
  const base = new URL(endpoint);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Azure endpoint must use HTTPS.");
  const headers = { "Ocp-Apim-Subscription-Key": key };
  const signal = AbortSignal.timeout(120000);
  const response = await request(
    new URL(
      "/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=2024-11-30",
      base,
    ),
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "image/jpeg" },
      body: new Uint8Array(bytes),
      signal,
      redirect: "error",
    },
  );
  if (!response.ok)
    throw new Error(
      `Azure analyze HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`,
    );
  const location = response.headers.get("operation-location");
  if (!location) throw new Error("Azure did not return an operation URL.");
  const operation = new URL(location);
  if (
    operation.origin !== base.origin ||
    operation.username ||
    operation.password
  )
    throw new Error("Azure returned an unexpected operation host.");
  let pause = Number(response.headers.get("retry-after")) || 2;
  for (;;) {
    await wait(Math.min(Math.max(pause, 1), 10) * 1000, signal);
    signal.throwIfAborted();
    const poll = await request(operation, {
      headers,
      signal,
      redirect: "error",
    });
    if (!poll.ok)
      throw new Error(
        `Azure result HTTP ${poll.status}: ${(await poll.text()).slice(0, 400)}`,
      );
    const body = (await poll.json()) as {
      status: string;
      analyzeResult?: AnalyzeResult;
      error?: { code?: string; message?: string };
    };
    if (body.status === "succeeded" && body.analyzeResult)
      return {
        data: normalizeAzure(body.analyzeResult),
        content: body.analyzeResult.content,
        raw: JSON.stringify(body.analyzeResult, null, 2),
        usage: {
          pages: body.analyzeResult.pages?.length ?? null,
          apiVersion: "2024-11-30",
          model: "prebuilt-receipt",
        },
      };
    if (body.status === "failed" || body.status === "canceled")
      throw new Error(
        `Azure ${body.status}: ${body.error?.code ?? ""} ${body.error?.message ?? ""}`,
      );
    pause = Number(poll.headers.get("retry-after")) || 2;
  }
}

export function createAzureExtractor(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
  wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) =>
    delay(ms, undefined, { signal }),
): ReceiptExtractor {
  return async (image) => {
    if (
      !env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ||
      !env.AZURE_DOCUMENT_INTELLIGENCE_KEY
    )
      throw new BillError(
        503,
        "Receipt scanning is not configured. You can enter items manually.",
      );
    try {
      const { data, content } = await azureReceipt(image, request, wait, env);
      return extractedReceipt.parse({
        merchant: data.merchant,
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
    } catch {
      throw new BillError(
        502,
        "Could not read this receipt. Your draft is safe. Retry, replace the photo, or enter items manually.",
      );
    }
  };
}
export const azureExtract = createAzureExtractor();
