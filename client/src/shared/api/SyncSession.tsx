import { createContext, useContext } from 'react';
import type { SyncSession } from './notification-channel';

export const SyncSessionContext = createContext<SyncSession | null>(null);
export function useSyncSession() {
  const session = useContext(SyncSessionContext);
  if (!session) throw new Error('Synchronization requires an authenticated session');
  return session;
}
