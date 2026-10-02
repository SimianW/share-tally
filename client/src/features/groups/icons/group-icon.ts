import type { GroupIcon as ContractGroupIcon } from '@share-tally/domain/contracts/groups';
import { iconNames, type IconName } from "lucide-react/dynamic.js";

export type GroupIcon = ContractGroupIcon<IconName>;

const names = new Set<string>(iconNames);
export function isLucideIconName(value: string): value is IconName {
  return names.has(value);
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function isUnicodeIcon(value: string): boolean {
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(value) &&
    !/\p{Cc}/u.test(value) &&
    Array.from(segmenter.segment(value)).length === 1;
}
