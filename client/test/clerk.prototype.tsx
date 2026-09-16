/* eslint-disable react-refresh/only-export-components -- Throwaway demo authentication, never used by the normal app. */
import type { ReactNode } from 'react';
const getToken = async () => 'prototype-only';
export function ClerkProvider({ children }: { children: ReactNode }) { return children; }
export function useAuth() { return { getToken }; }
export function useUser() { return { user: { id: 'prototype-alice', firstName: 'Alice', fullName: 'Alice' } }; }
export function Show({ when, children }: { when: string; children: ReactNode }) { return when === 'signed-in' ? children : null; }
export function UserButton() { return <span aria-label="Alice demo account">A</span>; }
export function SignInButton() { return null; }
export function SignUpButton() { return null; }
