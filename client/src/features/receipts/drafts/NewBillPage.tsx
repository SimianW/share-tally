import { useSyncSession } from '../../../shared/api/SyncSession';
import { routes } from '../../../shared/browser/paths';
import { ReceiptDraftForm } from './ReceiptDraft';
import { useEffect, useRef, useState } from "react";
import { startGroupSync } from "../../../shared/api/group-sync";
import { AccessError, hideProtectedQueries, useCached } from "../../../shared/api/query-cache";
import { useQueryClient } from "@tanstack/react-query";
import { useGroupApi, type GroupDetail } from "../../groups/api";
import { Notification } from "../../../shared/ui/Notification";
import { Button } from "../../../shared/ui/Button";

export function NewBillPage({ groupId, draftId }: { groupId: string; draftId?: string }) {
  const api = useGroupApi();
  const cache = useQueryClient();
  const [applied, setApplied] = useState<GroupDetail | null>(null);
  const [error, setError] = useState("");
  const [accessLost, setAccessLost] = useState(false);
  // The group page's cached details show the form until the first snapshot applies.
  // Access loss hides them here at once and from the cache for later pages.
  const cached = useCached<{ group: GroupDetail }>(`/groups/${groupId}`).data?.group;
  const group = accessLost ? null : applied ?? cached ?? null;
  const session = useSyncSession();
  const live = useRef<ReturnType<typeof startGroupSync> | null>(null);
  useEffect(() => {
    const sync = startGroupSync({
      groupId, session, read: signal => api.detail(groupId, signal),
      // A read begun before this notification, such as one refreshed by an early
      // draft save, may predate the subscription and must not be reused.
      invalidateRead: () => void cache.cancelQueries({ queryKey: [`/groups/${groupId}`], exact: true }),
      apply: ({ group }) => setApplied(group), status: setError,
      accessDenied: (status, error) => {
        setAccessLost(true);
        hideProtectedQueries(cache, `/groups/${groupId}`, error ?? new AccessError(status, status === 401 ? 'Please sign in again.' : 'Group not found.'));
      },
    });
    live.current = sync;
    return () => { sync.stop(); live.current = null; };
  }, [api, cache, groupId, session]);
  return <section className="receipt-page">
    {error && <Notification tone="error" title="Could not open this group"><p>{error}</p>{!accessLost && <Button onClick={() => live.current?.retry()}>Try again</Button>}</Notification>}
    {!group && !error && <p role="status">Opening group…</p>}
    {group && <ReceiptDraftForm group={group} id={draftId} close={() => { window.location.hash = routes.groupBills(groupId); }} created={bill => { window.location.hash = routes.bill(bill.id); }} />}
  </section>;
}
