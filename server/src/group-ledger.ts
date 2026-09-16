import type { readBills } from './bills.js';
import { BillError } from './bill-error.js';

type MemberBalance = { userId: string; displayName: string; netCents: number };
type Suggestion = { fromUserId: string; toUserId: string; amountCents: number };

export function groupLedger(
  bills: Awaited<ReturnType<typeof readBills>>,
  members: { userId: string; displayName: string | null }[],
) {
  const balances = new Map(members.map(member => [member.userId, 0n]));
  for (const bill of bills) {
    if (!bill.completedAt || bill.canceledAt) continue;
    balances.set(bill.initiatorId, balances.get(bill.initiatorId)! + BigInt(bill.totalCents));
    for (const share of bill.participants) {
      const cost = BigInt(share.amountCents!) + (share.userId === bill.initiatorId ? BigInt(bill.adjustmentCents!) : 0n);
      balances.set(share.userId, balances.get(share.userId)! - cost);
    }
  }
  const result = members.map(member => {
    const netCents = Number(balances.get(member.userId)!);
    if (!Number.isSafeInteger(netCents)) throw new BillError(422, 'Balance exceeds the supported range.');
    return { userId: member.userId, displayName: member.displayName ?? 'Member', netCents };
  });
  return {
    members: result,
    suggestions: minimumRepayments(result),
    incompleteBillIds: bills.filter(bill => !bill.completedAt && !bill.canceledAt).map(bill => bill.id),
  };
}

// Every connected repayment component has zero total balance and needs at least
// k - 1 transfers for k nonzero members. Maximize disjoint zero-sum components
// first, then clear each component in k - 1 transfers.
export function minimumRepayments(members: MemberBalance[]): Suggestion[] {
  const active = members.filter(member => member.netCents !== 0)
    .sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
  if (members.length > 16) throw new BillError(422, 'Groups can have up to 16 members.');
  const size = 1 << active.length;
  const sums: bigint[] = Array(size).fill(0n);
  const counts = new Uint8Array(size);
  const last = new Uint8Array(size);
  for (let mask = 1; mask < size; mask++) {
    const bit = mask & -mask;
    sums[mask] = sums[mask ^ bit] + BigInt(active[31 - Math.clz32(bit)].netCents);
    let best = -1;
    // Strict improvement preserves the first member-ID choice on equal optima.
    for (let i = 0; i < active.length; i++) {
      if (!(mask & (1 << i))) continue;
      const count = counts[mask ^ (1 << i)];
      if (count > best) { best = count; last[mask] = i; }
    }
    counts[mask] = best + (sums[mask] === 0n ? 1 : 0);
  }
  if (sums[size - 1] !== 0n) throw new Error('Group balances must sum to zero.');
  const result: Suggestion[] = [];
  let component: MemberBalance[] = [];
  for (let mask = size - 1; mask;) {
    const index = last[mask];
    component.push(active[index]);
    mask ^= 1 << index;
    if (sums[mask] === 0n) {
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
