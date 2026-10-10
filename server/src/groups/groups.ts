import type { GroupDeletionReason, MemberDepartureReason } from '@share-tally/domain/contracts/groups';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { readAttentionInSnapshot } from '../attention/attention.js';
import { readGroupAccountingInSnapshot, readMemberBalancesInSnapshot } from "../ledger/accounting.js";
import type { Transaction as Tx } from '../db/types.js';
import { groupLedger } from '../ledger/group-ledger.js';
import { notifyGroupChanged } from '../realtime/group-events.js';
import { readRepayments } from '../repayments/repayments.js';
import { safeCents } from '../shared/money.js';
import { lockGroupForMember } from './group-access.js';
import { db } from "../db/index.js";
import { groupMembers, groups, users } from "../db/schema.js";
import { parseGroupIcon } from "./group-icon.js";
import type { GroupDraft } from "@share-tally/domain/contracts/groups";

// explicitly list all the fields we want to return to the client
const publicGroupFields = {
  id: groups.id,
  name: groups.name,
  icon: groups.icon,
  createdBy: groups.createdBy,
  createdAt: groups.createdAt,
  ownerId: groups.ownerId,
}

export async function createGroup(
  creatorId: string,
  input: GroupDraft,
) {
  // 创建群组涉及两次写入：
  // 1. 插入群组。
  // 2. 插入创建者的成员关系。
  //
  // 事务保证它们一起成功或一起回滚。
  // 否则第二次写入失败时，会留下没有成员的群组。
  return db.transaction(async (tx) => {
    const [creator] = await tx.select().from(users).where(eq(users.id, creatorId));
    if (!creator) throw new Error('Group creator does not exist.');
    // 事务内部使用 tx，而不是 db。
    // 使用 db 可能让查询跑到事务之外的另一条连接上。
    const [group] = await tx
      .insert(groups)
      .values({
        name: input.name,
        icon: `${input.icon.type}:${input.icon.value}`,
        createdBy: creatorId,
        ownerId: creatorId,
      })
      .returning(publicGroupFields)

    // returning() 返回数组，因为 INSERT 可以一次插入多行。
    // 这里仅插入一个群组，因此取第一项。
    if (!group) {
      throw new Error('Group insert returned no row.')
    }

    const [membership] = await tx
      .insert(groupMembers)
      .values({
        groupId: group.id,
        userId: creatorId,
      })
      .returning({ joinedAt: groupMembers.joinedAt })

    // 回调成功结束后，Drizzle 才提交事务。
    // 如果上面的任意操作抛错，整个事务回滚。
    // A new group has no bills yet, so its creator's balance is zero.
    const ownerName = creator.displayName ?? "Member";
    return {
      ...toGroup({ ...group, joinedAt: membership!.joinedAt, ownerName, memberCount: 1 }, creatorId),
      netCents: 0,
      pendingActionCount: 0,
      memberPreview: [{ id: creatorId, displayName: ownerName }],
    }
  })
};

// Read through the current user's membership row: joinedAt is when they joined.
const summaryFields = {
  ...publicGroupFields,
  joinedAt: groupMembers.joinedAt,
  ownerName: sql<string>`coalesce(${users.displayName}, 'Member')`,
  memberCount: sql<number>`(select count(*) from ${groupMembers} where ${groupMembers.groupId} = ${groups.id})`.mapWith(Number),
};

function toGroup(row: {
  id: string; name: string; icon: string; createdBy: string; createdAt: Date; ownerId: string; joinedAt: Date;
  ownerName: string; memberCount: number;
}, userId: string) {
  const separator = row.icon.indexOf(':');
  return {
    ...row,
    icon: parseGroupIcon({ type: row.icon.slice(0, separator), value: row.icon.slice(separator + 1) }),
    isOwner: row.ownerId === userId,
  };
}

// Home's avatar stack shows this many members.
const previewSize = 4;

// Groups in the order the member joined them, so the order never shuffles. Each
// carries the member's own balance there, the same number as its group page.
export async function listGroupsForUser(userId: string) {
  return db.transaction(async tx => {
    const rows = await tx.select(summaryFields).from(groupMembers)
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .innerJoin(users, eq(groups.ownerId, users.id))
      .where(and(eq(groupMembers.userId, userId), isNull(groups.deletedAt)))
      .orderBy(groupMembers.joinedAt, groups.id);
    const ids = rows.map(row => row.id);
    const balances = await readMemberBalancesInSnapshot(tx, userId, ids);
    const actions = ids.length ? await readAttentionInSnapshot(tx, userId) : [];
    const pendingByGroup = new Map<string, number>();
    for (const action of actions) pendingByGroup.set(action.groupId, (pendingByGroup.get(action.groupId) ?? 0) + 1);
    const members = ids.length ? await tx.select({
      groupId: groupMembers.groupId,
      id: users.id,
      displayName: sql<string>`coalesce(${users.displayName}, 'Member')`,
    }).from(groupMembers).innerJoin(users, eq(groupMembers.userId, users.id))
      .where(inArray(groupMembers.groupId, ids)).orderBy(groupMembers.joinedAt, users.id) : [];
    return rows.map(row => ({
      ...toGroup(row, userId),
      netCents: safeCents(balances.get(row.id) ?? 0n),
      pendingActionCount: pendingByGroup.get(row.id) ?? 0,
      memberPreview: members.filter(member => member.groupId === row.id).slice(0, previewSize)
        .map(({ id, displayName }) => ({ id, displayName })),
    }));
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

// The active groups these users belong to, and everyone in those groups, themselves included.
export async function sharedGroups(tx: Tx, userIds: string[]) {
  if (!userIds.length) return { groupIds: [], memberIds: [] };
  const theirGroups = tx.select({ id: groupMembers.groupId }).from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(and(inArray(groupMembers.userId, userIds), isNull(groups.deletedAt)));
  const rows = await tx.select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
    .from(groupMembers).where(inArray(groupMembers.groupId, theirGroups));
  return {
    groupIds: [...new Set(rows.map(row => row.groupId))],
    memberIds: [...new Set(rows.map(row => row.userId))],
  };
}

export class GroupAccessError extends Error {
  constructor(public status: 400 | 403 | 404 | 409, message: string) { super(message); }
}

export async function getGroupForMember(groupId: string, userId: string) {
  const [row] = await db.select(summaryFields).from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .innerJoin(users, eq(groups.ownerId, users.id))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId), isNull(groups.deletedAt)));
  // Do not reveal whether an inaccessible group exists.
  if (!row) throw new GroupAccessError(404, 'Group not found.');
  const members = await db.select({
    id: users.id,
    displayName: sql<string>`coalesce(${users.displayName}, 'Member')`,
    joinedAt: groupMembers.joinedAt,
  }).from(groupMembers).innerJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId)).orderBy(groupMembers.joinedAt, users.id);
  return {
    ...toGroup(row, userId),
    memberCount: members.length,
    members: members.map(member => ({
      ...member, isOwner: member.id === row.ownerId, isCurrentUser: member.id === userId,
    })),
  };
}

export async function groupInvitation(groupId: string, userId: string, regenerate: boolean) {
  return db.transaction(async tx => {
    // Joining and rotating the token serialize on this same row.
    await lockGroupForOwner(tx, groupId, userId, 'Only the group owner can manage invitations.');
    const [group] = await tx.select({ invitationToken: groups.invitationToken }).from(groups).where(eq(groups.id, groupId));
    let token = group!.invitationToken;
    if (regenerate || token === null) {
      token = randomBytes(32).toString('hex');
      await tx.update(groups).set({ invitationToken: token }).where(eq(groups.id, groupId));
    }
    // A fragment keeps the secret out of page requests and Referer headers.
    return { path: `/#/join/${token}` };
  });
}

export async function joinGroup(token: string, userId: string) {
  const groupId = await db.transaction(async tx => {
    // PostgreSQL rechecks this predicate after waiting for a concurrent rotation.
    const [group] = await tx.select({ id: groups.id }).from(groups)
      .where(and(eq(groups.invitationToken, token), isNull(groups.deletedAt))).for('update');
    if (!group) throw new GroupAccessError(404, 'This invitation is invalid or has been replaced.');
    // The group row lock makes the capacity check and insertion one operation
    // relative to every other join. Existing members may retry even at capacity.
    const members = await tx.select({ userId: groupMembers.userId }).from(groupMembers)
      .where(eq(groupMembers.groupId, group.id));
    if (members.some(member => member.userId === userId)) return group.id;
    if (members.length >= 16)
      throw new GroupAccessError(409, 'This group is full. Groups can have up to 16 members.');
    // The composite primary key also protects against simultaneous repeat joins.
    await tx.insert(groupMembers).values({ groupId: group.id, userId })
      .onConflictDoNothing({ target: [groupMembers.groupId, groupMembers.userId] });
    return group.id;
  });
  notifyGroupChanged(groupId);
  return getGroupForMember(groupId, userId);
}

export class GroupDeletionError extends GroupAccessError {
  constructor(public reasons: GroupDeletionReason[]) {
    const descriptions = reasons.map(reason => {
      switch (reason.code) {
        case 'incomplete_bills': return `${reason.count} incomplete bill${reason.count === 1 ? '' : 's'}`;
        case 'pending_repayments': return `${reason.count} pending repayment${reason.count === 1 ? '' : 's'}`;
        case 'nonzero_balances': return reason.members.map(member => `${member.displayName}'s balance is not zero`).join(', ');
      }
    });
    super(409, `This group cannot be deleted: ${descriptions.join('; ')}.`);
  }
}

// Caller holds the group row lock while reading this ledger. Deletion and all
// financial writes serialize on that row, so the decision cannot go stale
// between this check and the update in markGroupDeleted.
async function deletionReasons(tx: Tx, groupId: string, userId: string): Promise<GroupDeletionReason[]> {
  const bills = await readGroupAccountingInSnapshot(tx, groupId);
  const repayments = await readRepayments(tx, userId, groupId);
  const members = await tx.select({ userId: users.id, displayName: users.displayName })
    .from(groupMembers).innerJoin(users, eq(users.id, groupMembers.userId))
    .where(eq(groupMembers.groupId, groupId)).orderBy(users.id);
  const ledger = groupLedger(bills, members, repayments);
  const reasons: GroupDeletionReason[] = [];
  if (ledger.incompleteBillIds.length)
    reasons.push({ code: 'incomplete_bills', count: ledger.incompleteBillIds.length });
  const pendingCount = repayments.filter(repayment => repayment.status === 'pending').length;
  if (pendingCount) reasons.push({ code: 'pending_repayments', count: pendingCount });
  const nonzeroMembers = ledger.members.filter(member => member.netCents !== 0);
  if (nonzeroMembers.length) reasons.push({ code: 'nonzero_balances', members: nonzeroMembers });
  return reasons;
}

// Ownership is reread under the group row lock, so a transfer that committed
// first is what decides this request, never the role the client last displayed.
export async function lockGroupForOwner(tx: Tx, groupId: string, userId: string,
  message = 'Only the group owner can delete this group.') {
  const group = await lockGroupForMember(tx, groupId, userId);
  if (group.ownerId !== userId) throw new GroupAccessError(403, message);
  return group;
}

export async function groupDeletionEligibility(groupId: string, userId: string) {
  return db.transaction(async tx => {
    await lockGroupForOwner(tx, groupId, userId);
    const reasons = await deletionReasons(tx, groupId, userId);
    return { eligible: reasons.length === 0, reasons };
  });
}

export async function requireGroupDeletionEligibility(tx: Tx, groupId: string, userId: string) {
  const reasons = await deletionReasons(tx, groupId, userId);
  if (reasons.length) throw new GroupDeletionError(reasons);
}

export async function markGroupDeleted(tx: Tx, groupId: string) {
  await tx.update(groups).set({ deletedAt: new Date() }).where(eq(groups.id, groupId));
}

export class MemberDepartureError extends GroupAccessError {
  constructor(subject: string, public reasons: MemberDepartureReason[]) {
    const descriptions = reasons.map(reason => {
      switch (reason.code) {
        case 'nonzero_balance': return 'the balance in this group is not zero';
        case 'incomplete_bills': return `${reason.bills.length} incomplete bill${reason.bills.length === 1 ? '' : 's'}`;
        case 'pending_repayments': return `${reason.repayments.length} pending repayment${reason.repayments.length === 1 ? '' : 's'}`;
        case 'sole_member': return 'the owner is the only member; delete the cleared group instead';
      }
    });
    super(409, `${subject}: ${descriptions.join('; ')}.`);
  }
}

// Caller holds the group row lock, which every membership change, join and
// financial write also takes first.
export async function requireCurrentMember(tx: Tx, groupId: string, userId: string) {
  const [member] = await tx.select({ userId: groupMembers.userId }).from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  if (!member) throw new GroupAccessError(404, 'Member not found.');
}

export async function memberIds(tx: Tx, groupId: string) {
  return (await tx.select({ userId: groupMembers.userId }).from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))).map(member => member.userId);
}

export async function transferOwnership(tx: Tx, groupId: string, successorId: string) {
  await tx.update(groups).set({ ownerId: successorId }).where(eq(groups.id, groupId));
}

// Ends access only. Bills, shares, claims and repayment records keep the
// user's stable identity, and a valid invitation lets them rejoin as a member.
export async function endMembership(tx: Tx, groupId: string, userId: string) {
  await tx.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}
