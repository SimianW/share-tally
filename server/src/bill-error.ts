export type ItemConflicts = {
  stale: (
    | { itemId: string; kind: "changed"; finalCents: number; name: string }
    | { itemId: string; kind: "added" | "removed" }
  )[];
  // Decimal integer strings preserve exact fractions even beyond Number's range.
  overAllocated: { itemId: string; available: { numerator: string; denominator: string } }[];
};

export class BillError extends Error {
  constructor(
    public status: number,
    message: string,
    public conflicts?: ItemConflicts,
  ) {
    super(message);
  }
}
