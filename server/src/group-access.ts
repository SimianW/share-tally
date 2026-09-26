import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db/index.js';
import { groupMembers, groups } from './db/schema.js';
import { BillError } from './bill-error.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Membership rows are retained after deletion, but never authorize access then.
export async function requireMember(tx: Tx | typeof db, groupId: string, userId: string) {
  const [group] = await tx.select({ id: groups.id, createdBy: groups.createdBy, name: groups.name })
    .from(groups).innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(and(eq(groups.id, groupId), isNull(groups.deletedAt), eq(groupMembers.userId, userId)));
  if (!group) throw new BillError(404, 'Group not found.');
  return group;
}

// Always acquire this before locking a bill, draft, or repayment. Deletion and
// ledger writes serialize on the same row; PostgreSQL rechecks deletedAt after
// a waiter acquires the lock, so a queued writer cannot revive a deleted group.
export async function lockGroupForMember(tx: Tx, groupId: string, userId: string) {
  const [group] = await tx.select().from(groups)
    .where(and(eq(groups.id, groupId), isNull(groups.deletedAt))).for('update');
  if (!group) throw new BillError(404, 'Group not found.');
  await requireMember(tx, groupId, userId);
  return group;
}
