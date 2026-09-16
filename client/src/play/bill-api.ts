import { AccessError, cachedRead, useCachedRequest, refreshFinancialQueries } from './query-cache';
import { useMemo } from "react";
import { useAuth } from "@clerk/react";
export class BillApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export type AttentionAction = { groupId: string; groupName: string } & (
  | { kind: 'missing-share' | 'confirm-share'; billId: string; title: string; amountCents: number | null }
  | { kind: 'review-repayment'; repaymentId: string; senderName: string; amountCents: number }
);
export type Repayment = {
  id: string; groupId: string; senderId: string; recipientId: string;
  amountCents: number; status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string; decidedAt: string | null;
};
export type RepaymentDraft = { requestId: string; recipientId: string; amountCents: number };
export type Summary = {
  receivableCents: number;
  payableCents: number;
  netCents: number;
};
export type GroupLedger = {
  members: { userId: string; displayName: string; netCents: number }[];
  suggestions: { fromUserId: string; toUserId: string; amountCents: number }[];
  incompleteBillIds: string[];
};
export type Bill = {
  mode: 'manual' | 'items';
  items?: import('./receipt-api').BillItem[];
  photo?: { draftId: string; expiresAt: string; expired?: boolean } | null;
  id: string;
  groupId: string;
  initiatorId: string;
  title: string;
  purchaseDate: string;
  notes: string;
  totalCents: number;
  submittedCents: number;
  differenceCents: number;
  confirmedCount: number;
  adjustmentCents: number | null;
  completedAt: string | null;
  canceledAt: string | null;
  revision: number;
  participants: {
    userId: string;
    displayName: string;
    imageUrl?: string | null; fallbackImageUrl?: string | null;
    isCurrentUser: boolean;
    amountCents: number | null;
    confirmedAt: string | null;
  }[];
};
export type BillDraft = {
  requestId: string;
  title: string;
  purchaseDate: string;
  timeZone: string;
  notes: string;
  totalCents: number;
  ownShareCents: number;
  participantIds: string[];
};
export type BillEdit = Omit<BillDraft, "requestId" | "ownShareCents"> & {
  revision: number;
};
export type ShareInput = {
  amountCents: number;
  expectedAmountCents: number | null;
  revision: number;
};
export function useBillApi() {
  const { getToken } = useAuth();
  const cache = useCachedRequest();
  return useMemo(() => {
    async function request<T>(
      path: string,
      method = "GET",
      body?: unknown,
      signal?: AbortSignal,
    ): Promise<T> {
      const key = `${path}`;
      const perform = async (readSignal?: AbortSignal): Promise<T> => {
        const token = await getToken();
        if (!token) throw new AccessError(401, "Please sign in again.");
        const response = await fetch(`/api${path}`, {
          method,
          signal: readSignal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new BillApiError(
            response.status,
            result?.error ?? "Request failed. Please try again.",
          );
        }
        return response.json();
      };
      if (method === 'GET' && key !== '/attention' && !key.startsWith('/bills/') && !key.endsWith('/invitation')) {
        return cachedRead<T>(cache, key);
      }
      const result = await perform(signal);
      if (method !== 'GET') await refreshFinancialQueries(cache);
      return result;
    }
    return {
      attention: (signal?: AbortSignal) =>
        request<{ actions: AttentionAction[] }>("/attention", "GET", undefined, signal),
      summary: (signal?: AbortSignal) =>
        request<{ summary: Summary }>("/summary", "GET", undefined, signal),
      list: (id: string, signal?: AbortSignal) =>
        request<{ bills: Bill[]; repayments: Repayment[]; summary: Summary; ledger: GroupLedger }>(
          `/groups/${encodeURIComponent(id)}/bills`,
          "GET",
          undefined,
          signal,
        ),
      recordRepayment: (id: string, draft: RepaymentDraft) =>
        request<{ repayment: Repayment }>(`/groups/${encodeURIComponent(id)}/repayments`, "POST", draft),
      decideRepayment: (id: string, decision: 'confirmed' | 'rejected') =>
        request<{ repayment: Repayment }>(`/repayments/${encodeURIComponent(id)}/decision`, "POST", { decision }),
      detail: (id: string, signal?: AbortSignal) =>
        request<{ bill: Bill }>(
          `/bills/${encodeURIComponent(id)}`,
          "GET",
          undefined,
          signal,
        ),
      create: (id: string, draft: BillDraft) =>
        request<{ bill: Bill }>(
          `/groups/${encodeURIComponent(id)}/bills`,
          "POST",
          draft,
        ),
      edit: (id: string, input: BillEdit) =>
        request<{ bill: Bill }>(
          `/bills/${encodeURIComponent(id)}`,
          "PATCH",
          input,
        ),
      cancel: (id: string, revision: number) =>
        request<{ bill: Bill }>(
          `/bills/${encodeURIComponent(id)}/cancel`,
          "POST",
          { revision },
        ),
      submit: (id: string, input: ShareInput) =>
        request<{ bill: Bill }>(
          `/bills/${encodeURIComponent(id)}/share`,
          "POST",
          input,
        ),
    };
  }, [getToken, cache]);
}
export type BillApi = ReturnType<typeof useBillApi>;
export const money = (cents: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100,
  );
export function parseMoney(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter an amount with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 1000000)
    throw new Error("Amounts cannot exceed CAD 10,000.00.");
  return result;
}
export function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
