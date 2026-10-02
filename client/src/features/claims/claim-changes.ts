import { useEffect, useState } from "react";
import type { BillItem } from "@share-tally/domain/contracts/receipts";
import { fraction, type Fraction } from '@share-tally/domain/fractions';
import { subtract, zero } from "../../shared/fractions";

// Long enough to notice whose share moved, short enough not to linger.
const HIGHLIGHT_MS = 1200;

/** A saved change to someone else's claim on an item, highlighted for about a second. */
export type ClaimChange = { itemId: string; userId: string; delta: Fraction; key: number };

function holdings(items: BillItem[], ownId: string | undefined) {
  return new Map(items.map((item) => [item.id, new Map(item.claims
    .filter((claim) => claim.userId !== ownId)
    .map((claim) => [claim.userId, fraction(BigInt(claim.numerator), BigInt(claim.denominator))]))]));
}

/**
 * Compares each refetched bill with the one before and reports other participants' claims
 * that grew, shrank or went away. Only saved claims reach the bill, so nobody's unsaved
 * pick is ever shown. New items and the first load are not changes.
 */
export function useClaimChanges(items: BillItem[], ownId: string | undefined) {
  const [previous, setPrevious] = useState(items);
  const [changes, setChanges] = useState<ClaimChange[]>([]);
  const [generation, setGeneration] = useState(0);
  if (items !== previous) {
    setPrevious(items);
    const before = holdings(previous, ownId);
    const key = generation + 1;
    const found: ClaimChange[] = [];
    for (const [itemId, now] of holdings(items, ownId)) {
      const then = before.get(itemId);
      if (!then) continue;
      for (const userId of new Set([...then.keys(), ...now.keys()])) {
        const delta = subtract(now.get(userId) ?? zero, then.get(userId) ?? zero);
        if (delta.n !== 0n) found.push({ itemId, userId, delta, key });
      }
    }
    if (found.length) {
      setGeneration(key);
      setChanges((current) => [...current.filter((change) =>
        !found.some((next) => next.itemId === change.itemId && next.userId === change.userId)), ...found]);
    }
  }
  useEffect(() => {
    if (!changes.length) return;
    const latest = Math.max(...changes.map((change) => change.key));
    const timer = window.setTimeout(() => setChanges((current) => current.filter((change) => change.key > latest)), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [changes]);
  return changes;
}

