import { and, desc, eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { groupMembers, repayments } from './db/schema.js';
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

async function requireMember(tx: Tx, groupId: string, userId: string) {
  const [member] = await tx.select().from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  if (!member) throw new BillError(404, 'Group not found.');
}

export async function readRepayments(tx: Tx, userId: string, groupId?: string) {
  return tx.select({ repayment: repayments }).from(repayments)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, repayments.groupId), eq(groupMembers.userId, userId)))
    .where(groupId ? eq(repayments.groupId, groupId) : undefined)
    .orderBy(desc(repayments.createdAt), repayments.id)
    .then(rows => rows.map(row => row.repayment));
}

export async function createRepayment(groupId: string, senderId: string, input: ReturnType<typeof parseRepayment>) {
  return db.transaction(async tx => {
    await requireMember(tx, groupId, senderId);
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
}

export async function decideRepayment(id: string, userId: string, decision: 'confirmed' | 'rejected') {
  return db.transaction(async tx => {
    const [record] = await tx.select().from(repayments).where(eq(repayments.id, id)).for('update');
    if (!record) throw new BillError(404, 'Repayment not found.');
    await requireMember(tx, record.groupId, userId);
    if (record.recipientId !== userId) throw new BillError(403, 'Only the recipient can decide this repayment.');
    if (record.status === decision) return record;
    if (record.status !== 'pending') throw new BillError(409, `This repayment is already ${record.status}. Refresh to see its current status.`);
    const [updated] = await tx.update(repayments).set({ status: decision, decidedAt: new Date() })
      .where(eq(repayments.id, id)).returning();
    return updated!;
  });
}
