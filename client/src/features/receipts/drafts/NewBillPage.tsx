import { useSyncSession } from '../../../shared/api/SyncSession';
import { routes } from '../../../shared/browser/paths';
import { ReceiptDraftForm } from './ReceiptDraft';
import { useEffect, useRef, useState } from "react";
import { startGroupSync } from "../../../shared/api/group-sync";
import { useGroupApi, type GroupDetail } from "../../groups/api";
import { Notification } from "../../../shared/ui/Notification";
import { Button } from "../../../shared/ui/Button";

export function NewBillPage({ groupId, draftId }: { groupId: string; draftId?: string }) {
  const api = useGroupApi();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState("");
  const session = useSyncSession();
  const live = useRef<ReturnType<typeof startGroupSync> | null>(null);
  useEffect(() => {
    const sync = startGroupSync({
      groupId, session, read: signal => api.detail(groupId, signal),
      apply: ({ group }) => setGroup(group), status: setError,
      accessDenied: () => setGroup(null),
    });
    live.current = sync;
    return () => { sync.stop(); live.current = null; };
  }, [api, groupId, session]);
  return <section className="receipt-page">
    {error && <Notification tone="error" title="Could not open this group"><p>{error}</p><Button onClick={() => live.current?.retry()}>Try again</Button></Notification>}
    {!group && !error && <p role="status">Opening group…</p>}
    {group && <ReceiptDraftForm group={group} id={draftId} close={() => { window.location.hash = routes.groupBills(groupId); }} created={bill => { window.location.hash = routes.bill(bill.id); }} />}
  </section>;
}
