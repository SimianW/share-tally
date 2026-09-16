import { notifyGroupChanged } from './group-events.js';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from "./db/index.js";
import { groupMembers, groups, users } from "./db/schema.js";

import { parseGroupIcon, type GroupIconInput } from './group-icon.js';

export type CreateGroupInput = {
  name: string;
  icon: GroupIconInput;
};

// explicitly list all the fields we want to return to the client
const publicGroupFields = {
  id: groups.id,
  name: groups.name,
  icon: groups.icon,
  createdBy: groups.createdBy,
  createdAt: groups.createdAt,
}

export async function createGroup(
  creatorId: string,
  input: CreateGroupInput,
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
      })
      .returning(publicGroupFields)

    // returning() 返回数组，因为 INSERT 可以一次插入多行。
    // 这里仅插入一个群组，因此取第一项。
    if (!group) {
      throw new Error('Group insert returned no row.')
    }

    await tx
      .insert(groupMembers)
      .values({
        groupId: group.id,
        userId: creatorId,
      })

    // 回调成功结束后，Drizzle 才提交事务。
    // 如果上面的任意操作抛错，整个事务回滚。
    return toGroup({ ...group, creatorName: creator.displayName ?? "Member", memberCount: 1 }, creatorId)
  })
};


const summaryFields = {
  ...publicGroupFields,
  creatorName: sql<string>`coalesce(${users.displayName}, 'Member')`,
  memberCount: sql<number>`(select count(*) from ${groupMembers} where ${groupMembers.groupId} = ${groups.id})`.mapWith(Number),
};

function toGroup(row: {
  id: string; name: string; icon: string; createdBy: string; createdAt: Date;
  creatorName: string; memberCount: number;
}, userId: string) {
  const separator = row.icon.indexOf(':');
  return {
    ...row,
    icon: parseGroupIcon({ type: row.icon.slice(0, separator), value: row.icon.slice(separator + 1) }),
    isCreator: row.createdBy === userId,
  };
}

export async function listGroupsForUser(userId: string) {
  const rows = await db.select(summaryFields).from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .innerJoin(users, eq(groups.createdBy, users.id))
    .where(eq(groupMembers.userId, userId))
    .orderBy(desc(groups.createdAt), groups.id);
  return rows.map(row => toGroup(row, userId));
}

export class GroupAccessError extends Error {
  constructor(public status: 403 | 404 | 409, message: string) { super(message); }
}

export async function getGroupForMember(groupId: string, userId: string) {
  const [row] = await db.select(summaryFields).from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .innerJoin(users, eq(groups.createdBy, users.id))
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
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
      ...member, isCreator: member.id === row.createdBy, isCurrentUser: member.id === userId,
    })),
  };
}


export async function groupInvitation(groupId: string, userId: string, regenerate: boolean) {
  return db.transaction(async tx => {
    // Joining and rotating the token serialize on this same row.
    const [group] = await tx.select().from(groups).where(eq(groups.id, groupId)).for('update');
    if (!group) throw new GroupAccessError(404, 'Group not found.');
    const [member] = await tx.select().from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
    if (!member) throw new GroupAccessError(404, 'Group not found.');
    if (group.createdBy !== userId) throw new GroupAccessError(403, 'Only the group creator can manage invitations.');
    let token = group.invitationToken;
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
      .where(eq(groups.invitationToken, token)).for('update');
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
