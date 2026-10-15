import { eq, inArray, or, sql } from 'drizzle-orm';
import { bills, billShares, groupMembers, groups, repayments, users } from '../db/schema.js';
import type { Transaction } from '../db/types.js';

// Current members and former members named in retained history share one naming
// scope (ADR-0021). Read all requested groups together, never one query per bill.
// Callers authorize these groups before exposing the result.
export async function readGroupPeopleInSnapshot(tx: Transaction, groupIds: string[]) {
  if (!groupIds.length) return new Map<string, GroupPerson[]>();
  const current = inArray(users.id, tx.select({ id: groupMembers.userId }).from(groupMembers)
    .where(eq(groupMembers.groupId, groups.id)));
  const rows = await tx.select({
    groupId: groups.id, userId: users.id,
    displayName: sql<string>`coalesce(${users.displayName}, 'Member')`,
    username: users.username, current: sql<boolean>`${current}`,
  }).from(groups).innerJoin(users, or(
    current,
    inArray(users.id, tx.select({ id: bills.initiatorId }).from(bills).where(eq(bills.groupId, groups.id))),
    inArray(users.id, tx.select({ id: billShares.userId }).from(billShares)
      .innerJoin(bills, eq(bills.id, billShares.billId)).where(eq(bills.groupId, groups.id))),
    inArray(users.id, tx.select({ id: repayments.senderId }).from(repayments).where(eq(repayments.groupId, groups.id))),
    inArray(users.id, tx.select({ id: repayments.recipientId }).from(repayments).where(eq(repayments.groupId, groups.id))),
  )).where(inArray(groups.id, groupIds)).orderBy(users.id);
  const result = new Map<string, GroupPerson[]>();
  for (const groupId of groupIds) {
    const people = rows.filter(row => row.groupId === groupId);
    const counts = new Map<string, number>();
    const key = (name: string) => name.trim().toLowerCase();
    for (const person of people) counts.set(key(person.displayName), (counts.get(key(person.displayName)) ?? 0) + 1);
    result.set(groupId, people.map(({ userId, displayName, username, current }) => ({
      userId, displayName, current,
      ...(counts.get(key(displayName))! > 1 && username ? { username } : {}),
    })));
  }
  return result;
}

type GroupPerson = { userId: string; displayName: string; username?: string; current: boolean };
