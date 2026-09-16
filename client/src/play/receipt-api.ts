import { useCachedRequest, refreshFinancialQueries } from "./query-cache";
import { useAuth } from "@clerk/react";
import { useMemo } from "react";
import { BillApiError, type Bill } from "./bill-api";
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
export type ReceiptDraftItem = Omit<
  ReceiptItem,
  "amountCents" | "finalCents"
> & {
  amountCents: number | null;
  finalCents: number | null;
  taxable?: boolean | null;
  manualFinal?: boolean;
};
export type ItemClaim = {
  itemId: string;
  userId: string;
  numerator: number;
  denominator: number;
  confirmedAt: string | null;
};
export type BillItem = ReceiptItem & { claims: ItemClaim[] };
export type ReceiptPricing = {
  subtotalCents: number | null;
  taxCents: number;
  discountCents: number;
  extraCents: number;
  pricesIncludeTax: boolean;
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
export function useReceiptApi() {
  const { getToken } = useAuth();
  const cache = useCachedRequest();
  return useMemo(() => {
    async function request<T>(
      path: string,
      method = "GET",
      body?: unknown,
    ): Promise<T> {
      const token = await getToken();
      if (!token) throw new BillApiError(401, "Please sign in again.");
      const response = await fetch(`/api${path}`, {
        method,
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
      list: (groupId: string) =>
        request<{ drafts: ReceiptDraft[] }>(
          `/groups/${groupId}/receipt-drafts`,
        ),
      get: (id: string) =>
        request<{ draft: ReceiptDraft }>(`/receipt-drafts/${id}`),
      save: (groupId: string, draft: ReceiptDraft) =>
        request<{ draft: ReceiptDraft }>(
          `/groups/${groupId}/receipt-drafts/${draft.id}`,
          "PUT",
          {
            revision: draft.revision,
            data: draft.data,
            photoBase64: draft.pendingPhoto,
          },
        ),
      remove: (id: string, revision: number) =>
        request<{ deleted: boolean }>(`/receipt-drafts/${id}`, "DELETE", {
          revision,
        }),
      previewExtract: (groupId: string, draft: ReceiptDraft) =>
        request<{ extraction: Extraction }>(
          `/groups/${groupId}/receipt-preview/extract`,
          "POST",
          draft.pendingPhoto
            ? { base64: draft.pendingPhoto }
            : { draftId: draft.id, revision: draft.revision },
        ),
      previewPrices: (groupId: string, data: ReceiptData) =>
        request<{ items: ReceiptDraftItem[]; warnings: string[] }>(
          `/groups/${groupId}/receipt-preview/prices`,
          "POST",
          data,
        ),
      previewNames: (groupId: string, data: ReceiptData) =>
        request<{ names: { id: string; name: string }[] }>(
          `/groups/${groupId}/receipt-preview/names`,
          "POST",
          data,
        ),
      upload: (id: string, revision: number, base64: string) =>
        request<{ draft: ReceiptDraft }>(`/receipt-drafts/${id}/photo`, "PUT", {
          revision,
          base64,
        }),
      extract: (id: string, revision: number) =>
        request<{ extraction: Extraction }>(
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
      names: (id: string, revision: number) =>
        request<{ names: { id: string; name: string }[] }>(
          `/receipt-drafts/${id}/names`,
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
      items: (id: string, revision: number, items: ReceiptItem[]) =>
        request<{ bill: Bill }>(`/bills/${id}/items`, "PUT", {
          revision,
          items,
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
export function cleanItem(item: ReceiptItem): ReceiptItem {
  return {
    id: item.id,
    name: item.name,
    originalText: item.originalText,
    quantity: item.quantity,
    amountCents: item.amountCents,
    taxCents: item.taxCents,
    discountCents: item.discountCents,
    extraCents: item.extraCents,
    finalCents: item.finalCents,
  };
}
