import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { bills, billShares, groupMembers, groups, repayments } from '../db/schema.js';
import type { Transaction as Tx } from '../db/types.js';
import { memberBalances, type LedgerBill } from './group-ledger.js';

// The accounting projection: only the bill and repayment fields that decide
// balances. Balance reads never load bill items or receipt evidence.

// The member's own shares of completed, non-canceled bills and their confirmed
// repayments, in every group they belong to or in the given authorized groups.
export async function readMemberBalancesInSnapshot(tx: Tx, userId: string, groupIds?: string[]) {
  if (groupIds && !groupIds.length) return new Map<string, bigint>();
  const scope = (groupId: typeof bills.groupId | typeof repayments.groupId) =>
    groupIds ? inArray(groupId, groupIds) : undefined;
  const shares = await tx.select({
    groupId: bills.groupId, initiatorId: bills.initiatorId, totalCents: bills.totalCents,
    adjustmentCents: bills.adjustmentCents, completedAt: bills.completedAt, canceledAt: bills.canceledAt,
    amountCents: billShares.amountCents,
  }).from(bills)
    .innerJoin(billShares, and(eq(billShares.billId, bills.id), eq(billShares.userId, userId)))
    .innerJoin(groups, and(eq(groups.id, bills.groupId), isNull(groups.deletedAt)))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, bills.groupId), eq(groupMembers.userId, userId)))
    .where(and(scope(bills.groupId), isNotNull(bills.completedAt), isNull(bills.canceledAt)));
  const confirmed = await tx.select({
    groupId: repayments.groupId, senderId: repayments.senderId, recipientId: repayments.recipientId,
    amountCents: repayments.amountCents, status: repayments.status,
  }).from(repayments)
    .innerJoin(groups, and(eq(groups.id, repayments.groupId), isNull(groups.deletedAt)))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, repayments.groupId), eq(groupMembers.userId, userId)))
    .where(and(scope(repayments.groupId), eq(repayments.status, 'confirmed'),
      or(eq(repayments.senderId, userId), eq(repayments.recipientId, userId))));
  return memberBalances(
    shares.map(({ amountCents, ...bill }) => ({ ...bill, participants: [{ userId, amountCents }] })), userId, confirmed);
}

// Every bill of a group the caller has authorized, with participant shares for
// the completed, non-canceled ones that affect balances.
export async function readGroupAccountingInSnapshot(tx: Tx, groupId: string): Promise<LedgerBill[]> {
  const rows = await tx.select({
    id: bills.id, title: bills.title, purchaseDate: bills.purchaseDate, initiatorId: bills.initiatorId,
    totalCents: bills.totalCents, adjustmentCents: bills.adjustmentCents,
    completedAt: bills.completedAt, canceledAt: bills.canceledAt,
  }).from(bills).where(eq(bills.groupId, groupId)).orderBy(desc(bills.createdAt), bills.id);
  const shares = await tx.select({ billId: billShares.billId, userId: billShares.userId, amountCents: billShares.amountCents })
    .from(billShares).innerJoin(bills, eq(bills.id, billShares.billId))
    .where(and(eq(bills.groupId, groupId), isNotNull(bills.completedAt), isNull(bills.canceledAt)))
    .orderBy(billShares.userId);
  const participants = new Map<string, LedgerBill['participants']>();
  for (const { billId, userId, amountCents } of shares)
    participants.set(billId, [...participants.get(billId) ?? [], { userId, amountCents }]);
  return rows.map(bill => ({ ...bill, participants: participants.get(bill.id) ?? [] }));
}
