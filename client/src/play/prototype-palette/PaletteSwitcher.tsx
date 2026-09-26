// PROTOTYPE ONLY (#94): floating palette switcher shown on every page in dev.
import { useEffect, useState } from 'react';
import { applyPalette, currentPalette, palettes } from './palette-choice';
import './prototype-palette.css';

export function PaletteSwitcher() {
  const [key, setKey] = useState(currentPalette);
  const index = Math.max(0, palettes.findIndex(palette => palette.key === key));
  const choose = (next: string) => { applyPalette(next); setKey(next); };
  const step = (delta: number) => choose(palettes[(index + delta + palettes.length) % palettes.length].key);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === '[') step(-1);
      if (event.key === ']') step(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const palette = palettes[index];
  return <div className="prototype-switcher" role="toolbar" aria-label="Prototype palette">
    <button type="button" onClick={() => step(-1)} aria-label="Previous palette">←</button>
    <span><b>{index + 1}/{palettes.length} {palette.name}</b> · {palette.fonts}</span>
    <button type="button" onClick={() => step(1)} aria-label="Next palette">→</button>
    <a href="#/prototype/palette">Specimen</a>
    <a href="#/">App</a>
  </div>;
}
