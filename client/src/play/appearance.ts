import { palettes, schemes, type PaletteKey, type SchemeKey } from './palettes';

export const paletteStorageKey = 'share-tally-palette';
export const schemeStorageKey = 'share-tally-scheme';
export function isPaletteKey(value: string | null): value is PaletteKey {
  return palettes.some(palette => palette.key === value);
}
function isSchemeKey(value: string | null): value is SchemeKey {
  return schemes.some(scheme => scheme.key === value);
}

export function readSavedPalette() {
  try {
    const saved = localStorage.getItem(paletteStorageKey);
    return { key: isPaletteKey(saved) ? saved : 'classic', storageAvailable: true } as const;
  } catch {
    return { key: 'classic', storageAvailable: false } as const;
  }
}

export function getCurrentPalette() {
  const applied = document.documentElement.dataset.palette ?? null;
  return isPaletteKey(applied) ? applied : readSavedPalette().key;
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

// The mode preference may follow the device; <html data-scheme> always holds
// the resolved light or dark value that palettes.css reads.
const deviceDark = () => matchMedia('(prefers-color-scheme: dark)');
let currentScheme: SchemeKey = 'system';

export function readSavedScheme() {
  try {
    const saved = localStorage.getItem(schemeStorageKey);
    return { key: isSchemeKey(saved) ? saved : 'system', storageAvailable: true } as const;
  } catch {
    return { key: 'system', storageAvailable: false } as const;
  }
}

export function getCurrentScheme() {
  return currentScheme;
}

function applyScheme(key: SchemeKey) {
  currentScheme = key;
  const dark = key === 'dark' || (key === 'system' && deviceDark().matches);
  document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
}

export function applySavedScheme() {
  applyScheme(readSavedScheme().key);
  deviceDark().addEventListener('change', () => {
    if (currentScheme === 'system') applyScheme('system');
  });
}

export function saveScheme(key: SchemeKey) {
  applyScheme(key);
  try {
    localStorage.setItem(schemeStorageKey, key);
    return true;
  } catch {
    return false;
  }
}
