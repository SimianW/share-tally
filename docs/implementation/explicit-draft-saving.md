# Explicit draft saving and unified New bill

The owner selected draft-list prototype A on 2026-09-16: compact rows with a direct Continue button and a delete icon. All three interactive alternatives are preserved on `prototype/draft-list-options`, commit `c797697`. Run `cd client && pnpm prototype:drafts` on that branch and visit `http://dev-2a1m:5178/?variant=A#/prototype/drafts`.

New bill opens the guided receipt/item form directly. Split by amounts instead retains manual bill creation and its existing financial rules. The duplicate manual creation form is removed.

Opening a blank form and closing it creates no draft. X, Escape and backdrop use the same close handler. Changes trigger a discard confirmation; keeping edits returns to the form. Discard clears the browser recovery copy and preserves the last explicitly saved server version, including its photo. Save draft & close overwrites that version. Draft deletion is available from the list and editor, requires confirmation, and removes the draft plus its photo without affecting published bills or balances.

Receipt extraction, naming and price calculation use authenticated group-scoped preview endpoints. They accept the current editing data and return results without saving it. A new cropped photo remains in the editing buffer until explicit save or initiation; extraction may send that image to the configured provider without retaining it in the database. Existing photos can be scanned only by their draft owner. The existing provider concurrency and request limits also apply to preview calls.

Explicit save normalizes an optional replacement photo before committing the draft data and photo in one transaction. Revision checks reject competing edits without partially changing the photo. Retrying the same successfully saved payload returns the saved revision without renewing photo retention. Initialization retains the existing response-loss retry behavior.

Deletion locks the draft row, checks ownership, membership, revision and that the draft has not been initialized. Concurrent deletion and initialization have one winner. Already deleted or inaccessible IDs return the same harmless success response without exposing ownership. The photo foreign key cascades deletion. No schema migration is required.

Browser session recovery remains best effort. Large pending photos may exceed sessionStorage capacity; those edits stay in memory but cannot be recovered after a reload. Explicit saving uses the server and is not subject to browser storage quota.

Nested confirmation dialogs share the page scroll lock so closing both editor and confirmation restores normal scrolling.

Verification covers explicit save/photo atomicity, preview non-persistence, ownership, stale deletion, response-loss retries and deletion/initialization races at the Express boundary with isolated PostgreSQL. Browser smoke covers blank close, cropped-photo discard, saved-draft discard, overwrite and deletion, plus the existing receipt claiming and manual bill/repayment workflows. No production credentials or deployment are changed.
