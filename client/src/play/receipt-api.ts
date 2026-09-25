import { useCachedRequest, refreshFinancialQueries } from "./query-cache";
import { useAuth } from "@clerk/react";
import { useMemo } from "react";
import { BillApiError, type Bill } from "./bill-api";
import { recoverReceiptData } from "./receipt-pricing";
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
export type ReceiptEvidenceFields = {
  pages?: { pageNumber: number; width: number; height: number; unit: string }[];
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
export type ItemClaim = {
  itemId: string;
  userId: string;
  numerator: number;
  denominator: number;
  confirmedAt: string | null;
};
export type BillItem = Omit<ReceiptItem, "taxCents" | "extraCents"> & {
  taxCents: number | null;
  extraCents: number | null;
  claims: ItemClaim[];
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
  ownShareCents: number;
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
function draftRequestData(data: ReceiptData): ReceiptData {
  const clean = recoverReceiptData(data);
  return { ...clean, items: clean.items.map((item) => {
    const input = { ...item };
    delete input.allocatedTaxCents;
    delete input.allocatedDiscountCents;
    delete input.allocatedExtraCents;
    return input;
  }) };
}

export function useReceiptApi() {
  const { getToken } = useAuth();
  const cache = useCachedRequest();
  return useMemo(() => {
    async function request<T>(
      path: string,
      method = "GET",
      body?: unknown,
      signal?: AbortSignal,
    ): Promise<T> {
      const token = await getToken();
      if (!token) throw new BillApiError(401, "Please sign in again.");
      const response = await fetch(`/api${path}`, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new BillApiError(
          response.status,
          error?.error || "Request failed. Please try again.",
        );
      }
      const result = await response.json();
      if (method !== "GET" && /\/(initialize|claims|items)$/.test(path))
        await refreshFinancialQueries(cache);
      return result;
    }
    return {
      list: (groupId: string, signal?: AbortSignal) =>
        request<{ drafts: ReceiptDraft[] }>(
          `/groups/${groupId}/receipt-drafts`, "GET", undefined, signal,
        ),
      get: (id: string, signal?: AbortSignal) =>
        request<{ draft: ReceiptDraft }>(`/receipt-drafts/${id}`, "GET", undefined, signal),
      save: (groupId: string, draft: ReceiptDraft) =>
        request<{ draft: ReceiptDraft }>(
          `/groups/${groupId}/receipt-drafts/${draft.id}`,
          "PUT",
          {
            revision: draft.revision,
            data: draftRequestData(draft.data),
            photoBase64: draft.pendingPhoto,
          },
        ),
      remove: (id: string, revision: number) =>
        request<{ deleted: boolean }>(`/receipt-drafts/${id}`, "DELETE", {
          revision,
        }),
      previewPrices: (groupId: string, data: ReceiptData) =>
        request<{ items: ReceiptDraftItem[]; warnings: string[] }>(
          `/groups/${groupId}/receipt-preview/prices`,
          "POST",
          draftRequestData(data),
        ),
      upload: (id: string, revision: number, base64: string) =>
        request<{ draft: ReceiptDraft }>(`/receipt-drafts/${id}/photo`, "PUT", {
          revision,
          base64,
        }),
      extract: (id: string, revision: number) =>
        request<{ draft: ReceiptDraft; extraction: Extraction }>(
          `/receipt-drafts/${id}/extract`,
          "POST",
          { revision },
        ),
      prices: (id: string, revision: number) =>
        request<{ items: ReceiptDraftItem[]; warnings: string[] }>(
          `/receipt-drafts/${id}/prices`,
          "POST",
          { revision },
        ),
      initialize: (id: string, revision: number) =>
        request<{ bill: Bill }>(`/receipt-drafts/${id}/initialize`, "POST", {
          revision,
        }),
      claims: (
        id: string,
        revision: number,
        claims: { itemId: string; numerator: number; denominator: number }[],
      ) =>
        request<{ bill: Bill }>(`/bills/${id}/claims`, "POST", {
          revision,
          claims,
        }),
      legacyItems: (id: string, revision: number, items: LegacyReceiptItem[]) =>
        request<{ bill: Bill }>(`/bills/${id}/items`, "PUT", { revision, items }),
      correctItem: (id: string, itemId: string, revision: number, item: ReceiptCorrection) =>
        request<{ bill: Bill }>(`/bills/${id}/items/${itemId}`, "PATCH", {
          revision,
          ...item,
        }),
      photo: async (id: string, signal: AbortSignal) => {
        const token = await getToken();
        const response = await fetch(`/api/receipt-drafts/${id}/photo`, {
          signal,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Photo unavailable or expired.");
        return response.blob();
      },
    };
  }, [getToken, cache]);
}
export type ReceiptApi = ReturnType<typeof useReceiptApi>;
export function correctionInput(item: ReceiptCorrectionItem | BillItem): ReceiptCorrection {
  return {
    name: item.name,
    quantity: item.quantity,
    amountCents: item.amountCents!,
    discountCents: item.discountCents,
    taxable: item.taxable ?? true,
    manualFinal: !!item.manualFinal,
    ...(item.manualFinal && item.finalCents !== null ? { finalCents: item.finalCents } : {}),
  };
}
