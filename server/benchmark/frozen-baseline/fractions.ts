// Frozen benchmark baseline from commit 16509935cb34d505ee8d48c5616c2a22ff908e2f (#48).
// Intentional snapshot: do not update when production behavior changes. No secrets or recordings.
// BigInt rational arithmetic keeps thirds exact until the final personal total.
export type Fraction = { n: bigint; d: bigint };
function gcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : gcd(b, a % b);
}
export function fraction(n: bigint, d: bigint): Fraction {
  const divisor = gcd(n < 0n ? -n : n, d);
  return { n: n / divisor, d: d / divisor };
}
export function add(a: Fraction, b: Fraction) {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}
export function sumFractions(
  rows: { numerator: number; denominator: number }[],
) {
  return rows.reduce(
    (a, r) => add(a, fraction(BigInt(r.numerator), BigInt(r.denominator))),
    { n: 0n, d: 1n },
  );
}
export function roundedCost(
  rows: { numerator: number; denominator: number; finalCents: number }[],
) {
  const total = rows.reduce(
    (a, r) =>
      add(
        a,
        fraction(
          BigInt(r.numerator) * BigInt(r.finalCents),
          BigInt(r.denominator),
        ),
      ),
    { n: 0n, d: 1n },
  );
  return Number((total.n * 2n + total.d) / (2n * total.d));
}
// Largest remainders, with source order as the stable tie breaker.
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (!total) {
    if (!amount) return weights.map(() => 0);
    throw new Error(
      "Cannot allocate a receipt adjustment across zero-cost items. Enter the item costs manually.",
    );
  }
  const sign = amount < 0 ? -1 : 1;
  const magnitude = BigInt(Math.abs(amount));
  const rows = weights.map((w, i) => ({
    i,
    value: Number((magnitude * BigInt(w)) / total),
    remainder: (magnitude * BigInt(w)) % total,
  }));
  let left = Math.abs(amount) - rows.reduce((s, r) => s + r.value, 0);
  for (const row of [...rows].sort((a, b) =>
    a.remainder === b.remainder
      ? a.i - b.i
      : a.remainder > b.remainder
        ? -1
        : 1,
  )) {
    if (left-- > 0) row.value++;
  }
  return rows.map((r) => sign * r.value);
}
