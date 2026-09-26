/* eslint-disable react-refresh/only-export-components -- Test-only replacement for the Clerk module, not a refresh boundary. */
// Only scripts/smoke-groups.mjs aliases Clerk to this module. Production Vite
// never imports it. API identities are likewise confined to server/test/.
import { useSyncExternalStore, cloneElement, type ReactElement, type ReactNode } from 'react';

const token = () => localStorage.getItem('smoke-token');
const getToken = async () => token();
const subscribe = (changed: () => void) => {
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
};
const useToken = () => useSyncExternalStore(subscribe, token);
export function ClerkProvider({ children }: { children: ReactNode }) { return children; }
export function useAuth() { return { getToken }; }
export function useUser() {
  const name = useToken()?.split('-')[0] ?? 'bob';
  return { user: { id: name, firstName: name[0].toUpperCase() + name.slice(1), fullName: name } };
}
export function Show({ when, children }: { when: string; children: ReactNode }) {
  const current = useToken();
  return (when === 'signed-in' ? !!current : !current) ? children : null;
}
export function useClerk() {
  return {
    signOut: async () => { localStorage.removeItem('smoke-token'); location.reload(); },
    openUserProfile: () => {},
  };
}
export function SignInButton({ children, forceRedirectUrl }: { children: ReactElement<{ onClick: () => void }>; forceRedirectUrl: string }) {
  return cloneElement(children, { onClick: () => { localStorage.setItem('smoke-token', 'bob-token');
    if (location.href === forceRedirectUrl) location.reload();
    else location.assign(forceRedirectUrl); } });
}
export const SignUpButton = SignInButton;
