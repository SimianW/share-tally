import type { GroupLedger, LedgerEntry } from '@share-tally/domain/contracts/ledger';
import type { Repayment } from '../repayments/repayments.js';
import type { bills as billsTable } from '../db/schema.js';
import { safeCents } from '../shared/money.js';
import { BillError } from '../shared/bill-error.js';

type MemberBalance = GroupLedger['members'][number];
type Suggestion = GroupLedger['directDebts'][number];
type BillEffect = Extract<LedgerEntry, { kind: 'bill' }>['effects'][number];
type RepaymentEffect = Extract<LedgerEntry, { kind: 'repayment' }>['effects'][number];

// The fields of a complete bill that decide its participants' balances.
export type BalanceBill = Pick<typeof billsTable.$inferSelect, 'initiatorId' | 'totalCents' | 'adjustmentCents'> & {
  participants: { userId: string; amountCents: number | null }[];
};

type LedgerBill = BalanceBill & Pick<typeof billsTable.$inferSelect, 'id' | 'title' | 'purchaseDate' | 'completedAt' | 'canceledAt'>;

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
function ledgerEntries(bills: LedgerBill[], repayments: Repayment[]): LedgerEntry[] {
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

type PairDebt = {
  fromUserId: string;
  toUserId: string;
  cents: bigint;
  lines: { entryId: string; cents: bigint }[];
};

const pairKey = (a: string, b: string) => a < b ? `${a}:${b}` : `${b}:${a}`;

// Index each unordered pair once in entry order. A positive amount means the
// lower-ID member owes the higher-ID member; reverse views negate its lines.
function pairDebts(entries: LedgerEntry[]) {
  const pairs = new Map<string, PairDebt>();
  function add(fromUserId: string, toUserId: string, entryId: string, cents: bigint) {
    if (cents === 0n) return;
    const key = pairKey(fromUserId, toUserId);
    const forward = fromUserId < toUserId;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { fromUserId: forward ? fromUserId : toUserId, toUserId: forward ? toUserId : fromUserId, cents: 0n, lines: [] };
      pairs.set(key, pair);
    }
    const signedCents = forward ? cents : -cents;
    pair.cents += signedCents;
    pair.lines.push({ entryId, cents: signedCents });
  }
  for (const entry of entries) {
    if (entry.kind === 'bill') {
      for (const effect of entry.effects) {
        if (effect.userId !== entry.initiatorId)
          add(effect.userId, entry.initiatorId, entry.id, BigInt(effect.shareCents));
      }
    } else {
      add(entry.senderId, entry.recipientId, entry.id, -BigInt(entry.amountCents));
    }
  }
  return pairs;
}

export function groupLedger(
  bills: LedgerBill[],
  members: { userId: string; displayName: string | null }[],
  repayments: Repayment[] = [],
): GroupLedger {
  const entries = ledgerEntries(bills, repayments);
  const balances = new Map(members.map(member => [member.userId, 0n]));
  for (const entry of entries) for (const effect of entry.effects)
    balances.set(effect.userId, balances.get(effect.userId)! + BigInt(effect.netCents));
  const result = members.map(member => {
    const netCents = safeCents(balances.get(member.userId)!);
    return { userId: member.userId, displayName: member.displayName ?? 'Member', netCents };
  });
  const pairs = pairDebts(entries);
  const directDebts: Suggestion[] = [];
  for (const pair of pairs.values()) {
    if (pair.cents === 0n) continue;
    const forward = pair.cents > 0n;
    directDebts.push({
      fromUserId: forward ? pair.fromUserId : pair.toUserId,
      toUserId: forward ? pair.toUserId : pair.fromUserId,
      amountCents: safeCents(forward ? pair.cents : -pair.cents),
    });
  }
  directDebts.sort((a, b) => a.fromUserId < b.fromUserId ? -1 : a.fromUserId > b.fromUserId ? 1 : a.toUserId < b.toUserId ? -1 : a.toUserId > b.toUserId ? 1 : 0);
  const suggestions = minimumRepayments(result).map(suggestion => {
    const pair = pairs.get(pairKey(suggestion.fromUserId, suggestion.toUserId));
    const sign = pair?.fromUserId === suggestion.fromUserId ? 1n : -1n;
    const direct = (pair?.cents ?? 0n) * sign;
    return {
      ...suggestion,
      explanation: {
        directCents: safeCents(direct),
        directLines: (pair?.lines ?? []).map(line => ({ entryId: line.entryId, cents: safeCents(line.cents * sign) })),
        passedAlongCents: safeCents(BigInt(suggestion.amountCents) - direct),
      },
    };
  });
  return {
    members: result,
    suggestions,
    directDebts,
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
