import { Notification } from './Notification';
import { useCached, useCachedRequest } from './query-cache';
import { groupDeletedEvent, type GroupDeleted } from './group-sync';
import { AttentionList } from './AttentionList';
import { BillDetails, OverviewBalance } from './Bills';
import GroupWorkspace from './GroupWorkspace';
import { NewBillPage } from './ReceiptDraft';
import { useRoute, leaveDeletedGroup, routeBelongsToDeletedGroup } from './route';
import { useEffect, useRef, useState } from "react";
import AccountCheck from "../AccountCheck";
import { TopBar, type SignedInAccount } from './TopBar';
import { GroupDetails, JoinGroup } from './GroupDetails';
import { useGroupApi, errorMessage, evictDeletedGroup, deletedLocally, type GroupDetail, type GroupDraft, type GroupView } from './group-api';
import {
  CreateGroupDialog,
  GroupList,
} from "./Groups";
import {
  Button,
  Icon,
  Logo,
  SectionHeading,
} from "./ui";
import "./play.css";

// Home is the only top-level page; every other route belongs to a group or the account.
function goHome() { window.location.hash = ''; }
function openGroupDetails(group: GroupView) { window.location.hash = `/groups/${group.id}`; }
function openGroupPage(id: string) { window.location.hash = `/group-bills/${id}`; }
function openAccount() { window.location.hash = '/account'; }

export default function PlayApp({
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
      const listed = cache.getQueryData<{ groups: GroupView[] }>(['/groups'])?.groups.find(group => group.id === id)
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
  const selectedId = route.startsWith('#/groups/') ? route.slice('#/groups/'.length) : null;
  const billId = route.startsWith('#/bills/') ? route.slice('#/bills/'.length) : null;
  const newBill = route.match(/^#\/new-bill\/([^/]+)(?:\/([^/]+))?$/);
  const billGroupId = route.startsWith('#/group-bills/') ? route.slice('#/group-bills/'.length).split('?')[0] : null;
  const invitationToken = route.startsWith('#/join/') ? route.slice('#/join/'.length) : null;
  const accountPage = route === '#/account';
  const groupQuery = useCached<{ groups: GroupView[] }>('/groups');
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
        {!billId && !newBill && !groupPageId && <header className="page-header">
          <div>
            <div className="eyebrow">YOUR SHARED PURCHASES</div>
            <h1>
              {accountPage ? "Account" : (
                <>
                  Hey {displayName}, <span>all good?</span>
                  <Icon name="spark" />
                </>
              )}
            </h1>
            <p>
              {accountPage
                ? "Your signed-in ShareTally account."
                : "Good people. Shared plans. Everything in one place."}
            </p>
          </div>
          {!accountPage && (
            <Button onClick={() => setCreating(true)}>
              <Icon name="plus" />
              New group
            </Button>
          )}
        </header>}
        {deletionNotice && <Notification tone="info" onDismiss={() => setDeletionNotice('')}>{deletionNotice}</Notification>}
        {billId ? <BillDetails key={billId} id={billId} /> : newBill ? <NewBillPage key={`${newBill[1]}:${newBill[2] ?? "new"}`} groupId={newBill[1]} draftId={newBill[2]} /> : groupPageId ? <GroupWorkspace groups={groups} selectedId={groupPageId} selectedRepaymentId={new URLSearchParams(route.split('?')[1]).get('repayment') ?? undefined} loading={loading} error={error} retry={() => setRevision(value => value + 1)} onDeleted={goHome} /> : accountPage ? (
          <section className="account-panel">
            <AccountCheck />
          </section>
        ) : (
          <section>
            <OverviewBalance revision={`${route}:${revision}`} />
            <AttentionList revision={`${route}:${revision}`} />
            {loading && <p role="status">Loading groups…</p>}
            {error && <Notification>
              <p>{error}</p>
              <Button onClick={() => { setRevision(value => value + 1); }} disabled={loading}>Try again</Button>
            </Notification>}
            <SectionHeading title="Your people" count={groups.length} action="Refresh" onAction={() => { setRevision(value => value + 1); }} />
            {!loading && groupQuery.data && <GroupList
              groups={groups}
              onCreate={() => setCreating(true)}
              onOpen={group => openGroupPage(group.id)}
            />}
          </section>
        )}
        <footer className="page-footer">
          <Logo compact />
          <span>Made for the people you share life with.</span>
          <span>CAD</span>
        </footer>
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
