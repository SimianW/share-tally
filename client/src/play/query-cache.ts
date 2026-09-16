import { QueryClient, QueryCache, useQuery, useQueryClient } from '@tanstack/react-query';

export class AccessError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function denied(error: unknown) {
  return error instanceof Error && 'status' in error && [401, 403, 404].includes(Number(error.status));
}

export function useCached<T>(path: string) {
  const result = useQuery<T>({ queryKey: [path], enabled: false });
  return { ...result, data: denied(result.error) ? undefined : result.data };
}

export function useCachedRequest() {
  const client = useQueryClient();
  return client;
}

export async function refreshFinancialQueries(client: QueryClient) {
  // Cancel obsolete reads before allowing a new server snapshot to populate the cache.
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => {
    const path = String(query.queryKey[0]);
    return path === '/summary' || path === '/groups' || path.startsWith('/groups/');
  } };
  await client.cancelQueries(filters);
  await client.invalidateQueries({ ...filters, refetchType: 'none' });
  await Promise.all(client.getQueryCache().findAll(filters).map(query => {
    const queryFn = query.options.queryFn;
    return typeof queryFn === 'function' ? client.fetchQuery({ queryKey: query.queryKey, queryFn }).catch(() => {}) : Promise.resolve();
  }));
}

export function hideProtectedQueries(client: QueryClient, path: string, error: Error) {
  const group = path.match(/^\/groups\/([^/]+)/)?.[1];
  const all = 'status' in error && error.status === 401;
  const listing = client.getQueryData<{ groups: { id: string }[] }>(['/groups']);
  const knownGroup = !!group && !!listing?.groups.some(item => item.id === group);
  if (!all && knownGroup) client.setQueryData(['/groups'], { groups: listing!.groups.filter(item => item.id !== group) });
  const affected = client.getQueryCache().findAll().filter(query => {
    const key = String(query.queryKey[0]);
    return all || key === path || (knownGroup && key === '/summary') || (group && (key === `/groups/${group}` || key.startsWith(`/groups/${group}/`)));
  });
  for (const query of affected) {
    void client.cancelQueries({ queryKey: query.queryKey, exact: true }, { revert: false });
    query.setState({ data: undefined, error, status: 'error', fetchStatus: 'idle' });
  }
}

export function createSessionClient(getToken: () => Promise<string | null>) {
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => {
      if (denied(error)) hideProtectedQueries(client, String(query.queryKey[0]), error);
    } }),
    defaultOptions: { queries: {
      queryFn: async ({ queryKey, signal }) => {
        const token = await getToken();
        if (!token) throw new AccessError(401, 'Please sign in again.');
        const response = await fetch(`/api${queryKey[0]}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new AccessError(response.status, body?.error ?? 'Request failed. Please try again.');
        }
        return response.json();
      },
      staleTime: 0, gcTime: 5 * 60_000, retry: false,
      refetchOnWindowFocus: false, refetchOnReconnect: false,
    } },
  });
  return client;
}

export function cachedRead<T>(client: QueryClient, path: string) {
  return client.fetchQuery<T>({ queryKey: [path] });
}
