import { lazy, Suspense, useRef, useState } from "react";
import { useOperation } from '../../shared/api/use-operation';
import { Button } from "../../shared/ui/Button";
import Dialog from "../../shared/ui/Dialog";
import { Icon } from "../../shared/ui/Icon";
import { Notification } from '../../shared/ui/Notification';
import { GroupIconView } from "./icons/GroupIconView";
import { type GroupIcon } from "./icons/group-icon";
import { errorMessage } from "../../shared/api/error-message";
import { type GroupDraft } from "./api";

const GroupIconPicker = lazy(() => import('./icons/GroupIconPicker'));

export function CreateGroupDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (draft: GroupDraft) => Promise<void>;
}) {
  const { pending, busy, error, setError, execute } = useOperation();
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

          await execute(async () => { await onCreate({ name: name.trim(), icon }); }, (error) => { setError(errorMessage(error)); });
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
