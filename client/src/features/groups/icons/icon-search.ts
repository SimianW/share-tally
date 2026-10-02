import type { IconChoice } from './icon-catalog';

export function searchChoices(choices: IconChoice[], query: string): IconChoice[] {
  const words = query.toLowerCase().trim().replaceAll('-', ' ').split(/\s+/);
  return choices.filter(item => words.every(word => item.keywords.toLowerCase().includes(word)));
}
