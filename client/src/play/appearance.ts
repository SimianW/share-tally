import { palettes, type PaletteKey } from './palettes';

export const paletteStorageKey = 'share-tally-palette';

export function isPaletteKey(value: string | null): value is PaletteKey {
  return palettes.some(palette => palette.key === value);
}

export function readSavedPalette() {
  try {
    const saved = localStorage.getItem(paletteStorageKey);
    return { key: isPaletteKey(saved) ? saved : 'classic', storageAvailable: true } as const;
  } catch {
    return { key: 'classic', storageAvailable: false } as const;
  }
}

export function applySavedPalette() {
  document.documentElement.dataset.palette = readSavedPalette().key;
}

export function savePalette(key: PaletteKey) {
  document.documentElement.dataset.palette = key;
  try {
    localStorage.setItem(paletteStorageKey, key);
    return true;
  } catch {
    return false;
  }
}
