import { parseMoney } from "../../money";
import { cost, one, text } from "../../fractions";
import { fraction, type Fraction } from '@share-tally/domain/fractions';
import type { PortionChoice } from "./PortionPicker";

// A portion of a By amount bill's total is only an input helper. A pick becomes a whole-cent
// amount, rounded half up like an item claim's cost, and only that amount is saved.

/** Even · 1/N first, then All and 1/2 to 1/6, leaving out the fixed choice that repeats Even. */
export function amountChoices(count: number, allName = "All"): PortionChoice[] {
  const n = Math.max(1, count);
  const even = fraction(1n, BigInt(n));
  const choices: PortionChoice[] = [{ key: "even", fraction: even, name: `Even · ${portionText(even)}`, tag: "Even" }];
  if (n > 1) choices.push({ key: "all", fraction: one, name: allName });
  for (let d = 2; d <= 6; d++) if (d !== n) choices.push({ key: `1/${d}`, fraction: fraction(1n, BigInt(d)), name: `1/${d}` });
  return choices;
}

export const portionText = (f: Fraction) => f.n === f.d ? "All" : text(f);

/**
 * The choice an amount is for this total, derived and never stored: a choice matches when the
 * amount equals its rounded amount. Even comes first, so it wins a tie. A custom fraction only
 * counts when no fixed choice matches.
 */
export function pressedChoice(choices: PortionChoice[], totalCents: number | null, cents: number | null, custom: Fraction | null) {
  if (totalCents === null || cents === null) return null;
  const hit = choices.find((choice) => cost(totalCents, choice.fraction) === cents);
  if (hit) return { key: hit.key, fraction: hit.fraction };
  if (custom && cost(totalCents, custom) === cents) return { key: "custom", fraction: custom };
  return null;
}

/** A typed amount in cents, or null when it is empty or not a valid CAD amount. */
export function parseCents(value: string): number | null {
  if (!value.trim()) return null;
  try {
    return parseMoney(value);
  } catch {
    return null;
  }
}

