import { AccessError, cachedRead, useCachedRequest, refreshFinancialQueries } from './query-cache';
import { useMemo } from "react";
import { useAuth } from "@clerk/react";
export type ItemConflicts = {
  stale: (
    | { itemId: string; kind: "changed"; finalCents: number; name: string }
    | { itemId: string; kind: "added" | "removed" }
  )[];
  overAllocated: { itemId: string; available: { numerator: string; denominator: string } }[];
};
export class BillApiError extends Error {
  status: number;
  conflicts?: ItemConflicts;
  constructor(status: number, message: string, conflicts?: ItemConflicts) {
    super(message);
    this.status = status;
    this.conflicts = conflicts;
  }
}
export type AttentionAction = { groupId: string; groupName: string } & (
  | { kind: 'missing-share' | 'confirm-share'; billId: string; title: string; amountCents: number | null; mode: 'manual' | 'items' }
  | { kind: 'review-repayment'; repaymentId: string; senderName: string; amountCents: number }
  | { kind: 'review-draft'; draftId: string; title: string; processingStatus: 'ready' | 'fallback'; amountCents: number | null }
);
export type Repayment = {
  id: string; groupId: string; senderId: string; recipientId: string;
  amountCents: number; status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string; decidedAt: string | null;
};
export type RepaymentDraft = { requestId: string; recipientId: string; amountCents: number };
// Starting values for Record repayment, e.g. from a suggested transfer.
export type RepaymentPrefill = Omit<RepaymentDraft, 'requestId'>;
export type Summary = {
  receivableCents: number;
  payableCents: number;
  netCents: number;
};
// A complete bill or confirmed repayment with each affected member's signed
// effect. A member's effects across all entries sum to their net balance.
// Entries arrive in the order they took effect: completion or confirmation time.
export type LedgerEntry =
  | { kind: 'bill'; id: string; title: string; purchaseDate: string; completedAt: string; initiatorId: string; totalCents: number;
      effects: { userId: string; paidCents: number; shareCents: number; adjustmentCents: number; netCents: number }[] }
  | { kind: 'repayment'; id: string; senderId: string; recipientId: string; amountCents: number; decidedAt: string;
      effects: { userId: string; netCents: number }[] };
export type GroupLedger = {
  members: { userId: string; displayName: string; netCents: number }[];
  // Each suggestion's amount is what its payer directly owes its recipient plus
  // what the fewest-transfers simplification passed along (either may be negative).
  suggestions: { fromUserId: string; toUserId: string; amountCents: number; explanation: {
    directCents: number;
    // Entries between the two, signed from the payer's side, in entry order.
    directLines: { entryId: string; cents: number }[];
    passedAlongCents: number;
  } }[];
  incompleteBillIds: string[];
  entries: LedgerEntry[];
  // What one member owes another from their own entries, netted per pair; positive.
  directDebts: { fromUserId: string; toUserId: string; amountCents: number }[];
};
export type Bill = {
  mode: 'manual' | 'items';
  items?: import('./receipt-api').BillItem[];
  receipt?: import('./receipt-api').ReceiptPricing & { totalCents: number } | null;
  frozenTaxRate?: { taxCents: number; taxableBaseCents: number } | null;
  frozenDiscountBaseCents?: number | null;
  frozenExtraBaseCents?: number | null;
  photo?: { draftId: string; expiresAt: string; expired?: boolean; pages?: import('./receipt-api').ReceiptPage[] } | null;
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
  participantIds: string[];
};
export type BillEdit = Omit<BillDraft, "requestId"> & {
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
