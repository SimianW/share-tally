import { resolveDisplayName } from '@share-tally/domain/display-name';
import { db } from '../db/index.js';
import { sharedGroups } from '../groups/groups.js';
import type { ProfileReader } from '../identity/clerk-profiles.js';
import { allClerkUserIds, saveDisplayNames } from '../identity/users.js';
import { notifyGroupChanged, notifyMembersChanged } from '../realtime/group-events.js';

// One API process. Clerk reads may overlap, so an hourly pass never delays a
// member's own edit, but their writes take turns: a name read from Clerk before
// the stored one for that user was read is stale and is not stored.
let reads = 0;
const storedRead = new Map<string, number>();
let writes: Promise<unknown> = Promise.resolve();

// Stores the current names of these users (default: every user) from verified Clerk
// data, then invalidates every view that shows a renamed user. Names are presentation
// only: no bill, share, claim or repayment is written.
export async function syncDisplayNames(profiles: ProfileReader, clerkUserIds?: string[]) {
  const read = ++reads;
  const names = (await profiles(clerkUserIds ?? await allClerkUserIds()))
    .map(profile => ({ clerkUserId: profile.clerkUserId, displayName: resolveDisplayName(profile) }));
  const stored = writes.then(() => store(read, names));
  writes = stored.catch(() => {});
  const { renamed, groupIds, memberIds } = await stored;
  // Only after the names are committed, so a notified view rereads the new name.
  for (const groupId of groupIds) notifyGroupChanged(groupId);
  notifyMembersChanged(memberIds);
  return { names, renamed };
}

async function store(read: number, names: { clerkUserId: string; displayName: string }[]) {
  const current = names.filter(name => (storedRead.get(name.clerkUserId) ?? 0) < read);
  const result = await db.transaction(async tx => {
    const renamed = await saveDisplayNames(tx, current);
    return { renamed, ...await sharedGroups(tx, renamed) };
  });
  for (const name of current) storedRead.set(name.clerkUserId, read);
  return result;
}
