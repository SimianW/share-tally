import { useCallback, useEffect, useState } from 'react';
import { money, useBillApi, type Summary } from './bill-api';
import type { GroupView } from './group-api';
import { GroupBills } from './Bills';
import { GroupIconView } from './GroupIconView';
import { Button } from './ui';
import './group-workspace.css';

function balanceLabel(summary: Summary | null | undefined) {
  if (summary === undefined) return 'Loading balance…';
  if (summary === null) return 'Balance unavailable';
  if (summary.netCents === 0) return 'All square · $0.00';
  return `${summary.netCents < 0 ? 'You owe' : 'You are owed'} ${money(Math.abs(summary.netCents))}`;
}

export default function GroupWorkspace({ groups, selectedId, loading, error, retry, onCreate }: {
  groups: GroupView[];
  selectedId?: string;
  loading: boolean;
  error: string;
  retry: () => void;
  onCreate: () => void;
}) {
  const activeId = selectedId ?? groups[0]?.id;
  const api = useBillApi();
  const [balances, setBalances] = useState<Record<string, Summary | null>>({});
  const updateBalance = useCallback((id: string, summary: Summary | null) => {
    setBalances(current => ({ ...current, [id]: summary }));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // The selected group's panel supplies its balance; fetch the other rows.
    for (const group of groups) {
      if (group.id === activeId) continue;
      api.list(group.id, controller.signal).then(({ summary }) => {
        if (!controller.signal.aborted) updateBalance(group.id, summary);
      }).catch(() => {
        if (!controller.signal.aborted) setBalances(current => ({ ...current, [group.id]: null }));
      });
    }
    return () => controller.abort();
  }, [api, groups, activeId, updateBalance]);
  return <div className="group-workspace">
    <nav className="workspace-groups" aria-label="Groups">
      {loading && <p role="status">Loading groups…</p>}
      {error && <div role="alert"><p>{error}</p><Button onClick={retry}>Retry groups</Button></div>}
      {groups.map(group => <a
        key={group.id}
        href={`#/group-bills/${group.id}`}
        aria-current={group.id === activeId ? 'page' : undefined}
      >
        <GroupIconView icon={group.icon} size={24} />
        <span><b>{group.name}</b><small>{balanceLabel(balances[group.id])}</small></span>
      </a>)}
    </nav>
    <div className="workspace-content">
      {activeId ? <GroupBills key={activeId} id={activeId} onSummary={updateBalance} /> : !loading && !error && <div className="empty-state"><h2>Your people, together.</h2><p>Create a group to start recording shared purchases.</p><Button onClick={onCreate}>Create your first group</Button></div>}
    </div>
  </div>;
}
