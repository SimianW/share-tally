import { lucideIconNames } from './generated/lucide-icon-names.js';

export type GroupIconInput =
  | { type: 'lucide'; value: string }
  | { type: 'unicode'; value: string };

export class InvalidGroupIconError extends Error {}

const lucideNames = new Set(lucideIconNames);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function parseGroupIcon(input: unknown): GroupIconInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidGroupIconError('Icon must be an object.');
  }

  if (!('type' in input) || !('value' in input) || typeof input.value !== 'string') {
    throw new InvalidGroupIconError('Icon must have a type and string value.');
  }

  const { type, value } = input;
  if (type === 'lucide') {
    if (!lucideNames.has(value)) {
      throw new InvalidGroupIconError('Unknown Lucide icon.');
    }
    return { type, value };
  }

  if (type === 'unicode') {
    // Count grapheme clusters so combined emoji remain one character.
    const hasVisibleContent = /[\p{L}\p{N}\p{P}\p{S}]/u.test(value);
    const hasControlCharacter = /\p{Cc}/u.test(value);
    const isSingleCharacter = Array.from(segmenter.segment(value)).length === 1;
    if (!hasVisibleContent || hasControlCharacter || !isSingleCharacter) {
      throw new InvalidGroupIconError('Enter one Unicode symbol or emoji.');
    }
    return { type, value };
  }

  throw new InvalidGroupIconError('Icon type must be lucide or unicode.');
}
