import { createTransport, type TokenProvider, type SessionLifetime } from './transport';
import { QueryClient, QueryCache, isCancelledError, useQuery, useQueryClient } from '@tanstack/react-query';

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

export async function refreshFinancialQueries(client: QueryClient, signal?: AbortSignal) {
  signal?.throwIfAborted();
  // Cancel obsolete reads before allowing a new server snapshot to populate the cache.
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => {
    const path = String(query.queryKey[0]);
    return path === '/groups' || path.startsWith('/groups/');
  } };
  await client.cancelQueries(filters);
  signal?.throwIfAborted();
  await client.invalidateQueries({ ...filters, refetchType: 'none' });
  await Promise.all(client.getQueryCache().findAll(filters).map(query => {
    const queryFn = query.options.queryFn;
    return typeof queryFn === 'function' ? client.fetchQuery({ queryKey: query.queryKey, queryFn }).catch(() => {}) : Promise.resolve();
  }));
  signal?.throwIfAborted();
}

export function hideProtectedQueries(client: QueryClient, path: string, error: Error) {
  const group = path.match(/^\/groups\/([^/]+)/)?.[1];
  const all = 'status' in error && error.status === 401;
  const listing = client.getQueryData<{ groups: { id: string }[] }>(['/groups']);
  const knownGroup = !!group && !!listing?.groups.some(item => item.id === group);
  if (!all && knownGroup) client.setQueryData(['/groups'], { groups: listing!.groups.filter(item => item.id !== group) });
  const affected = client.getQueryCache().findAll().filter(query => {
    const key = String(query.queryKey[0]);
    return all || key === path || (group && (key === `/groups/${group}` || key.startsWith(`/groups/${group}/`)));
  });
  for (const query of affected) {
    void client.cancelQueries({ queryKey: query.queryKey, exact: true }, { revert: false });
    query.setState({ data: undefined, error, status: 'error', fetchStatus: 'idle' });
  }
}

export function createSessionClient(getToken: TokenProvider, accessDenied: (path: string, error: AccessError) => void, lifetime: SessionLifetime) {
  const transport = createTransport(getToken, {
    unauthenticated: () => new AccessError(401, 'Please sign in again.'),
    failed: ({ status, body }) => new AccessError(status, body?.error ?? 'Request failed. Please try again.'),
  }, lifetime);
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => {
      if (denied(error)) {
        hideProtectedQueries(client, String(query.queryKey[0]), error);
        if (error instanceof AccessError) accessDenied(String(query.queryKey[0]), error);
      }
    } }),
    defaultOptions: { queries: {
      queryFn: ({ queryKey, signal }) => transport.json(String(queryKey[0]), 'GET', undefined, signal, false, 15_000),
      staleTime: 0, gcTime: 5 * 60_000, retry: false,
      refetchOnWindowFocus: false, refetchOnReconnect: false,
    } },
  });
  return client;
}

// Track actual callers, so leaving one view keeps a shared read alive, while
// invalidating every owner prevents its obsolete response from filling the cache.
const readers = new WeakMap<QueryClient, Map<string, Set<object>>>();
export async function cachedRead<T>(client: QueryClient, path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let paths = readers.get(client);
  if (!paths) { paths = new Map(); readers.set(client, paths); }
  let owners = paths.get(path);
  if (!owners) { owners = new Set(); paths.set(path, owners); }
  const owner = {};
  owners.add(owner);
  const release = () => {
    owners.delete(owner);
    if (!owners.size && paths.get(path) === owners) {
      paths.delete(path);
      if (signal?.aborted) void client.cancelQueries({ queryKey: [path], exact: true });
    }
  };
  signal?.addEventListener('abort', release, { once: true });
  try {
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      try { return await client.fetchQuery<T>({ queryKey: [path] }); }
      catch (error) { if (!isCancelledError(error) || signal?.aborted || attempt === 3) throw error; }
    }
  } finally { signal?.removeEventListener('abort', release); release(); }
}
