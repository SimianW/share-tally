import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type AppUser } from "../db/schema.js";
import type { Transaction } from "../db/types.js";
import type { ProfileReader } from "./clerk-profiles.js";
import { resolveDisplayName } from "@share-tally/domain/display-name";

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

export async function getGroupUser(clerkUserId: string, profiles: ProfileReader) {
  const user = await getOrCreateUser(clerkUserId);
  if (user.displayName !== null) return user;
  const [profile] = await profiles([clerkUserId]);
  // Only the first name, with the Clerk version it came from: a synchronization may
  // have stored a newer one meanwhile, and a lagging one must not replace this one.
  const [updated] = await db.update(users).set({
    displayName: resolveDisplayName(profile ?? {}),
    clerkUpdatedAt: profile ? new Date(profile.updatedAt) : null,
  }).where(and(eq(users.id, user.id), isNull(users.displayName))).returning();
  if (updated) return updated;
  const [current] = await db.select().from(users).where(eq(users.id, user.id));
  if (!current) throw new Error('User missing while saving display name.');
  return current;
}

export async function allClerkUserIds() {
  return (await db.select({ clerkUserId: users.clerkUserId }).from(users).orderBy(users.createdAt, users.id))
    .map(user => user.clerkUserId);
}

// Stores each user's current name, unless the stored one came from Clerk data saved
// later. Returns the IDs of users whose name changed.
export async function saveDisplayNames(tx: Transaction, names: { clerkUserId: string; displayName: string; updatedAt: Date }[]) {
  const renamed: string[] = [];
  for (const { clerkUserId, displayName, updatedAt } of names) {
    // Lock the row so a concurrent save cannot slip in between this check and the write.
    const [stored] = await tx.select({ id: users.id, displayName: users.displayName, clerkUpdatedAt: users.clerkUpdatedAt })
      .from(users).where(eq(users.clerkUserId, clerkUserId)).for('update');
    if (!stored || (stored.clerkUpdatedAt && stored.clerkUpdatedAt >= updatedAt)) continue;
    await tx.update(users).set({ displayName, clerkUpdatedAt: updatedAt }).where(eq(users.id, stored.id));
    if (stored.displayName !== displayName) renamed.push(stored.id);
  }
  return renamed;
}
