import { useSyncSession } from '../shared/api/SyncSession';
import { routes, parseRoute } from '../shared/browser/paths';
import './styles.css';
import { Notification } from '../shared/ui/Notification';
import { AppearancePicker } from '../theme/AppearancePicker';
import { cachedRead, refreshFinancialQueries, useCached } from '../shared/api/query-cache';
import { useQueryClient } from '@tanstack/react-query';
import { groupAccessEndedEvents, groupDeletedEvent, groupMembershipEndedEvent, groupUnavailableEvent, startMemberSync, type GroupDeleted } from '../shared/api/group-sync';
import { BillDetails } from '../features/bills/Bills';
import { Home } from '../features/home/Home';
import GroupWorkspace from './GroupWorkspace';
import { NewBillPage } from "../features/receipts/drafts/NewBillPage";
import { useRoute, leaveDeletedGroup, routeBelongsToDeletedGroup } from '../shared/browser/route';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { clearGroupRecovery } from '../features/receipts/drafts/draft-recovery';
import AccountCheck from "../features/account/AccountCheck";
import { TopBar, type SignedInAccount } from './TopBar';
import { GroupDetails, JoinGroup } from '../features/groups/GroupDetails';
import { useGroupApi, evictDeletedGroup, deletedLocally, leftLocally, type GroupDetail, type GroupDraft, type GroupView, type ListedGroup } from "../features/groups/api";
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
  const cache = useQueryClient();
  const session = useSyncSession();
  const recoveryIdentity = useRef<string | undefined>(undefined);
  const recoveryCleanup = useRef(new Set<string>());
  const identityRead = useRef<Promise<void> | undefined>(undefined);
  const loadRecoveryIdentity = useCallback(() => {
    if (recoveryIdentity.current || identityRead.current) return;
    const pending = cachedRead<{ id: string }>(cache, '/me', session.signal).then(({ id }) => {
      recoveryIdentity.current = id;
      for (const groupId of recoveryCleanup.current) clearGroupRecovery(id, groupId);
      recoveryCleanup.current.clear();
    }).catch(() => {}).finally(() => { if (identityRead.current === pending) identityRead.current = undefined; });
    identityRead.current = pending;
  }, [cache, session]);
  const clearGroupDraftRecovery = useCallback((id: string) => {
    // Recovery uses the server member ID, not the Clerk account ID.
    const userId = recoveryIdentity.current
      ?? cache.getQueryData<{ group: GroupDetail }>([`/groups/${id}`])?.group.members.find(member => member.isCurrentUser)?.id;
    if (userId) clearGroupRecovery(userId, id);
    else { recoveryCleanup.current.add(id); loadRecoveryIdentity(); }
  }, [cache, loadRecoveryIdentity]);
  const [accessNotice, setAccessNotice] = useState('');
  const handledAccessEnds = useRef(new Set<string>());
  const knownGroups = useRef(new Map<string, GroupView>());
  useEffect(() => {
    function accessEnded(event: Event) {
      const { id, name, removed } = (event as CustomEvent<GroupDeleted>).detail;
      clearGroupDraftRecovery(id);
      if (handledAccessEnds.current.has(id)) return;
      const detail = cache.getQueryData<{ group: GroupDetail }>([`/groups/${id}`])?.group;
      const listed = cache.getQueryData<{ groups: ListedGroup[] }>(['/groups'])?.groups.find(group => group.id === id)
        ?? knownGroups.current.get(id);
      // A 404 for an unknown/unauthorized ID is not evidence of lost membership.
      if (!name && !detail && !listed) return;
      handledAccessEnds.current.add(id);
      knownGroups.current.delete(id);
      const groupName = name ?? detail?.name ?? listed?.name;
      const local = event.type === groupDeletedEvent ? deletedLocally(id)
        : event.type === groupMembershipEndedEvent ? leftLocally(id) : deletedLocally(id) || leftLocally(id);
      if (!local) {
        if (event.type === groupMembershipEndedEvent) {
          setAccessNotice(removed ? `You were removed from ${groupName}` : `You left ${groupName}`);
        } else if (event.type === groupUnavailableEvent) {
          setAccessNotice(`${groupName} is no longer available. It may have been deleted or your membership ended.`);
        } else if (!detail?.isOwner && !listed?.isOwner) {
          setAccessNotice(`${groupName} was deleted by the group owner`);
        }
      }
      const route = window.location.hash;
      const billId = route.match(/^#\/bills\/([^/?#]+)/)?.[1];
      const billGroupId = billId
        ? cache.getQueryData<{ bill: { groupId: string } }>([`/bills/${billId}`])?.bill.groupId
        : undefined;
      void evictDeletedGroup(cache, id);
      if (routeBelongsToDeletedGroup(route, id, billGroupId)) leaveDeletedGroup();
    }
    const events = groupAccessEndedEvents;
    for (const event of events) window.addEventListener(event, accessEnded);
    return () => { for (const event of events) window.removeEventListener(event, accessEnded); };
  }, [cache, clearGroupDraftRecovery]);
  const route = useRoute();
  const { selectedId, billId, newBill, billGroupId, invitationToken, accountPage } = parseRoute(route);
  const groupQuery = useCached<{ groups: ListedGroup[] }>('/groups');
  const listedGroupIds = useRef(new Set<string>());
  useEffect(() => {
    loadRecoveryIdentity();
    if (!groupQuery.data) return;
    const currentIds = new Set(groupQuery.data.groups.map(group => group.id));
    // Home has only a member-wide stream. Its authoritative list also revokes
    // recovery for groups lost while no group workspace or editor was mounted.
    for (const id of listedGroupIds.current) if (!currentIds.has(id)) clearGroupDraftRecovery(id);
    listedGroupIds.current = currentIds;
    for (const group of groupQuery.data.groups) {
      if (!knownGroups.current.has(group.id)) handledAccessEnds.current.delete(group.id);
      knownGroups.current.set(group.id, group);
    }
  }, [groupQuery.data, loadRecoveryIdentity, clearGroupDraftRecovery]);
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
  // A member of one of this account's groups was renamed, possibly this account
  // elsewhere: reread Home's groups and actions and this account's own names.
  // Pages within a group hear of renames from that group's stream instead, so
  // each tab holds one stream.
  const renamed = useEffectEvent(() => {
    // Replace any group read already in flight: it may predate the rename.
    void refreshFinancialQueries(cache);
    setRevision(value => value + 1);
    account.reload();
  });
  const spansGroups = home || accountPage;
  useEffect(() => {
    if (!spansGroups) return;
    const sync = startMemberSync({ session, changed: renamed });
    return () => sync.stop();
  }, [session, spansGroups]);
  // Without that stream, an edit on another device reaches this account's own
  // names when the member returns to the tab.
  const returned = useEffectEvent(() => account.reload());
  useEffect(() => {
    if (spansGroups) return;
    const visible = () => { if (document.visibilityState === 'visible') returned(); };
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', returned);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [spansGroups]);
  const notice = accessNotice && <Notification tone="info" onDismiss={() => setAccessNotice('')}>{accessNotice}</Notification>;

  function leftGroup(id: string) {
    clearGroupDraftRecovery(id);
    leaveDeletedGroup();
  }

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
        {billId ? <BillDetails key={billId} id={billId} /> : newBill ? <NewBillPage key={`${newBill[1]}:${newBill[2] ?? "new"}`} groupId={newBill[1]} draftId={newBill[2]} /> : groupPageId ? <GroupWorkspace groups={groups} selectedId={groupPageId} selectedRepaymentId={new URLSearchParams(route.split('?')[1]).get('repayment') ?? undefined} loading={loading} error={error} retry={() => setRevision(value => value + 1)} onDeleted={() => leftGroup(groupPageId)} /> : accountPage ? (
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
        onDeleted={() => leftGroup(selectedId)} onLeft={() => leftGroup(selectedId)} onViewBills={() => openGroupPage(selectedId)} />}
      {invitationToken !== null && <JoinGroup key={invitationToken} token={invitationToken} api={api} close={goHome}
        joined={group => openGroupPage(group.id)} />}

    </div>
  );
}
