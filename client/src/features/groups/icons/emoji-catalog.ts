// Loaded only when the Emoji tab is opened. Skin-tone variants remain selectable.
import data from './emoji-data.json' with { type: 'json' };
import type { IconChoice } from './icon-catalog';

type CompactSkin = [value: string, label: string, keywords?: string];
type CompactEmoji = [value: string, label: string, keywords: string, skins?: CompactSkin[]];

export const emojiChoices: IconChoice[] = (data as CompactEmoji[]).flatMap(([value, label, keywords, skins = []]) => {
  const entries: CompactSkin[] = [[value, label], ...skins];
  return entries.map(([value, label, override]) => ({
    icon: { type: 'unicode' as const, value }, label,
    keywords: `${label} ${override ?? keywords} ${value}`,
  }));
});
