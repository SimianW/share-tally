# Synchronize displayed names by rereading Clerk, not through webhooks

Displayed names come from Clerk, and the server caches each user's name for every group, bill and ledger read. To keep the cache current, the server rereads verified Clerk data itself in three cases, rather than receiving Clerk webhooks:

- After a member saves an edit in Clerk's account window, and whenever they open ShareTally, their browser asks the server to reread that member's own Clerk account. The request carries no name; the server trusts only what Clerk returns for the authenticated user.
- At startup and every hour, the server rereads every user in batches. This brings in users who never sign in again, and edits made outside ShareTally.
- A changed name is stored first, then announced to every active group the user belongs to and to the members of those groups, so open views reread it.

Clerk reads may overlap, so an hourly pass never delays a member's own edit. Stores take turns within the process, and a name read from Clerk before the one already stored for that user is discarded rather than written back.

Webhooks would also cover edits made outside ShareTally immediately, but need a public endpoint, a signing secret and a Clerk dashboard configuration in every environment. Edits made in ShareTally are the supported path, so they need not wait for the hourly pass; other edits may take up to an hour.

Group pages already hold one event stream for their group, which announces renames of its members. Home and Account, which span groups, hold a separate per-member stream instead, so these pages add no second stream to a tab. That stream reports a per-member names version, so a reconnecting or returning tab rereads only when it missed a rename. Like group streams, it assumes one API process.
