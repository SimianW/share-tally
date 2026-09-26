import { requireMember, lockGroupForMember } from './group-access.js';
import { notifyGroupChanged } from './group-events.js';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from './db/index.js';
import { groupMembers, groups, repayments } from './db/schema.js';
import { BillError } from './bill-error.js';
import { cents, isUuid } from './input-validation.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Repayment = typeof repayments.$inferSelect;

export function parseRepayment(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BillError(400, 'Expected a JSON object.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['requestId', 'recipientId', 'amountCents'].includes(key)))
    throw new BillError(400, 'Record only your own transfer.');
  if (!isUuid(body.requestId) || !isUuid(body.recipientId)) throw new BillError(400, 'Valid request and recipient IDs are required.');
  const amountCents = cents(body.amountCents);
  if (!amountCents) throw new BillError(400, 'Repayment amount must be positive.');
  return { requestId: body.requestId.toLowerCase(), recipientId: body.recipientId.toLowerCase(), amountCents };
}

export async function readRepayments(tx: Tx, userId: string, groupId?: string) {
  if (groupId) await requireMember(tx, groupId, userId);
  return tx.select({ repayment: repayments }).from(repayments)
    .innerJoin(groups, and(eq(groups.id, repayments.groupId), isNull(groups.deletedAt)))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, repayments.groupId), eq(groupMembers.userId, userId)))
    .where(groupId ? eq(repayments.groupId, groupId) : undefined)
    .orderBy(desc(repayments.createdAt), repayments.id)
    .then(rows => rows.map(row => row.repayment));
}

export async function createRepayment(groupId: string, senderId: string, input: ReturnType<typeof parseRepayment>) {
  const repayment = await db.transaction(async tx => {
    await lockGroupForMember(tx, groupId, senderId);
    if (senderId === input.recipientId) throw new BillError(400, 'Choose another group member.');
    const [recipient] = await tx.select().from(groupMembers).where(and(
      eq(groupMembers.groupId, groupId), eq(groupMembers.userId, input.recipientId),
    ));
    if (!recipient) throw new BillError(400, 'Recipient must belong to this group.');
    // The unique key arbitrates even requests racing across different groups.
    const [created] = await tx.insert(repayments).values({ groupId, senderId, ...input })
      .onConflictDoNothing({ target: [repayments.senderId, repayments.requestId] }).returning();
    if (created) return created;
    const [existing] = await tx.select().from(repayments).where(and(
      eq(repayments.senderId, senderId), eq(repayments.requestId, input.requestId),
    ));
    if (!existing || existing.groupId !== groupId || existing.recipientId !== input.recipientId || existing.amountCents !== input.amountCents)
      throw new BillError(409, 'This creation request was already used with different details.');
    return existing;
  });
  notifyGroupChanged(repayment.groupId);
  return repayment;
}

export async function decideRepayment(id: string, userId: string, decision: 'confirmed' | 'rejected') {
  const repayment = await db.transaction(async tx => {
    const [scope] = await tx.select({ groupId: repayments.groupId }).from(repayments).where(eq(repayments.id, id));
    if (!scope) throw new BillError(404, 'Repayment not found.');
    await lockGroupForMember(tx, scope.groupId, userId);
    const [record] = await tx.select().from(repayments).where(eq(repayments.id, id)).for('update');
    if (!record) throw new BillError(404, 'Repayment not found.');
    if (record.recipientId !== userId) throw new BillError(403, 'Only the recipient can decide this repayment.');
    if (record.status === decision) return record;
    if (record.status !== 'pending') throw new BillError(409, `This repayment is already ${record.status}. Refresh to see its current status.`);
    const [updated] = await tx.update(repayments).set({ status: decision, decidedAt: new Date() })
      .where(eq(repayments.id, id)).returning();
    return updated!;
  });
  notifyGroupChanged(repayment.groupId);
  return repayment;
}
