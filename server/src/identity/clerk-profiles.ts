import { clerkClient } from '@clerk/express';
import type { ProfileNameFields } from '@share-tally/domain/display-name';

export type ClerkProfile = ProfileNameFields & { clerkUserId: string };
// Verified Clerk account data for these users. Users Clerk no longer knows are omitted.
export type ProfileReader = (clerkUserIds: string[]) => Promise<ClerkProfile[]>;

// Clerk filters a user list by at most 100 IDs per request.
export const clerkProfiles: ProfileReader = async clerkUserIds => {
  const profiles: ClerkProfile[] = [];
  for (let start = 0; start < clerkUserIds.length; start += 100) {
    const userId = clerkUserIds.slice(start, start + 100);
    const { data } = await clerkClient.users.getUserList({ userId, limit: userId.length });
    for (const user of data) profiles.push({
      clerkUserId: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName,
    });
  }
  return profiles;
};
