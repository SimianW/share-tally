
export type Summary = {
  receivableCents: number;
  payableCents: number;
  netCents: number;
};
// A complete bill or confirmed repayment with each affected member's signed
// effect. A member's effects across all entries sum to their net balance.
// Entries arrive in the order they took effect: completion or confirmation time.
export type LedgerEntry =
  | { kind: 'bill'; id: string; title: string; purchaseDate: string; completedAt: string; initiatorId: string; totalCents: number;
      effects: { userId: string; paidCents: number; shareCents: number; adjustmentCents: number; netCents: number }[] }
  | { kind: 'repayment'; id: string; senderId: string; recipientId: string; amountCents: number; decidedAt: string;
      effects: { userId: string; netCents: number }[] };
export type GroupLedger = {
  members: { userId: string; displayName: string; netCents: number }[];
  // Users who left the group but appear in its bills or repayment records, so
  // retained history can still name them. They are never repayment targets;
  // netCents sums their retained effects, zero because they left settled.
  formerMembers: { userId: string; displayName: string; netCents: number }[];
  // Each suggestion's amount is what its payer directly owes its recipient plus
  // what the fewest-transfers simplification passed along (either may be negative).
  suggestions: { fromUserId: string; toUserId: string; amountCents: number; explanation: {
    directCents: number;
    // Entries between the two, signed from the payer's side, in entry order.
    directLines: { entryId: string; cents: number }[];
    passedAlongCents: number;
  } }[];
  incompleteBillIds: string[];
  entries: LedgerEntry[];
  // What one member owes another from their own entries, netted per pair; positive.
  directDebts: { fromUserId: string; toUserId: string; amountCents: number }[];
};
