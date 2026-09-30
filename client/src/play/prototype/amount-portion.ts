// PROTOTYPE for #150 — throwaway, do not ship.
// Plan: three variants of the By amount share picker, switchable via ?variant=A|B|C.
// Pure helpers: the portion choices and what the current amount says about them.
// A portion is only an input helper; the amount in cents is all that is stored.
import { parseMoney } from "../bill-api";
import { cost, fraction, one, text, type Fraction } from "../claim-fractions";

export type Person = { id: string; displayName: string; imageUrl?: string | null };
/** Another participant and their submitted amount; null means not submitted yet. */
export type Other = { person: Person; cents: number | null };

export type Choice = { key: string; fraction: Fraction; even: boolean };

/** [Even · 1/N] [All] [1/2]…[1/6], dropping the fixed choice that repeats Even. */
export function choicesFor(count: number): Choice[] {
  const n = Math.max(1, count);
  const even = n === 1 ? one : fraction(1n, BigInt(n));
  const choices: Choice[] = [{ key: "even", fraction: even, even: true }];
  if (n > 1) choices.push({ key: "all", fraction: one, even: false });
  for (let d = 2; d <= 6; d++) if (d !== n) choices.push({ key: `1/${d}`, fraction: fraction(1n, BigInt(d)), even: false });
  return choices;
}

export const isAll = (f: Fraction) => f.n === f.d;
export const fractionLabel = (f: Fraction) => (isAll(f) ? "All" : text(f));
export const sameFraction = (a: Fraction | null, b: Fraction | null) => !!a && !!b && a.n === b.n && a.d === b.d;

export type Pressed = { key: string; fraction: Fraction; even: boolean };

/**
 * The choice the amount matches, derived and never stored: a choice is pressed iff
 * amount === round(total × fraction). The first match in button order wins; a custom
 * fraction only counts when no fixed choice matches.
 */
export function pressedChoice(choices: Choice[], totalCents: number | null, mineCents: number | null, custom: Fraction | null): Pressed | null {
  if (totalCents === null || mineCents === null) return null;
  const hit = choices.find((choice) => cost(totalCents, choice.fraction) === mineCents);
  if (hit) return hit;
  if (custom && cost(totalCents, custom) === mineCents) return { key: "custom", fraction: custom, even: false };
  return null;
}

export function parseCents(value: string): number | null {
  if (!value.trim()) return null;
  try {
    return parseMoney(value);
  } catch {
    return null;
  }
}
export const amountText = (cents: number) => (cents / 100).toFixed(2);

/** What everyone else has submitted and where this amount lands against the total. */
export function tally(totalCents: number | null, others: Other[], mineCents: number | null) {
  const othersSum = others.reduce((sum, other) => sum + (other.cents ?? 0), 0);
  const mine = mineCents ?? 0;
  const total = totalCents ?? 0;
  return {
    othersSum,
    left: total - othersSum,
    free: Math.max(0, total - othersSum - mine),
    over: totalCents === null ? 0 : Math.max(0, othersSum + mine - total),
    difference: total - othersSum - mine,
  };
}
