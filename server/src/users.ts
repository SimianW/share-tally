import { eq } from "drizzle-orm";

import { db } from "./db/index.js";
import { users, type AppUser } from "./db/schema.js";

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
  const [updated] = await db.update(users).set({ displayName: name })
    .where(eq(users.id, user.id)).returning();
  if (!updated) throw new Error('User missing while saving display name.');
  return updated;
}
