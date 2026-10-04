import { createTransport } from '../../shared/api/transport';
import { useSyncSession } from '../../shared/api/SyncSession';
import type { AttentionAction } from '@share-tally/domain/contracts/attention';
import type { Bill, BillDraft, BillEdit, ShareInput } from '@share-tally/domain/contracts/bills';
import type { GroupLedger, Summary } from '@share-tally/domain/contracts/ledger';
import type { Repayment, RepaymentDraft } from '@share-tally/domain/contracts/repayments';
import { useMemo } from "react";
import { BillApiError } from '../../shared/api/bill-error';
import { AccessError, cachedRead, refreshFinancialQueries, useCachedRequest } from '../../shared/api/query-cache';
export function useBillApi() {
  const session = useSyncSession();
  const { getToken } = session;
  const cache = useCachedRequest();
  return useMemo(() => {
    const transport = createTransport(getToken, {
      unauthenticated: () => new AccessError(401, 'Please sign in again.'),
      failed: ({ status, body }) => new BillApiError(status, body?.error ?? 'Request failed. Please try again.'),
    }, session);
    async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
      const result = await transport.json<T>(path, method, body, signal);
      if (method !== 'GET') await refreshFinancialQueries(cache, session.signal);
      session.signal.throwIfAborted();
      return result;
    }
    return {
      attention: (signal?: AbortSignal) =>
        request<{ actions: AttentionAction[] }>("/attention", "GET", undefined, signal),
      list: (id: string, signal?: AbortSignal) =>
        cachedRead<{ bills: Bill[]; repayments: Repayment[]; summary: Summary; ledger: GroupLedger }>(cache, `/groups/${encodeURIComponent(id)}/bills`, signal),
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
  }, [getToken, cache, session]);
}
export type BillApi = ReturnType<typeof useBillApi>;
