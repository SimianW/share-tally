import type { NotePhoto } from '@share-tally/domain/contracts/bills';
import { useMemo } from 'react';
import { BillApiError } from './bill-error';
import { useSyncSession } from './SyncSession';
import { createTransport } from './transport';

/** Note photos of bill drafts and bills. They change no revision, so no financial query needs refreshing. */
export function useNotePhotoApi() {
  const session = useSyncSession();
  const { getToken } = session;
  return useMemo(() => {
    const transport = createTransport(getToken, {
      unauthenticated: () => new BillApiError(401, 'Please sign in again.'),
      failed: ({ status, body }) => new BillApiError(status, body?.error || 'Request failed. Please try again.'),
    }, session);
    const add = async (path: string, base64: string) =>
      (await transport.json<{ notePhoto: NotePhoto }>(path, 'POST', { base64 })).notePhoto;
    return {
      addToDraft: (draftId: string, base64: string) => add(`/receipt-drafts/${encodeURIComponent(draftId)}/note-photos`, base64),
      addToBill: (billId: string, base64: string) => add(`/bills/${encodeURIComponent(billId)}/note-photos`, base64),
      remove: async (id: string) => { await transport.json(`/note-photos/${encodeURIComponent(id)}`, 'DELETE'); },
      // Binary photos keep their own protocol, as receipt photos do.
      bytes: async (id: string, signal: AbortSignal) => {
        const token = await getToken();
        const response = await fetch(`/api/note-photos/${encodeURIComponent(id)}`, {
          signal, headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Photo unavailable.');
        return response.blob();
      },
    };
  }, [getToken, session]);
}
