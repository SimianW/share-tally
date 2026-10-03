import { resolveDisplayName } from '@share-tally/domain/display-name';
import { db } from '../db/index.js';
import { sharedGroups } from '../groups/groups.js';
import type { ProfileReader } from '../identity/clerk-profiles.js';
import { allClerkUserIds, saveDisplayNames } from '../identity/users.js';
import { notifyGroupChanged, notifyMembersChanged } from '../realtime/group-events.js';

// Stores the current names of these users (default: every user) from verified Clerk
// data, then invalidates every view that shows a renamed user. Names are presentation
// only: no bill, share, claim or repayment is written. Overlapping synchronizations,
// in any process, cannot store a name older than the one already stored.
export async function syncDisplayNames(profiles: ProfileReader, clerkUserIds?: string[]) {
  const names = (await profiles(clerkUserIds ?? await allClerkUserIds())).map(profile => ({
    clerkUserId: profile.clerkUserId, displayName: resolveDisplayName(profile), updatedAt: new Date(profile.updatedAt),
  }));
  const { renamed, groupIds, memberIds } = await db.transaction(async tx => {
    const renamed = await saveDisplayNames(tx, names);
    return { renamed, ...await sharedGroups(tx, renamed) };
  });
  // Only after the names are committed, so a notified view rereads the new name.
  for (const groupId of groupIds) notifyGroupChanged(groupId);
  notifyMembersChanged(memberIds);
  return { names, renamed };
}
