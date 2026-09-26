// PROTOTYPE ONLY (#94): which candidate palette the app renders. Never merged.
export const palettes = [
  { key: 'classic', name: 'Classic (today)', fonts: 'Nunito + DM Sans' },
  { key: 'marigold', name: 'Marigold', fonts: 'Bricolage Grotesque + DM Sans' },
  { key: 'raspberry', name: 'Raspberry', fonts: 'Fraunces + Figtree' },
  { key: 'plum-butter', name: 'Plum & Butter', fonts: 'Nunito + DM Sans' },
  { key: 'lagoon', name: 'Lagoon', fonts: 'Manrope + Instrument Sans' },
  { key: 'blueberry', name: 'Blueberry Jam', fonts: 'Outfit + Figtree' },
] as const;

const storageKey = 'prototype-palette';

// A ?palette= query parameter wins, so a link can pin a palette.
export function currentPalette(): string {
  const fromQuery = new URLSearchParams(window.location.search).get('palette');
  const chosen = fromQuery ?? localStorage.getItem(storageKey) ?? 'classic';
  return palettes.some(palette => palette.key === chosen) ? chosen : 'classic';
}

export function applyPalette(key: string) {
  localStorage.setItem(storageKey, key);
  document.documentElement.dataset.palette = key;
}
