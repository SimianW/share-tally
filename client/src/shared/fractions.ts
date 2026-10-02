import { add, fraction, sumFractions, type Fraction } from '@share-tally/domain/fractions';
import type { ItemClaim } from '@share-tally/domain/contracts/receipts';
// Match the server's BigInt rational arithmetic: sum exact fractions, then round
// the participant's *whole* share once, not each item independently.
export const zero: Fraction = { n: 0n, d: 1n };
export const one: Fraction = { n: 1n, d: 1n };
export function sum(claims: Pick<ItemClaim, "numerator" | "denominator">[]): Fraction {
  return sumFractions(claims);
}
export function subtract(a: Fraction, b: Fraction): Fraction { return add(a, fraction(-b.n, b.d)); }
export function text(f: Fraction) { return `${f.n}/${f.d}`; }
export function shortText(f: Fraction) { return f.d === 1n ? String(f.n) : text(f); }
// Claims store numerators and denominators of at most 10,000, here and on the server.
export const maxClaimPart = 10_000n;
export function claimable(f: Fraction) { return f.n > 0n && f.n <= maxClaimPart && f.d <= maxClaimPart; }
export function parseClaimInput(value: string): { numerator: number; denominator: number } | { error: 'syntax' | 'range' } {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(value.trim());
  if (!match) return { error: 'syntax' };
  const numerator = Number(match[1]), denominator = Number(match[2] ?? 1);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) ||
    numerator < 1 || denominator < numerator || numerator > 10000 || denominator > 10000) return { error: 'range' };
  return { numerator, denominator };
}

export function parse(value: string): Fraction | null {
  const parsed = parseClaimInput(value);
  return 'error' in parsed ? null : fraction(BigInt(parsed.numerator), BigInt(parsed.denominator));
}
// The server sends exact fractions as decimal integer strings.
export function fromParts(numerator: string, denominator: string): Fraction {
  return fraction(BigInt(numerator), BigInt(denominator));
}
export function lessOrEqual(a: Fraction, b: Fraction) { return a.n * b.d <= b.n * a.d; }
export function cost(cents: number, f: Fraction) { return Number((BigInt(cents) * f.n * 2n + f.d) / (2n * f.d)); }
