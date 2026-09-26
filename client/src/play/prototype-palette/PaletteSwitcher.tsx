// PROTOTYPE ONLY (#94): floating palette switcher shown on every page in dev.
import { useEffect, useState } from 'react';
import { applyPalette, currentPalette, palettes } from './palette-choice';
import { chooseLayout, currentLayout, layouts } from '../prototype-layout/layout-choice';
import { applyButtons, buttonStyles, currentButtons } from '../prototype-buttons/button-choice';
import './prototype-palette.css';

export function PaletteSwitcher() {
  const [key, setKey] = useState(currentPalette);
  const [layout, setLayout] = useState(currentLayout);
  const layoutIndex = Math.max(0, layouts.findIndex(candidate => candidate.key === layout));
  const stepLayout = (delta: number) => {
    const next = layouts[(layoutIndex + delta + layouts.length) % layouts.length].key;
    chooseLayout(next);
    setLayout(next);
  };
  const [buttons, setButtons] = useState(currentButtons);
  const buttonIndex = Math.max(0, buttonStyles.findIndex(style => style.key === buttons));
  const stepButtons = (delta: number) => {
    const next = buttonStyles[(buttonIndex + delta + buttonStyles.length) % buttonStyles.length].key;
    applyButtons(next);
    setButtons(next);
  };
  const index = Math.max(0, palettes.findIndex(palette => palette.key === key));
  const choose = (next: string) => { applyPalette(next); setKey(next); };
  const step = (delta: number) => choose(palettes[(index + delta + palettes.length) % palettes.length].key);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === '[') step(-1);
      if (event.key === ']') step(1);
      if (event.key === ',') stepLayout(-1);
      if (event.key === '.') stepLayout(1);
      if (event.key === ';') stepButtons(-1);
      if (event.key === "'") stepButtons(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const palette = palettes[index];
  return <div className="prototype-switcher" role="toolbar" aria-label="Prototype palette">
    <button type="button" onClick={() => step(-1)} aria-label="Previous palette">←</button>
    <span><b>{index + 1}/{palettes.length} {palette.name}</b> · {palette.fonts}</span>
    <button type="button" onClick={() => step(1)} aria-label="Next palette">→</button>
    <span className="prototype-switcher-divider" aria-hidden="true" />
    <button type="button" onClick={() => stepLayout(-1)} aria-label="Previous layout">←</button>
    <span><b>{layouts[layoutIndex].name}</b></span>
    <button type="button" onClick={() => stepLayout(1)} aria-label="Next layout">→</button>
    <span className="prototype-switcher-divider" aria-hidden="true" />
    <button type="button" onClick={() => stepButtons(-1)} aria-label="Previous button style">←</button>
    <span><b>{buttonStyles[buttonIndex].name}</b></span>
    <button type="button" onClick={() => stepButtons(1)} aria-label="Next button style">→</button>
    <a href="#/prototype/palette">Specimen</a>
    <a href="#/">App</a>
  </div>;
}
