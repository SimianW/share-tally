import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import english from 'emojibase-data/en/data.json' with { type: 'json' };
import chinese from 'emojibase-data/zh/data.json' with { type: 'json' };

const generatedFile = new URL('../src/features/groups/icons/emoji-data.json', import.meta.url);
const translations = new Map(chinese.map(emoji => [emoji.hexcode, `${emoji.label} ${emoji.tags?.join(' ') ?? ''}`]));
const legacyChoices = english.flatMap(emoji => [emoji, ...(emoji.skins ?? [])].map(entry => ({
  icon: { type: 'unicode', value: entry.emoji }, label: entry.label,
  keywords: `${entry.label} ${emoji.tags?.join(' ') ?? ''} ${translations.get(entry.hexcode) ?? translations.get(emoji.hexcode) ?? ''} ${entry.emoji}`,
})));

test('committed emoji metadata is generated from the installed source data', async () => {
  const committed = JSON.parse(readFileSync(generatedFile, 'utf8'));
  const { buildCompactData } = await import('./generate-emoji-data.mjs');
  assert.deepEqual(committed, buildCompactData(english, chinese));
});

test('emoji choices retain every legacy icon, label, keyword string and ordering', async () => {
  const { emojiChoices } = await import('../src/features/groups/icons/emoji-catalog.ts');
  assert.deepEqual(emojiChoices, legacyChoices);
});

test('picker search retains English, Chinese, tag-only and normalized multi-word results', async () => {
  const { emojiChoices } = await import('../src/features/groups/icons/emoji-catalog.ts');
  const { searchChoices } = await import('../src/features/groups/icons/icon-search.ts');
  for (const [query, expected] of [
    ['pizza', '🍕'], ['披萨', '🍕'], ['购物', '🛒'], ['ttyl', '👋'],
    ['  WAVING-hand\tmedium skin-tone  ', '👋🏽'], ['👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦'],
    ['', '🍕'], [' \t ', '🍕'], ['no-such-emoji-match', null],
  ]) {
    const words = query.toLowerCase().trim().replaceAll('-', ' ').split(/\s+/);
    const legacyResults = legacyChoices.filter(item => words.every(word => item.keywords.toLowerCase().includes(word)))
      .map(item => item.icon.value);
    const results = searchChoices(emojiChoices, query).map(item => item.icon.value);
    assert.deepEqual(searchChoices(legacyChoices, query).map(item => item.icon.value), legacyResults, query);
    assert.deepEqual(results, legacyResults, query);
    if (expected) assert.ok(results.includes(expected), `${query} includes ${expected}`);
    else assert.deepEqual(results, [], query);
  }
  assert.ok(!legacyChoices.find(item => item.icon.value === '👋').label.includes('ttyl'));
});

test('skin-tone and combined emoji retain their selectable and saved Unicode icon values', async () => {
  const { emojiChoices } = await import('../src/features/groups/icons/emoji-catalog.ts');
  const { isUnicodeIcon } = await import('../src/features/groups/icons/group-icon.ts');
  for (const [value, label] of [
    ['👋🏽', 'waving hand: medium skin tone'],
    ['👨‍👩‍👧‍👦', 'family: man, woman, girl, boy'],
  ]) {
    const choice = emojiChoices.find(item => item.icon.value === value);
    assert.ok(choice, value);
    assert.deepEqual(choice.icon, { type: 'unicode', value });
    assert.equal(choice.label, label);
    assert.ok(isUnicodeIcon(choice.icon.value), value);
  }
  for (const value of ['★', '✓', '👨‍👩‍👧‍👦']) assert.ok(isUnicodeIcon(value), value);
  assert.equal(isUnicodeIcon('ab'), false);
});
