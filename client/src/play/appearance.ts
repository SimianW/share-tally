import { palettes, type PaletteKey } from './palettes';

export const paletteStorageKey = 'share-tally-palette';

export function isPaletteKey(value: string | null): value is PaletteKey {
  return palettes.some(palette => palette.key === value);
}

export function applySavedPalette() {
  const saved = localStorage.getItem(paletteStorageKey);
  document.documentElement.dataset.palette = isPaletteKey(saved) ? saved : 'classic';
}

export function savePalette(key: PaletteKey) {
  document.documentElement.dataset.palette = key;
  localStorage.setItem(paletteStorageKey, key);
}
