# Display Profile names and find users by Username

ShareTally names people by their Profile name, falling back to their Username and then `Member`. This reverses the Username-first rule from #206. Clerk restricts Usernames so they can serve as identifiers: they are unique within the Clerk instance, stored in lowercase and limited to Latin characters. A Username therefore cannot show a capitalised handle such as `SimianW` (#212) or a name such as `王思民`. A Profile name keeps the case and script the person chose. A member who wants friends to see a handle sets it as their Profile name.

Profile names are not unique, so Username remains the identifier wherever someone has to find exactly one user, such as searching for a user or a future friend request. Within a group, members whose displayed names are the same also show their Username beside the name, so nobody records money against the wrong person. Members with distinct names show no Username.

## Considered Options

- **Keep Username first.** Rejected because it always appears in lowercase and cannot hold non-Latin names.
- **Store each user's preferred capitalisation of their Username.** Rejected because it adds a second editable name and still cannot hold non-Latin names.

## Consequences

Name synchronization skips a user whose Clerk account has not changed since their name was cached (ADR-0017). The new rule would therefore not reach those cached names on its own; they must be rewritten once when it ships.
