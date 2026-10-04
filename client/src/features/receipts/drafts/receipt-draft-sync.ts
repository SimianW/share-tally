import { useSyncSession } from '../../../shared/api/SyncSession';
import { useEffect } from "react";
import { startGroupSync } from "../../../shared/api/group-sync";
import { useReceiptApi } from "../api";
import { type ReceiptDraft } from "@share-tally/domain/contracts/receipts";

// A `ready` event is an authoritative read too: it catches completions missed
// while the tab was disconnected or sleeping.
export function useReceiptDraftSync(
  groupId: string,
  draftId: string | null,
  apply: (drafts: ReceiptDraft[]) => void,
  status: (message: string) => void,
  enabled = true,
  retry = 0,
) {
  const session = useSyncSession();
  const api = useReceiptApi();
  useEffect(() => {
    if (!enabled) return;
    const sync = startGroupSync({
      groupId,
      session,
      read: async (signal) => draftId
        ? [ (await api.get(draftId, signal)).draft ]
        : (await api.list(groupId, signal)).drafts,
      apply,
      status,
    });
    return () => sync.stop();
  }, [groupId, draftId, session, api, apply, status, enabled, retry]);
}
