/** Shared palette metadata for the forthcoming Account appearance picker. */
export const palettes = [
  { key: 'classic', name: 'Classic (today)', fonts: 'Nunito + DM Sans' },
  { key: 'marigold', name: 'Marigold', fonts: 'Bricolage Grotesque + DM Sans' },
  { key: 'raspberry', name: 'Raspberry', fonts: 'Fraunces + Figtree' },
  { key: 'plum-butter', name: 'Plum & Butter', fonts: 'Nunito + DM Sans' },
  { key: 'lagoon', name: 'Lagoon', fonts: 'Manrope + Instrument Sans' },
  { key: 'blueberry', name: 'Blueberry Jam', fonts: 'Outfit + Figtree' },
] as const;

export type PaletteKey = (typeof palettes)[number]['key'];
