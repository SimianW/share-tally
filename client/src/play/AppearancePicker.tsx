import { useState } from 'react';
import { palettes, type PaletteKey } from './palettes';
import { readSavedPalette, savePalette } from './appearance';
import './appearance.css';

export function AppearancePicker() {
  const [initialPreference] = useState(readSavedPalette);
  const [selected, setSelected] = useState<PaletteKey>(initialPreference.key);
  const [note, setNote] = useState(initialPreference.storageAvailable
    ? 'Saved on this device.'
    : 'Could not read the saved palette. Your changes may not persist.');

  function choose(key: PaletteKey) {
    setSelected(key);
    setNote(savePalette(key)
      ? 'Saved on this device.'
      : 'Palette applied for this session, but could not be saved on this device.');
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
    <p className="appearance-note" role="status" aria-live="polite">{note}</p>
  </section>;
}
