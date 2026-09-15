/* eslint-disable react-refresh/only-export-components -- Test-only replacement for the Clerk module, not a refresh boundary. */
// Only scripts/smoke-groups.mjs aliases Clerk to this module. Production Vite
// never imports it. API identities are likewise confined to server/test/.
import { cloneElement, type ReactElement, type ReactNode } from 'react';

const token = () => localStorage.getItem('smoke-token');
const getToken = async () => token();
export function ClerkProvider({ children }: { children: ReactNode }) { return children; }
export function useAuth() { return { getToken }; }
export function useUser() {
  const name = token()?.split('-')[0] ?? 'bob';
  return { user: { id: name, firstName: name[0].toUpperCase() + name.slice(1), fullName: name } };
}
export function Show({ when, children }: { when: string; children: ReactNode }) {
  return (when === 'signed-in' ? !!token() : !token()) ? children : null;
}
export function UserButton() {
  return <button onClick={() => { localStorage.removeItem('smoke-token'); location.reload(); }}>Sign out</button>;
}
export function SignInButton({ children, forceRedirectUrl }: { children: ReactElement<{ onClick: () => void }>; forceRedirectUrl: string }) {
  return cloneElement(children, { onClick: () => { localStorage.setItem('smoke-token', 'bob-token');
    if (location.href === forceRedirectUrl) location.reload();
    else location.assign(forceRedirectUrl); } });
}
export const SignUpButton = SignInButton;
