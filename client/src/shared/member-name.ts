// The server supplies a Username only for a full-name collision in this group.
// A short label (for example a participant chip) keeps that same tag decision.
export function memberName(person: { displayName: string; username?: string } | null | undefined,
  label = person?.displayName ?? 'Member') {
  return person?.username ? `${label} @${person.username}` : label;
}
