import { AttentionList } from './AttentionList';
import { BillDetails, OverviewBalance } from './Bills';
import GroupWorkspace from './GroupWorkspace';
import { useRoute } from './route';
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import AccountCheck from "../AccountCheck";
import { GroupDetails, JoinGroup } from './GroupDetails';
import { useGroupApi, errorMessage, type GroupDraft, type GroupView } from './group-api';
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
  const route = useRoute();
  const selectedId = route.startsWith('#/groups/') ? route.slice('#/groups/'.length) : null;
  const billId = route.startsWith('#/bills/') ? route.slice('#/bills/'.length) : null;
  const billGroupId = route.startsWith('#/group-bills/') ? route.slice('#/group-bills/'.length).split('?')[0] : null;
  const invitationToken = route.startsWith('#/join/') ? route.slice('#/join/'.length) : null;
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.list(controller.signal).then(({ groups }) => {
      if (!controller.signal.aborted) { setGroups(groups); setError(''); }
    }).catch(error => {
      if (!controller.signal.aborted) setError(errorMessage(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, revision, route]);

  async function createGroup(draft: GroupDraft) {
    const { group } = await api.create(draft);
    setGroups(current => [group, ...current]);
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
                className={(billGroupId ? item.id === "groups" : view === item.id) ? "active" : ""}
                aria-current={(billGroupId ? item.id === "groups" : view === item.id) ? "page" : undefined}
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
          {!billId && <header className="page-header">
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
          {billId ? <BillDetails key={billId} id={billId} /> : (billGroupId || view === "groups") ? <GroupWorkspace key={billGroupId ?? "groups"} groups={groups} selectedId={billGroupId ?? undefined} selectedRepaymentId={new URLSearchParams(route.split('?')[1]).get('repayment') ?? undefined} loading={loading} error={error} retry={() => setRevision(value => value + 1)} onCreate={() => setCreating(true)} /> : view === "account" ? (
            <section className="account-panel">
              <AccountCheck />
            </section>
          ) : (
            <section>
              {view === "overview" && <OverviewBalance revision={`${route}:${revision}`} />}
              <AttentionList revision={`${route}:${revision}`} />
              {loading && <p role="status">Loading groups…</p>}
              {error && <div role="alert" className="form-error">
                <p>{error}</p>
                <Button onClick={() => { setLoading(true); setRevision(value => value + 1); }} disabled={loading}>Try again</Button>
              </div>}
              <SectionHeading title="Your people" count={groups.length} action="Refresh" onAction={() => { setLoading(true); setRevision(value => value + 1); }} />
              {!loading && !error && <GroupList
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
      {selectedId && <GroupDetails key={selectedId} id={selectedId} api={api} close={closeGroup} />}
      {invitationToken !== null && <JoinGroup key={invitationToken} token={invitationToken} api={api} close={closeGroup} joined={group => {
        setView('groups');
        goToGroup(group);
      }} />}

    </div>
  );
}
