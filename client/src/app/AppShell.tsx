import { routes, parseRoute } from '../shared/browser/paths';
import './styles.css';
import { Notification } from '../shared/ui/Notification';
import { AppearancePicker } from '../theme/AppearancePicker';
import { useCached, useCachedRequest } from '../shared/api/query-cache';
import { groupDeletedEvent, type GroupDeleted } from '../shared/api/group-sync';
import { BillDetails } from '../features/bills/Bills';
import { Home } from '../features/home/Home';
import GroupWorkspace from './GroupWorkspace';
import { NewBillPage } from "../features/receipts/drafts/NewBillPage";
import { useRoute, leaveDeletedGroup, routeBelongsToDeletedGroup } from '../shared/browser/route';
import { useEffect, useRef, useState } from "react";
import AccountCheck from "../features/account/AccountCheck";
import { TopBar, type SignedInAccount } from './TopBar';
import { GroupDetails, JoinGroup } from '../features/groups/GroupDetails';
import { useGroupApi, evictDeletedGroup, deletedLocally, type GroupDetail, type GroupDraft, type GroupView, type ListedGroup } from "../features/groups/api";
import { errorMessage } from "../shared/api/error-message";
import { CreateGroupDialog } from "../features/groups/Groups";

// Home is the only top-level page; every other route belongs to a group or the account.
function goHome() { window.location.hash = routes.home; }
function openGroupDetails(group: GroupView) { window.location.hash = routes.group(group.id); }
function openGroupPage(id: string) { window.location.hash = routes.groupBills(id); }
function openAccount() { window.location.hash = routes.account; }

export default function AppShell({
  displayName,
  account,
}: {
  displayName: string;
  account: SignedInAccount;
}) {
  const api = useGroupApi();
  const cache = useCachedRequest();
  const [deletionNotice, setDeletionNotice] = useState('');
  const handledDeletions = useRef(new Set<string>());
  const knownGroups = useRef(new Map<string, GroupView>());
  useEffect(() => {
    function deleted(event: Event) {
      const { id, name } = (event as CustomEvent<GroupDeleted>).detail;
      if (handledDeletions.current.has(id) || deletedLocally(id)) return;
      const detail = cache.getQueryData<{ group: GroupDetail }>([`/groups/${id}`])?.group;
      const listed = cache.getQueryData<{ groups: ListedGroup[] }>(['/groups'])?.groups.find(group => group.id === id)
        ?? knownGroups.current.get(id);
      // A 404 for an unknown/unauthorized ID is not evidence of a deleted membership.
      if (!name && !detail && !listed) return;
      handledDeletions.current.add(id);
      const groupName = name ?? detail?.name ?? listed?.name;
      void evictDeletedGroup(cache, id);
      if (!detail?.isCreator && !listed?.isCreator) {
        setDeletionNotice(`${groupName} was deleted by the group creator`);
      }
      const route = window.location.hash;
      const billId = route.match(/^#\/bills\/([^/?#]+)/)?.[1];
      const billGroupId = billId
        ? cache.getQueryData<{ bill: { groupId: string } }>([`/bills/${billId}`])?.bill.groupId
        : undefined;
      if (routeBelongsToDeletedGroup(route, id, billGroupId)) leaveDeletedGroup();
    }
    window.addEventListener(groupDeletedEvent, deleted);
    return () => window.removeEventListener(groupDeletedEvent, deleted);
  }, [cache]);
  const route = useRoute();
  const { selectedId, billId, newBill, billGroupId, invitationToken, accountPage } = parseRoute(route);
  const groupQuery = useCached<{ groups: ListedGroup[] }>('/groups');
  useEffect(() => {
    for (const group of groupQuery.data?.groups ?? []) knownGroups.current.set(group.id, group);
  }, [groupQuery.data]);
  const groups = groupQuery.data?.groups ?? [];
  // Group details open over that group's page. A stale or foreign link has no page behind it.
  const detailsGroupListed = !!selectedId && groups.some(group => group.id === selectedId);
  const groupPageId = billGroupId ?? (detailsGroupListed ? selectedId : null);
  const [creating, setCreating] = useState(false);
  const loading = !groupQuery.data && !groupQuery.error;
  const error = groupQuery.error ? errorMessage(groupQuery.error) : '';
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    void api.list().catch(() => {});
  }, [api, revision]);

  const home = !billId && !newBill && !groupPageId && !accountPage;
  const notice = deletionNotice && <Notification tone="info" onDismiss={() => setDeletionNotice('')}>{deletionNotice}</Notification>;

  async function createGroup(draft: GroupDraft) {
    const { group } = await api.create(draft);
    setCreating(false);
    openGroupDetails(group);
  }

  return (
    <div className="play">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <TopBar account={account} openAccount={openAccount} />
      <main className="main-content" id="main-content" tabIndex={-1}>
        {accountPage && <header className="page-header">
          <div>
            <h1>Account</h1>
          </div>
        </header>}
        {!home && notice}
        {billId ? <BillDetails key={billId} id={billId} /> : newBill ? <NewBillPage key={`${newBill[1]}:${newBill[2] ?? "new"}`} groupId={newBill[1]} draftId={newBill[2]} /> : groupPageId ? <GroupWorkspace groups={groups} selectedId={groupPageId} selectedRepaymentId={new URLSearchParams(route.split('?')[1]).get('repayment') ?? undefined} loading={loading} error={error} retry={() => setRevision(value => value + 1)} onDeleted={goHome} /> : accountPage ? (
          <section className="account-panel">
            <AppearancePicker />
            <AccountCheck />
          </section>
        ) : (
          <Home name={displayName} groups={groupQuery.data?.groups} loading={loading} error={error}
            revision={revision} retry={() => setRevision(value => value + 1)} notice={notice}
            onCreate={() => setCreating(true)} />
        )}
      </main>
      {creating && (
        <CreateGroupDialog
          onClose={() => setCreating(false)}
          onCreate={createGroup}
        />
      )}
      {selectedId && <GroupDetails key={selectedId} id={selectedId} api={api}
        close={() => { if (detailsGroupListed) openGroupPage(selectedId); else goHome(); }}
        onDeleted={goHome} onViewBills={() => openGroupPage(selectedId)} />}
      {invitationToken !== null && <JoinGroup key={invitationToken} token={invitationToken} api={api} close={goHome}
        joined={group => openGroupPage(group.id)} />}

    </div>
  );
}
