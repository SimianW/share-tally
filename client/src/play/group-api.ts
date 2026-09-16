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
  return useMemo(() => {
    async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again to continue.');
      const response = await fetch(`/api/groups${path}`, {
        method, signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || `Request failed (${response.status}). Please try again.`);
      }
      return response.json();
    }
    return {
      list: (signal?: AbortSignal) => request<{ groups: GroupView[] }>('', 'GET', undefined, signal),
      create: (draft: GroupDraft) => request<{ group: GroupView }>('', 'POST', draft),
      detail: (id: string, signal?: AbortSignal) => request<{ group: GroupDetail }>(`/${encodeURIComponent(id)}`, 'GET', undefined, signal),
      invitation: (id: string, regenerate = false) => request<{ path: string }>(`/${encodeURIComponent(id)}/invitation`, regenerate ? 'POST' : 'GET'),
      join: (token: string) => request<{ group: GroupDetail }>('/join', 'POST', { token }),
    };
  }, [getToken]);
}
export type GroupApi = ReturnType<typeof useGroupApi>;
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
