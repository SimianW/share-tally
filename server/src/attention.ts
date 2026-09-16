import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from './db/index.js';
import { bills, billShares, groupMembers, groups, repayments, users } from './db/schema.js';

export async function readAttention(userId: string) {
  return db.transaction(async tx => {
    const shares = await tx.select({
      billId: bills.id, groupId: groups.id, groupName: groups.name,
      title: bills.title, amountCents: billShares.amountCents,
    }).from(billShares)
      .innerJoin(bills, eq(billShares.billId, bills.id))
      .innerJoin(groups, eq(bills.groupId, groups.id))
      .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
      .where(and(eq(billShares.userId, userId), isNull(billShares.confirmedAt), isNull(bills.completedAt), isNull(bills.canceledAt)))
      .orderBy(asc(bills.createdAt), asc(bills.id));
    const incoming = await tx.select({
      repaymentId: repayments.id, groupId: groups.id, groupName: groups.name,
      senderName: users.displayName, amountCents: repayments.amountCents,
    }).from(repayments)
      .innerJoin(groups, eq(repayments.groupId, groups.id))
      .innerJoin(users, eq(repayments.senderId, users.id))
      .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
      .where(and(eq(repayments.recipientId, userId), eq(repayments.status, 'pending')))
      .orderBy(asc(repayments.createdAt), asc(repayments.id));
    return [...shares.map(share => ({
      kind: share.amountCents === null ? 'missing-share' as const : 'confirm-share' as const,
      ...share,
    })), ...incoming.map(record => ({
      kind: 'review-repayment' as const, ...record, senderName: record.senderName ?? 'Member',
    }))];
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
