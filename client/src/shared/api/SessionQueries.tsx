import { useAuth } from '@clerk/react';
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { SyncSessionContext } from './SyncSession';
import { createSyncSession } from './notification-channel';
import { AccessError, hideProtectedQueries, createSessionClient } from './query-cache';

// Remounted by user ID; only this account can observe this in-memory cache.
export function SessionQueries({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const [{ client, sync }] = useState(() => {
    const client = createSessionClient(options => sync.getToken(options), (path, error) => sync.accessDenied(path, error), {
      get signal() { return sync.signal; }, authenticationLost: () => sync.authenticationLost(),
    });
    const sync = createSyncSession(getToken, () => hideProtectedQueries(client, '/groups', new AccessError(401, 'Please sign in again.')));
    return { client, sync };
  });
  useEffect(() => sync.retain(() => client.clear()), [client, sync]);
  return <QueryClientProvider client={client}><SyncSessionContext.Provider value={sync}>{children}</SyncSessionContext.Provider></QueryClientProvider>;
}
