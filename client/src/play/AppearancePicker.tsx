import { useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { palettes, schemes, type PaletteKey, type SchemeKey } from './palettes';
import { getCurrentPalette, getCurrentScheme, readSavedPalette, readSavedScheme, savePalette, saveScheme } from './appearance';
import './appearance.css';

export function AppearancePicker() {
  const [initialPreference] = useState(readSavedPalette);
  const [initialScheme] = useState(readSavedScheme);
  const [selected, setSelected] = useState<PaletteKey>(getCurrentPalette);
  const [scheme, setScheme] = useState<SchemeKey>(getCurrentScheme);
  const [note, setNote] = useState(!initialPreference.storageAvailable
    ? 'Could not read the saved palette. Your changes may not persist.'
    : !initialScheme.storageAvailable
      ? 'Could not read the saved mode. Your changes may not persist.'
      : 'Saved on this device.');

  function choose(key: PaletteKey) {
    setSelected(key);
    setNote(savePalette(key)
      ? 'Saved on this device.'
      : 'Palette applied for this session, but could not be saved on this device.');
  }

  function chooseScheme(key: SchemeKey) {
    setScheme(key);
    setNote(saveScheme(key)
      ? 'Saved on this device.'
      : 'Mode applied for this session, but could not be saved on this device.');
  }

  return <section className="appearance-section" aria-labelledby="appearance-heading">
    <div className="appearance-heading">
      <div>
        <h2 id="appearance-heading">Appearance</h2>
        <p>Choose the colors and type style used in ShareTally.</p>
      </div>
    </div>
    <fieldset className="appearance-modes" role="radiogroup" aria-label="Mode">
      <legend className="visually-hidden">Mode</legend>
      {schemes.map(option => {
        const Icon = { system: Monitor, light: Sun, dark: Moon }[option.key];
        return <label key={option.key} className="appearance-mode">
          <input
            type="radio"
            name="appearance-scheme"
            value={option.key}
            checked={scheme === option.key}
            onChange={() => chooseScheme(option.key)}
          />
          <Icon aria-hidden="true" />
          <span>{option.name}</span>
        </label>;
      })}
    </fieldset>
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
