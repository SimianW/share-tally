import { palettes, schemes, paletteStorageKey, schemeStorageKey, resolveScheme, type PaletteKey, type SchemeKey } from './palettes';

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
  document.documentElement.dataset.scheme = resolveScheme(key, deviceDark().matches);
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

// A stable avatar tint for real member names, not just the five prototype names.
// Claim bars reuse it, so a person's segment matches their avatar.
export function avatarTint(name: string) {
  const tint = [...name.trim().toLowerCase()].reduce((hash, character) =>
    (hash * 31 + character.codePointAt(0)!) % 5, 0) + 1;
  return name.trim() ? `var(--avatar-${tint})` : "var(--avatar-default)";
}
