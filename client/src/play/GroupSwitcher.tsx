import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { Check, ChevronDown, CircleAlert } from 'lucide-react';
import type { GroupView } from './group-api';
import { GroupIconView } from './GroupIconView';
import { keyTarget, usePopup } from './popup';
import './group-switcher.css';

type GroupName = Pick<GroupView, 'id' | 'name' | 'icon'>;

function options(listbox: HTMLElement | null) {
  return [...(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
}
// The current group's option, else the first option, else the button while the list loads.
function focusCurrent(listbox: HTMLElement | null, trigger: HTMLElement | null) {
  const items = options(listbox);
  (items.find(option => option.getAttribute('aria-selected') === 'true') ?? items[0] ?? trigger)?.focus();
}

// The group page heading. The group's name opens a listbox of the member's groups;
// choosing one switches to it. Home is reached through the logo, not from here.
export function GroupSwitcher({ groups, currentId, current, loading, error, retry, focusOnMount, onSelect }: {
  groups: GroupName[];
  currentId: string;
  // The group page's own copy, which can arrive before or without the group list.
  current?: GroupName;
  loading: boolean;
  error: string;
  retry: () => void;
  // Keeps keyboard focus on the heading after it remounts for the chosen group.
  focusOnMount: boolean;
  onSelect: (id: string) => void;
}) {
  const { open, setOpen, close, root, trigger, focusLeft } = usePopup();
  const listbox = useRef<HTMLUListElement>(null);
  const labelId = useId();
  const listboxId = useId();
  const shown = current ?? groups.find(group => group.id === currentId);

  useEffect(() => {
    if (focusOnMount) trigger.current?.focus();
  }, [focusOnMount, trigger]);
  useEffect(() => {
    if (open) focusCurrent(listbox.current, trigger.current);
  }, [open, trigger]);
  // A successful retry removes the focused Retry button, which drops focus to the
  // body while the list stays open. Only then, return focus to the list.
  const retried = useRef(false);
  useEffect(() => {
    if (error || !retried.current) return;
    retried.current = false;
    const focused = document.activeElement;
    if (open && (!focused || focused === document.body)) focusCurrent(listbox.current, trigger.current);
  }, [error, open, trigger]);

  function choose(id: string) {
    if (id === currentId) {
      close();
      return;
    }
    setOpen(false);
    onSelect(id);
  }
  // Bound on the root, so Escape also closes the list after Shift+Tab back to the button.
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const items = options(listbox.current);
    const focused = document.activeElement as HTMLElement;
    if ((event.key === 'Enter' || event.key === ' ') && items.includes(focused)) {
      event.preventDefault();
      choose(focused.dataset.groupId!);
      return;
    }
    const next = keyTarget(items, focused, event.key, false);
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  return <div ref={root} className="group-switcher" onBlur={focusLeft} onKeyDown={navigate}>
    <h2>
      <button ref={trigger} type="button" className="group-switcher-trigger"
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open && groups.length ? listboxId : undefined}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) { event.preventDefault(); setOpen(true); }
        }}>
        {shown && <span className="group-switcher-icon"><GroupIconView icon={shown.icon} size={26} /></span>}
        <span className="group-switcher-name">{shown?.name ?? 'Group bills'}</span>
        <ChevronDown className="group-switcher-chevron" size={22} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </h2>
    {open && <div className="group-switcher-popover">
      <div id={labelId} className="group-switcher-label">Switch group</div>
      {groups.length > 0 && <ul ref={listbox} id={listboxId} role="listbox" aria-labelledby={labelId}>
        {groups.map(group => {
          const selected = group.id === currentId;
          return <li key={group.id} role="option" tabIndex={-1} aria-selected={selected} data-group-id={group.id}
            onClick={() => choose(group.id)}>
            <span className="group-switcher-option-icon"><GroupIconView icon={group.icon} size={20} /></span>
            <span className="group-switcher-option-name">{group.name}</span>
            {/* Per-group status, such as a pending-action count, goes between the name and the check. */}
            {selected && <Check className="group-switcher-check" size={18} strokeWidth={2.5} aria-hidden="true" />}
          </li>;
        })}
      </ul>}
      {loading && !groups.length && <p className="group-switcher-note" role="status">Loading groups…</p>}
      {error && <div className="group-switcher-error" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        <span>{error}</span>
        <button type="button" onClick={() => { retried.current = true; retry(); }}>Retry groups</button>
      </div>}
    </div>}
  </div>;
}
