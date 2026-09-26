import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { bills, billShares, groupMembers, groups, receiptDrafts, repayments, users } from './db/schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Both the Home inbox and group summaries use this same definition.
export async function readAttentionInSnapshot(tx: Tx, userId: string) {
  const shares = await tx.select({
    billId: bills.id, groupId: groups.id, groupName: groups.name,
    title: bills.title, amountCents: billShares.amountCents, mode: bills.mode,
  }).from(billShares)
    .innerJoin(bills, eq(billShares.billId, bills.id))
    .innerJoin(groups, eq(bills.groupId, groups.id))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(isNull(groups.deletedAt), eq(billShares.userId, userId), isNull(billShares.confirmedAt), isNull(bills.completedAt), isNull(bills.canceledAt)))
    .orderBy(asc(bills.createdAt), asc(bills.id));
  const incoming = await tx.select({
    repaymentId: repayments.id, groupId: groups.id, groupName: groups.name,
    senderName: users.displayName, amountCents: repayments.amountCents,
  }).from(repayments)
    .innerJoin(groups, eq(repayments.groupId, groups.id))
    .innerJoin(users, eq(repayments.senderId, users.id))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(isNull(groups.deletedAt), eq(repayments.recipientId, userId), eq(repayments.status, 'pending')))
    .orderBy(asc(repayments.createdAt), asc(repayments.id));
  const drafts = await tx.select({
    draftId: receiptDrafts.id, groupId: groups.id, groupName: groups.name,
    title: sql<string>`coalesce(nullif(${receiptDrafts.data}->>'title', ''), 'Untitled draft')`,
    amountCents: sql<number | null>`(${receiptDrafts.data}->>'totalCents')::integer`,
    processingStatus: receiptDrafts.processingStatus,
  }).from(receiptDrafts)
    .innerJoin(groups, eq(receiptDrafts.groupId, groups.id))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(isNull(groups.deletedAt), eq(receiptDrafts.initiatorId, userId),
      isNull(receiptDrafts.billId), inArray(receiptDrafts.processingStatus, ['ready', 'fallback'])))
    .orderBy(asc(receiptDrafts.createdAt), asc(receiptDrafts.id));
  return [...shares.map(share => ({
    kind: share.amountCents === null ? 'missing-share' as const : 'confirm-share' as const,
    ...share,
  })), ...incoming.map(record => ({
    kind: 'review-repayment' as const, ...record, senderName: record.senderName ?? 'Member',
  })), ...drafts.map(draft => ({ kind: 'review-draft' as const, ...draft }))];
}

export async function readAttention(userId: string) {
  return db.transaction(tx => readAttentionInSnapshot(tx, userId),
    { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
