import type { Repayment } from './repayments.js';
import type { readBills } from './bills.js';
import type { bills as billsTable } from './db/schema.js';
import { safeCents } from './money.js';
import { BillError } from './bill-error.js';

type MemberBalance = { userId: string; displayName: string; netCents: number };
type Suggestion = { fromUserId: string; toUserId: string; amountCents: number };
type BillEffect = { userId: string; paidCents: number; shareCents: number; adjustmentCents: number; netCents: number };
type RepaymentEffect = { userId: string; netCents: number };
type LedgerEntry =
  | { kind: 'bill'; id: string; title: string; purchaseDate: string; completedAt: string; initiatorId: string; totalCents: number; effects: BillEffect[] }
  | { kind: 'repayment'; id: string; senderId: string; recipientId: string; amountCents: number; decidedAt: string; effects: RepaymentEffect[] };

// The fields of a complete bill that decide its participants' balances.
export type BalanceBill = Pick<typeof billsTable.$inferSelect, 'initiatorId' | 'totalCents' | 'adjustmentCents'> & {
  participants: { userId: string; amountCents: number | null }[];
};

export const counted = (bill: { completedAt: Date | null; canceledAt: Date | null }) =>
  bill.completedAt !== null && bill.canceledAt === null;

// The initiator gains the bill total and loses their share plus the initiator
// adjustment; every other participant loses their share. Every balance view
// sums these effects, so explanations and balances cannot diverge.
export function billEffects(bill: BalanceBill): BillEffect[] {
  return bill.participants.map(share => {
    const initiator = share.userId === bill.initiatorId;
    const paidCents = initiator ? bill.totalCents : 0;
    const shareCents = share.amountCents!;
    const adjustmentCents = initiator ? bill.adjustmentCents! : 0;
    return { userId: share.userId, paidCents, shareCents, adjustmentCents, netCents: paidCents - shareCents - adjustmentCents };
  });
}

// One equal-and-opposite pair per confirmed record; pending and rejected
// records have no effect.
export function repaymentEffects(record: Repayment): RepaymentEffect[] {
  if (record.status !== 'confirmed') return [];
  return [
    { userId: record.senderId, netCents: record.amountCents },
    { userId: record.recipientId, netCents: -record.amountCents },
  ];
}

// Complete, non-canceled bills and confirmed repayments, ordered by when they
// took effect on balances: completion or confirmation time, then entry id. The
// purchase date is user-entered, so it is display-only and never a sort key.
function ledgerEntries(bills: Awaited<ReturnType<typeof readBills>>, repayments: Repayment[]): LedgerEntry[] {
  const timed: { at: Date; entry: LedgerEntry }[] = [];
  for (const bill of bills) {
    if (!counted(bill)) continue;
    const { id, title, purchaseDate, initiatorId, totalCents } = bill;
    const completedAt = bill.completedAt!.toISOString();
    timed.push({
      at: bill.completedAt!,
      entry: { kind: 'bill', id, title, purchaseDate, completedAt, initiatorId, totalCents, effects: billEffects(bill) },
    });
  }
  for (const record of repayments) {
    if (record.status !== 'confirmed') continue;
    const { id, senderId, recipientId, amountCents } = record;
    const decidedAt = record.decidedAt!.toISOString();
    timed.push({
      at: record.decidedAt!,
      entry: { kind: 'repayment', id, senderId, recipientId, amountCents, decidedAt, effects: repaymentEffects(record) },
    });
  }
  return timed.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0))
    .map(item => item.entry);
}

export function groupLedger(
  bills: Awaited<ReturnType<typeof readBills>>,
  members: { userId: string; displayName: string | null }[],
  repayments: Repayment[] = [],
) {
  const entries = ledgerEntries(bills, repayments);
  const balances = new Map(members.map(member => [member.userId, 0n]));
  for (const entry of entries) for (const effect of entry.effects)
    balances.set(effect.userId, balances.get(effect.userId)! + BigInt(effect.netCents));
  const result = members.map(member => {
    const netCents = safeCents(balances.get(member.userId)!);
    return { userId: member.userId, displayName: member.displayName ?? 'Member', netCents };
  });
  return {
    members: result,
    suggestions: minimumRepayments(result),
    incompleteBillIds: bills.filter(bill => !bill.completedAt && !bill.canceledAt).map(bill => bill.id),
    entries,
  };
}

// Every connected repayment component has zero total balance and needs at least
// k - 1 transfers for k nonzero members. Maximize disjoint zero-sum components
// first, then clear each component in k - 1 transfers.
export function minimumRepayments(members: MemberBalance[]): Suggestion[] {
  const active = members.filter(member => member.netCents !== 0)
    .sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
  if (members.length > 16) throw new BillError(422, 'Groups can have up to 16 members.');
  const subsetCount = 1 << active.length;
  const subsetSums: bigint[] = Array(subsetCount).fill(0n);
  const maxComponentCounts = new Uint8Array(subsetCount);
  const removedMemberIndex = new Uint8Array(subsetCount);
  for (let mask = 1; mask < subsetCount; mask++) {
    const bit = mask & -mask;
    subsetSums[mask] = subsetSums[mask ^ bit] + BigInt(active[31 - Math.clz32(bit)].netCents);
    let best = -1;
    // Strict improvement preserves the first member-ID choice on equal optima.
    for (let i = 0; i < active.length; i++) {
      if (!(mask & (1 << i))) continue;
      const count = maxComponentCounts[mask ^ (1 << i)];
      if (count > best) { best = count; removedMemberIndex[mask] = i; }
    }
    maxComponentCounts[mask] = best + (subsetSums[mask] === 0n ? 1 : 0);
  }
  if (subsetSums[subsetCount - 1] !== 0n) throw new Error('Group balances must sum to zero.');
  const result: Suggestion[] = [];
  let component: MemberBalance[] = [];
  for (let mask = subsetCount - 1; mask;) {
    const index = removedMemberIndex[mask];
    component.push(active[index]);
    mask ^= 1 << index;
    if (subsetSums[mask] === 0n) {
      result.push(...clearComponent(component));
      component = [];
    }
  }
  return result;
}

function clearComponent(members: MemberBalance[]): Suggestion[] {
  const debtors = members.filter(m => m.netCents < 0).map(m => ({ ...m }));
  const creditors = members.filter(m => m.netCents > 0).map(m => ({ ...m }));
  const result: Suggestion[] = [];
  for (const debtor of debtors) for (const creditor of creditors) {
    const amountCents = Math.min(-debtor.netCents, creditor.netCents);
    if (!amountCents) continue;
    result.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountCents });
    debtor.netCents += amountCents;
    creditor.netCents -= amountCents;
  }
  return result;
}
