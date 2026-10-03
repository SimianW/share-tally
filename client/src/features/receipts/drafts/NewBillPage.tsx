import { routes } from '../../../shared/browser/paths';
import { ReceiptDraftForm } from './ReceiptDraft';
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { startGroupSync } from "../../../shared/api/group-sync";
import { errorMessage } from "../../../shared/api/error-message";
import { useGroupApi, type GroupDetail } from "../../groups/api";
import { Notification } from "../../../shared/ui/Notification";
import { Button } from "../../../shared/ui/Button";

export function NewBillPage({ groupId, draftId }: { groupId: string; draftId?: string }) {
  const api = useGroupApi();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    api.detail(groupId).then(({ group }) => {
      if (live) { setGroup(group); setError(""); }
    }).catch((e) => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [api, groupId, retry]);
  // Members and their current names follow the group while the bill is written.
  // A failed reread keeps the members already shown.
  const { getToken } = useAuth();
  const opened = group !== null;
  useEffect(() => {
    if (!opened) return;
    const sync = startGroupSync({
      groupId, getToken, read: signal => api.detail(groupId, signal), apply: ({ group }) => setGroup(group), status: () => {},
    });
    return () => sync.stop();
  }, [opened, api, groupId, getToken]);
  return <section className="receipt-page">
    {error && <Notification tone="error" title="Could not open this group"><p>{error}</p><Button onClick={() => setRetry(n => n + 1)}>Try again</Button></Notification>}
    {!group && !error && <p role="status">Opening group…</p>}
    {group && <ReceiptDraftForm group={group} id={draftId} close={() => { window.location.hash = routes.groupBills(groupId); }} created={bill => { window.location.hash = routes.bill(bill.id); }} />}
  </section>;
}
