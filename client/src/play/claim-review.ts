import type { BillItem, ReviewedItem } from "./receipt-api";
import { lessOrEqual, one, parse, subtract, sum, zero, type Fraction } from "./claim-fractions";

/**
 * What a participant last acknowledged about an item: the version the server
 * checks, plus the name and cost they saw, so a later change can say what moved.
 */
export type SeenItem = ReviewedItem & { name: string; finalCents: number };

export function seenOf(item: BillItem): SeenItem {
  return { itemId: item.id, version: item.version, name: item.name, finalCents: item.finalCents };
}

/** Marks one item as seen at its current version, leaving every other item untouched. */
export function acknowledge(seen: SeenItem[], item: BillItem): SeenItem[] {
  const entry = seen.find((candidate) => candidate.itemId === item.id);
  if (entry?.version === item.version && entry.name === item.name && entry.finalCents === item.finalCents) return seen;
  return entry ? seen.map((candidate) => candidate.itemId === item.id ? seenOf(item) : candidate) : [...seen, seenOf(item)];
}

/**
 * The reviewed list sent with a claim: only items still on the bill, each at the version the
 * participant acknowledged. Removed items would otherwise pile up past the server's limit.
 */
export function reviewedFor(seen: SeenItem[], items: BillItem[]): ReviewedItem[] {
  return seen.filter((entry) => items.some((item) => item.id === entry.itemId))
    .map(({ itemId, version }) => ({ itemId, version }));
}

/** An item as the page last showed it, kept after the item leaves the bill. */
export type KnownItem = { name: string; finalCents: number; index: number };

export function knownOf(items: BillItem[]): Record<string, KnownItem> {
  return Object.fromEntries(items.map((item, index) => [item.id, { name: item.name, finalCents: item.finalCents, index }]));
}

export type ItemAttention = {
  /** Added since the participant last looked at the bill. Opening it acknowledges it. */
  isNew: boolean;
  /** The participant's pick is on an item whose price or name changed since they saw it. */
  changed: { from: SeenItem; to: BillItem } | null;
  /** An unselected item changed. Shown quietly; it never blocks Confirm. */
  updated: boolean;
  /** The pick plus everyone else's claims exceeds the item. */
  over: { left: Fraction; by: Fraction } | null;
  /** The server rejected the last Confirm because this item ran out. */
  conflict: boolean;
  /** The draft holds something that is not a claimable fraction, so it cannot be confirmed. */
  invalid: boolean;
};

/** A picked item the initiator removed. It has no sheet, only a row to dismiss. */
export type RemovedItem = { itemId: string; name: string; finalCents: number; portion: Fraction | null; index: number };

export type Blocker =
  | { kind: "item"; itemId: string; review: boolean; over: boolean; invalid: boolean }
  | { kind: "removed"; itemId: string };

export type ClaimReview = {
  attention: Record<string, ItemAttention>;
  removed: RemovedItem[];
  /** Everything that keeps Confirm disabled, in list order. */
  blockers: Blocker[];
  reviewCount: number;
  overCount: number;
};

/** The fraction of an item still open to this participant: whatever other people hold is not. */
export function roomFor(item: BillItem, ownId: string | undefined): Fraction {
  return subtract(one, sum(item.claims.filter((claim) => claim.userId !== ownId)));
}

export function overAllocation(item: BillItem, ownId: string | undefined, pick: Fraction | null) {
  if (!pick) return null;
  const room = roomFor(item, ownId);
  if (lessOrEqual(pick, room)) return null;
  const left = room.n > 0n ? room : zero;
  return { left, by: subtract(pick, left) };
}

export function needsReview(attention: ItemAttention) {
  return attention.isNew || !!attention.changed;
}

/**
 * Compares the participant's draft and acknowledgements with the live bill.
 * Mirrors the server's claim checks (ADR-0014): selected items whose version
 * changed, items never reviewed, selected items that are gone, and picks that
 * no longer fit. Unselected changes are reported but never block.
 */
export function claimReview({ items, ownId, selection, seen, known, conflicts }: {
  items: BillItem[];
  ownId: string | undefined;
  selection: Record<string, string>;
  seen: SeenItem[];
  known: Record<string, KnownItem>;
  conflicts: string[];
}): ClaimReview {
  const attention: Record<string, ItemAttention> = {};
  for (const item of items) {
    const entry = seen.find((candidate) => candidate.itemId === item.id);
    const pick = parse(selection[item.id] ?? "");
    const differs = !!entry && entry.version !== item.version;
    attention[item.id] = {
      isNew: !entry,
      changed: differs && pick ? { from: entry, to: item } : null,
      updated: differs && !pick,
      over: overAllocation(item, ownId, pick),
      conflict: conflicts.includes(item.id),
      invalid: !!(selection[item.id] ?? "").trim() && !pick,
    };
  }
  const removed = Object.entries(selection).flatMap(([itemId, value]) => {
    const portion = parse(value);
    if (!value.trim() || items.some((item) => item.id === itemId)) return [];
    const last = known[itemId] ?? { name: "An item", finalCents: 0, index: items.length };
    return [{ itemId, portion, ...last }];
  }).sort((a, b) => a.index - b.index);
  const blockers: Blocker[] = [];
  const removedAt = (index: number) => removed.filter((entry) => entry.index === index)
    .forEach((entry) => blockers.push({ kind: "removed", itemId: entry.itemId }));
  items.forEach((item, index) => {
    removedAt(index);
    const review = needsReview(attention[item.id]);
    const over = !!attention[item.id].over;
    const invalid = attention[item.id].invalid;
    if (review || over || invalid) blockers.push({ kind: "item", itemId: item.id, review, over, invalid });
  });
  removed.filter((entry) => entry.index >= items.length)
    .forEach((entry) => blockers.push({ kind: "removed", itemId: entry.itemId }));
  return {
    attention,
    removed,
    blockers,
    reviewCount: blockers.filter((blocker) => blocker.kind === "removed" || blocker.review).length,
    overCount: blockers.filter((blocker) => blocker.kind === "item" && blocker.over).length,
  };
}
