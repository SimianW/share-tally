import { useMemo } from "react";
import { useAuth } from "@clerk/react";
export class BillApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export type Summary = {
  receivableCents: number;
  payableCents: number;
  netCents: number;
};
export type Bill = {
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
export type BillEdit = Omit<BillDraft, "requestId" | "ownShareCents"> & { revision: number };
export type ShareInput = { amountCents: number; expectedAmountCents: number | null; revision: number };
export function useBillApi() {
  const { getToken } = useAuth();
  return useMemo(() => {
    async function request<T>(
      path: string,
      method = "GET",
      body?: unknown,
      signal?: AbortSignal,
    ): Promise<T> {
      const token = await getToken();
      if (!token) throw new Error("Please sign in again.");
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
        const result = await response.json().catch(() => null);
        throw new BillApiError(
          response.status,
          result?.error ?? "Request failed. Please try again.",
        );
      }
      return response.json();
    }
    return {
      summary: (signal?: AbortSignal) =>
        request<{ summary: Summary }>("/summary", "GET", undefined, signal),
      list: (id: string, signal?: AbortSignal) =>
        request<{ bills: Bill[]; summary: Summary }>(
          `/groups/${encodeURIComponent(id)}/bills`,
          "GET",
          undefined,
          signal,
        ),
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
      edit: (id: string, input: BillEdit) => request<{ bill: Bill }>(`/bills/${encodeURIComponent(id)}`, "PATCH", input),
      change: (id: string, action: "reopen" | "cancel", revision: number) => request<{ bill: Bill }>(`/bills/${encodeURIComponent(id)}/${action}`, "POST", { revision }),
      submit: (id: string, input: ShareInput) =>
        request<{ bill: Bill }>(
          `/bills/${encodeURIComponent(id)}/share`,
          "POST",
          input,
        ),
    };
  }, [getToken]);
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
