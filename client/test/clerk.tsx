/* eslint-disable react-refresh/only-export-components -- Test-only replacement for the Clerk module, not a refresh boundary. */
// Only the browser-test environment (test/browser/environment.mjs) and
// scripts/measure-emoji-picker.mjs alias Clerk to this module. Production Vite
// never imports it. API identities are likewise confined to server/test/.
import { useEffect, useState, useSyncExternalStore, cloneElement, type FormEvent, type ReactElement, type ReactNode } from 'react';

type Profile = { username: string | null; firstName: string | null; lastName: string | null };

const token = () => localStorage.getItem('smoke-token');
declare global {
  interface Window {
    smokeTokenControl?: { calls: number; delayMs?: number; fail?: boolean; missing?: boolean; ordinaryToken?: string };
  }
}
const getToken = async (options?: { skipCache?: boolean }) => {
  const control = window.smokeTokenControl;
  if (options?.skipCache && control) {
    control.calls++;
    if (control.delayMs) await new Promise(resolve => setTimeout(resolve, control.delayMs));
    if (control.fail) throw new Error('Test Clerk temporarily unavailable');
    if (control.missing) return null;
  }
  return !options?.skipCache && control?.ordinaryToken ? control.ordinaryToken : token();
};
const subscribe = (changed: () => void) => {
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
};
const useToken = () => useSyncExternalStore(subscribe, token);

// Each signed-in identity's Clerk fields. The test API holds the saved values,
// as Clerk does; until they arrive, Alice, Bob and Carol have their first names.
const profiles = new Map<string, Profile>();
let accountOpen = false;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribeStore = (changed: () => void) => {
  listeners.add(changed);
  return () => { listeners.delete(changed); };
};
function profileFor(current: string) {
  if (!profiles.has(current)) {
    const name = current.split('-')[0];
    const named = ['alice', 'bob', 'carol'].includes(name);
    profiles.set(current, { username: null, firstName: named ? name[0].toUpperCase() + name.slice(1) : null, lastName: null });
  }
  return profiles.get(current)!;
}
async function profileRequest(current: string, changes?: Partial<Profile>) {
  const response = await fetch('/api/test-clerk/profile', {
    method: changes ? 'PATCH' : 'GET',
    headers: { Authorization: `Bearer ${current}`, 'Content-Type': 'application/json' },
    ...(changes ? { body: JSON.stringify(changes) } : {}),
  });
  if (!response.ok) throw new Error(`Test Clerk profile request failed (${response.status})`);
  profiles.set(current, await response.json());
  emit();
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}<AccountWindow /></>;
}
export function useAuth() { return { getToken }; }
export function useUser() {
  const current = useToken();
  const profile = useSyncExternalStore(subscribeStore, () => current ? profileFor(current) : null);
  // Component-only scenarios run without the API; they keep the initial fields.
  useEffect(() => { if (current) profileRequest(current).catch(() => {}); }, [current]);
  if (!current || !profile) return { user: null };
  return { user: {
    id: current.split('-')[0], ...profile,
    fullName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null,
    reload: () => profileRequest(current),
  } };
}
export function Show({ when, children }: { when: string; children: ReactNode }) {
  const current = useToken();
  return (when === 'signed-in' ? !!current : !current) ? children : null;
}
export function useClerk() {
  return {
    signOut: async () => { localStorage.removeItem('smoke-token'); location.reload(); },
    openUserProfile: () => { accountOpen = true; emit(); },
  };
}
export function SignInButton({ children, forceRedirectUrl }: { children: ReactElement<{ onClick: () => void }>; forceRedirectUrl: string }) {
  return cloneElement(children, { onClick: () => { localStorage.setItem('smoke-token', 'bob-token');
    if (location.href === forceRedirectUrl) location.reload();
    else location.assign(forceRedirectUrl); } });
}
export const SignUpButton = SignInButton;

// Stands in for Clerk's account window: Update username edits the Username;
// Update profile edits the separate Profile name.
function AccountWindow() {
  const open = useSyncExternalStore(subscribeStore, () => accountOpen);
  const current = useToken();
  const [editing, setEditing] = useState<'username' | 'profile' | null>(null);
  const [error, setError] = useState('');
  if (!open || !current) return null;
  const profile = profileFor(current);
  const close = () => { accountOpen = false; setEditing(null); setError(''); emit(); };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? '').trim() || null;
    try {
      await profileRequest(current!, editing === 'username'
        ? { username: field('username') }
        : { firstName: field('firstName'), lastName: field('lastName') });
      setEditing(null);
      setError('');
    } catch (failure) { setError(String(failure)); }
  }
  return <div role="dialog" aria-modal="true" aria-label="Clerk account"
    style={{ position: 'fixed', inset: '10% 10% auto', zIndex: 1000, padding: 24, background: 'white', color: 'black', border: '1px solid' }}>
    <h2>Profile details</h2>
    <p>Username: {profile.username ?? 'none'}</p>
    <p>Profile: {[profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'none'}</p>
    {editing ? <form onSubmit={save}>
      {editing === 'username'
        ? <label>Username <input name="username" defaultValue={profile.username ?? ''} /></label>
        : <>
          <label>First name <input name="firstName" defaultValue={profile.firstName ?? ''} /></label>
          <label>Last name <input name="lastName" defaultValue={profile.lastName ?? ''} /></label>
        </>}
      <button type="submit">Save</button>
      <button type="button" onClick={() => setEditing(null)}>Cancel</button>
    </form> : <>
      <button type="button" onClick={() => setEditing('username')}>Update username</button>
      <button type="button" onClick={() => setEditing('profile')}>Update profile</button>
    </>}
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={close}>Close</button>
  </div>;
}
