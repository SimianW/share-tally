import { useEffect } from 'react';
import { useCached } from './query-cache';
import { money, useBillApi, type Summary } from './bill-api';
import type { GroupView } from './group-api';
import { GroupBills } from './Bills';
import { GroupIconView } from './GroupIconView';
import { Button, Icon } from './ui';
import './group-workspace.css';

function balanceLabel(summary: Summary | null | undefined) {
  if (summary === undefined) return 'Loading balance…';
  if (summary === null) return 'Balance unavailable';
  if (summary.netCents === 0) return 'Your balance · $0.00';
  return `${summary.netCents < 0 ? 'You owe' : 'You are owed'} ${money(Math.abs(summary.netCents))}`;
}

export default function GroupWorkspace({ groups, selectedId, selectedRepaymentId, loading, error, retry, onCreate }: {
  groups: GroupView[];
  selectedId?: string;
  selectedRepaymentId?: string;
  loading: boolean;
  error: string;
  retry: () => void;
  onCreate: () => void;
}) {
  const activeId = selectedId ?? groups[0]?.id;
  if (!activeId && !loading && !error) {
    return <section className="empty-state workspace-empty" aria-labelledby="empty-groups-title">
      <Icon name="people" size={32} />
      <h2 id="empty-groups-title">Your people, together.</h2>
      <p>Create a group to start recording shared purchases.</p>
      <Button onClick={onCreate}>Create your first group</Button>
    </section>;
  }
  return <div className="group-workspace">
    <nav className="workspace-groups" aria-label="Groups">
      {loading && <p role="status">Loading groups…</p>}
      {error && <div role="alert"><p>{error}</p><Button onClick={retry}>Retry groups</Button></div>}
      {groups.map(group => <GroupLink key={group.id} group={group} active={group.id === activeId} />)}
    </nav>
    <div className="workspace-content">
      {activeId && <GroupBills key={activeId} id={activeId} selectedRepaymentId={selectedRepaymentId} />}
    </div>
  </div>;
}

function GroupLink({ group, active }: { group: GroupView; active: boolean }) {
  const api = useBillApi();
  const query = useCached<Awaited<ReturnType<typeof api.list>>>(`/groups/${group.id}/bills`);
  useEffect(() => {
    // The active panel starts its authoritative read once SSE is ready.
    if (!active) void api.list(group.id).catch(() => {});
  }, [api, group.id, active]);
  return <a href={`#/group-bills/${group.id}`} aria-current={active ? 'page' : undefined}>
    <GroupIconView icon={group.icon} size={24} />
    <span><b>{group.name}</b><small>{balanceLabel(query.data?.summary ?? (query.error ? null : undefined))}</small></span>
  </a>;
}
