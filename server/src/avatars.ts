import { inArray } from 'drizzle-orm';
import { db } from './db/index.js';
import { users } from './db/schema.js';

export type AvatarImages = { imageUrl: string | null; fallbackImageUrl: string | null };
export type AvatarLookup = (clerkUserId: string) => Promise<AvatarImages | null>;

async function lookupWithDeadline(lookup: AvatarLookup, id: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => lookup(id)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Avatar lookup timed out')), 1500);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

// Call only with user IDs from records the caller is authorized to view.
export function createAvatarReader(lookup: AvatarLookup) {
  const cache = new Map<string, { expires: number; value: Promise<AvatarImages | null> }>();
  return async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return new Map<string, AvatarImages | null>();
    const rows = await db.select({ id: users.id, clerkId: users.clerkUserId })
      .from(users).where(inArray(users.id, uniqueIds));
    return new Map(await Promise.all(rows.map(async user => {
      let entry = cache.get(user.clerkId);
      if (!entry || entry.expires <= Date.now()) {
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        entry = { expires: Date.now() + 5 * 60_000, value: lookupWithDeadline(lookup, user.clerkId) };
        const current = entry;
        current.value = current.value.catch(() => {
          // A profile service outage must not prevent reading a bill.
          current.expires = Date.now() + 30_000;
          return null;
        });
        cache.set(user.clerkId, current);
      }
      return [user.id, await entry.value] as const;
    })));
  };
}
export type AvatarReader = ReturnType<typeof createAvatarReader>;
