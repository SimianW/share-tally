// Loaded only when the Emoji tab is opened. Skin-tone variants remain selectable.
import english from 'emojibase-data/en/data.json';
import chinese from 'emojibase-data/zh/data.json';
import type { IconChoice } from './icon-catalog';
const translations = new Map(chinese.map(emoji => [emoji.hexcode, `${emoji.label} ${emoji.tags?.join(' ') ?? ''}`]));
export const emojiChoices: IconChoice[] = english.flatMap(emoji => [emoji, ...(emoji.skins ?? [])].map(entry => ({
  icon: { type: 'unicode' as const, value: entry.emoji }, label: entry.label,
  keywords: `${entry.label} ${emoji.tags?.join(' ') ?? ''} ${translations.get(entry.hexcode) ?? translations.get(emoji.hexcode) ?? ''} ${entry.emoji}`,
})));
