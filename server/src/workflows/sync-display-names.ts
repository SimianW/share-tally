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
  const renamed: string[] = [];
  // One short transaction per user: an hourly pass never holds one member's row
  // while it works through the others, so their own edits are never delayed.
  for (const name of names) {
    const saved = await db.transaction(async tx => {
      const ids = await saveDisplayNames(tx, [name]);
      return { ids, ...await sharedGroups(tx, ids) };
    });
    // Only after the name is committed, so a notified view rereads the new name.
    // The renamed user hears of it too, even without an active group.
    for (const groupId of saved.groupIds) notifyGroupChanged(groupId);
    notifyMembersChanged([...new Set([...saved.ids, ...saved.memberIds])]);
    renamed.push(...saved.ids);
  }
  return { names, renamed };
}
