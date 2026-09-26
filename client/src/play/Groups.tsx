import { Notification } from './Notification';
import { lazy, Suspense, useRef, useState } from "react";
import Dialog from "./Dialog";
import { GroupIconView } from "./GroupIconView";
import { type GroupIcon } from "./group-icon";
import { Button, Icon } from "./ui";

import { errorMessage, type GroupDraft } from './group-api';
import './group-icon-picker.css';

const GroupIconPicker = lazy(() => import('./GroupIconPicker'));

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
        {error && <Notification>{error}</Notification>}
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
