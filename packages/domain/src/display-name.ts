// Clerk's account fields, as both applications read them. Username is the
// account handle; Profile name is the separate first and last name.
export type ProfileNameFields = {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

// The one display rule: Username, then Profile name, then Member.
export function resolveDisplayName(profile: ProfileNameFields): string {
  const username = profile.username?.trim();
  if (username) return username;
  const profileName = [profile.firstName, profile.lastName].map(part => part?.trim()).filter(Boolean).join(' ');
  return profileName || 'Member';
}
