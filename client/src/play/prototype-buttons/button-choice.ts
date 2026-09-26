// PROTOTYPE ONLY (#94): which button style the app renders. Never merged.
export const buttonStyles = [
  { key: 'current', name: 'Current buttons' },
  { key: 'pill', name: '1 · Soft pill' },
  { key: 'ink', name: '2 · Ink' },
  { key: 'soft', name: '3 · Soft depth' },
  { key: 'tinted', name: '4 · Tinted' },
] as const;

const storageKey = 'prototype-buttons';

export function currentButtons(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('buttons');
  const chosen = fromQuery ?? localStorage.getItem(storageKey) ?? 'current';
  return buttonStyles.some(style => style.key === chosen) ? chosen : 'current';
}

export function applyButtons(key: string) {
  localStorage.setItem(storageKey, key);
  document.documentElement.dataset.buttons = key;
}
