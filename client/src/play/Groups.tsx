import { lazy, Suspense, useRef, useState } from "react";
import Dialog from "./Dialog";
import { GroupIconView } from "./GroupIconView";
import { type GroupIcon } from "./group-icon";
import { Avatar, Button, Icon } from "./ui";

import { errorMessage, type GroupDraft, type GroupView } from './group-api';
import './group-icon-picker.css';

const GroupIconPicker = lazy(() => import('./GroupIconPicker'));

export function GroupList({
  groups,
  onCreate,
  onOpen,
}: {
  groups: GroupView[];
  onCreate: () => void;
  onOpen: (group: GroupView) => void;
}) {
  return (
    <>
      {groups.length === 0 && (
        <div className="empty-state">
          <Icon name="people" size={32} />
          <h3>Your people, together.</h3>
          <p>Start with a group for your next shared purchase.</p>
        </div>
      )}
      <div className="group-grid">
        {groups.map((group) => (
          <button
            type="button"
            className={`group-card ${group.icon.value === "shopping-basket" ? "lime" : group.icon.value === "house" ? "lavender" : "peach"}`}
            key={group.id}
            onClick={() => onOpen(group)}
          >
            <div className="group-card-top">
              <span className="group-symbol">
                <GroupIconView icon={group.icon} size={27} />
              </span>
              <Icon name="diagonal" className="group-arrow" size={18} />
            </div>
            <h3>{group.name}</h3>
            <p className="group-description">Created by {group.isCreator ? "you" : group.creatorName}</p>
            <div className="group-card-bottom">
              <Avatar name={group.creatorName} small />
              <span>{group.memberCount} {group.memberCount === 1 ? "member" : "members"}</span>
            </div>
          </button>
        ))}
        <button type="button" className="create-group-card" onClick={onCreate}>
          <Icon name="plus" />
          <span>A new group, a new plan</span>
        </button>
      </div>
    </>
  );
}

export function CreateGroupDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (draft: GroupDraft) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<GroupIcon>({ type: 'lucide', value: 'shopping-basket' });
  const [pickingIcon, setPickingIcon] = useState(false);
  const iconButton = useRef<HTMLButtonElement>(null);
  function closePicker() {
    setPickingIcon(false);
    requestAnimationFrame(() => iconButton.current?.focus());
  }
  return (
    <Dialog
      title="Your people. Your little corner."
      kicker="A NEW GROUP"
      className={`create-group-dialog ${pickingIcon ? 'with-icon-picker' : ''}`}
      close={() => { if (pickingIcon) closePicker(); else if (!pending.current) onClose(); }}
    >
      <form
        className="group-form create-group-summary"
        inert={pickingIcon}
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current || pickingIcon || !name.trim()) return;
          pending.current = true; setBusy(true); setError('');
          try { await onCreate({ name: name.trim(), icon }); }
          catch (error) { setError(errorMessage(error)); }
          finally { pending.current = false; setBusy(false); }
        }}
      >
        <button ref={iconButton} type="button" className="choose-group-icon" aria-label="Choose group icon"
          disabled={busy} onClick={() => setPickingIcon(true)}>
          <GroupIconView icon={icon} size={56} />
          <span>Change icon</span>
        </button>
        <label>
          Group name
          <input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Give your people a name"
            maxLength={40}
            required
            data-autofocus
          />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <Button type="submit" disabled={busy || pickingIcon || !name.trim()}>
          {busy ? 'Creating…' : 'Create group'}
          <Icon name="arrow" size={18} />
        </Button>
      </form>
      {pickingIcon && <Suspense fallback={<section className="group-icon-picker"><p role="status">Loading icons…</p><Button onClick={closePicker}>Cancel</Button></section>}>
        <GroupIconPicker value={icon} onCancel={closePicker} onApply={selected => { setIcon(selected); closePicker(); }} />
      </Suspense>}
    </Dialog>
  );
}
