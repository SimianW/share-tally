import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { ChevronDown, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Avatar, Logo } from './ui';
import './top-bar.css';

export type SignedInAccount = {
  name: string;
  email?: string | null;
  imageUrl?: string | null;
  openProfile: () => void;
  signOut: () => void;
};

// Home is the only top-level page: the logo returns to it and Account lives in the avatar menu.
export function TopBar({ account, openAccount }: { account: SignedInAccount; openAccount: () => void }) {
  return <header className="top-bar">
    <div className="top-bar-inner">
      <a className="top-bar-home" href="#" aria-label="ShareTally home"><Logo /></a>
      <AccountMenu account={account} openAccount={openAccount} />
    </div>
  </header>;
}

function AccountMenu({ account, openAccount }: { account: SignedInAccount; openAccount: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    // Touch browsers such as iOS Safari do not blur on a tap on non-focusable content.
    function pressedOutside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', pressedOutside);
    return () => document.removeEventListener('pointerdown', pressedOutside);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function choose(action: () => void) {
    close();
    action();
  }
  // Tabbing away, or a click that moves focus elsewhere, also closes the menu.
  function focusLeft(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[(next + items.length) % items.length].focus();
  }

  return <div ref={root} className="account-menu" onBlur={focusLeft}>
    <button ref={trigger} id={triggerId} type="button" className="account-menu-trigger"
      aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(value => !value)}
      onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}>
      <Avatar name={account.name} imageUrl={account.imageUrl} />
      <ChevronDown className="account-menu-chevron" size={16} aria-hidden="true" />
    </button>
    {open && <div className="account-menu-popover">
      <div className="account-menu-identity">
        <Avatar name={account.name} imageUrl={account.imageUrl} />
        <span>
          <strong>{account.name}</strong>
          <small>{account.email || 'Personal account'}</small>
        </span>
      </div>
      <div ref={menu} id={menuId} role="menu" aria-labelledby={triggerId} onKeyDown={navigate}>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(openAccount)}>
          <UserRound size={18} aria-hidden="true" />Account
        </button>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(account.openProfile)}>
          <ShieldCheck size={18} aria-hidden="true" />Profile &amp; security
        </button>
        <div role="separator" />
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => choose(account.signOut)}>
          <LogOut size={18} aria-hidden="true" />Sign out
        </button>
      </div>
    </div>}
  </div>;
}
