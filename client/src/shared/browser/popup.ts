import { useEffect, useRef, useState, type FocusEvent } from 'react';

// Shared dismissal for a button that opens a popup such as a menu or a listbox.
// Bind `root` and `focusLeft` on the element wrapping both the button and its
// popup, and `trigger` on the button.
export function usePopup() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pressingTrigger = useRef(false);
  useEffect(() => {
    if (!open) return;
    // Touch browsers such as iOS Safari do not blur on a tap on non-focusable content.
    function pressedOutside(event: PointerEvent) {
      // Only a primary press will produce the click that toggles the popup.
      pressingTrigger.current = event.button === 0 && !!trigger.current?.contains(event.target as Node);
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function clicked() { pressingTrigger.current = false; }
    document.addEventListener('pointerdown', pressedOutside);
    document.addEventListener('click', clicked);
    document.addEventListener('pointercancel', clicked);
    return () => {
      document.removeEventListener('pointerdown', pressedOutside);
      document.removeEventListener('click', clicked);
      document.removeEventListener('pointercancel', clicked);
      pressingTrigger.current = false;
    };
  }, [open]);

  // Closing on purpose returns focus to the button that opened the popup.
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  // Tabbing away, or a click that moves focus elsewhere, also closes the popup.
  function focusLeft(event: FocusEvent<HTMLElement>) {
    // Safari may blur an option to the body before clicking the trigger. Let
    // that click close the popup once, rather than closing here and reopening.
    if (!event.relatedTarget && pressingTrigger.current) return;
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }
  return { open, setOpen, close, root, trigger, focusLeft };
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
