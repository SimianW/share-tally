import { useState } from 'react';
import { palettes, type PaletteKey } from './palettes';
import { paletteStorageKey, savePalette } from './appearance';
import './appearance.css';

const initialPalette = (() => {
  const saved = localStorage.getItem(paletteStorageKey);
  return palettes.find(palette => palette.key === saved)?.key ?? 'classic';
})();

export function AppearancePicker() {
  const [selected, setSelected] = useState<PaletteKey>(initialPalette);

  function choose(key: PaletteKey) {
    setSelected(key);
    savePalette(key);
  }

  return <section className="appearance-section" aria-labelledby="appearance-heading">
    <div className="appearance-heading">
      <div>
        <h2 id="appearance-heading">Appearance</h2>
        <p>Choose the colors and type style used in ShareTally.</p>
      </div>
    </div>
    <fieldset className="appearance-options" role="radiogroup" aria-label="Appearance">
      <legend className="visually-hidden">Appearance</legend>
      {palettes.map(palette => <label key={palette.key} className="appearance-option" data-palette={palette.key}>
        <input
          type="radio"
          name="appearance-palette"
          value={palette.key}
          checked={selected === palette.key}
          onChange={() => choose(palette.key)}
        />
        <span className="appearance-option-copy">
          <strong>{palette.name}</strong>
          <small>{palette.fonts}</small>
        </span>
        <span className="appearance-swatches" aria-hidden="true">
          <span className="appearance-swatch appearance-swatch-page" />
          <span className="appearance-swatch appearance-swatch-card" />
          <span className="appearance-swatch appearance-swatch-accent" />
          <span className="appearance-swatch appearance-swatch-owed" />
          <span className="appearance-swatch appearance-swatch-owe" />
        </span>
      </label>)}
    </fieldset>
    <p className="appearance-note">Saved on this device.</p>
  </section>;
}
