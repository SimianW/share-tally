// Clerk's account fields, as both applications read them. Username is the
// account handle; Profile name is the separate first and last name.
export type ProfileNameFields = {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

// The one display rule: Profile name, then Username, then Member. Blank fields are absent.
export function resolveDisplayName(profile: ProfileNameFields): string {
  const profileName = [profile.firstName, profile.lastName].map(part => part?.trim()).filter(Boolean).join(' ');
  return profileName || profile.username?.trim() || 'Member';
}
