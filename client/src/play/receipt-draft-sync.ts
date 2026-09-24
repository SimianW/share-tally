import { useAuth } from "@clerk/react";
import { useEffect } from "react";
import { startGroupSync } from "./group-sync";
import { useReceiptApi, type ReceiptDraft } from "./receipt-api";

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
  const { getToken } = useAuth();
  const api = useReceiptApi();
  useEffect(() => {
    if (!enabled) return;
    const sync = startGroupSync({
      groupId,
      getToken,
      read: async (signal) => draftId
        ? [ (await api.get(draftId, signal)).draft ]
        : (await api.list(groupId, signal)).drafts,
      apply,
      status,
    });
    return () => sync.stop();
  }, [groupId, draftId, getToken, api, apply, status, enabled, retry]);
}
