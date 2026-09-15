import type { GroupView } from './group-api';
import { GroupBills } from './Bills';
import { GroupIconView } from './GroupIconView';
import { Button } from './ui';
import './group-workspace.css';

export default function GroupWorkspace({ groups, selectedId, loading, error, retry, onCreate }: {
  groups: GroupView[];
  selectedId?: string;
  loading: boolean;
  error: string;
  retry: () => void;
  onCreate: () => void;
}) {
  const activeId = selectedId ?? groups[0]?.id;
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
        <span><b>{group.name}</b><small>{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}</small></span>
      </a>)}
    </nav>
    <div className="workspace-content">
      {activeId ? <GroupBills key={activeId} id={activeId} /> : !loading && !error && <div className="empty-state"><h2>Your people, together.</h2><p>Create a group to start recording shared purchases.</p><Button onClick={onCreate}>Create your first group</Button></div>}
    </div>
  </div>;
}
