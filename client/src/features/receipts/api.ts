import { createTransport } from '../../shared/api/transport';
import type { ItemConflicts } from '@share-tally/domain/contracts/bills';
import { useSyncSession } from '../../shared/api/SyncSession';
import { type Bill } from "@share-tally/domain/contracts/bills";
import type { BillItem, Extraction, LegacyReceiptItem, ReceiptCorrection, ReceiptCorrectionItem, ReceiptData, ReceiptDraft, ReceiptDraftItem, ReviewedItem } from '@share-tally/domain/contracts/receipts';
import { useMemo } from "react";
import { BillApiError } from "../../shared/api/bill-error";
import { refreshFinancialQueries, useCachedRequest } from "../../shared/api/query-cache";
import { recoverReceiptData } from "./pricing/receipt-pricing";
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
  const session = useSyncSession();
  const { getToken } = session;
  const cache = useCachedRequest();
  return useMemo(() => {
    const transport = createTransport(getToken, {
      unauthenticated: () => new BillApiError(401, 'Please sign in again.'),
      failed: ({ status, body }) => new BillApiError(status, body?.error || 'Request failed. Please try again.', body?.conflicts as ItemConflicts | undefined),
    }, session);
    async function request<T>(
      path: string,
      method = "GET",
      body?: unknown,
      signal?: AbortSignal,
    ): Promise<T> {
      const result = await transport.json<T>(path, method, body, signal);
      // Draft saves/deletes, photo processing and extraction change the Home
      // attention set as well as bill mutations. Price previews are read-only POSTs.
      if (method !== "GET" && !path.endsWith("/prices"))
        await refreshFinancialQueries(cache, session.signal);
      session.signal.throwIfAborted();
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
      confirmItem: (id: string, itemId: string, revision: number, flag: "needsCheck" | "taxNotChecked" = "needsCheck") =>
        request<{ draft: ReceiptDraft }>(`/receipt-drafts/${id}/items/${itemId}/confirm`, "POST", { revision, flag }),
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
        reviewedItems: ReviewedItem[],
        claims: { itemId: string; numerator: number; denominator: number }[],
      ) =>
        request<{ bill: Bill }>(`/bills/${id}/claims`, "POST", {
          reviewedItems,
          claims,
        }),
      legacyItems: (id: string, reviewedItems: ReviewedItem[], items: LegacyReceiptItem[]) =>
        request<{ bill: Bill }>(`/bills/${id}/items`, "PUT", { reviewedItems, items }),
      correctItem: (id: string, itemId: string, version: number, item: ReceiptCorrection) =>
        request<{ bill: Bill }>(`/bills/${id}/items/${itemId}`, "PATCH", {
          version,
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
  }, [getToken, cache, session]);
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
