import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type AppUser } from "../db/schema.js";
import type { Transaction } from "../db/types.js";

export async function getOrCreateUser(clerkUserId: string,): Promise<AppUser> {
  const [createdUser] = await db
    .insert(users)
    .values({
      clerkUserId,
    })
    .onConflictDoNothing({
      target: users.clerkUserId,
    })
    .returning();
  if (createdUser) {
    return createdUser;
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (!existingUser) {
    throw new Error(`User ${clerkUserId} missing after insert conflict.`);
  }

  return existingUser;
}

export async function getGroupUser(clerkUserId: string, displayName: (id: string) => Promise<string>) {
  const user = await getOrCreateUser(clerkUserId);
  if (user.displayName !== null) return user;
  const name = (await displayName(clerkUserId)).trim() || 'Member';
  // Only the first name: a synchronization may have stored a newer one meanwhile.
  const [updated] = await db.update(users).set({ displayName: name })
    .where(and(eq(users.id, user.id), isNull(users.displayName))).returning();
  if (updated) return updated;
  const [current] = await db.select().from(users).where(eq(users.id, user.id));
  if (!current) throw new Error('User missing while saving display name.');
  return current;
}

export async function allClerkUserIds() {
  return (await db.select({ clerkUserId: users.clerkUserId }).from(users)).map(user => user.clerkUserId);
}

// Stores each user's current name, returning the IDs of users whose name changed.
export async function saveDisplayNames(tx: Transaction, names: { clerkUserId: string; displayName: string }[]) {
  const renamed: string[] = [];
  for (const { clerkUserId, displayName } of names) {
    const [user] = await tx.update(users).set({ displayName })
      .where(and(eq(users.clerkUserId, clerkUserId), sql`${users.displayName} IS DISTINCT FROM ${displayName}`))
      .returning({ id: users.id });
    if (user) renamed.push(user.id);
  }
  return renamed;
}
