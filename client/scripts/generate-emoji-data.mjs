import { writeFileSync } from 'node:fs';
import english from 'emojibase-data/en/data.json' with { type: 'json' };
import chinese from 'emojibase-data/zh/data.json' with { type: 'json' };

export function buildCompactData(english, chinese) {
  const translations = new Map(chinese.map(emoji => [emoji.hexcode, `${emoji.label} ${emoji.tags?.join(' ') ?? ''}`]));
  return english.map(emoji => {
    const tags = emoji.tags?.join(' ') ?? '';
    const translation = translations.get(emoji.hexcode) ?? '';
    const entry = [emoji.emoji, emoji.label, `${tags} ${translation}`];
    if (emoji.skins?.length) entry.push(emoji.skins.map(skin => {
      const skinTranslation = translations.get(skin.hexcode) ?? translation;
      return skinTranslation === translation ? [skin.emoji, skin.label]
        : [skin.emoji, skin.label, `${tags} ${skinTranslation}`];
    }));
    return entry;
  });
}

if (import.meta.main) {
  writeFileSync(
    new URL('../src/features/groups/icons/emoji-data.json', import.meta.url),
    `[\n${buildCompactData(english, chinese).map(entry => JSON.stringify(entry)).join(',\n')}\n]\n`,
  );
}
