import { useSyncSession } from '../shared/api/SyncSession';
import { routes } from '../shared/browser/paths';
import { useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../shared/api/error-message";
import { startGroupSync } from '../shared/api/group-sync';
import { AccessError, denied, hideProtectedQueries, useCached, useCachedRequest } from '../shared/api/query-cache';
import { LoadingFinancials } from '../shared/ui/LoadingFinancials';
import { Notification } from '../shared/ui/Notification';
import { Button } from "../shared/ui/Button";
import { useBillApi } from "../features/bills/api";
import { useGroupApi, type GroupDetail } from "../features/groups/api";
import { GroupDetails } from "../features/groups/GroupDetails";
import { GroupPage } from './GroupPage';
import { ReceiptDrafts } from "../features/receipts/drafts/ReceiptDrafts";

// `title` renders the heading for the group, which is undefined until the group page loads.
export function GroupBills({ id, selectedRepaymentId, onDeleted, title }: {
  id: string;
  selectedRepaymentId?: string;
  onDeleted: () => void;
  title: (group: GroupDetail | undefined) => ReactNode;
}) {
  const [membersOpen, setMembersOpen] = useState(false);
  const api = useBillApi();
  const groups = useGroupApi();
  const cache = useCachedRequest();
  const billsQuery = useCached<Awaited<ReturnType<typeof api.list>>>(`/groups/${id}/bills`);
  const groupQuery = useCached<{ group: GroupDetail }>(`/groups/${id}`);
  const accessError = [billsQuery.error, groupQuery.error].find(denied);
  const data = !accessError && billsQuery.data && groupQuery.data ? { ...billsQuery.data, ...groupQuery.data } : null;
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const session = useSyncSession();
  const live = useRef<ReturnType<typeof startGroupSync> | null>(null);
  useEffect(() => {
    const sync = startGroupSync({
      groupId: id, session,
      invalidateRead: () => {
        // A response begun before this notification must never replace newer state.
        void cache.cancelQueries({ queryKey: [`/groups/${id}/bills`], exact: true });
        void cache.cancelQueries({ queryKey: [`/groups/${id}`], exact: true });
      },
      accessDenied: (status, error) => hideProtectedQueries(cache, `/groups/${id}`, error ?? new AccessError(status, status === 401 ? 'Please sign in again.' : 'Group not found.')),
      read: async signal => {
        const [bills, group] = await Promise.all([api.list(id, signal), groups.detail(id, signal)]);
        return { ...bills, ...group };
      },
      apply: () => {
        // Ready/changed events also cover another member's actions and receipt
        // processing finishing after the original upload response.
        void cache.cancelQueries({ queryKey: ['/groups'], exact: true })
          .then(() => groups.list()).catch(() => {});
      },
      status: setError,
    });
    live.current = sync;
    return () => { sync.stop(); live.current = null; };
  }, [api, groups, session, id, revision, cache]);
  function closeMembers() {
    setMembersOpen(false);
    live.current?.retry();
  }
  return <>
    {data ? <GroupPage data={data} title={title(data.group)} api={api} selectedRepaymentId={selectedRepaymentId}
      openMembers={() => setMembersOpen(true)} refresh={() => live.current?.retry()}
      drafts={<ReceiptDrafts key={`${id}:${revision}`} groupId={id} open={draftId => { window.location.hash = routes.newBill(id, draftId); }} />} />
      : <section className="group-page">
        <header className="group-page-heading"><div className="group-page-title">{title(undefined)}</div></header>
        {(error || accessError) && <Notification><p>{accessError ? errorMessage(accessError) : "Couldn't load this group."}</p><Button onClick={() => setRevision(n => n + 1)}>Try again</Button></Notification>}
        <LoadingFinancials label="Loading group" />
      </section>}
    {data && error && <Notification><p>{error}</p><Button onClick={() => live.current?.retry()}>Try again</Button></Notification>}
    {membersOpen && <GroupDetails id={id} api={groups} close={closeMembers} onDeleted={onDeleted} />}
  </>;
}
