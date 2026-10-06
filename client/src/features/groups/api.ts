import type * as Contract from '@share-tally/domain/contracts/groups';
import type { GroupDeletionEligibility, GroupDeletionReason } from '@share-tally/domain/contracts/groups';
import type { IconName } from 'lucide-react/dynamic';
export type GroupDraft = Contract.GroupDraft<IconName>;
export type GroupView = Contract.GroupView<IconName>;
export type ListedGroup = Contract.ListedGroup<IconName>;
export type GroupDetail = Contract.GroupDetail<IconName>;
export type { GroupDeletionEligibility,GroupDeletionReason,MemberPreview } from '@share-tally/domain/contracts/groups';

import { useSyncSession } from '../../shared/api/SyncSession';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { AccessError, cachedRead, refreshFinancialQueries } from '../../shared/api/query-cache';
import { createTransport } from '../../shared/api/transport';

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
  cache.setQueryData<{ groups: ListedGroup[] }>(['/groups'], current => current && {
    groups: current.groups.filter(group => group.id !== id),
  });
}

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
  const session = useSyncSession();
  const { getToken } = session;
  const cache = useQueryClient();
  return useMemo(() => {
    const transport = createTransport(getToken, {
      unauthenticated: () => new AccessError(401, 'Please sign in again to continue.'),
      failed: ({ status, body }) => {
        const message = body?.error || `Request failed (${status}). Please try again.`;
        if (status === 409 && deletionReasons(body?.reasons))
          return new GroupDeletionAccessError(status, message, body.reasons);
        return new AccessError(status, message);
      },
    }, session);
    async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, committed?: (result: T) => Promise<void>): Promise<T> {
      const key = `/groups${path}`;
      // Read policy is selected by the endpoint; mutations preserve their commit ordering.
      const result = await transport.json<T>(key, method, body, signal);
      session.signal.throwIfAborted();
      await committed?.(result);
      if (method !== 'GET' && method !== 'DELETE') await refreshFinancialQueries(cache, session.signal);
      session.signal.throwIfAborted();
      return result;
    }
    async function rememberGroup({ group }: { group: ListedGroup | GroupDetail }) {
      // The successful write is authoritative even if the next list read fails.
      // Cancel an older list snapshot before inserting/replacing this membership.
      await cache.cancelQueries({ queryKey: ['/groups'], exact: true });
      session.signal.throwIfAborted();
      cache.setQueryData<{ groups: ListedGroup[] }>(['/groups'], current => {
        const existing = current?.groups ?? [];
        const listed = existing.find(item => item.id === group.id);
        const entry = asListed(group, listed);
        // A new membership is the most recently joined, so it goes last.
        return { groups: listed
          ? existing.map(item => item.id === group.id ? entry : item)
          : [...existing, entry] };
      });
    }
    return {
      list: (signal?: AbortSignal) => cachedRead<{ groups: ListedGroup[] }>(cache, '/groups', signal),
      create: (draft: GroupDraft) => request<{ group: ListedGroup }>('', 'POST', draft, undefined, rememberGroup),
      detail: (id: string, signal?: AbortSignal) => cachedRead<{ group: GroupDetail }>(cache, `/groups/${encodeURIComponent(id)}`, signal),
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
  }, [getToken, cache, session]);
}
export type GroupApi = ReturnType<typeof useGroupApi>;

// A join reply is the group's detail, without the list's balance. Keep the listed
// balance for a repeat join; otherwise the list read after the write supplies it.
function asListed(group: ListedGroup | GroupDetail, listed?: ListedGroup): ListedGroup {
  if (!('members' in group)) return group;
  const { members, ...view } = group;
  return {
    ...view,
    netCents: listed?.netCents ?? null,
    pendingActionCount: listed?.pendingActionCount ?? null,
    memberPreview: listed?.memberPreview ?? members.slice(0, 4).map(member => ({
      id: member.id, displayName: member.displayName,
      imageUrl: member.imageUrl ?? null, fallbackImageUrl: member.fallbackImageUrl ?? null,
    })),
  };
}
