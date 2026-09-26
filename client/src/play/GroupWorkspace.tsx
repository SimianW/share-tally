import { useState } from 'react';
import type { ListedGroup } from './group-api';
import { GroupBills } from './Bills';
import { GroupSwitcher } from './GroupSwitcher';
import './group-workspace.css';

// The group page takes the full width; other groups are one heading dropdown away.
export default function GroupWorkspace({ groups, selectedId, selectedRepaymentId, loading, error, retry, onDeleted }: {
  groups: ListedGroup[];
  selectedId: string;
  selectedRepaymentId?: string;
  loading: boolean;
  error: string;
  retry: () => void;
  onDeleted: () => void;
}) {
  const [switched, setSwitched] = useState(false);
  return <div className="workspace-content">
    <GroupBills key={selectedId} id={selectedId} selectedRepaymentId={selectedRepaymentId} onDeleted={onDeleted}
      title={group => <GroupSwitcher groups={groups} currentId={selectedId} current={group}
        loading={loading} error={error} retry={retry} focusOnMount={switched}
        onSelect={id => {
          setSwitched(true);
          window.location.hash = `/group-bills/${id}`;
        }} />} />
  </div>;
}
