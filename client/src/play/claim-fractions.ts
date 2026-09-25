import { money, type Bill } from "./bill-api";
import type { BillItem, ItemClaim } from "./receipt-api";

// Match the server's BigInt rational arithmetic: sum exact fractions, then round
// the participant's *whole* share once, not each item independently.
type Fraction = { n: bigint; d: bigint };
function gcd(a: bigint, b: bigint): bigint { return b ? gcd(b, a % b) : a; }
export function fraction(n: bigint, d: bigint): Fraction {
  const divisor = gcd(n < 0n ? -n : n, d);
  return { n: n / divisor, d: d / divisor };
}
function add(a: Fraction, b: Fraction): Fraction { return fraction(a.n * b.d + b.n * a.d, a.d * b.d); }
const zero: Fraction = { n: 0n, d: 1n };
export const one: Fraction = { n: 1n, d: 1n };
export function sum(claims: Pick<ItemClaim, "numerator" | "denominator">[]): Fraction {
  return claims.reduce((a, c) => add(a, fraction(BigInt(c.numerator), BigInt(c.denominator))), zero);
}
export function subtract(a: Fraction, b: Fraction): Fraction { return add(a, fraction(-b.n, b.d)); }
export function text(f: Fraction) { return `${f.n}/${f.d}`; }
export function shortText(f: Fraction) {
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return f.d === 1n ? String(f.n) : `${String(f.n).replace(/\d/g, (c) => digits[Number(c)])}⁄${String(f.d).replace(/\d/g, (c) => digits[Number(c)])}`;
}
export function parse(value: string): Fraction | null {
  const match = /^(\d+)(?:\/(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]), d = Number(match[2] ?? 1);
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || n < 1 || d < n || n > 10000 || d > 10000) return null;
  return fraction(BigInt(n), BigInt(d));
}
export function lessOrEqual(a: Fraction, b: Fraction) { return a.n * b.d <= b.n * a.d; }
export function cost(cents: number, f: Fraction) { return Number((BigInt(cents) * f.n * 2n + f.d) / (2n * f.d)); }
export function share(items: BillItem[], selection: Record<string, string>) {
  const total = items.reduce((a, item) => {
    const f = parse(selection[item.id] ?? "");
    return f ? add(a, fraction(BigInt(item.finalCents) * f.n, f.d)) : a;
  }, zero);
  return Number((total.n * 2n + total.d) / (2n * total.d));
}
export function signed(cents: number) { return cents < 0 ? `−${money(-cents)}` : money(cents); }

export function claimAvailabilityMessage(bill: Bill, selection: Record<string, string>) {
  const own = bill.participants.find((p) => p.isCurrentUser);
  for (const item of bill.items ?? []) {
    const chosen = parse(selection[item.id] ?? "");
    if (!chosen) continue;
    const room = subtract(one, sum(item.claims.filter((claim) => claim.userId !== own?.userId)));
    if (!lessOrEqual(chosen, room)) return `Not enough of ${item.name} is available. Only ${text(room)} is currently available to you. Other confirmed or reserved claims already hold that portion.`;
  }
  return null;
}

