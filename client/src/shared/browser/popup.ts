import { useEffect, useRef, useState, type FocusEvent } from 'react';

// Shared dismissal for a button that opens a popup such as a menu or a listbox.
// Bind `root` and `focusLeft` on the element wrapping both the button and its
// popup, and `trigger` on the button.
export function usePopup() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    // Touch browsers such as iOS Safari do not blur on a tap on non-focusable content.
    function pressedOutside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    // Safari can blur the focused option to the body when pressing the button.
    // Preserve focus until click closes the popup, including after touch pointerup.
    function preserveFocus(event: MouseEvent) {
      if (event.button === 0 && trigger.current?.contains(event.target as Node)) event.preventDefault();
    }
    document.addEventListener('pointerdown', pressedOutside);
    document.addEventListener('mousedown', preserveFocus);
    return () => {
      document.removeEventListener('pointerdown', pressedOutside);
      document.removeEventListener('mousedown', preserveFocus);
    };
  }, [open]);

  // Closing on purpose returns focus to the button that opened the popup.
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function toggle() {
    if (open) close();
    else setOpen(true);
  }
  // Tabbing away, or a click that moves focus elsewhere, also closes the popup.
  function focusLeft(event: FocusEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }
  return { open, setOpen, close, toggle, root, trigger, focusLeft };
}

// The item an arrow, Home or End key moves to, or undefined for any other key.
// Menus wrap around at either end; listboxes stop there.
export function keyTarget<T>(items: T[], current: T | null, key: string, wrap: boolean): T | undefined {
  if (!items.length) return undefined;
  const index = current === null ? -1 : items.indexOf(current);
  const last = items.length - 1;
  const next = ({ ArrowDown: index + 1, ArrowUp: (index < 0 ? items.length : index) - 1, Home: 0, End: last } as Record<string, number>)[key];
  if (next === undefined) return undefined;
  return items[wrap ? (next + items.length) % items.length : Math.min(Math.max(next, 0), last)];
}
