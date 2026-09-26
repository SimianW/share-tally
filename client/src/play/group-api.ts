import { AccessError, cachedRead, useCachedRequest, refreshFinancialQueries } from './query-cache';
import type { QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth } from '@clerk/react';
import type { GroupIcon } from './group-icon';

// Mark before the DELETE request: its SSE event can arrive before the HTTP reply.
const locallyDeletedGroups = new Set<string>();
export function deletedLocally(id: string) { return locallyDeletedGroups.has(id); }

export async function evictDeletedGroup(cache: QueryClient, id: string) {
  const groupPath = `/groups/${id}`;
  const scoped = { predicate: (query: { queryKey: readonly unknown[] }) => {
    const path = String(query.queryKey[0]);
    return path === groupPath || path.startsWith(`${groupPath}/`);
  } };
  await cache.cancelQueries(scoped);
  cache.removeQueries(scoped);
  await cache.cancelQueries({ queryKey: ['/groups'], exact: true });
  cache.setQueryData<{ groups: GroupView[] }>(['/groups'], current => current && {
    groups: current.groups.filter(group => group.id !== id),
  });
  await cache.invalidateQueries({ queryKey: ['/summary'], exact: true });
}

export type GroupDraft = { name: string; icon: GroupIcon };
export type GroupView = GroupDraft & {
  id: string;
  createdBy: string;
  createdAt: string;
  creatorName: string;
  creatorImageUrl?: string | null;
  creatorFallbackImageUrl?: string | null;
  memberCount: number;
  isCreator: boolean;
};
export type GroupDetail = GroupView & {
  members: { id: string; displayName: string; imageUrl?: string | null; fallbackImageUrl?: string | null; joinedAt: string; isCreator: boolean; isCurrentUser: boolean }[];
};
export type GroupDeletionReason =
  | { code: 'incomplete_bills'; count: number }
  | { code: 'pending_repayments'; count: number }
  | { code: 'nonzero_balances'; members: { userId: string; displayName: string; netCents: number }[] };
export type GroupDeletionEligibility = { eligible: boolean; reasons: GroupDeletionReason[] };

export class GroupDeletionAccessError extends AccessError {
  reasons: GroupDeletionReason[];
  constructor(status: number, message: string, reasons: GroupDeletionReason[]) {
    super(status, message);
    this.reasons = reasons;
  }
}

function deletionReasons(value: unknown): value is GroupDeletionReason[] {
  return Array.isArray(value) && value.length > 0 && value.every(reason => {
    if (!reason || typeof reason !== 'object') return false;
    if (reason.code === 'incomplete_bills' || reason.code === 'pending_repayments')
      return Number.isSafeInteger(reason.count) && reason.count > 0;
    return reason.code === 'nonzero_balances' && Array.isArray(reason.members) && reason.members.length > 0 &&
      reason.members.every((member: unknown) => member !== null && typeof member === 'object' &&
        'userId' in member && typeof member.userId === 'string' &&
        'displayName' in member && typeof member.displayName === 'string' &&
        'netCents' in member && Number.isSafeInteger(member.netCents) && member.netCents !== 0);
  });
}

export function useGroupApi() {
  const { getToken } = useAuth();
  const cache = useCachedRequest();
  return useMemo(() => {
    async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, committed?: (result: T) => Promise<void>): Promise<T> {
      const key = `/groups${path}`;
      const perform = async (readSignal?: AbortSignal): Promise<T> => {
        const token = await getToken();
        if (!token) throw new AccessError(401, 'Please sign in again to continue.');
        const response = await fetch(`/api/groups${path}`, {
          method, signal: readSignal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => null);
          const message = error?.error || `Request failed (${response.status}). Please try again.`;
          if (response.status === 409 && deletionReasons(error?.reasons))
            throw new GroupDeletionAccessError(response.status, message, error.reasons);
          throw new AccessError(response.status, message);
        }
        return response.json();
      };
      // Eligibility is a fresh, abortable check each time the delete dialog opens or retries.
      if (method === 'GET' && key !== '/attention' && !key.startsWith('/bills/') && !key.endsWith('/invitation') && !key.endsWith('/deletion')) {
        return cachedRead<T>(cache, key);
      }
      const result = await perform(signal);
      await committed?.(result);
      if (method !== 'GET' && method !== 'DELETE') await refreshFinancialQueries(cache);
      return result;
    }
    async function rememberGroup({ group }: { group: GroupView }) {
      // The successful write is authoritative even if the next list read fails.
      // Cancel an older list snapshot before inserting/replacing this membership.
      await cache.cancelQueries({ queryKey: ['/groups'], exact: true });
      cache.setQueryData<{ groups: GroupView[] }>(['/groups'], current => {
        const existing = current?.groups ?? [];
        return { groups: existing.some(item => item.id === group.id)
          ? existing.map(item => item.id === group.id ? group : item)
          : [group, ...existing] };
      });
    }
    return {
      list: (signal?: AbortSignal) => request<{ groups: GroupView[] }>('', 'GET', undefined, signal),
      create: (draft: GroupDraft) => request<{ group: GroupView }>('', 'POST', draft, undefined, rememberGroup),
      detail: (id: string, signal?: AbortSignal) => request<{ group: GroupDetail }>(`/${encodeURIComponent(id)}`, 'GET', undefined, signal),
      deletion: (id: string, signal?: AbortSignal) => request<GroupDeletionEligibility>(`/${encodeURIComponent(id)}/deletion`, 'GET', undefined, signal),
      invitation: (id: string, regenerate = false) => request<{ path: string }>(`/${encodeURIComponent(id)}/invitation`, regenerate ? 'POST' : 'GET'),
      join: (token: string) => request<{ group: GroupDetail }>('/join', 'POST', { token }, undefined, rememberGroup),
      delete: async (id: string) => {
        locallyDeletedGroups.add(id);
        try {
          return await request<{ deleted: true }>(`/${encodeURIComponent(id)}`, 'DELETE', undefined, undefined,
            async () => { await evictDeletedGroup(cache, id); });
        } catch (error) {
          locallyDeletedGroups.delete(id);
          throw error;
        }
      },
    };
  }, [getToken, cache]);
}
export type GroupApi = ReturnType<typeof useGroupApi>;
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
