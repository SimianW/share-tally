import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type AppUser } from "../db/schema.js";
import type { Transaction } from "../db/types.js";
import type { ProfileReader } from "./clerk-profiles.js";
import { resolveDisplayName } from "@share-tally/domain/display-name";

// Version 2 also caches Usernames, including unchanged accounts from version 1.
// Normal synchronization backfills them and publishes post-commit notifications.
const DISPLAY_NAME_VERSION = 2;

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
  // Cache both name fields with the Clerk version they came from. The guarded
  // update locks the row: a concurrent synchronization that won first stays saved.
  const [updated] = await db.update(users).set({
    displayName: resolveDisplayName(profile ?? {}),
    username: profile?.username?.trim() || null,
    displayNameVersion: DISPLAY_NAME_VERSION,
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
// later. Equal Clerk versions are rewritten once when the display rule changes.
// Username-only changes also invalidate views: their disambiguation tag changed.
export async function saveDisplayNames(tx: Transaction, names: { clerkUserId: string; displayName: string; username: string | null; updatedAt: Date }[]) {
  const renamed: string[] = [];
  for (const { clerkUserId, displayName, username, updatedAt } of names) {
    // Lock the row so a concurrent save cannot slip in between this check and the write.
    const [stored] = await tx.select({ id: users.id, displayName: users.displayName, username: users.username, clerkUpdatedAt: users.clerkUpdatedAt, displayNameVersion: users.displayNameVersion })
      .from(users).where(eq(users.clerkUserId, clerkUserId)).for('update');
    if (!stored) continue;
    if (stored.clerkUpdatedAt && (stored.clerkUpdatedAt > updatedAt ||
      (stored.clerkUpdatedAt.getTime() === updatedAt.getTime() && stored.displayNameVersion >= DISPLAY_NAME_VERSION))) continue;
    await tx.update(users).set({ displayName, username, clerkUpdatedAt: updatedAt, displayNameVersion: DISPLAY_NAME_VERSION }).where(eq(users.id, stored.id));
    if (stored.displayName !== displayName || stored.username !== username) renamed.push(stored.id);
  }
  return renamed;
}
