// PROTOTYPE ONLY (#94): which group-page layout renders. Never merged.
export const layouts = [
  { key: 'current', name: 'Current page' },
  { key: 'column', name: 'A · Calm column' },
  { key: 'sidebar', name: 'B · Sticky sidebar' },
  { key: 'hero', name: 'C · Balance hero' },
  { key: 'board', name: 'D · Bill board' },
  { key: 'table', name: 'E · Compact ledger' },
] as const;

const storageKey = 'prototype-layout';

export function currentLayout(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('layout');
  const chosen = fromQuery ?? localStorage.getItem(storageKey) ?? 'current';
  return layouts.some(layout => layout.key === chosen) ? chosen : 'current';
}

export function chooseLayout(key: string) {
  localStorage.setItem(storageKey, key);
  window.dispatchEvent(new Event('prototype-layout'));
}
