import { useAuth } from '@clerk/react';
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createSessionClient } from './query-cache';

// Remounted by user ID; only this account can observe this in-memory cache.
export function SessionQueries({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const [client] = useState(() => createSessionClient(getToken));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
