import { AccessError, cachedRead, useCachedRequest, refreshFinancialQueries } from './query-cache';
import { useMemo } from 'react';
import { useAuth } from '@clerk/react';
import type { GroupIcon } from './group-icon';

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
          throw new AccessError(response.status, error?.error || `Request failed (${response.status}). Please try again.`);
        }
        return response.json();
      };
      if (method === 'GET' && key !== '/attention' && !key.startsWith('/bills/') && !key.endsWith('/invitation')) {
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
      invitation: (id: string, regenerate = false) => request<{ path: string }>(`/${encodeURIComponent(id)}/invitation`, regenerate ? 'POST' : 'GET'),
      join: (token: string) => request<{ group: GroupDetail }>('/join', 'POST', { token }, undefined, rememberGroup),
      delete: (id: string) => request<{ deleted: true }>(`/${encodeURIComponent(id)}`, 'DELETE', undefined, undefined, async () => {
        // A successful deletion is authoritative; remove obsolete group data before refetching.
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
        await refreshFinancialQueries(cache);
      }),
    };
  }, [getToken, cache]);
}
export type GroupApi = ReturnType<typeof useGroupApi>;
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
