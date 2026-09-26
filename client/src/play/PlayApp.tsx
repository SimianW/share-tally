import { Notification } from './Notification';
import { useCached, useCachedRequest } from './query-cache';
import { groupDeletedEvent, type GroupDeleted } from './group-sync';
import { AttentionList } from './AttentionList';
import { BillDetails, OverviewBalance } from './Bills';
import GroupWorkspace from './GroupWorkspace';
import { NewBillPage } from './ReceiptDraft';
import { useRoute, leaveDeletedGroup } from './route';
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import AccountCheck from "../AccountCheck";
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
  type IconName,
} from "./ui";
import "./play.css";

const navigation: {
  id: "overview" | "groups" | "account";
  label: string;
  icon: IconName;
}[] = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "groups", label: "My groups", icon: "people" },
  { id: "account", label: "Account", icon: "settings" },
];

function goToGroup(group: GroupView) { window.location.hash = `/groups/${group.id}`; }
function closeGroup() { window.location.hash = ''; }

export default function PlayApp({
  displayName,
  accountControl,
}: {
  displayName: string;
  accountControl: ReactNode;
}) {
  const [view, setView] = useState<"overview" | "groups" | "account">(
    "overview",
  );
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
      setView('groups');
      leaveDeletedGroup();
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
  const groupQuery = useCached<{ groups: GroupView[] }>('/groups');
  useEffect(() => {
    for (const group of groupQuery.data?.groups ?? []) knownGroups.current.set(group.id, group);
  }, [groupQuery.data]);
  const groups = groupQuery.data?.groups ?? [];
  const [creating, setCreating] = useState(false);
  const loading = !groupQuery.data && !groupQuery.error;
  const error = groupQuery.error ? errorMessage(groupQuery.error) : '';
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    void api.list().catch(() => {});
  }, [api, revision]);

  function deletedGroup() {
    setView('groups');
    closeGroup();
  }

  async function createGroup(draft: GroupDraft) {
    const { group } = await api.create(draft);
    setCreating(false);
    setView('groups');
    goToGroup(group);
  }

  return (
    <div className="play">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <button
            className="logo-button"
            onClick={() => { setView("overview"); closeGroup(); }}
            aria-label="ShareTally home"
          >
            <Logo />
          </button>
          <div className="workspace-label">YOUR LITTLE CORNER</div>
          <nav className="main-nav" aria-label="Main navigation">
            {navigation.map((item) => (
              <button
                key={item.id}
                className={(billGroupId || newBill ? item.id === "groups" : view === item.id) ? "active" : ""}
                aria-current={(billGroupId || newBill ? item.id === "groups" : view === item.id) ? "page" : undefined}
                onClick={() => { setView(item.id); closeGroup(); }}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <Icon name="heart" />
              <p>
                More friendship.
                <br />
                Less “you owe me.”
              </p>
            </div>
            <div className="profile">
              {accountControl}
              <span className="profile-details">
                <strong>{displayName}</strong>
                <small>Personal account</small>
              </span>
            </div>
          </div>
        </aside>
        <main className="main-content" id="main-content" tabIndex={-1}>
          {!billId && !newBill && <header className="page-header">
            <div>
              <div className="eyebrow">YOUR SHARED PURCHASES</div>
              <h1>
                {view === "overview" && !billGroupId ? (
                  <>
                    Hey {displayName}, <span>all good?</span>
                    <Icon name="spark" />
                  </>
                ) : (
                  billGroupId ? "My groups" : navigation.find((item) => item.id === view)?.label
                )}
              </h1>
              <p>
                {view === "account"
                  ? "Your signed-in ShareTally account."
                  : "Good people. Shared plans. Everything in one place."}
              </p>
            </div>
            {view !== "account" && (
              <Button onClick={() => setCreating(true)}>
                <Icon name="plus" />
                New group
              </Button>
            )}
          </header>}
          {deletionNotice && <Notification tone="info" onDismiss={() => setDeletionNotice('')}>{deletionNotice}</Notification>}
          {billId ? <BillDetails key={billId} id={billId} /> : newBill ? <NewBillPage key={`${newBill[1]}:${newBill[2] ?? "new"}`} groupId={newBill[1]} draftId={newBill[2]} /> : (billGroupId || view === "groups") ? <GroupWorkspace groups={groups} selectedId={billGroupId ?? undefined} selectedRepaymentId={new URLSearchParams(route.split('?')[1]).get('repayment') ?? undefined} loading={loading} error={error} retry={() => setRevision(value => value + 1)} onCreate={() => setCreating(true)} onDeleted={deletedGroup} /> : view === "account" ? (
            <section className="account-panel">
              <AccountCheck />
            </section>
          ) : (
            <section>
              {view === "overview" && <OverviewBalance revision={`${route}:${revision}`} />}
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
                onOpen={group => { window.location.hash = `/group-bills/${group.id}`; }}
              />}
            </section>
          )}
          <footer className="page-footer">
            <Logo compact />
            <span>Made for the people you share life with.</span>
            <span>CAD</span>
          </footer>
        </main>
      </div>
      {creating && (
        <CreateGroupDialog
          onClose={() => setCreating(false)}
          onCreate={createGroup}
        />
      )}
      {selectedId && <GroupDetails key={selectedId} id={selectedId} api={api} close={closeGroup} onDeleted={deletedGroup} onViewBills={() => { window.location.hash = `/group-bills/${selectedId}`; }} />}
      {invitationToken !== null && <JoinGroup key={invitationToken} token={invitationToken} api={api} close={closeGroup} joined={group => {
        setView('groups');
        goToGroup(group);
      }} />}

    </div>
  );
}
